CREATE OR REPLACE FUNCTION public.reschedule_public_appointment(
  p_public_token text,
  p_staff_id uuid,
  p_starts_at timestamptz
)
RETURNS TABLE(appointment_id uuid, starts_at timestamptz, ends_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_appt record;
  v_duration integer;
  v_slot record;
  v_new_end timestamptz;
  v_tz text;
BEGIN
  IF length(trim(coalesce(p_public_token, ''))) < 16 THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;

  SELECT
    a.id,
    a.public_token,
    a.studio_id,
    a.status,
    a.starts_at,
    a.ends_at,
    s.slug,
    COALESCE(s.timezone, 'Europe/Lisbon') AS timezone
  INTO v_appt
  FROM public.appointments a
  JOIN public.studios s ON s.id = a.studio_id
  WHERE a.public_token = p_public_token
  FOR UPDATE;

  IF v_appt.id IS NULL THEN
    RAISE EXCEPTION 'appointment_not_found';
  END IF;

  IF v_appt.status IN ('cancelled', 'no_show', 'completed') THEN
    RAISE EXCEPTION 'appointment_not_reschedulable';
  END IF;

  v_tz := COALESCE(NULLIF(v_appt.timezone, ''), 'Europe/Lisbon');

  SELECT COALESCE(SUM(duration_min), 0)::integer
  INTO v_duration
  FROM public.appointment_services
  WHERE appointment_id = v_appt.id;

  IF v_duration <= 0 THEN
    v_duration := GREATEST(15, CEIL(EXTRACT(EPOCH FROM (v_appt.ends_at - v_appt.starts_at)) / 60)::integer);
  END IF;

  SELECT slot.staff_id, slot.slot_start
  INTO v_slot
  FROM public.get_available_slots(v_appt.slug, p_staff_id, (p_starts_at AT TIME ZONE v_tz)::date, v_duration, 15) slot
  WHERE slot.staff_id = p_staff_id
    AND abs(EXTRACT(EPOCH FROM (slot.slot_start - p_starts_at))) < 60
  LIMIT 1;

  IF v_slot.staff_id IS NULL THEN
    RAISE EXCEPTION 'slot_unavailable';
  END IF;

  v_new_end := p_starts_at + (v_duration || ' minutes')::interval;

  UPDATE public.appointments
  SET
    staff_id = p_staff_id,
    starts_at = p_starts_at,
    ends_at = v_new_end,
    status = 'confirmed',
    updated_at = now()
  WHERE id = v_appt.id
    AND public.is_staff_slot_bookable(v_appt.studio_id, p_staff_id, p_starts_at, v_duration)
  RETURNING id, appointments.starts_at, appointments.ends_at
  INTO appointment_id, starts_at, ends_at;

  IF appointment_id IS NULL THEN
    RAISE EXCEPTION 'slot_unavailable';
  END IF;

  RETURN NEXT;
END
$function$;

GRANT EXECUTE ON FUNCTION public.reschedule_public_appointment(text, uuid, timestamptz) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
