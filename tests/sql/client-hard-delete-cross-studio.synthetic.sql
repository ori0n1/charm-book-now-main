-- Execute only on a disposable local database with the candidate migration.
-- Each transaction rolls back all synthetic rows.
BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
  ('11111111-1111-1111-1111-111111111111','owner@example.invalid',now()),
  ('22222222-2222-2222-2222-222222222222','client@example.invalid',now());
INSERT INTO public.studios(id,slug) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','synthetic-a'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','synthetic-b');
INSERT INTO public.user_roles(user_id,studio_id,role) VALUES
  ('11111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','studio_owner');
INSERT INTO public.clients(id,studio_id,name,phone,email,auth_user_id) VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccc01','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Target','+351911111111','client@example.invalid','22222222-2222-2222-2222-222222222222'),
  ('cccccccc-cccc-cccc-cccc-cccccccccc02','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Other studio','+351911111111','client@example.invalid','22222222-2222-2222-2222-222222222222'),
  ('cccccccc-cccc-cccc-cccc-cccccccccc03','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Referred','+351922222222',NULL,NULL);
INSERT INTO public.appointments(id,studio_id,client_id,status,total_price) VALUES
  ('dddddddd-dddd-dddd-dddd-dddddddddd01','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','cccccccc-cccc-cccc-cccc-cccccccccc01','completed',42),
  ('dddddddd-dddd-dddd-dddd-dddddddddd02','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','cccccccc-cccc-cccc-cccc-cccccccccc03','completed',17);
INSERT INTO public.payment_intents(id,appointment_id) VALUES
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01','dddddddd-dddd-dddd-dddd-dddddddddd01');
INSERT INTO public.cash_register_movements(studio_id,appointment_id,movement_type,amount) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','dddddddd-dddd-dddd-dddd-dddddddddd01','payment',42);
INSERT INTO public.booking_policy_acceptances VALUES
  ('10000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','cccccccc-cccc-cccc-cccc-cccccccccc01');
INSERT INTO public.client_manual_whatsapp_confirmations VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','cccccccc-cccc-cccc-cccc-cccccccccc01');
INSERT INTO public.customer_loyalty_rewards(id,studio_id,client_id,status) VALUES
  ('10000000-0000-0000-0000-000000000002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','cccccccc-cccc-cccc-cccc-cccccccccc01','earned');
INSERT INTO public.customer_loyalty_stamp_entries(id,studio_id,client_id,status) VALUES
  ('10000000-0000-0000-0000-000000000003','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','cccccccc-cccc-cccc-cccc-cccccccccc01','earned');
INSERT INTO public.customer_referral_codes VALUES
  ('10000000-0000-0000-0000-000000000004','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','cccccccc-cccc-cccc-cccc-cccccccccc01','SYNTHETIC');
INSERT INTO public.customer_referrals VALUES
  ('10000000-0000-0000-0000-000000000005','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','cccccccc-cccc-cccc-cccc-cccccccccc01','cccccccc-cccc-cccc-cccc-cccccccccc03',NULL,'rejected','existing_client',true);
INSERT INTO public.manual_service_entries VALUES
  ('10000000-0000-0000-0000-000000000006','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','cccccccc-cccc-cccc-cccc-cccccccccc01',17,'received');
INSERT INTO public.push_subscriptions VALUES
  ('10000000-0000-0000-0000-000000000007','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','cccccccc-cccc-cccc-cccc-cccccccccc01');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
DO $$ BEGIN
  IF (SELECT outcome FROM public.delete_clients_for_owner(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    ARRAY['cccccccc-cccc-cccc-cccc-cccccccccc01']::uuid[],'EXCLUIR')) <> 'deleted'
  THEN RAISE EXCEPTION 'normal delete failed'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.clients WHERE id='cccccccc-cccc-cccc-cccc-cccccccccc01') THEN RAISE EXCEPTION 'profile retained'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id='cccccccc-cccc-cccc-cccc-cccccccccc02') THEN RAISE EXCEPTION 'other studio profile lost'; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id='22222222-2222-2222-2222-222222222222') THEN RAISE EXCEPTION 'global account lost'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.appointments WHERE id='dddddddd-dddd-dddd-dddd-dddddddddd01' AND client_id IS NULL AND status='completed' AND total_price=42) THEN RAISE EXCEPTION 'appointment changed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.payment_intents WHERE appointment_id='dddddddd-dddd-dddd-dddd-dddddddddd01') THEN RAISE EXCEPTION 'payment lost'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cash_register_movements WHERE appointment_id='dddddddd-dddd-dddd-dddd-dddddddddd01' AND amount=42) THEN RAISE EXCEPTION 'cash history lost'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customer_referrals WHERE id='10000000-0000-0000-0000-000000000005' AND referrer_client_id IS NULL AND status='rejected' AND rejection_reason='existing_client') THEN RAISE EXCEPTION 'referral state changed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customer_loyalty_rewards WHERE client_id IS NULL AND status='earned') THEN RAISE EXCEPTION 'reward lost'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customer_loyalty_stamp_entries WHERE client_id IS NULL AND status='earned') THEN RAISE EXCEPTION 'stamp lost'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.manual_service_entries WHERE client_id IS NULL AND amount=17 AND status='received') THEN RAISE EXCEPTION 'manual financial entry lost'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.client_removal_audit WHERE client_id='cccccccc-cccc-cccc-cccc-cccccccccc01' AND action='delete_client') THEN RAISE EXCEPTION 'audit missing'; END IF;
