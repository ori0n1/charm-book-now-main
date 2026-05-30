import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Nova palavra-passe — Lumière" }] }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [valid, setValid] = useState(false);
  const isTeamInvite =
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("invite") === "team";

  useEffect(() => {
    supabase.auth.getSession().then(({ data, error }) => {
      setChecking(false);
      if (error || !data.session) {
        setValid(false);
        return;
      }
      setValid(true);
    });
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("As palavras-passe não coincidem.");
      return;
    }
    if (password.length < 6) {
      toast.error("A palavra-passe deve ter pelo menos 6 caracteres.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(isTeamInvite ? "Bem-vinda ao painel." : "Palavra-passe atualizada com sucesso.");
    navigate({ to: isTeamInvite ? "/admin" : "/login" });
  }

  if (checking) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center px-6 py-12">
        <p className="text-sm text-muted-foreground">A verificar link…</p>
      </main>
    );
  }

  if (!valid) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-2xl font-light tracking-tight">Link inválido ou expirado</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            O link de recuperação já não é válido. Solicite um novo.
          </p>
          <Link
            to="/forgot-password"
            className="mt-6 inline-block text-sm underline text-foreground"
          >
            Solicitar novo link
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <Link to="/login" className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          ← Voltar ao login
        </Link>
        <h1 className="mt-6 text-3xl font-light tracking-tight">
          {isTeamInvite ? "Criar acesso ao painel" : "Nova palavra-passe"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {isTeamInvite
            ? "Defina a sua palavra-passe para aceder ao painel do estúdio. Depois entra automaticamente."
            : "Defina uma nova palavra-passe para a sua conta."}
        </p>
        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          <input
            type="password"
            required
            minLength={6}
            placeholder="Nova palavra-passe (min. 6)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
          />
          <input
            type="password"
            required
            minLength={6}
            placeholder="Confirmar palavra-passe"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-foreground py-3 text-sm font-medium text-background disabled:opacity-50"
          >
            {loading ? "A guardar…" : "Definir nova palavra-passe"}
          </button>
        </form>
      </div>
    </main>
  );
}
