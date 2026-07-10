import { createFileRoute, redirect } from "@tanstack/react-router";

// Redirects legacy URL to /admin/central
export const Route = createFileRoute("/_authenticated/admin/central-levantamentos")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/central", replace: true });
  },
});
