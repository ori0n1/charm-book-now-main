-- Prevent trial reuse and reserve subscription checkout sessions safely.
-- Idempotent and non-destructive: only adds metadata/status support.

ALTER TABLE public.studios
  ADD COLUMN IF NOT EXISTS trial_used_at timestamptz;

COMMENT ON COLUMN public.studios.trial_used_at IS
  'When trial was first claimed. Prevents infinite trial reuse exploit.';

CREATE INDEX IF NOT EXISTS idx_studios_trial_used_at
  ON public.studios(trial_used_at);

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_status_check;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_status_check
  CHECK (
    status IN (
      'active',
      'trialing',
      'past_due',
      'canceled',
      'unpaid',
      'incomplete',
      'incomplete_expired',
      'paused',
      'checkout_pending'
    )
  );

DROP INDEX IF EXISTS public.idx_one_live_subscription_per_studio;
DROP INDEX IF EXISTS public.idx_one_live_subscription_without_studio_per_user;

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_live_subscription_per_studio
  ON public.subscriptions(studio_id)
  WHERE studio_id IS NOT NULL
    AND status IN ('active', 'trialing', 'past_due', 'incomplete', 'checkout_pending');

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_live_subscription_without_studio_per_user
  ON public.subscriptions(user_id)
  WHERE studio_id IS NULL
    AND status IN ('active', 'trialing', 'past_due', 'incomplete', 'checkout_pending');
