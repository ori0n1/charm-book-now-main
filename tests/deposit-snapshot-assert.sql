-- Run only after setup and the prepared migration in the disposable database.
DO $$
DECLARE
  v_request jsonb;
  v_appointment jsonb;
BEGIN
  SELECT deposit_rule_snapshot INTO v_request FROM public.booking_payment_requests
    WHERE id = '20000000-0000-0000-0000-000000000001';
  SELECT deposit_rule_snapshot INTO v_appointment FROM public.appointments
    WHERE id = '30000000-0000-0000-0000-000000000001';
  IF v_request IS NOT NULL OR v_appointment IS NOT NULL THEN
    RAISE EXCEPTION 'Existing rows were changed';
  END IF;

  INSERT INTO public.booking_payment_requests (id, studio_id)
    VALUES ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001');
  INSERT INTO public.appointments (id, studio_id)
    VALUES ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001');
  SELECT deposit_rule_snapshot INTO v_request FROM public.booking_payment_requests
    WHERE id = '20000000-0000-0000-0000-000000000002';
  SELECT deposit_rule_snapshot INTO v_appointment FROM public.appointments
    WHERE id = '30000000-0000-0000-0000-000000000002';
  IF v_request <> '{"mode":"percent","percent":20}'::jsonb
    OR v_appointment <> v_request THEN
    RAISE EXCEPTION 'Percent snapshots incorrect: %, %', v_request, v_appointment;
  END IF;

  UPDATE public.studios SET studio_policy_settings =
    '{"deposit_mode":"fixed","deposit_fixed_cents":1000}'::jsonb
    WHERE id = '10000000-0000-0000-0000-000000000001';
  INSERT INTO public.booking_payment_requests (id, studio_id)
    VALUES ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001');
  INSERT INTO public.appointments (id, studio_id)
    VALUES ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001');
  SELECT deposit_rule_snapshot INTO v_request FROM public.booking_payment_requests
    WHERE id = '20000000-0000-0000-0000-000000000003';
  SELECT deposit_rule_snapshot INTO v_appointment FROM public.appointments
    WHERE id = '30000000-0000-0000-0000-000000000003';
  IF v_request <> '{"mode":"fixed","fixed_cents":1000}'::jsonb
    OR v_appointment <> v_request THEN
    RAISE EXCEPTION 'Fixed snapshots incorrect: %, %', v_request, v_appointment;
  END IF;

  SELECT deposit_rule_snapshot INTO v_request FROM public.booking_payment_requests
    WHERE id = '20000000-0000-0000-0000-000000000002';
  IF v_request <> '{"mode":"percent","percent":20}'::jsonb THEN
    RAISE EXCEPTION 'Earlier percent snapshot changed: %', v_request;
  END IF;
  IF (SELECT deposit_percent FROM public.studios
      WHERE id = '10000000-0000-0000-0000-000000000001') <> 20 THEN
    RAISE EXCEPTION 'Existing percentage changed';
  END IF;

  UPDATE public.studios SET studio_policy_settings =
    '{"deposit_mode":"fixed","deposit_fixed_cents":10}'::jsonb
    WHERE id = '10000000-0000-0000-0000-000000000001';
  BEGIN
    INSERT INTO public.appointments (id, studio_id)
      VALUES ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'Invalid fixed value was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'invalid_fixed_deposit' THEN RAISE; END IF;
  END;
END;
$$;
