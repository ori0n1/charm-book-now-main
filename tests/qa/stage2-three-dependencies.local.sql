-- QA disposable only. Replays the three definitions read from the active
-- pwmdzpvnatrvfpgcvnzg catalog under authenticated, READ ONLY, on 2026-11-22.
-- The two QA support tables must be empty before this transaction is run.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $qa_guard$
BEGIN
  IF current_setting('bellza.disposable_qa', true) IS DISTINCT FROM 'agenda-stage2-rls-qa'
    OR to_regclass('public.appointment_schedule_events') IS NULL THEN
    RAISE EXCEPTION 'qa_disposable_marker_required';
  END IF;
  IF EXISTS (SELECT 1 FROM public.refund_requests)
    OR EXISTS (SELECT 1 FROM public.whatsapp_message_logs) THEN
    RAISE EXCEPTION 'qa_support_tables_must_be_empty';
  END IF;
END
$qa_guard$;
DROP TABLE public.refund_requests, public.whatsapp_message_logs RESTRICT;

CREATE TABLE public.refund_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  studio_id uuid NOT NULL,
  appointment_id uuid,
  booking_request_id uuid,
  payment_intent_id uuid,
  client_name text,
  client_phone text,
  client_email text,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending'::text,
  decision_note text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  platform_processed_at timestamptz,
  platform_processed_by uuid,
  stripe_refund_id text,
  refund_method text,
  admin_notes text,
  CONSTRAINT refund_requests_pkey PRIMARY KEY (id),
  CONSTRAINT refund_requests_appointment_id_fkey FOREIGN KEY (appointment_id)
    REFERENCES public.appointments(id) ON DELETE SET NULL,
  CONSTRAINT refund_requests_booking_request_id_fkey FOREIGN KEY (booking_request_id)
    REFERENCES public.booking_payment_requests(id) ON DELETE SET NULL,
  CONSTRAINT refund_requests_payment_intent_id_fkey FOREIGN KEY (payment_intent_id)
    REFERENCES public.payment_intents(id) ON DELETE SET NULL,
  CONSTRAINT refund_requests_platform_processed_by_fkey FOREIGN KEY (platform_processed_by)
    REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT refund_requests_status_valid CHECK (status IN
    ('pending','in_review','approved','rejected','refunded')),
  CONSTRAINT refund_requests_studio_id_fkey FOREIGN KEY (studio_id)
    REFERENCES public.studios(id) ON DELETE CASCADE
);
CREATE INDEX idx_refund_requests_studio ON public.refund_requests (studio_id, created_at DESC);
CREATE INDEX idx_refund_requests_status ON public.refund_requests (status);
CREATE INDEX idx_refund_requests_platform_status ON public.refund_requests
  (status, platform_processed_at DESC, created_at DESC);
CREATE UNIQUE INDEX refund_requests_one_active_booking ON public.refund_requests (booking_request_id)
  WHERE booking_request_id IS NOT NULL AND status IN ('pending','in_review','processing');
CREATE UNIQUE INDEX refund_requests_one_active_appointment ON public.refund_requests (appointment_id)
  WHERE appointment_id IS NOT NULL AND status IN ('pending','in_review','processing');
CREATE UNIQUE INDEX refund_requests_one_active_payment ON public.refund_requests (payment_intent_id)
  WHERE payment_intent_id IS NOT NULL AND status IN ('pending','in_review','processing');
ALTER TABLE public.refund_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Financial privacy refund read" ON public.refund_requests
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (financial_privacy_global_visible(auth.uid(), studio_id)
    OR (appointment_id IS NOT NULL AND staff_owns_appointment(auth.uid(), appointment_id)));
CREATE POLICY "Members manage refund requests" ON public.refund_requests
  FOR ALL TO authenticated
  USING (can_use_studio((SELECT auth.uid()), studio_id))
  WITH CHECK (can_use_studio((SELECT auth.uid()), studio_id));
CREATE POLICY "Plan permits refund access" ON public.refund_requests
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (studio_has_entitlement(studio_id, 'online_payments') OR is_saas_owner())
  WITH CHECK (studio_has_entitlement(studio_id, 'online_payments') OR is_saas_owner());

CREATE OR REPLACE FUNCTION public.notify_refund_request_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
 perform public.insert_studio_notification(
 new.studio_id,
 'refund_request',
 'Novo pedido de reembolso',
 coalesce(nullif(trim(new.client_name), ''), 'Cliente') ||
 ' enviou um pedido de reembolso para análise.',
 jsonb_build_object(
 'refund_request_id', new.id,
 'appointment_id', new.appointment_id,
 'booking_request_id', new.booking_request_id,
 'payment_intent_id', new.payment_intent_id,
 'client_name', new.client_name,
 'event_key', 'refund:' || new.id::text || ':created',
 'action_url', '/admin/politicas'
 )
 );
 return new;
end
$function$;
REVOKE ALL ON FUNCTION public.notify_refund_request_created() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.notify_refund_request_created()
  TO PUBLIC,postgres,anon,authenticated,service_role;
CREATE TRIGGER trg_notify_refund_request_created AFTER INSERT ON public.refund_requests
  FOR EACH ROW EXECUTE FUNCTION notify_refund_request_created();
