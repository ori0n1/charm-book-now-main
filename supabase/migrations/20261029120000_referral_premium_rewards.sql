-- New referrals earn 14 days of Premium after a paid studio remains active
-- for 30 days. Existing referrals keep their original credit promise.
ALTER TABLE public.referrals ADD COLUMN IF NOT EXISTS reward_kind text;
UPDATE public.referrals SET reward_kind = 'legacy_credit' WHERE reward_kind IS NULL;
-- Legacy default keeps the pre-migration Worker safe during the staging gap.
-- The new Worker explicitly writes premium_days for every new claim.
ALTER TABLE public.referrals ALTER COLUMN reward_kind SET DEFAULT 'legacy_credit';
ALTER TABLE public.referrals ALTER COLUMN reward_kind SET NOT NULL;
ALTER TABLE public.referrals ADD CONSTRAINT referrals_reward_kind_check
  CHECK (reward_kind IN ('legacy_credit', 'premium_days'));

CREATE TABLE public.referral_premium_grants (
  referral_id uuid PRIMARY KEY REFERENCES public.referrals(id) ON DELETE RESTRICT,
  studio_id uuid NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referral_premium_grants_duration CHECK (ends_at = starts_at + interval '14 days')
);
CREATE INDEX referral_premium_grants_studio_end_idx
  ON public.referral_premium_grants (studio_id, ends_at DESC);
ALTER TABLE public.referral_premium_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.referral_premium_grants FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.referral_premium_grants TO service_role;

-- This replacement must be compared with the effective production definition
-- before release. It adds the active referral grant branch.
CREATE OR REPLACE FUNCTION public.studio_effective_plan_tier(
  _studio_id uuid, _at timestamptz DEFAULT now()
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_studio public.studios%ROWTYPE;
  v_subscription_tier text;
BEGIN
  SELECT * INTO v_studio FROM public.studios WHERE id = _studio_id;
  IF NOT FOUND OR v_studio.is_active IS DISTINCT FROM true THEN
    RETURN 'free';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.referral_premium_grants grant_row
    WHERE grant_row.studio_id = _studio_id
      AND grant_row.starts_at <= _at AND grant_row.ends_at > _at
  ) THEN
    RETURN 'premium';
  END IF;

  SELECT coalesce(sub.plan_tier, 'premium') INTO v_subscription_tier
  FROM public.subscriptions sub
  WHERE sub.studio_id = _studio_id
    AND sub.status IN ('active', 'trialing', 'canceled')
    AND sub.current_period_end IS NOT NULL
    AND sub.current_period_end > _at
  ORDER BY sub.updated_at DESC LIMIT 1;
  IF v_subscription_tier IN ('pro', 'premium') THEN
    RETURN v_subscription_tier;
  END IF;

  IF v_studio.subscription_status IN ('active', 'trialing', 'canceled')
    AND (v_studio.subscription_current_period_end > _at
      OR v_studio.premium_access_until > _at) THEN
    RETURN CASE WHEN v_studio.plan_tier IN ('pro', 'premium')
      THEN v_studio.plan_tier ELSE 'premium' END;
  END IF;

  IF v_studio.trial_ends_at IS NOT NULL AND v_studio.trial_ends_at > _at THEN
    RETURN 'premium';
  END IF;
  RETURN 'free';
END
$function$;

-- The Worker alone can call this function. Row locks serialize simultaneous
-- invoice events and make the six reward ceiling and stacking deterministic.
CREATE FUNCTION public.award_referral_premium(_referral_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_referral public.referrals%ROWTYPE;
  v_studio public.studios%ROWTYPE;
  v_now timestamptz := now();
  v_used integer;
  v_start timestamptz;
BEGIN
  SELECT * INTO v_referral FROM public.referrals
  WHERE id = _referral_id FOR UPDATE;
  IF NOT FOUND OR v_referral.status <> 'pending_validation'
    OR v_referral.reward_kind <> 'premium_days' THEN
    RETURN 'already_processed';
  END IF;
  IF v_referral.subscription_started_at IS NULL
    OR v_referral.subscription_started_at + interval '30 days' > v_now THEN
    RETURN 'not_ready';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.subscriptions sub
    WHERE sub.studio_id = v_referral.referred_studio_id
      AND sub.status = 'active' AND sub.plan_tier IN ('pro', 'premium')
      AND sub.current_period_end > v_now
  ) THEN
    RETURN 'not_eligible';
  END IF;

  SELECT * INTO v_studio FROM public.studios
  WHERE id = v_referral.referrer_studio_id FOR UPDATE;
  IF NOT FOUND OR v_studio.is_active IS DISTINCT FROM true THEN
    RETURN 'not_eligible';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.subscriptions sub
    WHERE sub.studio_id = v_studio.id AND sub.plan_tier = 'premium'
      AND sub.status IN ('active', 'trialing', 'canceled')
      AND sub.current_period_end > v_now
  ) THEN
    UPDATE public.referrals SET status = 'approved', validated_at = v_now
    WHERE id = _referral_id;
    RETURN 'premium_subscriber';
  END IF;

  SELECT (
    (SELECT count(*) FROM public.referral_credits credit
      WHERE credit.studio_id = v_studio.id AND credit.status IN ('available', 'applied'))
    + (SELECT count(*) FROM public.referral_premium_grants grant_row
      WHERE grant_row.studio_id = v_studio.id)
  ) INTO v_used;
  IF v_used >= 6 THEN
    UPDATE public.referrals SET status = 'approved', validated_at = v_now
    WHERE id = _referral_id;
    RETURN 'limit_reached';
  END IF;

  SELECT greatest(v_now, coalesce(max(grant_row.ends_at), v_now),
      CASE WHEN v_studio.trial_used_at IS NULL
        THEN coalesce(v_studio.trial_ends_at, v_now) ELSE v_now END) INTO v_start
  FROM public.referral_premium_grants grant_row
  WHERE grant_row.studio_id = v_studio.id;

  INSERT INTO public.referral_premium_grants
    (referral_id, studio_id, starts_at, ends_at)
  VALUES (_referral_id, v_studio.id, v_start, v_start + interval '14 days');
  UPDATE public.referrals
  SET status = 'approved', validated_at = v_now, credited_at = v_now
  WHERE id = _referral_id;
  RETURN 'granted';
END
$function$;
REVOKE ALL ON FUNCTION public.award_referral_premium(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.award_referral_premium(uuid) TO service_role;
