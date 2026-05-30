
-- 1. get_available_slots: devolve slots disponíveis para uma data
CREATE OR REPLACE FUNCTION public.get_available_slots(
  p_studio_slug TEXT,
  p_staff_id UUID,            -- NULL = qualquer profissional
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
  SELECT id INTO v_studio_id FROM studios WHERE slug = p_studio_slug AND is_active = true;
  IF v_studio_id IS NULL THEN RETURN; END IF;

  v_weekday := EXTRACT(DOW FROM p_date)::INT; -- 0..6 (Dom..Sab)

  RETURN QUERY
  WITH eligible_staff AS (
    SELECT s.id FROM staff s
    WHERE s.studio_id = v_studio_id
      AND s.is_active = true
      AND (p_staff_id IS NULL OR s.id = p_staff_id)
  ),
  windows AS (
    SELECT sa.staff_id, sa.start_time, sa.end_time
    FROM staff_availability sa
    JOIN eligible_staff es ON es.id = sa.staff_id
    WHERE sa.studio_id = v_studio_id AND sa.weekday = v_weekday
  ),
  candidates AS (
    SELECT
      w.staff_id,
      ((p_date::TEXT || ' ' || to_char(slot.t, 'HH24:MI:SS'))::TIMESTAMP AT TIME ZONE v_tz) AS slot_start_ts,
      slot.t AS slot_t
    FROM windows w
    CROSS JOIN LATERAL generate_series(
      w.start_time::TIME,
      (w.end_time - (p_duration_min || ' minutes')::INTERVAL)::TIME,
      (p_slot_step_min || ' minutes')::INTERVAL
    ) AS slot(t)
  )
  SELECT
    c.staff_id,
    c.slot_start_ts AS slot_start,
    to_char(c.slot_t, 'HH24:MI') AS slot_label
  FROM candidates c
  WHERE c.slot_start_ts > v_now
    -- não conflita com folgas
    AND NOT EXISTS (
      SELECT 1 FROM staff_time_off t
      WHERE t.staff_id = c.staff_id
        AND tstzrange(t.starts_at, t.ends_at, '[)') &&
            tstzrange(c.slot_start_ts, c.slot_start_ts + (p_duration_min || ' minutes')::INTERVAL, '[)')
    )
    -- não conflita com reservas existentes
    AND NOT EXISTS (
      SELECT 1 FROM appointments a
      WHERE a.staff_id = c.staff_id
        AND a.status NOT IN ('cancelled','no_show')
        AND tstzrange(a.starts_at, a.ends_at, '[)') &&
            tstzrange(c.slot_start_ts, c.slot_start_ts + (p_duration_min || ' minutes')::INTERVAL, '[)')
    )
  ORDER BY c.slot_start_ts, c.staff_id;
END $$;

GRANT EXECUTE ON FUNCTION public.get_available_slots(TEXT, UUID, DATE, INTEGER, INTEGER) TO anon, authenticated;

-- 2. Reforçar create_public_booking com validação de horário e folgas
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
  v_local_end   TIMESTAMP;
  v_weekday INT;
  v_window_ok BOOLEAN;
BEGIN
  IF p_client_name IS NULL OR length(trim(p_client_name)) < 2 THEN RAISE EXCEPTION 'invalid_name'; END IF;
  IF p_client_phone IS NULL OR length(trim(p_client_phone)) < 6 THEN RAISE EXCEPTION 'invalid_phone'; END IF;
  IF array_length(p_service_ids, 1) IS NULL THEN RAISE EXCEPTION 'no_services'; END IF;

  SELECT id INTO v_studio_id FROM studios WHERE slug = p_studio_slug AND is_active = true;
  IF v_studio_id IS NULL THEN RAISE EXCEPTION 'studio_not_found'; END IF;

  PERFORM 1 FROM staff WHERE id = p_staff_id AND studio_id = v_studio_id AND is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'staff_not_found'; END IF;

  FOR v_svc IN
    SELECT s.id, s.duration_min, s.price
    FROM services s
    WHERE s.id = ANY(p_service_ids) AND s.studio_id = v_studio_id AND s.is_active = true
  LOOP
    v_total_duration := v_total_duration + v_svc.duration_min;
    v_total_price    := v_total_price + v_svc.price;
  END LOOP;

  IF v_total_duration = 0 THEN RAISE EXCEPTION 'invalid_services'; END IF;

  v_ends_at := p_starts_at + (v_total_duration || ' minutes')::INTERVAL;

  -- Validar que está dentro de uma janela de disponibilidade (em Europe/Lisbon)
  v_local_start := (p_starts_at AT TIME ZONE v_tz);
  v_local_end   := (v_ends_at   AT TIME ZONE v_tz);
  v_weekday     := EXTRACT(DOW FROM v_local_start)::INT;

  IF v_local_start::DATE <> v_local_end::DATE THEN
    RAISE EXCEPTION 'outside_hours';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM staff_availability sa
    WHERE sa.staff_id = p_staff_id
      AND sa.weekday  = v_weekday
      AND sa.start_time <= v_local_start::TIME
      AND sa.end_time   >= v_local_end::TIME
  ) INTO v_window_ok;

  IF NOT v_window_ok THEN RAISE EXCEPTION 'outside_hours'; END IF;

  -- Validar folgas
  IF EXISTS (
    SELECT 1 FROM staff_time_off t
    WHERE t.staff_id = p_staff_id
      AND tstzrange(t.starts_at, t.ends_at, '[)') && tstzrange(p_starts_at, v_ends_at, '[)')
  ) THEN
    RAISE EXCEPTION 'staff_off';
  END IF;

  -- Upsert client
  INSERT INTO clients (studio_id, name, phone, email)
  VALUES (v_studio_id, trim(p_client_name), trim(p_client_phone), p_client_email)
  ON CONFLICT (studio_id, phone) DO UPDATE SET
    name = EXCLUDED.name,
    email = COALESCE(EXCLUDED.email, clients.email),
    updated_at = now()
  RETURNING id INTO v_client_id;

  INSERT INTO appointments (studio_id, staff_id, client_id, starts_at, ends_at, status, total_price, total_duration_min, notes)
  VALUES (v_studio_id, p_staff_id, v_client_id, p_starts_at, v_ends_at, 'confirmed', v_total_price, v_total_duration, p_notes)
  RETURNING id INTO v_appt_id;

  INSERT INTO appointment_services (appointment_id, service_id, is_upsell, price, duration_min)
  SELECT v_appt_id, s.id, (row_number() OVER (ORDER BY array_position(p_service_ids, s.id)) > 1), s.price, s.duration_min
  FROM services s WHERE s.id = ANY(p_service_ids);

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

-- 3. Auto-criar disponibilidade default (Seg–Sex 09:00–18:00) ao inserir staff novo
CREATE OR REPLACE FUNCTION public.seed_staff_default_availability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO staff_availability (studio_id, staff_id, weekday, start_time, end_time)
  SELECT NEW.studio_id, NEW.id, wd, '09:00'::TIME, '18:00'::TIME
  FROM generate_series(1, 5) AS wd
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_seed_staff_default_availability ON public.staff;
CREATE TRIGGER trg_seed_staff_default_availability
AFTER INSERT ON public.staff
FOR EACH ROW EXECUTE FUNCTION public.seed_staff_default_availability();
