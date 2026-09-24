


-- The public-only dump omits extension definitions installed outside public.
-- The exclusion constraint below requires the UUID GiST operator class.
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."app_role" AS ENUM (
    'saas_owner',
    'studio_owner',
    'manager',
    'staff',
    'desk_staff'
);


ALTER TYPE "public"."app_role" OWNER TO "postgres";


CREATE TYPE "public"."appointment_status" AS ENUM (
    'pending',
    'confirmed',
    'completed',
    'cancelled',
    'no_show',
    'pending_payment'
);


ALTER TYPE "public"."appointment_status" OWNER TO "postgres";


CREATE TYPE "public"."subscription_plan" AS ENUM (
    'trial',
    'starter',
    'pro',
    'business'
);


ALTER TYPE "public"."subscription_plan" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."acknowledge_studio_notification_delivery"("p_delivery_id" "uuid", "p_receipt_token" "uuid", "p_stage" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_delivery public.studio_notification_deliveries%rowtype;
  v_changed boolean := false;
  v_user_id uuid;
  v_kind text;
  v_appointment_id uuid;
begin
  if p_stage not in ('received', 'displayed') then
    return false;
  end if;

  select d.*
  into v_delivery
  from public.studio_notification_deliveries d
  where d.id = p_delivery_id
    and d.receipt_token = p_receipt_token
    and d.status in ('delivering', 'sent')
  for update;

  if v_delivery.id is null then
    return false;
  end if;

  if p_stage = 'received' and v_delivery.received_at is null then
    update public.studio_notification_deliveries
    set received_at = now(),
        updated_at = now()
    where id = v_delivery.id;
    v_changed := true;
  elsif p_stage = 'displayed' and v_delivery.displayed_at is null then
    update public.studio_notification_deliveries
    set received_at = coalesce(received_at, now()),
        displayed_at = now(),
        updated_at = now()
    where id = v_delivery.id;
    v_changed := true;
  end if;

  if v_changed then
    select ps.user_id, n.kind, nullif(n.payload->>'appointment_id', '')::uuid
    into v_user_id, v_kind, v_appointment_id
    from public.studio_notifications n
    left join public.push_subscriptions ps on ps.id = v_delivery.subscription_id
    where n.id = v_delivery.notification_id;

    insert into public.notifications_log (
      studio_id,
      appointment_id,
      channel,
      kind,
      recipient,
      payload,
      status
    )
    values (
      v_delivery.studio_id,
      v_appointment_id,
      'push_studio',
      coalesce(v_kind, 'push_receipt'),
      'user:' || coalesce(v_user_id::text, 'unknown'),
      jsonb_build_object(
        'event', 'studio_notification_device_receipt',
        'studio_notification_id', v_delivery.notification_id,
        'delivery_id', v_delivery.id,
        'subscription_id', v_delivery.subscription_id,
        'stage', p_stage,
        'attempt', v_delivery.attempt_count
      ),
      p_stage
    );
  end if;

  return true;
end
$$;


ALTER FUNCTION "public"."acknowledge_studio_notification_delivery"("p_delivery_id" "uuid", "p_receipt_token" "uuid", "p_stage" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."activate_appointment_lifecycle"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'confirmed' THEN
      NEW.lifecycle_activated_at := coalesce(NEW.lifecycle_activated_at, now());
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.starts_at IS DISTINCT FROM NEW.starts_at
     OR OLD.staff_id IS DISTINCT FROM NEW.staff_id THEN
    NEW.reminder_sent_at := NULL;
    NEW.attendance_confirmation_requested_at := NULL;
    NEW.attendance_resolved_at := NULL;
    NEW.attendance_resolved_by := NULL;
    IF NEW.status = 'confirmed' THEN
      NEW.lifecycle_activated_at := now();
    END IF;
  ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'confirmed' THEN
    NEW.lifecycle_activated_at := coalesce(NEW.lifecycle_activated_at, now());
    NEW.attendance_confirmation_requested_at := NULL;
    NEW.attendance_resolved_at := NULL;
    NEW.attendance_resolved_by := NULL;
  END IF;
  RETURN NEW;
END
$$;


ALTER FUNCTION "public"."activate_appointment_lifecycle"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."cash_register_movements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "appointment_id" "uuid",
    "movement_type" "text" NOT NULL,
    "payment_method" "text" DEFAULT 'cash'::"text" NOT NULL,
    "amount" numeric(10,2) NOT NULL,
    "description" "text" NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source_key" "text",
    CONSTRAINT "cash_register_movements_amount_check" CHECK (("amount" >= (0)::numeric)),
    CONSTRAINT "cash_register_movements_movement_type_check" CHECK (("movement_type" = ANY (ARRAY['service_payment'::"text", 'product_payment'::"text", 'online_payment'::"text", 'manual_in'::"text", 'manual_out'::"text", 'sangria'::"text", 'transfer_in'::"text", 'transfer_out'::"text"]))),
    CONSTRAINT "cash_register_movements_payment_method_check" CHECK (("payment_method" = ANY (ARRAY['cash'::"text", 'mb_way'::"text", 'card'::"text", 'bank_transfer'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."cash_register_movements" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_cash_register_movement"("p_session_id" "uuid", "p_movement_type" "text", "p_payment_method" "text", "p_amount" numeric, "p_description" "text") RETURNS "public"."cash_register_movements"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_session public.cash_register_sessions%ROWTYPE;
  v_movement public.cash_register_movements%ROWTYPE;
BEGIN
  SELECT * INTO v_session
  FROM public.cash_register_sessions
  WHERE id = p_session_id
    AND status = 'open'
  FOR UPDATE;

  IF v_session.id IS NULL THEN RAISE EXCEPTION 'cash_register_not_open'; END IF;
  IF NOT public.is_studio_member(auth.uid(), v_session.studio_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF COALESCE(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  IF p_movement_type NOT IN ('manual_in','manual_out','sangria','transfer_in','transfer_out') THEN
    RAISE EXCEPTION 'invalid_movement_type';
  END IF;
  IF NULLIF(trim(COALESCE(p_description, '')), '') IS NULL THEN RAISE EXCEPTION 'invalid_description'; END IF;

  INSERT INTO public.cash_register_movements (
    session_id, studio_id, movement_type, payment_method, amount, description, created_by
  ) VALUES (
    v_session.id,
    v_session.studio_id,
    p_movement_type,
    COALESCE(NULLIF(p_payment_method, ''), 'cash'),
    p_amount,
    trim(p_description),
    auth.uid()
  )
  RETURNING * INTO v_movement;

  RETURN v_movement;
END;
$$;


ALTER FUNCTION "public"."add_cash_register_movement"("p_session_id" "uuid", "p_movement_type" "text", "p_payment_method" "text", "p_amount" numeric, "p_description" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_payment_intent_succeeded"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.status <> 'succeeded' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'succeeded' THEN
    RETURN NEW;
  END IF;

  IF NEW.appointment_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.financial_audit_logs (
    studio_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    amount_cents,
    currency,
    metadata
  )
  SELECT
    NEW.studio_id,
    NULL,
    'payment_intent',
    NEW.id,
    'booking_deposit_succeeded',
    NEW.amount_cents,
    COALESCE(NEW.currency, 'eur'),
    jsonb_build_object(
      'appointment_id', NEW.appointment_id,
      'booking_request_id', NEW.booking_request_id,
      'stripe_payment_intent_id', NEW.stripe_payment_intent_id,
      'stripe_checkout_session_id', NEW.stripe_checkout_session_id,
      'method', NEW.method
    )
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.financial_audit_logs existing
    WHERE existing.entity_type = 'payment_intent'
      AND existing.entity_id = NEW.id
      AND existing.action = 'booking_deposit_succeeded'
  );

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."audit_payment_intent_succeeded"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_use_studio"("_user_id" "uuid", "_studio_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles AS membership
    WHERE membership.user_id = _user_id
      AND membership.studio_id = _studio_id
      AND (
        membership.role IN ('studio_owner', 'saas_owner')
        OR (
          membership.role = 'manager'
          AND public.studio_has_entitlement(_studio_id, 'team_management')
        )
        OR (
          membership.role = 'staff'
          AND EXISTS (
            SELECT 1
            FROM public.staff AS professional
            WHERE professional.studio_id = _studio_id
              AND professional.user_id = _user_id
              AND professional.is_active = true
              AND public.studio_staff_is_within_plan(_studio_id, professional.id)
          )
        )
      )
  ) AND EXISTS (
    SELECT 1 FROM public.studios AS studio
    WHERE studio.id = _studio_id AND studio.is_active = true
  )
$$;


ALTER FUNCTION "public"."can_use_studio"("_user_id" "uuid", "_studio_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."capture_appointment_commission_snapshot"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  SELECT COALESCE(st.commission_percent, s.commission_percent, 0)
  INTO NEW.studio_commission_percent_snapshot
  FROM public.studios s
  LEFT JOIN public.staff st ON st.id = NEW.staff_id AND st.studio_id = s.id
  WHERE s.id = NEW.studio_id;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."capture_appointment_commission_snapshot"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."capture_appointment_service_commission_snapshot"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  SELECT COALESCE(svc.commission_percent, a.studio_commission_percent_snapshot, 0)
  INTO NEW.studio_commission_percent_snapshot
  FROM public.appointments a
  JOIN public.services svc ON svc.id = NEW.service_id AND svc.studio_id = a.studio_id
  WHERE a.id = NEW.appointment_id;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."capture_appointment_service_commission_snapshot"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."capture_booking_payment_pricing_snapshot"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_snapshot jsonb;
  v_total_price numeric(10,2);
  v_total_duration integer;
BEGIN
  -- Never trust a caller-provided snapshot. Service ids and current backend
  -- pricing rules are the only inputs accepted at request creation.
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'position', priced.position,
          'service_id', priced.service_id,
          'price', round(priced.price, 2),
          'duration_min', priced.duration_min,
          'is_upsell', priced.is_upsell,
          'offer_id', priced.offer_id
        ) ORDER BY priced.position
      ),
      '[]'::jsonb
    ),
    COALESCE(sum(priced.price), 0)::numeric(10,2),
    COALESCE(sum(priced.duration_min), 0)::integer
  INTO v_snapshot, v_total_price, v_total_duration
  FROM (
    SELECT
      array_position(NEW.service_ids, resolved.service_id)::integer AS position,
      resolved.*
    FROM public.resolve_booking_service_pricing(NEW.studio_id, NEW.service_ids) resolved
  ) priced;

  IF jsonb_array_length(v_snapshot) = 0 OR v_total_duration <= 0 THEN
    RAISE EXCEPTION 'invalid_services';
  END IF;

  NEW.pricing_snapshot := v_snapshot;
  NEW.total_price := v_total_price;
  NEW.total_duration_min := v_total_duration;
  NEW.ends_at := NEW.starts_at + make_interval(mins => v_total_duration);
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."capture_booking_payment_pricing_snapshot"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_studio_notification_deliveries"("p_limit" integer DEFAULT 100, "p_studio_id" "uuid" DEFAULT NULL::"uuid", "p_notification_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("delivery_id" "uuid", "notification_id" "uuid", "studio_id" "uuid", "subscription_id" "uuid", "endpoint" "text", "p256dh" "text", "auth" "text", "user_id" "uuid", "kind" "text", "title" "text", "body" "text", "action_url" "text", "payload" "jsonb", "attempt_count" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden';
  end if;

  perform public.enqueue_studio_notification_deliveries(p_studio_id, p_notification_id);

  return query
  with candidates as (
    select d.id
    from public.studio_notification_deliveries d
    join public.studio_notifications n on n.id = d.notification_id
    join public.push_subscriptions ps
      on ps.id = d.subscription_id
     and ps.studio_id = d.studio_id
     and ps.audience in ('studio', 'both')
     and ps.revoked_at is null
    where d.attempt_count < 12
      and d.next_attempt_at <= now()
      and (
        d.status in ('pending', 'retry')
        or (d.status = 'delivering' and d.lease_until < now())
      )
      and (p_studio_id is null or d.studio_id = p_studio_id)
      and (p_notification_id is null or d.notification_id = p_notification_id)
      and exists (
        select 1
        from public.user_roles ur
        where ur.user_id = ps.user_id
          and ur.studio_id = d.studio_id
      )
    order by n.created_at asc, d.created_at asc
    limit greatest(1, least(coalesce(p_limit, 100), 500))
    for update of d skip locked
  ),
  claimed as (
    update public.studio_notification_deliveries d
    set status = 'delivering',
        attempt_count = d.attempt_count + 1,
        last_attempt_at = now(),
        lease_until = now() + interval '2 minutes',
        updated_at = now()
    from candidates c
    where d.id = c.id
    returning d.*
  )
  select
    c.id,
    c.notification_id,
    c.studio_id,
    c.subscription_id,
    ps.endpoint,
    ps.p256dh,
    ps.auth,
    ps.user_id,
    n.kind,
    n.title,
    n.body,
    coalesce(n.action_url, public.notification_default_action_url(n.kind, n.payload)),
    jsonb_set(
      coalesce(n.payload, '{}'::jsonb),
      '{delivery_receipt_token}',
      to_jsonb(c.receipt_token::text),
      true
    ),
    c.attempt_count
  from claimed c
  join public.studio_notifications n on n.id = c.notification_id
  join public.push_subscriptions ps on ps.id = c.subscription_id;
end
$$;


ALTER FUNCTION "public"."claim_studio_notification_deliveries"("p_limit" integer, "p_studio_id" "uuid", "p_notification_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_whatsapp_trial_for_owner"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
DECLARE
  v_email text;
  v_kind text;
  v_value text;
  v_hash text;
  v_entitlement public.whatsapp_studio_entitlements%ROWTYPE;
  v_reused boolean := false;
BEGIN
  IF NEW.role <> 'studio_owner' OR NEW.studio_id IS NULL THEN RETURN NEW; END IF;
  SELECT lower(trim(email)) INTO v_email FROM auth.users WHERE id = NEW.user_id;
  SELECT * INTO v_entitlement FROM public.whatsapp_studio_entitlements WHERE studio_id = NEW.studio_id FOR UPDATE;
  IF NOT FOUND OR v_entitlement.status <> 'trial' THEN RETURN NEW; END IF;

  FOREACH v_kind IN ARRAY ARRAY['account', 'email'] LOOP
    v_value := CASE WHEN v_kind = 'account' THEN NEW.user_id::text ELSE nullif(v_email, '') END;
    IF v_value IS NULL THEN CONTINUE; END IF;
    v_hash := encode(extensions.digest(v_value::bytea, 'sha256'), 'hex');
    IF EXISTS (
      SELECT 1 FROM public.whatsapp_trial_identity_claims c
      WHERE c.identity_kind = v_kind AND c.identity_hash = v_hash
        AND c.studio_id IS DISTINCT FROM NEW.studio_id
    ) THEN
      v_reused := true;
    END IF;
  END LOOP;

  IF v_reused THEN
    UPDATE public.whatsapp_studio_entitlements
    SET status = 'inactive', trial_ends_at = NULL,
        paused_reason = 'trial_identity_already_used', updated_at = now()
    WHERE studio_id = NEW.studio_id;
    RETURN NEW;
  END IF;

  FOREACH v_kind IN ARRAY ARRAY['account', 'email'] LOOP
    v_value := CASE WHEN v_kind = 'account' THEN NEW.user_id::text ELSE nullif(v_email, '') END;
    IF v_value IS NULL THEN CONTINUE; END IF;
    INSERT INTO public.whatsapp_trial_identity_claims (
      studio_id, identity_kind, identity_hash, claimed_at, trial_ends_at
    ) VALUES (
      NEW.studio_id, v_kind,
      encode(extensions.digest(v_value::bytea, 'sha256'), 'hex'),
      coalesce(v_entitlement.trial_started_at, now()), v_entitlement.trial_ends_at
    ) ON CONFLICT (identity_kind, identity_hash) DO NOTHING;
  END LOOP;
  RETURN NEW;
END
$$;


ALTER FUNCTION "public"."claim_whatsapp_trial_for_owner"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cash_register_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "opened_by" "uuid",
    "closed_by" "uuid",
    "opening_amount" numeric(10,2) DEFAULT 0 NOT NULL,
    "opened_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "closed_at" timestamp with time zone,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "closing_counted_amount" numeric(10,2),
    "expected_cash_amount" numeric(10,2),
    "difference_amount" numeric(10,2),
    "closing_note" "text",
    "summary" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cash_register_sessions_opening_amount_check" CHECK (("opening_amount" >= (0)::numeric)),
    CONSTRAINT "cash_register_sessions_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'closed'::"text"])))
);


ALTER TABLE "public"."cash_register_sessions" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."close_cash_register"("p_session_id" "uuid", "p_counted_amount" numeric, "p_note" "text" DEFAULT NULL::"text") RETURNS "public"."cash_register_sessions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_session public.cash_register_sessions%ROWTYPE;
  v_summary JSONB;
  v_total_in NUMERIC(10,2);
  v_total_out NUMERIC(10,2);
  v_expected NUMERIC(10,2);
BEGIN
  SELECT * INTO v_session
  FROM public.cash_register_sessions
  WHERE id = p_session_id
    AND status = 'open'
  FOR UPDATE;

  IF v_session.id IS NULL THEN RAISE EXCEPTION 'cash_register_not_open'; END IF;
  IF NOT public.is_studio_member(auth.uid(), v_session.studio_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF COALESCE(p_counted_amount, 0) < 0 THEN RAISE EXCEPTION 'invalid_counted_amount'; END IF;

  SELECT
    COALESCE(sum(amount) FILTER (WHERE movement_type NOT IN ('manual_out','sangria','transfer_out')), 0),
    COALESCE(sum(amount) FILTER (WHERE movement_type IN ('manual_out','sangria','transfer_out')), 0),
    jsonb_build_object(
      'by_method', jsonb_build_object(
        'cash', COALESCE(sum(amount) FILTER (WHERE payment_method = 'cash' AND movement_type NOT IN ('manual_out','sangria','transfer_out')), 0),
        'mb_way', COALESCE(sum(amount) FILTER (WHERE payment_method = 'mb_way' AND movement_type NOT IN ('manual_out','sangria','transfer_out')), 0),
        'card', COALESCE(sum(amount) FILTER (WHERE payment_method = 'card' AND movement_type NOT IN ('manual_out','sangria','transfer_out')), 0),
        'bank_transfer', COALESCE(sum(amount) FILTER (WHERE payment_method = 'bank_transfer' AND movement_type NOT IN ('manual_out','sangria','transfer_out')), 0),
        'other', COALESCE(sum(amount) FILTER (WHERE payment_method = 'other' AND movement_type NOT IN ('manual_out','sangria','transfer_out')), 0)
      ),
      'total_in', COALESCE(sum(amount) FILTER (WHERE movement_type NOT IN ('manual_out','sangria','transfer_out')), 0),
      'total_out', COALESCE(sum(amount) FILTER (WHERE movement_type IN ('manual_out','sangria','transfer_out')), 0),
      'manual_in', COALESCE(sum(amount) FILTER (WHERE movement_type = 'manual_in'), 0),
      'manual_out', COALESCE(sum(amount) FILTER (WHERE movement_type = 'manual_out'), 0),
      'transfer_in', COALESCE(sum(amount) FILTER (WHERE movement_type = 'transfer_in'), 0),
      'transfer_out', COALESCE(sum(amount) FILTER (WHERE movement_type = 'transfer_out'), 0),
      'sangria', COALESCE(sum(amount) FILTER (WHERE movement_type = 'sangria'), 0),
      'service_payments', COALESCE(sum(amount) FILTER (WHERE movement_type = 'service_payment'), 0),
      'movements', COALESCE(count(id), 0)
    )
  INTO v_total_in, v_total_out, v_summary
  FROM public.cash_register_movements
  WHERE session_id = v_session.id;

  v_expected := v_session.opening_amount + v_total_in - v_total_out;

  UPDATE public.cash_register_sessions
  SET
    status = 'closed',
    closed_by = auth.uid(),
    closed_at = now(),
    closing_counted_amount = COALESCE(p_counted_amount, 0),
    expected_cash_amount = v_expected,
    difference_amount = COALESCE(p_counted_amount, 0) - v_expected,
    closing_note = NULLIF(trim(COALESCE(p_note, '')), ''),
    summary = v_summary
  WHERE id = v_session.id
    AND status = 'open'
  RETURNING * INTO v_session;

  IF v_session.id IS NULL THEN RAISE EXCEPTION 'cash_register_close_failed'; END IF;

  RETURN v_session;
END;
$$;


ALTER FUNCTION "public"."close_cash_register"("p_session_id" "uuid", "p_counted_amount" numeric, "p_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."confirm_paid_booking_request"("p_request_id" "uuid", "p_stripe_payment_intent_id" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_req public.booking_payment_requests%ROWTYPE;
  v_client_id uuid;
  v_existing_client_id uuid;
  v_appt_id uuid;
  v_payment_status text;
BEGIN
  SELECT * INTO v_req
  FROM public.booking_payment_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking_request_not_found'; END IF;

  IF v_req.status = 'converted' AND v_req.appointment_id IS NOT NULL THEN
    RETURN v_req.appointment_id;
  END IF;
  IF v_req.status IN ('expired','failed','canceled','paid_conflict') THEN
    RAISE EXCEPTION 'booking_request_not_payable';
  END IF;
  IF v_req.expires_at <= now() - interval '5 minutes' THEN
    UPDATE public.booking_payment_requests
    SET status = 'expired',
        failure_reason = COALESCE(failure_reason, 'checkout_expired'),
        updated_at = now()
    WHERE id = v_req.id;
    RAISE EXCEPTION 'booking_request_expired';
  END IF;

  SELECT status INTO v_payment_status
  FROM public.payment_intents
  WHERE booking_request_id = p_request_id
    AND (p_stripe_payment_intent_id IS NULL OR stripe_payment_intent_id = p_stripe_payment_intent_id)
  ORDER BY created_at DESC
  LIMIT 1;
  IF v_payment_status IS DISTINCT FROM 'succeeded' THEN RAISE EXCEPTION 'payment_not_succeeded'; END IF;

  IF NOT public.is_staff_slot_bookable(
    v_req.studio_id, v_req.staff_id, v_req.starts_at,
    v_req.total_duration_min, v_req.id, NULL
  ) THEN
    UPDATE public.booking_payment_requests
    SET status = 'paid_conflict', failure_reason = 'slot_unavailable_after_payment', updated_at = now()
    WHERE id = v_req.id;
    RAISE EXCEPTION 'slot_unavailable_after_payment';
  END IF;

  SELECT id INTO v_existing_client_id
  FROM public.clients
  WHERE studio_id = v_req.studio_id
    AND (
      phone = trim(v_req.client_phone)
      OR (
        nullif(trim(coalesce(v_req.client_email, '')), '') IS NOT NULL
        AND email IS NOT NULL
        AND lower(email) = lower(nullif(trim(coalesce(v_req.client_email, '')), ''))
      )
    )
  ORDER BY (phone LIKE 'account:%') ASC, updated_at DESC
  LIMIT 1;

  UPDATE public.booking_payment_requests SET status = 'paid', updated_at = now() WHERE id = v_req.id;

  v_client_id := v_existing_client_id;
  IF v_client_id IS NULL THEN
    INSERT INTO public.clients (studio_id, name, phone, email)
    VALUES (
      v_req.studio_id,
      trim(v_req.client_name),
      trim(v_req.client_phone),
      nullif(trim(coalesce(v_req.client_email, '')), '')
    )
    ON CONFLICT (studio_id, phone) DO NOTHING
    RETURNING id INTO v_client_id;
    IF v_client_id IS NULL THEN
      SELECT id INTO v_client_id
      FROM public.clients
      WHERE studio_id = v_req.studio_id AND phone = trim(v_req.client_phone)
      LIMIT 1;
    END IF;
  END IF;
  IF v_client_id IS NULL THEN RAISE EXCEPTION 'client_identity_resolution_failed'; END IF;

  INSERT INTO public.appointments (
    studio_id, staff_id, client_id, starts_at, ends_at, status,
    total_price, total_duration_min, notes
  ) VALUES (
    v_req.studio_id, v_req.staff_id, v_client_id, v_req.starts_at, v_req.ends_at,
    'confirmed', v_req.total_price, v_req.total_duration_min, v_req.notes
  ) RETURNING id INTO v_appt_id;

  IF jsonb_array_length(v_req.pricing_snapshot) > 0 THEN
    INSERT INTO public.appointment_services (
      appointment_id, service_id, is_upsell, price, duration_min
    )
    SELECT
      v_appt_id, line.service_id, line.is_upsell,
      round(line.price, 2), line.duration_min
    FROM jsonb_to_recordset(v_req.pricing_snapshot) AS line(
      position integer,
      service_id uuid,
      price numeric,
      duration_min integer,
      is_upsell boolean,
      offer_id uuid
    )
    ORDER BY line.position;
  ELSE
    -- Compatibility for a checkout created before this migration. New requests
    -- always use the immutable snapshot branch above.
    INSERT INTO public.appointment_services (appointment_id, service_id, is_upsell, price, duration_min)
    SELECT v_appt_id, service_id, is_upsell, price, duration_min
    FROM public.resolve_booking_service_pricing(v_req.studio_id, v_req.service_ids);
  END IF;
  PERFORM public.record_upsell_acceptances_for_services(v_req.studio_id, v_req.service_ids);

  UPDATE public.booking_payment_requests
  SET status = 'converted', appointment_id = v_appt_id, updated_at = now()
  WHERE id = v_req.id;

  UPDATE public.customer_referrals
  SET referred_client_id = v_client_id,
      appointment_id = v_appt_id,
      referred_client_was_existing = COALESCE(referred_client_was_existing, false) OR (v_existing_client_id IS NOT NULL),
      status = CASE
        WHEN referrer_client_id = v_client_id THEN 'rejected'
        WHEN COALESCE(referred_client_was_existing, false) OR (v_existing_client_id IS NOT NULL) THEN 'rejected'
        ELSE status
      END,
      rejection_reason = CASE
        WHEN referrer_client_id = v_client_id THEN 'self_referral'
        WHEN COALESCE(referred_client_was_existing, false) OR (v_existing_client_id IS NOT NULL) THEN 'existing_client'
        ELSE rejection_reason
      END,
      updated_at = now()
  WHERE studio_id = v_req.studio_id AND booking_request_id = v_req.id;

  IF p_stripe_payment_intent_id IS NOT NULL THEN
    UPDATE public.payment_intents
    SET appointment_id = v_appt_id, updated_at = now()
    WHERE stripe_payment_intent_id = p_stripe_payment_intent_id;
  END IF;

  RETURN v_appt_id;
EXCEPTION
  WHEN exclusion_violation THEN
    UPDATE public.booking_payment_requests
    SET status = 'paid_conflict', failure_reason = 'slot_unavailable_after_payment', updated_at = now()
    WHERE id = p_request_id;
    RAISE EXCEPTION 'slot_unavailable_after_payment';
END;
$$;


ALTER FUNCTION "public"."confirm_paid_booking_request"("p_request_id" "uuid", "p_stripe_payment_intent_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."confirm_studio_appointment_payment"("p_appointment_id" "uuid", "p_payment_method" "text" DEFAULT 'cash'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_appointment public.appointments%ROWTYPE;
BEGIN
  SELECT * INTO v_appointment
  FROM public.appointments
  WHERE id = p_appointment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'appointment_not_found'; END IF;
  IF NOT public.is_studio_member(auth.uid(), v_appointment.studio_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  RETURN public.settle_appointment_attendance_core(
    v_appointment.id,
    v_appointment.studio_id,
    'completed',
    auth.uid(),
    p_payment_method
  );
END
$$;


ALTER FUNCTION "public"."confirm_studio_appointment_payment"("p_appointment_id" "uuid", "p_payment_method" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."consume_rate_limit"("p_key" "text", "p_limit" integer, "p_window_seconds" integer) RETURNS TABLE("allowed" boolean, "retry_after" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_now timestamptz := now();
  v_count integer;
  v_reset_at timestamptz;
BEGIN
  INSERT INTO public.server_rate_limits AS buckets (key, count, reset_at, updated_at)
  VALUES (p_key, 1, v_now + make_interval(secs => p_window_seconds), v_now)
  ON CONFLICT (key) DO UPDATE
    SET count = CASE
          WHEN buckets.reset_at <= v_now THEN 1
          ELSE buckets.count + 1
        END,
        reset_at = CASE
          WHEN buckets.reset_at <= v_now THEN v_now + make_interval(secs => p_window_seconds)
          ELSE buckets.reset_at
        END,
        updated_at = v_now
  RETURNING buckets.count, buckets.reset_at
  INTO v_count, v_reset_at;

  RETURN QUERY SELECT
    v_count <= p_limit,
    GREATEST(0, CEIL(EXTRACT(EPOCH FROM (v_reset_at - v_now)))::integer);
END;
$$;


ALTER FUNCTION "public"."consume_rate_limit"("p_key" "text", "p_limit" integer, "p_window_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_manual_appointment"("p_studio_id" "uuid", "p_staff_id" "uuid", "p_service_id" "uuid", "p_starts_at" timestamp with time zone, "p_client_id" "uuid" DEFAULT NULL::"uuid", "p_client_name" "text" DEFAULT NULL::"text", "p_client_phone" "text" DEFAULT NULL::"text", "p_notes" "text" DEFAULT NULL::"text", "p_is_fit" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_service public.services%ROWTYPE;
  v_client_id uuid;
  v_ends_at timestamptz;
  v_appointment_id uuid;
  v_phone text;
BEGIN
  IF NOT public.can_use_studio(auth.uid(), p_studio_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT * INTO v_service
  FROM public.services
  WHERE id = p_service_id AND studio_id = p_studio_id AND is_active = true;
  IF v_service.id IS NULL THEN RAISE EXCEPTION 'service_not_found'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.staff
    WHERE id = p_staff_id
      AND studio_id = p_studio_id
      AND is_active = true
      AND COALESCE(current_status, 'online') <> 'absent'
  ) THEN
    RAISE EXCEPTION 'staff_unavailable';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.staff_services
    WHERE staff_id = p_staff_id AND service_id = p_service_id
  ) THEN
    RAISE EXCEPTION 'staff_service_unavailable';
  END IF;

  v_ends_at := p_starts_at + make_interval(mins => v_service.duration_min);
  IF p_is_fit THEN
    IF NOT public.is_staff_managerial_slot_bookable(
      p_studio_id, p_staff_id, p_starts_at, v_service.duration_min, NULL
    ) THEN
      RAISE EXCEPTION 'slot_unavailable';
    END IF;
  ELSIF NOT public.is_staff_slot_bookable(
    p_studio_id, p_staff_id, p_starts_at, v_service.duration_min
  ) THEN
    RAISE EXCEPTION 'slot_unavailable';
  END IF;

  IF p_client_id IS NOT NULL THEN
    SELECT id INTO v_client_id
    FROM public.clients
    WHERE id = p_client_id AND studio_id = p_studio_id;
    IF v_client_id IS NULL THEN RAISE EXCEPTION 'client_not_found'; END IF;
  ELSE
    v_phone := NULLIF(trim(COALESCE(p_client_phone, '')), '');
    IF NULLIF(trim(COALESCE(p_client_name, '')), '') IS NULL OR v_phone IS NULL THEN
      RAISE EXCEPTION 'client_details_required';
    END IF;
    INSERT INTO public.clients (studio_id, name, phone)
    VALUES (p_studio_id, trim(p_client_name), v_phone)
    ON CONFLICT (studio_id, phone) DO UPDATE
      SET name = EXCLUDED.name, updated_at = now()
    RETURNING id INTO v_client_id;
  END IF;

  INSERT INTO public.appointments (
    studio_id, client_id, staff_id, starts_at, ends_at, status,
    total_price, total_duration_min, notes, notification_suppressed, updated_at
  ) VALUES (
    p_studio_id, v_client_id, p_staff_id, p_starts_at, v_ends_at, 'confirmed',
    v_service.price, v_service.duration_min,
    NULLIF(trim(COALESCE(p_notes, '')), ''), COALESCE(p_is_fit, false), now()
  )
  RETURNING id INTO v_appointment_id;

  INSERT INTO public.appointment_services (
    appointment_id, service_id, is_upsell, price, duration_min
  ) VALUES (
    v_appointment_id, v_service.id, false, v_service.price, v_service.duration_min
  );

  RETURN jsonb_build_object(
    'appointment_id', v_appointment_id,
    'client_id', v_client_id,
    'starts_at', p_starts_at,
    'ends_at', v_ends_at
  );
EXCEPTION
  WHEN exclusion_violation THEN RAISE EXCEPTION 'slot_unavailable';
END
$$;


ALTER FUNCTION "public"."create_manual_appointment"("p_studio_id" "uuid", "p_staff_id" "uuid", "p_service_id" "uuid", "p_starts_at" timestamp with time zone, "p_client_id" "uuid", "p_client_name" "text", "p_client_phone" "text", "p_notes" "text", "p_is_fit" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_public_booking"("p_studio_slug" "text", "p_staff_id" "uuid", "p_starts_at" timestamp with time zone, "p_service_ids" "uuid"[], "p_client_name" "text", "p_client_phone" "text", "p_client_email" "text" DEFAULT NULL::"text", "p_notes" "text" DEFAULT NULL::"text", "p_customer_referral_code" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_studio_id uuid;
  v_mode text;
BEGIN
  SELECT
    studio.id,
    CASE
      WHEN public.studio_has_entitlement(studio.id, 'whatsapp') THEN studio.booking_flow_mode
      ELSE 'online'
    END
  INTO v_studio_id, v_mode
  FROM public.studios AS studio
  WHERE studio.slug = p_studio_slug
    AND studio.is_active = true
    AND public.studio_has_entitlement(studio.id, 'online_booking');

  IF v_studio_id IS NULL THEN RAISE EXCEPTION 'studio_not_available'; END IF;
  IF v_mode <> 'online' THEN RAISE EXCEPTION 'booking_request_mode_only'; END IF;

  RETURN public.create_public_booking_online_core(
    p_studio_slug, p_staff_id, p_starts_at, p_service_ids,
    p_client_name, p_client_phone, p_client_email, p_notes,
    p_customer_referral_code
  );
END
$$;


ALTER FUNCTION "public"."create_public_booking"("p_studio_slug" "text", "p_staff_id" "uuid", "p_starts_at" timestamp with time zone, "p_service_ids" "uuid"[], "p_client_name" "text", "p_client_phone" "text", "p_client_email" "text", "p_notes" "text", "p_customer_referral_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_public_booking_online_core"("p_studio_slug" "text", "p_staff_id" "uuid", "p_starts_at" timestamp with time zone, "p_service_ids" "uuid"[], "p_client_name" "text", "p_client_phone" "text", "p_client_email" "text" DEFAULT NULL::"text", "p_notes" "text" DEFAULT NULL::"text", "p_customer_referral_code" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_studio_id uuid;
  v_payment_policy text;
  v_client_id uuid;
  v_existing_client_id uuid;
  v_client_was_existing boolean := false;
  v_appt_id uuid;
  v_request_id uuid;
  v_total_duration integer := 0;
  v_total_price numeric(10,2) := 0;
  v_ends_at timestamptz;
  v_available boolean;
  v_min_booking_notice_min integer := 30;
  v_client_email text := nullif(trim(coalesce(p_client_email, '')), '');
  v_client_phone text := trim(p_client_phone);
BEGIN
  IF p_client_name IS NULL OR length(trim(p_client_name)) < 2 THEN RAISE EXCEPTION 'invalid_name'; END IF;
  IF p_client_phone IS NULL OR length(regexp_replace(trim(p_client_phone), '\D', '', 'g')) < 9 THEN RAISE EXCEPTION 'invalid_phone'; END IF;
  IF array_length(p_service_ids, 1) IS NULL THEN RAISE EXCEPTION 'no_services'; END IF;

  PERFORM public.expire_pending_appointments();

  SELECT
    studio.id,
    CASE
      WHEN public.studio_has_entitlement(studio.id, 'online_payments') THEN studio.payment_policy
      ELSE 'pay_in_studio'
    END,
    COALESCE(studio.min_booking_notice_min, 30)
  INTO v_studio_id, v_payment_policy, v_min_booking_notice_min
  FROM public.studios AS studio
  WHERE studio.slug = p_studio_slug
    AND studio.is_active = true
    AND public.studio_has_entitlement(studio.id, 'online_booking');
  IF v_studio_id IS NULL THEN RAISE EXCEPTION 'studio_not_available'; END IF;

  IF v_client_email IS NOT NULL THEN
    SELECT id INTO v_existing_client_id
    FROM public.clients
    WHERE studio_id = v_studio_id
      AND email IS NOT NULL
      AND lower(email) = lower(v_client_email)
    ORDER BY (phone LIKE 'account:%') ASC, updated_at DESC
    LIMIT 1;
  END IF;

  IF v_existing_client_id IS NULL THEN
    SELECT id INTO v_existing_client_id
    FROM public.clients
    WHERE studio_id = v_studio_id
      AND phone = v_client_phone
      AND (
        v_client_email IS NULL OR email IS NULL OR lower(email) = lower(v_client_email)
      )
    ORDER BY updated_at DESC
    LIMIT 1;
  END IF;
  v_client_was_existing := v_existing_client_id IS NOT NULL;

  PERFORM public.raise_client_booking_block_if_needed(v_studio_id, p_client_phone);

  IF p_starts_at < now() + (v_min_booking_notice_min || ' minutes')::interval THEN
    RAISE EXCEPTION 'booking_too_soon';
  END IF;

  PERFORM 1 FROM public.staff
  WHERE id = p_staff_id
    AND studio_id = v_studio_id
    AND is_active = true
    AND COALESCE(current_status, 'online') <> 'absent'
    AND public.studio_staff_is_within_plan(v_studio_id, p_staff_id);
  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1 FROM public.staff
      WHERE id = p_staff_id
        AND studio_id = v_studio_id
        AND is_active = true
        AND COALESCE(current_status, 'online') = 'absent'
        AND public.studio_staff_is_within_plan(v_studio_id, p_staff_id)
    ) THEN
      RAISE EXCEPTION 'staff_off';
    END IF;
    RAISE EXCEPTION 'staff_not_found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_service_ids) AS requested(service_id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.staff_services ss
      JOIN public.services s ON s.id = ss.service_id
      WHERE ss.staff_id = p_staff_id
        AND ss.service_id = requested.service_id
        AND s.studio_id = v_studio_id
        AND s.is_active = true
    )
  ) THEN RAISE EXCEPTION 'staff_cannot_perform_service'; END IF;

  SELECT
    COALESCE(sum(duration_min), 0)::integer,
    COALESCE(sum(price), 0)::numeric(10,2)
  INTO v_total_duration, v_total_price
  FROM public.resolve_booking_service_pricing(v_studio_id, p_service_ids);
  IF v_total_duration = 0 THEN RAISE EXCEPTION 'invalid_services'; END IF;

  v_ends_at := p_starts_at + (v_total_duration || ' minutes')::interval;
  SELECT public.is_staff_slot_bookable(v_studio_id, p_staff_id, p_starts_at, v_total_duration)
  INTO v_available;
  IF NOT v_available THEN RAISE EXCEPTION 'slot_unavailable'; END IF;

  IF v_payment_policy = 'pre_payment' THEN
    INSERT INTO public.booking_payment_requests (
      studio_id, staff_id, service_ids, starts_at, ends_at, total_price, total_duration_min,
      client_name, client_phone, client_email, notes, status, expires_at
    ) VALUES (
      v_studio_id, p_staff_id, p_service_ids, p_starts_at, v_ends_at, v_total_price, v_total_duration,
      trim(p_client_name), v_client_phone, v_client_email,
      nullif(trim(coalesce(p_notes, '')), ''), 'awaiting_payment', now() + interval '15 minutes'
    ) RETURNING id INTO v_request_id;

    IF public.studio_has_entitlement(v_studio_id, 'loyalty') THEN
      PERFORM public.record_customer_referral_intent(
        v_studio_id, p_customer_referral_code, v_request_id, NULL, NULL, v_client_was_existing
      );
    END IF;

    RETURN jsonb_build_object(
      'booking_request_id', v_request_id, 'appointment_id', NULL,
      'studio_id', v_studio_id, 'starts_at', p_starts_at, 'ends_at', v_ends_at,
      'total_price', v_total_price, 'total_duration_min', v_total_duration,
      'requires_payment', true, 'reservation_status', 'awaiting_payment',
      'payment_status', 'not_started'
    );
  END IF;

  v_client_id := v_existing_client_id;
  IF v_client_id IS NULL THEN
    INSERT INTO public.clients (studio_id, name, phone, email)
    VALUES (v_studio_id, trim(p_client_name), v_client_phone, v_client_email)
    ON CONFLICT (studio_id, phone) DO NOTHING
    RETURNING id INTO v_client_id;

    IF v_client_id IS NULL THEN
      SELECT id INTO v_client_id
      FROM public.clients
      WHERE studio_id = v_studio_id AND phone = v_client_phone
      LIMIT 1;
    END IF;
  END IF;
  IF v_client_id IS NULL THEN RAISE EXCEPTION 'client_identity_resolution_failed'; END IF;

  INSERT INTO public.appointments (
    studio_id, staff_id, client_id, starts_at, ends_at, status,
    total_price, total_duration_min, notes
  ) VALUES (
    v_studio_id, p_staff_id, v_client_id, p_starts_at, v_ends_at, 'confirmed',
    v_total_price, v_total_duration, nullif(trim(coalesce(p_notes, '')), '')
  ) RETURNING id INTO v_appt_id;

  INSERT INTO public.appointment_services (appointment_id, service_id, is_upsell, price, duration_min)
  SELECT v_appt_id, service_id, is_upsell, price, duration_min
  FROM public.resolve_booking_service_pricing(v_studio_id, p_service_ids);

  IF public.studio_has_entitlement(v_studio_id, 'promotions') THEN
    PERFORM public.record_upsell_acceptances_for_services(v_studio_id, p_service_ids);
  END IF;
  IF public.studio_has_entitlement(v_studio_id, 'loyalty') THEN
    PERFORM public.record_customer_referral_intent(
      v_studio_id, p_customer_referral_code, NULL, v_appt_id, v_client_id, v_client_was_existing
    );
  END IF;

  RETURN jsonb_build_object(
    'appointment_id', v_appt_id, 'booking_request_id', NULL,
    'studio_id', v_studio_id, 'starts_at', p_starts_at, 'ends_at', v_ends_at,
    'total_price', v_total_price, 'total_duration_min', v_total_duration,
    'requires_payment', false, 'reservation_status', 'confirmed',
    'payment_status', 'pay_in_studio'
  );
EXCEPTION
  WHEN exclusion_violation THEN RAISE EXCEPTION 'slot_unavailable';
END;
$$;


ALTER FUNCTION "public"."create_public_booking_online_core"("p_studio_slug" "text", "p_staff_id" "uuid", "p_starts_at" timestamp with time zone, "p_service_ids" "uuid"[], "p_client_name" "text", "p_client_phone" "text", "p_client_email" "text", "p_notes" "text", "p_customer_referral_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_studio_manual_fit"("p_studio_id" "uuid", "p_staff_id" "uuid", "p_service_id" "uuid", "p_starts_at" timestamp with time zone, "p_client_id" "uuid", "p_client_name" "text", "p_client_phone" "text", "p_notes" "text", "p_confirm_overlap" boolean, "p_actor_id" "uuid", "p_expected_conflict_ids" "uuid"[] DEFAULT ARRAY[]::"uuid"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_service public.services%ROWTYPE;
  v_client_id uuid;
  v_phone text;
  v_end timestamptz;
  v_preview jsonb;
  v_conflicts jsonb;
  v_conflict_ids uuid[];
  v_appointment_id uuid;
BEGIN
  IF p_actor_id IS NULL OR NOT public.can_use_studio(p_actor_id, p_studio_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_studio_id::text, 726354));

  SELECT * INTO v_service FROM public.services
  WHERE id = p_service_id AND studio_id = p_studio_id AND is_active = true;
  IF v_service.id IS NULL THEN RAISE EXCEPTION 'service_not_found'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.staff
    WHERE id = p_staff_id AND studio_id = p_studio_id AND is_active = true
      AND COALESCE(current_status, 'online') <> 'absent'
  ) THEN RAISE EXCEPTION 'staff_unavailable'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.staff_services WHERE staff_id = p_staff_id AND service_id = p_service_id
  ) THEN RAISE EXCEPTION 'staff_service_unavailable'; END IF;

  v_preview := public.preview_studio_schedule_change(
    p_studio_id, p_staff_id, p_starts_at, v_service.duration_min, ARRAY[]::uuid[]
  );
  IF COALESCE((v_preview->>'hardBlocked')::boolean, false) THEN RAISE EXCEPTION 'schedule_hard_blocked'; END IF;
  v_conflicts := COALESCE(v_preview->'conflicts', '[]'::jsonb);
  SELECT COALESCE(array_agg(DISTINCT (item->>'appointmentId')::uuid), ARRAY[]::uuid[])
  INTO v_conflict_ids FROM jsonb_array_elements(v_conflicts) AS item;
  IF jsonb_array_length(v_conflicts) > 0 AND NOT COALESCE(p_confirm_overlap, false) THEN
    RAISE EXCEPTION 'schedule_conflict';
  END IF;
  IF COALESCE(p_confirm_overlap, false)
     AND NOT (
       v_conflict_ids <@ COALESCE(p_expected_conflict_ids, ARRAY[]::uuid[])
       AND COALESCE(p_expected_conflict_ids, ARRAY[]::uuid[]) <@ v_conflict_ids
     ) THEN
    RAISE EXCEPTION 'schedule_conflict_changed';
  END IF;

  IF p_client_id IS NOT NULL THEN
    SELECT id INTO v_client_id FROM public.clients
    WHERE id = p_client_id AND studio_id = p_studio_id;
    IF v_client_id IS NULL THEN RAISE EXCEPTION 'client_not_found'; END IF;
  ELSE
    v_phone := NULLIF(trim(COALESCE(p_client_phone, '')), '');
    IF NULLIF(trim(COALESCE(p_client_name, '')), '') IS NULL OR v_phone IS NULL THEN
      RAISE EXCEPTION 'client_details_required';
    END IF;
    INSERT INTO public.clients (studio_id, name, phone)
    VALUES (p_studio_id, trim(p_client_name), v_phone)
    ON CONFLICT (studio_id, phone) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
    RETURNING id INTO v_client_id;
  END IF;

  IF jsonb_array_length(v_conflicts) > 0 THEN
    PERFORM set_config('bellza.allow_manual_overlap', 'on', true);
  END IF;
  v_end := p_starts_at + make_interval(mins => v_service.duration_min);
  INSERT INTO public.appointments (
    studio_id, client_id, staff_id, starts_at, ends_at, status,
    total_price, total_duration_min, notes, notification_suppressed,
    is_manual_fit, duration_overridden, updated_at
  ) VALUES (
    p_studio_id, v_client_id, p_staff_id, p_starts_at, v_end, 'confirmed',
    v_service.price, v_service.duration_min, NULLIF(trim(COALESCE(p_notes, '')), ''),
    true, true, false, now()
  ) RETURNING id INTO v_appointment_id;

  INSERT INTO public.appointment_services (
    appointment_id, service_id, is_upsell, price, duration_min
  ) VALUES (v_appointment_id, v_service.id, false, v_service.price, v_service.duration_min);

  INSERT INTO public.appointment_schedule_events (
    studio_id, appointment_id, actor_id, operation, overlap_confirmed,
    previous_state, next_state, conflict_snapshot
  ) VALUES (
    p_studio_id, v_appointment_id, p_actor_id, 'manual_fit',
    jsonb_array_length(v_conflicts) > 0, '{}'::jsonb,
    jsonb_build_object('startsAt', p_starts_at, 'endsAt', v_end, 'durationMin', v_service.duration_min),
    v_conflicts
  );

  RETURN jsonb_build_object(
    'appointmentId', v_appointment_id, 'clientId', v_client_id,
    'startsAt', p_starts_at, 'endsAt', v_end,
    'overlapConfirmed', jsonb_array_length(v_conflicts) > 0, 'conflicts', v_conflicts
  );
END
$$;


ALTER FUNCTION "public"."create_studio_manual_fit"("p_studio_id" "uuid", "p_staff_id" "uuid", "p_service_id" "uuid", "p_starts_at" timestamp with time zone, "p_client_id" "uuid", "p_client_name" "text", "p_client_phone" "text", "p_notes" "text", "p_confirm_overlap" boolean, "p_actor_id" "uuid", "p_expected_conflict_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_studio_with_owner"("p_name" "text", "p_slug" "text", "p_timezone" "text" DEFAULT 'Europe/Lisbon'::"text", "p_currency" "text" DEFAULT 'EUR'::"text", "p_business_segment" "text" DEFAULT 'beauty'::"text", "p_trial_phone" "text" DEFAULT NULL::"text", "p_trial_device_fingerprint_hash" "text" DEFAULT NULL::"text", "p_trial_ip_hash" "text" DEFAULT NULL::"text", "p_trial_nif" "text" DEFAULT NULL::"text", "p_trial_stripe_account_id" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_studio_id uuid;
  v_user uuid := auth.uid();
  v_phone text := public.normalize_trial_phone(p_trial_phone);
  v_slug text := public.normalize_trial_text(p_slug);
  v_name text := public.normalize_trial_text(p_name);
  v_nif text := public.normalize_trial_phone(p_trial_nif);
  v_device_hash text := nullif(trim(coalesce(p_trial_device_fingerprint_hash, '')), '');
  v_ip_hash text := nullif(trim(coalesce(p_trial_ip_hash, '')), '');
  v_stripe_account text := nullif(trim(coalesce(p_trial_stripe_account_id, '')), '');
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_business_segment NOT IN ('beauty', 'barbershop', 'nail_studio', 'clinic', 'other') THEN
    RAISE EXCEPTION 'invalid_business_segment';
  END IF;

  INSERT INTO public.studios (
    name,
    slug,
    timezone,
    currency,
    business_segment,
    phone,
    subscription_status,
    trial_ends_at,
    trial_claimed_at,
    trial_identity_phone,
    trial_identity_studio_name,
    trial_identity_slug,
    trial_identity_ip_hash,
    trial_identity_device_fingerprint_hash,
    trial_identity_nif,
    trial_identity_stripe_account_id
  )
  VALUES (
    p_name,
    p_slug,
    p_timezone,
    p_currency,
    p_business_segment,
    v_phone,
    'trialing',
    now() + interval '14 days',
    now(),
    v_phone,
    v_name,
    v_slug,
    v_ip_hash,
    v_device_hash,
    v_nif,
    v_stripe_account
  )
  RETURNING id INTO v_studio_id;

  INSERT INTO public.user_roles (user_id, studio_id, role)
  VALUES (v_user, v_studio_id, 'studio_owner');

  RETURN v_studio_id;
END
$$;


ALTER FUNCTION "public"."create_studio_with_owner"("p_name" "text", "p_slug" "text", "p_timezone" "text", "p_currency" "text", "p_business_segment" "text", "p_trial_phone" "text", "p_trial_device_fingerprint_hash" "text", "p_trial_ip_hash" "text", "p_trial_nif" "text", "p_trial_stripe_account_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_studio_with_owner"("p_owner_user_id" "uuid", "p_name" "text", "p_slug" "text", "p_timezone" "text" DEFAULT 'Europe/Lisbon'::"text", "p_currency" "text" DEFAULT 'EUR'::"text", "p_business_segment" "text" DEFAULT 'beauty'::"text", "p_trial_phone" "text" DEFAULT NULL::"text", "p_trial_device_fingerprint_hash" "text" DEFAULT NULL::"text", "p_trial_ip_hash" "text" DEFAULT NULL::"text", "p_trial_nif" "text" DEFAULT NULL::"text", "p_trial_stripe_account_id" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_studio_id uuid;
  v_phone text := public.normalize_trial_phone(p_trial_phone);
  v_slug text := public.normalize_trial_text(p_slug);
  v_name text := public.normalize_trial_text(p_name);
  v_nif text := public.normalize_trial_phone(p_trial_nif);
  v_device_hash text := nullif(trim(coalesce(p_trial_device_fingerprint_hash, '')), '');
  v_ip_hash text := nullif(trim(coalesce(p_trial_ip_hash, '')), '');
  v_stripe_account text := nullif(trim(coalesce(p_trial_stripe_account_id, '')), '');
BEGIN
  IF p_owner_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.users u WHERE u.id = p_owner_user_id
  ) THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_business_segment NOT IN ('beauty', 'barbershop', 'nail_studio', 'clinic', 'other') THEN
    RAISE EXCEPTION 'invalid_business_segment';
  END IF;

  INSERT INTO public.studios (
    name, slug, timezone, currency, business_segment, phone,
    subscription_status, trial_ends_at, trial_claimed_at,
    trial_identity_phone, trial_identity_studio_name, trial_identity_slug,
    trial_identity_ip_hash, trial_identity_device_fingerprint_hash,
    trial_identity_nif, trial_identity_stripe_account_id
  ) VALUES (
    p_name, p_slug, p_timezone, p_currency, p_business_segment, v_phone,
    'trialing', now() + interval '14 days', now(),
    v_phone, v_name, v_slug, v_ip_hash, v_device_hash, v_nif, v_stripe_account
  )
  RETURNING id INTO v_studio_id;

  INSERT INTO public.user_roles (user_id, studio_id, role)
  VALUES (p_owner_user_id, v_studio_id, 'studio_owner');

  RETURN v_studio_id;
END
$$;


ALTER FUNCTION "public"."create_studio_with_owner"("p_owner_user_id" "uuid", "p_name" "text", "p_slug" "text", "p_timezone" "text", "p_currency" "text", "p_business_segment" "text", "p_trial_phone" "text", "p_trial_device_fingerprint_hash" "text", "p_trial_ip_hash" "text", "p_trial_nif" "text", "p_trial_stripe_account_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_walk_in_appointment"("p_studio_id" "uuid", "p_staff_id" "uuid", "p_service_id" "uuid", "p_starts_at" timestamp with time zone, "p_client_id" "uuid" DEFAULT NULL::"uuid", "p_client_name" "text" DEFAULT NULL::"text", "p_client_phone" "text" DEFAULT NULL::"text", "p_payment_method" "text" DEFAULT 'cash'::"text", "p_amount" numeric DEFAULT NULL::numeric, "p_notes" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_studio public.studios%ROWTYPE;
  v_service public.services%ROWTYPE;
  v_client_id UUID;
  v_client_name TEXT;
  v_client_phone TEXT;
  v_ends_at TIMESTAMPTZ;
  v_local_start TIMESTAMP;
  v_local_end TIMESTAMP;
  v_duration_min INTEGER;
  v_appointment_id UUID;
  v_session_id UUID;
  v_payment_amount NUMERIC(10,2);
BEGIN
  IF NOT public.is_studio_member(auth.uid(), p_studio_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT * INTO v_studio
  FROM public.studios
  WHERE id = p_studio_id
    AND is_active = true;
  IF v_studio.id IS NULL THEN RAISE EXCEPTION 'studio_not_found'; END IF;

  SELECT * INTO v_service
  FROM public.services
  WHERE id = p_service_id
    AND studio_id = p_studio_id
    AND is_active = true;
  IF v_service.id IS NULL THEN RAISE EXCEPTION 'service_not_found'; END IF;

  v_duration_min := COALESCE(v_service.duration_min, 30);
  v_ends_at := p_starts_at + (v_duration_min || ' minutes')::interval;
  v_local_start := p_starts_at AT TIME ZONE COALESCE(v_studio.timezone, 'Europe/Lisbon');
  v_local_end := v_ends_at AT TIME ZONE COALESCE(v_studio.timezone, 'Europe/Lisbon');

  IF NOT EXISTS (
    SELECT 1 FROM public.staff
    WHERE id = p_staff_id
      AND studio_id = p_studio_id
      AND is_active = true
      AND COALESCE(current_status, 'online') <> 'absent'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM public.staff
      WHERE id = p_staff_id
        AND studio_id = p_studio_id
        AND is_active = true
        AND COALESCE(current_status, 'online') = 'absent'
    ) THEN
      RAISE EXCEPTION 'staff_unavailable';
    END IF;
    RAISE EXCEPTION 'staff_not_found';
  END IF;

  IF NOT public.is_staff_slot_bookable(p_studio_id, p_staff_id, p_starts_at, v_duration_min) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.staff_availability sa
      WHERE sa.studio_id = p_studio_id
        AND sa.staff_id = p_staff_id
        AND sa.weekday = EXTRACT(DOW FROM v_local_start)::int
        AND sa.start_time <= v_local_start::time
        AND sa.end_time >= v_local_end::time
    ) THEN
      RAISE EXCEPTION 'outside_staff_availability';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.staff_time_off t
      WHERE t.staff_id = p_staff_id
        AND tstzrange(t.starts_at, t.ends_at, '[)') && tstzrange(p_starts_at, v_ends_at, '[)')
    ) THEN
      RAISE EXCEPTION 'staff_unavailable';
    END IF;

    RAISE EXCEPTION 'slot_unavailable';
  END IF;

  v_payment_amount := COALESCE(p_amount, v_service.price, 0);
  IF v_payment_amount > 0 THEN
    SELECT id INTO v_session_id
    FROM public.cash_register_sessions
    WHERE studio_id = p_studio_id
      AND status = 'open'
    ORDER BY opened_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_session_id IS NULL THEN
      RAISE EXCEPTION 'cash_register_not_open';
    END IF;
  END IF;

  IF p_client_id IS NOT NULL THEN
    SELECT id INTO v_client_id
    FROM public.clients
    WHERE id = p_client_id
      AND studio_id = p_studio_id;
    IF v_client_id IS NULL THEN RAISE EXCEPTION 'client_not_found'; END IF;
  ELSE
    v_client_name := COALESCE(NULLIF(trim(p_client_name), ''), 'Cliente balcao');
    v_client_phone := NULLIF(trim(COALESCE(p_client_phone, '')), '');

    IF v_client_phone IS NULL THEN
      v_client_phone := 'balcao-' || replace(gen_random_uuid()::text, '-', '');
      INSERT INTO public.clients (studio_id, name, phone)
      VALUES (p_studio_id, v_client_name, v_client_phone)
      RETURNING id INTO v_client_id;
    ELSE
      INSERT INTO public.clients (studio_id, name, phone)
      VALUES (p_studio_id, v_client_name, v_client_phone)
      ON CONFLICT (studio_id, phone) DO UPDATE SET
        name = EXCLUDED.name,
        updated_at = now()
      RETURNING id INTO v_client_id;
    END IF;
  END IF;

  INSERT INTO public.appointments (
    studio_id, staff_id, client_id, starts_at, ends_at, status,
    total_price, total_duration_min, notes
  )
  VALUES (
    p_studio_id, p_staff_id, v_client_id, p_starts_at, v_ends_at, 'completed',
    v_payment_amount, v_duration_min,
    NULLIF(trim(COALESCE(p_notes, '')), '')
  )
  RETURNING id INTO v_appointment_id;

  INSERT INTO public.appointment_services (appointment_id, service_id, is_upsell, price, duration_min)
  VALUES (v_appointment_id, v_service.id, false, v_payment_amount, v_duration_min);

  UPDATE public.clients
  SET
    total_visits = total_visits + 1,
    total_spent = total_spent + v_payment_amount,
    updated_at = now()
  WHERE id = v_client_id;

  IF v_payment_amount > 0 THEN
    INSERT INTO public.cash_register_movements (
      session_id, studio_id, appointment_id, movement_type, payment_method,
      amount, description, occurred_at, created_by
    )
    VALUES (
      v_session_id, p_studio_id, v_appointment_id, 'service_payment',
      COALESCE(NULLIF(p_payment_method, ''), 'cash'), v_payment_amount,
      'Encaixe - ' || v_service.name, now(), auth.uid()
    );
  END IF;

  RETURN jsonb_build_object(
    'appointment_id', v_appointment_id,
    'client_id', v_client_id,
    'starts_at', p_starts_at,
    'ends_at', v_ends_at,
    'cash_session_id', v_session_id
  );
EXCEPTION
  WHEN exclusion_violation THEN RAISE EXCEPTION 'slot_unavailable';
END;
$$;


ALTER FUNCTION "public"."create_walk_in_appointment"("p_studio_id" "uuid", "p_staff_id" "uuid", "p_service_id" "uuid", "p_starts_at" timestamp with time zone, "p_client_id" "uuid", "p_client_name" "text", "p_client_phone" "text", "p_payment_method" "text", "p_amount" numeric, "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_whatsapp_entitlement_for_studio"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_settings public.whatsapp_platform_settings%ROWTYPE;
  v_trial_allowed boolean := true;
  v_trial_started_at timestamptz;
  v_trial_ends_at timestamptz;
  v_identity record;
  v_identity_hash text;
BEGIN
  SELECT * INTO v_settings FROM public.whatsapp_platform_settings WHERE id = 1;
  v_trial_started_at := coalesce(NEW.trial_claimed_at, NEW.created_at, now());
  v_trial_ends_at := least(
    coalesce(NEW.trial_ends_at, 'infinity'::timestamptz),
    v_trial_started_at + make_interval(days => coalesce(v_settings.trial_duration_days, 14))
  );

  FOR v_identity IN
    SELECT identity.kind, identity.value
    FROM (VALUES
      ('phone', nullif(NEW.trial_identity_phone, '')),
      ('slug', nullif(NEW.trial_identity_slug, '')),
      ('device', nullif(NEW.trial_identity_device_fingerprint_hash, '')),
      ('ip', nullif(NEW.trial_identity_ip_hash, '')),
      ('nif', nullif(NEW.trial_identity_nif, '')),
      ('stripe', nullif(NEW.trial_identity_stripe_account_id, ''))
    ) AS identity(kind, value)
    WHERE identity.value IS NOT NULL
  LOOP
    v_identity_hash := encode(extensions.digest(v_identity.value::bytea, 'sha256'), 'hex');
    IF EXISTS (
      SELECT 1 FROM public.whatsapp_trial_identity_claims c
      WHERE c.identity_kind = v_identity.kind AND c.identity_hash = v_identity_hash
    ) THEN
      v_trial_allowed := false;
    END IF;
  END LOOP;

  INSERT INTO public.whatsapp_studio_entitlements (
    studio_id, status, trial_started_at, trial_ends_at
  ) VALUES (
    NEW.id,
    CASE
      WHEN coalesce(v_settings.trial_enabled, true) AND v_trial_allowed AND v_trial_ends_at > now() THEN 'trial'
      ELSE 'inactive'
    END,
    v_trial_started_at,
    CASE WHEN coalesce(v_settings.trial_enabled, true) AND v_trial_allowed THEN v_trial_ends_at ELSE NULL END
  )
  ON CONFLICT (studio_id) DO NOTHING;

  IF v_trial_allowed THEN
    FOR v_identity IN
      SELECT identity.kind, identity.value
      FROM (VALUES
        ('phone', nullif(NEW.trial_identity_phone, '')),
        ('slug', nullif(NEW.trial_identity_slug, '')),
        ('device', nullif(NEW.trial_identity_device_fingerprint_hash, '')),
        ('ip', nullif(NEW.trial_identity_ip_hash, '')),
        ('nif', nullif(NEW.trial_identity_nif, '')),
        ('stripe', nullif(NEW.trial_identity_stripe_account_id, ''))
      ) AS identity(kind, value)
      WHERE identity.value IS NOT NULL
    LOOP
      INSERT INTO public.whatsapp_trial_identity_claims (
        studio_id, identity_kind, identity_hash, claimed_at, trial_ends_at
      ) VALUES (
        NEW.id, v_identity.kind,
        encode(extensions.digest(v_identity.value::bytea, 'sha256'), 'hex'),
        v_trial_started_at, v_trial_ends_at
      ) ON CONFLICT (identity_kind, identity_hash) DO NOTHING;
    END LOOP;
  END IF;
  RETURN NEW;
END
$$;


ALTER FUNCTION "public"."create_whatsapp_entitlement_for_studio"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."customer_loyalty_completed_appointment_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.status = 'completed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM public.process_customer_loyalty_for_completed_appointment(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."customer_loyalty_completed_appointment_trigger"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."diagnose_studio_reschedule_slot"("p_appointment_id" "uuid", "p_studio_id" "uuid", "p_local_date" "date", "p_local_time" time without time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_appt record;
  v_duration integer;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_local_start timestamp;
  v_local_end timestamp;
  v_conflict record;
BEGIN
  SELECT
    a.id,
    a.staff_id,
    a.status,
    a.starts_at,
    a.ends_at,
    a.total_duration_min,
    s.is_active AS studio_active,
    COALESCE(s.timezone, 'Europe/Lisbon') AS timezone
  INTO v_appt
  FROM public.appointments AS a
  JOIN public.studios AS s ON s.id = a.studio_id
  WHERE a.id = p_appointment_id
    AND a.studio_id = p_studio_id;

  IF v_appt.id IS NULL THEN
    RETURN jsonb_build_object('reason', 'appointment_not_found');
  END IF;

  SELECT COALESCE(SUM(aps.duration_min), 0)::integer
  INTO v_duration
  FROM public.appointment_services AS aps
  WHERE aps.appointment_id = v_appt.id;

  v_duration := COALESCE(
    NULLIF(v_appt.total_duration_min, 0),
    NULLIF(v_duration, 0),
    GREATEST(
      15,
      CEIL(EXTRACT(EPOCH FROM (v_appt.ends_at - v_appt.starts_at)) / 60)::integer
    )
  );
  v_starts_at := (p_local_date::timestamp + p_local_time) AT TIME ZONE v_appt.timezone;
  v_ends_at := v_starts_at + make_interval(mins => v_duration);
  v_local_start := v_starts_at AT TIME ZONE v_appt.timezone;
  v_local_end := v_ends_at AT TIME ZONE v_appt.timezone;

  IF NOT v_appt.studio_active THEN
    RETURN jsonb_build_object('reason', 'studio_inactive');
  END IF;

  SELECT st.id, st.is_active, st.current_status
  INTO v_conflict
  FROM public.staff AS st
  WHERE st.id = v_appt.staff_id
    AND st.studio_id = p_studio_id;

  IF v_conflict.id IS NULL THEN
    RETURN jsonb_build_object('reason', 'staff_not_found');
  END IF;
  IF NOT v_conflict.is_active THEN
    RETURN jsonb_build_object('reason', 'staff_inactive');
  END IF;
  IF COALESCE(v_conflict.current_status, 'online') = 'absent' THEN
    RETURN jsonb_build_object('reason', 'staff_absent');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.staff_availability AS sa
    WHERE sa.studio_id = p_studio_id
      AND sa.staff_id = v_appt.staff_id
      AND sa.weekday = EXTRACT(DOW FROM v_local_start)::integer
      AND sa.start_time <= v_local_start::time
      AND sa.end_time >= v_local_end::time
  ) THEN
    RETURN jsonb_build_object(
      'reason', 'outside_staff_availability',
      'weekday', EXTRACT(DOW FROM v_local_start)::integer,
      'local_start', to_char(v_local_start, 'YYYY-MM-DD HH24:MI'),
      'local_end', to_char(v_local_end, 'YYYY-MM-DD HH24:MI'),
      'duration_min', v_duration
    );
  END IF;

  SELECT t.id, t.starts_at, t.ends_at
  INTO v_conflict
  FROM public.staff_time_off AS t
  WHERE t.staff_id = v_appt.staff_id
    AND tstzrange(t.starts_at, t.ends_at, '[)') && tstzrange(v_starts_at, v_ends_at, '[)')
  ORDER BY t.starts_at
  LIMIT 1;
  IF v_conflict.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'reason', 'staff_time_off',
      'conflict_id', v_conflict.id,
      'conflict_start', v_conflict.starts_at,
      'conflict_end', v_conflict.ends_at
    );
  END IF;

  SELECT a.id, a.status, a.starts_at, a.ends_at
  INTO v_conflict
  FROM public.appointments AS a
  WHERE a.staff_id = v_appt.staff_id
    AND a.id <> v_appt.id
    AND a.status NOT IN ('cancelled', 'no_show')
    AND tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(v_starts_at, v_ends_at, '[)')
  ORDER BY a.starts_at
  LIMIT 1;
  IF v_conflict.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'reason', 'active_appointment_conflict',
      'conflict_id', v_conflict.id,
      'conflict_status', v_conflict.status,
      'conflict_start', v_conflict.starts_at,
      'conflict_end', v_conflict.ends_at
    );
  END IF;

  SELECT bpr.id, bpr.status, bpr.starts_at, bpr.ends_at
  INTO v_conflict
  FROM public.booking_payment_requests AS bpr
  WHERE bpr.staff_id = v_appt.staff_id
    AND bpr.status IN ('awaiting_payment', 'processing', 'paid')
    AND bpr.expires_at > now()
    AND tstzrange(bpr.starts_at, bpr.ends_at, '[)') && tstzrange(v_starts_at, v_ends_at, '[)')
  ORDER BY bpr.starts_at
  LIMIT 1;
  IF v_conflict.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'reason', 'active_payment_request_conflict',
      'conflict_id', v_conflict.id,
      'conflict_status', v_conflict.status,
      'conflict_start', v_conflict.starts_at,
      'conflict_end', v_conflict.ends_at
    );
  END IF;

  RETURN jsonb_build_object(
    'reason', 'bookable_or_constraint_race',
    'local_start', to_char(v_local_start, 'YYYY-MM-DD HH24:MI'),
    'local_end', to_char(v_local_end, 'YYYY-MM-DD HH24:MI'),
    'duration_min', v_duration
  );
END
$$;


ALTER FUNCTION "public"."diagnose_studio_reschedule_slot"("p_appointment_id" "uuid", "p_studio_id" "uuid", "p_local_date" "date", "p_local_time" time without time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_appointment_schedule_overlap"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_active boolean;
  v_old_active boolean;
  v_override boolean;
BEGIN
  v_active := NEW.status::text NOT IN ('cancelled', 'canceled', 'no_show');
  v_old_active := CASE
    WHEN TG_OP = 'UPDATE' THEN OLD.status::text NOT IN ('cancelled', 'canceled', 'no_show')
    ELSE false
  END;

  IF NOT v_active THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.staff_id IS NOT DISTINCT FROM OLD.staff_id
     AND NEW.starts_at IS NOT DISTINCT FROM OLD.starts_at
     AND NEW.ends_at IS NOT DISTINCT FROM OLD.ends_at
     AND v_active = v_old_active THEN
    RETURN NEW;
  END IF;

  IF NEW.ends_at <= NEW.starts_at THEN
    RAISE EXCEPTION 'invalid_appointment_interval';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.staff_id::text, 918273));
  v_override := COALESCE(current_setting('bellza.allow_manual_overlap', true), '') = 'on';

  IF NOT v_override AND EXISTS (
    SELECT 1
    FROM public.appointments AS other
    WHERE other.staff_id = NEW.staff_id
      AND other.id <> NEW.id
      AND other.status::text NOT IN ('cancelled', 'canceled', 'no_show')
      AND tstzrange(other.starts_at, other.ends_at, '[)') &&
          tstzrange(NEW.starts_at, NEW.ends_at, '[)')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23P01',
      MESSAGE = 'slot_unavailable',
      DETAIL = 'appointment_overlap';
  END IF;

  RETURN NEW;
END
$$;


ALTER FUNCTION "public"."enforce_appointment_schedule_overlap"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_client_plan_protected_columns"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_changed boolean;
BEGIN
  IF auth.role() <> 'authenticated' OR public.is_saas_owner() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    v_changed := coalesce(NEW.booking_status, 'active') <> 'active'
      OR NEW.suspended_until IS NOT NULL
      OR NEW.block_reason IS NOT NULL
      OR NEW.date_of_birth IS NOT NULL;
  ELSE
    v_changed := NEW.booking_status IS DISTINCT FROM OLD.booking_status
      OR NEW.suspended_until IS DISTINCT FROM OLD.suspended_until
      OR NEW.block_reason IS DISTINCT FROM OLD.block_reason
      OR NEW.date_of_birth IS DISTINCT FROM OLD.date_of_birth;
  END IF;
  IF v_changed AND NOT public.studio_has_entitlement(NEW.studio_id, 'clients_full') THEN
    RAISE EXCEPTION 'plan_feature_required:clients_full' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;


ALTER FUNCTION "public"."enforce_client_plan_protected_columns"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_notification_log_appointment_tenant"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_studio_id uuid;
  v_starts_at timestamptz;
BEGIN
  IF NEW.appointment_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT a.studio_id, a.starts_at
    INTO v_studio_id, v_starts_at
  FROM public.appointments a
  WHERE a.id = NEW.appointment_id;

  IF v_studio_id IS NULL THEN
    RAISE EXCEPTION 'notification_log_appointment_missing';
  END IF;
  IF NEW.studio_id IS DISTINCT FROM v_studio_id THEN
    RAISE EXCEPTION 'notification_log_appointment_studio_mismatch';
  END IF;

  NEW.payload := jsonb_set(
    jsonb_set(
      COALESCE(NEW.payload, '{}'::jsonb),
      '{appointment_id}',
      to_jsonb(NEW.appointment_id::text),
      true
    ),
    '{studio_id}',
    to_jsonb(NEW.studio_id::text),
    true
  );
  IF NEW.kind = 'appointment_reminder' THEN
    NEW.payload := jsonb_set(NEW.payload, '{starts_at}', to_jsonb(v_starts_at), true);
  END IF;
  RETURN NEW;
END
$$;


ALTER FUNCTION "public"."enforce_notification_log_appointment_tenant"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_notification_plan_on_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT public.studio_has_entitlement(NEW.studio_id, 'notifications') THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END
$$;


ALTER FUNCTION "public"."enforce_notification_plan_on_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_plan_professional_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_limit integer;
  v_active_count integer;
BEGIN
  IF NEW.is_active IS DISTINCT FROM true THEN
    RETURN NEW;
  END IF;

  v_limit := public.studio_plan_professional_limit(NEW.studio_id);
  IF v_limit IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*)::integer INTO v_active_count
  FROM public.staff s
  WHERE s.studio_id = NEW.studio_id
    AND s.is_active = true
    AND s.id IS DISTINCT FROM NEW.id;

  IF v_active_count >= v_limit THEN
    RAISE EXCEPTION 'plan_professional_limit_reached:%', v_limit USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;


ALTER FUNCTION "public"."enforce_plan_professional_limit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_service_plan_protected_columns"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_changed boolean;
BEGIN
  IF auth.role() <> 'authenticated' OR public.is_saas_owner() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    v_changed := NEW.commission_percent IS NOT NULL
      OR NEW.deposit_recipient IS NOT NULL
      OR NEW.deposit_professional_percent IS NOT NULL;
  ELSE
    v_changed := NEW.commission_percent IS DISTINCT FROM OLD.commission_percent
      OR NEW.deposit_recipient IS DISTINCT FROM OLD.deposit_recipient
      OR NEW.deposit_professional_percent IS DISTINCT FROM OLD.deposit_professional_percent;
  END IF;
  IF v_changed AND NOT public.studio_has_entitlement(NEW.studio_id, 'finance_basic') THEN
    RAISE EXCEPTION 'plan_feature_required:finance_basic' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;


ALTER FUNCTION "public"."enforce_service_plan_protected_columns"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_staff_plan_protected_columns"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_finance_changed boolean;
  v_team_changed boolean;
BEGIN
  IF auth.role() <> 'authenticated' OR public.is_saas_owner() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_finance_changed := NEW.commission_percent IS NOT NULL
      OR NEW.deposit_recipient IS NOT NULL
      OR NEW.deposit_professional_percent IS NOT NULL;
    v_team_changed := NEW.user_id IS NOT NULL
      OR NEW.invite_token IS NOT NULL
      OR NEW.invite_role IS NOT NULL
      OR NEW.invite_code IS NOT NULL;
  ELSE
    v_finance_changed := NEW.commission_percent IS DISTINCT FROM OLD.commission_percent
      OR NEW.deposit_recipient IS DISTINCT FROM OLD.deposit_recipient
      OR NEW.deposit_professional_percent IS DISTINCT FROM OLD.deposit_professional_percent;
    v_team_changed := NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.invite_token IS DISTINCT FROM OLD.invite_token
      OR NEW.invite_role IS DISTINCT FROM OLD.invite_role
      OR NEW.invite_status IS DISTINCT FROM OLD.invite_status
      OR NEW.invite_expires_at IS DISTINCT FROM OLD.invite_expires_at
      OR NEW.invite_code IS DISTINCT FROM OLD.invite_code;
  END IF;

  IF v_finance_changed AND NOT public.studio_has_entitlement(NEW.studio_id, 'finance_basic') THEN
    RAISE EXCEPTION 'plan_feature_required:finance_basic' USING ERRCODE = '42501';
  END IF;
  IF v_team_changed AND NOT public.studio_has_entitlement(NEW.studio_id, 'team_management') THEN
    RAISE EXCEPTION 'plan_feature_required:team_management' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;


ALTER FUNCTION "public"."enforce_staff_plan_protected_columns"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_studio_notification_delivery_tenant"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id uuid;
  v_last_seen_at timestamptz;
  v_updated_at timestamptz;
  v_kind text;
  v_appointment_id uuid;
  v_queued_starts_at timestamptz;
  v_current_starts_at timestamptz;
  v_appointment_status text;
BEGIN
  SELECT
    ps.user_id,
    ps.last_seen_at,
    ps.updated_at,
    n.kind,
    n.appointment_id,
    CASE
      WHEN NULLIF(n.payload ->> 'starts_at', '') IS NULL THEN NULL
      ELSE (n.payload ->> 'starts_at')::timestamptz
    END
  INTO
    v_user_id,
    v_last_seen_at,
    v_updated_at,
    v_kind,
    v_appointment_id,
    v_queued_starts_at
  FROM public.studio_notifications n
  JOIN public.push_subscriptions ps
    ON ps.id = NEW.subscription_id
   AND ps.studio_id = NEW.studio_id
   AND ps.audience IN ('studio', 'both')
   AND ps.revoked_at IS NULL
  JOIN public.user_roles ur
    ON ur.user_id = ps.user_id
   AND ur.studio_id = NEW.studio_id
  WHERE n.id = NEW.notification_id
    AND n.studio_id = NEW.studio_id;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'notification_delivery_studio_mismatch';
  END IF;

  IF TG_OP = 'INSERT' AND v_kind = 'appointment_reminder' THEN
    SELECT a.starts_at, a.status::text
      INTO v_current_starts_at, v_appointment_status
    FROM public.appointments a
    WHERE a.id = v_appointment_id
      AND a.studio_id = NEW.studio_id;

    IF v_current_starts_at IS NULL
       OR v_appointment_status <> 'confirmed'
       OR v_current_starts_at <= now()
       OR v_queued_starts_at IS DISTINCT FROM v_current_starts_at THEN
      RETURN NULL;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_last_seen_at IS NULL OR v_last_seen_at < now() - interval '30 days' THEN
      RETURN NULL;
    END IF;
    IF (
      SELECT count(*)
      FROM public.push_subscriptions newer
      WHERE newer.user_id = v_user_id
        AND newer.studio_id = NEW.studio_id
        AND newer.audience IN ('studio', 'both')
        AND newer.revoked_at IS NULL
        AND newer.last_seen_at >= now() - interval '30 days'
        AND (
          newer.last_seen_at > v_last_seen_at
          OR (newer.last_seen_at = v_last_seen_at AND newer.updated_at > v_updated_at)
        )
    ) >= 3 THEN
      RETURN NULL;
    END IF;
  END IF;

  RETURN NEW;
END
$$;


ALTER FUNCTION "public"."enforce_studio_notification_delivery_tenant"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_studio_notification_tenant_time"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_payload_appointment_id uuid;
  v_appointment_studio_id uuid;
  v_starts_at timestamptz;
BEGIN
  IF NEW.studio_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.studios s WHERE s.id = NEW.studio_id
  ) THEN
    RAISE EXCEPTION 'notification_studio_missing';
  END IF;

  NEW.payload := COALESCE(NEW.payload, '{}'::jsonb);
  IF NULLIF(NEW.payload ->> 'studio_id', '') IS NOT NULL
     AND (NEW.payload ->> 'studio_id') <> NEW.studio_id::text THEN
    RAISE EXCEPTION 'notification_payload_studio_mismatch';
  END IF;
  NEW.payload := jsonb_set(NEW.payload, '{studio_id}', to_jsonb(NEW.studio_id::text), true);

  IF NULLIF(NEW.payload ->> 'appointment_id', '') IS NOT NULL THEN
    BEGIN
      v_payload_appointment_id := (NEW.payload ->> 'appointment_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'invalid_notification_appointment_id';
    END;
    IF NEW.appointment_id IS NOT NULL AND NEW.appointment_id <> v_payload_appointment_id THEN
      RAISE EXCEPTION 'notification_appointment_mismatch';
    END IF;
    NEW.appointment_id := v_payload_appointment_id;
  END IF;

  IF NEW.appointment_id IS NOT NULL THEN
    SELECT a.studio_id, a.starts_at
      INTO v_appointment_studio_id, v_starts_at
    FROM public.appointments a
    WHERE a.id = NEW.appointment_id;

    IF v_appointment_studio_id IS NULL THEN
      RAISE EXCEPTION 'notification_appointment_missing';
    END IF;
    IF v_appointment_studio_id <> NEW.studio_id THEN
      RAISE EXCEPTION 'notification_studio_mismatch';
    END IF;

    NEW.payload := jsonb_set(NEW.payload, '{appointment_id}', to_jsonb(NEW.appointment_id::text), true);
    NEW.payload := jsonb_set(NEW.payload, '{starts_at}', to_jsonb(v_starts_at), true);
  END IF;
  RETURN NEW;
END
$$;


ALTER FUNCTION "public"."enforce_studio_notification_tenant_time"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_studio_plan_protected_columns"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR public.is_saas_owner() THEN
    RETURN NEW;
  END IF;

  IF NEW.plan_tier IS DISTINCT FROM OLD.plan_tier
    OR NEW.plan IS DISTINCT FROM OLD.plan
    OR NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id
    OR NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id
    OR NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
    OR NEW.subscription_current_period_end IS DISTINCT FROM OLD.subscription_current_period_end
    OR NEW.subscription_cancel_at_period_end IS DISTINCT FROM OLD.subscription_cancel_at_period_end
    OR NEW.premium_access_until IS DISTINCT FROM OLD.premium_access_until
    OR NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at
    OR NEW.trial_used_at IS DISTINCT FROM OLD.trial_used_at THEN
    RAISE EXCEPTION 'billing_fields_are_server_managed' USING ERRCODE = '42501';
  END IF;

  IF (
    NEW.payment_policy IS DISTINCT FROM OLD.payment_policy
    OR NEW.accepted_payment_methods IS DISTINCT FROM OLD.accepted_payment_methods
    OR NEW.deposit_percent IS DISTINCT FROM OLD.deposit_percent
    OR NEW.deposit_recipient IS DISTINCT FROM OLD.deposit_recipient
    OR NEW.deposit_professional_percent IS DISTINCT FROM OLD.deposit_professional_percent
  ) AND NOT public.studio_has_entitlement(NEW.id, 'online_payments') THEN
    RAISE EXCEPTION 'plan_feature_required:online_payments' USING ERRCODE = '42501';
  END IF;

  IF NEW.commission_percent IS DISTINCT FROM OLD.commission_percent
    AND NOT public.studio_has_entitlement(NEW.id, 'finance_basic') THEN
    RAISE EXCEPTION 'plan_feature_required:finance_basic' USING ERRCODE = '42501';
  END IF;

  IF (
    NEW.whatsapp_auto_send_enabled IS DISTINCT FROM OLD.whatsapp_auto_send_enabled
    OR NEW.whatsapp_default_message IS DISTINCT FROM OLD.whatsapp_default_message
    OR (NEW.booking_flow_mode IS DISTINCT FROM OLD.booking_flow_mode AND NEW.booking_flow_mode = 'request')
  ) AND NOT public.studio_has_entitlement(NEW.id, 'whatsapp') THEN
    RAISE EXCEPTION 'plan_feature_required:whatsapp' USING ERRCODE = '42501';
  END IF;

  IF NEW.staff_agenda_visibility IS DISTINCT FROM OLD.staff_agenda_visibility
    AND NOT public.studio_has_entitlement(NEW.id, 'team_management') THEN
    RAISE EXCEPTION 'plan_feature_required:team_management' USING ERRCODE = '42501';
  END IF;

  IF NEW.appointment_reminder_minutes IS DISTINCT FROM OLD.appointment_reminder_minutes
    AND NOT public.studio_has_entitlement(NEW.id, 'notifications') THEN
    RAISE EXCEPTION 'plan_feature_required:notifications' USING ERRCODE = '42501';
  END IF;

  IF NEW.attendance_grace_minutes IS DISTINCT FROM OLD.attendance_grace_minutes
    AND NOT public.studio_has_entitlement(NEW.id, 'attendance') THEN
    RAISE EXCEPTION 'plan_feature_required:attendance' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$$;


ALTER FUNCTION "public"."enforce_studio_plan_protected_columns"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enqueue_due_appointment_lifecycle_notifications"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_appointment record;
  v_summary record;
  v_client_count integer := 0;
  v_studio_count integer := 0;
  v_prompt_count integer := 0;
  v_summary_count integer := 0;
  v_notification_id uuid;
  v_key text;
  v_local_time text;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  FOR v_appointment IN
    SELECT
      a.id,
      a.studio_id,
      a.client_id,
      a.starts_at,
      s.name AS studio_name,
      coalesce(nullif(s.timezone, ''), 'Europe/Lisbon') AS timezone,
      s.appointment_reminder_minutes,
      c.name AS client_name,
      c.auth_user_id
    FROM public.appointments a
    JOIN public.studios s ON s.id = a.studio_id
    JOIN public.clients c ON c.id = a.client_id
    WHERE a.status = 'confirmed'
      AND a.lifecycle_activated_at IS NOT NULL
      AND a.starts_at > now()
      AND now() >= a.starts_at - make_interval(mins => s.appointment_reminder_minutes)
  LOOP
    v_key := 'appointment:' || v_appointment.id::text || ':reminder:' ||
      extract(epoch from v_appointment.starts_at)::bigint::text;
    v_local_time := to_char(
      v_appointment.starts_at AT TIME ZONE v_appointment.timezone,
      'HH24:MI'
    );

    v_notification_id := public.insert_studio_notification(
      v_appointment.studio_id,
      'appointment_reminder',
      'Próximo atendimento',
      coalesce(v_appointment.client_name, 'Cliente') || ' está marcado para ' || v_local_time || '.',
      jsonb_build_object(
        'appointment_id', v_appointment.id,
        'client_id', v_appointment.client_id,
        'starts_at', v_appointment.starts_at,
        'event_key', v_key || ':studio',
        'action_url', '/admin/agenda'
      )
    );
    IF v_notification_id IS NOT NULL THEN
      v_studio_count := v_studio_count + 1;
    END IF;

    IF v_appointment.auth_user_id IS NOT NULL THEN
      INSERT INTO public.notifications_log (
        studio_id, appointment_id, channel, kind, recipient, status, payload
      ) VALUES (
        v_appointment.studio_id,
        v_appointment.id,
        'client_center',
        'appointment_reminder',
        'user:' || v_appointment.auth_user_id::text,
        'unread',
        jsonb_build_object(
          'key', v_key || ':client',
          'title', 'Lembrete de marcação',
          'body', 'Tem uma marcação hoje às ' || v_local_time || ' em ' || v_appointment.studio_name || '.',
          'recipient_user_id', v_appointment.auth_user_id,
          'appointment_id', v_appointment.id,
          'event', 'appointment_reminder'
        )
      ) ON CONFLICT DO NOTHING;
      IF FOUND THEN v_client_count := v_client_count + 1; END IF;
    END IF;

    UPDATE public.appointments
    SET reminder_sent_at = coalesce(reminder_sent_at, now())
    WHERE id = v_appointment.id;
  END LOOP;

  FOR v_appointment IN
    SELECT
      a.id,
      a.studio_id,
      a.client_id,
      a.starts_at,
      s.attendance_grace_minutes,
      coalesce(nullif(s.timezone, ''), 'Europe/Lisbon') AS timezone,
      c.name AS client_name
    FROM public.appointments a
    JOIN public.studios s ON s.id = a.studio_id
    JOIN public.clients c ON c.id = a.client_id
    WHERE a.status = 'confirmed'
      AND a.lifecycle_activated_at IS NOT NULL
      AND a.lifecycle_activated_at <= a.starts_at + make_interval(mins => s.attendance_grace_minutes)
      AND now() >= a.starts_at + make_interval(mins => s.attendance_grace_minutes)
      AND a.attendance_confirmation_requested_at IS NULL
    FOR UPDATE OF a SKIP LOCKED
  LOOP
    v_key := 'appointment:' || v_appointment.id::text || ':attendance_confirmation:' ||
      extract(epoch from v_appointment.starts_at)::bigint::text;
    v_local_time := to_char(v_appointment.starts_at AT TIME ZONE v_appointment.timezone, 'HH24:MI');
    PERFORM public.insert_studio_notification(
      v_appointment.studio_id,
      'attendance_confirmation',
      'O atendimento aconteceu?',
      coalesce(v_appointment.client_name, 'Cliente') || ' estava marcado para ' || v_local_time || '. Confirme na Agenda.',
      jsonb_build_object(
        'appointment_id', v_appointment.id,
        'client_id', v_appointment.client_id,
        'starts_at', v_appointment.starts_at,
        'event_key', v_key,
        'action_url', '/admin/agenda?pendencias=1'
      )
    );
    UPDATE public.appointments
    SET attendance_confirmation_requested_at = now()
    WHERE id = v_appointment.id AND status = 'confirmed';
    IF FOUND THEN v_prompt_count := v_prompt_count + 1; END IF;
  END LOOP;

  -- A single summary after the configured final availability slot of the local day.
  FOR v_summary IN
    WITH local_studios AS (
      SELECT
        s.id AS studio_id,
        coalesce(nullif(s.timezone, ''), 'Europe/Lisbon') AS timezone,
        (now() AT TIME ZONE coalesce(nullif(s.timezone, ''), 'Europe/Lisbon'))::date AS local_date,
        (now() AT TIME ZONE coalesce(nullif(s.timezone, ''), 'Europe/Lisbon'))::time AS local_time
      FROM public.studios s
    ), closing AS (
      SELECT
        local_studios.studio_id,
        local_studios.timezone,
        local_studios.local_date,
        local_studios.local_time,
        max(availability.end_time) AS closes_at
      FROM local_studios
      JOIN public.staff_availability availability
        ON availability.studio_id = local_studios.studio_id
       AND availability.weekday = extract(dow from local_studios.local_date)::integer
      JOIN public.staff closing_staff
        ON closing_staff.id = availability.staff_id
       AND closing_staff.studio_id = local_studios.studio_id
       AND closing_staff.is_active = true
      GROUP BY local_studios.studio_id, local_studios.timezone,
               local_studios.local_date, local_studios.local_time
    )
    SELECT
      closing.studio_id,
      closing.local_date,
      count(appointment.id)::integer AS pending_count,
      array_agg(appointment.id ORDER BY appointment.starts_at) AS appointment_ids
    FROM closing
    JOIN public.appointments appointment
      ON appointment.studio_id = closing.studio_id
     AND (appointment.starts_at AT TIME ZONE closing.timezone)::date = closing.local_date
     AND appointment.status = 'confirmed'
     AND appointment.attendance_confirmation_requested_at IS NOT NULL
    WHERE closing.local_time >= closing.closes_at
    GROUP BY closing.studio_id, closing.local_date
  LOOP
    v_key := 'attendance_summary:' || v_summary.studio_id::text || ':' || v_summary.local_date::text;
    PERFORM public.insert_studio_notification(
      v_summary.studio_id,
      'attendance_summary',
      v_summary.pending_count::text || CASE WHEN v_summary.pending_count = 1
        THEN ' atendimento precisa de confirmação'
        ELSE ' atendimentos precisam de confirmação' END,
      'Resolva as pendências rapidamente na Agenda.',
      jsonb_build_object(
        'appointment_ids', to_jsonb(v_summary.appointment_ids),
        'pending_count', v_summary.pending_count,
        'local_date', v_summary.local_date,
        'event_key', v_key,
        'action_url', '/admin/agenda?pendencias=1'
      )
    );
    v_summary_count := v_summary_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'client_reminders_created', v_client_count,
    'studio_reminders_processed', v_studio_count,
    'attendance_prompts_created', v_prompt_count,
    'daily_summaries_processed', v_summary_count
  );
END
$$;


ALTER FUNCTION "public"."enqueue_due_appointment_lifecycle_notifications"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enqueue_studio_notification_deliveries"("p_studio_id" "uuid" DEFAULT NULL::"uuid", "p_notification_id" "uuid" DEFAULT NULL::"uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden';
  end if;

  insert into public.studio_notification_deliveries (
    notification_id,
    studio_id,
    subscription_id,
    endpoint_fingerprint
  )
  select
    n.id,
    n.studio_id,
    ps.id,
    md5(ps.endpoint)
  from public.studio_notifications n
  join public.push_subscriptions ps
    on ps.studio_id = n.studio_id
   and ps.audience in ('studio', 'both')
   and ps.revoked_at is null
   and (ps.expiration_time is null or ps.expiration_time > floor(extract(epoch from now()) * 1000))
  where n.created_at >= now() - interval '30 days'
    and n.read_at is null
    and (p_studio_id is null or n.studio_id = p_studio_id)
    and (p_notification_id is null or n.id = p_notification_id)
    and exists (
      select 1
      from public.user_roles ur
      where ur.user_id = ps.user_id
        and ur.studio_id = n.studio_id
    )
  on conflict (notification_id, subscription_id) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end
$$;


ALTER FUNCTION "public"."enqueue_studio_notification_deliveries"("p_studio_id" "uuid", "p_notification_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_appointment_public_token"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.public_token IS NULL OR length(trim(NEW.public_token)) < 16 THEN
    NEW.public_token := replace(gen_random_uuid()::text, '-', '') || left(replace(gen_random_uuid()::text, '-', ''), 8);
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."ensure_appointment_public_token"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customer_loyalty_settings" (
    "studio_id" "uuid" NOT NULL,
    "enabled" boolean DEFAULT false NOT NULL,
    "booking_stamps_enabled" boolean DEFAULT true NOT NULL,
    "stamps_per_completed_booking" integer DEFAULT 1 NOT NULL,
    "referral_stamps_enabled" boolean DEFAULT true NOT NULL,
    "stamps_per_completed_referral" integer DEFAULT 1 NOT NULL,
    "stamps_required_for_reward" integer DEFAULT 10 NOT NULL,
    "reward_type" "text" DEFAULT 'percent'::"text" NOT NULL,
    "reward_value" numeric(10,2) DEFAULT 10 NOT NULL,
    "levels" "jsonb" DEFAULT '[{"name": "Cliente", "threshold": 0}, {"name": "Cliente fiel", "threshold": 10}, {"name": "Embaixadora", "threshold": 25}]'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "customer_loyalty_settings_reward_type_check" CHECK (("reward_type" = ANY (ARRAY['percent'::"text", 'fixed'::"text"]))),
    CONSTRAINT "customer_loyalty_settings_reward_value_check" CHECK (("reward_value" >= (0)::numeric)),
    CONSTRAINT "customer_loyalty_settings_stamps_per_completed_booking_check" CHECK ((("stamps_per_completed_booking" >= 0) AND ("stamps_per_completed_booking" <= 100))),
    CONSTRAINT "customer_loyalty_settings_stamps_per_completed_referral_check" CHECK ((("stamps_per_completed_referral" >= 0) AND ("stamps_per_completed_referral" <= 100))),
    CONSTRAINT "customer_loyalty_settings_stamps_required_for_reward_check" CHECK ((("stamps_required_for_reward" > 0) AND ("stamps_required_for_reward" <= 1000)))
);


ALTER TABLE "public"."customer_loyalty_settings" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_customer_loyalty_settings"("p_studio_id" "uuid") RETURNS "public"."customer_loyalty_settings"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_settings public.customer_loyalty_settings%ROWTYPE;
BEGIN
  INSERT INTO public.customer_loyalty_settings (studio_id, enabled)
  VALUES (p_studio_id, false)
  ON CONFLICT (studio_id) DO NOTHING;

  SELECT * INTO v_settings
  FROM public.customer_loyalty_settings
  WHERE studio_id = p_studio_id;

  RETURN v_settings;
END;
$$;


ALTER FUNCTION "public"."ensure_customer_loyalty_settings"("p_studio_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."expire_pending_appointments"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_count integer := 0;
  v_request_count integer := 0;
  v_payment_count integer := 0;
BEGIN
  WITH expired AS (
    SELECT a.id
    FROM public.appointments a
    LEFT JOIN public.payment_intents pi ON pi.appointment_id = a.id
      AND pi.status IN ('requires_action','processing','succeeded')
    WHERE a.status = 'pending_payment'
      AND a.created_at < now() - interval '30 minutes'
      AND pi.id IS NULL
  )
  UPDATE public.appointments
  SET status = 'cancelled',
      cancellation_reason = 'payment_timeout',
      updated_at = now()
  WHERE id IN (SELECT id FROM expired)
    AND status = 'pending_payment';

  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.booking_payment_requests
  SET status = 'expired',
      failure_reason = COALESCE(failure_reason, 'checkout_expired'),
      updated_at = now()
  WHERE status IN ('awaiting_payment','processing')
    AND expires_at <= now();

  GET DIAGNOSTICS v_request_count = ROW_COUNT;

  UPDATE public.payment_intents
  SET status = 'expired',
      failure_reason = COALESCE(failure_reason, 'payment_expired'),
      updated_at = now()
  WHERE status IN ('requires_action','processing')
    AND expires_at IS NOT NULL
    AND expires_at <= now();

  GET DIAGNOSTICS v_payment_count = ROW_COUNT;

  RETURN v_count + v_request_count + v_payment_count;
END
$$;


ALTER FUNCTION "public"."expire_pending_appointments"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fanout_studio_notification_delivery"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_count integer := 0;
begin
  insert into public.studio_notification_deliveries (
    notification_id,
    studio_id,
    subscription_id,
    endpoint_fingerprint,
    status,
    next_attempt_at
  )
  select
    new.id,
    new.studio_id,
    ps.id,
    md5(ps.endpoint),
    'pending',
    now()
  from public.push_subscriptions ps
  where ps.studio_id = new.studio_id
    and ps.audience in ('studio', 'both')
    and ps.revoked_at is null
    and (ps.expiration_time is null or ps.expiration_time > floor(extract(epoch from now()) * 1000))
    and exists (
      select 1
      from public.user_roles ur
      where ur.user_id = ps.user_id
        and ur.studio_id = new.studio_id
    )
  on conflict (notification_id, subscription_id) do nothing;

  get diagnostics v_count = row_count;

  if v_count = 0 then
    insert into public.notifications_log (
      studio_id,
      appointment_id,
      channel,
      kind,
      recipient,
      payload,
      status,
      error
    )
    values (
      new.studio_id,
      nullif(new.payload->>'appointment_id', '')::uuid,
      'push_studio',
      new.kind,
      'studio:' || new.studio_id::text,
      jsonb_build_object(
        'event', 'studio_notification_not_enqueued',
        'studio_notification_id', new.id
      ),
      'skipped',
      'no_active_studio_push_subscription'
    );
  end if;

  return new;
end
$$;


ALTER FUNCTION "public"."fanout_studio_notification_delivery"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_stale_studio_notification_deliveries"("p_studio_id" "uuid" DEFAULT NULL::"uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_count integer := 0;
  v_updated integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden';
  end if;

  update public.studio_notification_deliveries d
  set status = 'skipped',
      lease_until = null,
      last_error = 'subscription_inactive_or_membership_removed',
      updated_at = now()
  where d.status in ('pending', 'retry', 'delivering')
    and (p_studio_id is null or d.studio_id = p_studio_id)
    and not exists (
      select 1
      from public.push_subscriptions ps
      where ps.id = d.subscription_id
        and ps.studio_id = d.studio_id
        and ps.audience in ('studio', 'both')
        and ps.revoked_at is null
        and (ps.expiration_time is null or ps.expiration_time > floor(extract(epoch from now()) * 1000))
        and exists (
          select 1
          from public.user_roles ur
          where ur.user_id = ps.user_id
            and ur.studio_id = d.studio_id
        )
    );
  get diagnostics v_updated = row_count;
  v_count := v_count + v_updated;

  update public.studio_notification_deliveries
  set status = 'failed',
      lease_until = null,
      last_error = coalesce(last_error, 'delivery_lease_expired_after_max_attempts'),
      updated_at = now()
  where status = 'delivering'
    and lease_until < now()
    and attempt_count >= 12
    and (p_studio_id is null or studio_id = p_studio_id);
  get diagnostics v_updated = row_count;

  return v_count + v_updated;
end
$$;


ALTER FUNCTION "public"."finalize_stale_studio_notification_deliveries"("p_studio_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_whatsapp_usage"("p_idempotency_key" "text", "p_outcome" "text", "p_message_log_id" "uuid" DEFAULT NULL::"uuid", "p_provider_message_id" "text" DEFAULT NULL::"text", "p_provider_status" "text" DEFAULT NULL::"text", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_row public.whatsapp_usage_ledger%ROWTYPE;
  v_settings public.whatsapp_platform_settings%ROWTYPE;
  v_entitlement public.whatsapp_studio_entitlements%ROWTYPE;
  v_used integer;
  v_limit integer;
  v_threshold integer;
  v_scope text;
BEGIN
  IF p_outcome NOT IN ('submitted', 'delivered', 'failed', 'skipped') THEN
    RAISE EXCEPTION 'invalid_whatsapp_usage_outcome';
  END IF;

  UPDATE public.whatsapp_usage_ledger
  SET state = CASE
        WHEN p_outcome = 'delivered' THEN 'counted'
        WHEN p_outcome = 'submitted' THEN 'submitted'
        ELSE 'released'
      END,
      message_log_id = coalesce(p_message_log_id, message_log_id),
      provider_message_id = coalesce(p_provider_message_id, provider_message_id),
      provider_status = coalesce(p_provider_status, provider_status),
      submitted_at = CASE WHEN p_outcome IN ('submitted', 'delivered') THEN coalesce(submitted_at, now()) ELSE submitted_at END,
      counted_at = CASE WHEN p_outcome = 'delivered' THEN coalesce(counted_at, now()) ELSE counted_at END,
      released_at = CASE WHEN p_outcome IN ('failed', 'skipped') THEN coalesce(released_at, now()) ELSE released_at END,
      metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
      updated_at = now()
  WHERE idempotency_key = p_idempotency_key
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'usage_reservation_not_found');
  END IF;

  IF v_row.entitlement_kind = 'trial' AND p_outcome IN ('submitted', 'delivered') THEN
    SELECT * INTO v_settings FROM public.whatsapp_platform_settings WHERE id = 1;
    SELECT * INTO v_entitlement FROM public.whatsapp_studio_entitlements WHERE studio_id = v_row.studio_id;
    v_limit := coalesce(v_entitlement.trial_message_limit_override, v_settings.trial_message_limit);
    v_scope := coalesce(v_row.metadata->>'usage_scope', 'trial');
    SELECT count(*)::integer INTO v_used
    FROM public.whatsapp_usage_ledger
    WHERE studio_id = v_row.studio_id
      AND entitlement_kind = 'trial'
      AND state IN ('submitted', 'counted')
      AND created_at >= coalesce(v_entitlement.trial_started_at, '-infinity'::timestamptz)
      AND created_at < coalesce(v_entitlement.trial_ends_at, 'infinity'::timestamptz);

    FOREACH v_threshold IN ARRAY v_settings.alert_thresholds LOOP
      IF v_limit > 0 AND (v_used * 100.0 / v_limit) >= v_threshold THEN
        INSERT INTO public.whatsapp_usage_alerts (
          studio_id, usage_scope, threshold_percent, used_count, limit_count
        ) VALUES (v_row.studio_id, v_scope, v_threshold, v_used, v_limit)
        ON CONFLICT (studio_id, usage_scope, threshold_percent) DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'state', v_row.state, 'ledgerId', v_row.id);
END
$$;


ALTER FUNCTION "public"."finalize_whatsapp_usage"("p_idempotency_key" "text", "p_outcome" "text", "p_message_log_id" "uuid", "p_provider_message_id" "text", "p_provider_status" "text", "p_metadata" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_available_slots"("p_studio_slug" "text", "p_staff_id" "uuid", "p_date" "date", "p_duration_min" integer, "p_slot_step_min" integer DEFAULT 15) RETURNS TABLE("staff_id" "uuid", "slot_start" timestamp with time zone, "slot_label" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_studio_id uuid;
  v_tz text := 'Europe/Lisbon';
  v_weekday int;
  v_now timestamptz := now();
  v_min_booking_notice_min integer := 30;
  v_min_start timestamptz;
BEGIN
  IF p_duration_min IS NULL OR p_duration_min <= 0 OR p_duration_min > 720 THEN RETURN; END IF;
  IF p_slot_step_min IS NULL OR p_slot_step_min <= 0 OR p_slot_step_min > 720 THEN
    p_slot_step_min := 15;
  END IF;

  SELECT studio.id, studio.timezone, COALESCE(studio.min_booking_notice_min, 30)
  INTO v_studio_id, v_tz, v_min_booking_notice_min
  FROM public.studios AS studio
  WHERE studio.slug = p_studio_slug
    AND studio.is_active = true
    AND public.studio_has_entitlement(studio.id, 'online_booking');
  IF v_studio_id IS NULL THEN RETURN; END IF;

  v_tz := COALESCE(v_tz, 'Europe/Lisbon');
  v_min_start := v_now + (GREATEST(v_min_booking_notice_min, 0) || ' minutes')::interval;
  v_weekday := EXTRACT(DOW FROM p_date)::int;

  RETURN QUERY
  WITH eligible_staff AS (
    SELECT member.id
    FROM public.staff AS member
    WHERE member.studio_id = v_studio_id
      AND member.is_active = true
      AND COALESCE(member.current_status, 'online') <> 'absent'
      AND (p_staff_id IS NULL OR member.id = p_staff_id)
      AND public.studio_staff_is_within_plan(v_studio_id, member.id)
  ), windows AS (
    SELECT availability.staff_id, availability.start_time, availability.end_time
    FROM public.staff_availability AS availability
    JOIN eligible_staff ON eligible_staff.id = availability.staff_id
    WHERE availability.studio_id = v_studio_id
      AND availability.weekday = v_weekday
      AND availability.end_time > availability.start_time
  ), slot_grid AS (
    SELECT
      windows.staff_id,
      slot.local_ts,
      slot.local_ts::time AS slot_t
    FROM windows
    CROSS JOIN LATERAL generate_series(
      p_date::timestamp + windows.start_time,
      p_date::timestamp + windows.end_time,
      (p_slot_step_min || ' minutes')::interval
    ) AS slot(local_ts)
  ), candidates AS (
    SELECT
      slot_grid.staff_id,
      (slot_grid.local_ts AT TIME ZONE v_tz) AS slot_start_ts,
      slot_grid.slot_t
    FROM slot_grid
  )
  SELECT
    candidates.staff_id,
    candidates.slot_start_ts AS slot_start,
    to_char(candidates.slot_t, 'HH24:MI') AS slot_label
  FROM candidates
  WHERE candidates.slot_start_ts >= v_min_start
    AND public.is_staff_slot_bookable(
      v_studio_id, candidates.staff_id, candidates.slot_start_ts, p_duration_min
    )
  ORDER BY candidates.slot_start_ts, candidates.staff_id;
END
$$;


ALTER FUNCTION "public"."get_available_slots"("p_studio_slug" "text", "p_staff_id" "uuid", "p_date" "date", "p_duration_min" integer, "p_slot_step_min" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_cash_register_closure_history"("p_studio_id" "uuid", "p_limit" integer DEFAULT 20) RETURNS TABLE("id" "uuid", "opened_at" timestamp with time zone, "closed_at" timestamp with time zone, "opening_amount" numeric, "closing_counted_amount" numeric, "expected_cash_amount" numeric, "difference_amount" numeric, "total_in" numeric, "total_out" numeric, "movement_count" integer, "summary" "jsonb", "movements" "jsonb")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  WITH closed_sessions AS (
    SELECT s.*
    FROM public.cash_register_sessions s
    WHERE s.studio_id = p_studio_id
      AND s.status = 'closed'
      AND public.is_studio_member(auth.uid(), s.studio_id)
    ORDER BY s.closed_at DESC NULLS LAST
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100)
  ),
  totals AS (
    SELECT
      s.id,
      COALESCE(sum(m.amount) FILTER (WHERE m.movement_type NOT IN ('manual_out','sangria','transfer_out')), 0) AS total_in,
      COALESCE(sum(m.amount) FILTER (WHERE m.movement_type IN ('manual_out','sangria','transfer_out')), 0) AS total_out,
      count(m.id)::integer AS movement_count
    FROM closed_sessions s
    LEFT JOIN public.cash_register_movements m ON m.session_id = s.id
    GROUP BY s.id
  )
  SELECT
    s.id,
    s.opened_at,
    s.closed_at,
    s.opening_amount,
    s.closing_counted_amount,
    (s.opening_amount + t.total_in - t.total_out) AS expected_cash_amount,
    (COALESCE(s.closing_counted_amount, 0) - (s.opening_amount + t.total_in - t.total_out)) AS difference_amount,
    t.total_in,
    t.total_out,
    t.movement_count,
    COALESCE(s.summary, '{}'::jsonb) || jsonb_build_object(
      'total_in', t.total_in,
      'total_out', t.total_out,
      'movements', t.movement_count
    ) AS summary,
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', m.id,
            'movement_type', m.movement_type,
            'payment_method', m.payment_method,
            'amount', m.amount,
            'description', m.description,
            'occurred_at', m.occurred_at,
            'created_by', m.created_by,
            'responsible_name', COALESCE(p.full_name, 'Responsavel')
          )
          ORDER BY m.occurred_at ASC
        )
        FROM public.cash_register_movements m
        LEFT JOIN public.profiles p ON p.id = m.created_by
        WHERE m.session_id = s.id
      ),
      '[]'::jsonb
    ) AS movements
  FROM closed_sessions s
  JOIN totals t ON t.id = s.id
  ORDER BY s.closed_at DESC NULLS LAST;
$$;


ALTER FUNCTION "public"."get_cash_register_closure_history"("p_studio_id" "uuid", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_open_cash_register"("p_studio_id" "uuid") RETURNS TABLE("id" "uuid", "studio_id" "uuid", "opening_amount" numeric, "opened_at" timestamp with time zone, "opened_by" "uuid", "movement_count" bigint, "total_cash" numeric, "total_mb_way" numeric, "total_card" numeric, "total_bank_transfer" numeric, "total_other" numeric, "manual_in" numeric, "manual_out" numeric, "expected_cash_amount" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    s.id,
    s.studio_id,
    s.opening_amount,
    s.opened_at,
    s.opened_by,
    count(m.id) AS movement_count,
    COALESCE(sum(m.amount) FILTER (WHERE m.payment_method = 'cash' AND m.movement_type NOT IN ('manual_out','sangria','transfer_out')), 0) AS total_cash,
    COALESCE(sum(m.amount) FILTER (WHERE m.payment_method = 'mb_way' AND m.movement_type NOT IN ('manual_out','sangria','transfer_out')), 0) AS total_mb_way,
    COALESCE(sum(m.amount) FILTER (WHERE m.payment_method = 'card' AND m.movement_type NOT IN ('manual_out','sangria','transfer_out')), 0) AS total_card,
    COALESCE(sum(m.amount) FILTER (WHERE m.payment_method = 'bank_transfer' AND m.movement_type NOT IN ('manual_out','sangria','transfer_out')), 0) AS total_bank_transfer,
    COALESCE(sum(m.amount) FILTER (WHERE m.payment_method = 'other' AND m.movement_type NOT IN ('manual_out','sangria','transfer_out')), 0) AS total_other,
    COALESCE(sum(m.amount) FILTER (WHERE m.movement_type IN ('manual_in','transfer_in')), 0) AS manual_in,
    COALESCE(sum(m.amount) FILTER (WHERE m.movement_type IN ('manual_out','sangria','transfer_out')), 0) AS manual_out,
    (
      s.opening_amount
      + COALESCE(sum(m.amount) FILTER (WHERE m.movement_type NOT IN ('manual_out','sangria','transfer_out')), 0)
      - COALESCE(sum(m.amount) FILTER (WHERE m.movement_type IN ('manual_out','sangria','transfer_out')), 0)
    ) AS expected_cash_amount
  FROM public.cash_register_sessions s
  LEFT JOIN public.cash_register_movements m ON m.session_id = s.id
  WHERE s.studio_id = p_studio_id
    AND s.status = 'open'
    AND public.is_studio_member(auth.uid(), s.studio_id)
  GROUP BY s.id;
$$;


ALTER FUNCTION "public"."get_open_cash_register"("p_studio_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_or_create_customer_referral_code"("p_studio_id" "uuid", "p_client_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_code text;
  v_candidate text;
  v_attempt integer := 0;
BEGIN
  IF p_studio_id IS NULL OR p_client_id IS NULL THEN
    RAISE EXCEPTION 'customer_referral_invalid_context';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.clients c
    WHERE c.id = p_client_id
      AND c.studio_id = p_studio_id
  ) THEN
    RAISE EXCEPTION 'customer_referral_client_not_found';
  END IF;

  SELECT code INTO v_code
  FROM public.customer_referral_codes
  WHERE studio_id = p_studio_id
    AND referrer_client_id = p_client_id;

  IF v_code IS NOT NULL THEN
    RETURN v_code;
  END IF;

  LOOP
    v_attempt := v_attempt + 1;
    v_candidate := 'C' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    BEGIN
      INSERT INTO public.customer_referral_codes (studio_id, referrer_client_id, code)
      VALUES (p_studio_id, p_client_id, v_candidate)
      RETURNING code INTO v_code;
      RETURN v_code;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt > 10 THEN
        RAISE EXCEPTION 'customer_referral_code_generation_failed';
      END IF;
    END;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."get_or_create_customer_referral_code"("p_studio_id" "uuid", "p_client_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_or_create_referral_code"("p_studio_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_code TEXT;
  v_chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_attempt INT := 0;
BEGIN
  SELECT referral_code INTO v_code FROM studios WHERE id = p_studio_id;
  IF v_code IS NOT NULL THEN RETURN v_code; END IF;
  LOOP
    v_attempt := v_attempt + 1;
    IF v_attempt > 10 THEN RAISE EXCEPTION 'referral_code_generation_failed'; END IF;
    v_code := '';
    FOR i IN 1..8 LOOP
      v_code := v_code || substr(v_chars, floor(random() * length(v_chars) + 1)::int, 1);
    END LOOP;
    BEGIN
      UPDATE studios SET referral_code = v_code WHERE id = p_studio_id AND referral_code IS NULL;
      IF FOUND THEN RETURN v_code; END IF;
      SELECT referral_code INTO v_code FROM studios WHERE id = p_studio_id;
      IF v_code IS NOT NULL THEN RETURN v_code; END IF;
    EXCEPTION WHEN unique_violation THEN CONTINUE;
    END;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."get_or_create_referral_code"("p_studio_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_public_reschedule_slots"("p_public_token" "text", "p_staff_id" "uuid", "p_date" "date", "p_slot_step_min" integer DEFAULT 15) RETURNS TABLE("staff_id" "uuid", "slot_start" timestamp with time zone, "slot_label" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_appt record;
  v_duration integer;
  v_tz text;
  v_min_start timestamptz;
  v_weekday integer;
BEGIN
  IF length(trim(coalesce(p_public_token, ''))) < 16
     OR p_staff_id IS NULL
     OR p_date IS NULL THEN
    RETURN;
  END IF;
  IF p_slot_step_min IS NULL OR p_slot_step_min <= 0 OR p_slot_step_min > 720 THEN
    p_slot_step_min := 15;
  END IF;

  SELECT
    a.id,
    a.studio_id,
    a.status,
    a.starts_at,
    a.ends_at,
    a.total_duration_min,
    COALESCE(s.timezone, 'Europe/Lisbon') AS timezone,
    COALESCE(s.min_booking_notice_min, 30) AS min_booking_notice_min
  INTO v_appt
  FROM public.appointments AS a
  JOIN public.studios AS s ON s.id = a.studio_id
  WHERE a.public_token = p_public_token
    AND s.is_active = true
    AND public.has_active_premium_access(s.id);

  IF v_appt.id IS NULL
     OR v_appt.status IN ('cancelled', 'no_show', 'completed') THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(aps.duration_min), 0)::integer
  INTO v_duration
  FROM public.appointment_services AS aps
  WHERE aps.appointment_id = v_appt.id;

  v_duration := COALESCE(
    NULLIF(v_appt.total_duration_min, 0),
    NULLIF(v_duration, 0),
    GREATEST(
      15,
      CEIL(EXTRACT(EPOCH FROM (v_appt.ends_at - v_appt.starts_at)) / 60)::integer
    )
  );
  v_tz := COALESCE(NULLIF(v_appt.timezone, ''), 'Europe/Lisbon');
  v_min_start := now() + (GREATEST(v_appt.min_booking_notice_min, 0) || ' minutes')::interval;
  v_weekday := EXTRACT(DOW FROM p_date)::integer;

  RETURN QUERY
  WITH windows AS (
    SELECT sa.start_time, sa.end_time
    FROM public.staff_availability AS sa
    JOIN public.staff AS st
      ON st.id = sa.staff_id
     AND st.studio_id = v_appt.studio_id
     AND st.is_active = true
     AND COALESCE(st.current_status, 'online') <> 'absent'
    WHERE sa.studio_id = v_appt.studio_id
      AND sa.staff_id = p_staff_id
      AND sa.weekday = v_weekday
      AND sa.end_time > sa.start_time
      AND (sa.end_time - make_interval(mins => v_duration)) >= sa.start_time
  ),
  candidates AS (
    SELECT
      ((p_date::timestamp + candidate.local_ts::time) AT TIME ZONE v_tz) AS starts_at,
      candidate.local_ts::time AS local_time
    FROM windows AS w
    CROSS JOIN LATERAL generate_series(
      p_date::timestamp + w.start_time,
      p_date::timestamp + w.end_time - make_interval(mins => v_duration),
      make_interval(mins => p_slot_step_min)
    ) AS candidate(local_ts)
  )
  SELECT
    p_staff_id,
    candidate.starts_at,
    to_char(candidate.local_time, 'HH24:MI')
  FROM candidates AS candidate
  WHERE candidate.starts_at >= v_min_start
    AND public.is_staff_slot_bookable(
      v_appt.studio_id,
      p_staff_id,
      candidate.starts_at,
      v_duration,
      NULL,
      v_appt.id
    )
  ORDER BY candidate.starts_at;
END
$$;


ALTER FUNCTION "public"."get_public_reschedule_slots"("p_public_token" "text", "p_staff_id" "uuid", "p_date" "date", "p_slot_step_min" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_studio_id_by_referral_code"("p_code" "text") RETURNS "uuid"
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
  SELECT id FROM studios WHERE referral_code = p_code LIMIT 1;
$$;


ALTER FUNCTION "public"."get_studio_id_by_referral_code"("p_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_whatsapp_admin_overview"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'whatsapp_admin_overview_forbidden' USING ERRCODE = '42501';
  END IF;

  WITH settings AS (
    SELECT * FROM public.whatsapp_platform_settings WHERE id = 1
  ),
  studio_rollup AS (
    SELECT
      s.id,
      s.name,
      s.subscription_status,
      s.whatsapp_auto_send_enabled,
      coalesce(e.status, 'inactive') AS whatsapp_status,
      e.trial_started_at,
      coalesce(e.trial_ends_at, s.trial_ends_at) AS whatsapp_trial_ends_at,
      e.addon_started_at,
      e.addon_ends_at,
      e.paused_reason,
      CASE
        WHEN e.status = 'trial' THEN coalesce(e.trial_message_limit_override, cfg.trial_message_limit)
        ELSE NULL
      END AS message_limit,
      coalesce(u.used, 0)::integer AS used,
      coalesce(u.reserved, 0)::integer AS reserved,
      coalesce(l.sent, 0)::integer AS sent_messages,
      coalesce(l.pending, 0)::integer AS pending_messages,
      coalesce(l.failed, 0)::integer AS failed_messages,
      coalesce(l.blocked, 0)::integer AS blocked_messages,
      coalesce(u.provider_cost_cents, 0)::bigint AS estimated_provider_cost_cents,
      coalesce(u.revenue_cents, 0)::bigint AS estimated_revenue_cents,
      greatest(u.last_activity_at, l.last_activity_at) AS last_activity_at,
      CASE
        WHEN NOT cfg.global_enabled THEN false
        WHEN e.status = 'legacy' THEN true
        WHEN e.status = 'active' THEN e.addon_ends_at IS NULL OR e.addon_ends_at > now()
        WHEN e.status = 'trial' THEN
          cfg.trial_enabled
          AND coalesce(e.trial_ends_at, s.trial_ends_at) > now()
          AND coalesce(u.used, 0) + coalesce(u.reserved, 0)
              < coalesce(e.trial_message_limit_override, cfg.trial_message_limit)
        ELSE false
      END AS available
    FROM public.studios s
    CROSS JOIN settings cfg
    LEFT JOIN public.whatsapp_studio_entitlements e ON e.studio_id = s.id
    LEFT JOIN LATERAL (
      SELECT
        count(*) FILTER (WHERE w.state IN ('submitted', 'counted')) AS used,
        count(*) FILTER (WHERE w.state = 'reserved') AS reserved,
        sum(w.unit_cost_cents) FILTER (WHERE w.state IN ('submitted', 'counted')) AS provider_cost_cents,
        sum(w.commercial_unit_cents) FILTER (WHERE w.state IN ('submitted', 'counted')) AS revenue_cents,
        max(w.updated_at) AS last_activity_at
      FROM public.whatsapp_usage_ledger w
      WHERE w.studio_id = s.id
        AND (
          e.status IS DISTINCT FROM 'trial'
          OR (
            w.created_at >= coalesce(e.trial_started_at, '-infinity'::timestamptz)
            AND w.created_at < coalesce(e.trial_ends_at, s.trial_ends_at, 'infinity'::timestamptz)
          )
        )
    ) u ON true
    LEFT JOIN LATERAL (
      SELECT
        count(*) FILTER (WHERE m.status = 'sent') AS sent,
        count(*) FILTER (WHERE m.status = 'pending') AS pending,
        count(*) FILTER (WHERE m.status = 'failed') AS failed,
        count(*) FILTER (
          WHERE m.status = 'skipped' AND coalesce(m.reason, '') LIKE 'whatsapp_%'
        ) AS blocked,
        max(m.updated_at) AS last_activity_at
      FROM public.whatsapp_message_logs m
      WHERE m.studio_id = s.id
    ) l ON true
  ),
  global_usage AS (
    SELECT
      count(*) FILTER (WHERE state IN ('submitted', 'counted'))::integer AS messages,
      coalesce(sum(unit_cost_cents) FILTER (WHERE state IN ('submitted', 'counted')), 0)::bigint AS provider_cost_cents,
      coalesce(sum(commercial_unit_cents) FILTER (WHERE state IN ('submitted', 'counted')), 0)::bigint AS revenue_cents
    FROM public.whatsapp_usage_ledger
  ),
  global_logs AS (
    SELECT
      count(*) FILTER (WHERE status = 'failed')::integer AS failed,
      count(*) FILTER (
        WHERE status = 'skipped' AND coalesce(reason, '') LIKE 'whatsapp_%'
      )::integer AS blocked
    FROM public.whatsapp_message_logs
  )
  SELECT jsonb_build_object(
    'settings', jsonb_build_object(
      'id', cfg.id,
      'global_enabled', cfg.global_enabled,
      'trial_enabled', cfg.trial_enabled,
      'trial_duration_days', cfg.trial_duration_days,
      'trial_message_limit', cfg.trial_message_limit,
      'alert_thresholds', cfg.alert_thresholds,
      'post_trial_mode', cfg.post_trial_mode,
      'billing_mode', cfg.billing_mode,
      'provider_cost_per_message_cents', cfg.provider_cost_per_message_cents,
      'commercial_price_cents', cfg.commercial_price_cents,
      'commercial_included_messages', cfg.commercial_included_messages,
      'commercial_excess_message_cents', cfg.commercial_excess_message_cents,
      'currency', cfg.currency,
      'provider_contract_verified_at', cfg.provider_contract_verified_at,
      'updated_at', cfg.updated_at
    ),
    'summary', jsonb_build_object(
      'studiosUsing', count(*) FILTER (WHERE r.available AND r.whatsapp_auto_send_enabled),
      'trialStudios', count(*) FILTER (WHERE r.whatsapp_status = 'trial'),
      'payingStudios', count(*) FILTER (WHERE r.whatsapp_status = 'active'),
      'messages', gu.messages,
      'failedMessages', gl.failed,
      'blockedMessages', gl.blocked,
      'estimatedProviderCostCents', gu.provider_cost_cents,
      'estimatedRevenueCents', gu.revenue_cents,
      'costConfigured', cfg.provider_cost_per_message_cents IS NOT NULL
    ),
    'studios', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'name', r.name,
          'subscriptionStatus', r.subscription_status,
          'status', r.whatsapp_status,
          'available', r.available,
          'autoSendEnabled', r.whatsapp_auto_send_enabled,
          'trialEndsAt', r.whatsapp_trial_ends_at,
          'daysRemaining', CASE
            WHEN r.whatsapp_status = 'trial' AND r.whatsapp_trial_ends_at IS NOT NULL
            THEN greatest(0, ceil(extract(epoch FROM (r.whatsapp_trial_ends_at - now())) / 86400.0))::integer
            ELSE NULL
          END,
          'used', r.used,
          'reserved', r.reserved,
          'limit', r.message_limit,
          'remaining', CASE
            WHEN r.message_limit IS NULL THEN NULL
            ELSE greatest(0, r.message_limit - r.used - r.reserved)
          END,
          'usagePercent', CASE
            WHEN r.message_limit IS NULL THEN NULL
            WHEN r.message_limit = 0 THEN 100
            ELSE least(100, round(((r.used + r.reserved)::numeric / r.message_limit) * 100))::integer
          END,
          'pauseReason', r.paused_reason,
          'billingAvailable', cfg.billing_mode <> 'disabled' AND cfg.commercial_price_cents IS NOT NULL,
          'billingMode', cfg.billing_mode,
          'commercialPriceCents', cfg.commercial_price_cents,
          'currency', cfg.currency,
          'sentMessages', r.sent_messages,
          'pendingMessages', r.pending_messages,
          'failedMessages', r.failed_messages,
          'blockedMessages', r.blocked_messages,
          'estimatedProviderCostCents', r.estimated_provider_cost_cents,
          'estimatedRevenueCents', r.estimated_revenue_cents,
          'lastActivityAt', r.last_activity_at
        ) ORDER BY r.name
      ) FILTER (WHERE r.id IS NOT NULL),
      '[]'::jsonb
    )
  ) INTO v_result
  FROM settings cfg
  CROSS JOIN global_usage gu
  CROSS JOIN global_logs gl
  LEFT JOIN studio_rollup r ON true
  GROUP BY cfg.id, cfg.global_enabled, cfg.trial_enabled, cfg.trial_duration_days,
           cfg.trial_message_limit, cfg.alert_thresholds, cfg.post_trial_mode,
           cfg.billing_mode, cfg.provider_cost_per_message_cents,
           cfg.commercial_price_cents, cfg.commercial_included_messages,
           cfg.commercial_excess_message_cents, cfg.currency,
           cfg.provider_contract_verified_at, cfg.updated_by,
           cfg.created_at, cfg.updated_at,
           gu.messages, gu.provider_cost_cents, gu.revenue_cents,
           gl.failed, gl.blocked;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'whatsapp_platform_settings_missing' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_result;
END
$$;


ALTER FUNCTION "public"."get_whatsapp_admin_overview"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_whatsapp_admin_overview"() IS 'Server-only aggregate for Central Bellza WhatsApp. The Worker must authorize SaaS owner first.';



CREATE OR REPLACE FUNCTION "public"."group_attendance_confirmation_notification"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_timezone text := 'Europe/Lisbon';
  v_local_date date;
  v_event_key text;
BEGIN
  IF NEW.kind <> 'attendance_confirmation' THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(nullif(timezone, ''), 'Europe/Lisbon')
  INTO v_timezone
  FROM public.studios
  WHERE id = NEW.studio_id;

  BEGIN
    v_local_date := (
      coalesce(nullif(NEW.payload->>'starts_at', '')::timestamptz, now())
      AT TIME ZONE v_timezone
    )::date;
  EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow THEN
    v_local_date := (now() AT TIME ZONE v_timezone)::date;
  END;

  v_event_key := 'attendance_confirmation:' || NEW.studio_id::text || ':' || v_local_date::text;
  NEW.title := 'Atendimentos por confirmar';
  NEW.body := 'Existem atendimentos pendentes. Abra a Agenda para resolver todos de uma vez.';
  NEW.event_key := v_event_key;
  NEW.action_url := '/admin/agenda?pendencias=1';
  NEW.payload := (coalesce(NEW.payload, '{}'::jsonb) - 'appointment_id' - 'client_id') ||
    jsonb_build_object(
      'event_key', v_event_key,
      'local_date', v_local_date,
      'action_url', NEW.action_url,
      'grouped', true
    );
  RETURN NEW;
END
$$;


ALTER FUNCTION "public"."group_attendance_confirmation_notification"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_studio_platform_fields"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF auth.role() IN ('anon', 'authenticated') AND (
    NEW.plan IS DISTINCT FROM OLD.plan OR
    NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at OR
    NEW.is_active IS DISTINCT FROM OLD.is_active OR
    NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id OR
    NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id OR
    NEW.subscription_status IS DISTINCT FROM OLD.subscription_status OR
    NEW.subscription_current_period_end IS DISTINCT FROM OLD.subscription_current_period_end OR
    NEW.subscription_cancel_at_period_end IS DISTINCT FROM OLD.subscription_cancel_at_period_end OR
    NEW.premium_access_until IS DISTINCT FROM OLD.premium_access_until OR
    NEW.trial_used_at IS DISTINCT FROM OLD.trial_used_at OR
    NEW.stripe_connect_account_id IS DISTINCT FROM OLD.stripe_connect_account_id OR
    NEW.stripe_connect_charges_enabled IS DISTINCT FROM OLD.stripe_connect_charges_enabled OR
    NEW.stripe_connect_payouts_enabled IS DISTINCT FROM OLD.stripe_connect_payouts_enabled OR
    NEW.stripe_connect_onboarding_completed IS DISTINCT FROM OLD.stripe_connect_onboarding_completed OR
    NEW.stripe_connect_status IS DISTINCT FROM OLD.stripe_connect_status OR
    NEW.stripe_connect_mb_way_payments_enabled IS DISTINCT FROM OLD.stripe_connect_mb_way_payments_enabled OR
    NEW.trial_claimed_at IS DISTINCT FROM OLD.trial_claimed_at OR
    NEW.trial_identity_phone IS DISTINCT FROM OLD.trial_identity_phone OR
    NEW.trial_identity_studio_name IS DISTINCT FROM OLD.trial_identity_studio_name OR
    NEW.trial_identity_slug IS DISTINCT FROM OLD.trial_identity_slug OR
    NEW.trial_identity_ip_hash IS DISTINCT FROM OLD.trial_identity_ip_hash OR
    NEW.trial_identity_device_fingerprint_hash IS DISTINCT FROM OLD.trial_identity_device_fingerprint_hash OR
    NEW.trial_identity_nif IS DISTINCT FROM OLD.trial_identity_nif OR
    NEW.trial_identity_stripe_account_id IS DISTINCT FROM OLD.trial_identity_stripe_account_id OR
    NEW.trial_blocked_reason IS DISTINCT FROM OLD.trial_blocked_reason
  ) THEN
    RAISE EXCEPTION 'platform_fields_are_server_managed';
  END IF;
  RETURN NEW;
END
$$;


ALTER FUNCTION "public"."guard_studio_platform_fields"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NULLIF(NEW.raw_user_meta_data->>'phone', '')
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
    phone = COALESCE(EXCLUDED.phone, profiles.phone),
    updated_at = now();
  RETURN NEW;
END
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_active_premium_access"("_studio_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  -- Kept semantically compatible for stored policies and for a safe Worker
  -- rollback during a rolling deployment. New code must ask for a specific
  -- entitlement instead of treating this compatibility function as a base gate.
  SELECT public.studio_effective_plan_tier(_studio_id) = 'premium'
$$;


ALTER FUNCTION "public"."has_active_premium_access"("_studio_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_privileged_studio_access"("_user_id" "uuid", "_studio_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.studio_id = _studio_id
      AND ur.role::text IN ('saas_owner', 'studio_owner', 'manager')
  )
$$;


ALTER FUNCTION "public"."has_privileged_studio_access"("_user_id" "uuid", "_studio_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_role"("_user_id" "uuid", "_studio_id" "uuid", "_role" "public"."app_role") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND studio_id = _studio_id AND role = _role
  )
$$;


ALTER FUNCTION "public"."has_role"("_user_id" "uuid", "_studio_id" "uuid", "_role" "public"."app_role") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."insert_studio_notification"("p_studio_id" "uuid", "p_kind" "text", "p_title" "text", "p_body" "text", "p_payload" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_id uuid;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_event_key text;
  v_action_url text;
  v_title text;
  v_body text;
  v_appointment_id uuid;
  v_related_studio_id uuid;
  v_inserted boolean := false;
begin
  if not exists (select 1 from public.studios where id = p_studio_id) then
    raise exception 'notification_studio_missing';
  end if;

  if nullif(v_payload->>'appointment_id', '') is not null then
    begin
      v_appointment_id := (v_payload->>'appointment_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'invalid_notification_appointment_id';
    end;

    select studio_id into v_related_studio_id
    from public.appointments
    where id = v_appointment_id;

    if v_related_studio_id is null then
      raise exception 'notification_appointment_missing';
    end if;
    if v_related_studio_id <> p_studio_id then
      raise exception 'notification_studio_mismatch';
    end if;
  end if;

  if nullif(v_payload->>'booking_request_id', '') is not null then
    select studio_id into v_related_studio_id
    from public.booking_payment_requests
    where id = (v_payload->>'booking_request_id')::uuid;
    if v_related_studio_id is null or v_related_studio_id <> p_studio_id then
      raise exception 'notification_booking_request_studio_mismatch';
    end if;
  end if;

  if nullif(v_payload->>'client_id', '') is not null then
    select studio_id into v_related_studio_id
    from public.clients
    where id = (v_payload->>'client_id')::uuid;
    if v_related_studio_id is null or v_related_studio_id <> p_studio_id then
      raise exception 'notification_client_studio_mismatch';
    end if;
  end if;

  if nullif(v_payload->>'review_id', '') is not null then
    select studio_id into v_related_studio_id
    from public.studio_reviews
    where id = (v_payload->>'review_id')::uuid;
    if v_related_studio_id is null or v_related_studio_id <> p_studio_id then
      raise exception 'notification_review_studio_mismatch';
    end if;
  end if;

  v_payload := jsonb_set(v_payload, '{studio_id}', to_jsonb(p_studio_id::text), true);
  v_title := trim(coalesce(p_title, ''));
  v_body := trim(coalesce(p_body, ''));

  if v_title = '' or v_title ~* '\m(from|insert|update|delete|upsert|select|payload|schema|table|row|uuid|endpoint|subscription|webhook)\M' then
    v_title := case p_kind
      when 'new_appointment' then 'Nova marcação recebida'
      when 'appointment_rescheduled' then 'Marcação remarcada'
      when 'appointment_cancelled' then 'Marcação cancelada'
      when 'payment_confirmed' then 'Pagamento aprovado'
      when 'payment_failed' then 'Pagamento não concluído'
      when 'new_client' then 'Novo cliente cadastrado'
      when 'new_review' then 'Nova avaliação recebida'
      when 'refund_request' then 'Pedido de reembolso recebido'
      when 'withdrawal_requested' then 'Pedido financeiro recebido'
      else 'Notificação'
    end;
  end if;

  if v_body = '' or v_body ~* '\m(from|insert|update|delete|upsert|select|payload|schema|table|row|uuid|endpoint|subscription|webhook)\M' then
    v_body := case p_kind
      when 'new_appointment' then 'Tem uma nova marcação para acompanhar no painel.'
      when 'appointment_rescheduled' then 'Uma marcação foi remarcada.'
      when 'appointment_cancelled' then 'Uma marcação foi cancelada.'
      when 'payment_confirmed' then 'Um pagamento foi aprovado.'
      when 'payment_failed' then 'Um pagamento precisa de atenção.'
      when 'new_client' then 'Um novo cliente foi adicionado ao estúdio.'
      when 'new_review' then 'O estúdio recebeu uma nova avaliação.'
      when 'refund_request' then 'Existe um pedido de reembolso para analisar.'
      when 'withdrawal_requested' then 'Existe uma atualização financeira para analisar.'
      else 'Tem uma nova atualização importante no painel.'
    end;
  end if;

  v_event_key := nullif(trim(coalesce(v_payload->>'event_key', '')), '');
  if v_event_key is null then
    v_event_key := concat_ws(
      ':',
      p_kind,
      coalesce(
        v_payload->>'payment_intent_id',
        v_payload->>'review_id',
        v_payload->>'client_id',
        v_payload->>'appointment_id',
        v_payload->>'booking_request_id',
        md5(v_payload::text)
      )
    );
  end if;

  v_action_url := nullif(trim(coalesce(v_payload->>'action_url', '')), '');
  if v_action_url is null or v_action_url !~ '^/admin(/|$|[?])' then
    v_action_url := public.notification_default_action_url(p_kind, v_payload);
  end if;

  insert into public.studio_notifications (
    studio_id,
    kind,
    title,
    body,
    payload,
    event_key,
    action_url
  )
  values (
    p_studio_id,
    p_kind,
    left(v_title, 160),
    left(v_body, 1000),
    v_payload,
    left(v_event_key, 500),
    v_action_url
  )
  on conflict (studio_id, event_key) where event_key is not null do nothing
  returning id into v_id;

  if v_id is not null then
    v_inserted := true;
  else
    select id into v_id
    from public.studio_notifications
    where studio_id = p_studio_id
      and event_key = left(v_event_key, 500);
  end if;

  if v_inserted then
    insert into public.notifications_log (
      studio_id,
      appointment_id,
      channel,
      kind,
      recipient,
      payload,
      status
    )
    values (
      p_studio_id,
      v_appointment_id,
      'studio_realtime',
      p_kind,
      'studio:' || p_studio_id::text,
      jsonb_build_object(
        'event', 'studio_notification_created',
        'studio_notification_id', v_id,
        'event_key', v_event_key,
        'action_url', v_action_url
      ),
      'sent'
    );
  end if;

  return v_id;
end
$_$;


ALTER FUNCTION "public"."insert_studio_notification"("p_studio_id" "uuid", "p_kind" "text", "p_title" "text", "p_body" "text", "p_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_saas_owner"("_user_id" "uuid" DEFAULT "auth"."uid"()) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id AND ur.role = 'saas_owner'
  )
$$;


ALTER FUNCTION "public"."is_saas_owner"("_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_staff_managerial_slot_bookable"("p_studio_id" "uuid", "p_staff_id" "uuid", "p_starts_at" timestamp with time zone, "p_duration_min" integer, "p_ignore_appointment_id" "uuid" DEFAULT NULL::"uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF p_studio_id IS NULL
     OR p_staff_id IS NULL
     OR p_starts_at IS NULL
     OR p_duration_min IS NULL
     OR p_duration_min <= 0
     OR p_duration_min > 720 THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.studios AS studio
    JOIN public.staff AS staff
      ON staff.studio_id = studio.id
     AND staff.id = p_staff_id
     AND staff.is_active = true
     AND COALESCE(staff.current_status, 'online') <> 'absent'
    WHERE studio.id = p_studio_id
      AND studio.is_active = true
  ) THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.staff_time_off AS time_off
    WHERE time_off.staff_id = p_staff_id
      AND tstzrange(time_off.starts_at, time_off.ends_at, '[)') &&
          tstzrange(
            p_starts_at,
            p_starts_at + make_interval(mins => p_duration_min),
            '[)'
          )
  ) THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.appointments AS appointment
    WHERE appointment.staff_id = p_staff_id
      AND (p_ignore_appointment_id IS NULL OR appointment.id <> p_ignore_appointment_id)
      AND appointment.status NOT IN ('cancelled', 'no_show')
      AND tstzrange(appointment.starts_at, appointment.ends_at, '[)') &&
          tstzrange(
            p_starts_at,
            p_starts_at + make_interval(mins => p_duration_min),
            '[)'
          )
  ) THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.booking_payment_requests AS request
    WHERE request.staff_id = p_staff_id
      AND request.status IN ('awaiting_payment', 'processing', 'paid')
      AND request.expires_at > now()
      AND tstzrange(request.starts_at, request.ends_at, '[)') &&
          tstzrange(
            p_starts_at,
            p_starts_at + make_interval(mins => p_duration_min),
            '[)'
          )
  ) THEN
    RETURN false;
  END IF;

  RETURN true;
END
$$;


ALTER FUNCTION "public"."is_staff_managerial_slot_bookable"("p_studio_id" "uuid", "p_staff_id" "uuid", "p_starts_at" timestamp with time zone, "p_duration_min" integer, "p_ignore_appointment_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_staff_slot_bookable"("p_studio_id" "uuid", "p_staff_id" "uuid", "p_starts_at" timestamp with time zone, "p_duration_min" integer, "p_ignore_booking_request_id" "uuid" DEFAULT NULL::"uuid", "p_ignore_appointment_id" "uuid" DEFAULT NULL::"uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_tz text;
  v_local_start timestamp;
  v_local_end timestamp;
BEGIN
  IF p_studio_id IS NULL
    OR p_staff_id IS NULL
    OR p_starts_at IS NULL
    OR p_duration_min IS NULL
    OR p_duration_min <= 0
    OR p_duration_min > 720
  THEN
    RETURN false;
  END IF;

  SELECT COALESCE(timezone, 'Europe/Lisbon')
  INTO v_tz
  FROM public.studios
  WHERE id = p_studio_id
    AND is_active = true;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_local_start := p_starts_at AT TIME ZONE v_tz;
  v_local_end := (p_starts_at + (p_duration_min || ' minutes')::interval) AT TIME ZONE v_tz;

  IF NOT EXISTS (
    SELECT 1
    FROM public.staff s
    WHERE s.id = p_staff_id
      AND s.studio_id = p_studio_id
      AND s.is_active = true
      AND COALESCE(s.current_status, 'online') <> 'absent'
  ) THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.staff_availability sa
    WHERE sa.studio_id = p_studio_id
      AND sa.staff_id = p_staff_id
      AND sa.weekday = EXTRACT(DOW FROM v_local_start)::int
      AND sa.start_time <= v_local_start::time
      AND sa.end_time >= v_local_end::time
  ) THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.staff_time_off t
    WHERE t.staff_id = p_staff_id
      AND tstzrange(t.starts_at, t.ends_at, '[)') &&
          tstzrange(p_starts_at, p_starts_at + (p_duration_min || ' minutes')::interval, '[)')
  ) THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.appointments a
    WHERE a.staff_id = p_staff_id
      AND (p_ignore_appointment_id IS NULL OR a.id <> p_ignore_appointment_id)
      AND a.status NOT IN ('cancelled','no_show')
      AND tstzrange(a.starts_at, a.ends_at, '[)') &&
          tstzrange(p_starts_at, p_starts_at + (p_duration_min || ' minutes')::interval, '[)')
  ) THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.booking_payment_requests bpr
    WHERE bpr.staff_id = p_staff_id
      AND (p_ignore_booking_request_id IS NULL OR bpr.id <> p_ignore_booking_request_id)
      AND bpr.status IN ('awaiting_payment','processing','paid')
      AND bpr.expires_at > now()
      AND tstzrange(bpr.starts_at, bpr.ends_at, '[)') &&
          tstzrange(p_starts_at, p_starts_at + (p_duration_min || ' minutes')::interval, '[)')
  ) THEN
    RETURN false;
  END IF;

  RETURN true;
END
$$;


ALTER FUNCTION "public"."is_staff_slot_bookable"("p_studio_id" "uuid", "p_staff_id" "uuid", "p_starts_at" timestamp with time zone, "p_duration_min" integer, "p_ignore_booking_request_id" "uuid", "p_ignore_appointment_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_studio_member"("_user_id" "uuid", "_studio_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND studio_id = _studio_id
  )
$$;


ALTER FUNCTION "public"."is_studio_member"("_user_id" "uuid", "_studio_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."issue_customer_loyalty_rewards"("p_studio_id" "uuid", "p_client_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_settings public.customer_loyalty_settings%ROWTYPE;
  v_total_stamps integer;
  v_existing_rewards integer;
  v_target_rewards integer;
  v_missing integer;
BEGIN
  v_settings := public.ensure_customer_loyalty_settings(p_studio_id);
  IF NOT v_settings.enabled OR v_settings.stamps_required_for_reward <= 0 OR v_settings.reward_value <= 0 THEN
    RETURN;
  END IF;

  SELECT COALESCE(sum(stamps), 0)::integer
  INTO v_total_stamps
  FROM public.customer_loyalty_stamp_entries
  WHERE studio_id = p_studio_id
    AND client_id = p_client_id;

  SELECT count(*)::integer
  INTO v_existing_rewards
  FROM public.customer_loyalty_rewards
  WHERE studio_id = p_studio_id
    AND client_id = p_client_id;

  v_target_rewards := floor(GREATEST(v_total_stamps, 0)::numeric / v_settings.stamps_required_for_reward)::integer;
  v_missing := GREATEST(v_target_rewards - v_existing_rewards, 0);

  WHILE v_missing > 0 LOOP
    INSERT INTO public.customer_loyalty_rewards (
      studio_id,
      client_id,
      reward_type,
      reward_value,
      stamps_required
    )
    VALUES (
      p_studio_id,
      p_client_id,
      v_settings.reward_type,
      v_settings.reward_value,
      v_settings.stamps_required_for_reward
    );
    v_missing := v_missing - 1;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."issue_customer_loyalty_rewards"("p_studio_id" "uuid", "p_client_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."move_studio_appointment"("p_studio_id" "uuid", "p_appointment_id" "uuid", "p_starts_at" timestamp with time zone, "p_duration_min" integer, "p_confirm_overlap" boolean, "p_actor_id" "uuid", "p_expected_conflict_ids" "uuid"[] DEFAULT ARRAY[]::"uuid"[], "p_operation" "text" DEFAULT 'move'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_appt public.appointments%ROWTYPE;
  v_end timestamptz;
  v_preview jsonb;
  v_conflicts jsonb;
  v_conflict_ids uuid[];
BEGIN
  IF p_actor_id IS NOT NULL AND NOT public.can_use_studio(p_actor_id, p_studio_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF p_actor_id IS NULL AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_studio_id::text, 726354));

  SELECT * INTO v_appt FROM public.appointments
  WHERE id = p_appointment_id AND studio_id = p_studio_id FOR UPDATE;
  IF v_appt.id IS NULL THEN RAISE EXCEPTION 'appointment_not_found'; END IF;
  IF v_appt.status::text IN ('cancelled', 'canceled', 'no_show', 'completed') THEN
    RAISE EXCEPTION 'appointment_not_reschedulable';
  END IF;
  IF p_duration_min < 5 OR p_duration_min > 720 THEN RAISE EXCEPTION 'invalid_duration'; END IF;
  IF p_operation NOT IN ('move', 'duration') THEN RAISE EXCEPTION 'invalid_schedule_operation'; END IF;
  IF abs(EXTRACT(EPOCH FROM (p_starts_at - v_appt.starts_at))) < 60
     AND p_duration_min = GREATEST(5, COALESCE(v_appt.total_duration_min,
       CEIL(EXTRACT(EPOCH FROM (v_appt.ends_at - v_appt.starts_at)) / 60)::integer)) THEN
    RETURN jsonb_build_object(
      'appointmentId', v_appt.id, 'startsAt', v_appt.starts_at,
      'endsAt', v_appt.ends_at, 'durationMin', p_duration_min,
      'changed', false, 'overlapConfirmed', false, 'conflicts', '[]'::jsonb
    );
  END IF;

  v_preview := public.preview_studio_schedule_change(
    p_studio_id, v_appt.staff_id, p_starts_at, p_duration_min, ARRAY[v_appt.id]
  );
  IF COALESCE((v_preview->>'hardBlocked')::boolean, false) THEN RAISE EXCEPTION 'schedule_hard_blocked'; END IF;
  IF NOT COALESCE((v_preview->>'withinAvailability')::boolean, false)
     AND NOT COALESCE(v_appt.is_manual_fit, false) THEN
    RAISE EXCEPTION 'outside_staff_availability';
  END IF;
  IF COALESCE((v_preview->>'hasConflict')::boolean, false) AND NOT COALESCE(p_confirm_overlap, false) THEN
    RAISE EXCEPTION 'schedule_conflict';
  END IF;

  v_end := p_starts_at + make_interval(mins => p_duration_min);
  v_conflicts := COALESCE(v_preview->'conflicts', '[]'::jsonb);
  SELECT COALESCE(array_agg(DISTINCT (item->>'appointmentId')::uuid), ARRAY[]::uuid[])
  INTO v_conflict_ids FROM jsonb_array_elements(v_conflicts) AS item;
  IF COALESCE(p_confirm_overlap, false)
     AND NOT (
       v_conflict_ids <@ COALESCE(p_expected_conflict_ids, ARRAY[]::uuid[])
       AND COALESCE(p_expected_conflict_ids, ARRAY[]::uuid[]) <@ v_conflict_ids
     ) THEN
    RAISE EXCEPTION 'schedule_conflict_changed';
  END IF;
  IF COALESCE(p_confirm_overlap, false) AND jsonb_array_length(v_conflicts) > 0 THEN
    PERFORM set_config('bellza.allow_manual_overlap', 'on', true);
  END IF;

  UPDATE public.appointments SET
    starts_at = p_starts_at,
    ends_at = v_end,
    total_duration_min = p_duration_min,
    duration_overridden = duration_overridden OR p_duration_min <> v_appt.total_duration_min,
    is_manual_fit = is_manual_fit OR jsonb_array_length(v_conflicts) > 0,
    updated_at = now()
  WHERE id = v_appt.id;

  INSERT INTO public.appointment_schedule_events (
    studio_id, appointment_id, actor_id, operation, overlap_confirmed,
    previous_state, next_state, conflict_snapshot
  ) VALUES (
    p_studio_id, v_appt.id, p_actor_id,
    CASE
      WHEN jsonb_array_length(v_conflicts) > 0 THEN 'manual_fit'
      WHEN p_operation = 'duration' THEN 'duration'
      ELSE 'move'
    END,
    COALESCE(p_confirm_overlap, false) AND jsonb_array_length(v_conflicts) > 0,
    jsonb_build_object('startsAt', v_appt.starts_at, 'endsAt', v_appt.ends_at, 'durationMin', v_appt.total_duration_min),
    jsonb_build_object('startsAt', p_starts_at, 'endsAt', v_end, 'durationMin', p_duration_min),
    v_conflicts
  );

  RETURN jsonb_build_object(
    'appointmentId', v_appt.id, 'startsAt', p_starts_at, 'endsAt', v_end,
    'durationMin', p_duration_min, 'overlapConfirmed', jsonb_array_length(v_conflicts) > 0,
    'changed', true, 'conflicts', v_conflicts
  );
END
$$;


ALTER FUNCTION "public"."move_studio_appointment"("p_studio_id" "uuid", "p_appointment_id" "uuid", "p_starts_at" timestamp with time zone, "p_duration_min" integer, "p_confirm_overlap" boolean, "p_actor_id" "uuid", "p_expected_conflict_ids" "uuid"[], "p_operation" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_customer_referral_code"("p_value" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  SELECT upper(regexp_replace(coalesce(trim(p_value), ''), '[^a-zA-Z0-9]', '', 'g'));
$$;


ALTER FUNCTION "public"."normalize_customer_referral_code"("p_value" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_trial_phone"("_value" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT nullif(regexp_replace(coalesce(_value, ''), '\D', '', 'g'), '')
$$;


ALTER FUNCTION "public"."normalize_trial_phone"("_value" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_trial_text"("_value" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT nullif(regexp_replace(lower(trim(coalesce(_value, ''))), '[^a-z0-9]+', '', 'g'), '')
$$;


ALTER FUNCTION "public"."normalize_trial_text"("_value" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notification_default_action_url"("p_kind" "text", "p_payload" "jsonb") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  select case
    when p_kind in ('new_appointment', 'appointment_rescheduled', 'appointment_cancelled')
      then '/admin/agenda'
    when p_kind in ('payment_confirmed', 'payment_failed', 'withdrawal_requested')
      then '/admin/recebimento'
    when p_kind in ('new_client', 'new_review')
      then '/admin/clientes'
    when p_kind = 'refund_request'
      then '/admin/politicas'
    else '/admin'
  end
$$;


ALTER FUNCTION "public"."notification_default_action_url"("p_kind" "text", "p_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_new_appointment"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_appointment public.appointments%ROWTYPE;
  v_client_name TEXT := 'Cliente';
  v_staff_name TEXT := 'Profissional';
  v_services TEXT := U&'Servi\00E7o';
  v_tz TEXT := 'Europe/Lisbon';
  v_when TEXT;
BEGIN
  SELECT *
  INTO v_appointment
  FROM public.appointments
  WHERE id = NEW.appointment_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.studio_notifications sn
    WHERE sn.kind = 'new_appointment'
      AND sn.payload->>'appointment_id' = v_appointment.id::text
  ) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(c.name, 'Cliente')
  INTO v_client_name
  FROM public.clients c
  WHERE c.id = v_appointment.client_id;

  SELECT COALESCE(s.name, 'Profissional')
  INTO v_staff_name
  FROM public.staff s
  WHERE s.id = v_appointment.staff_id;

  SELECT COALESCE(st.timezone, 'Europe/Lisbon')
  INTO v_tz
  FROM public.studios st
  WHERE st.id = v_appointment.studio_id;

  SELECT COALESCE(string_agg(sv.name, ', ' ORDER BY aps.id), U&'Servi\00E7o')
  INTO v_services
  FROM public.appointment_services aps
  JOIN public.services sv ON sv.id = aps.service_id
  WHERE aps.appointment_id = v_appointment.id;

  v_when := to_char(v_appointment.starts_at AT TIME ZONE v_tz, 'DD/MM/YYYY HH24:MI');

  PERFORM public.insert_studio_notification(
    v_appointment.studio_id,
    'new_appointment',
    U&'Nova marca\00E7\00E3o recebida',
    v_client_name || ' marcou ' || v_services || ' com ' || v_staff_name || ' para ' || v_when || '.',
    jsonb_build_object(
      'appointment_id', v_appointment.id,
      'client_name', v_client_name,
      'staff_name', v_staff_name,
      'services', v_services,
      'starts_at', v_appointment.starts_at,
      'ends_at', v_appointment.ends_at,
      'total_price', v_appointment.total_price
    )
  );

  RETURN NEW;
END $$;


ALTER FUNCTION "public"."notify_new_appointment"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_payment_confirmed"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_studio_id UUID;
  v_appointment_id UUID;
  v_total_price NUMERIC(10,2);
  v_deposit_percent NUMERIC(5,2) := 0;
  v_client_name TEXT := 'Cliente';
  v_staff_name TEXT := 'Profissional';
  v_services TEXT := 'Serviço';
  v_paid_amount NUMERIC(10,2);
  v_payment_label TEXT;
BEGIN
  IF NEW.status <> 'succeeded' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND COALESCE(OLD.status, '') = 'succeeded'
     AND OLD.appointment_id IS NOT DISTINCT FROM NEW.appointment_id THEN
    RETURN NEW;
  END IF;

  v_studio_id := NEW.studio_id;
  v_appointment_id := NEW.appointment_id;
  v_paid_amount := COALESCE(NEW.amount_cents, 0)::numeric / 100;

  IF v_appointment_id IS NULL AND NEW.booking_request_id IS NOT NULL THEN
    SELECT bpr.appointment_id, bpr.total_price, bpr.client_name, COALESCE(st.name, 'Profissional'), COALESCE(string_agg(sv.name, ', ' ORDER BY sv.name), 'Serviço')
    INTO v_appointment_id, v_total_price, v_client_name, v_staff_name, v_services
    FROM public.booking_payment_requests bpr
    LEFT JOIN public.staff st ON st.id = bpr.staff_id
    LEFT JOIN public.services sv ON sv.id = ANY(bpr.service_ids)
    WHERE bpr.id = NEW.booking_request_id
    GROUP BY bpr.appointment_id, bpr.total_price, bpr.client_name, st.name;
  END IF;

  IF v_appointment_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT a.total_price, COALESCE(c.name, 'Cliente'), COALESCE(stf.name, 'Profissional'), COALESCE(string_agg(sv.name, ', ' ORDER BY aps.id), 'Serviço')
  INTO v_total_price, v_client_name, v_staff_name, v_services
  FROM public.appointments a
  LEFT JOIN public.clients c ON c.id = a.client_id
  LEFT JOIN public.staff stf ON stf.id = a.staff_id
  LEFT JOIN public.appointment_services aps ON aps.appointment_id = a.id
  LEFT JOIN public.services sv ON sv.id = aps.service_id
  WHERE a.id = v_appointment_id
  GROUP BY a.total_price, c.name, stf.name;

  SELECT COALESCE(deposit_percent, 0)
  INTO v_deposit_percent
  FROM public.studios
  WHERE id = v_studio_id;

  v_payment_label := CASE
    WHEN v_total_price IS NOT NULL AND v_paid_amount >= v_total_price THEN 'Pagamento completo confirmado'
    WHEN v_deposit_percent >= 100 THEN 'Pagamento completo confirmado'
    ELSE 'Sinal confirmado'
  END;

  IF EXISTS (
    SELECT 1
    FROM public.studio_notifications sn
    WHERE sn.kind = 'payment_confirmed'
      AND sn.payload->>'payment_intent_id' = NEW.id::text
  ) THEN
    RETURN NEW;
  END IF;

  PERFORM public.insert_studio_notification(
    v_studio_id,
    'payment_confirmed',
    v_payment_label,
    v_client_name || ' pagou ' || to_char(v_paid_amount, 'FM999999990D00') || ' € online para ' || v_services || '.',
    jsonb_build_object(
      'appointment_id', v_appointment_id,
      'booking_request_id', NEW.booking_request_id,
      'payment_intent_id', NEW.id,
      'client_name', v_client_name,
      'staff_name', v_staff_name,
      'services', v_services,
      'paid_amount', v_paid_amount,
      'total_price', v_total_price,
      'payment_type', CASE WHEN v_total_price IS NOT NULL AND v_paid_amount >= v_total_price THEN 'full' ELSE 'deposit' END
    )
  );

  RETURN NEW;
END $$;


ALTER FUNCTION "public"."notify_payment_confirmed"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_payment_problem"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_studio_id UUID;
  v_client_name TEXT := 'Cliente';
  v_services TEXT := 'Serviço';
  v_amount NUMERIC(10,2);
BEGIN
  IF NEW.status NOT IN ('failed','canceled','expired') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND COALESCE(OLD.status, '') = NEW.status THEN
    RETURN NEW;
  END IF;

  v_studio_id := NEW.studio_id;
  v_amount := COALESCE(NEW.amount_cents, 0)::numeric / 100;

  IF NEW.booking_request_id IS NOT NULL THEN
    SELECT COALESCE(bpr.client_name, 'Cliente'), COALESCE(string_agg(sv.name, ', ' ORDER BY sv.name), 'Serviço')
    INTO v_client_name, v_services
    FROM public.booking_payment_requests bpr
    LEFT JOIN public.services sv ON sv.id = ANY(bpr.service_ids)
    WHERE bpr.id = NEW.booking_request_id
    GROUP BY bpr.client_name;
  ELSIF NEW.appointment_id IS NOT NULL THEN
    SELECT COALESCE(c.name, 'Cliente'), COALESCE(string_agg(sv.name, ', ' ORDER BY aps.id), 'Serviço')
    INTO v_client_name, v_services
    FROM public.appointments a
    LEFT JOIN public.clients c ON c.id = a.client_id
    LEFT JOIN public.appointment_services aps ON aps.appointment_id = a.id
    LEFT JOIN public.services sv ON sv.id = aps.service_id
    WHERE a.id = NEW.appointment_id
    GROUP BY c.name;
  END IF;

  PERFORM public.insert_studio_notification(
    v_studio_id,
    'payment_failed',
    'Pagamento não concluído',
    v_client_name || ' não concluiu o pagamento de ' || to_char(v_amount, 'FM999999990D00') || ' € para ' || v_services || '.',
    jsonb_build_object(
      'appointment_id', NEW.appointment_id,
      'booking_request_id', NEW.booking_request_id,
      'payment_intent_id', NEW.id,
      'status', NEW.status,
      'failure_reason', NEW.failure_reason
    )
  );

  RETURN NEW;
END $$;


ALTER FUNCTION "public"."notify_payment_problem"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_refund_request_created"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  perform public.insert_studio_notification(
    new.studio_id,
    'refund_request',
    'Novo pedido de reembolso',
    coalesce(nullif(trim(new.client_name), ''), 'Cliente') ||
      ' enviou um pedido de reembolso para análise.',
    jsonb_build_object(
      'refund_request_id', new.id,
      'appointment_id', new.appointment_id,
      'booking_request_id', new.booking_request_id,
      'payment_intent_id', new.payment_intent_id,
      'client_name', new.client_name,
      'event_key', 'refund:' || new.id::text || ':created',
      'action_url', '/admin/politicas'
    )
  );
  return new;
end
$$;


ALTER FUNCTION "public"."notify_refund_request_created"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_studio_appointment_lifecycle"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_client_name text := 'Cliente';
  v_tz text := 'Europe/Lisbon';
  v_when text;
begin
  if coalesce(new.notification_suppressed, false) then
    return new;
  end if;

  select coalesce(c.name, 'Cliente') into v_client_name
  from public.clients c where c.id = new.client_id;
  select coalesce(timezone, 'Europe/Lisbon') into v_tz
  from public.studios where id = new.studio_id;
  v_when := to_char(new.starts_at at time zone v_tz, 'DD/MM/YYYY HH24:MI');

  if tg_op = 'INSERT' then
    perform public.insert_studio_notification(
      new.studio_id,
      'new_appointment',
      'Nova marcação recebida',
      v_client_name || ' realizou uma marcação para ' || v_when || '.',
      jsonb_build_object(
        'appointment_id', new.id,
        'client_id', new.client_id,
        'starts_at', new.starts_at,
        'event_key', 'new_appointment:' || new.id::text,
        'action_url', '/admin/agenda'
      )
    );
  elsif new.status = 'cancelled' and old.status is distinct from new.status then
    perform public.insert_studio_notification(
      new.studio_id,
      'appointment_cancelled',
      'Marcação cancelada',
      v_client_name || ' cancelou a marcação de ' || v_when || '.',
      jsonb_build_object(
        'appointment_id', new.id,
        'client_id', new.client_id,
        'status', new.status,
        'event_key', 'appointment:' || new.id::text || ':cancelled',
        'action_url', '/admin/agenda'
      )
    );
  elsif old.starts_at is distinct from new.starts_at
     or old.ends_at is distinct from new.ends_at
     or old.staff_id is distinct from new.staff_id then
    perform public.insert_studio_notification(
      new.studio_id,
      'appointment_rescheduled',
      'Marcação remarcada',
      v_client_name || ' remarcou para ' || v_when || '.',
      jsonb_build_object(
        'appointment_id', new.id,
        'client_id', new.client_id,
        'starts_at', new.starts_at,
        'staff_id', new.staff_id,
        'event_key', 'appointment:' || new.id::text || ':rescheduled:' ||
          extract(epoch from new.starts_at)::bigint::text || ':' || coalesce(new.staff_id::text, 'none'),
        'action_url', '/admin/agenda'
      )
    );
  end if;

  return new;
end
$$;


ALTER FUNCTION "public"."notify_studio_appointment_lifecycle"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_studio_new_client"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  perform public.insert_studio_notification(
    new.studio_id,
    'new_client',
    'Novo cliente cadastrado',
    coalesce(nullif(trim(new.name), ''), 'Um novo cliente') || ' foi adicionado ao estúdio.',
    jsonb_build_object(
      'client_id', new.id,
      'event_key', 'client:' || new.id::text || ':created',
      'action_url', '/admin/clientes'
    )
  );
  return new;
end
$$;


ALTER FUNCTION "public"."notify_studio_new_client"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_studio_new_review"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  perform public.insert_studio_notification(
    new.studio_id,
    'new_review',
    'Nova avaliação recebida',
    coalesce(nullif(trim(new.reviewer_name), ''), 'Um cliente') ||
      ' deixou uma avaliação de ' || new.rating::text || ' estrelas.',
    jsonb_build_object(
      'review_id', new.id,
      'appointment_id', new.appointment_id,
      'rating', new.rating,
      'event_key', 'review:' || new.id::text || ':created',
      'action_url', '/admin/clientes'
    )
  );
  return new;
end
$$;


ALTER FUNCTION "public"."notify_studio_new_review"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_studio_payment_lifecycle"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_kind text;
  v_title text;
  v_body text;
  v_amount numeric := coalesce(new.amount_cents, 0)::numeric / 100;
begin
  if new.status not in ('succeeded', 'failed', 'canceled', 'expired') then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;

  if new.status = 'succeeded' then
    v_kind := 'payment_confirmed';
    v_title := 'Pagamento aprovado';
    v_body := 'Foi aprovado um pagamento de ' ||
      to_char(v_amount, 'FM999999990D00') || ' €.';
  else
    v_kind := 'payment_failed';
    v_title := case when new.status = 'expired'
      then 'Pagamento expirado'
      else 'Pagamento não concluído'
    end;
    v_body := 'O pagamento de ' ||
      to_char(v_amount, 'FM999999990D00') || ' € ficou com estado ' || new.status || '.';
  end if;

  perform public.insert_studio_notification(
    new.studio_id,
    v_kind,
    v_title,
    v_body,
    jsonb_build_object(
      'payment_intent_id', new.id,
      'appointment_id', new.appointment_id,
      'booking_request_id', new.booking_request_id,
      'status', new.status,
      'amount_cents', new.amount_cents,
      'event_key', 'payment:' || new.id::text || ':' || new.status,
      'action_url', '/admin/recebimento'
    )
  );
  return new;
end
$$;


ALTER FUNCTION "public"."notify_studio_payment_lifecycle"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."open_cash_register"("p_studio_id" "uuid", "p_opening_amount" numeric DEFAULT 0) RETURNS "public"."cash_register_sessions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_session public.cash_register_sessions%ROWTYPE;
BEGIN
  IF NOT public.is_studio_member(auth.uid(), p_studio_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF COALESCE(p_opening_amount, 0) < 0 THEN
    RAISE EXCEPTION 'invalid_opening_amount';
  END IF;

  INSERT INTO public.cash_register_sessions (studio_id, opening_amount, opened_by)
  VALUES (p_studio_id, COALESCE(p_opening_amount, 0), auth.uid())
  RETURNING * INTO v_session;

  RETURN v_session;
EXCEPTION
  WHEN unique_violation THEN RAISE EXCEPTION 'cash_register_already_open';
END;
$$;


ALTER FUNCTION "public"."open_cash_register"("p_studio_id" "uuid", "p_opening_amount" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."preserve_cancel_at_period_end"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF OLD.cancel_at_period_end = true AND NEW.cancel_at_period_end = false THEN
    NEW.cancel_at_period_end := true;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."preserve_cancel_at_period_end"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."preserve_studio_cancel_at_period_end"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF OLD.subscription_cancel_at_period_end = true AND NEW.subscription_cancel_at_period_end = false THEN
    NEW.subscription_cancel_at_period_end := true;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."preserve_studio_cancel_at_period_end"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."preview_studio_schedule_change"("p_studio_id" "uuid", "p_staff_id" "uuid", "p_starts_at" timestamp with time zone, "p_duration_min" integer, "p_ignore_appointment_ids" "uuid"[] DEFAULT ARRAY[]::"uuid"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_ends_at timestamptz;
  v_conflicts jsonb;
  v_blocks jsonb;
  v_holds jsonb;
  v_staff_available boolean;
  v_within_availability boolean;
  v_timezone text;
  v_local_start timestamp;
  v_local_end timestamp;
BEGIN
  IF p_studio_id IS NULL OR p_staff_id IS NULL OR p_starts_at IS NULL
     OR p_duration_min IS NULL OR p_duration_min < 5 OR p_duration_min > 720 THEN
    RAISE EXCEPTION 'invalid_schedule_change';
  END IF;
  v_ends_at := p_starts_at + make_interval(mins => p_duration_min);
  SELECT COALESCE(NULLIF(timezone, ''), 'Europe/Lisbon') INTO v_timezone
  FROM public.studios WHERE id = p_studio_id;
  v_local_start := p_starts_at AT TIME ZONE COALESCE(v_timezone, 'Europe/Lisbon');
  v_local_end := v_ends_at AT TIME ZONE COALESCE(v_timezone, 'Europe/Lisbon');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'appointmentId', conflict.id,
    'clientName', COALESCE(client.name, 'Cliente'),
    'professionalName', COALESCE(professional.name, 'Profissional'),
    'serviceName', COALESCE(service_names.names, 'Serviço'),
    'startsAt', conflict.starts_at,
    'endsAt', conflict.ends_at,
    'overlapStartsAt', GREATEST(conflict.starts_at, p_starts_at),
    'overlapEndsAt', LEAST(conflict.ends_at, v_ends_at)
  ) ORDER BY conflict.starts_at), '[]'::jsonb)
  INTO v_conflicts
  FROM public.appointments AS conflict
  LEFT JOIN public.clients AS client ON client.id = conflict.client_id
  LEFT JOIN public.staff AS professional ON professional.id = conflict.staff_id
  LEFT JOIN LATERAL (
    SELECT string_agg(service.name, ', ' ORDER BY line.id) AS names
    FROM public.appointment_services AS line
    JOIN public.services AS service ON service.id = line.service_id
    WHERE line.appointment_id = conflict.id
  ) AS service_names ON true
  WHERE conflict.studio_id = p_studio_id
    AND conflict.staff_id = p_staff_id
    AND conflict.status::text NOT IN ('cancelled', 'canceled', 'no_show')
    AND NOT (conflict.id = ANY(COALESCE(p_ignore_appointment_ids, ARRAY[]::uuid[])))
    AND tstzrange(conflict.starts_at, conflict.ends_at, '[)') && tstzrange(p_starts_at, v_ends_at, '[)');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'blockId', block.id,
    'reason', block.reason,
    'startsAt', block.starts_at,
    'endsAt', block.ends_at
  ) ORDER BY block.starts_at), '[]'::jsonb)
  INTO v_blocks
  FROM public.staff_time_off AS block
  WHERE block.studio_id = p_studio_id
    AND block.staff_id = p_staff_id
    AND tstzrange(block.starts_at, block.ends_at, '[)') && tstzrange(p_starts_at, v_ends_at, '[)');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'requestId', hold.id,
    'startsAt', hold.starts_at,
    'endsAt', hold.ends_at,
    'status', hold.status
  ) ORDER BY hold.starts_at), '[]'::jsonb)
  INTO v_holds
  FROM public.booking_payment_requests AS hold
  WHERE hold.studio_id = p_studio_id
    AND hold.staff_id = p_staff_id
    AND hold.status IN ('awaiting_payment', 'processing', 'paid')
    AND hold.expires_at > now()
    AND tstzrange(hold.starts_at, hold.ends_at, '[)') && tstzrange(p_starts_at, v_ends_at, '[)');

  SELECT EXISTS (
    SELECT 1 FROM public.staff
    WHERE id = p_staff_id AND studio_id = p_studio_id AND is_active = true
      AND COALESCE(current_status, 'online') <> 'absent'
  ) INTO v_staff_available;

  SELECT EXISTS (
    SELECT 1 FROM public.staff_availability AS availability
    WHERE availability.studio_id = p_studio_id
      AND availability.staff_id = p_staff_id
      AND availability.weekday = EXTRACT(DOW FROM v_local_start)::integer
      AND availability.start_time <= v_local_start::time
      AND availability.end_time >= v_local_end::time
  ) INTO v_within_availability;

  RETURN jsonb_build_object(
    'startsAt', p_starts_at,
    'endsAt', v_ends_at,
    'durationMin', p_duration_min,
    'conflicts', v_conflicts,
    'blocks', v_blocks,
    'paymentHolds', v_holds,
    'staffAvailable', v_staff_available,
    'withinAvailability', v_within_availability,
    'hasConflict', jsonb_array_length(v_conflicts) > 0,
    'hardBlocked', NOT v_staff_available OR jsonb_array_length(v_blocks) > 0 OR jsonb_array_length(v_holds) > 0,
    'canOverride', v_staff_available AND jsonb_array_length(v_blocks) = 0
      AND jsonb_array_length(v_holds) = 0 AND jsonb_array_length(v_conflicts) > 0
  );
END
$$;


ALTER FUNCTION "public"."preview_studio_schedule_change"("p_studio_id" "uuid", "p_staff_id" "uuid", "p_starts_at" timestamp with time zone, "p_duration_min" integer, "p_ignore_appointment_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_customer_loyalty_for_completed_appointment"("p_appointment_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_appt public.appointments%ROWTYPE;
  v_settings public.customer_loyalty_settings%ROWTYPE;
  v_paid_cents integer := 0;
  v_cash_amount numeric := 0;
  v_ref public.customer_referrals%ROWTYPE;
BEGIN
  SELECT * INTO v_appt
  FROM public.appointments
  WHERE id = p_appointment_id;

  IF NOT FOUND OR v_appt.status <> 'completed' THEN
    RETURN;
  END IF;

  v_settings := public.ensure_customer_loyalty_settings(v_appt.studio_id);
  IF NOT v_settings.enabled THEN
    RETURN;
  END IF;

  SELECT COALESCE(sum(amount_cents), 0)::integer
  INTO v_paid_cents
  FROM public.payment_intents
  WHERE appointment_id = v_appt.id
    AND status = 'succeeded';

  SELECT COALESCE(sum(amount), 0)
  INTO v_cash_amount
  FROM public.cash_register_movements
  WHERE appointment_id = v_appt.id
    AND studio_id = v_appt.studio_id
    AND movement_type = 'service_payment';

  IF v_appt.total_price > 0 AND (v_paid_cents <= 0 AND COALESCE(v_cash_amount, 0) <= 0) THEN
    RETURN;
  END IF;

  IF v_settings.booking_stamps_enabled AND v_settings.stamps_per_completed_booking > 0 THEN
    INSERT INTO public.customer_loyalty_stamp_entries (
      studio_id,
      client_id,
      source_type,
      source_appointment_id,
      stamps,
      note
    )
    VALUES (
      v_appt.studio_id,
      v_appt.client_id,
      'booking_completed',
      v_appt.id,
      v_settings.stamps_per_completed_booking,
      'Reserva concluida'
    )
    ON CONFLICT DO NOTHING;
  END IF;

  FOR v_ref IN
    SELECT *
    FROM public.customer_referrals
    WHERE studio_id = v_appt.studio_id
      AND (
        appointment_id = v_appt.id
        OR booking_request_id IN (
          SELECT id
          FROM public.booking_payment_requests
          WHERE appointment_id = v_appt.id
        )
      )
      AND status = 'pending_completion'
    FOR UPDATE
  LOOP
    IF v_ref.referred_client_was_existing THEN
      UPDATE public.customer_referrals
      SET status = 'rejected',
          rejection_reason = 'existing_client',
          updated_at = now()
      WHERE id = v_ref.id;
      CONTINUE;
    END IF;

    IF v_ref.referrer_client_id = v_appt.client_id THEN
      UPDATE public.customer_referrals
      SET status = 'rejected',
          rejection_reason = 'self_referral',
          referred_client_id = v_appt.client_id,
          appointment_id = v_appt.id,
          updated_at = now()
      WHERE id = v_ref.id;
      CONTINUE;
    END IF;

    UPDATE public.customer_referrals
    SET status = 'completed',
        referred_client_id = COALESCE(referred_client_id, v_appt.client_id),
        appointment_id = v_appt.id,
        completed_at = now(),
        updated_at = now()
    WHERE id = v_ref.id;

    IF v_settings.referral_stamps_enabled AND v_settings.stamps_per_completed_referral > 0 THEN
      INSERT INTO public.customer_loyalty_stamp_entries (
        studio_id,
        client_id,
        source_type,
        source_customer_referral_id,
        stamps,
        note
      )
      VALUES (
        v_appt.studio_id,
        v_ref.referrer_client_id,
        'referral_completed',
        v_ref.id,
        v_settings.stamps_per_completed_referral,
        'Indicacao concluida'
      )
      ON CONFLICT DO NOTHING;

      PERFORM public.issue_customer_loyalty_rewards(v_appt.studio_id, v_ref.referrer_client_id);
    END IF;
  END LOOP;

  PERFORM public.issue_customer_loyalty_rewards(v_appt.studio_id, v_appt.client_id);
END;
$$;


ALTER FUNCTION "public"."process_customer_loyalty_for_completed_appointment"("p_appointment_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."quote_public_booking"("p_studio_slug" "text", "p_service_ids" "uuid"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_studio_id uuid;
  v_lines jsonb;
  v_total_price numeric(10,2);
  v_total_duration integer;
BEGIN
  IF array_length(p_service_ids, 1) IS NULL OR array_length(p_service_ids, 1) > 12 THEN
    RAISE EXCEPTION 'invalid_services';
  END IF;

  SELECT studio.id INTO v_studio_id
  FROM public.studios AS studio
  WHERE studio.slug = p_studio_slug
    AND studio.is_active = true
    AND public.studio_has_entitlement(studio.id, 'online_booking');
  IF v_studio_id IS NULL THEN RAISE EXCEPTION 'studio_not_available'; END IF;

  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'service_id', priced.service_id,
          'price', round(priced.price, 2),
          'duration_min', priced.duration_min,
          'is_upsell', priced.is_upsell
        ) ORDER BY priced.position
      ),
      '[]'::jsonb
    ),
    COALESCE(sum(priced.price), 0)::numeric(10,2),
    COALESCE(sum(priced.duration_min), 0)::integer
  INTO v_lines, v_total_price, v_total_duration
  FROM (
    SELECT
      array_position(p_service_ids, resolved.service_id)::integer AS position,
      resolved.*
    FROM public.resolve_booking_service_pricing(v_studio_id, p_service_ids) AS resolved
  ) AS priced;

  IF jsonb_array_length(v_lines) <> array_length(p_service_ids, 1) OR v_total_duration <= 0 THEN
    RAISE EXCEPTION 'invalid_services';
  END IF;

  RETURN jsonb_build_object(
    'studio_id', v_studio_id,
    'total_price', v_total_price,
    'total_duration_min', v_total_duration,
    'lines', v_lines
  );
END;
$$;


ALTER FUNCTION "public"."quote_public_booking"("p_studio_slug" "text", "p_service_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."raise_client_booking_block_if_needed"("p_studio_id" "uuid", "p_client_phone" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_client public.clients%ROWTYPE;
  v_phone TEXT := regexp_replace(trim(coalesce(p_client_phone, '')), '\D', '', 'g');
BEGIN
  IF v_phone = '' THEN
    RETURN;
  END IF;

  SELECT *
  INTO v_client
  FROM public.clients
  WHERE studio_id = p_studio_id
    AND regexp_replace(phone, '\D', '', 'g') = v_phone
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_client.booking_status = 'suspended'
     AND v_client.suspended_until IS NOT NULL
     AND v_client.suspended_until < current_date THEN
    UPDATE public.clients
    SET booking_status = 'active',
        suspended_until = NULL,
        updated_at = now()
    WHERE id = v_client.id;
    RETURN;
  END IF;

  IF v_client.booking_status = 'blocked' THEN
    RAISE EXCEPTION 'client_blocked';
  END IF;

  IF v_client.booking_status = 'suspended'
     AND (v_client.suspended_until IS NULL OR v_client.suspended_until >= current_date) THEN
    RAISE EXCEPTION 'client_suspended';
  END IF;
END $$;


ALTER FUNCTION "public"."raise_client_booking_block_if_needed"("p_studio_id" "uuid", "p_client_phone" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_customer_referral_intent"("p_studio_id" "uuid", "p_referral_code" "text", "p_booking_request_id" "uuid", "p_appointment_id" "uuid", "p_referred_client_id" "uuid", "p_referred_client_was_existing" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_code text := public.normalize_customer_referral_code(p_referral_code);
  v_referrer_client_id uuid;
  v_settings public.customer_loyalty_settings%ROWTYPE;
  v_status text := 'pending_completion';
  v_reason text := NULL;
BEGIN
  IF v_code = '' OR p_studio_id IS NULL THEN
    RETURN;
  END IF;

  SELECT referrer_client_id
  INTO v_referrer_client_id
  FROM public.customer_referral_codes
  WHERE studio_id = p_studio_id
    AND code = v_code;

  IF v_referrer_client_id IS NULL THEN
    RETURN;
  END IF;

  v_settings := public.ensure_customer_loyalty_settings(p_studio_id);
  IF NOT v_settings.enabled OR NOT v_settings.referral_stamps_enabled OR v_settings.stamps_per_completed_referral <= 0 THEN
    RETURN;
  END IF;

  IF p_referred_client_id IS NOT NULL AND v_referrer_client_id = p_referred_client_id THEN
    v_status := 'rejected';
    v_reason := 'self_referral';
  ELSIF p_referred_client_was_existing THEN
    v_status := 'rejected';
    v_reason := 'existing_client';
  END IF;

  INSERT INTO public.customer_referrals (
    studio_id,
    referrer_client_id,
    referred_client_id,
    booking_request_id,
    appointment_id,
    referral_code,
    status,
    rejection_reason,
    referred_client_was_existing
  )
  VALUES (
    p_studio_id,
    v_referrer_client_id,
    p_referred_client_id,
    p_booking_request_id,
    p_appointment_id,
    v_code,
    v_status,
    v_reason,
    COALESCE(p_referred_client_was_existing, false)
  )
  ON CONFLICT DO NOTHING;
END;
$$;


ALTER FUNCTION "public"."record_customer_referral_intent"("p_studio_id" "uuid", "p_referral_code" "text", "p_booking_request_id" "uuid", "p_appointment_id" "uuid", "p_referred_client_id" "uuid", "p_referred_client_was_existing" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_public_policy_acceptance"("p_studio_id" "uuid", "p_booking_request_id" "uuid", "p_appointment_id" "uuid", "p_policy_version" "text", "p_payload" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_id uuid;
  v_ok boolean := false;
  v_ip text;
begin
  if p_booking_request_id is not null then
    select exists (
      select 1 from public.booking_payment_requests
      where id = p_booking_request_id and studio_id = p_studio_id
    ) into v_ok;
  elsif p_appointment_id is not null then
    select exists (
      select 1 from public.appointments
      where id = p_appointment_id and studio_id = p_studio_id
    ) into v_ok;
  end if;

  if not v_ok then
    raise exception 'booking_not_found';
  end if;

  v_ip := coalesce(
    public.request_header('cf-connecting-ip'),
    split_part(coalesce(public.request_header('x-forwarded-for'), ''), ',', 1),
    public.request_header('x-real-ip')
  );

  insert into public.booking_policy_acceptances (
    studio_id,
    booking_request_id,
    appointment_id,
    policy_version,
    accepted_at,
    payment_timestamp,
    ip_address,
    user_agent,
    payload
  )
  values (
    p_studio_id,
    p_booking_request_id,
    p_appointment_id,
    coalesce(nullif(p_policy_version, ''), '2026-05-28'),
    now(),
    now(),
    nullif(trim(coalesce(v_ip, '')), ''),
    public.request_header('user-agent'),
    coalesce(p_payload, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;


ALTER FUNCTION "public"."record_public_policy_acceptance"("p_studio_id" "uuid", "p_booking_request_id" "uuid", "p_appointment_id" "uuid", "p_policy_version" "text", "p_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_studio_plan_event"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.plan_tier IS NOT DISTINCT FROM OLD.plan_tier
    AND NEW.subscription_status IS NOT DISTINCT FROM OLD.subscription_status
    AND NEW.subscription_current_period_end IS NOT DISTINCT FROM OLD.subscription_current_period_end
    AND NEW.subscription_cancel_at_period_end IS NOT DISTINCT FROM OLD.subscription_cancel_at_period_end
    AND NEW.trial_ends_at IS NOT DISTINCT FROM OLD.trial_ends_at THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.studio_plan_events (
    studio_id, previous_tier, new_tier, previous_status, new_status, reason, metadata
  ) VALUES (
    NEW.id,
    OLD.plan_tier,
    NEW.plan_tier,
    OLD.subscription_status,
    NEW.subscription_status,
    CASE
      WHEN OLD.trial_ends_at IS DISTINCT FROM NEW.trial_ends_at THEN 'trial_changed'
      WHEN OLD.subscription_cancel_at_period_end IS DISTINCT FROM NEW.subscription_cancel_at_period_end THEN 'cancellation_changed'
      ELSE 'subscription_sync'
    END,
    jsonb_build_object(
      'previous_period_end', OLD.subscription_current_period_end,
      'new_period_end', NEW.subscription_current_period_end,
      'cancel_at_period_end', NEW.subscription_cancel_at_period_end
    )
  );
  RETURN NEW;
END
$$;


ALTER FUNCTION "public"."record_studio_plan_event"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_upsell_acceptances_for_services"("p_studio_id" "uuid", "p_service_ids" "uuid"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF p_service_ids IS NULL OR array_length(p_service_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  WITH accepted AS (
    SELECT offer_id, price
    FROM public.resolve_booking_service_pricing(p_studio_id, p_service_ids)
    WHERE offer_id IS NOT NULL
  )
  UPDATE public.upsell_offers u
  SET conversions_count = u.conversions_count + 1,
      views_count = GREATEST(u.views_count, u.conversions_count + 1),
      extra_revenue = u.extra_revenue + accepted.price
  FROM accepted
  WHERE u.id = accepted.offer_id
    AND u.is_active = true;
END;
$$;


ALTER FUNCTION "public"."record_upsell_acceptances_for_services"("p_studio_id" "uuid", "p_service_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_reassigned_appointment_line_commissions"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- A future/active appointment reassigned to another professional must use
  -- that professional's rule. Closed history remains immutable.
  IF NEW.staff_id IS DISTINCT FROM OLD.staff_id
     AND NEW.status NOT IN ('completed', 'cancelled', 'no_show') THEN
    UPDATE public.appointment_services aps
    SET studio_commission_percent_snapshot = COALESCE(
      svc.commission_percent,
      NEW.studio_commission_percent_snapshot,
      0
    )
    FROM public.services svc
    WHERE aps.appointment_id = NEW.id
      AND svc.id = aps.service_id;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."refresh_reassigned_appointment_line_commissions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_studio_rating"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_studio_id UUID;
BEGIN
  v_studio_id := COALESCE(NEW.studio_id, OLD.studio_id);

  UPDATE public.studios
  SET
    rating        = (SELECT ROUND(AVG(rating)::numeric, 1) FROM public.studio_reviews WHERE studio_id = v_studio_id),
    reviews_count = (SELECT COUNT(*) FROM public.studio_reviews WHERE studio_id = v_studio_id)
  WHERE id = v_studio_id;

  UPDATE public.staff s
  SET
    rating = (
      SELECT ROUND(AVG(r.rating)::numeric, 1)
      FROM public.studio_reviews r
      WHERE r.studio_id = v_studio_id AND s.id = ANY(r.staff_ids)
    ),
    reviews_count = (
      SELECT COUNT(*)
      FROM public.studio_reviews r
      WHERE r.studio_id = v_studio_id AND s.id = ANY(r.staff_ids)
    )
  WHERE s.studio_id = v_studio_id
    AND (
      (TG_OP = 'INSERT' AND s.id = ANY(NEW.staff_ids))
   OR (TG_OP = 'DELETE' AND s.id = ANY(OLD.staff_ids))
   OR (TG_OP = 'UPDATE' AND (s.id = ANY(NEW.staff_ids) OR s.id = ANY(OLD.staff_ids)))
    );

  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."refresh_studio_rating"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."remove_or_archive_service"("p_studio_id" "uuid", "p_service_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_has_history boolean;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_role(auth.uid(), p_studio_id, 'studio_owner') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- The tenant predicate is part of the lookup so a caller cannot use this
  -- function to discover or mutate a service belonging to another studio.
  PERFORM 1
  FROM public.services
  WHERE id = p_service_id
    AND studio_id = p_studio_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'service_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT
    EXISTS (
      SELECT 1
      FROM public.appointment_services
      WHERE service_id = p_service_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.manual_service_entries
      WHERE service_id = p_service_id
    )
  INTO v_has_history;

  IF v_has_history THEN
    UPDATE public.services
    SET is_active = false,
        is_recommended = false
    WHERE id = p_service_id
      AND studio_id = p_studio_id;

    UPDATE public.upsell_offers
    SET is_active = false
    WHERE studio_id = p_studio_id
      AND (trigger_service_id = p_service_id OR offered_service_id = p_service_id);

    RETURN 'archived';
  END IF;

  -- If another historical relation is introduced now or a concurrent insert
  -- wins the race, the FK remains the final safety net and we archive instead.
  BEGIN
    DELETE FROM public.services
    WHERE id = p_service_id
      AND studio_id = p_studio_id;

    RETURN 'deleted';
  EXCEPTION
    WHEN foreign_key_violation THEN
      UPDATE public.services
      SET is_active = false,
          is_recommended = false
      WHERE id = p_service_id
        AND studio_id = p_studio_id;

      UPDATE public.upsell_offers
      SET is_active = false
      WHERE studio_id = p_studio_id
        AND (trigger_service_id = p_service_id OR offered_service_id = p_service_id);

      RETURN 'archived';
  END;
END;
$$;


ALTER FUNCTION "public"."remove_or_archive_service"("p_studio_id" "uuid", "p_service_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."remove_or_archive_service"("p_studio_id" "uuid", "p_service_id" "uuid") IS 'Deletes an unused service or archives it when historical references must be preserved.';



CREATE OR REPLACE FUNCTION "public"."request_header"("header_name" "text") RETURNS "text"
    LANGUAGE "plpgsql" STABLE
    AS $$
declare
  headers jsonb;
begin
  begin
    headers := current_setting('request.headers', true)::jsonb;
  exception when others then
    return null;
  end;
  return headers ->> lower(header_name);
end;
$$;


ALTER FUNCTION "public"."request_header"("header_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reschedule_public_appointment"("p_public_token" "text", "p_staff_id" "uuid", "p_starts_at" timestamp with time zone) RETURNS TABLE("appointment_id" "uuid", "starts_at" timestamp with time zone, "ends_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_appt record;
  v_duration integer;
  v_new_end timestamptz;
  v_min_booking_notice_min integer;
BEGIN
  IF length(trim(coalesce(p_public_token, ''))) < 16 THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;
  IF p_staff_id IS NULL OR p_starts_at IS NULL THEN
    RAISE EXCEPTION 'invalid_reschedule_datetime';
  END IF;

  SELECT
    a.id,
    a.public_token,
    a.studio_id,
    a.status,
    a.starts_at,
    a.ends_at,
    a.total_duration_min,
    COALESCE(s.min_booking_notice_min, 30) AS min_booking_notice_min
  INTO v_appt
  FROM public.appointments AS a
  JOIN public.studios AS s ON s.id = a.studio_id
  WHERE a.public_token = p_public_token
    AND s.is_active = true
    AND public.has_active_premium_access(s.id)
  FOR UPDATE OF a;

  IF v_appt.id IS NULL THEN
    RAISE EXCEPTION 'appointment_not_found';
  END IF;
  IF v_appt.status IN ('cancelled', 'no_show', 'completed') THEN
    RAISE EXCEPTION 'appointment_not_reschedulable';
  END IF;

  v_min_booking_notice_min := GREATEST(v_appt.min_booking_notice_min, 0);
  IF p_starts_at < now() + (v_min_booking_notice_min || ' minutes')::interval THEN
    RAISE EXCEPTION 'slot_unavailable';
  END IF;

  SELECT COALESCE(SUM(aps.duration_min), 0)::integer
  INTO v_duration
  FROM public.appointment_services AS aps
  WHERE aps.appointment_id = v_appt.id;

  v_duration := COALESCE(
    NULLIF(v_appt.total_duration_min, 0),
    NULLIF(v_duration, 0),
    GREATEST(
      15,
      CEIL(EXTRACT(EPOCH FROM (v_appt.ends_at - v_appt.starts_at)) / 60)::integer
    )
  );
  v_new_end := p_starts_at + make_interval(mins => v_duration);

  UPDATE public.appointments AS target
  SET
    staff_id = p_staff_id,
    starts_at = p_starts_at,
    ends_at = v_new_end,
    status = 'confirmed',
    updated_at = now()
  WHERE target.id = v_appt.id
    AND public.is_staff_slot_bookable(
      v_appt.studio_id,
      p_staff_id,
      p_starts_at,
      v_duration,
      NULL,
      v_appt.id
    )
  RETURNING target.id, target.starts_at, target.ends_at
  INTO appointment_id, starts_at, ends_at;

  IF appointment_id IS NULL THEN
    RAISE EXCEPTION 'slot_unavailable';
  END IF;

  RETURN NEXT;
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'slot_unavailable';
END
$$;


ALTER FUNCTION "public"."reschedule_public_appointment"("p_public_token" "text", "p_staff_id" "uuid", "p_starts_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reschedule_studio_appointment"("p_appointment_id" "uuid", "p_studio_id" "uuid", "p_local_date" "date", "p_local_time" time without time zone) RETURNS TABLE("appointment_id" "uuid", "starts_at" timestamp with time zone, "ends_at" timestamp with time zone, "rescheduled" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_appt public.appointments%ROWTYPE;
  v_tz text;
  v_start timestamptz;
  v_duration integer;
  v_result jsonb;
BEGIN
  SELECT appointment.*
  INTO v_appt FROM public.appointments AS appointment
  WHERE appointment.id = p_appointment_id AND appointment.studio_id = p_studio_id;
  IF v_appt.id IS NULL THEN RAISE EXCEPTION 'appointment_not_found'; END IF;
  SELECT COALESCE(NULLIF(timezone, ''), 'Europe/Lisbon') INTO v_tz FROM public.studios WHERE id = p_studio_id;
  v_start := (p_local_date::timestamp + p_local_time) AT TIME ZONE v_tz;
  v_duration := GREATEST(5, COALESCE(v_appt.total_duration_min,
    CEIL(EXTRACT(EPOCH FROM (v_appt.ends_at - v_appt.starts_at)) / 60)::integer));
  IF abs(EXTRACT(EPOCH FROM (v_start - v_appt.starts_at))) < 60 THEN
    RETURN QUERY SELECT v_appt.id, v_appt.starts_at, v_appt.ends_at, false;
    RETURN;
  END IF;
  v_result := public.move_studio_appointment(
    p_studio_id, p_appointment_id, v_start, v_duration, false, auth.uid(), ARRAY[]::uuid[], 'move'
  );
  RETURN QUERY SELECT
    (v_result->>'appointmentId')::uuid,
    (v_result->>'startsAt')::timestamptz,
    (v_result->>'endsAt')::timestamptz,
    COALESCE((v_result->>'changed')::boolean, true);
END
$$;


ALTER FUNCTION "public"."reschedule_studio_appointment"("p_appointment_id" "uuid", "p_studio_id" "uuid", "p_local_date" "date", "p_local_time" time without time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reserve_whatsapp_usage"("p_studio_id" "uuid", "p_idempotency_key" "text", "p_message_kind" "text" DEFAULT 'confirmation'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_settings public.whatsapp_platform_settings%ROWTYPE;
  v_entitlement public.whatsapp_studio_entitlements%ROWTYPE;
  v_existing public.whatsapp_usage_ledger%ROWTYPE;
  v_limit integer;
  v_reserved integer := 0;
  v_scope text;
  v_kind text := 'active';
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_trial_active boolean := false;
BEGIN
  IF p_studio_id IS NULL OR nullif(trim(p_idempotency_key), '') IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'invalid_usage_request');
  END IF;

  IF NOT public.studio_has_entitlement(p_studio_id, 'whatsapp') THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'plan_feature_required:whatsapp');
  END IF;

  SELECT * INTO v_settings FROM public.whatsapp_platform_settings WHERE id = 1;
  IF NOT FOUND OR NOT v_settings.global_enabled THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'whatsapp_globally_disabled');
  END IF;

  SELECT * INTO v_existing
  FROM public.whatsapp_usage_ledger
  WHERE idempotency_key = p_idempotency_key;
  IF FOUND AND v_existing.state <> 'released' THEN
    RETURN jsonb_build_object(
      'allowed', true,
      'reason', 'already_reserved',
      'ledgerId', v_existing.id,
      'entitlement', v_existing.entitlement_kind
    );
  END IF;

  INSERT INTO public.whatsapp_studio_entitlements (studio_id, status)
  VALUES (p_studio_id, 'active')
  ON CONFLICT (studio_id) DO NOTHING;

  SELECT * INTO v_entitlement
  FROM public.whatsapp_studio_entitlements
  WHERE studio_id = p_studio_id
  FOR UPDATE;

  IF v_entitlement.status = 'paused' THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', coalesce(v_entitlement.paused_reason, 'whatsapp_paused')
    );
  END IF;

  SELECT s.subscription_status = 'trialing' AND s.trial_ends_at > now()
  INTO v_trial_active
  FROM public.studios s
  WHERE s.id = p_studio_id;

  IF v_trial_active THEN
    IF NOT v_settings.trial_enabled THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'whatsapp_trial_disabled');
    END IF;
    v_kind := 'trial';
    v_limit := coalesce(v_entitlement.trial_message_limit_override, v_settings.trial_message_limit);
    SELECT coalesce(s.trial_claimed_at, s.created_at), s.trial_ends_at
    INTO v_period_start, v_period_end
    FROM public.studios s WHERE s.id = p_studio_id;
    v_scope := 'trial:' || to_char(v_period_start AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS');
  ELSE
    v_kind := 'active';
    v_limit := coalesce(
      v_entitlement.monthly_message_limit_override,
      v_settings.commercial_included_messages,
      v_settings.premium_message_limit
    );
    v_period_start := date_trunc('month', now());
    v_period_end := v_period_start + interval '1 month';
    v_scope := 'premium:' || to_char(v_period_start AT TIME ZONE 'UTC', 'YYYYMM');
  END IF;

  SELECT count(*)::integer INTO v_reserved
  FROM public.whatsapp_usage_ledger
  WHERE studio_id = p_studio_id
    AND state IN ('reserved', 'submitted', 'counted')
    AND created_at >= v_period_start
    AND created_at < v_period_end;

  IF v_reserved >= v_limit AND NOT v_entitlement.allow_paid_overage THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', CASE WHEN v_trial_active THEN 'whatsapp_trial_limit_reached' ELSE 'whatsapp_monthly_limit_reached' END,
      'used', v_reserved,
      'limit', v_limit
    );
  END IF;

  IF v_existing.id IS NOT NULL THEN
    UPDATE public.whatsapp_usage_ledger
    SET state = 'reserved', entitlement_kind = v_kind,
        message_kind = coalesce(nullif(p_message_kind, ''), message_kind),
        unit_cost_cents = v_settings.provider_cost_per_message_cents,
        commercial_unit_cents = CASE
          WHEN v_reserved >= v_limit THEN v_settings.commercial_excess_message_cents
          ELSE 0
        END,
        reserved_at = now(), submitted_at = NULL, counted_at = NULL,
        released_at = NULL, provider_message_id = NULL, provider_status = NULL,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'usage_scope', v_scope,
          'included_limit', v_limit,
          'is_overage', v_reserved >= v_limit
        ),
        updated_at = now()
    WHERE id = v_existing.id
    RETURNING * INTO v_existing;
  ELSE
    INSERT INTO public.whatsapp_usage_ledger (
      studio_id, idempotency_key, entitlement_kind, message_kind,
      unit_cost_cents, commercial_unit_cents, metadata
    ) VALUES (
      p_studio_id, p_idempotency_key, v_kind,
      coalesce(nullif(p_message_kind, ''), 'confirmation'),
      v_settings.provider_cost_per_message_cents,
      CASE WHEN v_reserved >= v_limit THEN v_settings.commercial_excess_message_cents ELSE 0 END,
      jsonb_build_object(
        'usage_scope', v_scope,
        'included_limit', v_limit,
        'is_overage', v_reserved >= v_limit
      )
    )
    RETURNING * INTO v_existing;
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'reason', 'reserved',
    'ledgerId', v_existing.id,
    'entitlement', v_existing.entitlement_kind,
    'used', v_reserved + 1,
    'limit', v_limit,
    'overage', v_reserved >= v_limit
  );
EXCEPTION WHEN unique_violation THEN
  SELECT * INTO v_existing
  FROM public.whatsapp_usage_ledger
  WHERE idempotency_key = p_idempotency_key;
  RETURN jsonb_build_object(
    'allowed', v_existing.state <> 'released',
    'reason', 'already_reserved',
    'ledgerId', v_existing.id
  );
END
$$;


ALTER FUNCTION "public"."reserve_whatsapp_usage"("p_studio_id" "uuid", "p_idempotency_key" "text", "p_message_kind" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."appointments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "staff_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "starts_at" timestamp with time zone NOT NULL,
    "ends_at" timestamp with time zone NOT NULL,
    "status" "public"."appointment_status" DEFAULT 'pending'::"public"."appointment_status" NOT NULL,
    "total_price" numeric(10,2) DEFAULT 0 NOT NULL,
    "total_duration_min" integer DEFAULT 0 NOT NULL,
    "notes" "text",
    "cancellation_reason" "text",
    "reminder_sent_at" timestamp with time zone,
    "confirmation_sent_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "public_token" "text",
    "notification_suppressed" boolean DEFAULT false NOT NULL,
    "studio_commission_percent_snapshot" numeric(5,2) NOT NULL,
    "lifecycle_activated_at" timestamp with time zone,
    "attendance_confirmation_requested_at" timestamp with time zone,
    "attendance_resolved_at" timestamp with time zone,
    "attendance_resolved_by" "uuid",
    "is_manual_fit" boolean DEFAULT false NOT NULL,
    "duration_overridden" boolean DEFAULT false NOT NULL,
    CONSTRAINT "appointments_check" CHECK (("ends_at" > "starts_at")),
    CONSTRAINT "appointments_studio_commission_snapshot_range" CHECK ((("studio_commission_percent_snapshot" IS NULL) OR (("studio_commission_percent_snapshot" >= (0)::numeric) AND ("studio_commission_percent_snapshot" <= (100)::numeric))))
);


ALTER TABLE "public"."appointments" OWNER TO "postgres";


COMMENT ON COLUMN "public"."appointments"."studio_commission_percent_snapshot" IS 'Effective studio percentage frozen when the appointment is created or reassigned.';



CREATE OR REPLACE FUNCTION "public"."resolve_appointment_attendance"("p_appointment_id" "uuid", "p_studio_id" "uuid", "p_outcome" "text", "p_actor_id" "uuid") RETURNS "public"."appointments"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  PERFORM public.resolve_appointment_attendance_batch(
    ARRAY[p_appointment_id], p_studio_id, p_outcome, p_actor_id, 'cash'
  );
  RETURN (SELECT appointment FROM public.appointments appointment WHERE id = p_appointment_id);
END
$$;


ALTER FUNCTION "public"."resolve_appointment_attendance"("p_appointment_id" "uuid", "p_studio_id" "uuid", "p_outcome" "text", "p_actor_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_appointment_attendance_batch"("p_appointment_ids" "uuid"[], "p_studio_id" "uuid", "p_outcome" "text", "p_actor_id" "uuid", "p_payment_method" "text" DEFAULT 'cash'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_appointment_id uuid;
  v_results jsonb := '[]'::jsonb;
  v_count integer := 0;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_appointment_ids IS NULL OR cardinality(p_appointment_ids) = 0 THEN
    RAISE EXCEPTION 'appointment_ids_required';
  END IF;
  IF cardinality(p_appointment_ids) > 100 THEN RAISE EXCEPTION 'too_many_appointments'; END IF;

  FOR v_appointment_id IN
    SELECT DISTINCT appointment_id
    FROM unnest(p_appointment_ids) AS ids(appointment_id)
    ORDER BY appointment_id
  LOOP
    v_results := v_results || jsonb_build_array(
      public.settle_appointment_attendance_core(
        v_appointment_id, p_studio_id, p_outcome, p_actor_id, p_payment_method
      )
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('count', v_count, 'results', v_results);
END
$$;


ALTER FUNCTION "public"."resolve_appointment_attendance_batch"("p_appointment_ids" "uuid"[], "p_studio_id" "uuid", "p_outcome" "text", "p_actor_id" "uuid", "p_payment_method" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_booking_service_pricing"("p_studio_id" "uuid", "p_service_ids" "uuid"[]) RETURNS TABLE("service_id" "uuid", "price" numeric, "duration_min" integer, "is_upsell" boolean, "offer_id" "uuid")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  WITH requested AS (
    SELECT u.service_id, u.ordinality::integer AS position
    FROM unnest(p_service_ids) WITH ORDINALITY AS u(service_id, ordinality)
  ),
  trigger_service AS (
    SELECT service_id AS id
    FROM requested
    WHERE position = 1
  )
  SELECT
    service.id AS service_id,
    CASE
      WHEN requested.position > 1 AND offer.id IS NOT NULL
        THEN round(offer.discounted_price::numeric, 2)
      ELSE round(service.price::numeric, 2)
    END AS price,
    CASE
      WHEN requested.position > 1 AND offer.id IS NOT NULL
        THEN COALESCE(offer.duration_min, service.duration_min)
      ELSE service.duration_min
    END AS duration_min,
    (requested.position > 1 AND offer.id IS NOT NULL) AS is_upsell,
    offer.id AS offer_id
  FROM requested
  JOIN public.services AS service
    ON service.id = requested.service_id
   AND service.studio_id = p_studio_id
   AND service.is_active = true
  CROSS JOIN trigger_service
  LEFT JOIN public.upsell_offers AS offer
    ON public.studio_has_entitlement(p_studio_id, 'promotions')
   AND offer.studio_id = p_studio_id
   AND offer.trigger_service_id = trigger_service.id
   AND offer.offered_service_id = service.id
   AND offer.is_active = true
  ORDER BY requested.position;
$$;


ALTER FUNCTION "public"."resolve_booking_service_pricing"("p_studio_id" "uuid", "p_service_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_studio_local_datetime"("p_studio_id" "uuid", "p_local_date" "date", "p_local_time" time without time zone) RETURNS timestamp with time zone
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_timezone text;
  v_instant timestamptz;
  v_roundtrip timestamp;
BEGIN
  IF p_studio_id IS NULL OR p_local_date IS NULL OR p_local_time IS NULL THEN
    RAISE EXCEPTION 'invalid_schedule_datetime';
  END IF;
  IF auth.role() <> 'service_role'
     AND NOT public.can_use_studio(auth.uid(), p_studio_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT coalesce(nullif(s.timezone, ''), 'Europe/Lisbon')
    INTO v_timezone
  FROM public.studios s
  WHERE s.id = p_studio_id;
  IF v_timezone IS NULL THEN RAISE EXCEPTION 'studio_not_found'; END IF;

  v_instant := (p_local_date::timestamp + p_local_time) AT TIME ZONE v_timezone;
  v_roundtrip := v_instant AT TIME ZONE v_timezone;

  -- Reject a non-existent civil time during the spring DST transition. An
  -- ambiguous autumn time remains deterministic under PostgreSQL timezone data.
  IF v_roundtrip::date IS DISTINCT FROM p_local_date
     OR to_char(v_roundtrip, 'HH24:MI') IS DISTINCT FROM to_char(p_local_time, 'HH24:MI') THEN
    RAISE EXCEPTION 'invalid_schedule_datetime_for_timezone';
  END IF;
  RETURN v_instant;
END
$$;


ALTER FUNCTION "public"."resolve_studio_local_datetime"("p_studio_id" "uuid", "p_local_date" "date", "p_local_time" time without time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."revoke_terminal_studio_push_subscription"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  -- 401/403 normally indicate a VAPID/provider configuration problem. Keeping
  -- the subscription allows recovery after configuration is corrected.
  if new.status = 'failed'
     and new.subscription_id is not null
     and new.last_error in ('web_push_400', 'web_push_404', 'web_push_410') then
    update public.push_subscriptions
    set revoked_at = coalesce(revoked_at, now()),
        revocation_reason = new.last_error,
        updated_at = now()
    where id = new.subscription_id
      and revoked_at is null;
  end if;

  return new;
end
$$;


ALTER FUNCTION "public"."revoke_terminal_studio_push_subscription"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."seed_staff_default_availability"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.staff_availability (studio_id, staff_id, weekday, start_time, end_time)
  SELECT NEW.studio_id, NEW.id, wd, '09:00'::TIME, '18:00'::TIME
  FROM generate_series(1, 5) AS wd
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.staff_availability sa
    WHERE sa.staff_id = NEW.id AND sa.weekday = wd
  );
  RETURN NEW;
END $$;


ALTER FUNCTION "public"."seed_staff_default_availability"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."settle_appointment_attendance_core"("p_appointment_id" "uuid", "p_studio_id" "uuid", "p_outcome" "text", "p_actor_id" "uuid", "p_payment_method" "text" DEFAULT 'cash'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_appointment public.appointments%ROWTYPE;
  v_session public.cash_register_sessions%ROWTYPE;
  v_status public.appointment_status;
  v_method text;
  v_total_cents bigint := 0;
  v_online_gross_cents bigint := 0;
  v_onsite_gross_cents bigint := 0;
  v_refunded_cents bigint := 0;
  v_received_before_cents bigint := 0;
  v_onsite_added_cents bigint := 0;
  v_received_after_cents bigint := 0;
  v_movement_id uuid;
  v_source_key text;
BEGIN
  IF p_outcome NOT IN ('completed', 'no_show') THEN
    RAISE EXCEPTION 'invalid_attendance_outcome';
  END IF;
  v_status := p_outcome::public.appointment_status;
  v_method := coalesce(nullif(trim(p_payment_method), ''), 'cash');
  IF v_method NOT IN ('cash', 'card', 'mb_way', 'bank_transfer', 'other') THEN
    RAISE EXCEPTION 'invalid_payment_method';
  END IF;

  SELECT * INTO v_appointment
  FROM public.appointments
  WHERE id = p_appointment_id
    AND studio_id = p_studio_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'appointment_not_found'; END IF;
  IF v_appointment.status = 'cancelled' THEN RAISE EXCEPTION 'appointment_cancelled'; END IF;
  IF v_appointment.status IN ('completed', 'no_show') AND v_appointment.status <> v_status THEN
    RAISE EXCEPTION 'attendance_already_resolved';
  END IF;
  IF v_appointment.status NOT IN ('confirmed', 'completed', 'no_show') THEN
    RAISE EXCEPTION 'appointment_not_confirmed';
  END IF;

  -- All arithmetic is integer cents. Refunds are full online refunds in the
  -- current model and are deduplicated by payment intent.
  v_total_cents := greatest(0, round(coalesce(v_appointment.total_price, 0) * 100)::bigint);

  SELECT coalesce(sum(pi.amount_cents), 0)::bigint
  INTO v_online_gross_cents
  FROM public.payment_intents pi
  WHERE pi.appointment_id = v_appointment.id
    AND pi.studio_id = v_appointment.studio_id
    AND pi.status = 'succeeded';

  SELECT coalesce(sum(round(crm.amount * 100)), 0)::bigint
  INTO v_onsite_gross_cents
  FROM public.cash_register_movements crm
  WHERE crm.appointment_id = v_appointment.id
    AND crm.studio_id = v_appointment.studio_id
    AND crm.movement_type = 'service_payment';

  SELECT coalesce(sum(refunded.amount_cents), 0)::bigint
  INTO v_refunded_cents
  FROM (
    SELECT DISTINCT pi.id, pi.amount_cents
    FROM public.refund_requests rr
    JOIN public.payment_intents pi ON pi.id = rr.payment_intent_id
    WHERE rr.appointment_id = v_appointment.id
      AND rr.studio_id = v_appointment.studio_id
      AND rr.status = 'refunded'
  ) refunded;

  v_received_before_cents := greatest(
    0,
    v_online_gross_cents + v_onsite_gross_cents - v_refunded_cents
  );

  -- A retry after the terminal state is a read-only success. This is essential
  -- for double clicks, network retries, and two devices resolving concurrently.
  IF v_appointment.status = v_status THEN
    SELECT crm.id INTO v_movement_id
    FROM public.cash_register_movements crm
    WHERE crm.source_key = 'attendance-settlement:' || v_appointment.id::text;

    RETURN jsonb_build_object(
      'appointment_id', v_appointment.id,
      'status', v_status,
      'total_cents', v_total_cents,
      'received_before_cents', v_received_before_cents,
      'onsite_added_cents', 0,
      'received_after_cents', least(v_total_cents, v_received_before_cents),
      'pending_cents', 0,
      'movement_id', v_movement_id,
      'idempotent', true
    );
  END IF;

  IF p_outcome = 'completed' THEN
    v_onsite_added_cents := greatest(
      0,
      v_total_cents - least(v_total_cents, v_received_before_cents)
    );

    IF v_onsite_added_cents > 0 THEN
      SELECT * INTO v_session
      FROM public.cash_register_sessions
      WHERE studio_id = v_appointment.studio_id
        AND status = 'open'
      ORDER BY opened_at DESC
      LIMIT 1
      FOR UPDATE;

      IF v_session.id IS NULL THEN RAISE EXCEPTION 'cash_register_not_open'; END IF;

      v_source_key := 'attendance-settlement:' || v_appointment.id::text;
      INSERT INTO public.cash_register_movements (
        session_id,
        studio_id,
        appointment_id,
        movement_type,
        payment_method,
        amount,
        description,
        occurred_at,
        created_by,
        source_key
      ) VALUES (
        v_session.id,
        v_appointment.studio_id,
        v_appointment.id,
        'service_payment',
        v_method,
        v_onsite_added_cents::numeric / 100,
        'Liquidação presencial por comparecimento',
        now(),
        p_actor_id,
        v_source_key
      )
      ON CONFLICT (source_key) WHERE source_key IS NOT NULL DO NOTHING
      RETURNING id INTO v_movement_id;

      IF v_movement_id IS NULL THEN
        SELECT id INTO v_movement_id
        FROM public.cash_register_movements
        WHERE source_key = v_source_key;
      END IF;
    END IF;
  END IF;

  UPDATE public.appointments
  SET status = v_status,
      attendance_resolved_at = now(),
      attendance_resolved_by = p_actor_id,
      updated_at = now()
  WHERE id = v_appointment.id;

  v_received_after_cents := least(
    v_total_cents,
    v_received_before_cents + v_onsite_added_cents
  );

  INSERT INTO public.financial_audit_logs (
    studio_id, actor_user_id, entity_type, entity_id, action, amount_cents, metadata
  ) VALUES (
    v_appointment.studio_id,
    p_actor_id,
    'appointment',
    v_appointment.id,
    CASE WHEN p_outcome = 'completed'
      THEN 'attendance_completed_and_settled'
      ELSE 'attendance_no_show'
    END,
    v_onsite_added_cents,
    jsonb_build_object(
      'total_cents', v_total_cents,
      'received_before_cents', v_received_before_cents,
      'onsite_added_cents', v_onsite_added_cents,
      'received_after_cents', v_received_after_cents,
      'payment_method', CASE WHEN v_onsite_added_cents > 0 THEN v_method ELSE NULL END
    )
  );

  RETURN jsonb_build_object(
    'appointment_id', v_appointment.id,
    'status', v_status,
    'total_cents', v_total_cents,
    'received_before_cents', v_received_before_cents,
    'onsite_added_cents', v_onsite_added_cents,
    'received_after_cents', v_received_after_cents,
    'pending_cents', 0,
    'movement_id', v_movement_id,
    'idempotent', false
  );
END
$$;


ALTER FUNCTION "public"."settle_appointment_attendance_core"("p_appointment_id" "uuid", "p_studio_id" "uuid", "p_outcome" "text", "p_actor_id" "uuid", "p_payment_method" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."staff_owns_appointment"("_user_id" "uuid", "_appointment_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.appointments a
    JOIN public.staff st
      ON st.id = a.staff_id
     AND st.studio_id = a.studio_id
     AND st.is_active = true
    JOIN public.user_roles ur
      ON ur.user_id = _user_id
     AND ur.studio_id = a.studio_id
     AND ur.role::text = 'staff'
    WHERE a.id = _appointment_id
      AND st.user_id = _user_id
  )
$$;


ALTER FUNCTION "public"."staff_owns_appointment"("_user_id" "uuid", "_appointment_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."studio_can_add_professional"("_studio_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT public.studio_plan_professional_limit(_studio_id) IS NULL
    OR (
      SELECT count(*)
      FROM public.staff AS member
      WHERE member.studio_id = _studio_id AND member.is_active = true
    ) < public.studio_plan_professional_limit(_studio_id)
$$;


ALTER FUNCTION "public"."studio_can_add_professional"("_studio_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."studio_effective_plan_tier"("_studio_id" "uuid", "_at" timestamp with time zone DEFAULT "now"()) RETURNS "text"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_studio public.studios%ROWTYPE;
  v_subscription_tier text;
BEGIN
  SELECT * INTO v_studio
  FROM public.studios
  WHERE id = _studio_id;

  IF NOT FOUND OR v_studio.is_active IS DISTINCT FROM true THEN
    RETURN 'free';
  END IF;

  -- A paid or Stripe-managed period wins over the product trial. This keeps
  -- paid Pro/Premium studios unchanged during administrative trial resets.
  SELECT coalesce(sub.plan_tier, 'premium')
  INTO v_subscription_tier
  FROM public.subscriptions sub
  WHERE sub.studio_id = _studio_id
    AND sub.status IN ('active', 'trialing', 'canceled')
    AND sub.current_period_end IS NOT NULL
    AND sub.current_period_end > _at
  ORDER BY sub.updated_at DESC
  LIMIT 1;

  IF v_subscription_tier IN ('pro', 'premium') THEN
    RETURN v_subscription_tier;
  END IF;

  IF v_studio.subscription_status IN ('active', 'trialing', 'canceled')
    AND (
      v_studio.subscription_current_period_end > _at
      OR v_studio.premium_access_until > _at
    ) THEN
    RETURN CASE
      WHEN v_studio.plan_tier IN ('pro', 'premium') THEN v_studio.plan_tier
      ELSE 'premium'
    END;
  END IF;

  -- A Bellza product trial grants the full Premium experience.
  IF v_studio.trial_ends_at IS NOT NULL AND v_studio.trial_ends_at > _at THEN
    RETURN 'premium';
  END IF;

  RETURN 'free';
END
$$;


ALTER FUNCTION "public"."studio_effective_plan_tier"("_studio_id" "uuid", "_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."studio_has_entitlement"("_studio_id" "uuid", "_feature" "text", "_at" timestamp with time zone DEFAULT "now"()) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  WITH access AS (
    SELECT public.studio_effective_plan_tier(_studio_id, _at) AS tier
  )
  SELECT CASE
    WHEN _feature IN (
      'agenda', 'online_booking', 'services', 'manual_booking',
      'clients_basic', 'public_page'
    ) THEN true
    WHEN _feature IN (
      'clients_full', 'team_management', 'online_payments', 'notifications',
      'finance_basic', 'attendance', 'reviews', 'reports_basic'
    ) THEN access.tier IN ('pro', 'premium')
    WHEN _feature IN (
      'whatsapp', 'loyalty', 'promotions', 'finance_advanced',
      'team_advanced', 'future_integrations'
    ) THEN access.tier = 'premium'
    ELSE false
  END
  FROM access
  WHERE EXISTS (
    SELECT 1 FROM public.studios s
    WHERE s.id = _studio_id AND s.is_active = true
  )
$$;


ALTER FUNCTION "public"."studio_has_entitlement"("_studio_id" "uuid", "_feature" "text", "_at" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."studio_has_entitlement"("_studio_id" "uuid", "_feature" "text", "_at" timestamp with time zone) IS 'Authoritative tenant-scoped feature authorization for Free, Pro and Premium.';



CREATE OR REPLACE FUNCTION "public"."studio_plan_professional_limit"("_studio_id" "uuid") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT CASE public.studio_effective_plan_tier(_studio_id)
    WHEN 'free' THEN 1
    WHEN 'pro' THEN 3
    ELSE NULL
  END
$$;


ALTER FUNCTION "public"."studio_plan_professional_limit"("_studio_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."studio_staff_is_within_plan"("_studio_id" "uuid", "_staff_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  WITH plan_limit AS (
    SELECT public.studio_plan_professional_limit(_studio_id) AS maximum
  ), allowed_staff AS (
    SELECT member.id
    FROM public.staff AS member
    WHERE member.studio_id = _studio_id
      AND (
        member.is_active IS DISTINCT FROM true
        OR (SELECT maximum FROM plan_limit) IS NULL
        OR member.id IN (
          SELECT active_member.id
          FROM public.staff AS active_member
          WHERE active_member.studio_id = _studio_id
            AND active_member.is_active = true
          ORDER BY active_member.sort_order ASC NULLS LAST, active_member.id ASC
          LIMIT coalesce((SELECT maximum FROM plan_limit), 2147483647)
        )
      )
  )
  SELECT EXISTS (SELECT 1 FROM allowed_staff WHERE id = _staff_id)
$$;


ALTER FUNCTION "public"."studio_staff_is_within_plan"("_studio_id" "uuid", "_staff_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_public_refund_request"("p_booking_request_id" "uuid", "p_appointment_id" "uuid", "p_reason" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_id uuid;
  v_req public.booking_payment_requests%rowtype;
  v_appt public.appointments%rowtype;
  v_payment_id uuid;
  v_client_name text;
  v_client_phone text;
  v_client_email text;
  v_studio_id uuid;
  v_enabled boolean;
begin
  if length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'refund_reason_required';
  end if;

  if p_booking_request_id is not null then
    select * into v_req from public.booking_payment_requests where id = p_booking_request_id;
    if not found then raise exception 'booking_not_found'; end if;
    v_studio_id := v_req.studio_id;
    v_client_name := v_req.client_name;
    v_client_phone := v_req.client_phone;
    v_client_email := v_req.client_email;
  elsif p_appointment_id is not null then
    select * into v_appt from public.appointments where id = p_appointment_id;
    if not found then raise exception 'booking_not_found'; end if;
    v_studio_id := v_appt.studio_id;
  else
    raise exception 'booking_not_found';
  end if;

  select refund_requests_enabled into v_enabled from public.studios where id = v_studio_id;
  if coalesce(v_enabled, false) = false then
    raise exception 'refund_requests_disabled';
  end if;

  select id into v_payment_id
  from public.payment_intents
  where (booking_request_id = p_booking_request_id or appointment_id = p_appointment_id)
    and status = 'succeeded'
  order by created_at desc
  limit 1;

  insert into public.refund_requests (
    studio_id,
    appointment_id,
    booking_request_id,
    payment_intent_id,
    client_name,
    client_phone,
    client_email,
    reason,
    status
  )
  values (
    v_studio_id,
    p_appointment_id,
    p_booking_request_id,
    v_payment_id,
    v_client_name,
    v_client_phone,
    v_client_email,
    trim(p_reason),
    'pending'
  )
  returning id into v_id;

  return v_id;
end;
$$;


ALTER FUNCTION "public"."submit_public_refund_request"("p_booking_request_id" "uuid", "p_appointment_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."suppress_invalidated_appointment_reminders"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF OLD.starts_at IS DISTINCT FROM NEW.starts_at
     OR OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.studio_notification_deliveries d
    SET status = 'skipped',
        lease_until = NULL,
        last_error = CASE
          WHEN OLD.starts_at IS DISTINCT FROM NEW.starts_at THEN 'appointment_schedule_changed'
          WHEN NEW.status <> 'confirmed' THEN 'appointment_no_longer_confirmed'
          ELSE 'appointment_reminder_invalidated'
        END,
        updated_at = now()
    FROM public.studio_notifications n
    WHERE n.id = d.notification_id
      AND n.studio_id = NEW.studio_id
      AND n.appointment_id = NEW.id
      AND n.kind = 'appointment_reminder'
      AND d.status IN ('pending', 'retry', 'delivering');
  END IF;
  RETURN NEW;
END
$$;


ALTER FUNCTION "public"."suppress_invalidated_appointment_reminders"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."swap_studio_appointments"("p_studio_id" "uuid", "p_first_appointment_id" "uuid", "p_second_appointment_id" "uuid", "p_confirm_overlap" boolean, "p_actor_id" "uuid", "p_expected_conflict_ids" "uuid"[] DEFAULT ARRAY[]::"uuid"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_first public.appointments%ROWTYPE;
  v_second public.appointments%ROWTYPE;
  v_first_duration integer;
  v_second_duration integer;
  v_first_preview jsonb;
  v_second_preview jsonb;
  v_conflicts jsonb;
  v_conflict_ids uuid[];
  v_correlation uuid := gen_random_uuid();
BEGIN
  IF p_first_appointment_id = p_second_appointment_id THEN RAISE EXCEPTION 'swap_same_appointment'; END IF;
  IF p_actor_id IS NOT NULL AND NOT public.can_use_studio(p_actor_id, p_studio_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF p_actor_id IS NULL AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_studio_id::text, 726354));

  PERFORM 1 FROM public.appointments
  WHERE id IN (p_first_appointment_id, p_second_appointment_id) AND studio_id = p_studio_id
  ORDER BY id FOR UPDATE;
  SELECT * INTO v_first FROM public.appointments WHERE id = p_first_appointment_id AND studio_id = p_studio_id;
  SELECT * INTO v_second FROM public.appointments WHERE id = p_second_appointment_id AND studio_id = p_studio_id;
  IF v_first.id IS NULL OR v_second.id IS NULL THEN RAISE EXCEPTION 'appointment_not_found'; END IF;
  IF v_first.status::text IN ('cancelled', 'canceled', 'no_show', 'completed')
     OR v_second.status::text IN ('cancelled', 'canceled', 'no_show', 'completed') THEN
    RAISE EXCEPTION 'appointment_not_reschedulable';
  END IF;
  IF abs(EXTRACT(EPOCH FROM (v_first.starts_at - v_second.starts_at))) < 60 THEN
    RETURN jsonb_build_object(
      'firstAppointmentId', v_first.id, 'secondAppointmentId', v_second.id,
      'firstStartsAt', v_first.starts_at, 'secondStartsAt', v_second.starts_at,
      'changed', false, 'overlapConfirmed', false, 'conflicts', '[]'::jsonb
    );
  END IF;

  v_first_duration := GREATEST(5, COALESCE(v_first.total_duration_min,
    CEIL(EXTRACT(EPOCH FROM (v_first.ends_at - v_first.starts_at)) / 60)::integer));
  v_second_duration := GREATEST(5, COALESCE(v_second.total_duration_min,
    CEIL(EXTRACT(EPOCH FROM (v_second.ends_at - v_second.starts_at)) / 60)::integer));
  v_first_preview := public.preview_studio_schedule_change(
    p_studio_id, v_first.staff_id, v_second.starts_at, v_first_duration,
    ARRAY[v_first.id, v_second.id]
  );
  v_second_preview := public.preview_studio_schedule_change(
    p_studio_id, v_second.staff_id, v_first.starts_at, v_second_duration,
    ARRAY[v_first.id, v_second.id]
  );
  IF COALESCE((v_first_preview->>'hardBlocked')::boolean, false)
     OR COALESCE((v_second_preview->>'hardBlocked')::boolean, false) THEN
    RAISE EXCEPTION 'schedule_hard_blocked';
  END IF;
  IF (NOT COALESCE((v_first_preview->>'withinAvailability')::boolean, false)
      AND NOT COALESCE(v_first.is_manual_fit, false))
     OR (NOT COALESCE((v_second_preview->>'withinAvailability')::boolean, false)
      AND NOT COALESCE(v_second.is_manual_fit, false)) THEN
    RAISE EXCEPTION 'outside_staff_availability';
  END IF;
  v_conflicts := COALESCE(v_first_preview->'conflicts', '[]'::jsonb)
    || COALESCE(v_second_preview->'conflicts', '[]'::jsonb);
  SELECT COALESCE(array_agg(DISTINCT (item->>'appointmentId')::uuid), ARRAY[]::uuid[])
  INTO v_conflict_ids FROM jsonb_array_elements(v_conflicts) AS item;
  IF jsonb_array_length(v_conflicts) > 0 AND NOT COALESCE(p_confirm_overlap, false) THEN
    RAISE EXCEPTION 'schedule_conflict';
  END IF;
  IF COALESCE(p_confirm_overlap, false)
     AND NOT (
       v_conflict_ids <@ COALESCE(p_expected_conflict_ids, ARRAY[]::uuid[])
       AND COALESCE(p_expected_conflict_ids, ARRAY[]::uuid[]) <@ v_conflict_ids
     ) THEN
    RAISE EXCEPTION 'schedule_conflict_changed';
  END IF;

  -- Required even without an external conflict because the two updates pass
  -- through a transient state inside the same atomic transaction.
  PERFORM set_config('bellza.allow_manual_overlap', 'on', true);

  UPDATE public.appointments SET
    starts_at = v_second.starts_at,
    ends_at = v_second.starts_at + make_interval(mins => v_first_duration),
    is_manual_fit = is_manual_fit OR jsonb_array_length(v_conflicts) > 0,
    updated_at = now()
  WHERE id = v_first.id;
  UPDATE public.appointments SET
    starts_at = v_first.starts_at,
    ends_at = v_first.starts_at + make_interval(mins => v_second_duration),
    is_manual_fit = is_manual_fit OR jsonb_array_length(v_conflicts) > 0,
    updated_at = now()
  WHERE id = v_second.id;

  INSERT INTO public.appointment_schedule_events (
    studio_id, appointment_id, related_appointment_id, actor_id, operation,
    overlap_confirmed, previous_state, next_state, conflict_snapshot, correlation_id
  ) VALUES
  (
    p_studio_id, v_first.id, v_second.id, p_actor_id, 'swap',
    COALESCE(p_confirm_overlap, false) AND jsonb_array_length(v_conflicts) > 0,
    jsonb_build_object('startsAt', v_first.starts_at, 'endsAt', v_first.ends_at),
    jsonb_build_object('startsAt', v_second.starts_at, 'endsAt', v_second.starts_at + make_interval(mins => v_first_duration)),
    v_conflicts, v_correlation
  ),
  (
    p_studio_id, v_second.id, v_first.id, p_actor_id, 'swap',
    COALESCE(p_confirm_overlap, false) AND jsonb_array_length(v_conflicts) > 0,
    jsonb_build_object('startsAt', v_second.starts_at, 'endsAt', v_second.ends_at),
    jsonb_build_object('startsAt', v_first.starts_at, 'endsAt', v_first.starts_at + make_interval(mins => v_second_duration)),
    v_conflicts, v_correlation
  );

  RETURN jsonb_build_object(
    'firstAppointmentId', v_first.id, 'secondAppointmentId', v_second.id,
    'firstStartsAt', v_second.starts_at, 'secondStartsAt', v_first.starts_at,
    'changed', true, 'overlapConfirmed', jsonb_array_length(v_conflicts) > 0,
    'conflicts', v_conflicts
  );
END
$$;


ALTER FUNCTION "public"."swap_studio_appointments"("p_studio_id" "uuid", "p_first_appointment_id" "uuid", "p_second_appointment_id" "uuid", "p_confirm_overlap" boolean, "p_actor_id" "uuid", "p_expected_conflict_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."track_upsell_acceptances"("p_offer_ids" "uuid"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF p_offer_ids IS NULL OR array_length(p_offer_ids, 1) IS NULL THEN
    RETURN;
  END IF;
  UPDATE public.upsell_offers
  SET conversions_count = conversions_count + 1,
      extra_revenue = extra_revenue + discounted_price
  WHERE id = ANY(p_offer_ids) AND is_active = true;
END
$$;


ALTER FUNCTION "public"."track_upsell_acceptances"("p_offer_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."track_upsell_views"("p_offer_ids" "uuid"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF p_offer_ids IS NULL OR array_length(p_offer_ids, 1) IS NULL THEN
    RETURN;
  END IF;
  UPDATE public.upsell_offers
  SET views_count = views_count + 1
  WHERE id = ANY(p_offer_ids) AND is_active = true;
END
$$;


ALTER FUNCTION "public"."track_upsell_views"("p_offer_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_client_totals_from_manual_entry"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.client_id IS NOT NULL THEN
    UPDATE public.clients
    SET
      total_visits = total_visits + 1,
      total_spent = total_spent + NEW.amount,
      updated_at = now()
    WHERE id = NEW.client_id;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.client_id IS NOT NULL THEN
      UPDATE public.clients
      SET
        total_visits = GREATEST(0, total_visits - 1),
        total_spent = GREATEST(0, total_spent - OLD.amount),
        updated_at = now()
      WHERE id = OLD.client_id;
    END IF;
    IF NEW.client_id IS NOT NULL THEN
      UPDATE public.clients
      SET
        total_visits = total_visits + 1,
        total_spent = total_spent + NEW.amount,
        updated_at = now()
      WHERE id = NEW.client_id;
    END IF;
  ELSIF TG_OP = 'DELETE' AND OLD.client_id IS NOT NULL THEN
    UPDATE public.clients
    SET
      total_visits = GREATEST(0, total_visits - 1),
      total_spent = GREATEST(0, total_spent - OLD.amount),
      updated_at = now()
    WHERE id = OLD.client_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END $$;


ALTER FUNCTION "public"."update_client_totals_from_manual_entry"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_manual_appointment_service"("p_appointment_id" "uuid", "p_studio_id" "uuid", "p_staff_id" "uuid", "p_service_id" "uuid", "p_notes" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_appt public.appointments%ROWTYPE;
  v_service public.services%ROWTYPE;
  v_ends_at timestamptz;
  v_line_count integer;
  v_is_fit boolean;
BEGIN
  IF NOT public.can_use_studio(auth.uid(), p_studio_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT * INTO v_appt
  FROM public.appointments
  WHERE id = p_appointment_id AND studio_id = p_studio_id
  FOR UPDATE;
  IF v_appt.id IS NULL THEN RAISE EXCEPTION 'appointment_not_found'; END IF;
  IF v_appt.status IN ('cancelled', 'no_show', 'completed') THEN
    RAISE EXCEPTION 'appointment_not_editable';
  END IF;

  SELECT * INTO v_service
  FROM public.services
  WHERE id = p_service_id AND studio_id = p_studio_id AND is_active = true;
  IF v_service.id IS NULL THEN RAISE EXCEPTION 'service_not_found'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.staff
    WHERE id = p_staff_id AND studio_id = p_studio_id AND is_active = true
  ) OR NOT EXISTS (
    SELECT 1 FROM public.staff_services
    WHERE staff_id = p_staff_id AND service_id = p_service_id
  ) THEN
    RAISE EXCEPTION 'staff_service_unavailable';
  END IF;

  SELECT count(*) INTO v_line_count
  FROM public.appointment_services
  WHERE appointment_id = p_appointment_id;
  IF v_line_count <> 1 THEN RAISE EXCEPTION 'multi_service_edit_not_supported'; END IF;

  v_ends_at := v_appt.starts_at + make_interval(mins => v_service.duration_min);
  v_is_fit := COALESCE(v_appt.notification_suppressed, false);
  IF v_is_fit THEN
    IF NOT public.is_staff_managerial_slot_bookable(
      p_studio_id, p_staff_id, v_appt.starts_at, v_service.duration_min, v_appt.id
    ) THEN RAISE EXCEPTION 'slot_unavailable'; END IF;
  ELSIF NOT public.is_staff_slot_bookable(
    p_studio_id, p_staff_id, v_appt.starts_at, v_service.duration_min, NULL, v_appt.id
  ) THEN
    RAISE EXCEPTION 'slot_unavailable';
  END IF;

  UPDATE public.appointments
  SET
    staff_id = p_staff_id,
    ends_at = v_ends_at,
    total_price = v_service.price,
    total_duration_min = v_service.duration_min,
    notes = NULLIF(trim(COALESCE(p_notes, '')), ''),
    updated_at = now()
  WHERE id = v_appt.id;

  UPDATE public.appointment_services
  SET
    service_id = v_service.id,
    price = v_service.price,
    duration_min = v_service.duration_min
  WHERE appointment_id = v_appt.id;

  RETURN jsonb_build_object(
    'appointment_id', v_appt.id,
    'ends_at', v_ends_at,
    'duration_min', v_service.duration_min,
    'price', v_service.price
  );
EXCEPTION
  WHEN exclusion_violation THEN RAISE EXCEPTION 'slot_unavailable';
END
$$;


ALTER FUNCTION "public"."update_manual_appointment_service"("p_appointment_id" "uuid", "p_studio_id" "uuid", "p_staff_id" "uuid", "p_service_id" "uuid", "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_studio_ids"("_user_id" "uuid") RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT DISTINCT studio_id FROM public.user_roles WHERE user_id = _user_id AND studio_id IS NOT NULL
$$;


ALTER FUNCTION "public"."user_studio_ids"("_user_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."appointment_schedule_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "appointment_id" "uuid" NOT NULL,
    "related_appointment_id" "uuid",
    "actor_id" "uuid",
    "operation" "text" NOT NULL,
    "overlap_confirmed" boolean DEFAULT false NOT NULL,
    "previous_state" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "next_state" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "conflict_snapshot" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "correlation_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "appointment_schedule_events_operation_check" CHECK (("operation" = ANY (ARRAY['move'::"text", 'swap'::"text", 'duration'::"text", 'manual_fit'::"text"])))
);


ALTER TABLE "public"."appointment_schedule_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."appointment_services" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "appointment_id" "uuid" NOT NULL,
    "service_id" "uuid" NOT NULL,
    "is_upsell" boolean DEFAULT false NOT NULL,
    "price" numeric(10,2) NOT NULL,
    "duration_min" integer NOT NULL,
    "studio_commission_percent_snapshot" numeric(5,2) NOT NULL,
    CONSTRAINT "appointment_services_studio_commission_snapshot_range" CHECK ((("studio_commission_percent_snapshot" IS NULL) OR (("studio_commission_percent_snapshot" >= (0)::numeric) AND ("studio_commission_percent_snapshot" <= (100)::numeric))))
);


ALTER TABLE "public"."appointment_services" OWNER TO "postgres";


COMMENT ON COLUMN "public"."appointment_services"."studio_commission_percent_snapshot" IS 'Effective service/staff/studio percentage frozen for this appointment line.';



CREATE TABLE IF NOT EXISTS "public"."booking_payment_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "staff_id" "uuid" NOT NULL,
    "service_ids" "uuid"[] NOT NULL,
    "starts_at" timestamp with time zone NOT NULL,
    "ends_at" timestamp with time zone NOT NULL,
    "total_price" numeric(10,2) DEFAULT 0 NOT NULL,
    "total_duration_min" integer DEFAULT 0 NOT NULL,
    "client_name" "text" NOT NULL,
    "client_phone" "text" NOT NULL,
    "client_email" "text",
    "notes" "text",
    "status" "text" DEFAULT 'awaiting_payment'::"text" NOT NULL,
    "failure_reason" "text",
    "appointment_id" "uuid",
    "expires_at" timestamp with time zone DEFAULT ("now"() + '00:30:00'::interval) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "pricing_snapshot" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    CONSTRAINT "booking_payment_requests_check" CHECK (("ends_at" > "starts_at")),
    CONSTRAINT "booking_payment_requests_pricing_snapshot_array" CHECK (("jsonb_typeof"("pricing_snapshot") = 'array'::"text")),
    CONSTRAINT "booking_payment_requests_service_ids_check" CHECK (("array_length"("service_ids", 1) IS NOT NULL)),
    CONSTRAINT "booking_payment_requests_status_check" CHECK (("status" = ANY (ARRAY['awaiting_payment'::"text", 'processing'::"text", 'paid'::"text", 'converted'::"text", 'expired'::"text", 'failed'::"text", 'canceled'::"text", 'paid_conflict'::"text"]))),
    CONSTRAINT "booking_payment_requests_total_duration_min_check" CHECK (("total_duration_min" > 0)),
    CONSTRAINT "booking_payment_requests_total_price_check" CHECK (("total_price" >= (0)::numeric))
);


ALTER TABLE "public"."booking_payment_requests" OWNER TO "postgres";


COMMENT ON COLUMN "public"."booking_payment_requests"."pricing_snapshot" IS 'Immutable backend-calculated service line snapshot used when converting a paid request into an appointment.';



CREATE TABLE IF NOT EXISTS "public"."booking_policy_acceptances" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "appointment_id" "uuid",
    "booking_request_id" "uuid",
    "policy_version" "text" NOT NULL,
    "accepted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "payment_timestamp" timestamp with time zone,
    "ip_address" "text",
    "user_agent" "text",
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."booking_policy_acceptances" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_appointment_action_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "appointment_id" "uuid",
    "studio_id" "uuid",
    "public_token_hash" "text",
    "action" "text" NOT NULL,
    "status" "text" NOT NULL,
    "result" "text",
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_appointment_action_logs_action_check" CHECK (("action" = ANY (ARRAY['open'::"text", 'reschedule_open'::"text", 'reschedule'::"text", 'cancel_open'::"text", 'cancel'::"text", 'contact_whatsapp'::"text"]))),
    CONSTRAINT "client_appointment_action_logs_status_check" CHECK (("status" = ANY (ARRAY['started'::"text", 'succeeded'::"text", 'failed'::"text", 'blocked'::"text"])))
);


ALTER TABLE "public"."client_appointment_action_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "phone" "text" NOT NULL,
    "email" "text",
    "notes" "text",
    "total_visits" integer DEFAULT 0 NOT NULL,
    "total_spent" numeric(10,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "booking_status" "text" DEFAULT 'active'::"text" NOT NULL,
    "suspended_until" "date",
    "block_reason" "text",
    "auth_user_id" "uuid",
    "avatar_url" "text",
    "date_of_birth" "date",
    "account_kind" "text" DEFAULT 'visitor'::"text" NOT NULL,
    "contact_consent_at" timestamp with time zone,
    "contact_consent_version" "text",
    "policy_accepted_at" timestamp with time zone,
    "policy_version" "text",
    "notification_consent_at" timestamp with time zone,
    "notification_consent_status" "text",
    CONSTRAINT "clients_account_kind_check" CHECK (("account_kind" = ANY (ARRAY['visitor'::"text", 'account'::"text"]))),
    CONSTRAINT "clients_booking_status_check" CHECK (("booking_status" = ANY (ARRAY['active'::"text", 'suspended'::"text", 'blocked'::"text"]))),
    CONSTRAINT "clients_notification_consent_status_check" CHECK ((("notification_consent_status" IS NULL) OR ("notification_consent_status" = ANY (ARRAY['granted'::"text", 'denied'::"text", 'default'::"text"]))))
);


ALTER TABLE "public"."clients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customer_loyalty_rewards" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "reward_type" "text" NOT NULL,
    "reward_value" numeric(10,2) NOT NULL,
    "stamps_required" integer NOT NULL,
    "status" "text" DEFAULT 'available'::"text" NOT NULL,
    "appointment_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "used_at" timestamp with time zone,
    CONSTRAINT "customer_loyalty_rewards_reward_type_check" CHECK (("reward_type" = ANY (ARRAY['percent'::"text", 'fixed'::"text"]))),
    CONSTRAINT "customer_loyalty_rewards_status_check" CHECK (("status" = ANY (ARRAY['available'::"text", 'used'::"text", 'expired'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."customer_loyalty_rewards" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customer_loyalty_stamp_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "source_type" "text" NOT NULL,
    "source_appointment_id" "uuid",
    "source_customer_referral_id" "uuid",
    "stamps" integer NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "customer_loyalty_stamp_entries_source_type_check" CHECK (("source_type" = ANY (ARRAY['booking_completed'::"text", 'referral_completed'::"text", 'reward_redeemed'::"text", 'manual'::"text"])))
);


ALTER TABLE "public"."customer_loyalty_stamp_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customer_referral_codes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "referrer_client_id" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."customer_referral_codes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customer_referrals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "referrer_client_id" "uuid" NOT NULL,
    "referred_client_id" "uuid",
    "booking_request_id" "uuid",
    "appointment_id" "uuid",
    "referral_code" "text" NOT NULL,
    "status" "text" DEFAULT 'pending_completion'::"text" NOT NULL,
    "rejection_reason" "text",
    "referred_client_was_existing" boolean DEFAULT false NOT NULL,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "customer_referrals_status_check" CHECK (("status" = ANY (ARRAY['pending_completion'::"text", 'completed'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."customer_referrals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_message_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "appointment_id" "uuid",
    "payment_intent_id" "uuid",
    "idempotency_key" "text" NOT NULL,
    "provider" "text" DEFAULT 'resend_email'::"text" NOT NULL,
    "recipient_email" "text",
    "status" "text" NOT NULL,
    "reason" "text",
    "provider_message_id" "text",
    "subject" "text",
    "message" "text",
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "email_message_logs_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'sent'::"text", 'failed'::"text", 'skipped'::"text"])))
);


ALTER TABLE "public"."email_message_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."financial_audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid",
    "actor_user_id" "uuid",
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid",
    "action" "text" NOT NULL,
    "amount_cents" integer,
    "currency" "text" DEFAULT 'eur'::"text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."financial_audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."manual_service_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "service_id" "uuid" NOT NULL,
    "staff_id" "uuid" NOT NULL,
    "client_id" "uuid",
    "performed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "amount" numeric(10,2) NOT NULL,
    "payment_method" "text" DEFAULT 'cash'::"text" NOT NULL,
    "notes" "text",
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "manual_service_entries_amount_check" CHECK (("amount" >= (0)::numeric)),
    CONSTRAINT "manual_service_entries_payment_method_check" CHECK (("payment_method" = ANY (ARRAY['cash'::"text", 'mb_way'::"text", 'multibanco'::"text", 'card'::"text", 'bank_transfer'::"text", 'other'::"text"]))),
    CONSTRAINT "manual_service_entries_source_check" CHECK (("source" = ANY (ARRAY['manual'::"text", 'walk_in'::"text"])))
);


ALTER TABLE "public"."manual_service_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "appointment_id" "uuid",
    "channel" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "recipient" "text" NOT NULL,
    "payload" "jsonb",
    "status" "text" DEFAULT 'sent'::"text" NOT NULL,
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."notifications_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."onboarding_progress" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "step" "text" NOT NULL,
    "completed_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."onboarding_progress" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payment_intents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "appointment_id" "uuid",
    "stripe_payment_intent_id" "text",
    "client_secret" "text",
    "amount_cents" integer NOT NULL,
    "currency" "text" DEFAULT 'eur'::"text" NOT NULL,
    "method" "text" NOT NULL,
    "status" "text" DEFAULT 'requires_action'::"text" NOT NULL,
    "multibanco_entity" "text",
    "multibanco_reference" "text",
    "hosted_voucher_url" "text",
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "booking_request_id" "uuid",
    "failure_reason" "text",
    "stripe_checkout_session_id" "text",
    "stripe_connect_account_id" "text",
    "stripe_charge_id" "text",
    "stripe_balance_transaction_id" "text",
    "gross_amount_cents" integer,
    "stripe_fee_cents" integer,
    "net_amount_cents" integer,
    "available_on" timestamp with time zone,
    "financial_details_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    CONSTRAINT "payment_intents_method_check" CHECK (("method" = ANY (ARRAY['mb_way'::"text", 'card'::"text", 'multibanco'::"text"]))),
    CONSTRAINT "payment_intents_status_check" CHECK (("status" = ANY (ARRAY['requires_action'::"text", 'processing'::"text", 'succeeded'::"text", 'failed'::"text", 'expired'::"text", 'canceled'::"text"])))
);


ALTER TABLE "public"."payment_intents" OWNER TO "postgres";


COMMENT ON CONSTRAINT "payment_intents_method_check" ON "public"."payment_intents" IS 'Historical Multibanco rows remain readable/updateable for expiry reconciliation. New checkout creation is restricted in backend code and studio settings to mb_way/card.';



CREATE TABLE IF NOT EXISTS "public"."platform_billing_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid",
    "stripe_event_id" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."platform_billing_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text",
    "avatar_url" "text",
    "phone" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."service_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "label" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."service_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."studios" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "tagline" "text",
    "description" "text",
    "hero_image_url" "text",
    "logo_url" "text",
    "brand_color" "text",
    "location" "text",
    "phone" "text",
    "email" "text",
    "whatsapp" "text",
    "instagram" "text",
    "timezone" "text" DEFAULT 'Europe/Lisbon'::"text" NOT NULL,
    "currency" "text" DEFAULT 'EUR'::"text" NOT NULL,
    "plan" "public"."subscription_plan" DEFAULT 'trial'::"public"."subscription_plan" NOT NULL,
    "trial_ends_at" timestamp with time zone DEFAULT ("now"() + '14 days'::interval),
    "is_active" boolean DEFAULT true NOT NULL,
    "rating" numeric(2,1),
    "reviews_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "onboarding_completed_at" timestamp with time zone,
    "payment_policy" "text" DEFAULT 'pre_payment'::"text" NOT NULL,
    "accepted_payment_methods" "text"[] DEFAULT ARRAY['mb_way'::"text", 'card'::"text"] NOT NULL,
    "deposit_percent" integer DEFAULT 25 NOT NULL,
    "commission_percent" integer DEFAULT 50 NOT NULL,
    "deposit_recipient" "text" DEFAULT 'studio'::"text" NOT NULL,
    "deposit_professional_percent" integer DEFAULT 0 NOT NULL,
    "stripe_customer_id" "text",
    "stripe_subscription_id" "text",
    "subscription_status" "text" DEFAULT 'trialing'::"text" NOT NULL,
    "subscription_current_period_end" timestamp with time zone,
    "subscription_cancel_at_period_end" boolean DEFAULT false NOT NULL,
    "premium_access_until" timestamp with time zone,
    "public_amenities" "jsonb" DEFAULT '{"wifi": true, "parking": {"type": "none", "available": false, "easy_access": false}, "comforts": {"tv": false, "other": "", "water": true, "coffee": false, "children": false, "accessibility": false, "air_conditioning": true}, "payments": {"card": false, "cash": true, "other": "", "mb_way": true, "multibanco": true}}'::"jsonb" NOT NULL,
    "min_booking_notice_min" integer DEFAULT 30 NOT NULL,
    "whatsapp_auto_send_enabled" boolean DEFAULT true NOT NULL,
    "whatsapp_default_message" "text",
    "business_segment" "text" DEFAULT 'beauty'::"text" NOT NULL,
    "hero_gallery_urls" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "cancellation_min_notice_hours" integer DEFAULT 24 NOT NULL,
    "cancellation_after_deadline_policy" "text" DEFAULT 'non_refundable'::"text" NOT NULL,
    "refund_requests_enabled" boolean DEFAULT true NOT NULL,
    "cancellation_policy_text" "text",
    "legal_policy_version" "text" DEFAULT '2026-05-28'::"text" NOT NULL,
    "trial_used_at" timestamp with time zone,
    "studio_policy_settings" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "stripe_connect_account_id" "text",
    "stripe_connect_charges_enabled" boolean DEFAULT false NOT NULL,
    "stripe_connect_payouts_enabled" boolean DEFAULT false NOT NULL,
    "stripe_connect_onboarding_completed" boolean DEFAULT false NOT NULL,
    "stripe_connect_status" "text" DEFAULT 'not_connected'::"text" NOT NULL,
    "referral_code" "text",
    "owner_name" "text",
    "trial_claimed_at" timestamp with time zone DEFAULT "now"(),
    "trial_identity_phone" "text",
    "trial_identity_studio_name" "text",
    "trial_identity_slug" "text",
    "trial_identity_ip_hash" "text",
    "trial_identity_device_fingerprint_hash" "text",
    "trial_identity_nif" "text",
    "trial_identity_stripe_account_id" "text",
    "trial_blocked_reason" "text",
    "staff_agenda_visibility" "text" DEFAULT 'private'::"text" NOT NULL,
    "stripe_connect_mb_way_payments_enabled" boolean DEFAULT false NOT NULL,
    "appointment_reminder_minutes" smallint DEFAULT 120 NOT NULL,
    "attendance_grace_minutes" smallint DEFAULT 30 NOT NULL,
    "booking_flow_mode" "text" DEFAULT 'online'::"text" NOT NULL,
    "booking_request_professional_mode" "text" DEFAULT 'hidden'::"text" NOT NULL,
    "plan_tier" "text" DEFAULT 'free'::"text" NOT NULL,
    CONSTRAINT "studios_accepted_payment_methods_no_multibanco" CHECK ((NOT ("accepted_payment_methods" @> ARRAY['multibanco'::"text"]))),
    CONSTRAINT "studios_appointment_reminder_minutes_range" CHECK ((("appointment_reminder_minutes" >= 0) AND ("appointment_reminder_minutes" <= 10080))),
    CONSTRAINT "studios_attendance_grace_minutes_range" CHECK ((("attendance_grace_minutes" >= 0) AND ("attendance_grace_minutes" <= 1440))),
    CONSTRAINT "studios_booking_flow_mode_check" CHECK (("booking_flow_mode" = ANY (ARRAY['online'::"text", 'request'::"text"]))),
    CONSTRAINT "studios_booking_request_professional_mode_check" CHECK (("booking_request_professional_mode" = ANY (ARRAY['hidden'::"text", 'showcase'::"text", 'preference'::"text"]))),
    CONSTRAINT "studios_business_segment_check" CHECK (("business_segment" = ANY (ARRAY['beauty'::"text", 'barbershop'::"text", 'nail_studio'::"text", 'clinic'::"text", 'other'::"text"]))),
    CONSTRAINT "studios_commission_percent_range" CHECK ((("commission_percent" >= 0) AND ("commission_percent" <= 100))),
    CONSTRAINT "studios_deposit_percent_check" CHECK ((("deposit_percent" >= 0) AND ("deposit_percent" <= 100))),
    CONSTRAINT "studios_deposit_professional_percent_range" CHECK ((("deposit_professional_percent" >= 0) AND ("deposit_professional_percent" <= 100))),
    CONSTRAINT "studios_deposit_recipient_valid" CHECK (("deposit_recipient" = ANY (ARRAY['studio'::"text", 'professional'::"text", 'split'::"text"]))),
    CONSTRAINT "studios_min_booking_notice_min_range" CHECK ((("min_booking_notice_min" >= 0) AND ("min_booking_notice_min" <= 10080))),
    CONSTRAINT "studios_payment_policy_check" CHECK (("payment_policy" = ANY (ARRAY['pay_in_studio'::"text", 'pre_payment'::"text"]))),
    CONSTRAINT "studios_plan_tier_valid" CHECK (("plan_tier" = ANY (ARRAY['free'::"text", 'pro'::"text", 'premium'::"text"]))),
    CONSTRAINT "studios_staff_agenda_visibility_check" CHECK (("staff_agenda_visibility" = ANY (ARRAY['private'::"text", 'team_busy'::"text", 'team_basic'::"text"]))),
    CONSTRAINT "studios_subscription_status_valid" CHECK (("subscription_status" = ANY (ARRAY['trialing'::"text", 'active'::"text", 'past_due'::"text", 'canceled'::"text", 'unpaid'::"text", 'incomplete'::"text", 'incomplete_expired'::"text", 'paused'::"text"])))
);


ALTER TABLE "public"."studios" OWNER TO "postgres";


COMMENT ON COLUMN "public"."studios"."deposit_percent" IS 'Percentagem do total cobrada como sinal online quando payment_policy = pre_payment. 100 = pagamento integral; <100 = sinal, restante pago no estúdio.';



COMMENT ON COLUMN "public"."studios"."deposit_recipient" IS 'Destino padrao do sinal online: studio, professional ou split.';



COMMENT ON COLUMN "public"."studios"."deposit_professional_percent" IS 'Percentual do sinal que entra para a profissional quando deposit_recipient = split.';



COMMENT ON COLUMN "public"."studios"."stripe_customer_id" IS 'Stripe Customer ID usado para assinatura recorrente da plataforma.';



COMMENT ON COLUMN "public"."studios"."stripe_subscription_id" IS 'Stripe Subscription ID ativo ou mais recente.';



COMMENT ON COLUMN "public"."studios"."subscription_status" IS 'Status Stripe sincronizado por checkout/webhook.';



COMMENT ON COLUMN "public"."studios"."premium_access_until" IS 'Data limite de acesso premium quando aplicavel.';



COMMENT ON COLUMN "public"."studios"."min_booking_notice_min" IS 'Antecedencia minima, em minutos, para permitir uma marcacao publica.';



COMMENT ON COLUMN "public"."studios"."trial_used_at" IS 'When trial was first claimed. Prevents infinite trial reuse exploit.';



COMMENT ON COLUMN "public"."studios"."studio_policy_settings" IS 'Structured policy settings edited from the studio compliance center. Operational payment/refund fields remain authoritative for booking flows.';



COMMENT ON COLUMN "public"."studios"."staff_agenda_visibility" IS 'Controls what staff users can see in the admin agenda: private, team_busy, or team_basic.';



COMMENT ON COLUMN "public"."studios"."plan_tier" IS 'Commercial tier selected by trusted billing flows. Effective access may be Premium during the 14-day trial and Free after expiry.';



CREATE OR REPLACE VIEW "public"."public_service_categories" WITH ("security_barrier"='true') AS
 SELECT "category"."id",
    "category"."studio_id",
    "category"."label",
    "category"."sort_order"
   FROM ("public"."service_categories" "category"
     JOIN "public"."studios" "studio" ON (("studio"."id" = "category"."studio_id")))
  WHERE ("studio"."is_active" = true);


ALTER VIEW "public"."public_service_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."services" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "category_id" "uuid",
    "name" "text" NOT NULL,
    "description" "text",
    "duration_min" integer NOT NULL,
    "price" numeric(10,2) NOT NULL,
    "is_recommended" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "media" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "commission_percent" integer,
    "deposit_recipient" "text",
    "deposit_professional_percent" integer,
    CONSTRAINT "services_commission_percent_range" CHECK ((("commission_percent" IS NULL) OR (("commission_percent" >= 0) AND ("commission_percent" <= 100)))),
    CONSTRAINT "services_deposit_professional_percent_range" CHECK ((("deposit_professional_percent" IS NULL) OR (("deposit_professional_percent" >= 0) AND ("deposit_professional_percent" <= 100)))),
    CONSTRAINT "services_deposit_recipient_valid" CHECK ((("deposit_recipient" IS NULL) OR ("deposit_recipient" = ANY (ARRAY['studio'::"text", 'professional'::"text", 'split'::"text"])))),
    CONSTRAINT "services_duration_min_check" CHECK (("duration_min" >= 0)),
    CONSTRAINT "services_price_check" CHECK (("price" >= (0)::numeric))
);


ALTER TABLE "public"."services" OWNER TO "postgres";


COMMENT ON COLUMN "public"."services"."duration_min" IS 'Duration in minutes. Zero is allowed for extras that do not consume agenda time.';



COMMENT ON COLUMN "public"."services"."commission_percent" IS 'Override opcional de comissao para este servico.';



CREATE OR REPLACE VIEW "public"."public_services" WITH ("security_barrier"='true') AS
 SELECT "service"."id",
    "service"."studio_id",
    "service"."category_id",
    "service"."name",
    "service"."description",
    "service"."duration_min",
    "service"."price",
    "service"."is_recommended",
    "service"."is_active",
    "service"."media",
    "service"."sort_order"
   FROM ("public"."services" "service"
     JOIN "public"."studios" "studio" ON (("studio"."id" = "service"."studio_id")))
  WHERE (("studio"."is_active" = true) AND ("service"."is_active" = true));


ALTER VIEW "public"."public_services" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."staff" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "name" "text" NOT NULL,
    "role" "text",
    "bio" "text",
    "photo_url" "text",
    "rating" numeric(2,1),
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "commission_percent" integer,
    "deposit_recipient" "text",
    "deposit_professional_percent" integer,
    "whatsapp" "text",
    "invite_token" "text",
    "invite_role" "text",
    "invite_status" "text" DEFAULT 'pending'::"text",
    "invite_expires_at" timestamp with time zone,
    "invite_code" "text",
    "current_status" "text" DEFAULT 'available'::"text" NOT NULL,
    "reviews_count" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "staff_commission_percent_range" CHECK ((("commission_percent" IS NULL) OR (("commission_percent" >= 0) AND ("commission_percent" <= 100)))),
    CONSTRAINT "staff_current_status_check" CHECK (("current_status" = ANY (ARRAY['online'::"text", 'available'::"text", 'busy'::"text", 'absent'::"text"]))),
    CONSTRAINT "staff_deposit_professional_percent_range" CHECK ((("deposit_professional_percent" IS NULL) OR (("deposit_professional_percent" >= 0) AND ("deposit_professional_percent" <= 100)))),
    CONSTRAINT "staff_deposit_recipient_valid" CHECK ((("deposit_recipient" IS NULL) OR ("deposit_recipient" = ANY (ARRAY['studio'::"text", 'professional'::"text", 'split'::"text"]))))
);


ALTER TABLE "public"."staff" OWNER TO "postgres";


COMMENT ON COLUMN "public"."staff"."commission_percent" IS 'Override opcional de comissao para esta profissional.';



COMMENT ON COLUMN "public"."staff"."current_status" IS 'Manual status: online=immed+future, available=future only, busy=active now, absent=hidden';



CREATE OR REPLACE VIEW "public"."public_staff" WITH ("security_barrier"='true') AS
 SELECT "member"."id",
    "member"."studio_id",
    "member"."name",
    "member"."role",
    "member"."bio",
    "member"."photo_url",
    "member"."rating",
    "member"."reviews_count",
    "member"."is_active",
    "member"."current_status",
    "member"."sort_order"
   FROM ("public"."staff" "member"
     JOIN "public"."studios" "studio" ON (("studio"."id" = "member"."studio_id")))
  WHERE (("studio"."is_active" = true) AND ("member"."is_active" = true) AND "public"."studio_staff_is_within_plan"("member"."studio_id", "member"."id"));


ALTER VIEW "public"."public_staff" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."staff_services" (
    "staff_id" "uuid" NOT NULL,
    "service_id" "uuid" NOT NULL
);


ALTER TABLE "public"."staff_services" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."public_staff_services" WITH ("security_barrier"='true') AS
 SELECT "member"."studio_id",
    "link"."staff_id",
    "link"."service_id"
   FROM ((("public"."staff_services" "link"
     JOIN "public"."staff" "member" ON ((("member"."id" = "link"."staff_id") AND ("member"."is_active" = true))))
     JOIN "public"."services" "service" ON ((("service"."id" = "link"."service_id") AND ("service"."studio_id" = "member"."studio_id") AND ("service"."is_active" = true))))
     JOIN "public"."studios" "studio" ON ((("studio"."id" = "member"."studio_id") AND ("studio"."is_active" = true))))
  WHERE "public"."studio_staff_is_within_plan"("member"."studio_id", "member"."id");


ALTER VIEW "public"."public_staff_services" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."public_studios" WITH ("security_barrier"='true') AS
 SELECT "id",
    "slug",
    "name",
    "tagline",
    "description",
    "hero_image_url",
    "hero_gallery_urls",
    "logo_url",
    "brand_color",
    "location",
    "phone",
    "email",
    "whatsapp",
    "instagram",
    "timezone",
    "currency",
    "is_active",
        CASE
            WHEN "public"."studio_has_entitlement"("id", 'reviews'::"text") THEN "rating"
            ELSE NULL::numeric(2,1)
        END AS "rating",
        CASE
            WHEN "public"."studio_has_entitlement"("id", 'reviews'::"text") THEN "reviews_count"
            ELSE 0
        END AS "reviews_count",
    "updated_at",
        CASE
            WHEN "public"."studio_has_entitlement"("id", 'online_payments'::"text") THEN "payment_policy"
            ELSE 'pay_in_studio'::"text"
        END AS "payment_policy",
        CASE
            WHEN "public"."studio_has_entitlement"("id", 'online_payments'::"text") THEN "accepted_payment_methods"
            ELSE ARRAY[]::"text"[]
        END AS "accepted_payment_methods",
        CASE
            WHEN "public"."studio_has_entitlement"("id", 'online_payments'::"text") THEN "deposit_percent"
            ELSE 0
        END AS "deposit_percent",
    "public_amenities",
    "min_booking_notice_min",
    "business_segment",
    "cancellation_min_notice_hours",
    "cancellation_after_deadline_policy",
        CASE
            WHEN "public"."studio_has_entitlement"("id", 'online_payments'::"text") THEN "refund_requests_enabled"
            ELSE false
        END AS "refund_requests_enabled",
    "cancellation_policy_text",
    "legal_policy_version",
        CASE
            WHEN "public"."studio_has_entitlement"("id", 'online_payments'::"text") THEN "stripe_connect_charges_enabled"
            ELSE false
        END AS "stripe_connect_charges_enabled",
        CASE
            WHEN "public"."studio_has_entitlement"("id", 'online_payments'::"text") THEN "stripe_connect_onboarding_completed"
            ELSE false
        END AS "stripe_connect_onboarding_completed",
        CASE
            WHEN "public"."studio_has_entitlement"("id", 'online_payments'::"text") THEN "stripe_connect_mb_way_payments_enabled"
            ELSE false
        END AS "stripe_connect_mb_way_payments_enabled",
        CASE
            WHEN "public"."studio_has_entitlement"("id", 'whatsapp'::"text") THEN "booking_flow_mode"
            ELSE 'online'::"text"
        END AS "booking_flow_mode",
        CASE
            WHEN "public"."studio_has_entitlement"("id", 'whatsapp'::"text") THEN "booking_request_professional_mode"
            ELSE 'hidden'::"text"
        END AS "booking_request_professional_mode",
    "public"."studio_has_entitlement"("id", 'notifications'::"text") AS "notifications_enabled"
   FROM "public"."studios" "studio"
  WHERE (("is_active" = true) AND "public"."studio_has_entitlement"("id", 'public_page'::"text"));


ALTER VIEW "public"."public_studios" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."upsell_offers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "trigger_service_id" "uuid" NOT NULL,
    "offered_service_id" "uuid" NOT NULL,
    "discounted_price" numeric(10,2) NOT NULL,
    "description" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "conversions_count" integer DEFAULT 0 NOT NULL,
    "extra_revenue" numeric(10,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "views_count" integer DEFAULT 0 NOT NULL,
    "discount_type" "text" DEFAULT 'price'::"text" NOT NULL,
    "discount_value" numeric(10,2),
    "display_mode" "text" DEFAULT 'both'::"text" NOT NULL,
    "duration_min" integer,
    CONSTRAINT "upsell_offers_discount_type_check" CHECK (("discount_type" = ANY (ARRAY['price'::"text", 'percent'::"text", 'fixed'::"text"]))),
    CONSTRAINT "upsell_offers_display_mode_check" CHECK (("display_mode" = ANY (ARRAY['percent'::"text", 'amount'::"text", 'both'::"text"]))),
    CONSTRAINT "upsell_offers_duration_min_check" CHECK ((("duration_min" IS NULL) OR ("duration_min" >= 0)))
);


ALTER TABLE "public"."upsell_offers" OWNER TO "postgres";


COMMENT ON COLUMN "public"."upsell_offers"."discount_type" IS 'How the studio configures the upsell discount: price=final price, percent=percentage off, fixed=fixed amount off.';



COMMENT ON COLUMN "public"."upsell_offers"."discount_value" IS 'Configured discount value. Percent uses 0-100; fixed uses currency amount; price can keep null for legacy rows.';



COMMENT ON COLUMN "public"."upsell_offers"."display_mode" IS 'How the public checkout highlights the offer: percent, amount or both.';



COMMENT ON COLUMN "public"."upsell_offers"."duration_min" IS 'Optional duration override. Null uses the service duration; zero adds no agenda time.';



CREATE OR REPLACE VIEW "public"."public_upsell_offers" WITH ("security_barrier"='true') AS
 SELECT "offer"."id",
    "offer"."studio_id",
    "offer"."trigger_service_id",
    "offer"."offered_service_id",
    "offer"."discounted_price",
    "offer"."description",
    "offer"."is_active",
    "offer"."discount_type",
    "offer"."discount_value",
    "offer"."display_mode",
    "offer"."duration_min"
   FROM ("public"."upsell_offers" "offer"
     JOIN "public"."studios" "studio" ON (("studio"."id" = "offer"."studio_id")))
  WHERE (("studio"."is_active" = true) AND ("offer"."is_active" = true) AND "public"."studio_has_entitlement"("offer"."studio_id", 'promotions'::"text"));


ALTER VIEW "public"."public_upsell_offers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."push_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "studio_id" "uuid",
    "client_id" "uuid",
    "audience" "text" NOT NULL,
    "endpoint" "text" NOT NULL,
    "p256dh" "text" NOT NULL,
    "auth" "text" NOT NULL,
    "expiration_time" bigint,
    "user_agent" "text",
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "revoked_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "revocation_reason" "text",
    CONSTRAINT "push_subscriptions_audience_check" CHECK (("audience" = ANY (ARRAY['client'::"text", 'studio'::"text", 'both'::"text"])))
);


ALTER TABLE "public"."push_subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."referral_credits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "referral_id" "uuid",
    "amount_cents" integer DEFAULT 899 NOT NULL,
    "status" "text" DEFAULT 'available'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "applied_at" timestamp with time zone,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '6 mons'::interval) NOT NULL,
    CONSTRAINT "referral_credits_positive_amount" CHECK (("amount_cents" > 0)),
    CONSTRAINT "referral_credits_valid_status" CHECK (("status" = ANY (ARRAY['available'::"text", 'applied'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."referral_credits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."referrals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "referrer_studio_id" "uuid" NOT NULL,
    "referred_studio_id" "uuid" NOT NULL,
    "ref_code" "text" NOT NULL,
    "status" "text" DEFAULT 'pending_validation'::"text" NOT NULL,
    "rejected_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "subscription_started_at" timestamp with time zone,
    "validated_at" timestamp with time zone,
    "credited_at" timestamp with time zone,
    CONSTRAINT "referrals_no_self_referral" CHECK (("referrer_studio_id" <> "referred_studio_id")),
    CONSTRAINT "referrals_valid_status" CHECK (("status" = ANY (ARRAY['pending_validation'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."referrals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."refund_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "appointment_id" "uuid",
    "booking_request_id" "uuid",
    "payment_intent_id" "uuid",
    "client_name" "text",
    "client_phone" "text",
    "client_email" "text",
    "reason" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "decision_note" "text",
    "reviewed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "platform_processed_at" timestamp with time zone,
    "platform_processed_by" "uuid",
    "stripe_refund_id" "text",
    "refund_method" "text",
    "admin_notes" "text",
    CONSTRAINT "refund_requests_status_valid" CHECK (("status" = ANY (ARRAY['pending'::"text", 'in_review'::"text", 'approved'::"text", 'rejected'::"text", 'refunded'::"text"])))
);


ALTER TABLE "public"."refund_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."server_rate_limits" (
    "key" "text" NOT NULL,
    "count" integer DEFAULT 0 NOT NULL,
    "reset_at" timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."server_rate_limits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."service_category_suggestions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "label" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."service_category_suggestions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."staff_availability" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "staff_id" "uuid" NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "weekday" smallint NOT NULL,
    "start_time" time without time zone NOT NULL,
    "end_time" time without time zone NOT NULL,
    CONSTRAINT "staff_availability_check" CHECK (("end_time" > "start_time")),
    CONSTRAINT "staff_availability_weekday_check" CHECK ((("weekday" >= 0) AND ("weekday" <= 6)))
);


ALTER TABLE "public"."staff_availability" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."staff_time_off" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "staff_id" "uuid" NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "starts_at" timestamp with time zone NOT NULL,
    "ends_at" timestamp with time zone NOT NULL,
    "reason" "text",
    CONSTRAINT "staff_time_off_check" CHECK (("ends_at" > "starts_at"))
);


ALTER TABLE "public"."staff_time_off" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."studio_follows" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."studio_follows" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."studio_notification_deliveries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "notification_id" "uuid" NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "subscription_id" "uuid",
    "endpoint_fingerprint" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "next_attempt_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "lease_until" timestamp with time zone,
    "accepted_at" timestamp with time zone,
    "last_attempt_at" timestamp with time zone,
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "receipt_token" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "received_at" timestamp with time zone,
    "displayed_at" timestamp with time zone,
    CONSTRAINT "studio_notification_deliveries_attempt_count_check" CHECK (("attempt_count" >= 0)),
    CONSTRAINT "studio_notification_deliveries_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'delivering'::"text", 'retry'::"text", 'sent'::"text", 'failed'::"text", 'skipped'::"text"])))
);


ALTER TABLE "public"."studio_notification_deliveries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."studio_notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "kind" "text" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "event_key" "text",
    "action_url" "text",
    "appointment_id" "uuid",
    CONSTRAINT "studio_notifications_kind_check" CHECK (("kind" = ANY (ARRAY['new_appointment'::"text", 'appointment_rescheduled'::"text", 'appointment_cancelled'::"text", 'appointment_reminder'::"text", 'attendance_confirmation'::"text", 'attendance_summary'::"text", 'payment_confirmed'::"text", 'payment_failed'::"text", 'new_client'::"text", 'new_review'::"text", 'refund_request'::"text", 'withdrawal_requested'::"text", 'critical_request'::"text"])))
);


ALTER TABLE "public"."studio_notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."studio_payout_settings" (
    "studio_id" "uuid" NOT NULL,
    "fiscal_name" "text" NOT NULL,
    "nif" "text" NOT NULL,
    "payout_mode" "text" DEFAULT 'manual'::"text" NOT NULL,
    "payout_method" "text" DEFAULT 'iban'::"text" NOT NULL,
    "iban" "text",
    "mb_way_phone" "text",
    "stripe_account_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "studio_payout_settings_destination_check" CHECK (((("payout_method" = 'iban'::"text") AND ("iban" IS NOT NULL)) OR (("payout_method" = 'mb_way'::"text") AND ("mb_way_phone" IS NOT NULL)) OR (("payout_method" = 'stripe'::"text") AND ("stripe_account_id" IS NOT NULL)))),
    CONSTRAINT "studio_payout_settings_payout_method_check" CHECK (("payout_method" = ANY (ARRAY['iban'::"text", 'mb_way'::"text", 'stripe'::"text"]))),
    CONSTRAINT "studio_payout_settings_payout_mode_check" CHECK (("payout_mode" = ANY (ARRAY['manual'::"text", 'stripe_automatic'::"text"])))
);


ALTER TABLE "public"."studio_payout_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."studio_plan_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "previous_tier" "text",
    "new_tier" "text" NOT NULL,
    "previous_status" "text",
    "new_status" "text",
    "reason" "text" DEFAULT 'subscription_sync'::"text" NOT NULL,
    "stripe_event_id" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "studio_plan_events_new_tier_check" CHECK (("new_tier" = ANY (ARRAY['free'::"text", 'pro'::"text", 'premium'::"text"]))),
    CONSTRAINT "studio_plan_events_previous_tier_check" CHECK ((("previous_tier" IS NULL) OR ("previous_tier" = ANY (ARRAY['free'::"text", 'pro'::"text", 'premium'::"text"]))))
);


ALTER TABLE "public"."studio_plan_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."studio_reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "appointment_id" "uuid",
    "rating" smallint NOT NULL,
    "comment" "text",
    "staff_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "reviewer_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "studio_reviews_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 5)))
);


ALTER TABLE "public"."studio_reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."studio_trial_extension_backup_20260719_1910" (
    "backed_up_at" timestamp with time zone,
    "id" "uuid",
    "slug" "text",
    "name" "text",
    "tagline" "text",
    "description" "text",
    "hero_image_url" "text",
    "logo_url" "text",
    "brand_color" "text",
    "location" "text",
    "phone" "text",
    "email" "text",
    "whatsapp" "text",
    "instagram" "text",
    "timezone" "text",
    "currency" "text",
    "plan" "public"."subscription_plan",
    "trial_ends_at" timestamp with time zone,
    "is_active" boolean,
    "rating" numeric(2,1),
    "reviews_count" integer,
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "onboarding_completed_at" timestamp with time zone,
    "payment_policy" "text",
    "accepted_payment_methods" "text"[],
    "deposit_percent" integer,
    "commission_percent" integer,
    "deposit_recipient" "text",
    "deposit_professional_percent" integer,
    "stripe_customer_id" "text",
    "stripe_subscription_id" "text",
    "subscription_status" "text",
    "subscription_current_period_end" timestamp with time zone,
    "subscription_cancel_at_period_end" boolean,
    "premium_access_until" timestamp with time zone,
    "public_amenities" "jsonb",
    "min_booking_notice_min" integer,
    "whatsapp_auto_send_enabled" boolean,
    "whatsapp_default_message" "text",
    "business_segment" "text",
    "hero_gallery_urls" "jsonb",
    "cancellation_min_notice_hours" integer,
    "cancellation_after_deadline_policy" "text",
    "refund_requests_enabled" boolean,
    "cancellation_policy_text" "text",
    "legal_policy_version" "text",
    "trial_used_at" timestamp with time zone,
    "studio_policy_settings" "jsonb",
    "stripe_connect_account_id" "text",
    "stripe_connect_charges_enabled" boolean,
    "stripe_connect_payouts_enabled" boolean,
    "stripe_connect_onboarding_completed" boolean,
    "stripe_connect_status" "text",
    "referral_code" "text",
    "owner_name" "text",
    "trial_claimed_at" timestamp with time zone,
    "trial_identity_phone" "text",
    "trial_identity_studio_name" "text",
    "trial_identity_slug" "text",
    "trial_identity_ip_hash" "text",
    "trial_identity_device_fingerprint_hash" "text",
    "trial_identity_nif" "text",
    "trial_identity_stripe_account_id" "text",
    "trial_blocked_reason" "text",
    "staff_agenda_visibility" "text",
    "stripe_connect_mb_way_payments_enabled" boolean
);


ALTER TABLE "public"."studio_trial_extension_backup_20260719_1910" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."studios_cancel_flag_backup_20260705_194119" (
    "id" "uuid",
    "slug" "text",
    "subscription_cancel_at_period_end" boolean,
    "subscription_status" "text",
    "trial_ends_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "backed_up_at" timestamp with time zone
);


ALTER TABLE "public"."studios_cancel_flag_backup_20260705_194119" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."studios_trial_renewal_backup_20260821" (
    "backed_up_at" timestamp with time zone,
    "id" "uuid",
    "slug" "text",
    "name" "text",
    "tagline" "text",
    "description" "text",
    "hero_image_url" "text",
    "logo_url" "text",
    "brand_color" "text",
    "location" "text",
    "phone" "text",
    "email" "text",
    "whatsapp" "text",
    "instagram" "text",
    "timezone" "text",
    "currency" "text",
    "plan" "public"."subscription_plan",
    "trial_ends_at" timestamp with time zone,
    "is_active" boolean,
    "rating" numeric(2,1),
    "reviews_count" integer,
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "onboarding_completed_at" timestamp with time zone,
    "payment_policy" "text",
    "accepted_payment_methods" "text"[],
    "deposit_percent" integer,
    "commission_percent" integer,
    "deposit_recipient" "text",
    "deposit_professional_percent" integer,
    "stripe_customer_id" "text",
    "stripe_subscription_id" "text",
    "subscription_status" "text",
    "subscription_current_period_end" timestamp with time zone,
    "subscription_cancel_at_period_end" boolean,
    "premium_access_until" timestamp with time zone,
    "public_amenities" "jsonb",
    "min_booking_notice_min" integer,
    "whatsapp_auto_send_enabled" boolean,
    "whatsapp_default_message" "text",
    "business_segment" "text",
    "hero_gallery_urls" "jsonb",
    "cancellation_min_notice_hours" integer,
    "cancellation_after_deadline_policy" "text",
    "refund_requests_enabled" boolean,
    "cancellation_policy_text" "text",
    "legal_policy_version" "text",
    "trial_used_at" timestamp with time zone,
    "studio_policy_settings" "jsonb",
    "stripe_connect_account_id" "text",
    "stripe_connect_charges_enabled" boolean,
    "stripe_connect_payouts_enabled" boolean,
    "stripe_connect_onboarding_completed" boolean,
    "stripe_connect_status" "text",
    "referral_code" "text",
    "owner_name" "text",
    "trial_claimed_at" timestamp with time zone,
    "trial_identity_phone" "text",
    "trial_identity_studio_name" "text",
    "trial_identity_slug" "text",
    "trial_identity_ip_hash" "text",
    "trial_identity_device_fingerprint_hash" "text",
    "trial_identity_nif" "text",
    "trial_identity_stripe_account_id" "text",
    "trial_blocked_reason" "text",
    "staff_agenda_visibility" "text",
    "stripe_connect_mb_way_payments_enabled" boolean
);


ALTER TABLE "public"."studios_trial_renewal_backup_20260821" OWNER TO "postgres";


COMMENT ON TABLE "public"."studios_trial_renewal_backup_20260821" IS 'Rollback snapshot before the 2026-08-21 Bellza-wide 14-day trial renewal.';



CREATE TABLE IF NOT EXISTS "public"."studios_trial_reset_backup_20260807" (
    "backed_up_at" timestamp with time zone,
    "id" "uuid",
    "slug" "text",
    "name" "text",
    "tagline" "text",
    "description" "text",
    "hero_image_url" "text",
    "logo_url" "text",
    "brand_color" "text",
    "location" "text",
    "phone" "text",
    "email" "text",
    "whatsapp" "text",
    "instagram" "text",
    "timezone" "text",
    "currency" "text",
    "plan" "public"."subscription_plan",
    "trial_ends_at" timestamp with time zone,
    "is_active" boolean,
    "rating" numeric(2,1),
    "reviews_count" integer,
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "onboarding_completed_at" timestamp with time zone,
    "payment_policy" "text",
    "accepted_payment_methods" "text"[],
    "deposit_percent" integer,
    "commission_percent" integer,
    "deposit_recipient" "text",
    "deposit_professional_percent" integer,
    "stripe_customer_id" "text",
    "stripe_subscription_id" "text",
    "subscription_status" "text",
    "subscription_current_period_end" timestamp with time zone,
    "subscription_cancel_at_period_end" boolean,
    "premium_access_until" timestamp with time zone,
    "public_amenities" "jsonb",
    "min_booking_notice_min" integer,
    "whatsapp_auto_send_enabled" boolean,
    "whatsapp_default_message" "text",
    "business_segment" "text",
    "hero_gallery_urls" "jsonb",
    "cancellation_min_notice_hours" integer,
    "cancellation_after_deadline_policy" "text",
    "refund_requests_enabled" boolean,
    "cancellation_policy_text" "text",
    "legal_policy_version" "text",
    "trial_used_at" timestamp with time zone,
    "studio_policy_settings" "jsonb",
    "stripe_connect_account_id" "text",
    "stripe_connect_charges_enabled" boolean,
    "stripe_connect_payouts_enabled" boolean,
    "stripe_connect_onboarding_completed" boolean,
    "stripe_connect_status" "text",
    "referral_code" "text",
    "owner_name" "text",
    "trial_claimed_at" timestamp with time zone,
    "trial_identity_phone" "text",
    "trial_identity_studio_name" "text",
    "trial_identity_slug" "text",
    "trial_identity_ip_hash" "text",
    "trial_identity_device_fingerprint_hash" "text",
    "trial_identity_nif" "text",
    "trial_identity_stripe_account_id" "text",
    "trial_blocked_reason" "text",
    "staff_agenda_visibility" "text",
    "stripe_connect_mb_way_payments_enabled" boolean
);


ALTER TABLE "public"."studios_trial_reset_backup_20260807" OWNER TO "postgres";


COMMENT ON TABLE "public"."studios_trial_reset_backup_20260807" IS 'Complete rollback snapshot before the 2026-08-07 14-day trial grant.';



CREATE TABLE IF NOT EXISTS "public"."studios_trial_restore_backup_20260705_190426" (
    "id" "uuid",
    "slug" "text",
    "name" "text",
    "subscription_status" "text",
    "subscription_current_period_end" timestamp with time zone,
    "premium_access_until" timestamp with time zone,
    "trial_ends_at" timestamp with time zone,
    "trial_claimed_at" timestamp with time zone,
    "trial_blocked_reason" "text",
    "updated_at" timestamp with time zone,
    "backed_up_at" timestamp with time zone
);


ALTER TABLE "public"."studios_trial_restore_backup_20260705_190426" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "studio_id" "uuid",
    "stripe_customer_id" "text" NOT NULL,
    "stripe_subscription_id" "text" NOT NULL,
    "stripe_price_id" "text" NOT NULL,
    "plan" "text" NOT NULL,
    "status" "text" NOT NULL,
    "current_period_end" timestamp with time zone,
    "cancel_at_period_end" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "plan_tier" "text",
    CONSTRAINT "subscriptions_plan_check" CHECK (("plan" = ANY (ARRAY['monthly'::"text", 'quarterly'::"text", 'yearly'::"text"]))),
    CONSTRAINT "subscriptions_plan_tier_valid" CHECK ((("plan_tier" IS NULL) OR ("plan_tier" = ANY (ARRAY['pro'::"text", 'premium'::"text"])))),
    CONSTRAINT "subscriptions_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'trialing'::"text", 'past_due'::"text", 'canceled'::"text", 'unpaid'::"text", 'incomplete'::"text", 'incomplete_expired'::"text", 'paused'::"text", 'checkout_pending'::"text"])))
);


ALTER TABLE "public"."subscriptions" OWNER TO "postgres";


COMMENT ON TABLE "public"."subscriptions" IS 'Stripe platform subscriptions. Written only by trusted backend/service role webhook flow.';



COMMENT ON COLUMN "public"."subscriptions"."plan" IS 'Billing interval (monthly, quarterly legacy, yearly). Product tier is stored in subscriptions.plan_tier.';



COMMENT ON COLUMN "public"."subscriptions"."plan_tier" IS 'Server-validated Bellza product tier associated with the Stripe price.';



CREATE TABLE IF NOT EXISTS "public"."subscriptions_trial_renewal_backup_20260821" (
    "backed_up_at" timestamp with time zone,
    "id" "uuid",
    "user_id" "uuid",
    "studio_id" "uuid",
    "stripe_customer_id" "text",
    "stripe_subscription_id" "text",
    "stripe_price_id" "text",
    "plan" "text",
    "status" "text",
    "current_period_end" timestamp with time zone,
    "cancel_at_period_end" boolean,
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone
);


ALTER TABLE "public"."subscriptions_trial_renewal_backup_20260821" OWNER TO "postgres";


COMMENT ON TABLE "public"."subscriptions_trial_renewal_backup_20260821" IS 'Subscription snapshot paired with studios_trial_renewal_backup_20260821.';



CREATE TABLE IF NOT EXISTS "public"."subscriptions_trial_reset_backup_20260807" (
    "backed_up_at" timestamp with time zone,
    "id" "uuid",
    "user_id" "uuid",
    "studio_id" "uuid",
    "stripe_customer_id" "text",
    "stripe_subscription_id" "text",
    "stripe_price_id" "text",
    "plan" "text",
    "status" "text",
    "current_period_end" timestamp with time zone,
    "cancel_at_period_end" boolean,
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone
);


ALTER TABLE "public"."subscriptions_trial_reset_backup_20260807" OWNER TO "postgres";


COMMENT ON TABLE "public"."subscriptions_trial_reset_backup_20260807" IS 'Subscription snapshot paired with studios_trial_reset_backup_20260807.';



CREATE TABLE IF NOT EXISTS "public"."user_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "studio_id" "uuid",
    "role" "public"."app_role" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."whatsapp_admin_audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid",
    "actor_user_id" "uuid",
    "action" "text" NOT NULL,
    "before_state" "jsonb",
    "after_state" "jsonb",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."whatsapp_admin_audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."whatsapp_message_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "appointment_id" "uuid",
    "payment_intent_id" "uuid",
    "idempotency_key" "text" NOT NULL,
    "provider" "text" DEFAULT 'twilio_whatsapp_sandbox'::"text" NOT NULL,
    "recipient_phone" "text",
    "status" "text" NOT NULL,
    "reason" "text",
    "provider_message_id" "text",
    "message" "text",
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "whatsapp_message_logs_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'sent'::"text", 'failed'::"text", 'skipped'::"text"])))
);


ALTER TABLE "public"."whatsapp_message_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."whatsapp_platform_settings" (
    "id" smallint DEFAULT 1 NOT NULL,
    "global_enabled" boolean DEFAULT true NOT NULL,
    "trial_enabled" boolean DEFAULT true NOT NULL,
    "trial_duration_days" integer DEFAULT 14 NOT NULL,
    "trial_message_limit" integer DEFAULT 100 NOT NULL,
    "alert_thresholds" integer[] DEFAULT ARRAY[70, 90, 100] NOT NULL,
    "post_trial_mode" "text" DEFAULT 'inactive'::"text" NOT NULL,
    "billing_mode" "text" DEFAULT 'disabled'::"text" NOT NULL,
    "provider_cost_per_message_cents" integer,
    "commercial_price_cents" integer,
    "commercial_included_messages" integer,
    "commercial_excess_message_cents" integer,
    "currency" "text" DEFAULT 'eur'::"text" NOT NULL,
    "provider_contract_verified_at" timestamp with time zone,
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "premium_message_limit" integer DEFAULT 500 NOT NULL,
    CONSTRAINT "whatsapp_platform_settings_billing_mode_check" CHECK (("billing_mode" = ANY (ARRAY['disabled'::"text", 'manual'::"text", 'automatic'::"text"]))),
    CONSTRAINT "whatsapp_platform_settings_commercial_excess_message_cent_check" CHECK ((("commercial_excess_message_cents" IS NULL) OR ("commercial_excess_message_cents" >= 0))),
    CONSTRAINT "whatsapp_platform_settings_commercial_included_messages_check" CHECK ((("commercial_included_messages" IS NULL) OR ("commercial_included_messages" >= 0))),
    CONSTRAINT "whatsapp_platform_settings_commercial_price_cents_check" CHECK ((("commercial_price_cents" IS NULL) OR ("commercial_price_cents" >= 0))),
    CONSTRAINT "whatsapp_platform_settings_id_check" CHECK (("id" = 1)),
    CONSTRAINT "whatsapp_platform_settings_post_trial_mode_check" CHECK (("post_trial_mode" = ANY (ARRAY['inactive'::"text", 'manual_addon'::"text"]))),
    CONSTRAINT "whatsapp_platform_settings_premium_message_limit_check" CHECK (("premium_message_limit" >= 0)),
    CONSTRAINT "whatsapp_platform_settings_provider_cost_per_message_cent_check" CHECK ((("provider_cost_per_message_cents" IS NULL) OR ("provider_cost_per_message_cents" >= 0))),
    CONSTRAINT "whatsapp_platform_settings_trial_duration_days_check" CHECK ((("trial_duration_days" >= 1) AND ("trial_duration_days" <= 365))),
    CONSTRAINT "whatsapp_platform_settings_trial_message_limit_check" CHECK (("trial_message_limit" >= 0))
);


ALTER TABLE "public"."whatsapp_platform_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."whatsapp_studio_entitlements" (
    "studio_id" "uuid" NOT NULL,
    "status" "text" NOT NULL,
    "trial_started_at" timestamp with time zone,
    "trial_ends_at" timestamp with time zone,
    "trial_message_limit_override" integer,
    "addon_started_at" timestamp with time zone,
    "addon_ends_at" timestamp with time zone,
    "paused_reason" "text",
    "billing_customer_reference" "text",
    "billing_subscription_reference" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "monthly_message_limit_override" integer,
    "allow_paid_overage" boolean DEFAULT false NOT NULL,
    CONSTRAINT "whatsapp_studio_entitlements_monthly_message_limit_overri_check" CHECK ((("monthly_message_limit_override" IS NULL) OR ("monthly_message_limit_override" >= 0))),
    CONSTRAINT "whatsapp_studio_entitlements_status_check" CHECK (("status" = ANY (ARRAY['trial'::"text", 'active'::"text", 'inactive'::"text", 'paused'::"text", 'legacy'::"text"]))),
    CONSTRAINT "whatsapp_studio_entitlements_trial_message_limit_override_check" CHECK ((("trial_message_limit_override" IS NULL) OR ("trial_message_limit_override" >= 0)))
);


ALTER TABLE "public"."whatsapp_studio_entitlements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."whatsapp_trial_identity_claims" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid",
    "identity_kind" "text" NOT NULL,
    "identity_hash" "text" NOT NULL,
    "claimed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "trial_ends_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."whatsapp_trial_identity_claims" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."whatsapp_usage_alerts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "usage_scope" "text" NOT NULL,
    "threshold_percent" integer NOT NULL,
    "used_count" integer NOT NULL,
    "limit_count" integer NOT NULL,
    "acknowledged_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "whatsapp_usage_alerts_threshold_percent_check" CHECK ((("threshold_percent" >= 1) AND ("threshold_percent" <= 100)))
);


ALTER TABLE "public"."whatsapp_usage_alerts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."whatsapp_usage_ledger" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "message_log_id" "uuid",
    "idempotency_key" "text" NOT NULL,
    "entitlement_kind" "text" NOT NULL,
    "state" "text" DEFAULT 'reserved'::"text" NOT NULL,
    "provider" "text" DEFAULT 'senddm_whatsapp'::"text" NOT NULL,
    "provider_message_id" "text",
    "provider_status" "text",
    "message_kind" "text" DEFAULT 'confirmation'::"text" NOT NULL,
    "unit_cost_cents" integer,
    "commercial_unit_cents" integer,
    "reserved_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "submitted_at" timestamp with time zone,
    "counted_at" timestamp with time zone,
    "released_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "whatsapp_usage_ledger_commercial_unit_cents_check" CHECK ((("commercial_unit_cents" IS NULL) OR ("commercial_unit_cents" >= 0))),
    CONSTRAINT "whatsapp_usage_ledger_entitlement_kind_check" CHECK (("entitlement_kind" = ANY (ARRAY['trial'::"text", 'active'::"text", 'legacy'::"text"]))),
    CONSTRAINT "whatsapp_usage_ledger_state_check" CHECK (("state" = ANY (ARRAY['reserved'::"text", 'submitted'::"text", 'counted'::"text", 'released'::"text"]))),
    CONSTRAINT "whatsapp_usage_ledger_unit_cost_cents_check" CHECK ((("unit_cost_cents" IS NULL) OR ("unit_cost_cents" >= 0)))
);


ALTER TABLE "public"."whatsapp_usage_ledger" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."withdrawal_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "requested_by" "uuid" NOT NULL,
    "amount_cents" integer NOT NULL,
    "currency" "text" DEFAULT 'eur'::"text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "payout_mode" "text" NOT NULL,
    "payout_method" "text" NOT NULL,
    "fiscal_name" "text" NOT NULL,
    "nif" "text" NOT NULL,
    "iban_last4" "text",
    "mb_way_phone" "text",
    "stripe_account_id" "text",
    "stripe_transfer_id" "text",
    "admin_notes" "text",
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reviewed_at" timestamp with time zone,
    "paid_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "proof_url" "text",
    "failure_reason" "text",
    "processed_at" timestamp with time zone,
    "status_updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "withdrawal_requests_amount_cents_check" CHECK (("amount_cents" > 0)),
    CONSTRAINT "withdrawal_requests_payout_method_check" CHECK (("payout_method" = ANY (ARRAY['iban'::"text", 'mb_way'::"text", 'stripe'::"text"]))),
    CONSTRAINT "withdrawal_requests_payout_mode_check" CHECK (("payout_mode" = ANY (ARRAY['manual'::"text", 'stripe_automatic'::"text"]))),
    CONSTRAINT "withdrawal_requests_status_check" CHECK (("status" = ANY (ARRAY['in_review'::"text", 'processing'::"text", 'completed'::"text", 'failed'::"text", 'canceled'::"text", 'pending'::"text", 'paid'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."withdrawal_requests" OWNER TO "postgres";


ALTER TABLE ONLY "public"."appointment_schedule_events"
    ADD CONSTRAINT "appointment_schedule_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appointment_services"
    ADD CONSTRAINT "appointment_services_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_public_token_key" UNIQUE ("public_token");



ALTER TABLE ONLY "public"."booking_payment_requests"
    ADD CONSTRAINT "booking_payment_requests_no_active_overlap" EXCLUDE USING "gist" ("staff_id" WITH =, "tstzrange"("starts_at", "ends_at", '[)'::"text") WITH &&) WHERE (("status" = ANY (ARRAY['awaiting_payment'::"text", 'processing'::"text"])));



ALTER TABLE ONLY "public"."booking_payment_requests"
    ADD CONSTRAINT "booking_payment_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booking_policy_acceptances"
    ADD CONSTRAINT "booking_policy_acceptances_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cash_register_movements"
    ADD CONSTRAINT "cash_register_movements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cash_register_sessions"
    ADD CONSTRAINT "cash_register_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_appointment_action_logs"
    ADD CONSTRAINT "client_appointment_action_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_studio_id_phone_key" UNIQUE ("studio_id", "phone");



ALTER TABLE ONLY "public"."customer_loyalty_rewards"
    ADD CONSTRAINT "customer_loyalty_rewards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customer_loyalty_settings"
    ADD CONSTRAINT "customer_loyalty_settings_pkey" PRIMARY KEY ("studio_id");



ALTER TABLE ONLY "public"."customer_loyalty_stamp_entries"
    ADD CONSTRAINT "customer_loyalty_stamp_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customer_referral_codes"
    ADD CONSTRAINT "customer_referral_codes_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."customer_referral_codes"
    ADD CONSTRAINT "customer_referral_codes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customer_referral_codes"
    ADD CONSTRAINT "customer_referral_codes_studio_id_referrer_client_id_key" UNIQUE ("studio_id", "referrer_client_id");



ALTER TABLE ONLY "public"."customer_referrals"
    ADD CONSTRAINT "customer_referrals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_message_logs"
    ADD CONSTRAINT "email_message_logs_idempotency_key_key" UNIQUE ("idempotency_key");



ALTER TABLE ONLY "public"."email_message_logs"
    ADD CONSTRAINT "email_message_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."financial_audit_logs"
    ADD CONSTRAINT "financial_audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."manual_service_entries"
    ADD CONSTRAINT "manual_service_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booking_payment_requests"
    ADD CONSTRAINT "no_overlap_active_booking_payment_requests" EXCLUDE USING "gist" ("staff_id" WITH =, "tstzrange"("starts_at", "ends_at", '[)'::"text") WITH &&) WHERE (("status" = ANY (ARRAY['awaiting_payment'::"text", 'processing'::"text", 'paid'::"text"])));



ALTER TABLE ONLY "public"."notifications_log"
    ADD CONSTRAINT "notifications_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."onboarding_progress"
    ADD CONSTRAINT "onboarding_progress_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."onboarding_progress"
    ADD CONSTRAINT "onboarding_progress_studio_id_step_key" UNIQUE ("studio_id", "step");



ALTER TABLE ONLY "public"."payment_intents"
    ADD CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_intents"
    ADD CONSTRAINT "payment_intents_stripe_payment_intent_id_key" UNIQUE ("stripe_payment_intent_id");



ALTER TABLE ONLY "public"."platform_billing_events"
    ADD CONSTRAINT "platform_billing_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."platform_billing_events"
    ADD CONSTRAINT "platform_billing_events_stripe_event_id_key" UNIQUE ("stripe_event_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."referral_credits"
    ADD CONSTRAINT "referral_credits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."referrals"
    ADD CONSTRAINT "referrals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."referrals"
    ADD CONSTRAINT "referrals_referred_studio_id_key" UNIQUE ("referred_studio_id");



ALTER TABLE ONLY "public"."refund_requests"
    ADD CONSTRAINT "refund_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."server_rate_limits"
    ADD CONSTRAINT "server_rate_limits_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."service_categories"
    ADD CONSTRAINT "service_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."service_category_suggestions"
    ADD CONSTRAINT "service_category_suggestions_label_key" UNIQUE ("label");



ALTER TABLE ONLY "public"."service_category_suggestions"
    ADD CONSTRAINT "service_category_suggestions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."staff_availability"
    ADD CONSTRAINT "staff_availability_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."staff"
    ADD CONSTRAINT "staff_invite_token_key" UNIQUE ("invite_token");



ALTER TABLE ONLY "public"."staff"
    ADD CONSTRAINT "staff_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."staff_services"
    ADD CONSTRAINT "staff_services_pkey" PRIMARY KEY ("staff_id", "service_id");



ALTER TABLE ONLY "public"."staff_time_off"
    ADD CONSTRAINT "staff_time_off_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."studio_follows"
    ADD CONSTRAINT "studio_follows_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."studio_follows"
    ADD CONSTRAINT "studio_follows_user_id_studio_id_key" UNIQUE ("user_id", "studio_id");



ALTER TABLE ONLY "public"."studio_notification_deliveries"
    ADD CONSTRAINT "studio_notification_deliverie_notification_id_subscription__key" UNIQUE ("notification_id", "subscription_id");



ALTER TABLE ONLY "public"."studio_notification_deliveries"
    ADD CONSTRAINT "studio_notification_deliveries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."studio_notifications"
    ADD CONSTRAINT "studio_notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."studio_payout_settings"
    ADD CONSTRAINT "studio_payout_settings_pkey" PRIMARY KEY ("studio_id");



ALTER TABLE ONLY "public"."studio_plan_events"
    ADD CONSTRAINT "studio_plan_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."studio_reviews"
    ADD CONSTRAINT "studio_reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."studio_reviews"
    ADD CONSTRAINT "studio_reviews_user_id_appointment_id_key" UNIQUE ("user_id", "appointment_id");



ALTER TABLE ONLY "public"."studios"
    ADD CONSTRAINT "studios_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."studios"
    ADD CONSTRAINT "studios_referral_code_key" UNIQUE ("referral_code");



ALTER TABLE ONLY "public"."studios"
    ADD CONSTRAINT "studios_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_stripe_subscription_id_key" UNIQUE ("stripe_subscription_id");



ALTER TABLE ONLY "public"."upsell_offers"
    ADD CONSTRAINT "upsell_offers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."upsell_offers"
    ADD CONSTRAINT "upsell_offers_trigger_service_id_offered_service_id_key" UNIQUE ("trigger_service_id", "offered_service_id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_studio_id_role_key" UNIQUE ("user_id", "studio_id", "role");



ALTER TABLE ONLY "public"."whatsapp_admin_audit_logs"
    ADD CONSTRAINT "whatsapp_admin_audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."whatsapp_message_logs"
    ADD CONSTRAINT "whatsapp_message_logs_idempotency_key_key" UNIQUE ("idempotency_key");



ALTER TABLE ONLY "public"."whatsapp_message_logs"
    ADD CONSTRAINT "whatsapp_message_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."whatsapp_platform_settings"
    ADD CONSTRAINT "whatsapp_platform_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."whatsapp_studio_entitlements"
    ADD CONSTRAINT "whatsapp_studio_entitlements_pkey" PRIMARY KEY ("studio_id");



ALTER TABLE ONLY "public"."whatsapp_trial_identity_claims"
    ADD CONSTRAINT "whatsapp_trial_identity_claims_identity_kind_identity_hash_key" UNIQUE ("identity_kind", "identity_hash");



ALTER TABLE ONLY "public"."whatsapp_trial_identity_claims"
    ADD CONSTRAINT "whatsapp_trial_identity_claims_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."whatsapp_usage_alerts"
    ADD CONSTRAINT "whatsapp_usage_alerts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."whatsapp_usage_alerts"
    ADD CONSTRAINT "whatsapp_usage_alerts_studio_id_usage_scope_threshold_perce_key" UNIQUE ("studio_id", "usage_scope", "threshold_percent");



ALTER TABLE ONLY "public"."whatsapp_usage_ledger"
    ADD CONSTRAINT "whatsapp_usage_ledger_idempotency_key_key" UNIQUE ("idempotency_key");



ALTER TABLE ONLY "public"."whatsapp_usage_ledger"
    ADD CONSTRAINT "whatsapp_usage_ledger_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."withdrawal_requests"
    ADD CONSTRAINT "withdrawal_requests_pkey" PRIMARY KEY ("id");



CREATE INDEX "appointment_schedule_events_appointment_created_idx" ON "public"."appointment_schedule_events" USING "btree" ("appointment_id", "created_at" DESC);



CREATE INDEX "appointment_schedule_events_studio_created_idx" ON "public"."appointment_schedule_events" USING "btree" ("studio_id", "created_at" DESC);



CREATE UNIQUE INDEX "customer_loyalty_booking_stamp_once" ON "public"."customer_loyalty_stamp_entries" USING "btree" ("studio_id", "client_id", "source_appointment_id", "source_type") WHERE (("source_type" = 'booking_completed'::"text") AND ("source_appointment_id" IS NOT NULL));



CREATE UNIQUE INDEX "customer_loyalty_referral_stamp_once" ON "public"."customer_loyalty_stamp_entries" USING "btree" ("studio_id", "client_id", "source_customer_referral_id", "source_type") WHERE (("source_type" = 'referral_completed'::"text") AND ("source_customer_referral_id" IS NOT NULL));



CREATE INDEX "customer_loyalty_rewards_lookup" ON "public"."customer_loyalty_rewards" USING "btree" ("studio_id", "client_id", "status", "created_at");



CREATE UNIQUE INDEX "customer_referrals_appointment_once" ON "public"."customer_referrals" USING "btree" ("appointment_id") WHERE ("appointment_id" IS NOT NULL);



CREATE UNIQUE INDEX "customer_referrals_booking_request_once" ON "public"."customer_referrals" USING "btree" ("booking_request_id") WHERE ("booking_request_id" IS NOT NULL);



CREATE UNIQUE INDEX "customer_referrals_referred_completed_once" ON "public"."customer_referrals" USING "btree" ("studio_id", "referred_client_id") WHERE (("referred_client_id" IS NOT NULL) AND ("status" = 'completed'::"text"));



CREATE INDEX "idx_appointments_lifecycle_due" ON "public"."appointments" USING "btree" ("starts_at", "studio_id") WHERE (("status" = 'confirmed'::"public"."appointment_status") AND ("lifecycle_activated_at" IS NOT NULL));



CREATE INDEX "idx_appointments_public_token" ON "public"."appointments" USING "btree" ("public_token");



CREATE INDEX "idx_appt_svc_appt" ON "public"."appointment_services" USING "btree" ("appointment_id");



CREATE INDEX "idx_appts_staff_starts" ON "public"."appointments" USING "btree" ("staff_id", "starts_at");



CREATE INDEX "idx_appts_studio_starts" ON "public"."appointments" USING "btree" ("studio_id", "starts_at");



CREATE INDEX "idx_avail_staff" ON "public"."staff_availability" USING "btree" ("staff_id", "weekday");



CREATE INDEX "idx_booking_payment_requests_staff_range" ON "public"."booking_payment_requests" USING "gist" ("staff_id", "tstzrange"("starts_at", "ends_at", '[)'::"text")) WHERE (("status" = ANY (ARRAY['awaiting_payment'::"text", 'processing'::"text", 'paid'::"text"])) AND ("expires_at" > '2000-01-01 00:00:00+00'::timestamp with time zone));



CREATE INDEX "idx_booking_payment_requests_status_expires" ON "public"."booking_payment_requests" USING "btree" ("status", "expires_at");



CREATE INDEX "idx_booking_payment_requests_studio" ON "public"."booking_payment_requests" USING "btree" ("studio_id", "starts_at");



CREATE INDEX "idx_cash_register_movements_session" ON "public"."cash_register_movements" USING "btree" ("session_id", "occurred_at" DESC);



CREATE UNIQUE INDEX "idx_cash_register_movements_source_key" ON "public"."cash_register_movements" USING "btree" ("source_key") WHERE ("source_key" IS NOT NULL);



CREATE INDEX "idx_cash_register_movements_studio" ON "public"."cash_register_movements" USING "btree" ("studio_id", "occurred_at" DESC);



CREATE UNIQUE INDEX "idx_cash_register_one_open_per_studio" ON "public"."cash_register_sessions" USING "btree" ("studio_id") WHERE ("status" = 'open'::"text");



CREATE INDEX "idx_cash_register_sessions_studio_opened" ON "public"."cash_register_sessions" USING "btree" ("studio_id", "opened_at" DESC);



CREATE INDEX "idx_categories_studio" ON "public"."service_categories" USING "btree" ("studio_id");



CREATE INDEX "idx_client_action_logs_appointment_created" ON "public"."client_appointment_action_logs" USING "btree" ("appointment_id", "created_at" DESC);



CREATE INDEX "idx_client_action_logs_studio_created" ON "public"."client_appointment_action_logs" USING "btree" ("studio_id", "created_at" DESC);



CREATE INDEX "idx_clients_booking_status" ON "public"."clients" USING "btree" ("studio_id", "booking_status", "suspended_until");



CREATE INDEX "idx_clients_studio" ON "public"."clients" USING "btree" ("studio_id");



CREATE INDEX "idx_clients_studio_auth_user" ON "public"."clients" USING "btree" ("studio_id", "auth_user_id") WHERE ("auth_user_id" IS NOT NULL);



CREATE INDEX "idx_clients_studio_birth_month_day" ON "public"."clients" USING "btree" ("studio_id", EXTRACT(month FROM "date_of_birth"), EXTRACT(day FROM "date_of_birth")) WHERE ("date_of_birth" IS NOT NULL);



CREATE INDEX "idx_clients_studio_email_lower" ON "public"."clients" USING "btree" ("studio_id", "lower"("email")) WHERE ("email" IS NOT NULL);



CREATE INDEX "idx_email_message_logs_appointment" ON "public"."email_message_logs" USING "btree" ("appointment_id", "created_at" DESC);



CREATE INDEX "idx_email_message_logs_payment" ON "public"."email_message_logs" USING "btree" ("payment_intent_id", "created_at" DESC) WHERE ("payment_intent_id" IS NOT NULL);



CREATE INDEX "idx_email_message_logs_studio_created" ON "public"."email_message_logs" USING "btree" ("studio_id", "created_at" DESC);



CREATE INDEX "idx_financial_audit_logs_entity" ON "public"."financial_audit_logs" USING "btree" ("entity_type", "entity_id", "created_at" DESC);



CREATE INDEX "idx_financial_audit_logs_studio_created" ON "public"."financial_audit_logs" USING "btree" ("studio_id", "created_at" DESC);



CREATE INDEX "idx_manual_service_entries_client" ON "public"."manual_service_entries" USING "btree" ("client_id");



CREATE INDEX "idx_manual_service_entries_staff_date" ON "public"."manual_service_entries" USING "btree" ("staff_id", "performed_at" DESC);



CREATE INDEX "idx_manual_service_entries_studio_date" ON "public"."manual_service_entries" USING "btree" ("studio_id", "performed_at" DESC);



CREATE INDEX "idx_notif_studio" ON "public"."notifications_log" USING "btree" ("studio_id", "created_at" DESC);



CREATE UNIQUE INDEX "idx_notifications_log_client_event_once" ON "public"."notifications_log" USING "btree" ("studio_id", "channel", "recipient", "kind", (("payload" ->> 'key'::"text"))) WHERE (("channel" = 'client_center'::"text") AND (NULLIF(("payload" ->> 'key'::"text"), ''::"text") IS NOT NULL));



CREATE UNIQUE INDEX "idx_notifications_log_lifecycle_key" ON "public"."notifications_log" USING "btree" ("studio_id", "channel", "recipient", "kind", (("payload" ->> 'key'::"text"))) WHERE (("payload" ? 'key'::"text") AND ("kind" = 'appointment_reminder'::"text"));



CREATE UNIQUE INDEX "idx_one_live_subscription_per_studio" ON "public"."subscriptions" USING "btree" ("studio_id") WHERE (("studio_id" IS NOT NULL) AND ("status" = ANY (ARRAY['active'::"text", 'trialing'::"text", 'past_due'::"text", 'incomplete'::"text", 'checkout_pending'::"text"])));



CREATE UNIQUE INDEX "idx_one_live_subscription_without_studio_per_user" ON "public"."subscriptions" USING "btree" ("user_id") WHERE (("studio_id" IS NULL) AND ("status" = ANY (ARRAY['active'::"text", 'trialing'::"text", 'past_due'::"text", 'incomplete'::"text", 'checkout_pending'::"text"])));



CREATE INDEX "idx_payment_intents_appt" ON "public"."payment_intents" USING "btree" ("appointment_id");



CREATE INDEX "idx_payment_intents_checkout_session" ON "public"."payment_intents" USING "btree" ("stripe_checkout_session_id") WHERE ("stripe_checkout_session_id" IS NOT NULL);



CREATE UNIQUE INDEX "idx_payment_intents_one_succeeded_appointment" ON "public"."payment_intents" USING "btree" ("appointment_id") WHERE (("appointment_id" IS NOT NULL) AND ("status" = 'succeeded'::"text"));



CREATE UNIQUE INDEX "idx_payment_intents_one_succeeded_booking_request" ON "public"."payment_intents" USING "btree" ("booking_request_id") WHERE (("booking_request_id" IS NOT NULL) AND ("status" = 'succeeded'::"text"));



CREATE INDEX "idx_payment_intents_request" ON "public"."payment_intents" USING "btree" ("booking_request_id");



CREATE INDEX "idx_payment_intents_status_expires" ON "public"."payment_intents" USING "btree" ("status", "expires_at");



CREATE UNIQUE INDEX "idx_payment_intents_unique_checkout_session" ON "public"."payment_intents" USING "btree" ("stripe_checkout_session_id") WHERE ("stripe_checkout_session_id" IS NOT NULL);



CREATE UNIQUE INDEX "idx_payment_intents_unique_stripe_payment_intent" ON "public"."payment_intents" USING "btree" ("stripe_payment_intent_id") WHERE ("stripe_payment_intent_id" IS NOT NULL);



CREATE INDEX "idx_policy_acceptances_appointment" ON "public"."booking_policy_acceptances" USING "btree" ("appointment_id");



CREATE INDEX "idx_policy_acceptances_booking_request" ON "public"."booking_policy_acceptances" USING "btree" ("booking_request_id");



CREATE INDEX "idx_policy_acceptances_studio" ON "public"."booking_policy_acceptances" USING "btree" ("studio_id", "accepted_at" DESC);



CREATE INDEX "idx_push_subscriptions_active_endpoint_user_studio" ON "public"."push_subscriptions" USING "btree" ("endpoint", "user_id", "studio_id", "audience") WHERE ("revoked_at" IS NULL);



CREATE INDEX "idx_push_subscriptions_active_studio_user" ON "public"."push_subscriptions" USING "btree" ("studio_id", "user_id", "updated_at" DESC) WHERE (("revoked_at" IS NULL) AND ("audience" = ANY (ARRAY['studio'::"text", 'both'::"text"])));



CREATE INDEX "idx_push_subscriptions_client" ON "public"."push_subscriptions" USING "btree" ("client_id") WHERE (("client_id" IS NOT NULL) AND ("revoked_at" IS NULL));



CREATE UNIQUE INDEX "idx_push_subscriptions_endpoint_studio" ON "public"."push_subscriptions" USING "btree" ("endpoint", "studio_id");



CREATE INDEX "idx_push_subscriptions_studio_audience" ON "public"."push_subscriptions" USING "btree" ("studio_id", "audience") WHERE ("revoked_at" IS NULL);



CREATE INDEX "idx_push_subscriptions_user" ON "public"."push_subscriptions" USING "btree" ("user_id") WHERE ("revoked_at" IS NULL);



CREATE INDEX "idx_referral_credits_status" ON "public"."referral_credits" USING "btree" ("status");



CREATE INDEX "idx_referral_credits_studio" ON "public"."referral_credits" USING "btree" ("studio_id");



CREATE INDEX "idx_referrals_ref_code" ON "public"."referrals" USING "btree" ("ref_code");



CREATE INDEX "idx_referrals_referrer" ON "public"."referrals" USING "btree" ("referrer_studio_id");



CREATE INDEX "idx_referrals_status" ON "public"."referrals" USING "btree" ("status");



CREATE INDEX "idx_refund_requests_platform_status" ON "public"."refund_requests" USING "btree" ("status", "platform_processed_at" DESC, "created_at" DESC);



CREATE INDEX "idx_refund_requests_status" ON "public"."refund_requests" USING "btree" ("status");



CREATE INDEX "idx_refund_requests_studio" ON "public"."refund_requests" USING "btree" ("studio_id", "created_at" DESC);



CREATE INDEX "idx_services_studio" ON "public"."services" USING "btree" ("studio_id");



CREATE INDEX "idx_staff_invite_token" ON "public"."staff" USING "btree" ("invite_token");



CREATE INDEX "idx_staff_studio" ON "public"."staff" USING "btree" ("studio_id");



CREATE INDEX "idx_studio_follows_studio_id" ON "public"."studio_follows" USING "btree" ("studio_id");



CREATE INDEX "idx_studio_follows_user_id" ON "public"."studio_follows" USING "btree" ("user_id");



CREATE INDEX "idx_studio_notification_deliveries_due" ON "public"."studio_notification_deliveries" USING "btree" ("next_attempt_at", "created_at") WHERE ("status" = ANY (ARRAY['pending'::"text", 'retry'::"text", 'delivering'::"text"]));



CREATE INDEX "idx_studio_notification_deliveries_studio" ON "public"."studio_notification_deliveries" USING "btree" ("studio_id", "created_at" DESC);



CREATE UNIQUE INDEX "idx_studio_notification_delivery_receipt" ON "public"."studio_notification_deliveries" USING "btree" ("id", "receipt_token");



CREATE UNIQUE INDEX "idx_studio_notifications_event_key" ON "public"."studio_notifications" USING "btree" ("studio_id", "event_key") WHERE ("event_key" IS NOT NULL);



CREATE INDEX "idx_studio_notifications_studio_appointment" ON "public"."studio_notifications" USING "btree" ("studio_id", "appointment_id") WHERE ("appointment_id" IS NOT NULL);



CREATE INDEX "idx_studio_notifications_studio_created" ON "public"."studio_notifications" USING "btree" ("studio_id", "created_at" DESC);



CREATE INDEX "idx_studio_notifications_unread" ON "public"."studio_notifications" USING "btree" ("studio_id", "created_at" DESC) WHERE ("read_at" IS NULL);



CREATE INDEX "idx_studio_plan_events_studio_created" ON "public"."studio_plan_events" USING "btree" ("studio_id", "created_at" DESC);



CREATE INDEX "idx_studio_reviews_appointment" ON "public"."studio_reviews" USING "btree" ("appointment_id");



CREATE INDEX "idx_studio_reviews_studio_id" ON "public"."studio_reviews" USING "btree" ("studio_id");



CREATE INDEX "idx_studio_reviews_user_id" ON "public"."studio_reviews" USING "btree" ("user_id");



CREATE INDEX "idx_studios_slug" ON "public"."studios" USING "btree" ("slug");



CREATE INDEX "idx_studios_stripe_connect_account_id" ON "public"."studios" USING "btree" ("stripe_connect_account_id") WHERE ("stripe_connect_account_id" IS NOT NULL);



CREATE INDEX "idx_studios_stripe_customer" ON "public"."studios" USING "btree" ("stripe_customer_id");



CREATE INDEX "idx_studios_stripe_subscription" ON "public"."studios" USING "btree" ("stripe_subscription_id");



CREATE INDEX "idx_studios_trial_identity_device_hash" ON "public"."studios" USING "btree" ("trial_identity_device_fingerprint_hash") WHERE ("trial_identity_device_fingerprint_hash" IS NOT NULL);



CREATE INDEX "idx_studios_trial_identity_ip_hash" ON "public"."studios" USING "btree" ("trial_identity_ip_hash") WHERE ("trial_identity_ip_hash" IS NOT NULL);



CREATE INDEX "idx_studios_trial_identity_phone" ON "public"."studios" USING "btree" ("trial_identity_phone") WHERE ("trial_identity_phone" IS NOT NULL);



CREATE INDEX "idx_studios_trial_identity_slug" ON "public"."studios" USING "btree" ("trial_identity_slug") WHERE ("trial_identity_slug" IS NOT NULL);



CREATE INDEX "idx_studios_trial_identity_studio_name" ON "public"."studios" USING "btree" ("trial_identity_studio_name") WHERE ("trial_identity_studio_name" IS NOT NULL);



CREATE INDEX "idx_studios_trial_used_at" ON "public"."studios" USING "btree" ("trial_used_at");



CREATE INDEX "idx_subscriptions_customer_id" ON "public"."subscriptions" USING "btree" ("stripe_customer_id");



CREATE INDEX "idx_subscriptions_status" ON "public"."subscriptions" USING "btree" ("status");



CREATE INDEX "idx_subscriptions_studio_id" ON "public"."subscriptions" USING "btree" ("studio_id");



CREATE INDEX "idx_subscriptions_user_id" ON "public"."subscriptions" USING "btree" ("user_id");



CREATE INDEX "idx_timeoff_staff" ON "public"."staff_time_off" USING "btree" ("staff_id", "starts_at");



CREATE INDEX "idx_upsell_trigger" ON "public"."upsell_offers" USING "btree" ("trigger_service_id");



CREATE INDEX "idx_user_roles_studio" ON "public"."user_roles" USING "btree" ("studio_id");



CREATE INDEX "idx_user_roles_user" ON "public"."user_roles" USING "btree" ("user_id");



CREATE INDEX "idx_whatsapp_admin_audit_created" ON "public"."whatsapp_admin_audit_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_whatsapp_message_logs_appointment" ON "public"."whatsapp_message_logs" USING "btree" ("appointment_id", "created_at" DESC);



CREATE UNIQUE INDEX "idx_whatsapp_message_logs_payment_sent_once" ON "public"."whatsapp_message_logs" USING "btree" ("payment_intent_id") WHERE (("payment_intent_id" IS NOT NULL) AND ("status" = 'sent'::"text"));



CREATE INDEX "idx_whatsapp_message_logs_studio_created" ON "public"."whatsapp_message_logs" USING "btree" ("studio_id", "created_at" DESC);



CREATE INDEX "idx_whatsapp_usage_studio_created" ON "public"."whatsapp_usage_ledger" USING "btree" ("studio_id", "created_at" DESC);



CREATE INDEX "idx_whatsapp_usage_studio_state" ON "public"."whatsapp_usage_ledger" USING "btree" ("studio_id", "state", "created_at" DESC);



CREATE INDEX "idx_withdrawal_requests_status" ON "public"."withdrawal_requests" USING "btree" ("status", "requested_at" DESC);



CREATE INDEX "idx_withdrawal_requests_status_updated" ON "public"."withdrawal_requests" USING "btree" ("studio_id", "status_updated_at" DESC);



CREATE INDEX "idx_withdrawal_requests_studio_requested" ON "public"."withdrawal_requests" USING "btree" ("studio_id", "requested_at" DESC);



CREATE UNIQUE INDEX "notifications_log_client_risk_episode_unique" ON "public"."notifications_log" USING "btree" ("studio_id", "channel", "kind", "recipient", (("payload" ->> 'risk_episode_key'::"text"))) WHERE (("channel" = 'client_center'::"text") AND ("kind" = 'follower_client_at_risk'::"text") AND ("payload" ? 'risk_episode_key'::"text"));



CREATE INDEX "payment_intents_stripe_balance_transaction_idx" ON "public"."payment_intents" USING "btree" ("stripe_balance_transaction_id") WHERE ("stripe_balance_transaction_id" IS NOT NULL);



CREATE INDEX "payment_intents_stripe_connect_account_idx" ON "public"."payment_intents" USING "btree" ("stripe_connect_account_id") WHERE ("stripe_connect_account_id" IS NOT NULL);



CREATE UNIQUE INDEX "refund_requests_one_active_appointment" ON "public"."refund_requests" USING "btree" ("appointment_id") WHERE (("appointment_id" IS NOT NULL) AND ("status" = ANY (ARRAY['pending'::"text", 'in_review'::"text", 'processing'::"text"])));



CREATE UNIQUE INDEX "refund_requests_one_active_booking" ON "public"."refund_requests" USING "btree" ("booking_request_id") WHERE (("booking_request_id" IS NOT NULL) AND ("status" = ANY (ARRAY['pending'::"text", 'in_review'::"text", 'processing'::"text"])));



CREATE UNIQUE INDEX "refund_requests_one_active_payment" ON "public"."refund_requests" USING "btree" ("payment_intent_id") WHERE (("payment_intent_id" IS NOT NULL) AND ("status" = ANY (ARRAY['pending'::"text", 'in_review'::"text", 'processing'::"text"])));



CREATE UNIQUE INDEX "withdrawal_requests_one_active_per_studio_idx" ON "public"."withdrawal_requests" USING "btree" ("studio_id") WHERE ("status" = ANY (ARRAY['pending'::"text", 'in_review'::"text", 'processing'::"text"]));



CREATE OR REPLACE TRIGGER "enforce_appointment_schedule_overlap_trigger" BEFORE INSERT OR UPDATE ON "public"."appointments" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_appointment_schedule_overlap"();



CREATE OR REPLACE TRIGGER "preserve_cancel_flag" BEFORE UPDATE ON "public"."subscriptions" FOR EACH ROW EXECUTE FUNCTION "public"."preserve_cancel_at_period_end"();



CREATE OR REPLACE TRIGGER "preserve_studio_cancel_flag" BEFORE UPDATE ON "public"."studios" FOR EACH ROW EXECUTE FUNCTION "public"."preserve_studio_cancel_at_period_end"();



CREATE OR REPLACE TRIGGER "trg_activate_appointment_lifecycle" BEFORE INSERT OR UPDATE OF "starts_at", "staff_id", "status" ON "public"."appointments" FOR EACH ROW EXECUTE FUNCTION "public"."activate_appointment_lifecycle"();



CREATE OR REPLACE TRIGGER "trg_appointments_updated_at" BEFORE UPDATE ON "public"."appointments" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_appts_updated" BEFORE UPDATE ON "public"."appointments" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_audit_payment_intent_succeeded_insert" AFTER INSERT ON "public"."payment_intents" FOR EACH ROW EXECUTE FUNCTION "public"."audit_payment_intent_succeeded"();



CREATE OR REPLACE TRIGGER "trg_audit_payment_intent_succeeded_update" AFTER UPDATE OF "status", "appointment_id" ON "public"."payment_intents" FOR EACH ROW EXECUTE FUNCTION "public"."audit_payment_intent_succeeded"();



CREATE OR REPLACE TRIGGER "trg_booking_payment_requests_updated_at" BEFORE UPDATE ON "public"."booking_payment_requests" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_capture_appointment_commission_snapshot" BEFORE INSERT OR UPDATE OF "staff_id", "studio_id" ON "public"."appointments" FOR EACH ROW EXECUTE FUNCTION "public"."capture_appointment_commission_snapshot"();



CREATE OR REPLACE TRIGGER "trg_capture_appointment_service_commission_snapshot" BEFORE INSERT OR UPDATE OF "appointment_id", "service_id" ON "public"."appointment_services" FOR EACH ROW EXECUTE FUNCTION "public"."capture_appointment_service_commission_snapshot"();



CREATE OR REPLACE TRIGGER "trg_capture_booking_payment_pricing_snapshot" BEFORE INSERT ON "public"."booking_payment_requests" FOR EACH ROW EXECUTE FUNCTION "public"."capture_booking_payment_pricing_snapshot"();



CREATE OR REPLACE TRIGGER "trg_cash_register_sessions_updated_at" BEFORE UPDATE ON "public"."cash_register_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_claim_whatsapp_trial_for_owner" AFTER INSERT ON "public"."user_roles" FOR EACH ROW EXECUTE FUNCTION "public"."claim_whatsapp_trial_for_owner"();



CREATE OR REPLACE TRIGGER "trg_clients_updated" BEFORE UPDATE ON "public"."clients" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_create_whatsapp_entitlement" AFTER INSERT ON "public"."studios" FOR EACH ROW EXECUTE FUNCTION "public"."create_whatsapp_entitlement_for_studio"();



CREATE OR REPLACE TRIGGER "trg_customer_loyalty_completed_appointment" AFTER INSERT OR UPDATE OF "status" ON "public"."appointments" FOR EACH ROW EXECUTE FUNCTION "public"."customer_loyalty_completed_appointment_trigger"();



CREATE OR REPLACE TRIGGER "trg_email_message_logs_updated" BEFORE UPDATE ON "public"."email_message_logs" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_enforce_client_plan_protected_columns" BEFORE INSERT OR UPDATE ON "public"."clients" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_client_plan_protected_columns"();



CREATE OR REPLACE TRIGGER "trg_enforce_email_notification_plan" BEFORE INSERT ON "public"."email_message_logs" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_notification_plan_on_insert"();



CREATE OR REPLACE TRIGGER "trg_enforce_notification_log_appointment_tenant" BEFORE INSERT OR UPDATE OF "appointment_id", "studio_id", "kind", "payload" ON "public"."notifications_log" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_notification_log_appointment_tenant"();



CREATE OR REPLACE TRIGGER "trg_enforce_notification_log_plan" BEFORE INSERT ON "public"."notifications_log" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_notification_plan_on_insert"();



CREATE OR REPLACE TRIGGER "trg_enforce_plan_professional_limit" BEFORE INSERT OR UPDATE OF "studio_id", "is_active" ON "public"."staff" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_plan_professional_limit"();



CREATE OR REPLACE TRIGGER "trg_enforce_service_plan_protected_columns" BEFORE INSERT OR UPDATE ON "public"."services" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_service_plan_protected_columns"();



CREATE OR REPLACE TRIGGER "trg_enforce_staff_plan_protected_columns" BEFORE INSERT OR UPDATE ON "public"."staff" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_staff_plan_protected_columns"();



CREATE OR REPLACE TRIGGER "trg_enforce_studio_notification_delivery_tenant" BEFORE INSERT OR UPDATE OF "notification_id", "studio_id", "subscription_id" ON "public"."studio_notification_deliveries" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_studio_notification_delivery_tenant"();



CREATE OR REPLACE TRIGGER "trg_enforce_studio_notification_plan" BEFORE INSERT ON "public"."studio_notifications" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_notification_plan_on_insert"();



CREATE OR REPLACE TRIGGER "trg_enforce_studio_notification_tenant_time" BEFORE INSERT OR UPDATE OF "studio_id", "appointment_id", "payload" ON "public"."studio_notifications" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_studio_notification_tenant_time"();



CREATE OR REPLACE TRIGGER "trg_enforce_studio_plan_protected_columns" BEFORE UPDATE ON "public"."studios" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_studio_plan_protected_columns"();



CREATE OR REPLACE TRIGGER "trg_ensure_appointment_public_token" BEFORE INSERT ON "public"."appointments" FOR EACH ROW EXECUTE FUNCTION "public"."ensure_appointment_public_token"();



CREATE OR REPLACE TRIGGER "trg_fanout_studio_notification_delivery" AFTER INSERT ON "public"."studio_notifications" FOR EACH ROW EXECUTE FUNCTION "public"."fanout_studio_notification_delivery"();



CREATE OR REPLACE TRIGGER "trg_group_attendance_confirmation_notification" BEFORE INSERT ON "public"."studio_notifications" FOR EACH ROW WHEN (("new"."kind" = 'attendance_confirmation'::"text")) EXECUTE FUNCTION "public"."group_attendance_confirmation_notification"();



CREATE OR REPLACE TRIGGER "trg_guard_studio_platform_fields" BEFORE UPDATE ON "public"."studios" FOR EACH ROW EXECUTE FUNCTION "public"."guard_studio_platform_fields"();



CREATE OR REPLACE TRIGGER "trg_manual_service_entries_client_totals" AFTER INSERT OR DELETE OR UPDATE ON "public"."manual_service_entries" FOR EACH ROW EXECUTE FUNCTION "public"."update_client_totals_from_manual_entry"();



CREATE OR REPLACE TRIGGER "trg_manual_service_entries_updated_at" BEFORE UPDATE ON "public"."manual_service_entries" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_notify_refund_request_created" AFTER INSERT ON "public"."refund_requests" FOR EACH ROW EXECUTE FUNCTION "public"."notify_refund_request_created"();



CREATE OR REPLACE TRIGGER "trg_notify_studio_appointment_lifecycle" AFTER INSERT OR UPDATE OF "status", "starts_at", "ends_at", "staff_id" ON "public"."appointments" FOR EACH ROW EXECUTE FUNCTION "public"."notify_studio_appointment_lifecycle"();



CREATE OR REPLACE TRIGGER "trg_notify_studio_new_client" AFTER INSERT ON "public"."clients" FOR EACH ROW EXECUTE FUNCTION "public"."notify_studio_new_client"();



CREATE OR REPLACE TRIGGER "trg_notify_studio_new_review" AFTER INSERT ON "public"."studio_reviews" FOR EACH ROW EXECUTE FUNCTION "public"."notify_studio_new_review"();



CREATE OR REPLACE TRIGGER "trg_notify_studio_payment_lifecycle" AFTER INSERT OR UPDATE OF "status", "appointment_id" ON "public"."payment_intents" FOR EACH ROW EXECUTE FUNCTION "public"."notify_studio_payment_lifecycle"();



CREATE OR REPLACE TRIGGER "trg_payment_intents_updated_at" BEFORE UPDATE ON "public"."payment_intents" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_profiles_updated" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_record_studio_plan_event" AFTER UPDATE OF "plan_tier", "subscription_status", "subscription_current_period_end", "subscription_cancel_at_period_end", "trial_ends_at" ON "public"."studios" FOR EACH ROW EXECUTE FUNCTION "public"."record_studio_plan_event"();



CREATE OR REPLACE TRIGGER "trg_refresh_reassigned_appointment_line_commissions" AFTER UPDATE OF "staff_id" ON "public"."appointments" FOR EACH ROW EXECUTE FUNCTION "public"."refresh_reassigned_appointment_line_commissions"();



CREATE OR REPLACE TRIGGER "trg_refresh_studio_rating" AFTER INSERT OR DELETE OR UPDATE ON "public"."studio_reviews" FOR EACH ROW EXECUTE FUNCTION "public"."refresh_studio_rating"();



CREATE OR REPLACE TRIGGER "trg_revoke_terminal_studio_push_subscription" AFTER INSERT OR UPDATE OF "status", "last_error" ON "public"."studio_notification_deliveries" FOR EACH ROW EXECUTE FUNCTION "public"."revoke_terminal_studio_push_subscription"();



CREATE OR REPLACE TRIGGER "trg_seed_staff_default_availability" AFTER INSERT ON "public"."staff" FOR EACH ROW EXECUTE FUNCTION "public"."seed_staff_default_availability"();



CREATE OR REPLACE TRIGGER "trg_services_updated" BEFORE UPDATE ON "public"."services" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_services_updated_at" BEFORE UPDATE ON "public"."services" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_staff_updated" BEFORE UPDATE ON "public"."staff" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_staff_updated_at" BEFORE UPDATE ON "public"."staff" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_studio_payout_settings_updated_at" BEFORE UPDATE ON "public"."studio_payout_settings" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_studios_updated" BEFORE UPDATE ON "public"."studios" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_studios_updated_at" BEFORE UPDATE ON "public"."studios" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_suppress_invalidated_appointment_reminders" AFTER UPDATE OF "starts_at", "status" ON "public"."appointments" FOR EACH ROW EXECUTE FUNCTION "public"."suppress_invalidated_appointment_reminders"();



CREATE OR REPLACE TRIGGER "trg_whatsapp_message_logs_updated" BEFORE UPDATE ON "public"."whatsapp_message_logs" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_whatsapp_platform_settings_updated" BEFORE UPDATE ON "public"."whatsapp_platform_settings" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_whatsapp_studio_entitlements_updated" BEFORE UPDATE ON "public"."whatsapp_studio_entitlements" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_whatsapp_usage_ledger_updated" BEFORE UPDATE ON "public"."whatsapp_usage_ledger" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_withdrawal_requests_updated_at" BEFORE UPDATE ON "public"."withdrawal_requests" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."appointment_schedule_events"
    ADD CONSTRAINT "appointment_schedule_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."appointment_schedule_events"
    ADD CONSTRAINT "appointment_schedule_events_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appointment_schedule_events"
    ADD CONSTRAINT "appointment_schedule_events_related_appointment_id_fkey" FOREIGN KEY ("related_appointment_id") REFERENCES "public"."appointments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."appointment_schedule_events"
    ADD CONSTRAINT "appointment_schedule_events_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appointment_services"
    ADD CONSTRAINT "appointment_services_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appointment_services"
    ADD CONSTRAINT "appointment_services_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booking_payment_requests"
    ADD CONSTRAINT "booking_payment_requests_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."booking_payment_requests"
    ADD CONSTRAINT "booking_payment_requests_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."booking_payment_requests"
    ADD CONSTRAINT "booking_payment_requests_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booking_policy_acceptances"
    ADD CONSTRAINT "booking_policy_acceptances_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."booking_policy_acceptances"
    ADD CONSTRAINT "booking_policy_acceptances_booking_request_id_fkey" FOREIGN KEY ("booking_request_id") REFERENCES "public"."booking_payment_requests"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."booking_policy_acceptances"
    ADD CONSTRAINT "booking_policy_acceptances_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cash_register_movements"
    ADD CONSTRAINT "cash_register_movements_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cash_register_movements"
    ADD CONSTRAINT "cash_register_movements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cash_register_movements"
    ADD CONSTRAINT "cash_register_movements_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."cash_register_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cash_register_movements"
    ADD CONSTRAINT "cash_register_movements_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cash_register_sessions"
    ADD CONSTRAINT "cash_register_sessions_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cash_register_sessions"
    ADD CONSTRAINT "cash_register_sessions_opened_by_fkey" FOREIGN KEY ("opened_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cash_register_sessions"
    ADD CONSTRAINT "cash_register_sessions_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_appointment_action_logs"
    ADD CONSTRAINT "client_appointment_action_logs_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_appointment_action_logs"
    ADD CONSTRAINT "client_appointment_action_logs_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_loyalty_rewards"
    ADD CONSTRAINT "customer_loyalty_rewards_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."customer_loyalty_rewards"
    ADD CONSTRAINT "customer_loyalty_rewards_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_loyalty_rewards"
    ADD CONSTRAINT "customer_loyalty_rewards_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_loyalty_settings"
    ADD CONSTRAINT "customer_loyalty_settings_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_loyalty_stamp_entries"
    ADD CONSTRAINT "customer_loyalty_stamp_entries_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_loyalty_stamp_entries"
    ADD CONSTRAINT "customer_loyalty_stamp_entries_source_appointment_id_fkey" FOREIGN KEY ("source_appointment_id") REFERENCES "public"."appointments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."customer_loyalty_stamp_entries"
    ADD CONSTRAINT "customer_loyalty_stamp_entries_source_customer_referral_id_fkey" FOREIGN KEY ("source_customer_referral_id") REFERENCES "public"."customer_referrals"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."customer_loyalty_stamp_entries"
    ADD CONSTRAINT "customer_loyalty_stamp_entries_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_referral_codes"
    ADD CONSTRAINT "customer_referral_codes_referrer_client_id_fkey" FOREIGN KEY ("referrer_client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_referral_codes"
    ADD CONSTRAINT "customer_referral_codes_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_referrals"
    ADD CONSTRAINT "customer_referrals_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."customer_referrals"
    ADD CONSTRAINT "customer_referrals_booking_request_id_fkey" FOREIGN KEY ("booking_request_id") REFERENCES "public"."booking_payment_requests"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."customer_referrals"
    ADD CONSTRAINT "customer_referrals_referred_client_id_fkey" FOREIGN KEY ("referred_client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."customer_referrals"
    ADD CONSTRAINT "customer_referrals_referrer_client_id_fkey" FOREIGN KEY ("referrer_client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_referrals"
    ADD CONSTRAINT "customer_referrals_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_message_logs"
    ADD CONSTRAINT "email_message_logs_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."email_message_logs"
    ADD CONSTRAINT "email_message_logs_payment_intent_id_fkey" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."email_message_logs"
    ADD CONSTRAINT "email_message_logs_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."financial_audit_logs"
    ADD CONSTRAINT "financial_audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."financial_audit_logs"
    ADD CONSTRAINT "financial_audit_logs_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."manual_service_entries"
    ADD CONSTRAINT "manual_service_entries_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."manual_service_entries"
    ADD CONSTRAINT "manual_service_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."manual_service_entries"
    ADD CONSTRAINT "manual_service_entries_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."manual_service_entries"
    ADD CONSTRAINT "manual_service_entries_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."manual_service_entries"
    ADD CONSTRAINT "manual_service_entries_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications_log"
    ADD CONSTRAINT "notifications_log_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notifications_log"
    ADD CONSTRAINT "notifications_log_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."onboarding_progress"
    ADD CONSTRAINT "onboarding_progress_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_intents"
    ADD CONSTRAINT "payment_intents_booking_request_id_fkey" FOREIGN KEY ("booking_request_id") REFERENCES "public"."booking_payment_requests"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."platform_billing_events"
    ADD CONSTRAINT "platform_billing_events_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."referral_credits"
    ADD CONSTRAINT "referral_credits_referral_id_fkey" FOREIGN KEY ("referral_id") REFERENCES "public"."referrals"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."referral_credits"
    ADD CONSTRAINT "referral_credits_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."referrals"
    ADD CONSTRAINT "referrals_referred_studio_id_fkey" FOREIGN KEY ("referred_studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."referrals"
    ADD CONSTRAINT "referrals_referrer_studio_id_fkey" FOREIGN KEY ("referrer_studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."refund_requests"
    ADD CONSTRAINT "refund_requests_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."refund_requests"
    ADD CONSTRAINT "refund_requests_booking_request_id_fkey" FOREIGN KEY ("booking_request_id") REFERENCES "public"."booking_payment_requests"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."refund_requests"
    ADD CONSTRAINT "refund_requests_payment_intent_id_fkey" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."refund_requests"
    ADD CONSTRAINT "refund_requests_platform_processed_by_fkey" FOREIGN KEY ("platform_processed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."refund_requests"
    ADD CONSTRAINT "refund_requests_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."service_categories"
    ADD CONSTRAINT "service_categories_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."service_categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."staff_availability"
    ADD CONSTRAINT "staff_availability_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."staff_availability"
    ADD CONSTRAINT "staff_availability_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."staff_services"
    ADD CONSTRAINT "staff_services_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."staff_services"
    ADD CONSTRAINT "staff_services_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."staff"
    ADD CONSTRAINT "staff_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."staff_time_off"
    ADD CONSTRAINT "staff_time_off_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."staff_time_off"
    ADD CONSTRAINT "staff_time_off_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."staff"
    ADD CONSTRAINT "staff_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."studio_follows"
    ADD CONSTRAINT "studio_follows_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."studio_follows"
    ADD CONSTRAINT "studio_follows_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."studio_notification_deliveries"
    ADD CONSTRAINT "studio_notification_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "public"."studio_notifications"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."studio_notification_deliveries"
    ADD CONSTRAINT "studio_notification_deliveries_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."studio_notification_deliveries"
    ADD CONSTRAINT "studio_notification_deliveries_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "public"."push_subscriptions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."studio_notifications"
    ADD CONSTRAINT "studio_notifications_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."studio_notifications"
    ADD CONSTRAINT "studio_notifications_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."studio_payout_settings"
    ADD CONSTRAINT "studio_payout_settings_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."studio_plan_events"
    ADD CONSTRAINT "studio_plan_events_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."studio_reviews"
    ADD CONSTRAINT "studio_reviews_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."studio_reviews"
    ADD CONSTRAINT "studio_reviews_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."studio_reviews"
    ADD CONSTRAINT "studio_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."upsell_offers"
    ADD CONSTRAINT "upsell_offers_offered_service_id_fkey" FOREIGN KEY ("offered_service_id") REFERENCES "public"."services"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."upsell_offers"
    ADD CONSTRAINT "upsell_offers_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."upsell_offers"
    ADD CONSTRAINT "upsell_offers_trigger_service_id_fkey" FOREIGN KEY ("trigger_service_id") REFERENCES "public"."services"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."whatsapp_admin_audit_logs"
    ADD CONSTRAINT "whatsapp_admin_audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."whatsapp_admin_audit_logs"
    ADD CONSTRAINT "whatsapp_admin_audit_logs_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."whatsapp_message_logs"
    ADD CONSTRAINT "whatsapp_message_logs_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."whatsapp_message_logs"
    ADD CONSTRAINT "whatsapp_message_logs_payment_intent_id_fkey" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."whatsapp_message_logs"
    ADD CONSTRAINT "whatsapp_message_logs_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."whatsapp_platform_settings"
    ADD CONSTRAINT "whatsapp_platform_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."whatsapp_studio_entitlements"
    ADD CONSTRAINT "whatsapp_studio_entitlements_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."whatsapp_trial_identity_claims"
    ADD CONSTRAINT "whatsapp_trial_identity_claims_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."whatsapp_usage_alerts"
    ADD CONSTRAINT "whatsapp_usage_alerts_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."whatsapp_usage_ledger"
    ADD CONSTRAINT "whatsapp_usage_ledger_message_log_id_fkey" FOREIGN KEY ("message_log_id") REFERENCES "public"."whatsapp_message_logs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."whatsapp_usage_ledger"
    ADD CONSTRAINT "whatsapp_usage_ledger_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."withdrawal_requests"
    ADD CONSTRAINT "withdrawal_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."withdrawal_requests"
    ADD CONSTRAINT "withdrawal_requests_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



CREATE POLICY "Members create services" ON "public"."services" FOR INSERT TO "authenticated" WITH CHECK ("public"."can_use_studio"("auth"."uid"(), "studio_id"));



CREATE POLICY "Members manage availability" ON "public"."staff_availability" TO "authenticated" USING ("public"."can_use_studio"("auth"."uid"(), "studio_id")) WITH CHECK ("public"."can_use_studio"("auth"."uid"(), "studio_id"));



CREATE POLICY "Members manage cash register movements" ON "public"."cash_register_movements" TO "authenticated" USING ("public"."is_studio_member"("auth"."uid"(), "studio_id")) WITH CHECK ("public"."is_studio_member"("auth"."uid"(), "studio_id"));



CREATE POLICY "Members manage cash register sessions" ON "public"."cash_register_sessions" TO "authenticated" USING ("public"."is_studio_member"("auth"."uid"(), "studio_id")) WITH CHECK ("public"."is_studio_member"("auth"."uid"(), "studio_id"));



CREATE POLICY "Members manage categories" ON "public"."service_categories" TO "authenticated" USING ("public"."can_use_studio"("auth"."uid"(), "studio_id")) WITH CHECK ("public"."can_use_studio"("auth"."uid"(), "studio_id"));



CREATE POLICY "Members manage manual service entries" ON "public"."manual_service_entries" TO "authenticated" USING ("public"."can_use_studio"("auth"."uid"(), "studio_id")) WITH CHECK ("public"."can_use_studio"("auth"."uid"(), "studio_id"));



CREATE POLICY "Members manage onboarding_progress" ON "public"."onboarding_progress" TO "authenticated" USING ("public"."can_use_studio"("auth"."uid"(), "studio_id")) WITH CHECK ("public"."can_use_studio"("auth"."uid"(), "studio_id"));



CREATE POLICY "Members manage own studio" ON "public"."studios" TO "authenticated" USING ("public"."can_use_studio"("auth"."uid"(), "id")) WITH CHECK ("public"."can_use_studio"("auth"."uid"(), "id"));



CREATE POLICY "Members manage refund requests" ON "public"."refund_requests" TO "authenticated" USING ("public"."can_use_studio"("auth"."uid"(), "studio_id")) WITH CHECK ("public"."can_use_studio"("auth"."uid"(), "studio_id"));



CREATE POLICY "Members manage staff" ON "public"."staff" TO "authenticated" USING ("public"."can_use_studio"("auth"."uid"(), "studio_id")) WITH CHECK ("public"."can_use_studio"("auth"."uid"(), "studio_id"));



CREATE POLICY "Members manage staff_services" ON "public"."staff_services" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."staff" "s"
  WHERE (("s"."id" = "staff_services"."staff_id") AND "public"."can_use_studio"("auth"."uid"(), "s"."studio_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."staff" "s"
  WHERE (("s"."id" = "staff_services"."staff_id") AND "public"."can_use_studio"("auth"."uid"(), "s"."studio_id")))));



CREATE POLICY "Members manage time_off" ON "public"."staff_time_off" TO "authenticated" USING ("public"."can_use_studio"("auth"."uid"(), "studio_id")) WITH CHECK ("public"."can_use_studio"("auth"."uid"(), "studio_id"));



CREATE POLICY "Members manage upsells" ON "public"."upsell_offers" TO "authenticated" USING ("public"."can_use_studio"("auth"."uid"(), "studio_id")) WITH CHECK ("public"."can_use_studio"("auth"."uid"(), "studio_id"));



CREATE POLICY "Members read WhatsApp alerts" ON "public"."whatsapp_usage_alerts" FOR SELECT TO "authenticated" USING (("public"."is_studio_member"("auth"."uid"(), "studio_id") OR "public"."is_saas_owner"()));



CREATE POLICY "Members read WhatsApp entitlement" ON "public"."whatsapp_studio_entitlements" FOR SELECT TO "authenticated" USING (("public"."is_studio_member"("auth"."uid"(), "studio_id") OR "public"."is_saas_owner"()));



CREATE POLICY "Members read WhatsApp usage" ON "public"."whatsapp_usage_ledger" FOR SELECT TO "authenticated" USING (("public"."is_studio_member"("auth"."uid"(), "studio_id") OR "public"."is_saas_owner"()));



CREATE POLICY "Members read booking payment requests" ON "public"."booking_payment_requests" FOR SELECT TO "authenticated" USING ("public"."can_use_studio"("auth"."uid"(), "studio_id"));



CREATE POLICY "Members read client appointment action logs" ON "public"."client_appointment_action_logs" FOR SELECT TO "authenticated" USING ("public"."is_studio_member"("auth"."uid"(), "studio_id"));



CREATE POLICY "Members read email message logs" ON "public"."email_message_logs" FOR SELECT TO "authenticated" USING ("public"."is_studio_member"("auth"."uid"(), "studio_id"));



CREATE POLICY "Members read notifications" ON "public"."notifications_log" FOR SELECT TO "authenticated" USING ("public"."can_use_studio"("auth"."uid"(), "studio_id"));



CREATE POLICY "Members read own plan history" ON "public"."studio_plan_events" FOR SELECT TO "authenticated" USING (("public"."is_studio_member"("auth"."uid"(), "studio_id") OR "public"."is_saas_owner"()));



CREATE POLICY "Members read platform billing events" ON "public"."platform_billing_events" FOR SELECT USING ((("studio_id" IS NOT NULL) AND "public"."is_studio_member"("auth"."uid"(), "studio_id")));



CREATE POLICY "Members read policy acceptances" ON "public"."booking_policy_acceptances" FOR SELECT TO "authenticated" USING ("public"."can_use_studio"("auth"."uid"(), "studio_id"));



CREATE POLICY "Members read services" ON "public"."services" FOR SELECT TO "authenticated" USING ("public"."can_use_studio"("auth"."uid"(), "studio_id"));



CREATE POLICY "Members read studio notification deliveries" ON "public"."studio_notification_deliveries" FOR SELECT TO "authenticated" USING ("public"."is_studio_member"("auth"."uid"(), "studio_id"));



CREATE POLICY "Members read studio notifications" ON "public"."studio_notifications" FOR SELECT TO "authenticated" USING ("public"."can_use_studio"("auth"."uid"(), "studio_id"));



CREATE POLICY "Members read withdrawal requests" ON "public"."withdrawal_requests" FOR SELECT TO "authenticated" USING ("public"."can_use_studio"("auth"."uid"(), "studio_id"));



CREATE POLICY "Members update services" ON "public"."services" FOR UPDATE TO "authenticated" USING ("public"."can_use_studio"("auth"."uid"(), "studio_id")) WITH CHECK ("public"."can_use_studio"("auth"."uid"(), "studio_id"));



CREATE POLICY "Members update studio notifications" ON "public"."studio_notifications" FOR UPDATE TO "authenticated" USING ("public"."can_use_studio"("auth"."uid"(), "studio_id")) WITH CHECK ("public"."can_use_studio"("auth"."uid"(), "studio_id"));



CREATE POLICY "Plan permits WhatsApp alert reads" ON "public"."whatsapp_usage_alerts" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (("public"."studio_has_entitlement"("studio_id", 'whatsapp'::"text") OR "public"."is_saas_owner"()));



CREATE POLICY "Plan permits WhatsApp entitlement reads" ON "public"."whatsapp_studio_entitlements" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (("public"."studio_has_entitlement"("studio_id", 'whatsapp'::"text") OR "public"."is_saas_owner"()));



CREATE POLICY "Plan permits WhatsApp history" ON "public"."whatsapp_message_logs" AS RESTRICTIVE TO "authenticated" USING (("public"."studio_has_entitlement"("studio_id", 'whatsapp'::"text") OR "public"."is_saas_owner"())) WITH CHECK (("public"."studio_has_entitlement"("studio_id", 'whatsapp'::"text") OR "public"."is_saas_owner"()));



CREATE POLICY "Plan permits WhatsApp usage reads" ON "public"."whatsapp_usage_ledger" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (("public"."studio_has_entitlement"("studio_id", 'whatsapp'::"text") OR "public"."is_saas_owner"()));



CREATE POLICY "Plan permits booking payment reads" ON "public"."booking_payment_requests" AS RESTRICTIVE TO "authenticated" USING (("public"."studio_has_entitlement"("studio_id", 'online_payments'::"text") OR "public"."is_saas_owner"())) WITH CHECK (("public"."studio_has_entitlement"("studio_id", 'online_payments'::"text") OR "public"."is_saas_owner"()));



CREATE POLICY "Plan permits cash register access" ON "public"."cash_register_movements" AS RESTRICTIVE TO "authenticated" USING (("public"."studio_has_entitlement"("studio_id", 'finance_basic'::"text") OR "public"."is_saas_owner"())) WITH CHECK (("public"."studio_has_entitlement"("studio_id", 'finance_basic'::"text") OR "public"."is_saas_owner"()));



CREATE POLICY "Plan permits cash session access" ON "public"."cash_register_sessions" AS RESTRICTIVE TO "authenticated" USING (("public"."studio_has_entitlement"("studio_id", 'finance_basic'::"text") OR "public"."is_saas_owner"())) WITH CHECK (("public"."studio_has_entitlement"("studio_id", 'finance_basic'::"text") OR "public"."is_saas_owner"()));



CREATE POLICY "Plan permits customer referral codes" ON "public"."customer_referral_codes" AS RESTRICTIVE TO "authenticated" USING (("public"."studio_has_entitlement"("studio_id", 'loyalty'::"text") OR "public"."is_saas_owner"())) WITH CHECK (("public"."studio_has_entitlement"("studio_id", 'loyalty'::"text") OR "public"."is_saas_owner"()));



CREATE POLICY "Plan permits customer referrals" ON "public"."customer_referrals" AS RESTRICTIVE TO "authenticated" USING (("public"."studio_has_entitlement"("studio_id", 'loyalty'::"text") OR "public"."is_saas_owner"())) WITH CHECK (("public"."studio_has_entitlement"("studio_id", 'loyalty'::"text") OR "public"."is_saas_owner"()));



CREATE POLICY "Plan permits email notification history" ON "public"."email_message_logs" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (("public"."studio_has_entitlement"("studio_id", 'notifications'::"text") OR "public"."is_saas_owner"()));



CREATE POLICY "Plan permits loyalty rewards" ON "public"."customer_loyalty_rewards" AS RESTRICTIVE TO "authenticated" USING (("public"."studio_has_entitlement"("studio_id", 'loyalty'::"text") OR "public"."is_saas_owner"())) WITH CHECK (("public"."studio_has_entitlement"("studio_id", 'loyalty'::"text") OR "public"."is_saas_owner"()));



CREATE POLICY "Plan permits loyalty settings" ON "public"."customer_loyalty_settings" AS RESTRICTIVE TO "authenticated" USING (("public"."studio_has_entitlement"("studio_id", 'loyalty'::"text") OR "public"."is_saas_owner"())) WITH CHECK (("public"."studio_has_entitlement"("studio_id", 'loyalty'::"text") OR "public"."is_saas_owner"()));



CREATE POLICY "Plan permits loyalty stamps" ON "public"."customer_loyalty_stamp_entries" AS RESTRICTIVE TO "authenticated" USING (("public"."studio_has_entitlement"("studio_id", 'loyalty'::"text") OR "public"."is_saas_owner"())) WITH CHECK (("public"."studio_has_entitlement"("studio_id", 'loyalty'::"text") OR "public"."is_saas_owner"()));



CREATE POLICY "Plan permits manual financial entries" ON "public"."manual_service_entries" AS RESTRICTIVE TO "authenticated" USING (("public"."studio_has_entitlement"("studio_id", 'finance_basic'::"text") OR "public"."is_saas_owner"())) WITH CHECK (("public"."studio_has_entitlement"("studio_id", 'finance_basic'::"text") OR "public"."is_saas_owner"()));



CREATE POLICY "Plan permits notification deliveries" ON "public"."studio_notification_deliveries" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (("public"."studio_has_entitlement"("studio_id", 'notifications'::"text") OR "public"."is_saas_owner"()));



CREATE POLICY "Plan permits notification history" ON "public"."notifications_log" AS RESTRICTIVE TO "authenticated" USING (("public"."studio_has_entitlement"("studio_id", 'notifications'::"text") OR "public"."is_saas_owner"())) WITH CHECK (("public"."studio_has_entitlement"("studio_id", 'notifications'::"text") OR "public"."is_saas_owner"()));



CREATE POLICY "Plan permits payment intent reads" ON "public"."payment_intents" AS RESTRICTIVE TO "authenticated" USING (("public"."studio_has_entitlement"("studio_id", 'finance_basic'::"text") OR "public"."is_saas_owner"())) WITH CHECK (("public"."studio_has_entitlement"("studio_id", 'finance_basic'::"text") OR "public"."is_saas_owner"()));



CREATE POLICY "Plan permits payout settings access" ON "public"."studio_payout_settings" AS RESTRICTIVE TO "authenticated" USING (("public"."studio_has_entitlement"("studio_id", 'finance_advanced'::"text") OR "public"."is_saas_owner"())) WITH CHECK (("public"."studio_has_entitlement"("studio_id", 'finance_advanced'::"text") OR "public"."is_saas_owner"()));



CREATE POLICY "Plan permits promotions" ON "public"."upsell_offers" AS RESTRICTIVE TO "authenticated", "anon" USING (("public"."studio_has_entitlement"("studio_id", 'promotions'::"text") OR "public"."is_saas_owner"())) WITH CHECK (("public"."studio_has_entitlement"("studio_id", 'promotions'::"text") OR "public"."is_saas_owner"()));



CREATE POLICY "Plan permits push subscription reads" ON "public"."push_subscriptions" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (("public"."studio_has_entitlement"("studio_id", 'notifications'::"text") OR "public"."is_saas_owner"()));



CREATE POLICY "Plan permits refund access" ON "public"."refund_requests" AS RESTRICTIVE TO "authenticated" USING (("public"."studio_has_entitlement"("studio_id", 'online_payments'::"text") OR "public"."is_saas_owner"())) WITH CHECK (("public"."studio_has_entitlement"("studio_id", 'online_payments'::"text") OR "public"."is_saas_owner"()));



CREATE POLICY "Plan permits reviews" ON "public"."studio_reviews" AS RESTRICTIVE TO "authenticated", "anon" USING (("public"."studio_has_entitlement"("studio_id", 'reviews'::"text") OR "public"."is_saas_owner"())) WITH CHECK (("public"."studio_has_entitlement"("studio_id", 'reviews'::"text") OR "public"."is_saas_owner"()));



CREATE POLICY "Plan permits studio notifications" ON "public"."studio_notifications" AS RESTRICTIVE TO "authenticated" USING (("public"."studio_has_entitlement"("studio_id", 'notifications'::"text") OR "public"."is_saas_owner"())) WITH CHECK (("public"."studio_has_entitlement"("studio_id", 'notifications'::"text") OR "public"."is_saas_owner"()));



CREATE POLICY "Plan permits visible professional availability" ON "public"."staff_availability" AS RESTRICTIVE TO "authenticated" USING (("public"."studio_staff_is_within_plan"("studio_id", "staff_id") OR "public"."is_saas_owner"())) WITH CHECK (("public"."studio_staff_is_within_plan"("studio_id", "staff_id") OR "public"."is_saas_owner"()));



CREATE POLICY "Plan permits visible professional services" ON "public"."staff_services" AS RESTRICTIVE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."staff" "member"
  WHERE (("member"."id" = "staff_services"."staff_id") AND ("public"."studio_staff_is_within_plan"("member"."studio_id", "member"."id") OR "public"."is_saas_owner"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."staff" "member"
  WHERE (("member"."id" = "staff_services"."staff_id") AND ("public"."studio_staff_is_within_plan"("member"."studio_id", "member"."id") OR "public"."is_saas_owner"())))));



CREATE POLICY "Plan permits visible professional time off" ON "public"."staff_time_off" AS RESTRICTIVE TO "authenticated" USING (("public"."studio_staff_is_within_plan"("studio_id", "staff_id") OR "public"."is_saas_owner"())) WITH CHECK (("public"."studio_staff_is_within_plan"("studio_id", "staff_id") OR "public"."is_saas_owner"()));



CREATE POLICY "Plan permits visible professionals" ON "public"."staff" AS RESTRICTIVE TO "authenticated" USING (("public"."studio_staff_is_within_plan"("studio_id", "id") OR "public"."is_saas_owner"())) WITH CHECK (("public"."studio_staff_is_within_plan"("studio_id", "id") OR ("is_active" IS DISTINCT FROM true) OR "public"."studio_can_add_professional"("studio_id") OR "public"."is_saas_owner"()));



CREATE POLICY "Plan permits withdrawal access" ON "public"."withdrawal_requests" AS RESTRICTIVE TO "authenticated" USING (("public"."studio_has_entitlement"("studio_id", 'finance_advanced'::"text") OR "public"."is_saas_owner"())) WITH CHECK (("public"."studio_has_entitlement"("studio_id", 'finance_advanced'::"text") OR "public"."is_saas_owner"()));



CREATE POLICY "Privileged members manage appointment services" ON "public"."appointment_services" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."appointments" "a"
  WHERE (("a"."id" = "appointment_services"."appointment_id") AND "public"."has_privileged_studio_access"("auth"."uid"(), "a"."studio_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."appointments" "a"
  WHERE (("a"."id" = "appointment_services"."appointment_id") AND "public"."has_privileged_studio_access"("auth"."uid"(), "a"."studio_id")))));



CREATE POLICY "Privileged members manage appointments" ON "public"."appointments" TO "authenticated" USING ("public"."has_privileged_studio_access"("auth"."uid"(), "studio_id")) WITH CHECK ("public"."has_privileged_studio_access"("auth"."uid"(), "studio_id"));



CREATE POLICY "Privileged members manage clients" ON "public"."clients" TO "authenticated" USING ("public"."has_privileged_studio_access"("auth"."uid"(), "studio_id")) WITH CHECK ("public"."has_privileged_studio_access"("auth"."uid"(), "studio_id"));



CREATE POLICY "Privileged members read payment intents" ON "public"."payment_intents" FOR SELECT TO "authenticated" USING ("public"."has_privileged_studio_access"("auth"."uid"(), "studio_id"));



CREATE POLICY "Privileged members read whatsapp logs" ON "public"."whatsapp_message_logs" FOR SELECT TO "authenticated" USING ("public"."has_privileged_studio_access"("auth"."uid"(), "studio_id"));



CREATE POLICY "Professionals manage own appointment services" ON "public"."appointment_services" TO "authenticated" USING ("public"."staff_owns_appointment"("auth"."uid"(), "appointment_id")) WITH CHECK ("public"."staff_owns_appointment"("auth"."uid"(), "appointment_id"));



CREATE POLICY "Professionals manage own appointments" ON "public"."appointments" TO "authenticated" USING ("public"."staff_owns_appointment"("auth"."uid"(), "id")) WITH CHECK (("public"."has_privileged_studio_access"("auth"."uid"(), "studio_id") OR (EXISTS ( SELECT 1
   FROM ("public"."staff" "st"
     JOIN "public"."user_roles" "ur" ON ((("ur"."user_id" = "auth"."uid"()) AND ("ur"."studio_id" = "appointments"."studio_id") AND (("ur"."role")::"text" = 'staff'::"text"))))
  WHERE (("st"."id" = "appointments"."staff_id") AND ("st"."studio_id" = "appointments"."studio_id") AND ("st"."user_id" = "auth"."uid"()) AND ("st"."is_active" = true))))));



CREATE POLICY "Professionals read own payment intents" ON "public"."payment_intents" FOR SELECT TO "authenticated" USING ((("appointment_id" IS NOT NULL) AND "public"."staff_owns_appointment"("auth"."uid"(), "appointment_id")));



CREATE POLICY "Professionals read own whatsapp logs" ON "public"."whatsapp_message_logs" FOR SELECT TO "authenticated" USING ((("appointment_id" IS NOT NULL) AND "public"."staff_owns_appointment"("auth"."uid"(), "appointment_id")));



CREATE POLICY "Professionals read served clients" ON "public"."clients" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."appointments" "a"
  WHERE (("a"."client_id" = "clients"."id") AND "public"."staff_owns_appointment"("auth"."uid"(), "a"."id")))));



CREATE POLICY "Professionals update served clients" ON "public"."clients" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."appointments" "a"
  WHERE (("a"."client_id" = "clients"."id") AND "public"."staff_owns_appointment"("auth"."uid"(), "a"."id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."appointments" "a"
  WHERE (("a"."client_id" = "clients"."id") AND "public"."staff_owns_appointment"("auth"."uid"(), "a"."id")))));



CREATE POLICY "Public read suggestions" ON "public"."service_category_suggestions" FOR SELECT TO "authenticated", "anon" USING (("is_active" = true));



CREATE POLICY "SaaS owners manage WhatsApp entitlement" ON "public"."whatsapp_studio_entitlements" TO "authenticated" USING ("public"."is_saas_owner"()) WITH CHECK ("public"."is_saas_owner"());



CREATE POLICY "SaaS owners manage WhatsApp settings" ON "public"."whatsapp_platform_settings" TO "authenticated" USING ("public"."is_saas_owner"()) WITH CHECK ("public"."is_saas_owner"());



CREATE POLICY "SaaS owners read WhatsApp audit" ON "public"."whatsapp_admin_audit_logs" FOR SELECT TO "authenticated" USING ("public"."is_saas_owner"());



CREATE POLICY "SaaS owners read WhatsApp trial claims" ON "public"."whatsapp_trial_identity_claims" FOR SELECT TO "authenticated" USING ("public"."is_saas_owner"());



CREATE POLICY "Saas owners read financial audit logs" ON "public"."financial_audit_logs" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = 'saas_owner'::"public"."app_role")))));



CREATE POLICY "Service role manages WhatsApp alerts" ON "public"."whatsapp_usage_alerts" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role manages WhatsApp audit" ON "public"."whatsapp_admin_audit_logs" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role manages WhatsApp entitlements" ON "public"."whatsapp_studio_entitlements" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role manages WhatsApp settings" ON "public"."whatsapp_platform_settings" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role manages WhatsApp trial claims" ON "public"."whatsapp_trial_identity_claims" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role manages WhatsApp usage" ON "public"."whatsapp_usage_ledger" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role manages client appointment action logs" ON "public"."client_appointment_action_logs" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role manages email message logs" ON "public"."email_message_logs" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role manages plan history" ON "public"."studio_plan_events" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role manages schedule events" ON "public"."appointment_schedule_events" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role manages studio notification deliveries" ON "public"."studio_notification_deliveries" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role manages whatsapp message logs" ON "public"."whatsapp_message_logs" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Studio members manage loyalty settings" ON "public"."customer_loyalty_settings" TO "authenticated" USING ("public"."is_studio_member"("auth"."uid"(), "studio_id")) WITH CHECK ("public"."is_studio_member"("auth"."uid"(), "studio_id"));



CREATE POLICY "Studio members read customer loyalty" ON "public"."customer_referral_codes" FOR SELECT TO "authenticated" USING ("public"."is_studio_member"("auth"."uid"(), "studio_id"));



CREATE POLICY "Studio members read customer referrals" ON "public"."customer_referrals" FOR SELECT TO "authenticated" USING ("public"."is_studio_member"("auth"."uid"(), "studio_id"));



CREATE POLICY "Studio members read customer rewards" ON "public"."customer_loyalty_rewards" FOR SELECT TO "authenticated" USING ("public"."is_studio_member"("auth"."uid"(), "studio_id"));



CREATE POLICY "Studio members read customer stamps" ON "public"."customer_loyalty_stamp_entries" FOR SELECT TO "authenticated" USING ("public"."is_studio_member"("auth"."uid"(), "studio_id"));



CREATE POLICY "Studio members read schedule events" ON "public"."appointment_schedule_events" FOR SELECT TO "authenticated" USING ("public"."can_use_studio"("auth"."uid"(), "studio_id"));



CREATE POLICY "Studio members read subscriptions" ON "public"."subscriptions" FOR SELECT USING ((("studio_id" IS NOT NULL) AND "public"."is_studio_member"("auth"."uid"(), "studio_id")));



CREATE POLICY "Studio owners manage payout settings" ON "public"."studio_payout_settings" TO "authenticated" USING (("public"."has_role"("auth"."uid"(), "studio_id", 'studio_owner'::"public"."app_role") AND "public"."has_active_premium_access"("studio_id"))) WITH CHECK (("public"."has_role"("auth"."uid"(), "studio_id", 'studio_owner'::"public"."app_role") AND "public"."has_active_premium_access"("studio_id")));



CREATE POLICY "Studio owners manage roles" ON "public"."user_roles" TO "authenticated" USING ((("studio_id" IS NOT NULL) AND ("public"."is_saas_owner"() OR ("public"."has_role"("auth"."uid"(), "studio_id", 'studio_owner'::"public"."app_role") AND "public"."studio_has_entitlement"("studio_id", 'team_management'::"text"))))) WITH CHECK ((("studio_id" IS NOT NULL) AND ("public"."is_saas_owner"() OR ("public"."has_role"("auth"."uid"(), "studio_id", 'studio_owner'::"public"."app_role") AND "public"."studio_has_entitlement"("studio_id", 'team_management'::"text")))));



CREATE POLICY "Users can manage their own follows" ON "public"."studio_follows" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users create own profile" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK (("id" = "auth"."uid"()));



CREATE POLICY "Users delete own push subscriptions" ON "public"."push_subscriptions" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users read own push subscriptions" ON "public"."push_subscriptions" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users read own subscriptions" ON "public"."subscriptions" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users update own profile" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("id" = "auth"."uid"())) WITH CHECK (("id" = "auth"."uid"()));



CREATE POLICY "Users view own profile" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("id" = "auth"."uid"()));



CREATE POLICY "Users view own roles" ON "public"."user_roles" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."appointment_schedule_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."appointment_services" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."appointments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."booking_payment_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."booking_policy_acceptances" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cash_register_movements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cash_register_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_appointment_action_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."clients" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customer_loyalty_rewards" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customer_loyalty_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customer_loyalty_stamp_entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customer_referral_codes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customer_referrals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."email_message_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."financial_audit_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."manual_service_entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."onboarding_progress" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payment_intents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."platform_billing_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."push_subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."referral_credits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."referrals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."refund_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."server_rate_limits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."service_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."service_category_suggestions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."services" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."staff" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."staff_availability" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."staff_services" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."staff_time_off" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."studio_follows" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."studio_notification_deliveries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."studio_notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."studio_payout_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."studio_plan_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."studio_reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."studio_trial_extension_backup_20260719_1910" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."studios" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."studios_cancel_flag_backup_20260705_194119" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."studios_trial_renewal_backup_20260821" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."studios_trial_reset_backup_20260807" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."studios_trial_restore_backup_20260705_190426" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subscriptions_trial_renewal_backup_20260821" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subscriptions_trial_reset_backup_20260807" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."upsell_offers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."whatsapp_admin_audit_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."whatsapp_message_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."whatsapp_platform_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."whatsapp_studio_entitlements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."whatsapp_trial_identity_claims" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."whatsapp_usage_alerts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."whatsapp_usage_ledger" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."withdrawal_requests" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."acknowledge_studio_notification_delivery"("p_delivery_id" "uuid", "p_receipt_token" "uuid", "p_stage" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."acknowledge_studio_notification_delivery"("p_delivery_id" "uuid", "p_receipt_token" "uuid", "p_stage" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."activate_appointment_lifecycle"() TO "anon";
GRANT ALL ON FUNCTION "public"."activate_appointment_lifecycle"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."activate_appointment_lifecycle"() TO "service_role";



GRANT ALL ON TABLE "public"."cash_register_movements" TO "anon";
GRANT ALL ON TABLE "public"."cash_register_movements" TO "authenticated";
GRANT ALL ON TABLE "public"."cash_register_movements" TO "service_role";



GRANT ALL ON FUNCTION "public"."add_cash_register_movement"("p_session_id" "uuid", "p_movement_type" "text", "p_payment_method" "text", "p_amount" numeric, "p_description" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."add_cash_register_movement"("p_session_id" "uuid", "p_movement_type" "text", "p_payment_method" "text", "p_amount" numeric, "p_description" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_cash_register_movement"("p_session_id" "uuid", "p_movement_type" "text", "p_payment_method" "text", "p_amount" numeric, "p_description" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."audit_payment_intent_succeeded"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."audit_payment_intent_succeeded"() TO "anon";
GRANT ALL ON FUNCTION "public"."audit_payment_intent_succeeded"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."audit_payment_intent_succeeded"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_use_studio"("_user_id" "uuid", "_studio_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_use_studio"("_user_id" "uuid", "_studio_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_use_studio"("_user_id" "uuid", "_studio_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."capture_appointment_commission_snapshot"() TO "anon";
GRANT ALL ON FUNCTION "public"."capture_appointment_commission_snapshot"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."capture_appointment_commission_snapshot"() TO "service_role";



GRANT ALL ON FUNCTION "public"."capture_appointment_service_commission_snapshot"() TO "anon";
GRANT ALL ON FUNCTION "public"."capture_appointment_service_commission_snapshot"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."capture_appointment_service_commission_snapshot"() TO "service_role";



GRANT ALL ON FUNCTION "public"."capture_booking_payment_pricing_snapshot"() TO "anon";
GRANT ALL ON FUNCTION "public"."capture_booking_payment_pricing_snapshot"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."capture_booking_payment_pricing_snapshot"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_studio_notification_deliveries"("p_limit" integer, "p_studio_id" "uuid", "p_notification_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_studio_notification_deliveries"("p_limit" integer, "p_studio_id" "uuid", "p_notification_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_whatsapp_trial_for_owner"() TO "anon";
GRANT ALL ON FUNCTION "public"."claim_whatsapp_trial_for_owner"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_whatsapp_trial_for_owner"() TO "service_role";



GRANT ALL ON TABLE "public"."cash_register_sessions" TO "anon";
GRANT ALL ON TABLE "public"."cash_register_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."cash_register_sessions" TO "service_role";



GRANT ALL ON FUNCTION "public"."close_cash_register"("p_session_id" "uuid", "p_counted_amount" numeric, "p_note" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."close_cash_register"("p_session_id" "uuid", "p_counted_amount" numeric, "p_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."close_cash_register"("p_session_id" "uuid", "p_counted_amount" numeric, "p_note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."confirm_paid_booking_request"("p_request_id" "uuid", "p_stripe_payment_intent_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."confirm_paid_booking_request"("p_request_id" "uuid", "p_stripe_payment_intent_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."confirm_studio_appointment_payment"("p_appointment_id" "uuid", "p_payment_method" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."confirm_studio_appointment_payment"("p_appointment_id" "uuid", "p_payment_method" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."confirm_studio_appointment_payment"("p_appointment_id" "uuid", "p_payment_method" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."consume_rate_limit"("p_key" "text", "p_limit" integer, "p_window_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."consume_rate_limit"("p_key" "text", "p_limit" integer, "p_window_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_manual_appointment"("p_studio_id" "uuid", "p_staff_id" "uuid", "p_service_id" "uuid", "p_starts_at" timestamp with time zone, "p_client_id" "uuid", "p_client_name" "text", "p_client_phone" "text", "p_notes" "text", "p_is_fit" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_manual_appointment"("p_studio_id" "uuid", "p_staff_id" "uuid", "p_service_id" "uuid", "p_starts_at" timestamp with time zone, "p_client_id" "uuid", "p_client_name" "text", "p_client_phone" "text", "p_notes" "text", "p_is_fit" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_manual_appointment"("p_studio_id" "uuid", "p_staff_id" "uuid", "p_service_id" "uuid", "p_starts_at" timestamp with time zone, "p_client_id" "uuid", "p_client_name" "text", "p_client_phone" "text", "p_notes" "text", "p_is_fit" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_public_booking"("p_studio_slug" "text", "p_staff_id" "uuid", "p_starts_at" timestamp with time zone, "p_service_ids" "uuid"[], "p_client_name" "text", "p_client_phone" "text", "p_client_email" "text", "p_notes" "text", "p_customer_referral_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_public_booking"("p_studio_slug" "text", "p_staff_id" "uuid", "p_starts_at" timestamp with time zone, "p_service_ids" "uuid"[], "p_client_name" "text", "p_client_phone" "text", "p_client_email" "text", "p_notes" "text", "p_customer_referral_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_public_booking_online_core"("p_studio_slug" "text", "p_staff_id" "uuid", "p_starts_at" timestamp with time zone, "p_service_ids" "uuid"[], "p_client_name" "text", "p_client_phone" "text", "p_client_email" "text", "p_notes" "text", "p_customer_referral_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_public_booking_online_core"("p_studio_slug" "text", "p_staff_id" "uuid", "p_starts_at" timestamp with time zone, "p_service_ids" "uuid"[], "p_client_name" "text", "p_client_phone" "text", "p_client_email" "text", "p_notes" "text", "p_customer_referral_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_studio_manual_fit"("p_studio_id" "uuid", "p_staff_id" "uuid", "p_service_id" "uuid", "p_starts_at" timestamp with time zone, "p_client_id" "uuid", "p_client_name" "text", "p_client_phone" "text", "p_notes" "text", "p_confirm_overlap" boolean, "p_actor_id" "uuid", "p_expected_conflict_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_studio_manual_fit"("p_studio_id" "uuid", "p_staff_id" "uuid", "p_service_id" "uuid", "p_starts_at" timestamp with time zone, "p_client_id" "uuid", "p_client_name" "text", "p_client_phone" "text", "p_notes" "text", "p_confirm_overlap" boolean, "p_actor_id" "uuid", "p_expected_conflict_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_studio_with_owner"("p_name" "text", "p_slug" "text", "p_timezone" "text", "p_currency" "text", "p_business_segment" "text", "p_trial_phone" "text", "p_trial_device_fingerprint_hash" "text", "p_trial_ip_hash" "text", "p_trial_nif" "text", "p_trial_stripe_account_id" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."create_studio_with_owner"("p_owner_user_id" "uuid", "p_name" "text", "p_slug" "text", "p_timezone" "text", "p_currency" "text", "p_business_segment" "text", "p_trial_phone" "text", "p_trial_device_fingerprint_hash" "text", "p_trial_ip_hash" "text", "p_trial_nif" "text", "p_trial_stripe_account_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_studio_with_owner"("p_owner_user_id" "uuid", "p_name" "text", "p_slug" "text", "p_timezone" "text", "p_currency" "text", "p_business_segment" "text", "p_trial_phone" "text", "p_trial_device_fingerprint_hash" "text", "p_trial_ip_hash" "text", "p_trial_nif" "text", "p_trial_stripe_account_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_walk_in_appointment"("p_studio_id" "uuid", "p_staff_id" "uuid", "p_service_id" "uuid", "p_starts_at" timestamp with time zone, "p_client_id" "uuid", "p_client_name" "text", "p_client_phone" "text", "p_payment_method" "text", "p_amount" numeric, "p_notes" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."create_walk_in_appointment"("p_studio_id" "uuid", "p_staff_id" "uuid", "p_service_id" "uuid", "p_starts_at" timestamp with time zone, "p_client_id" "uuid", "p_client_name" "text", "p_client_phone" "text", "p_payment_method" "text", "p_amount" numeric, "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_walk_in_appointment"("p_studio_id" "uuid", "p_staff_id" "uuid", "p_service_id" "uuid", "p_starts_at" timestamp with time zone, "p_client_id" "uuid", "p_client_name" "text", "p_client_phone" "text", "p_payment_method" "text", "p_amount" numeric, "p_notes" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_whatsapp_entitlement_for_studio"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_whatsapp_entitlement_for_studio"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_whatsapp_entitlement_for_studio"() TO "service_role";



GRANT ALL ON FUNCTION "public"."customer_loyalty_completed_appointment_trigger"() TO "anon";
GRANT ALL ON FUNCTION "public"."customer_loyalty_completed_appointment_trigger"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."customer_loyalty_completed_appointment_trigger"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."diagnose_studio_reschedule_slot"("p_appointment_id" "uuid", "p_studio_id" "uuid", "p_local_date" "date", "p_local_time" time without time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."diagnose_studio_reschedule_slot"("p_appointment_id" "uuid", "p_studio_id" "uuid", "p_local_date" "date", "p_local_time" time without time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_appointment_schedule_overlap"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_appointment_schedule_overlap"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_appointment_schedule_overlap"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_client_plan_protected_columns"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_client_plan_protected_columns"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_client_plan_protected_columns"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."enforce_notification_log_appointment_tenant"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enforce_notification_log_appointment_tenant"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_notification_plan_on_insert"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_notification_plan_on_insert"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_notification_plan_on_insert"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_plan_professional_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_plan_professional_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_plan_professional_limit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_service_plan_protected_columns"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_service_plan_protected_columns"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_service_plan_protected_columns"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_staff_plan_protected_columns"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_staff_plan_protected_columns"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_staff_plan_protected_columns"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."enforce_studio_notification_delivery_tenant"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enforce_studio_notification_delivery_tenant"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."enforce_studio_notification_tenant_time"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enforce_studio_notification_tenant_time"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."enforce_studio_plan_protected_columns"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enforce_studio_plan_protected_columns"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."enqueue_due_appointment_lifecycle_notifications"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enqueue_due_appointment_lifecycle_notifications"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."enqueue_studio_notification_deliveries"("p_studio_id" "uuid", "p_notification_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enqueue_studio_notification_deliveries"("p_studio_id" "uuid", "p_notification_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."ensure_appointment_public_token"() TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_appointment_public_token"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_appointment_public_token"() TO "service_role";



GRANT ALL ON TABLE "public"."customer_loyalty_settings" TO "anon";
GRANT ALL ON TABLE "public"."customer_loyalty_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_loyalty_settings" TO "service_role";



REVOKE ALL ON FUNCTION "public"."ensure_customer_loyalty_settings"("p_studio_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ensure_customer_loyalty_settings"("p_studio_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."expire_pending_appointments"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."expire_pending_appointments"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fanout_studio_notification_delivery"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fanout_studio_notification_delivery"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_stale_studio_notification_deliveries"("p_studio_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_stale_studio_notification_deliveries"("p_studio_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_whatsapp_usage"("p_idempotency_key" "text", "p_outcome" "text", "p_message_log_id" "uuid", "p_provider_message_id" "text", "p_provider_status" "text", "p_metadata" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_whatsapp_usage"("p_idempotency_key" "text", "p_outcome" "text", "p_message_log_id" "uuid", "p_provider_message_id" "text", "p_provider_status" "text", "p_metadata" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_available_slots"("p_studio_slug" "text", "p_staff_id" "uuid", "p_date" "date", "p_duration_min" integer, "p_slot_step_min" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_available_slots"("p_studio_slug" "text", "p_staff_id" "uuid", "p_date" "date", "p_duration_min" integer, "p_slot_step_min" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_available_slots"("p_studio_slug" "text", "p_staff_id" "uuid", "p_date" "date", "p_duration_min" integer, "p_slot_step_min" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_available_slots"("p_studio_slug" "text", "p_staff_id" "uuid", "p_date" "date", "p_duration_min" integer, "p_slot_step_min" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_cash_register_closure_history"("p_studio_id" "uuid", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_cash_register_closure_history"("p_studio_id" "uuid", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_cash_register_closure_history"("p_studio_id" "uuid", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_open_cash_register"("p_studio_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_open_cash_register"("p_studio_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_open_cash_register"("p_studio_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_or_create_customer_referral_code"("p_studio_id" "uuid", "p_client_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_or_create_customer_referral_code"("p_studio_id" "uuid", "p_client_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_or_create_referral_code"("p_studio_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_or_create_referral_code"("p_studio_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_public_reschedule_slots"("p_public_token" "text", "p_staff_id" "uuid", "p_date" "date", "p_slot_step_min" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_public_reschedule_slots"("p_public_token" "text", "p_staff_id" "uuid", "p_date" "date", "p_slot_step_min" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_reschedule_slots"("p_public_token" "text", "p_staff_id" "uuid", "p_date" "date", "p_slot_step_min" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_reschedule_slots"("p_public_token" "text", "p_staff_id" "uuid", "p_date" "date", "p_slot_step_min" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_studio_id_by_referral_code"("p_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_studio_id_by_referral_code"("p_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_studio_id_by_referral_code"("p_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_whatsapp_admin_overview"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_whatsapp_admin_overview"() TO "service_role";



GRANT ALL ON FUNCTION "public"."group_attendance_confirmation_notification"() TO "anon";
GRANT ALL ON FUNCTION "public"."group_attendance_confirmation_notification"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."group_attendance_confirmation_notification"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."guard_studio_platform_fields"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guard_studio_platform_fields"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."has_active_premium_access"("_studio_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."has_active_premium_access"("_studio_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_active_premium_access"("_studio_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."has_privileged_studio_access"("_user_id" "uuid", "_studio_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."has_privileged_studio_access"("_user_id" "uuid", "_studio_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_privileged_studio_access"("_user_id" "uuid", "_studio_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_role"("_user_id" "uuid", "_studio_id" "uuid", "_role" "public"."app_role") TO "anon";
GRANT ALL ON FUNCTION "public"."has_role"("_user_id" "uuid", "_studio_id" "uuid", "_role" "public"."app_role") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_role"("_user_id" "uuid", "_studio_id" "uuid", "_role" "public"."app_role") TO "service_role";



REVOKE ALL ON FUNCTION "public"."insert_studio_notification"("p_studio_id" "uuid", "p_kind" "text", "p_title" "text", "p_body" "text", "p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."insert_studio_notification"("p_studio_id" "uuid", "p_kind" "text", "p_title" "text", "p_body" "text", "p_payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_saas_owner"("_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_saas_owner"("_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_saas_owner"("_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_staff_managerial_slot_bookable"("p_studio_id" "uuid", "p_staff_id" "uuid", "p_starts_at" timestamp with time zone, "p_duration_min" integer, "p_ignore_appointment_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_staff_managerial_slot_bookable"("p_studio_id" "uuid", "p_staff_id" "uuid", "p_starts_at" timestamp with time zone, "p_duration_min" integer, "p_ignore_appointment_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_staff_slot_bookable"("p_studio_id" "uuid", "p_staff_id" "uuid", "p_starts_at" timestamp with time zone, "p_duration_min" integer, "p_ignore_booking_request_id" "uuid", "p_ignore_appointment_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_staff_slot_bookable"("p_studio_id" "uuid", "p_staff_id" "uuid", "p_starts_at" timestamp with time zone, "p_duration_min" integer, "p_ignore_booking_request_id" "uuid", "p_ignore_appointment_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_staff_slot_bookable"("p_studio_id" "uuid", "p_staff_id" "uuid", "p_starts_at" timestamp with time zone, "p_duration_min" integer, "p_ignore_booking_request_id" "uuid", "p_ignore_appointment_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_studio_member"("_user_id" "uuid", "_studio_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_studio_member"("_user_id" "uuid", "_studio_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_studio_member"("_user_id" "uuid", "_studio_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."issue_customer_loyalty_rewards"("p_studio_id" "uuid", "p_client_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."issue_customer_loyalty_rewards"("p_studio_id" "uuid", "p_client_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."move_studio_appointment"("p_studio_id" "uuid", "p_appointment_id" "uuid", "p_starts_at" timestamp with time zone, "p_duration_min" integer, "p_confirm_overlap" boolean, "p_actor_id" "uuid", "p_expected_conflict_ids" "uuid"[], "p_operation" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."move_studio_appointment"("p_studio_id" "uuid", "p_appointment_id" "uuid", "p_starts_at" timestamp with time zone, "p_duration_min" integer, "p_confirm_overlap" boolean, "p_actor_id" "uuid", "p_expected_conflict_ids" "uuid"[], "p_operation" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."normalize_customer_referral_code"("p_value" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."normalize_customer_referral_code"("p_value" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_customer_referral_code"("p_value" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."normalize_trial_phone"("_value" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."normalize_trial_phone"("_value" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_trial_phone"("_value" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."normalize_trial_text"("_value" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."normalize_trial_text"("_value" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_trial_text"("_value" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."notification_default_action_url"("p_kind" "text", "p_payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."notification_default_action_url"("p_kind" "text", "p_payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."notification_default_action_url"("p_kind" "text", "p_payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_new_appointment"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_new_appointment"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_new_appointment"() TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_payment_confirmed"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_payment_confirmed"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_payment_confirmed"() TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_payment_problem"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_payment_problem"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_payment_problem"() TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_refund_request_created"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_refund_request_created"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_refund_request_created"() TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_studio_appointment_lifecycle"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_studio_appointment_lifecycle"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_studio_appointment_lifecycle"() TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_studio_new_client"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_studio_new_client"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_studio_new_client"() TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_studio_new_review"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_studio_new_review"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_studio_new_review"() TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_studio_payment_lifecycle"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_studio_payment_lifecycle"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_studio_payment_lifecycle"() TO "service_role";



GRANT ALL ON FUNCTION "public"."open_cash_register"("p_studio_id" "uuid", "p_opening_amount" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."open_cash_register"("p_studio_id" "uuid", "p_opening_amount" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."open_cash_register"("p_studio_id" "uuid", "p_opening_amount" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."preserve_cancel_at_period_end"() TO "anon";
GRANT ALL ON FUNCTION "public"."preserve_cancel_at_period_end"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."preserve_cancel_at_period_end"() TO "service_role";



GRANT ALL ON FUNCTION "public"."preserve_studio_cancel_at_period_end"() TO "anon";
GRANT ALL ON FUNCTION "public"."preserve_studio_cancel_at_period_end"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."preserve_studio_cancel_at_period_end"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."preview_studio_schedule_change"("p_studio_id" "uuid", "p_staff_id" "uuid", "p_starts_at" timestamp with time zone, "p_duration_min" integer, "p_ignore_appointment_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."preview_studio_schedule_change"("p_studio_id" "uuid", "p_staff_id" "uuid", "p_starts_at" timestamp with time zone, "p_duration_min" integer, "p_ignore_appointment_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."process_customer_loyalty_for_completed_appointment"("p_appointment_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."process_customer_loyalty_for_completed_appointment"("p_appointment_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."quote_public_booking"("p_studio_slug" "text", "p_service_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."quote_public_booking"("p_studio_slug" "text", "p_service_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."raise_client_booking_block_if_needed"("p_studio_id" "uuid", "p_client_phone" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."raise_client_booking_block_if_needed"("p_studio_id" "uuid", "p_client_phone" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."raise_client_booking_block_if_needed"("p_studio_id" "uuid", "p_client_phone" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."record_customer_referral_intent"("p_studio_id" "uuid", "p_referral_code" "text", "p_booking_request_id" "uuid", "p_appointment_id" "uuid", "p_referred_client_id" "uuid", "p_referred_client_was_existing" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."record_customer_referral_intent"("p_studio_id" "uuid", "p_referral_code" "text", "p_booking_request_id" "uuid", "p_appointment_id" "uuid", "p_referred_client_id" "uuid", "p_referred_client_was_existing" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_customer_referral_intent"("p_studio_id" "uuid", "p_referral_code" "text", "p_booking_request_id" "uuid", "p_appointment_id" "uuid", "p_referred_client_id" "uuid", "p_referred_client_was_existing" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_public_policy_acceptance"("p_studio_id" "uuid", "p_booking_request_id" "uuid", "p_appointment_id" "uuid", "p_policy_version" "text", "p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_public_policy_acceptance"("p_studio_id" "uuid", "p_booking_request_id" "uuid", "p_appointment_id" "uuid", "p_policy_version" "text", "p_payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."record_studio_plan_event"() TO "anon";
GRANT ALL ON FUNCTION "public"."record_studio_plan_event"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_studio_plan_event"() TO "service_role";



GRANT ALL ON FUNCTION "public"."record_upsell_acceptances_for_services"("p_studio_id" "uuid", "p_service_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."record_upsell_acceptances_for_services"("p_studio_id" "uuid", "p_service_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_upsell_acceptances_for_services"("p_studio_id" "uuid", "p_service_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_reassigned_appointment_line_commissions"() TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_reassigned_appointment_line_commissions"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_reassigned_appointment_line_commissions"() TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_studio_rating"() TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_studio_rating"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_studio_rating"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."remove_or_archive_service"("p_studio_id" "uuid", "p_service_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."remove_or_archive_service"("p_studio_id" "uuid", "p_service_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."remove_or_archive_service"("p_studio_id" "uuid", "p_service_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."request_header"("header_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."request_header"("header_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."request_header"("header_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."reschedule_public_appointment"("p_public_token" "text", "p_staff_id" "uuid", "p_starts_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reschedule_public_appointment"("p_public_token" "text", "p_staff_id" "uuid", "p_starts_at" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."reschedule_public_appointment"("p_public_token" "text", "p_staff_id" "uuid", "p_starts_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reschedule_public_appointment"("p_public_token" "text", "p_staff_id" "uuid", "p_starts_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."reschedule_studio_appointment"("p_appointment_id" "uuid", "p_studio_id" "uuid", "p_local_date" "date", "p_local_time" time without time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reschedule_studio_appointment"("p_appointment_id" "uuid", "p_studio_id" "uuid", "p_local_date" "date", "p_local_time" time without time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."reserve_whatsapp_usage"("p_studio_id" "uuid", "p_idempotency_key" "text", "p_message_kind" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reserve_whatsapp_usage"("p_studio_id" "uuid", "p_idempotency_key" "text", "p_message_kind" "text") TO "service_role";



GRANT ALL ON TABLE "public"."appointments" TO "anon";
GRANT ALL ON TABLE "public"."appointments" TO "authenticated";
GRANT ALL ON TABLE "public"."appointments" TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_appointment_attendance"("p_appointment_id" "uuid", "p_studio_id" "uuid", "p_outcome" "text", "p_actor_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_appointment_attendance"("p_appointment_id" "uuid", "p_studio_id" "uuid", "p_outcome" "text", "p_actor_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_appointment_attendance_batch"("p_appointment_ids" "uuid"[], "p_studio_id" "uuid", "p_outcome" "text", "p_actor_id" "uuid", "p_payment_method" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_appointment_attendance_batch"("p_appointment_ids" "uuid"[], "p_studio_id" "uuid", "p_outcome" "text", "p_actor_id" "uuid", "p_payment_method" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_booking_service_pricing"("p_studio_id" "uuid", "p_service_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_booking_service_pricing"("p_studio_id" "uuid", "p_service_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."resolve_booking_service_pricing"("p_studio_id" "uuid", "p_service_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_booking_service_pricing"("p_studio_id" "uuid", "p_service_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_studio_local_datetime"("p_studio_id" "uuid", "p_local_date" "date", "p_local_time" time without time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_studio_local_datetime"("p_studio_id" "uuid", "p_local_date" "date", "p_local_time" time without time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."revoke_terminal_studio_push_subscription"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."revoke_terminal_studio_push_subscription"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."seed_staff_default_availability"() TO "anon";
GRANT ALL ON FUNCTION "public"."seed_staff_default_availability"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."seed_staff_default_availability"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."settle_appointment_attendance_core"("p_appointment_id" "uuid", "p_studio_id" "uuid", "p_outcome" "text", "p_actor_id" "uuid", "p_payment_method" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."staff_owns_appointment"("_user_id" "uuid", "_appointment_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."staff_owns_appointment"("_user_id" "uuid", "_appointment_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."staff_owns_appointment"("_user_id" "uuid", "_appointment_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."studio_can_add_professional"("_studio_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."studio_can_add_professional"("_studio_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."studio_can_add_professional"("_studio_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."studio_can_add_professional"("_studio_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."studio_effective_plan_tier"("_studio_id" "uuid", "_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."studio_effective_plan_tier"("_studio_id" "uuid", "_at" timestamp with time zone) TO "service_role";
GRANT ALL ON FUNCTION "public"."studio_effective_plan_tier"("_studio_id" "uuid", "_at" timestamp with time zone) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."studio_has_entitlement"("_studio_id" "uuid", "_feature" "text", "_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."studio_has_entitlement"("_studio_id" "uuid", "_feature" "text", "_at" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."studio_has_entitlement"("_studio_id" "uuid", "_feature" "text", "_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."studio_has_entitlement"("_studio_id" "uuid", "_feature" "text", "_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."studio_plan_professional_limit"("_studio_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."studio_plan_professional_limit"("_studio_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."studio_plan_professional_limit"("_studio_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."studio_plan_professional_limit"("_studio_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."studio_staff_is_within_plan"("_studio_id" "uuid", "_staff_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."studio_staff_is_within_plan"("_studio_id" "uuid", "_staff_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."studio_staff_is_within_plan"("_studio_id" "uuid", "_staff_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."studio_staff_is_within_plan"("_studio_id" "uuid", "_staff_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."submit_public_refund_request"("p_booking_request_id" "uuid", "p_appointment_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."submit_public_refund_request"("p_booking_request_id" "uuid", "p_appointment_id" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."suppress_invalidated_appointment_reminders"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."suppress_invalidated_appointment_reminders"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."swap_studio_appointments"("p_studio_id" "uuid", "p_first_appointment_id" "uuid", "p_second_appointment_id" "uuid", "p_confirm_overlap" boolean, "p_actor_id" "uuid", "p_expected_conflict_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."swap_studio_appointments"("p_studio_id" "uuid", "p_first_appointment_id" "uuid", "p_second_appointment_id" "uuid", "p_confirm_overlap" boolean, "p_actor_id" "uuid", "p_expected_conflict_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."track_upsell_acceptances"("p_offer_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."track_upsell_acceptances"("p_offer_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."track_upsell_views"("p_offer_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."track_upsell_views"("p_offer_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."update_client_totals_from_manual_entry"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_client_totals_from_manual_entry"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_client_totals_from_manual_entry"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_manual_appointment_service"("p_appointment_id" "uuid", "p_studio_id" "uuid", "p_staff_id" "uuid", "p_service_id" "uuid", "p_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_manual_appointment_service"("p_appointment_id" "uuid", "p_studio_id" "uuid", "p_staff_id" "uuid", "p_service_id" "uuid", "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_manual_appointment_service"("p_appointment_id" "uuid", "p_studio_id" "uuid", "p_staff_id" "uuid", "p_service_id" "uuid", "p_notes" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."user_studio_ids"("_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."user_studio_ids"("_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_studio_ids"("_user_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."appointment_schedule_events" TO "anon";
GRANT ALL ON TABLE "public"."appointment_schedule_events" TO "authenticated";
GRANT ALL ON TABLE "public"."appointment_schedule_events" TO "service_role";



GRANT ALL ON TABLE "public"."appointment_services" TO "anon";
GRANT ALL ON TABLE "public"."appointment_services" TO "authenticated";
GRANT ALL ON TABLE "public"."appointment_services" TO "service_role";



GRANT ALL ON TABLE "public"."booking_payment_requests" TO "anon";
GRANT ALL ON TABLE "public"."booking_payment_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."booking_payment_requests" TO "service_role";



GRANT ALL ON TABLE "public"."booking_policy_acceptances" TO "anon";
GRANT ALL ON TABLE "public"."booking_policy_acceptances" TO "authenticated";
GRANT ALL ON TABLE "public"."booking_policy_acceptances" TO "service_role";



GRANT ALL ON TABLE "public"."client_appointment_action_logs" TO "anon";
GRANT ALL ON TABLE "public"."client_appointment_action_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."client_appointment_action_logs" TO "service_role";



GRANT ALL ON TABLE "public"."clients" TO "anon";
GRANT ALL ON TABLE "public"."clients" TO "authenticated";
GRANT ALL ON TABLE "public"."clients" TO "service_role";



GRANT ALL ON TABLE "public"."customer_loyalty_rewards" TO "anon";
GRANT ALL ON TABLE "public"."customer_loyalty_rewards" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_loyalty_rewards" TO "service_role";



GRANT ALL ON TABLE "public"."customer_loyalty_stamp_entries" TO "anon";
GRANT ALL ON TABLE "public"."customer_loyalty_stamp_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_loyalty_stamp_entries" TO "service_role";



GRANT ALL ON TABLE "public"."customer_referral_codes" TO "anon";
GRANT ALL ON TABLE "public"."customer_referral_codes" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_referral_codes" TO "service_role";



GRANT ALL ON TABLE "public"."customer_referrals" TO "anon";
GRANT ALL ON TABLE "public"."customer_referrals" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_referrals" TO "service_role";



GRANT ALL ON TABLE "public"."email_message_logs" TO "anon";
GRANT ALL ON TABLE "public"."email_message_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."email_message_logs" TO "service_role";



GRANT ALL ON TABLE "public"."financial_audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."financial_audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."financial_audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."manual_service_entries" TO "anon";
GRANT ALL ON TABLE "public"."manual_service_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."manual_service_entries" TO "service_role";



GRANT ALL ON TABLE "public"."notifications_log" TO "anon";
GRANT ALL ON TABLE "public"."notifications_log" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications_log" TO "service_role";



GRANT ALL ON TABLE "public"."onboarding_progress" TO "anon";
GRANT ALL ON TABLE "public"."onboarding_progress" TO "authenticated";
GRANT ALL ON TABLE "public"."onboarding_progress" TO "service_role";



GRANT ALL ON TABLE "public"."payment_intents" TO "anon";
GRANT ALL ON TABLE "public"."payment_intents" TO "authenticated";
GRANT ALL ON TABLE "public"."payment_intents" TO "service_role";



GRANT ALL ON TABLE "public"."platform_billing_events" TO "anon";
GRANT ALL ON TABLE "public"."platform_billing_events" TO "authenticated";
GRANT ALL ON TABLE "public"."platform_billing_events" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."service_categories" TO "anon";
GRANT ALL ON TABLE "public"."service_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."service_categories" TO "service_role";



GRANT SELECT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."studios" TO "authenticated";
GRANT ALL ON TABLE "public"."studios" TO "service_role";



GRANT ALL ON TABLE "public"."public_service_categories" TO "service_role";
GRANT SELECT ON TABLE "public"."public_service_categories" TO "anon";
GRANT SELECT ON TABLE "public"."public_service_categories" TO "authenticated";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."services" TO "anon";
GRANT ALL ON TABLE "public"."services" TO "authenticated";
GRANT ALL ON TABLE "public"."services" TO "service_role";



GRANT ALL ON TABLE "public"."public_services" TO "service_role";
GRANT SELECT ON TABLE "public"."public_services" TO "anon";
GRANT SELECT ON TABLE "public"."public_services" TO "authenticated";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."staff" TO "anon";
GRANT ALL ON TABLE "public"."staff" TO "authenticated";
GRANT ALL ON TABLE "public"."staff" TO "service_role";



GRANT ALL ON TABLE "public"."public_staff" TO "service_role";
GRANT SELECT ON TABLE "public"."public_staff" TO "anon";
GRANT SELECT ON TABLE "public"."public_staff" TO "authenticated";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."staff_services" TO "anon";
GRANT ALL ON TABLE "public"."staff_services" TO "authenticated";
GRANT ALL ON TABLE "public"."staff_services" TO "service_role";



GRANT ALL ON TABLE "public"."public_staff_services" TO "service_role";
GRANT SELECT ON TABLE "public"."public_staff_services" TO "anon";
GRANT SELECT ON TABLE "public"."public_staff_services" TO "authenticated";



GRANT ALL ON TABLE "public"."public_studios" TO "service_role";
GRANT SELECT ON TABLE "public"."public_studios" TO "anon";
GRANT SELECT ON TABLE "public"."public_studios" TO "authenticated";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."upsell_offers" TO "anon";
GRANT ALL ON TABLE "public"."upsell_offers" TO "authenticated";
GRANT ALL ON TABLE "public"."upsell_offers" TO "service_role";



GRANT ALL ON TABLE "public"."public_upsell_offers" TO "service_role";
GRANT SELECT ON TABLE "public"."public_upsell_offers" TO "anon";
GRANT SELECT ON TABLE "public"."public_upsell_offers" TO "authenticated";



GRANT ALL ON TABLE "public"."push_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."referral_credits" TO "anon";
GRANT ALL ON TABLE "public"."referral_credits" TO "authenticated";
GRANT ALL ON TABLE "public"."referral_credits" TO "service_role";



GRANT ALL ON TABLE "public"."referrals" TO "anon";
GRANT ALL ON TABLE "public"."referrals" TO "authenticated";
GRANT ALL ON TABLE "public"."referrals" TO "service_role";



GRANT ALL ON TABLE "public"."refund_requests" TO "anon";
GRANT ALL ON TABLE "public"."refund_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."refund_requests" TO "service_role";



GRANT ALL ON TABLE "public"."server_rate_limits" TO "anon";
GRANT ALL ON TABLE "public"."server_rate_limits" TO "authenticated";
GRANT ALL ON TABLE "public"."server_rate_limits" TO "service_role";



GRANT ALL ON TABLE "public"."service_category_suggestions" TO "anon";
GRANT ALL ON TABLE "public"."service_category_suggestions" TO "authenticated";
GRANT ALL ON TABLE "public"."service_category_suggestions" TO "service_role";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."staff_availability" TO "anon";
GRANT ALL ON TABLE "public"."staff_availability" TO "authenticated";
GRANT ALL ON TABLE "public"."staff_availability" TO "service_role";



GRANT ALL ON TABLE "public"."staff_time_off" TO "anon";
GRANT ALL ON TABLE "public"."staff_time_off" TO "authenticated";
GRANT ALL ON TABLE "public"."staff_time_off" TO "service_role";



GRANT ALL ON TABLE "public"."studio_follows" TO "anon";
GRANT ALL ON TABLE "public"."studio_follows" TO "authenticated";
GRANT ALL ON TABLE "public"."studio_follows" TO "service_role";



GRANT ALL ON TABLE "public"."studio_notification_deliveries" TO "anon";
GRANT ALL ON TABLE "public"."studio_notification_deliveries" TO "authenticated";
GRANT ALL ON TABLE "public"."studio_notification_deliveries" TO "service_role";



GRANT ALL ON TABLE "public"."studio_notifications" TO "anon";
GRANT ALL ON TABLE "public"."studio_notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."studio_notifications" TO "service_role";



GRANT ALL ON TABLE "public"."studio_payout_settings" TO "anon";
GRANT ALL ON TABLE "public"."studio_payout_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."studio_payout_settings" TO "service_role";



GRANT ALL ON TABLE "public"."studio_plan_events" TO "anon";
GRANT ALL ON TABLE "public"."studio_plan_events" TO "authenticated";
GRANT ALL ON TABLE "public"."studio_plan_events" TO "service_role";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."studio_reviews" TO "anon";
GRANT ALL ON TABLE "public"."studio_reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."studio_reviews" TO "service_role";



GRANT ALL ON TABLE "public"."studio_trial_extension_backup_20260719_1910" TO "anon";
GRANT ALL ON TABLE "public"."studio_trial_extension_backup_20260719_1910" TO "authenticated";
GRANT ALL ON TABLE "public"."studio_trial_extension_backup_20260719_1910" TO "service_role";



GRANT ALL ON TABLE "public"."studios_cancel_flag_backup_20260705_194119" TO "anon";
GRANT ALL ON TABLE "public"."studios_cancel_flag_backup_20260705_194119" TO "authenticated";
GRANT ALL ON TABLE "public"."studios_cancel_flag_backup_20260705_194119" TO "service_role";



GRANT ALL ON TABLE "public"."studios_trial_renewal_backup_20260821" TO "anon";
GRANT ALL ON TABLE "public"."studios_trial_renewal_backup_20260821" TO "authenticated";
GRANT ALL ON TABLE "public"."studios_trial_renewal_backup_20260821" TO "service_role";



GRANT ALL ON TABLE "public"."studios_trial_reset_backup_20260807" TO "anon";
GRANT ALL ON TABLE "public"."studios_trial_reset_backup_20260807" TO "authenticated";
GRANT ALL ON TABLE "public"."studios_trial_reset_backup_20260807" TO "service_role";



GRANT ALL ON TABLE "public"."studios_trial_restore_backup_20260705_190426" TO "anon";
GRANT ALL ON TABLE "public"."studios_trial_restore_backup_20260705_190426" TO "authenticated";
GRANT ALL ON TABLE "public"."studios_trial_restore_backup_20260705_190426" TO "service_role";



GRANT ALL ON TABLE "public"."subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."subscriptions_trial_renewal_backup_20260821" TO "anon";
GRANT ALL ON TABLE "public"."subscriptions_trial_renewal_backup_20260821" TO "authenticated";
GRANT ALL ON TABLE "public"."subscriptions_trial_renewal_backup_20260821" TO "service_role";



GRANT ALL ON TABLE "public"."subscriptions_trial_reset_backup_20260807" TO "anon";
GRANT ALL ON TABLE "public"."subscriptions_trial_reset_backup_20260807" TO "authenticated";
GRANT ALL ON TABLE "public"."subscriptions_trial_reset_backup_20260807" TO "service_role";



GRANT ALL ON TABLE "public"."user_roles" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."user_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_roles" TO "service_role";



GRANT ALL ON TABLE "public"."whatsapp_admin_audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."whatsapp_admin_audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_admin_audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."whatsapp_message_logs" TO "anon";
GRANT ALL ON TABLE "public"."whatsapp_message_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_message_logs" TO "service_role";



GRANT ALL ON TABLE "public"."whatsapp_platform_settings" TO "anon";
GRANT ALL ON TABLE "public"."whatsapp_platform_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_platform_settings" TO "service_role";



GRANT ALL ON TABLE "public"."whatsapp_studio_entitlements" TO "anon";
GRANT ALL ON TABLE "public"."whatsapp_studio_entitlements" TO "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_studio_entitlements" TO "service_role";



GRANT ALL ON TABLE "public"."whatsapp_trial_identity_claims" TO "anon";
GRANT ALL ON TABLE "public"."whatsapp_trial_identity_claims" TO "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_trial_identity_claims" TO "service_role";



GRANT ALL ON TABLE "public"."whatsapp_usage_alerts" TO "anon";
GRANT ALL ON TABLE "public"."whatsapp_usage_alerts" TO "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_usage_alerts" TO "service_role";



GRANT ALL ON TABLE "public"."whatsapp_usage_ledger" TO "anon";
GRANT ALL ON TABLE "public"."whatsapp_usage_ledger" TO "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_usage_ledger" TO "service_role";



GRANT ALL ON TABLE "public"."withdrawal_requests" TO "anon";
GRANT ALL ON TABLE "public"."withdrawal_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."withdrawal_requests" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";






