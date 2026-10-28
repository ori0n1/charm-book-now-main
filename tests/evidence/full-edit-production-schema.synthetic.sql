\set ON_ERROR_STOP on
-- Run only against codex_full_edit_schema_20261028, the disposable schema-only clone.
BEGIN;
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);

INSERT INTO auth.users(id) VALUES ('22222222-2222-4222-8222-222222222222');
INSERT INTO public.studios(id,slug,name,plan_tier)
VALUES ('11111111-1111-4111-8111-111111111111','synthetic-schema-validation','Synthetic Schema Validation','premium');
INSERT INTO public.user_roles(user_id,studio_id,role)
VALUES ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','studio_owner');
INSERT INTO public.staff(id,studio_id,name,commission_percent)
VALUES
  ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','Synthetic Staff',25),
  ('99999999-9999-4999-8999-999999999999','11111111-1111-4111-8111-111111111111','Synthetic Alternate Staff',30);
INSERT INTO public.services(id,studio_id,name,duration_min,price,commission_percent)
VALUES
  ('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','Synthetic Service',90,50,20),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','Synthetic Alternate Service',75,70,35);
INSERT INTO public.staff_services(staff_id,service_id)
VALUES
  ('33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444'),
  ('33333333-3333-4333-8333-333333333333','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('99999999-9999-4999-8999-999999999999','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
DELETE FROM public.staff_availability WHERE staff_id IN
  ('33333333-3333-4333-8333-333333333333','99999999-9999-4999-8999-999999999999');
INSERT INTO public.staff_availability(staff_id,studio_id,weekday,start_time,end_time)
SELECT staff_id,'11111111-1111-4111-8111-111111111111'::uuid,days.weekday,'00:00','23:59'
FROM (VALUES ('33333333-3333-4333-8333-333333333333'::uuid),
             ('99999999-9999-4999-8999-999999999999'::uuid)) AS staff(staff_id)
CROSS JOIN generate_series(0,6) AS days(weekday);
INSERT INTO public.appointments
  (id,studio_id,staff_id,starts_at,ends_at,total_duration_min,status,total_price,
   is_manual_fit,cancellation_reason,cancelled_at,cancelled_by)
VALUES
  ('55555555-5555-4555-8555-555555555555','11111111-1111-4111-8111-111111111111',
   '33333333-3333-4333-8333-333333333333','2030-10-29 10:00+00','2030-10-29 11:00+00',60,'completed',50,false,NULL,NULL,NULL),
  ('66666666-6666-4666-8666-666666666666','11111111-1111-4111-8111-111111111111',
   '33333333-3333-4333-8333-333333333333','2030-10-30 10:00+00','2030-10-30 11:00+00',60,'no_show',50,false,NULL,NULL,NULL),
  ('77777777-7777-4777-8777-777777777777','11111111-1111-4111-8111-111111111111',
   '33333333-3333-4333-8333-333333333333','2030-10-31 10:00+00','2030-10-31 11:00+00',60,'cancelled',50,true,'Motivo sintético','2030-10-28 10:00+00','22222222-2222-4222-8222-222222222222'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111',
   '99999999-9999-4999-8999-999999999999','2030-10-29 15:00+00','2030-10-29 16:00+00',60,'confirmed',50,false,NULL,NULL,NULL),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','11111111-1111-4111-8111-111111111111',
   '33333333-3333-4333-8333-333333333333','2030-11-01 10:00+00','2030-11-01 11:00+00',60,'completed',50,false,NULL,NULL,NULL),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','11111111-1111-4111-8111-111111111111',
   '33333333-3333-4333-8333-333333333333','2030-11-02 10:00+00','2030-11-02 11:30+00',90,'completed',80,false,NULL,NULL,NULL),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff','11111111-1111-4111-8111-111111111111',
   '33333333-3333-4333-8333-333333333333','2030-11-03 10:00+00','2030-11-03 11:30+00',90,'completed',80,false,NULL,NULL,NULL);
INSERT INTO public.appointment_services
  (appointment_id,service_id,staff_id,starts_at,ends_at,position,duration_min,price)
