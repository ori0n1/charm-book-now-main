-- Customer loyalty referrals are intentionally separate from studio-to-studio referrals.
-- They are scoped by studio and never create monetary affiliate credits.

CREATE TABLE IF NOT EXISTS public.customer_loyalty_settings (
  studio_id uuid PRIMARY KEY REFERENCES public.studios(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  booking_stamps_enabled boolean NOT NULL DEFAULT true,
  stamps_per_completed_booking integer NOT NULL DEFAULT 1 CHECK (stamps_per_completed_booking >= 0 AND stamps_per_completed_booking <= 100),
  referral_stamps_enabled boolean NOT NULL DEFAULT true,
  stamps_per_completed_referral integer NOT NULL DEFAULT 1 CHECK (stamps_per_completed_referral >= 0 AND stamps_per_completed_referral <= 100),
  stamps_required_for_reward integer NOT NULL DEFAULT 10 CHECK (stamps_required_for_reward > 0 AND stamps_required_for_reward <= 1000),
  reward_type text NOT NULL DEFAULT 'percent' CHECK (reward_type IN ('percent','fixed')),
  reward_value numeric(10,2) NOT NULL DEFAULT 10 CHECK (reward_value >= 0),
  levels jsonb NOT NULL DEFAULT '[{"name":"Cliente","threshold":0},{"name":"Cliente fiel","threshold":10},{"name":"Embaixadora","threshold":25}]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.customer_referral_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id uuid NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  referrer_client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (studio_id, referrer_client_id)
);

CREATE TABLE IF NOT EXISTS public.customer_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id uuid NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  referrer_client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  referred_client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  booking_request_id uuid REFERENCES public.booking_payment_requests(id) ON DELETE SET NULL,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  referral_code text NOT NULL,
  status text NOT NULL DEFAULT 'pending_completion' CHECK (status IN ('pending_completion','completed','rejected')),
  rejection_reason text,
  referred_client_was_existing boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS customer_referrals_booking_request_once
  ON public.customer_referrals(booking_request_id)
  WHERE booking_request_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS customer_referrals_appointment_once
  ON public.customer_referrals(appointment_id)
  WHERE appointment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS customer_referrals_referred_completed_once
  ON public.customer_referrals(studio_id, referred_client_id)
  WHERE referred_client_id IS NOT NULL AND status = 'completed';

CREATE TABLE IF NOT EXISTS public.customer_loyalty_stamp_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id uuid NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('booking_completed','referral_completed','reward_redeemed','manual')),
  source_appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  source_customer_referral_id uuid REFERENCES public.customer_referrals(id) ON DELETE SET NULL,
  stamps integer NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS customer_loyalty_booking_stamp_once
  ON public.customer_loyalty_stamp_entries(studio_id, client_id, source_appointment_id, source_type)
  WHERE source_type = 'booking_completed' AND source_appointment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS customer_loyalty_referral_stamp_once
  ON public.customer_loyalty_stamp_entries(studio_id, client_id, source_customer_referral_id, source_type)
  WHERE source_type = 'referral_completed' AND source_customer_referral_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.customer_loyalty_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id uuid NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  reward_type text NOT NULL CHECK (reward_type IN ('percent','fixed')),
  reward_value numeric(10,2) NOT NULL,
  stamps_required integer NOT NULL,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available','used','expired','cancelled')),
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz
);

CREATE INDEX IF NOT EXISTS customer_loyalty_rewards_lookup
  ON public.customer_loyalty_rewards(studio_id, client_id, status, created_at);

ALTER TABLE public.customer_loyalty_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_loyalty_stamp_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_loyalty_rewards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Studio members manage loyalty settings" ON public.customer_loyalty_settings;
CREATE POLICY "Studio members manage loyalty settings"
  ON public.customer_loyalty_settings
  FOR ALL
  USING (public.is_studio_member(studio_id, auth.uid()))
  WITH CHECK (public.is_studio_member(studio_id, auth.uid()));

