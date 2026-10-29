import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { GoogleAuthButton } from "@/components/google-auth-button";
import { AuthField, AuthPrimaryButton } from "@/components/public/auth-field";
import { AuthPageLayout } from "@/components/public/auth-page-layout";
import { useAuthRedirectError } from "@/hooks/use-auth-redirect-error";
import { supabase } from "@/integrations/supabase/client";
import { APP_BRAND } from "@/lib/app-brand";
import { toast } from "sonner";

const REF_CODE_KEY = "bellza_ref_code";

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: `Criar conta - ${APP_BRAND.name}` },
      { name: "robots", content: "noindex,nofollow,noarchive" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    ref: typeof s.ref === "string" ? s.ref.toUpperCase().trim() : undefined,
  }),
  component: SignupPage,
});

function SignupPage() {
  useAuthRedirectError();
  const search = useSearch({ from: "/signup" });
  const refCode = search.ref;

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Persist ref code to localStorage so it survives email confirmation redirect.
  useEffect(() => {
    if (refCode) {
      try {
        localStorage.setItem(REF_CODE_KEY, refCode);
      } catch {
        // localStorage unavailable - ignore
      }
    }
  }, [refCode]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);

    // Persist ref code in user_metadata so the server can access it after email verification.
    const storedRef = refCode ?? (() => {
      try { return localStorage.getItem(REF_CODE_KEY) ?? undefined; } catch { return undefined; }
    })();

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: {
          full_name: name,
          ...(storedRef ? { referral_code: storedRef } : {}),
        },
      },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setSubmitted(true);
    toast.success("Confirme o seu email para ativar a conta.");
  }

  return (
    <AuthPageLayout
      title="Criar conta Bellza"
      description="Teste gratuito de 14 dias. Sem cartão de crédito."
      footer={
        <p className="text-center text-xs text-muted-foreground">
          Já tem conta?{" "}
          <Link to="/login" className="font-medium text-foreground underline-offset-2 hover:underline">
            Entrar
          </Link>
        </p>
      }
    >
      {refCode && (
        <div className="mb-4 rounded-xl border border-success/25 bg-success-soft px-4 py-3 text-xs text-success">
          <span className="font-semibold">Indicação ativa.</span>{" "}
          O estúdio que te indicou pode receber 14 dias de Premium se mantiveres uma assinatura Pro ou Premium ativa durante 30 dias. Até seis recompensas; quem já paga Premium não recebe dias adicionais.
        </div>
      )}
      {submitted ? (
        <div className="rounded-xl border border-border/80 bg-muted/30 p-4 text-sm">
          <p className="font-medium">Verifique o seu email</p>
          <p className="mt-2 text-muted-foreground">
            Enviámos um link para <strong className="text-foreground">{email}</strong>. Clique para ativar a conta.
          </p>
          {refCode && (
            <p className="mt-2 text-muted-foreground">
              Código de indicação {refCode} guardado. O benefício, quando elegível, pertence ao estúdio que te indicou.
            </p>
          )}
          <Link to="/login" className="mt-4 inline-block min-h-11 text-sm font-medium underline-offset-2 hover:underline">
            Ir para entrar
          </Link>
        </div>
      ) : (
        <>
          <GoogleAuthButton mode="signup" />
          <div className="my-6 flex items-center gap-3 text-[11px] font-medium uppercase text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            <span>ou email</span>
            <span className="h-px flex-1 bg-border" />
          </div>
          <form method="post" action="/signup" onSubmit={onSubmit} className="space-y-4">
            <AuthField
              label="Nome"
              name="name"
              required
              placeholder="O seu nome"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <AuthField
              label="Email"
              name="email"
              type="email"
              required
              placeholder="nome@estudio.pt"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <AuthField
              label="Palavra-passe"
              name="password"
              type="password"
              required
              minLength={6}
              placeholder="Mínimo 6 caracteres"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <AuthPrimaryButton disabled={loading}>{loading ? "A criar..." : "Criar conta"}</AuthPrimaryButton>
            <p className="text-center text-[11px] text-muted-foreground">
              Enviaremos um email de confirmação para ativar a conta Bellza.
            </p>
          </form>
        </>
      )}
    </AuthPageLayout>
  );
}
