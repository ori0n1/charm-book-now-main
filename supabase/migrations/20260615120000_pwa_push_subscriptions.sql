CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  studio_id uuid REFERENCES public.studios(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  audience text NOT NULL,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  expiration_time bigint,
  user_agent text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT push_subscriptions_audience_check CHECK (audience IN ('client', 'studio'))
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON public.push_subscriptions(user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_studio_audience
  ON public.push_subscriptions(studio_id, audience)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_client
  ON public.push_subscriptions(client_id)
  WHERE client_id IS NOT NULL AND revoked_at IS NULL;

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users read own push subscriptions"
  ON public.push_subscriptions
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users delete own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users delete own push subscriptions"
  ON public.push_subscriptions
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
