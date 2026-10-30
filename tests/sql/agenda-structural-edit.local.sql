\set ON_ERROR_STOP on
BEGIN;
DO $test$
DECLARE
  v_studio uuid := '11111111-1111-4111-8111-111111111111';
  v_client uuid := '55555555-5555-4555-8555-000000000001';
  v_service_a uuid := '44444444-4444-4444-8444-000000000001';
  v_service_b uuid := '44444444-4444-4444-8444-000000000002';
  v_service_c uuid := '44444444-4444-4444-8444-000000000003';
  v_staff_a uuid := '33333333-3333-4333-8333-000000000001';
  v_staff_b uuid := '33333333-3333-4333-8333-000000000002';
  v_actor uuid;
  v_result jsonb;
  v_appt uuid;
  v_line_a uuid;
  v_line_b uuid;
  v_line_c uuid;
  v_start timestamptz;
  v_count integer;
  v_total numeric;
  v_blocked boolean;
  v_index integer;
BEGIN
  INSERT INTO public.services(id,studio_id,name,duration_min,price)
    VALUES (v_service_c,v_studio,'Serviço C sintético',30,20);
  INSERT INTO public.staff_services(staff_id,service_id) VALUES (v_staff_a,v_service_c);
  FOR v_index IN 1..4 LOOP
    v_actor := ('22222222-2222-4222-8222-' || lpad(v_index::text,12,'0'))::uuid;
    v_start := '2030-10-30 13:30+00'::timestamptz + make_interval(days=>(v_index-1)*7);
    PERFORM set_config('request.jwt.claim.role','authenticated',true);
    PERFORM set_config('request.jwt.claim.sub',v_actor::text,true);
    v_result := public.create_manual_multi_professional_appointment(v_studio,
      jsonb_build_array(jsonb_build_object('serviceId',v_service_a,'staffId',v_staff_a)),
      v_start,v_client,NULL,NULL,'edição estrutural sintética');
    v_appt := (v_result->>'appointment_id')::uuid;
    SELECT id INTO v_line_a FROM public.appointment_services WHERE appointment_id=v_appt;
    v_line_b := gen_random_uuid();
    PERFORM public.edit_studio_appointment(v_studio,v_appt,v_start,
      jsonb_build_array(
        jsonb_build_object('lineId',v_line_a,'serviceId',v_service_a,'staffId',v_staff_a,'durationMin',90),
        jsonb_build_object('lineId',v_line_b,'serviceId',v_service_b,'staffId',v_staff_b,'isNew',true)),
      68,'dois serviços');
    SELECT count(*),sum(price) INTO v_count,v_total
      FROM public.appointment_services WHERE appointment_id=v_appt;
    IF v_count<>2 OR v_total<>68 OR
      (SELECT ends_at FROM public.appointment_services WHERE id=v_line_a) <>
      (SELECT starts_at FROM public.appointment_services WHERE id=v_line_b) THEN
      RAISE EXCEPTION 'add_service_failed_for_role_%',v_index;
    END IF;
    PERFORM public.edit_studio_appointment(v_studio,v_appt,v_start,
      jsonb_build_array(jsonb_build_object('lineId',v_line_b,'serviceId',v_service_b,
        'staffId',v_staff_b,'durationMin',90)),40,'um serviço restante');
    SELECT count(*),sum(price) INTO v_count,v_total
      FROM public.appointment_services WHERE appointment_id=v_appt;
    IF v_count<>1 OR v_total<>40 OR
      (SELECT staff_id FROM public.appointments WHERE id=v_appt)<>v_staff_b THEN
      RAISE EXCEPTION 'remove_service_failed_for_role_%',v_index;
    END IF;
    PERFORM public.edit_studio_appointment(v_studio,v_appt,v_start,
      jsonb_build_array(jsonb_build_object('lineId',v_line_b,'serviceId',v_service_a,
        'staffId',v_staff_a,'durationMin',90)),28,'serviço e profissional alterados');
    IF (SELECT service_id FROM public.appointment_services WHERE id=v_line_b)<>v_service_a OR
      (SELECT staff_id FROM public.appointment_services WHERE id=v_line_b)<>v_staff_a THEN
      RAISE EXCEPTION 'replace_service_failed_for_role_%',v_index;
    END IF;

    -- The existing payment boundary must refuse a structural change.
    INSERT INTO public.payment_intents(studio_id,appointment_id,amount_cents,status,method)
      VALUES (v_studio,v_appt,2800,'succeeded','card');
    v_blocked := false;
    BEGIN
      PERFORM public.edit_studio_appointment(v_studio,v_appt,v_start,
        jsonb_build_array(
          jsonb_build_object('lineId',v_line_b,'serviceId',v_service_a,'staffId',v_staff_a),
          jsonb_build_object('lineId',gen_random_uuid(),'serviceId',v_service_b,
            'staffId',v_staff_b,'isNew',true)),68,'deve bloquear');
    EXCEPTION WHEN OTHERS THEN
      v_blocked := SQLERRM='received_reservation_financial_fields_locked';
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'paid_structure_was_editable_for_role_%',v_index; END IF;
    IF (SELECT count(*) FROM public.appointment_services WHERE appointment_id=v_appt)<>1 THEN
      RAISE EXCEPTION 'paid_structure_changed_for_role_%',v_index;
    END IF;
  END LOOP;

  -- An existing confirmed service-level joint booking may gain one more service.
  PERFORM set_config('request.jwt.claim.sub','22222222-2222-4222-8222-000000000001',true);
  v_result := public.create_manual_multi_professional_appointment(v_studio,
    jsonb_build_array(
      jsonb_build_object('serviceId',v_service_a,'staffId',v_staff_a),
      jsonb_build_object('serviceId',v_service_b,'staffId',v_staff_b)),
    '2031-01-02 13:30+00',v_client,NULL,NULL,'conjunto de estados sintético');
  v_appt := (v_result->>'appointment_id')::uuid;
  UPDATE public.appointment_services SET service_state='confirmed' WHERE appointment_id=v_appt;
  SELECT id INTO v_line_a FROM public.appointment_services
    WHERE appointment_id=v_appt AND service_id=v_service_a;
  SELECT id INTO v_line_b FROM public.appointment_services
    WHERE appointment_id=v_appt AND service_id=v_service_b;
  v_line_c := gen_random_uuid();
  PERFORM public.edit_studio_appointment(v_studio,v_appt,'2031-01-02 13:30+00',
    jsonb_build_array(
      jsonb_build_object('lineId',v_line_a,'serviceId',v_service_a,'staffId',v_staff_a),
      jsonb_build_object('lineId',v_line_b,'serviceId',v_service_b,'staffId',v_staff_b),
      jsonb_build_object('lineId',v_line_c,'serviceId',v_service_c,'staffId',v_staff_a,'isNew',true)),
    88,'três serviços');
  IF (SELECT count(*) FROM public.appointment_services WHERE appointment_id=v_appt)<>3 OR
    (SELECT service_state FROM public.appointment_services WHERE id=v_line_c)<>'confirmed' THEN
    RAISE EXCEPTION 'stateful_joint_add_failed';
  END IF;
END
$test$;
ROLLBACK;
