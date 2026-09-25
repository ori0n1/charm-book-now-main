-- Intelligent appointment lifecycle without changing the existing appointment_status enum.
-- Existing financial/payment rows are never updated by this migration.

ALTER TABLE public.studios
  ADD COLUMN IF NOT EXISTS appointment_reminder_minutes smallint NOT NULL DEFAULT 120,
  ADD COLUMN IF NOT EXISTS attendance_grace_minutes smallint NOT NULL DEFAULT 30;

ALTER TABLE public.studios
  DROP CONSTRAINT IF EXISTS studios_appointment_reminder_minutes_range,
  DROP CONSTRAINT IF EXISTS studios_attendance_grace_minutes_range;

ALTER TABLE public.studios
  ADD CONSTRAINT studios_appointment_reminder_minutes_range
    CHECK (appointment_reminder_minutes BETWEEN 0 AND 10080),
  ADD CONSTRAINT studios_attendance_grace_minutes_range
    CHECK (attendance_grace_minutes BETWEEN 0 AND 1440);

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS lifecycle_activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS attendance_confirmation_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS attendance_resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS attendance_resolved_by uuid;

-- Activate only future appointments during rollout. This prevents a notification storm
-- for historical rows while still showing them as pending in the Agenda projection.
UPDATE public.appointments
SET lifecycle_activated_at = now()
WHERE lifecycle_activated_at IS NULL
  AND status = 'confirmed'
  AND starts_at > now();

CREATE INDEX IF NOT EXISTS idx_appointments_lifecycle_due
  ON public.appointments(starts_at, studio_id)
  WHERE status = 'confirmed' AND lifecycle_activated_at IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_log_lifecycle_key
  ON public.notifications_log(
    studio_id,
    channel,
    recipient,
    kind,
    ((payload ->> 'key'))
  )
  WHERE payload ? 'key'
    AND kind IN ('appointment_reminder');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'studio_notifications_kind_check'
      AND conrelid = 'public.studio_notifications'::regclass
  ) THEN
    ALTER TABLE public.studio_notifications DROP CONSTRAINT studio_notifications_kind_check;
  END IF;

  ALTER TABLE public.studio_notifications
    ADD CONSTRAINT studio_notifications_kind_check
    CHECK (kind IN (
      'new_appointment',
      'appointment_rescheduled',
      'appointment_cancelled',
      'appointment_reminder',
      'attendance_confirmation',
      'attendance_summary',
      'payment_confirmed',
      'payment_failed',
      'new_client',
      'new_review',
      'refund_request',
      'withdrawal_requested',
      'critical_request'
    ));
END $$;

CREATE OR REPLACE FUNCTION public.activate_appointment_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
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

DROP TRIGGER IF EXISTS trg_activate_appointment_lifecycle ON public.appointments;
CREATE TRIGGER trg_activate_appointment_lifecycle
  BEFORE INSERT OR UPDATE OF starts_at, staff_id, status
  ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.activate_appointment_lifecycle();

CREATE OR REPLACE FUNCTION public.enqueue_due_appointment_lifecycle_notifications()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

REVOKE ALL ON FUNCTION public.enqueue_due_appointment_lifecycle_notifications()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_due_appointment_lifecycle_notifications()
  TO service_role;

CREATE OR REPLACE FUNCTION public.resolve_appointment_attendance(
  p_appointment_id uuid,
  p_studio_id uuid,
  p_outcome text,
  p_actor_id uuid
)
RETURNS public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_appointment public.appointments;
  v_status public.appointment_status;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_outcome NOT IN ('completed', 'no_show') THEN RAISE EXCEPTION 'invalid_attendance_outcome'; END IF;
  v_status := p_outcome::public.appointment_status;

  SELECT * INTO v_appointment
  FROM public.appointments
  WHERE id = p_appointment_id AND studio_id = p_studio_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'appointment_not_found'; END IF;
  IF v_appointment.status = 'cancelled' THEN RAISE EXCEPTION 'appointment_cancelled'; END IF;
  IF v_appointment.status IN ('completed', 'no_show') THEN
    IF v_appointment.status = v_status THEN RETURN v_appointment; END IF;
    RAISE EXCEPTION 'attendance_already_resolved';
  END IF;
  IF v_appointment.status <> 'confirmed' THEN RAISE EXCEPTION 'appointment_not_confirmed'; END IF;

  UPDATE public.appointments
  SET status = v_status,
      attendance_resolved_at = now(),
      attendance_resolved_by = p_actor_id,
      updated_at = now()
  WHERE id = p_appointment_id
  RETURNING * INTO v_appointment;
  RETURN v_appointment;
END
$$;

REVOKE ALL ON FUNCTION public.resolve_appointment_attendance(uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_appointment_attendance(uuid, uuid, text, uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';
