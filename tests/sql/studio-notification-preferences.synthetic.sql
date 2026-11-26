\set ON_ERROR_STOP on

CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE TABLE public.studios (id uuid PRIMARY KEY);
CREATE TABLE public.user_roles (studio_id uuid NOT NULL, user_id uuid NOT NULL, role text NOT NULL);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END $$;
GRANT USAGE ON SCHEMA auth, public TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
GRANT SELECT ON public.user_roles TO authenticated;

INSERT INTO auth.users VALUES
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000003');
INSERT INTO public.studios VALUES
  ('10000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002');
INSERT INTO public.user_roles VALUES
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'studio_owner'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'studio_owner'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', 'staff');

\ir ../../supabase/migrations/20261126101758_studio_notification_preferences.sql

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
INSERT INTO public.studio_notification_preferences (studio_id, user_id, category, enabled)
VALUES ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'payments', false);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.studio_notification_preferences) <> 1 THEN
    RAISE EXCEPTION 'owner_cannot_read_own_preference';
  END IF;
  BEGIN
    INSERT INTO public.studio_notification_preferences (studio_id, user_id, category, enabled)
    VALUES ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'payments', false);
    RAISE EXCEPTION 'cross_user_insert_allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.studio_notification_preferences (studio_id, user_id, category, enabled)
    VALUES ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'payments', false);
    RAISE EXCEPTION 'other_studio_insert_allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.studio_notification_preferences) <> 0 THEN
    RAISE EXCEPTION 'second_owner_sees_first_owner_preferences';
  END IF;
END $$;
INSERT INTO public.studio_notification_preferences (studio_id, user_id, category, enabled)
VALUES ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'payments', true);
DO $$ DECLARE updated integer; BEGIN
  UPDATE public.studio_notification_preferences SET enabled = true
  WHERE user_id = '00000000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS updated = ROW_COUNT;
  IF updated <> 0 THEN RAISE EXCEPTION 'cross_user_update_allowed'; END IF;
END $$;

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.studio_notification_preferences) <> 0 THEN
    RAISE EXCEPTION 'staff_sees_owner_preferences';
  END IF;
  BEGIN
    INSERT INTO public.studio_notification_preferences (studio_id, user_id, category, enabled)
    VALUES ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', 'payments', false);
    RAISE EXCEPTION 'staff_insert_allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
SELECT 'STUDIO_NOTIFICATION_PREFERENCES_RLS_OK' AS result;
