-- Final pre-launch security hardening.
-- Public catalog data is exposed through allowlisted views; private base tables
-- remain available only through tenant-scoped policies and trusted server code.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE OR REPLACE VIEW public.public_studios
WITH (security_barrier = true)
AS
SELECT
  id,
  slug,
  name,
  tagline,
  description,
  hero_image_url,
  hero_gallery_urls,
  logo_url,
  brand_color,
  location,
  phone,
  email,
  whatsapp,
  instagram,
  timezone,
  currency,
  is_active,
  rating,
  reviews_count,
  updated_at,
  payment_policy,
  accepted_payment_methods,
  deposit_percent,
  public_amenities,
  min_booking_notice_min,
  business_segment,
  cancellation_min_notice_hours,
  cancellation_after_deadline_policy,
  refund_requests_enabled,
  cancellation_policy_text,
  legal_policy_version,
  stripe_connect_charges_enabled,
  stripe_connect_onboarding_completed,
  stripe_connect_mb_way_payments_enabled
FROM public.studios
WHERE is_active = true;

CREATE OR REPLACE VIEW public.public_services
WITH (security_barrier = true)
AS
SELECT
  service.id,
  service.studio_id,
  service.category_id,
  service.name,
  service.description,
  service.duration_min,
  service.price,
  service.is_recommended,
  service.is_active,
  service.media,
  service.sort_order
FROM public.services AS service
JOIN public.studios AS studio ON studio.id = service.studio_id
WHERE studio.is_active = true AND service.is_active = true;

CREATE OR REPLACE VIEW public.public_service_categories
WITH (security_barrier = true)
AS
SELECT category.id, category.studio_id, category.label, category.sort_order
FROM public.service_categories AS category
JOIN public.studios AS studio ON studio.id = category.studio_id
WHERE studio.is_active = true;

CREATE OR REPLACE VIEW public.public_staff
WITH (security_barrier = true)
AS
SELECT
  member.id,
  member.studio_id,
  member.name,
  member.role,
  member.bio,
  member.photo_url,
  member.rating,
  member.reviews_count,
  member.is_active,
  member.current_status,
  member.sort_order
FROM public.staff AS member
JOIN public.studios AS studio ON studio.id = member.studio_id
WHERE studio.is_active = true AND member.is_active = true;

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
JOIN public.studios AS studio ON studio.id = member.studio_id AND studio.is_active = true;

CREATE OR REPLACE VIEW public.public_upsell_offers
WITH (security_barrier = true)
AS
SELECT
  offer.id,
  offer.studio_id,
  offer.trigger_service_id,
  offer.offered_service_id,
  offer.discounted_price,
  offer.description,
  offer.is_active,
  offer.discount_type,
  offer.discount_value,
  offer.display_mode,
  offer.duration_min
FROM public.upsell_offers AS offer
JOIN public.studios AS studio ON studio.id = offer.studio_id
WHERE studio.is_active = true AND offer.is_active = true;

REVOKE ALL ON public.public_studios FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.public_services FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.public_service_categories FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.public_staff FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.public_staff_services FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.public_upsell_offers FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.public_studios TO anon, authenticated;
GRANT SELECT ON public.public_services TO anon, authenticated;
GRANT SELECT ON public.public_service_categories TO anon, authenticated;
GRANT SELECT ON public.public_staff TO anon, authenticated;
GRANT SELECT ON public.public_staff_services TO anon, authenticated;
GRANT SELECT ON public.public_upsell_offers TO anon, authenticated;

DROP POLICY IF EXISTS "Public can read active studios" ON public.studios;
DROP POLICY IF EXISTS "Public read active staff" ON public.staff;
DROP POLICY IF EXISTS "Public read active services" ON public.services;
DROP POLICY IF EXISTS "Public read categories" ON public.service_categories;
DROP POLICY IF EXISTS "Public read staff_services" ON public.staff_services;
DROP POLICY IF EXISTS "Public read availability" ON public.staff_availability;
DROP POLICY IF EXISTS "Public read active upsells" ON public.upsell_offers;
DROP POLICY IF EXISTS "Public can read reviews" ON public.studio_reviews;
DROP POLICY IF EXISTS "Users insert own reviews" ON public.studio_reviews;
DROP POLICY IF EXISTS "Authenticated can create studio" ON public.studios;
DROP POLICY IF EXISTS "Studio owners manage roles" ON public.user_roles;

