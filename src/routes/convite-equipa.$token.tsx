import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, type FormEvent } from "react";
import { Check, Loader2, LockKeyhole, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { acceptStaffInviteLink, getStaffInviteLink } from "@/lib/access.functions";
import { APP_BRAND } from "@/lib/app-brand";

export const Route = createFileRoute("/convite-equipa/$token")({
  head: () => ({ meta: [{ title: `Convite - ${APP_BRAND.name}` }] }),
  component: TeamInvitePage,
});

type Invite = {
  staffName: string;
  staffRole: string;
  studioName: string;
  whatsapp: string;
  photoUrl: string | null;
  status: string;
  inviteCode: string | null;
  expiresAt: string | null;
};

function TeamInvitePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const loadInvite = useServerFn(getStaffInviteLink);
  const acceptInvite = useServerFn(acceptStaffInviteLink);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    loadInvite({ data: { token } })
      .then((data) => {
        if (!cancelled) setInvite(data as Invite);
      })
      .catch(() => {
        if (!cancelled) setInvite(null);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadInvite, token]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!invite || saving) return;
    if (password !== confirm) return toast.error("As palavras-passe não coincidem.");
    if (password.length < 6) return toast.error("A palavra-passe deve ter pelo menos 6 caracteres.");
    setSaving(true);
    try {
      const result = (await acceptInvite({ data: { token, password, code } })) as {
        email: string;
        landing: string;
      };
      await supabase.auth.signOut();
      const { error } = await supabase.auth.signInWithPassword({
        email: result.email,
        password,
      });
      if (error) throw error;
      toast.success("Conta ativada. Bem-vinda ao painel.");
      navigate({ to: result.landing as "/admin" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível ativar a conta.");
    } finally {
      setSaving(false);
    }
  }

  if (checking) {
    return (
      <main className="grid min-h-screen place-items-center bg-background px-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (!invite || ["cancelled", "expired"].includes(invite.status)) {
    return (
      <main className="grid min-h-screen place-items-center bg-background px-6 py-12">
        <div className="w-full max-w-sm text-center">
          <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
            Convite indisponivel
          </p>
          <h1 className="mt-3 text-2xl font-light tracking-tight">Solicite um novo link</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Este convite foi cancelado ou expirou.
          </p>
          <Link to="/login" className="mt-6 inline-flex text-sm font-medium underline">
            Ir para login
          </Link>
        </div>
      </main>
    );
  }

  if (invite.status === "active" || invite.status === "password_created") {
    return (
      <main className="grid min-h-screen place-items-center bg-background px-6 py-12">
        <div className="w-full max-w-sm text-center">
          <Check className="mx-auto h-8 w-8" />
          <h1 className="mt-4 text-2xl font-light tracking-tight">Conta ja ativada</h1>
          <Link to="/login" className="mt-6 inline-flex text-sm font-medium underline">
            Entrar no painel
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background px-4 py-6 sm:grid sm:place-items-center sm:px-6">
      <div className="mx-auto w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl shadow-black/10">
        <div className="flex items-center gap-3">
          <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-full bg-muted">
            {invite.photoUrl ? (
              <img src={invite.photoUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <MessageCircle className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Convite para acesso
            </p>
            <h1 className="truncate text-xl font-light tracking-tight">{invite.studioName}</h1>
            <p className="truncate text-sm text-muted-foreground">
              {invite.staffName}
              {invite.staffRole ? ` · ${invite.staffRole}` : ""}
            </p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="mt-6 space-y-3">
          {invite.inviteCode && (
            <label className="block text-xs">
              <span className="text-muted-foreground">Codigo de acesso opcional</span>
              <input
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="Ex.: A1B2C3"
                className="mt-1 h-11 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-foreground/40"
              />
            </label>
          )}
          <label className="block text-xs">
            <span className="text-muted-foreground">Palavra-passe</span>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Minimo 6 caracteres"
              className="mt-1 h-11 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-foreground/40"
            />
          </label>
          <label className="block text-xs">
            <span className="text-muted-foreground">Confirmar palavra-passe</span>
            <input
              type="password"
              required
              minLength={6}
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              placeholder="Repita a palavra-passe"
              className="mt-1 h-11 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-foreground/40"
            />
          </label>
          <button
            type="submit"
            disabled={saving}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-foreground text-sm font-semibold text-background transition hover:opacity-90 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
            Ativar acesso
          </button>
        </form>
      </div>
    </main>
  );
}