CREATE TRIGGER trg_refund_requests_same_studio
  BEFORE INSERT OR UPDATE OF studio_id, appointment_id, booking_request_id, payment_intent_id
  ON public.refund_requests FOR EACH ROW EXECUTE FUNCTION assert_financial_tenant_links();
CREATE TRIGGER trg_refund_requests_studio_immutable BEFORE UPDATE OF studio_id
  ON public.refund_requests FOR EACH ROW EXECUTE FUNCTION reject_tenant_reassignment();

CREATE TABLE public.whatsapp_message_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  studio_id uuid NOT NULL,
  appointment_id uuid,
  payment_intent_id uuid,
  idempotency_key text NOT NULL,
  provider text NOT NULL DEFAULT 'twilio_whatsapp_sandbox'::text,
  recipient_phone text,
  status text NOT NULL,
  reason text,
  provider_message_id text,
  message text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_message_logs_pkey PRIMARY KEY (id),
  CONSTRAINT whatsapp_message_logs_appointment_id_fkey FOREIGN KEY (appointment_id)
    REFERENCES public.appointments(id) ON DELETE SET NULL,
  CONSTRAINT whatsapp_message_logs_idempotency_key_key UNIQUE (idempotency_key),
  CONSTRAINT whatsapp_message_logs_payment_intent_id_fkey FOREIGN KEY (payment_intent_id)
    REFERENCES public.payment_intents(id) ON DELETE SET NULL,
  CONSTRAINT whatsapp_message_logs_status_check CHECK (status IN ('pending','sent','failed','skipped')),
  CONSTRAINT whatsapp_message_logs_studio_id_fkey FOREIGN KEY (studio_id)
    REFERENCES public.studios(id) ON DELETE CASCADE
);
CREATE INDEX idx_whatsapp_message_logs_studio_created ON public.whatsapp_message_logs (studio_id, created_at DESC);
CREATE INDEX idx_whatsapp_message_logs_appointment ON public.whatsapp_message_logs (appointment_id, created_at DESC);
CREATE UNIQUE INDEX idx_whatsapp_message_logs_payment_sent_once ON public.whatsapp_message_logs (payment_intent_id)
  WHERE payment_intent_id IS NOT NULL AND status = 'sent';
ALTER TABLE public.whatsapp_message_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Plan permits WhatsApp history" ON public.whatsapp_message_logs
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (studio_has_entitlement(studio_id, 'whatsapp') OR is_saas_owner())
  WITH CHECK (studio_has_entitlement(studio_id, 'whatsapp') OR is_saas_owner());
CREATE POLICY "Privileged members read whatsapp logs" ON public.whatsapp_message_logs
  FOR SELECT TO authenticated USING (has_privileged_studio_access((SELECT auth.uid()), studio_id));
CREATE POLICY "Professionals read own whatsapp logs" ON public.whatsapp_message_logs
  FOR SELECT TO authenticated
  USING (appointment_id IS NOT NULL AND staff_owns_appointment((SELECT auth.uid()), appointment_id));
CREATE POLICY "Service role manages whatsapp message logs" ON public.whatsapp_message_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE TRIGGER trg_whatsapp_message_logs_updated BEFORE UPDATE ON public.whatsapp_message_logs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION public.resolve_studio_local_datetime(p_studio_id uuid, p_local_date date, p_local_time time without time zone)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
 v_timezone text;
 v_instant timestamptz;
 v_roundtrip timestamp;
BEGIN
 IF p_studio_id IS NULL OR p_local_date IS NULL OR p_local_time IS NULL THEN
 RAISE EXCEPTION 'invalid_schedule_datetime';
 END IF;
 IF auth.role() <> 'service_role'
 AND NOT public.can_use_studio(auth.uid(), p_studio_id) THEN
 RAISE EXCEPTION 'not_authorized';
 END IF;

 SELECT coalesce(nullif(s.timezone, ''), 'Europe/Lisbon')
 INTO v_timezone
 FROM public.studios s
 WHERE s.id = p_studio_id;
 IF v_timezone IS NULL THEN RAISE EXCEPTION 'studio_not_found'; END IF;

 v_instant := (p_local_date::timestamp + p_local_time) AT TIME ZONE v_timezone;
 v_roundtrip := v_instant AT TIME ZONE v_timezone;

 -- Reject a non-existent civil time during the spring DST transition. An
 -- ambiguous autumn time remains deterministic under PostgreSQL timezone data.
 IF v_roundtrip::date IS DISTINCT FROM p_local_date
 OR to_char(v_roundtrip, 'HH24:MI') IS DISTINCT FROM to_char(p_local_time, 'HH24:MI') THEN
 RAISE EXCEPTION 'invalid_schedule_datetime_for_timezone';
 END IF;
 RETURN v_instant;
END
$function$;
REVOKE ALL ON FUNCTION public.resolve_studio_local_datetime(uuid,date,time without time zone)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.resolve_studio_local_datetime(uuid,date,time without time zone)
  TO postgres,service_role;

REVOKE ALL ON TABLE public.refund_requests,public.whatsapp_message_logs
  FROM PUBLIC,anon,authenticated,service_role;
GRANT ALL ON TABLE public.refund_requests,public.whatsapp_message_logs
  TO postgres,anon,authenticated,service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