-- Team access is managed by authenticated server functions. Direct role writes
-- would otherwise allow a studio owner to mint the global saas_owner role.
REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM authenticated;

-- Direct studio creation bypassed trial controls. The guarded RPC remains the
-- only authenticated creation path.
REVOKE INSERT ON public.studios FROM authenticated;
REVOKE ALL ON public.studios FROM anon;

-- Prevent browser sessions from changing platform billing/trial/Stripe state.
CREATE OR REPLACE FUNCTION public.guard_studio_platform_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.role() IN ('anon', 'authenticated') AND (
    NEW.plan IS DISTINCT FROM OLD.plan OR
    NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at OR
    NEW.is_active IS DISTINCT FROM OLD.is_active OR
    NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id OR
    NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id OR
    NEW.subscription_status IS DISTINCT FROM OLD.subscription_status OR
    NEW.subscription_current_period_end IS DISTINCT FROM OLD.subscription_current_period_end OR
    NEW.subscription_cancel_at_period_end IS DISTINCT FROM OLD.subscription_cancel_at_period_end OR
    NEW.premium_access_until IS DISTINCT FROM OLD.premium_access_until OR
    NEW.trial_used_at IS DISTINCT FROM OLD.trial_used_at OR
    NEW.stripe_connect_account_id IS DISTINCT FROM OLD.stripe_connect_account_id OR
    NEW.stripe_connect_charges_enabled IS DISTINCT FROM OLD.stripe_connect_charges_enabled OR
    NEW.stripe_connect_payouts_enabled IS DISTINCT FROM OLD.stripe_connect_payouts_enabled OR
    NEW.stripe_connect_onboarding_completed IS DISTINCT FROM OLD.stripe_connect_onboarding_completed OR
    NEW.stripe_connect_status IS DISTINCT FROM OLD.stripe_connect_status OR
    NEW.stripe_connect_mb_way_payments_enabled IS DISTINCT FROM OLD.stripe_connect_mb_way_payments_enabled OR
    NEW.trial_claimed_at IS DISTINCT FROM OLD.trial_claimed_at OR
    NEW.trial_identity_phone IS DISTINCT FROM OLD.trial_identity_phone OR
    NEW.trial_identity_studio_name IS DISTINCT FROM OLD.trial_identity_studio_name OR
    NEW.trial_identity_slug IS DISTINCT FROM OLD.trial_identity_slug OR
    NEW.trial_identity_ip_hash IS DISTINCT FROM OLD.trial_identity_ip_hash OR
    NEW.trial_identity_device_fingerprint_hash IS DISTINCT FROM OLD.trial_identity_device_fingerprint_hash OR
    NEW.trial_identity_nif IS DISTINCT FROM OLD.trial_identity_nif OR
    NEW.trial_identity_stripe_account_id IS DISTINCT FROM OLD.trial_identity_stripe_account_id OR
    NEW.trial_blocked_reason IS DISTINCT FROM OLD.trial_blocked_reason
  ) THEN
    RAISE EXCEPTION 'platform_fields_are_server_managed';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_guard_studio_platform_fields ON public.studios;
CREATE TRIGGER trg_guard_studio_platform_fields
BEFORE UPDATE ON public.studios
FOR EACH ROW EXECUTE FUNCTION public.guard_studio_platform_fields();

REVOKE ALL ON FUNCTION public.guard_studio_platform_fields() FROM PUBLIC, anon, authenticated;

-- Payout details are restricted to the studio owner. Server-side operations use
-- service_role and therefore continue to work.
DROP POLICY IF EXISTS "Owners manage payout settings" ON public.studio_payout_settings;
CREATE POLICY "Studio owners manage payout settings"
ON public.studio_payout_settings
FOR ALL TO authenticated
USING (
  public.has_role(auth.uid(), studio_id, 'studio_owner')
  AND public.has_active_premium_access(studio_id)
)
WITH CHECK (
  public.has_role(auth.uid(), studio_id, 'studio_owner')
  AND public.has_active_premium_access(studio_id)
);

