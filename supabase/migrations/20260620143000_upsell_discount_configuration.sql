ALTER TABLE public.upsell_offers
  ADD COLUMN IF NOT EXISTS discount_type TEXT NOT NULL DEFAULT 'price'
    CHECK (discount_type IN ('price', 'percent', 'fixed')),
  ADD COLUMN IF NOT EXISTS discount_value NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS display_mode TEXT NOT NULL DEFAULT 'both'
    CHECK (display_mode IN ('percent', 'amount', 'both'));

COMMENT ON COLUMN public.upsell_offers.discount_type IS
  'How the studio configures the upsell discount: price=final price, percent=percentage off, fixed=fixed amount off.';

COMMENT ON COLUMN public.upsell_offers.discount_value IS
  'Configured discount value. Percent uses 0-100; fixed uses currency amount; price can keep null for legacy rows.';

COMMENT ON COLUMN public.upsell_offers.display_mode IS
  'How the public checkout highlights the offer: percent, amount or both.';
