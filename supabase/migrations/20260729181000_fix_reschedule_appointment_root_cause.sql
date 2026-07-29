-- Fixes the production reschedule failure caused by the output parameter
-- `appointment_id` colliding with appointment_services.appointment_id.
-- Every column that can collide with a PL/pgSQL variable is explicitly
-- qualified. The operation remains atomic and the exclusion constraint on
-- appointments continues to be the final concurrency guard.

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
  IF p_staff_id IS NULL OR p_starts_at IS NULL THEN
    RAISE EXCEPTION 'invalid_reschedule_datetime';
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
  FROM public.appointments AS a
  JOIN public.studios AS s ON s.id = a.studio_id
  WHERE a.public_token = p_public_token
  FOR UPDATE;

  IF v_appt.id IS NULL THEN
    RAISE EXCEPTION 'appointment_not_found';
  END IF;
  IF v_appt.status IN ('cancelled', 'no_show', 'completed') THEN
    RAISE EXCEPTION 'appointment_not_reschedulable';
  END IF;

  v_tz := COALESCE(NULLIF(v_appt.timezone, ''), 'Europe/Lisbon');

  SELECT COALESCE(SUM(aps.duration_min), 0)::integer
  INTO v_duration
  FROM public.appointment_services AS aps
  WHERE aps.appointment_id = v_appt.id;

  IF v_duration <= 0 THEN
    v_duration := GREATEST(
      15,
      CEIL(EXTRACT(EPOCH FROM (v_appt.ends_at - v_appt.starts_at)) / 60)::integer
    );
  END IF;

  SELECT available.staff_id, available.slot_start
  INTO v_slot
  FROM public.get_available_slots(
    v_appt.slug,
    p_staff_id,
    (p_starts_at AT TIME ZONE v_tz)::date,
    v_duration,
    15
  ) AS available
  WHERE available.staff_id = p_staff_id
    AND abs(EXTRACT(EPOCH FROM (available.slot_start - p_starts_at))) < 60
  LIMIT 1;

  IF v_slot.staff_id IS NULL THEN
    RAISE EXCEPTION 'slot_unavailable';
  END IF;

  v_new_end := p_starts_at + (v_duration || ' minutes')::interval;

  UPDATE public.appointments AS target
  SET
    staff_id = p_staff_id,
    starts_at = p_starts_at,
    ends_at = v_new_end,
    status = 'confirmed',
    updated_at = now()
  WHERE target.id = v_appt.id
    AND public.is_staff_slot_bookable(
      v_appt.studio_id,
      p_staff_id,
      p_starts_at,
      v_duration
    )
  RETURNING target.id, target.starts_at, target.ends_at
  INTO appointment_id, starts_at, ends_at;

  IF appointment_id IS NULL THEN
    RAISE EXCEPTION 'slot_unavailable';
  END IF;

  RETURN NEXT;
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'slot_unavailable';
END
$function$;

REVOKE ALL ON FUNCTION public.reschedule_public_appointment(text, uuid, timestamptz)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reschedule_public_appointment(text, uuid, timestamptz)
  TO anon, authenticated, service_role;

-- The studio flow receives the wall-clock date/time selected in the panel and
-- resolves it in the studio timezone inside PostgreSQL. This prevents a device
-- timezone from shifting the appointment.
CREATE OR REPLACE FUNCTION public.reschedule_studio_appointment(
  p_appointment_id uuid,
  p_studio_id uuid,
  p_local_date date,
  p_local_time time
)
RETURNS TABLE(
  appointment_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  rescheduled boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_appt record;
  v_duration integer;
  v_slot record;
  v_starts_at timestamptz;
  v_new_end timestamptz;
  v_tz text;
BEGIN
  IF p_appointment_id IS NULL
     OR p_studio_id IS NULL
     OR p_local_date IS NULL
     OR p_local_time IS NULL THEN
    RAISE EXCEPTION 'invalid_reschedule_datetime';
  END IF;

  SELECT
    a.id,
    a.studio_id,
    a.staff_id,
    a.status,
    a.starts_at,
    a.ends_at,
    s.slug,
    COALESCE(s.timezone, 'Europe/Lisbon') AS timezone
  INTO v_appt
  FROM public.appointments AS a
  JOIN public.studios AS s ON s.id = a.studio_id
  WHERE a.id = p_appointment_id
    AND a.studio_id = p_studio_id
  FOR UPDATE;

  IF v_appt.id IS NULL THEN
    RAISE EXCEPTION 'appointment_not_found';
  END IF;
  IF v_appt.status IN ('cancelled', 'no_show', 'completed') THEN
    RAISE EXCEPTION 'appointment_not_reschedulable';
  END IF;

  v_tz := COALESCE(NULLIF(v_appt.timezone, ''), 'Europe/Lisbon');
  v_starts_at := (p_local_date::timestamp + p_local_time) AT TIME ZONE v_tz;

  IF abs(EXTRACT(EPOCH FROM (v_starts_at - v_appt.starts_at))) < 60 THEN
    appointment_id := v_appt.id;
    starts_at := v_appt.starts_at;
    ends_at := v_appt.ends_at;
    rescheduled := false;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT COALESCE(SUM(aps.duration_min), 0)::integer
  INTO v_duration
  FROM public.appointment_services AS aps
  WHERE aps.appointment_id = v_appt.id;

  IF v_duration <= 0 THEN
    v_duration := GREATEST(
      15,
      CEIL(EXTRACT(EPOCH FROM (v_appt.ends_at - v_appt.starts_at)) / 60)::integer
    );
  END IF;

  SELECT available.staff_id, available.slot_start
  INTO v_slot
  FROM public.get_available_slots(
    v_appt.slug,
    v_appt.staff_id,
    p_local_date,
    v_duration,
    15
  ) AS available
  WHERE available.staff_id = v_appt.staff_id
    AND abs(EXTRACT(EPOCH FROM (available.slot_start - v_starts_at))) < 60
  LIMIT 1;

  IF v_slot.staff_id IS NULL THEN
    RAISE EXCEPTION 'slot_unavailable';
  END IF;

  v_new_end := v_starts_at + (v_duration || ' minutes')::interval;

  UPDATE public.appointments AS target
  SET
    starts_at = v_starts_at,
    ends_at = v_new_end,
    updated_at = now()
  WHERE target.id = v_appt.id
    AND target.studio_id = p_studio_id
    AND public.is_staff_slot_bookable(
      p_studio_id,
      v_appt.staff_id,
      v_starts_at,
      v_duration
    )
  RETURNING target.id, target.starts_at, target.ends_at
  INTO appointment_id, starts_at, ends_at;

  IF appointment_id IS NULL THEN
    RAISE EXCEPTION 'slot_unavailable';
  END IF;

  rescheduled := true;
  RETURN NEXT;
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'slot_unavailable';
END
$function$;

REVOKE ALL ON FUNCTION public.reschedule_studio_appointment(uuid, uuid, date, time)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_studio_appointment(uuid, uuid, date, time)
  TO service_role;

NOTIFY pgrst, 'reload schema';
