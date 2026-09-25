-- Review-to-professional array validation, including service_role bypass of RLS.
BEGIN;
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
VALUES ('00000000-0000-0000-0000-000000000211',
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'reviewer@invalid.example', 'not-a-password', now());
INSERT INTO public.studios (id, slug, name) VALUES
  ('00000000-0000-0000-0000-000000000111', 'synthetic-review-a', 'Synthetic Review A'),
  ('00000000-0000-0000-0000-000000000112', 'synthetic-review-b', 'Synthetic Review B');
INSERT INTO public.staff (id, studio_id, name) VALUES
  ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000111', 'A staff'),
  ('00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000112', 'B staff');

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO public.studio_reviews (id, studio_id, user_id, rating, staff_ids)
VALUES ('00000000-0000-0000-0000-000000000911',
  '00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000000211', 5,
  ARRAY['00000000-0000-0000-0000-000000000301'::uuid]);
DO $test$
BEGIN
  BEGIN
    INSERT INTO public.studio_reviews (studio_id, user_id, rating, staff_ids)
    VALUES ('00000000-0000-0000-0000-000000000111',
      '00000000-0000-0000-0000-000000000211', 5,
      ARRAY['00000000-0000-0000-0000-000000000302'::uuid]);
    RAISE EXCEPTION 'foreign_review_staff_was_accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'review_staff_ids_tenant_mismatch' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.studio_reviews
    SET staff_ids = ARRAY['00000000-0000-0000-0000-000000000999'::uuid]
    WHERE id = '00000000-0000-0000-0000-000000000911';
    RAISE EXCEPTION 'missing_review_staff_was_accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'review_staff_ids_tenant_mismatch' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'review_staff_array_guard_passed';
END
$test$;
ROLLBACK;
