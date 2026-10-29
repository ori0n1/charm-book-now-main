-- Candidate only. Apply after a read-only preflight of the effective production
-- functions and explicit approval. The new predicate is restricted to agenda RPCs.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Preserve the exact effective definitions, including production-only changes.
-- App roles have no SELECT privilege; RLS is defense in depth.
CREATE TABLE public.agenda_role_parity_function_backup_20261029 (
  signature text PRIMARY KEY,
  definition text NOT NULL,
  definition_md5 text NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.agenda_role_parity_function_backup_20261029
  FROM PUBLIC, anon, authenticated;
ALTER TABLE public.agenda_role_parity_function_backup_20261029 ENABLE ROW LEVEL SECURITY;

-- Desk access is deliberately separate from can_use_studio, which also protects
-- non-agenda capabilities. No application role may call this predicate directly.
CREATE FUNCTION public.can_use_agenda_desk(p_user_id uuid, p_studio_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles AS membership
    JOIN public.staff AS professional
      ON professional.user_id = membership.user_id
     AND professional.studio_id = membership.studio_id
     AND professional.is_active = true
    JOIN public.studios AS studio
      ON studio.id = membership.studio_id AND studio.is_active = true
    WHERE membership.user_id = p_user_id
      AND membership.studio_id = p_studio_id
      AND membership.role = 'desk_staff'
  )
$$;
REVOKE ALL ON FUNCTION public.can_use_agenda_desk(uuid,uuid)
  FROM PUBLIC, anon, authenticated;

DO $migration$
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
  -- Read-only production preflight on 2026-10-29. Any later SQL drift aborts.
  v_expected_hashes text[] := ARRAY[
    'd6be6280833a3dd59dc798aaad414b96',
    '3d27484c6ac62783f6a6fbf062e4c8be',
    'cb24182599700e93b680925c3c6e8777',
    'c9da278d23ee1d6783e118184c6d2b29',
    '1f75ca2cc752f55884704aed7acd2ed3',
    '18cda414b102998a0a88e063820e0651',
    '69757354e24af901b768dc77ec73495b',
    '39f44c05a53afd9d2c3467889ba46272',
    'af10b0ea9a4c356c4b7b3790a648d9ab',
    '93b8f250f2f8a8fa482f9bc7d099d160',
    'a3668e219cdd3c0b6e18cb4beb7fc6d7'
  ];
  v_signature text;
  v_oid oid;
  v_definition text;
  v_security_definer boolean;
  v_pattern text := $pattern$role[[:space:]]+IN[[:space:]]*\([[:space:]]*'studio_owner'[[:space:]]*,[[:space:]]*'saas_owner'[[:space:]]*\)$pattern$;
  v_desk_pattern text := $pattern$public\.can_use_studio\([[:space:]]*(auth\.uid\(\)|p_actor_id)[[:space:]]*,[[:space:]]*p_studio_id[[:space:]]*\)$pattern$;
  v_matches integer;
  v_ordinal integer := 0;
BEGIN
  -- Preflight every function before replacing any one of them.
  FOREACH v_signature IN ARRAY v_signatures LOOP
    v_ordinal := v_ordinal + 1;
    v_oid := to_regprocedure(v_signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'agenda_role_parity_missing_function: %', v_signature;
    END IF;
    SELECT pg_get_functiondef(v_oid), prosecdef
      INTO STRICT v_definition, v_security_definer
      FROM pg_proc WHERE oid = v_oid;
    IF v_security_definer IS NOT TRUE THEN
      RAISE EXCEPTION 'agenda_role_parity_security_definer_required: %', v_signature;
    END IF;
    IF md5(v_definition) <> v_expected_hashes[v_ordinal] THEN
      RAISE EXCEPTION 'agenda_role_parity_production_definition_changed: %', v_signature;
    END IF;
    SELECT count(*) INTO v_matches FROM regexp_matches(v_definition,
      CASE WHEN v_ordinal <= 5 THEN v_pattern ELSE v_desk_pattern END, 'gi');
    IF v_matches <> 1 THEN
      RAISE EXCEPTION 'agenda_role_parity_unexpected_access_check: % (%)', v_signature, v_matches;
    END IF;
    INSERT INTO public.agenda_role_parity_function_backup_20261029
      (signature, definition, definition_md5)
    VALUES (v_signature, v_definition, md5(v_definition));
  END LOOP;

  v_ordinal := 0;
  FOREACH v_signature IN ARRAY v_signatures LOOP
    v_ordinal := v_ordinal + 1;
    SELECT definition INTO STRICT v_definition
      FROM public.agenda_role_parity_function_backup_20261029
      WHERE signature = v_signature;
    IF v_ordinal <= 5 THEN
      EXECUTE regexp_replace(v_definition, v_pattern,
        $replacement$role IN ('studio_owner', 'saas_owner', 'manager', 'staff', 'desk_staff')$replacement$,
        'i');
    ELSE
      EXECUTE regexp_replace(v_definition, v_desk_pattern,
        $replacement$(public.can_use_studio(\1, p_studio_id) OR public.can_use_agenda_desk(\1, p_studio_id))$replacement$,
        'i');
    END IF;
  END LOOP;
END;
$migration$;

COMMIT;
