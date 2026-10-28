-- Edit one resolved appointment without changing its attendance or financial records.
-- This is a candidate migration; it has not been applied to production.
CREATE OR REPLACE FUNCTION public.edit_resolved_appointment_schedule(
  p_studio_id uuid, p_appointment_id uuid, p_expected_status text,
  p_starts_at timestamptz, p_duration_min integer, p_notes text,
  p_actor_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_appt public.appointments%ROWTYPE;
  v_line public.appointment_services%ROWTYPE;
  v_catalog_duration integer;
  v_preview jsonb;
  v_end timestamptz;
  v_changed boolean;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=p_actor_id
      AND studio_id=p_studio_id AND role IN ('studio_owner','saas_owner')) THEN
    RAISE EXCEPTION 'studio_owner_required';
  END IF;
  IF p_expected_status NOT IN ('completed','no_show')
     OR p_starts_at IS NULL OR p_duration_min IS NULL
     OR p_duration_min < 5 OR p_duration_min > 720
     OR length(coalesce(p_notes,'')) > 5000 THEN
    RAISE EXCEPTION 'invalid_resolved_edit';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_studio_id::text,726354));
  SELECT * INTO v_appt FROM public.appointments
    WHERE id=p_appointment_id AND studio_id=p_studio_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'appointment_not_found'; END IF;
  IF v_appt.status::text <> p_expected_status THEN RAISE EXCEPTION 'appointment_changed_reload'; END IF;
  IF (SELECT count(*) FROM public.appointment_services WHERE appointment_id=v_appt.id) <> 1 THEN
    RAISE EXCEPTION 'resolved_multi_service_edit_unsupported';
  END IF;
  SELECT * INTO v_line FROM public.appointment_services WHERE appointment_id=v_appt.id FOR UPDATE;
  IF v_line.service_state IS NOT NULL THEN RAISE EXCEPTION 'resolved_joint_service_edit_unsupported'; END IF;
  SELECT duration_min INTO v_catalog_duration FROM public.services
    WHERE id=v_line.service_id AND studio_id=p_studio_id;
  IF v_catalog_duration IS NULL OR p_duration_min > greatest(v_catalog_duration,v_line.duration_min) THEN
    RAISE EXCEPTION 'invalid_duration';
  END IF;
  v_end := p_starts_at + make_interval(mins => p_duration_min);
  v_changed := p_starts_at IS DISTINCT FROM v_appt.starts_at
    OR v_end IS DISTINCT FROM v_appt.ends_at;
  IF NOT v_changed THEN
    UPDATE public.appointments SET notes=p_notes,updated_at=now() WHERE id=v_appt.id;
    RETURN jsonb_build_object('appointmentId',v_appt.id,'status',v_appt.status,'changed',false);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_appt.staff_id::text,918273));
  v_preview := public.preview_studio_schedule_change(
    p_studio_id,v_appt.staff_id,p_starts_at,p_duration_min,ARRAY[v_appt.id]);
  IF coalesce((v_preview->>'hardBlocked')::boolean,false) THEN RAISE EXCEPTION 'schedule_hard_blocked'; END IF;
  IF coalesce((v_preview->>'hasConflict')::boolean,false) THEN RAISE EXCEPTION 'slot_unavailable'; END IF;
  IF NOT coalesce((v_preview->>'withinAvailability')::boolean,false)
     AND NOT coalesce(v_appt.is_manual_fit,false) THEN
    RAISE EXCEPTION 'outside_staff_availability';
  END IF;

  -- Preserve each service line ID and avoid UPDATE OF service_id/price/staff_id,
  -- which would recapture commission snapshots or modify financial calculations.
  IF v_line.staff_id IS NOT NULL THEN
    UPDATE public.appointment_services SET staff_id=NULL,starts_at=NULL,ends_at=NULL,position=NULL
      WHERE id=v_line.id;
  END IF;
  UPDATE public.appointments SET starts_at=p_starts_at,ends_at=v_end,
    total_duration_min=p_duration_min,
    duration_overridden=duration_overridden OR p_duration_min <> coalesce(v_appt.total_duration_min,v_line.duration_min),
    notes=p_notes,updated_at=now() WHERE id=v_appt.id;
  IF v_line.staff_id IS NOT NULL THEN
    UPDATE public.appointment_services SET staff_id=v_line.staff_id,
      starts_at=p_starts_at,ends_at=v_end,duration_min=p_duration_min,position=v_line.position
      WHERE id=v_line.id;
  ELSE
    UPDATE public.appointment_services SET duration_min=p_duration_min WHERE id=v_line.id;
  END IF;
  -- The published lifecycle trigger clears attendance metadata on a start-time
  -- change. Restore it in the same transaction without changing the status.
  UPDATE public.appointments SET attendance_resolved_at=v_appt.attendance_resolved_at,
    attendance_resolved_by=v_appt.attendance_resolved_by WHERE id=v_appt.id;
  INSERT INTO public.appointment_schedule_events
    (studio_id,appointment_id,actor_id,operation,previous_state,next_state)
  VALUES (p_studio_id,v_appt.id,p_actor_id,
    CASE WHEN p_starts_at IS DISTINCT FROM v_appt.starts_at THEN 'move' ELSE 'duration' END,
    jsonb_build_object('startsAt',v_appt.starts_at,'endsAt',v_appt.ends_at,'durationMin',v_appt.total_duration_min),
    jsonb_build_object('startsAt',p_starts_at,'endsAt',v_end,'durationMin',p_duration_min));
  RETURN jsonb_build_object('appointmentId',v_appt.id,'status',v_appt.status,'changed',true);
END $$;

REVOKE ALL ON FUNCTION public.edit_resolved_appointment_schedule(uuid,uuid,text,timestamptz,integer,text,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.edit_resolved_appointment_schedule(uuid,uuid,text,timestamptz,integer,text,uuid)
  TO service_role;
