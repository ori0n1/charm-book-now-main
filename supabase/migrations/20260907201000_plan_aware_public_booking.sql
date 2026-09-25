-- Public booking must expose and execute the effective plan, not merely the
-- preserved studio configuration. Downgrades keep data but cannot keep using
-- paid capabilities through public views or service-role RPCs.

CREATE OR REPLACE VIEW public.public_studios
WITH (security_barrier = true)
AS
SELECT
  studio.id, studio.slug, studio.name, studio.tagline, studio.description,
  studio.hero_image_url, studio.hero_gallery_urls, studio.logo_url,
  studio.brand_color, studio.location, studio.phone, studio.email,
  studio.whatsapp, studio.instagram, studio.timezone, studio.currency,
  studio.is_active,
  CASE
    WHEN public.studio_has_entitlement(studio.id, 'reviews') THEN studio.rating
    ELSE NULL::numeric(2,1)
  END::numeric(2,1) AS rating,
  CASE WHEN public.studio_has_entitlement(studio.id, 'reviews') THEN studio.reviews_count ELSE 0 END AS reviews_count,
  studio.updated_at,
  CASE
    WHEN public.studio_has_entitlement(studio.id, 'online_payments') THEN studio.payment_policy
    ELSE 'pay_in_studio'
  END AS payment_policy,
  CASE
    WHEN public.studio_has_entitlement(studio.id, 'online_payments') THEN studio.accepted_payment_methods
    ELSE ARRAY[]::text[]
  END AS accepted_payment_methods,
  CASE
    WHEN public.studio_has_entitlement(studio.id, 'online_payments') THEN studio.deposit_percent
    ELSE 0
  END AS deposit_percent,
  studio.public_amenities, studio.min_booking_notice_min, studio.business_segment,
  studio.cancellation_min_notice_hours, studio.cancellation_after_deadline_policy,
  CASE
    WHEN public.studio_has_entitlement(studio.id, 'online_payments') THEN studio.refund_requests_enabled
    ELSE false
  END AS refund_requests_enabled,
  studio.cancellation_policy_text, studio.legal_policy_version,
  CASE
    WHEN public.studio_has_entitlement(studio.id, 'online_payments') THEN studio.stripe_connect_charges_enabled
    ELSE false
  END AS stripe_connect_charges_enabled,
  CASE
    WHEN public.studio_has_entitlement(studio.id, 'online_payments') THEN studio.stripe_connect_onboarding_completed
    ELSE false
  END AS stripe_connect_onboarding_completed,
  CASE
    WHEN public.studio_has_entitlement(studio.id, 'online_payments') THEN studio.stripe_connect_mb_way_payments_enabled
    ELSE false
  END AS stripe_connect_mb_way_payments_enabled,
  CASE
    WHEN public.studio_has_entitlement(studio.id, 'whatsapp') THEN studio.booking_flow_mode
    ELSE 'online'
  END AS booking_flow_mode,
  CASE
    WHEN public.studio_has_entitlement(studio.id, 'whatsapp') THEN studio.booking_request_professional_mode
    ELSE 'hidden'
  END AS booking_request_professional_mode,
  public.studio_has_entitlement(studio.id, 'notifications') AS notifications_enabled
FROM public.studios AS studio
WHERE studio.is_active = true
  AND public.studio_has_entitlement(studio.id, 'public_page');

CREATE OR REPLACE VIEW public.public_staff
WITH (security_barrier = true)
AS
SELECT
  member.id, member.studio_id, member.name, member.role, member.bio,
  member.photo_url, member.rating, member.reviews_count, member.is_active,
  member.current_status, member.sort_order
FROM public.staff AS member
JOIN public.studios AS studio ON studio.id = member.studio_id
WHERE studio.is_active = true
  AND member.is_active = true
  AND public.studio_staff_is_within_plan(member.studio_id, member.id);

CREATE OR REPLACE VIEW public.public_staff_services
WITH (security_barrier = true)
AS
SELECT member.studio_id, link.staff_id, link.service_id
FROM public.staff_services AS link
JOIN public.staff AS member ON member.id = link.staff_id AND member.is_active = true
JOIN public.services AS service
  ON service.id = link.service_id
 AND service.studio_id = member.studio_id
 AND service.is_active = true
JOIN public.studios AS studio ON studio.id = member.studio_id AND studio.is_active = true
WHERE public.studio_staff_is_within_plan(member.studio_id, member.id);

CREATE OR REPLACE VIEW public.public_upsell_offers
WITH (security_barrier = true)
AS
SELECT
  offer.id, offer.studio_id, offer.trigger_service_id, offer.offered_service_id,
  offer.discounted_price, offer.description, offer.is_active,
  offer.discount_type, offer.discount_value, offer.display_mode, offer.duration_min
FROM public.upsell_offers AS offer
JOIN public.studios AS studio ON studio.id = offer.studio_id
WHERE studio.is_active = true
  AND offer.is_active = true
  AND public.studio_has_entitlement(offer.studio_id, 'promotions');

