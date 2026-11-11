-- Preserve all booking decisions. Expose only the server-side PL/pgSQL error
-- location so an emergency identity rejection can be diagnosed precisely.
BEGIN;

DO $guard$
BEGIN
  IF md5(pg_catalog.pg_get_functiondef(
    'public.create_public_booking_verified(text,uuid,timestamptz,uuid[],text,text,text,text,text,uuid)'::regprocedure
  )) <> 'd65626420a9cd7db9d51d7e8d52fb290'
     OR md5(pg_catalog.pg_get_functiondef(
    'public.resolve_booking_client_identity(uuid,text,text,text,boolean)'::regprocedure
  )) <> '7777793aaca6fe11d42da9529d62586a' THEN
    RAISE EXCEPTION 'booking_diagnostic_definition_changed';
  END IF;
  IF has_function_privilege('anon',
       'public.create_public_booking_verified(text,uuid,timestamptz,uuid[],text,text,text,text,text,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.create_public_booking_verified(text,uuid,timestamptz,uuid[],text,text,text,text,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'booking_diagnostic_wrapper_exposed';
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
BEGIN
  IF p_verified_auth_user_id IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  PERFORM pg_catalog.set_config('bellza.verified_auth_user_id', p_verified_auth_user_id::text, true);
  RETURN public.create_public_booking(
    p_studio_slug, p_staff_id, p_starts_at, p_service_ids, p_client_name,
    p_client_phone, p_client_email, p_notes, p_customer_referral_code);
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'client_identity_review_required' THEN RAISE; END IF;
  GET STACKED DIAGNOSTICS v_context = PG_EXCEPTION_CONTEXT;
  RAISE EXCEPTION 'client_identity_review_required' USING DETAIL = v_context;
END;
$$;

COMMIT;
