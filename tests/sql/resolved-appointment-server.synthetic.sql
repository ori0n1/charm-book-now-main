\set ON_ERROR_STOP on
-- Run only in the dedicated local PostgreSQL database codex_appt_synthetic_20261027.
CREATE SCHEMA auth;
DO $$ BEGIN
  CREATE ROLE service_role;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE ROLE authenticated;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE ROLE anon;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE TYPE public.appointment_status AS ENUM ('confirmed','completed','no_show','cancelled');
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$
  SELECT current_setting('request.jwt.claim.role',true)
$$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
CREATE TABLE public.user_roles (user_id uuid,studio_id uuid,role text);
CREATE TABLE public.services (id uuid PRIMARY KEY,studio_id uuid,duration_min integer);
CREATE TABLE public.appointments (
  id uuid PRIMARY KEY,studio_id uuid,staff_id uuid,starts_at timestamptz,ends_at timestamptz,
  total_duration_min integer,status public.appointment_status,total_price numeric,notes text,
  studio_commission_percent_snapshot numeric,attendance_resolved_at timestamptz,
  attendance_resolved_by uuid,cancellation_reason text,cancelled_at timestamptz,
  cancelled_by uuid,updated_at timestamptz,duration_overridden boolean DEFAULT false,
  is_manual_fit boolean DEFAULT false
);
CREATE TABLE public.appointment_services (
  id uuid PRIMARY KEY,appointment_id uuid,service_id uuid,staff_id uuid,
  starts_at timestamptz,ends_at timestamptz,position integer,service_state text,
  duration_min integer,price numeric,studio_commission_percent_snapshot numeric
);
CREATE TABLE public.cash_register_movements (
  id uuid PRIMARY KEY,studio_id uuid,appointment_id uuid,movement_type text,
  payment_method text,amount numeric
);
CREATE TABLE public.financial_audit_logs (
  studio_id uuid,actor_user_id uuid,entity_type text,entity_id uuid,
  action text,amount_cents integer,metadata jsonb
);
CREATE TABLE public.appointment_schedule_events (
  studio_id uuid,appointment_id uuid,actor_id uuid,operation text,
  previous_state jsonb,next_state jsonb
);
CREATE FUNCTION public.preview_studio_schedule_change(uuid,uuid,timestamptz,integer,uuid[])
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('hardBlocked',false,
    'hasConflict',current_setting('synthetic.block',true)='on',
    'withinAvailability',true)
$$;
CREATE FUNCTION public.synthetic_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.starts_at IS DISTINCT FROM NEW.starts_at THEN
    NEW.attendance_resolved_at := NULL;
    NEW.attendance_resolved_by := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER synthetic_lifecycle BEFORE UPDATE OF starts_at ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.synthetic_lifecycle();
CREATE FUNCTION public.synthetic_commission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.studio_commission_percent_snapshot := -999;
  RETURN NEW;
END $$;
CREATE TRIGGER synthetic_commission BEFORE UPDATE OF service_id ON public.appointment_services
  FOR EACH ROW EXECUTE FUNCTION public.synthetic_commission();

\ir ../../supabase/migrations/20261027160000_appointment_action_and_method_correction.sql
\ir ../../supabase/migrations/20261027234500_resolved_appointment_schedule_edit.sql

