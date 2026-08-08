-- WhatsApp commercial controls.
-- Additive migration: existing studios keep their current access through the
-- explicit `legacy` entitlement. Automatic billing remains disabled until the
-- provider contract and Bellza commercial values are configured by a SaaS owner.

CREATE TABLE IF NOT EXISTS public.whatsapp_platform_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  global_enabled boolean NOT NULL DEFAULT true,
  trial_enabled boolean NOT NULL DEFAULT true,
  trial_duration_days integer NOT NULL DEFAULT 14 CHECK (trial_duration_days BETWEEN 1 AND 365),
  trial_message_limit integer NOT NULL DEFAULT 100 CHECK (trial_message_limit >= 0),
  alert_thresholds integer[] NOT NULL DEFAULT ARRAY[70, 90, 100],
  post_trial_mode text NOT NULL DEFAULT 'inactive' CHECK (post_trial_mode IN ('inactive', 'manual_addon')),
  billing_mode text NOT NULL DEFAULT 'disabled' CHECK (billing_mode IN ('disabled', 'manual', 'automatic')),
  provider_cost_per_message_cents integer CHECK (provider_cost_per_message_cents IS NULL OR provider_cost_per_message_cents >= 0),
  commercial_price_cents integer CHECK (commercial_price_cents IS NULL OR commercial_price_cents >= 0),
  commercial_included_messages integer CHECK (commercial_included_messages IS NULL OR commercial_included_messages >= 0),
  commercial_excess_message_cents integer CHECK (commercial_excess_message_cents IS NULL OR commercial_excess_message_cents >= 0),
  currency text NOT NULL DEFAULT 'eur',
  provider_contract_verified_at timestamptz,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.whatsapp_platform_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.whatsapp_studio_entitlements (
  studio_id uuid PRIMARY KEY REFERENCES public.studios(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('trial', 'active', 'inactive', 'paused', 'legacy')),
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  trial_message_limit_override integer CHECK (trial_message_limit_override IS NULL OR trial_message_limit_override >= 0),
  addon_started_at timestamptz,
  addon_ends_at timestamptz,
  paused_reason text,
  billing_customer_reference text,
  billing_subscription_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.whatsapp_trial_identity_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id uuid REFERENCES public.studios(id) ON DELETE SET NULL,
  identity_kind text NOT NULL,
  identity_hash text NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  trial_ends_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (identity_kind, identity_hash)
);

-- Claims deliberately survive studio deletion. Only irreversible hashes are kept.
INSERT INTO public.whatsapp_trial_identity_claims (
  studio_id, identity_kind, identity_hash, claimed_at, trial_ends_at
)
SELECT s.id, identity.kind,
       encode(extensions.digest(identity.value::bytea, 'sha256'), 'hex'),
       coalesce(s.trial_claimed_at, s.created_at), s.trial_ends_at
FROM public.studios s
CROSS JOIN LATERAL (
  VALUES
    ('phone', nullif(s.trial_identity_phone, '')),
    ('slug', nullif(s.trial_identity_slug, '')),
    ('device', nullif(s.trial_identity_device_fingerprint_hash, '')),
    ('ip', nullif(s.trial_identity_ip_hash, '')),
    ('nif', nullif(s.trial_identity_nif, '')),
    ('stripe', nullif(s.trial_identity_stripe_account_id, ''))
) AS identity(kind, value)
WHERE identity.value IS NOT NULL
ON CONFLICT (identity_kind, identity_hash) DO NOTHING;

INSERT INTO public.whatsapp_trial_identity_claims (
  studio_id, identity_kind, identity_hash, claimed_at, trial_ends_at
)
SELECT ur.studio_id, identity.kind,
       encode(extensions.digest(identity.value::bytea, 'sha256'), 'hex'),
       coalesce(s.trial_claimed_at, s.created_at), s.trial_ends_at
