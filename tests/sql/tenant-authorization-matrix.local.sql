-- Local-only, synthetic two-studio RLS regression. Nothing commits.
BEGIN;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
VALUES ('00000000-0000-0000-0000-000000000211',
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'matrix-owner-a@invalid.example', 'not-a-password', now());
INSERT INTO public.studios (id, slug, name, trial_ends_at) VALUES
  ('00000000-0000-0000-0000-000000000111', 'synthetic-matrix-a', 'Synthetic Matrix A', now() + interval '7 days'),
  ('00000000-0000-0000-0000-000000000112', 'synthetic-matrix-b', 'Synthetic Matrix B', now() + interval '7 days');
INSERT INTO public.user_roles (user_id, studio_id, role) VALUES
  ('00000000-0000-0000-0000-000000000211',
   '00000000-0000-0000-0000-000000000111', 'studio_owner');
INSERT INTO public.staff (id, studio_id, name) VALUES
  ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000111', 'A staff'),
  ('00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000112', 'B staff');
INSERT INTO public.clients (id, studio_id, name, phone) VALUES
  ('00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000111', 'A client', '+351000000001'),
  ('00000000-0000-0000-0000-000000000402', '00000000-0000-0000-0000-000000000112', 'B client', '+351000000002');
INSERT INTO public.services (id, studio_id, name, duration_min, price) VALUES
  ('00000000-0000-0000-0000-000000000601', '00000000-0000-0000-0000-000000000111', 'A service', 60, 10),
  ('00000000-0000-0000-0000-000000000602', '00000000-0000-0000-0000-000000000112', 'B service', 60, 10);
INSERT INTO public.appointments (
  id, studio_id, staff_id, client_id, starts_at, ends_at, studio_commission_percent_snapshot
) VALUES
  ('00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000111',
   '00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000401',
   '2030-01-01T10:00:00Z', '2030-01-01T11:00:00Z', 50),
  ('00000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-000000000112',
   '00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000402',
   '2030-01-01T10:00:00Z', '2030-01-01T11:00:00Z', 50);
INSERT INTO public.booking_payment_requests (
  id, studio_id, staff_id, service_ids, starts_at, ends_at, client_name, client_phone
) VALUES ('00000000-0000-0000-0000-000000000701',
  '00000000-0000-0000-0000-000000000112',
  '00000000-0000-0000-0000-000000000302',
  ARRAY['00000000-0000-0000-0000-000000000602'::uuid],
  '2030-01-02T10:00:00Z', '2030-01-02T11:00:00Z', 'B client', '+351000000002');
INSERT INTO public.payment_intents (id, studio_id, booking_request_id, amount_cents, method)
VALUES ('00000000-0000-0000-0000-000000000801',
  '00000000-0000-0000-0000-000000000112',
  '00000000-0000-0000-0000-000000000701', 1000, 'card');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000211', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

DO $test$
DECLARE affected integer;
BEGIN
  IF (SELECT count(*) FROM public.clients WHERE id = '00000000-0000-0000-0000-000000000402') <> 0
    OR (SELECT count(*) FROM public.staff WHERE id = '00000000-0000-0000-0000-000000000302') <> 0
    OR (SELECT count(*) FROM public.services WHERE id = '00000000-0000-0000-0000-000000000602') <> 0
    OR (SELECT count(*) FROM public.appointments WHERE id = '00000000-0000-0000-0000-000000000502') <> 0
    OR (SELECT count(*) FROM public.booking_payment_requests WHERE id = '00000000-0000-0000-0000-000000000701') <> 0
    OR (SELECT count(*) FROM public.payment_intents WHERE id = '00000000-0000-0000-0000-000000000801') <> 0
  THEN RAISE EXCEPTION 'foreign_studio_read_was_allowed'; END IF;

  UPDATE public.clients SET name = 'tampered' WHERE id = '00000000-0000-0000-0000-000000000402';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'foreign_client_update_was_allowed'; END IF;
  UPDATE public.staff SET name = 'tampered' WHERE id = '00000000-0000-0000-0000-000000000302';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'foreign_staff_update_was_allowed'; END IF;
  UPDATE public.services SET name = 'tampered' WHERE id = '00000000-0000-0000-0000-000000000602';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'foreign_service_update_was_allowed'; END IF;
  UPDATE public.appointments SET notes = 'tampered' WHERE id = '00000000-0000-0000-0000-000000000502';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'foreign_appointment_update_was_allowed'; END IF;
  DELETE FROM public.clients WHERE id = '00000000-0000-0000-0000-000000000402';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'foreign_client_delete_was_allowed'; END IF;
  DELETE FROM public.staff WHERE id = '00000000-0000-0000-0000-000000000302';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'foreign_staff_delete_was_allowed'; END IF;
  DELETE FROM public.appointments WHERE id = '00000000-0000-0000-0000-000000000502';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'foreign_appointment_delete_was_allowed'; END IF;

  BEGIN
    INSERT INTO public.clients (studio_id, name, phone)
    VALUES ('00000000-0000-0000-0000-000000000112', 'intruder', '+351000000099');
    RAISE EXCEPTION 'foreign_client_insert_was_allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.staff (studio_id, name)
    VALUES ('00000000-0000-0000-0000-000000000112', 'intruder');
    RAISE EXCEPTION 'foreign_staff_insert_was_allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.services (studio_id, name, duration_min, price)
    VALUES ('00000000-0000-0000-0000-000000000112', 'intruder', 60, 10);
    RAISE EXCEPTION 'foreign_service_insert_was_allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  UPDATE public.clients SET name = 'A client updated'
  WHERE id = '00000000-0000-0000-0000-000000000401';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'own_client_update_broken'; END IF;
  UPDATE public.staff SET name = 'A staff updated'
  WHERE id = '00000000-0000-0000-0000-000000000301';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'own_staff_update_broken'; END IF;
  IF (SELECT count(*) FROM public.appointments WHERE id = '00000000-0000-0000-0000-000000000501') <> 1
  THEN RAISE EXCEPTION 'own_appointment_read_broken'; END IF;
  RAISE NOTICE 'tenant_rls_authorization_matrix_passed';
END
$test$;

ROLLBACK;
