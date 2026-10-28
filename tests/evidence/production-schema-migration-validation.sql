\set ON_ERROR_STOP on
-- Run only against codex_appt_schema_validation_20261028, the disposable schema-only clone.
BEGIN;
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);

INSERT INTO auth.users(id) VALUES ('22222222-2222-4222-8222-222222222222');
INSERT INTO public.studios(id,slug,name,plan_tier)
VALUES ('11111111-1111-4111-8111-111111111111','synthetic-schema-validation','Synthetic Schema Validation','premium');
INSERT INTO public.user_roles(user_id,studio_id,role)
VALUES ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','studio_owner');
INSERT INTO public.staff(id,studio_id,name)
VALUES ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','Synthetic Staff');
INSERT INTO public.services(id,studio_id,name,duration_min,price)
VALUES ('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','Synthetic Service',90,50);
INSERT INTO public.staff_services(staff_id,service_id)
VALUES ('33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444');
INSERT INTO public.appointments
  (id,studio_id,staff_id,starts_at,ends_at,total_duration_min,status,total_price,
   is_manual_fit,cancellation_reason,cancelled_at,cancelled_by)
VALUES
  ('55555555-5555-4555-8555-555555555555','11111111-1111-4111-8111-111111111111',
   '33333333-3333-4333-8333-333333333333','2030-10-29 10:00+00','2030-10-29 11:00+00',60,'completed',50,true,NULL,NULL,NULL),
  ('66666666-6666-4666-8666-666666666666','11111111-1111-4111-8111-111111111111',
   '33333333-3333-4333-8333-333333333333','2030-10-30 10:00+00','2030-10-30 11:00+00',60,'no_show',50,true,NULL,NULL,NULL),
  ('77777777-7777-4777-8777-777777777777','11111111-1111-4111-8111-111111111111',
   '33333333-3333-4333-8333-333333333333','2030-10-31 10:00+00','2030-10-31 11:00+00',60,'cancelled',50,true,'Motivo sintético','2030-10-28 10:00+00','22222222-2222-4222-8222-222222222222');
INSERT INTO public.appointment_services
  (appointment_id,service_id,staff_id,starts_at,ends_at,position,duration_min,price)
VALUES
  ('55555555-5555-4555-8555-555555555555','44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333','2030-10-29 10:00+00','2030-10-29 11:00+00',0,60,50),
  ('66666666-6666-4666-8666-666666666666','44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333','2030-10-30 10:00+00','2030-10-30 11:00+00',0,60,50),
  ('77777777-7777-4777-8777-777777777777','44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333','2030-10-31 10:00+00','2030-10-31 11:00+00',0,60,50);
UPDATE public.appointments SET attendance_resolved_at='2030-10-28 10:00+00',
  attendance_resolved_by='22222222-2222-4222-8222-222222222222'
WHERE id IN ('55555555-5555-4555-8555-555555555555','66666666-6666-4666-8666-666666666666');
INSERT INTO public.cash_register_sessions(id,studio_id)
VALUES ('88888888-8888-4888-8888-888888888888','11111111-1111-4111-8111-111111111111');
INSERT INTO public.cash_register_movements
  (session_id,studio_id,appointment_id,movement_type,payment_method,amount,description)
VALUES
  ('88888888-8888-4888-8888-888888888888','11111111-1111-4111-8111-111111111111','55555555-5555-4555-8555-555555555555','service_payment','cash',50,'Synthetic completed'),
  ('88888888-8888-4888-8888-888888888888','11111111-1111-4111-8111-111111111111','66666666-6666-4666-8666-666666666666','service_payment','card',50,'Synthetic no-show'),
  ('88888888-8888-4888-8888-888888888888','11111111-1111-4111-8111-111111111111','77777777-7777-4777-8777-777777777777','service_payment','cash',50,'Synthetic cancelled');

DO $$
DECLARE
  v_studio uuid := '11111111-1111-4111-8111-111111111111';
  v_actor uuid := '22222222-2222-4222-8222-222222222222';
  v_completed uuid := '55555555-5555-4555-8555-555555555555';
  v_no_show uuid := '66666666-6666-4666-8666-666666666666';
  v_cancelled uuid := '77777777-7777-4777-8777-777777777777';
  v_result jsonb;
  v_appointment_snapshots jsonb;
  v_service_snapshots jsonb;
  v_cancelled_line uuid;
