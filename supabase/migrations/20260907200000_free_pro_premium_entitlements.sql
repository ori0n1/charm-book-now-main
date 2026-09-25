-- Bellza plans v2: additive, tenant-scoped and non-destructive.
-- Billing cadence remains in subscriptions.plan for backwards compatibility;
-- product access is stored separately in plan_tier.

ALTER TABLE public.studios
  ADD COLUMN IF NOT EXISTS plan_tier text NOT NULL DEFAULT 'free';

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS plan_tier text;

ALTER TABLE public.studios
  DROP CONSTRAINT IF EXISTS studios_plan_tier_valid;
ALTER TABLE public.studios
  ADD CONSTRAINT studios_plan_tier_valid CHECK (plan_tier IN ('free', 'pro', 'premium'));

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_plan_tier_valid;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_plan_tier_valid
  CHECK (plan_tier IS NULL OR plan_tier IN ('pro', 'premium'));

-- Existing paid Bellza subscriptions historically included every feature, so
-- they are mapped to Premium. Expired studios fall back to Free without any
-- deletion or mutation of operational data.
UPDATE public.subscriptions
SET plan_tier = 'premium'
WHERE plan_tier IS NULL;

UPDATE public.studios s
SET plan_tier = CASE
  WHEN s.is_active = true
    AND s.subscription_status = 'trialing'
    AND s.trial_ends_at > now() THEN 'premium'
  WHEN s.is_active = true
    AND (
      s.subscription_current_period_end > now()
      OR s.premium_access_until > now()
      OR EXISTS (
        SELECT 1
        FROM public.subscriptions sub
        WHERE sub.studio_id = s.id
          AND sub.status IN ('active', 'trialing', 'canceled')
          AND sub.current_period_end > now()
      )
    ) THEN 'premium'
  ELSE 'free'
END;

CREATE TABLE IF NOT EXISTS public.studio_plan_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id uuid NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  previous_tier text CHECK (previous_tier IS NULL OR previous_tier IN ('free', 'pro', 'premium')),
  new_tier text NOT NULL CHECK (new_tier IN ('free', 'pro', 'premium')),
  previous_status text,
  new_status text,
  reason text NOT NULL DEFAULT 'subscription_sync',
  stripe_event_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_studio_plan_events_studio_created
  ON public.studio_plan_events(studio_id, created_at DESC);

ALTER TABLE public.studio_plan_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read own plan history" ON public.studio_plan_events;
CREATE POLICY "Members read own plan history" ON public.studio_plan_events
  FOR SELECT TO authenticated
  USING (public.is_studio_member(auth.uid(), studio_id) OR public.is_saas_owner());

