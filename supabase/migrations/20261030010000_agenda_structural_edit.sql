-- Extend the existing edit RPC only when service lines are added or removed.
-- Same-count edits retain their exact deployed implementation.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE public.agenda_structural_edit_backup_20261030 (
  signature text PRIMARY KEY,
  definition text NOT NULL,
  installed_md5 text,
  saved_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.agenda_structural_edit_backup_20261030 FROM PUBLIC, anon, authenticated;
ALTER TABLE public.agenda_structural_edit_backup_20261030 ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.edit_studio_appointment_structure_unpaid(
  p_studio_id uuid, p_appointment_id uuid, p_starts_at timestamptz,
  p_assignments jsonb, p_total_price numeric, p_notes text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_appt public.appointments%ROWTYPE;
  v_existing public.appointment_services%ROWTYPE;
  v_service public.services%ROWTYPE;
  v_item jsonb;
  v_line jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_before_lines jsonb;
  v_line_id uuid;
  v_service_id uuid;
  v_staff_id uuid;
  v_duration integer;
  v_count integer;
  v_index integer := 0;
  v_weight numeric := 0;
  v_allocated numeric := 0;
  v_price numeric;
  v_cursor timestamptz;
  v_preview jsonb;
  v_stateful boolean;
  v_explicit boolean;
  v_is_new boolean;
  v_old_override text := COALESCE(current_setting('bellza.allow_manual_overlap', true), 'off');
BEGIN
  IF NOT (public.can_use_studio(auth.uid(), p_studio_id)
    OR public.can_use_agenda_desk(auth.uid(), p_studio_id)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  SELECT * INTO v_appt FROM public.appointments
    WHERE id=p_appointment_id AND studio_id=p_studio_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'appointment_not_found'; END IF;
  IF v_appt.status <> 'confirmed' THEN RAISE EXCEPTION 'appointment_not_editable'; END IF;
  IF p_starts_at IS NULL OR p_total_price IS NULL OR p_total_price < 0
    OR p_total_price > 99999999.99 OR p_total_price <> round(p_total_price,2)
    OR p_total_price::text IN ('NaN','Infinity','-Infinity') THEN
    RAISE EXCEPTION 'invalid_appointment_value';
  END IF;
  IF p_assignments IS NULL OR jsonb_typeof(p_assignments) <> 'array'
    OR jsonb_array_length(p_assignments) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'services_required';
  END IF;
  v_count := jsonb_array_length(p_assignments);
  PERFORM 1 FROM public.appointment_services
    WHERE appointment_id=p_appointment_id FOR UPDATE;
  SELECT COALESCE(jsonb_agg(to_jsonb(line) ORDER BY position NULLS LAST,id),'[]'::jsonb)
    INTO v_before_lines FROM public.appointment_services line
    WHERE appointment_id=p_appointment_id;
  SELECT EXISTS (SELECT 1 FROM public.appointment_services
    WHERE appointment_id=p_appointment_id AND service_state IS NOT NULL) INTO v_stateful;
  IF EXISTS (SELECT 1 FROM public.appointment_services
    WHERE appointment_id=p_appointment_id AND service_state IS NOT NULL
      AND service_state <> 'confirmed') THEN
    RAISE EXCEPTION 'joint_service_state_locked';
  END IF;

  -- Any received or active payment record locks the service structure.
  IF EXISTS (SELECT 1 FROM public.payment_intents WHERE appointment_id=p_appointment_id)
    OR EXISTS (SELECT 1 FROM public.cash_register_movements
      WHERE appointment_id=p_appointment_id AND movement_type='service_payment')
    OR EXISTS (SELECT 1 FROM public.joint_payment_attempts WHERE appointment_id=p_appointment_id)
    OR EXISTS (SELECT 1 FROM public.joint_service_payment_allocations WHERE appointment_id=p_appointment_id)
    OR EXISTS (SELECT 1 FROM public.booking_payment_requests
      WHERE appointment_id=p_appointment_id AND status IN ('awaiting_payment','processing','paid')) THEN
    RAISE EXCEPTION 'received_reservation_financial_fields_locked';
  END IF;
  IF (SELECT count(DISTINCT item.value->>'lineId')
      FROM jsonb_array_elements(p_assignments) AS item(value)) <> v_count
    OR (SELECT count(DISTINCT item.value->>'serviceId')
      FROM jsonb_array_elements(p_assignments) AS item(value)) <> v_count THEN
    RAISE EXCEPTION 'duplicate_services';
  END IF;

  -- Reuse the existing schedule locks and preview for each sequential segment.
  FOR v_staff_id IN
    SELECT DISTINCT id FROM (
      SELECT (value->>'staffId')::uuid AS id FROM jsonb_array_elements(p_assignments)
      UNION SELECT COALESCE(staff_id,v_appt.staff_id)
        FROM public.appointment_services WHERE appointment_id=p_appointment_id
    ) staff_ids ORDER BY id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(v_staff_id::text,918273));
  END LOOP;

  v_cursor := p_starts_at;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_assignments) WITH ORDINALITY AS items(value,ordinal)
    ORDER BY ordinal
  LOOP
    v_line_id := (v_item->>'lineId')::uuid;
    v_service_id := (v_item->>'serviceId')::uuid;
    v_staff_id := (v_item->>'staffId')::uuid;
    v_is_new := COALESCE((v_item->>'isNew')::boolean,false);
    IF v_line_id IS NULL OR v_service_id IS NULL OR v_staff_id IS NULL THEN
      RAISE EXCEPTION 'services_required';
    END IF;
    SELECT * INTO v_existing FROM public.appointment_services WHERE id=v_line_id;
    IF v_is_new THEN
      IF FOUND THEN RAISE EXCEPTION 'invalid_service_lines'; END IF;
    ELSIF NOT FOUND OR v_existing.appointment_id <> p_appointment_id THEN
      RAISE EXCEPTION 'invalid_service_lines';
    END IF;
    SELECT * INTO v_service FROM public.services
      WHERE id=v_service_id AND studio_id=p_studio_id AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'service_not_found'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.staff WHERE id=v_staff_id
      AND studio_id=p_studio_id AND is_active
      AND COALESCE(current_status,'online') <> 'absent') THEN
      RAISE EXCEPTION 'staff_unavailable';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.staff_services
      WHERE staff_id=v_staff_id AND service_id=v_service_id) THEN
      RAISE EXCEPTION 'staff_service_unavailable';
    END IF;
    v_duration := CASE WHEN NOT v_is_new AND v_existing.service_id=v_service_id
      THEN v_existing.duration_min ELSE v_service.duration_min END;
    IF v_item ? 'durationMin' THEN
      IF jsonb_typeof(v_item->'durationMin') <> 'number'
        OR (v_item->>'durationMin') !~ '^[0-9]+$' THEN
        RAISE EXCEPTION 'invalid_duration';
      END IF;
      v_duration := (v_item->>'durationMin')::integer;
    END IF;
    IF v_duration NOT BETWEEN 5 AND v_service.duration_min THEN
      RAISE EXCEPTION 'invalid_duration';
    END IF;
    v_preview := public.preview_studio_schedule_change(
      p_studio_id,v_staff_id,v_cursor,v_duration,ARRAY[p_appointment_id]);
    IF COALESCE((v_preview->>'hardBlocked')::boolean,false) THEN
      RAISE EXCEPTION 'schedule_hard_blocked';
    END IF;
    IF COALESCE((v_preview->>'hasConflict')::boolean,false)
      OR (NOT COALESCE((v_preview->>'withinAvailability')::boolean,false)
        AND NOT v_appt.is_manual_fit) THEN
      RAISE EXCEPTION 'slot_unavailable';
    END IF;
    v_weight := v_weight + v_service.price;
    v_explicit := v_count > 1 OR v_stateful
      OR (NOT v_is_new AND v_existing.staff_id IS NOT NULL);
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'id',v_line_id,'serviceId',v_service_id,'staffId',v_staff_id,
      'startsAt',v_cursor,'endsAt',v_cursor+make_interval(mins=>v_duration),
      'duration',v_duration,'weightPrice',v_service.price,
      'isNew',v_is_new,'explicit',v_explicit));
    v_cursor := v_cursor + make_interval(mins=>v_duration);
  END LOOP;

  UPDATE public.appointment_services SET staff_id=NULL,starts_at=NULL,ends_at=NULL,position=NULL
    WHERE appointment_id=p_appointment_id AND staff_id IS NOT NULL;
  DELETE FROM public.appointment_services WHERE appointment_id=p_appointment_id
    AND id NOT IN (SELECT (item.value->>'id')::uuid
      FROM jsonb_array_elements(v_lines) AS item(value)
      WHERE NOT (item.value->>'isNew')::boolean);
  PERFORM set_config('bellza.allow_manual_overlap','on',true);
  UPDATE public.appointments SET
    staff_id=(v_lines->0->>'staffId')::uuid,
    starts_at=p_starts_at, ends_at=v_cursor,
    total_duration_min=round(EXTRACT(EPOCH FROM (v_cursor-p_starts_at))/60)::integer,
    total_price=p_total_price, notes=p_notes, updated_at=now()
    WHERE id=p_appointment_id;

  FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines) WITH ORDINALITY AS lines(value,ordinal)
    ORDER BY ordinal
  LOOP
    v_index := v_index+1;
    v_price := CASE WHEN v_index=v_count THEN p_total_price-v_allocated
      WHEN v_weight>0 THEN trunc(p_total_price*(v_line->>'weightPrice')::numeric/v_weight,2)
      ELSE trunc(p_total_price/v_count,2) END;
    v_allocated := v_allocated+v_price;
    v_explicit := (v_line->>'explicit')::boolean;
    IF (v_line->>'isNew')::boolean THEN
      INSERT INTO public.appointment_services
        (id,appointment_id,service_id,is_upsell,price,duration_min,
          staff_id,starts_at,ends_at,position,service_state)
      VALUES ((v_line->>'id')::uuid,p_appointment_id,(v_line->>'serviceId')::uuid,
        false,v_price,(v_line->>'duration')::integer,
        CASE WHEN v_explicit THEN (v_line->>'staffId')::uuid ELSE NULL END,
        CASE WHEN v_explicit THEN (v_line->>'startsAt')::timestamptz ELSE NULL END,
        CASE WHEN v_explicit THEN (v_line->>'endsAt')::timestamptz ELSE NULL END,
        CASE WHEN v_explicit THEN v_index-1 ELSE NULL END,
        CASE WHEN v_stateful THEN 'confirmed' ELSE NULL END);
    ELSE
      UPDATE public.appointment_services SET
        service_id=(v_line->>'serviceId')::uuid,price=v_price,
        duration_min=(v_line->>'duration')::integer,
        staff_id=CASE WHEN v_explicit THEN (v_line->>'staffId')::uuid ELSE NULL END,
        starts_at=CASE WHEN v_explicit THEN (v_line->>'startsAt')::timestamptz ELSE NULL END,
        ends_at=CASE WHEN v_explicit THEN (v_line->>'endsAt')::timestamptz ELSE NULL END,
        position=CASE WHEN v_explicit THEN v_index-1 ELSE NULL END
      WHERE id=(v_line->>'id')::uuid AND appointment_id=p_appointment_id;
    END IF;
  END LOOP;
  PERFORM set_config('bellza.allow_manual_overlap',v_old_override,true);
  INSERT INTO public.appointment_schedule_events
    (studio_id,appointment_id,actor_id,operation,previous_state,next_state)
  VALUES (p_studio_id,p_appointment_id,auth.uid(),'duration',
    jsonb_build_object('startsAt',v_appt.starts_at,'endsAt',v_appt.ends_at,
      'staffId',v_appt.staff_id,'services',v_before_lines),
    jsonb_build_object('startsAt',p_starts_at,'endsAt',v_cursor,
      'staffId',(v_lines->0->>'staffId')::uuid,'services',v_lines));
  RETURN jsonb_build_object('appointment_id',p_appointment_id,'updated',true);
