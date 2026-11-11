-- Reinstates the pre-fix email collision guard. Run only after confirming
-- rollback is safe for bookings made since the change and owner approval.
BEGIN;

DO $guard$
DECLARE
  v_def text;
  v_anchor text := $anchor$IF v_email <> ''
      AND NOT COALESCE(
        v_match.auth_user_id IS NOT NULL
        AND v_match.auth_user_id = NULLIF(current_setting('bellza.verified_auth_user_id', true), '')::uuid
        AND lower(regexp_replace(COALESCE(v_match.email, ''), '\s', '', 'g')) = v_email,
        false
      )
      AND EXISTS (
        SELECT 1 FROM public.clients WHERE studio_id = p_studio_id AND id <> v_match.id
          AND lower(regexp_replace(COALESCE(email, ''), '\s', '', 'g')) = v_email
      ) THEN RAISE EXCEPTION 'client_identity_review_required'; END IF;$anchor$;
  v_replacement text := $replacement$IF v_email <> '' AND EXISTS (
      SELECT 1 FROM public.clients WHERE studio_id = p_studio_id AND id <> v_match.id
        AND lower(regexp_replace(COALESCE(email, ''), '\s', '', 'g')) = v_email
    ) THEN RAISE EXCEPTION 'client_identity_review_required'; END IF;$replacement$;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.resolve_booking_client_identity(uuid,text,text,text,boolean)'::regprocedure
  ) INTO v_def;
  IF length(v_def) - length(replace(v_def, v_anchor, '')) <> length(v_anchor) THEN
    RAISE EXCEPTION 'booking_verified_owner_rollback_anchor_changed';
  END IF;
  EXECUTE replace(v_def, v_anchor, v_replacement);
END;
$guard$;

COMMIT;
