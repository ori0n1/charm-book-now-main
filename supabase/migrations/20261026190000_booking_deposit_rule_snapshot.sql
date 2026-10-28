-- Prepared only. Apply before activating the corresponding Worker version.
ALTER TABLE public.booking_payment_requests
  ADD COLUMN IF NOT EXISTS deposit_rule_snapshot jsonb;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS deposit_rule_snapshot jsonb;

CREATE OR REPLACE FUNCTION public.snapshot_booking_deposit_rule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_percent integer;
  v_settings jsonb;
  v_fixed_text text;
  v_fixed_cents bigint;
BEGIN
  SELECT deposit_percent, studio_policy_settings
    INTO v_percent, v_settings
    FROM public.studios WHERE id = NEW.studio_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'studio_not_found'; END IF;

  IF v_settings ? 'deposit_mode' AND v_settings ->> 'deposit_mode' NOT IN ('percent', 'fixed') THEN
    RAISE EXCEPTION 'invalid_deposit_mode';
  END IF;

  IF v_settings ->> 'deposit_mode' = 'fixed' THEN
    v_fixed_text := v_settings ->> 'deposit_fixed_cents';
    IF v_fixed_text IS NULL OR v_fixed_text !~ '^[0-9]{1,9}$' THEN
      RAISE EXCEPTION 'invalid_fixed_deposit';
    END IF;
    v_fixed_cents := v_fixed_text::bigint;
    IF v_fixed_cents < 50 THEN RAISE EXCEPTION 'invalid_fixed_deposit'; END IF;
    NEW.deposit_rule_snapshot := jsonb_build_object('mode', 'fixed', 'fixed_cents', v_fixed_cents);
  ELSE
    NEW.deposit_rule_snapshot := jsonb_build_object('mode', 'percent', 'percent', greatest(10, least(100, v_percent)));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS booking_request_deposit_rule_snapshot ON public.booking_payment_requests;
CREATE TRIGGER booking_request_deposit_rule_snapshot
  BEFORE INSERT ON public.booking_payment_requests
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_booking_deposit_rule();

DROP TRIGGER IF EXISTS appointment_deposit_rule_snapshot ON public.appointments;
CREATE TRIGGER appointment_deposit_rule_snapshot
  BEFORE INSERT ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_booking_deposit_rule();

REVOKE ALL ON FUNCTION public.snapshot_booking_deposit_rule() FROM PUBLIC, anon, authenticated;
