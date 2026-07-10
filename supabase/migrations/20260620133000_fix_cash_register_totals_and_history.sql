ALTER TABLE public.cash_register_movements
  DROP CONSTRAINT IF EXISTS cash_register_movements_movement_type_check;

ALTER TABLE public.cash_register_movements
  ADD CONSTRAINT cash_register_movements_movement_type_check
  CHECK (
    movement_type IN (
      'service_payment',
      'product_payment',
      'online_payment',
      'manual_in',
      'manual_out',
      'sangria',
      'transfer_in',
      'transfer_out'
    )
  );

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
    COALESCE(sum(m.amount) FILTER (WHERE m.payment_method = 'cash' AND m.movement_type NOT IN ('manual_out','sangria','transfer_out')), 0) AS total_cash,
    COALESCE(sum(m.amount) FILTER (WHERE m.payment_method = 'mb_way' AND m.movement_type NOT IN ('manual_out','sangria','transfer_out')), 0) AS total_mb_way,
    COALESCE(sum(m.amount) FILTER (WHERE m.payment_method = 'card' AND m.movement_type NOT IN ('manual_out','sangria','transfer_out')), 0) AS total_card,
    COALESCE(sum(m.amount) FILTER (WHERE m.payment_method = 'bank_transfer' AND m.movement_type NOT IN ('manual_out','sangria','transfer_out')), 0) AS total_bank_transfer,
    COALESCE(sum(m.amount) FILTER (WHERE m.payment_method = 'other' AND m.movement_type NOT IN ('manual_out','sangria','transfer_out')), 0) AS total_other,
    COALESCE(sum(m.amount) FILTER (WHERE m.movement_type IN ('manual_in','transfer_in')), 0) AS manual_in,
    COALESCE(sum(m.amount) FILTER (WHERE m.movement_type IN ('manual_out','sangria','transfer_out')), 0) AS manual_out,
    (
      s.opening_amount
      + COALESCE(sum(m.amount) FILTER (WHERE m.movement_type NOT IN ('manual_out','sangria','transfer_out')), 0)
      - COALESCE(sum(m.amount) FILTER (WHERE m.movement_type IN ('manual_out','sangria','transfer_out')), 0)
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
  IF p_movement_type NOT IN ('manual_in','manual_out','sangria','transfer_in','transfer_out') THEN
    RAISE EXCEPTION 'invalid_movement_type';
  END IF;
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
  v_total_in NUMERIC(10,2);
  v_total_out NUMERIC(10,2);
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

  SELECT
    COALESCE(sum(amount) FILTER (WHERE movement_type NOT IN ('manual_out','sangria','transfer_out')), 0),
    COALESCE(sum(amount) FILTER (WHERE movement_type IN ('manual_out','sangria','transfer_out')), 0),
    jsonb_build_object(
      'by_method', jsonb_build_object(
        'cash', COALESCE(sum(amount) FILTER (WHERE payment_method = 'cash' AND movement_type NOT IN ('manual_out','sangria','transfer_out')), 0),
        'mb_way', COALESCE(sum(amount) FILTER (WHERE payment_method = 'mb_way' AND movement_type NOT IN ('manual_out','sangria','transfer_out')), 0),
        'card', COALESCE(sum(amount) FILTER (WHERE payment_method = 'card' AND movement_type NOT IN ('manual_out','sangria','transfer_out')), 0),
        'bank_transfer', COALESCE(sum(amount) FILTER (WHERE payment_method = 'bank_transfer' AND movement_type NOT IN ('manual_out','sangria','transfer_out')), 0),
        'other', COALESCE(sum(amount) FILTER (WHERE payment_method = 'other' AND movement_type NOT IN ('manual_out','sangria','transfer_out')), 0)
      ),
      'total_in', COALESCE(sum(amount) FILTER (WHERE movement_type NOT IN ('manual_out','sangria','transfer_out')), 0),
      'total_out', COALESCE(sum(amount) FILTER (WHERE movement_type IN ('manual_out','sangria','transfer_out')), 0),
      'manual_in', COALESCE(sum(amount) FILTER (WHERE movement_type = 'manual_in'), 0),
      'manual_out', COALESCE(sum(amount) FILTER (WHERE movement_type = 'manual_out'), 0),
      'transfer_in', COALESCE(sum(amount) FILTER (WHERE movement_type = 'transfer_in'), 0),
      'transfer_out', COALESCE(sum(amount) FILTER (WHERE movement_type = 'transfer_out'), 0),
      'sangria', COALESCE(sum(amount) FILTER (WHERE movement_type = 'sangria'), 0),
      'service_payments', COALESCE(sum(amount) FILTER (WHERE movement_type = 'service_payment'), 0),
      'movements', COALESCE(count(id), 0)
    )
  INTO v_total_in, v_total_out, v_summary
  FROM public.cash_register_movements
  WHERE session_id = v_session.id;

  v_expected := v_session.opening_amount + v_total_in - v_total_out;

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
  WITH closed_sessions AS (
    SELECT s.*
    FROM public.cash_register_sessions s
    WHERE s.studio_id = p_studio_id
      AND s.status = 'closed'
      AND public.is_studio_member(auth.uid(), s.studio_id)
    ORDER BY s.closed_at DESC NULLS LAST
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100)
  ),
  totals AS (
    SELECT
      s.id,
      COALESCE(sum(m.amount) FILTER (WHERE m.movement_type NOT IN ('manual_out','sangria','transfer_out')), 0) AS total_in,
      COALESCE(sum(m.amount) FILTER (WHERE m.movement_type IN ('manual_out','sangria','transfer_out')), 0) AS total_out,
      count(m.id)::integer AS movement_count
    FROM closed_sessions s
    LEFT JOIN public.cash_register_movements m ON m.session_id = s.id
    GROUP BY s.id
  )
  SELECT
    s.id,
    s.opened_at,
    s.closed_at,
    s.opening_amount,
    s.closing_counted_amount,
    (s.opening_amount + t.total_in - t.total_out) AS expected_cash_amount,
    (COALESCE(s.closing_counted_amount, 0) - (s.opening_amount + t.total_in - t.total_out)) AS difference_amount,
    t.total_in,
    t.total_out,
    t.movement_count,
    COALESCE(s.summary, '{}'::jsonb) || jsonb_build_object(
      'total_in', t.total_in,
      'total_out', t.total_out,
      'movements', t.movement_count
    ) AS summary,
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
            'responsible_name', COALESCE(p.full_name, 'Responsavel')
          )
          ORDER BY m.occurred_at ASC
        )
        FROM public.cash_register_movements m
        LEFT JOIN public.profiles p ON p.id = m.created_by
        WHERE m.session_id = s.id
      ),
      '[]'::jsonb
    ) AS movements
  FROM closed_sessions s
  JOIN totals t ON t.id = s.id
  ORDER BY s.closed_at DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.get_cash_register_closure_history(UUID, INTEGER) TO authenticated;

