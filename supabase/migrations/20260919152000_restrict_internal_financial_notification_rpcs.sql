-- These internal SECURITY DEFINER RPCs are invoked by server code with
-- service_role (and by trusted database functions), never directly by a
-- browser role. The observed baseline granted EXECUTE to anon/authenticated.
-- No data is rewritten; production rollout requires a fresh privilege audit.

REVOKE EXECUTE ON FUNCTION public.confirm_paid_booking_request(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_paid_booking_request(uuid, text)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.insert_studio_notification(uuid, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_studio_notification(uuid, text, text, text, jsonb)
  TO service_role;
