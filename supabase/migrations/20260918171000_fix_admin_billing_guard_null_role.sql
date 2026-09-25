-- auth.role() is NULL for trusted direct administrative sessions. SQL's
-- `NULL <> 'authenticated'` is NULL (not true), which previously made those
-- sessions fall through to the browser-only billing guard. Use an explicit
-- NULL-safe comparison while preserving the authenticated-client block.
CREATE OR REPLACE FUNCTION public.enforce_studio_plan_protected_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR public.is_saas_owner() THEN
    RETURN NEW;
  END IF;

  IF NEW.plan_tier IS DISTINCT FROM OLD.plan_tier
    OR NEW.plan IS DISTINCT FROM OLD.plan
    OR NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id
    OR NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id
    OR NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
    OR NEW.subscription_current_period_end IS DISTINCT FROM OLD.subscription_current_period_end
    OR NEW.subscription_cancel_at_period_end IS DISTINCT FROM OLD.subscription_cancel_at_period_end
    OR NEW.premium_access_until IS DISTINCT FROM OLD.premium_access_until
    OR NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at
    OR NEW.trial_used_at IS DISTINCT FROM OLD.trial_used_at THEN
    RAISE EXCEPTION 'billing_fields_are_server_managed' USING ERRCODE = '42501';
  END IF;

  IF (
    NEW.payment_policy IS DISTINCT FROM OLD.payment_policy
    OR NEW.accepted_payment_methods IS DISTINCT FROM OLD.accepted_payment_methods
    OR NEW.deposit_percent IS DISTINCT FROM OLD.deposit_percent
    OR NEW.deposit_recipient IS DISTINCT FROM OLD.deposit_recipient
    OR NEW.deposit_professional_percent IS DISTINCT FROM OLD.deposit_professional_percent
  ) AND NOT public.studio_has_entitlement(NEW.id, 'online_payments') THEN
    RAISE EXCEPTION 'plan_feature_required:online_payments' USING ERRCODE = '42501';
  END IF;

  IF NEW.commission_percent IS DISTINCT FROM OLD.commission_percent
    AND NOT public.studio_has_entitlement(NEW.id, 'finance_basic') THEN
    RAISE EXCEPTION 'plan_feature_required:finance_basic' USING ERRCODE = '42501';
  END IF;

  IF (
    NEW.whatsapp_auto_send_enabled IS DISTINCT FROM OLD.whatsapp_auto_send_enabled
    OR NEW.whatsapp_default_message IS DISTINCT FROM OLD.whatsapp_default_message
    OR (NEW.booking_flow_mode IS DISTINCT FROM OLD.booking_flow_mode AND NEW.booking_flow_mode = 'request')
  ) AND NOT public.studio_has_entitlement(NEW.id, 'whatsapp') THEN
    RAISE EXCEPTION 'plan_feature_required:whatsapp' USING ERRCODE = '42501';
  END IF;

  IF NEW.staff_agenda_visibility IS DISTINCT FROM OLD.staff_agenda_visibility
    AND NOT public.studio_has_entitlement(NEW.id, 'team_management') THEN
    RAISE EXCEPTION 'plan_feature_required:team_management' USING ERRCODE = '42501';
  END IF;

  IF NEW.appointment_reminder_minutes IS DISTINCT FROM OLD.appointment_reminder_minutes
    AND NOT public.studio_has_entitlement(NEW.id, 'notifications') THEN
    RAISE EXCEPTION 'plan_feature_required:notifications' USING ERRCODE = '42501';
  END IF;

  IF NEW.attendance_grace_minutes IS DISTINCT FROM OLD.attendance_grace_minutes
    AND NOT public.studio_has_entitlement(NEW.id, 'attendance') THEN
    RAISE EXCEPTION 'plan_feature_required:attendance' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.enforce_studio_plan_protected_columns()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_studio_plan_protected_columns()
  TO service_role;
