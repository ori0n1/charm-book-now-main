import { createFileRoute } from "@tanstack/react-router";
import { getVerifiedRequestUser } from "@/integrations/supabase/server-client";

function privateJson(payload: Record<string, unknown>, status: number) {
  return Response.json(payload, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      Pragma: "no-cache",
      Expires: "0",
      Vary: "Cookie, Authorization",
    },
  });
}

export const Route = createFileRoute("/api/auth/session")({
  server: {
    handlers: {
      GET: async () => {
        const { user } = await getVerifiedRequestUser();
        if (!user) {
          return privateJson({ authenticated: false }, 401);
        }
        return privateJson({ authenticated: true, userId: user.id }, 200);
      },
    },
  },
});
