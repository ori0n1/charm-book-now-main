-- Additive tenant-boundary constraints. Every relationship checked below has
-- zero tenant mismatches in the linked schema as of 2026-09-19. No rows are
-- rewritten and no table or customer data is removed.

CREATE UNIQUE INDEX IF NOT EXISTS clients_id_studio_id_unique
  ON public.clients (id, studio_id);
CREATE UNIQUE INDEX IF NOT EXISTS staff_id_studio_id_unique
  ON public.staff (id, studio_id);

ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_client_same_studio
    FOREIGN KEY (client_id, studio_id) REFERENCES public.clients (id, studio_id)
    NOT VALID,
  ADD CONSTRAINT appointments_staff_same_studio
    FOREIGN KEY (staff_id, studio_id) REFERENCES public.staff (id, studio_id)
    NOT VALID;

ALTER TABLE public.appointments VALIDATE CONSTRAINT appointments_client_same_studio;
ALTER TABLE public.appointments VALIDATE CONSTRAINT appointments_staff_same_studio;

-- Tenant ownership is an identity, not an editable attribute. A deliberate
-- business transfer must copy records through a separately audited workflow.
CREATE OR REPLACE FUNCTION public.reject_tenant_reassignment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.studio_id IS DISTINCT FROM OLD.studio_id THEN
    RAISE EXCEPTION 'studio_id_is_immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.reject_tenant_reassignment() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_clients_studio_immutable
  BEFORE UPDATE OF studio_id ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.reject_tenant_reassignment();
CREATE TRIGGER trg_staff_studio_immutable
  BEFORE UPDATE OF studio_id ON public.staff
  FOR EACH ROW EXECUTE FUNCTION public.reject_tenant_reassignment();
CREATE TRIGGER trg_services_studio_immutable
  BEFORE UPDATE OF studio_id ON public.services
  FOR EACH ROW EXECUTE FUNCTION public.reject_tenant_reassignment();
CREATE TRIGGER trg_appointments_studio_immutable
  BEFORE UPDATE OF studio_id ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.reject_tenant_reassignment();
CREATE TRIGGER trg_booking_payment_requests_studio_immutable
  BEFORE UPDATE OF studio_id ON public.booking_payment_requests
  FOR EACH ROW EXECUTE FUNCTION public.reject_tenant_reassignment();
CREATE TRIGGER trg_payment_intents_studio_immutable
  BEFORE UPDATE OF studio_id ON public.payment_intents
  FOR EACH ROW EXECUTE FUNCTION public.reject_tenant_reassignment();
CREATE TRIGGER trg_refund_requests_studio_immutable
  BEFORE UPDATE OF studio_id ON public.refund_requests
  FOR EACH ROW EXECUTE FUNCTION public.reject_tenant_reassignment();

-- These join tables have no studio_id of their own. Validate both parents in
-- a definer trigger so the check cannot be bypassed by row visibility.
CREATE OR REPLACE FUNCTION public.assert_tenant_join_consistency()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF TG_TABLE_NAME = 'appointment_services' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.appointments a
      JOIN public.services s ON s.id = NEW.service_id AND s.studio_id = a.studio_id
      WHERE a.id = NEW.appointment_id
    ) THEN
      RAISE EXCEPTION 'tenant_link_mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'staff_services' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.staff st
      JOIN public.services s ON s.id = NEW.service_id AND s.studio_id = st.studio_id
      WHERE st.id = NEW.staff_id
    ) THEN
      RAISE EXCEPTION 'tenant_link_mismatch' USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'unsupported_tenant_link_table' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.assert_tenant_join_consistency() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_appointment_services_same_studio
  BEFORE INSERT OR UPDATE OF appointment_id, service_id ON public.appointment_services
  FOR EACH ROW EXECUTE FUNCTION public.assert_tenant_join_consistency();
CREATE TRIGGER trg_staff_services_same_studio
  BEFORE INSERT OR UPDATE OF staff_id, service_id ON public.staff_services
  FOR EACH ROW EXECUTE FUNCTION public.assert_tenant_join_consistency();

-- Financial objects must not point to another studio's booking or payment,
-- even when created by service_role or a future backend path.
CREATE OR REPLACE FUNCTION public.assert_financial_tenant_links()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF TG_TABLE_NAME = 'booking_payment_requests' THEN
    IF NEW.staff_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.staff st
      WHERE st.id = NEW.staff_id AND st.studio_id = NEW.studio_id
    ) THEN
      RAISE EXCEPTION 'tenant_link_mismatch' USING ERRCODE = '23514';
    END IF;
    IF NEW.appointment_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.appointments a
      WHERE a.id = NEW.appointment_id AND a.studio_id = NEW.studio_id
    ) THEN
      RAISE EXCEPTION 'tenant_link_mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'payment_intents' THEN
    IF NEW.appointment_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.appointments a
      WHERE a.id = NEW.appointment_id AND a.studio_id = NEW.studio_id
    ) THEN
      RAISE EXCEPTION 'tenant_link_mismatch' USING ERRCODE = '23514';
    END IF;
    IF NEW.booking_request_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.booking_payment_requests b
      WHERE b.id = NEW.booking_request_id AND b.studio_id = NEW.studio_id
    ) THEN
      RAISE EXCEPTION 'tenant_link_mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'refund_requests' THEN
    IF NEW.appointment_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.appointments a
      WHERE a.id = NEW.appointment_id AND a.studio_id = NEW.studio_id
    ) THEN
      RAISE EXCEPTION 'tenant_link_mismatch' USING ERRCODE = '23514';
    END IF;
    IF NEW.booking_request_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.booking_payment_requests b
      WHERE b.id = NEW.booking_request_id AND b.studio_id = NEW.studio_id
    ) THEN
      RAISE EXCEPTION 'tenant_link_mismatch' USING ERRCODE = '23514';
    END IF;
    IF NEW.payment_intent_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.payment_intents p
      WHERE p.id = NEW.payment_intent_id AND p.studio_id = NEW.studio_id
    ) THEN
      RAISE EXCEPTION 'tenant_link_mismatch' USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'unsupported_financial_link_table' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.assert_financial_tenant_links() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_booking_payment_requests_same_studio
  BEFORE INSERT OR UPDATE OF studio_id, staff_id, appointment_id
  ON public.booking_payment_requests
  FOR EACH ROW EXECUTE FUNCTION public.assert_financial_tenant_links();
CREATE TRIGGER trg_payment_intents_same_studio
  BEFORE INSERT OR UPDATE OF studio_id, appointment_id, booking_request_id
  ON public.payment_intents
  FOR EACH ROW EXECUTE FUNCTION public.assert_financial_tenant_links();
CREATE TRIGGER trg_refund_requests_same_studio
  BEFORE INSERT OR UPDATE OF studio_id, appointment_id, booking_request_id, payment_intent_id
  ON public.refund_requests
  FOR EACH ROW EXECUTE FUNCTION public.assert_financial_tenant_links();
