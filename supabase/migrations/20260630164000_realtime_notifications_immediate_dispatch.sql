do $$
begin
  alter publication supabase_realtime add table public.studio_notifications;
exception
  when duplicate_object then null;
end $$;

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
begin
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
  values (p_studio_id, p_kind, v_title, v_body, coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;

  insert into public.notifications_log (studio_id, appointment_id, channel, kind, recipient, payload, status)
  values (
    p_studio_id,
    nullif(coalesce(p_payload->>'appointment_id', ''), '')::uuid,
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

update public.studio_notifications
set title = trim(regexp_replace(title, '\s+from\s+\S+\s*$', '', 'i'))
where title ~* '\s+from\s+\S+\s*$';
