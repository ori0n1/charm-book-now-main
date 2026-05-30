CREATE OR REPLACE FUNCTION public.confirm_paid_booking_request(
  p_request_id UUID,
  p_stripe_payment_intent_id TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_req public.booking_payment_requests%ROWTYPE;
  v_client_id UUID;
  v_appt_id UUID;
  v_payment_status TEXT;
BEGIN
  SELECT * INTO v_req
  FROM public.booking_payment_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'booking_request_not_found'; END IF;

  IF v_req.status = 'converted' AND v_req.appointment_id IS NOT NULL THEN
    RETURN v_req.appointment_id;
  END IF;

  IF v_req.status IN ('expired','failed','canceled','paid_conflict') OR v_req.expires_at <= now() THEN
    UPDATE public.booking_payment_requests
    SET status = CASE WHEN status IN ('converted','paid_conflict') THEN status ELSE 'expired' END,
        failure_reason = COALESCE(failure_reason, 'payment_expired'),
        updated_at = now()
    WHERE id = p_request_id;
    RAISE EXCEPTION 'booking_request_not_payable';
  END IF;

  IF p_stripe_payment_intent_id IS NULL OR length(trim(p_stripe_payment_intent_id)) = 0 THEN
    RAISE EXCEPTION 'payment_intent_required';
  END IF;

  SELECT status INTO v_payment_status
  FROM public.payment_intents
  WHERE booking_request_id = p_request_id
    AND stripe_payment_intent_id = p_stripe_payment_intent_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_payment_status IS DISTINCT FROM 'succeeded' THEN
    RAISE EXCEPTION 'payment_not_confirmed';
  END IF;

  UPDATE public.booking_payment_requests
  SET status = 'paid', updated_at = now()
  WHERE id = v_req.id;

  INSERT INTO public.clients (studio_id, name, phone, email)
  VALUES (v_req.studio_id, trim(v_req.client_name), trim(v_req.client_phone), nullif(trim(coalesce(v_req.client_email, '')), ''))
  ON CONFLICT (studio_id, phone) DO UPDATE SET
    name = EXCLUDED.name, email = COALESCE(EXCLUDED.email, clients.email), updated_at = now()
  RETURNING id INTO v_client_id;

  INSERT INTO public.appointments (studio_id, staff_id, client_id, starts_at, ends_at, status, total_price, total_duration_min, notes)
  VALUES (v_req.studio_id, v_req.staff_id, v_client_id, v_req.starts_at, v_req.ends_at, 'confirmed', v_req.total_price, v_req.total_duration_min, v_req.notes)
  RETURNING id INTO v_appt_id;

  INSERT INTO public.appointment_services (appointment_id, service_id, is_upsell, price, duration_min)
  SELECT v_appt_id, s.id, (row_number() OVER (ORDER BY array_position(v_req.service_ids, s.id)) > 1), s.price, s.duration_min
  FROM public.services s
  WHERE s.id = ANY(v_req.service_ids) AND s.studio_id = v_req.studio_id
  ORDER BY array_position(v_req.service_ids, s.id);

  UPDATE public.booking_payment_requests
  SET status = 'converted', appointment_id = v_appt_id, updated_at = now()
  WHERE id = v_req.id;

  UPDATE public.payment_intents
  SET appointment_id = v_appt_id, updated_at = now()
  WHERE stripe_payment_intent_id = p_stripe_payment_intent_id;

  RETURN v_appt_id;
EXCEPTION
  WHEN exclusion_violation THEN
    UPDATE public.booking_payment_requests
    SET status = 'paid_conflict', failure_reason = 'slot_unavailable_after_payment', updated_at = now()
    WHERE id = p_request_id;
    RAISE EXCEPTION 'slot_unavailable_after_payment';
END
$function$;

REVOKE ALL ON FUNCTION public.confirm_paid_booking_request(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_paid_booking_request(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.confirm_paid_booking_request(UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_paid_booking_request(UUID, TEXT) TO service_role;