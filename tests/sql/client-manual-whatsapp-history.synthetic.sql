\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA IF NOT EXISTS auth;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE TABLE public.studios (id uuid PRIMARY KEY);
CREATE TABLE public.clients (id uuid PRIMARY KEY, studio_id uuid NOT NULL, archived_at timestamptz);
CREATE TABLE public.user_roles (user_id uuid NOT NULL, studio_id uuid NOT NULL, role text NOT NULL);
GRANT SELECT ON public.clients, public.user_roles TO authenticated;
INSERT INTO public.studios VALUES
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');
INSERT INTO public.clients VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '11111111-1111-4111-8111-111111111111', NULL),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', '22222222-2222-4222-8222-222222222222', NULL),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', '11111111-1111-4111-8111-111111111111', now());
INSERT INTO public.user_roles VALUES
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', '11111111-1111-4111-8111-111111111111', 'studio_owner'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', '22222222-2222-4222-8222-222222222222', 'studio_owner');

\ir ../../supabase/migrations/20261106150000_client_manual_whatsapp_confirmations.sql
-- Mirror the broad Supabase default grant observed on the production table.
GRANT UPDATE ON public.client_manual_whatsapp_confirmations TO authenticated;
\ir ../../supabase/migrations/20261126155006_client_manual_whatsapp_history.sql

DO $$ BEGIN
  IF has_table_privilege('authenticated', 'public.client_manual_whatsapp_confirmations', 'UPDATE')
    OR has_column_privilege('authenticated', 'public.client_manual_whatsapp_confirmations', 'opened_at_history', 'UPDATE')
    OR NOT has_column_privilege('authenticated', 'public.client_manual_whatsapp_confirmations', 'last_opened_at', 'UPDATE') THEN
    RAISE EXCEPTION 'Permissões UPDATE demasiado amplas ou ausentes';
  END IF;
END $$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', true);
SELECT public.record_client_manual_whatsapp_open(
  '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
SELECT public.record_client_manual_whatsapp_open(
  '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
DO $$
DECLARE row_count int; history_count int; first_at timestamptz; latest_at timestamptz;
BEGIN
  SELECT count(*), max(cardinality(opened_at_history)), min(confirmed_at), max(last_opened_at)
  INTO row_count, history_count, first_at, latest_at
  FROM public.client_manual_whatsapp_confirmations;
  IF row_count <> 1 OR history_count <> 1 OR latest_at < first_at THEN
    RAISE EXCEPTION 'Histórico e estado recente não preservados';
  END IF;
END $$;

DO $$
DECLARE rejected boolean := false;
BEGIN
  BEGIN
    UPDATE public.client_manual_whatsapp_confirmations
    SET opened_at_history = '{}'
    WHERE studio_id = '11111111-1111-4111-8111-111111111111';
  EXCEPTION WHEN insufficient_privilege THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Histórico editável diretamente'; END IF;
END $$;

UPDATE public.client_manual_whatsapp_confirmations
SET last_opened_at = '2000-01-01T00:00:00Z'
WHERE studio_id = '11111111-1111-4111-8111-111111111111';
DO $$
BEGIN
  IF (SELECT cardinality(opened_at_history) FROM public.client_manual_whatsapp_confirmations) <> 2
    OR (SELECT last_opened_at FROM public.client_manual_whatsapp_confirmations) < now() - interval '1 minute' THEN
    RAISE EXCEPTION 'Trigger não preservou o histórico ou aceitou um horário arbitrário';
  END IF;
END $$;

DO $$
DECLARE rejected boolean := false;
BEGIN
  BEGIN
    PERFORM public.record_client_manual_whatsapp_open(
      '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2');
  EXCEPTION WHEN insufficient_privilege THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Cliente de outro estúdio aceite'; END IF;
  rejected := false;
  BEGIN
    PERFORM public.record_client_manual_whatsapp_open(
      '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3');
  EXCEPTION WHEN insufficient_privilege THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Cliente arquivado aceite'; END IF;
END $$;

SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', true);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.client_manual_whatsapp_confirmations) THEN
    RAISE EXCEPTION 'Histórico de outro estúdio visível';
  END IF;
END $$;
RESET ROLE;
ROLLBACK;
