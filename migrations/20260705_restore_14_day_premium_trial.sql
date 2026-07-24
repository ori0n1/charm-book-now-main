-- Restore the original 14-day Premium trial flow.
-- Rollback data snapshot:
--   public.studios_trial_restore_backup_20260705_190426

CREATE TABLE IF NOT EXISTS public.studios_trial_restore_backup_20260705_190426 AS
SELECT
  id,
  slug,
  name,
  subscription_status,
  subscription_current_period_end,
  premium_access_until,
  trial_ends_at,
  trial_claimed_at,
  trial_blocked_reason,
  updated_at,
  now() AS backed_up_at
FROM public.studios;

ALTER TABLE public.studios
  ALTER COLUMN subscription_status SET DEFAULT 'trialing',
  ALTER COLUMN trial_ends_at SET DEFAULT (now() + interval '14 days');

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

UPDATE public.studios s
SET
  subscription_status = CASE
    WHEN s.subscription_status = 'active'
      AND (s.subscription_current_period_end IS NULL OR s.subscription_current_period_end > now())
      THEN s.subscription_status
    WHEN s.subscription_current_period_end IS NOT NULL AND s.subscription_current_period_end > now() THEN s.subscription_status
    WHEN EXISTS (
      SELECT 1
      FROM public.subscriptions sub
      WHERE sub.studio_id = s.id
        AND sub.status IN ('active', 'trialing')
        AND (sub.current_period_end IS NULL OR sub.current_period_end > now())
    ) THEN s.subscription_status
    ELSE 'trialing'
  END,
  trial_ends_at = now() + interval '14 days',
  trial_claimed_at = coalesce(s.trial_claimed_at, now()),
  trial_blocked_reason = NULL,
  premium_access_until = CASE
    WHEN s.subscription_status = 'active' THEN s.premium_access_until
    WHEN s.subscription_current_period_end IS NOT NULL AND s.subscription_current_period_end > now()
      THEN greatest(coalesce(s.premium_access_until, s.subscription_current_period_end), s.subscription_current_period_end)
    WHEN EXISTS (
      SELECT 1
      FROM public.subscriptions sub
      WHERE sub.studio_id = s.id
        AND sub.status IN ('active', 'trialing')
        AND (sub.current_period_end IS NULL OR sub.current_period_end > now())
    ) THEN s.premium_access_until
    ELSE NULL
  END,
  updated_at = now()
WHERE s.is_active = true;