BEGIN
  SELECT jsonb_object_agg(id,studio_commission_percent_snapshot) INTO v_appointment_snapshots
  FROM public.appointments WHERE id IN (v_completed,v_no_show,v_cancelled);
  SELECT jsonb_object_agg(appointment_id,studio_commission_percent_snapshot) INTO v_service_snapshots
  FROM public.appointment_services WHERE appointment_id IN (v_completed,v_no_show,v_cancelled);
  v_result := public.edit_resolved_appointment_schedule(v_studio,v_completed,'completed',
    '2030-10-29 12:00+00',45,'Synthetic completed edit',v_actor);
  IF v_result->>'appointmentId' <> v_completed::text OR v_result->>'status' <> 'completed' THEN
    RAISE EXCEPTION 'completed appointment identity or state changed';
  END IF;
  v_result := public.edit_resolved_appointment_schedule(v_studio,v_no_show,'no_show',
    '2030-10-30 12:00+00',40,'Synthetic no-show edit',v_actor);
  IF v_result->>'appointmentId' <> v_no_show::text OR v_result->>'status' <> 'no_show' THEN
    RAISE EXCEPTION 'no-show appointment identity or state changed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.appointments WHERE id IN (v_completed,v_no_show)
      AND (total_price<>50 OR attendance_resolved_at<>'2030-10-28 10:00+00'::timestamptz
           OR attendance_resolved_by<>v_actor)) THEN
    RAISE EXCEPTION 'attendance or appointment finance changed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.appointment_services WHERE appointment_id IN (v_completed,v_no_show)
      AND (price<>50 OR service_id<>'44444444-4444-4444-8444-444444444444'::uuid
           OR staff_id<>'33333333-3333-4333-8333-333333333333'::uuid)) THEN
    RAISE EXCEPTION 'service or finance changed';
  END IF;
  IF v_appointment_snapshots IS DISTINCT FROM
      (SELECT jsonb_object_agg(id,studio_commission_percent_snapshot) FROM public.appointments
       WHERE id IN (v_completed,v_no_show,v_cancelled))
     OR v_service_snapshots IS DISTINCT FROM
      (SELECT jsonb_object_agg(appointment_id,studio_commission_percent_snapshot)
       FROM public.appointment_services WHERE appointment_id IN (v_completed,v_no_show,v_cancelled)) THEN
    RAISE EXCEPTION 'commission snapshot changed';
  END IF;
  IF (SELECT count(*) FROM public.cash_register_movements)<>3
     OR (SELECT sum(amount) FROM public.cash_register_movements)<>150 THEN
    RAISE EXCEPTION 'receipt changed';
  END IF;
  PERFORM public.correct_owner_appointment_action(v_studio,v_cancelled,'confirmed',v_actor,NULL);
  SELECT id INTO v_cancelled_line FROM public.appointment_services WHERE appointment_id=v_cancelled;
  v_result := public.edit_studio_appointment(v_studio,v_cancelled,'2030-10-31 12:00+00',
    jsonb_build_array(jsonb_build_object('lineId',v_cancelled_line,
      'serviceId','44444444-4444-4444-8444-444444444444',
      'staffId','33333333-3333-4333-8333-333333333333','durationMin',45)),
    50,'Synthetic reopened edit');
  IF NOT EXISTS (SELECT 1 FROM public.appointments WHERE id=v_cancelled AND status='confirmed'
      AND cancelled_at='2030-10-28 10:00+00'::timestamptz AND cancelled_by=v_actor
      AND cancellation_reason='Motivo sintético' AND starts_at='2030-10-31 12:00+00'::timestamptz) THEN
    RAISE EXCEPTION 'cancelled appointment reopen identity/history changed';
  END IF;
  IF (SELECT count(*) FROM public.appointments)<>3
     OR (SELECT count(*) FROM public.cash_register_movements WHERE appointment_id=v_cancelled AND amount=50)<>1
     OR (SELECT count(*) FROM public.financial_audit_logs WHERE entity_id=v_cancelled AND action='appointment_action_corrected')<>1 THEN
    RAISE EXCEPTION 'reopen duplicated appointment or altered finance/history';
  END IF;
  IF v_appointment_snapshots IS DISTINCT FROM
      (SELECT jsonb_object_agg(id,studio_commission_percent_snapshot) FROM public.appointments
       WHERE id IN (v_completed,v_no_show,v_cancelled))
     OR v_service_snapshots IS DISTINCT FROM
      (SELECT jsonb_object_agg(appointment_id,studio_commission_percent_snapshot)
       FROM public.appointment_services WHERE appointment_id IN (v_completed,v_no_show,v_cancelled))
     OR (SELECT count(*) FROM public.appointment_services WHERE appointment_id=v_cancelled AND id=v_cancelled_line)<>1
     OR (SELECT count(*) FROM public.cash_register_movements)<>3
     OR (SELECT sum(amount) FROM public.cash_register_movements)<>150 THEN
    RAISE EXCEPTION 'reopened edit changed financial snapshot, receipt, or service line';
  END IF;
  RAISE NOTICE 'production-schema synthetic completed/no-show/cancelled: OK';
END $$;
ROLLBACK;