-- Correct legacy membership argument order. The old policies denied legitimate
-- members and forced application code to rely on service_role.
DROP POLICY IF EXISTS "Members read client appointment action logs" ON public.client_appointment_action_logs;
CREATE POLICY "Members read client appointment action logs"
ON public.client_appointment_action_logs FOR SELECT TO authenticated
USING (public.is_studio_member(auth.uid(), studio_id));

DROP POLICY IF EXISTS "Studio members read customer rewards" ON public.customer_loyalty_rewards;
CREATE POLICY "Studio members read customer rewards"
ON public.customer_loyalty_rewards FOR SELECT TO authenticated
USING (public.is_studio_member(auth.uid(), studio_id));

DROP POLICY IF EXISTS "Studio members manage loyalty settings" ON public.customer_loyalty_settings;
CREATE POLICY "Studio members manage loyalty settings"
ON public.customer_loyalty_settings FOR ALL TO authenticated
USING (public.is_studio_member(auth.uid(), studio_id))
WITH CHECK (public.is_studio_member(auth.uid(), studio_id));

DROP POLICY IF EXISTS "Studio members read customer stamps" ON public.customer_loyalty_stamp_entries;
CREATE POLICY "Studio members read customer stamps"
ON public.customer_loyalty_stamp_entries FOR SELECT TO authenticated
USING (public.is_studio_member(auth.uid(), studio_id));

DROP POLICY IF EXISTS "Studio members read customer loyalty" ON public.customer_referral_codes;
CREATE POLICY "Studio members read customer loyalty"
ON public.customer_referral_codes FOR SELECT TO authenticated
USING (public.is_studio_member(auth.uid(), studio_id));

DROP POLICY IF EXISTS "Studio members read customer referrals" ON public.customer_referrals;
CREATE POLICY "Studio members read customer referrals"
ON public.customer_referrals FOR SELECT TO authenticated
USING (public.is_studio_member(auth.uid(), studio_id));

