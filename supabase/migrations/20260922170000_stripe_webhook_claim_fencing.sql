-- Fence stale webhook workers after a lease is reclaimed. Without a token tied
-- to one processing attempt, an expired worker could complete or fail the next
-- worker's claim after that worker has legitimately acquired the event.

ALTER TABLE public.platform_billing_events
  ADD COLUMN IF NOT EXISTS processing_token uuid;

DROP FUNCTION IF EXISTS public.claim_stripe_webhook_event(text, text, uuid, jsonb, integer);

CREATE FUNCTION public.claim_stripe_webhook_event(
  p_event_id text,
  p_event_type text,
  p_studio_id uuid,
  p_payload jsonb,
  p_lease_seconds integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_rows integer := 0;
  v_state text;
  v_started_at timestamptz;
  v_now timestamptz := clock_timestamp();
  v_lease interval := make_interval(secs => greatest(coalesce(p_lease_seconds, 120), 30));
  v_token uuid := gen_random_uuid();
  v_attempt_count integer;
BEGIN
  IF nullif(btrim(p_event_id), '') IS NULL OR nullif(btrim(p_event_type), '') IS NULL THEN
    RAISE EXCEPTION 'stripe_webhook_identity_missing';
  END IF;

  INSERT INTO public.platform_billing_events (
    stripe_event_id, event_type, studio_id, payload, processing_state,
    processing_started_at, processing_token, processed_at, attempt_count, last_error
  ) VALUES (
    p_event_id, p_event_type, p_studio_id, coalesce(p_payload, '{}'::jsonb),
    'processing', v_now, v_token, NULL, 1, NULL
  )
  ON CONFLICT (stripe_event_id) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 1 THEN
    RETURN jsonb_build_object('state', 'claimed', 'token', v_token::text, 'attempt_count', 1);
  END IF;

  SELECT processing_state, processing_started_at
  INTO v_state, v_started_at
  FROM public.platform_billing_events
  WHERE stripe_event_id = p_event_id;

  IF v_state = 'processed' THEN
    RETURN jsonb_build_object('state', 'processed');
  END IF;

  UPDATE public.platform_billing_events
  SET
    event_type = p_event_type,
    studio_id = coalesce(p_studio_id, studio_id),
    payload = coalesce(p_payload, payload),
    processing_state = 'processing',
    processing_started_at = v_now,
    processing_token = v_token,
    processed_at = NULL,
    attempt_count = attempt_count + 1,
    last_error = NULL
  WHERE stripe_event_id = p_event_id
    AND (
      processing_state = 'failed'
      OR (
        processing_state = 'processing'
        AND coalesce(processing_started_at, '-infinity'::timestamptz) < v_now - v_lease
      )
    )
  RETURNING attempt_count INTO v_attempt_count;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'state', 'claimed',
      'token', v_token::text,
      'attempt_count', v_attempt_count
    );
  END IF;

  RETURN jsonb_build_object('state', 'busy');
END
$function$;

CREATE OR REPLACE FUNCTION public.complete_stripe_webhook_event(
  p_event_id text,
  p_processing_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  UPDATE public.platform_billing_events
  SET processing_state = 'processed',
      processed_at = clock_timestamp(),
      processing_token = NULL,
      last_error = NULL
  WHERE stripe_event_id = p_event_id
    AND processing_state = 'processing'
    AND processing_token = p_processing_token;
  RETURN FOUND;
END
$function$;

CREATE OR REPLACE FUNCTION public.fail_stripe_webhook_event(
  p_event_id text,
  p_processing_token uuid,
  p_error text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  UPDATE public.platform_billing_events
  SET processing_state = 'failed',
      processing_token = NULL,
      last_error = left(coalesce(p_error, 'stripe_webhook_processing_failed'), 500)
  WHERE stripe_event_id = p_event_id
    AND processing_state = 'processing'
    AND processing_token = p_processing_token;
  RETURN FOUND;
END
$function$;

REVOKE ALL ON FUNCTION public.claim_stripe_webhook_event(text, text, uuid, jsonb, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_stripe_webhook_event(text, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_stripe_webhook_event(text, uuid, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_stripe_webhook_event(text, text, uuid, jsonb, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_stripe_webhook_event(text, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_stripe_webhook_event(text, uuid, text)
  TO service_role;

NOTIFY pgrst, 'reload schema';
