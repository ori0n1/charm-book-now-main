-- Reproduced a service-category tenant link before the generic FK migration;
-- now asserts that the same direct authenticated UPDATE is rejected.
BEGIN;
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
VALUES ('00000000-0000-0000-0000-000000000211',
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'gap-owner-a@invalid.example', 'not-a-password', now());
INSERT INTO public.studios (id, slug, name, trial_ends_at) VALUES
  ('00000000-0000-0000-0000-000000000111', 'synthetic-gap-a', 'Synthetic Gap A', now() + interval '7 days'),
  ('00000000-0000-0000-0000-000000000112', 'synthetic-gap-b', 'Synthetic Gap B', now() + interval '7 days');
INSERT INTO public.user_roles (user_id, studio_id, role)
VALUES ('00000000-0000-0000-0000-000000000211',
  '00000000-0000-0000-0000-000000000111', 'studio_owner');
INSERT INTO public.service_categories (id, studio_id, label) VALUES
  ('00000000-0000-0000-0000-000000000621',
   '00000000-0000-0000-0000-000000000112', 'B category');
INSERT INTO public.services (id, studio_id, name, duration_min, price) VALUES
  ('00000000-0000-0000-0000-000000000611',
   '00000000-0000-0000-0000-000000000111', 'A service', 60, 10);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000211', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
DO $test$
BEGIN
  BEGIN
    UPDATE public.services SET category_id = '00000000-0000-0000-0000-000000000621'
    WHERE id = '00000000-0000-0000-0000-000000000611';
    RAISE EXCEPTION 'cross_tenant_category_link_was_accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'tenant_fk_mismatch: services.category_id' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'cross_tenant_category_link_rejected';
END
$test$;
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
DO $test$
BEGIN
  BEGIN
    UPDATE public.services SET category_id = '00000000-0000-0000-0000-000000000621'
    WHERE id = '00000000-0000-0000-0000-000000000611';
    RAISE EXCEPTION 'service_role_cross_tenant_category_link_was_accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'tenant_fk_mismatch: services.category_id' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'service_role_cross_tenant_category_link_rejected';
END
$test$;
ROLLBACK;
