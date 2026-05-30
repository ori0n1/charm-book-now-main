import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Recuperar palavra-passe — Lumière" }] }),
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

  // Recompute remaining cooldown for the current email every second.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const tick = () => {
      const key = email.trim().toLowerCase();
      if (!key) {
        setRemaining(0);
        return;
      }
      const last = readLastSent()[key] ?? 0;
      const elapsed = Math.floor((Date.now() - last) / 1000);
      setRemaining(Math.max(0, COOLDOWN_SECONDS - elapsed));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [email]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const key = email.trim().toLowerCase();
    if (!key) return;

    if (remaining > 0) {
      toast.error(`Aguarde ${remaining}s antes de tentar novamente.`);
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(key, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    const map = readLastSent();
    map[key] = Date.now();
    // Garbage-collect entries older than the cooldown window.
    for (const k of Object.keys(map)) {
      if (Date.now() - map[k] > COOLDOWN_SECONDS * 1000) delete map[k];
    }
    writeLastSent(map);
    setRemaining(COOLDOWN_SECONDS);
    setSent(true);
    toast.success("Email de recuperação enviado. Verifique a sua caixa de entrada.");
  }

  const disabled = loading || remaining > 0;

  return (
    <main className="min-h-screen bg-background flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <Link to="/login" className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          ← Voltar ao login
        </Link>
        <h1 className="mt-6 text-3xl font-light tracking-tight">Recuperar palavra-passe</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Insira o seu email e enviaremos um link para redefinir a palavra-passe.
        </p>

        {sent ? (
          <div className="mt-8 rounded-md border border-border bg-muted/40 p-4 text-sm text-foreground">
            Se existir uma conta associada a este email, receberá um link para redefinir a palavra-passe.
            {remaining > 0 && (
              <div className="mt-2 text-xs text-muted-foreground">
                Pode reenviar em {remaining}s.
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-8 space-y-4">
            <input
              type="email"
              required
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
            />
            <button
              type="submit"
              disabled={disabled}
              className="w-full rounded-md bg-foreground py-3 text-sm font-medium text-background disabled:opacity-50"
            >
              {loading
                ? "A enviar…"
                : remaining > 0
                  ? `Aguarde ${remaining}s`
                  : "Enviar link de recuperação"}
            </button>
            {remaining > 0 && (
              <p className="text-center text-xs text-muted-foreground">
                Para evitar spam, só pode pedir um novo email a cada {COOLDOWN_SECONDS}s.
              </p>
            )}
          </form>
        )}

        <p className="mt-6 text-center text-xs text-muted-foreground">
          <Link to="/login" className="underline">
            Voltar ao login
          </Link>
        </p>
      </div>
    </main>
  );
}
