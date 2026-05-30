-- Studio-facing refund workflow states.
ALTER TABLE public.refund_requests
  DROP CONSTRAINT IF EXISTS refund_requests_status_valid;

ALTER TABLE public.refund_requests
  ADD CONSTRAINT refund_requests_status_valid
  CHECK (status IN ('pending', 'in_review', 'approved', 'rejected', 'refunded'));

-- Keep the studio notification bell in sync with client refund requests.
CREATE OR REPLACE FUNCTION public.notify_refund_request_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_service text;
  v_amount numeric;
BEGIN
  IF NEW.appointment_id IS NOT NULL THEN
    SELECT string_agg(s.name, ', '), max(a.total_price)
    INTO v_service, v_amount
    FROM public.appointments a
    LEFT JOIN public.appointment_services aps ON aps.appointment_id = a.id
    LEFT JOIN public.services s ON s.id = aps.service_id
    WHERE a.id = NEW.appointment_id
    GROUP BY a.id;
  END IF;

  INSERT INTO public.studio_notifications (studio_id, kind, title, body, payload)
  VALUES (
    NEW.studio_id,
    'refund_request',
    'Novo pedido de reembolso',
    COALESCE(NULLIF(NEW.client_name, ''), 'Cliente') ||
      ' pediu análise de reembolso' ||
      CASE WHEN v_service IS NOT NULL THEN ' para ' || v_service ELSE '' END || '.',
    jsonb_build_object(
      'refund_request_id', NEW.id,
      'appointment_id', NEW.appointment_id,
      'booking_request_id', NEW.booking_request_id,
      'payment_intent_id', NEW.payment_intent_id,
      'client_name', NEW.client_name,
      'service', v_service,
      'amount', v_amount
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_refund_request_created ON public.refund_requests;
CREATE TRIGGER trg_notify_refund_request_created
  AFTER INSERT ON public.refund_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_refund_request_created();

-- Do not allow the booking conversion function to trust a payment unless the
-- matching local payment row is already marked as succeeded by the Stripe flow.
CREATE OR REPLACE FUNCTION public.confirm_paid_booking_request(
  p_request_id uuid,
  p_stripe_payment_intent_id text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_req public.booking_payment_requests%ROWTYPE;
  v_client_id uuid;
  v_appt_id uuid;
  v_payment_status text;
BEGIN
  SELECT * INTO v_req
  FROM public.booking_payment_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'booking_request_not_found'; END IF;

  IF v_req.status = 'converted' AND v_req.appointment_id IS NOT NULL THEN
    RETURN v_req.appointment_id;
  END IF;

  IF v_req.status IN ('expired','failed','canceled','paid_conflict') THEN
    RAISE EXCEPTION 'booking_request_not_payable';
  END IF;

  SELECT status INTO v_payment_status
  FROM public.payment_intents
  WHERE booking_request_id = p_request_id
    AND (p_stripe_payment_intent_id IS NULL OR stripe_payment_intent_id = p_stripe_payment_intent_id)
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_payment_status IS DISTINCT FROM 'succeeded' THEN
    RAISE EXCEPTION 'payment_not_succeeded';
  END IF;

  UPDATE public.booking_payment_requests
  SET status = 'paid', updated_at = now()
  WHERE id = v_req.id;

  INSERT INTO public.clients (studio_id, name, phone, email)
  VALUES (v_req.studio_id, trim(v_req.client_name), trim(v_req.client_phone), nullif(trim(coalesce(v_req.client_email, '')), ''))
  ON CONFLICT (studio_id, phone) DO UPDATE SET
    name = EXCLUDED.name,
    email = COALESCE(EXCLUDED.email, clients.email),
    updated_at = now()
  RETURNING id INTO v_client_id;

  INSERT INTO public.appointments (studio_id, staff_id, client_id, starts_at, ends_at, status, total_price, total_duration_min, notes)
  VALUES (v_req.studio_id, v_req.staff_id, v_client_id, v_req.starts_at, v_req.ends_at, 'confirmed', v_req.total_price, v_req.total_duration_min, v_req.notes)
  RETURNING id INTO v_appt_id;

  INSERT INTO public.appointment_services (appointment_id, service_id, is_upsell, price, duration_min)
  SELECT v_appt_id, service_id, is_upsell, price, duration_min
  FROM public.resolve_booking_service_pricing(v_req.studio_id, v_req.service_ids);

  PERFORM public.record_upsell_acceptances_for_services(v_req.studio_id, v_req.service_ids);

  UPDATE public.booking_payment_requests
  SET status = 'converted', appointment_id = v_appt_id, updated_at = now()
  WHERE id = v_req.id;

  IF p_stripe_payment_intent_id IS NOT NULL THEN
    UPDATE public.payment_intents
    SET appointment_id = v_appt_id, updated_at = now()
    WHERE stripe_payment_intent_id = p_stripe_payment_intent_id;
  END IF;

  RETURN v_appt_id;
EXCEPTION
  WHEN exclusion_violation THEN
    UPDATE public.booking_payment_requests
    SET status = 'paid_conflict', failure_reason = 'slot_unavailable_after_payment', updated_at = now()
    WHERE id = p_request_id;
    RAISE EXCEPTION 'slot_unavailable_after_payment';
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_paid_booking_request(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_paid_booking_request(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.confirm_paid_booking_request(UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_paid_booking_request(UUID, TEXT) TO service_role;
