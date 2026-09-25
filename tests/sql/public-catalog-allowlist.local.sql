-- Run only against the disposable local/staging database after 20260919150000.
-- Never point this file at the production project.

DO $$
BEGIN
  IF to_regclass('public.public_booking_studios') IS NULL
    OR to_regclass('public.public_booking_staff') IS NULL THEN
    RAISE EXCEPTION 'public booking views missing';
  END IF;
  IF has_table_privilege('anon', 'public.public_studios', 'SELECT')
    OR has_table_privilege('authenticated', 'public.public_studios', 'SELECT')
    OR has_table_privilege('anon', 'public.public_staff', 'SELECT') THEN
    RAISE EXCEPTION 'legacy public views still accessible';
  END IF;
  IF NOT has_table_privilege('anon', 'public.public_booking_studios', 'SELECT')
    OR NOT has_table_privilege('authenticated', 'public.public_booking_studios', 'SELECT')
    OR NOT has_table_privilege('anon', 'public.public_booking_staff', 'SELECT') THEN
    RAISE EXCEPTION 'new booking views not publicly accessible';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'public_booking_studios'
      AND column_name LIKE 'stripe_%'
  ) OR EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'public_booking_staff'
      AND column_name = 'current_status'
  ) THEN
    RAISE EXCEPTION 'internal columns leaked by public booking views';
  END IF;
END;
$$;

BEGIN;
INSERT INTO public.studios(slug, name, is_active)
VALUES ('synthetic-public-allowlist-probe', 'Synthetic Public Studio', true);
SET LOCAL ROLE anon;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.public_booking_studios
      WHERE slug = 'synthetic-public-allowlist-probe') <> 1 THEN
    RAISE EXCEPTION 'published synthetic studio not visible to anon';
  END IF;
  PERFORM count(*) FROM public.public_booking_staff;
END;
$$;
ROLLBACK;
