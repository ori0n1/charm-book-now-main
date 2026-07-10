CREATE OR REPLACE FUNCTION public.confirm_studio_appointment_payment(
  p_appointment_id UUID,
  p_payment_method TEXT DEFAULT 'cash'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_appt public.appointments%ROWTYPE;
  v_session public.cash_register_sessions%ROWTYPE;
  v_movement public.cash_register_movements%ROWTYPE;
  v_amount NUMERIC(10,2);
  v_method TEXT;
BEGIN
  SELECT * INTO v_appt
  FROM public.appointments
  WHERE id = p_appointment_id
  FOR UPDATE;

  IF v_appt.id IS NULL THEN
    RAISE EXCEPTION 'appointment_not_found';
  END IF;

  IF NOT public.is_studio_member(auth.uid(), v_appt.studio_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF v_appt.status = 'cancelled' THEN
    RAISE EXCEPTION 'appointment_cancelled';
  END IF;

  IF v_appt.status = 'no_show' THEN
    RAISE EXCEPTION 'appointment_no_show';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.payment_intents pi
    WHERE pi.appointment_id = v_appt.id
      AND pi.status = 'succeeded'
  ) THEN
    RAISE EXCEPTION 'appointment_already_paid_online';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.cash_register_movements crm
    WHERE crm.appointment_id = v_appt.id
      AND crm.movement_type = 'service_payment'
  ) THEN
    RAISE EXCEPTION 'appointment_payment_already_confirmed';
  END IF;

  v_method := COALESCE(NULLIF(trim(p_payment_method), ''), 'cash');
  IF v_method NOT IN ('cash', 'card', 'mb_way', 'other') THEN
    RAISE EXCEPTION 'invalid_payment_method';
  END IF;

  v_amount := GREATEST(0, COALESCE(v_appt.total_price, 0));
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;

  SELECT * INTO v_session
  FROM public.cash_register_sessions
  WHERE studio_id = v_appt.studio_id
    AND status = 'open'
  ORDER BY opened_at DESC
  LIMIT 1;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'cash_register_not_open';
  END IF;

  UPDATE public.appointments
  SET status = 'completed',
      updated_at = now()
  WHERE id = v_appt.id;

  INSERT INTO public.cash_register_movements (
    session_id,
    studio_id,
    appointment_id,
    movement_type,
    payment_method,
    amount,
    description,
    occurred_at,
    created_by
  )
  VALUES (
    v_session.id,
    v_appt.studio_id,
    v_appt.id,
    'service_payment',
    v_method,
    v_amount,
    'Pagamento presencial - marcação',
    now(),
    auth.uid()
  )
  RETURNING * INTO v_movement;

  RETURN jsonb_build_object(
    'appointment_id', v_appt.id,
    'cash_session_id', v_session.id,
    'movement_id', v_movement.id,
    'amount', v_amount,
    'payment_method', v_method,
    'status', 'completed'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_studio_appointment_payment(UUID, TEXT) TO authenticated;
