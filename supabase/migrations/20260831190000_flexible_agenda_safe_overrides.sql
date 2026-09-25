-- Flexible studio agenda with explicit, audited overlap overrides.
-- Public bookings remain conflict-safe: only the service-role RPCs below can
-- enable a manual overlap for the duration of their own transaction.

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS is_manual_fit boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS duration_overridden boolean NOT NULL DEFAULT false;

-- Existing administrative fits used notification_suppressed as their only
-- marker. Preserve that meaning without changing time, price or payment data.
UPDATE public.appointments
SET is_manual_fit = true
WHERE COALESCE(notification_suppressed, false) = true
  AND is_manual_fit = false;

CREATE TABLE IF NOT EXISTS public.appointment_schedule_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id uuid NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  related_appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  operation text NOT NULL CHECK (operation IN ('move', 'swap', 'duration', 'manual_fit')),
  overlap_confirmed boolean NOT NULL DEFAULT false,
  previous_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  next_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  conflict_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS appointment_schedule_events_appointment_created_idx
  ON public.appointment_schedule_events (appointment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS appointment_schedule_events_studio_created_idx
  ON public.appointment_schedule_events (studio_id, created_at DESC);

ALTER TABLE public.appointment_schedule_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Studio members read schedule events" ON public.appointment_schedule_events;
CREATE POLICY "Studio members read schedule events"
  ON public.appointment_schedule_events FOR SELECT TO authenticated
  USING (public.can_use_studio(auth.uid(), studio_id));

DROP POLICY IF EXISTS "Service role manages schedule events" ON public.appointment_schedule_events;
CREATE POLICY "Service role manages schedule events"
  ON public.appointment_schedule_events FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- The former exclusion constraint could not distinguish accidental overlap
-- from an explicitly confirmed studio fit. This serialized trigger preserves
-- concurrency safety while allowing only transaction-scoped administrative
-- overrides.
ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS no_overlap_per_staff;

CREATE OR REPLACE FUNCTION public.enforce_appointment_schedule_overlap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
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
$function$;

DROP TRIGGER IF EXISTS enforce_appointment_schedule_overlap_trigger ON public.appointments;
CREATE TRIGGER enforce_appointment_schedule_overlap_trigger
  BEFORE INSERT OR UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_appointment_schedule_overlap();

CREATE OR REPLACE FUNCTION public.preview_studio_schedule_change(
  p_studio_id uuid,
  p_staff_id uuid,
  p_starts_at timestamptz,
  p_duration_min integer,
  p_ignore_appointment_ids uuid[] DEFAULT ARRAY[]::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.preview_studio_schedule_change(uuid, uuid, timestamptz, integer, uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preview_studio_schedule_change(uuid, uuid, timestamptz, integer, uuid[])
  TO service_role;

CREATE OR REPLACE FUNCTION public.move_studio_appointment(
  p_studio_id uuid,
  p_appointment_id uuid,
  p_starts_at timestamptz,
  p_duration_min integer,
  p_confirm_overlap boolean,
  p_actor_id uuid,
  p_expected_conflict_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_operation text DEFAULT 'move'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.move_studio_appointment(uuid, uuid, timestamptz, integer, boolean, uuid, uuid[], text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.move_studio_appointment(uuid, uuid, timestamptz, integer, boolean, uuid, uuid[], text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.swap_studio_appointments(
  p_studio_id uuid,
  p_first_appointment_id uuid,
  p_second_appointment_id uuid,
  p_confirm_overlap boolean,
  p_actor_id uuid,
  p_expected_conflict_ids uuid[] DEFAULT ARRAY[]::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.swap_studio_appointments(uuid, uuid, uuid, boolean, uuid, uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.swap_studio_appointments(uuid, uuid, uuid, boolean, uuid, uuid[])
  TO service_role;

CREATE OR REPLACE FUNCTION public.create_studio_manual_fit(
  p_studio_id uuid,
  p_staff_id uuid,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_client_id uuid,
  p_client_name text,
  p_client_phone text,
  p_notes text,
  p_confirm_overlap boolean,
  p_actor_id uuid,
  p_expected_conflict_ids uuid[] DEFAULT ARRAY[]::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.create_studio_manual_fit(
  uuid, uuid, uuid, timestamptz, uuid, text, text, text, boolean, uuid, uuid[]
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_studio_manual_fit(
  uuid, uuid, uuid, timestamptz, uuid, text, text, text, boolean, uuid, uuid[]
) TO service_role;

-- Keep the existing server entry point compatible while routing it through the
-- new atomic operation. It remains strict and never overrides a conflict.
CREATE OR REPLACE FUNCTION public.reschedule_studio_appointment(
  p_appointment_id uuid,
  p_studio_id uuid,
  p_local_date date,
  p_local_time time
)
RETURNS TABLE(appointment_id uuid, starts_at timestamptz, ends_at timestamptz, rescheduled boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.reschedule_studio_appointment(uuid, uuid, date, time)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_studio_appointment(uuid, uuid, date, time)
  TO service_role;

NOTIFY pgrst, 'reload schema';
