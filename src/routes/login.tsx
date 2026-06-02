import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { GoogleAuthButton } from "@/components/google-auth-button";
import { AuthField, AuthPrimaryButton } from "@/components/public/auth-field";
import { AuthPageLayout } from "@/components/public/auth-page-layout";
import { useAuthRedirectError } from "@/hooks/use-auth-redirect-error";
import { supabase } from "@/integrations/supabase/client";
import { APP_BRAND } from "@/lib/app-brand";
import { resolveAuthLanding } from "@/lib/auth-landing";
import { resolveTeamLoginIdentifier } from "@/lib/access.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: `Entrar — ${APP_BRAND.name}` }] }),
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
    if (data.session) {
      const landing = await resolveAuthLanding(data.user.id);
      navigate({ to: landing as never });
    } else {
      setLoading(false);
      toast.error("Não foi possível iniciar sessão. Tente novamente.");
    }
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
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setResending(false);
    if (error) toast.error(error.message);
    else toast.success("Email de confirmação reenviado.");
  }

  return (
    <AuthPageLayout
      variant="login"
      title="Entrar na Bellza"
      description="Acesso seguro ao painel do seu estúdio."
      footer={
        <p className="text-center text-xs text-muted-foreground">
          Sem conta?{" "}
          <Link to="/signup" className="font-semibold text-foreground underline-offset-2 hover:underline">
            Criar conta Bellza
          </Link>
        </p>
      }
    >
      <GoogleAuthButton
        mode="login"
        className="h-11 rounded-xl bg-card/70 font-semibold shadow-sm backdrop-blur hover:-translate-y-0.5"
      />
      <div className="my-5 flex items-center gap-3 text-[11px] font-semibold uppercase text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        <span>ou email</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <form onSubmit={onSubmit} className="space-y-3.5">
        <AuthField
          label="Email ou WhatsApp"
          labelClassName="text-[11px] font-semibold uppercase"
          name="identifier"
          required
          placeholder="nome@estudio.pt"
          className="font-medium placeholder:font-normal"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <AuthField
          label="Palavra-passe"
          labelClassName="text-[11px] font-semibold uppercase"
          name="password"
          type="password"
          required
          minLength={6}
          placeholder="••••••••"
          className="font-medium placeholder:font-normal"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div className="flex justify-end pt-0.5">
          <Link to="/forgot-password" className="text-xs font-semibold text-muted-foreground hover:text-foreground">
            Esqueceu-se da palavra-passe?
          </Link>
        </div>
        <AuthPrimaryButton disabled={loading} className="mt-1 h-11 rounded-xl font-semibold">
          {loading ? "A entrar..." : "Entrar"}
        </AuthPrimaryButton>
      </form>

      {needsConfirm && (
        <div className="mt-4 rounded-xl border border-border/80 bg-muted/30 p-4 text-xs text-muted-foreground">
          <p>Confirme o email antes de entrar. Verifique a caixa de entrada.</p>
          <button
            type="button"
            onClick={resendConfirmation}
            disabled={resending}
            className="mt-2 font-medium text-foreground underline-offset-2 hover:underline disabled:opacity-50"
          >
            {resending ? "A enviar..." : "Reenviar confirmação"}
          </button>
        </div>
      )}
    </AuthPageLayout>
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
