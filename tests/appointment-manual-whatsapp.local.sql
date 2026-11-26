\set ON_ERROR_STOP on
BEGIN;

-- Minimal synthetic schema. The entire fixture is rolled back after the checks.
CREATE TABLE public.studios (id uuid PRIMARY KEY, whatsapp_auto_send_enabled boolean NOT NULL);
CREATE TABLE public.clients (id uuid PRIMARY KEY, studio_id uuid NOT NULL, archived_at timestamptz);
CREATE TABLE public.appointments (id uuid PRIMARY KEY, studio_id uuid NOT NULL, client_id uuid NOT NULL, status text NOT NULL, starts_at timestamptz NOT NULL);
CREATE TABLE public.user_roles (user_id uuid NOT NULL, studio_id uuid NOT NULL, role text NOT NULL);
CREATE TABLE public.client_manual_whatsapp_confirmations (
  studio_id uuid NOT NULL, client_id uuid NOT NULL, confirmed_by uuid NOT NULL,
  confirmed_at timestamptz NOT NULL, last_opened_at timestamptz,
  opened_at_history timestamptz[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (studio_id, client_id)
);
CREATE FUNCTION public.append_client_manual_whatsapp_open() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.opened_at_history := OLD.opened_at_history || NEW.last_opened_at;
  RETURN NEW;
END $$;
CREATE TRIGGER append_client_manual_whatsapp_open BEFORE UPDATE OF last_opened_at
  ON public.client_manual_whatsapp_confirmations FOR EACH ROW
  EXECUTE FUNCTION public.append_client_manual_whatsapp_open();

GRANT SELECT ON public.studios, public.clients, public.appointments, public.user_roles TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.client_manual_whatsapp_confirmations TO service_role;

INSERT INTO public.studios VALUES
  ('00000000-0000-0000-0000-000000000001', false),
  ('00000000-0000-0000-0000-000000000002', false),
  ('00000000-0000-0000-0000-000000000003', true);
INSERT INTO public.clients (id, studio_id) VALUES
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000003');
INSERT INTO public.appointments VALUES
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'confirmed', now() + interval '1 day'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'confirmed', now() + interval '1 day'),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 'confirmed', now() + interval '1 day'),
  ('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'cancelled', now() + interval '1 day');
INSERT INTO public.user_roles VALUES
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'studio_owner'),
  ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'studio_owner'),
  ('30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000003', 'studio_owner');

\ir ../supabase/migrations/20261126224230_appointment_manual_whatsapp_opens.sql

DO $$ BEGIN
  IF has_function_privilege('authenticated', 'public.record_appointment_manual_whatsapp_open(uuid,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can execute service-only function';
  END IF;
  IF has_table_privilege('authenticated', 'public.appointment_manual_whatsapp_opens', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated can read appointment history';
  END IF;
END $$;

SET ROLE service_role;
SELECT public.record_appointment_manual_whatsapp_open(
  '00000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001') IS NOT NULL AS owner_opened;
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.appointment_manual_whatsapp_opens;
  IF n <> 1 THEN RAISE EXCEPTION 'expected one appointment open, got %', n; END IF;
  SELECT count(*) INTO n FROM public.client_manual_whatsapp_confirmations;
  IF n <> 1 THEN RAISE EXCEPTION 'expected one client confirmation, got %', n; END IF;
  PERFORM public.record_appointment_manual_whatsapp_open('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001');
  SELECT cardinality(opened_at_history) INTO n FROM public.client_manual_whatsapp_confirmations;
  IF n <> 1 THEN RAISE EXCEPTION 'repeat open did not preserve client history'; END IF;

  BEGIN
    PERFORM public.record_appointment_manual_whatsapp_open('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'cross-studio appointment accepted';
  EXCEPTION WHEN sqlstate '22023' THEN NULL; END;
  BEGIN
    PERFORM public.record_appointment_manual_whatsapp_open('00000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'foreign studio owner accepted';
  EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
  BEGIN
    PERFORM public.record_appointment_manual_whatsapp_open('00000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003');
    RAISE EXCEPTION 'automatic studio accepted';
  EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
  BEGIN
    PERFORM public.record_appointment_manual_whatsapp_open('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'cancelled appointment accepted';
  EXCEPTION WHEN sqlstate '22023' THEN NULL; END;

  SELECT count(*) INTO n FROM public.appointment_manual_whatsapp_opens;
  IF n <> 2 THEN RAISE EXCEPTION 'denied attempts wrote appointment opens'; END IF;
END $$;
RESET ROLE;

ROLLBACK;
