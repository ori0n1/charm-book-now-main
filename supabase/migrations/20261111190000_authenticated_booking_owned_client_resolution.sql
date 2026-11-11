-- Route an authenticated booking by the verified auth id. Never claim a
-- different client's row merely because a form phone or email matches it.
-- A contact collision creates an account-owned row with a non-contact phone
-- marker; the submitted shared phone remains unavailable for notifications.
BEGIN;

DO $guard$
DECLARE
  v_booking text;
  v_profile text;
  v_booking_anchor text := $anchor$IF v_phone = '' THEN RAISE EXCEPTION 'invalid_phone'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock($anchor$;
  v_profile_anchor text := $anchor$WHERE studio_id = p_studio_id AND auth_user_id = v_user_id FOR UPDATE;
    IF v_match.archived_at IS NOT NULL THEN$anchor$;
  v_profile_multi_anchor text := $anchor$SELECT count(*) INTO v_count FROM public.clients
    WHERE studio_id = p_studio_id AND auth_user_id = v_user_id;
  IF v_count > 1 THEN$anchor$;
  v_booking_insert text := $insert$IF v_phone = '' THEN RAISE EXCEPTION 'invalid_phone'; END IF;
  -- bellza_owned_booking_start
  IF NULLIF(current_setting('bellza.verified_auth_user_id', true), '') IS NOT NULL THEN
    -- Serialize account creation and contact matching across concurrent bookings.
    PERFORM pg_catalog.pg_advisory_xact_lock(hashtextextended(
      p_studio_id::text || ':auth:' || current_setting('bellza.verified_auth_user_id', true), 0));
    PERFORM pg_catalog.pg_advisory_xact_lock(hashtextextended(
      p_studio_id::text || ':phone:' || v_phone, 0));
    SELECT count(*) INTO v_count FROM public.clients
      WHERE studio_id = p_studio_id
        AND public.normalized_client_phone(phone) = v_phone
        AND auth_user_id IS DISTINCT FROM current_setting('bellza.verified_auth_user_id', true)::uuid;
    IF v_count > 0 THEN
      -- Reuse a non-contact account row when this phone is shared.
      SELECT * INTO v_match FROM public.clients
        WHERE studio_id = p_studio_id
          AND auth_user_id = current_setting('bellza.verified_auth_user_id', true)::uuid
          AND archived_at IS NULL AND phone LIKE 'account:%'
          AND regexp_replace(phone, '[^0-9]', '', 'g') = ''
        ORDER BY updated_at DESC NULLS LAST, id LIMIT 1 FOR UPDATE;
    ELSE
      SELECT * INTO v_match FROM public.clients
        WHERE studio_id = p_studio_id
          AND auth_user_id = current_setting('bellza.verified_auth_user_id', true)::uuid
          AND archived_at IS NULL
          AND public.normalized_client_phone(phone) = v_phone
        ORDER BY updated_at DESC NULLS LAST, id LIMIT 1 FOR UPDATE;
    END IF;
    IF FOUND THEN
      client_id := v_match.id; was_existing := true; RETURN NEXT; RETURN;
    END IF;
    client_id := NULL;
    was_existing := EXISTS (SELECT 1 FROM public.clients
      WHERE studio_id = p_studio_id
        AND auth_user_id = current_setting('bellza.verified_auth_user_id', true)::uuid);
    IF p_create THEN
      INSERT INTO public.clients(studio_id, name, phone, email, auth_user_id, account_kind)
      VALUES (
        p_studio_id, left(trim(p_name), 120),
        CASE WHEN v_count > 0 THEN 'account:' || translate(
          pg_catalog.gen_random_uuid()::text,
          '0123456789-', 'abcdefghij')
          ELSE trim(p_phone) END,
        (SELECT lower(regexp_replace(email, '\s', '', 'g')) FROM auth.users
          WHERE id = current_setting('bellza.verified_auth_user_id', true)::uuid
            AND email_confirmed_at IS NOT NULL),
        current_setting('bellza.verified_auth_user_id', true)::uuid, 'account'
      ) RETURNING id INTO client_id;
      INSERT INTO public.client_removal_audit(studio_id, client_id, actor_id, action)
      VALUES (p_studio_id, client_id,
        current_setting('bellza.verified_auth_user_id', true)::uuid, 'identity_created');
    END IF;
    RETURN NEXT; RETURN;
  END IF;
  -- bellza_owned_booking_end
  PERFORM pg_catalog.pg_advisory_xact_lock($insert$;
  v_profile_insert text := $insert$WHERE studio_id = p_studio_id AND auth_user_id = v_user_id FOR UPDATE;
    -- bellza_shared_phone_profile_start
    -- A shared phone is not evidence that this account owns the other row.
    -- Keep this account's existing contact unchanged; booking uses auth id.
    IF p_phone NOT LIKE 'account:%' AND v_phone <> '' AND EXISTS (
      SELECT 1 FROM public.clients
      WHERE studio_id = p_studio_id AND id <> v_match.id
        AND public.normalized_client_phone(phone) = v_phone
    ) THEN
      client_id := NULL; resolution := 'manual_review'; RETURN NEXT; RETURN;
    END IF;
    -- bellza_shared_phone_profile_end
    IF v_match.archived_at IS NOT NULL THEN$insert$;
  v_profile_multi_insert text := $insert$SELECT count(*) INTO v_count FROM public.clients
    WHERE studio_id = p_studio_id AND auth_user_id = v_user_id;
  -- bellza_owned_profile_multi_start
  -- A real account row plus safe contact markers is still one person's profile.
  IF v_count > 1 AND
     (SELECT count(*) FROM public.clients WHERE studio_id = p_studio_id
        AND auth_user_id = v_user_id AND archived_at IS NULL
        AND phone NOT LIKE 'account:%') = 1 AND
     (SELECT count(*) FROM public.clients WHERE studio_id = p_studio_id
        AND auth_user_id = v_user_id AND archived_at IS NULL
        AND phone LIKE 'account:%'
        AND regexp_replace(phone, '[^0-9]', '', 'g') = '') = v_count - 1 THEN
    SELECT * INTO v_match FROM public.clients WHERE studio_id = p_studio_id
      AND auth_user_id = v_user_id AND archived_at IS NULL
      AND phone NOT LIKE 'account:%' FOR UPDATE;
    IF p_phone NOT LIKE 'account:%' AND v_phone <> '' AND EXISTS (
      SELECT 1 FROM public.clients WHERE studio_id = p_studio_id
        AND id <> v_match.id AND public.normalized_client_phone(phone) = v_phone
    ) THEN
      client_id := NULL; resolution := 'manual_review'; RETURN NEXT; RETURN;
    END IF;
    client_id := v_match.id; resolution := 'existing_auth'; RETURN NEXT; RETURN;
  END IF;
  -- bellza_owned_profile_multi_end
  IF v_count > 1 THEN$insert$;
BEGIN
  v_booking := pg_catalog.pg_get_functiondef(
    'public.resolve_booking_client_identity(uuid,text,text,text,boolean)'::regprocedure);
  v_profile := pg_catalog.pg_get_functiondef(
    'public.resolve_authenticated_studio_client(uuid,text,text)'::regprocedure);
  IF md5(v_booking) <> '91a610f0607173c57b3c7a864df374fb'
     OR md5(v_profile) <> 'c419f856fb10f4ed1c65419ef0947214'
     OR md5(pg_catalog.pg_get_functiondef(
       'public.create_public_booking_verified(text,uuid,timestamptz,uuid[],text,text,text,text,text,uuid)'::regprocedure
     )) <> '5645ec21134434a9e1014e10fe8c43a2'
     OR md5(pg_catalog.pg_get_functiondef(
       'public.create_public_joint_booking_verified(text,timestamptz,jsonb,text,text,text,text,text,uuid)'::regprocedure
     )) <> '7e80e1bbcac42d0434531f2cac34366c'
     OR md5(pg_catalog.pg_get_functiondef(
       'public.confirm_paid_booking_request(uuid,text)'::regprocedure
     )) <> 'bfe13ebf06626ce840834f90345209fe' THEN
    RAISE EXCEPTION 'authenticated_booking_definition_changed';
  END IF;
  IF has_function_privilege('anon', 'public.resolve_booking_client_identity(uuid,text,text,text,boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.resolve_booking_client_identity(uuid,text,text,text,boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.create_public_booking_verified(text,uuid,timestamptz,uuid[],text,text,text,text,text,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.create_public_booking_verified(text,uuid,timestamptz,uuid[],text,text,text,text,text,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.create_public_joint_booking_verified(text,timestamptz,jsonb,text,text,text,text,text,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.create_public_joint_booking_verified(text,timestamptz,jsonb,text,text,text,text,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated_booking_function_exposed';
  END IF;
  v_booking_anchor := replace(replace(v_booking_anchor, E'\r\n', E'\n'), E'\n',
    CASE WHEN strpos(v_booking, E'\r\n') > 0 THEN E'\r\n' ELSE E'\n' END);
  v_booking_insert := replace(replace(v_booking_insert, E'\r\n', E'\n'), E'\n',
    CASE WHEN strpos(v_booking, E'\r\n') > 0 THEN E'\r\n' ELSE E'\n' END);
  v_profile_anchor := replace(replace(v_profile_anchor, E'\r\n', E'\n'), E'\n',
    CASE WHEN strpos(v_profile, E'\r\n') > 0 THEN E'\r\n' ELSE E'\n' END);
  v_profile_insert := replace(replace(v_profile_insert, E'\r\n', E'\n'), E'\n',
    CASE WHEN strpos(v_profile, E'\r\n') > 0 THEN E'\r\n' ELSE E'\n' END);
  v_profile_multi_anchor := replace(replace(v_profile_multi_anchor, E'\r\n', E'\n'), E'\n',
    CASE WHEN strpos(v_profile, E'\r\n') > 0 THEN E'\r\n' ELSE E'\n' END);
  v_profile_multi_insert := replace(replace(v_profile_multi_insert, E'\r\n', E'\n'), E'\n',
    CASE WHEN strpos(v_profile, E'\r\n') > 0 THEN E'\r\n' ELSE E'\n' END);
  IF length(v_booking) - length(replace(v_booking, v_booking_anchor, '')) <> length(v_booking_anchor)
     OR length(v_profile) - length(replace(v_profile, v_profile_anchor, '')) <> length(v_profile_anchor)
     OR length(v_profile) - length(replace(v_profile, v_profile_multi_anchor, '')) <> length(v_profile_multi_anchor) THEN
    RAISE EXCEPTION 'authenticated_booking_anchor_changed';
  END IF;
  EXECUTE replace(v_booking, v_booking_anchor, v_booking_insert);
  EXECUTE replace(replace(v_profile, v_profile_anchor, v_profile_insert),
    v_profile_multi_anchor, v_profile_multi_insert);
END;
$guard$;

-- The service-only wrappers use the confirmed Supabase email, never a form
-- address, including the payment-request branch of the booking function.
CREATE OR REPLACE FUNCTION public.create_public_booking_verified(
  p_studio_slug text, p_staff_id uuid, p_starts_at timestamptz,
  p_service_ids uuid[], p_client_name text, p_client_phone text,
  p_client_email text, p_notes text, p_customer_referral_code text,
  p_verified_auth_user_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_context text;
  v_detail text;
  v_verified_email text;
  v_result jsonb;
  v_request_id uuid;
  v_studio_id uuid;
  v_owned_client_id uuid;
  v_owned_phone text;
  v_shared_phone boolean;
BEGIN
  IF p_verified_auth_user_id IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  SELECT lower(regexp_replace(email, '\s', '', 'g')) INTO v_verified_email
    FROM auth.users WHERE id = p_verified_auth_user_id AND email_confirmed_at IS NOT NULL;
  PERFORM pg_catalog.set_config('bellza.verified_auth_user_id', p_verified_auth_user_id::text, true);
  v_result := public.create_public_booking(
    p_studio_slug, p_staff_id, p_starts_at, p_service_ids, p_client_name,
    p_client_phone, v_verified_email, p_notes, p_customer_referral_code);
  v_request_id := NULLIF(v_result->>'booking_request_id', '')::uuid;
  SELECT id INTO v_studio_id FROM public.studios WHERE slug = p_studio_slug;
  SELECT EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.studio_id = v_studio_id
      AND public.normalized_client_phone(c.phone) = public.normalized_client_phone(p_client_phone)
      AND c.auth_user_id IS DISTINCT FROM p_verified_auth_user_id
  ) INTO v_shared_phone;
  IF v_request_id IS NOT NULL THEN
    -- Paid conversion resolves an exact client_phone; use this account's row.
    SELECT r.client_id INTO v_owned_client_id
      FROM public.resolve_booking_client_identity(
        v_studio_id, p_client_name, p_client_phone, v_verified_email, true) AS r;
    SELECT phone INTO v_owned_phone FROM public.clients
      WHERE id = v_owned_client_id AND studio_id = v_studio_id
        AND auth_user_id = p_verified_auth_user_id;
    v_shared_phone := v_shared_phone OR v_owned_phone LIKE 'account:%';
    IF v_owned_phone IS NULL OR
       (v_shared_phone AND (v_owned_phone NOT LIKE 'account:%' OR
        regexp_replace(v_owned_phone, '[^0-9]', '', 'g') <> '')) THEN
      RAISE EXCEPTION 'booking_owned_client_not_found';
    END IF;
    UPDATE public.booking_payment_requests
      SET client_phone = v_owned_phone
      WHERE id = v_request_id
        AND studio_id = v_studio_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'booking_request_not_found'; END IF;
  END IF;
  RETURN CASE WHEN v_shared_phone
    THEN v_result || jsonb_build_object('shared_contact_phone', true)
    ELSE v_result END;
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
DECLARE
  v_verified_email text;
  v_result jsonb;
  v_request_id uuid;
  v_studio_id uuid;
  v_owned_client_id uuid;
  v_owned_phone text;
  v_shared_phone boolean;
BEGIN
  IF p_verified_auth_user_id IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  SELECT lower(regexp_replace(email, '\s', '', 'g')) INTO v_verified_email
    FROM auth.users WHERE id = p_verified_auth_user_id AND email_confirmed_at IS NOT NULL;
  PERFORM pg_catalog.set_config('bellza.verified_auth_user_id', p_verified_auth_user_id::text, true);
  v_result := public.create_public_joint_booking(
    p_studio_slug, p_starts_at, p_service_assignments, p_client_name,
    p_client_phone, v_verified_email, p_notes, p_customer_referral_code);
  v_request_id := NULLIF(v_result->>'booking_request_id', '')::uuid;
  SELECT id INTO v_studio_id FROM public.studios WHERE slug = p_studio_slug;
  SELECT EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.studio_id = v_studio_id
      AND public.normalized_client_phone(c.phone) = public.normalized_client_phone(p_client_phone)
      AND c.auth_user_id IS DISTINCT FROM p_verified_auth_user_id
  ) INTO v_shared_phone;
  IF v_request_id IS NOT NULL THEN
    SELECT r.client_id INTO v_owned_client_id
      FROM public.resolve_booking_client_identity(
        v_studio_id, p_client_name, p_client_phone, v_verified_email, true) AS r;
    SELECT phone INTO v_owned_phone FROM public.clients
      WHERE id = v_owned_client_id AND studio_id = v_studio_id
        AND auth_user_id = p_verified_auth_user_id;
    v_shared_phone := v_shared_phone OR v_owned_phone LIKE 'account:%';
    IF v_owned_phone IS NULL OR
       (v_shared_phone AND (v_owned_phone NOT LIKE 'account:%' OR
        regexp_replace(v_owned_phone, '[^0-9]', '', 'g') <> '')) THEN
      RAISE EXCEPTION 'booking_owned_client_not_found';
    END IF;
    UPDATE public.booking_payment_requests
      SET client_phone = v_owned_phone
      WHERE id = v_request_id
        AND studio_id = v_studio_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'booking_request_not_found'; END IF;
  END IF;
  RETURN CASE WHEN v_shared_phone
    THEN v_result || jsonb_build_object('shared_contact_phone', true)
    ELSE v_result END;
END;
$$;

DO $grant_guard$
BEGIN
  IF has_function_privilege('anon', 'public.resolve_booking_client_identity(uuid,text,text,text,boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.resolve_booking_client_identity(uuid,text,text,text,boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.create_public_booking_verified(text,uuid,timestamptz,uuid[],text,text,text,text,text,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.create_public_booking_verified(text,uuid,timestamptz,uuid[],text,text,text,text,text,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.create_public_joint_booking_verified(text,timestamptz,jsonb,text,text,text,text,text,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.create_public_joint_booking_verified(text,timestamptz,jsonb,text,text,text,text,text,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.create_public_booking_verified(text,uuid,timestamptz,uuid[],text,text,text,text,text,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.create_public_joint_booking_verified(text,timestamptz,jsonb,text,text,text,text,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated_booking_grants_changed';
  END IF;
END;
$grant_guard$;

COMMIT;