DROP POLICY IF EXISTS "Service role manages plan history" ON public.studio_plan_events;
CREATE POLICY "Service role manages plan history" ON public.studio_plan_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.studio_effective_plan_tier(
  _studio_id uuid,
  _at timestamptz DEFAULT now()
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_studio public.studios%ROWTYPE;
  v_subscription_tier text;
BEGIN
  SELECT * INTO v_studio
  FROM public.studios
  WHERE id = _studio_id;

  IF NOT FOUND OR v_studio.is_active IS DISTINCT FROM true THEN
    RETURN 'free';
  END IF;

  -- The product trial is always the full Premium experience for 14 days.
  IF v_studio.trial_ends_at IS NOT NULL AND v_studio.trial_ends_at > _at THEN
    RETURN 'premium';
  END IF;

  SELECT coalesce(sub.plan_tier, 'premium')
  INTO v_subscription_tier
  FROM public.subscriptions sub
  WHERE sub.studio_id = _studio_id
    AND sub.status IN ('active', 'trialing', 'canceled')
    AND sub.current_period_end IS NOT NULL
    AND sub.current_period_end > _at
  ORDER BY sub.updated_at DESC
  LIMIT 1;

  IF v_subscription_tier IN ('pro', 'premium') THEN
    RETURN v_subscription_tier;
  END IF;

  IF v_studio.subscription_status IN ('active', 'trialing', 'canceled')
    AND (
      v_studio.subscription_current_period_end > _at
      OR v_studio.premium_access_until > _at
    ) THEN
    RETURN CASE
      WHEN v_studio.plan_tier IN ('pro', 'premium') THEN v_studio.plan_tier
      ELSE 'premium'
    END;
  END IF;

  RETURN 'free';
END
$$;

CREATE OR REPLACE FUNCTION public.studio_has_entitlement(
  _studio_id uuid,
  _feature text,
  _at timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH access AS (
    SELECT public.studio_effective_plan_tier(_studio_id, _at) AS tier
  )
  SELECT CASE
    WHEN _feature IN (
      'agenda', 'online_booking', 'services', 'manual_booking',
      'clients_basic', 'public_page'
    ) THEN true
    WHEN _feature IN (
      'clients_full', 'team_management', 'online_payments', 'notifications',
      'finance_basic', 'attendance', 'reviews', 'reports_basic'
    ) THEN access.tier IN ('pro', 'premium')
    WHEN _feature IN (
      'whatsapp', 'loyalty', 'promotions', 'finance_advanced',
      'team_advanced', 'future_integrations'
    ) THEN access.tier = 'premium'
    ELSE false
  END
  FROM access
  WHERE EXISTS (
    SELECT 1 FROM public.studios s
    WHERE s.id = _studio_id AND s.is_active = true
  )
$$;

CREATE OR REPLACE FUNCTION public.studio_plan_professional_limit(_studio_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE public.studio_effective_plan_tier(_studio_id)
    WHEN 'free' THEN 1
    WHEN 'pro' THEN 3
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION public.studio_staff_is_within_plan(
  _studio_id uuid,
  _staff_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH plan_limit AS (
    SELECT public.studio_plan_professional_limit(_studio_id) AS maximum
  ), allowed_staff AS (
    SELECT member.id
    FROM public.staff AS member
    WHERE member.studio_id = _studio_id
      AND (
        member.is_active IS DISTINCT FROM true
        OR (SELECT maximum FROM plan_limit) IS NULL
        OR member.id IN (
          SELECT active_member.id
          FROM public.staff AS active_member
          WHERE active_member.studio_id = _studio_id
            AND active_member.is_active = true
          ORDER BY active_member.sort_order ASC NULLS LAST, active_member.id ASC
          LIMIT coalesce((SELECT maximum FROM plan_limit), 2147483647)
        )
      )
  )
  SELECT EXISTS (SELECT 1 FROM allowed_staff WHERE id = _staff_id)
$$;

CREATE OR REPLACE FUNCTION public.studio_can_add_professional(_studio_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.studio_plan_professional_limit(_studio_id) IS NULL
    OR (
      SELECT count(*)
      FROM public.staff AS member
      WHERE member.studio_id = _studio_id AND member.is_active = true
    ) < public.studio_plan_professional_limit(_studio_id)
$$;

-- Compatibility functions now express base studio availability. Feature-level
-- authorization is enforced separately by studio_has_entitlement.
CREATE OR REPLACE FUNCTION public.can_use_studio(_user_id uuid, _studio_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles AS membership
    WHERE membership.user_id = _user_id
      AND membership.studio_id = _studio_id
      AND (
        membership.role IN ('studio_owner', 'saas_owner')
        OR (
          membership.role = 'manager'
          AND public.studio_has_entitlement(_studio_id, 'team_management')
        )
        OR (
          membership.role = 'staff'
          AND EXISTS (
            SELECT 1
            FROM public.staff AS professional
            WHERE professional.studio_id = _studio_id
              AND professional.user_id = _user_id
              AND professional.is_active = true
              AND public.studio_staff_is_within_plan(_studio_id, professional.id)
          )
        )
      )
  ) AND EXISTS (
    SELECT 1 FROM public.studios AS studio
    WHERE studio.id = _studio_id AND studio.is_active = true
  )
$$;

CREATE OR REPLACE FUNCTION public.has_active_premium_access(_studio_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Kept semantically compatible for stored policies and for a safe Worker
  -- rollback during a rolling deployment. New code must ask for a specific
  -- entitlement instead of treating this compatibility function as a base gate.
  SELECT public.studio_effective_plan_tier(_studio_id) = 'premium'
$$;

REVOKE ALL ON FUNCTION public.studio_effective_plan_tier(uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.studio_has_entitlement(uuid, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.studio_plan_professional_limit(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.studio_staff_is_within_plan(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.studio_can_add_professional(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_use_studio(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.studio_effective_plan_tier(uuid, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.studio_has_entitlement(uuid, text, timestamptz) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.studio_plan_professional_limit(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.studio_staff_is_within_plan(uuid, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.studio_can_add_professional(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_use_studio(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_studio_plan_protected_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'authenticated' OR public.is_saas_owner() THEN
    RETURN NEW;
  END IF;

  IF NEW.plan_tier IS DISTINCT FROM OLD.plan_tier
    OR NEW.plan IS DISTINCT FROM OLD.plan
    OR NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id
    OR NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id
    OR NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
    OR NEW.subscription_current_period_end IS DISTINCT FROM OLD.subscription_current_period_end
    OR NEW.subscription_cancel_at_period_end IS DISTINCT FROM OLD.subscription_cancel_at_period_end
    OR NEW.premium_access_until IS DISTINCT FROM OLD.premium_access_until
    OR NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at
    OR NEW.trial_used_at IS DISTINCT FROM OLD.trial_used_at THEN
    RAISE EXCEPTION 'billing_fields_are_server_managed' USING ERRCODE = '42501';
  END IF;

  IF (
    NEW.payment_policy IS DISTINCT FROM OLD.payment_policy
    OR NEW.accepted_payment_methods IS DISTINCT FROM OLD.accepted_payment_methods
    OR NEW.deposit_percent IS DISTINCT FROM OLD.deposit_percent
    OR NEW.deposit_recipient IS DISTINCT FROM OLD.deposit_recipient
    OR NEW.deposit_professional_percent IS DISTINCT FROM OLD.deposit_professional_percent
  ) AND NOT public.studio_has_entitlement(NEW.id, 'online_payments') THEN
    RAISE EXCEPTION 'plan_feature_required:online_payments' USING ERRCODE = '42501';
  END IF;

  IF NEW.commission_percent IS DISTINCT FROM OLD.commission_percent
    AND NOT public.studio_has_entitlement(NEW.id, 'finance_basic') THEN
    RAISE EXCEPTION 'plan_feature_required:finance_basic' USING ERRCODE = '42501';
  END IF;

  IF (
    NEW.whatsapp_auto_send_enabled IS DISTINCT FROM OLD.whatsapp_auto_send_enabled
    OR NEW.whatsapp_default_message IS DISTINCT FROM OLD.whatsapp_default_message
    OR (NEW.booking_flow_mode IS DISTINCT FROM OLD.booking_flow_mode AND NEW.booking_flow_mode = 'request')
  ) AND NOT public.studio_has_entitlement(NEW.id, 'whatsapp') THEN
    RAISE EXCEPTION 'plan_feature_required:whatsapp' USING ERRCODE = '42501';
  END IF;

  IF NEW.staff_agenda_visibility IS DISTINCT FROM OLD.staff_agenda_visibility
    AND NOT public.studio_has_entitlement(NEW.id, 'team_management') THEN
    RAISE EXCEPTION 'plan_feature_required:team_management' USING ERRCODE = '42501';
  END IF;

  IF NEW.appointment_reminder_minutes IS DISTINCT FROM OLD.appointment_reminder_minutes
    AND NOT public.studio_has_entitlement(NEW.id, 'notifications') THEN
    RAISE EXCEPTION 'plan_feature_required:notifications' USING ERRCODE = '42501';
  END IF;

  IF NEW.attendance_grace_minutes IS DISTINCT FROM OLD.attendance_grace_minutes
    AND NOT public.studio_has_entitlement(NEW.id, 'attendance') THEN
    RAISE EXCEPTION 'plan_feature_required:attendance' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_enforce_studio_plan_protected_columns ON public.studios;
CREATE TRIGGER trg_enforce_studio_plan_protected_columns
  BEFORE UPDATE ON public.studios
  FOR EACH ROW EXECUTE FUNCTION public.enforce_studio_plan_protected_columns();

CREATE OR REPLACE FUNCTION public.enforce_plan_professional_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer;
  v_active_count integer;
BEGIN
  IF NEW.is_active IS DISTINCT FROM true THEN
    RETURN NEW;
  END IF;

  v_limit := public.studio_plan_professional_limit(NEW.studio_id);
  IF v_limit IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*)::integer INTO v_active_count
  FROM public.staff s
  WHERE s.studio_id = NEW.studio_id
    AND s.is_active = true
    AND s.id IS DISTINCT FROM NEW.id;

  IF v_active_count >= v_limit THEN
    RAISE EXCEPTION 'plan_professional_limit_reached:%', v_limit USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_enforce_plan_professional_limit ON public.staff;
CREATE TRIGGER trg_enforce_plan_professional_limit
  BEFORE INSERT OR UPDATE OF studio_id, is_active ON public.staff
  FOR EACH ROW EXECUTE FUNCTION public.enforce_plan_professional_limit();

CREATE OR REPLACE FUNCTION public.enforce_staff_plan_protected_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_finance_changed boolean;
  v_team_changed boolean;
BEGIN
  IF auth.role() <> 'authenticated' OR public.is_saas_owner() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_finance_changed := NEW.commission_percent IS NOT NULL
      OR NEW.deposit_recipient IS NOT NULL
      OR NEW.deposit_professional_percent IS NOT NULL;
    v_team_changed := NEW.user_id IS NOT NULL
      OR NEW.invite_token IS NOT NULL
      OR NEW.invite_role IS NOT NULL
      OR NEW.invite_code IS NOT NULL;
  ELSE
    v_finance_changed := NEW.commission_percent IS DISTINCT FROM OLD.commission_percent
      OR NEW.deposit_recipient IS DISTINCT FROM OLD.deposit_recipient
      OR NEW.deposit_professional_percent IS DISTINCT FROM OLD.deposit_professional_percent;
    v_team_changed := NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.invite_token IS DISTINCT FROM OLD.invite_token
      OR NEW.invite_role IS DISTINCT FROM OLD.invite_role
      OR NEW.invite_status IS DISTINCT FROM OLD.invite_status
      OR NEW.invite_expires_at IS DISTINCT FROM OLD.invite_expires_at
      OR NEW.invite_code IS DISTINCT FROM OLD.invite_code;
  END IF;

  IF v_finance_changed AND NOT public.studio_has_entitlement(NEW.studio_id, 'finance_basic') THEN
    RAISE EXCEPTION 'plan_feature_required:finance_basic' USING ERRCODE = '42501';
  END IF;
  IF v_team_changed AND NOT public.studio_has_entitlement(NEW.studio_id, 'team_management') THEN
    RAISE EXCEPTION 'plan_feature_required:team_management' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_enforce_staff_plan_protected_columns ON public.staff;
CREATE TRIGGER trg_enforce_staff_plan_protected_columns
  BEFORE INSERT OR UPDATE ON public.staff
  FOR EACH ROW EXECUTE FUNCTION public.enforce_staff_plan_protected_columns();

CREATE OR REPLACE FUNCTION public.enforce_service_plan_protected_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed boolean;
BEGIN
  IF auth.role() <> 'authenticated' OR public.is_saas_owner() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    v_changed := NEW.commission_percent IS NOT NULL
      OR NEW.deposit_recipient IS NOT NULL
      OR NEW.deposit_professional_percent IS NOT NULL;
  ELSE
    v_changed := NEW.commission_percent IS DISTINCT FROM OLD.commission_percent
      OR NEW.deposit_recipient IS DISTINCT FROM OLD.deposit_recipient
      OR NEW.deposit_professional_percent IS DISTINCT FROM OLD.deposit_professional_percent;
  END IF;
  IF v_changed AND NOT public.studio_has_entitlement(NEW.studio_id, 'finance_basic') THEN
    RAISE EXCEPTION 'plan_feature_required:finance_basic' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_enforce_service_plan_protected_columns ON public.services;
CREATE TRIGGER trg_enforce_service_plan_protected_columns
  BEFORE INSERT OR UPDATE ON public.services
  FOR EACH ROW EXECUTE FUNCTION public.enforce_service_plan_protected_columns();

CREATE OR REPLACE FUNCTION public.enforce_client_plan_protected_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed boolean;
BEGIN
  IF auth.role() <> 'authenticated' OR public.is_saas_owner() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    v_changed := coalesce(NEW.booking_status, 'active') <> 'active'
      OR NEW.suspended_until IS NOT NULL
      OR NEW.block_reason IS NOT NULL
      OR NEW.date_of_birth IS NOT NULL;
  ELSE
    v_changed := NEW.booking_status IS DISTINCT FROM OLD.booking_status
      OR NEW.suspended_until IS DISTINCT FROM OLD.suspended_until
      OR NEW.block_reason IS DISTINCT FROM OLD.block_reason
      OR NEW.date_of_birth IS DISTINCT FROM OLD.date_of_birth;
  END IF;
  IF v_changed AND NOT public.studio_has_entitlement(NEW.studio_id, 'clients_full') THEN
    RAISE EXCEPTION 'plan_feature_required:clients_full' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_enforce_client_plan_protected_columns ON public.clients;
CREATE TRIGGER trg_enforce_client_plan_protected_columns
  BEFORE INSERT OR UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.enforce_client_plan_protected_columns();

DROP POLICY IF EXISTS "Plan permits visible professionals" ON public.staff;
CREATE POLICY "Plan permits visible professionals" ON public.staff AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.studio_staff_is_within_plan(studio_id, id) OR public.is_saas_owner())
  WITH CHECK (
    public.studio_staff_is_within_plan(studio_id, id)
    OR is_active IS DISTINCT FROM true
    OR public.studio_can_add_professional(studio_id)
    OR public.is_saas_owner()
  );

DROP POLICY IF EXISTS "Plan permits visible professional services" ON public.staff_services;
CREATE POLICY "Plan permits visible professional services" ON public.staff_services AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.staff AS member
      WHERE member.id = staff_id
        AND (public.studio_staff_is_within_plan(member.studio_id, member.id) OR public.is_saas_owner())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.staff AS member
      WHERE member.id = staff_id
        AND (public.studio_staff_is_within_plan(member.studio_id, member.id) OR public.is_saas_owner())
    )
  );

DROP POLICY IF EXISTS "Plan permits visible professional availability" ON public.staff_availability;
CREATE POLICY "Plan permits visible professional availability" ON public.staff_availability AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.studio_staff_is_within_plan(studio_id, staff_id) OR public.is_saas_owner())
  WITH CHECK (public.studio_staff_is_within_plan(studio_id, staff_id) OR public.is_saas_owner());

DROP POLICY IF EXISTS "Plan permits visible professional time off" ON public.staff_time_off;
CREATE POLICY "Plan permits visible professional time off" ON public.staff_time_off AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.studio_staff_is_within_plan(studio_id, staff_id) OR public.is_saas_owner())
  WITH CHECK (public.studio_staff_is_within_plan(studio_id, staff_id) OR public.is_saas_owner());

CREATE OR REPLACE FUNCTION public.record_studio_plan_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.plan_tier IS NOT DISTINCT FROM OLD.plan_tier
    AND NEW.subscription_status IS NOT DISTINCT FROM OLD.subscription_status
    AND NEW.subscription_current_period_end IS NOT DISTINCT FROM OLD.subscription_current_period_end
    AND NEW.subscription_cancel_at_period_end IS NOT DISTINCT FROM OLD.subscription_cancel_at_period_end
    AND NEW.trial_ends_at IS NOT DISTINCT FROM OLD.trial_ends_at THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.studio_plan_events (
    studio_id, previous_tier, new_tier, previous_status, new_status, reason, metadata
  ) VALUES (
    NEW.id,
    OLD.plan_tier,
    NEW.plan_tier,
    OLD.subscription_status,
    NEW.subscription_status,
    CASE
      WHEN OLD.trial_ends_at IS DISTINCT FROM NEW.trial_ends_at THEN 'trial_changed'
      WHEN OLD.subscription_cancel_at_period_end IS DISTINCT FROM NEW.subscription_cancel_at_period_end THEN 'cancellation_changed'
      ELSE 'subscription_sync'
    END,
    jsonb_build_object(
      'previous_period_end', OLD.subscription_current_period_end,
      'new_period_end', NEW.subscription_current_period_end,
      'cancel_at_period_end', NEW.subscription_cancel_at_period_end
    )
  );
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_record_studio_plan_event ON public.studios;
CREATE TRIGGER trg_record_studio_plan_event
  AFTER UPDATE OF plan_tier, subscription_status, subscription_current_period_end,
    subscription_cancel_at_period_end, trial_ends_at ON public.studios
  FOR EACH ROW EXECUTE FUNCTION public.record_studio_plan_event();

INSERT INTO public.studio_plan_events (
  studio_id, previous_tier, new_tier, previous_status, new_status, reason
)
SELECT s.id, NULL, s.plan_tier, NULL, s.subscription_status, 'plans_v2_migration'
FROM public.studios AS s
WHERE NOT EXISTS (
  SELECT 1 FROM public.studio_plan_events AS event
  WHERE event.studio_id = s.id
);

DROP POLICY IF EXISTS "Studio owners manage roles" ON public.user_roles;
CREATE POLICY "Studio owners manage roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (
    studio_id IS NOT NULL
    AND (
      public.is_saas_owner()
      OR (
        public.has_role(auth.uid(), studio_id, 'studio_owner')
        AND public.studio_has_entitlement(studio_id, 'team_management')
      )
    )
  )
  WITH CHECK (
    studio_id IS NOT NULL
    AND (
      public.is_saas_owner()
      OR (
        public.has_role(auth.uid(), studio_id, 'studio_owner')
        AND public.studio_has_entitlement(studio_id, 'team_management')
      )
    )
  );

-- Restrictive policies are AND-ed with the existing tenant policies. They do
-- not broaden access and service_role remains available to validated backend jobs.
DROP POLICY IF EXISTS "Plan permits payment intent reads" ON public.payment_intents;
CREATE POLICY "Plan permits payment intent reads" ON public.payment_intents AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.studio_has_entitlement(studio_id, 'finance_basic') OR public.is_saas_owner())
  WITH CHECK (public.studio_has_entitlement(studio_id, 'finance_basic') OR public.is_saas_owner());

DROP POLICY IF EXISTS "Plan permits booking payment reads" ON public.booking_payment_requests;
CREATE POLICY "Plan permits booking payment reads" ON public.booking_payment_requests AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.studio_has_entitlement(studio_id, 'online_payments') OR public.is_saas_owner())
  WITH CHECK (public.studio_has_entitlement(studio_id, 'online_payments') OR public.is_saas_owner());

DROP POLICY IF EXISTS "Plan permits cash register access" ON public.cash_register_movements;
CREATE POLICY "Plan permits cash register access" ON public.cash_register_movements AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.studio_has_entitlement(studio_id, 'finance_basic') OR public.is_saas_owner())
  WITH CHECK (public.studio_has_entitlement(studio_id, 'finance_basic') OR public.is_saas_owner());

DROP POLICY IF EXISTS "Plan permits cash session access" ON public.cash_register_sessions;
CREATE POLICY "Plan permits cash session access" ON public.cash_register_sessions AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.studio_has_entitlement(studio_id, 'finance_basic') OR public.is_saas_owner())
  WITH CHECK (public.studio_has_entitlement(studio_id, 'finance_basic') OR public.is_saas_owner());

DROP POLICY IF EXISTS "Plan permits manual financial entries" ON public.manual_service_entries;
CREATE POLICY "Plan permits manual financial entries" ON public.manual_service_entries AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.studio_has_entitlement(studio_id, 'finance_basic') OR public.is_saas_owner())
  WITH CHECK (public.studio_has_entitlement(studio_id, 'finance_basic') OR public.is_saas_owner());

DROP POLICY IF EXISTS "Plan permits refund access" ON public.refund_requests;
CREATE POLICY "Plan permits refund access" ON public.refund_requests AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.studio_has_entitlement(studio_id, 'online_payments') OR public.is_saas_owner())
  WITH CHECK (public.studio_has_entitlement(studio_id, 'online_payments') OR public.is_saas_owner());

DROP POLICY IF EXISTS "Plan permits payout settings access" ON public.studio_payout_settings;
CREATE POLICY "Plan permits payout settings access" ON public.studio_payout_settings AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.studio_has_entitlement(studio_id, 'finance_advanced') OR public.is_saas_owner())
  WITH CHECK (public.studio_has_entitlement(studio_id, 'finance_advanced') OR public.is_saas_owner());

DROP POLICY IF EXISTS "Plan permits withdrawal access" ON public.withdrawal_requests;
CREATE POLICY "Plan permits withdrawal access" ON public.withdrawal_requests AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.studio_has_entitlement(studio_id, 'finance_advanced') OR public.is_saas_owner())
  WITH CHECK (public.studio_has_entitlement(studio_id, 'finance_advanced') OR public.is_saas_owner());

DROP POLICY IF EXISTS "Plan permits studio notifications" ON public.studio_notifications;
CREATE POLICY "Plan permits studio notifications" ON public.studio_notifications AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.studio_has_entitlement(studio_id, 'notifications') OR public.is_saas_owner())
  WITH CHECK (public.studio_has_entitlement(studio_id, 'notifications') OR public.is_saas_owner());

DROP POLICY IF EXISTS "Plan permits notification history" ON public.notifications_log;
CREATE POLICY "Plan permits notification history" ON public.notifications_log AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.studio_has_entitlement(studio_id, 'notifications') OR public.is_saas_owner())
  WITH CHECK (public.studio_has_entitlement(studio_id, 'notifications') OR public.is_saas_owner());

