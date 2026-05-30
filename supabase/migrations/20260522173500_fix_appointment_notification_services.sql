DROP TRIGGER IF EXISTS trg_notify_new_appointment ON public.appointments;
DROP TRIGGER IF EXISTS trg_notify_new_appointment_service ON public.appointment_services;

CREATE OR REPLACE FUNCTION public.notify_new_appointment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_appointment public.appointments%ROWTYPE;
  v_client_name TEXT := 'Cliente';
  v_staff_name TEXT := 'Profissional';
  v_services TEXT := 'Serviço';
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

  SELECT COALESCE(string_agg(sv.name, ', ' ORDER BY aps.id), 'Serviço')
  INTO v_services
  FROM public.appointment_services aps
  JOIN public.services sv ON sv.id = aps.service_id
  WHERE aps.appointment_id = v_appointment.id;

  v_when := to_char(v_appointment.starts_at AT TIME ZONE v_tz, 'DD/MM/YYYY HH24:MI');

  PERFORM public.insert_studio_notification(
    v_appointment.studio_id,
    'new_appointment',
    'Nova marcação recebida',
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

CREATE TRIGGER trg_notify_new_appointment_service
  AFTER INSERT ON public.appointment_services
  FOR EACH ROW EXECUTE FUNCTION public.notify_new_appointment();
