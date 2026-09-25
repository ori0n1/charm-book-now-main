-- Prospective deletion safety; synthetic data, transaction never commits.
BEGIN;
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
VALUES ('00000000-0000-0000-0000-000000000211',
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'history-owner@invalid.example', 'not-a-password', now());
INSERT INTO public.studios (id, slug, name, trial_ends_at)
VALUES ('00000000-0000-0000-0000-000000000111',
  'synthetic-history-a', 'Synthetic History A', now() + interval '7 days');
INSERT INTO public.user_roles (user_id, studio_id, role)
VALUES ('00000000-0000-0000-0000-000000000211',
  '00000000-0000-0000-0000-000000000111', 'studio_owner');
INSERT INTO public.staff (id, studio_id, name)
VALUES ('00000000-0000-0000-0000-000000000301',
  '00000000-0000-0000-0000-000000000111', 'History staff');
INSERT INTO public.services (id, studio_id, name, duration_min, price) VALUES
  ('00000000-0000-0000-0000-000000000601',
   '00000000-0000-0000-0000-000000000111', 'Historic service', 60, 10),
  ('00000000-0000-0000-0000-000000000602',
   '00000000-0000-0000-0000-000000000111', 'Unused service', 60, 10);
INSERT INTO public.booking_payment_requests (
  id, studio_id, staff_id, service_ids, starts_at, ends_at, client_name, client_phone, status
) VALUES ('00000000-0000-0000-0000-000000000701',
  '00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000000301',
  ARRAY['00000000-0000-0000-0000-000000000601'::uuid],
  '2030-01-02T10:00:00Z', '2030-01-02T11:00:00Z',
  'History client', '+351000000001', 'expired');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000211', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
DO $test$
DECLARE outcome text;
BEGIN
  SELECT public.remove_or_archive_service(
    '00000000-0000-0000-0000-000000000111',
    '00000000-0000-0000-0000-000000000601') INTO outcome;
  IF outcome <> 'archived' THEN RAISE EXCEPTION 'historic_service_not_archived'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.services
    WHERE id = '00000000-0000-0000-0000-000000000601' AND is_active = false)
  THEN RAISE EXCEPTION 'historic_service_was_deleted'; END IF;
  SELECT public.remove_or_archive_service(
    '00000000-0000-0000-0000-000000000111',
    '00000000-0000-0000-0000-000000000602') INTO outcome;
  IF outcome <> 'deleted' THEN RAISE EXCEPTION 'unused_service_not_deleted'; END IF;
  RAISE NOTICE 'archive_historic_delete_unused_passed';
END
$test$;

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
DO $test$
BEGIN
  BEGIN
    DELETE FROM public.services
    WHERE id = '00000000-0000-0000-0000-000000000601';
    RAISE EXCEPTION 'service_role_deleted_historic_service';
  EXCEPTION WHEN foreign_key_violation THEN
    IF SQLERRM <> 'service_referenced_by_booking_history' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'service_role_historic_delete_rejected';
END
$test$;
ROLLBACK;
