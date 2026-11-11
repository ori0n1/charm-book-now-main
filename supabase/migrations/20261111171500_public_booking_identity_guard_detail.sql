-- Diagnostic only: retain the identity guard and disclose three booleans to
-- the server log when its combined condition rejects a booking.
BEGIN;

DO $guard$
DECLARE
  v_def text;
  v_marker text := 'RAISE EXCEPTION ''client_identity_review_required'';';
  v_parts text[];
  v_replacement text := $replacement$RAISE EXCEPTION 'client_identity_review_required' USING DETAIL = pg_catalog.format(
  'auth_mismatch=%s;archived=%s;email_mismatch=%s',
  v_match.auth_user_id IS NOT NULL AND v_match.auth_user_id IS DISTINCT FROM NULLIF(current_setting('bellza.verified_auth_user_id', true), '')::uuid,
  v_match.archived_at IS NOT NULL,
  v_email <> '' AND NULLIF(trim(v_match.email), '') IS NOT NULL AND lower(regexp_replace(v_match.email, '\s', '', 'g')) <> v_email
);$replacement$;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.resolve_booking_client_identity(uuid,text,text,text,boolean)'::regprocedure
  ) INTO v_def;
  IF md5(v_def) <> '7777793aaca6fe11d42da9529d62586a' THEN
    RAISE EXCEPTION 'booking_guard_detail_definition_changed';
  END IF;
  IF md5(pg_catalog.pg_get_functiondef(
    'public.create_public_booking_verified(text,uuid,timestamptz,uuid[],text,text,text,text,text,uuid)'::regprocedure
  )) <> '6e28c3188d149ffc08339cf4294b488c' THEN
    RAISE EXCEPTION 'booking_guard_detail_wrapper_changed';
  END IF;
  v_parts := string_to_array(v_def, v_marker);
  IF array_length(v_parts, 1) <> 6 THEN
    RAISE EXCEPTION 'booking_guard_detail_anchor_changed';
  END IF;
  EXECUTE v_parts[1] || v_marker || v_parts[2] || v_replacement ||
    v_parts[3] || v_marker || v_parts[4] || v_marker ||
    v_parts[5] || v_marker || v_parts[6];
END;
$guard$;

COMMIT;
