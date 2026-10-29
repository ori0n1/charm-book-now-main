CREATE TABLE public.studios (
  id uuid PRIMARY KEY,
  is_active boolean NOT NULL DEFAULT true,
  plan_tier text,
  subscription_status text,
  subscription_current_period_end timestamptz,
  premium_access_until timestamptz,
  trial_ends_at timestamptz,
  trial_used_at timestamptz
);
CREATE TABLE public.subscriptions (
  studio_id uuid NOT NULL,
  plan_tier text,
  status text,
  current_period_end timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.referrals (
  id uuid PRIMARY KEY,
  referrer_studio_id uuid NOT NULL REFERENCES public.studios(id),
  referred_studio_id uuid NOT NULL REFERENCES public.studios(id),
  status text NOT NULL DEFAULT 'pending_validation',
  created_at timestamptz NOT NULL DEFAULT now(),
  subscription_started_at timestamptz,
  validated_at timestamptz,
  credited_at timestamptz
);
CREATE TABLE public.referral_credits (
  id uuid PRIMARY KEY,
  studio_id uuid NOT NULL REFERENCES public.studios(id),
  referral_id uuid REFERENCES public.referrals(id),
  status text NOT NULL
);
INSERT INTO public.studios (id, plan_tier, subscription_status, subscription_current_period_end)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'pro', 'active', now() + interval '1 month'),
  ('00000000-0000-0000-0000-000000000002', 'pro', 'active', now() + interval '1 month'),
  ('00000000-0000-0000-0000-000000000003', 'premium', 'active', now() + interval '1 month');
INSERT INTO public.subscriptions (studio_id, plan_tier, status, current_period_end)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'pro', 'active', now() + interval '1 month'),
  ('00000000-0000-0000-0000-000000000002', 'pro', 'active', now() + interval '1 month'),
  ('00000000-0000-0000-0000-000000000003', 'premium', 'active', now() + interval '1 month');
INSERT INTO public.referrals
  (id, referrer_studio_id, referred_studio_id, subscription_started_at)
VALUES
  ('00000000-0000-0000-0000-000000000011',
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000002', now() - interval '31 days');
INSERT INTO public.referral_credits (id, studio_id, status)
VALUES ('00000000-0000-0000-0000-000000000021',
  '00000000-0000-0000-0000-000000000003', 'available');
