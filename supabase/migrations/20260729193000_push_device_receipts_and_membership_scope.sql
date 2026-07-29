-- Distinguish provider acceptance from actual Service Worker receipt/display,
-- and prevent subscriptions from users who no longer belong to the studio.

alter table public.studio_notification_deliveries
  add column if not exists receipt_token uuid not null default gen_random_uuid(),
  add column if not exists received_at timestamptz,
  add column if not exists displayed_at timestamptz;

create unique index if not exists idx_studio_notification_delivery_receipt
  on public.studio_notification_deliveries(id, receipt_token);

update public.push_subscriptions ps
set revoked_at = coalesce(ps.revoked_at, now()),
    revocation_reason = coalesce(ps.revocation_reason, 'studio_membership_removed'),
    updated_at = now()
where ps.revoked_at is null
  and ps.audience in ('studio', 'both')
  and not exists (
    select 1
    from public.user_roles ur
    where ur.user_id = ps.user_id
      and ur.studio_id = ps.studio_id
  );

create or replace function public.fanout_studio_notification_delivery()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  insert into public.studio_notification_deliveries (
    notification_id,
    studio_id,
    subscription_id,
    endpoint_fingerprint,
    status,
    next_attempt_at
  )
  select
    new.id,
    new.studio_id,
    ps.id,
    md5(ps.endpoint),
    'pending',
    now()
  from public.push_subscriptions ps
  where ps.studio_id = new.studio_id
    and ps.audience in ('studio', 'both')
    and ps.revoked_at is null
    and (ps.expiration_time is null or ps.expiration_time > floor(extract(epoch from now()) * 1000))
    and exists (
      select 1
      from public.user_roles ur
      where ur.user_id = ps.user_id
        and ur.studio_id = new.studio_id
    )
  on conflict (notification_id, subscription_id) do nothing;

  get diagnostics v_count = row_count;

  if v_count = 0 then
    insert into public.notifications_log (
      studio_id,
      appointment_id,
      channel,
      kind,
      recipient,
      payload,
      status,
      error
    )
    values (
      new.studio_id,
      nullif(new.payload->>'appointment_id', '')::uuid,
      'push_studio',
      new.kind,
      'studio:' || new.studio_id::text,
      jsonb_build_object(
        'event', 'studio_notification_not_enqueued',
        'studio_notification_id', new.id
      ),
      'skipped',
      'no_active_studio_push_subscription'
    );
  end if;

  return new;
end
$$;

