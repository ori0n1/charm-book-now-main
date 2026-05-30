import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { GoogleAuthButton } from "@/components/google-auth-button";
import { useAuthRedirectError } from "@/hooks/use-auth-redirect-error";
import { supabase } from "@/integrations/supabase/client";
import { APP_BRAND } from "@/lib/app-brand";
import { resolveTeamLoginIdentifier } from "@/lib/access.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: `Entrar - ${APP_BRAND.name}` }] }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  useAuthRedirectError();
  const resolveLoginIdentifier = useServerFn(resolveTeamLoginIdentifier);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [resending, setResending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setNeedsConfirm(false);
    const loginId = await normalizeLoginIdentifier(email, resolveLoginIdentifier);
    const { data, error } = await supabase.auth.signInWithPassword({ email: loginId, password });
    if (error) {
      setLoading(false);
      const msg = error.message.toLowerCase();
      if (msg.includes("not confirmed") || msg.includes("email not confirmed")) {
        setNeedsConfirm(true);
        toast.error("Confirme o seu email antes de entrar.");
      } else {
        toast.error(error.message);
      }
      return;
    }
    // Session is already in storage at this point — navigate immediately.
    // We keep `loading` true so the button stays disabled during the route
    // transition (prevents double-submit / double-navigate races).
    if (data.session) {
      const landing = await resolveAdminLanding(data.user.id);
      navigate({
        to: landing === "desk" ? "/admin/balcao" : landing === "limited" ? "/admin/agenda" : "/admin",
      });
    } else {
      setLoading(false);
      toast.error("Não foi possível iniciar sessão. Tente novamente.");
    }
  }

  async function resolveAdminLanding(userId: string) {
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (!roles || roles.length === 0) return "admin";
    if (roles.every((role) => role.role === "desk_staff")) return "desk";
    if (roles.every((role) => role.role === "staff" || role.role === "desk_staff")) return "limited";
    return "admin";
  }


  async function resendConfirmation() {
    if (!email) {
      toast.error("Introduza o seu email.");
      return;
    }
    setResending(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `${window.location.origin}/onboarding` },
    });
    setResending(false);
    if (error) toast.error(error.message);
    else toast.success("Email de confirmação reenviado.");
  }

  return (
    <main className="min-h-screen bg-background flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <Link to="/" className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          ← Voltar
        </Link>
        <h1 className="mt-6 text-3xl font-light tracking-tight">Entrar</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Acesso ao painel do estúdio.
        </p>
        <div className="mt-8">
          <GoogleAuthButton mode="login" />
          <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            <span>Email</span>
            <span className="h-px flex-1 bg-border" />
          </div>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <input
            type="text"
            required
            placeholder="Email ou WhatsApp"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
          />
          <input
            type="password"
            required
            minLength={6}
            placeholder="Palavra-passe"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-foreground py-3 text-sm font-medium text-background disabled:opacity-50"
          >
            {loading ? "A entrar…" : "Entrar"}
          </button>
        </form>

        {needsConfirm && (
          <div className="mt-4 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            <p>
              A sua conta ainda não foi confirmada. Verifique a caixa de entrada do seu email e clique no
              link de confirmação.
            </p>
            <button
              onClick={resendConfirmation}
              disabled={resending}
              className="mt-2 text-foreground underline disabled:opacity-50"
            >
              {resending ? "A enviar…" : "Reenviar email de confirmação"}
            </button>
          </div>
        )}

        <p className="mt-4 text-center text-xs text-muted-foreground">
          <Link to="/forgot-password" className="underline">
            Esqueceu a palavra-passe?
          </Link>
        </p>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Sem conta?{" "}
          <Link to="/signup" className="underline">
            Criar conta
          </Link>
        </p>
      </div>
    </main>
  );
}

async function normalizeLoginIdentifier(
  value: string,
  resolveLoginIdentifier: (args: { data: { identifier: string } }) => Promise<{ loginId: string }>,
) {
  const trimmed = value.trim();
  if (trimmed.includes("@")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return trimmed;
  const resolved = await resolveLoginIdentifier({ data: { identifier: trimmed } });
  return resolved.loginId;
}
