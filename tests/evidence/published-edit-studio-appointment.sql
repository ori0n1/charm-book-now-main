CREATE OR REPLACE FUNCTION public.edit_studio_appointment(p_studio_id uuid, p_appointment_id uuid, p_starts_at timestamp with time zone, p_assignments jsonb, p_total_price numeric, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_appt public.appointments%ROWTYPE;
  v_line public.appointment_services%ROWTYPE;
  v_service public.services%ROWTYPE;
  v_item jsonb; v_lines jsonb := '[]'::jsonb; v_before_lines jsonb;
  v_staff uuid; v_duration integer; v_catalog_duration integer; v_delta integer := 0;
  v_cursor timestamptz; v_start timestamptz; v_end timestamptz;
  v_preview jsonb; v_schedule_changed boolean := false;
  v_explicit boolean; v_price numeric; v_allocated numeric := 0;
  v_weight numeric := 0; v_index integer := 0; v_count integer;
  v_old_override text := COALESCE(current_setting('bellza.allow_manual_overlap', true), 'off');
BEGIN
  IF NOT public.can_use_studio(auth.uid(), p_studio_id) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO v_appt FROM public.appointments
    WHERE id = p_appointment_id AND studio_id = p_studio_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'appointment_not_found'; END IF;
  IF v_appt.status IN ('cancelled','no_show','completed') THEN RAISE EXCEPTION 'appointment_not_editable'; END IF;
  IF p_starts_at IS NULL OR p_total_price IS NULL OR p_total_price < 0
     OR p_total_price > 99999999.99 OR p_total_price <> round(p_total_price,2)
     OR p_total_price::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'invalid_appointment_value'; END IF;
  IF p_assignments IS NULL OR jsonb_typeof(p_assignments) <> 'array' THEN RAISE EXCEPTION 'services_required'; END IF;
  SELECT count(*), COALESCE(sum(price),0), jsonb_agg(to_jsonb(s) ORDER BY position NULLS LAST,id)
    INTO v_count,v_weight,v_before_lines FROM public.appointment_services s WHERE appointment_id=v_appt.id;
  IF v_count = 0 OR v_count <> jsonb_array_length(p_assignments) OR v_count > 20
    OR (SELECT count(DISTINCT value->>'lineId') FROM jsonb_array_elements(p_assignments)) <> v_count
    THEN RAISE EXCEPTION 'invalid_service_lines'; END IF;
  v_schedule_changed := p_starts_at IS DISTINCT FROM v_appt.starts_at;
  -- Lock old and new professionals in a stable order, sharing the current schedule locks.
  FOR v_staff IN
    SELECT DISTINCT id FROM (
      SELECT (value->>'staffId')::uuid id FROM jsonb_array_elements(p_assignments)
      UNION SELECT COALESCE(staff_id,v_appt.staff_id) FROM public.appointment_services WHERE appointment_id=v_appt.id
    ) ids ORDER BY id
  LOOP PERFORM pg_advisory_xact_lock(hashtextextended(v_staff::text,918273)); END LOOP;
  v_cursor := p_starts_at;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_assignments)
    ORDER BY (SELECT position FROM public.appointment_services WHERE id=(value->>'lineId')::uuid AND appointment_id=v_appt.id) NULLS LAST,
      (SELECT starts_at FROM public.appointment_services WHERE id=(value->>'lineId')::uuid AND appointment_id=v_appt.id) NULLS LAST,
      (value->>'lineId')::uuid
  LOOP
    SELECT * INTO v_line FROM public.appointment_services
      WHERE id=(v_item->>'lineId')::uuid AND appointment_id=v_appt.id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'invalid_service_lines'; END IF;
    v_staff := (v_item->>'staffId')::uuid;
    IF v_staff IS NULL OR (v_item->>'serviceId') IS NULL THEN RAISE EXCEPTION 'services_required'; END IF;
    v_duration := CASE WHEN v_count=1 AND v_line.service_id=(v_item->>'serviceId')::uuid
      THEN round(EXTRACT(EPOCH FROM (v_appt.ends_at-v_appt.starts_at))/60)::integer ELSE v_line.duration_min END;
    IF v_line.service_id IS DISTINCT FROM (v_item->>'serviceId')::uuid THEN
      SELECT * INTO v_service FROM public.services WHERE id=(v_item->>'serviceId')::uuid AND studio_id=p_studio_id AND is_active;
      IF NOT FOUND THEN RAISE EXCEPTION 'service_not_found'; END IF;
      v_duration := v_service.duration_min;
    END IF;
    IF v_item ? 'durationMin' THEN
      SELECT duration_min INTO v_catalog_duration FROM public.services
        WHERE id=(v_item->>'serviceId')::uuid AND studio_id=p_studio_id;
      IF v_catalog_duration IS NULL THEN RAISE EXCEPTION 'service_not_found'; END IF;
      IF jsonb_typeof(v_item->'durationMin') <> 'number'
         OR (v_item->>'durationMin') !~ '^[0-9]+$' THEN
        RAISE EXCEPTION 'invalid_duration';
      END IF;
      IF (v_item->>'durationMin')::numeric < 5
         OR (v_item->>'durationMin')::numeric > v_catalog_duration THEN
        RAISE EXCEPTION 'invalid_duration';
      END IF;
      v_duration := (v_item->>'durationMin')::integer;
    END IF;
    IF v_duration IS DISTINCT FROM (CASE WHEN v_count=1 THEN
      round(EXTRACT(EPOCH FROM (v_appt.ends_at-v_appt.starts_at))/60)::integer
      ELSE v_line.duration_min END) THEN
      v_schedule_changed := true;
    END IF;
    IF v_staff IS DISTINCT FROM COALESCE(v_line.staff_id,v_appt.staff_id)
       OR v_line.service_id IS DISTINCT FROM (v_item->>'serviceId')::uuid THEN
      v_schedule_changed := true;
    END IF;
    v_start := CASE WHEN v_line.starts_at IS NOT NULL
      THEN p_starts_at+(v_line.starts_at-v_appt.starts_at)+make_interval(mins=>v_delta) ELSE v_cursor END;
    v_end := v_start+make_interval(mins=>v_duration);
    v_delta := v_delta + v_duration - CASE WHEN v_count=1 THEN round(EXTRACT(EPOCH FROM (v_appt.ends_at-v_appt.starts_at))/60)::integer ELSE v_line.duration_min END;
    v_cursor := v_end;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('id',v_line.id,'serviceId',v_item->>'serviceId',
      'staffId',v_staff,'startsAt',v_start,'endsAt',v_end,'duration',v_duration,'price',v_line.price,
      'explicit',v_line.staff_id IS NOT NULL,'position',v_line.position));
  END LOOP;
  IF v_schedule_changed THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_lines)
    LOOP
      v_staff := (v_item->>'staffId')::uuid;
      IF NOT EXISTS (SELECT 1 FROM public.staff WHERE id=v_staff AND studio_id=p_studio_id AND is_active
        AND COALESCE(current_status,'online') <> 'absent') THEN RAISE EXCEPTION 'staff_unavailable'; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.staff_services WHERE staff_id=v_staff AND service_id=(v_item->>'serviceId')::uuid)
        THEN RAISE EXCEPTION 'staff_service_unavailable'; END IF;
      v_preview := public.preview_studio_schedule_change(p_studio_id,v_staff,(v_item->>'startsAt')::timestamptz,
        (v_item->>'duration')::integer,ARRAY[v_appt.id]);
      IF COALESCE((v_preview->>'hardBlocked')::boolean,false) THEN RAISE EXCEPTION 'schedule_hard_blocked'; END IF;
      IF COALESCE((v_preview->>'hasConflict')::boolean,false)
        OR (NOT COALESCE((v_preview->>'withinAvailability')::boolean,false) AND NOT v_appt.is_manual_fit)
        THEN RAISE EXCEPTION 'slot_unavailable'; END IF;
    END LOOP;
    -- Keep every line ID. Clear the explicit segment shape only inside this transaction,
    -- then let the existing segment trigger validate the final intervals.
    UPDATE public.appointment_services SET staff_id=NULL,starts_at=NULL,ends_at=NULL,position=NULL
      WHERE appointment_id=v_appt.id AND staff_id IS NOT NULL;
    PERFORM set_config('bellza.allow_manual_overlap','on',true);
    UPDATE public.appointments SET staff_id=(v_lines->0->>'staffId')::uuid, starts_at=p_starts_at,
      ends_at=v_appt.ends_at+(p_starts_at-v_appt.starts_at)+make_interval(mins=>v_delta),
      total_duration_min=COALESCE(v_appt.total_duration_min,round(EXTRACT(EPOCH FROM(v_appt.ends_at-v_appt.starts_at))/60)::integer)+v_delta,
      updated_at=now() WHERE id=v_appt.id;
    PERFORM set_config('bellza.allow_manual_overlap',v_old_override,true);
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_lines)
  LOOP
    v_index := v_index+1;
    v_price := CASE WHEN p_total_price=v_appt.total_price THEN (v_item->>'price')::numeric
      WHEN v_index=v_count THEN p_total_price-v_allocated
      WHEN v_weight>0 THEN trunc(p_total_price*(v_item->>'price')::numeric/v_weight,2)
      ELSE trunc(p_total_price/v_count,2) END;
    v_allocated := v_allocated+v_price;
    IF v_schedule_changed THEN
      v_explicit := (v_item->>'explicit')::boolean OR v_count>1;
      UPDATE public.appointment_services SET service_id=(v_item->>'serviceId')::uuid,price=v_price,
        duration_min=(v_item->>'duration')::integer,
        staff_id=CASE WHEN v_explicit THEN (v_item->>'staffId')::uuid ELSE NULL END,
        starts_at=CASE WHEN v_explicit THEN (v_item->>'startsAt')::timestamptz ELSE NULL END,
        ends_at=CASE WHEN v_explicit THEN (v_item->>'endsAt')::timestamptz ELSE NULL END,
        position=CASE WHEN v_explicit THEN COALESCE((v_item->>'position')::integer,v_index-1) ELSE NULL END
        WHERE id=(v_item->>'id')::uuid AND appointment_id=v_appt.id;
    ELSIF p_total_price IS DISTINCT FROM v_appt.total_price THEN
      UPDATE public.appointment_services SET price=v_price WHERE id=(v_item->>'id')::uuid AND appointment_id=v_appt.id;
    END IF;
  END LOOP;
  UPDATE public.appointments SET total_price=p_total_price,notes=p_notes,updated_at=now() WHERE id=v_appt.id;
  IF v_schedule_changed THEN
    INSERT INTO public.appointment_schedule_events(studio_id,appointment_id,actor_id,operation,previous_state,next_state)
      SELECT p_studio_id,v_appt.id,auth.uid(),CASE WHEN p_starts_at<>v_appt.starts_at THEN 'move' ELSE 'duration' END,
        jsonb_build_object('startsAt',v_appt.starts_at,'endsAt',v_appt.ends_at,'staffId',v_appt.staff_id,'services',v_before_lines),
        jsonb_build_object('startsAt',a.starts_at,'endsAt',a.ends_at,'staffId',a.staff_id,'services',v_lines)
      FROM public.appointments a WHERE a.id=v_appt.id;
  END IF;
  RETURN jsonb_build_object('appointment_id',v_appt.id,'updated',true);
END
$function$

