\set ON_ERROR_STOP on
BEGIN;

CREATE TABLE public.studios (id uuid PRIMARY KEY, name text NOT NULL);
CREATE TABLE public.user_roles (user_id uuid NOT NULL, studio_id uuid NOT NULL, role text NOT NULL);
CREATE TABLE public.staff (id uuid PRIMARY KEY, studio_id uuid NOT NULL, user_id uuid,
  is_active boolean NOT NULL DEFAULT true, current_status text DEFAULT 'online');
CREATE TABLE public.services (id uuid PRIMARY KEY, studio_id uuid NOT NULL, name text NOT NULL,
  duration_min integer NOT NULL, price numeric NOT NULL);
CREATE TABLE public.staff_services (staff_id uuid NOT NULL, service_id uuid NOT NULL,
  PRIMARY KEY (staff_id,service_id));
CREATE TABLE public.appointments (
  id uuid PRIMARY KEY, studio_id uuid NOT NULL, staff_id uuid NOT NULL,
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'confirmed', total_price numeric NOT NULL,
  total_duration_min integer NOT NULL, is_manual_fit boolean NOT NULL DEFAULT false,
  duration_overridden boolean NOT NULL DEFAULT false,
  studio_commission_percent_snapshot numeric, notes text, updated_at timestamptz DEFAULT now());
CREATE TABLE public.appointment_services (
  id uuid PRIMARY KEY, appointment_id uuid NOT NULL, service_id uuid NOT NULL,
  staff_id uuid, starts_at timestamptz, ends_at timestamptz, position integer,
  duration_min integer NOT NULL, price numeric NOT NULL, service_state text,
  studio_commission_percent_snapshot numeric,
  professional_commission_percent_snapshot numeric);
CREATE TABLE public.staff_time_off (
  id uuid PRIMARY KEY, studio_id uuid NOT NULL, staff_id uuid NOT NULL,
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, reason text);
CREATE TABLE public.booking_payment_requests (
  id uuid PRIMARY KEY, appointment_id uuid, studio_id uuid, staff_id uuid,
  starts_at timestamptz, ends_at timestamptz, status text NOT NULL);
CREATE TABLE public.payment_intents (id uuid PRIMARY KEY, appointment_id uuid NOT NULL, status text NOT NULL);
CREATE TABLE public.cash_register_movements (id uuid PRIMARY KEY, appointment_id uuid NOT NULL, amount numeric NOT NULL);
CREATE TABLE public.appointment_schedule_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), studio_id uuid NOT NULL,
  appointment_id uuid NOT NULL, actor_id uuid NOT NULL, operation text NOT NULL,
  previous_state jsonb NOT NULL, next_state jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());