-- Internal SECURITY DEFINER routines must not be callable directly by clients.
REVOKE ALL ON FUNCTION public.consume_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(text, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.ensure_customer_loyalty_settings(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_customer_loyalty_settings(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.issue_customer_loyalty_rewards(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_customer_loyalty_rewards(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.process_customer_loyalty_for_completed_appointment(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_customer_loyalty_for_completed_appointment(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.get_or_create_customer_referral_code(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_customer_referral_code(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.get_or_create_referral_code(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_referral_code(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.confirm_paid_booking_request(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_paid_booking_request(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.expire_pending_appointments() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_pending_appointments() TO service_role;
REVOKE ALL ON FUNCTION public.track_upsell_views(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.track_upsell_views(uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.track_upsell_acceptances(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.track_upsell_acceptances(uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.submit_public_refund_request(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_public_refund_request(uuid, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.create_studio_with_owner(text, text, text, text, text, text, text, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_studio_with_owner(text, text, text, text, text, text, text, text, text, text)
  TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Previously exposed invitations must not remain usable with leaked token/code
-- pairs. Owners can resend the newly generated credentials from the same UI.
UPDATE public.staff
SET
  invite_token = encode(extensions.gen_random_bytes(32), 'hex'),
  invite_code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  invite_status = 'pending',
  updated_at = now()
WHERE user_id IS NULL
  AND invite_token IS NOT NULL
  AND invite_status NOT IN ('cancelled', 'expired', 'active');

-- At most one active checkout hold may cover a professional's time interval.
ALTER TABLE public.booking_payment_requests
  DROP CONSTRAINT IF EXISTS booking_payment_requests_no_active_overlap;
ALTER TABLE public.booking_payment_requests
  ADD CONSTRAINT booking_payment_requests_no_active_overlap
  EXCLUDE USING gist (
    staff_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  )
  WHERE (status IN ('awaiting_payment', 'processing'));

CREATE UNIQUE INDEX IF NOT EXISTS refund_requests_one_active_booking
  ON public.refund_requests (booking_request_id)
  WHERE booking_request_id IS NOT NULL AND status IN ('pending', 'in_review', 'processing');
CREATE UNIQUE INDEX IF NOT EXISTS refund_requests_one_active_appointment
  ON public.refund_requests (appointment_id)
  WHERE appointment_id IS NOT NULL AND status IN ('pending', 'in_review', 'processing');
CREATE UNIQUE INDEX IF NOT EXISTS refund_requests_one_active_payment
  ON public.refund_requests (payment_intent_id)
  WHERE payment_intent_id IS NOT NULL AND status IN ('pending', 'in_review', 'processing');

-- Atomic creation for both normal manual appointments and walk-in overrides.
CREATE OR REPLACE FUNCTION public.create_manual_appointment(
  p_studio_id uuid,
  p_staff_id uuid,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_client_id uuid DEFAULT NULL,
  p_client_name text DEFAULT NULL,
  p_client_phone text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_is_fit boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_service public.services%ROWTYPE;
  v_client_id uuid;
  v_ends_at timestamptz;
  v_appointment_id uuid;
  v_phone text;
BEGIN
  IF NOT public.can_use_studio(auth.uid(), p_studio_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT * INTO v_service
  FROM public.services
  WHERE id = p_service_id AND studio_id = p_studio_id AND is_active = true;
  IF v_service.id IS NULL THEN RAISE EXCEPTION 'service_not_found'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.staff
    WHERE id = p_staff_id
      AND studio_id = p_studio_id
      AND is_active = true
      AND COALESCE(current_status, 'online') <> 'absent'
  ) THEN
    RAISE EXCEPTION 'staff_unavailable';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.staff_services
    WHERE staff_id = p_staff_id AND service_id = p_service_id
  ) THEN
    RAISE EXCEPTION 'staff_service_unavailable';
  END IF;

  v_ends_at := p_starts_at + make_interval(mins => v_service.duration_min);
  IF p_is_fit THEN
    IF NOT public.is_staff_managerial_slot_bookable(
      p_studio_id, p_staff_id, p_starts_at, v_service.duration_min, NULL
    ) THEN
      RAISE EXCEPTION 'slot_unavailable';
    END IF;
  ELSIF NOT public.is_staff_slot_bookable(
    p_studio_id, p_staff_id, p_starts_at, v_service.duration_min
  ) THEN
    RAISE EXCEPTION 'slot_unavailable';
  END IF;

  IF p_client_id IS NOT NULL THEN
    SELECT id INTO v_client_id
    FROM public.clients
    WHERE id = p_client_id AND studio_id = p_studio_id;
    IF v_client_id IS NULL THEN RAISE EXCEPTION 'client_not_found'; END IF;
  ELSE
    v_phone := NULLIF(trim(COALESCE(p_client_phone, '')), '');
    IF NULLIF(trim(COALESCE(p_client_name, '')), '') IS NULL OR v_phone IS NULL THEN
      RAISE EXCEPTION 'client_details_required';
    END IF;
    INSERT INTO public.clients (studio_id, name, phone)
    VALUES (p_studio_id, trim(p_client_name), v_phone)
    ON CONFLICT (studio_id, phone) DO UPDATE
      SET name = EXCLUDED.name, updated_at = now()
    RETURNING id INTO v_client_id;
  END IF;

  INSERT INTO public.appointments (
    studio_id, client_id, staff_id, starts_at, ends_at, status,
    total_price, total_duration_min, notes, notification_suppressed, updated_at
  ) VALUES (
    p_studio_id, v_client_id, p_staff_id, p_starts_at, v_ends_at, 'confirmed',
    v_service.price, v_service.duration_min,
    NULLIF(trim(COALESCE(p_notes, '')), ''), COALESCE(p_is_fit, false), now()
  )
  RETURNING id INTO v_appointment_id;

  INSERT INTO public.appointment_services (
    appointment_id, service_id, is_upsell, price, duration_min
  ) VALUES (
    v_appointment_id, v_service.id, false, v_service.price, v_service.duration_min
  );

  RETURN jsonb_build_object(
    'appointment_id', v_appointment_id,
    'client_id', v_client_id,
    'starts_at', p_starts_at,
    'ends_at', v_ends_at
  );
EXCEPTION
  WHEN exclusion_violation THEN RAISE EXCEPTION 'slot_unavailable';
END
$function$;

REVOKE ALL ON FUNCTION public.create_manual_appointment(uuid, uuid, uuid, timestamptz, uuid, text, text, text, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_manual_appointment(uuid, uuid, uuid, timestamptz, uuid, text, text, text, boolean)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_manual_appointment_service(
  p_appointment_id uuid,
  p_studio_id uuid,
  p_staff_id uuid,
  p_service_id uuid,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_appt public.appointments%ROWTYPE;
  v_service public.services%ROWTYPE;
  v_ends_at timestamptz;
  v_line_count integer;
  v_is_fit boolean;
BEGIN
  IF NOT public.can_use_studio(auth.uid(), p_studio_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT * INTO v_appt
  FROM public.appointments
  WHERE id = p_appointment_id AND studio_id = p_studio_id
  FOR UPDATE;
  IF v_appt.id IS NULL THEN RAISE EXCEPTION 'appointment_not_found'; END IF;
  IF v_appt.status IN ('cancelled', 'no_show', 'completed') THEN
    RAISE EXCEPTION 'appointment_not_editable';
  END IF;

  SELECT * INTO v_service
  FROM public.services
  WHERE id = p_service_id AND studio_id = p_studio_id AND is_active = true;
  IF v_service.id IS NULL THEN RAISE EXCEPTION 'service_not_found'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.staff
    WHERE id = p_staff_id AND studio_id = p_studio_id AND is_active = true
  ) OR NOT EXISTS (
    SELECT 1 FROM public.staff_services
    WHERE staff_id = p_staff_id AND service_id = p_service_id
  ) THEN
    RAISE EXCEPTION 'staff_service_unavailable';
  END IF;

  SELECT count(*) INTO v_line_count
  FROM public.appointment_services
  WHERE appointment_id = p_appointment_id;
  IF v_line_count <> 1 THEN RAISE EXCEPTION 'multi_service_edit_not_supported'; END IF;

  v_ends_at := v_appt.starts_at + make_interval(mins => v_service.duration_min);
  v_is_fit := COALESCE(v_appt.notification_suppressed, false);
  IF v_is_fit THEN
    IF NOT public.is_staff_managerial_slot_bookable(
      p_studio_id, p_staff_id, v_appt.starts_at, v_service.duration_min, v_appt.id
    ) THEN RAISE EXCEPTION 'slot_unavailable'; END IF;
  ELSIF NOT public.is_staff_slot_bookable(
    p_studio_id, p_staff_id, v_appt.starts_at, v_service.duration_min, NULL, v_appt.id
  ) THEN
    RAISE EXCEPTION 'slot_unavailable';
  END IF;

  UPDATE public.appointments
  SET
    staff_id = p_staff_id,
    ends_at = v_ends_at,
    total_price = v_service.price,
    total_duration_min = v_service.duration_min,
    notes = NULLIF(trim(COALESCE(p_notes, '')), ''),
    updated_at = now()
  WHERE id = v_appt.id;

  UPDATE public.appointment_services
  SET
    service_id = v_service.id,
    price = v_service.price,
    duration_min = v_service.duration_min
  WHERE appointment_id = v_appt.id;

  RETURN jsonb_build_object(
    'appointment_id', v_appt.id,
    'ends_at', v_ends_at,
    'duration_min', v_service.duration_min,
    'price', v_service.price
  );
EXCEPTION
  WHEN exclusion_violation THEN RAISE EXCEPTION 'slot_unavailable';
END
$function$;

REVOKE ALL ON FUNCTION public.update_manual_appointment_service(uuid, uuid, uuid, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_manual_appointment_service(uuid, uuid, uuid, uuid, text)
  TO authenticated, service_role;

-- Correct signal + remaining-balance handling and serialize concurrent payment
-- confirmations. Pending online attempts block an alternative in-person charge.
CREATE OR REPLACE FUNCTION public.confirm_studio_appointment_payment(
  p_appointment_id uuid,
  p_payment_method text DEFAULT 'cash'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_appt public.appointments%ROWTYPE;
  v_session public.cash_register_sessions%ROWTYPE;
  v_movement public.cash_register_movements%ROWTYPE;
  v_method text;
  v_paid_online numeric(10,2);
  v_amount numeric(10,2);
BEGIN
  SELECT * INTO v_appt
  FROM public.appointments
  WHERE id = p_appointment_id
  FOR UPDATE;

  IF v_appt.id IS NULL THEN RAISE EXCEPTION 'appointment_not_found'; END IF;
  IF NOT public.is_studio_member(auth.uid(), v_appt.studio_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF v_appt.status IN ('cancelled', 'no_show') THEN
    RAISE EXCEPTION 'appointment_not_payable';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payment_intents
    WHERE appointment_id = v_appt.id
      AND status IN ('requires_action', 'processing')
  ) THEN
    RAISE EXCEPTION 'online_payment_in_progress';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.cash_register_movements
    WHERE appointment_id = v_appt.id AND movement_type = 'service_payment'
  ) THEN
    RAISE EXCEPTION 'appointment_payment_already_confirmed';
  END IF;

  SELECT COALESCE(sum(amount_cents), 0)::numeric / 100
  INTO v_paid_online
  FROM public.payment_intents
  WHERE appointment_id = v_appt.id AND status = 'succeeded';

  v_amount := GREATEST(0, COALESCE(v_appt.total_price, 0) - COALESCE(v_paid_online, 0));
  IF v_amount <= 0 THEN RAISE EXCEPTION 'appointment_already_paid_online'; END IF;

  v_method := COALESCE(NULLIF(trim(p_payment_method), ''), 'cash');
  IF v_method NOT IN ('cash', 'card', 'mb_way', 'other') THEN
    RAISE EXCEPTION 'invalid_payment_method';
  END IF;

  SELECT * INTO v_session
  FROM public.cash_register_sessions
  WHERE studio_id = v_appt.studio_id AND status = 'open'
  ORDER BY opened_at DESC
  LIMIT 1
  FOR UPDATE;
  IF v_session.id IS NULL THEN RAISE EXCEPTION 'cash_register_not_open'; END IF;

  UPDATE public.appointments
  SET status = 'completed', updated_at = now()
  WHERE id = v_appt.id;

  INSERT INTO public.cash_register_movements (
    session_id, studio_id, appointment_id, movement_type, payment_method,
    amount, description, occurred_at, created_by
  ) VALUES (
    v_session.id, v_appt.studio_id, v_appt.id, 'service_payment', v_method,
    v_amount, 'Pagamento presencial - saldo da marcação', now(), auth.uid()
  )
  RETURNING * INTO v_movement;

  RETURN jsonb_build_object(
    'appointment_id', v_appt.id,
    'cash_session_id', v_session.id,
    'movement_id', v_movement.id,
    'amount', v_amount,
    'paid_online', v_paid_online,
    'payment_method', v_method,
    'status', 'completed'
  );
END
$function$;

REVOKE ALL ON FUNCTION public.confirm_studio_appointment_payment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_studio_appointment_payment(uuid, text)
  TO authenticated, service_role;

-- Public asset hosting accepts only the formats used by the product and caps
-- each object to prevent unbounded storage/bandwidth abuse.
UPDATE storage.buckets
SET
  file_size_limit = 26214400,
  allowed_mime_types = ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'
  ]::text[]
WHERE id = 'studio-assets';

-- Balance calculation and request insertion are separate application steps.
-- Serialise that boundary at database level so two concurrent clicks cannot
-- reserve the same studio balance twice.
CREATE UNIQUE INDEX IF NOT EXISTS withdrawal_requests_one_active_per_studio_idx
  ON public.withdrawal_requests (studio_id)
  WHERE status IN ('pending', 'in_review', 'processing');

NOTIFY pgrst, 'reload schema';
