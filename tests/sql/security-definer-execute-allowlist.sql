-- Read-only assertions for 20260922120000_security_definer_execute_allowlist.
DO $test$
DECLARE
  signature text;
  browser_role text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.get_available_slots(text,uuid,date,integer,integer)'
  ] LOOP
    IF NOT has_function_privilege('anon', signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'required_anon_rpc_missing: %', signature;
    END IF;
  END LOOP;

  FOREACH signature IN ARRAY ARRAY[
    'public.can_use_studio(uuid,uuid)',
    'public.has_active_premium_access(uuid)',
    'public.has_privileged_studio_access(uuid,uuid)',
    'public.has_role(uuid,uuid,public.app_role)',
    'public.is_saas_owner(uuid)',
    'public.is_studio_member(uuid,uuid)',
    'public.staff_owns_appointment(uuid,uuid)',
    'public.studio_can_add_professional(uuid)',
    'public.studio_has_entitlement(uuid,text,timestamp with time zone)',
    'public.studio_staff_is_within_plan(uuid,uuid)',
    'public.add_cash_register_movement(uuid,text,text,numeric,text)',
    'public.close_cash_register(uuid,numeric,text)',
    'public.confirm_studio_appointment_payment(uuid,text)',
    'public.create_manual_appointment(uuid,uuid,uuid,timestamp with time zone,uuid,text,text,text,boolean)',
    'public.create_walk_in_appointment(uuid,uuid,uuid,timestamp with time zone,uuid,text,text,text,numeric,text)',
    'public.get_available_slots(text,uuid,date,integer,integer)',
    'public.get_cash_register_closure_history(uuid,integer)',
    'public.get_open_cash_register(uuid)',
    'public.open_cash_register(uuid,numeric)',
    'public.remove_or_archive_service(uuid,uuid)',
    'public.update_manual_appointment_service(uuid,uuid,uuid,uuid,text)'
  ] LOOP
    IF NOT has_function_privilege('authenticated', signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'required_authenticated_rpc_missing: %', signature;
    END IF;
  END LOOP;

  FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH signature IN ARRAY ARRAY[
      'public.acknowledge_studio_notification_delivery(uuid,uuid,text)',
      'public.claim_studio_notification_deliveries(integer,uuid,uuid)',
      'public.confirm_paid_booking_request(uuid,text)',
      'public.consume_rate_limit(text,integer,integer)',
      'public.create_public_booking(text,uuid,timestamp with time zone,uuid[],text,text,text,text,text)',
      'public.create_public_booking_online_core(text,uuid,timestamp with time zone,uuid[],text,text,text,text,text)',
      'public.enqueue_due_appointment_lifecycle_notifications()',
      'public.enqueue_studio_notification_deliveries(uuid,uuid)',
      'public.ensure_customer_loyalty_settings(uuid)',
      'public.finalize_stale_studio_notification_deliveries(uuid)',
      'public.finalize_whatsapp_usage(text,text,uuid,text,text,jsonb)',
      'public.get_or_create_customer_referral_code(uuid,uuid)',
      'public.get_or_create_referral_code(uuid)',
      'public.get_studio_id_by_referral_code(text)',
      'public.get_whatsapp_admin_overview()',
      'public.insert_studio_notification(uuid,text,text,text,jsonb)',
      'public.issue_customer_loyalty_rewards(uuid,uuid)',
      'public.quote_public_booking(text,uuid[])',
      'public.record_public_policy_acceptance(uuid,uuid,uuid,text,jsonb)',
      'public.reserve_whatsapp_usage(uuid,text,text)',
      'public.reschedule_public_appointment(text,uuid,timestamp with time zone)',
      'public.submit_public_refund_request(uuid,uuid,text)',
      'public.track_upsell_acceptances(uuid[])',
      'public.track_upsell_views(uuid[])'
    ] LOOP
      IF has_function_privilege(browser_role, signature, 'EXECUTE') THEN
        RAISE EXCEPTION 'internal_rpc_exposed: role=% function=%', browser_role, signature;
      END IF;
      IF NOT has_function_privilege('service_role', signature, 'EXECUTE') THEN
        RAISE EXCEPTION 'service_role_rpc_missing: %', signature;
      END IF;
    END LOOP;
  END LOOP;
END
$test$;

DO $test$
DECLARE
  mutable_count integer;
BEGIN
  SELECT count(*)
  INTO mutable_count
  FROM pg_proc AS function_row
  JOIN pg_namespace AS function_schema
    ON function_schema.oid = function_row.pronamespace
  WHERE function_schema.nspname = 'public'
    AND function_row.proname = ANY (ARRAY[
      'get_or_create_referral_code',
      'get_studio_id_by_referral_code',
      'normalize_customer_referral_code',
      'preserve_cancel_at_period_end',
      'preserve_studio_cancel_at_period_end',
      'refresh_studio_rating',
      'request_header',
      'set_updated_at'
    ])
    AND NOT coalesce(function_row.proconfig, ARRAY[]::text[])
      && ARRAY['search_path=pg_catalog, public', 'search_path=pg_catalog,public'];

  IF mutable_count <> 0 THEN
    RAISE EXCEPTION 'mutable_search_path_remains: %', mutable_count;
  END IF;
END
$test$;

SELECT
  count(*) FILTER (WHERE has_function_privilege('anon', function_row.oid, 'EXECUTE'))
    AS anon_security_definer_executable,
  count(*) FILTER (WHERE has_function_privilege('authenticated', function_row.oid, 'EXECUTE'))
    AS authenticated_security_definer_executable,
  count(*) FILTER (WHERE NOT has_function_privilege('service_role', function_row.oid, 'EXECUTE'))
    AS service_role_security_definer_missing
FROM pg_proc AS function_row
JOIN pg_namespace AS function_schema
  ON function_schema.oid = function_row.pronamespace
WHERE function_schema.nspname = 'public'
  AND function_row.prosecdef;
