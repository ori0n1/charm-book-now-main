BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Owner corrections change the existing appointment or onsite receipt in place.
-- Money movements and Stripe payment intents are never created or deleted here.
CREATE OR REPLACE FUNCTION public.correct_owner_appointment_action(
  p_studio_id uuid, p_appointment_id uuid, p_outcome text,
  p_actor_id uuid, p_reason text DEFAULT NULL
)
RETURNS public.appointments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_appointment public.appointments%ROWTYPE;
  v_previous text;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles
    WHERE user_id = p_actor_id AND studio_id = p_studio_id
      AND role IN ('studio_owner', 'saas_owner')) THEN
    RAISE EXCEPTION 'studio_owner_required';
  END IF;
  SELECT * INTO v_appointment FROM public.appointments
    WHERE id = p_appointment_id AND studio_id = p_studio_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'appointment_not_found'; END IF;
  v_previous := v_appointment.status::text;
  IF v_previous = p_outcome THEN RETURN v_appointment; END IF;
  IF NOT (
    (v_previous = 'cancelled' AND p_outcome = 'confirmed') OR
    (v_previous = 'no_show' AND p_outcome = 'cancelled')
  ) THEN RAISE EXCEPTION 'invalid_appointment_transition'; END IF;
  IF p_outcome = 'cancelled' AND
    length(trim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'cancellation_reason_required';
  END IF;

  -- Parent-level corrections must not bypass per-service lifecycle protection.
  IF EXISTS (
    SELECT 1 FROM public.appointment_services s
    WHERE s.appointment_id = p_appointment_id AND s.service_state IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'cancel_joint_services_individually';
  END IF;
  UPDATE public.appointments SET
    status = p_outcome::public.appointment_status,
    cancellation_reason = CASE WHEN p_outcome = 'cancelled' THEN trim(p_reason) ELSE cancellation_reason END,
    cancelled_at = CASE WHEN p_outcome = 'cancelled' THEN now() ELSE cancelled_at END,
    cancelled_by = CASE WHEN p_outcome = 'cancelled' THEN p_actor_id ELSE cancelled_by END,
    attendance_resolved_at = CASE WHEN p_outcome = 'confirmed' THEN NULL ELSE attendance_resolved_at END,
    attendance_resolved_by = CASE WHEN p_outcome = 'confirmed' THEN NULL ELSE attendance_resolved_by END,
    updated_at = now()
    WHERE id = p_appointment_id RETURNING * INTO v_appointment;

  INSERT INTO public.financial_audit_logs
    (studio_id, actor_user_id, entity_type, entity_id, action, amount_cents, metadata)
  VALUES (p_studio_id, p_actor_id, 'appointment', p_appointment_id,
    'appointment_action_corrected', 0,
    jsonb_build_object('previous_status', v_previous, 'new_status', p_outcome,
      'reason', nullif(trim(coalesce(p_reason, '')), ''), 'changed_at', now()));
  RETURN v_appointment;
END $$;

REVOKE ALL ON FUNCTION public.correct_owner_appointment_action(uuid,uuid,text,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.correct_owner_appointment_action(uuid,uuid,text,uuid,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.correct_onsite_payment_method(
  p_studio_id uuid, p_appointment_id uuid, p_movement_id uuid,
  p_new_method text, p_actor_id uuid
)
RETURNS public.cash_register_movements
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_movement public.cash_register_movements%ROWTYPE;
  v_previous text;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles
    WHERE user_id = p_actor_id AND studio_id = p_studio_id
      AND role IN ('studio_owner', 'saas_owner')) THEN
    RAISE EXCEPTION 'studio_owner_required';
  END IF;
  IF p_new_method NOT IN ('cash','mb_way','card','bank_transfer','other') THEN
    RAISE EXCEPTION 'invalid_payment_method';
  END IF;
  SELECT * INTO v_movement FROM public.cash_register_movements
    WHERE id = p_movement_id AND studio_id = p_studio_id
      AND appointment_id = p_appointment_id AND movement_type = 'service_payment'
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'onsite_payment_not_found'; END IF;
  v_previous := v_movement.payment_method;
  IF v_previous = p_new_method THEN RETURN v_movement; END IF;
  UPDATE public.cash_register_movements SET payment_method = p_new_method
    WHERE id = p_movement_id RETURNING * INTO v_movement;
  INSERT INTO public.financial_audit_logs
    (studio_id, actor_user_id, entity_type, entity_id, action, amount_cents, metadata)
  VALUES (p_studio_id, p_actor_id, 'cash_register_movement', p_movement_id,
    'payment_method_corrected', 0,
    jsonb_build_object('appointment_id', p_appointment_id,
      'previous_method', v_previous, 'new_method', p_new_method,
      'changed_at', now()));
  RETURN v_movement;
END $$;

REVOKE ALL ON FUNCTION public.correct_onsite_payment_method(uuid,uuid,uuid,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.correct_onsite_payment_method(uuid,uuid,uuid,text,uuid)
  TO service_role;

-- Stamp each new cancellation, including one after a permitted reopening.
CREATE OR REPLACE FUNCTION public.guard_completed_appointment_cancellation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'completed' AND NEW.status = 'cancelled' THEN
    IF auth.uid() IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.user_roles r
      WHERE r.user_id = auth.uid()
        AND r.studio_id = OLD.studio_id
        AND r.role IN ('studio_owner', 'saas_owner')
    ) THEN
      RAISE EXCEPTION 'studio_owner_required';
    END IF;
    IF NULLIF(trim(NEW.cancellation_reason), '') IS NULL THEN
      RAISE EXCEPTION 'cancellation_reason_required';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.appointment_services s
      WHERE s.appointment_id = OLD.id AND s.service_state IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'cancel_joint_services_individually';
    END IF;
    NEW.cancelled_at := now();
    NEW.cancelled_by := auth.uid();
  ELSIF OLD.status <> 'cancelled' AND NEW.status = 'cancelled' THEN
    IF EXISTS (
      SELECT 1 FROM public.appointment_services s
      WHERE s.appointment_id = OLD.id AND s.service_state IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'cancel_joint_services_individually';
    END IF;
    NEW.cancelled_at := now();
    NEW.cancelled_by := coalesce(auth.uid(), NEW.cancelled_by);
  ELSIF OLD.status = 'cancelled' THEN
    -- A retry cannot rewrite the original audit or create another adjustment.
    NEW.cancelled_at := OLD.cancelled_at;
    NEW.cancelled_by := OLD.cancelled_by;
    NEW.cancellation_reason := OLD.cancellation_reason;
  END IF;
  RETURN NEW;
END;
$$;
-- The existing owner cancellation RPC already preserves the payment. Add the
-- status transition to the same audit ledger, including its original state.
CREATE OR REPLACE FUNCTION public.cancel_completed_appointment(
  p_studio_id uuid,
  p_appointment_id uuid,
  p_reason text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status public.appointment_status;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_roles r
    WHERE r.user_id = auth.uid()
      AND r.studio_id = p_studio_id
      AND r.role IN ('studio_owner', 'saas_owner')
  ) THEN
    RAISE EXCEPTION 'studio_owner_required';
  END IF;
  IF length(trim(coalesce(p_reason, ''))) < 3 OR length(trim(p_reason)) > 500 THEN
    RAISE EXCEPTION 'cancellation_reason_required';
  END IF;

  SELECT status INTO v_status
  FROM public.appointments
  WHERE id = p_appointment_id AND studio_id = p_studio_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'appointment_not_found'; END IF;
  IF v_status = 'cancelled' THEN RETURN false; END IF;
  IF v_status <> 'completed' THEN RAISE EXCEPTION 'appointment_not_completed'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.appointment_services s
    WHERE s.appointment_id = p_appointment_id AND s.service_state IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'cancel_joint_services_individually';
  END IF;

  UPDATE public.appointments
  SET status = 'cancelled', cancellation_reason = trim(p_reason), updated_at = now()
  WHERE id = p_appointment_id AND studio_id = p_studio_id;
  INSERT INTO public.financial_audit_logs
    (studio_id, actor_user_id, entity_type, entity_id, action, amount_cents, metadata)
  VALUES (p_studio_id, auth.uid(), 'appointment', p_appointment_id,
    'appointment_action_corrected', 0,
    jsonb_build_object('previous_status', 'completed', 'new_status', 'cancelled',
      'reason', trim(p_reason), 'changed_at', now()));
  RETURN true;
END;
$$;
NOTIFY pgrst, 'reload schema';
COMMIT;
