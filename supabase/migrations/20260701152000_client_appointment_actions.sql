CREATE TABLE IF NOT EXISTS public.client_appointment_action_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  studio_id uuid REFERENCES public.studios(id) ON DELETE SET NULL,
  public_token_hash text,
  action text NOT NULL CHECK (action IN ('open','reschedule_open','reschedule','cancel_open','cancel','contact_whatsapp')),
  status text NOT NULL CHECK (status IN ('started','succeeded','failed','blocked')),
  result text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_action_logs_appointment_created
  ON public.client_appointment_action_logs(appointment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_client_action_logs_studio_created
  ON public.client_appointment_action_logs(studio_id, created_at DESC);

ALTER TABLE public.client_appointment_action_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'studio_notifications_kind_check'
      AND conrelid = 'public.studio_notifications'::regclass
  ) THEN
    ALTER TABLE public.studio_notifications
      DROP CONSTRAINT studio_notifications_kind_check;
  END IF;

  ALTER TABLE public.studio_notifications
    ADD CONSTRAINT studio_notifications_kind_check
    CHECK (kind IN (
      'new_appointment',
      'payment_confirmed',
      'payment_failed',
      'refund_request',
      'withdrawal_requested',
      'appointment_rescheduled',
      'appointment_cancelled'
    ));
END $$;

DROP POLICY IF EXISTS "Members read client appointment action logs" ON public.client_appointment_action_logs;
CREATE POLICY "Members read client appointment action logs" ON public.client_appointment_action_logs
FOR SELECT USING (public.is_studio_member(studio_id, auth.uid()));

DROP POLICY IF EXISTS "Service role manages client appointment action logs" ON public.client_appointment_action_logs;
CREATE POLICY "Service role manages client appointment action logs" ON public.client_appointment_action_logs
FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.reschedule_public_appointment(
  p_public_token text,
  p_staff_id uuid,
  p_starts_at timestamptz
)
RETURNS TABLE(appointment_id uuid, starts_at timestamptz, ends_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_appt record;
  v_duration integer;
  v_slot record;
  v_new_end timestamptz;
BEGIN
  IF length(trim(coalesce(p_public_token, ''))) < 16 THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;

  SELECT a.id, a.public_token, a.studio_id, a.status, a.starts_at, a.ends_at, s.slug
  INTO v_appt
  FROM public.appointments a
  JOIN public.studios s ON s.id = a.studio_id
  WHERE a.public_token = p_public_token
  FOR UPDATE;

  IF v_appt.id IS NULL THEN
    RAISE EXCEPTION 'appointment_not_found';
  END IF;

  IF v_appt.status IN ('cancelled', 'no_show', 'completed') THEN
    RAISE EXCEPTION 'appointment_not_reschedulable';
  END IF;

  SELECT COALESCE(SUM(duration_min), 0)::integer
  INTO v_duration
  FROM public.appointment_services
  WHERE appointment_id = v_appt.id;

  IF v_duration <= 0 THEN
    v_duration := GREATEST(15, CEIL(EXTRACT(EPOCH FROM (v_appt.ends_at - v_appt.starts_at)) / 60)::integer);
  END IF;

  SELECT slot.staff_id, slot.slot_start
  INTO v_slot
  FROM public.get_available_slots(v_appt.slug, p_staff_id, (p_starts_at AT TIME ZONE 'Europe/Lisbon')::date, v_duration, 15) slot
  WHERE slot.staff_id = p_staff_id
    AND abs(EXTRACT(EPOCH FROM (slot.slot_start - p_starts_at))) < 60
  LIMIT 1;

  IF v_slot.staff_id IS NULL THEN
    RAISE EXCEPTION 'slot_unavailable';
  END IF;

  v_new_end := p_starts_at + (v_duration || ' minutes')::interval;

  UPDATE public.appointments
  SET
    staff_id = p_staff_id,
    starts_at = p_starts_at,
    ends_at = v_new_end,
    status = 'confirmed',
    updated_at = now()
  WHERE id = v_appt.id
    AND public.is_staff_slot_bookable(v_appt.studio_id, p_staff_id, p_starts_at, v_duration)
  RETURNING id, appointments.starts_at, appointments.ends_at
  INTO appointment_id, starts_at, ends_at;

  IF appointment_id IS NULL THEN
    RAISE EXCEPTION 'slot_unavailable';
  END IF;

  RETURN NEXT;
END
$function$;

GRANT EXECUTE ON FUNCTION public.reschedule_public_appointment(text, uuid, timestamptz) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
