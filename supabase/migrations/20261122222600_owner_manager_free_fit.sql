-- Stage 2 follow-up: owner/manager may explicitly keep or clear a manual fit.
-- The six-argument overload preserves the published five-argument RPC for the
-- currently active Worker while keeping all existing financial safeguards.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.move_studio_appointment_stage2(
  p_studio_id uuid,
  p_appointment_id uuid,
  p_starts_at timestamptz,
  p_assignments jsonb,
  p_actor_id uuid,
  p_manual_fit boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE
  v_appt public.appointments%ROWTYPE;
  v_line public.appointment_services%ROWTYPE;
  v_item jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_before_lines jsonb;
  v_preview jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_staff uuid;
  v_first_staff uuid;
  v_duration integer;
  v_old_duration integer;
  v_buffer integer;
  v_count integer;
  v_delta interval := interval '0 minutes';
  v_start timestamptz;
  v_end timestamptz;
  v_last_end timestamptz;
  v_new_end timestamptz;
  v_duration_changed boolean := false;
  v_staff_changed boolean := false;
  v_has_conflict boolean := false;
  v_outside boolean := false;
  v_hard_blocked boolean := false;
  v_auto_fit_before boolean := false;
  v_auto_fit_after boolean := false;
  v_manual_fit_after boolean;
  v_privileged boolean;
  v_actor_staff uuid;
  v_changed boolean;
  v_old_override text := coalesce(current_setting('bellza.allow_manual_overlap', true), 'off');
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_studio_id IS NULL OR p_appointment_id IS NULL OR p_actor_id IS NULL
    OR p_starts_at IS NULL OR p_assignments IS NULL
    OR jsonb_typeof(p_assignments) <> 'array'
    OR jsonb_array_length(p_assignments) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'invalid_schedule_change';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles
    WHERE user_id=p_actor_id AND studio_id=p_studio_id
      AND role IN ('saas_owner','studio_owner','manager','staff','desk_staff')) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.user_roles
    WHERE user_id=p_actor_id AND studio_id=p_studio_id
      AND role IN ('saas_owner','studio_owner','manager')) INTO v_privileged;
  IF p_manual_fit IS NOT NULL AND NOT v_privileged THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF NOT v_privileged THEN
    SELECT id INTO v_actor_staff FROM public.staff
      WHERE studio_id=p_studio_id AND user_id=p_actor_id AND is_active
      ORDER BY id LIMIT 1;
    IF v_actor_staff IS NULL THEN RAISE EXCEPTION 'not_authorized'; END IF;
  END IF;
  -- Share the lock order with the published agenda RPCs.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_studio_id::text,726354));
  SELECT * INTO v_appt FROM public.appointments
    WHERE id=p_appointment_id AND studio_id=p_studio_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'appointment_not_found'; END IF;
  IF v_appt.status::text <> 'confirmed' THEN RAISE EXCEPTION 'appointment_not_editable'; END IF;
  SELECT count(*), jsonb_agg(to_jsonb(s) ORDER BY position NULLS LAST,starts_at NULLS LAST,id)
    INTO v_count,v_before_lines FROM public.appointment_services s
    WHERE appointment_id=p_appointment_id;
  IF v_count <> jsonb_array_length(p_assignments)
    OR (SELECT count(DISTINCT value->>'lineId') FROM jsonb_array_elements(p_assignments)) <> v_count
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_assignments) AS item(value)
      WHERE NOT EXISTS (SELECT 1 FROM public.appointment_services s
        WHERE s.id=(item.value->>'lineId')::uuid AND s.appointment_id=p_appointment_id)) THEN
    RAISE EXCEPTION 'invalid_service_lines';
  END IF;
  IF EXISTS (SELECT 1 FROM public.appointment_services
    WHERE appointment_id=p_appointment_id AND service_state IS NOT NULL
      AND service_state <> 'confirmed') THEN
    RAISE EXCEPTION 'joint_service_state_locked';
  END IF;
  PERFORM 1 FROM public.appointment_services
    WHERE appointment_id=p_appointment_id FOR UPDATE;
  FOR v_staff IN SELECT DISTINCT id FROM (
    SELECT (value->>'staffId')::uuid AS id FROM jsonb_array_elements(p_assignments)
    UNION SELECT coalesce(staff_id,v_appt.staff_id) FROM public.appointment_services
      WHERE appointment_id=p_appointment_id
  ) AS staff_ids WHERE id IS NOT NULL ORDER BY id LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(v_staff::text,918273));
  END LOOP;

  FOR v_line IN SELECT * FROM public.appointment_services
    WHERE appointment_id=p_appointment_id
    ORDER BY position NULLS LAST, starts_at NULLS LAST, id LOOP
    SELECT value INTO v_item FROM jsonb_array_elements(p_assignments) AS item(value)
      WHERE item.value->>'lineId'=v_line.id::text;
    v_staff := (v_item->>'staffId')::uuid;
    IF v_staff IS NULL OR jsonb_typeof(v_item->'durationMin') <> 'number'
      OR (v_item->>'durationMin') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'invalid_schedule_change';
    END IF;
    v_duration := (v_item->>'durationMin')::integer;
    IF v_duration NOT BETWEEN 5 AND 720 THEN RAISE EXCEPTION 'invalid_duration'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.staff
      WHERE id=v_staff AND studio_id=p_studio_id AND is_active
        AND coalesce(current_status,'online') <> 'absent') THEN
      RAISE EXCEPTION 'staff_unavailable';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.staff_services
      WHERE staff_id=v_staff AND service_id=v_line.service_id) THEN
      RAISE EXCEPTION 'staff_service_unavailable';
    END IF;
    v_old_duration := CASE WHEN v_count=1 THEN
      round(extract(epoch FROM (v_appt.ends_at-v_appt.starts_at))/60)::integer
      ELSE v_line.duration_min END;
    v_buffer := CASE WHEN v_count>1 AND v_line.starts_at IS NOT NULL
      AND v_line.ends_at IS NOT NULL THEN
      round(extract(epoch FROM (v_line.ends_at-v_line.starts_at))/60)::integer-v_line.duration_min
      ELSE 0 END;
    IF v_buffer < 0 THEN RAISE EXCEPTION 'invalid_service_segments'; END IF;
    v_duration_changed := v_duration_changed OR v_duration <> v_old_duration;
    v_staff_changed := v_staff_changed OR v_staff IS DISTINCT FROM coalesce(v_line.staff_id,v_appt.staff_id);
    v_start := CASE WHEN v_line.starts_at IS NOT NULL THEN
      p_starts_at + (v_line.starts_at-v_appt.starts_at) + v_delta
      ELSE coalesce(v_last_end,p_starts_at) END;
    v_end := v_start + make_interval(mins=>v_duration+v_buffer);
    IF v_last_end IS NOT NULL AND v_start < v_last_end THEN
      RAISE EXCEPTION 'joint_service_segments_overlap';
    END IF;
    v_delta := v_delta + make_interval(mins=>v_duration-v_old_duration);
    v_last_end := v_end;
    IF v_first_staff IS NULL THEN v_first_staff := v_staff; END IF;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'id',v_line.id,'staffId',v_staff,'startsAt',v_start,'endsAt',v_end,
      'durationMin',v_duration,'explicit',v_line.staff_id IS NOT NULL,
      'position',v_line.position,
      'studioCommission',v_line.studio_commission_percent_snapshot,
      'professionalCommission',v_line.professional_commission_percent_snapshot));
  END LOOP;
  v_new_end := v_appt.ends_at + (p_starts_at-v_appt.starts_at) + v_delta;
  IF v_last_end IS NULL OR v_new_end < v_last_end OR v_new_end <= p_starts_at
    OR v_new_end > p_starts_at + interval '1440 minutes' THEN
    RAISE EXCEPTION 'invalid_duration';
  END IF;
  IF v_staff_changed AND (
    EXISTS (SELECT 1 FROM public.payment_intents WHERE appointment_id=p_appointment_id)
    OR EXISTS (SELECT 1 FROM public.cash_register_movements WHERE appointment_id=p_appointment_id)
    OR EXISTS (SELECT 1 FROM public.booking_payment_requests
      WHERE appointment_id=p_appointment_id AND status IN ('awaiting_payment','processing','paid'))
  ) THEN RAISE EXCEPTION 'received_reservation_financial_fields_locked'; END IF;

  -- Recheck every segment inside the transaction; the client preview is advisory.
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_lines) AS item(value) LOOP
    v_preview := public.preview_studio_schedule_change(
      p_studio_id,(v_item->>'staffId')::uuid,(v_item->>'startsAt')::timestamptz,
      round(extract(epoch FROM ((v_item->>'endsAt')::timestamptz-
        (v_item->>'startsAt')::timestamptz))/60)::integer,ARRAY[p_appointment_id]);
    v_hard_blocked := coalesce((v_preview->>'hardBlocked')::boolean,false);
    -- Time off and ordinary schedule blocks are intentional fit opportunities
    -- for an owner/manager. Absent staff and online payment holds remain locked.
    IF NOT coalesce((v_preview->>'staffAvailable')::boolean,false)
      OR jsonb_array_length(coalesce(v_preview->'paymentHolds','[]'::jsonb)) > 0
      OR (v_hard_blocked AND NOT v_privileged) THEN
      RAISE EXCEPTION 'schedule_hard_blocked';
    END IF;
    v_has_conflict := v_has_conflict OR coalesce((v_preview->>'hasConflict')::boolean,false)
      OR jsonb_array_length(coalesce(v_preview->'blocks','[]'::jsonb)) > 0;
    v_outside := v_outside OR NOT coalesce((v_preview->>'withinAvailability')::boolean,false);
    v_conflicts := v_conflicts || coalesce(v_preview->'conflicts','[]'::jsonb);
  END LOOP;
  SELECT coalesce((next_state->>'manualFitAuto')::boolean,false)
    INTO v_auto_fit_before FROM public.appointment_schedule_events
    WHERE studio_id=p_studio_id AND appointment_id=p_appointment_id
    ORDER BY created_at DESC LIMIT 1;
  v_auto_fit_before := coalesce(v_auto_fit_before,false);
  IF p_manual_fit IS TRUE THEN
    v_auto_fit_after := false;
    v_manual_fit_after := true;
  ELSIF p_manual_fit IS FALSE THEN
    v_auto_fit_after := v_has_conflict OR v_outside;
    v_manual_fit_after := v_auto_fit_after;
  ELSE
    v_auto_fit_after := (v_has_conflict OR v_outside)
      AND (NOT coalesce(v_appt.is_manual_fit,false) OR v_auto_fit_before);
    v_manual_fit_after := v_has_conflict OR v_outside OR
      (coalesce(v_appt.is_manual_fit,false) AND NOT v_auto_fit_before);
  END IF;
  -- A professional may edit their own free schedule. Exceptions and staff
  -- transfers require the studio owner or manager, as in the owner drag flow.
  IF NOT v_privileged AND (v_has_conflict OR v_outside OR v_staff_changed OR
    v_appt.staff_id IS DISTINCT FROM v_actor_staff OR
    EXISTS (SELECT 1 FROM public.appointment_services s
      WHERE s.appointment_id=p_appointment_id
        AND coalesce(s.staff_id,v_appt.staff_id) IS DISTINCT FROM v_actor_staff)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  v_changed := p_starts_at IS DISTINCT FROM v_appt.starts_at
    OR v_new_end IS DISTINCT FROM v_appt.ends_at OR v_staff_changed OR v_duration_changed
    OR v_manual_fit_after IS DISTINCT FROM coalesce(v_appt.is_manual_fit,false);
  IF NOT v_changed THEN
    RETURN jsonb_build_object('appointmentId',p_appointment_id,'startsAt',v_appt.starts_at,
      'endsAt',v_appt.ends_at,'durationMin',v_appt.total_duration_min,
      'isManualFit',v_appt.is_manual_fit,'changed',false,'shouldNotify',false,
      'conflicts',v_conflicts,'services',v_lines);
  END IF;

  -- Detach explicit segments only for this transaction. Never change service ID,
  -- price or any financial row; restore commission snapshots after staff triggers.
  UPDATE public.appointment_services SET staff_id=NULL,starts_at=NULL,ends_at=NULL,position=NULL
    WHERE appointment_id=p_appointment_id AND staff_id IS NOT NULL;
  PERFORM set_config('bellza.allow_manual_overlap','on',true);
  IF v_first_staff IS DISTINCT FROM v_appt.staff_id THEN
    UPDATE public.appointments SET staff_id=v_first_staff,starts_at=p_starts_at,ends_at=v_new_end,
      total_duration_min=round(extract(epoch FROM (v_new_end-p_starts_at))/60)::integer,
      duration_overridden=coalesce(duration_overridden,false) OR v_duration_changed,
      is_manual_fit=v_manual_fit_after,updated_at=now()
      WHERE id=p_appointment_id AND studio_id=p_studio_id;
    -- A staff reassignment fires the published commission trigger. Keep the
    -- reservation's recorded snapshot; the line snapshots are restored below.
    UPDATE public.appointments SET
      studio_commission_percent_snapshot=v_appt.studio_commission_percent_snapshot
      WHERE id=p_appointment_id AND studio_id=p_studio_id
        AND studio_commission_percent_snapshot IS DISTINCT FROM
          v_appt.studio_commission_percent_snapshot;
  ELSE
    -- Omitting staff_id avoids firing that trigger on a pure time/duration edit.
    UPDATE public.appointments SET starts_at=p_starts_at,ends_at=v_new_end,
      total_duration_min=round(extract(epoch FROM (v_new_end-p_starts_at))/60)::integer,
      duration_overridden=coalesce(duration_overridden,false) OR v_duration_changed,
      is_manual_fit=v_manual_fit_after,updated_at=now()
      WHERE id=p_appointment_id AND studio_id=p_studio_id;
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_lines) AS item(value) LOOP
    UPDATE public.appointment_services SET
      duration_min=(v_item->>'durationMin')::integer,
      staff_id=CASE WHEN (v_item->>'explicit')::boolean OR v_count>1
        THEN (v_item->>'staffId')::uuid ELSE NULL END,
      starts_at=CASE WHEN (v_item->>'explicit')::boolean OR v_count>1
        THEN (v_item->>'startsAt')::timestamptz ELSE NULL END,
      ends_at=CASE WHEN (v_item->>'explicit')::boolean OR v_count>1
        THEN (v_item->>'endsAt')::timestamptz ELSE NULL END,
      position=CASE WHEN (v_item->>'explicit')::boolean OR v_count>1
        THEN (v_item->>'position')::integer ELSE NULL END
      WHERE id=(v_item->>'id')::uuid AND appointment_id=p_appointment_id;
    UPDATE public.appointment_services SET
      studio_commission_percent_snapshot=(v_item->>'studioCommission')::numeric,
      professional_commission_percent_snapshot=(v_item->>'professionalCommission')::numeric
      WHERE id=(v_item->>'id')::uuid AND appointment_id=p_appointment_id;
  END LOOP;
  PERFORM set_config('bellza.allow_manual_overlap',v_old_override,true);
  IF EXISTS (SELECT 1 FROM public.appointment_services s
    JOIN jsonb_array_elements(v_lines) AS item(value) ON s.id=(item.value->>'id')::uuid
    WHERE s.appointment_id=p_appointment_id AND (
      s.studio_commission_percent_snapshot IS DISTINCT FROM (item.value->>'studioCommission')::numeric
      OR s.professional_commission_percent_snapshot IS DISTINCT FROM (item.value->>'professionalCommission')::numeric
    )) THEN RAISE EXCEPTION 'commission_snapshot_changed'; END IF;
  IF EXISTS (SELECT 1 FROM public.appointments a
    WHERE a.id=p_appointment_id AND a.studio_id=p_studio_id
      AND a.studio_commission_percent_snapshot IS DISTINCT FROM
        v_appt.studio_commission_percent_snapshot) THEN
    RAISE EXCEPTION 'commission_snapshot_changed';
  END IF;
  INSERT INTO public.appointment_schedule_events
    (studio_id,appointment_id,actor_id,operation,previous_state,next_state)
  VALUES (p_studio_id,p_appointment_id,p_actor_id,
    CASE WHEN p_starts_at IS DISTINCT FROM v_appt.starts_at OR v_staff_changed THEN 'move' ELSE 'duration' END,
    jsonb_build_object('startsAt',v_appt.starts_at,'endsAt',v_appt.ends_at,
      'durationMin',v_appt.total_duration_min,'staffId',v_appt.staff_id,
      'isManualFit',v_appt.is_manual_fit,'manualFitAuto',v_auto_fit_before,
      'services',v_before_lines),
    jsonb_build_object('startsAt',p_starts_at,'endsAt',v_new_end,
      'durationMin',round(extract(epoch FROM (v_new_end-p_starts_at))/60)::integer,
      'staffId',v_first_staff,'isManualFit',v_manual_fit_after,
      'manualFitAuto',v_auto_fit_after,'services',v_lines));
  RETURN jsonb_build_object('appointmentId',p_appointment_id,'startsAt',p_starts_at,
    'endsAt',v_new_end,
    'durationMin',round(extract(epoch FROM (v_new_end-p_starts_at))/60)::integer,
    'isManualFit',v_manual_fit_after,'changed',true,
    'shouldNotify',p_starts_at IS DISTINCT FROM v_appt.starts_at OR v_staff_changed,
    'conflicts',v_conflicts,'services',v_lines,
    'autoFitCreated',v_auto_fit_after AND NOT coalesce(v_appt.is_manual_fit,false));
END
$function$;

REVOKE ALL ON FUNCTION public.move_studio_appointment_stage2(uuid,uuid,timestamptz,jsonb,uuid,boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.move_studio_appointment_stage2(uuid,uuid,timestamptz,jsonb,uuid,boolean)
  TO service_role;
COMMIT;