DROP POLICY IF EXISTS "Plan permits email notification history" ON public.email_message_logs;
CREATE POLICY "Plan permits email notification history" ON public.email_message_logs AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (public.studio_has_entitlement(studio_id, 'notifications') OR public.is_saas_owner());

DROP POLICY IF EXISTS "Plan permits notification deliveries" ON public.studio_notification_deliveries;
CREATE POLICY "Plan permits notification deliveries" ON public.studio_notification_deliveries AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (public.studio_has_entitlement(studio_id, 'notifications') OR public.is_saas_owner());

DROP POLICY IF EXISTS "Plan permits push subscription reads" ON public.push_subscriptions;
CREATE POLICY "Plan permits push subscription reads" ON public.push_subscriptions AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (public.studio_has_entitlement(studio_id, 'notifications') OR public.is_saas_owner());

CREATE OR REPLACE FUNCTION public.enforce_notification_plan_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.studio_has_entitlement(NEW.studio_id, 'notifications') THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_enforce_studio_notification_plan ON public.studio_notifications;
CREATE TRIGGER trg_enforce_studio_notification_plan
  BEFORE INSERT ON public.studio_notifications
  FOR EACH ROW EXECUTE FUNCTION public.enforce_notification_plan_on_insert();

DROP TRIGGER IF EXISTS trg_enforce_notification_log_plan ON public.notifications_log;
CREATE TRIGGER trg_enforce_notification_log_plan
  BEFORE INSERT ON public.notifications_log
  FOR EACH ROW EXECUTE FUNCTION public.enforce_notification_plan_on_insert();

