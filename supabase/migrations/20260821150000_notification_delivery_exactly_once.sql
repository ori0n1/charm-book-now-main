alter table public.appointments
  add column if not exists notification_suppressed boolean not null default false;

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
  if coalesce(new.notification_suppressed, false) then
    return new;
  end if;

  select coalesce(c.name, 'Cliente') into v_client_name
  from public.clients c where c.id = new.client_id;
  select coalesce(timezone, 'Europe/Lisbon') into v_tz
  from public.studios where id = new.studio_id;
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

create or replace function public.finalize_stale_studio_notification_deliveries(
  p_studio_id uuid default null
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

  update public.studio_notification_deliveries
  set status = 'failed',
      lease_until = null,
      last_error = coalesce(last_error, 'delivery_lease_expired_after_max_attempts'),
      updated_at = now()
  where status = 'delivering'
    and lease_until < now()
    and attempt_count >= 12
    and (p_studio_id is null or studio_id = p_studio_id);

  get diagnostics v_count = row_count;
  return v_count;
end
$$;

revoke execute on function public.finalize_stale_studio_notification_deliveries(uuid)
  from public, anon, authenticated;
grant execute on function public.finalize_stale_studio_notification_deliveries(uuid)
  to service_role;

notify pgrst, 'reload schema';
