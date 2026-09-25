-- Public catalogue consumers use the allowlisted public_* views created by
-- the pre-launch hardening migration. Remove the legacy base-table grants as
-- defense in depth in addition to the now-closed RLS policies.

REVOKE SELECT ON TABLE public.staff FROM anon;
REVOKE SELECT ON TABLE public.services FROM anon;
REVOKE SELECT ON TABLE public.service_categories FROM anon;
REVOKE SELECT ON TABLE public.staff_services FROM anon;
REVOKE SELECT ON TABLE public.staff_availability FROM anon;
REVOKE SELECT ON TABLE public.upsell_offers FROM anon;
REVOKE SELECT ON TABLE public.studio_reviews FROM anon;

NOTIFY pgrst, 'reload schema';
