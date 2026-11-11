-- Delete only the studio's client profile. Keep appointments, payments,
-- loyalty and referral history; detach their client references atomically.
BEGIN;

DO $guard$
BEGIN
  IF md5(pg_catalog.pg_get_functiondef(
    'public.remove_clients_for_owner(uuid,uuid[],text)'::regprocedure
  )) <> 'cd080513f35e3a0dc3a4355671cff8e7' THEN
    RAISE EXCEPTION 'client_removal_definition_changed';
  END IF;
  IF md5(pg_catalog.pg_get_functiondef(
    'public.correct_customer_referral_existing_client()'::regprocedure
  )) <> '4f95ebd1b3aada5a6acdce739f868814' THEN
    RAISE EXCEPTION 'referral_trigger_definition_changed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint fk
    WHERE fk.contype = 'f' AND fk.confrelid = 'public.clients'::regclass
      AND fk.conrelid NOT IN (
        'public.appointments'::regclass,
        'public.booking_policy_acceptances'::regclass,
        'public.client_manual_whatsapp_confirmations'::regclass,
        'public.customer_loyalty_rewards'::regclass,
        'public.customer_loyalty_stamp_entries'::regclass,
        'public.customer_referral_codes'::regclass,
        'public.customer_referrals'::regclass,
        'public.manual_service_entries'::regclass,
        'public.push_subscriptions'::regclass
      )
  ) THEN RAISE EXCEPTION 'unexpected_client_foreign_key'; END IF;
END;
$guard$;

-- These four historical tables must never cascade with a deleted profile.
ALTER TABLE public.customer_loyalty_rewards ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE public.customer_loyalty_rewards
  DROP CONSTRAINT customer_loyalty_rewards_client_id_fkey,
  ADD CONSTRAINT customer_loyalty_rewards_client_id_fkey
    FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;
ALTER TABLE public.customer_loyalty_stamp_entries ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE public.customer_loyalty_stamp_entries
  DROP CONSTRAINT customer_loyalty_stamp_entries_client_id_fkey,
  ADD CONSTRAINT customer_loyalty_stamp_entries_client_id_fkey
    FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;
ALTER TABLE public.customer_referral_codes ALTER COLUMN referrer_client_id DROP NOT NULL;
ALTER TABLE public.customer_referral_codes
  DROP CONSTRAINT customer_referral_codes_referrer_client_id_fkey,
  ADD CONSTRAINT customer_referral_codes_referrer_client_id_fkey
    FOREIGN KEY (referrer_client_id) REFERENCES public.clients(id) ON DELETE SET NULL;
ALTER TABLE public.customer_referrals ALTER COLUMN referrer_client_id DROP NOT NULL;
ALTER TABLE public.customer_referrals
  DROP CONSTRAINT customer_referrals_referrer_client_id_fkey,
  ADD CONSTRAINT customer_referrals_referrer_client_id_fkey
    FOREIGN KEY (referrer_client_id) REFERENCES public.clients(id) ON DELETE SET NULL;

ALTER TABLE public.client_removal_audit
  DROP CONSTRAINT client_removal_audit_action_check,
  ADD CONSTRAINT client_removal_audit_action_check CHECK (action IN (
    'archive', 'delete_empty', 'delete_client', 'reactivate', 'unify_empty',
    'identity_linked', 'identity_created'
  ));

-- Detaching a referrer must not reclassify an existing referral.
CREATE OR REPLACE FUNCTION public.correct_customer_referral_existing_client()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_had_completed_visit boolean;
BEGIN
  IF TG_OP = 'UPDATE'
     AND current_setting('bellza.client_hard_delete_confirmed', true) = 'yes'
     AND OLD.referrer_client_id IS DISTINCT FROM NEW.referrer_client_id
     AND NEW.referrer_client_id IS NULL
     AND OLD.referred_client_id IS NOT DISTINCT FROM NEW.referred_client_id
     AND OLD.status IS NOT DISTINCT FROM NEW.status
     AND OLD.rejection_reason IS NOT DISTINCT FROM NEW.rejection_reason
     AND OLD.referred_client_was_existing IS NOT DISTINCT FROM NEW.referred_client_was_existing
  THEN RETURN NEW; END IF;
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

