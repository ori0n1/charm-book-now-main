-- Only remove the management surface if no management actions have been recorded.
DO $rollback$
BEGIN
  IF EXISTS (SELECT 1 FROM public.customer_loyalty_stamp_entries
             WHERE management_action_id IS NOT NULL) THEN
    RAISE EXCEPTION 'loyalty_management_has_history_keep_additive_schema';
  END IF;
  DROP FUNCTION IF EXISTS public.admin_decide_customer_referral(uuid, uuid, boolean);
  DROP FUNCTION IF EXISTS public.admin_adjust_customer_loyalty_stamps(uuid, uuid, integer, text, uuid, uuid);
  DROP INDEX IF EXISTS public.customer_loyalty_management_action_once;
  ALTER TABLE public.customer_loyalty_stamp_entries
    DROP COLUMN IF EXISTS management_action_id,
    DROP COLUMN IF EXISTS managed_by_user_id;
END;
$rollback$;
