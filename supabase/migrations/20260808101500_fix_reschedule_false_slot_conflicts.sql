-- Reagendamento deve usar a mesma fonte de verdade intervalar das criações,
-- ignorando apenas a própria marcação que está a ser movida.
--
-- O fluxo anterior consultava get_available_slots (grade de 15 minutos) e
-- depois chamava is_staff_slot_bookable sem p_ignore_appointment_id. Isso
-- fazia a marcação conflitar consigo mesma e rejeitava minutos intermediários.

CREATE OR REPLACE FUNCTION public.get_public_reschedule_slots(
  p_public_token text,
  p_staff_id uuid,
  p_date date,
  p_slot_step_min integer DEFAULT 15
)
RETURNS TABLE(staff_id uuid, slot_start timestamptz, slot_label text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_appt record;
  v_duration integer;
  v_tz text;
  v_min_start timestamptz;
  v_weekday integer;
BEGIN
  IF length(trim(coalesce(p_public_token, ''))) < 16
     OR p_staff_id IS NULL
     OR p_date IS NULL THEN
    RETURN;
  END IF;
  IF p_slot_step_min IS NULL OR p_slot_step_min <= 0 OR p_slot_step_min > 720 THEN
    p_slot_step_min := 15;
  END IF;

  SELECT
    a.id,
    a.studio_id,
    a.status,
    a.starts_at,
    a.ends_at,
    a.total_duration_min,
    COALESCE(s.timezone, 'Europe/Lisbon') AS timezone,
    COALESCE(s.min_booking_notice_min, 30) AS min_booking_notice_min
  INTO v_appt
  FROM public.appointments AS a
  JOIN public.studios AS s ON s.id = a.studio_id
  WHERE a.public_token = p_public_token
    AND s.is_active = true
    AND public.has_active_premium_access(s.id);

  IF v_appt.id IS NULL
     OR v_appt.status IN ('cancelled', 'no_show', 'completed') THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(aps.duration_min), 0)::integer
  INTO v_duration
  FROM public.appointment_services AS aps
  WHERE aps.appointment_id = v_appt.id;

  v_duration := COALESCE(
    NULLIF(v_appt.total_duration_min, 0),
    NULLIF(v_duration, 0),
    GREATEST(
      15,
      CEIL(EXTRACT(EPOCH FROM (v_appt.ends_at - v_appt.starts_at)) / 60)::integer
    )
  );
  v_tz := COALESCE(NULLIF(v_appt.timezone, ''), 'Europe/Lisbon');
  v_min_start := now() + (GREATEST(v_appt.min_booking_notice_min, 0) || ' minutes')::interval;
  v_weekday := EXTRACT(DOW FROM p_date)::integer;

  RETURN QUERY
  WITH windows AS (
    SELECT sa.start_time, sa.end_time
    FROM public.staff_availability AS sa
    JOIN public.staff AS st
      ON st.id = sa.staff_id
     AND st.studio_id = v_appt.studio_id
     AND st.is_active = true
     AND COALESCE(st.current_status, 'online') <> 'absent'
    WHERE sa.studio_id = v_appt.studio_id
      AND sa.staff_id = p_staff_id
      AND sa.weekday = v_weekday
      AND sa.end_time > sa.start_time
      AND (sa.end_time - make_interval(mins => v_duration)) >= sa.start_time
  ),
  candidates AS (
    SELECT
      ((p_date::timestamp + candidate.local_ts::time) AT TIME ZONE v_tz) AS starts_at,
      candidate.local_ts::time AS local_time
    FROM windows AS w
    CROSS JOIN LATERAL generate_series(
      p_date::timestamp + w.start_time,
      p_date::timestamp + w.end_time - make_interval(mins => v_duration),
      make_interval(mins => p_slot_step_min)
    ) AS candidate(local_ts)
  )
  SELECT
    p_staff_id,
    candidate.starts_at,
    to_char(candidate.local_time, 'HH24:MI')
  FROM candidates AS candidate
  WHERE candidate.starts_at >= v_min_start
    AND public.is_staff_slot_bookable(
      v_appt.studio_id,
      p_staff_id,
      candidate.starts_at,
      v_duration,
      NULL,
      v_appt.id
    )
  ORDER BY candidate.starts_at;
END
$function$;

REVOKE ALL ON FUNCTION public.get_public_reschedule_slots(text, uuid, date, integer)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_reschedule_slots(text, uuid, date, integer)
  TO anon, authenticated, service_role;

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
  v_new_end timestamptz;
  v_min_booking_notice_min integer;
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
    a.total_duration_min,
    COALESCE(s.min_booking_notice_min, 30) AS min_booking_notice_min
  INTO v_appt
  FROM public.appointments AS a
  JOIN public.studios AS s ON s.id = a.studio_id
  WHERE a.public_token = p_public_token
    AND s.is_active = true
    AND public.has_active_premium_access(s.id)
  FOR UPDATE OF a;

  IF v_appt.id IS NULL THEN
    RAISE EXCEPTION 'appointment_not_found';
  END IF;
  IF v_appt.status IN ('cancelled', 'no_show', 'completed') THEN
    RAISE EXCEPTION 'appointment_not_reschedulable';
  END IF;

  v_min_booking_notice_min := GREATEST(v_appt.min_booking_notice_min, 0);
  IF p_starts_at < now() + (v_min_booking_notice_min || ' minutes')::interval THEN
    RAISE EXCEPTION 'slot_unavailable';
  END IF;

  SELECT COALESCE(SUM(aps.duration_min), 0)::integer
  INTO v_duration
  FROM public.appointment_services AS aps
  WHERE aps.appointment_id = v_appt.id;

  v_duration := COALESCE(
    NULLIF(v_appt.total_duration_min, 0),
    NULLIF(v_duration, 0),
    GREATEST(
      15,
      CEIL(EXTRACT(EPOCH FROM (v_appt.ends_at - v_appt.starts_at)) / 60)::integer
    )
  );
  v_new_end := p_starts_at + make_interval(mins => v_duration);

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
      v_duration,
      NULL,
      v_appt.id
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
    a.total_duration_min,
    COALESCE(s.timezone, 'Europe/Lisbon') AS timezone
  INTO v_appt
  FROM public.appointments AS a
  JOIN public.studios AS s ON s.id = a.studio_id
  WHERE a.id = p_appointment_id
    AND a.studio_id = p_studio_id
  FOR UPDATE OF a;

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

  v_duration := COALESCE(
    NULLIF(v_appt.total_duration_min, 0),
    NULLIF(v_duration, 0),
    GREATEST(
      15,
      CEIL(EXTRACT(EPOCH FROM (v_appt.ends_at - v_appt.starts_at)) / 60)::integer
    )
  );
  v_new_end := v_starts_at + make_interval(mins => v_duration);

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
      v_duration,
      NULL,
      v_appt.id
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
