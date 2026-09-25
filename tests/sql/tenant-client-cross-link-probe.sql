-- Disposable local-only probe. All rows are synthetic and rolled back.
BEGIN;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
VALUES (
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'tenant-a@invalid.example', 'not-a-password', now()
);
INSERT INTO public.studios (id, slug, name) VALUES
  ('00000000-0000-0000-0000-000000000101', 'synthetic-tenant-a', 'Synthetic Tenant A'),
  ('00000000-0000-0000-0000-000000000102', 'synthetic-tenant-b', 'Synthetic Tenant B');
INSERT INTO public.user_roles (user_id, studio_id, role)
VALUES ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000101', 'staff');
INSERT INTO public.staff (id, studio_id, user_id, name)
VALUES ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000201', 'Synthetic Staff A');
INSERT INTO public.clients (id, studio_id, name, phone) VALUES
  ('00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000101', 'Synthetic Client A', '+351000000001'),
  ('00000000-0000-0000-0000-000000000402', '00000000-0000-0000-0000-000000000102', 'Synthetic Client B', '+351000000002');
INSERT INTO public.appointments (
  id, studio_id, staff_id, client_id, starts_at, ends_at, studio_commission_percent_snapshot
) VALUES (
  '00000000-0000-0000-0000-000000000501',
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000301',
  '00000000-0000-0000-0000-000000000401',
  '2030-01-01T10:00:00Z', '2030-01-01T11:00:00Z', 50
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000201', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT 'foreign_client_before' AS probe, count(*) AS visible
FROM public.clients WHERE id = '00000000-0000-0000-0000-000000000402';
UPDATE public.appointments
SET client_id = '00000000-0000-0000-0000-000000000402'
WHERE id = '00000000-0000-0000-0000-000000000501';
SELECT 'foreign_client_after' AS probe, count(*) AS visible
FROM public.clients WHERE id = '00000000-0000-0000-0000-000000000402';

ROLLBACK;
