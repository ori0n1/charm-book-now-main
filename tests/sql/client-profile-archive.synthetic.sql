\set ON_ERROR_STOP on
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE TABLE public.user_roles (user_id uuid NOT NULL, studio_id uuid NOT NULL, role text NOT NULL);
CREATE TABLE public.clients (
  id uuid PRIMARY KEY, studio_id uuid NOT NULL, name text NOT NULL, phone text NOT NULL,
  email text, notes text, date_of_birth date, avatar_url text, auth_user_id uuid,
  UNIQUE (studio_id, phone)
);
CREATE TABLE public.appointments (
  id uuid PRIMARY KEY, studio_id uuid NOT NULL, client_id uuid NOT NULL REFERENCES public.clients(id),
  starts_at timestamptz NOT NULL
);
CREATE TABLE public.payments (id uuid PRIMARY KEY, appointment_id uuid NOT NULL REFERENCES public.appointments(id), amount numeric NOT NULL);

INSERT INTO public.user_roles VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'studio_owner'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111', 'manager'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '22222222-2222-4222-8222-222222222222', 'studio_owner');
INSERT INTO public.clients (id, studio_id, name, phone, email, notes, auth_user_id) VALUES
  ('00000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Cliente sintética', '900000001', 'qa@example.test', 'nota sintética', NULL),
  ('00000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Conta ligada', '900000002', NULL, NULL, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
  ('00000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Marcação futura', '900000003', NULL, NULL, NULL),
  ('00000000-0000-4000-8000-000000000004', '22222222-2222-4222-8222-222222222222', 'Outro estúdio', '900000004', NULL, NULL, NULL);
INSERT INTO public.appointments VALUES
  ('10000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-000000000001', now() - interval '1 day'),
  ('10000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-000000000003', now() + interval '1 day');
INSERT INTO public.payments VALUES ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 42);

\ir ../../supabase/migrations/20261029150000_archive_client_owner_only.sql

DO $$
DECLARE blocked boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', false);
  blocked := false;
  BEGIN
    PERFORM public.archive_client_for_owner('11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-000000000001', 'EXCLUIR');
  EXCEPTION WHEN others THEN blocked := SQLERRM = 'studio_owner_required'; END;
  IF NOT blocked THEN RAISE EXCEPTION 'manager RPC was not denied'; END IF;
  blocked := false;
  BEGIN
    UPDATE public.clients SET archived_at = now() WHERE id = '00000000-0000-4000-8000-000000000001';
  EXCEPTION WHEN others THEN blocked := SQLERRM = 'studio_owner_required'; END;
  IF NOT blocked THEN RAISE EXCEPTION 'manager direct update was not denied'; END IF;

  PERFORM set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false);
  blocked := false;
  BEGIN
    PERFORM public.archive_client_for_owner('22222222-2222-4222-8222-222222222222', '00000000-0000-4000-8000-000000000004', 'EXCLUIR');
  EXCEPTION WHEN others THEN blocked := SQLERRM = 'studio_owner_required'; END;
  IF NOT blocked THEN RAISE EXCEPTION 'cross-studio RPC was not denied'; END IF;
  blocked := false;
  BEGIN
    PERFORM public.archive_client_for_owner('11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-000000000002', 'EXCLUIR');
  EXCEPTION WHEN others THEN blocked := SQLERRM = 'client_archive_linked_account'; END;
  IF NOT blocked THEN RAISE EXCEPTION 'linked account was not protected'; END IF;
  blocked := false;
  BEGIN
    PERFORM public.archive_client_for_owner('11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-000000000003', 'EXCLUIR');
  EXCEPTION WHEN others THEN blocked := SQLERRM = 'client_archive_future_appointment'; END;
  IF NOT blocked THEN RAISE EXCEPTION 'future appointment was not protected'; END IF;

  PERFORM public.archive_client_for_owner('11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-000000000001', 'EXCLUIR');
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = '00000000-0000-4000-8000-000000000001' AND archived_at IS NOT NULL AND name = 'Cliente excluído' AND email IS NULL AND notes IS NULL AND phone = '00000000000040008000000000000001') THEN
    RAISE EXCEPTION 'profile was not anonymized';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.appointments WHERE id = '10000000-0000-4000-8000-000000000001') OR NOT EXISTS (SELECT 1 FROM public.payments WHERE id = '20000000-0000-4000-8000-000000000001' AND amount = 42) THEN
    RAISE EXCEPTION 'historical financial records changed';
  END IF;
  blocked := false;
  BEGIN
    UPDATE public.clients SET name = 'Reidentificada' WHERE id = '00000000-0000-4000-8000-000000000001';
  EXCEPTION WHEN others THEN blocked := SQLERRM = 'client_archived_readonly'; END;
  IF NOT blocked THEN RAISE EXCEPTION 'archived profile could be reidentified'; END IF;
  blocked := false;
  BEGIN
    DELETE FROM public.clients WHERE id = '00000000-0000-4000-8000-000000000001';
  EXCEPTION WHEN others THEN blocked := SQLERRM = 'client_hard_delete_forbidden'; END;
  IF NOT blocked THEN RAISE EXCEPTION 'direct hard delete was not denied'; END IF;
END;
$$;
SELECT 'client archive synthetic SQL passed' AS result;
