-- Run only against the disposable local schema. Synthetic rows never commit.
BEGIN;

INSERT INTO public.studios (id, slug, name) VALUES
  ('00000000-0000-0000-0000-000000000101', 'synthetic-tenant-a', 'Synthetic Tenant A'),
  ('00000000-0000-0000-0000-000000000102', 'synthetic-tenant-b', 'Synthetic Tenant B');
INSERT INTO public.staff (id, studio_id, name) VALUES
  ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000101', 'Synthetic Staff A'),
  ('00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000102', 'Synthetic Staff B');
INSERT INTO public.clients (id, studio_id, name, phone) VALUES
  ('00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000101', 'Synthetic Client A', '+351000000001'),
  ('00000000-0000-0000-0000-000000000402', '00000000-0000-0000-0000-000000000102', 'Synthetic Client B', '+351000000002');
INSERT INTO public.services (id, studio_id, name, duration_min, price) VALUES
  ('00000000-0000-0000-0000-000000000601', '00000000-0000-0000-0000-000000000101', 'Synthetic Service A', 60, 10),
  ('00000000-0000-0000-0000-000000000602', '00000000-0000-0000-0000-000000000102', 'Synthetic Service B', 60, 10);
INSERT INTO public.appointments (
  id, studio_id, staff_id, client_id, starts_at, ends_at, studio_commission_percent_snapshot
) VALUES
  ('00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000101',
   '00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000401',
   '2030-01-01T10:00:00Z', '2030-01-01T11:00:00Z', 50),
  ('00000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-000000000102',
   '00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000402',
   '2030-01-01T10:00:00Z', '2030-01-01T11:00:00Z', 50);

-- Same-tenant paths must continue to work.
INSERT INTO public.staff_services (staff_id, service_id)
VALUES ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000601');
INSERT INTO public.appointment_services (
  appointment_id, service_id, price, duration_min, studio_commission_percent_snapshot
) VALUES (
  '00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000601', 10, 60, 50
);
INSERT INTO public.booking_payment_requests (
  id, studio_id, staff_id, service_ids, starts_at, ends_at, client_name, client_phone
) VALUES (
  '00000000-0000-0000-0000-000000000701', '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000301',
  ARRAY['00000000-0000-0000-0000-000000000601'::uuid],
  '2030-01-02T10:00:00Z', '2030-01-02T11:00:00Z', 'Synthetic Client A', '+351000000001'
);
INSERT INTO public.payment_intents (
  id, studio_id, appointment_id, amount_cents, method
) VALUES (
  '00000000-0000-0000-0000-000000000801', '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000501', 1000, 'card'
);
INSERT INTO public.refund_requests (
  id, studio_id, appointment_id, payment_intent_id, reason
) VALUES (
  '00000000-0000-0000-0000-000000000901', '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000501',
  '00000000-0000-0000-0000-000000000801', 'synthetic'
);

-- The relationship guards must apply even when RLS is bypassed by service_role.
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $test$
BEGIN
  BEGIN
    INSERT INTO public.staff_services (staff_id, service_id)
    VALUES ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000602');
    RAISE EXCEPTION 'cross_tenant_staff_service_was_accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'tenant_link_mismatch' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.appointment_services (
      appointment_id, service_id, price, duration_min, studio_commission_percent_snapshot
    ) VALUES ('00000000-0000-0000-0000-000000000501',
      '00000000-0000-0000-0000-000000000602', 10, 60, 50);
    RAISE EXCEPTION 'cross_tenant_appointment_service_was_accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'tenant_link_mismatch' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.booking_payment_requests (
      studio_id, staff_id, service_ids, starts_at, ends_at, client_name, client_phone
    ) VALUES ('00000000-0000-0000-0000-000000000102',
      '00000000-0000-0000-0000-000000000301',
      ARRAY['00000000-0000-0000-0000-000000000602'::uuid],
      '2030-01-03T10:00:00Z', '2030-01-03T11:00:00Z', 'Synthetic B', '+351000000002');
    RAISE EXCEPTION 'cross_tenant_booking_staff_was_accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'tenant_link_mismatch' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.booking_payment_requests (
      studio_id, staff_id, service_ids, starts_at, ends_at, client_name, client_phone
    ) VALUES ('00000000-0000-0000-0000-000000000101',
      '00000000-0000-0000-0000-000000000301',
      ARRAY['00000000-0000-0000-0000-000000000601'::uuid,
            '00000000-0000-0000-0000-000000000602'::uuid],
      '2030-01-03T10:00:00Z', '2030-01-03T11:00:00Z', 'Synthetic A', '+351000000001');
    RAISE EXCEPTION 'cross_tenant_booking_service_array_was_accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'booking_service_ids_tenant_mismatch' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.booking_payment_requests
    SET service_ids = ARRAY['00000000-0000-0000-0000-000000000601'::uuid,
                            '00000000-0000-0000-0000-000000000999'::uuid]
    WHERE id = '00000000-0000-0000-0000-000000000701';
    RAISE EXCEPTION 'missing_booking_service_was_accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'booking_service_ids_tenant_mismatch' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.payment_intents (studio_id, appointment_id, amount_cents, method)
    VALUES ('00000000-0000-0000-0000-000000000102',
      '00000000-0000-0000-0000-000000000501', 1000, 'card');
    RAISE EXCEPTION 'cross_tenant_payment_appointment_was_accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'tenant_link_mismatch' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.refund_requests (studio_id, payment_intent_id, reason)
    VALUES ('00000000-0000-0000-0000-000000000102',
      '00000000-0000-0000-0000-000000000801', 'synthetic');
    RAISE EXCEPTION 'cross_tenant_refund_payment_was_accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'tenant_link_mismatch' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.services SET studio_id = '00000000-0000-0000-0000-000000000102'
    WHERE id = '00000000-0000-0000-0000-000000000601';
    RAISE EXCEPTION 'tenant_reassignment_was_accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'studio_id_is_immutable' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'tenant_relationship_invariants_passed';
END
$test$;

ROLLBACK;
