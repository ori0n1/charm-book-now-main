BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Restore the exact cancellation behavior observed in production before this release.
-- Existing appointments, receipts, cash movements and audit rows remain untouched.
CREATE OR REPLACE FUNCTION public.guard_completed_appointment_cancellation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'completed' AND NEW.status = 'cancelled' THEN
    IF auth.uid() IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.user_roles r
      WHERE r.user_id = auth.uid()
        AND r.studio_id = OLD.studio_id
        AND r.role IN ('studio_owner', 'saas_owner')
    ) THEN
      RAISE EXCEPTION 'studio_owner_required';
    END IF;
    IF NULLIF(trim(NEW.cancellation_reason), '') IS NULL THEN
      RAISE EXCEPTION 'cancellation_reason_required';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.appointment_services s
      WHERE s.appointment_id = OLD.id AND s.service_state IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'cancel_joint_services_individually';
    END IF;
    NEW.cancelled_at := now();
    NEW.cancelled_by := auth.uid();
  ELSIF OLD.status = 'cancelled' THEN
    -- A retry cannot rewrite the original audit or create another adjustment.
    NEW.cancelled_at := OLD.cancelled_at;
    NEW.cancelled_by := OLD.cancelled_by;
    NEW.cancellation_reason := OLD.cancellation_reason;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_completed_appointment(
  p_studio_id uuid,
  p_appointment_id uuid,
  p_reason text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status public.appointment_status;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_roles r
    WHERE r.user_id = auth.uid()
      AND r.studio_id = p_studio_id
      AND r.role IN ('studio_owner', 'saas_owner')
  ) THEN
    RAISE EXCEPTION 'studio_owner_required';
  END IF;
  IF length(trim(coalesce(p_reason, ''))) < 3 OR length(trim(p_reason)) > 500 THEN
    RAISE EXCEPTION 'cancellation_reason_required';
  END IF;

  SELECT status INTO v_status
  FROM public.appointments
  WHERE id = p_appointment_id AND studio_id = p_studio_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'appointment_not_found'; END IF;
  IF v_status = 'cancelled' THEN RETURN false; END IF;
  IF v_status <> 'completed' THEN RAISE EXCEPTION 'appointment_not_completed'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.appointment_services s
    WHERE s.appointment_id = p_appointment_id AND s.service_state IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'cancel_joint_services_individually';
  END IF;

  UPDATE public.appointments
  SET status = 'cancelled', cancellation_reason = trim(p_reason), updated_at = now()
  WHERE id = p_appointment_id AND studio_id = p_studio_id;
  RETURN true;
END;
$$;

DROP FUNCTION IF EXISTS public.correct_owner_appointment_action(uuid,uuid,text,uuid,text);
DROP FUNCTION IF EXISTS public.correct_onsite_payment_method(uuid,uuid,uuid,text,uuid);
NOTIFY pgrst, 'reload schema';
COMMIT;
