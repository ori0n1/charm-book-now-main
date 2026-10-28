BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
-- A voided mistake remains at zero and its original value remains in the audit.
-- Restoring a purported receipt automatically could create fictitious revenue.
DROP FUNCTION IF EXISTS public.undo_mistaken_onsite_attendance_receipt(uuid,uuid,uuid,text);
NOTIFY pgrst, 'reload schema';
COMMIT;
