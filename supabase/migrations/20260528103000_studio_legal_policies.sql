alter table public.studios
  add column if not exists cancellation_min_notice_hours integer not null default 24,
  add column if not exists cancellation_after_deadline_policy text not null default 'non_refundable',
  add column if not exists refund_requests_enabled boolean not null default true,
  add column if not exists cancellation_policy_text text,
  add column if not exists legal_policy_version text not null default '2026-05-28';

create table if not exists public.booking_policy_acceptances (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  booking_request_id uuid references public.booking_payment_requests(id) on delete set null,
  policy_version text not null,
  accepted_at timestamptz not null default now(),
  payment_timestamp timestamptz,
  ip_address text,
  user_agent text,
  payload jsonb not null default '{}'::jsonb
);

create index if not exists idx_policy_acceptances_studio
  on public.booking_policy_acceptances(studio_id, accepted_at desc);
create index if not exists idx_policy_acceptances_booking_request
  on public.booking_policy_acceptances(booking_request_id);
create index if not exists idx_policy_acceptances_appointment
  on public.booking_policy_acceptances(appointment_id);

alter table public.booking_policy_acceptances enable row level security;

drop policy if exists "Members read policy acceptances" on public.booking_policy_acceptances;
create policy "Members read policy acceptances"
on public.booking_policy_acceptances
for select
using (public.is_studio_member(studio_id, auth.uid()));

create table if not exists public.refund_requests (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  booking_request_id uuid references public.booking_payment_requests(id) on delete set null,
  payment_intent_id uuid references public.payment_intents(id) on delete set null,
  client_name text,
  client_phone text,
  client_email text,
  reason text not null,
  status text not null default 'pending',
  decision_note text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_refund_requests_studio
  on public.refund_requests(studio_id, created_at desc);
create index if not exists idx_refund_requests_status
  on public.refund_requests(status);

alter table public.refund_requests enable row level security;

drop policy if exists "Members manage refund requests" on public.refund_requests;
create policy "Members manage refund requests"
on public.refund_requests
for all
using (public.is_studio_member(studio_id, auth.uid()))
with check (public.is_studio_member(studio_id, auth.uid()));

create or replace function public.request_header(header_name text)
returns text
language plpgsql
stable
as $$
declare
  headers jsonb;
begin
  begin
    headers := current_setting('request.headers', true)::jsonb;
  exception when others then
    return null;
  end;
  return headers ->> lower(header_name);
end;
$$;

create or replace function public.record_public_policy_acceptance(
  p_studio_id uuid,
  p_booking_request_id uuid,
  p_appointment_id uuid,
  p_policy_version text,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_ok boolean := false;
  v_ip text;
begin
  if p_booking_request_id is not null then
    select exists (
      select 1 from public.booking_payment_requests
      where id = p_booking_request_id and studio_id = p_studio_id
    ) into v_ok;
  elsif p_appointment_id is not null then
    select exists (
      select 1 from public.appointments
      where id = p_appointment_id and studio_id = p_studio_id
    ) into v_ok;
  end if;

  if not v_ok then
    raise exception 'booking_not_found';
  end if;

  v_ip := coalesce(
    public.request_header('cf-connecting-ip'),
    split_part(coalesce(public.request_header('x-forwarded-for'), ''), ',', 1),
    public.request_header('x-real-ip')
  );

  insert into public.booking_policy_acceptances (
    studio_id,
    booking_request_id,
    appointment_id,
    policy_version,
    accepted_at,
    payment_timestamp,
    ip_address,
    user_agent,
    payload
  )
  values (
    p_studio_id,
    p_booking_request_id,
    p_appointment_id,
    coalesce(nullif(p_policy_version, ''), '2026-05-28'),
    now(),
    now(),
    nullif(trim(coalesce(v_ip, '')), ''),
    public.request_header('user-agent'),
    coalesce(p_payload, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.record_public_policy_acceptance(uuid, uuid, uuid, text, jsonb)
to anon, authenticated;

create or replace function public.submit_public_refund_request(
  p_booking_request_id uuid,
  p_appointment_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_req public.booking_payment_requests%rowtype;
  v_appt public.appointments%rowtype;
  v_payment_id uuid;
  v_client_name text;
  v_client_phone text;
  v_client_email text;
  v_studio_id uuid;
  v_enabled boolean;
begin
  if length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'refund_reason_required';
  end if;

  if p_booking_request_id is not null then
    select * into v_req from public.booking_payment_requests where id = p_booking_request_id;
    if not found then raise exception 'booking_not_found'; end if;
    v_studio_id := v_req.studio_id;
    v_client_name := v_req.client_name;
    v_client_phone := v_req.client_phone;
    v_client_email := v_req.client_email;
  elsif p_appointment_id is not null then
    select * into v_appt from public.appointments where id = p_appointment_id;
    if not found then raise exception 'booking_not_found'; end if;
    v_studio_id := v_appt.studio_id;
  else
    raise exception 'booking_not_found';
  end if;

  select refund_requests_enabled into v_enabled from public.studios where id = v_studio_id;
  if coalesce(v_enabled, false) = false then
    raise exception 'refund_requests_disabled';
  end if;

  select id into v_payment_id
  from public.payment_intents
  where (booking_request_id = p_booking_request_id or appointment_id = p_appointment_id)
    and status = 'succeeded'
  order by created_at desc
  limit 1;

  insert into public.refund_requests (
    studio_id,
    appointment_id,
    booking_request_id,
    payment_intent_id,
    client_name,
    client_phone,
    client_email,
    reason,
    status
  )
  values (
    v_studio_id,
    p_appointment_id,
    p_booking_request_id,
    v_payment_id,
    v_client_name,
    v_client_phone,
    v_client_email,
    trim(p_reason),
    'pending'
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.submit_public_refund_request(uuid, uuid, text)
to anon, authenticated;