VALUES
  ('55555555-5555-4555-8555-555555555555','44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333','2030-10-29 10:00+00','2030-10-29 11:00+00',0,60,50),
  ('66666666-6666-4666-8666-666666666666','44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333','2030-10-30 10:00+00','2030-10-30 11:00+00',0,60,50),
  ('77777777-7777-4777-8777-777777777777','44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333','2030-10-31 10:00+00','2030-10-31 11:00+00',0,60,50),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','99999999-9999-4999-8999-999999999999','2030-10-29 15:00+00','2030-10-29 16:00+00',0,60,50),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333','2030-11-01 10:00+00','2030-11-01 11:00+00',0,60,50),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333','2030-11-02 10:00+00','2030-11-02 11:00+00',0,60,50),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','99999999-9999-4999-8999-999999999999','2030-11-02 11:00+00','2030-11-02 11:30+00',1,30,30),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff','44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333','2030-11-03 10:00+00','2030-11-03 11:00+00',0,60,50),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','99999999-9999-4999-8999-999999999999','2030-11-03 11:00+00','2030-11-03 11:30+00',1,30,30);
UPDATE public.appointment_services SET service_state='completed'
  WHERE appointment_id='ffffffff-ffff-4fff-8fff-ffffffffffff';
UPDATE public.appointment_services SET service_state='no_show'
  WHERE appointment_id='ffffffff-ffff-4fff-8fff-ffffffffffff' AND position=1;
UPDATE public.appointments SET attendance_resolved_at='2030-10-28 10:00+00',
  attendance_resolved_by='22222222-2222-4222-8222-222222222222'
WHERE id IN ('55555555-5555-4555-8555-555555555555','66666666-6666-4666-8666-666666666666',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'ffffffff-ffff-4fff-8fff-ffffffffffff');
INSERT INTO public.cash_register_sessions(id,studio_id)
VALUES ('88888888-8888-4888-8888-888888888888','11111111-1111-4111-8111-111111111111');
INSERT INTO public.cash_register_movements
  (session_id,studio_id,appointment_id,movement_type,payment_method,amount,description)
VALUES
  ('88888888-8888-4888-8888-888888888888','11111111-1111-4111-8111-111111111111','77777777-7777-4777-8777-777777777777','service_payment','cash',50,'Synthetic cancelled'),
  ('88888888-8888-4888-8888-888888888888','11111111-1111-4111-8111-111111111111','dddddddd-dddd-4ddd-8ddd-dddddddddddd','service_payment','cash',50,'Synthetic settled');
INSERT INTO public.payment_intents
  (studio_id,appointment_id,stripe_payment_intent_id,amount_cents,method,status)
VALUES ('11111111-1111-4111-8111-111111111111','66666666-6666-4666-8666-666666666666',
  'pi_synthetic_schema_only_no_charge',5000,'card','succeeded');

DO $$
DECLARE
  v_studio uuid := '11111111-1111-4111-8111-111111111111';
  v_actor uuid := '22222222-2222-4222-8222-222222222222';
  v_completed uuid := '55555555-5555-4555-8555-555555555555';
  v_no_show uuid := '66666666-6666-4666-8666-666666666666';
  v_cancelled uuid := '77777777-7777-4777-8777-777777777777';
  v_other uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  v_settled uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  v_multi uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  v_joint uuid := 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  v_original_service uuid := '44444444-4444-4444-8444-444444444444';
  v_new_service uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_original_staff uuid := '33333333-3333-4333-8333-333333333333';
  v_new_staff uuid := '99999999-9999-4999-8999-999999999999';
  v_result jsonb;
  v_completed_line uuid;
  v_no_show_line uuid;
  v_cancelled_line uuid;
  v_settled_line uuid;
  v_multi_first uuid;
  v_multi_second uuid;
  v_joint_first uuid;
  v_joint_second uuid;
  v_other_before jsonb;
  v_settled_before jsonb;
  v_settled_receipt_before jsonb;
  v_stripe_before jsonb;
  v_blocked boolean := false;
  v_commission_before numeric;
  v_commission_after numeric;
