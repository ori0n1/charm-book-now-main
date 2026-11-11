-- Safe only before any delete_client action. Never use this to undo a real deletion.
BEGIN;
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.client_removal_audit WHERE action = 'delete_client')
     OR EXISTS (SELECT 1 FROM public.customer_loyalty_rewards WHERE client_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.customer_loyalty_stamp_entries WHERE client_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.customer_referral_codes WHERE referrer_client_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.customer_referrals WHERE referrer_client_id IS NULL) THEN
    RAISE EXCEPTION 'client_deletion_rollback_requires_manual_recovery';
  END IF;
END;
$guard$;

DROP FUNCTION public.delete_clients_for_owner(uuid, uuid[], text);
CREATE OR REPLACE FUNCTION public.correct_customer_referral_existing_client()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_had_completed_visit boolean;
BEGIN
  IF NEW.referred_client_id IS NULL OR NEW.referrer_client_id = NEW.referred_client_id
     OR (NOT NEW.referred_client_was_existing AND NEW.rejection_reason IS DISTINCT FROM 'existing_client')
  THEN RETURN NEW; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.appointments AS appointment
    WHERE appointment.studio_id = NEW.studio_id
      AND appointment.client_id = NEW.referred_client_id
      AND appointment.id IS DISTINCT FROM NEW.appointment_id
      AND appointment.status = 'completed'
  ) INTO v_had_completed_visit;
  IF NOT v_had_completed_visit THEN
    NEW.referred_client_was_existing := false;
    IF NEW.status = 'rejected' AND NEW.rejection_reason = 'existing_client' THEN
      NEW.status := 'pending_completion';
      NEW.rejection_reason := NULL;
    END IF;
  END IF;
  RETURN NEW;
END; $function$;
ALTER TABLE public.customer_loyalty_rewards
  DROP CONSTRAINT customer_loyalty_rewards_client_id_fkey,
  ADD CONSTRAINT customer_loyalty_rewards_client_id_fkey
    FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;
ALTER TABLE public.customer_loyalty_rewards ALTER COLUMN client_id SET NOT NULL;
ALTER TABLE public.customer_loyalty_stamp_entries
  DROP CONSTRAINT customer_loyalty_stamp_entries_client_id_fkey,
  ADD CONSTRAINT customer_loyalty_stamp_entries_client_id_fkey
    FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;
ALTER TABLE public.customer_loyalty_stamp_entries ALTER COLUMN client_id SET NOT NULL;
ALTER TABLE public.customer_referral_codes
  DROP CONSTRAINT customer_referral_codes_referrer_client_id_fkey,
  ADD CONSTRAINT customer_referral_codes_referrer_client_id_fkey
    FOREIGN KEY (referrer_client_id) REFERENCES public.clients(id) ON DELETE CASCADE;
ALTER TABLE public.customer_referral_codes ALTER COLUMN referrer_client_id SET NOT NULL;
ALTER TABLE public.customer_referrals
  DROP CONSTRAINT customer_referrals_referrer_client_id_fkey,
  ADD CONSTRAINT customer_referrals_referrer_client_id_fkey
    FOREIGN KEY (referrer_client_id) REFERENCES public.clients(id) ON DELETE CASCADE;
ALTER TABLE public.customer_referrals ALTER COLUMN referrer_client_id SET NOT NULL;
ALTER TABLE public.client_removal_audit
  DROP CONSTRAINT client_removal_audit_action_check,
  ADD CONSTRAINT client_removal_audit_action_check CHECK (action IN (
    'archive', 'delete_empty', 'reactivate', 'unify_empty',
    'identity_linked', 'identity_created'
  ));
NOTIFY pgrst, 'reload schema';
COMMIT;
