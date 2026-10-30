-- Run before the agenda role-parity rollback, after reverting the matching Worker.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $rollback$
DECLARE
  v_signature text := 'public.edit_studio_appointment(uuid,uuid,timestamptz,jsonb,numeric,text)';
  v_definition text;
  v_installed_md5 text;
BEGIN
  SELECT definition,installed_md5 INTO STRICT v_definition,v_installed_md5
    FROM public.agenda_structural_edit_backup_20261030 WHERE signature=v_signature;
  IF v_installed_md5 IS NULL OR
    md5(pg_get_functiondef(to_regprocedure(v_signature))) <> v_installed_md5 THEN
    RAISE EXCEPTION 'agenda_structural_edit_current_definition_drift';
  END IF;
  EXECUTE v_definition;
END
$rollback$;
DROP FUNCTION public.edit_studio_appointment_structure_unpaid(uuid,uuid,timestamptz,jsonb,numeric,text);
DROP TABLE public.agenda_structural_edit_backup_20261030;
COMMIT;
