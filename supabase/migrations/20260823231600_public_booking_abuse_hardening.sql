-- Residual HIGH hardening for anonymous bookings:
-- 1. only the application server may invoke mutation RPCs;
-- 2. an anonymous booking never changes an existing client's identity;
-- 3. the same rule also applies after a successful pre-payment.

CREATE OR REPLACE FUNCTION public.create_public_booking(
  p_studio_slug text,
  p_staff_id uuid,
  p_starts_at timestamptz,
  p_service_ids uuid[],
  p_client_name text,
  p_client_phone text,
  p_client_email text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_customer_referral_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_studio_id uuid;
  v_payment_policy text;
  v_client_id uuid;
  v_existing_client_id uuid;
  v_client_was_existing boolean := false;
  v_appt_id uuid;
  v_request_id uuid;
  v_total_duration integer := 0;
  v_total_price numeric(10,2) := 0;
  v_ends_at timestamptz;
  v_available boolean;
  v_min_booking_notice_min integer := 30;
  v_client_email text := nullif(trim(coalesce(p_client_email, '')), '');
  v_client_phone text := trim(p_client_phone);
BEGIN
  IF p_client_name IS NULL OR length(trim(p_client_name)) < 2 THEN RAISE EXCEPTION 'invalid_name'; END IF;
  IF p_client_phone IS NULL OR length(regexp_replace(trim(p_client_phone), '\D', '', 'g')) < 9 THEN RAISE EXCEPTION 'invalid_phone'; END IF;
  IF array_length(p_service_ids, 1) IS NULL THEN RAISE EXCEPTION 'no_services'; END IF;

  PERFORM public.expire_pending_appointments();

  SELECT id, payment_policy, COALESCE(min_booking_notice_min, 30)
  INTO v_studio_id, v_payment_policy, v_min_booking_notice_min
  FROM public.studios
  WHERE slug = p_studio_slug
    AND is_active = true
    AND public.has_active_premium_access(id);
  IF v_studio_id IS NULL THEN RAISE EXCEPTION 'studio_not_available'; END IF;

  IF v_client_email IS NOT NULL THEN
    SELECT id INTO v_existing_client_id
    FROM public.clients
    WHERE studio_id = v_studio_id
      AND email IS NOT NULL
      AND lower(email) = lower(v_client_email)
    ORDER BY (phone LIKE 'account:%') ASC, updated_at DESC
    LIMIT 1;
  END IF;

  IF v_existing_client_id IS NULL THEN
    SELECT id INTO v_existing_client_id
    FROM public.clients
    WHERE studio_id = v_studio_id
      AND phone = v_client_phone
      AND (
        v_client_email IS NULL
        OR email IS NULL
        OR lower(email) = lower(v_client_email)
      )
    ORDER BY updated_at DESC
    LIMIT 1;
  END IF;
  v_client_was_existing := v_existing_client_id IS NOT NULL;

  PERFORM public.raise_client_booking_block_if_needed(v_studio_id, p_client_phone);

  IF p_starts_at < now() + (v_min_booking_notice_min || ' minutes')::interval THEN
    RAISE EXCEPTION 'booking_too_soon';
  END IF;

  PERFORM 1 FROM public.staff
  WHERE id = p_staff_id
    AND studio_id = v_studio_id
    AND is_active = true
    AND COALESCE(current_status, 'online') <> 'absent';
  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1 FROM public.staff
      WHERE id = p_staff_id
        AND studio_id = v_studio_id
        AND is_active = true
        AND COALESCE(current_status, 'online') = 'absent'
    ) THEN
      RAISE EXCEPTION 'staff_off';
    END IF;
    RAISE EXCEPTION 'staff_not_found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_service_ids) AS requested(service_id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.staff_services ss
      JOIN public.services s ON s.id = ss.service_id
      WHERE ss.staff_id = p_staff_id
        AND ss.service_id = requested.service_id
        AND s.studio_id = v_studio_id
        AND s.is_active = true
    )
  ) THEN RAISE EXCEPTION 'staff_cannot_perform_service'; END IF;

  SELECT
    COALESCE(sum(duration_min), 0)::integer,
    COALESCE(sum(price), 0)::numeric(10,2)
  INTO v_total_duration, v_total_price
  FROM public.resolve_booking_service_pricing(v_studio_id, p_service_ids);
  IF v_total_duration = 0 THEN RAISE EXCEPTION 'invalid_services'; END IF;

  v_ends_at := p_starts_at + (v_total_duration || ' minutes')::interval;
  SELECT public.is_staff_slot_bookable(v_studio_id, p_staff_id, p_starts_at, v_total_duration)
  INTO v_available;
  IF NOT v_available THEN RAISE EXCEPTION 'slot_unavailable'; END IF;

  IF v_payment_policy = 'pre_payment' THEN
    INSERT INTO public.booking_payment_requests (
      studio_id, staff_id, service_ids, starts_at, ends_at, total_price, total_duration_min,
      client_name, client_phone, client_email, notes, status, expires_at
    ) VALUES (
      v_studio_id, p_staff_id, p_service_ids, p_starts_at, v_ends_at, v_total_price, v_total_duration,
      trim(p_client_name), v_client_phone, v_client_email,
      nullif(trim(coalesce(p_notes, '')), ''), 'awaiting_payment', now() + interval '15 minutes'
    ) RETURNING id INTO v_request_id;

    PERFORM public.record_customer_referral_intent(
      v_studio_id, p_customer_referral_code, v_request_id, NULL, NULL, v_client_was_existing
    );

    RETURN jsonb_build_object(
      'booking_request_id', v_request_id,
      'appointment_id', NULL,
      'studio_id', v_studio_id,
      'starts_at', p_starts_at,
      'ends_at', v_ends_at,
      'total_price', v_total_price,
      'total_duration_min', v_total_duration,
      'requires_payment', true,
      'reservation_status', 'awaiting_payment',
      'payment_status', 'not_started'
    );
  END IF;

  -- Match an existing client, but never change name, phone or e-mail using
  -- anonymous form values. Only a brand-new identity is inserted.
  v_client_id := v_existing_client_id;
  IF v_client_id IS NULL THEN
    INSERT INTO public.clients (studio_id, name, phone, email)
    VALUES (v_studio_id, trim(p_client_name), v_client_phone, v_client_email)
    ON CONFLICT (studio_id, phone) DO NOTHING
    RETURNING id INTO v_client_id;

    IF v_client_id IS NULL THEN
      SELECT id INTO v_client_id
      FROM public.clients
      WHERE studio_id = v_studio_id AND phone = v_client_phone
      LIMIT 1;
    END IF;
  END IF;
  IF v_client_id IS NULL THEN RAISE EXCEPTION 'client_identity_resolution_failed'; END IF;

  INSERT INTO public.appointments (
    studio_id, staff_id, client_id, starts_at, ends_at, status,
    total_price, total_duration_min, notes
  ) VALUES (
    v_studio_id, p_staff_id, v_client_id, p_starts_at, v_ends_at, 'confirmed',
    v_total_price, v_total_duration, nullif(trim(coalesce(p_notes, '')), '')
  ) RETURNING id INTO v_appt_id;

  INSERT INTO public.appointment_services (appointment_id, service_id, is_upsell, price, duration_min)
  SELECT v_appt_id, service_id, is_upsell, price, duration_min
  FROM public.resolve_booking_service_pricing(v_studio_id, p_service_ids);

  PERFORM public.record_upsell_acceptances_for_services(v_studio_id, p_service_ids);
  PERFORM public.record_customer_referral_intent(
    v_studio_id, p_customer_referral_code, NULL, v_appt_id, v_client_id, v_client_was_existing
  );

  RETURN jsonb_build_object(
    'appointment_id', v_appt_id,
    'booking_request_id', NULL,
    'studio_id', v_studio_id,
    'starts_at', p_starts_at,
    'ends_at', v_ends_at,
    'total_price', v_total_price,
    'total_duration_min', v_total_duration,
    'requires_payment', false,
    'reservation_status', 'confirmed',
    'payment_status', 'pay_in_studio'
  );
