ALTER TABLE public.payment_intents
  ADD COLUMN IF NOT EXISTS stripe_connect_account_id text,
  ADD COLUMN IF NOT EXISTS stripe_charge_id text,
  ADD COLUMN IF NOT EXISTS stripe_balance_transaction_id text,
  ADD COLUMN IF NOT EXISTS gross_amount_cents integer,
  ADD COLUMN IF NOT EXISTS stripe_fee_cents integer,
  ADD COLUMN IF NOT EXISTS net_amount_cents integer,
  ADD COLUMN IF NOT EXISTS available_on timestamptz,
  ADD COLUMN IF NOT EXISTS financial_details_status text NOT NULL DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS payment_intents_stripe_connect_account_idx
  ON public.payment_intents(stripe_connect_account_id)
  WHERE stripe_connect_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payment_intents_stripe_balance_transaction_idx
  ON public.payment_intents(stripe_balance_transaction_id)
  WHERE stripe_balance_transaction_id IS NOT NULL;