FROM public.user_roles ur
JOIN public.studios s ON s.id = ur.studio_id
JOIN auth.users au ON au.id = ur.user_id
CROSS JOIN LATERAL (
  VALUES
    ('account', ur.user_id::text),
    ('email', nullif(lower(trim(au.email)), ''))
) AS identity(kind, value)
WHERE ur.role = 'studio_owner' AND ur.studio_id IS NOT NULL AND identity.value IS NOT NULL
ON CONFLICT (identity_kind, identity_hash) DO NOTHING;

-- Preserve current behaviour. No existing studio is disabled by this release.
INSERT INTO public.whatsapp_studio_entitlements (studio_id, status, trial_started_at, trial_ends_at)
SELECT s.id, 'legacy', s.trial_claimed_at, s.trial_ends_at
FROM public.studios s
ON CONFLICT (studio_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.whatsapp_usage_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id uuid NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  message_log_id uuid REFERENCES public.whatsapp_message_logs(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL UNIQUE,
  entitlement_kind text NOT NULL CHECK (entitlement_kind IN ('trial', 'active', 'legacy')),
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved', 'submitted', 'counted', 'released')),
  provider text NOT NULL DEFAULT 'senddm_whatsapp',
  provider_message_id text,
  provider_status text,
  message_kind text NOT NULL DEFAULT 'confirmation',
  unit_cost_cents integer CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0),
  commercial_unit_cents integer CHECK (commercial_unit_cents IS NULL OR commercial_unit_cents >= 0),
  reserved_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  counted_at timestamptz,
  released_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_usage_studio_created
  ON public.whatsapp_usage_ledger(studio_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_usage_studio_state
  ON public.whatsapp_usage_ledger(studio_id, state, created_at DESC);

-- Import the operational history once. Existing records remain `legacy`, so
-- this is reporting-only and cannot unexpectedly consume a new trial quota.
INSERT INTO public.whatsapp_usage_ledger (
  studio_id, message_log_id, idempotency_key, entitlement_kind, state,
  provider, provider_message_id, provider_status, message_kind,
  reserved_at, submitted_at, counted_at, released_at, created_at, updated_at,
  metadata
)
SELECT
  l.studio_id,
  l.id,
  l.idempotency_key,
  'legacy',
  CASE l.status
    WHEN 'sent' THEN 'counted'
    WHEN 'pending' THEN 'submitted'
    ELSE 'released'
  END,
  l.provider,
  l.provider_message_id,
  coalesce(l.payload->>'status', l.status),
  coalesce(l.payload->>'message_kind', 'confirmation'),
  l.created_at,
  CASE WHEN l.status IN ('sent', 'pending') THEN l.created_at END,
  CASE WHEN l.status = 'sent' THEN coalesce(l.updated_at, l.created_at) END,
  CASE WHEN l.status IN ('failed', 'skipped') THEN coalesce(l.updated_at, l.created_at) END,
  l.created_at,
  coalesce(l.updated_at, l.created_at),
  jsonb_build_object('migrated_from_message_log', true)
FROM public.whatsapp_message_logs l
ON CONFLICT (idempotency_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.whatsapp_usage_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id uuid NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  usage_scope text NOT NULL,
  threshold_percent integer NOT NULL CHECK (threshold_percent BETWEEN 1 AND 100),
  used_count integer NOT NULL,
  limit_count integer NOT NULL,
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (studio_id, usage_scope, threshold_percent)
);

CREATE TABLE IF NOT EXISTS public.whatsapp_admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id uuid REFERENCES public.studios(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  before_state jsonb,
  after_state jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_admin_audit_created
  ON public.whatsapp_admin_audit_logs(created_at DESC);

CREATE OR REPLACE FUNCTION public.is_saas_owner(_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id AND ur.role = 'saas_owner'
  )
$$;

CREATE OR REPLACE FUNCTION public.create_whatsapp_entitlement_for_studio()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings public.whatsapp_platform_settings%ROWTYPE;
  v_trial_allowed boolean := true;
  v_trial_started_at timestamptz;
  v_trial_ends_at timestamptz;
  v_identity record;
  v_identity_hash text;
BEGIN
  SELECT * INTO v_settings FROM public.whatsapp_platform_settings WHERE id = 1;
  v_trial_started_at := coalesce(NEW.trial_claimed_at, NEW.created_at, now());
  v_trial_ends_at := least(
    coalesce(NEW.trial_ends_at, 'infinity'::timestamptz),
    v_trial_started_at + make_interval(days => coalesce(v_settings.trial_duration_days, 14))
  );

  FOR v_identity IN
    SELECT identity.kind, identity.value
    FROM (VALUES
      ('phone', nullif(NEW.trial_identity_phone, '')),
      ('slug', nullif(NEW.trial_identity_slug, '')),
      ('device', nullif(NEW.trial_identity_device_fingerprint_hash, '')),
      ('ip', nullif(NEW.trial_identity_ip_hash, '')),
      ('nif', nullif(NEW.trial_identity_nif, '')),
      ('stripe', nullif(NEW.trial_identity_stripe_account_id, ''))
    ) AS identity(kind, value)
    WHERE identity.value IS NOT NULL
  LOOP
    v_identity_hash := encode(extensions.digest(v_identity.value::bytea, 'sha256'), 'hex');
    IF EXISTS (
      SELECT 1 FROM public.whatsapp_trial_identity_claims c
      WHERE c.identity_kind = v_identity.kind AND c.identity_hash = v_identity_hash
    ) THEN
      v_trial_allowed := false;
    END IF;
  END LOOP;

  INSERT INTO public.whatsapp_studio_entitlements (
    studio_id, status, trial_started_at, trial_ends_at
  ) VALUES (
    NEW.id,
    CASE
      WHEN coalesce(v_settings.trial_enabled, true) AND v_trial_allowed AND v_trial_ends_at > now() THEN 'trial'
      ELSE 'inactive'
    END,
    v_trial_started_at,
    CASE WHEN coalesce(v_settings.trial_enabled, true) AND v_trial_allowed THEN v_trial_ends_at ELSE NULL END
  )
  ON CONFLICT (studio_id) DO NOTHING;

  IF v_trial_allowed THEN
    FOR v_identity IN
      SELECT identity.kind, identity.value
      FROM (VALUES
        ('phone', nullif(NEW.trial_identity_phone, '')),
        ('slug', nullif(NEW.trial_identity_slug, '')),
        ('device', nullif(NEW.trial_identity_device_fingerprint_hash, '')),
        ('ip', nullif(NEW.trial_identity_ip_hash, '')),
        ('nif', nullif(NEW.trial_identity_nif, '')),
        ('stripe', nullif(NEW.trial_identity_stripe_account_id, ''))
      ) AS identity(kind, value)
      WHERE identity.value IS NOT NULL
    LOOP
      INSERT INTO public.whatsapp_trial_identity_claims (
        studio_id, identity_kind, identity_hash, claimed_at, trial_ends_at
      ) VALUES (
        NEW.id, v_identity.kind,
        encode(extensions.digest(v_identity.value::bytea, 'sha256'), 'hex'),
        v_trial_started_at, v_trial_ends_at
      ) ON CONFLICT (identity_kind, identity_hash) DO NOTHING;
    END LOOP;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_create_whatsapp_entitlement ON public.studios;
CREATE TRIGGER trg_create_whatsapp_entitlement
  AFTER INSERT ON public.studios
  FOR EACH ROW EXECUTE FUNCTION public.create_whatsapp_entitlement_for_studio();

CREATE OR REPLACE FUNCTION public.claim_whatsapp_trial_for_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_email text;
  v_kind text;
  v_value text;
  v_hash text;
  v_entitlement public.whatsapp_studio_entitlements%ROWTYPE;
  v_reused boolean := false;
BEGIN
  IF NEW.role <> 'studio_owner' OR NEW.studio_id IS NULL THEN RETURN NEW; END IF;
  SELECT lower(trim(email)) INTO v_email FROM auth.users WHERE id = NEW.user_id;
  SELECT * INTO v_entitlement FROM public.whatsapp_studio_entitlements WHERE studio_id = NEW.studio_id FOR UPDATE;
  IF NOT FOUND OR v_entitlement.status <> 'trial' THEN RETURN NEW; END IF;

  FOREACH v_kind IN ARRAY ARRAY['account', 'email'] LOOP
    v_value := CASE WHEN v_kind = 'account' THEN NEW.user_id::text ELSE nullif(v_email, '') END;
    IF v_value IS NULL THEN CONTINUE; END IF;
    v_hash := encode(extensions.digest(v_value::bytea, 'sha256'), 'hex');
    IF EXISTS (
      SELECT 1 FROM public.whatsapp_trial_identity_claims c
      WHERE c.identity_kind = v_kind AND c.identity_hash = v_hash
        AND c.studio_id IS DISTINCT FROM NEW.studio_id
    ) THEN
      v_reused := true;
    END IF;
  END LOOP;

  IF v_reused THEN
    UPDATE public.whatsapp_studio_entitlements
    SET status = 'inactive', trial_ends_at = NULL,
        paused_reason = 'trial_identity_already_used', updated_at = now()
    WHERE studio_id = NEW.studio_id;
    RETURN NEW;
  END IF;

  FOREACH v_kind IN ARRAY ARRAY['account', 'email'] LOOP
    v_value := CASE WHEN v_kind = 'account' THEN NEW.user_id::text ELSE nullif(v_email, '') END;
    IF v_value IS NULL THEN CONTINUE; END IF;
    INSERT INTO public.whatsapp_trial_identity_claims (
      studio_id, identity_kind, identity_hash, claimed_at, trial_ends_at
    ) VALUES (
      NEW.studio_id, v_kind,
      encode(extensions.digest(v_value::bytea, 'sha256'), 'hex'),
      coalesce(v_entitlement.trial_started_at, now()), v_entitlement.trial_ends_at
    ) ON CONFLICT (identity_kind, identity_hash) DO NOTHING;
  END LOOP;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_claim_whatsapp_trial_for_owner ON public.user_roles;
CREATE TRIGGER trg_claim_whatsapp_trial_for_owner
  AFTER INSERT ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.claim_whatsapp_trial_for_owner();

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
  v_reserved integer;
  v_scope text;
BEGIN
  IF p_studio_id IS NULL OR nullif(trim(p_idempotency_key), '') IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'invalid_usage_request');
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

  SELECT * INTO v_entitlement
  FROM public.whatsapp_studio_entitlements
  WHERE studio_id = p_studio_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'whatsapp_entitlement_missing');
  END IF;

  IF v_entitlement.status IN ('inactive', 'paused') THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', CASE WHEN v_entitlement.status = 'paused' THEN coalesce(v_entitlement.paused_reason, 'whatsapp_paused') ELSE 'whatsapp_addon_inactive' END
    );
  END IF;

  IF v_entitlement.status = 'active' AND v_entitlement.addon_ends_at IS NOT NULL
     AND v_entitlement.addon_ends_at <= now() THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'whatsapp_addon_expired');
  END IF;

  IF v_entitlement.status = 'trial' THEN
    IF NOT v_settings.trial_enabled OR v_entitlement.trial_ends_at IS NULL OR v_entitlement.trial_ends_at <= now() THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'whatsapp_trial_expired');
    END IF;
    v_limit := coalesce(v_entitlement.trial_message_limit_override, v_settings.trial_message_limit);
    v_scope := to_char(v_entitlement.trial_started_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS');
    SELECT count(*)::integer INTO v_reserved
    FROM public.whatsapp_usage_ledger
    WHERE studio_id = p_studio_id
      AND entitlement_kind = 'trial'
      AND state IN ('reserved', 'submitted', 'counted')
      AND created_at >= coalesce(v_entitlement.trial_started_at, '-infinity'::timestamptz)
      AND created_at < v_entitlement.trial_ends_at;
    IF v_reserved >= v_limit THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'whatsapp_trial_limit_reached', 'used', v_reserved, 'limit', v_limit);
    END IF;
  ELSE
    v_limit := NULL;
    v_reserved := NULL;
    v_scope := v_entitlement.status;
  END IF;

  IF v_existing.id IS NOT NULL THEN
    UPDATE public.whatsapp_usage_ledger
    SET state = 'reserved', entitlement_kind = v_entitlement.status,
        message_kind = coalesce(nullif(p_message_kind, ''), message_kind),
        unit_cost_cents = v_settings.provider_cost_per_message_cents,
        commercial_unit_cents = v_settings.commercial_excess_message_cents,
        reserved_at = now(), submitted_at = NULL, counted_at = NULL,
        released_at = NULL, provider_message_id = NULL, provider_status = NULL,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('usage_scope', coalesce(v_scope, v_entitlement.status)),
        updated_at = now()
    WHERE id = v_existing.id
    RETURNING * INTO v_existing;
  ELSE
    INSERT INTO public.whatsapp_usage_ledger (
      studio_id, idempotency_key, entitlement_kind, message_kind,
      unit_cost_cents, commercial_unit_cents, metadata
    ) VALUES (
      p_studio_id, p_idempotency_key, v_entitlement.status, coalesce(nullif(p_message_kind, ''), 'confirmation'),
      v_settings.provider_cost_per_message_cents,
      v_settings.commercial_excess_message_cents,
      jsonb_build_object('usage_scope', coalesce(v_scope, v_entitlement.status))
    )
    RETURNING * INTO v_existing;
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'reason', 'reserved',
    'ledgerId', v_existing.id,
    'entitlement', v_existing.entitlement_kind,
    'used', CASE WHEN v_reserved IS NULL THEN NULL ELSE v_reserved + 1 END,
    'limit', v_limit
  );
