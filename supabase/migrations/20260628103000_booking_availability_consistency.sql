CREATE OR REPLACE FUNCTION public.is_staff_slot_bookable(
  p_studio_id uuid,
  p_staff_id uuid,
  p_starts_at timestamp with time zone,
  p_duration_min integer,
  p_ignore_booking_request_id uuid DEFAULT NULL,
  p_ignore_appointment_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tz text;
  v_local_start timestamp;
  v_local_end timestamp;
BEGIN
  IF p_studio_id IS NULL
    OR p_staff_id IS NULL
    OR p_starts_at IS NULL
    OR p_duration_min IS NULL
    OR p_duration_min <= 0
    OR p_duration_min > 720
  THEN
    RETURN false;
  END IF;

  SELECT COALESCE(timezone, 'Europe/Lisbon')
  INTO v_tz
  FROM public.studios
  WHERE id = p_studio_id
    AND is_active = true;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_local_start := p_starts_at AT TIME ZONE v_tz;
  v_local_end := (p_starts_at + (p_duration_min || ' minutes')::interval) AT TIME ZONE v_tz;

  IF NOT EXISTS (
    SELECT 1
    FROM public.staff s
    WHERE s.id = p_staff_id
      AND s.studio_id = p_studio_id
      AND s.is_active = true
      AND COALESCE(s.current_status, 'online') <> 'absent'
  ) THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.staff_availability sa
    WHERE sa.studio_id = p_studio_id
      AND sa.staff_id = p_staff_id
      AND sa.weekday = EXTRACT(DOW FROM v_local_start)::int
      AND sa.start_time <= v_local_start::time
      AND sa.end_time >= v_local_end::time
  ) THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.staff_time_off t
    WHERE t.staff_id = p_staff_id
      AND tstzrange(t.starts_at, t.ends_at, '[)') &&
          tstzrange(p_starts_at, p_starts_at + (p_duration_min || ' minutes')::interval, '[)')
  ) THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.appointments a
    WHERE a.staff_id = p_staff_id
      AND (p_ignore_appointment_id IS NULL OR a.id <> p_ignore_appointment_id)
      AND a.status NOT IN ('cancelled','no_show')
      AND tstzrange(a.starts_at, a.ends_at, '[)') &&
          tstzrange(p_starts_at, p_starts_at + (p_duration_min || ' minutes')::interval, '[)')
  ) THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.booking_payment_requests bpr
    WHERE bpr.staff_id = p_staff_id
      AND (p_ignore_booking_request_id IS NULL OR bpr.id <> p_ignore_booking_request_id)
      AND bpr.status IN ('awaiting_payment','processing','paid')
      AND bpr.expires_at > now()
      AND tstzrange(bpr.starts_at, bpr.ends_at, '[)') &&
          tstzrange(p_starts_at, p_starts_at + (p_duration_min || ' minutes')::interval, '[)')
  ) THEN
    RETURN false;
  END IF;

  RETURN true;
END
$function$;

GRANT EXECUTE ON FUNCTION public.is_staff_slot_bookable(uuid, uuid, timestamp with time zone, integer, uuid, uuid) TO anon, authenticated, service_role;

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
  IF p_duration_min IS NULL OR p_duration_min <= 0 OR p_duration_min > 720 THEN
    RETURN;
  END IF;

  IF p_slot_step_min IS NULL OR p_slot_step_min <= 0 OR p_slot_step_min > 720 THEN
    p_slot_step_min := 15;
  END IF;

  SELECT id, timezone, COALESCE(min_booking_notice_min, 30)
  INTO v_studio_id, v_tz, v_min_booking_notice_min
  FROM public.studios
  WHERE slug = p_studio_slug
    AND is_active = true
    AND public.has_active_premium_access(id);

  IF v_studio_id IS NULL THEN
    RETURN;
  END IF;

  v_tz := COALESCE(v_tz, 'Europe/Lisbon');
  v_min_start := v_now + (GREATEST(v_min_booking_notice_min, 0) || ' minutes')::interval;
  v_weekday := EXTRACT(DOW FROM p_date)::int;

  RETURN QUERY
  WITH eligible_staff AS (
    SELECT s.id
    FROM public.staff s
    WHERE s.studio_id = v_studio_id
      AND s.is_active = true
      AND COALESCE(s.current_status, 'online') <> 'absent'
      AND (p_staff_id IS NULL OR s.id = p_staff_id)
  ),
  windows AS (
    SELECT sa.staff_id, sa.start_time, sa.end_time
    FROM public.staff_availability sa
    JOIN eligible_staff es ON es.id = sa.staff_id
    WHERE sa.studio_id = v_studio_id
      AND sa.weekday = v_weekday
      AND sa.end_time > sa.start_time
      AND (sa.end_time - (p_duration_min || ' minutes')::interval) >= sa.start_time
  ),
  candidates AS (
    SELECT
      w.staff_id,
      ((p_date::timestamp + (slot.local_ts::time)) AT TIME ZONE v_tz) AS slot_start_ts,
      slot.local_ts::time AS slot_t
    FROM windows w
    CROSS JOIN LATERAL generate_series(
      p_date::timestamp + w.start_time,
      p_date::timestamp + w.end_time - (p_duration_min || ' minutes')::interval,
      (p_slot_step_min || ' minutes')::interval
    ) AS slot(local_ts)
  )
  SELECT
    c.staff_id,
    c.slot_start_ts AS slot_start,
    to_char(c.slot_t, 'HH24:MI') AS slot_label
  FROM candidates c
  WHERE c.slot_start_ts >= v_min_start
    AND public.is_staff_slot_bookable(v_studio_id, c.staff_id, c.slot_start_ts, p_duration_min)
  ORDER BY c.slot_start_ts, c.staff_id;
END
$function$;

GRANT EXECUTE ON FUNCTION public.get_available_slots(text, uuid, date, integer, integer) TO anon, authenticated;

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
AS $function$
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
  v_available boolean;
  v_min_booking_notice_min integer := 30;
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
      trim(p_client_name), trim(p_client_phone), nullif(trim(coalesce(p_client_email, '')), ''),
      nullif(trim(coalesce(p_notes, '')), ''), 'awaiting_payment', now() + interval '15 minutes'
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
$function$;

GRANT EXECUTE ON FUNCTION public.create_public_booking(text, uuid, timestamp with time zone, uuid[], text, text, text, text) TO anon, authenticated;

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

  IF v_payment_status IS DISTINCT FROM 'succeeded' THEN
    RAISE EXCEPTION 'payment_not_succeeded';
  END IF;

  IF NOT public.is_staff_slot_bookable(v_req.studio_id, v_req.staff_id, v_req.starts_at, v_req.total_duration_min, v_req.id, NULL) THEN
    UPDATE public.booking_payment_requests
    SET status = 'paid_conflict',
        failure_reason = 'slot_unavailable_after_payment',
        updated_at = now()
    WHERE id = v_req.id;
    RAISE EXCEPTION 'slot_unavailable_after_payment';
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
    SET status = 'paid_conflict',
        failure_reason = 'slot_unavailable_after_payment',
        updated_at = now()
    WHERE id = p_request_id;
    RAISE EXCEPTION 'slot_unavailable_after_payment';
END;
$function$;

GRANT EXECUTE ON FUNCTION public.confirm_paid_booking_request(uuid, text) TO service_role, authenticated;
