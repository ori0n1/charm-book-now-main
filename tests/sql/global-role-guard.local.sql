-- Local-only regression: studio team management still works, global-role
-- writes require a server/admin context. Synthetic rows are rolled back.
BEGIN;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
VALUES
  ('00000000-0000-0000-0000-000000000211',
   '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'owner-a@invalid.example', 'not-a-password', now()),
  ('00000000-0000-0000-0000-000000000212',
   '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'member-a@invalid.example', 'not-a-password', now());
INSERT INTO public.studios (id, slug, name, trial_ends_at)
VALUES ('00000000-0000-0000-0000-000000000111',
  'synthetic-owner-a', 'Synthetic Owner A', now() + interval '7 days');
INSERT INTO public.user_roles (user_id, studio_id, role)
VALUES ('00000000-0000-0000-0000-000000000211',
  '00000000-0000-0000-0000-000000000111', 'studio_owner');
INSERT INTO public.user_roles (user_id, studio_id, role)
VALUES ('00000000-0000-0000-0000-000000000212',
  '00000000-0000-0000-0000-000000000111', 'saas_owner');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000211', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

INSERT INTO public.user_roles (user_id, studio_id, role)
VALUES ('00000000-0000-0000-0000-000000000212',
  '00000000-0000-0000-0000-000000000111', 'staff');
DO $test$
BEGIN
  BEGIN
    INSERT INTO public.user_roles (user_id, studio_id, role)
    VALUES ('00000000-0000-0000-0000-000000000211',
      '00000000-0000-0000-0000-000000000111', 'saas_owner');
    RAISE EXCEPTION 'self_global_escalation_was_accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'global_role_server_only' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.user_roles (user_id, studio_id, role)
    VALUES ('00000000-0000-0000-0000-000000000212',
      '00000000-0000-0000-0000-000000000111', 'saas_owner');
    RAISE EXCEPTION 'other_user_global_escalation_was_accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'global_role_server_only' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.user_roles SET role = 'saas_owner'
    WHERE user_id = '00000000-0000-0000-0000-000000000212' AND role = 'staff';
    RAISE EXCEPTION 'global_role_update_was_accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'global_role_server_only' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM public.user_roles
    WHERE user_id = '00000000-0000-0000-0000-000000000212' AND role = 'saas_owner';
    RAISE EXCEPTION 'global_role_delete_was_accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'global_role_server_only' THEN RAISE; END IF;
  END;
  IF public.is_saas_owner() THEN RAISE EXCEPTION 'owner_escalated_after_rejected_write'; END IF;
  IF has_function_privilege('authenticated', 'public.user_studio_ids(uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.user_studio_ids(uuid)', 'EXECUTE')
  THEN RAISE EXCEPTION 'membership_oracle_rpc_still_exposed'; END IF;
  RAISE NOTICE 'authenticated_global_role_guards_passed';
END
$test$;

RESET ROLE;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO public.user_roles (user_id, studio_id, role)
VALUES ('00000000-0000-0000-0000-000000000211',
  '00000000-0000-0000-0000-000000000111', 'saas_owner');
SELECT 'server_global_role_write' AS probe,
  count(*) AS rows_created FROM public.user_roles
  WHERE user_id = '00000000-0000-0000-0000-000000000211' AND role = 'saas_owner';

ROLLBACK;
