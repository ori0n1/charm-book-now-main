import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getVerifiedAuthState } from "@/integrations/supabase/auth-session.functions";
import { sanitizePrivateReturnTo } from "@/lib/auth-return";
import { BELLZA_MANIFEST } from "@/lib/brand-assets";

export const Route = createFileRoute("/_authenticated")({
  head: () => ({
    meta: [{ name: "robots", content: "noindex,nofollow,noarchive" }],
    links: [{ rel: "manifest", href: BELLZA_MANIFEST }],
  }),
  beforeLoad: async ({ location }) => {
    const auth = await getVerifiedAuthState();
    if (!auth.authenticated) {
      const returnTo = sanitizePrivateReturnTo(`${location.pathname}${location.searchStr}`);
      throw redirect({ to: "/login", search: { returnTo } });
    }
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  return <Outlet />;
}