create or replace function public.enqueue_studio_notification_deliveries(
  p_studio_id uuid default null,
  p_notification_id uuid default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden';
  end if;

  insert into public.studio_notification_deliveries (
    notification_id,
    studio_id,
    subscription_id,
    endpoint_fingerprint
  )
  select
    n.id,
    n.studio_id,
    ps.id,
    md5(ps.endpoint)
  from public.studio_notifications n
  join public.push_subscriptions ps
    on ps.studio_id = n.studio_id
   and ps.audience in ('studio', 'both')
   and ps.revoked_at is null
   and (ps.expiration_time is null or ps.expiration_time > floor(extract(epoch from now()) * 1000))
  where n.created_at >= now() - interval '30 days'
    and n.read_at is null
    and (p_studio_id is null or n.studio_id = p_studio_id)
    and (p_notification_id is null or n.id = p_notification_id)
    and exists (
      select 1
      from public.user_roles ur
      where ur.user_id = ps.user_id
        and ur.studio_id = n.studio_id
    )
  on conflict (notification_id, subscription_id) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end
$$;

create or replace function public.claim_studio_notification_deliveries(
  p_limit integer default 100,
  p_studio_id uuid default null,
  p_notification_id uuid default null
) returns table (
  delivery_id uuid,
  notification_id uuid,
  studio_id uuid,
  subscription_id uuid,
  endpoint text,
  p256dh text,
  auth text,
  user_id uuid,
  kind text,
  title text,
  body text,
  action_url text,
  payload jsonb,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden';
  end if;

  perform public.enqueue_studio_notification_deliveries(p_studio_id, p_notification_id);

  return query
  with candidates as (
    select d.id
    from public.studio_notification_deliveries d
    join public.studio_notifications n on n.id = d.notification_id
    join public.push_subscriptions ps
      on ps.id = d.subscription_id
     and ps.studio_id = d.studio_id
     and ps.audience in ('studio', 'both')
     and ps.revoked_at is null
    where d.attempt_count < 12
      and d.next_attempt_at <= now()
      and (
        d.status in ('pending', 'retry')
        or (d.status = 'delivering' and d.lease_until < now())
      )
      and (p_studio_id is null or d.studio_id = p_studio_id)
      and (p_notification_id is null or d.notification_id = p_notification_id)
      and exists (
        select 1
        from public.user_roles ur
        where ur.user_id = ps.user_id
          and ur.studio_id = d.studio_id
      )
    order by n.created_at asc, d.created_at asc
    limit greatest(1, least(coalesce(p_limit, 100), 500))
    for update of d skip locked
  ),
  claimed as (
    update public.studio_notification_deliveries d
    set status = 'delivering',
        attempt_count = d.attempt_count + 1,
        last_attempt_at = now(),
        lease_until = now() + interval '2 minutes',
        updated_at = now()
    from candidates c
    where d.id = c.id
    returning d.*
  )
  select
    c.id,
    c.notification_id,
    c.studio_id,
    c.subscription_id,
    ps.endpoint,
    ps.p256dh,
    ps.auth,
    ps.user_id,
    n.kind,
    n.title,
    n.body,
    coalesce(n.action_url, public.notification_default_action_url(n.kind, n.payload)),
    jsonb_set(
      coalesce(n.payload, '{}'::jsonb),
      '{delivery_receipt_token}',
      to_jsonb(c.receipt_token::text),
      true
    ),
    c.attempt_count
  from claimed c
  join public.studio_notifications n on n.id = c.notification_id
  join public.push_subscriptions ps on ps.id = c.subscription_id;
end
$$;

create or replace function public.acknowledge_studio_notification_delivery(
  p_delivery_id uuid,
  p_receipt_token uuid,
  p_stage text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delivery public.studio_notification_deliveries%rowtype;
  v_changed boolean := false;
  v_user_id uuid;
  v_kind text;
  v_appointment_id uuid;
begin
  if p_stage not in ('received', 'displayed') then
    return false;
  end if;

  select d.*
  into v_delivery
  from public.studio_notification_deliveries d
  where d.id = p_delivery_id
    and d.receipt_token = p_receipt_token
  for update;

  if v_delivery.id is null then
    return false;
  end if;

  if p_stage = 'received' and v_delivery.received_at is null then
    update public.studio_notification_deliveries
    set received_at = now(),
        updated_at = now()
    where id = v_delivery.id;
    v_changed := true;
  elsif p_stage = 'displayed' and v_delivery.displayed_at is null then
    update public.studio_notification_deliveries
    set received_at = coalesce(received_at, now()),
        displayed_at = now(),
        updated_at = now()
    where id = v_delivery.id;
    v_changed := true;
  end if;

  if v_changed then
    select ps.user_id, n.kind, nullif(n.payload->>'appointment_id', '')::uuid
    into v_user_id, v_kind, v_appointment_id
    from public.studio_notifications n
    left join public.push_subscriptions ps on ps.id = v_delivery.subscription_id
    where n.id = v_delivery.notification_id;

    insert into public.notifications_log (
      studio_id,
      appointment_id,
      channel,
      kind,
      recipient,
      payload,
      status
    )
    values (
      v_delivery.studio_id,
      v_appointment_id,
      'push_studio',
      coalesce(v_kind, 'push_receipt'),
      'user:' || coalesce(v_user_id::text, 'unknown'),
      jsonb_build_object(
        'event', 'studio_notification_device_receipt',
        'studio_notification_id', v_delivery.notification_id,
        'delivery_id', v_delivery.id,
        'subscription_id', v_delivery.subscription_id,
        'stage', p_stage,
        'attempt', v_delivery.attempt_count
      ),
      p_stage
    );
  end if;

  return true;
end
$$;

revoke execute on function public.acknowledge_studio_notification_delivery(uuid, uuid, text)
  from public;
grant execute on function public.acknowledge_studio_notification_delivery(uuid, uuid, text)
  to service_role;

revoke execute on function public.fanout_studio_notification_delivery()
  from public, anon, authenticated;
revoke execute on function public.enqueue_studio_notification_deliveries(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.claim_studio_notification_deliveries(integer, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.enqueue_studio_notification_deliveries(uuid, uuid)
  to service_role;
grant execute on function public.claim_studio_notification_deliveries(integer, uuid, uuid)
  to service_role;

notify pgrst, 'reload schema';