EXCEPTION
  WHEN exclusion_violation THEN RAISE EXCEPTION 'slot_unavailable';
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_paid_booking_request(
  p_request_id uuid,
  p_stripe_payment_intent_id text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_req public.booking_payment_requests%ROWTYPE;
  v_client_id uuid;
  v_existing_client_id uuid;
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
  IF v_req.expires_at <= now() - interval '5 minutes' THEN
    UPDATE public.booking_payment_requests
    SET status = 'expired',
        failure_reason = COALESCE(failure_reason, 'checkout_expired'),
        updated_at = now()
    WHERE id = v_req.id;
    RAISE EXCEPTION 'booking_request_expired';
  END IF;

  SELECT status INTO v_payment_status
  FROM public.payment_intents
  WHERE booking_request_id = p_request_id
    AND (p_stripe_payment_intent_id IS NULL OR stripe_payment_intent_id = p_stripe_payment_intent_id)
  ORDER BY created_at DESC
  LIMIT 1;
  IF v_payment_status IS DISTINCT FROM 'succeeded' THEN RAISE EXCEPTION 'payment_not_succeeded'; END IF;

  IF NOT public.is_staff_slot_bookable(
    v_req.studio_id, v_req.staff_id, v_req.starts_at,
    v_req.total_duration_min, v_req.id, NULL
  ) THEN
    UPDATE public.booking_payment_requests
    SET status = 'paid_conflict', failure_reason = 'slot_unavailable_after_payment', updated_at = now()
    WHERE id = v_req.id;
    RAISE EXCEPTION 'slot_unavailable_after_payment';
  END IF;

  SELECT id INTO v_existing_client_id
  FROM public.clients
  WHERE studio_id = v_req.studio_id
    AND (
      phone = trim(v_req.client_phone)
      OR (
        nullif(trim(coalesce(v_req.client_email, '')), '') IS NOT NULL
        AND email IS NOT NULL
        AND lower(email) = lower(nullif(trim(coalesce(v_req.client_email, '')), ''))
      )
    )
  ORDER BY (phone LIKE 'account:%') ASC, updated_at DESC
  LIMIT 1;

  UPDATE public.booking_payment_requests SET status = 'paid', updated_at = now() WHERE id = v_req.id;

  v_client_id := v_existing_client_id;
  IF v_client_id IS NULL THEN
    INSERT INTO public.clients (studio_id, name, phone, email)
    VALUES (
      v_req.studio_id,
      trim(v_req.client_name),
      trim(v_req.client_phone),
      nullif(trim(coalesce(v_req.client_email, '')), '')
    )
    ON CONFLICT (studio_id, phone) DO NOTHING
    RETURNING id INTO v_client_id;
    IF v_client_id IS NULL THEN
      SELECT id INTO v_client_id
      FROM public.clients
      WHERE studio_id = v_req.studio_id AND phone = trim(v_req.client_phone)
      LIMIT 1;
    END IF;
  END IF;
  IF v_client_id IS NULL THEN RAISE EXCEPTION 'client_identity_resolution_failed'; END IF;

  INSERT INTO public.appointments (
    studio_id, staff_id, client_id, starts_at, ends_at, status,
    total_price, total_duration_min, notes
  ) VALUES (
    v_req.studio_id, v_req.staff_id, v_client_id, v_req.starts_at, v_req.ends_at,
    'confirmed', v_req.total_price, v_req.total_duration_min, v_req.notes
  ) RETURNING id INTO v_appt_id;

  INSERT INTO public.appointment_services (appointment_id, service_id, is_upsell, price, duration_min)
  SELECT v_appt_id, service_id, is_upsell, price, duration_min
  FROM public.resolve_booking_service_pricing(v_req.studio_id, v_req.service_ids);
  PERFORM public.record_upsell_acceptances_for_services(v_req.studio_id, v_req.service_ids);

  UPDATE public.booking_payment_requests
  SET status = 'converted', appointment_id = v_appt_id, updated_at = now()
  WHERE id = v_req.id;

  UPDATE public.customer_referrals
  SET referred_client_id = v_client_id,
      appointment_id = v_appt_id,
      referred_client_was_existing = COALESCE(referred_client_was_existing, false) OR (v_existing_client_id IS NOT NULL),
      status = CASE
        WHEN referrer_client_id = v_client_id THEN 'rejected'
        WHEN COALESCE(referred_client_was_existing, false) OR (v_existing_client_id IS NOT NULL) THEN 'rejected'
        ELSE status
      END,
      rejection_reason = CASE
        WHEN referrer_client_id = v_client_id THEN 'self_referral'
        WHEN COALESCE(referred_client_was_existing, false) OR (v_existing_client_id IS NOT NULL) THEN 'existing_client'
        ELSE rejection_reason
      END,
      updated_at = now()
  WHERE studio_id = v_req.studio_id AND booking_request_id = v_req.id;

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
$function$;

REVOKE ALL ON FUNCTION public.create_public_booking(
  text, uuid, timestamptz, uuid[], text, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_public_booking(
  text, uuid, timestamptz, uuid[], text, text, text, text, text
) TO service_role;

REVOKE ALL ON FUNCTION public.record_public_policy_acceptance(uuid, uuid, uuid, text, jsonb)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_public_policy_acceptance(uuid, uuid, uuid, text, jsonb)
TO service_role;
