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
