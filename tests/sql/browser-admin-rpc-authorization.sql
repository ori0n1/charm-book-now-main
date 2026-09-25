DO $test$
DECLARE
  requirement record;
  function_definition text;
  argument_names text[];
BEGIN
  FOR requirement IN
    SELECT *
    FROM (VALUES
      ('public.add_cash_register_movement(uuid,text,text,numeric,text)', 'is_studio_member(auth.uid(),'),
      ('public.close_cash_register(uuid,numeric,text)', 'is_studio_member(auth.uid(),'),
      ('public.confirm_studio_appointment_payment(uuid,text)', 'is_studio_member(auth.uid(),'),
      ('public.create_manual_appointment(uuid,uuid,uuid,timestamp with time zone,uuid,text,text,text,boolean)', 'can_use_studio(auth.uid(),'),
      ('public.create_walk_in_appointment(uuid,uuid,uuid,timestamp with time zone,uuid,text,text,text,numeric,text)', 'is_studio_member(auth.uid(),'),
      ('public.get_cash_register_closure_history(uuid,integer)', 'is_studio_member(auth.uid(),'),
      ('public.get_open_cash_register(uuid)', 'is_studio_member(auth.uid(),'),
      ('public.open_cash_register(uuid,numeric)', 'is_studio_member(auth.uid(),'),
      ('public.remove_or_archive_service(uuid,uuid)', 'has_role(auth.uid(),'),
      ('public.update_manual_appointment_service(uuid,uuid,uuid,uuid,text)', 'can_use_studio(auth.uid(),')
    ) AS expected(signature, authorization_expression)
  LOOP
    SELECT
      lower(pg_get_functiondef(function_row.oid)),
      function_row.proargnames
    INTO function_definition, argument_names
    FROM pg_proc AS function_row
    WHERE function_row.oid = to_regprocedure(requirement.signature);

    IF function_definition IS NULL THEN
      RAISE EXCEPTION 'browser_admin_rpc_missing: %', requirement.signature;
    END IF;

    IF position(requirement.authorization_expression IN function_definition) = 0 THEN
      RAISE EXCEPTION 'browser_admin_rpc_auth_guard_missing: % expected=%',
        requirement.signature,
        requirement.authorization_expression;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM unnest(coalesce(argument_names, ARRAY[]::text[])) AS argument_name
      WHERE argument_name ~* '^p_(actor|user|owner)(_id)?$'
    ) THEN
      RAISE EXCEPTION 'browser_admin_rpc_accepts_actor_identity: %', requirement.signature;
    END IF;
  END LOOP;
END
$test$;
