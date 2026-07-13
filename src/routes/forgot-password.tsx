import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { AuthField, AuthPrimaryButton } from "@/components/public/auth-field";
import { AuthPageLayout } from "@/components/public/auth-page-layout";
import { supabase } from "@/integrations/supabase/client";
import { APP_BRAND } from "@/lib/app-brand";
import { toast } from "sonner";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { title: `Recuperar palavra-passe — ${APP_BRAND.name}` },
      { name: "robots", content: "noindex,nofollow,noarchive" },
    ],
  }),
  component: ForgotPasswordPage,
});

const COOLDOWN_SECONDS = 60;
const STORAGE_KEY = "forgot-password:last-sent";

type LastSent = Record<string, number>;

function readLastSent(): LastSent {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LastSent) : {};
  } catch {
    return {};
  }
}

function writeLastSent(map: LastSent) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (remaining <= 0) return;
    const timer = window.setInterval(() => {
      setRemaining((value) => (value <= 1 ? 0 : value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [remaining]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading || remaining > 0) return;
    setLoading(true);
    const key = email.trim().toLowerCase();
    const { error } = await supabase.auth.resetPasswordForEmail(key, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);

    if (error) {
      const waitSeconds = getResetRequestWaitSeconds(error.message);
      if (waitSeconds > 0) setRemaining(waitSeconds);
      toast.error(formatResetRequestError(error.message));
      return;
    }

    const map = readLastSent();
    map[key] = Date.now();
    for (const k of Object.keys(map)) {
      if (Date.now() - map[k] > COOLDOWN_SECONDS * 1000) delete map[k];
    }
    writeLastSent(map);
    setRemaining(COOLDOWN_SECONDS);
    setSent(true);
    toast.success("Email de recuperação enviado.");
  }

  const disabled = loading || remaining > 0;

  return (
    <AuthPageLayout
      title="Recuperar palavra-passe"
      description="Enviaremos um link seguro para redefinir o acesso."
      footer={
        <p className="text-center text-xs text-muted-foreground">
          <Link to="/login" className="font-medium text-foreground underline-offset-2 hover:underline">
            Voltar ao login
          </Link>
        </p>
      }
    >
      {sent ? (
        <div className="rounded-xl border border-border/80 bg-muted/30 p-4 text-sm">
          Se existir uma conta com este email, receberá instruções para redefinir a palavra-passe.
          {remaining > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">Pode reenviar em {remaining}s.</p>
          )}
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <AuthField
            label="Email"
            name="email"
            type="email"
            required
            placeholder="nome@estudio.pt"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <AuthPrimaryButton disabled={disabled}>
            {loading ? "A enviar…" : remaining > 0 ? `Aguarde ${remaining}s` : "Enviar link"}
          </AuthPrimaryButton>
        </form>
      )}
    </AuthPageLayout>
  );
}

function formatResetRequestError(message: string) {
  const seconds = getResetRequestWaitSeconds(message);
  if (seconds) {
    return `Por segurança, aguarde ${seconds}s antes de pedir outro link. Use sempre o email mais recente.`;
  }
  return message;
}

function getResetRequestWaitSeconds(message: string) {
  return Number(message.match(/(\d+)\s*seconds?/i)?.[1] ?? 0);
}
