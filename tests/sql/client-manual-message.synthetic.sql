\set ON_ERROR_STOP on
CREATE SCHEMA IF NOT EXISTS auth;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END;
$$;
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
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', '11111111-1111-4111-8111-111111111111', 'manager'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3', '22222222-2222-4222-8222-222222222222', 'studio_owner');

\ir ../../supabase/migrations/20261106150000_client_manual_whatsapp_confirmations.sql

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', false);
INSERT INTO public.client_manual_whatsapp_confirmations (studio_id, client_id)
VALUES ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');

DO $$
DECLARE rejected boolean;
BEGIN
  IF (SELECT count(*) FROM public.client_manual_whatsapp_confirmations) <> 1 THEN
    RAISE EXCEPTION 'O proprietário não vê a sua confirmação';
  END IF;
  rejected := false;
  BEGIN
    INSERT INTO public.client_manual_whatsapp_confirmations (studio_id, client_id)
    VALUES ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
  EXCEPTION WHEN unique_violation THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Confirmação duplicada aceite'; END IF;
  rejected := false;
  BEGIN
    INSERT INTO public.client_manual_whatsapp_confirmations (studio_id, client_id)
    VALUES ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2');
  EXCEPTION WHEN insufficient_privilege THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Cliente de outro estúdio aceite'; END IF;
  rejected := false;
  BEGIN
    INSERT INTO public.client_manual_whatsapp_confirmations (studio_id, client_id)
    VALUES ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3');
  EXCEPTION WHEN insufficient_privilege THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Cliente arquivado aceite'; END IF;
END;
$$;

SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', false);
DO $$
DECLARE rejected boolean := false;
BEGIN
  IF (SELECT count(*) FROM public.client_manual_whatsapp_confirmations) <> 0 THEN
    RAISE EXCEPTION 'Gestor leu confirmações';
  END IF;
  BEGIN
    INSERT INTO public.client_manual_whatsapp_confirmations (studio_id, client_id)
    VALUES ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
  EXCEPTION WHEN insufficient_privilege THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Gestor confirmou mensagem'; END IF;
END;
$$;

SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3', false);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.client_manual_whatsapp_confirmations) <> 0 THEN
    RAISE EXCEPTION 'Proprietário do outro estúdio leu confirmações';
  END IF;
END;
$$;

RESET ROLE;
DELETE FROM public.client_manual_whatsapp_confirmations;
\ir ../../supabase/rollback/20261106150000_client_manual_whatsapp_confirmations.sql
SELECT 'manual WhatsApp confirmations synthetic SQL passed' AS result;
