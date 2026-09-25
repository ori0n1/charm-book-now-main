-- Prevent a studio owner from using the team-management RLS policy to grant
-- the global saas_owner role to themselves or another user. Existing rows are
-- preserved; service_role remains the only normal writer of global roles.

CREATE OR REPLACE FUNCTION public.guard_global_saas_role()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF auth.role() IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.role = 'saas_owner' THEN
        RAISE EXCEPTION 'global_role_server_only' USING ERRCODE = '42501';
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      IF OLD.role = 'saas_owner' OR NEW.role = 'saas_owner' THEN
        RAISE EXCEPTION 'global_role_server_only' USING ERRCODE = '42501';
      END IF;
    ELSIF TG_OP = 'DELETE' THEN
      IF OLD.role = 'saas_owner' THEN
        RAISE EXCEPTION 'global_role_server_only' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.guard_global_saas_role() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_guard_global_saas_role
  BEFORE INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.guard_global_saas_role();

-- This unused helper accepted an arbitrary user UUID and disclosed that
-- user's studio memberships through the exposed public RPC schema.
REVOKE EXECUTE ON FUNCTION public.user_studio_ids(uuid) FROM PUBLIC, anon, authenticated;