EXCEPTION WHEN unique_violation THEN
  SELECT * INTO v_existing FROM public.whatsapp_usage_ledger WHERE idempotency_key = p_idempotency_key;
  RETURN jsonb_build_object('allowed', v_existing.state <> 'released', 'reason', 'already_reserved', 'ledgerId', v_existing.id);
END
$$;

CREATE OR REPLACE FUNCTION public.finalize_whatsapp_usage(
  p_idempotency_key text,
  p_outcome text,
  p_message_log_id uuid DEFAULT NULL,
  p_provider_message_id text DEFAULT NULL,
  p_provider_status text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.whatsapp_usage_ledger%ROWTYPE;
  v_settings public.whatsapp_platform_settings%ROWTYPE;
  v_entitlement public.whatsapp_studio_entitlements%ROWTYPE;
  v_used integer;
  v_limit integer;
  v_threshold integer;
  v_scope text;
BEGIN
  IF p_outcome NOT IN ('submitted', 'delivered', 'failed', 'skipped') THEN
    RAISE EXCEPTION 'invalid_whatsapp_usage_outcome';
  END IF;

  UPDATE public.whatsapp_usage_ledger
  SET state = CASE
        WHEN p_outcome = 'delivered' THEN 'counted'
        WHEN p_outcome = 'submitted' THEN 'submitted'
        ELSE 'released'
      END,
      message_log_id = coalesce(p_message_log_id, message_log_id),
      provider_message_id = coalesce(p_provider_message_id, provider_message_id),
      provider_status = coalesce(p_provider_status, provider_status),
      submitted_at = CASE WHEN p_outcome IN ('submitted', 'delivered') THEN coalesce(submitted_at, now()) ELSE submitted_at END,
      counted_at = CASE WHEN p_outcome = 'delivered' THEN coalesce(counted_at, now()) ELSE counted_at END,
      released_at = CASE WHEN p_outcome IN ('failed', 'skipped') THEN coalesce(released_at, now()) ELSE released_at END,
      metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
      updated_at = now()
  WHERE idempotency_key = p_idempotency_key
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'usage_reservation_not_found');
  END IF;

  IF v_row.entitlement_kind = 'trial' AND p_outcome IN ('submitted', 'delivered') THEN
    SELECT * INTO v_settings FROM public.whatsapp_platform_settings WHERE id = 1;
    SELECT * INTO v_entitlement FROM public.whatsapp_studio_entitlements WHERE studio_id = v_row.studio_id;
    v_limit := coalesce(v_entitlement.trial_message_limit_override, v_settings.trial_message_limit);
    v_scope := coalesce(v_row.metadata->>'usage_scope', 'trial');
    SELECT count(*)::integer INTO v_used
    FROM public.whatsapp_usage_ledger
    WHERE studio_id = v_row.studio_id
      AND entitlement_kind = 'trial'
      AND state IN ('submitted', 'counted')
      AND created_at >= coalesce(v_entitlement.trial_started_at, '-infinity'::timestamptz)
      AND created_at < coalesce(v_entitlement.trial_ends_at, 'infinity'::timestamptz);

    FOREACH v_threshold IN ARRAY v_settings.alert_thresholds LOOP
      IF v_limit > 0 AND (v_used * 100.0 / v_limit) >= v_threshold THEN
        INSERT INTO public.whatsapp_usage_alerts (
          studio_id, usage_scope, threshold_percent, used_count, limit_count
        ) VALUES (v_row.studio_id, v_scope, v_threshold, v_used, v_limit)
        ON CONFLICT (studio_id, usage_scope, threshold_percent) DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'state', v_row.state, 'ledgerId', v_row.id);
