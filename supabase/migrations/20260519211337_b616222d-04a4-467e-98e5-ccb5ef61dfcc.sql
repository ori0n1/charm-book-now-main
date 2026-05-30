CREATE OR REPLACE FUNCTION public.resolve_booking_service_pricing(
  p_studio_id uuid,
  p_service_ids uuid[]
)
RETURNS TABLE(
  service_id uuid,
  price numeric,
  duration_min integer,
  is_upsell boolean,
  offer_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH requested AS (
    SELECT u.service_id, u.ordinality::integer AS position
    FROM unnest(p_service_ids) WITH ORDINALITY AS u(service_id, ordinality)
  ),
  trigger_service AS (
    SELECT service_id AS id
    FROM requested
    WHERE position = 1
  )
  SELECT
    s.id AS service_id,
    CASE
      WHEN r.position > 1 AND uo.id IS NOT NULL THEN uo.discounted_price
      ELSE s.price
    END AS price,
    s.duration_min,
    (r.position > 1) AS is_upsell,
    uo.id AS offer_id
  FROM requested r
  JOIN public.services s
    ON s.id = r.service_id
   AND s.studio_id = p_studio_id
   AND s.is_active = true
  CROSS JOIN trigger_service ts
  LEFT JOIN public.upsell_offers uo
    ON uo.studio_id = p_studio_id
   AND uo.trigger_service_id = ts.id
   AND uo.offered_service_id = s.id
   AND uo.is_active = true
  ORDER BY r.position;
$$;

CREATE OR REPLACE FUNCTION public.record_upsell_acceptances_for_services(
  p_studio_id uuid,
  p_service_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_service_ids IS NULL OR array_length(p_service_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  WITH accepted AS (
    SELECT offer_id, price
    FROM public.resolve_booking_service_pricing(p_studio_id, p_service_ids)
    WHERE offer_id IS NOT NULL
  )
  UPDATE public.upsell_offers u
  SET conversions_count = u.conversions_count + 1,
      extra_revenue = u.extra_revenue + accepted.price
  FROM accepted
  WHERE u.id = accepted.offer_id
    AND u.is_active = true;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_public_booking(
  p_studio_slug text,
  p_staff_id uuid,
  p_starts_at timestamp with time zone,
  p_service_ids uuid[],
  p_client_name text,
  p_client_phone text,
  p_client_email text DEFAULT NULL::text,
  p_notes text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_studio_id uuid;
  v_payment_policy text;
  v_client_id uuid;
  v_appt_id uuid;
  v_request_id uuid;
  v_total_duration integer := 0;
  v_total_price numeric(10,2) := 0;
  v_ends_at timestamptz;
  v_tz text := 'Europe/Lisbon';
  v_local_start timestamp;
  v_available boolean;
BEGIN
  IF p_client_name IS NULL OR length(trim(p_client_name)) < 2 THEN RAISE EXCEPTION 'invalid_name'; END IF;
  IF p_client_phone IS NULL OR length(regexp_replace(trim(p_client_phone), '\D', '', 'g')) < 9 THEN RAISE EXCEPTION 'invalid_phone'; END IF;
  IF array_length(p_service_ids, 1) IS NULL THEN RAISE EXCEPTION 'no_services'; END IF;

  SELECT id, payment_policy INTO v_studio_id, v_payment_policy
  FROM public.studios
  WHERE slug = p_studio_slug AND is_active = true;
  IF v_studio_id IS NULL THEN RAISE EXCEPTION 'studio_not_found'; END IF;

  UPDATE public.booking_payment_requests
  SET status = 'expired', failure_reason = COALESCE(failure_reason, 'checkout_expired'), updated_at = now()
  WHERE studio_id = v_studio_id
    AND status IN ('awaiting_payment','processing')
    AND expires_at <= now();

  PERFORM 1 FROM public.staff
  WHERE id = p_staff_id AND studio_id = v_studio_id AND is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'staff_not_found'; END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_service_ids) AS requested(service_id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.staff_services ss
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
  v_local_start := (p_starts_at AT TIME ZONE v_tz);

  SELECT EXISTS (
    SELECT 1 FROM public.get_available_slots(p_studio_slug, p_staff_id, v_local_start::date, v_total_duration, 15) slot
    WHERE slot.slot_start = p_starts_at
  ) INTO v_available;

  IF NOT v_available THEN RAISE EXCEPTION 'slot_unavailable'; END IF;

  IF v_payment_policy = 'pre_payment' THEN
    INSERT INTO public.booking_payment_requests (
      studio_id, staff_id, service_ids, starts_at, ends_at, total_price, total_duration_min,
      client_name, client_phone, client_email, notes, status, expires_at
    ) VALUES (
      v_studio_id, p_staff_id, p_service_ids, p_starts_at, v_ends_at, v_total_price, v_total_duration,
      trim(p_client_name), trim(p_client_phone), nullif(trim(coalesce(p_client_email, '')), ''),
      nullif(trim(coalesce(p_notes, '')), ''), 'awaiting_payment', now() + interval '30 minutes'
    ) RETURNING id INTO v_request_id;

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

  INSERT INTO public.clients (studio_id, name, phone, email)
  VALUES (v_studio_id, trim(p_client_name), trim(p_client_phone), nullif(trim(coalesce(p_client_email, '')), ''))
  ON CONFLICT (studio_id, phone) DO UPDATE SET
    name = EXCLUDED.name,
    email = COALESCE(EXCLUDED.email, clients.email),
    updated_at = now()
  RETURNING id INTO v_client_id;

  INSERT INTO public.appointments (studio_id, staff_id, client_id, starts_at, ends_at, status, total_price, total_duration_min, notes)
  VALUES (v_studio_id, p_staff_id, v_client_id, p_starts_at, v_ends_at, 'confirmed', v_total_price, v_total_duration, nullif(trim(coalesce(p_notes, '')), ''))
  RETURNING id INTO v_appt_id;

  INSERT INTO public.appointment_services (appointment_id, service_id, is_upsell, price, duration_min)
  SELECT v_appt_id, service_id, is_upsell, price, duration_min
  FROM public.resolve_booking_service_pricing(v_studio_id, p_service_ids);

  PERFORM public.record_upsell_acceptances_for_services(v_studio_id, p_service_ids);

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
$$;

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

GRANT EXECUTE ON FUNCTION public.resolve_booking_service_pricing(uuid, uuid[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_upsell_acceptances_for_services(uuid, uuid[]) TO anon, authenticated;