REVOKE ALL ON public.public_studios FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.public_staff FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.public_staff_services FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.public_upsell_offers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.public_studios TO anon, authenticated;
GRANT SELECT ON public.public_staff TO anon, authenticated;
GRANT SELECT ON public.public_staff_services TO anon, authenticated;
GRANT SELECT ON public.public_upsell_offers TO anon, authenticated;

-- Pricing is resolved once in the database.  A preserved Premium offer must
-- not keep discounting bookings after a downgrade: the offer data remains in
-- place, but only the promotions entitlement can make it financially active.
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
    service.id AS service_id,
    CASE
      WHEN requested.position > 1 AND offer.id IS NOT NULL
        THEN round(offer.discounted_price::numeric, 2)
      ELSE round(service.price::numeric, 2)
    END AS price,
    CASE
      WHEN requested.position > 1 AND offer.id IS NOT NULL
        THEN COALESCE(offer.duration_min, service.duration_min)
      ELSE service.duration_min
    END AS duration_min,
    (requested.position > 1 AND offer.id IS NOT NULL) AS is_upsell,
    offer.id AS offer_id
  FROM requested
  JOIN public.services AS service
    ON service.id = requested.service_id
   AND service.studio_id = p_studio_id
   AND service.is_active = true
  CROSS JOIN trigger_service
  LEFT JOIN public.upsell_offers AS offer
    ON public.studio_has_entitlement(p_studio_id, 'promotions')
   AND offer.studio_id = p_studio_id
   AND offer.trigger_service_id = trigger_service.id
   AND offer.offered_service_id = service.id
   AND offer.is_active = true
  ORDER BY requested.position;
$$;

REVOKE ALL ON FUNCTION public.resolve_booking_service_pricing(uuid, uuid[])
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_booking_service_pricing(uuid, uuid[])
  TO anon, authenticated, service_role;

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

  SELECT studio.id INTO v_studio_id
  FROM public.studios AS studio
  WHERE studio.slug = p_studio_slug
    AND studio.is_active = true
    AND public.studio_has_entitlement(studio.id, 'online_booking');
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
    FROM public.resolve_booking_service_pricing(v_studio_id, p_service_ids) AS resolved
  ) AS priced;

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

