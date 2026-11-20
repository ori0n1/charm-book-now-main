-- Run only on the bellza-finance-full disposable database. psql ON_ERROR_STOP required.
-- Stage the adjacent migration under /tmp/loyalty_manager_patch.sql;
-- this test's transaction ROLLBACKs the migration and all fixture rows.
-- The local fixture predates agenda role parity; adjust that one existing role
-- predicate inside this transaction to exercise the already published pathway.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
DO $local_fixture$
DECLARE v_definition text;
BEGIN
  v_definition := pg_get_functiondef('public.edit_owner_resolved_appointment(uuid,uuid,text,timestamptz,jsonb,numeric,text,uuid)'::regprocedure);
  IF length(v_definition) - length(replace(v_definition, 'role IN (''studio_owner'',''saas_owner'')', ''))
     <> length('role IN (''studio_owner'',''saas_owner'')') THEN
    RAISE EXCEPTION 'local_financial_editor_fixture_drift';
  END IF;
  EXECUTE replace(v_definition, 'role IN (''studio_owner'',''saas_owner'')',
    'role IN (''studio_owner'',''saas_owner'',''manager'')');
END;
$local_fixture$;

\i /tmp/loyalty_manager_patch.sql

INSERT INTO public.appointments
  (id,studio_id,staff_id,client_id,starts_at,ends_at,status,total_price,
   total_duration_min,studio_commission_percent_snapshot,notification_suppressed)
VALUES ('8f000000-0000-4000-8000-000000000091',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'aaaaaaaa-5000-4000-8000-000000000001',
  'aaaaaaaa-7000-4000-8000-000000000001',
  now()+interval '3 days',now()+interval '3 days 1 hour','confirmed',20,60,0,true);
INSERT INTO public.appointment_services
  (id,appointment_id,service_id,price,duration_min,studio_commission_percent_snapshot)
VALUES ('8e000000-0000-4000-8000-000000000091',
  '8f000000-0000-4000-8000-000000000091',
  'aaaaaaaa-6000-4000-8000-000000000001',20,60,0);
INSERT INTO public.customer_loyalty_stamp_entries
  (studio_id,client_id,source_type,stamps,note)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'aaaaaaaa-7000-4000-8000-000000000001','manual',10,'QA local reversível');
INSERT INTO public.customer_loyalty_rewards
  (studio_id,client_id,reward_type,reward_value,stamps_required,redemption_code,apply_when)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'aaaaaaaa-7000-4000-8000-000000000001','fixed',5,5,'QAMANAGERONLY01','next');

DO $assert$
DECLARE
  v_studio uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_appointment uuid := '8f000000-0000-4000-8000-000000000091';
  v_manager uuid := 'fe8fe541-ab42-49e5-8dcb-a4c7e12b3ef9';
  v_staff uuid := 'c4ceb8b7-f83b-4d37-a35d-8719a956e9fe';
  v_result jsonb;
BEGIN
  BEGIN
    PERFORM public.redeem_customer_loyalty_discount(v_studio,'QAMANAGERONLY01',v_appointment,v_staff);
    RAISE EXCEPTION 'ordinary_staff_redeemed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'loyalty_redeemer_required' THEN RAISE; END IF;
  END;

  v_result := public.redeem_customer_loyalty_discount(v_studio,'QAMANAGERONLY01',v_appointment,v_manager);
  IF (v_result->>'discountCents')::integer <> 500
     OR (SELECT total_price FROM public.appointments WHERE id=v_appointment) <> 15
     OR (SELECT count(*) FROM public.customer_loyalty_stamp_entries
         WHERE source_type='reward_redeemed' AND source_appointment_id=v_appointment) <> 1
     OR (SELECT sum(stamps) FROM public.customer_loyalty_stamp_entries
         WHERE source_type='reward_redeemed' AND source_appointment_id=v_appointment) <> -5 THEN
    RAISE EXCEPTION 'manager_redemption_incorrect';
  END IF;

  BEGIN
    PERFORM public.redeem_customer_loyalty_discount(v_studio,'QAMANAGERONLY01',v_appointment,v_manager);
    RAISE EXCEPTION 'duplicate_manager_redemption';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'reward_not_available' THEN RAISE; END IF;
  END;
END;
$assert$;
SELECT 'LOYALTY_MANAGER_REDEMPTION_OK';
ROLLBACK;
