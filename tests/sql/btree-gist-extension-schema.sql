DO $test$
DECLARE
  extension_schema text;
  invalid_constraint_count integer;
BEGIN
  SELECT namespace.nspname
  INTO extension_schema
  FROM pg_extension AS extension_row
  JOIN pg_namespace AS namespace ON namespace.oid = extension_row.extnamespace
  WHERE extension_row.extname = 'btree_gist';

  IF extension_schema IS DISTINCT FROM 'extensions' THEN
    RAISE EXCEPTION 'btree_gist_wrong_schema: %', extension_schema;
  END IF;

  SELECT count(*)
  INTO invalid_constraint_count
  FROM pg_constraint
  WHERE contype = 'x'
    AND conname IN (
      'booking_payment_requests_no_active_overlap',
      'no_overlap_active_booking_payment_requests'
    )
    AND NOT convalidated;

  IF invalid_constraint_count <> 0 THEN
    RAISE EXCEPTION 'invalid_booking_exclusion_constraints: %', invalid_constraint_count;
  END IF;
END
$test$;

BEGIN;

CREATE TEMPORARY TABLE btree_gist_relocation_probe (
  staff_id uuid NOT NULL,
  occupied_range tstzrange NOT NULL,
  EXCLUDE USING gist (staff_id WITH =, occupied_range WITH &&)
);

INSERT INTO btree_gist_relocation_probe (staff_id, occupied_range)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  tstzrange('2026-09-22 09:00:00+00', '2026-09-22 10:00:00+00', '[)')
);

DO $test$
BEGIN
  BEGIN
    INSERT INTO btree_gist_relocation_probe (staff_id, occupied_range)
    VALUES (
      '00000000-0000-0000-0000-000000000001',
      tstzrange('2026-09-22 09:30:00+00', '2026-09-22 10:30:00+00', '[)')
    );
    RAISE EXCEPTION 'btree_gist_overlap_was_accepted';
  EXCEPTION
    WHEN exclusion_violation THEN
      NULL;
  END;
END
$test$;

ROLLBACK;