DROP TRIGGER IF EXISTS trg_enforce_email_notification_plan ON public.email_message_logs;
CREATE TRIGGER trg_enforce_email_notification_plan
  BEFORE INSERT ON public.email_message_logs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_notification_plan_on_insert();

DROP POLICY IF EXISTS "Plan permits WhatsApp history" ON public.whatsapp_message_logs;
CREATE POLICY "Plan permits WhatsApp history" ON public.whatsapp_message_logs AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.studio_has_entitlement(studio_id, 'whatsapp') OR public.is_saas_owner())
  WITH CHECK (public.studio_has_entitlement(studio_id, 'whatsapp') OR public.is_saas_owner());

DROP POLICY IF EXISTS "Plan permits loyalty settings" ON public.customer_loyalty_settings;
CREATE POLICY "Plan permits loyalty settings" ON public.customer_loyalty_settings AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.studio_has_entitlement(studio_id, 'loyalty') OR public.is_saas_owner())
  WITH CHECK (public.studio_has_entitlement(studio_id, 'loyalty') OR public.is_saas_owner());

DROP POLICY IF EXISTS "Plan permits customer referral codes" ON public.customer_referral_codes;
CREATE POLICY "Plan permits customer referral codes" ON public.customer_referral_codes AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.studio_has_entitlement(studio_id, 'loyalty') OR public.is_saas_owner())
  WITH CHECK (public.studio_has_entitlement(studio_id, 'loyalty') OR public.is_saas_owner());

