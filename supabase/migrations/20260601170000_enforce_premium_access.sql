CREATE OR REPLACE FUNCTION public.has_active_premium_access(_studio_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.studios s
    WHERE s.id = _studio_id
      AND s.is_active = true
      AND (
        (
          s.subscription_status = 'active'
          AND (
            (s.subscription_current_period_end IS NOT NULL AND s.subscription_current_period_end > now())
            OR (s.premium_access_until IS NOT NULL AND s.premium_access_until > now())
          )
        )
        OR (
          s.subscription_status = 'trialing'
          AND s.trial_ends_at IS NOT NULL
          AND s.trial_ends_at > now()
        )
        OR (
          s.premium_access_until IS NOT NULL
          AND s.premium_access_until > now()
        )
        OR EXISTS (
          SELECT 1
          FROM public.subscriptions sub
          WHERE sub.studio_id = s.id
            AND sub.status IN ('active', 'trialing')
            AND sub.current_period_end IS NOT NULL
            AND sub.current_period_end > now()
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.can_use_studio(_user_id uuid, _studio_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_studio_member(_user_id, _studio_id)
     AND public.has_active_premium_access(_studio_id)
$$;

DROP POLICY IF EXISTS "Members manage own studio" ON public.studios;
CREATE POLICY "Members manage own studio" ON public.studios
  FOR ALL TO authenticated
  USING (public.can_use_studio(auth.uid(), id))
  WITH CHECK (public.can_use_studio(auth.uid(), id));

DROP POLICY IF EXISTS "Studio owners manage roles" ON public.user_roles;
CREATE POLICY "Studio owners manage roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (
    studio_id IS NOT NULL
    AND public.has_role(auth.uid(), studio_id, 'studio_owner')
    AND public.has_active_premium_access(studio_id)
  )
  WITH CHECK (
    studio_id IS NOT NULL
    AND public.has_role(auth.uid(), studio_id, 'studio_owner')
    AND public.has_active_premium_access(studio_id)
  );

DROP POLICY IF EXISTS "Members manage categories" ON public.service_categories;
CREATE POLICY "Members manage categories" ON public.service_categories
  FOR ALL TO authenticated
  USING (public.can_use_studio(auth.uid(), studio_id))
  WITH CHECK (public.can_use_studio(auth.uid(), studio_id));

DROP POLICY IF EXISTS "Members manage services" ON public.services;
CREATE POLICY "Members manage services" ON public.services
  FOR ALL TO authenticated
  USING (public.can_use_studio(auth.uid(), studio_id))
  WITH CHECK (public.can_use_studio(auth.uid(), studio_id));

DROP POLICY IF EXISTS "Members manage staff" ON public.staff;
CREATE POLICY "Members manage staff" ON public.staff
  FOR ALL TO authenticated
  USING (public.can_use_studio(auth.uid(), studio_id))
  WITH CHECK (public.can_use_studio(auth.uid(), studio_id));

DROP POLICY IF EXISTS "Members manage staff_services" ON public.staff_services;
CREATE POLICY "Members manage staff_services" ON public.staff_services
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = staff_id
        AND public.can_use_studio(auth.uid(), s.studio_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = staff_id
        AND public.can_use_studio(auth.uid(), s.studio_id)
    )
  );

DROP POLICY IF EXISTS "Members manage availability" ON public.staff_availability;
CREATE POLICY "Members manage availability" ON public.staff_availability
  FOR ALL TO authenticated
  USING (public.can_use_studio(auth.uid(), studio_id))
  WITH CHECK (public.can_use_studio(auth.uid(), studio_id));

DROP POLICY IF EXISTS "Members manage time_off" ON public.staff_time_off;
CREATE POLICY "Members manage time_off" ON public.staff_time_off
  FOR ALL TO authenticated
  USING (public.can_use_studio(auth.uid(), studio_id))
  WITH CHECK (public.can_use_studio(auth.uid(), studio_id));

DROP POLICY IF EXISTS "Members manage upsells" ON public.upsell_offers;
CREATE POLICY "Members manage upsells" ON public.upsell_offers
  FOR ALL TO authenticated
  USING (public.can_use_studio(auth.uid(), studio_id))
  WITH CHECK (public.can_use_studio(auth.uid(), studio_id));

DROP POLICY IF EXISTS "Members manage clients" ON public.clients;
CREATE POLICY "Members manage clients" ON public.clients
  FOR ALL TO authenticated
  USING (public.can_use_studio(auth.uid(), studio_id))
  WITH CHECK (public.can_use_studio(auth.uid(), studio_id));

DROP POLICY IF EXISTS "Members manage appointments" ON public.appointments;
CREATE POLICY "Members manage appointments" ON public.appointments
  FOR ALL TO authenticated
  USING (public.can_use_studio(auth.uid(), studio_id))
  WITH CHECK (public.can_use_studio(auth.uid(), studio_id));

DROP POLICY IF EXISTS "Members manage appointment_services" ON public.appointment_services;
CREATE POLICY "Members manage appointment_services" ON public.appointment_services
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.appointments a
      WHERE a.id = appointment_id
        AND public.can_use_studio(auth.uid(), a.studio_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.appointments a
      WHERE a.id = appointment_id
        AND public.can_use_studio(auth.uid(), a.studio_id)
    )
  );

DROP POLICY IF EXISTS "Members read notifications" ON public.notifications_log;
CREATE POLICY "Members read notifications" ON public.notifications_log
  FOR SELECT TO authenticated
  USING (public.can_use_studio(auth.uid(), studio_id));

DROP POLICY IF EXISTS "Members read booking payment requests" ON public.booking_payment_requests;
CREATE POLICY "Members read booking payment requests" ON public.booking_payment_requests
  FOR SELECT TO authenticated
  USING (public.can_use_studio(auth.uid(), studio_id));

DROP POLICY IF EXISTS "Members read payment_intents" ON public.payment_intents;
CREATE POLICY "Members read payment_intents" ON public.payment_intents
  FOR SELECT TO authenticated
  USING (public.can_use_studio(auth.uid(), studio_id));

DROP POLICY IF EXISTS "Members manage onboarding_progress" ON public.onboarding_progress;
CREATE POLICY "Members manage onboarding_progress" ON public.onboarding_progress
  FOR ALL TO authenticated
  USING (public.can_use_studio(auth.uid(), studio_id))
  WITH CHECK (public.can_use_studio(auth.uid(), studio_id));

DROP POLICY IF EXISTS "Members manage manual service entries" ON public.manual_service_entries;
CREATE POLICY "Members manage manual service entries" ON public.manual_service_entries
  FOR ALL TO authenticated
  USING (public.can_use_studio(auth.uid(), studio_id))
  WITH CHECK (public.can_use_studio(auth.uid(), studio_id));

DROP POLICY IF EXISTS "Members read studio notifications" ON public.studio_notifications;
CREATE POLICY "Members read studio notifications" ON public.studio_notifications
  FOR SELECT TO authenticated
  USING (public.can_use_studio(auth.uid(), studio_id));

DROP POLICY IF EXISTS "Members update studio notifications" ON public.studio_notifications;
CREATE POLICY "Members update studio notifications" ON public.studio_notifications
  FOR UPDATE TO authenticated
  USING (public.can_use_studio(auth.uid(), studio_id))
  WITH CHECK (public.can_use_studio(auth.uid(), studio_id));

DROP POLICY IF EXISTS "Members read whatsapp message logs" ON public.whatsapp_message_logs;
CREATE POLICY "Members read whatsapp message logs" ON public.whatsapp_message_logs
  FOR SELECT TO authenticated
  USING (public.can_use_studio(auth.uid(), studio_id));

DROP POLICY IF EXISTS "Members read policy acceptances" ON public.booking_policy_acceptances;
CREATE POLICY "Members read policy acceptances" ON public.booking_policy_acceptances
  FOR SELECT TO authenticated
  USING (public.can_use_studio(auth.uid(), studio_id));

DROP POLICY IF EXISTS "Members manage refund requests" ON public.refund_requests;
CREATE POLICY "Members manage refund requests" ON public.refund_requests
  FOR ALL TO authenticated
  USING (public.can_use_studio(auth.uid(), studio_id))
  WITH CHECK (public.can_use_studio(auth.uid(), studio_id));

DROP POLICY IF EXISTS "Owners manage payout settings" ON public.studio_payout_settings;
CREATE POLICY "Owners manage payout settings" ON public.studio_payout_settings
  FOR ALL TO authenticated
  USING (public.can_use_studio(auth.uid(), studio_id))
  WITH CHECK (public.can_use_studio(auth.uid(), studio_id));

DROP POLICY IF EXISTS "Members read withdrawal requests" ON public.withdrawal_requests;
CREATE POLICY "Members read withdrawal requests" ON public.withdrawal_requests
  FOR SELECT TO authenticated
  USING (public.can_use_studio(auth.uid(), studio_id));

DROP POLICY IF EXISTS "Members upload studio-assets" ON storage.objects;
CREATE POLICY "Members upload studio-assets"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'studio-assets'
    AND public.can_use_studio(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "Members update studio-assets" ON storage.objects;
CREATE POLICY "Members update studio-assets"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'studio-assets'
    AND public.can_use_studio(auth.uid(), ((storage.foldername(name))[1])::uuid)
  )
  WITH CHECK (
    bucket_id = 'studio-assets'
    AND public.can_use_studio(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "Members delete studio-assets" ON storage.objects;
CREATE POLICY "Members delete studio-assets"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'studio-assets'
    AND public.can_use_studio(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

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
  v_effective_slot_step_min integer;
BEGIN
  IF p_duration_min IS NULL OR p_duration_min <= 0 OR p_duration_min > 720 THEN
    RETURN;
  END IF;

  IF p_slot_step_min IS NULL OR p_slot_step_min <= 0 OR p_slot_step_min > 720 THEN
    p_slot_step_min := 15;
  END IF;

  v_effective_slot_step_min := GREATEST(p_slot_step_min, p_duration_min);

  SELECT id, timezone, COALESCE(min_booking_notice_min, 30)
  INTO v_studio_id, v_tz, v_min_booking_notice_min
  FROM public.studios
  WHERE slug = p_studio_slug
    AND is_active = true
    AND public.has_active_premium_access(id);

  IF v_studio_id IS NULL THEN
    RETURN;
  END IF;

  v_min_start := v_now + (GREATEST(v_min_booking_notice_min, 0) || ' minutes')::interval;
  v_weekday := EXTRACT(DOW FROM p_date)::int;

  RETURN QUERY
  WITH eligible_staff AS (
    SELECT s.id
    FROM public.staff s
    WHERE s.studio_id = v_studio_id
      AND s.is_active = true
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
      (v_effective_slot_step_min || ' minutes')::interval
    ) AS slot(local_ts)
  )
  SELECT
    c.staff_id,
    c.slot_start_ts AS slot_start,
    to_char(c.slot_t, 'HH24:MI') AS slot_label
  FROM candidates c
  WHERE c.slot_start_ts >= v_min_start
    AND NOT EXISTS (
      SELECT 1
      FROM public.staff_time_off t
      WHERE t.staff_id = c.staff_id
        AND tstzrange(t.starts_at, t.ends_at, '[)') &&
            tstzrange(c.slot_start_ts, c.slot_start_ts + (p_duration_min || ' minutes')::interval, '[)')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.appointments a
      WHERE a.staff_id = c.staff_id
        AND a.status NOT IN ('cancelled','no_show')
        AND tstzrange(a.starts_at, a.ends_at, '[)') &&
            tstzrange(c.slot_start_ts, c.slot_start_ts + (p_duration_min || ' minutes')::interval, '[)')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.booking_payment_requests bpr
      WHERE bpr.staff_id = c.staff_id
        AND bpr.status IN ('awaiting_payment','processing','paid')
        AND bpr.expires_at > now()
        AND tstzrange(bpr.starts_at, bpr.ends_at, '[)') &&
            tstzrange(c.slot_start_ts, c.slot_start_ts + (p_duration_min || ' minutes')::interval, '[)')
    )
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
  v_local_start timestamp;
  v_available boolean;
  v_min_booking_notice_min integer := 30;
BEGIN
  IF p_client_name IS NULL OR length(trim(p_client_name)) < 2 THEN RAISE EXCEPTION 'invalid_name'; END IF;
  IF p_client_phone IS NULL OR length(regexp_replace(trim(p_client_phone), '\D', '', 'g')) < 9 THEN RAISE EXCEPTION 'invalid_phone'; END IF;
  IF array_length(p_service_ids, 1) IS NULL THEN RAISE EXCEPTION 'no_services'; END IF;

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
$function$;

GRANT EXECUTE ON FUNCTION public.create_public_booking(text, uuid, timestamp with time zone, uuid[], text, text, text, text) TO anon, authenticated;
