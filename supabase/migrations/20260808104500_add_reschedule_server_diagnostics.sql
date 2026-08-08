-- Diagnóstico interno e restrito para explicar rejeições de reagendamento.
-- Não altera regras de disponibilidade e não é acessível por anon/authenticated.

CREATE OR REPLACE FUNCTION public.diagnose_studio_reschedule_slot(
  p_appointment_id uuid,
  p_studio_id uuid,
  p_local_date date,
  p_local_time time
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_appt record;
  v_duration integer;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_local_start timestamp;
  v_local_end timestamp;
  v_conflict record;
BEGIN
  SELECT
    a.id,
    a.staff_id,
    a.status,
    a.starts_at,
    a.ends_at,
    a.total_duration_min,
    s.is_active AS studio_active,
    COALESCE(s.timezone, 'Europe/Lisbon') AS timezone
  INTO v_appt
  FROM public.appointments AS a
  JOIN public.studios AS s ON s.id = a.studio_id
  WHERE a.id = p_appointment_id
    AND a.studio_id = p_studio_id;

  IF v_appt.id IS NULL THEN
    RETURN jsonb_build_object('reason', 'appointment_not_found');
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
  v_starts_at := (p_local_date::timestamp + p_local_time) AT TIME ZONE v_appt.timezone;
  v_ends_at := v_starts_at + make_interval(mins => v_duration);
  v_local_start := v_starts_at AT TIME ZONE v_appt.timezone;
  v_local_end := v_ends_at AT TIME ZONE v_appt.timezone;

  IF NOT v_appt.studio_active THEN
    RETURN jsonb_build_object('reason', 'studio_inactive');
  END IF;

  SELECT st.id, st.is_active, st.current_status
  INTO v_conflict
  FROM public.staff AS st
  WHERE st.id = v_appt.staff_id
    AND st.studio_id = p_studio_id;

  IF v_conflict.id IS NULL THEN
    RETURN jsonb_build_object('reason', 'staff_not_found');
  END IF;
  IF NOT v_conflict.is_active THEN
    RETURN jsonb_build_object('reason', 'staff_inactive');
  END IF;
  IF COALESCE(v_conflict.current_status, 'online') = 'absent' THEN
    RETURN jsonb_build_object('reason', 'staff_absent');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.staff_availability AS sa
    WHERE sa.studio_id = p_studio_id
      AND sa.staff_id = v_appt.staff_id
      AND sa.weekday = EXTRACT(DOW FROM v_local_start)::integer
      AND sa.start_time <= v_local_start::time
      AND sa.end_time >= v_local_end::time
  ) THEN
    RETURN jsonb_build_object(
      'reason', 'outside_staff_availability',
      'weekday', EXTRACT(DOW FROM v_local_start)::integer,
      'local_start', to_char(v_local_start, 'YYYY-MM-DD HH24:MI'),
      'local_end', to_char(v_local_end, 'YYYY-MM-DD HH24:MI'),
      'duration_min', v_duration
    );
  END IF;

  SELECT t.id, t.starts_at, t.ends_at
  INTO v_conflict
  FROM public.staff_time_off AS t
  WHERE t.staff_id = v_appt.staff_id
    AND tstzrange(t.starts_at, t.ends_at, '[)') && tstzrange(v_starts_at, v_ends_at, '[)')
  ORDER BY t.starts_at
  LIMIT 1;
  IF v_conflict.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'reason', 'staff_time_off',
      'conflict_id', v_conflict.id,
      'conflict_start', v_conflict.starts_at,
      'conflict_end', v_conflict.ends_at
    );
  END IF;

  SELECT a.id, a.status, a.starts_at, a.ends_at
  INTO v_conflict
  FROM public.appointments AS a
  WHERE a.staff_id = v_appt.staff_id
    AND a.id <> v_appt.id
    AND a.status NOT IN ('cancelled', 'no_show')
    AND tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(v_starts_at, v_ends_at, '[)')
  ORDER BY a.starts_at
  LIMIT 1;
  IF v_conflict.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'reason', 'active_appointment_conflict',
      'conflict_id', v_conflict.id,
      'conflict_status', v_conflict.status,
      'conflict_start', v_conflict.starts_at,
      'conflict_end', v_conflict.ends_at
    );
  END IF;

  SELECT bpr.id, bpr.status, bpr.starts_at, bpr.ends_at
  INTO v_conflict
  FROM public.booking_payment_requests AS bpr
  WHERE bpr.staff_id = v_appt.staff_id
    AND bpr.status IN ('awaiting_payment', 'processing', 'paid')
    AND bpr.expires_at > now()
    AND tstzrange(bpr.starts_at, bpr.ends_at, '[)') && tstzrange(v_starts_at, v_ends_at, '[)')
  ORDER BY bpr.starts_at
  LIMIT 1;
  IF v_conflict.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'reason', 'active_payment_request_conflict',
      'conflict_id', v_conflict.id,
      'conflict_status', v_conflict.status,
      'conflict_start', v_conflict.starts_at,
      'conflict_end', v_conflict.ends_at
    );
  END IF;

  RETURN jsonb_build_object(
    'reason', 'bookable_or_constraint_race',
    'local_start', to_char(v_local_start, 'YYYY-MM-DD HH24:MI'),
    'local_end', to_char(v_local_end, 'YYYY-MM-DD HH24:MI'),
    'duration_min', v_duration
  );
END
$function$;

REVOKE ALL ON FUNCTION public.diagnose_studio_reschedule_slot(uuid, uuid, date, time)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.diagnose_studio_reschedule_slot(uuid, uuid, date, time)
  TO service_role;

NOTIFY pgrst, 'reload schema';
