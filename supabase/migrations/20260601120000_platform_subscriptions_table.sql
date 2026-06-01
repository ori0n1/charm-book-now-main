CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  studio_id uuid REFERENCES public.studios(id) ON DELETE SET NULL,
  stripe_customer_id text NOT NULL,
  stripe_subscription_id text NOT NULL UNIQUE,
  stripe_price_id text NOT NULL,
  plan text NOT NULL CHECK (plan IN ('monthly', 'quarterly', 'yearly')),
  status text NOT NULL CHECK (
    status IN (
      'active',
      'trialing',
      'past_due',
      'canceled',
      'unpaid',
      'incomplete',
      'incomplete_expired',
      'paused'
    )
  ),
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS studio_id uuid REFERENCES public.studios(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_studio_id ON public.subscriptions(studio_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_customer_id ON public.subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON public.subscriptions(status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_live_subscription_per_user
  ON public.subscriptions(user_id)
  WHERE status IN ('active', 'trialing', 'past_due', 'incomplete');

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own subscriptions" ON public.subscriptions;
CREATE POLICY "Users read own subscriptions" ON public.subscriptions
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Studio members read subscriptions" ON public.subscriptions;
CREATE POLICY "Studio members read subscriptions" ON public.subscriptions
  FOR SELECT
  USING (studio_id IS NOT NULL AND public.is_studio_member(auth.uid(), studio_id));

COMMENT ON TABLE public.subscriptions IS 'Stripe platform subscriptions. Written only by trusted backend/service role webhook flow.';
COMMENT ON COLUMN public.subscriptions.plan IS 'Internal Bellza plan id: monthly, quarterly or yearly. Never trusted from frontend without backend Price ID validation.';
