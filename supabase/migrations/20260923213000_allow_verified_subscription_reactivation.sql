-- Stripe is the source of truth for subscription cancellation state. These
-- legacy monotonic triggers made a legitimate `true -> false` transition
-- impossible even after Stripe confirmed a reactivation. Webhook and billing
-- server functions retrieve the current Stripe subscription before persisting
-- it, so delayed events cannot reintroduce stale cancellation state.

-- Subscription rows are server-managed. Remove browser mutation privileges
-- before removing the legacy trigger; tenant members retain their existing
-- RLS-scoped SELECT access.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.subscriptions
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS preserve_cancel_flag ON public.subscriptions;
DROP TRIGGER IF EXISTS preserve_studio_cancel_flag ON public.studios;

DROP FUNCTION IF EXISTS public.preserve_cancel_at_period_end();
DROP FUNCTION IF EXISTS public.preserve_studio_cancel_at_period_end();

COMMENT ON COLUMN public.subscriptions.cancel_at_period_end IS
  'Stripe-authoritative cancellation flag; writes are restricted to trusted server roles.';

COMMENT ON COLUMN public.studios.subscription_cancel_at_period_end IS
  'Stripe-authoritative cancellation flag; browser writes remain blocked by the platform-field guard.';