DROP POLICY IF EXISTS "Plan permits customer referrals" ON public.customer_referrals;
CREATE POLICY "Plan permits customer referrals" ON public.customer_referrals AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.studio_has_entitlement(studio_id, 'loyalty') OR public.is_saas_owner())
  WITH CHECK (public.studio_has_entitlement(studio_id, 'loyalty') OR public.is_saas_owner());

DROP POLICY IF EXISTS "Plan permits loyalty stamps" ON public.customer_loyalty_stamp_entries;
CREATE POLICY "Plan permits loyalty stamps" ON public.customer_loyalty_stamp_entries AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.studio_has_entitlement(studio_id, 'loyalty') OR public.is_saas_owner())
  WITH CHECK (public.studio_has_entitlement(studio_id, 'loyalty') OR public.is_saas_owner());

DROP POLICY IF EXISTS "Plan permits loyalty rewards" ON public.customer_loyalty_rewards;
CREATE POLICY "Plan permits loyalty rewards" ON public.customer_loyalty_rewards AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.studio_has_entitlement(studio_id, 'loyalty') OR public.is_saas_owner())
  WITH CHECK (public.studio_has_entitlement(studio_id, 'loyalty') OR public.is_saas_owner());

DROP POLICY IF EXISTS "Plan permits reviews" ON public.studio_reviews;
CREATE POLICY "Plan permits reviews" ON public.studio_reviews AS RESTRICTIVE
  FOR ALL TO anon, authenticated
  USING (public.studio_has_entitlement(studio_id, 'reviews') OR public.is_saas_owner())
  WITH CHECK (public.studio_has_entitlement(studio_id, 'reviews') OR public.is_saas_owner());

