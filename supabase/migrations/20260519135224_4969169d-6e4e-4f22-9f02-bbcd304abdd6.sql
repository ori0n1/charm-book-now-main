CREATE OR REPLACE FUNCTION public.get_available_slots(
  p_studio_slug TEXT,
  p_staff_id UUID,
  p_date DATE,
  p_duration_min INTEGER,
  p_slot_step_min INTEGER DEFAULT 15
)
RETURNS TABLE(staff_id UUID, slot_start TIMESTAMPTZ, slot_label TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_studio_id UUID;
  v_tz TEXT := 'Europe/Lisbon';
  v_weekday INT;
  v_now TIMESTAMPTZ := now();
BEGIN
  IF p_duration_min IS NULL OR p_duration_min <= 0 OR p_duration_min > 720 THEN
    RETURN;
  END IF;

  IF p_slot_step_min IS NULL OR p_slot_step_min <= 0 OR p_slot_step_min > 120 THEN
    p_slot_step_min := 15;
  END IF;

  SELECT id INTO v_studio_id
  FROM public.studios
  WHERE slug = p_studio_slug AND is_active = true;

  IF v_studio_id IS NULL THEN
    RETURN;
  END IF;

  v_weekday := EXTRACT(DOW FROM p_date)::INT;

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
      AND (sa.end_time - (p_duration_min || ' minutes')::INTERVAL) >= sa.start_time
  ),
  candidates AS (
    SELECT
      w.staff_id,
      ((p_date::timestamp + (slot.local_ts::time)) AT TIME ZONE v_tz) AS slot_start_ts,
      slot.local_ts::time AS slot_t
    FROM windows w
    CROSS JOIN LATERAL generate_series(
      p_date::timestamp + w.start_time,
      p_date::timestamp + w.end_time - (p_duration_min || ' minutes')::INTERVAL,
      (p_slot_step_min || ' minutes')::INTERVAL
    ) AS slot(local_ts)
  )
  SELECT
    c.staff_id,
    c.slot_start_ts AS slot_start,
    to_char(c.slot_t, 'HH24:MI') AS slot_label
  FROM candidates c
  WHERE c.slot_start_ts > v_now
    AND NOT EXISTS (
      SELECT 1
      FROM public.staff_time_off t
      WHERE t.staff_id = c.staff_id
        AND tstzrange(t.starts_at, t.ends_at, '[)') &&
            tstzrange(c.slot_start_ts, c.slot_start_ts + (p_duration_min || ' minutes')::INTERVAL, '[)')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.appointments a
      WHERE a.staff_id = c.staff_id
        AND a.status NOT IN ('cancelled','no_show')
        AND tstzrange(a.starts_at, a.ends_at, '[)') &&
            tstzrange(c.slot_start_ts, c.slot_start_ts + (p_duration_min || ' minutes')::INTERVAL, '[)')
    )
  ORDER BY c.slot_start_ts, c.staff_id;
END $$;

