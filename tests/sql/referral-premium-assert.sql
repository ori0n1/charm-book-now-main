DO $$
BEGIN
  IF (SELECT reward_kind FROM public.referrals
      WHERE id = '00000000-0000-0000-0000-000000000011') <> 'legacy_credit' THEN
    RAISE EXCEPTION 'existing referral was not grandfathered';
  END IF;
END $$;

INSERT INTO public.referrals
  (id, referrer_studio_id, referred_studio_id, subscription_started_at, reward_kind)
VALUES
  ('00000000-0000-0000-0000-000000000012',
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000002', now() - interval '31 days', 'premium_days'),
  ('00000000-0000-0000-0000-000000000013',
   '00000000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-000000000002', now() - interval '31 days', 'premium_days');

DO $$
DECLARE
  v_grant text;
BEGIN
  v_grant := public.award_referral_premium('00000000-0000-0000-0000-000000000012');
  IF v_grant <> 'granted' THEN RAISE EXCEPTION 'grant failed: %', v_grant; END IF;
  IF public.award_referral_premium('00000000-0000-0000-0000-000000000012') <> 'already_processed' THEN
    RAISE EXCEPTION 'grant was not idempotent';
  END IF;
  IF public.studio_effective_plan_tier('00000000-0000-0000-0000-000000000001') <> 'premium' THEN
    RAISE EXCEPTION 'Premium entitlement missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.referral_premium_grants
    WHERE referral_id = '00000000-0000-0000-0000-000000000012'
      AND ends_at = starts_at + interval '14 days'
  ) THEN RAISE EXCEPTION 'grant duration incorrect'; END IF;
  IF public.award_referral_premium('00000000-0000-0000-0000-000000000013') <> 'premium_subscriber' THEN
    RAISE EXCEPTION 'paid Premium referrer incorrectly rewarded';
  END IF;
END $$;
