-- Keep public bookings from overwriting or taking over a different verified
-- client e-mail just because the same phone number was entered.

CREATE OR REPLACE FUNCTION public.create_public_booking(
  p_studio_slug text,
  p_staff_id uuid,
  p_starts_at timestamp with time zone,
  p_service_ids uuid[],
  p_client_name text,
  p_client_phone text,
  p_client_email text DEFAULT NULL::text,
  p_notes text DEFAULT NULL::text,
  p_customer_referral_code text DEFAULT NULL::text
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
  v_tz text := 'Europe/Lisbon';
  v_available boolean;
  v_min_booking_notice_min integer := 30;
  v_client_email text := nullif(trim(coalesce(p_client_email, '')), '');
  v_client_phone text := trim(p_client_phone);
BEGIN
  IF p_client_name IS NULL OR length(trim(p_client_name)) < 2 THEN RAISE EXCEPTION 'invalid_name'; END IF;
  IF p_client_phone IS NULL OR length(regexp_replace(trim(p_client_phone), '\D', '', 'g')) < 9 THEN RAISE EXCEPTION 'invalid_phone'; END IF;
  IF array_length(p_service_ids, 1) IS NULL THEN RAISE EXCEPTION 'no_services'; END IF;

  PERFORM public.expire_pending_appointments();

  SELECT id, payment_policy, timezone, COALESCE(min_booking_notice_min, 30)
  INTO v_studio_id, v_payment_policy, v_tz, v_min_booking_notice_min
  FROM public.studios
  WHERE slug = p_studio_slug
    AND is_active = true
    AND public.has_active_premium_access(id);
  IF v_studio_id IS NULL THEN RAISE EXCEPTION 'studio_not_available'; END IF;

  IF v_client_email IS NOT NULL THEN
    SELECT id
    INTO v_existing_client_id
    FROM public.clients
    WHERE studio_id = v_studio_id
      AND email IS NOT NULL
      AND lower(email) = lower(v_client_email)
    ORDER BY (phone LIKE 'account:%') ASC, updated_at DESC
    LIMIT 1;
  END IF;

  IF v_existing_client_id IS NULL THEN
    SELECT id
    INTO v_existing_client_id
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
      v_studio_id,
      p_customer_referral_code,
      v_request_id,
      NULL,
      NULL,
      v_client_was_existing
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

  IF v_client_email IS NOT NULL THEN
    SELECT id
    INTO v_client_id
    FROM public.clients
    WHERE studio_id = v_studio_id
      AND email IS NOT NULL
      AND lower(email) = lower(v_client_email)
    ORDER BY (phone LIKE 'account:%') ASC, updated_at DESC
    LIMIT 1;
  END IF;

  IF v_client_id IS NOT NULL THEN
    UPDATE public.clients
    SET
      name = trim(p_client_name),
      phone = CASE
        WHEN phone = v_client_phone THEN phone
        WHEN NOT EXISTS (
          SELECT 1 FROM public.clients other_client
          WHERE other_client.studio_id = v_studio_id
            AND other_client.phone = v_client_phone
            AND other_client.id <> v_client_id
        ) THEN v_client_phone
        ELSE phone
      END,
      email = COALESCE(email, v_client_email),
      updated_at = now()
    WHERE id = v_client_id
      AND studio_id = v_studio_id
    RETURNING id INTO v_client_id;
  ELSE
    INSERT INTO public.clients (studio_id, name, phone, email)
    VALUES (v_studio_id, trim(p_client_name), v_client_phone, v_client_email)
    ON CONFLICT (studio_id, phone) DO UPDATE SET
      name = EXCLUDED.name,
      email = CASE
        WHEN clients.email IS NULL THEN EXCLUDED.email
        WHEN EXCLUDED.email IS NULL THEN clients.email
        WHEN lower(clients.email) = lower(EXCLUDED.email) THEN EXCLUDED.email
        ELSE clients.email
      END,
      updated_at = now()
    RETURNING id INTO v_client_id;
  END IF;

  INSERT INTO public.appointments (studio_id, staff_id, client_id, starts_at, ends_at, status, total_price, total_duration_min, notes)
  VALUES (v_studio_id, p_staff_id, v_client_id, p_starts_at, v_ends_at, 'confirmed', v_total_price, v_total_duration, nullif(trim(coalesce(p_notes, '')), ''))
  RETURNING id INTO v_appt_id;

  INSERT INTO public.appointment_services (appointment_id, service_id, is_upsell, price, duration_min)
  SELECT v_appt_id, service_id, is_upsell, price, duration_min
  FROM public.resolve_booking_service_pricing(v_studio_id, p_service_ids);

  PERFORM public.record_upsell_acceptances_for_services(v_studio_id, p_service_ids);

  PERFORM public.record_customer_referral_intent(
    v_studio_id,
    p_customer_referral_code,
    NULL,
    v_appt_id,
    v_client_id,
    v_client_was_existing
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
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.create_public_booking(
    p_studio_slug,
    p_staff_id,
    p_starts_at,
    p_service_ids,
    p_client_name,
    p_client_phone,
    p_client_email,
    p_notes,
    NULL::text
  );
$function$;

GRANT EXECUTE ON FUNCTION public.create_public_booking(text, uuid, timestamp with time zone, uuid[], text, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_public_booking(text, uuid, timestamp with time zone, uuid[], text, text, text, text) TO anon, authenticated;
