-- A receipt token is sent only after a delivery is claimed. Reject receipts
-- for rows that were never handed to a push provider.

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
    and d.status in ('delivering', 'sent')
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
  from public, anon, authenticated;
grant execute on function public.acknowledge_studio_notification_delivery(uuid, uuid, text)
  to service_role;

notify pgrst, 'reload schema';