END
$function$;
REVOKE ALL ON FUNCTION public.edit_studio_appointment_structure_unpaid(uuid,uuid,timestamptz,jsonb,numeric,text)
  FROM PUBLIC, anon, authenticated, service_role;

DO $install$
DECLARE
  v_signature text := 'public.edit_studio_appointment(uuid,uuid,timestamptz,jsonb,numeric,text)';
  v_original text;
  v_current text;
  v_expected text;
  v_marker text := '  IF v_count = 0 OR v_count <> jsonb_array_length(p_assignments) OR v_count > 20';
  v_insert text := $insert$  IF v_count <> jsonb_array_length(p_assignments)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_assignments) AS item(value)
      WHERE item.value->>'isNew' = 'true') THEN
    RETURN public.edit_studio_appointment_structure_unpaid(
      p_studio_id,p_appointment_id,p_starts_at,p_assignments,p_total_price,p_notes);
  END IF;
  IF v_count = 0 OR v_count <> jsonb_array_length(p_assignments) OR v_count > 20$insert$;
BEGIN
  SELECT definition INTO STRICT v_original FROM public.agenda_role_parity_function_backup_20261029
    WHERE signature=v_signature;
  v_expected := regexp_replace(v_original,
    $pattern$public\.can_use_studio\([[:space:]]*(auth\.uid\(\)|p_actor_id)[[:space:]]*,[[:space:]]*p_studio_id[[:space:]]*\)$pattern$,
    $replacement$(public.can_use_studio(\1, p_studio_id) OR public.can_use_agenda_desk(\1, p_studio_id))$replacement$,'i');
  v_current := pg_get_functiondef(to_regprocedure(v_signature));
  IF v_current IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'agenda_structural_edit_source_drift';
  END IF;
  IF length(v_current)-length(replace(v_current,v_marker,'')) <> length(v_marker) THEN
    RAISE EXCEPTION 'agenda_structural_edit_marker_changed';
  END IF;
  INSERT INTO public.agenda_structural_edit_backup_20261030(signature,definition)
    VALUES (v_signature,v_current);
  EXECUTE replace(v_current,v_marker,v_insert);
  UPDATE public.agenda_structural_edit_backup_20261030
    SET installed_md5=md5(pg_get_functiondef(to_regprocedure(v_signature)))
    WHERE signature=v_signature;
END
$install$;
COMMIT;