END $$;
INSERT INTO public.clients(id,studio_id,name,phone) VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccc04','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Reuse','+351911111111');
ROLLBACK;

BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
  ('11111111-1111-1111-1111-111111111111','owner@example.invalid',now());
INSERT INTO public.studios(id,slug) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','synthetic-a'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','synthetic-b');
INSERT INTO public.user_roles(user_id,studio_id,role) VALUES
  ('11111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','studio_owner');
INSERT INTO public.clients(id,studio_id,name,phone)
SELECT ('cccccccc-cccc-cccc-cccc-cccccccccc' || lpad(n::text,2,'0'))::uuid,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Cross '||n,'+35193'||lpad(n::text,7,'0')
FROM generate_series(11,19) AS n;
INSERT INTO public.client_manual_whatsapp_confirmations VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','cccccccc-cccc-cccc-cccc-cccccccccc11');
INSERT INTO public.customer_loyalty_rewards(id,studio_id,client_id,status) VALUES
  (gen_random_uuid(),'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','cccccccc-cccc-cccc-cccc-cccccccccc12','earned');
INSERT INTO public.customer_loyalty_stamp_entries(id,studio_id,client_id,status) VALUES
  (gen_random_uuid(),'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','cccccccc-cccc-cccc-cccc-cccccccccc13','earned');
INSERT INTO public.customer_referral_codes VALUES
  (gen_random_uuid(),'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','cccccccc-cccc-cccc-cccc-cccccccccc14','CROSS');
INSERT INTO public.customer_referrals VALUES
  (gen_random_uuid(),'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','cccccccc-cccc-cccc-cccc-cccccccccc15',NULL,NULL,'pending_completion',NULL,false);
INSERT INTO public.customer_referrals VALUES
  (gen_random_uuid(),'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','cccccccc-cccc-cccc-cccc-cccccccccc15','cccccccc-cccc-cccc-cccc-cccccccccc18',NULL,'pending_completion',NULL,false);
INSERT INTO public.manual_service_entries VALUES
  (gen_random_uuid(),'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','cccccccc-cccc-cccc-cccc-cccccccccc16',10,'received');
INSERT INTO public.push_subscriptions VALUES
  (gen_random_uuid(),'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','cccccccc-cccc-cccc-cccc-cccccccccc17');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
DO $$ DECLARE n integer; BEGIN
  FOR n IN 11..18 LOOP
    BEGIN
      PERFORM public.delete_clients_for_owner('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        ARRAY[('cccccccc-cccc-cccc-cccc-cccccccccc' || n::text)::uuid],'EXCLUIR');
      RAISE EXCEPTION 'cross-studio delete unexpectedly succeeded for %',n;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'client_cross_studio_reference' THEN RAISE; END IF;
    END;
  END LOOP;
  BEGIN
    PERFORM public.delete_clients_for_owner('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      ARRAY['cccccccc-cccc-cccc-cccc-cccccccccc19','cccccccc-cccc-cccc-cccc-cccccccccc11']::uuid[],'EXCLUIR');
    RAISE EXCEPTION 'mixed batch unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'client_cross_studio_reference' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.clients WHERE studio_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') <> 9 THEN RAISE EXCEPTION 'cross-studio profile or mixed batch changed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.client_manual_whatsapp_confirmations WHERE studio_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' AND client_id='cccccccc-cccc-cccc-cccc-cccccccccc11') THEN RAISE EXCEPTION 'other-studio consent lost'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customer_referrals WHERE studio_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' AND referrer_client_id='cccccccc-cccc-cccc-cccc-cccccccccc15') THEN RAISE EXCEPTION 'other-studio referral changed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customer_referrals WHERE studio_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' AND referred_client_id='cccccccc-cccc-cccc-cccc-cccccccccc18') THEN RAISE EXCEPTION 'other-studio referred client changed'; END IF;
  IF EXISTS (SELECT 1 FROM public.client_removal_audit WHERE action='delete_client') THEN RAISE EXCEPTION 'cross-studio deletion audited'; END IF;
END $$;
ROLLBACK;
