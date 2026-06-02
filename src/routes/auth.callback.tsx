import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getSettledSession, resolveAuthLanding } from "@/lib/auth-landing";

export const Route = createFileRoute("/auth/callback")({
  component: AuthCallbackPage,
});

function AuthCallbackPage() {
  const navigate = useNavigate();
  const [message, setMessage] = useState("A validar sessão...");

  useEffect(() => {
    let cancelled = false;

    async function settleOAuthSession() {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        if (code) await supabase.auth.exchangeCodeForSession(code);

        if (window.location.hash || window.location.search) {
          window.history.replaceState({}, document.title, "/auth/callback");
        }

        const session = await getSettledSession();
        if (!session?.user?.id) {
          navigate({ to: "/login", replace: true });
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