CREATE FUNCTION public.delete_clients_for_owner(
  p_studio_id uuid, p_client_ids uuid[], p_confirmation text
) RETURNS TABLE(client_id uuid, outcome text, dependencies jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_id uuid;
  v_client public.clients%ROWTYPE;
  v_dependencies jsonb;
BEGIN
  IF p_confirmation IS DISTINCT FROM 'EXCLUIR'
     OR COALESCE(array_length(p_client_ids, 1), 0) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'client_removal_confirmation_required';
  END IF;
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND studio_id = p_studio_id AND role = 'studio_owner'
  ) THEN RAISE EXCEPTION 'studio_owner_required'; END IF;

  -- Fail closed if a later migration adds a client reference this routine does
  -- not detach. This check also protects a newly introduced CASCADE relation.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      AND a.attnum > 0 AND NOT a.attisdropped
      AND (a.attname = 'client_id' OR a.attname LIKE '%_client_id')
      AND c.relname NOT IN ('clients', 'client_removal_audit')
      AND (c.relname, a.attname) NOT IN (
        ('appointments', 'client_id'),
        ('booking_policy_acceptances', 'client_id'),
        ('client_manual_whatsapp_confirmations', 'client_id'),
        ('customer_loyalty_rewards', 'client_id'),
        ('customer_loyalty_stamp_entries', 'client_id'),
        ('customer_referral_codes', 'referrer_client_id'),
        ('customer_referrals', 'referred_client_id'),
        ('customer_referrals', 'referrer_client_id'),
        ('manual_service_entries', 'client_id'),
        ('push_subscriptions', 'client_id')
      )
  ) THEN RAISE EXCEPTION 'unexpected_client_reference'; END IF;

  FOREACH v_id IN ARRAY p_client_ids LOOP
    SELECT * INTO v_client FROM public.clients
      WHERE id = v_id AND studio_id = p_studio_id FOR UPDATE;
    IF NOT FOUND OR v_client.archived_at IS NOT NULL THEN
      client_id := v_id; outcome := 'not_found'; dependencies := '{}'::jsonb;
      RETURN NEXT;
      CONTINUE;
    END IF;
    v_dependencies := public.client_dependency_counts(p_studio_id, v_id);

    UPDATE public.appointments AS a SET client_id = NULL
      WHERE a.studio_id = p_studio_id AND a.client_id = v_id;
    UPDATE public.booking_policy_acceptances AS a SET client_id = NULL
      WHERE a.studio_id = p_studio_id AND a.client_id = v_id;
    DELETE FROM public.client_manual_whatsapp_confirmations AS a
      WHERE a.studio_id = p_studio_id AND a.client_id = v_id;
    UPDATE public.customer_loyalty_rewards AS a SET client_id = NULL
      WHERE a.studio_id = p_studio_id AND a.client_id = v_id;
    UPDATE public.customer_loyalty_stamp_entries AS a SET client_id = NULL
      WHERE a.studio_id = p_studio_id AND a.client_id = v_id;
    UPDATE public.customer_referral_codes AS a SET referrer_client_id = NULL
      WHERE a.studio_id = p_studio_id AND a.referrer_client_id = v_id;
    PERFORM pg_catalog.set_config('bellza.client_hard_delete_confirmed', 'yes', true);
    UPDATE public.customer_referrals AS a SET referrer_client_id = NULL
      WHERE a.studio_id = p_studio_id AND a.referrer_client_id = v_id;
    PERFORM pg_catalog.set_config('bellza.client_hard_delete_confirmed', '', true);
    UPDATE public.customer_referrals AS a SET referred_client_id = NULL
      WHERE a.studio_id = p_studio_id AND a.referred_client_id = v_id;
    UPDATE public.manual_service_entries AS a SET client_id = NULL
      WHERE a.studio_id = p_studio_id AND a.client_id = v_id;
    UPDATE public.push_subscriptions AS a SET client_id = NULL
      WHERE a.studio_id = p_studio_id AND a.client_id = v_id;

    PERFORM pg_catalog.set_config('bellza.client_hard_delete_confirmed', 'yes', true);
    DELETE FROM public.clients WHERE id = v_id AND studio_id = p_studio_id;
    PERFORM pg_catalog.set_config('bellza.client_hard_delete_confirmed', '', true);
    INSERT INTO public.client_removal_audit(studio_id, client_id, actor_id, action, dependencies)
      VALUES (p_studio_id, v_id, auth.uid(), 'delete_client', v_dependencies);
    client_id := v_id; outcome := 'deleted'; dependencies := v_dependencies;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_clients_for_owner(uuid, uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_clients_for_owner(uuid, uuid[], text) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
