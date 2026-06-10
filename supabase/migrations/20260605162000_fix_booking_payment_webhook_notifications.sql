DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'studio_notifications_kind_check'
      AND conrelid = 'public.studio_notifications'::regclass
  ) THEN
    ALTER TABLE public.studio_notifications
      DROP CONSTRAINT studio_notifications_kind_check;
  END IF;

  ALTER TABLE public.studio_notifications
    ADD CONSTRAINT studio_notifications_kind_check
    CHECK (kind IN ('new_appointment','payment_confirmed','payment_failed','refund_request','withdrawal_requested'));
END $$;

CREATE OR REPLACE FUNCTION public.notify_payment_confirmed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_studio_id UUID;
  v_appointment_id UUID;
  v_total_price NUMERIC(10,2);
  v_deposit_percent NUMERIC(5,2) := 0;
  v_client_name TEXT := 'Cliente';
  v_staff_name TEXT := 'Profissional';
  v_services TEXT := 'Serviço';
  v_paid_amount NUMERIC(10,2);
  v_payment_label TEXT;
BEGIN
  IF NEW.status <> 'succeeded' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND COALESCE(OLD.status, '') = 'succeeded'
     AND OLD.appointment_id IS NOT DISTINCT FROM NEW.appointment_id THEN
    RETURN NEW;
  END IF;

  v_studio_id := NEW.studio_id;
  v_appointment_id := NEW.appointment_id;
  v_paid_amount := COALESCE(NEW.amount_cents, 0)::numeric / 100;

  IF v_appointment_id IS NULL AND NEW.booking_request_id IS NOT NULL THEN
    SELECT bpr.appointment_id, bpr.total_price, bpr.client_name, COALESCE(st.name, 'Profissional'), COALESCE(string_agg(sv.name, ', ' ORDER BY sv.name), 'Serviço')
    INTO v_appointment_id, v_total_price, v_client_name, v_staff_name, v_services
    FROM public.booking_payment_requests bpr
    LEFT JOIN public.staff st ON st.id = bpr.staff_id
    LEFT JOIN public.services sv ON sv.id = ANY(bpr.service_ids)
    WHERE bpr.id = NEW.booking_request_id
    GROUP BY bpr.appointment_id, bpr.total_price, bpr.client_name, st.name;
  END IF;

  IF v_appointment_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT a.total_price, COALESCE(c.name, 'Cliente'), COALESCE(stf.name, 'Profissional'), COALESCE(string_agg(sv.name, ', ' ORDER BY aps.id), 'Serviço')
  INTO v_total_price, v_client_name, v_staff_name, v_services
  FROM public.appointments a
  LEFT JOIN public.clients c ON c.id = a.client_id
  LEFT JOIN public.staff stf ON stf.id = a.staff_id
  LEFT JOIN public.appointment_services aps ON aps.appointment_id = a.id
  LEFT JOIN public.services sv ON sv.id = aps.service_id
  WHERE a.id = v_appointment_id
  GROUP BY a.total_price, c.name, stf.name;

  SELECT COALESCE(deposit_percent, 0)
  INTO v_deposit_percent
  FROM public.studios
  WHERE id = v_studio_id;

  v_payment_label := CASE
    WHEN v_total_price IS NOT NULL AND v_paid_amount >= v_total_price THEN 'Pagamento completo confirmado'
    WHEN v_deposit_percent >= 100 THEN 'Pagamento completo confirmado'
    ELSE 'Sinal confirmado'
  END;

  IF EXISTS (
    SELECT 1
    FROM public.studio_notifications sn
    WHERE sn.kind = 'payment_confirmed'
      AND sn.payload->>'payment_intent_id' = NEW.id::text
  ) THEN
    RETURN NEW;
  END IF;

  PERFORM public.insert_studio_notification(
    v_studio_id,
    'payment_confirmed',
    v_payment_label,
    v_client_name || ' pagou ' || to_char(v_paid_amount, 'FM999999990D00') || ' € online para ' || v_services || '.',
    jsonb_build_object(
      'appointment_id', v_appointment_id,
      'booking_request_id', NEW.booking_request_id,
      'payment_intent_id', NEW.id,
      'client_name', v_client_name,
      'staff_name', v_staff_name,
      'services', v_services,
      'paid_amount', v_paid_amount,
      'total_price', v_total_price,
      'payment_type', CASE WHEN v_total_price IS NOT NULL AND v_paid_amount >= v_total_price THEN 'full' ELSE 'deposit' END
    )
  );

  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.notify_payment_problem()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_studio_id UUID;
  v_client_name TEXT := 'Cliente';
  v_services TEXT := 'Serviço';
  v_amount NUMERIC(10,2);
BEGIN
  IF NEW.status NOT IN ('failed','canceled','expired') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND COALESCE(OLD.status, '') = NEW.status THEN
    RETURN NEW;
  END IF;

  v_studio_id := NEW.studio_id;
  v_amount := COALESCE(NEW.amount_cents, 0)::numeric / 100;

  IF NEW.booking_request_id IS NOT NULL THEN
    SELECT COALESCE(bpr.client_name, 'Cliente'), COALESCE(string_agg(sv.name, ', ' ORDER BY sv.name), 'Serviço')
    INTO v_client_name, v_services
    FROM public.booking_payment_requests bpr
    LEFT JOIN public.services sv ON sv.id = ANY(bpr.service_ids)
    WHERE bpr.id = NEW.booking_request_id
    GROUP BY bpr.client_name;
  ELSIF NEW.appointment_id IS NOT NULL THEN
    SELECT COALESCE(c.name, 'Cliente'), COALESCE(string_agg(sv.name, ', ' ORDER BY aps.id), 'Serviço')
    INTO v_client_name, v_services
    FROM public.appointments a
    LEFT JOIN public.clients c ON c.id = a.client_id
    LEFT JOIN public.appointment_services aps ON aps.appointment_id = a.id
    LEFT JOIN public.services sv ON sv.id = aps.service_id
    WHERE a.id = NEW.appointment_id
    GROUP BY c.name;
  END IF;

  PERFORM public.insert_studio_notification(
    v_studio_id,
    'payment_failed',
    'Pagamento não concluído',
    v_client_name || ' não concluiu o pagamento de ' || to_char(v_amount, 'FM999999990D00') || ' € para ' || v_services || '.',
    jsonb_build_object(
      'appointment_id', NEW.appointment_id,
      'booking_request_id', NEW.booking_request_id,
      'payment_intent_id', NEW.id,
      'status', NEW.status,
      'failure_reason', NEW.failure_reason
    )
  );

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_payment_confirmed_insert ON public.payment_intents;
CREATE TRIGGER trg_notify_payment_confirmed_insert
  AFTER INSERT ON public.payment_intents
  FOR EACH ROW EXECUTE FUNCTION public.notify_payment_confirmed();

DROP TRIGGER IF EXISTS trg_notify_payment_confirmed_update ON public.payment_intents;
CREATE TRIGGER trg_notify_payment_confirmed_update
  AFTER UPDATE OF status, appointment_id ON public.payment_intents
  FOR EACH ROW EXECUTE FUNCTION public.notify_payment_confirmed();

DROP TRIGGER IF EXISTS trg_notify_payment_problem_update ON public.payment_intents;
CREATE TRIGGER trg_notify_payment_problem_update
  AFTER UPDATE OF status ON public.payment_intents
  FOR EACH ROW EXECUTE FUNCTION public.notify_payment_problem();
