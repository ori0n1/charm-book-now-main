ALTER TABLE public.studios
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS subscription_status text NOT NULL DEFAULT 'trialing',
  ADD COLUMN IF NOT EXISTS subscription_current_period_end timestamptz,
  ADD COLUMN IF NOT EXISTS subscription_cancel_at_period_end boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS premium_access_until timestamptz;

ALTER TABLE public.studios
  ADD CONSTRAINT studios_subscription_status_valid
  CHECK (
    subscription_status IN (
      'trialing',
      'active',
      'past_due',
      'canceled',
      'unpaid',
      'incomplete',
      'incomplete_expired',
      'paused'
    )
  );

CREATE INDEX IF NOT EXISTS idx_studios_stripe_customer ON public.studios(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_studios_stripe_subscription ON public.studios(stripe_subscription_id);

CREATE TABLE IF NOT EXISTS public.platform_billing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id uuid REFERENCES public.studios(id) ON DELETE SET NULL,
  stripe_event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_billing_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read platform billing events" ON public.platform_billing_events;
CREATE POLICY "Members read platform billing events" ON public.platform_billing_events
  FOR SELECT
  USING (studio_id IS NOT NULL AND public.is_studio_member(auth.uid(), studio_id));

COMMENT ON COLUMN public.studios.stripe_customer_id IS 'Stripe Customer ID usado para assinatura recorrente da plataforma.';
COMMENT ON COLUMN public.studios.stripe_subscription_id IS 'Stripe Subscription ID ativo ou mais recente.';
COMMENT ON COLUMN public.studios.subscription_status IS 'Status Stripe sincronizado por checkout/webhook.';
COMMENT ON COLUMN public.studios.premium_access_until IS 'Data limite de acesso premium quando aplicavel.';
