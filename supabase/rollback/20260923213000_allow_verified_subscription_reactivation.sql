BEGIN;

GRANT ALL PRIVILEGES ON TABLE public.subscriptions TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.preserve_cancel_at_period_end()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF OLD.cancel_at_period_end = true AND NEW.cancel_at_period_end = false THEN
    NEW.cancel_at_period_end := true;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.preserve_studio_cancel_at_period_end()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF OLD.subscription_cancel_at_period_end = true AND NEW.subscription_cancel_at_period_end = false THEN
    NEW.subscription_cancel_at_period_end := true;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS preserve_cancel_flag ON public.subscriptions;
CREATE TRIGGER preserve_cancel_flag
BEFORE UPDATE ON public.subscriptions
FOR EACH ROW EXECUTE FUNCTION public.preserve_cancel_at_period_end();

DROP TRIGGER IF EXISTS preserve_studio_cancel_flag ON public.studios;
CREATE TRIGGER preserve_studio_cancel_flag
BEFORE UPDATE ON public.studios
FOR EACH ROW EXECUTE FUNCTION public.preserve_studio_cancel_at_period_end();

COMMENT ON COLUMN public.subscriptions.cancel_at_period_end IS NULL;
COMMENT ON COLUMN public.studios.subscription_cancel_at_period_end IS NULL;

COMMIT;
