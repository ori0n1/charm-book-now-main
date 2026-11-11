-- A second client row may carry the same email. A booking for the uniquely
-- matched phone can still use its existing client row when that row belongs
-- to the verified caller and already carries the submitted email. Keep the
-- collision guard for unlinked or differently owned client rows.
BEGIN;

DO $guard$
DECLARE
  v_def text;
  v_anchor text := $anchor$IF v_email <> '' AND EXISTS (
      SELECT 1 FROM public.clients WHERE studio_id = p_studio_id AND id <> v_match.id
        AND lower(regexp_replace(COALESCE(email, ''), '\s', '', 'g')) = v_email
    ) THEN RAISE EXCEPTION 'client_identity_review_required'; END IF;$anchor$;
  v_replacement text := $replacement$IF v_email <> ''
      AND NOT COALESCE(
        v_match.auth_user_id IS NOT NULL
        AND v_match.auth_user_id = NULLIF(current_setting('bellza.verified_auth_user_id', true), '')::uuid
        AND lower(regexp_replace(COALESCE(v_match.email, ''), '\s', '', 'g')) = v_email,
        false
      )
      AND EXISTS (
        SELECT 1 FROM public.clients WHERE studio_id = p_studio_id AND id <> v_match.id
          AND lower(regexp_replace(COALESCE(email, ''), '\s', '', 'g')) = v_email
      ) THEN RAISE EXCEPTION 'client_identity_review_required'; END IF;$replacement$;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.resolve_booking_client_identity(uuid,text,text,text,boolean)'::regprocedure
  ) INTO v_def;
  IF md5(v_def) <> 'fde4dcf63c974b0bb54dfb56bbcadd18' THEN
    RAISE EXCEPTION 'booking_verified_owner_definition_changed';
  END IF;
  IF length(v_def) - length(replace(v_def, v_anchor, '')) <> length(v_anchor) THEN
    RAISE EXCEPTION 'booking_verified_owner_anchor_changed';
  END IF;
  EXECUTE replace(v_def, v_anchor, v_replacement);
END;
$guard$;

COMMIT;
