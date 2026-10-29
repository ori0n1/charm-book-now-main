\set ON_ERROR_STOP on
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT null::uuid $$;
CREATE TABLE public.user_roles (user_id uuid, studio_id uuid, role text);
CREATE TABLE public.clients (
  id uuid PRIMARY KEY, studio_id uuid, name text, phone text, email text, notes text,
  date_of_birth date, avatar_url text, auth_user_id uuid
);
CREATE TABLE public.appointments (client_id uuid, studio_id uuid, starts_at timestamptz);
\ir ../../supabase/migrations/20261029150000_archive_client_owner_only.sql
\ir ../../supabase/rollback/20261029150000_archive_client_owner_only.sql
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'clients' AND column_name = 'archived_at') THEN
    RAISE EXCEPTION 'rollback left archive column';
  END IF;
  IF to_regprocedure('public.archive_client_for_owner(uuid,uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback left archive RPC';
  END IF;
END;
$$;
SELECT 'client archive pre-use rollback synthetic SQL passed' AS result;
