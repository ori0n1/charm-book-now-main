-- Extend only loyalty redemption to studio managers. The existing financial
-- appointment editor and its payment/receipt guards remain unchanged.
DO $migration$
DECLARE
  v_redeem_oid regprocedure := to_regprocedure('public.redeem_customer_loyalty_discount(uuid,text,uuid,uuid)');
  v_editor_oid regprocedure := to_regprocedure('public.edit_owner_resolved_appointment(uuid,uuid,text,timestamptz,jsonb,numeric,text,uuid)');
  v_definition text;
  v_editor_definition text;
  v_old text := 'r.role=''studio_owner''';
  v_new text := 'r.role IN (''studio_owner'',''manager'')';
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('statement_timeout', '30s', true);
  IF v_redeem_oid IS NULL OR v_editor_oid IS NULL THEN
    RAISE EXCEPTION 'loyalty_manager_redemption_dependency_missing';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_redeem_oid::oid)
     OR has_function_privilege('authenticated', v_redeem_oid::oid, 'EXECUTE')
     OR has_function_privilege('anon', v_redeem_oid::oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_redeem_oid::oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'loyalty_manager_redemption_permission_drift';
  END IF;

  v_definition := pg_get_functiondef(v_redeem_oid::oid);
  v_editor_definition := pg_get_functiondef(v_editor_oid::oid);
  IF length(v_definition) - length(replace(v_definition, v_old, '')) <> length(v_old)
     OR position('loyalty_owner_required' IN v_definition) = 0
     OR position('service_role' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'loyalty_manager_redemption_definition_drift';
  END IF;
  -- The existing financial editor must already allow managers. Never widen it here.
  IF v_editor_definition !~ 'WHERE[[:space:]]+user_id[[:space:]]*=[[:space:]]*p_actor_id[[:space:]]+AND[[:space:]]+studio_id[[:space:]]*=[[:space:]]*p_studio_id[[:space:]]+AND[[:space:]]+role[[:space:]]+IN[[:space:]]*\([^)]*''manager''[^)]*\)' THEN
    RAISE EXCEPTION 'loyalty_manager_financial_editor_forbidden';
  END IF;

  EXECUTE replace(replace(v_definition, v_old, v_new),
    'loyalty_owner_required', 'loyalty_redeemer_required');
END;
$migration$;
