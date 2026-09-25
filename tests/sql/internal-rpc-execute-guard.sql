-- Read-only ACL assertion for the candidate migration 20260919152000.
DO $test$
DECLARE
  signature text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.confirm_paid_booking_request(uuid,text)',
    'public.insert_studio_notification(uuid,text,text,text,jsonb)'
  ] LOOP
    IF has_function_privilege('anon', signature, 'EXECUTE')
      OR has_function_privilege('authenticated', signature, 'EXECUTE')
      OR NOT has_function_privilege('service_role', signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'internal_rpc_acl_violation: %', signature;
    END IF;
  END LOOP;
END
$test$;