CREATE FUNCTION public.qa_member(p_studio uuid, p_roles text[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f$
  SELECT EXISTS(SELECT 1 FROM public.user_roles
    WHERE user_id=auth.uid() AND studio_id=p_studio AND role=ANY(p_roles));
$f$;

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_schedule_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY qa_appointments ON public.appointments TO authenticated USING (
  public.qa_member(studio_id,ARRAY['studio_owner','manager']) OR
  EXISTS (SELECT 1 FROM public.staff s WHERE s.id=staff_id AND s.user_id=auth.uid()
    AND s.studio_id=studio_id));
CREATE POLICY qa_services ON public.appointment_services TO authenticated USING (
  EXISTS (SELECT 1 FROM public.appointments a WHERE a.id=appointment_id));
CREATE POLICY qa_events ON public.appointment_schedule_events TO authenticated USING (
  public.qa_member(studio_id,ARRAY['studio_owner','manager']));
CREATE POLICY qa_roles ON public.user_roles TO authenticated USING (user_id=auth.uid());
GRANT SELECT ON public.appointments,public.appointment_services,
  public.appointment_schedule_events,public.user_roles,public.staff TO authenticated;
GRANT EXECUTE ON FUNCTION public.qa_member(uuid,text[]) TO authenticated;

CREATE FUNCTION public.preview_studio_schedule_change(
  p_studio_id uuid, p_staff_id uuid, p_starts_at timestamptz,
  p_duration_min integer, p_ignore_appointment_ids uuid[] DEFAULT '{}'::uuid[]
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE
  v_end timestamptz := p_starts_at+make_interval(mins=>p_duration_min);
  v_conflicts jsonb;
  v_blocked boolean;
  v_staff_available boolean;
  v_within boolean;
BEGIN
  SELECT is_active AND coalesce(current_status,'online')<>'absent'
    INTO v_staff_available FROM public.staff WHERE id=p_staff_id AND studio_id=p_studio_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('appointmentId',id)),'[]'::jsonb)
    INTO v_conflicts FROM (
      SELECT DISTINCT a.id FROM public.appointments a
      LEFT JOIN public.appointment_services s ON s.appointment_id=a.id AND s.staff_id=p_staff_id
      WHERE a.studio_id=p_studio_id AND a.status='confirmed'
        AND NOT a.id=ANY(p_ignore_appointment_ids)
        AND ((a.staff_id=p_staff_id AND a.starts_at<v_end AND a.ends_at>p_starts_at)
          OR (s.starts_at<v_end AND s.ends_at>p_starts_at))
    ) AS occupied;
  SELECT EXISTS(SELECT 1 FROM public.staff_time_off
    WHERE studio_id=p_studio_id AND staff_id=p_staff_id AND starts_at<v_end AND ends_at>p_starts_at)
    OR EXISTS(SELECT 1 FROM public.booking_payment_requests
      WHERE studio_id=p_studio_id AND staff_id=p_staff_id
        AND status IN ('awaiting_payment','processing')
        AND starts_at<v_end AND ends_at>p_starts_at) INTO v_blocked;
  v_within := (p_starts_at AT TIME ZONE 'UTC')::time >= time '09:00'
    AND (v_end AT TIME ZONE 'UTC')::time <= time '17:00'
    AND (p_starts_at AT TIME ZONE 'UTC')::date=(v_end AT TIME ZONE 'UTC')::date;
  RETURN jsonb_build_object('conflicts',v_conflicts,'hasConflict',jsonb_array_length(v_conflicts)>0,
    'withinAvailability',v_within,'staffAvailable',coalesce(v_staff_available,false),
    'hardBlocked',v_blocked OR NOT coalesce(v_staff_available,false));
END
$f$;
REVOKE ALL ON FUNCTION public.preview_studio_schedule_change(uuid,uuid,timestamptz,integer,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preview_studio_schedule_change(uuid,uuid,timestamptz,integer,uuid[]) TO service_role;

INSERT INTO public.studios VALUES
  ('11111111-1111-4111-8111-111111111111','QA próprio'),
  ('99999999-9999-4999-8999-999999999999','QA outro');
INSERT INTO public.staff(id,studio_id) VALUES
  ('33333333-3333-4333-8333-000000000001','11111111-1111-4111-8111-111111111111'),
  ('33333333-3333-4333-8333-000000000002','11111111-1111-4111-8111-111111111111'),
  ('33333333-3333-4333-8333-000000000009','99999999-9999-4999-8999-999999999999');
INSERT INTO public.services VALUES
  ('44444444-4444-4444-8444-000000000001','11111111-1111-4111-8111-111111111111','QA serviço A',30,28),
  ('44444444-4444-4444-8444-000000000002','11111111-1111-4111-8111-111111111111','QA serviço B',60,40);
INSERT INTO public.staff_services VALUES
  ('33333333-3333-4333-8333-000000000001','44444444-4444-4444-8444-000000000001'),
  ('33333333-3333-4333-8333-000000000001','44444444-4444-4444-8444-000000000002'),
  ('33333333-3333-4333-8333-000000000002','44444444-4444-4444-8444-000000000001'),
  ('33333333-3333-4333-8333-000000000002','44444444-4444-4444-8444-000000000002');
COMMIT;
