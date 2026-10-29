-- Candidate rollback. Restore the exact definitions captured at migration time.
-- Apply only after the matching Worker version has been reverted and approved.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $rollback$
DECLARE
  v_signatures text[] := ARRAY[
    'public.correct_owner_appointment_action(uuid,uuid,text,uuid,text)',
    'public.guard_completed_appointment_cancellation()',
    'public.cancel_completed_appointment(uuid,uuid,text)',
    'public.edit_resolved_appointment_schedule(uuid,uuid,text,timestamptz,integer,text,uuid)',
    'public.edit_owner_resolved_appointment(uuid,uuid,text,timestamptz,jsonb,numeric,text,uuid)',
    'public.create_studio_walkin_appointment(uuid,jsonb,timestamptz,uuid,text,text,text)',
    'public.create_manual_multi_professional_appointment(uuid,jsonb,timestamptz,uuid,text,text,text)',
    'public.edit_studio_appointment(uuid,uuid,timestamptz,jsonb,numeric,text)',
    'public.create_studio_manual_multi_professional_fit(uuid,jsonb,timestamptz,uuid,text,text,text,boolean,uuid,uuid[])',
    'public.move_studio_appointment(uuid,uuid,timestamptz,integer,boolean,uuid,uuid[],text)',
    'public.swap_studio_appointments(uuid,uuid,uuid,boolean,uuid,uuid[])'
  ];
  v_signature text;
  v_definition text;
  v_hash text;
  v_current text;
  v_expected_current text;
  v_pattern text := $pattern$role[[:space:]]+IN[[:space:]]*\([[:space:]]*'studio_owner'[[:space:]]*,[[:space:]]*'saas_owner'[[:space:]]*,[[:space:]]*'manager'[[:space:]]*,[[:space:]]*'staff'[[:space:]]*,[[:space:]]*'desk_staff'[[:space:]]*\)$pattern$;
  v_desk_pattern text := $pattern$\(public\.can_use_studio\([[:space:]]*(auth\.uid\(\)|p_actor_id)[[:space:]]*,[[:space:]]*p_studio_id[[:space:]]*\)[[:space:]]+OR[[:space:]]+public\.can_use_agenda_desk\([[:space:]]*\1[[:space:]]*,[[:space:]]*p_studio_id[[:space:]]*\)\)$pattern$;
  v_source_role_pattern text := $pattern$role[[:space:]]+IN[[:space:]]*\([[:space:]]*'studio_owner'[[:space:]]*,[[:space:]]*'saas_owner'[[:space:]]*\)$pattern$;
  v_source_desk_pattern text := $pattern$public\.can_use_studio\([[:space:]]*(auth\.uid\(\)|p_actor_id)[[:space:]]*,[[:space:]]*p_studio_id[[:space:]]*\)$pattern$;
  v_matches integer;
  v_ordinal integer := 0;
BEGIN
  IF (SELECT count(*) FROM public.agenda_role_parity_function_backup_20261029) <> 11 THEN
    RAISE EXCEPTION 'agenda_role_parity_incomplete_backup';
  END IF;
  FOREACH v_signature IN ARRAY v_signatures LOOP
    v_ordinal := v_ordinal + 1;
    SELECT definition, definition_md5 INTO STRICT v_definition, v_hash
      FROM public.agenda_role_parity_function_backup_20261029
      WHERE signature = v_signature;
    IF md5(v_definition) <> v_hash THEN
      RAISE EXCEPTION 'agenda_role_parity_backup_changed: %', v_signature;
    END IF;
    v_current := pg_get_functiondef(to_regprocedure(v_signature));
    SELECT count(*) INTO v_matches FROM regexp_matches(v_current,
      CASE WHEN v_ordinal <= 5 THEN v_pattern ELSE v_desk_pattern END, 'gi');
    IF v_matches <> 1 THEN
      RAISE EXCEPTION 'agenda_role_parity_current_function_changed: %', v_signature;
    END IF;
    v_expected_current := CASE WHEN v_ordinal <= 5 THEN
      regexp_replace(v_definition, v_source_role_pattern,
        $replacement$role IN ('studio_owner', 'saas_owner', 'manager', 'staff', 'desk_staff')$replacement$, 'i')
      ELSE regexp_replace(v_definition, v_source_desk_pattern,
        $replacement$(public.can_use_studio(\1, p_studio_id) OR public.can_use_agenda_desk(\1, p_studio_id))$replacement$, 'i')
    END;
    IF v_current IS DISTINCT FROM v_expected_current THEN
      RAISE EXCEPTION 'agenda_role_parity_current_definition_drift: %', v_signature;
    END IF;
  END LOOP;

  FOREACH v_signature IN ARRAY v_signatures LOOP
    SELECT definition INTO STRICT v_definition
      FROM public.agenda_role_parity_function_backup_20261029
      WHERE signature = v_signature;
    EXECUTE v_definition;
  END LOOP;
END;
$rollback$;

DROP TABLE public.agenda_role_parity_function_backup_20261029;
DROP FUNCTION public.can_use_agenda_desk(uuid,uuid);
COMMIT;
