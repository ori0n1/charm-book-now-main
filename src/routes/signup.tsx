import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { GoogleAuthButton } from "@/components/google-auth-button";
import { useAuthRedirectError } from "@/hooks/use-auth-redirect-error";
import { supabase } from "@/integrations/supabase/client";
import { APP_BRAND } from "@/lib/app-brand";
import { toast } from "sonner";

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: `Criar conta - ${APP_BRAND.name}` }] }),
  component: SignupPage,
});

function SignupPage() {
  useAuthRedirectError();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/onboarding`,
        data: { full_name: name },
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
    <main className="min-h-screen bg-background flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <Link to="/" className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          ← Voltar
        </Link>
        <h1 className="mt-6 text-3xl font-light tracking-tight">Criar conta</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Comece o teste gratuito de 14 dias.
        </p>

        {submitted ? (
          <div className="mt-8 rounded-md border border-border bg-muted/40 p-4 text-sm">
            <p className="font-medium text-foreground">Verifique o seu email</p>
            <p className="mt-1 text-muted-foreground">
              Enviámos um link de confirmação para <strong>{email}</strong>. Clique no link para
              ativar a sua conta e poder entrar.
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              Já confirmou?{" "}
              <Link to="/login" className="underline text-foreground">
                Entrar
              </Link>
            </p>
          </div>
        ) : (
          <>
            <div className="mt-8">
              <GoogleAuthButton mode="signup" />
              <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                <span>Email</span>
                <span className="h-px flex-1 bg-border" />
              </div>
            </div>
            <form onSubmit={onSubmit} className="space-y-4">
            <input
              required
              placeholder="O seu nome"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
            />
            <input
              type="email"
              required
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
            />
            <input
              type="password"
              required
              minLength={6}
              placeholder="Palavra-passe (min. 6)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-foreground py-3 text-sm font-medium text-background disabled:opacity-50"
            >
              {loading ? "A criar…" : "Criar conta"}
            </button>
            <p className="text-center text-[11px] text-muted-foreground">
              Enviaremos um email com um link para ativar a sua conta.
            </p>
            </form>
          </>
        )}

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Já tem conta?{" "}
          <Link to="/login" className="underline">
            Entrar
          </Link>
        </p>
      </div>
    </main>
  );
}