DROP POLICY IF EXISTS "Plan permits promotions" ON public.upsell_offers;
CREATE POLICY "Plan permits promotions" ON public.upsell_offers AS RESTRICTIVE
  FOR ALL TO anon, authenticated
  USING (public.studio_has_entitlement(studio_id, 'promotions') OR public.is_saas_owner())
  WITH CHECK (public.studio_has_entitlement(studio_id, 'promotions') OR public.is_saas_owner());

DROP POLICY IF EXISTS "Plan permits WhatsApp entitlement reads" ON public.whatsapp_studio_entitlements;
CREATE POLICY "Plan permits WhatsApp entitlement reads" ON public.whatsapp_studio_entitlements AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (public.studio_has_entitlement(studio_id, 'whatsapp') OR public.is_saas_owner());

DROP POLICY IF EXISTS "Plan permits WhatsApp usage reads" ON public.whatsapp_usage_ledger;
CREATE POLICY "Plan permits WhatsApp usage reads" ON public.whatsapp_usage_ledger AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (public.studio_has_entitlement(studio_id, 'whatsapp') OR public.is_saas_owner());

DROP POLICY IF EXISTS "Plan permits WhatsApp alert reads" ON public.whatsapp_usage_alerts;
CREATE POLICY "Plan permits WhatsApp alert reads" ON public.whatsapp_usage_alerts AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (public.studio_has_entitlement(studio_id, 'whatsapp') OR public.is_saas_owner());

