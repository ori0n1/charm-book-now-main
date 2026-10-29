-- Simulate the migration gap: an old Worker omits reward_kind.
INSERT INTO public.referrals
  (id, referrer_studio_id, referred_studio_id, subscription_started_at)
VALUES ('00000000-0000-0000-0000-000000000014',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002', now() - interval '31 days')
ON CONFLICT (id) DO NOTHING;

-- Simulate a new Worker claim that matures during compatible rollback.
INSERT INTO public.referrals
  (id, referrer_studio_id, referred_studio_id, subscription_started_at, reward_kind)
VALUES ('00000000-0000-0000-0000-000000000015',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002', now() - interval '31 days',
  'premium_days')
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF (SELECT reward_kind FROM public.referrals
      WHERE id = '00000000-0000-0000-0000-000000000014') <> 'legacy_credit' THEN
    RAISE EXCEPTION 'migration gap created Premium promise under old Worker';
  END IF;
  IF (SELECT count(*) FROM public.referral_credits
      WHERE id = '00000000-0000-0000-0000-000000000021'
        AND status = 'available') <> 1 THEN
    RAISE EXCEPTION 'historic credit changed';
  END IF;
  IF (SELECT count(*) FROM public.referral_premium_grants
      WHERE referral_id = '00000000-0000-0000-0000-000000000012') <> 1 THEN
    RAISE EXCEPTION 'acquired Premium grant lost';
  END IF;
  IF (SELECT status FROM public.referrals
      WHERE id = '00000000-0000-0000-0000-000000000015') <> 'pending_validation' THEN
    RAISE EXCEPTION 'Premium referral was not pending during rollback';
  END IF;
  IF EXISTS (SELECT 1 FROM public.referral_credits
      WHERE referral_id = '00000000-0000-0000-0000-000000000015') THEN
    RAISE EXCEPTION 'Premium referral received historic credit';
  END IF;
END $$;

-- Recovery: the same pending Premium referral can be awarded once.
DO $$
BEGIN
  IF public.award_referral_premium('00000000-0000-0000-0000-000000000015')
      <> 'granted' THEN
    RAISE EXCEPTION 'pending reward was not recoverable';
  END IF;
  IF EXISTS (SELECT 1 FROM public.referral_credits
      WHERE referral_id = '00000000-0000-0000-0000-000000000015') THEN
    RAISE EXCEPTION 'recovered Premium referral received historic credit';
  END IF;
END $$;
