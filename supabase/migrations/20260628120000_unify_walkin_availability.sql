CREATE OR REPLACE FUNCTION public.create_walk_in_appointment(
  p_studio_id UUID,
  p_staff_id UUID,
  p_service_id UUID,
  p_starts_at TIMESTAMPTZ,
  p_client_id UUID DEFAULT NULL,
  p_client_name TEXT DEFAULT NULL,
  p_client_phone TEXT DEFAULT NULL,
  p_payment_method TEXT DEFAULT 'cash',
  p_amount NUMERIC DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_studio public.studios%ROWTYPE;
  v_service public.services%ROWTYPE;
  v_client_id UUID;
  v_client_name TEXT;
  v_client_phone TEXT;
  v_ends_at TIMESTAMPTZ;
  v_local_start TIMESTAMP;
  v_local_end TIMESTAMP;
  v_duration_min INTEGER;
  v_appointment_id UUID;
  v_session_id UUID;
  v_payment_amount NUMERIC(10,2);
BEGIN
  IF NOT public.is_studio_member(auth.uid(), p_studio_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT * INTO v_studio
  FROM public.studios
  WHERE id = p_studio_id
    AND is_active = true;
  IF v_studio.id IS NULL THEN RAISE EXCEPTION 'studio_not_found'; END IF;

  SELECT * INTO v_service
  FROM public.services
  WHERE id = p_service_id
    AND studio_id = p_studio_id
    AND is_active = true;
  IF v_service.id IS NULL THEN RAISE EXCEPTION 'service_not_found'; END IF;

  v_duration_min := COALESCE(v_service.duration_min, 30);
  v_ends_at := p_starts_at + (v_duration_min || ' minutes')::interval;
  v_local_start := p_starts_at AT TIME ZONE COALESCE(v_studio.timezone, 'Europe/Lisbon');
  v_local_end := v_ends_at AT TIME ZONE COALESCE(v_studio.timezone, 'Europe/Lisbon');

  IF NOT EXISTS (
    SELECT 1 FROM public.staff
    WHERE id = p_staff_id
      AND studio_id = p_studio_id
      AND is_active = true
      AND COALESCE(current_status, 'online') <> 'absent'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM public.staff
      WHERE id = p_staff_id
        AND studio_id = p_studio_id
        AND is_active = true
        AND COALESCE(current_status, 'online') = 'absent'
    ) THEN
      RAISE EXCEPTION 'staff_unavailable';
    END IF;
    RAISE EXCEPTION 'staff_not_found';
  END IF;

  IF NOT public.is_staff_slot_bookable(p_studio_id, p_staff_id, p_starts_at, v_duration_min) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.staff_availability sa
      WHERE sa.studio_id = p_studio_id
        AND sa.staff_id = p_staff_id
        AND sa.weekday = EXTRACT(DOW FROM v_local_start)::int
        AND sa.start_time <= v_local_start::time
        AND sa.end_time >= v_local_end::time
    ) THEN
      RAISE EXCEPTION 'outside_staff_availability';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.staff_time_off t
      WHERE t.staff_id = p_staff_id
        AND tstzrange(t.starts_at, t.ends_at, '[)') && tstzrange(p_starts_at, v_ends_at, '[)')
    ) THEN
      RAISE EXCEPTION 'staff_unavailable';
    END IF;

    RAISE EXCEPTION 'slot_unavailable';
  END IF;

  v_payment_amount := COALESCE(p_amount, v_service.price, 0);
  IF v_payment_amount > 0 THEN
    SELECT id INTO v_session_id
    FROM public.cash_register_sessions
    WHERE studio_id = p_studio_id
      AND status = 'open'
    ORDER BY opened_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_session_id IS NULL THEN
      RAISE EXCEPTION 'cash_register_not_open';
    END IF;
  END IF;

  IF p_client_id IS NOT NULL THEN
    SELECT id INTO v_client_id
    FROM public.clients
    WHERE id = p_client_id
      AND studio_id = p_studio_id;
    IF v_client_id IS NULL THEN RAISE EXCEPTION 'client_not_found'; END IF;
  ELSE
    v_client_name := COALESCE(NULLIF(trim(p_client_name), ''), 'Cliente balcao');
    v_client_phone := NULLIF(trim(COALESCE(p_client_phone, '')), '');

    IF v_client_phone IS NULL THEN
      v_client_phone := 'balcao-' || replace(gen_random_uuid()::text, '-', '');
      INSERT INTO public.clients (studio_id, name, phone)
      VALUES (p_studio_id, v_client_name, v_client_phone)
      RETURNING id INTO v_client_id;
    ELSE
      INSERT INTO public.clients (studio_id, name, phone)
      VALUES (p_studio_id, v_client_name, v_client_phone)
      ON CONFLICT (studio_id, phone) DO UPDATE SET
        name = EXCLUDED.name,
        updated_at = now()
      RETURNING id INTO v_client_id;
    END IF;
  END IF;

  INSERT INTO public.appointments (
    studio_id, staff_id, client_id, starts_at, ends_at, status,
    total_price, total_duration_min, notes
  )
  VALUES (
    p_studio_id, p_staff_id, v_client_id, p_starts_at, v_ends_at, 'completed',
    v_payment_amount, v_duration_min,
    NULLIF(trim(COALESCE(p_notes, '')), '')
  )
  RETURNING id INTO v_appointment_id;

  INSERT INTO public.appointment_services (appointment_id, service_id, is_upsell, price, duration_min)
  VALUES (v_appointment_id, v_service.id, false, v_payment_amount, v_duration_min);

  UPDATE public.clients
  SET
    total_visits = total_visits + 1,
    total_spent = total_spent + v_payment_amount,
    updated_at = now()
  WHERE id = v_client_id;

  IF v_payment_amount > 0 THEN
    INSERT INTO public.cash_register_movements (
      session_id, studio_id, appointment_id, movement_type, payment_method,
      amount, description, occurred_at, created_by
    )
    VALUES (
      v_session_id, p_studio_id, v_appointment_id, 'service_payment',
      COALESCE(NULLIF(p_payment_method, ''), 'cash'), v_payment_amount,
      'Encaixe - ' || v_service.name, now(), auth.uid()
    );
  END IF;

  RETURN jsonb_build_object(
    'appointment_id', v_appointment_id,
    'client_id', v_client_id,
    'starts_at', p_starts_at,
    'ends_at', v_ends_at,
    'cash_session_id', v_session_id
  );
EXCEPTION
  WHEN exclusion_violation THEN RAISE EXCEPTION 'slot_unavailable';
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_walk_in_appointment(UUID, UUID, UUID, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT) TO authenticated;
