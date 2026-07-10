ALTER TABLE public.push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_endpoint_key;

DROP INDEX IF EXISTS push_subscriptions_endpoint_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint_studio
  ON public.push_subscriptions(endpoint, studio_id);
