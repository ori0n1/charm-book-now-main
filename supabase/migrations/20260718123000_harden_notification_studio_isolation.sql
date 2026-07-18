create or replace function public.insert_studio_notification(
  p_studio_id uuid,
  p_kind text,
  p_title text,
  p_body text,
  p_payload jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public as $$
declare
  v_id uuid;
  v_title text;
  v_body text;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_appointment_id uuid;
  v_appointment_text text;
  v_appointment_studio_id uuid;
  v_booking_request_id uuid;
  v_booking_request_text text;
  v_booking_request_studio_id uuid;
  v_booking_request_appointment_id uuid;
begin
  if not exists (select 1 from public.studios where id = p_studio_id) then
    raise exception 'notification_studio_missing';
  end if;

  v_appointment_text := nullif(trim(coalesce(v_payload->>'appointment_id', '')), '');
  if v_appointment_text is not null then
    if v_appointment_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'invalid_notification_appointment_id';
    end if;

    v_appointment_id := v_appointment_text::uuid;
    select studio_id
      into v_appointment_studio_id
      from public.appointments
      where id = v_appointment_id;

    if v_appointment_studio_id is null then
      raise exception 'notification_appointment_missing';
    end if;

    if v_appointment_studio_id <> p_studio_id then
      raise exception 'notification_studio_mismatch';
    end if;
  end if;

  v_booking_request_text := nullif(trim(coalesce(v_payload->>'booking_request_id', '')), '');
  if v_booking_request_text is not null then
    if v_booking_request_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'invalid_notification_booking_request_id';
    end if;

    v_booking_request_id := v_booking_request_text::uuid;
    select studio_id, appointment_id
      into v_booking_request_studio_id, v_booking_request_appointment_id
      from public.booking_payment_requests
      where id = v_booking_request_id;

    if v_booking_request_studio_id is null then
      raise exception 'notification_booking_request_missing';
    end if;

    if v_booking_request_studio_id <> p_studio_id then
      raise exception 'notification_booking_request_studio_mismatch';
    end if;

    if v_appointment_id is not null
      and v_booking_request_appointment_id is not null
      and v_booking_request_appointment_id <> v_appointment_id then
      raise exception 'notification_booking_request_appointment_mismatch';
    end if;
  end if;

  v_payload := jsonb_set(v_payload, '{studio_id}', to_jsonb(p_studio_id::text), true);

  v_title := trim(coalesce(p_title, ''));
  v_body := trim(coalesce(p_body, ''));

  if v_title = '' or v_title ~* '\m(from|insert|update|delete|upsert|select|payload|schema|table|row|uuid|endpoint|subscription|webhook)\M' then
    v_title := case
      when p_kind = 'new_appointment' then U&'Nova marca\00E7\00E3o recebida'
      when p_kind = 'payment_confirmed' then 'Pagamento confirmado'
      when p_kind = 'payment_failed' then U&'Pagamento n\00E3o conclu\00EDdo'
      when p_kind = 'refund_request' then 'Pedido de reembolso recebido'
      when p_kind = 'withdrawal_requested' then 'Pedido financeiro recebido'
      else U&'Notifica\00E7\00E3o'
    end;
  end if;

  v_title := trim(regexp_replace(v_title, '\s+from\s+\S+\s*$', '', 'i'));

  if v_body = '' or v_body ~* '\m(from|insert|update|delete|upsert|select|payload|schema|table|row|uuid|endpoint|subscription|webhook)\M' then
    v_body := case
      when p_kind = 'new_appointment' then U&'Tem uma nova marca\00E7\00E3o para acompanhar no painel.'
      when p_kind = 'payment_confirmed' then 'Um pagamento foi confirmado.'
      when p_kind = 'payment_failed' then U&'Um pagamento precisa de aten\00E7\00E3o.'
      when p_kind = 'refund_request' then 'Existe um pedido de reembolso para analisar.'
      when p_kind = 'withdrawal_requested' then U&'Existe uma nova atualiza\00E7\00E3o financeira para analisar.'
      else U&'Tem uma nova a\00E7\00E3o importante no painel.'
    end;
  end if;

  insert into public.studio_notifications (studio_id, kind, title, body, payload)
  values (p_studio_id, p_kind, v_title, v_body, v_payload)
  returning id into v_id;

  insert into public.notifications_log (studio_id, appointment_id, channel, kind, recipient, payload, status)
  values (
    p_studio_id,
    v_appointment_id,
    'studio_realtime',
    p_kind,
    'studio:' || p_studio_id::text,
    jsonb_build_object(
      'event', 'studio_notification_created',
      'studio_notification_id', v_id,
      'title', v_title,
      'body', v_body
    ),
    'sent'
  );

  return v_id;
end $$;

create index if not exists idx_push_subscriptions_active_endpoint_user_studio
  on public.push_subscriptions(endpoint, user_id, studio_id, audience)
  where revoked_at is null;

with ranked as (
  select
    id,
    row_number() over (
      partition by
        endpoint,
        user_id,
        case when audience in ('studio', 'both') then 'studio' else 'client' end
      order by updated_at desc nulls last, id desc
    ) as rn
  from public.push_subscriptions
  where revoked_at is null
    and endpoint is not null
    and user_id is not null
    and studio_id is not null
)
update public.push_subscriptions ps
set revoked_at = now(),
    updated_at = now()
from ranked
where ps.id = ranked.id
  and ranked.rn > 1;
