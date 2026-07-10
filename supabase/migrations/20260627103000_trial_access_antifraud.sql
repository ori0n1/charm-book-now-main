-- Trial access metadata and premium-access helpers.
-- The original commercial rule is intentionally simple:
-- every new studio receives a full 14-day Premium trial, then access is blocked
-- unless a valid Premium subscription or paid period exists.

ALTER TABLE public.studios
  ADD COLUMN IF NOT EXISTS trial_claimed_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS trial_identity_phone text,
  ADD COLUMN IF NOT EXISTS trial_identity_studio_name text,
  ADD COLUMN IF NOT EXISTS trial_identity_slug text,
  ADD COLUMN IF NOT EXISTS trial_identity_ip_hash text,
  ADD COLUMN IF NOT EXISTS trial_identity_device_fingerprint_hash text,
  ADD COLUMN IF NOT EXISTS trial_identity_nif text,
  ADD COLUMN IF NOT EXISTS trial_identity_stripe_account_id text,
  ADD COLUMN IF NOT EXISTS trial_blocked_reason text;

CREATE INDEX IF NOT EXISTS idx_studios_trial_identity_phone
  ON public.studios(trial_identity_phone)
  WHERE trial_identity_phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_studios_trial_identity_slug
  ON public.studios(trial_identity_slug)
  WHERE trial_identity_slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_studios_trial_identity_studio_name
  ON public.studios(trial_identity_studio_name)
  WHERE trial_identity_studio_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_studios_trial_identity_ip_hash
  ON public.studios(trial_identity_ip_hash)
  WHERE trial_identity_ip_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_studios_trial_identity_device_hash
  ON public.studios(trial_identity_device_fingerprint_hash)
  WHERE trial_identity_device_fingerprint_hash IS NOT NULL;

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
            s.subscription_current_period_end IS NULL
            OR s.subscription_current_period_end > now()
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
            AND (
              (sub.status = 'active' AND (sub.current_period_end IS NULL OR sub.current_period_end > now()))
              OR (sub.status = 'trialing' AND sub.current_period_end IS NOT NULL AND sub.current_period_end > now())
            )
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.normalize_trial_text(_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT nullif(regexp_replace(lower(trim(coalesce(_value, ''))), '[^a-z0-9]+', '', 'g'), '')
$$;

CREATE OR REPLACE FUNCTION public.normalize_trial_phone(_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT nullif(regexp_replace(coalesce(_value, ''), '\D', '', 'g'), '')
$$;

DROP FUNCTION IF EXISTS public.create_studio_with_owner(TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.create_studio_with_owner(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.create_studio_with_owner(
  p_name text,
  p_slug text,
  p_timezone text DEFAULT 'Europe/Lisbon',
  p_currency text DEFAULT 'EUR',
  p_business_segment text DEFAULT 'beauty',
  p_trial_phone text DEFAULT NULL,
  p_trial_device_fingerprint_hash text DEFAULT NULL,
  p_trial_ip_hash text DEFAULT NULL,
  p_trial_nif text DEFAULT NULL,
  p_trial_stripe_account_id text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_studio_id uuid;
  v_user uuid := auth.uid();
  v_phone text := public.normalize_trial_phone(p_trial_phone);
  v_slug text := public.normalize_trial_text(p_slug);
  v_name text := public.normalize_trial_text(p_name);
  v_nif text := public.normalize_trial_phone(p_trial_nif);
  v_device_hash text := nullif(trim(coalesce(p_trial_device_fingerprint_hash, '')), '');
  v_ip_hash text := nullif(trim(coalesce(p_trial_ip_hash, '')), '');
  v_stripe_account text := nullif(trim(coalesce(p_trial_stripe_account_id, '')), '');
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_business_segment NOT IN ('beauty', 'barbershop', 'nail_studio', 'clinic', 'other') THEN
    RAISE EXCEPTION 'invalid_business_segment';
  END IF;

  INSERT INTO public.studios (
    name,
    slug,
    timezone,
    currency,
    business_segment,
    phone,
    subscription_status,
    trial_ends_at,
    trial_claimed_at,
    trial_identity_phone,
    trial_identity_studio_name,
    trial_identity_slug,
    trial_identity_ip_hash,
    trial_identity_device_fingerprint_hash,
    trial_identity_nif,
    trial_identity_stripe_account_id
  )
  VALUES (
    p_name,
    p_slug,
    p_timezone,
    p_currency,
    p_business_segment,
    v_phone,
    'trialing',
    now() + interval '14 days',
    now(),
    v_phone,
    v_name,
    v_slug,
    v_ip_hash,
    v_device_hash,
    v_nif,
    v_stripe_account
  )
  RETURNING id INTO v_studio_id;

  INSERT INTO public.user_roles (user_id, studio_id, role)
  VALUES (v_user, v_studio_id, 'studio_owner');

  RETURN v_studio_id;
END
$$;

GRANT EXECUTE ON FUNCTION public.create_studio_with_owner(
  text, text, text, text, text, text, text, text, text, text
) TO authenticated;
