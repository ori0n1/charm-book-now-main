-- Record each manual WhatsApp opening for one appointment without changing
-- appointment lifecycle or the automatic provider's message log.
CREATE TABLE public.appointment_manual_whatsapp_opens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id uuid NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  opened_by uuid NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX appointment_manual_whatsapp_opens_studio_appointment_time
  ON public.appointment_manual_whatsapp_opens (studio_id, appointment_id, opened_at DESC);

ALTER TABLE public.appointment_manual_whatsapp_opens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.appointment_manual_whatsapp_opens FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.appointment_manual_whatsapp_opens TO service_role;
CREATE POLICY "Service role reads manual appointment WhatsApp opens"
  ON public.appointment_manual_whatsapp_opens FOR SELECT TO service_role USING (true);
CREATE POLICY "Service role records manual appointment WhatsApp opens"
  ON public.appointment_manual_whatsapp_opens FOR INSERT TO service_role WITH CHECK (true);

-- The authenticated Worker calls this service-role-only function after checking
-- the user's studio access. Keep the appointment log and existing client history
-- in the same transaction; no automatic message log or scheduler is touched.
CREATE FUNCTION public.record_appointment_manual_whatsapp_open(
  p_studio_id uuid,
  p_appointment_id uuid,
  p_user_id uuid
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_client_id uuid;
  v_opened_at timestamptz := clock_timestamp();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles r
    JOIN public.studios s ON s.id = r.studio_id
    WHERE r.user_id = p_user_id
      AND r.studio_id = p_studio_id
      AND r.role IN ('studio_owner', 'saas_owner')
      AND s.whatsapp_auto_send_enabled IS FALSE
  ) THEN
    RAISE EXCEPTION 'manual_whatsapp_forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT a.client_id INTO v_client_id
  FROM public.appointments a
  WHERE a.id = p_appointment_id
    AND a.studio_id = p_studio_id
    AND a.status = 'confirmed'
    AND a.starts_at > v_opened_at;
  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'manual_whatsapp_appointment_unavailable' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.appointment_manual_whatsapp_opens
    (studio_id, appointment_id, client_id, opened_by, opened_at)
  VALUES
    (p_studio_id, p_appointment_id, v_client_id, p_user_id, v_opened_at);

  INSERT INTO public.client_manual_whatsapp_confirmations
    (studio_id, client_id, confirmed_by, confirmed_at)
  VALUES
    (p_studio_id, v_client_id, p_user_id, v_opened_at)
  ON CONFLICT (studio_id, client_id) DO UPDATE
    SET last_opened_at = v_opened_at;

  RETURN v_opened_at;
END;
$$;

REVOKE ALL ON FUNCTION public.record_appointment_manual_whatsapp_open(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_appointment_manual_whatsapp_open(uuid, uuid, uuid)
  TO service_role;
