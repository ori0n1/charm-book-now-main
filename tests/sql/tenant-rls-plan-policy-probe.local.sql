-- Demonstrates current permissive plan policies using only synthetic local rows.
-- Must never run against a linked or production database.
BEGIN;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
VALUES ('00000000-0000-0000-0000-000000000211',
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'rls-owner-a@invalid.example', 'not-a-password', now());
INSERT INTO public.studios (id, slug, name, trial_ends_at) VALUES
  ('00000000-0000-0000-0000-000000000111', 'synthetic-rls-a', 'Synthetic RLS A', now() + interval '7 days'),
  ('00000000-0000-0000-0000-000000000112', 'synthetic-rls-b', 'Synthetic RLS B', now() + interval '7 days');
INSERT INTO public.user_roles (user_id, studio_id, role) VALUES
  ('00000000-0000-0000-0000-000000000211',
   '00000000-0000-0000-0000-000000000111', 'studio_owner');
INSERT INTO public.staff (id, studio_id, name) VALUES
  ('00000000-0000-0000-0000-000000000311',
   '00000000-0000-0000-0000-000000000112', 'Synthetic B Professional');
INSERT INTO public.services (id, studio_id, name, duration_min, price) VALUES
  ('00000000-0000-0000-0000-000000000611',
   '00000000-0000-0000-0000-000000000112', 'Synthetic B Service', 60, 10);
INSERT INTO public.booking_payment_requests (
  id, studio_id, staff_id, service_ids, starts_at, ends_at, client_name, client_phone
) VALUES ('00000000-0000-0000-0000-000000000711',
  '00000000-0000-0000-0000-000000000112',
  '00000000-0000-0000-0000-000000000311',
  ARRAY['00000000-0000-0000-0000-000000000611'::uuid],
  '2030-01-02T10:00:00Z', '2030-01-02T11:00:00Z',
  'Synthetic B Client', '+351000000002');
INSERT INTO public.payment_intents (id, studio_id, booking_request_id, amount_cents, method)
VALUES ('00000000-0000-0000-0000-000000000811',
  '00000000-0000-0000-0000-000000000112',
  '00000000-0000-0000-0000-000000000711', 1000, 'card');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000211', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT 'foreign_staff_read' AS probe, count(*) FROM public.staff
WHERE id = '00000000-0000-0000-0000-000000000311';
SELECT 'foreign_booking_read' AS probe, count(*) FROM public.booking_payment_requests
WHERE id = '00000000-0000-0000-0000-000000000711';
SELECT 'foreign_payment_read' AS probe, count(*) FROM public.payment_intents
WHERE id = '00000000-0000-0000-0000-000000000811';
UPDATE public.staff SET name = 'Tampered by A'
WHERE id = '00000000-0000-0000-0000-000000000311';
ROLLBACK;
