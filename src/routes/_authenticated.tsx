import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async () => {
    // Skip on SSR — Supabase auth lives in localStorage on the browser.
    // If we ran getUser() on the server it would always be null and we'd
    // bounce every refresh to /login.
    if (typeof window === "undefined") return;

    // getSession() is a synchronous read from local storage (no network).
    // getUser() would do a network round-trip to Supabase auth every nav,
    // which was making the panel feel "eternally loading".
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({ to: "/login" });
    }
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  return <Outlet />;
}