WITH totals AS (
  SELECT
    s.id,
    COALESCE(sum(m.amount) FILTER (WHERE m.movement_type NOT IN ('manual_out','sangria','transfer_out')), 0) AS total_in,
    COALESCE(sum(m.amount) FILTER (WHERE m.movement_type IN ('manual_out','sangria','transfer_out')), 0) AS total_out,
    COALESCE(sum(m.amount) FILTER (WHERE m.movement_type = 'manual_in'), 0) AS manual_in,
    COALESCE(sum(m.amount) FILTER (WHERE m.movement_type = 'manual_out'), 0) AS manual_out,
    COALESCE(sum(m.amount) FILTER (WHERE m.movement_type = 'transfer_in'), 0) AS transfer_in,
    COALESCE(sum(m.amount) FILTER (WHERE m.movement_type = 'transfer_out'), 0) AS transfer_out,
    COALESCE(sum(m.amount) FILTER (WHERE m.movement_type = 'sangria'), 0) AS sangria,
    count(m.id)::integer AS movement_count
  FROM public.cash_register_sessions s
  LEFT JOIN public.cash_register_movements m ON m.session_id = s.id
  WHERE s.status = 'closed'
  GROUP BY s.id
)
UPDATE public.cash_register_sessions s
SET
  expected_cash_amount = s.opening_amount + totals.total_in - totals.total_out,
  difference_amount = COALESCE(s.closing_counted_amount, 0) - (s.opening_amount + totals.total_in - totals.total_out),
  summary = COALESCE(s.summary, '{}'::jsonb) || jsonb_build_object(
    'total_in', totals.total_in,
    'total_out', totals.total_out,
    'manual_in', totals.manual_in,
    'manual_out', totals.manual_out,
    'transfer_in', totals.transfer_in,
    'transfer_out', totals.transfer_out,
    'sangria', totals.sangria,
    'movements', totals.movement_count
  )
FROM totals
WHERE s.id = totals.id;
