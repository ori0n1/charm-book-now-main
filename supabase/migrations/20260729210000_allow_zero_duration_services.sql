-- Zero-minute services represent extras, products and fees that do not consume
-- additional agenda time. A complete booking must still have a positive total
-- duration; create_public_booking already enforces that invariant.

ALTER TABLE public.services
  DROP CONSTRAINT IF EXISTS services_duration_min_check;

ALTER TABLE public.services
  ADD CONSTRAINT services_duration_min_check
  CHECK (duration_min >= 0)
  NOT VALID;

ALTER TABLE public.services
  VALIDATE CONSTRAINT services_duration_min_check;

ALTER TABLE public.upsell_offers
  DROP CONSTRAINT IF EXISTS upsell_offers_duration_min_check;

ALTER TABLE public.upsell_offers
  ADD CONSTRAINT upsell_offers_duration_min_check
  CHECK (duration_min IS NULL OR duration_min >= 0)
  NOT VALID;

ALTER TABLE public.upsell_offers
  VALIDATE CONSTRAINT upsell_offers_duration_min_check;

COMMENT ON COLUMN public.services.duration_min IS
  'Duration in minutes. Zero is allowed for extras that do not consume agenda time.';

COMMENT ON COLUMN public.upsell_offers.duration_min IS
  'Optional duration override. Null uses the service duration; zero adds no agenda time.';
