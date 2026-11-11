-- Restores the exact guarded functions that preceded the owned-client change.
-- Run only after a separate owner approval and review of bookings created
-- with account phone markers; existing bookings and client rows are retained.
BEGIN;

DO $guard$
DECLARE
  v_def text;
  v_start integer;
  v_end integer;
  v_start_marker text := '  -- bellza_owned_booking_start';
  v_end_marker text := '  -- bellza_owned_booking_end';
BEGIN
  v_def := pg_catalog.pg_get_functiondef(
    'public.resolve_booking_client_identity(uuid,text,text,text,boolean)'::regprocedure);
  v_start := strpos(v_def, v_start_marker);
  v_end := strpos(v_def, v_end_marker);
  IF v_start = 0 OR v_end <= v_start
     OR strpos(substring(v_def from v_start + length(v_start_marker)), v_start_marker) > 0
     OR strpos(substring(v_def from v_end + length(v_end_marker)), v_end_marker) > 0 THEN
    RAISE EXCEPTION 'owned_booking_rollback_anchor_changed';
  END IF;
  EXECUTE substring(v_def from 1 for v_start - 1)
    || substring(v_def from v_end + length(v_end_marker) +
      CASE WHEN substring(v_def from v_end + length(v_end_marker) for 2) = E'\r\n'
        THEN 2 ELSE 1 END);
  IF md5(pg_catalog.pg_get_functiondef(
    'public.resolve_booking_client_identity(uuid,text,text,text,boolean)'::regprocedure
  )) <> '91a610f0607173c57b3c7a864df374fb' THEN
    RAISE EXCEPTION 'owned_booking_rollback_definition_mismatch';
  END IF;

  v_def := pg_catalog.pg_get_functiondef(
    'public.resolve_authenticated_studio_client(uuid,text,text)'::regprocedure);
  v_start_marker := '    -- bellza_shared_phone_profile_start';
  v_end_marker := '    -- bellza_shared_phone_profile_end';
  v_start := strpos(v_def, v_start_marker);
  v_end := strpos(v_def, v_end_marker);
  IF v_start = 0 OR v_end <= v_start
     OR strpos(substring(v_def from v_start + length(v_start_marker)), v_start_marker) > 0
     OR strpos(substring(v_def from v_end + length(v_end_marker)), v_end_marker) > 0 THEN
    RAISE EXCEPTION 'owned_profile_rollback_anchor_changed';
  END IF;
  v_def := substring(v_def from 1 for v_start - 1)
    || substring(v_def from v_end + length(v_end_marker) +
      CASE WHEN substring(v_def from v_end + length(v_end_marker) for 2) = E'\r\n'
        THEN 2 ELSE 1 END);
  v_start_marker := '  -- bellza_owned_profile_multi_start';
  v_end_marker := '  -- bellza_owned_profile_multi_end';
  v_start := strpos(v_def, v_start_marker);
  v_end := strpos(v_def, v_end_marker);
  IF v_start = 0 OR v_end <= v_start
     OR strpos(substring(v_def from v_start + length(v_start_marker)), v_start_marker) > 0
     OR strpos(substring(v_def from v_end + length(v_end_marker)), v_end_marker) > 0 THEN
    RAISE EXCEPTION 'owned_profile_multi_rollback_anchor_changed';
  END IF;
  EXECUTE substring(v_def from 1 for v_start - 1)
    || substring(v_def from v_end + length(v_end_marker) +
      CASE WHEN substring(v_def from v_end + length(v_end_marker) for 2) = E'\r\n'
        THEN 2 ELSE 1 END);
  IF md5(pg_catalog.pg_get_functiondef(
    'public.resolve_authenticated_studio_client(uuid,text,text)'::regprocedure
  )) <> 'c419f856fb10f4ed1c65419ef0947214' THEN
    RAISE EXCEPTION 'owned_profile_rollback_definition_mismatch';
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.create_public_booking_verified(
  p_studio_slug text, p_staff_id uuid, p_starts_at timestamptz,
  p_service_ids uuid[], p_client_name text, p_client_phone text,
  p_client_email text, p_notes text, p_customer_referral_code text,
  p_verified_auth_user_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_context text;
  v_detail text;
BEGIN
  IF p_verified_auth_user_id IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  PERFORM pg_catalog.set_config('bellza.verified_auth_user_id', p_verified_auth_user_id::text, true);
  RETURN public.create_public_booking(
    p_studio_slug, p_staff_id, p_starts_at, p_service_ids, p_client_name,
    p_client_phone, p_client_email, p_notes, p_customer_referral_code);
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'client_identity_review_required' THEN RAISE; END IF;
  GET STACKED DIAGNOSTICS v_context = PG_EXCEPTION_CONTEXT, v_detail = PG_EXCEPTION_DETAIL;
  RAISE EXCEPTION 'client_identity_review_required'
    USING DETAIL = COALESCE(NULLIF(v_detail, ''), v_context);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_public_joint_booking_verified(
  p_studio_slug text, p_starts_at timestamptz, p_service_assignments jsonb,
  p_client_name text, p_client_phone text, p_client_email text,
  p_notes text, p_customer_referral_code text, p_verified_auth_user_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF p_verified_auth_user_id IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  PERFORM pg_catalog.set_config('bellza.verified_auth_user_id', p_verified_auth_user_id::text, true);
  RETURN public.create_public_joint_booking(
    p_studio_slug, p_starts_at, p_service_assignments, p_client_name,
    p_client_phone, p_client_email, p_notes, p_customer_referral_code);
END;
$$;

DO $guard$
BEGIN
  IF md5(pg_catalog.pg_get_functiondef(
    'public.create_public_booking_verified(text,uuid,timestamptz,uuid[],text,text,text,text,text,uuid)'::regprocedure
  )) <> '5645ec21134434a9e1014e10fe8c43a2'
     OR md5(pg_catalog.pg_get_functiondef(
    'public.create_public_joint_booking_verified(text,timestamptz,jsonb,text,text,text,text,text,uuid)'::regprocedure
  )) <> '7e80e1bbcac42d0434531f2cac34366c' THEN
    RAISE EXCEPTION 'owned_wrapper_rollback_definition_mismatch';
  END IF;
END;
$guard$;

COMMIT;
