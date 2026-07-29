-- Self-healing Web Push subscriptions and immediate durable fan-out.
-- Keeps studio isolation intact while making terminal endpoints diagnosable.

alter table public.push_subscriptions
  add column if not exists revocation_reason text;

update public.push_subscriptions ps
set revocation_reason = coalesce(
  ps.revocation_reason,
  (
    select d.last_error
    from public.studio_notification_deliveries d
    where d.subscription_id = ps.id
      and d.last_error is not null
    order by d.updated_at desc
    limit 1
  ),
  'legacy_revocation'
)
where ps.revoked_at is not null
  and ps.revocation_reason is null;

create index if not exists idx_push_subscriptions_active_studio_user
  on public.push_subscriptions(studio_id, user_id, updated_at desc)
  where revoked_at is null and audience in ('studio', 'both');

create or replace function public.revoke_terminal_studio_push_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 401/403 normally indicate a VAPID/provider configuration problem. Keeping
  -- the subscription allows recovery after configuration is corrected.
  if new.status = 'failed'
     and new.subscription_id is not null
     and new.last_error in ('web_push_400', 'web_push_404', 'web_push_410') then
    update public.push_subscriptions
    set revoked_at = coalesce(revoked_at, now()),
        revocation_reason = new.last_error,
        updated_at = now()
    where id = new.subscription_id
      and revoked_at is null;
  end if;

  return new;
end
$$;

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

drop trigger if exists trg_fanout_studio_notification_delivery
  on public.studio_notifications;
create trigger trg_fanout_studio_notification_delivery
  after insert on public.studio_notifications
  for each row execute function public.fanout_studio_notification_delivery();

revoke execute on function public.fanout_studio_notification_delivery()
  from public, anon, authenticated;

-- Queue every still-unread recent notification for currently valid devices.
insert into public.studio_notification_deliveries (
  notification_id,
  studio_id,
  subscription_id,
  endpoint_fingerprint,
  status,
  next_attempt_at
)
select
  n.id,
  n.studio_id,
  ps.id,
  md5(ps.endpoint),
  'pending',
  now()
from public.studio_notifications n
join public.push_subscriptions ps
  on ps.studio_id = n.studio_id
 and ps.audience in ('studio', 'both')
 and ps.revoked_at is null
 and (ps.expiration_time is null or ps.expiration_time > floor(extract(epoch from now()) * 1000))
where n.read_at is null
  and n.created_at >= now() - interval '30 days'
on conflict (notification_id, subscription_id) do nothing;

notify pgrst, 'reload schema';
