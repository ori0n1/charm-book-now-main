DO $test$
DECLARE
  table_name text;
  browser_role text;
  table_signature text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'platform_billing_events',
    'referral_credits',
    'referrals',
    'server_rate_limits',
    'studio_trial_extension_backup_20260719_1910',
    'studios_cancel_flag_backup_20260705_194119',
    'studios_trial_renewal_backup_20260821',
    'studios_trial_reset_backup_20260807',
    'studios_trial_restore_backup_20260705_190426',
    'subscriptions_trial_renewal_backup_20260821',
    'subscriptions_trial_reset_backup_20260807'
  ] LOOP
    table_signature := format('public.%I', table_name);

    FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (
        SELECT 1
        FROM unnest(ARRAY[
          'SELECT', 'INSERT', 'UPDATE', 'DELETE',
          'TRUNCATE', 'REFERENCES', 'TRIGGER'
        ]) AS privilege_name
        WHERE has_table_privilege(browser_role, table_signature, privilege_name)
      ) THEN
        RAISE EXCEPTION 'internal_table_browser_grant: role=% table=%',
          browser_role,
          table_signature;
      END IF;
    END LOOP;

    IF EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'SELECT', 'INSERT', 'UPDATE', 'DELETE',
        'TRUNCATE', 'REFERENCES', 'TRIGGER'
      ]) AS privilege_name
      WHERE NOT has_table_privilege('service_role', table_signature, privilege_name)
    ) THEN
      RAISE EXCEPTION 'internal_table_service_role_grant_missing: %', table_signature;
    END IF;
  END LOOP;
END
$test$;
