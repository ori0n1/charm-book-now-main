ALTER TABLE public.cash_register_movements
  DROP CONSTRAINT IF EXISTS cash_register_movements_movement_type_check;

ALTER TABLE public.cash_register_movements
  ADD CONSTRAINT cash_register_movements_movement_type_check
  CHECK (movement_type IN ('service_payment','product_payment','online_payment','manual_in','manual_out','sangria'));

CREATE OR REPLACE FUNCTION public.get_open_cash_register(p_studio_id UUID)
RETURNS TABLE (
  id UUID,
  studio_id UUID,
  opening_amount NUMERIC,
  opened_at TIMESTAMPTZ,
  opened_by UUID,
  movement_count BIGINT,
  total_cash NUMERIC,
  total_mb_way NUMERIC,
  total_card NUMERIC,
  total_bank_transfer NUMERIC,
  total_other NUMERIC,
  manual_in NUMERIC,
  manual_out NUMERIC,
  expected_cash_amount NUMERIC
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id,
    s.studio_id,
    s.opening_amount,
    s.opened_at,
    s.opened_by,
    count(m.id) AS movement_count,
    COALESCE(sum(m.amount) FILTER (WHERE m.payment_method = 'cash' AND m.movement_type NOT IN ('manual_out','sangria')), 0) AS total_cash,
    COALESCE(sum(m.amount) FILTER (WHERE m.payment_method = 'mb_way' AND m.movement_type NOT IN ('manual_out','sangria')), 0) AS total_mb_way,
    COALESCE(sum(m.amount) FILTER (WHERE m.payment_method = 'card' AND m.movement_type NOT IN ('manual_out','sangria')), 0) AS total_card,
    COALESCE(sum(m.amount) FILTER (WHERE m.payment_method = 'bank_transfer' AND m.movement_type NOT IN ('manual_out','sangria')), 0) AS total_bank_transfer,
    COALESCE(sum(m.amount) FILTER (WHERE m.payment_method = 'other' AND m.movement_type NOT IN ('manual_out','sangria')), 0) AS total_other,
    COALESCE(sum(m.amount) FILTER (WHERE m.movement_type = 'manual_in'), 0) AS manual_in,
    COALESCE(sum(m.amount) FILTER (WHERE m.movement_type IN ('manual_out','sangria')), 0) AS manual_out,
    (
      s.opening_amount
      + COALESCE(sum(m.amount) FILTER (WHERE m.movement_type NOT IN ('manual_out','sangria')), 0)
      - COALESCE(sum(m.amount) FILTER (WHERE m.movement_type IN ('manual_out','sangria')), 0)
    ) AS expected_cash_amount
  FROM public.cash_register_sessions s
  LEFT JOIN public.cash_register_movements m ON m.session_id = s.id
  WHERE s.studio_id = p_studio_id
    AND s.status = 'open'
    AND public.is_studio_member(auth.uid(), s.studio_id)
  GROUP BY s.id;
$$;

GRANT EXECUTE ON FUNCTION public.get_open_cash_register(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.add_cash_register_movement(
  p_session_id UUID,
  p_movement_type TEXT,
  p_payment_method TEXT,
  p_amount NUMERIC,
  p_description TEXT
)
RETURNS public.cash_register_movements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.cash_register_sessions%ROWTYPE;
  v_movement public.cash_register_movements%ROWTYPE;
BEGIN
  SELECT * INTO v_session
  FROM public.cash_register_sessions
  WHERE id = p_session_id
    AND status = 'open'
  FOR UPDATE;

  IF v_session.id IS NULL THEN RAISE EXCEPTION 'cash_register_not_open'; END IF;
  IF NOT public.is_studio_member(auth.uid(), v_session.studio_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF COALESCE(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  IF p_movement_type NOT IN ('manual_in','manual_out','sangria') THEN RAISE EXCEPTION 'invalid_movement_type'; END IF;
  IF NULLIF(trim(COALESCE(p_description, '')), '') IS NULL THEN RAISE EXCEPTION 'invalid_description'; END IF;

  INSERT INTO public.cash_register_movements (
    session_id, studio_id, movement_type, payment_method, amount, description, created_by
  ) VALUES (
    v_session.id,
    v_session.studio_id,
    p_movement_type,
    COALESCE(NULLIF(p_payment_method, ''), 'cash'),
    p_amount,
    trim(p_description),
    auth.uid()
  )
  RETURNING * INTO v_movement;

  RETURN v_movement;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_cash_register_movement(UUID, TEXT, TEXT, NUMERIC, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.close_cash_register(
  p_session_id UUID,
  p_counted_amount NUMERIC,
  p_note TEXT DEFAULT NULL
)
RETURNS public.cash_register_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.cash_register_sessions%ROWTYPE;
  v_summary JSONB;
  v_expected NUMERIC(10,2);
BEGIN
  SELECT * INTO v_session
  FROM public.cash_register_sessions
  WHERE id = p_session_id
    AND status = 'open'
  FOR UPDATE;

  IF v_session.id IS NULL THEN RAISE EXCEPTION 'cash_register_not_open'; END IF;
  IF NOT public.is_studio_member(auth.uid(), v_session.studio_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF COALESCE(p_counted_amount, 0) < 0 THEN RAISE EXCEPTION 'invalid_counted_amount'; END IF;

  SELECT jsonb_build_object(
    'by_method', jsonb_build_object(
      'cash', COALESCE(sum(amount) FILTER (WHERE payment_method = 'cash' AND movement_type NOT IN ('manual_out','sangria')), 0),
      'mb_way', COALESCE(sum(amount) FILTER (WHERE payment_method = 'mb_way' AND movement_type NOT IN ('manual_out','sangria')), 0),
      'card', COALESCE(sum(amount) FILTER (WHERE payment_method = 'card' AND movement_type NOT IN ('manual_out','sangria')), 0),
      'bank_transfer', COALESCE(sum(amount) FILTER (WHERE payment_method = 'bank_transfer' AND movement_type NOT IN ('manual_out','sangria')), 0),
      'other', COALESCE(sum(amount) FILTER (WHERE payment_method = 'other' AND movement_type NOT IN ('manual_out','sangria')), 0)
    ),
    'total_in', COALESCE(sum(amount) FILTER (WHERE movement_type NOT IN ('manual_out','sangria')), 0),
    'total_out', COALESCE(sum(amount) FILTER (WHERE movement_type IN ('manual_out','sangria')), 0),
    'manual_in', COALESCE(sum(amount) FILTER (WHERE movement_type = 'manual_in'), 0),
    'manual_out', COALESCE(sum(amount) FILTER (WHERE movement_type = 'manual_out'), 0),
    'sangria', COALESCE(sum(amount) FILTER (WHERE movement_type = 'sangria'), 0),
    'service_payments', COALESCE(sum(amount) FILTER (WHERE movement_type = 'service_payment'), 0),
    'movements', COALESCE(count(id), 0)
  )
  INTO v_summary
  FROM public.cash_register_movements
  WHERE session_id = v_session.id;

  v_expected := (
    v_session.opening_amount
    + COALESCE((v_summary ->> 'total_in')::numeric, 0)
    - COALESCE((v_summary ->> 'total_out')::numeric, 0)
  );

  UPDATE public.cash_register_sessions
  SET
    status = 'closed',
    closed_by = auth.uid(),
    closed_at = now(),
    closing_counted_amount = COALESCE(p_counted_amount, 0),
    expected_cash_amount = v_expected,
    difference_amount = COALESCE(p_counted_amount, 0) - v_expected,
    closing_note = NULLIF(trim(COALESCE(p_note, '')), ''),
    summary = v_summary
  WHERE id = v_session.id
    AND status = 'open'
  RETURNING * INTO v_session;

  IF v_session.id IS NULL THEN RAISE EXCEPTION 'cash_register_close_failed'; END IF;

  RETURN v_session;
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_cash_register(UUID, NUMERIC, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_cash_register_closure_history(
  p_studio_id UUID,
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  opened_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  opening_amount NUMERIC,
  closing_counted_amount NUMERIC,
  expected_cash_amount NUMERIC,
  difference_amount NUMERIC,
  total_in NUMERIC,
  total_out NUMERIC,
  movement_count INTEGER,
  summary JSONB,
  movements JSONB
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id,
    s.opened_at,
    s.closed_at,
    s.opening_amount,
    s.closing_counted_amount,
    s.expected_cash_amount,
    s.difference_amount,
    COALESCE((s.summary ->> 'total_in')::numeric, 0) AS total_in,
    COALESCE((s.summary ->> 'total_out')::numeric, 0) AS total_out,
    COALESCE((s.summary ->> 'movements')::integer, 0) AS movement_count,
    s.summary,
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', m.id,
            'movement_type', m.movement_type,
            'payment_method', m.payment_method,
            'amount', m.amount,
            'description', m.description,
            'occurred_at', m.occurred_at,
            'created_by', m.created_by,
            'responsible_name', COALESCE(p.full_name, 'Responsável')
          )
          ORDER BY m.occurred_at ASC
        )
        FROM public.cash_register_movements m
        LEFT JOIN public.profiles p ON p.id = m.created_by
        WHERE m.session_id = s.id
      ),
      '[]'::jsonb
    ) AS movements
  FROM public.cash_register_sessions s
  WHERE s.studio_id = p_studio_id
    AND s.status = 'closed'
    AND public.is_studio_member(auth.uid(), s.studio_id)
  ORDER BY s.closed_at DESC NULLS LAST
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
$$;

GRANT EXECUTE ON FUNCTION public.get_cash_register_closure_history(UUID, INTEGER) TO authenticated;

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
  v_available BOOLEAN;
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

  IF NOT EXISTS (
    SELECT 1 FROM public.staff
    WHERE id = p_staff_id
      AND studio_id = p_studio_id
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'staff_not_found';
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

  v_ends_at := p_starts_at + (COALESCE(v_service.duration_min, 30) || ' minutes')::interval;
  v_local_start := p_starts_at AT TIME ZONE COALESCE(v_studio.timezone, 'Europe/Lisbon');
  v_local_end := v_ends_at AT TIME ZONE COALESCE(v_studio.timezone, 'Europe/Lisbon');

  SELECT EXISTS (
    SELECT 1
    FROM public.staff_availability sa
    WHERE sa.studio_id = p_studio_id
      AND sa.staff_id = p_staff_id
      AND sa.weekday = EXTRACT(DOW FROM v_local_start)::int
      AND sa.start_time <= v_local_start::time
      AND sa.end_time >= v_local_end::time
  ) INTO v_available;
  IF NOT v_available THEN RAISE EXCEPTION 'outside_staff_availability'; END IF;

  IF EXISTS (
    SELECT 1
    FROM public.staff_time_off t
    WHERE t.staff_id = p_staff_id
      AND tstzrange(t.starts_at, t.ends_at, '[)') && tstzrange(p_starts_at, v_ends_at, '[)')
  ) THEN
    RAISE EXCEPTION 'staff_unavailable';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.appointments a
    WHERE a.staff_id = p_staff_id
      AND a.status NOT IN ('cancelled','no_show')
      AND tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(p_starts_at, v_ends_at, '[)')
  ) THEN
    RAISE EXCEPTION 'slot_unavailable';
  END IF;

  IF p_client_id IS NOT NULL THEN
    SELECT id INTO v_client_id
    FROM public.clients
    WHERE id = p_client_id
      AND studio_id = p_studio_id;
    IF v_client_id IS NULL THEN RAISE EXCEPTION 'client_not_found'; END IF;
  ELSE
    v_client_name := COALESCE(NULLIF(trim(p_client_name), ''), 'Cliente balcão');
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
    v_payment_amount, COALESCE(v_service.duration_min, 30),
    NULLIF(trim(COALESCE(p_notes, '')), '')
  )
  RETURNING id INTO v_appointment_id;

  INSERT INTO public.appointment_services (appointment_id, service_id, is_upsell, price, duration_min)
  VALUES (v_appointment_id, v_service.id, false, v_payment_amount, COALESCE(v_service.duration_min, 30));

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
