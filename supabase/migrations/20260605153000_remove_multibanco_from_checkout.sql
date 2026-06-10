ALTER TABLE public.studios
  ALTER COLUMN accepted_payment_methods SET DEFAULT ARRAY['mb_way','card']::text[];

UPDATE public.studios
SET accepted_payment_methods = CASE
  WHEN array_length(array_remove(accepted_payment_methods, 'multibanco'), 1) IS NULL
    THEN ARRAY['mb_way','card']::text[]
  ELSE array_remove(accepted_payment_methods, 'multibanco')
END
WHERE accepted_payment_methods @> ARRAY['multibanco']::text[];

ALTER TABLE public.studios
  DROP CONSTRAINT IF EXISTS studios_accepted_payment_methods_no_multibanco;

ALTER TABLE public.studios
  ADD CONSTRAINT studios_accepted_payment_methods_no_multibanco
  CHECK (NOT accepted_payment_methods @> ARRAY['multibanco']::text[]);

ALTER TABLE public.payment_intents
  DROP CONSTRAINT IF EXISTS payment_intents_method_check;

ALTER TABLE public.payment_intents
  ADD CONSTRAINT payment_intents_method_check
  CHECK (method IN ('mb_way','card','multibanco'));

ALTER TABLE public.payment_intents
  DROP CONSTRAINT IF EXISTS payment_intents_method_no_new_multibanco;

ALTER TABLE public.payment_intents
  ADD CONSTRAINT payment_intents_method_no_new_multibanco
  CHECK (method <> 'multibanco') NOT VALID;
