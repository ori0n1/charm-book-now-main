-- Immutable commission snapshots for appointment reporting.
-- Existing monetary values are not changed. Historical rows are frozen using
-- the effective configuration available at migration time because an earlier
-- configuration cannot be reconstructed safely.

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS studio_commission_percent_snapshot numeric(5,2);

ALTER TABLE public.appointment_services
  ADD COLUMN IF NOT EXISTS studio_commission_percent_snapshot numeric(5,2);

ALTER TABLE public.appointments
  DROP CONSTRAINT IF EXISTS appointments_studio_commission_snapshot_range;
ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_studio_commission_snapshot_range
  CHECK (
    studio_commission_percent_snapshot IS NULL OR
    studio_commission_percent_snapshot BETWEEN 0 AND 100
  );

ALTER TABLE public.appointment_services
  DROP CONSTRAINT IF EXISTS appointment_services_studio_commission_snapshot_range;
ALTER TABLE public.appointment_services
  ADD CONSTRAINT appointment_services_studio_commission_snapshot_range
  CHECK (
    studio_commission_percent_snapshot IS NULL OR
    studio_commission_percent_snapshot BETWEEN 0 AND 100
  );

UPDATE public.appointments a
SET studio_commission_percent_snapshot = COALESCE(
  (SELECT st.commission_percent FROM public.staff st WHERE st.id = a.staff_id),
  (SELECT s.commission_percent FROM public.studios s WHERE s.id = a.studio_id),
  0
)
WHERE a.studio_commission_percent_snapshot IS NULL;

UPDATE public.appointment_services aps
SET studio_commission_percent_snapshot = COALESCE(
  svc.commission_percent,
  a.studio_commission_percent_snapshot,
  0
)
FROM public.appointments a, public.services svc
WHERE a.id = aps.appointment_id
  AND svc.id = aps.service_id
  AND aps.studio_commission_percent_snapshot IS NULL;

ALTER TABLE public.appointments
  ALTER COLUMN studio_commission_percent_snapshot SET NOT NULL;
ALTER TABLE public.appointment_services
  ALTER COLUMN studio_commission_percent_snapshot SET NOT NULL;

CREATE OR REPLACE FUNCTION public.capture_appointment_commission_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  SELECT COALESCE(st.commission_percent, s.commission_percent, 0)
  INTO NEW.studio_commission_percent_snapshot
  FROM public.studios s
  LEFT JOIN public.staff st ON st.id = NEW.staff_id AND st.studio_id = s.id
  WHERE s.id = NEW.studio_id;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_capture_appointment_commission_snapshot ON public.appointments;
CREATE TRIGGER trg_capture_appointment_commission_snapshot
BEFORE INSERT OR UPDATE OF staff_id, studio_id ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.capture_appointment_commission_snapshot();

CREATE OR REPLACE FUNCTION public.refresh_reassigned_appointment_line_commissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- A future/active appointment reassigned to another professional must use
  -- that professional's rule. Closed history remains immutable.
  IF NEW.staff_id IS DISTINCT FROM OLD.staff_id
     AND NEW.status NOT IN ('completed', 'cancelled', 'no_show') THEN
    UPDATE public.appointment_services aps
    SET studio_commission_percent_snapshot = COALESCE(
      svc.commission_percent,
      NEW.studio_commission_percent_snapshot,
      0
    )
    FROM public.services svc
    WHERE aps.appointment_id = NEW.id
      AND svc.id = aps.service_id;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_refresh_reassigned_appointment_line_commissions
  ON public.appointments;
CREATE TRIGGER trg_refresh_reassigned_appointment_line_commissions
AFTER UPDATE OF staff_id ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.refresh_reassigned_appointment_line_commissions();

CREATE OR REPLACE FUNCTION public.capture_appointment_service_commission_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  SELECT COALESCE(svc.commission_percent, a.studio_commission_percent_snapshot, 0)
  INTO NEW.studio_commission_percent_snapshot
  FROM public.appointments a
  JOIN public.services svc ON svc.id = NEW.service_id AND svc.studio_id = a.studio_id
  WHERE a.id = NEW.appointment_id;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_capture_appointment_service_commission_snapshot
  ON public.appointment_services;
CREATE TRIGGER trg_capture_appointment_service_commission_snapshot
BEFORE INSERT OR UPDATE OF appointment_id, service_id ON public.appointment_services
FOR EACH ROW EXECUTE FUNCTION public.capture_appointment_service_commission_snapshot();

COMMENT ON COLUMN public.appointments.studio_commission_percent_snapshot IS
  'Effective studio percentage frozen when the appointment is created or reassigned.';
COMMENT ON COLUMN public.appointment_services.studio_commission_percent_snapshot IS
  'Effective service/staff/studio percentage frozen for this appointment line.';
