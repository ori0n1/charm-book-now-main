-- Make Stripe webhook idempotency recoverable. A unique receipt alone can
-- permanently swallow an event if the Worker terminates after inserting the
-- receipt but before applying its effects. These states provide an atomic
-- claim, an explicit completion marker and a retry path for failed/stale work.

ALTER TABLE public.platform_billing_events
  ADD COLUMN IF NOT EXISTS processing_state text NOT NULL DEFAULT 'processed',
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_error text;

UPDATE public.platform_billing_events
SET processed_at = COALESCE(processed_at, created_at)
WHERE processing_state = 'processed'
  AND processed_at IS NULL;

ALTER TABLE public.platform_billing_events
  DROP CONSTRAINT IF EXISTS platform_billing_events_processing_state_valid,
  ADD CONSTRAINT platform_billing_events_processing_state_valid
    CHECK (processing_state IN ('processing', 'processed', 'failed')),
  DROP CONSTRAINT IF EXISTS platform_billing_events_attempt_count_valid,
  ADD CONSTRAINT platform_billing_events_attempt_count_valid
    CHECK (attempt_count > 0);

CREATE OR REPLACE FUNCTION public.claim_stripe_webhook_event(
  p_event_id text,
  p_event_type text,
  p_studio_id uuid,
  p_payload jsonb,
  p_lease_seconds integer
)
RETURNS text
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
BEGIN
  IF nullif(btrim(p_event_id), '') IS NULL OR nullif(btrim(p_event_type), '') IS NULL THEN
    RAISE EXCEPTION 'stripe_webhook_identity_missing';
  END IF;

  INSERT INTO public.platform_billing_events (
    stripe_event_id,
    event_type,
    studio_id,
    payload,
    processing_state,
    processing_started_at,
    processed_at,
    attempt_count,
    last_error
  ) VALUES (
    p_event_id,
    p_event_type,
    p_studio_id,
    coalesce(p_payload, '{}'::jsonb),
    'processing',
    v_now,
    NULL,
    1,
    NULL
  )
  ON CONFLICT (stripe_event_id) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 1 THEN
    RETURN 'claimed';
  END IF;

  SELECT processing_state, processing_started_at
  INTO v_state, v_started_at
  FROM public.platform_billing_events
  WHERE stripe_event_id = p_event_id;

  IF v_state = 'processed' THEN
    RETURN 'processed';
  END IF;

  UPDATE public.platform_billing_events
  SET
    event_type = p_event_type,
    studio_id = coalesce(p_studio_id, studio_id),
    payload = coalesce(p_payload, payload),
    processing_state = 'processing',
    processing_started_at = v_now,
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
    );

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 1 THEN
    RETURN 'claimed';
  END IF;

  RETURN 'busy';
END
$function$;

REVOKE ALL ON FUNCTION public.claim_stripe_webhook_event(text, text, uuid, jsonb, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_stripe_webhook_event(text, text, uuid, jsonb, integer)
  TO service_role;

CREATE INDEX IF NOT EXISTS platform_billing_events_processing_state_idx
  ON public.platform_billing_events(processing_state, processing_started_at)
  WHERE processing_state <> 'processed';

NOTIFY pgrst, 'reload schema';