END
$$;

REVOKE ALL ON FUNCTION public.reserve_whatsapp_usage(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_whatsapp_usage(text, text, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_whatsapp_usage(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_whatsapp_usage(text, text, uuid, text, text, jsonb) TO service_role;

ALTER TABLE public.whatsapp_platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_studio_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_trial_identity_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_usage_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_usage_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_admin_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SaaS owners manage WhatsApp settings" ON public.whatsapp_platform_settings
  FOR ALL TO authenticated USING (public.is_saas_owner()) WITH CHECK (public.is_saas_owner());
CREATE POLICY "Members read WhatsApp entitlement" ON public.whatsapp_studio_entitlements
  FOR SELECT TO authenticated USING (public.is_studio_member(auth.uid(), studio_id) OR public.is_saas_owner());
CREATE POLICY "SaaS owners manage WhatsApp entitlement" ON public.whatsapp_studio_entitlements
  FOR ALL TO authenticated USING (public.is_saas_owner()) WITH CHECK (public.is_saas_owner());
CREATE POLICY "SaaS owners read WhatsApp trial claims" ON public.whatsapp_trial_identity_claims
  FOR SELECT TO authenticated USING (public.is_saas_owner());
CREATE POLICY "Members read WhatsApp usage" ON public.whatsapp_usage_ledger
  FOR SELECT TO authenticated USING (public.is_studio_member(auth.uid(), studio_id) OR public.is_saas_owner());
CREATE POLICY "Members read WhatsApp alerts" ON public.whatsapp_usage_alerts
  FOR SELECT TO authenticated USING (public.is_studio_member(auth.uid(), studio_id) OR public.is_saas_owner());
CREATE POLICY "SaaS owners read WhatsApp audit" ON public.whatsapp_admin_audit_logs
  FOR SELECT TO authenticated USING (public.is_saas_owner());

CREATE POLICY "Service role manages WhatsApp settings" ON public.whatsapp_platform_settings
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role manages WhatsApp entitlements" ON public.whatsapp_studio_entitlements
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role manages WhatsApp trial claims" ON public.whatsapp_trial_identity_claims
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role manages WhatsApp usage" ON public.whatsapp_usage_ledger
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role manages WhatsApp alerts" ON public.whatsapp_usage_alerts
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role manages WhatsApp audit" ON public.whatsapp_admin_audit_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_whatsapp_platform_settings_updated ON public.whatsapp_platform_settings;
CREATE TRIGGER trg_whatsapp_platform_settings_updated
  BEFORE UPDATE ON public.whatsapp_platform_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_whatsapp_studio_entitlements_updated ON public.whatsapp_studio_entitlements;
CREATE TRIGGER trg_whatsapp_studio_entitlements_updated
  BEFORE UPDATE ON public.whatsapp_studio_entitlements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_whatsapp_usage_ledger_updated ON public.whatsapp_usage_ledger;
CREATE TRIGGER trg_whatsapp_usage_ledger_updated
  BEFORE UPDATE ON public.whatsapp_usage_ledger
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

NOTIFY pgrst, 'reload schema';
