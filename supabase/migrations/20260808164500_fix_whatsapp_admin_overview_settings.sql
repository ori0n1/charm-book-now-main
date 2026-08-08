-- Production follow-up for databases that applied the first overview function
-- before its settings object was made aggregate-safe. Fresh databases already
-- receive the corrected definition in the preceding migration, so this is a
-- deliberate no-op there.
DO $$
DECLARE
  v_definition text;
  v_legacy text := '''settings'', to_jsonb(cfg),';
  v_replacement text := $replacement$'settings', jsonb_build_object(
      'id', cfg.id,
      'global_enabled', cfg.global_enabled,
      'trial_enabled', cfg.trial_enabled,
      'trial_duration_days', cfg.trial_duration_days,
      'trial_message_limit', cfg.trial_message_limit,
      'alert_thresholds', cfg.alert_thresholds,
      'post_trial_mode', cfg.post_trial_mode,
      'billing_mode', cfg.billing_mode,
      'provider_cost_per_message_cents', cfg.provider_cost_per_message_cents,
      'commercial_price_cents', cfg.commercial_price_cents,
      'commercial_included_messages', cfg.commercial_included_messages,
      'commercial_excess_message_cents', cfg.commercial_excess_message_cents,
      'currency', cfg.currency,
      'provider_contract_verified_at', cfg.provider_contract_verified_at,
      'updated_at', cfg.updated_at
    ),$replacement$;
BEGIN
  SELECT pg_get_functiondef('public.get_whatsapp_admin_overview()'::regprocedure)
  INTO v_definition;

  IF position(v_legacy IN v_definition) > 0 THEN
    EXECUTE replace(v_definition, v_legacy, v_replacement);
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';
