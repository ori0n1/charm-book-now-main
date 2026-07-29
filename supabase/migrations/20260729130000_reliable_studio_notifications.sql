-- Durable, idempotent studio notification outbox.
-- Existing callers keep using insert_studio_notification with the same signature.

alter table public.studio_notifications
  add column if not exists event_key text,
  add column if not exists action_url text;

create unique index if not exists idx_studio_notifications_event_key
  on public.studio_notifications(studio_id, event_key)
  where event_key is not null;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'studio_notifications_kind_check'
      and conrelid = 'public.studio_notifications'::regclass
  ) then
    alter table public.studio_notifications
      drop constraint studio_notifications_kind_check;
  end if;

  alter table public.studio_notifications
    add constraint studio_notifications_kind_check
    check (kind in (
      'new_appointment',
      'appointment_rescheduled',
      'appointment_cancelled',
      'payment_confirmed',
      'payment_failed',
      'new_client',
      'new_review',
      'refund_request',
      'withdrawal_requested',
      'critical_request'
    ));
end $$;

create table if not exists public.studio_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.studio_notifications(id) on delete cascade,
  studio_id uuid not null references public.studios(id) on delete cascade,
  subscription_id uuid references public.push_subscriptions(id) on delete set null,
  endpoint_fingerprint text not null,
  status text not null default 'pending'
    check (status in ('pending', 'delivering', 'retry', 'sent', 'failed', 'skipped')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  accepted_at timestamptz,
  last_attempt_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(notification_id, subscription_id)
);

create index if not exists idx_studio_notification_deliveries_due
  on public.studio_notification_deliveries(next_attempt_at, created_at)
  where status in ('pending', 'retry', 'delivering');

create index if not exists idx_studio_notification_deliveries_studio
  on public.studio_notification_deliveries(studio_id, created_at desc);

alter table public.studio_notification_deliveries enable row level security;

drop policy if exists "Members read studio notification deliveries"
  on public.studio_notification_deliveries;
create policy "Members read studio notification deliveries"
  on public.studio_notification_deliveries
  for select to authenticated
  using (public.is_studio_member(auth.uid(), studio_id));

drop policy if exists "Service role manages studio notification deliveries"
  on public.studio_notification_deliveries;
create policy "Service role manages studio notification deliveries"
  on public.studio_notification_deliveries
  for all to service_role
  using (true)
  with check (true);

create or replace function public.notification_default_action_url(
  p_kind text,
  p_payload jsonb
) returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_kind in ('new_appointment', 'appointment_rescheduled', 'appointment_cancelled')
      then '/admin/agenda'
    when p_kind in ('payment_confirmed', 'payment_failed', 'withdrawal_requested')
      then '/admin/recebimento'
    when p_kind in ('new_client', 'new_review')
      then '/admin/clientes'
    when p_kind = 'refund_request'
      then '/admin/politicas'
    else '/admin'
  end
$$;

