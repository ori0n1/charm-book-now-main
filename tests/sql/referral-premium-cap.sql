DO $$
DECLARE
  v_referred uuid;
  v_referral uuid;
  v_previous_end timestamptz;
  v_start timestamptz;
  v_result text;
BEGIN
  SELECT max(ends_at) INTO v_previous_end FROM public.referral_premium_grants
  WHERE studio_id = '00000000-0000-0000-0000-000000000001';
  FOR i IN 1..5 LOOP
    v_referred := gen_random_uuid();
    v_referral := gen_random_uuid();
    INSERT INTO public.studios (id, plan_tier, subscription_status,
      subscription_current_period_end)
    VALUES (v_referred, 'pro', 'active', now() + interval '1 month');
    INSERT INTO public.subscriptions (studio_id, plan_tier, status, current_period_end)
    VALUES (v_referred, 'pro', 'active', now() + interval '1 month');
    INSERT INTO public.referrals (id, referrer_studio_id, referred_studio_id,
      subscription_started_at, reward_kind)
    VALUES (v_referral, '00000000-0000-0000-0000-000000000001',
      v_referred, now() - interval '31 days', 'premium_days');
    v_result := public.award_referral_premium(v_referral);
    IF i <= 4 AND v_result <> 'granted' THEN
      RAISE EXCEPTION 'reward % should be granted; got %', i, v_result;
    END IF;
    IF i = 5 AND v_result <> 'limit_reached' THEN
      RAISE EXCEPTION 'seventh reward should be capped; got %', v_result;
    END IF;
    IF i <= 4 THEN
      SELECT starts_at INTO v_start FROM public.referral_premium_grants
      WHERE referral_id = v_referral;
      IF v_start <> v_previous_end THEN
        RAISE EXCEPTION 'reward % did not stack', i;
      END IF;
      SELECT ends_at INTO v_previous_end FROM public.referral_premium_grants
      WHERE referral_id = v_referral;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.referral_premium_grants
      WHERE studio_id = '00000000-0000-0000-0000-000000000001') <> 6 THEN
    RAISE EXCEPTION 'six reward ceiling violated';
  END IF;
END $$;