BEGIN
  SELECT id INTO v_completed_line FROM public.appointment_services WHERE appointment_id=v_completed;
  SELECT id INTO v_no_show_line FROM public.appointment_services WHERE appointment_id=v_no_show;
  SELECT id INTO v_settled_line FROM public.appointment_services WHERE appointment_id=v_settled;
  SELECT id INTO v_multi_first FROM public.appointment_services WHERE appointment_id=v_multi AND position=0;
  SELECT id INTO v_multi_second FROM public.appointment_services WHERE appointment_id=v_multi AND position=1;
  SELECT id INTO v_joint_first FROM public.appointment_services WHERE appointment_id=v_joint AND position=0;
  SELECT id INTO v_joint_second FROM public.appointment_services WHERE appointment_id=v_joint AND position=1;
  SELECT to_jsonb(a) INTO v_other_before FROM public.appointments a WHERE id=v_other;
  SELECT to_jsonb(p) INTO v_stripe_before FROM public.payment_intents p WHERE appointment_id=v_no_show;
  SELECT studio_commission_percent_snapshot INTO v_commission_before
    FROM public.appointments WHERE id=v_completed;
  BEGIN
    PERFORM public.edit_owner_resolved_appointment(v_studio,v_settled,'completed',
      '2030-11-01 12:00+00',jsonb_build_array(jsonb_build_object('lineId',v_settled_line,
      'serviceId',v_new_service,'staffId',v_new_staff,'durationMin',120)),40,
      'Should not persist',v_actor);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_blocked := SQLERRM='price_below_recorded_receipts';
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'paid-value guard failed'; END IF;

  v_result := public.edit_owner_resolved_appointment(v_studio,v_completed,'completed',
    '2030-10-29 12:00+00',jsonb_build_array(jsonb_build_object('lineId',v_completed_line,
    'serviceId',v_new_service,'staffId',v_new_staff,'durationMin',120)),70,
    'Synthetic completed edit',v_actor);
  IF v_result->>'appointmentId' <> v_completed::text OR v_result->>'status' <> 'completed' THEN
    RAISE EXCEPTION 'completed appointment identity or state changed';
  END IF;
  SELECT studio_commission_percent_snapshot INTO v_commission_after
    FROM public.appointments WHERE id=v_completed;
  IF v_commission_before<>25 OR v_commission_after<>30 THEN
    RAISE EXCEPTION 'commission reassignment was not captured';
  END IF;
  v_result := public.edit_owner_resolved_appointment(v_studio,v_no_show,'no_show',
    '2030-10-30 12:00+00',jsonb_build_array(jsonb_build_object('lineId',v_no_show_line,
    'serviceId',v_original_service,'staffId',v_original_staff,'durationMin',40)),50,
    'Synthetic paid no-show schedule edit',v_actor);
  IF v_result->>'appointmentId' <> v_no_show::text OR v_result->>'status' <> 'no_show' THEN
    RAISE EXCEPTION 'no-show appointment identity or state changed';
  END IF;
  IF (SELECT to_jsonb(p) FROM public.payment_intents p WHERE appointment_id=v_no_show)
       IS DISTINCT FROM v_stripe_before
     OR (SELECT count(*) FROM public.financial_audit_logs WHERE entity_id=v_no_show
       AND action='resolved_appointment_reservation_edited')<>0 THEN
    RAISE EXCEPTION 'synthetic Stripe receipt or no-show finance changed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.appointments WHERE id IN (v_completed,v_no_show)
      AND (attendance_resolved_at<>'2030-10-28 10:00+00'::timestamptz
           OR attendance_resolved_by<>v_actor)) THEN
    RAISE EXCEPTION 'attendance changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.appointments WHERE id=v_completed AND status='completed'
      AND staff_id=v_new_staff AND total_price=70 AND total_duration_min=120
      AND starts_at='2030-10-29 12:00+00'::timestamptz)
     OR NOT EXISTS (SELECT 1 FROM public.appointment_services WHERE id=v_completed_line
      AND appointment_id=v_completed AND service_id=v_new_service AND staff_id=v_new_staff
      AND duration_min=120 AND price=70)
     OR NOT EXISTS (SELECT 1 FROM public.appointments WHERE id=v_no_show AND status='no_show'
      AND total_price=50 AND total_duration_min=40)
     OR NOT EXISTS (SELECT 1 FROM public.appointment_services WHERE id=v_no_show_line
      AND appointment_id=v_no_show AND duration_min=40 AND price=50) THEN
    RAISE EXCEPTION 'full edit did not keep the same lines, status, price, staff, service or duration';
  END IF;
  IF (SELECT duration_min FROM public.services WHERE id=v_new_service)<>75
     OR (SELECT duration_min FROM public.services WHERE id=v_original_service)<>90
     OR (SELECT to_jsonb(a) FROM public.appointments a WHERE id=v_other) IS DISTINCT FROM v_other_before THEN
    RAISE EXCEPTION 'catalog or another appointment changed';
  END IF;
  v_blocked := false;
  BEGIN
    PERFORM public.edit_owner_resolved_appointment(v_studio,v_completed,'completed',
      '2030-10-29 15:00+00',jsonb_build_array(jsonb_build_object('lineId',v_completed_line,
      'serviceId',v_new_service,'staffId',v_new_staff,'durationMin',60)),70,
      'Conflict should not persist',v_actor);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_blocked := SQLERRM='slot_unavailable';
  END;
  IF NOT v_blocked OR (SELECT starts_at FROM public.appointments WHERE id=v_completed)<>
      '2030-10-29 12:00+00'::timestamptz THEN
    RAISE EXCEPTION 'availability guard or atomicity failed';
  END IF;
  v_blocked := false;
  BEGIN
    PERFORM public.edit_owner_resolved_appointment(v_studio,v_completed,'completed',
      '2030-10-29 12:00+00',jsonb_build_array(jsonb_build_object('lineId',v_completed_line,
      'serviceId',v_original_service,'staffId',v_new_staff,'durationMin',120)),70,
      'Invalid staff-service link',v_actor);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_blocked := SQLERRM='staff_service_unavailable';
  END;
  IF NOT v_blocked OR (SELECT staff_id FROM public.appointments WHERE id=v_completed)<>v_new_staff THEN
    RAISE EXCEPTION 'staff-service validation or atomicity failed';
  END IF;
  IF (SELECT count(*) FROM public.cash_register_movements)<>2
     OR (SELECT sum(amount) FROM public.cash_register_movements)<>100 THEN
    RAISE EXCEPTION 'receipt changed';
  END IF;
  IF (SELECT count(*) FROM public.financial_audit_logs WHERE action='resolved_appointment_reservation_edited')<>1
     OR EXISTS (SELECT 1 FROM public.financial_audit_logs
       WHERE action='resolved_appointment_reservation_edited'
         AND (metadata->'before' IS NULL OR metadata->'after' IS NULL)) THEN
    RAISE EXCEPTION 'financial correction audit missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.financial_audit_logs
      WHERE entity_id=v_completed AND action='resolved_appointment_reservation_edited'
        AND (metadata->'before'->>'commissionSnapshot')::numeric=25
        AND (metadata->'after'->>'commissionSnapshot')::numeric=30
        AND (metadata->'before'->>'totalPrice')::numeric=50
        AND (metadata->'after'->>'totalPrice')::numeric=70
        AND (metadata->>'recordedReceiptCents')::numeric=0) THEN
    RAISE EXCEPTION 'commission or receipt before/after audit is incomplete';
  END IF;
  PERFORM public.correct_owner_appointment_action(v_studio,v_cancelled,'confirmed',v_actor,NULL);
  SELECT id INTO v_cancelled_line FROM public.appointment_services WHERE appointment_id=v_cancelled;
  v_result := public.edit_owner_resolved_appointment(v_studio,v_cancelled,'confirmed','2030-10-31 12:00+00',
    jsonb_build_array(jsonb_build_object('lineId',v_cancelled_line,
      'serviceId',v_original_service,'staffId',v_original_staff,'durationMin',45)),
    50,'Synthetic reopened paid edit',v_actor);
  IF NOT EXISTS (SELECT 1 FROM public.appointments WHERE id=v_cancelled AND status='confirmed'
      AND cancelled_at='2030-10-28 10:00+00'::timestamptz AND cancelled_by=v_actor
      AND cancellation_reason='Motivo sintético' AND starts_at='2030-10-31 12:00+00'::timestamptz) THEN
    RAISE EXCEPTION 'cancelled appointment reopen identity/history changed';
  END IF;
  IF (SELECT count(*) FROM public.appointments)<>7
     OR (SELECT count(*) FROM public.cash_register_movements WHERE appointment_id=v_cancelled AND amount=50)<>1
     OR (SELECT count(*) FROM public.financial_audit_logs WHERE entity_id=v_cancelled AND action='appointment_action_corrected')<>1 THEN
    RAISE EXCEPTION 'reopen duplicated appointment or altered finance/history';
  END IF;
  IF (SELECT count(*) FROM public.appointment_services WHERE appointment_id=v_cancelled AND id=v_cancelled_line)<>1
     OR (SELECT count(*) FROM public.cash_register_movements)<>2
     OR (SELECT sum(amount) FROM public.cash_register_movements)<>100 THEN
    RAISE EXCEPTION 'reopened edit changed receipt or service line';
  END IF;
  -- Two independent service lines, different professionals, no receipts yet:
  -- every selected field may change while both line IDs and the catalog survive.
  v_result := public.edit_owner_resolved_appointment(v_studio,v_multi,'completed',
    '2030-11-02 12:00+00',jsonb_build_array(
      jsonb_build_object('lineId',v_multi_first,'serviceId',v_new_service,
        'staffId',v_original_staff,'durationMin',45),
      jsonb_build_object('lineId',v_multi_second,'serviceId',v_new_service,
        'staffId',v_new_staff,'durationMin',70)),100,'Synthetic multi-service edit',v_actor);
  IF v_result->>'appointmentId'<>v_multi::text OR v_result->>'status'<>'completed'
     OR NOT EXISTS (SELECT 1 FROM public.appointments WHERE id=v_multi AND status='completed'
       AND total_price=100 AND total_duration_min=115
       AND starts_at='2030-11-02 12:00+00'::timestamptz
       AND ends_at='2030-11-02 13:55+00'::timestamptz)
     OR NOT EXISTS (SELECT 1 FROM public.appointment_services WHERE id=v_multi_first
       AND appointment_id=v_multi AND service_id=v_new_service AND staff_id=v_original_staff
       AND duration_min=45 AND price=62.50 AND starts_at='2030-11-02 12:00+00'::timestamptz)
     OR NOT EXISTS (SELECT 1 FROM public.appointment_services WHERE id=v_multi_second
       AND appointment_id=v_multi AND service_id=v_new_service AND staff_id=v_new_staff
       AND duration_min=70 AND price=37.50 AND starts_at='2030-11-02 12:45+00'::timestamptz)
     OR (SELECT count(*) FROM public.appointment_services WHERE appointment_id=v_multi)<>2
     OR (SELECT duration_min FROM public.services WHERE id=v_new_service)<>75 THEN
    RAISE EXCEPTION 'unpaid multi-service full edit changed identity, allocation or catalog';
  END IF;
  -- Joint service states stay on the same lines during an unpaid full edit.
  v_result := public.edit_owner_resolved_appointment(v_studio,v_joint,'completed',
      '2030-11-03 12:00+00',jsonb_build_array(
        jsonb_build_object('lineId',v_joint_first,'serviceId',v_new_service,
          'staffId',v_original_staff,'durationMin',45),
        jsonb_build_object('lineId',v_joint_second,'serviceId',v_new_service,
          'staffId',v_new_staff,'durationMin',70)),100,'Joint edit',v_actor);
  IF v_result->>'appointmentId'<>v_joint::text
     OR (SELECT total_price FROM public.appointments WHERE id=v_joint)<>100
     OR (SELECT count(*) FROM public.appointment_services WHERE appointment_id=v_joint
       AND service_state='completed')<>1
     OR (SELECT count(*) FROM public.appointment_services WHERE appointment_id=v_joint
       AND service_state='no_show')<>1
     OR (SELECT count(*) FROM public.appointment_services WHERE appointment_id=v_joint)<>2 THEN
    RAISE EXCEPTION 'unpaid joint identity or states changed';
  END IF;
  INSERT INTO public.cash_register_movements
    (session_id,studio_id,appointment_id,movement_type,payment_method,amount,description)
  VALUES ('88888888-8888-4888-8888-888888888888',v_studio,v_joint,
    'service_payment','cash',80,'Synthetic joint receipt');
  v_blocked := false;
  BEGIN
    PERFORM public.edit_owner_resolved_appointment(v_studio,v_joint,'completed',
      '2030-11-03 14:00+00',jsonb_build_array(
        jsonb_build_object('lineId',v_joint_first,'serviceId',v_original_service,
          'staffId',v_original_staff,'durationMin',50),
        jsonb_build_object('lineId',v_joint_second,'serviceId',v_new_service,
          'staffId',v_new_staff,'durationMin',65)),100,'Blocked paid joint',v_actor);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_blocked := SQLERRM='received_reservation_financial_fields_locked';
  END;
  IF NOT v_blocked OR (SELECT starts_at FROM public.appointments WHERE id=v_joint)<>'2030-11-03 12:00+00'::timestamptz
     OR (SELECT sum(amount) FROM public.cash_register_movements WHERE appointment_id=v_joint)<>80 THEN
    RAISE EXCEPTION 'paid joint financial guard failed';
  END IF;
  v_result := public.edit_owner_resolved_appointment(v_studio,v_joint,'completed',
    '2030-11-03 14:00+00',jsonb_build_array(
      jsonb_build_object('lineId',v_joint_first,'serviceId',v_new_service,
        'staffId',v_original_staff,'durationMin',50),
      jsonb_build_object('lineId',v_joint_second,'serviceId',v_new_service,
        'staffId',v_new_staff,'durationMin',65)),100,'Paid joint schedule',v_actor);
  IF v_result->>'appointmentId'<>v_joint::text
     OR (SELECT count(*) FROM public.appointment_services WHERE appointment_id=v_joint AND service_state='completed')<>1
     OR (SELECT count(*) FROM public.appointment_services WHERE appointment_id=v_joint AND service_state='no_show')<>1
     OR (SELECT sum(amount) FROM public.cash_register_movements WHERE appointment_id=v_joint)<>80
     OR (SELECT count(*) FROM public.appointment_services WHERE appointment_id=v_joint)<>2 THEN
    RAISE EXCEPTION 'paid joint schedule changed finance or service states';
  END IF;
  SELECT to_jsonb(a) INTO v_settled_before FROM public.appointments a WHERE id=v_settled;
  SELECT to_jsonb(m) INTO v_settled_receipt_before FROM public.cash_register_movements m
    WHERE appointment_id=v_settled;
  v_blocked := false;
  BEGIN
    PERFORM public.edit_owner_resolved_appointment(v_studio,v_settled,'completed',
      '2030-11-01 12:00+00',jsonb_build_array(jsonb_build_object('lineId',v_settled_line,
        'serviceId',v_original_service,'staffId',v_original_staff,'durationMin',120)),70,
      'Paid value must remain locked',v_actor);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_blocked := SQLERRM='received_reservation_financial_fields_locked';
  END;
  IF NOT v_blocked OR (SELECT to_jsonb(a) FROM public.appointments a WHERE id=v_settled)
       IS DISTINCT FROM v_settled_before
     OR (SELECT count(*) FROM public.financial_audit_logs WHERE entity_id=v_settled
       AND action='resolved_appointment_reservation_edited')<>0 THEN
    RAISE EXCEPTION 'paid price edit was partial';
  END IF;
  v_blocked := false;
  BEGIN
    PERFORM public.edit_owner_resolved_appointment(v_studio,v_settled,'completed',
      '2030-11-01 12:00+00',jsonb_build_array(jsonb_build_object('lineId',v_settled_line,
        'serviceId',v_new_service,'staffId',v_new_staff,'durationMin',120)),50,
      'Paid service and staff must remain locked',v_actor);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_blocked := SQLERRM='received_reservation_financial_fields_locked';
  END;
  IF NOT v_blocked OR (SELECT to_jsonb(a) FROM public.appointments a WHERE id=v_settled)
       IS DISTINCT FROM v_settled_before THEN
    RAISE EXCEPTION 'paid service or professional edit was partial';
  END IF;
  v_result := public.edit_owner_resolved_appointment(v_studio,v_settled,'completed',
    '2030-11-01 12:00+00',jsonb_build_array(jsonb_build_object('lineId',v_settled_line,
      'serviceId',v_original_service,'staffId',v_original_staff,'durationMin',120)),50,
    'Paid individual duration above catalog',v_actor);
  IF v_result->>'appointmentId'<>v_settled::text OR v_result->>'status'<>'completed'
     OR NOT EXISTS (SELECT 1 FROM public.appointments WHERE id=v_settled AND status='completed'
       AND total_price=50 AND staff_id=v_original_staff AND studio_commission_percent_snapshot=25
       AND starts_at='2030-11-01 12:00+00'::timestamptz AND total_duration_min=120)
     OR NOT EXISTS (SELECT 1 FROM public.appointment_services WHERE id=v_settled_line
       AND service_id=v_original_service AND duration_min=120 AND price=50)
     OR (SELECT duration_min FROM public.services WHERE id=v_original_service)<>90
     OR (SELECT to_jsonb(m) FROM public.cash_register_movements m WHERE appointment_id=v_settled)
       IS DISTINCT FROM v_settled_receipt_before THEN
    RAISE EXCEPTION 'paid schedule/duration changed finance, identity or catalog';
  END IF;
  v_result := public.edit_owner_resolved_appointment(v_studio,v_settled,'completed',
    '2030-11-01 14:00+00',jsonb_build_array(jsonb_build_object('lineId',v_settled_line,
      'serviceId',v_original_service,'staffId',v_original_staff,'durationMin',45)),50,
    'Safe settled schedule correction',v_actor);
  IF v_result->>'appointmentId'<>v_settled::text OR v_result->>'status'<>'completed'
     OR NOT EXISTS (SELECT 1 FROM public.appointments WHERE id=v_settled AND status='completed'
       AND total_price=50 AND studio_commission_percent_snapshot=25
       AND starts_at='2030-11-01 14:00+00'::timestamptz)
     OR (SELECT to_jsonb(m) FROM public.cash_register_movements m WHERE appointment_id=v_settled)
       IS DISTINCT FROM v_settled_receipt_before THEN
    RAISE EXCEPTION 'safe settled schedule correction changed finance or identity';
  END IF;
  IF EXISTS (SELECT 1 FROM public.financial_audit_logs WHERE entity_id=v_settled
       AND action='resolved_appointment_reservation_edited' AND amount_cents<>0) THEN
    RAISE EXCEPTION 'paid schedule generated a financial adjustment';
  END IF;
  INSERT INTO public.cash_register_movements
    (session_id,studio_id,appointment_id,movement_type,payment_method,amount,description)
  VALUES ('88888888-8888-4888-8888-888888888888',v_studio,v_multi,
    'service_payment','cash',100,'Synthetic multi-service settlement');
  v_blocked := false;
  BEGIN
    PERFORM public.edit_owner_resolved_appointment(v_studio,v_multi,'completed',
      '2030-11-02 15:00+00',jsonb_build_array(
        jsonb_build_object('lineId',v_multi_first,'serviceId',v_new_service,
          'staffId',v_original_staff,'durationMin',45),
        jsonb_build_object('lineId',v_multi_second,'serviceId',v_new_service,
          'staffId',v_new_staff,'durationMin',70)),110,'Settled multi value must block',v_actor);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_blocked := SQLERRM='received_reservation_financial_fields_locked';
  END;
  IF NOT v_blocked OR (SELECT starts_at FROM public.appointments WHERE id=v_multi)
    <>'2030-11-02 12:00+00'::timestamptz THEN
    RAISE EXCEPTION 'settled multi-service financial guard failed';
  END IF;
  v_result := public.edit_owner_resolved_appointment(v_studio,v_multi,'completed',
    '2030-11-02 15:00+00',jsonb_build_array(
      jsonb_build_object('lineId',v_multi_first,'serviceId',v_new_service,
        'staffId',v_original_staff,'durationMin',50),
      jsonb_build_object('lineId',v_multi_second,'serviceId',v_new_service,
        'staffId',v_new_staff,'durationMin',65)),100,'Paid multi schedule only',v_actor);
  IF v_result->>'appointmentId'<>v_multi::text
     OR (SELECT count(*) FROM public.appointment_services WHERE appointment_id=v_multi)<>2
     OR NOT EXISTS (SELECT 1 FROM public.appointments WHERE id=v_multi
       AND status='completed' AND total_price=100 AND starts_at='2030-11-02 15:00+00'::timestamptz)
     OR NOT EXISTS (SELECT 1 FROM public.appointment_services WHERE id=v_multi_first
       AND duration_min=50 AND price=62.50)
     OR NOT EXISTS (SELECT 1 FROM public.appointment_services WHERE id=v_multi_second
       AND duration_min=65 AND price=37.50)
     OR (SELECT sum(amount) FROM public.cash_register_movements WHERE appointment_id=v_multi)<>100 THEN
    RAISE EXCEPTION 'paid multi schedule changed finance or line identity';
  END IF;
  RAISE NOTICE 'full edit schema: unpaid full edit, paid schedule-only, joint states and rollback fixture OK';
END $$;
ROLLBACK;