ALTER TABLE public.whatsapp_platform_settings
  ADD COLUMN IF NOT EXISTS premium_message_limit integer NOT NULL DEFAULT 500
    CHECK (premium_message_limit >= 0);

ALTER TABLE public.whatsapp_studio_entitlements
  ADD COLUMN IF NOT EXISTS monthly_message_limit_override integer
    CHECK (monthly_message_limit_override IS NULL OR monthly_message_limit_override >= 0),
  ADD COLUMN IF NOT EXISTS allow_paid_overage boolean NOT NULL DEFAULT false;

UPDATE public.whatsapp_platform_settings
SET commercial_included_messages = coalesce(commercial_included_messages, premium_message_limit)
WHERE id = 1;

CREATE OR REPLACE FUNCTION public.reserve_whatsapp_usage(
  p_studio_id uuid,
  p_idempotency_key text,
  p_message_kind text DEFAULT 'confirmation'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings public.whatsapp_platform_settings%ROWTYPE;
  v_entitlement public.whatsapp_studio_entitlements%ROWTYPE;
  v_existing public.whatsapp_usage_ledger%ROWTYPE;
  v_limit integer;
  v_reserved integer := 0;
  v_scope text;
  v_kind text := 'active';
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_trial_active boolean := false;
BEGIN
  IF p_studio_id IS NULL OR nullif(trim(p_idempotency_key), '') IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'invalid_usage_request');
  END IF;

  IF NOT public.studio_has_entitlement(p_studio_id, 'whatsapp') THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'plan_feature_required:whatsapp');
  END IF;

  SELECT * INTO v_settings FROM public.whatsapp_platform_settings WHERE id = 1;
  IF NOT FOUND OR NOT v_settings.global_enabled THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'whatsapp_globally_disabled');
  END IF;

  SELECT * INTO v_existing
  FROM public.whatsapp_usage_ledger
  WHERE idempotency_key = p_idempotency_key;
  IF FOUND AND v_existing.state <> 'released' THEN
    RETURN jsonb_build_object(
      'allowed', true,
      'reason', 'already_reserved',
      'ledgerId', v_existing.id,
      'entitlement', v_existing.entitlement_kind
    );
  END IF;

  INSERT INTO public.whatsapp_studio_entitlements (studio_id, status)
  VALUES (p_studio_id, 'active')
  ON CONFLICT (studio_id) DO NOTHING;

  SELECT * INTO v_entitlement
  FROM public.whatsapp_studio_entitlements
  WHERE studio_id = p_studio_id
  FOR UPDATE;

  IF v_entitlement.status = 'paused' THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', coalesce(v_entitlement.paused_reason, 'whatsapp_paused')
    );
  END IF;

  SELECT s.subscription_status = 'trialing' AND s.trial_ends_at > now()
  INTO v_trial_active
  FROM public.studios s
  WHERE s.id = p_studio_id;

  IF v_trial_active THEN
    IF NOT v_settings.trial_enabled THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'whatsapp_trial_disabled');
    END IF;
    v_kind := 'trial';
    v_limit := coalesce(v_entitlement.trial_message_limit_override, v_settings.trial_message_limit);
    SELECT coalesce(s.trial_claimed_at, s.created_at), s.trial_ends_at
    INTO v_period_start, v_period_end
    FROM public.studios s WHERE s.id = p_studio_id;
    v_scope := 'trial:' || to_char(v_period_start AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS');
  ELSE
    v_kind := 'active';
    v_limit := coalesce(
      v_entitlement.monthly_message_limit_override,
      v_settings.commercial_included_messages,
      v_settings.premium_message_limit
    );
    v_period_start := date_trunc('month', now());
    v_period_end := v_period_start + interval '1 month';
    v_scope := 'premium:' || to_char(v_period_start AT TIME ZONE 'UTC', 'YYYYMM');
  END IF;

  SELECT count(*)::integer INTO v_reserved
  FROM public.whatsapp_usage_ledger
  WHERE studio_id = p_studio_id
    AND state IN ('reserved', 'submitted', 'counted')
    AND created_at >= v_period_start
    AND created_at < v_period_end;

  IF v_reserved >= v_limit AND NOT v_entitlement.allow_paid_overage THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', CASE WHEN v_trial_active THEN 'whatsapp_trial_limit_reached' ELSE 'whatsapp_monthly_limit_reached' END,
      'used', v_reserved,
      'limit', v_limit
    );
  END IF;

  IF v_existing.id IS NOT NULL THEN
    UPDATE public.whatsapp_usage_ledger
    SET state = 'reserved', entitlement_kind = v_kind,
        message_kind = coalesce(nullif(p_message_kind, ''), message_kind),
        unit_cost_cents = v_settings.provider_cost_per_message_cents,
        commercial_unit_cents = CASE
          WHEN v_reserved >= v_limit THEN v_settings.commercial_excess_message_cents
          ELSE 0
        END,
        reserved_at = now(), submitted_at = NULL, counted_at = NULL,
        released_at = NULL, provider_message_id = NULL, provider_status = NULL,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'usage_scope', v_scope,
          'included_limit', v_limit,
          'is_overage', v_reserved >= v_limit
        ),
        updated_at = now()
    WHERE id = v_existing.id
    RETURNING * INTO v_existing;
  ELSE
    INSERT INTO public.whatsapp_usage_ledger (
      studio_id, idempotency_key, entitlement_kind, message_kind,
      unit_cost_cents, commercial_unit_cents, metadata
    ) VALUES (
      p_studio_id, p_idempotency_key, v_kind,
      coalesce(nullif(p_message_kind, ''), 'confirmation'),
      v_settings.provider_cost_per_message_cents,
      CASE WHEN v_reserved >= v_limit THEN v_settings.commercial_excess_message_cents ELSE 0 END,
      jsonb_build_object(
        'usage_scope', v_scope,
        'included_limit', v_limit,
        'is_overage', v_reserved >= v_limit
      )
    )
    RETURNING * INTO v_existing;
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'reason', 'reserved',
    'ledgerId', v_existing.id,
    'entitlement', v_existing.entitlement_kind,
    'used', v_reserved + 1,
    'limit', v_limit,
    'overage', v_reserved >= v_limit
  );
EXCEPTION WHEN unique_violation THEN
  SELECT * INTO v_existing
  FROM public.whatsapp_usage_ledger
  WHERE idempotency_key = p_idempotency_key;
  RETURN jsonb_build_object(
    'allowed', v_existing.state <> 'released',
    'reason', 'already_reserved',
    'ledgerId', v_existing.id
  );
END
$$;

REVOKE ALL ON FUNCTION public.reserve_whatsapp_usage(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_whatsapp_usage(uuid, text, text) TO service_role;

COMMENT ON COLUMN public.studios.plan_tier IS
  'Commercial tier selected by trusted billing flows. Effective access may be Premium during the 14-day trial and Free after expiry.';
COMMENT ON COLUMN public.subscriptions.plan IS
  'Billing interval (monthly, quarterly legacy, yearly). Product tier is stored in subscriptions.plan_tier.';
COMMENT ON COLUMN public.subscriptions.plan_tier IS
  'Server-validated Bellza product tier associated with the Stripe price.';
COMMENT ON FUNCTION public.studio_has_entitlement(uuid, text, timestamptz) IS
  'Authoritative tenant-scoped feature authorization for Free, Pro and Premium.';

NOTIFY pgrst, 'reload schema';
