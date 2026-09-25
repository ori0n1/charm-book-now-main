-- Bind every appointment notification structurally to its tenant and canonical schedule.
ALTER TABLE public.studio_notifications
  ADD COLUMN IF NOT EXISTS appointment_id uuid
  REFERENCES public.appointments(id) ON DELETE SET NULL;

UPDATE public.studio_notifications n
SET appointment_id = a.id,
    payload = jsonb_set(
      jsonb_set(COALESCE(n.payload, '{}'::jsonb), '{studio_id}', to_jsonb(a.studio_id::text), true),
      '{starts_at}',
      to_jsonb(a.starts_at),
      true
    )
FROM public.appointments a
WHERE n.appointment_id IS NULL
  AND NULLIF(n.payload ->> 'appointment_id', '') = a.id::text
  AND n.studio_id = a.studio_id;

CREATE INDEX IF NOT EXISTS idx_studio_notifications_studio_appointment
  ON public.studio_notifications(studio_id, appointment_id)
  WHERE appointment_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_studio_notification_tenant_time()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

DROP TRIGGER IF EXISTS trg_enforce_studio_notification_tenant_time
  ON public.studio_notifications;
CREATE TRIGGER trg_enforce_studio_notification_tenant_time
BEFORE INSERT OR UPDATE OF studio_id, appointment_id, payload
ON public.studio_notifications
FOR EACH ROW EXECUTE FUNCTION public.enforce_studio_notification_tenant_time();

-- Final push-delivery guard: ids in a delivery must all belong to the same tenant.
CREATE OR REPLACE FUNCTION public.enforce_studio_notification_delivery_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
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
      AND n.studio_id = NEW.studio_id
  ) THEN
    RAISE EXCEPTION 'notification_delivery_studio_mismatch';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_enforce_studio_notification_delivery_tenant
  ON public.studio_notification_deliveries;
CREATE TRIGGER trg_enforce_studio_notification_delivery_tenant
BEFORE INSERT OR UPDATE OF notification_id, studio_id, subscription_id
ON public.studio_notification_deliveries
FOR EACH ROW EXECUTE FUNCTION public.enforce_studio_notification_delivery_tenant();

REVOKE EXECUTE ON FUNCTION public.enforce_studio_notification_tenant_time()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_studio_notification_delivery_tenant()
  FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
