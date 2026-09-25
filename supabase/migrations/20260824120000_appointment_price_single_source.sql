-- Appointment price consistency.
-- `appointments.total_price` is the immutable financial total. Public booking
-- requests also retain the exact service lines used to calculate that total so
-- catalogue changes while a checkout is open cannot alter the appointment.

ALTER TABLE public.booking_payment_requests
  ADD COLUMN IF NOT EXISTS pricing_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.booking_payment_requests
  DROP CONSTRAINT IF EXISTS booking_payment_requests_pricing_snapshot_array;
ALTER TABLE public.booking_payment_requests
  ADD CONSTRAINT booking_payment_requests_pricing_snapshot_array
  CHECK (jsonb_typeof(pricing_snapshot) = 'array');

COMMENT ON COLUMN public.booking_payment_requests.pricing_snapshot IS
  'Immutable backend-calculated service line snapshot used when converting a paid request into an appointment.';

CREATE OR REPLACE FUNCTION public.capture_booking_payment_pricing_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_snapshot jsonb;
  v_total_price numeric(10,2);
  v_total_duration integer;
BEGIN
  -- Never trust a caller-provided snapshot. Service ids and current backend
  -- pricing rules are the only inputs accepted at request creation.
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'position', priced.position,
          'service_id', priced.service_id,
          'price', round(priced.price, 2),
          'duration_min', priced.duration_min,
          'is_upsell', priced.is_upsell,
          'offer_id', priced.offer_id
        ) ORDER BY priced.position
      ),
      '[]'::jsonb
    ),
    COALESCE(sum(priced.price), 0)::numeric(10,2),
    COALESCE(sum(priced.duration_min), 0)::integer
  INTO v_snapshot, v_total_price, v_total_duration
  FROM (
    SELECT
      array_position(NEW.service_ids, resolved.service_id)::integer AS position,
      resolved.*
    FROM public.resolve_booking_service_pricing(NEW.studio_id, NEW.service_ids) resolved
  ) priced;

  IF jsonb_array_length(v_snapshot) = 0 OR v_total_duration <= 0 THEN
    RAISE EXCEPTION 'invalid_services';
  END IF;

  NEW.pricing_snapshot := v_snapshot;
  NEW.total_price := v_total_price;
  NEW.total_duration_min := v_total_duration;
  NEW.ends_at := NEW.starts_at + make_interval(mins => v_total_duration);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_capture_booking_payment_pricing_snapshot
  ON public.booking_payment_requests;
CREATE TRIGGER trg_capture_booking_payment_pricing_snapshot
BEFORE INSERT ON public.booking_payment_requests
FOR EACH ROW EXECUTE FUNCTION public.capture_booking_payment_pricing_snapshot();

CREATE OR REPLACE FUNCTION public.quote_public_booking(
  p_studio_slug text,
  p_service_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_studio_id uuid;
  v_lines jsonb;
  v_total_price numeric(10,2);
  v_total_duration integer;
BEGIN
  IF array_length(p_service_ids, 1) IS NULL OR array_length(p_service_ids, 1) > 12 THEN
    RAISE EXCEPTION 'invalid_services';
  END IF;

  SELECT id INTO v_studio_id
  FROM public.studios
  WHERE slug = p_studio_slug
    AND is_active = true
    AND public.has_active_premium_access(id);
  IF v_studio_id IS NULL THEN RAISE EXCEPTION 'studio_not_available'; END IF;

  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'service_id', priced.service_id,
          'price', round(priced.price, 2),
          'duration_min', priced.duration_min,
          'is_upsell', priced.is_upsell
        ) ORDER BY priced.position
      ),
      '[]'::jsonb
    ),
    COALESCE(sum(priced.price), 0)::numeric(10,2),
    COALESCE(sum(priced.duration_min), 0)::integer
  INTO v_lines, v_total_price, v_total_duration
  FROM (
    SELECT
      array_position(p_service_ids, resolved.service_id)::integer AS position,
      resolved.*
    FROM public.resolve_booking_service_pricing(v_studio_id, p_service_ids) resolved
  ) priced;

  IF jsonb_array_length(v_lines) <> array_length(p_service_ids, 1) OR v_total_duration <= 0 THEN
    RAISE EXCEPTION 'invalid_services';
  END IF;

  RETURN jsonb_build_object(
    'studio_id', v_studio_id,
    'total_price', v_total_price,
    'total_duration_min', v_total_duration,
    'lines', v_lines
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.quote_public_booking(text, uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quote_public_booking(text, uuid[])
  TO service_role;

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

  IF jsonb_array_length(v_req.pricing_snapshot) > 0 THEN
    INSERT INTO public.appointment_services (
      appointment_id, service_id, is_upsell, price, duration_min
    )
    SELECT
      v_appt_id, line.service_id, line.is_upsell,
      round(line.price, 2), line.duration_min
    FROM jsonb_to_recordset(v_req.pricing_snapshot) AS line(
      position integer,
      service_id uuid,
      price numeric,
      duration_min integer,
      is_upsell boolean,
      offer_id uuid
    )
    ORDER BY line.position;
  ELSE
    -- Compatibility for a checkout created before this migration. New requests
    -- always use the immutable snapshot branch above.
    INSERT INTO public.appointment_services (appointment_id, service_id, is_upsell, price, duration_min)
    SELECT v_appt_id, service_id, is_upsell, price, duration_min
    FROM public.resolve_booking_service_pricing(v_req.studio_id, v_req.service_ids);
  END IF;
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

REVOKE ALL ON FUNCTION public.confirm_paid_booking_request(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_paid_booking_request(uuid, text)
  TO service_role;
