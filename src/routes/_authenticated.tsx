import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getSettledSession } from "@/lib/auth-landing";

export const Route = createFileRoute("/_authenticated")({
  head: () => ({
    meta: [{ name: "robots", content: "noindex,nofollow,noarchive" }],
    links: [{ rel: "manifest", href: "/manifest.webmanifest" }],
  }),
  beforeLoad: async () => {
    // Skip on SSR — Supabase auth lives in localStorage on the browser.
    // If we ran getUser() on the server it would always be null and we'd
    // bounce every refresh to /login.
    if (typeof window === "undefined") return;

    const session = await getSettledSession();
    if (!session) {
      throw redirect({ to: "/login" });
    }
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  return <Outlet />;
}
