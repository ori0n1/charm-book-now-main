alter table public.payment_intents
  add column if not exists stripe_checkout_session_id text;

create index if not exists idx_payment_intents_checkout_session
  on public.payment_intents (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;
