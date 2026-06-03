import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { useAuthRedirectError } from "@/hooks/use-auth-redirect-error";
import { supabase } from "@/integrations/supabase/client";
import { APP_BRAND } from "@/lib/app-brand";
import { getSettledSession, resolveAuthLanding } from "@/lib/auth-landing";
import { SEGMENT_OPTIONS, type BusinessSegment } from "@/lib/segments";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({ meta: [{ title: `Configurar negócio - ${APP_BRAND.name}` }] }),
  component: OnboardingPage,
});

function OnboardingPage() {
  const navigate = useNavigate();
  useAuthRedirectError();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [segment, setSegment] = useState<BusinessSegment>("beauty");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const session = await getSettledSession();
      if (!session?.user?.id) {
        navigate({ to: "/login", replace: true });
        return;
      }

      const destination = await resolveAuthLanding(session.user.id);
      if (destination !== "/onboarding") {
        navigate({ to: destination as never, replace: true });
        return;
      }

      const metadata = session.user.user_metadata ?? {};
      const profileName =
        typeof metadata.full_name === "string"
          ? metadata.full_name
          : typeof metadata.name === "string"
            ? metadata.name
            : "";
      if (profileName) {
        setName((current) => current || profileName);
        setSlug((current) => current || slugify(profileName));
      }

      if (!cancelled) {
        setChecking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.rpc("create_studio_with_owner", {
      p_name: name.trim(),
      p_slug: slug.trim().toLowerCase(),
      p_business_segment: segment,
    });
    setLoading(false);
    if (error) {
      toast.error(error.message.includes("duplicate") ? "Esse link já existe." : error.message);
      return;
    }
    toast.success("Negócio criado!");
    navigate({ to: "/admin" });
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">A verificar...</p>
      </div>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-xl">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Passo 1 de 1
        </p>
        <h1 className="mt-4 text-3xl font-light tracking-tight">O seu negócio</h1>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
          Escolha o segmento, defina o nome e crie o link público. O painel usa a mesma estrutura
          para todos os negócios.
        </p>

        <form onSubmit={onSubmit} className="mt-8 space-y-5">
          <section className="space-y-2">
            <label className="text-xs uppercase tracking-wide text-muted-foreground">
              Segmento
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              {SEGMENT_OPTIONS.map((option) => {
                const active = segment === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setSegment(option.id)}
                    className={`min-h-[5.25rem] rounded-xl border px-4 py-3 text-left transition ${
                      active
                        ? "border-foreground bg-foreground text-background shadow-lg shadow-black/10"
                        : "border-border bg-card/70 hover:border-foreground/40 hover:bg-card"
                    }`}
                  >
                    <span className="block text-sm font-medium">{option.title}</span>
                    <span
                      className={`mt-1 block text-xs leading-relaxed ${
                        active ? "text-background/70" : "text-muted-foreground"
                      }`}
                    >
                      {option.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground">Nome</label>
            <input
              required
              minLength={2}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!slug) setSlug(slugify(e.target.value));
              }}
              className="mt-1 w-full rounded-md border border-border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
              placeholder="Nome do negócio"
            />
          </div>

          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground">
              Link público
            </label>
            <div className="mt-1 flex items-center rounded-md border border-border bg-background px-4 py-3 text-sm">
              <span className="text-muted-foreground">/</span>
              <input
                required
                minLength={2}
                pattern="[a-z0-9-]+"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
                className="ml-1 min-w-0 flex-1 bg-transparent focus:outline-none"
                placeholder="meu-negocio"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-foreground py-3 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "A criar..." : "Criar negócio"}
          </button>
        </form>
      </div>
    </main>
  );
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
