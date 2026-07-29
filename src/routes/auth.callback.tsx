import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  readAndClearPublicAuthContext,
  readAndClearPublicReturnTo,
  resolveAuthCallbackDestination,
  syncCurrentSessionAccountType,
} from "@/lib/auth-context";
import { resolveAuthLanding, settleSessionFromCurrentUrl } from "@/lib/auth-landing";
import { recordAuthDebugEvent } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth/callback")({
  head: () => ({
    meta: [
      { title: "A validar sessão - Bellza" },
      { name: "robots", content: "noindex,nofollow,noarchive" },
    ],
  }),
  component: AuthCallbackPage,
});

function AuthCallbackPage() {
  const navigate = useNavigate();
  const [message, setMessage] = useState("A validar sessão...");

  useEffect(() => {
    let cancelled = false;

    async function settleOAuthSession() {
      try {
        const session = await settleSessionFromCurrentUrl("/auth/callback");
        if (!session?.user?.id) {
          navigate({ to: "/login", replace: true });
          return;
        }

        const callbackContext = readAuthCallbackContext();
        const clearedLegacyPublicContext = readAndClearPublicAuthContext();
        const publicReturnTo = readAndClearPublicReturnTo();

        setMessage("A carregar conta...");
        const landing = await resolveAuthLanding(session.user.id);
        const decision = resolveAuthCallbackDestination({
          landing,
          callbackContext,
          publicReturnTo,
        });

        recordAuthDebugEvent({
          kind: "auth_callback_destination",
          ok: true,
          message: JSON.stringify({
            landing,
            destination: decision.destination,
            accountType: decision.accountType,
            explicitPublicContext: callbackContext === "public",
            clearedLegacyPublicContext: clearedLegacyPublicContext === "public",
          }),
        });

        if (decision.accountType) {
          await syncCurrentSessionAccountType(decision.accountType);
        }
        if (decision.accountType === "customer") {
          setMessage("A voltar à página de marcação...");
        }
        if (!cancelled) navigate({ to: decision.destination as never, replace: true });
      } catch (error) {
        if (cancelled) return;
        const detail = error instanceof Error ? error.message : "Não foi possível concluir o login.";
        toast.error(detail);
        navigate({ to: "/login", replace: true, search: { error: "auth_callback" } as never });
      }
    }

    void settleOAuthSession();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

function readAuthCallbackContext() {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  return url.searchParams.get("context") === "public" ? "public" : null;
}
