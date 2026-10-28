BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
DO $preflight$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'customer_loyalty_stamp_entries'
               AND column_name IN ('management_action_id', 'managed_by_user_id'))
     OR to_regprocedure('public.admin_adjust_customer_loyalty_stamps(uuid,uuid,integer,text,uuid,uuid)') IS NOT NULL
     OR (SELECT pg_get_triggerdef(oid) FROM pg_trigger
         WHERE tgname = 'trg_customer_loyalty_completed_appointment')
           NOT LIKE '%AFTER INSERT OR UPDATE OF status ON public.appointments%'
  THEN RAISE EXCEPTION 'loyalty_management_production_drift'; END IF;
END;
$preflight$;
-- Audited, idempotent management actions. Existing entries and rewards are untouched.
ALTER TABLE public.customer_loyalty_stamp_entries
  ADD COLUMN IF NOT EXISTS management_action_id uuid,
  ADD COLUMN IF NOT EXISTS managed_by_user_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS customer_loyalty_management_action_once
  ON public.customer_loyalty_stamp_entries(management_action_id)
  WHERE management_action_id IS NOT NULL;

-- Attendance may be resolved after status becomes completed. Process at either transition.
CREATE OR REPLACE FUNCTION public.customer_loyalty_completed_appointment_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'completed'
     AND NEW.attendance_resolved_at IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status
          OR OLD.attendance_resolved_at IS DISTINCT FROM NEW.attendance_resolved_at) THEN
    PERFORM public.process_customer_loyalty_for_completed_appointment(NEW.id);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_customer_loyalty_completed_appointment ON public.appointments;
CREATE TRIGGER trg_customer_loyalty_completed_appointment
  AFTER INSERT OR UPDATE OF status, attendance_resolved_at ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.customer_loyalty_completed_appointment_trigger();

CREATE OR REPLACE FUNCTION public.admin_adjust_customer_loyalty_stamps(
  p_studio_id uuid, p_client_id uuid, p_delta integer, p_note text,
  p_actor_id uuid, p_action_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_existing public.customer_loyalty_stamp_entries%ROWTYPE;
  v_total integer;
  v_id uuid;
BEGIN
  IF p_delta = 0 OR p_delta < -20 OR p_delta > 20
     OR length(trim(coalesce(p_note, ''))) < 5 OR length(p_note) > 300
     OR p_actor_id IS NULL OR p_action_id IS NULL THEN
    RAISE EXCEPTION 'invalid_loyalty_adjustment';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clients
                 WHERE id = p_client_id AND studio_id = p_studio_id) THEN
    RAISE EXCEPTION 'loyalty_client_not_found';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_studio_id::text || ':' || p_client_id::text, 0));
  SELECT * INTO v_existing FROM public.customer_loyalty_stamp_entries
  WHERE management_action_id = p_action_id;
  IF FOUND THEN
    IF v_existing.studio_id = p_studio_id AND v_existing.client_id = p_client_id
       AND v_existing.stamps = p_delta AND v_existing.note = trim(p_note)
       AND v_existing.managed_by_user_id = p_actor_id THEN
      RETURN v_existing.id;
    END IF;
    RAISE EXCEPTION 'loyalty_action_conflict';
  END IF;

  SELECT coalesce(sum(stamps), 0)::integer INTO v_total
  FROM public.customer_loyalty_stamp_entries
  WHERE studio_id = p_studio_id AND client_id = p_client_id;
  IF v_total + p_delta < 0 THEN RAISE EXCEPTION 'insufficient_loyalty_stamps'; END IF;

  INSERT INTO public.customer_loyalty_stamp_entries
    (studio_id, client_id, source_type, stamps, note, managed_by_user_id, management_action_id)
  VALUES (p_studio_id, p_client_id, 'manual', p_delta, trim(p_note), p_actor_id, p_action_id)
  RETURNING id INTO v_id;
  IF p_delta > 0 THEN
    PERFORM public.issue_customer_loyalty_rewards(p_studio_id, p_client_id);
  END IF;
  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_adjust_customer_loyalty_stamps(uuid, uuid, integer, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_customer_loyalty_stamps(uuid, uuid, integer, text, uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.admin_decide_customer_referral(
  p_studio_id uuid, p_referral_id uuid, p_approve boolean
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_ref public.customer_referrals%ROWTYPE;
  v_appt public.appointments%ROWTYPE;
  v_status text;
BEGIN
  SELECT * INTO v_ref FROM public.customer_referrals
  WHERE id = p_referral_id AND studio_id = p_studio_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'loyalty_referral_not_found'; END IF;
  IF v_ref.status <> 'pending_completion' THEN RETURN v_ref.status; END IF;
  IF NOT p_approve THEN
    UPDATE public.customer_referrals
    SET status = 'rejected', rejection_reason = 'staff_review', updated_at = now()
    WHERE id = p_referral_id;
    RETURN 'rejected';
  END IF;

  SELECT * INTO v_appt FROM public.appointments
  WHERE id = coalesce(v_ref.appointment_id, (
    SELECT appointment_id FROM public.booking_payment_requests
    WHERE id = v_ref.booking_request_id
  )) AND studio_id = p_studio_id FOR SHARE;
  IF NOT FOUND OR v_appt.status <> 'completed' OR v_appt.attendance_resolved_at IS NULL THEN
    RAISE EXCEPTION 'loyalty_referral_appointment_not_confirmed';
  END IF;
  PERFORM public.process_customer_loyalty_for_completed_appointment(v_appt.id);
  SELECT status INTO v_status FROM public.customer_referrals WHERE id = p_referral_id;
  IF v_status = 'pending_completion' THEN
    RAISE EXCEPTION 'loyalty_referral_payment_not_confirmed';
  END IF;
  RETURN v_status;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_decide_customer_referral(uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_decide_customer_referral(uuid, uuid, boolean)
  TO service_role;


COMMIT;