DO $$
DECLARE
  v_studio uuid := '11111111-1111-4111-8111-111111111111';
  v_actor uuid := '22222222-2222-4222-8222-222222222222';
  v_staff uuid := '33333333-3333-4333-8333-333333333333';
  v_service uuid := '44444444-4444-4444-8444-444444444444';
  v_completed uuid := '55555555-5555-4555-8555-555555555555';
  v_no_show uuid := '66666666-6666-4666-8666-666666666666';
  v_cancelled uuid := '77777777-7777-4777-8777-777777777777';
  v_before timestamptz := '2030-10-29 10:00:00+00';
  v_result jsonb;
  v_blocked boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  INSERT INTO public.user_roles VALUES (v_actor,v_studio,'studio_owner');
  INSERT INTO public.services VALUES (v_service,v_studio,90);
  INSERT INTO public.appointments
    (id,studio_id,staff_id,starts_at,ends_at,total_duration_min,status,total_price,
     studio_commission_percent_snapshot,attendance_resolved_at,attendance_resolved_by,
     cancellation_reason,cancelled_at,cancelled_by)
  VALUES
    (v_completed,v_studio,v_staff,v_before,v_before+interval '60 min',60,'completed',50,
     25,v_before,v_actor,NULL,NULL,NULL),
    (v_no_show,v_studio,v_staff,v_before+interval '1 day',v_before+interval '1 day 60 min',60,'no_show',50,
     25,v_before,v_actor,NULL,NULL,NULL),
    (v_cancelled,v_studio,v_staff,v_before+interval '2 days',v_before+interval '2 days 60 min',60,'cancelled',50,
     25,NULL,NULL,'Motivo sintético',v_before,v_actor);
  INSERT INTO public.appointment_services
    (id,appointment_id,service_id,staff_id,starts_at,ends_at,position,duration_min,price,studio_commission_percent_snapshot)
  VALUES
    (gen_random_uuid(),v_completed,v_service,v_staff,v_before,v_before+interval '60 min',0,60,50,25),
    (gen_random_uuid(),v_no_show,v_service,v_staff,v_before+interval '1 day',v_before+interval '1 day 60 min',0,60,50,25),
    (gen_random_uuid(),v_cancelled,v_service,v_staff,v_before+interval '2 days',v_before+interval '2 days 60 min',0,60,50,25);
  INSERT INTO public.cash_register_movements VALUES
    (gen_random_uuid(),v_studio,v_completed,'service_payment','cash',50),
    (gen_random_uuid(),v_studio,v_no_show,'service_payment','card',50),
    (gen_random_uuid(),v_studio,v_cancelled,'service_payment','cash',50);

  v_result := public.edit_resolved_appointment_schedule(
    v_studio,v_completed,'completed',v_before+interval '2 hours',45,'editado',v_actor);
  IF v_result->>'appointmentId' <> v_completed::text OR v_result->>'status' <> 'completed' THEN
    RAISE EXCEPTION 'completed identity or status changed';
  END IF;
  v_result := public.edit_resolved_appointment_schedule(
    v_studio,v_no_show,'no_show',v_before+interval '1 day 2 hours',40,'falta editada',v_actor);
  IF v_result->>'appointmentId' <> v_no_show::text OR v_result->>'status' <> 'no_show' THEN
    RAISE EXCEPTION 'no_show identity or status changed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.appointments WHERE id IN (v_completed,v_no_show)
      AND (total_price<>50 OR studio_commission_percent_snapshot<>25
           OR attendance_resolved_at<>v_before OR attendance_resolved_by<>v_actor)) THEN
    RAISE EXCEPTION 'attendance or financial appointment snapshot changed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.appointment_services WHERE appointment_id IN (v_completed,v_no_show)
      AND (price<>50 OR service_id<>v_service OR staff_id<>v_staff
           OR studio_commission_percent_snapshot<>25)) THEN
    RAISE EXCEPTION 'service or commission snapshot changed';
  END IF;
  IF (SELECT count(*) FROM public.cash_register_movements)<>3
     OR (SELECT sum(amount) FROM public.cash_register_movements)<>150 THEN
    RAISE EXCEPTION 'receipt changed';
  END IF;
  IF (SELECT count(*) FROM public.appointment_schedule_events)<>2 THEN
    RAISE EXCEPTION 'schedule history missing';
  END IF;
  PERFORM set_config('synthetic.block','on',true);
  BEGIN
    PERFORM public.edit_resolved_appointment_schedule(
      v_studio,v_completed,'completed',v_before+interval '3 hours',45,'blocked',v_actor);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_blocked := SQLERRM='slot_unavailable';
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'availability guard was bypassed'; END IF;
  PERFORM set_config('synthetic.block','off',true);

  PERFORM public.correct_owner_appointment_action(v_studio,v_cancelled,'confirmed',v_actor,NULL);
  IF NOT EXISTS (SELECT 1 FROM public.appointments WHERE id=v_cancelled
      AND status='confirmed' AND cancelled_at=v_before
      AND cancelled_by=v_actor AND cancellation_reason='Motivo sintético') THEN
    RAISE EXCEPTION 'cancelled appointment was not reopened in place with history';
  END IF;
  IF (SELECT count(*) FROM public.appointments)<>3
     OR (SELECT count(*) FROM public.cash_register_movements WHERE appointment_id=v_cancelled AND amount=50)<>1
     OR (SELECT count(*) FROM public.financial_audit_logs WHERE entity_id=v_cancelled AND action='appointment_action_corrected')<>1 THEN
    RAISE EXCEPTION 'reopen duplicate or audit missing';
  END IF;
  RAISE NOTICE 'synthetic server edits completed, no_show and cancelled: OK';
END $$;