DROP POLICY IF EXISTS "Studio members read customer loyalty" ON public.customer_referral_codes;
CREATE POLICY "Studio members read customer loyalty"
  ON public.customer_referral_codes
  FOR SELECT
  USING (public.is_studio_member(studio_id, auth.uid()));

DROP POLICY IF EXISTS "Studio members read customer referrals" ON public.customer_referrals;
CREATE POLICY "Studio members read customer referrals"
  ON public.customer_referrals
  FOR SELECT
  USING (public.is_studio_member(studio_id, auth.uid()));

DROP POLICY IF EXISTS "Studio members read customer stamps" ON public.customer_loyalty_stamp_entries;
CREATE POLICY "Studio members read customer stamps"
  ON public.customer_loyalty_stamp_entries
  FOR SELECT
  USING (public.is_studio_member(studio_id, auth.uid()));

DROP POLICY IF EXISTS "Studio members read customer rewards" ON public.customer_loyalty_rewards;
CREATE POLICY "Studio members read customer rewards"
  ON public.customer_loyalty_rewards
  FOR SELECT
  USING (public.is_studio_member(studio_id, auth.uid()));

CREATE OR REPLACE FUNCTION public.normalize_customer_referral_code(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT upper(regexp_replace(coalesce(trim(p_value), ''), '[^a-zA-Z0-9]', '', 'g'));
$function$;

CREATE OR REPLACE FUNCTION public.ensure_customer_loyalty_settings(p_studio_id uuid)
RETURNS public.customer_loyalty_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_settings public.customer_loyalty_settings%ROWTYPE;
BEGIN
  INSERT INTO public.customer_loyalty_settings (studio_id, enabled)
  VALUES (p_studio_id, false)
  ON CONFLICT (studio_id) DO NOTHING;

  SELECT * INTO v_settings
  FROM public.customer_loyalty_settings
  WHERE studio_id = p_studio_id;

  RETURN v_settings;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_or_create_customer_referral_code(
  p_studio_id uuid,
  p_client_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_code text;
  v_candidate text;
  v_attempt integer := 0;
BEGIN
  IF p_studio_id IS NULL OR p_client_id IS NULL THEN
    RAISE EXCEPTION 'customer_referral_invalid_context';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.clients c
    WHERE c.id = p_client_id
      AND c.studio_id = p_studio_id
  ) THEN
    RAISE EXCEPTION 'customer_referral_client_not_found';
  END IF;

  SELECT code INTO v_code
  FROM public.customer_referral_codes
  WHERE studio_id = p_studio_id
    AND referrer_client_id = p_client_id;

  IF v_code IS NOT NULL THEN
    RETURN v_code;
  END IF;

  LOOP
    v_attempt := v_attempt + 1;
    v_candidate := 'C' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    BEGIN
      INSERT INTO public.customer_referral_codes (studio_id, referrer_client_id, code)
      VALUES (p_studio_id, p_client_id, v_candidate)
      RETURNING code INTO v_code;
      RETURN v_code;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt > 10 THEN
        RAISE EXCEPTION 'customer_referral_code_generation_failed';
      END IF;
    END;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_customer_referral_intent(
  p_studio_id uuid,
  p_referral_code text,
  p_booking_request_id uuid,
  p_appointment_id uuid,
  p_referred_client_id uuid,
  p_referred_client_was_existing boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_code text := public.normalize_customer_referral_code(p_referral_code);
  v_referrer_client_id uuid;
  v_settings public.customer_loyalty_settings%ROWTYPE;
  v_status text := 'pending_completion';
  v_reason text := NULL;
BEGIN
  IF v_code = '' OR p_studio_id IS NULL THEN
    RETURN;
  END IF;

  SELECT referrer_client_id
  INTO v_referrer_client_id
  FROM public.customer_referral_codes
  WHERE studio_id = p_studio_id
    AND code = v_code;

  IF v_referrer_client_id IS NULL THEN
    RETURN;
  END IF;

  v_settings := public.ensure_customer_loyalty_settings(p_studio_id);
  IF NOT v_settings.enabled OR NOT v_settings.referral_stamps_enabled OR v_settings.stamps_per_completed_referral <= 0 THEN
    RETURN;
  END IF;

  IF p_referred_client_id IS NOT NULL AND v_referrer_client_id = p_referred_client_id THEN
    v_status := 'rejected';
    v_reason := 'self_referral';
  ELSIF p_referred_client_was_existing THEN
    v_status := 'rejected';
    v_reason := 'existing_client';
  END IF;

  INSERT INTO public.customer_referrals (
    studio_id,
    referrer_client_id,
    referred_client_id,
    booking_request_id,
    appointment_id,
    referral_code,
    status,
    rejection_reason,
    referred_client_was_existing
  )
  VALUES (
    p_studio_id,
    v_referrer_client_id,
    p_referred_client_id,
    p_booking_request_id,
    p_appointment_id,
    v_code,
    v_status,
    v_reason,
    COALESCE(p_referred_client_was_existing, false)
  )
  ON CONFLICT DO NOTHING;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_customer_loyalty_rewards(p_studio_id uuid, p_client_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_settings public.customer_loyalty_settings%ROWTYPE;
  v_total_stamps integer;
  v_existing_rewards integer;
  v_target_rewards integer;
  v_missing integer;
BEGIN
  v_settings := public.ensure_customer_loyalty_settings(p_studio_id);
  IF NOT v_settings.enabled OR v_settings.stamps_required_for_reward <= 0 OR v_settings.reward_value <= 0 THEN
    RETURN;
  END IF;

  SELECT COALESCE(sum(stamps), 0)::integer
  INTO v_total_stamps
  FROM public.customer_loyalty_stamp_entries
  WHERE studio_id = p_studio_id
    AND client_id = p_client_id;

  SELECT count(*)::integer
  INTO v_existing_rewards
  FROM public.customer_loyalty_rewards
  WHERE studio_id = p_studio_id
    AND client_id = p_client_id;

  v_target_rewards := floor(GREATEST(v_total_stamps, 0)::numeric / v_settings.stamps_required_for_reward)::integer;
  v_missing := GREATEST(v_target_rewards - v_existing_rewards, 0);

  WHILE v_missing > 0 LOOP
    INSERT INTO public.customer_loyalty_rewards (
      studio_id,
      client_id,
      reward_type,
      reward_value,
      stamps_required
    )
    VALUES (
      p_studio_id,
      p_client_id,
      v_settings.reward_type,
      v_settings.reward_value,
      v_settings.stamps_required_for_reward
    );
    v_missing := v_missing - 1;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.process_customer_loyalty_for_completed_appointment(p_appointment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_appt public.appointments%ROWTYPE;
  v_settings public.customer_loyalty_settings%ROWTYPE;
  v_paid_cents integer := 0;
  v_cash_amount numeric := 0;
  v_ref public.customer_referrals%ROWTYPE;
BEGIN
  SELECT * INTO v_appt
  FROM public.appointments
  WHERE id = p_appointment_id;

  IF NOT FOUND OR v_appt.status <> 'completed' THEN
    RETURN;
  END IF;

  v_settings := public.ensure_customer_loyalty_settings(v_appt.studio_id);
  IF NOT v_settings.enabled THEN
    RETURN;
  END IF;

  SELECT COALESCE(sum(amount_cents), 0)::integer
  INTO v_paid_cents
  FROM public.payment_intents
  WHERE appointment_id = v_appt.id
    AND status = 'succeeded';

  SELECT COALESCE(sum(amount), 0)
  INTO v_cash_amount
  FROM public.cash_register_movements
  WHERE appointment_id = v_appt.id
    AND studio_id = v_appt.studio_id
    AND movement_type = 'service_payment';

  IF v_appt.total_price > 0 AND (v_paid_cents <= 0 AND COALESCE(v_cash_amount, 0) <= 0) THEN
    RETURN;
  END IF;

  IF v_settings.booking_stamps_enabled AND v_settings.stamps_per_completed_booking > 0 THEN
    INSERT INTO public.customer_loyalty_stamp_entries (
      studio_id,
      client_id,
      source_type,
      source_appointment_id,
      stamps,
      note
    )
    VALUES (
      v_appt.studio_id,
      v_appt.client_id,
      'booking_completed',
      v_appt.id,
      v_settings.stamps_per_completed_booking,
      'Reserva concluida'
    )
    ON CONFLICT DO NOTHING;
  END IF;

  FOR v_ref IN
    SELECT *
    FROM public.customer_referrals
    WHERE studio_id = v_appt.studio_id
      AND (
        appointment_id = v_appt.id
        OR booking_request_id IN (
          SELECT id
          FROM public.booking_payment_requests
          WHERE appointment_id = v_appt.id
        )
      )
      AND status = 'pending_completion'
    FOR UPDATE
  LOOP
    IF v_ref.referred_client_was_existing THEN
      UPDATE public.customer_referrals
      SET status = 'rejected',
          rejection_reason = 'existing_client',
          updated_at = now()
      WHERE id = v_ref.id;
      CONTINUE;
    END IF;

    IF v_ref.referrer_client_id = v_appt.client_id THEN
      UPDATE public.customer_referrals
      SET status = 'rejected',
          rejection_reason = 'self_referral',
          referred_client_id = v_appt.client_id,
          appointment_id = v_appt.id,
          updated_at = now()
      WHERE id = v_ref.id;
      CONTINUE;
    END IF;

    UPDATE public.customer_referrals
    SET status = 'completed',
        referred_client_id = COALESCE(referred_client_id, v_appt.client_id),
        appointment_id = v_appt.id,
        completed_at = now(),
        updated_at = now()
    WHERE id = v_ref.id;

    IF v_settings.referral_stamps_enabled AND v_settings.stamps_per_completed_referral > 0 THEN
      INSERT INTO public.customer_loyalty_stamp_entries (
        studio_id,
        client_id,
        source_type,
        source_customer_referral_id,
        stamps,
        note
      )
      VALUES (
        v_appt.studio_id,
        v_ref.referrer_client_id,
        'referral_completed',
        v_ref.id,
        v_settings.stamps_per_completed_referral,
        'Indicacao concluida'
      )
      ON CONFLICT DO NOTHING;

      PERFORM public.issue_customer_loyalty_rewards(v_appt.studio_id, v_ref.referrer_client_id);
    END IF;
  END LOOP;

  PERFORM public.issue_customer_loyalty_rewards(v_appt.studio_id, v_appt.client_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.customer_loyalty_completed_appointment_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'completed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM public.process_customer_loyalty_for_completed_appointment(NEW.id);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_customer_loyalty_completed_appointment ON public.appointments;
CREATE TRIGGER trg_customer_loyalty_completed_appointment
AFTER INSERT OR UPDATE OF status ON public.appointments
FOR EACH ROW
EXECUTE FUNCTION public.customer_loyalty_completed_appointment_trigger();

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

  SELECT id
  INTO v_existing_client_id
  FROM public.clients
  WHERE studio_id = v_studio_id
    AND (
      phone = trim(p_client_phone)
      OR (
        nullif(trim(coalesce(p_client_email, '')), '') IS NOT NULL
        AND email IS NOT NULL
        AND lower(email) = lower(nullif(trim(coalesce(p_client_email, '')), ''))
      )
    )
  ORDER BY updated_at DESC
  LIMIT 1;
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
      trim(p_client_name), trim(p_client_phone), nullif(trim(coalesce(p_client_email, '')), ''),
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

GRANT EXECUTE ON FUNCTION public.create_public_booking(text, uuid, timestamp with time zone, uuid[], text, text, text, text, text) TO anon, authenticated;
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
  ORDER BY updated_at DESC
  LIMIT 1;

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
  WHERE studio_id = v_req.studio_id
    AND booking_request_id = v_req.id;

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

GRANT EXECUTE ON FUNCTION public.get_or_create_customer_referral_code(uuid, uuid) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.process_customer_loyalty_for_completed_appointment(uuid) TO service_role, authenticated;
