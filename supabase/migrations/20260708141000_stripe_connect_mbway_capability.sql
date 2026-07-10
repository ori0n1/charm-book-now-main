ALTER TABLE public.studios
  ADD COLUMN IF NOT EXISTS stripe_connect_mb_way_payments_enabled boolean NOT NULL DEFAULT false;
