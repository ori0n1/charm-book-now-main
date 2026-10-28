BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Only an owner-confirmed erroneous onsite attendance receipt can be voided.
-- The movement remains in place at zero; its former amount and source key stay
-- in the immutable financial audit log. Real Stripe payments are never touched.
CREATE OR REPLACE FUNCTION public.undo_mistaken_onsite_attendance_receipt(
  p_studio_id uuid, p_appointment_id uuid, p_actor_id uuid, p_reason text
)
RETURNS public.appointments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_appointment public.appointments%ROWTYPE;
  v_movement public.cash_register_movements%ROWTYPE;
  v_session public.cash_register_sessions%ROWTYPE;
  v_summary jsonb;
  v_total_in numeric;
  v_total_out numeric;
  v_expected numeric;
  v_original_cents bigint;
  v_original_source_key text;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF length(trim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'correction_reason_required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_actor_id AND studio_id = p_studio_id
      AND role IN ('studio_owner', 'saas_owner')
  ) THEN RAISE EXCEPTION 'studio_owner_required'; END IF;

  SELECT * INTO v_appointment FROM public.appointments
  WHERE id = p_appointment_id AND studio_id = p_studio_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'appointment_not_found'; END IF;
  IF v_appointment.status NOT IN ('confirmed','completed','no_show','cancelled') THEN
    RAISE EXCEPTION 'invalid_appointment_transition';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.appointment_services
    WHERE appointment_id = p_appointment_id AND service_state IS NOT NULL
  ) THEN RAISE EXCEPTION 'joint_services_require_individual_resolution'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.payment_intents
    WHERE appointment_id = p_appointment_id AND studio_id = p_studio_id
      AND status = 'succeeded'
  ) THEN RAISE EXCEPTION 'confirmed_external_payment_must_be_preserved'; END IF;

  -- Reopening cannot silently undo loyalty or referral effects already awarded.
  IF EXISTS (
    SELECT 1 FROM public.customer_loyalty_stamp_entries
    WHERE studio_id = p_studio_id AND source_appointment_id = p_appointment_id
      AND source_type = 'booking_completed'
  ) OR EXISTS (
    SELECT 1 FROM public.customer_referrals r
    WHERE r.studio_id = p_studio_id AND r.status <> 'pending_completion'
      AND (r.appointment_id = p_appointment_id OR r.booking_request_id IN (
        SELECT b.id FROM public.booking_payment_requests b
        WHERE b.appointment_id = p_appointment_id
      ))
  ) THEN RAISE EXCEPTION 'attendance_correction_requires_loyalty_review'; END IF;

  SELECT * INTO v_movement FROM public.cash_register_movements
  WHERE appointment_id = p_appointment_id AND studio_id = p_studio_id
    AND movement_type = 'service_payment' AND amount > 0
    AND source_key LIKE 'attendance-settlement:' || p_appointment_id::text || '%'
  ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'onsite_receipt_not_found'; END IF;

  SELECT * INTO v_session FROM public.cash_register_sessions
  WHERE id = v_movement.session_id FOR UPDATE;
  IF v_session.id IS NULL OR v_session.status NOT IN ('open','closed') THEN
    RAISE EXCEPTION 'cash_register_not_found';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.cash_register_movements
    WHERE appointment_id = p_appointment_id AND studio_id = p_studio_id
      AND movement_type = 'service_payment' AND amount > 0 AND id <> v_movement.id
  ) THEN RAISE EXCEPTION 'other_real_receipt_must_be_preserved'; END IF;

  v_original_cents := round(v_movement.amount * 100)::bigint;
  v_original_source_key := v_movement.source_key;
  UPDATE public.cash_register_movements SET
    amount = 0,
    source_key = 'voided:' || v_movement.id::text,
    description = 'ANULADO (registo incorreto): ' || v_movement.description
  WHERE id = v_movement.id;

  -- Recalculate a closed session from its surviving movements, preserving
  -- other summary keys and the original counted amount. The prior snapshot
  -- is retained in this correction's financial audit metadata.
  IF v_session.status = 'closed' THEN
    SELECT
      coalesce(sum(amount) FILTER (WHERE movement_type NOT IN ('manual_out','sangria','transfer_out')), 0),
      coalesce(sum(amount) FILTER (WHERE movement_type IN ('manual_out','sangria','transfer_out')), 0),
      jsonb_build_object(
        'by_method', coalesce(v_session.summary->'by_method', '{}'::jsonb) || jsonb_build_object(
          'cash', coalesce(sum(amount) FILTER (WHERE payment_method = 'cash' AND movement_type NOT IN ('manual_out','sangria','transfer_out')), 0),
          'mb_way', coalesce(sum(amount) FILTER (WHERE payment_method = 'mb_way' AND movement_type NOT IN ('manual_out','sangria','transfer_out')), 0),
          'card', coalesce(sum(amount) FILTER (WHERE payment_method = 'card' AND movement_type NOT IN ('manual_out','sangria','transfer_out')), 0),
          'bank_transfer', coalesce(sum(amount) FILTER (WHERE payment_method = 'bank_transfer' AND movement_type NOT IN ('manual_out','sangria','transfer_out')), 0),
          'other', coalesce(sum(amount) FILTER (WHERE payment_method = 'other' AND movement_type NOT IN ('manual_out','sangria','transfer_out')), 0)
        ),
        'total_in', coalesce(sum(amount) FILTER (WHERE movement_type NOT IN ('manual_out','sangria','transfer_out')), 0),
        'total_out', coalesce(sum(amount) FILTER (WHERE movement_type IN ('manual_out','sangria','transfer_out')), 0),
        'manual_in', coalesce(sum(amount) FILTER (WHERE movement_type = 'manual_in'), 0),
        'manual_out', coalesce(sum(amount) FILTER (WHERE movement_type = 'manual_out'), 0),
        'transfer_in', coalesce(sum(amount) FILTER (WHERE movement_type = 'transfer_in'), 0),
        'transfer_out', coalesce(sum(amount) FILTER (WHERE movement_type = 'transfer_out'), 0),
        'sangria', coalesce(sum(amount) FILTER (WHERE movement_type = 'sangria'), 0),
        'service_payments', coalesce(sum(amount) FILTER (WHERE movement_type = 'service_payment'), 0),
        'movements', coalesce(count(id), 0)
      )
    INTO v_total_in, v_total_out, v_summary
    FROM public.cash_register_movements
    WHERE session_id = v_session.id;
    v_expected := v_session.opening_amount + v_total_in - v_total_out;
    UPDATE public.cash_register_sessions SET
      expected_cash_amount = v_expected,
      difference_amount = coalesce(v_session.closing_counted_amount, 0) - v_expected,
      summary = coalesce(v_session.summary, '{}'::jsonb) || v_summary,
      updated_at = now()
    WHERE id = v_session.id;
  END IF;
  IF v_appointment.status IN ('completed','no_show') THEN
    PERFORM public.correct_appointment_attendance(
      p_appointment_id, p_studio_id, 'confirmed', p_actor_id
    );
  ELSIF v_appointment.status = 'cancelled' THEN
    PERFORM public.correct_owner_appointment_action(
      p_studio_id, p_appointment_id, 'confirmed', p_actor_id, NULL
    );
  END IF;

  INSERT INTO public.financial_audit_logs
    (studio_id, actor_user_id, entity_type, entity_id, action, amount_cents, metadata)
  VALUES (p_studio_id, p_actor_id, 'cash_register_movement', v_movement.id,
    'mistaken_onsite_receipt_voided', 0,
    jsonb_build_object(
      'appointment_id', p_appointment_id,
      'previous_status', v_appointment.status,
      'new_status', 'confirmed',
      'original_amount_cents', v_original_cents,
      'original_method', v_movement.payment_method,
      'original_source_key', v_original_source_key,
      'cash_session_id', v_session.id,
      'cash_session_status', v_session.status,
      'previous_closed_summary', CASE WHEN v_session.status = 'closed' THEN v_session.summary ELSE NULL END,
      'previous_closed_expected', CASE WHEN v_session.status = 'closed' THEN v_session.expected_cash_amount ELSE NULL END,
      'new_closed_expected', v_expected,
      'reason', trim(p_reason),
      'changed_at', now()
    ));
  SELECT * INTO v_appointment FROM public.appointments WHERE id = p_appointment_id;
  RETURN v_appointment;
END $$;

REVOKE ALL ON FUNCTION public.undo_mistaken_onsite_attendance_receipt(uuid,uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.undo_mistaken_onsite_attendance_receipt(uuid,uuid,uuid,text)
  TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
