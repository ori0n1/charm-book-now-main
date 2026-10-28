-- Owner-only, atomic correction of an already resolved appointment. The published
-- edit_studio_appointment remains untouched for confirmed appointments.
CREATE OR REPLACE FUNCTION public.edit_owner_resolved_appointment(p_studio_id uuid, p_appointment_id uuid, p_expected_status text, p_starts_at timestamp with time zone, p_assignments jsonb, p_total_price numeric, p_notes text, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_appt public.appointments%ROWTYPE;
  v_line public.appointment_services%ROWTYPE;
  v_service public.services%ROWTYPE;
  v_item jsonb; v_lines jsonb := '[]'::jsonb; v_before_lines jsonb; v_previous_line jsonb;
  v_staff uuid; v_duration integer; v_catalog_duration integer; v_delta integer := 0;
  v_cursor timestamptz; v_start timestamptz; v_end timestamptz;
  v_preview jsonb; v_schedule_changed boolean := false;
  v_explicit boolean; v_price numeric; v_allocated numeric := 0;
  v_weight numeric := 0; v_index integer := 0; v_count integer;
  v_old_override text := COALESCE(current_setting('bellza.allow_manual_overlap', true), 'off');
  v_attendance_at timestamptz; v_attendance_by uuid;
  v_receipts_before numeric; v_receipts_after numeric;
  v_payment_rows_before jsonb; v_cash_rows_before jsonb;
  v_payment_rows_after jsonb; v_cash_rows_after jsonb;
  v_after public.appointments%ROWTYPE;
  v_after_lines jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles
    WHERE user_id=p_actor_id AND studio_id=p_studio_id
      AND role IN ('studio_owner','saas_owner')) THEN
    RAISE EXCEPTION 'studio_owner_required';
  END IF;
  SELECT * INTO v_appt FROM public.appointments
    WHERE id = p_appointment_id AND studio_id = p_studio_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'appointment_not_found'; END IF;
  IF p_expected_status NOT IN ('confirmed','completed','no_show') OR v_appt.status::text <> p_expected_status THEN
    RAISE EXCEPTION 'appointment_changed_reload';
  END IF;
  IF p_starts_at IS NULL OR p_total_price IS NULL OR p_total_price < 0
     OR p_total_price > 99999999.99 OR p_total_price <> round(p_total_price,2)
     OR p_total_price::text IN ('NaN','Infinity','-Infinity')
     OR length(coalesce(p_notes,'')) > 5000 THEN RAISE EXCEPTION 'invalid_appointment_value'; END IF;
  v_attendance_at := v_appt.attendance_resolved_at;
  v_attendance_by := v_appt.attendance_resolved_by;
  SELECT COALESCE((SELECT sum(amount_cents)::numeric FROM public.payment_intents
      WHERE appointment_id=v_appt.id AND status='succeeded'),0)
       + COALESCE((SELECT sum(round(amount*100)) FROM public.cash_register_movements
      WHERE appointment_id=v_appt.id AND movement_type='service_payment'),0)
    INTO v_receipts_before;
  SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]'::jsonb)
    INTO v_payment_rows_before FROM public.payment_intents p WHERE appointment_id=v_appt.id;
  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.id),'[]'::jsonb)
    INTO v_cash_rows_before FROM public.cash_register_movements m WHERE appointment_id=v_appt.id;
  -- Existing receipts are immutable here. A lower value requires the established
  -- refund/receipt-correction flow before editing this appointment.
  IF p_total_price*100 < v_receipts_before THEN RAISE EXCEPTION 'price_below_recorded_receipts'; END IF;
  IF p_assignments IS NULL OR jsonb_typeof(p_assignments) <> 'array' THEN RAISE EXCEPTION 'services_required'; END IF;
  -- A receipt locks service, professional and price at the database boundary.
  -- Schedule, individual duration and notes remain editable on the same row.
  IF v_receipts_before > 0 THEN
    IF p_total_price IS DISTINCT FROM v_appt.total_price OR
       (SELECT count(*) FROM public.appointment_services WHERE appointment_id=v_appt.id)
         <> jsonb_array_length(p_assignments) OR
       EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_assignments) AS item(value)
         LEFT JOIN public.appointment_services line
           ON line.id=(item.value->>'lineId')::uuid AND line.appointment_id=v_appt.id
         WHERE line.id IS NULL
           OR (item.value->>'serviceId')::uuid IS DISTINCT FROM line.service_id
           OR (item.value->>'staffId')::uuid IS DISTINCT FROM COALESCE(line.staff_id,v_appt.staff_id)
       ) THEN
      RAISE EXCEPTION 'received_reservation_financial_fields_locked';
    END IF;
    IF jsonb_array_length(p_assignments)=1 THEN
      SELECT * INTO v_line FROM public.appointment_services WHERE appointment_id=v_appt.id FOR UPDATE;
      v_item := p_assignments->0;
    END IF;
    IF jsonb_array_length(p_assignments)=1 AND p_expected_status IN ('completed','no_show')
       AND COALESCE((v_item->>'durationMin')::integer,
         round(EXTRACT(EPOCH FROM (v_appt.ends_at-v_appt.starts_at))/60)::integer)
         <= greatest((SELECT duration_min FROM public.services WHERE id=v_line.service_id),v_line.duration_min) THEN
      RETURN public.edit_resolved_appointment_schedule(p_studio_id,p_appointment_id,
        p_expected_status,p_starts_at,
        COALESCE((v_item->>'durationMin')::integer,
          round(EXTRACT(EPOCH FROM (v_appt.ends_at-v_appt.starts_at))/60)::integer),
        p_notes,p_actor_id);
    END IF;
  END IF;
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
         OR (v_item->>'durationMin')::numeric > 720 THEN
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
    IF (v_lines->0->>'staffId')::uuid IS DISTINCT FROM v_appt.staff_id THEN
      UPDATE public.appointments SET staff_id=(v_lines->0->>'staffId')::uuid, starts_at=p_starts_at,
        ends_at=v_appt.ends_at+(p_starts_at-v_appt.starts_at)+make_interval(mins=>v_delta),
        total_duration_min=COALESCE(v_appt.total_duration_min,round(EXTRACT(EPOCH FROM(v_appt.ends_at-v_appt.starts_at))/60)::integer)+v_delta,
        updated_at=now() WHERE id=v_appt.id;
    ELSE
      UPDATE public.appointments SET starts_at=p_starts_at,
        ends_at=v_appt.ends_at+(p_starts_at-v_appt.starts_at)+make_interval(mins=>v_delta),
        total_duration_min=COALESCE(v_appt.total_duration_min,round(EXTRACT(EPOCH FROM(v_appt.ends_at-v_appt.starts_at))/60)::integer)+v_delta,
        updated_at=now() WHERE id=v_appt.id;
    END IF;
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
      -- UPDATE OF service_id fires the snapshot trigger even for an identical ID.
      -- Keep every published snapshot when a paid service is unchanged.
      IF v_receipts_before > 0 THEN
        SELECT previous.value INTO v_previous_line FROM jsonb_array_elements(v_before_lines) AS previous(value)
          WHERE previous.value->>'id'=v_item->>'id';
        UPDATE public.appointment_services s SET
          professional_commission_percent_snapshot=(v_previous_line->>'professional_commission_percent_snapshot')::numeric,
          studio_commission_percent_snapshot=(v_previous_line->>'studio_commission_percent_snapshot')::numeric
          WHERE s.id=(v_item->>'id')::uuid;
      END IF;
    ELSIF p_total_price IS DISTINCT FROM v_appt.total_price THEN
      UPDATE public.appointment_services SET price=v_price WHERE id=(v_item->>'id')::uuid AND appointment_id=v_appt.id;
    END IF;
  END LOOP;
  UPDATE public.appointments SET total_price=p_total_price,notes=p_notes,updated_at=now() WHERE id=v_appt.id;
  IF v_schedule_changed THEN
    INSERT INTO public.appointment_schedule_events(studio_id,appointment_id,actor_id,operation,previous_state,next_state)
      SELECT p_studio_id,v_appt.id,p_actor_id,CASE WHEN p_starts_at<>v_appt.starts_at THEN 'move' ELSE 'duration' END,
        jsonb_build_object('startsAt',v_appt.starts_at,'endsAt',v_appt.ends_at,'staffId',v_appt.staff_id,'services',v_before_lines),
        jsonb_build_object('startsAt',a.starts_at,'endsAt',a.ends_at,'staffId',a.staff_id,'services',v_lines)
      FROM public.appointments a WHERE a.id=v_appt.id;
  END IF;
  -- The published lifecycle trigger clears attendance on a schedule change.
  -- Restore it without touching status, receipts or settlement history.
  UPDATE public.appointments SET attendance_resolved_at=v_attendance_at,
    attendance_resolved_by=v_attendance_by WHERE id=v_appt.id;
  SELECT * INTO v_after FROM public.appointments WHERE id=v_appt.id;
  SELECT jsonb_agg(to_jsonb(s) ORDER BY position NULLS LAST,id) INTO v_after_lines
    FROM public.appointment_services s WHERE appointment_id=v_appt.id;
  SELECT COALESCE((SELECT sum(amount_cents)::numeric FROM public.payment_intents
      WHERE appointment_id=v_appt.id AND status='succeeded'),0)
       + COALESCE((SELECT sum(round(amount*100)) FROM public.cash_register_movements
      WHERE appointment_id=v_appt.id AND movement_type='service_payment'),0)
    INTO v_receipts_after;
  SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]'::jsonb)
    INTO v_payment_rows_after FROM public.payment_intents p WHERE appointment_id=v_appt.id;
  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.id),'[]'::jsonb)
    INTO v_cash_rows_after FROM public.cash_register_movements m WHERE appointment_id=v_appt.id;
  IF v_after.status IS DISTINCT FROM v_appt.status
     OR v_after.attendance_resolved_at IS DISTINCT FROM v_attendance_at
     OR v_after.attendance_resolved_by IS DISTINCT FROM v_attendance_by
     OR v_receipts_after IS DISTINCT FROM v_receipts_before
     OR v_payment_rows_after IS DISTINCT FROM v_payment_rows_before
     OR v_cash_rows_after IS DISTINCT FROM v_cash_rows_before THEN
    RAISE EXCEPTION 'resolved_edit_integrity_failed';
  END IF;
  INSERT INTO public.financial_audit_logs
    (studio_id,actor_user_id,entity_type,entity_id,action,amount_cents,metadata)
  VALUES (p_studio_id,p_actor_id,'appointment',v_appt.id,
    'resolved_appointment_reservation_edited',0,
    jsonb_build_object('before',jsonb_build_object('status',v_appt.status,
      'startsAt',v_appt.starts_at,'endsAt',v_appt.ends_at,'totalPrice',v_appt.total_price,
      'commissionSnapshot',v_appt.studio_commission_percent_snapshot,'services',v_before_lines),
      'after',jsonb_build_object('status',v_after.status,'startsAt',v_after.starts_at,
      'endsAt',v_after.ends_at,'totalPrice',v_after.total_price,
      'commissionSnapshot',v_after.studio_commission_percent_snapshot,'services',v_after_lines),
      'recordedReceiptCents',v_receipts_before,
      'receiptTransactionCount',jsonb_array_length(v_payment_rows_before)+jsonb_array_length(v_cash_rows_before),
      'changedAt',now()));
  RETURN jsonb_build_object('appointmentId',v_appt.id,'status',v_after.status,
    'updated',true,'recordedReceiptCents',v_receipts_before);
END
$function$;

REVOKE ALL ON FUNCTION public.edit_owner_resolved_appointment(uuid,uuid,text,timestamptz,jsonb,numeric,text,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.edit_owner_resolved_appointment(uuid,uuid,text,timestamptz,jsonb,numeric,text,uuid)
  TO service_role;

