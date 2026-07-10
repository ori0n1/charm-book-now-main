import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { AuthField, AuthPrimaryButton } from "@/components/public/auth-field";
import { AuthPageLayout } from "@/components/public/auth-page-layout";
import { supabase } from "@/integrations/supabase/client";
import { APP_BRAND } from "@/lib/app-brand";
import { toast } from "sonner";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: `Nova palavra-passe — ${APP_BRAND.name}` },
      { name: "robots", content: "noindex,nofollow,noarchive" },
    ],
  }),
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
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Palavra-passe atualizada.");
    navigate({ to: isTeamInvite ? "/admin" : "/login" });
  }

  if (checking) {
    return (
      <AuthPageLayout title="A verificar link" description="Aguarde um momento.">
        <p className="text-sm text-muted-foreground">A validar o seu acesso…</p>
      </AuthPageLayout>
    );
  }

  if (!valid) {
    return (
      <AuthPageLayout
        title="Link inválido"
        description="O link expirou ou já foi utilizado."
        footer={
          <Link to="/forgot-password" className="block text-center text-sm font-medium underline-offset-2 hover:underline">
            Solicitar novo link
          </Link>
        }
      >
        <p className="text-sm text-muted-foreground">Peça um novo email de recuperação para continuar.</p>
      </AuthPageLayout>
    );
  }

  return (
    <AuthPageLayout
      title={isTeamInvite ? "Criar acesso ao painel" : "Nova palavra-passe"}
      description="Defina uma palavra-passe segura para a sua conta."
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <AuthField
          label="Nova palavra-passe"
          name="password"
          type="password"
          required
          minLength={6}
          placeholder="Mínimo 6 caracteres"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <AuthField
          label="Confirmar palavra-passe"
          name="confirm"
          type="password"
          required
          minLength={6}
          placeholder="Repita a palavra-passe"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <AuthPrimaryButton disabled={loading}>
          {loading ? "A guardar…" : "Guardar palavra-passe"}
        </AuthPrimaryButton>
      </form>
    </AuthPageLayout>
  );
}