CREATE OR REPLACE FUNCTION public.get_available_slots(
  p_studio_slug text,
  p_staff_id uuid,
  p_date date,
  p_duration_min integer,
  p_slot_step_min integer DEFAULT 15
)
RETURNS TABLE(staff_id uuid, slot_start timestamp with time zone, slot_label text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_studio_id uuid;
  v_tz text := 'Europe/Lisbon';
  v_weekday int;
  v_now timestamptz := now();
  v_min_booking_notice_min integer := 30;
  v_min_start timestamptz;
BEGIN
  IF p_duration_min IS NULL OR p_duration_min <= 0 OR p_duration_min > 720 THEN RETURN; END IF;
  IF p_slot_step_min IS NULL OR p_slot_step_min <= 0 OR p_slot_step_min > 720 THEN
    p_slot_step_min := 15;
  END IF;

  SELECT studio.id, studio.timezone, COALESCE(studio.min_booking_notice_min, 30)
  INTO v_studio_id, v_tz, v_min_booking_notice_min
  FROM public.studios AS studio
  WHERE studio.slug = p_studio_slug
    AND studio.is_active = true
    AND public.studio_has_entitlement(studio.id, 'online_booking');
  IF v_studio_id IS NULL THEN RETURN; END IF;

  v_tz := COALESCE(v_tz, 'Europe/Lisbon');
  v_min_start := v_now + (GREATEST(v_min_booking_notice_min, 0) || ' minutes')::interval;
  v_weekday := EXTRACT(DOW FROM p_date)::int;

  RETURN QUERY
  WITH eligible_staff AS (
    SELECT member.id
    FROM public.staff AS member
    WHERE member.studio_id = v_studio_id
      AND member.is_active = true
      AND COALESCE(member.current_status, 'online') <> 'absent'
      AND (p_staff_id IS NULL OR member.id = p_staff_id)
      AND public.studio_staff_is_within_plan(v_studio_id, member.id)
  ), windows AS (
    SELECT availability.staff_id, availability.start_time, availability.end_time
    FROM public.staff_availability AS availability
    JOIN eligible_staff ON eligible_staff.id = availability.staff_id
    WHERE availability.studio_id = v_studio_id
      AND availability.weekday = v_weekday
      AND availability.end_time > availability.start_time
  ), slot_grid AS (
    SELECT
      windows.staff_id,
      slot.local_ts,
      slot.local_ts::time AS slot_t
    FROM windows
    CROSS JOIN LATERAL generate_series(
      p_date::timestamp + windows.start_time,
      p_date::timestamp + windows.end_time,
      (p_slot_step_min || ' minutes')::interval
    ) AS slot(local_ts)
  ), candidates AS (
    SELECT
      slot_grid.staff_id,
      (slot_grid.local_ts AT TIME ZONE v_tz) AS slot_start_ts,
      slot_grid.slot_t
    FROM slot_grid
  )
  SELECT
    candidates.staff_id,
    candidates.slot_start_ts AS slot_start,
    to_char(candidates.slot_t, 'HH24:MI') AS slot_label
  FROM candidates
  WHERE candidates.slot_start_ts >= v_min_start
    AND public.is_staff_slot_bookable(
      v_studio_id, candidates.staff_id, candidates.slot_start_ts, p_duration_min
    )
  ORDER BY candidates.slot_start_ts, candidates.staff_id;
END
$function$;

REVOKE ALL ON FUNCTION public.get_available_slots(text, uuid, date, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_available_slots(text, uuid, date, integer, integer) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_public_booking_online_core(
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

  SELECT
    studio.id,
    CASE
      WHEN public.studio_has_entitlement(studio.id, 'online_payments') THEN studio.payment_policy
      ELSE 'pay_in_studio'
    END,
    COALESCE(studio.min_booking_notice_min, 30)
  INTO v_studio_id, v_payment_policy, v_min_booking_notice_min
  FROM public.studios AS studio
  WHERE studio.slug = p_studio_slug
    AND studio.is_active = true
    AND public.studio_has_entitlement(studio.id, 'online_booking');
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
        v_client_email IS NULL OR email IS NULL OR lower(email) = lower(v_client_email)
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
    AND COALESCE(current_status, 'online') <> 'absent'
    AND public.studio_staff_is_within_plan(v_studio_id, p_staff_id);
  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1 FROM public.staff
      WHERE id = p_staff_id
        AND studio_id = v_studio_id
        AND is_active = true
        AND COALESCE(current_status, 'online') = 'absent'
        AND public.studio_staff_is_within_plan(v_studio_id, p_staff_id)
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

    IF public.studio_has_entitlement(v_studio_id, 'loyalty') THEN
      PERFORM public.record_customer_referral_intent(
        v_studio_id, p_customer_referral_code, v_request_id, NULL, NULL, v_client_was_existing
      );
    END IF;

    RETURN jsonb_build_object(
      'booking_request_id', v_request_id, 'appointment_id', NULL,
      'studio_id', v_studio_id, 'starts_at', p_starts_at, 'ends_at', v_ends_at,
      'total_price', v_total_price, 'total_duration_min', v_total_duration,
      'requires_payment', true, 'reservation_status', 'awaiting_payment',
      'payment_status', 'not_started'
    );
  END IF;

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

  IF public.studio_has_entitlement(v_studio_id, 'promotions') THEN
    PERFORM public.record_upsell_acceptances_for_services(v_studio_id, p_service_ids);
  END IF;
  IF public.studio_has_entitlement(v_studio_id, 'loyalty') THEN
    PERFORM public.record_customer_referral_intent(
      v_studio_id, p_customer_referral_code, NULL, v_appt_id, v_client_id, v_client_was_existing
    );
  END IF;

  RETURN jsonb_build_object(
    'appointment_id', v_appt_id, 'booking_request_id', NULL,
    'studio_id', v_studio_id, 'starts_at', p_starts_at, 'ends_at', v_ends_at,
    'total_price', v_total_price, 'total_duration_min', v_total_duration,
    'requires_payment', false, 'reservation_status', 'confirmed',
    'payment_status', 'pay_in_studio'
  );
EXCEPTION
  WHEN exclusion_violation THEN RAISE EXCEPTION 'slot_unavailable';
END;
$function$;

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
SET search_path = public
AS $$
DECLARE
  v_studio_id uuid;
  v_mode text;
BEGIN
  SELECT
    studio.id,
    CASE
      WHEN public.studio_has_entitlement(studio.id, 'whatsapp') THEN studio.booking_flow_mode
      ELSE 'online'
    END
  INTO v_studio_id, v_mode
  FROM public.studios AS studio
  WHERE studio.slug = p_studio_slug
    AND studio.is_active = true
    AND public.studio_has_entitlement(studio.id, 'online_booking');

  IF v_studio_id IS NULL THEN RAISE EXCEPTION 'studio_not_available'; END IF;
  IF v_mode <> 'online' THEN RAISE EXCEPTION 'booking_request_mode_only'; END IF;

  RETURN public.create_public_booking_online_core(
    p_studio_slug, p_staff_id, p_starts_at, p_service_ids,
    p_client_name, p_client_phone, p_client_email, p_notes,
    p_customer_referral_code
  );
END
$$;

REVOKE ALL ON FUNCTION public.create_public_booking_online_core(
  text, uuid, timestamptz, uuid[], text, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_public_booking_online_core(
  text, uuid, timestamptz, uuid[], text, text, text, text, text
) TO service_role;
REVOKE ALL ON FUNCTION public.create_public_booking(
  text, uuid, timestamptz, uuid[], text, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_public_booking(
  text, uuid, timestamptz, uuid[], text, text, text, text, text
) TO service_role;

NOTIFY pgrst, 'reload schema';
