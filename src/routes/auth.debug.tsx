import { createFileRoute, redirect } from "@tanstack/react-router";

// The previous diagnostics persisted authentication events in browser storage.
// Keep the historical route inert so old bookmarks do not expose a debug UI.
export const Route = createFileRoute("/auth/debug")({
  beforeLoad() {
    throw redirect({ to: "/" });
  },
});
