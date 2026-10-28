-- Recovery for the pre-Worker migration only. Keep nullable columns and their data.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DROP TRIGGER IF EXISTS booking_request_deposit_rule_snapshot ON public.booking_payment_requests;
DROP TRIGGER IF EXISTS appointment_deposit_rule_snapshot ON public.appointments;
DROP FUNCTION IF EXISTS public.snapshot_booking_deposit_rule();
COMMIT;