create or replace function public.insert_studio_notification(
  p_studio_id uuid,
  p_kind text,
  p_title text,
  p_body text,
  p_payload jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_event_key text;
  v_action_url text;
  v_title text;
  v_body text;
  v_appointment_id uuid;
  v_related_studio_id uuid;
  v_inserted boolean := false;
begin
  if not exists (select 1 from public.studios where id = p_studio_id) then
    raise exception 'notification_studio_missing';
  end if;

  if nullif(v_payload->>'appointment_id', '') is not null then
    begin
      v_appointment_id := (v_payload->>'appointment_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'invalid_notification_appointment_id';
    end;

    select studio_id into v_related_studio_id
    from public.appointments
    where id = v_appointment_id;

    if v_related_studio_id is null then
      raise exception 'notification_appointment_missing';
    end if;
    if v_related_studio_id <> p_studio_id then
      raise exception 'notification_studio_mismatch';
    end if;
  end if;

  if nullif(v_payload->>'booking_request_id', '') is not null then
    select studio_id into v_related_studio_id
    from public.booking_payment_requests
    where id = (v_payload->>'booking_request_id')::uuid;
    if v_related_studio_id is null or v_related_studio_id <> p_studio_id then
      raise exception 'notification_booking_request_studio_mismatch';
    end if;
  end if;

  if nullif(v_payload->>'client_id', '') is not null then
    select studio_id into v_related_studio_id
    from public.clients
    where id = (v_payload->>'client_id')::uuid;
    if v_related_studio_id is null or v_related_studio_id <> p_studio_id then
      raise exception 'notification_client_studio_mismatch';
    end if;
  end if;

  if nullif(v_payload->>'review_id', '') is not null then
    select studio_id into v_related_studio_id
    from public.studio_reviews
    where id = (v_payload->>'review_id')::uuid;
    if v_related_studio_id is null or v_related_studio_id <> p_studio_id then
      raise exception 'notification_review_studio_mismatch';
    end if;
  end if;

  v_payload := jsonb_set(v_payload, '{studio_id}', to_jsonb(p_studio_id::text), true);
  v_title := trim(coalesce(p_title, ''));
  v_body := trim(coalesce(p_body, ''));

  if v_title = '' or v_title ~* '\m(from|insert|update|delete|upsert|select|payload|schema|table|row|uuid|endpoint|subscription|webhook)\M' then
    v_title := case p_kind
      when 'new_appointment' then 'Nova marcação recebida'
      when 'appointment_rescheduled' then 'Marcação remarcada'
      when 'appointment_cancelled' then 'Marcação cancelada'
      when 'payment_confirmed' then 'Pagamento aprovado'
      when 'payment_failed' then 'Pagamento não concluído'
      when 'new_client' then 'Novo cliente cadastrado'
      when 'new_review' then 'Nova avaliação recebida'
      when 'refund_request' then 'Pedido de reembolso recebido'
      when 'withdrawal_requested' then 'Pedido financeiro recebido'
      else 'Notificação'
    end;
  end if;

  if v_body = '' or v_body ~* '\m(from|insert|update|delete|upsert|select|payload|schema|table|row|uuid|endpoint|subscription|webhook)\M' then
    v_body := case p_kind
      when 'new_appointment' then 'Tem uma nova marcação para acompanhar no painel.'
      when 'appointment_rescheduled' then 'Uma marcação foi remarcada.'
      when 'appointment_cancelled' then 'Uma marcação foi cancelada.'
      when 'payment_confirmed' then 'Um pagamento foi aprovado.'
      when 'payment_failed' then 'Um pagamento precisa de atenção.'
      when 'new_client' then 'Um novo cliente foi adicionado ao estúdio.'
      when 'new_review' then 'O estúdio recebeu uma nova avaliação.'
      when 'refund_request' then 'Existe um pedido de reembolso para analisar.'
      when 'withdrawal_requested' then 'Existe uma atualização financeira para analisar.'
      else 'Tem uma nova atualização importante no painel.'
    end;
  end if;

  v_event_key := nullif(trim(coalesce(v_payload->>'event_key', '')), '');
  if v_event_key is null then
    v_event_key := concat_ws(
      ':',
      p_kind,
      coalesce(
        v_payload->>'payment_intent_id',
        v_payload->>'review_id',
        v_payload->>'client_id',
        v_payload->>'appointment_id',
        v_payload->>'booking_request_id',
        md5(v_payload::text)
      )
    );
  end if;

  v_action_url := nullif(trim(coalesce(v_payload->>'action_url', '')), '');
  if v_action_url is null or v_action_url !~ '^/admin(/|$|[?])' then
    v_action_url := public.notification_default_action_url(p_kind, v_payload);
  end if;

  insert into public.studio_notifications (
    studio_id,
    kind,
    title,
    body,
    payload,
    event_key,
    action_url
  )
  values (
    p_studio_id,
    p_kind,
    left(v_title, 160),
    left(v_body, 1000),
    v_payload,
    left(v_event_key, 500),
    v_action_url
  )
  on conflict (studio_id, event_key) where event_key is not null do nothing
  returning id into v_id;

  if v_id is not null then
    v_inserted := true;
  else
    select id into v_id
    from public.studio_notifications
    where studio_id = p_studio_id
      and event_key = left(v_event_key, 500);
  end if;

  if v_inserted then
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
      p_studio_id,
      v_appointment_id,
      'studio_realtime',
      p_kind,
      'studio:' || p_studio_id::text,
      jsonb_build_object(
        'event', 'studio_notification_created',
        'studio_notification_id', v_id,
        'event_key', v_event_key,
        'action_url', v_action_url
      ),
      'sent'
    );
  end if;

  return v_id;
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
  where n.created_at >= now() - interval '30 days'
    and n.read_at is null
    and (p_studio_id is null or n.studio_id = p_studio_id)
    and (p_notification_id is null or n.id = p_notification_id)
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
    n.payload,
    c.attempt_count
  from claimed c
  join public.studio_notifications n on n.id = c.notification_id
  join public.push_subscriptions ps on ps.id = c.subscription_id;
end
$$;

create or replace function public.notify_studio_appointment_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_name text := 'Cliente';
  v_tz text := 'Europe/Lisbon';
  v_when text;
begin
  select coalesce(c.name, 'Cliente')
    into v_client_name
  from public.clients c
  where c.id = new.client_id;

  select coalesce(timezone, 'Europe/Lisbon')
    into v_tz
  from public.studios
  where id = new.studio_id;

  v_when := to_char(new.starts_at at time zone v_tz, 'DD/MM/YYYY HH24:MI');

  if tg_op = 'INSERT' then
    perform public.insert_studio_notification(
      new.studio_id,
      'new_appointment',
      'Nova marcação recebida',
      v_client_name || ' realizou uma marcação para ' || v_when || '.',
      jsonb_build_object(
        'appointment_id', new.id,
        'client_id', new.client_id,
        'starts_at', new.starts_at,
        'event_key', 'new_appointment:' || new.id::text,
        'action_url', '/admin/agenda'
      )
    );
  elsif new.status = 'cancelled' and old.status is distinct from new.status then
    perform public.insert_studio_notification(
      new.studio_id,
      'appointment_cancelled',
      'Marcação cancelada',
      v_client_name || ' cancelou a marcação de ' || v_when || '.',
      jsonb_build_object(
        'appointment_id', new.id,
        'client_id', new.client_id,
        'status', new.status,
        'event_key', 'appointment:' || new.id::text || ':cancelled',
        'action_url', '/admin/agenda'
      )
    );
  elsif old.starts_at is distinct from new.starts_at
     or old.ends_at is distinct from new.ends_at
     or old.staff_id is distinct from new.staff_id then
    perform public.insert_studio_notification(
      new.studio_id,
      'appointment_rescheduled',
      'Marcação remarcada',
      v_client_name || ' remarcou para ' || v_when || '.',
      jsonb_build_object(
        'appointment_id', new.id,
        'client_id', new.client_id,
        'starts_at', new.starts_at,
        'staff_id', new.staff_id,
        'event_key', 'appointment:' || new.id::text || ':rescheduled:' ||
          extract(epoch from new.starts_at)::bigint::text || ':' || coalesce(new.staff_id::text, 'none'),
        'action_url', '/admin/agenda'
      )
    );
  end if;

  return new;
end
$$;

drop trigger if exists trg_notify_studio_appointment_lifecycle on public.appointments;
create trigger trg_notify_studio_appointment_lifecycle
  after insert or update of status, starts_at, ends_at, staff_id
  on public.appointments
  for each row execute function public.notify_studio_appointment_lifecycle();

-- The legacy trigger ran once per appointment-service row. The lifecycle
-- trigger above is the single source of truth and the event key protects
-- callers that still explicitly request an immediate dispatch.
drop trigger if exists trg_notify_new_appointment on public.appointments;
drop trigger if exists trg_notify_new_appointment_service on public.appointment_services;

create or replace function public.notify_studio_new_client()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.insert_studio_notification(
    new.studio_id,
    'new_client',
    'Novo cliente cadastrado',
    coalesce(nullif(trim(new.name), ''), 'Um novo cliente') || ' foi adicionado ao estúdio.',
    jsonb_build_object(
      'client_id', new.id,
      'event_key', 'client:' || new.id::text || ':created',
      'action_url', '/admin/clientes'
    )
  );
  return new;
end
$$;

drop trigger if exists trg_notify_studio_new_client on public.clients;
create trigger trg_notify_studio_new_client
  after insert on public.clients
  for each row execute function public.notify_studio_new_client();

create or replace function public.notify_studio_new_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.insert_studio_notification(
    new.studio_id,
    'new_review',
    'Nova avaliação recebida',
    coalesce(nullif(trim(new.reviewer_name), ''), 'Um cliente') ||
      ' deixou uma avaliação de ' || new.rating::text || ' estrelas.',
    jsonb_build_object(
      'review_id', new.id,
      'appointment_id', new.appointment_id,
      'rating', new.rating,
      'event_key', 'review:' || new.id::text || ':created',
      'action_url', '/admin/clientes'
    )
  );
  return new;
end
$$;

drop trigger if exists trg_notify_studio_new_review on public.studio_reviews;
create trigger trg_notify_studio_new_review
  after insert on public.studio_reviews
  for each row execute function public.notify_studio_new_review();

create or replace function public.notify_studio_payment_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;
  v_title text;
  v_body text;
  v_amount numeric := coalesce(new.amount_cents, 0)::numeric / 100;
begin
  if new.status not in ('succeeded', 'failed', 'canceled', 'expired') then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;

  if new.status = 'succeeded' then
    v_kind := 'payment_confirmed';
    v_title := 'Pagamento aprovado';
    v_body := 'Foi aprovado um pagamento de ' ||
      to_char(v_amount, 'FM999999990D00') || ' €.';
  else
    v_kind := 'payment_failed';
    v_title := case when new.status = 'expired'
      then 'Pagamento expirado'
      else 'Pagamento não concluído'
    end;
    v_body := 'O pagamento de ' ||
      to_char(v_amount, 'FM999999990D00') || ' € ficou com estado ' || new.status || '.';
  end if;

  perform public.insert_studio_notification(
    new.studio_id,
    v_kind,
    v_title,
    v_body,
    jsonb_build_object(
      'payment_intent_id', new.id,
      'appointment_id', new.appointment_id,
      'booking_request_id', new.booking_request_id,
      'status', new.status,
      'amount_cents', new.amount_cents,
      'event_key', 'payment:' || new.id::text || ':' || new.status,
      'action_url', '/admin/recebimento'
    )
  );
  return new;
end
$$;

drop trigger if exists trg_notify_payment_confirmed_insert on public.payment_intents;
drop trigger if exists trg_notify_payment_confirmed_update on public.payment_intents;
drop trigger if exists trg_notify_payment_problem_update on public.payment_intents;
drop trigger if exists trg_notify_studio_payment_lifecycle on public.payment_intents;
create trigger trg_notify_studio_payment_lifecycle
  after insert or update of status, appointment_id
  on public.payment_intents
  for each row execute function public.notify_studio_payment_lifecycle();

create or replace function public.notify_refund_request_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.insert_studio_notification(
    new.studio_id,
    'refund_request',
    'Novo pedido de reembolso',
    coalesce(nullif(trim(new.client_name), ''), 'Cliente') ||
      ' enviou um pedido de reembolso para análise.',
    jsonb_build_object(
      'refund_request_id', new.id,
      'appointment_id', new.appointment_id,
      'booking_request_id', new.booking_request_id,
      'payment_intent_id', new.payment_intent_id,
      'client_name', new.client_name,
      'event_key', 'refund:' || new.id::text || ':created',
      'action_url', '/admin/politicas'
    )
  );
  return new;
end
$$;

drop trigger if exists trg_notify_refund_request_created on public.refund_requests;
create trigger trg_notify_refund_request_created
  after insert on public.refund_requests
  for each row execute function public.notify_refund_request_created();

grant execute on function public.enqueue_studio_notification_deliveries(uuid, uuid) to service_role;
grant execute on function public.claim_studio_notification_deliveries(integer, uuid, uuid) to service_role;
revoke execute on function public.enqueue_studio_notification_deliveries(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.claim_studio_notification_deliveries(integer, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.insert_studio_notification(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.insert_studio_notification(uuid, text, text, text, jsonb) to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'studio_notifications'
     ) then
    alter publication supabase_realtime add table public.studio_notifications;
  end if;
end $$;

notify pgrst, 'reload schema';