GRANT EXECUTE ON FUNCTION public.get_available_slots(TEXT, UUID, DATE, INTEGER, INTEGER) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_public_booking(
  p_studio_slug TEXT,
  p_staff_id UUID,
  p_starts_at TIMESTAMPTZ,
  p_service_ids UUID[],
  p_client_name TEXT,
  p_client_phone TEXT,
  p_client_email TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_studio_id UUID;
  v_client_id UUID;
  v_appt_id UUID;
  v_total_duration INTEGER := 0;
  v_total_price NUMERIC(10,2) := 0;
  v_ends_at TIMESTAMPTZ;
  v_svc RECORD;
  v_tz TEXT := 'Europe/Lisbon';
  v_local_start TIMESTAMP;
  v_available BOOLEAN;
  v_expected_services INTEGER;
BEGIN
  IF p_client_name IS NULL OR length(trim(p_client_name)) < 2 THEN RAISE EXCEPTION 'invalid_name'; END IF;
  IF p_client_phone IS NULL OR length(regexp_replace(trim(p_client_phone), '\D', '', 'g')) < 9 THEN RAISE EXCEPTION 'invalid_phone'; END IF;
  IF array_length(p_service_ids, 1) IS NULL THEN RAISE EXCEPTION 'no_services'; END IF;

  SELECT id INTO v_studio_id
  FROM public.studios
  WHERE slug = p_studio_slug AND is_active = true;
  IF v_studio_id IS NULL THEN RAISE EXCEPTION 'studio_not_found'; END IF;

  PERFORM 1
  FROM public.staff
  WHERE id = p_staff_id AND studio_id = v_studio_id AND is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'staff_not_found'; END IF;

  SELECT count(DISTINCT x) INTO v_expected_services
  FROM unnest(p_service_ids) AS x;

  FOR v_svc IN
    SELECT s.id, s.duration_min, s.price
    FROM public.services s
    WHERE s.id = ANY(p_service_ids)
      AND s.studio_id = v_studio_id
      AND s.is_active = true
  LOOP
    v_total_duration := v_total_duration + v_svc.duration_min;
    v_total_price := v_total_price + v_svc.price;
  END LOOP;

  IF v_total_duration = 0 THEN RAISE EXCEPTION 'invalid_services'; END IF;
  IF v_expected_services IS NOT NULL AND v_expected_services <> (
    SELECT count(DISTINCT s.id)
    FROM public.services s
    WHERE s.id = ANY(p_service_ids)
      AND s.studio_id = v_studio_id
      AND s.is_active = true
  ) THEN
    RAISE EXCEPTION 'invalid_services';
  END IF;

  v_ends_at := p_starts_at + (v_total_duration || ' minutes')::INTERVAL;
  v_local_start := (p_starts_at AT TIME ZONE v_tz);

  SELECT EXISTS (
    SELECT 1
    FROM public.get_available_slots(
      p_studio_slug,
      p_staff_id,
      v_local_start::date,
      v_total_duration,
      15
    ) slot
    WHERE slot.slot_start = p_starts_at
  ) INTO v_available;

  IF NOT v_available THEN RAISE EXCEPTION 'slot_unavailable'; END IF;

  INSERT INTO public.clients (studio_id, name, phone, email)
  VALUES (v_studio_id, trim(p_client_name), trim(p_client_phone), nullif(trim(coalesce(p_client_email, '')), ''))
  ON CONFLICT (studio_id, phone) DO UPDATE SET
    name = EXCLUDED.name,
    email = COALESCE(EXCLUDED.email, clients.email),
    updated_at = now()
  RETURNING id INTO v_client_id;

  INSERT INTO public.appointments (studio_id, staff_id, client_id, starts_at, ends_at, status, total_price, total_duration_min, notes)
  VALUES (v_studio_id, p_staff_id, v_client_id, p_starts_at, v_ends_at, 'confirmed', v_total_price, v_total_duration, nullif(trim(coalesce(p_notes, '')), ''))
  RETURNING id INTO v_appt_id;

  INSERT INTO public.appointment_services (appointment_id, service_id, is_upsell, price, duration_min)
  SELECT v_appt_id, s.id, (row_number() OVER (ORDER BY array_position(p_service_ids, s.id)) > 1), s.price, s.duration_min
  FROM public.services s
  WHERE s.id = ANY(p_service_ids)
    AND s.studio_id = v_studio_id
  ORDER BY array_position(p_service_ids, s.id);

  RETURN jsonb_build_object(
    'appointment_id', v_appt_id,
    'starts_at', p_starts_at,
    'ends_at', v_ends_at,
    'total_price', v_total_price,
    'total_duration_min', v_total_duration
  );
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'slot_unavailable';
END $$;

GRANT EXECUTE ON FUNCTION public.create_public_booking(TEXT, UUID, TIMESTAMPTZ, UUID[], TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.seed_staff_default_availability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.staff_availability (studio_id, staff_id, weekday, start_time, end_time)
  SELECT NEW.studio_id, NEW.id, wd, '09:00'::TIME, '18:00'::TIME
  FROM generate_series(1, 5) AS wd
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.staff_availability sa
    WHERE sa.staff_id = NEW.id AND sa.weekday = wd
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_seed_staff_default_availability ON public.staff;
CREATE TRIGGER trg_seed_staff_default_availability
AFTER INSERT ON public.staff
FOR EACH ROW EXECUTE FUNCTION public.seed_staff_default_availability();

DROP TRIGGER IF EXISTS trg_studios_updated_at ON public.studios;
CREATE TRIGGER trg_studios_updated_at
BEFORE UPDATE ON public.studios
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_services_updated_at ON public.services;
CREATE TRIGGER trg_services_updated_at
BEFORE UPDATE ON public.services
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_staff_updated_at ON public.staff;
CREATE TRIGGER trg_staff_updated_at
BEFORE UPDATE ON public.staff
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_appointments_updated_at ON public.appointments;
CREATE TRIGGER trg_appointments_updated_at
BEFORE UPDATE ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();