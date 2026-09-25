-- Final safety net for appointment reminders.
-- No appointment, payment or historical financial value is modified.

CREATE OR REPLACE FUNCTION public.enforce_notification_log_appointment_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

DROP TRIGGER IF EXISTS trg_enforce_notification_log_appointment_tenant
  ON public.notifications_log;
CREATE TRIGGER trg_enforce_notification_log_appointment_tenant
BEFORE INSERT OR UPDATE OF appointment_id, studio_id, kind, payload
ON public.notifications_log
FOR EACH ROW EXECUTE FUNCTION public.enforce_notification_log_appointment_tenant();

-- Preserve old rows while assigning a distinct forensic key to any historical
-- duplicate. New client-center events are then exactly-once per tenant/user/key.
WITH ranked_client_events AS (
  SELECT
    id,
    payload ->> 'key' AS event_key,
    row_number() OVER (
      PARTITION BY studio_id, channel, recipient, kind, payload ->> 'key'
      ORDER BY created_at, id
    ) AS duplicate_rank
  FROM public.notifications_log
  WHERE channel = 'client_center'
    AND NULLIF(payload ->> 'key', '') IS NOT NULL
)
UPDATE public.notifications_log log
SET payload = jsonb_set(
  log.payload,
  '{key}',
  to_jsonb(ranked_client_events.event_key || ':legacy-duplicate:' || log.id::text),
  true
)
FROM ranked_client_events
WHERE log.id = ranked_client_events.id
  AND ranked_client_events.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_log_client_event_once
  ON public.notifications_log(
    studio_id,
    channel,
    recipient,
    kind,
    ((payload ->> 'key'))
  )
  WHERE channel = 'client_center'
    AND NULLIF(payload ->> 'key', '') IS NOT NULL;

-- Rescheduling or cancelling invalidates already queued reminder deliveries.
-- A rescheduled confirmed appointment gets a new event key from the lifecycle
-- job, so the old message can never be delivered with an obsolete time.
CREATE OR REPLACE FUNCTION public.suppress_invalidated_appointment_reminders()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

DROP TRIGGER IF EXISTS trg_suppress_invalidated_appointment_reminders
  ON public.appointments;
CREATE TRIGGER trg_suppress_invalidated_appointment_reminders
AFTER UPDATE OF starts_at, status
ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.suppress_invalidated_appointment_reminders();

-- Prevent a stale reminder from entering the delivery queue even if a delayed
-- transaction attempts fan-out after the appointment has started or changed.
CREATE OR REPLACE FUNCTION public.enforce_studio_notification_delivery_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

-- Safely finalize reminders which were already waiting before this guard.
UPDATE public.studio_notification_deliveries d
SET status = 'skipped',
    lease_until = NULL,
    last_error = CASE
      WHEN a.status <> 'confirmed' THEN 'appointment_no_longer_confirmed'
      WHEN a.starts_at <= now() THEN 'appointment_reminder_expired'
      ELSE 'appointment_schedule_changed'
    END,
    updated_at = now()
FROM public.studio_notifications n
JOIN public.appointments a
  ON a.id = n.appointment_id
 AND a.studio_id = n.studio_id
WHERE d.notification_id = n.id
  AND d.studio_id = n.studio_id
  AND n.kind = 'appointment_reminder'
  AND d.status IN ('pending', 'retry', 'delivering')
  AND (
    a.status <> 'confirmed'
    OR a.starts_at <= now()
    OR NULLIF(n.payload ->> 'starts_at', '') IS NULL
    OR (n.payload ->> 'starts_at')::timestamptz IS DISTINCT FROM a.starts_at
  );

REVOKE EXECUTE ON FUNCTION public.enforce_notification_log_appointment_tenant()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.suppress_invalidated_appointment_reminders()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_studio_notification_delivery_tenant()
  FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
