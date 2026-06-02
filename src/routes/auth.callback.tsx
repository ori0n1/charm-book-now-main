import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { resolveAuthLanding, settleSessionFromCurrentUrl } from "@/lib/auth-landing";

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
        const session = await settleSessionFromCurrentUrl("/auth/callback");
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
