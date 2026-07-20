import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Check, Loader2, LockKeyhole, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { LandingFooter } from "@/components/landing/landing-footer";
import { LandingHeader } from "@/components/landing/landing-header";
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
      <InviteShell>
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </InviteShell>
    );
  }

  if (!invite || ["cancelled", "expired"].includes(invite.status)) {
    return (
      <InviteShell>
        <div className="w-full max-w-sm text-center">
          <p className="public-section-label">
            Convite indisponivel
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">Solicite um novo link</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Este convite foi cancelado ou expirou.
          </p>
          <Link to="/login" className="public-btn-primary mt-6">
            Ir para login
          </Link>
        </div>
      </InviteShell>
    );
  }

  if (invite.status === "active" || invite.status === "password_created") {
    return (
      <InviteShell>
        <div className="w-full max-w-sm text-center">
          <Check className="mx-auto h-8 w-8 text-accent" />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">Conta ja ativada</h1>
          <Link to="/login" className="public-btn-primary mt-6">
            Entrar no painel
          </Link>
        </div>
      </InviteShell>
    );
  }

  return (
    <InviteShell>
      <div className="public-card mx-auto w-full max-w-md p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-full bg-muted">
            {invite.photoUrl ? (
              <img src={invite.photoUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <MessageCircle className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0">
            <p className="public-section-label">
              Convite para acesso
            </p>
            <h1 className="truncate text-xl font-semibold tracking-tight">{invite.studioName}</h1>
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
                className="public-input mt-1 w-full"
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
              className="public-input mt-1 w-full"
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
              className="public-input mt-1 w-full"
            />
          </label>
          <button
            type="submit"
            disabled={saving}
            className="public-btn-primary w-full"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
            Ativar acesso
          </button>
        </form>
      </div>
    </InviteShell>
  );
}

function InviteShell({ children }: { children: ReactNode }) {
  return (
    <div className="public-shell public-site-theme public-auth-surface min-h-screen overflow-x-hidden">
      <div className="public-grid-bg pointer-events-none fixed inset-0 opacity-35" aria-hidden="true" />
      <LandingHeader />
      <main className="relative grid min-h-[60vh] place-items-center px-4 py-10 sm:px-6 sm:py-14">{children}</main>
      <LandingFooter />
    </div>
  );
}
