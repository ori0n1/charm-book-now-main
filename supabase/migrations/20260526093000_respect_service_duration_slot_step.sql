CREATE OR REPLACE FUNCTION public.get_available_slots(
  p_studio_slug text,
  p_staff_id uuid,
  p_date date,
  p_duration_min integer,
  p_slot_step_min integer DEFAULT 15
)
RETURNS TABLE(staff_id uuid, slot_start timestamp with time zone, slot_label text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_studio_id uuid;
  v_tz text := 'Europe/Lisbon';
  v_weekday int;
  v_now timestamptz := now();
  v_min_booking_notice_min integer := 30;
  v_min_start timestamptz;
  v_effective_slot_step_min integer;
BEGIN
  IF p_duration_min IS NULL OR p_duration_min <= 0 OR p_duration_min > 720 THEN
    RETURN;
  END IF;

  IF p_slot_step_min IS NULL OR p_slot_step_min <= 0 OR p_slot_step_min > 720 THEN
    p_slot_step_min := 15;
  END IF;

  v_effective_slot_step_min := GREATEST(p_slot_step_min, p_duration_min);

  SELECT id, timezone, COALESCE(min_booking_notice_min, 30)
  INTO v_studio_id, v_tz, v_min_booking_notice_min
  FROM public.studios
  WHERE slug = p_studio_slug AND is_active = true;

  IF v_studio_id IS NULL THEN
    RETURN;
  END IF;

  v_min_start := v_now + (GREATEST(v_min_booking_notice_min, 0) || ' minutes')::interval;
  v_weekday := EXTRACT(DOW FROM p_date)::int;

  RETURN QUERY
  WITH eligible_staff AS (
    SELECT s.id
    FROM public.staff s
    WHERE s.studio_id = v_studio_id
      AND s.is_active = true
      AND (p_staff_id IS NULL OR s.id = p_staff_id)
  ),
  windows AS (
    SELECT sa.staff_id, sa.start_time, sa.end_time
    FROM public.staff_availability sa
    JOIN eligible_staff es ON es.id = sa.staff_id
    WHERE sa.studio_id = v_studio_id
      AND sa.weekday = v_weekday
      AND sa.end_time > sa.start_time
      AND (sa.end_time - (p_duration_min || ' minutes')::interval) >= sa.start_time
  ),
  candidates AS (
    SELECT
      w.staff_id,
      ((p_date::timestamp + (slot.local_ts::time)) AT TIME ZONE v_tz) AS slot_start_ts,
      slot.local_ts::time AS slot_t
    FROM windows w
    CROSS JOIN LATERAL generate_series(
      p_date::timestamp + w.start_time,
      p_date::timestamp + w.end_time - (p_duration_min || ' minutes')::interval,
      (v_effective_slot_step_min || ' minutes')::interval
    ) AS slot(local_ts)
  )
  SELECT
    c.staff_id,
    c.slot_start_ts AS slot_start,
    to_char(c.slot_t, 'HH24:MI') AS slot_label
  FROM candidates c
  WHERE c.slot_start_ts >= v_min_start
    AND NOT EXISTS (
      SELECT 1
      FROM public.staff_time_off t
      WHERE t.staff_id = c.staff_id
        AND tstzrange(t.starts_at, t.ends_at, '[)') &&
            tstzrange(c.slot_start_ts, c.slot_start_ts + (p_duration_min || ' minutes')::interval, '[)')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.appointments a
      WHERE a.staff_id = c.staff_id
        AND a.status NOT IN ('cancelled','no_show')
        AND tstzrange(a.starts_at, a.ends_at, '[)') &&
            tstzrange(c.slot_start_ts, c.slot_start_ts + (p_duration_min || ' minutes')::interval, '[)')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.booking_payment_requests bpr
      WHERE bpr.staff_id = c.staff_id
        AND bpr.status IN ('awaiting_payment','processing','paid')
        AND bpr.expires_at > now()
        AND tstzrange(bpr.starts_at, bpr.ends_at, '[)') &&
            tstzrange(c.slot_start_ts, c.slot_start_ts + (p_duration_min || ' minutes')::interval, '[)')
    )
  ORDER BY c.slot_start_ts, c.staff_id;
END
$function$;

GRANT EXECUTE ON FUNCTION public.get_available_slots(text, uuid, date, integer, integer) TO anon, authenticated;
