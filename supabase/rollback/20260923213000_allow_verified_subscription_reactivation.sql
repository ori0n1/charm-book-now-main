BEGIN;

REVOKE ALL PRIVILEGES ON TABLE public.subscriptions FROM PUBLIC, anon, authenticated;
GRANT SELECT, MAINTAIN ON TABLE public.subscriptions TO authenticated;

CREATE OR REPLACE FUNCTION public.preserve_cancel_at_period_end()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS E'\r\nBEGIN\r\n  IF OLD.cancel_at_period_end = true AND NEW.cancel_at_period_end = false THEN\r\n    NEW.cancel_at_period_end := true;\r\n  END IF;\r\n  RETURN NEW;\r\nEND;\r\n';

CREATE OR REPLACE FUNCTION public.preserve_studio_cancel_at_period_end()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS E'\r\nBEGIN\r\n  IF OLD.subscription_cancel_at_period_end = true AND NEW.subscription_cancel_at_period_end = false THEN\r\n    NEW.subscription_cancel_at_period_end := true;\r\n  END IF;\r\n  RETURN NEW;\r\nEND;\r\n';

ALTER FUNCTION public.preserve_cancel_at_period_end() OWNER TO postgres;
ALTER FUNCTION public.preserve_studio_cancel_at_period_end() OWNER TO postgres;

REVOKE ALL PRIVILEGES ON FUNCTION public.preserve_cancel_at_period_end()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.preserve_studio_cancel_at_period_end()
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.preserve_cancel_at_period_end()
  TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.preserve_studio_cancel_at_period_end()
  TO PUBLIC, anon, authenticated, service_role;

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
