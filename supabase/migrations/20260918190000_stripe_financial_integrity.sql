-- Additive Stripe/Connect financial integrity hardening. No existing payment,
-- subscription, Customer or connected-account identifier is rewritten.

CREATE UNIQUE INDEX IF NOT EXISTS studios_unique_stripe_connect_account
  ON public.studios(stripe_connect_account_id)
  WHERE stripe_connect_account_id IS NOT NULL;

ALTER TABLE public.studios
  ADD COLUMN IF NOT EXISTS stripe_connect_fees_payer text,
  ADD COLUMN IF NOT EXISTS stripe_connect_losses_collector text,
  ADD COLUMN IF NOT EXISTS stripe_connect_dashboard_type text,
  ADD COLUMN IF NOT EXISTS stripe_connect_negative_balance_cents integer,
  ADD COLUMN IF NOT EXISTS stripe_connect_responsibility_checked_at timestamptz;

ALTER TABLE public.payment_intents
  ADD COLUMN IF NOT EXISTS refund_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS refunded_amount_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stripe_dispute_id text,
  ADD COLUMN IF NOT EXISTS dispute_status text,
  ADD COLUMN IF NOT EXISTS disputed_amount_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stripe_financial_state_updated_at timestamptz;

ALTER TABLE public.payment_intents
  DROP CONSTRAINT IF EXISTS payment_intents_refunded_amount_valid,
  ADD CONSTRAINT payment_intents_refunded_amount_valid
    CHECK (refunded_amount_cents >= 0 AND refunded_amount_cents <= amount_cents),
  DROP CONSTRAINT IF EXISTS payment_intents_disputed_amount_valid,
  ADD CONSTRAINT payment_intents_disputed_amount_valid
    CHECK (disputed_amount_cents >= 0 AND disputed_amount_cents <= amount_cents);

CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_unique_stripe_charge
  ON public.payment_intents(stripe_charge_id)
  WHERE stripe_charge_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payment_intents_stripe_dispute_idx
  ON public.payment_intents(stripe_dispute_id)
  WHERE stripe_dispute_id IS NOT NULL;

ALTER TABLE public.refund_requests
  ADD COLUMN IF NOT EXISTS amount_cents integer,
  ADD COLUMN IF NOT EXISTS stripe_refund_status text,
  ADD COLUMN IF NOT EXISTS stripe_last_synced_at timestamptz;

ALTER TABLE public.refund_requests
  DROP CONSTRAINT IF EXISTS refund_requests_amount_positive,
  ADD CONSTRAINT refund_requests_amount_positive
    CHECK (amount_cents IS NULL OR amount_cents > 0);

-- Financial state is server-managed. Studio members can read their requests,
-- but all mutations go through authenticated server functions using service_role.
DROP POLICY IF EXISTS "Members manage refund requests" ON public.refund_requests;
DROP POLICY IF EXISTS "Plan permits refund access" ON public.refund_requests;
CREATE POLICY "Plan permits refund access"
  ON public.refund_requests AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.studio_has_entitlement(studio_id, 'online_payments') OR public.is_saas_owner());
CREATE POLICY "Members read refund requests"
  ON public.refund_requests FOR SELECT TO authenticated
  USING (public.can_use_studio(auth.uid(), studio_id));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.refund_requests FROM anon, authenticated;
REVOKE ALL ON public.refund_requests FROM PUBLIC, anon;
GRANT SELECT ON public.refund_requests TO authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.payment_intents FROM anon, authenticated;
REVOKE ALL ON public.payment_intents FROM PUBLIC, anon;
GRANT SELECT ON public.payment_intents TO authenticated;

DROP POLICY IF EXISTS "Plan permits payment intent reads" ON public.payment_intents;
CREATE POLICY "Plan permits payment intent reads"
  ON public.payment_intents AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.studio_has_entitlement(studio_id, 'finance_basic') OR public.is_saas_owner());

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.subscriptions FROM anon, authenticated;
REVOKE ALL ON public.subscriptions FROM PUBLIC, anon;
GRANT SELECT ON public.subscriptions TO authenticated;

-- Raw Stripe payloads can include customer data. Existing payloads remain for
-- audit retention, but browser roles lose direct access; new code stores only a
-- minimal event envelope.
DROP POLICY IF EXISTS "Members read platform billing events" ON public.platform_billing_events;
REVOKE ALL ON public.platform_billing_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.platform_billing_events TO service_role;

-- Keep the original platform-field guard aligned with the new server-owned
-- Connect responsibility fields.
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
    NEW.stripe_connect_fees_payer IS DISTINCT FROM OLD.stripe_connect_fees_payer OR
    NEW.stripe_connect_losses_collector IS DISTINCT FROM OLD.stripe_connect_losses_collector OR
    NEW.stripe_connect_dashboard_type IS DISTINCT FROM OLD.stripe_connect_dashboard_type OR
    NEW.stripe_connect_negative_balance_cents IS DISTINCT FROM OLD.stripe_connect_negative_balance_cents OR
    NEW.stripe_connect_responsibility_checked_at IS DISTINCT FROM OLD.stripe_connect_responsibility_checked_at OR
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

REVOKE ALL ON FUNCTION public.guard_studio_platform_fields()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_studio_platform_fields() TO service_role;
