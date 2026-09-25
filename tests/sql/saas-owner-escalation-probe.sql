-- Disposable local-only probe; all synthetic records are rolled back.
BEGIN;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
VALUES (
  '00000000-0000-0000-0000-000000000211',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'owner-a@invalid.example', 'not-a-password', now()
);
INSERT INTO public.studios (id, slug, name, trial_ends_at)
VALUES ('00000000-0000-0000-0000-000000000111',
  'synthetic-owner-a', 'Synthetic Owner A', now() + interval '7 days');
INSERT INTO public.user_roles (user_id, studio_id, role)
VALUES ('00000000-0000-0000-0000-000000000211',
  '00000000-0000-0000-0000-000000000111', 'studio_owner');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000211', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT 'saas_owner_before' AS probe, public.is_saas_owner() AS value;
INSERT INTO public.user_roles (user_id, studio_id, role)
VALUES ('00000000-0000-0000-0000-000000000211',
  '00000000-0000-0000-0000-000000000111', 'saas_owner');
SELECT 'saas_owner_after' AS probe, public.is_saas_owner() AS value;

ROLLBACK;
