-- Definitive attendance settlement.
-- One transactional rule is shared by individual attendance, bulk attendance,
-- and the legacy "receive payment" action.

ALTER TABLE public.cash_register_movements
  ADD COLUMN IF NOT EXISTS source_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_register_movements_source_key
  ON public.cash_register_movements(source_key)
  WHERE source_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.settle_appointment_attendance_core(
  p_appointment_id uuid,
  p_studio_id uuid,
  p_outcome text,
  p_actor_id uuid,
  p_payment_method text DEFAULT 'cash'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_appointment public.appointments%ROWTYPE;
  v_session public.cash_register_sessions%ROWTYPE;
  v_status public.appointment_status;
  v_method text;
  v_total_cents bigint := 0;
  v_online_gross_cents bigint := 0;
  v_onsite_gross_cents bigint := 0;
  v_refunded_cents bigint := 0;
  v_received_before_cents bigint := 0;
  v_onsite_added_cents bigint := 0;
  v_received_after_cents bigint := 0;
  v_movement_id uuid;
  v_source_key text;
BEGIN
  IF p_outcome NOT IN ('completed', 'no_show') THEN
    RAISE EXCEPTION 'invalid_attendance_outcome';
  END IF;
  v_status := p_outcome::public.appointment_status;
  v_method := coalesce(nullif(trim(p_payment_method), ''), 'cash');
  IF v_method NOT IN ('cash', 'card', 'mb_way', 'bank_transfer', 'other') THEN
    RAISE EXCEPTION 'invalid_payment_method';
  END IF;

  SELECT * INTO v_appointment
  FROM public.appointments
  WHERE id = p_appointment_id
    AND studio_id = p_studio_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'appointment_not_found'; END IF;
  IF v_appointment.status = 'cancelled' THEN RAISE EXCEPTION 'appointment_cancelled'; END IF;
  IF v_appointment.status IN ('completed', 'no_show') AND v_appointment.status <> v_status THEN
    RAISE EXCEPTION 'attendance_already_resolved';
  END IF;
  IF v_appointment.status NOT IN ('confirmed', 'completed', 'no_show') THEN
    RAISE EXCEPTION 'appointment_not_confirmed';
  END IF;

  -- All arithmetic is integer cents. Refunds are full online refunds in the
  -- current model and are deduplicated by payment intent.
  v_total_cents := greatest(0, round(coalesce(v_appointment.total_price, 0) * 100)::bigint);

  SELECT coalesce(sum(pi.amount_cents), 0)::bigint
  INTO v_online_gross_cents
  FROM public.payment_intents pi
  WHERE pi.appointment_id = v_appointment.id
    AND pi.studio_id = v_appointment.studio_id
    AND pi.status = 'succeeded';

  SELECT coalesce(sum(round(crm.amount * 100)), 0)::bigint
  INTO v_onsite_gross_cents
  FROM public.cash_register_movements crm
  WHERE crm.appointment_id = v_appointment.id
    AND crm.studio_id = v_appointment.studio_id
    AND crm.movement_type = 'service_payment';

  SELECT coalesce(sum(refunded.amount_cents), 0)::bigint
  INTO v_refunded_cents
  FROM (
    SELECT DISTINCT pi.id, pi.amount_cents
    FROM public.refund_requests rr
    JOIN public.payment_intents pi ON pi.id = rr.payment_intent_id
    WHERE rr.appointment_id = v_appointment.id
      AND rr.studio_id = v_appointment.studio_id
      AND rr.status = 'refunded'
  ) refunded;

  v_received_before_cents := greatest(
    0,
    v_online_gross_cents + v_onsite_gross_cents - v_refunded_cents
  );

  -- A retry after the terminal state is a read-only success. This is essential
  -- for double clicks, network retries, and two devices resolving concurrently.
  IF v_appointment.status = v_status THEN
    SELECT crm.id INTO v_movement_id
    FROM public.cash_register_movements crm
    WHERE crm.source_key = 'attendance-settlement:' || v_appointment.id::text;

    RETURN jsonb_build_object(
      'appointment_id', v_appointment.id,
      'status', v_status,
      'total_cents', v_total_cents,
      'received_before_cents', v_received_before_cents,
      'onsite_added_cents', 0,
      'received_after_cents', least(v_total_cents, v_received_before_cents),
      'pending_cents', 0,
      'movement_id', v_movement_id,
      'idempotent', true
    );
  END IF;

  IF p_outcome = 'completed' THEN
    v_onsite_added_cents := greatest(
      0,
      v_total_cents - least(v_total_cents, v_received_before_cents)
    );

    IF v_onsite_added_cents > 0 THEN
      SELECT * INTO v_session
      FROM public.cash_register_sessions
      WHERE studio_id = v_appointment.studio_id
        AND status = 'open'
      ORDER BY opened_at DESC
      LIMIT 1
      FOR UPDATE;

      IF v_session.id IS NULL THEN RAISE EXCEPTION 'cash_register_not_open'; END IF;

      v_source_key := 'attendance-settlement:' || v_appointment.id::text;
      INSERT INTO public.cash_register_movements (
        session_id,
        studio_id,
        appointment_id,
        movement_type,
        payment_method,
        amount,
        description,
        occurred_at,
        created_by,
        source_key
      ) VALUES (
        v_session.id,
        v_appointment.studio_id,
        v_appointment.id,
        'service_payment',
        v_method,
        v_onsite_added_cents::numeric / 100,
        'Liquidação presencial por comparecimento',
        now(),
        p_actor_id,
        v_source_key
      )
      ON CONFLICT (source_key) WHERE source_key IS NOT NULL DO NOTHING
      RETURNING id INTO v_movement_id;

      IF v_movement_id IS NULL THEN
        SELECT id INTO v_movement_id
        FROM public.cash_register_movements
        WHERE source_key = v_source_key;
      END IF;
    END IF;
  END IF;

  UPDATE public.appointments
  SET status = v_status,
      attendance_resolved_at = now(),
      attendance_resolved_by = p_actor_id,
      updated_at = now()
  WHERE id = v_appointment.id;

  v_received_after_cents := least(
    v_total_cents,
    v_received_before_cents + v_onsite_added_cents
  );

  INSERT INTO public.financial_audit_logs (
    studio_id, actor_user_id, entity_type, entity_id, action, amount_cents, metadata
  ) VALUES (
    v_appointment.studio_id,
    p_actor_id,
    'appointment',
    v_appointment.id,
    CASE WHEN p_outcome = 'completed'
      THEN 'attendance_completed_and_settled'
      ELSE 'attendance_no_show'
    END,
    v_onsite_added_cents,
    jsonb_build_object(
      'total_cents', v_total_cents,
      'received_before_cents', v_received_before_cents,
      'onsite_added_cents', v_onsite_added_cents,
      'received_after_cents', v_received_after_cents,
      'payment_method', CASE WHEN v_onsite_added_cents > 0 THEN v_method ELSE NULL END
    )
  );

  RETURN jsonb_build_object(
    'appointment_id', v_appointment.id,
    'status', v_status,
    'total_cents', v_total_cents,
    'received_before_cents', v_received_before_cents,
    'onsite_added_cents', v_onsite_added_cents,
    'received_after_cents', v_received_after_cents,
    'pending_cents', 0,
    'movement_id', v_movement_id,
    'idempotent', false
  );
END
$$;

REVOKE ALL ON FUNCTION public.settle_appointment_attendance_core(uuid, uuid, text, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.resolve_appointment_attendance_batch(
  p_appointment_ids uuid[],
  p_studio_id uuid,
  p_outcome text,
  p_actor_id uuid,
  p_payment_method text DEFAULT 'cash'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_appointment_id uuid;
  v_results jsonb := '[]'::jsonb;
  v_count integer := 0;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_appointment_ids IS NULL OR cardinality(p_appointment_ids) = 0 THEN
    RAISE EXCEPTION 'appointment_ids_required';
  END IF;
  IF cardinality(p_appointment_ids) > 100 THEN RAISE EXCEPTION 'too_many_appointments'; END IF;

  FOR v_appointment_id IN
    SELECT DISTINCT appointment_id
    FROM unnest(p_appointment_ids) AS ids(appointment_id)
    ORDER BY appointment_id
  LOOP
    v_results := v_results || jsonb_build_array(
      public.settle_appointment_attendance_core(
        v_appointment_id, p_studio_id, p_outcome, p_actor_id, p_payment_method
      )
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('count', v_count, 'results', v_results);
END
$$;

REVOKE ALL ON FUNCTION public.resolve_appointment_attendance_batch(uuid[], uuid, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_appointment_attendance_batch(uuid[], uuid, text, uuid, text)
  TO service_role;

-- Backwards-compatible single-item entry point delegates to the batch rule.
CREATE OR REPLACE FUNCTION public.resolve_appointment_attendance(
  p_appointment_id uuid,
  p_studio_id uuid,
  p_outcome text,
  p_actor_id uuid
)
RETURNS public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  PERFORM public.resolve_appointment_attendance_batch(
    ARRAY[p_appointment_id], p_studio_id, p_outcome, p_actor_id, 'cash'
  );
  RETURN (SELECT appointment FROM public.appointments appointment WHERE id = p_appointment_id);
END
$$;

REVOKE ALL ON FUNCTION public.resolve_appointment_attendance(uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_appointment_attendance(uuid, uuid, text, uuid)
  TO service_role;

-- The legacy payment button now uses the same settlement core and therefore
-- charges only the unpaid remainder instead of rejecting deposits or charging twice.
CREATE OR REPLACE FUNCTION public.confirm_studio_appointment_payment(
  p_appointment_id uuid,
  p_payment_method text DEFAULT 'cash'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_appointment public.appointments%ROWTYPE;
BEGIN
  SELECT * INTO v_appointment
  FROM public.appointments
  WHERE id = p_appointment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'appointment_not_found'; END IF;
  IF NOT public.is_studio_member(auth.uid(), v_appointment.studio_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  RETURN public.settle_appointment_attendance_core(
    v_appointment.id,
    v_appointment.studio_id,
    'completed',
    auth.uid(),
    p_payment_method
  );
END
$$;

REVOKE ALL ON FUNCTION public.confirm_studio_appointment_payment(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_studio_appointment_payment(uuid, text)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
