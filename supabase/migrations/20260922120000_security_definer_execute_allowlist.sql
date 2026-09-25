-- Reduce the exposed PostgREST RPC surface to the functions that the browser
-- actually needs. SECURITY DEFINER functions not listed below are internal and
-- may only be executed by service_role. Trigger execution is unaffected by
-- revoking direct EXECUTE from browser roles.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO service_role;

DO $hardening$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT function_row.oid::regprocedure AS signature
    FROM pg_proc AS function_row
    JOIN pg_namespace AS function_schema
      ON function_schema.oid = function_row.pronamespace
    WHERE function_schema.nspname = 'public'
      AND function_row.prosecdef
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated',
      target.signature
    );
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %s TO service_role',
      target.signature
    );
  END LOOP;
END
$hardening$;

-- Anonymous booking availability is intentionally public. Mutating booking,
-- payment, refund and notification RPCs are mediated by server functions.
GRANT EXECUTE ON FUNCTION public.get_available_slots(text, uuid, date, integer, integer)
  TO anon, authenticated;

-- The public catalogue views call these helpers while serving anonymous
-- requests. PostgreSQL still checks the nested function ACL in this view chain,
-- so removing either grant breaks public catalogue reads.
GRANT EXECUTE ON FUNCTION public.studio_has_entitlement(uuid, text, timestamptz)
  TO anon;
GRANT EXECUTE ON FUNCTION public.studio_staff_is_within_plan(uuid, uuid)
  TO anon;

-- These helpers are invoked by authenticated RLS policies. Keeping EXECUTE is
-- required for ordinary tenant-scoped table access; each helper remains
-- responsible for comparing the requested tenant/user with auth.uid().
GRANT EXECUTE ON FUNCTION public.can_use_studio(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_active_premium_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_privileged_studio_access(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_saas_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_studio_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_owns_appointment(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.studio_can_add_professional(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.studio_has_entitlement(uuid, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.studio_staff_is_within_plan(uuid, uuid) TO authenticated;

-- Authenticated browser RPCs still used by the agenda, service catalogue and
-- cash-register screens. Each function performs its own tenant/role checks.
GRANT EXECUTE ON FUNCTION public.add_cash_register_movement(uuid, text, text, numeric, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_cash_register(uuid, numeric, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_studio_appointment_payment(uuid, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_manual_appointment(
  uuid, uuid, uuid, timestamptz, uuid, text, text, text, boolean
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_walk_in_appointment(
  uuid, uuid, uuid, timestamptz, uuid, text, text, text, numeric, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_cash_register_closure_history(uuid, integer)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_open_cash_register(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.open_cash_register(uuid, numeric)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_or_archive_service(uuid, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_manual_appointment_service(uuid, uuid, uuid, uuid, text)
  TO authenticated;

-- Fix every mutable search_path reported by the staging advisor. pg_catalog is
-- first so built-ins cannot be shadowed; application relations remain in public.
ALTER FUNCTION public.get_or_create_referral_code(uuid)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.get_studio_id_by_referral_code(text)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.normalize_customer_referral_code(text)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.preserve_cancel_at_period_end()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.preserve_studio_cancel_at_period_end()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.refresh_studio_rating()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.request_header(text)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.set_updated_at()
  SET search_path = pg_catalog, public;

NOTIFY pgrst, 'reload schema';
