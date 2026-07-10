ALTER TABLE public.push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_audience_check;

ALTER TABLE public.push_subscriptions
  ADD CONSTRAINT push_subscriptions_audience_check
  CHECK (audience IN ('client', 'studio', 'both'));
