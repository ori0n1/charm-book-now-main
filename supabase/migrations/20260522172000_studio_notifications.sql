CREATE TABLE IF NOT EXISTS public.studio_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id UUID NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('new_appointment','payment_confirmed')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_studio_notifications_studio_created
  ON public.studio_notifications(studio_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_studio_notifications_unread
  ON public.studio_notifications(studio_id, created_at DESC)
  WHERE read_at IS NULL;

ALTER TABLE public.studio_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read studio notifications" ON public.studio_notifications;
CREATE POLICY "Members read studio notifications" ON public.studio_notifications
  FOR SELECT TO authenticated
  USING (public.is_studio_member(auth.uid(), studio_id));

DROP POLICY IF EXISTS "Members update studio notifications" ON public.studio_notifications;
CREATE POLICY "Members update studio notifications" ON public.studio_notifications
  FOR UPDATE TO authenticated
  USING (public.is_studio_member(auth.uid(), studio_id))
  WITH CHECK (public.is_studio_member(auth.uid(), studio_id));

CREATE OR REPLACE FUNCTION public.insert_studio_notification(
  p_studio_id UUID,
  p_kind TEXT,
  p_title TEXT,
  p_body TEXT,
  p_payload JSONB DEFAULT '{}'::jsonb
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.studio_notifications (studio_id, kind, title, body, payload)
  VALUES (p_studio_id, p_kind, p_title, p_body, COALESCE(p_payload, '{}'::jsonb))
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.notify_new_appointment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_client_name TEXT := 'Cliente';
  v_staff_name TEXT := 'Profissional';
  v_services TEXT := 'Serviço';
  v_tz TEXT := 'Europe/Lisbon';
  v_when TEXT;
BEGIN
  SELECT COALESCE(c.name, 'Cliente')
  INTO v_client_name
  FROM public.clients c
  WHERE c.id = NEW.client_id;

  SELECT COALESCE(s.name, 'Profissional')
  INTO v_staff_name
  FROM public.staff s
  WHERE s.id = NEW.staff_id;

  SELECT COALESCE(st.timezone, 'Europe/Lisbon')
  INTO v_tz
  FROM public.studios st
  WHERE st.id = NEW.studio_id;

  SELECT COALESCE(string_agg(sv.name, ', ' ORDER BY aps.id), 'Serviço')
  INTO v_services
  FROM public.appointment_services aps
  JOIN public.services sv ON sv.id = aps.service_id
  WHERE aps.appointment_id = NEW.id;

  v_when := to_char(NEW.starts_at AT TIME ZONE v_tz, 'DD/MM/YYYY HH24:MI');

  PERFORM public.insert_studio_notification(
    NEW.studio_id,
    'new_appointment',
    'Nova marcação recebida',
    v_client_name || ' marcou ' || v_services || ' com ' || v_staff_name || ' para ' || v_when || '.',
    jsonb_build_object(
      'appointment_id', NEW.id,
      'client_name', v_client_name,
      'staff_name', v_staff_name,
      'services', v_services,
      'starts_at', NEW.starts_at,
      'ends_at', NEW.ends_at,
      'total_price', NEW.total_price
    )
  );

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_new_appointment ON public.appointments;
CREATE TRIGGER trg_notify_new_appointment
  AFTER INSERT ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.notify_new_appointment();

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

  IF TG_OP = 'UPDATE' AND COALESCE(OLD.status, '') = 'succeeded' THEN
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

  IF v_appointment_id IS NOT NULL THEN
    SELECT a.total_price, COALESCE(c.name, 'Cliente'), COALESCE(stf.name, 'Profissional'), COALESCE(string_agg(sv.name, ', ' ORDER BY aps.id), 'Serviço')
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

DROP TRIGGER IF EXISTS trg_notify_payment_confirmed_insert ON public.payment_intents;
CREATE TRIGGER trg_notify_payment_confirmed_insert
  AFTER INSERT ON public.payment_intents
  FOR EACH ROW EXECUTE FUNCTION public.notify_payment_confirmed();

DROP TRIGGER IF EXISTS trg_notify_payment_confirmed_update ON public.payment_intents;
CREATE TRIGGER trg_notify_payment_confirmed_update
  AFTER UPDATE OF status ON public.payment_intents
  FOR EACH ROW EXECUTE FUNCTION public.notify_payment_confirmed();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'studio_notifications'
    ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.studio_notifications';
  END IF;
END $$;
