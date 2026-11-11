-- Production candidate: keep the original booking functions and their grants intact.
-- Apply before the Worker that calls the two verified wrappers.
BEGIN;

DO $guard$
DECLARE
  v_helper text;
  v_pattern text := 'v_match\.auth_user_id[[:space:]]+IS[[:space:]]+NOT[[:space:]]+NULL[[:space:]]+OR[[:space:]]+v_match\.archived_at[[:space:]]+IS[[:space:]]+NOT[[:space:]]+NULL';
  v_matches integer;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(p.oid) INTO v_helper
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'resolve_booking_client_identity'
    AND pg_catalog.pg_get_function_identity_arguments(p.oid) =
      'p_studio_id uuid, p_name text, p_phone text, p_email text, p_create boolean';

  IF v_helper IS NULL OR md5(v_helper) <> '757995fa2be9097b3a7030385c909dbd' THEN
    RAISE EXCEPTION 'verified_booking_helper_definition_changed';
  END IF;
  IF has_function_privilege('anon', 'public.resolve_booking_client_identity(uuid,text,text,text,boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.resolve_booking_client_identity(uuid,text,text,text,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'verified_booking_helper_exposed';
  END IF;
  IF md5(pg_catalog.pg_get_functiondef('public.create_public_booking(text,uuid,timestamptz,uuid[],text,text,text,text,text)'::regprocedure))
       <> '733296c0b6027bc73c95d0a41f41276e'
     OR md5(pg_catalog.pg_get_functiondef('public.create_public_joint_booking(text,timestamptz,jsonb,text,text,text,text,text)'::regprocedure))
       <> '6649d7e5413300b58c662f852526bf79' THEN
    RAISE EXCEPTION 'verified_booking_entrypoint_definition_changed';
  END IF;
  IF to_regprocedure('public.create_public_booking_verified(text,uuid,timestamptz,uuid[],text,text,text,text,text,uuid)') IS NOT NULL
     OR to_regprocedure('public.create_public_joint_booking_verified(text,timestamptz,jsonb,text,text,text,text,text,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'verified_booking_wrapper_already_exists';
  END IF;

  SELECT count(*) INTO v_matches FROM regexp_matches(v_helper, v_pattern, 'g');
  IF v_matches <> 1 THEN RAISE EXCEPTION 'verified_booking_guard_anchor_changed'; END IF;
  EXECUTE regexp_replace(
    v_helper, v_pattern,
    '(v_match.auth_user_id IS NOT NULL AND v_match.auth_user_id IS DISTINCT FROM NULLIF(current_setting(''bellza.verified_auth_user_id'', true), '''')::uuid) OR v_match.archived_at IS NOT NULL'
  );
END;
$guard$;

-- Only the server-side service role can pass the user id that it obtained
-- from Supabase Auth. The scoped setting disappears with the RPC transaction.
CREATE FUNCTION public.create_public_booking_verified(
  p_studio_slug text, p_staff_id uuid, p_starts_at timestamptz,
  p_service_ids uuid[], p_client_name text, p_client_phone text,
  p_client_email text, p_notes text, p_customer_referral_code text,
  p_verified_auth_user_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF p_verified_auth_user_id IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  PERFORM pg_catalog.set_config('bellza.verified_auth_user_id', p_verified_auth_user_id::text, true);
  RETURN public.create_public_booking(
    p_studio_slug, p_staff_id, p_starts_at, p_service_ids, p_client_name,
    p_client_phone, p_client_email, p_notes, p_customer_referral_code);
END;
$$;
REVOKE ALL ON FUNCTION public.create_public_booking_verified(text,uuid,timestamptz,uuid[],text,text,text,text,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_public_booking_verified(text,uuid,timestamptz,uuid[],text,text,text,text,text,uuid)
  TO service_role;

CREATE FUNCTION public.create_public_joint_booking_verified(
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
REVOKE ALL ON FUNCTION public.create_public_joint_booking_verified(text,timestamptz,jsonb,text,text,text,text,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_public_joint_booking_verified(text,timestamptz,jsonb,text,text,text,text,text,uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
