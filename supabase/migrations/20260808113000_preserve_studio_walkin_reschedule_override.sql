-- Marcações criadas pelo painel como encaixe podem existir fora da agenda
-- recorrente do profissional. Ao reagendá-las pelo próprio painel, preserve
-- esse caráter de encaixe, mas continue a bloquear profissionais inativos,
-- folgas, outras marcações e pedidos de pagamento concorrentes.

CREATE OR REPLACE FUNCTION public.is_staff_managerial_slot_bookable(
  p_studio_id uuid,
  p_staff_id uuid,
  p_starts_at timestamptz,
  p_duration_min integer,
  p_ignore_appointment_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_studio_id IS NULL
     OR p_staff_id IS NULL
     OR p_starts_at IS NULL
     OR p_duration_min IS NULL
     OR p_duration_min <= 0
     OR p_duration_min > 720 THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.studios AS studio
    JOIN public.staff AS staff
      ON staff.studio_id = studio.id
     AND staff.id = p_staff_id
     AND staff.is_active = true
     AND COALESCE(staff.current_status, 'online') <> 'absent'
    WHERE studio.id = p_studio_id
      AND studio.is_active = true
  ) THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.staff_time_off AS time_off
    WHERE time_off.staff_id = p_staff_id
      AND tstzrange(time_off.starts_at, time_off.ends_at, '[)') &&
          tstzrange(
            p_starts_at,
            p_starts_at + make_interval(mins => p_duration_min),
            '[)'
          )
  ) THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.appointments AS appointment
    WHERE appointment.staff_id = p_staff_id
      AND (p_ignore_appointment_id IS NULL OR appointment.id <> p_ignore_appointment_id)
      AND appointment.status NOT IN ('cancelled', 'no_show')
      AND tstzrange(appointment.starts_at, appointment.ends_at, '[)') &&
          tstzrange(
            p_starts_at,
            p_starts_at + make_interval(mins => p_duration_min),
            '[)'
          )
  ) THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.booking_payment_requests AS request
    WHERE request.staff_id = p_staff_id
      AND request.status IN ('awaiting_payment', 'processing', 'paid')
      AND request.expires_at > now()
      AND tstzrange(request.starts_at, request.ends_at, '[)') &&
          tstzrange(
            p_starts_at,
            p_starts_at + make_interval(mins => p_duration_min),
            '[)'
          )
  ) THEN
    RETURN false;
  END IF;

  RETURN true;
END
$function$;

REVOKE ALL ON FUNCTION public.is_staff_managerial_slot_bookable(uuid, uuid, timestamptz, integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_staff_managerial_slot_bookable(uuid, uuid, timestamptz, integer, uuid)
  TO service_role;

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
  v_original_local_start timestamp;
  v_original_local_end timestamp;
  v_is_managerial_override boolean;
  v_is_bookable boolean;
BEGIN
  IF p_appointment_id IS NULL
     OR p_studio_id IS NULL
     OR p_local_date IS NULL
     OR p_local_time IS NULL THEN
    RAISE EXCEPTION 'invalid_reschedule_datetime';
  END IF;

  SELECT
    appointment.id,
    appointment.studio_id,
    appointment.staff_id,
    appointment.status,
    appointment.starts_at,
    appointment.ends_at,
    appointment.total_duration_min,
    COALESCE(studio.timezone, 'Europe/Lisbon') AS timezone
  INTO v_appt
  FROM public.appointments AS appointment
  JOIN public.studios AS studio ON studio.id = appointment.studio_id
  WHERE appointment.id = p_appointment_id
    AND appointment.studio_id = p_studio_id
  FOR UPDATE OF appointment;

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

  SELECT COALESCE(SUM(service.duration_min), 0)::integer
  INTO v_duration
  FROM public.appointment_services AS service
  WHERE service.appointment_id = v_appt.id;

  v_duration := COALESCE(
    NULLIF(v_appt.total_duration_min, 0),
    NULLIF(v_duration, 0),
    GREATEST(
      15,
      CEIL(EXTRACT(EPOCH FROM (v_appt.ends_at - v_appt.starts_at)) / 60)::integer
    )
  );
  v_new_end := v_starts_at + make_interval(mins => v_duration);
  v_original_local_start := v_appt.starts_at AT TIME ZONE v_tz;
  v_original_local_end := v_appt.ends_at AT TIME ZONE v_tz;

  -- Um encaixe administrativo é identificado por já estar fora das janelas
  -- recorrentes. Reservas normais continuam sujeitas à disponibilidade usual.
  v_is_managerial_override := NOT EXISTS (
    SELECT 1
    FROM public.staff_availability AS availability
    WHERE availability.studio_id = p_studio_id
      AND availability.staff_id = v_appt.staff_id
      AND availability.weekday = EXTRACT(DOW FROM v_original_local_start)::integer
      AND availability.start_time <= v_original_local_start::time
      AND availability.end_time >= v_original_local_end::time
  );

  IF v_is_managerial_override THEN
    v_is_bookable := public.is_staff_managerial_slot_bookable(
      p_studio_id,
      v_appt.staff_id,
      v_starts_at,
      v_duration,
      v_appt.id
    );
  ELSE
    v_is_bookable := public.is_staff_slot_bookable(
      p_studio_id,
      v_appt.staff_id,
      v_starts_at,
      v_duration,
      NULL,
      v_appt.id
    );
  END IF;

  IF NOT v_is_bookable THEN
    RAISE EXCEPTION 'slot_unavailable';
  END IF;

  UPDATE public.appointments AS target
  SET
    starts_at = v_starts_at,
    ends_at = v_new_end,
    updated_at = now()
  WHERE target.id = v_appt.id
    AND target.studio_id = p_studio_id
  RETURNING target.id, target.starts_at, target.ends_at
  INTO appointment_id, starts_at, ends_at;

  IF appointment_id IS NULL THEN
    RAISE EXCEPTION 'appointment_not_found';
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
