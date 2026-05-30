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

  IF EXISTS (
    SELECT 1
    FROM unnest(p_service_ids) AS requested(service_id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.staff_services ss
      JOIN public.services s ON s.id = ss.service_id
      WHERE ss.staff_id = p_staff_id
        AND ss.service_id = requested.service_id
        AND s.studio_id = v_studio_id
        AND s.is_active = true
    )
  ) THEN
    RAISE EXCEPTION 'staff_cannot_perform_service';
  END IF;

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
    FROM public.get_available_slots(p_studio_slug, p_staff_id, v_local_start::date, v_total_duration, 15) slot
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