\set ON_ERROR_STOP on
BEGIN;
DO $test$
DECLARE
  v_index integer;
  v_studio uuid := '11111111-1111-4111-8111-111111111111';
  v_other uuid := '99999999-9999-4999-8999-999999999999';
  v_client uuid := '55555555-5555-4555-8555-000000000001';
  v_actor uuid;
  v_role text;
  v_start timestamptz;
  v_simple uuid;
  v_joint uuid;
  v_public_joint uuid;
  v_result jsonb;
  v_assignments jsonb;
  v_lines uuid[];
  v_status text;
  v_count integer;
  v_total numeric;
BEGIN
  INSERT INTO public.cash_register_sessions(studio_id) VALUES (v_studio);
  FOR v_index IN 1..4 LOOP
    v_actor := ('22222222-2222-4222-8222-' || lpad(v_index::text,12,'0'))::uuid;
    v_role := (ARRAY['studio_owner','manager','staff','desk_staff'])[v_index];
    v_start := '2030-10-30 09:00+00'::timestamptz + make_interval(days => (v_index - 1) * 7);
    PERFORM set_config('request.jwt.claim.role','authenticated',true);
    PERFORM set_config('request.jwt.claim.sub',v_actor::text,true);

    v_result := public.create_manual_multi_professional_appointment(v_studio,
      jsonb_build_array(jsonb_build_object('serviceId','44444444-4444-4444-8444-000000000001',
        'staffId','33333333-3333-4333-8333-000000000001')),
      v_start,v_client,NULL,NULL,'simples ' || v_role);
    v_simple := (v_result->>'appointment_id')::uuid;
    IF (v_result->>'service_count')::integer <> 1 OR (v_result->>'total_price')::numeric <> 28 THEN
      RAISE EXCEPTION 'simple_create_failed: %', v_role;
    END IF;
    SELECT jsonb_agg(jsonb_build_object('lineId',id,'serviceId',service_id,
      'staffId',staff_id,'durationMin',duration_min)) INTO v_assignments
      FROM public.appointment_services WHERE appointment_id=v_simple;
    PERFORM public.edit_studio_appointment(v_studio,v_simple,v_start + interval '30 minutes',
      v_assignments,28,'simples editada ' || v_role);
    SELECT starts_at INTO v_start FROM public.appointments WHERE id=v_simple;
    IF v_start IS NULL THEN RAISE EXCEPTION 'simple_edit_failed: %', v_role; END IF;

    v_start := '2030-10-30 13:30+00'::timestamptz + make_interval(days => (v_index - 1) * 7);
    v_result := public.create_manual_multi_professional_appointment(v_studio,
      jsonb_build_array(
        jsonb_build_object('serviceId','44444444-4444-4444-8444-000000000001',
          'staffId','33333333-3333-4333-8333-000000000001'),
        jsonb_build_object('serviceId','44444444-4444-4444-8444-000000000002',
          'staffId','33333333-3333-4333-8333-000000000002')),
      v_start,v_client,NULL,NULL,'conjunta ' || v_role);
    v_joint := (v_result->>'appointment_id')::uuid;
    IF (v_result->>'service_count')::integer <> 2 OR
       (v_result->>'total_price')::numeric <> 68 OR
       (v_result->>'total_duration_min')::integer <> 180 THEN
      RAISE EXCEPTION 'joint_create_failed: %', v_role;
    END IF;
    SELECT count(*),sum(price),array_agg(id ORDER BY position),
      jsonb_agg(jsonb_build_object('lineId',id,'serviceId',service_id,
        'staffId',staff_id,'durationMin',duration_min) ORDER BY position)
      INTO v_count,v_total,v_lines,v_assignments
      FROM public.appointment_services WHERE appointment_id=v_joint;
    IF v_count <> 2 OR v_total <> 68 THEN RAISE EXCEPTION 'joint_lines_failed: %', v_role; END IF;
    PERFORM public.edit_studio_appointment(v_studio,v_joint,v_start + interval '30 minutes',
      v_assignments,68,'conjunta editada ' || v_role);
    IF (SELECT starts_at FROM public.appointment_services WHERE id=v_lines[2]) <>
       (SELECT ends_at FROM public.appointment_services WHERE id=v_lines[1]) THEN
      RAISE EXCEPTION 'joint_sequence_failed: %', v_role;
    END IF;

    v_result := public.create_manual_multi_professional_appointment(v_studio,
      jsonb_build_array(
        jsonb_build_object('serviceId','44444444-4444-4444-8444-000000000001',
          'staffId','33333333-3333-4333-8333-000000000001'),
        jsonb_build_object('serviceId','44444444-4444-4444-8444-000000000002',
          'staffId','33333333-3333-4333-8333-000000000002')),
      v_start + interval '1 day',v_client,NULL,NULL,'conjunta por serviço ' || v_role);
    v_public_joint := (v_result->>'appointment_id')::uuid;
    UPDATE public.appointment_services SET service_state='confirmed'
      WHERE appointment_id=v_public_joint;
    SELECT array_agg(id ORDER BY position) INTO v_lines
      FROM public.appointment_services WHERE appointment_id=v_public_joint;

    PERFORM set_config('request.jwt.claim.role','service_role',true);
    PERFORM public.resolve_appointment_attendance_batch(ARRAY[v_simple],v_studio,'no_show',v_actor);
    IF (SELECT status::text FROM public.appointments WHERE id=v_simple) <> 'no_show' THEN
      RAISE EXCEPTION 'simple_no_show_failed: %', v_role;
    END IF;
    PERFORM public.correct_owner_appointment_action(v_studio,v_simple,'cancelled',v_actor,'Correção sintética');
    PERFORM public.correct_owner_appointment_action(v_studio,v_simple,'confirmed',v_actor,NULL);
    SELECT status::text INTO v_status FROM public.appointments WHERE id=v_simple;
    IF v_status <> 'confirmed' THEN RAISE EXCEPTION 'reopen_failed: %', v_role; END IF;

    PERFORM public.resolve_appointment_attendance_batch(ARRAY[v_joint],v_studio,'completed',v_actor);
    IF (SELECT status::text FROM public.appointments WHERE id=v_joint) <> 'completed' THEN
      RAISE EXCEPTION 'manual_joint_attendance_failed: %', v_role;
    END IF;
    PERFORM public.resolve_joint_service_state(v_studio,v_lines[1],'completed',v_actor);
    PERFORM public.resolve_joint_service_state(v_studio,v_lines[2],'no_show',v_actor);
    IF (SELECT count(*) FROM public.appointment_services
      WHERE appointment_id=v_public_joint AND service_state IN ('completed','no_show')) <> 2 THEN
      RAISE EXCEPTION 'service_level_buttons_failed: %', v_role;
    END IF;
  END LOOP;

  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub','22222222-2222-4222-8222-000000000009',true);
  BEGIN
    PERFORM public.create_manual_multi_professional_appointment(v_studio,
      jsonb_build_array(jsonb_build_object('serviceId','44444444-4444-4444-8444-000000000001',
        'staffId','33333333-3333-4333-8333-000000000001')),
      '2031-01-01 09:00+00',v_client,NULL,NULL,'forbidden');
    RAISE EXCEPTION 'cross_studio_create_allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'not_authorized' THEN RAISE; END IF;
  END;
END
$test$;
ROLLBACK;
