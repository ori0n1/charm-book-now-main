import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { readAndClearPublicAuthContext, readAndClearPublicReturnTo } from "@/lib/auth-context";
import { resolveAuthLanding, settleSessionFromCurrentUrl } from "@/lib/auth-landing";
import { supabase } from "@/integrations/supabase/client";

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
        const storedContext = readAndClearPublicAuthContext();
        const publicReturnTo = readAndClearPublicReturnTo();
        const isExplicitPublicAuth = callbackContext === "public" || storedContext === "public";

        if (isExplicitPublicAuth) {
          await markSessionAsPublicCustomer();
          setMessage("A voltar à página de marcação...");
          if (!cancelled) navigate({ to: (publicReturnTo ?? "/") as never, replace: true });
          return;
        }

        setMessage("A carregar conta...");
        const destination = await resolveAuthLanding(session.user.id);
        if (!cancelled) navigate({ to: destination as never, replace: true });
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

async function markSessionAsPublicCustomer() {
  try {
    const { data } = await supabase.auth.getUser();
    const metadata = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
    if (metadata.account_type === "customer" && metadata.bellza_account_type === "customer") return;
    await supabase.auth.updateUser({
      data: {
        ...metadata,
        account_type: "customer",
        bellza_account_type: "customer",
      },
    });
  } catch {
    // The public callback context is authoritative for routing; metadata only
    // helps future guards identify pure customer accounts.
  }
}
