DROP INDEX IF EXISTS public.idx_one_live_subscription_per_user;

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_live_subscription_per_studio
ON public.subscriptions(studio_id)
WHERE studio_id IS NOT NULL
  AND status IN ('active', 'trialing', 'past_due', 'incomplete');

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_live_subscription_without_studio_per_user
ON public.subscriptions(user_id)
WHERE studio_id IS NULL
  AND status IN ('active', 'trialing', 'past_due', 'incomplete');
