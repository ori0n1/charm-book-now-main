CREATE OR REPLACE FUNCTION public.notify_new_appointment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_appointment public.appointments%ROWTYPE;
  v_client_name TEXT := 'Cliente';
  v_staff_name TEXT := 'Profissional';
  v_services TEXT := U&'Servi\00E7o';
  v_tz TEXT := 'Europe/Lisbon';
  v_when TEXT;
BEGIN
  SELECT *
  INTO v_appointment
  FROM public.appointments
  WHERE id = NEW.appointment_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.studio_notifications sn
    WHERE sn.kind = 'new_appointment'
      AND sn.payload->>'appointment_id' = v_appointment.id::text
  ) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(c.name, 'Cliente')
  INTO v_client_name
  FROM public.clients c
  WHERE c.id = v_appointment.client_id;

  SELECT COALESCE(s.name, 'Profissional')
  INTO v_staff_name
  FROM public.staff s
  WHERE s.id = v_appointment.staff_id;

  SELECT COALESCE(st.timezone, 'Europe/Lisbon')
  INTO v_tz
  FROM public.studios st
  WHERE st.id = v_appointment.studio_id;

  SELECT COALESCE(string_agg(sv.name, ', ' ORDER BY aps.id), U&'Servi\00E7o')
  INTO v_services
  FROM public.appointment_services aps
  JOIN public.services sv ON sv.id = aps.service_id
  WHERE aps.appointment_id = v_appointment.id;

  v_when := to_char(v_appointment.starts_at AT TIME ZONE v_tz, 'DD/MM/YYYY HH24:MI');

  PERFORM public.insert_studio_notification(
    v_appointment.studio_id,
    'new_appointment',
    U&'Nova marca\00E7\00E3o recebida',
    v_client_name || ' marcou ' || v_services || ' com ' || v_staff_name || ' para ' || v_when || '.',
    jsonb_build_object(
      'appointment_id', v_appointment.id,
      'client_name', v_client_name,
      'staff_name', v_staff_name,
      'services', v_services,
      'starts_at', v_appointment.starts_at,
      'ends_at', v_appointment.ends_at,
      'total_price', v_appointment.total_price
    )
  );

  RETURN NEW;
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
  v_services TEXT := U&'Servi\00E7o';
  v_paid_amount NUMERIC(10,2);
  v_payment_label TEXT;
BEGIN
  IF NEW.status <> 'succeeded' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND COALESCE(OLD.status, '') = 'succeeded' THEN
    RETURN NEW;
  END IF;

  v_studio_id := NEW.studio_id;
  v_appointment_id := NEW.appointment_id;
  v_paid_amount := COALESCE(NEW.amount_cents, 0)::numeric / 100;

  IF v_appointment_id IS NULL AND NEW.booking_request_id IS NOT NULL THEN
    SELECT bpr.appointment_id, bpr.total_price, bpr.client_name, COALESCE(st.name, 'Profissional'), COALESCE(string_agg(sv.name, ', ' ORDER BY sv.name), U&'Servi\00E7o')
    INTO v_appointment_id, v_total_price, v_client_name, v_staff_name, v_services
    FROM public.booking_payment_requests bpr
    LEFT JOIN public.staff st ON st.id = bpr.staff_id
    LEFT JOIN public.services sv ON sv.id = ANY(bpr.service_ids)
    WHERE bpr.id = NEW.booking_request_id
    GROUP BY bpr.appointment_id, bpr.total_price, bpr.client_name, st.name;
  END IF;

  IF v_appointment_id IS NOT NULL THEN
    SELECT a.total_price, COALESCE(c.name, 'Cliente'), COALESCE(stf.name, 'Profissional'), COALESCE(string_agg(sv.name, ', ' ORDER BY aps.id), U&'Servi\00E7o')
    INTO v_total_price, v_client_name, v_staff_name, v_services
    FROM public.appointments a
    LEFT JOIN public.clients c ON c.id = a.client_id
    LEFT JOIN public.staff stf ON stf.id = a.staff_id
    LEFT JOIN public.appointment_services aps ON aps.appointment_id = a.id
    LEFT JOIN public.services sv ON sv.id = aps.service_id
    WHERE a.id = v_appointment_id
    GROUP BY a.total_price, c.name, stf.name;
  END IF;

  SELECT COALESCE(deposit_percent, 0)
  INTO v_deposit_percent
  FROM public.studios
  WHERE id = v_studio_id;

  v_payment_label := CASE
    WHEN v_total_price IS NOT NULL AND v_paid_amount >= v_total_price THEN 'Pagamento completo confirmado'
    WHEN v_deposit_percent >= 100 THEN 'Pagamento completo confirmado'
    ELSE 'Sinal confirmado'
  END;

  PERFORM public.insert_studio_notification(
    v_studio_id,
    'payment_confirmed',
    v_payment_label,
    v_client_name || ' pagou ' || to_char(v_paid_amount, 'FM999999990D00') || U&' \20AC online para ' || v_services || '.',
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

CREATE OR REPLACE FUNCTION pg_temp.bellza_clean_text(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT replace(
    replace(
    replace(
    replace(
    replace(
    replace(
    replace(
    replace(
    replace(
    replace(
    replace(
    replace(
    replace(
    replace(
    replace(
    replace(
    replace(
    replace(
    replace(
    replace(
    COALESCE(value, ''),
      U&'Servi\00C3\00A7o', U&'Servi\00E7o'),
      U&'servi\00C3\00A7o', U&'servi\00E7o'),
      U&'marca\00C3\00A7\00C3\00A3o', U&'marca\00E7\00E3o'),
      U&'marca\00C3\00A7\00C3\00B5es', U&'marca\00E7\00F5es'),
      U&'Marca\00C3\00A7\00C3\00A3o', U&'Marca\00E7\00E3o'),
      U&'Nova marca\00C3\00A7\00C3\00A3o recebida', U&'Nova marca\00E7\00E3o recebida'),
      U&'Notifica\00C3\00A7\00C3\00B5es', U&'Notifica\00E7\00F5es'),
      U&'notifica\00C3\00A7\00C3\00B5es', U&'notifica\00E7\00F5es'),
      U&'dispon\00C3\00ADvel', U&'dispon\00EDvel'),
      U&'Conclu\00C3\00ADdo', U&'Conclu\00EDdo'),
      U&'N\00C3\00A3o', U&'N\00E3o'),
      U&'n\00C3\00A3o', U&'n\00E3o'),
      U&'v\00C3\00A1lido', U&'v\00E1lido'),
      U&'transfer\00C3\00AAncia', U&'transfer\00EAncia'),
      U&'Transfer\00C3\00AAncia', U&'Transfer\00EAncia'),
      U&'Ol\00C3\00A1', U&'Ol\00E1'),
      U&'est\00C3\00A1', U&'est\00E1'),
      U&'\00C3\00A0s', U&'\00E0s'),
      U&'est\00C3\00BAdio', U&'est\00FAdio'),
      U&'\00E2\201A\00AC', U&'\20AC')
$$;

UPDATE public.studio_notifications
SET
  title = pg_temp.bellza_clean_text(title),
  body = replace(pg_temp.bellza_clean_text(body), U&'\00C2\00B7', U&'\00B7')
WHERE title IS NOT NULL
   OR body IS NOT NULL;

UPDATE public.studios
SET whatsapp_default_message = replace(
  pg_temp.bellza_clean_text(whatsapp_default_message),
  U&'\00C2\00B7',
  U&'\00B7'
)
WHERE whatsapp_default_message IS NOT NULL;

NOTIFY pgrst, 'reload schema';
