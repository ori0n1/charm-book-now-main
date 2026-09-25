-- Group attendance prompts by studio and local day.
-- Financial data, appointment statuses and historical notifications are untouched.

CREATE OR REPLACE FUNCTION public.group_attendance_confirmation_notification()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_timezone text := 'Europe/Lisbon';
  v_local_date date;
  v_event_key text;
BEGIN
  IF NEW.kind <> 'attendance_confirmation' THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(nullif(timezone, ''), 'Europe/Lisbon')
  INTO v_timezone
  FROM public.studios
  WHERE id = NEW.studio_id;

  BEGIN
    v_local_date := (
      coalesce(nullif(NEW.payload->>'starts_at', '')::timestamptz, now())
      AT TIME ZONE v_timezone
    )::date;
  EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow THEN
    v_local_date := (now() AT TIME ZONE v_timezone)::date;
  END;

  v_event_key := 'attendance_confirmation:' || NEW.studio_id::text || ':' || v_local_date::text;
  NEW.title := 'Atendimentos por confirmar';
  NEW.body := 'Existem atendimentos pendentes. Abra a Agenda para resolver todos de uma vez.';
  NEW.event_key := v_event_key;
  NEW.action_url := '/admin/agenda?pendencias=1';
  NEW.payload := (coalesce(NEW.payload, '{}'::jsonb) - 'appointment_id' - 'client_id') ||
    jsonb_build_object(
      'event_key', v_event_key,
      'local_date', v_local_date,
      'action_url', NEW.action_url,
      'grouped', true
    );
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_group_attendance_confirmation_notification
  ON public.studio_notifications;
CREATE TRIGGER trg_group_attendance_confirmation_notification
BEFORE INSERT ON public.studio_notifications
FOR EACH ROW
WHEN (NEW.kind = 'attendance_confirmation')
EXECUTE FUNCTION public.group_attendance_confirmation_notification();
