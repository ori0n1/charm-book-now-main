import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  BadgeCheck,
  Calendar,
  CalendarPlus,
  Clock,
  CreditCard,
  HandCoins,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Scissors,
  ShieldCheck,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { AdminNotifications } from "@/components/admin-notifications";
import { PwaInstallGuide } from "@/components/pwa-install-guide";
import { ThemeToggle } from "@/components/theme-toggle";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentStudio } from "@/hooks/use-current-studio";
import { APP_BRAND } from "@/lib/app-brand";
import { getSegmentConfig } from "@/lib/segments";
import { getPlatformSubscriptionSummary } from "@/lib/subscriptions.functions";
import { getSettledSession } from "@/lib/auth-landing";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: APP_BRAND.name }] }),
  component: AdminLayout,
});

const NAV = [
  { to: "/admin", label: "Painel", mobileLabel: "Início", icon: LayoutDashboard, exact: true },
  { to: "/admin/balcao", label: "Balcão", mobileLabel: "Balcão", icon: CalendarPlus, exact: false },
  { to: "/admin/agenda", label: "Agenda", mobileLabel: "Agenda", icon: Calendar, exact: false },
  {
    to: "/admin/servicos",
    label: "Serviços",
    mobileLabel: "Serviços",
    icon: Scissors,
    exact: false,
  },
  { to: "/admin/equipa", label: "Equipa", mobileLabel: "Equipa", icon: Users, exact: false },
  {
    to: "/admin/clientes",
    label: "Clientes",
    mobileLabel: "Clientes",
    icon: UserRound,
    exact: false,
  },
  { to: "/admin/horarios", label: "Horários", mobileLabel: "Horas", icon: Clock, exact: false },
  {
    to: "/admin/pagamentos",
    label: "Financeiro",
    mobileLabel: "Financeiro",
    icon: CreditCard,
    exact: false,
  },
  {
    to: "/admin/levantamentos",
    label: "Levantamentos",
    mobileLabel: "Levant.",
    icon: HandCoins,
    exact: false,
  },
  {
    to: "/admin/whatsapp",
    label: "WhatsApp",
    mobileLabel: "WhatsApp",
    icon: MessageCircle,
    exact: false,
  },
  { to: "/admin/marca", label: "Marca", mobileLabel: "Marca", icon: Palette, exact: false },
  {
    to: "/admin/politicas",
    label: "Políticas",
    mobileLabel: "Políticas",
    icon: ShieldCheck,
    exact: false,
  },
  {
    to: "/admin/premium",
    label: "Assinatura",
    mobileLabel: "Plano",
    icon: BadgeCheck,
    exact: false,
  },
] as const;

type BillingSummary = {
  available?: boolean;
  plan: string;
  status: string;
  nextBillingAt: string | null;
  trialEndsAt?: string | null;
  daysRemaining?: number | null;
  cancelAtPeriodEnd?: boolean;
  premiumActive: boolean;
};

function AdminLayout() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { studio, studios, loading, error, refetch } = useCurrentStudio();
  const loadBilling = useServerFn(getPlatformSubscriptionSummary);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false);
  const [sidebarStateReady, setSidebarStateReady] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const accessMode =
    studio?.role === "desk_staff" ? "desk" : studio?.role === "staff" ? "limited" : "full";
  const billingQuery = useQuery({
    queryKey: ["platform-subscription-summary", studio?.id],
    enabled: sessionReady && !!studio,
    staleTime: 30 * 1000,
    retry: 1,
    queryFn: async () =>
      (await loadBilling({ data: { studioId: studio!.id } })) as BillingSummary,
  });
  const premiumLocked = Boolean(billingQuery.data && billingQuery.data.status !== "trialing" && !billingQuery.data.premiumActive);
  const isPremiumPage = pathname.startsWith("/admin/premium");

  useEffect(() => {
    let cancelled = false;
    void getSettledSession().then((session) => {
      if (!cancelled) setSessionReady(Boolean(session?.access_token));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loading && studios.length === 0) {
      navigate({ to: "/onboarding" });
    }
  }, [loading, studios.length, navigate]);

  useEffect(() => {
    if (loading || accessMode === "full" || premiumLocked) return;
    const allowedPaths =
      accessMode === "desk"
        ? ["/admin/balcao"]
        : ["/admin/agenda", "/admin/clientes", "/admin/balcao"];
    const canAccess = allowedPaths.some((to) =>
      to === "/admin" ? pathname === to : pathname.startsWith(to),
    );
    if (!canAccess) {
      navigate({ to: allowedPaths[0], replace: true });
    }
  }, [accessMode, loading, navigate, pathname, premiumLocked]);

  useEffect(() => {
    if (loading || billingQuery.isLoading || !premiumLocked || isPremiumPage) return;
    navigate({ to: "/admin/premium", replace: true });
  }, [billingQuery.isLoading, isPremiumPage, loading, navigate, premiumLocked]);

  useEffect(() => {
    setDesktopSidebarCollapsed(localStorage.getItem("admin-sidebar-collapsed") === "true");
    setSidebarStateReady(true);
  }, []);

  useEffect(() => {
    if (sidebarStateReady) {
      localStorage.setItem("admin-sidebar-collapsed", String(desktopSidebarCollapsed));
    }
  }, [desktopSidebarCollapsed, sidebarStateReady]);

  async function logout() {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <p className="text-sm text-muted-foreground">A carregar o painel...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-5 text-center shadow-sm">
          <p className="text-sm font-semibold">Não foi possível carregar o painel.</p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Verifique a ligação e tente novamente. Se a sessão expirou, entre outra vez.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void refetch()}
              className="h-10 rounded-2xl border border-border text-xs font-bold uppercase tracking-wide transition hover:bg-muted"
            >
              Tentar
            </button>
            <button
              type="button"
              onClick={() => navigate({ to: "/login" })}
              className="h-10 rounded-2xl bg-foreground text-xs font-bold uppercase tracking-wide text-background transition hover:opacity-90"
            >
              Entrar
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!studio) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <p className="text-sm text-muted-foreground">A abrir configuração...</p>
      </div>
    );
  }

  if (premiumLocked) {
    if (!isPremiumPage) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background px-6">
          <p className="text-sm text-muted-foreground">A abrir planos premium...</p>
        </div>
      );
    }

    return (
      <div className="min-h-screen overflow-x-hidden bg-background">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border/70 bg-background/88 px-4 py-3 backdrop-blur-2xl md:px-8 md:py-4">
          <div className="min-w-0">
            <p className="text-[9px] uppercase tracking-[0.25em] text-muted-foreground">
              {APP_BRAND.shortName}
            </p>
            <h1 className="truncate text-base font-light tracking-tight">{studio.name}</h1>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle className="h-9 w-9" />
            <button
              onClick={logout}
              className="rounded-2xl border border-border p-2"
              aria-label="Sair"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 pb-10 pt-4 md:px-8 md:pt-8">
          <Outlet />
        </main>
      </div>
    );
  }

  const isActive = (to: string, exact: boolean) =>
    exact ? pathname === to : pathname.startsWith(to);
  const segment = getSegmentConfig(studio.business_segment);
  const allowedNav =
    accessMode === "desk"
      ? NAV.filter((item) => item.to === "/admin/balcao")
      : accessMode === "limited"
        ? NAV.filter((item) =>
            ["/admin/agenda", "/admin/clientes", "/admin/balcao"].includes(item.to),
          )
        : NAV;
  const roleNav = allowedNav;

  const primaryMobileNav = roleNav.filter((item) =>
    ["/admin", "/admin/agenda", "/admin/clientes", "/admin/pagamentos"].includes(item.to),
  );
  const deskMobileNav = accessMode === "desk" ? roleNav : primaryMobileNav;
  const secondaryMobileNav = roleNav.filter((item) => !deskMobileNav.includes(item));
  const secondaryActive = secondaryMobileNav.some((item) => isActive(item.to, item.exact));
  const navLabel = (item: (typeof NAV)[number]) =>
    item.to === "/admin/equipa" ? capitalize(segment.labels.professionalPlural) : item.label;
  const mobileNavLabel = (item: (typeof NAV)[number]) =>
    item.to === "/admin/equipa" ? capitalize(segment.labels.professionalPlural) : item.mobileLabel;

  if (accessMode !== "full" && !roleNav.some((item) => isActive(item.to, item.exact))) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <p className="text-sm text-muted-foreground">A abrir Balcão...</p>
      </div>
    );
  }

  return (
    <div className="admin-shell min-h-screen overflow-x-hidden bg-background">
      <aside
        className={`fixed inset-y-0 left-0 hidden h-dvh min-h-0 flex-col border-r border-border/70 bg-card/95 shadow-[12px_0_40px_rgba(0,0,0,0.04)] transition-[width] duration-300 ease-out md:flex ${
          desktopSidebarCollapsed ? "w-20" : "w-60"
        }`}
      >
        <div className={desktopSidebarCollapsed ? "shrink-0 px-3 pb-3 pt-4" : "shrink-0 px-5 pt-5 pb-4"}>
          <div className={desktopSidebarCollapsed ? "flex flex-col items-center gap-2.5" : "flex items-start justify-between gap-3"}>
            <div className="min-w-0">
              {!desktopSidebarCollapsed && (
                <>
                  <p className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground/85">
                    {APP_BRAND.name}
                  </p>
                  <h1 className="mt-1.5 truncate text-lg font-light tracking-tight">{studio.name}</h1>
                </>
              )}
              {desktopSidebarCollapsed && (
                <span
                  className="grid size-9 place-items-center rounded-full bg-foreground text-sm font-black text-background shadow-sm"
                  title={studio.name}
                >
                  {studio.name.slice(0, 1).toUpperCase()}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setDesktopSidebarCollapsed((collapsed) => !collapsed)}
              className="grid size-8 shrink-0 place-items-center rounded-xl border border-border/80 bg-background/55 text-muted-foreground shadow-sm transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-foreground/15 hover:bg-muted hover:text-foreground hover:shadow-md active:translate-y-0"
              aria-label={desktopSidebarCollapsed ? "Expandir sidebar" : "Recolher sidebar"}
              title={desktopSidebarCollapsed ? "Expandir" : "Recolher"}
            >
              {desktopSidebarCollapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        <nav
          className={`admin-sidebar-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain pb-4 pr-1.5 ${
            desktopSidebarCollapsed ? "flex flex-col items-stretch gap-1 px-3 pt-1" : "flex flex-col gap-[3px] px-3 pt-1"
          }`}
        >
          {roleNav.map((item) => {
            const active = isActive(item.to, item.exact);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                title={desktopSidebarCollapsed ? navLabel(item) : undefined}
                className={`group relative flex items-center rounded-lg text-[13.5px] font-medium tracking-[-0.005em] transition-all duration-200 ease-out ${
                  desktopSidebarCollapsed ? "h-10 justify-center px-0" : "h-10 gap-3 px-3"
                } ${
                  active
                    ? "bg-foreground text-background shadow-[0_1px_2px_rgba(0,0,0,0.08),0_4px_12px_rgba(0,0,0,0.06)]"
                    : "text-muted-foreground hover:bg-muted/65 hover:text-foreground"
                }`}
              >
                <Icon
                  className={`h-[1.05rem] w-[1.05rem] shrink-0 transition-transform duration-200 ease-out ${
                    active ? "" : "group-hover:scale-[1.04]"
                  }`}
                  strokeWidth={active ? 2.1 : 1.75}
                />
                {!desktopSidebarCollapsed && <span className="truncate">{navLabel(item)}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="shrink-0 border-t border-border/60 px-3 py-3">
          <button
            onClick={logout}
            className={`flex w-full items-center rounded-lg py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground transition-all duration-200 ease-out hover:bg-muted/65 hover:text-foreground ${
              desktopSidebarCollapsed ? "justify-center px-0" : "gap-2.5 px-3"
            }`}
            title={desktopSidebarCollapsed ? "Sair" : undefined}
          >
            <LogOut className="h-3.5 w-3.5" strokeWidth={1.85} />
            {!desktopSidebarCollapsed && "Sair"}
          </button>
        </div>
      </aside>

      <header
        className={`sticky top-0 z-20 flex items-center justify-between border-b border-border/70 bg-background/88 px-4 py-3 backdrop-blur-2xl transition-[margin] duration-300 ease-out md:px-8 md:py-4 ${
          desktopSidebarCollapsed ? "md:ml-20" : "md:ml-60"
        }`}
      >
        <div className="min-w-0">
          <p className="text-[9px] uppercase tracking-[0.25em] text-muted-foreground">
            {APP_BRAND.shortName}
          </p>
          <h1 className="truncate text-base font-light tracking-tight">{studio.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          {accessMode === "full" && <AdminNotifications studioId={studio.id} studioName={studio.name} />}
          <ThemeToggle className="h-9 w-9" />
          <button
            onClick={logout}
            className="rounded-2xl border border-border p-2"
            aria-label="Sair"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main
        className={`admin-main transition-[margin] duration-300 ease-out ${
          desktopSidebarCollapsed ? "md:ml-20" : "md:ml-60"
        }`}
      >
        <div className="admin-content mx-auto max-w-6xl px-4 pb-28 pt-4 md:px-8 md:pb-10 md:pt-8">
          {accessMode === "full" && billingQuery.data && !isPremiumPage && (
            <PremiumPlanStatusCard billing={billingQuery.data} />
          )}
          <Outlet />
        </div>
      </main>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-30 bg-background/45 backdrop-blur-sm md:hidden">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Fechar menu"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="absolute inset-x-3 bottom-[5.8rem] overflow-hidden rounded-[1.4rem] border border-border/80 bg-card/98 shadow-2xl shadow-black/35">
            <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                  Gestão
                </p>
                <p className="text-sm font-medium">Serviços e configurações</p>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="grid size-9 place-items-center rounded-2xl border border-border bg-background/80 text-muted-foreground"
                aria-label="Fechar menu"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-1 px-2 py-2">
              {secondaryMobileNav.map((item) => {
                const active = isActive(item.to, item.exact);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex min-h-[4.05rem] items-center gap-3 rounded-2xl px-3 text-sm transition ${
                      active
                        ? "bg-foreground text-background shadow-sm"
                        : "text-foreground hover:bg-muted/70"
                    }`}
                  >
                    <span
                      className={`grid size-10 shrink-0 place-items-center rounded-2xl ${
                        active
                          ? "bg-background/15 text-background"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <Icon className="h-4.5 w-4.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-semibold">{navLabel(item)}</span>
                      <span
                        className={`block truncate text-xs ${
                          active ? "text-background/70" : "text-muted-foreground"
                        }`}
                      >
                        {item.to === "/admin/servicos" && "Serviços, categorias e preços"}
                        {item.to === "/admin/equipa" && segment.labels.teamDescription}
                        {item.to === "/admin/horarios" && "Disponibilidade e folgas"}
                        {item.to === "/admin/whatsapp" && "Ligação e mensagens automáticas"}
                        {item.to === "/admin/marca" && "Marca e página pública"}
                        {item.to === "/admin/politicas" && "Cancelamentos e reembolsos"}
                        {item.to === "/admin/premium" && "Plano, teste e renovação"}
                        {item.to === "/admin/levantamentos" && "Saldo, pedidos e comprovativos"}
                      </span>
                    </span>
                    <span className="text-lg text-muted-foreground">›</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-card/96 px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-2 shadow-[0_-16px_36px_rgba(0,0,0,0.35)] backdrop-blur-2xl md:hidden">
        <div className={`grid gap-1.5 ${secondaryMobileNav.length > 0 ? "grid-cols-5" : "grid-cols-1"}`}>
          {deskMobileNav.map((item) => {
            const active = isActive(item.to, item.exact);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex min-w-0 flex-col items-center justify-center gap-1.5 rounded-2xl px-1 py-2 text-[10px] font-semibold leading-none tracking-normal transition ${
                  active
                    ? "bg-foreground text-background shadow-lg shadow-black/20"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="w-full truncate text-center">{mobileNavLabel(item)}</span>
              </Link>
            );
          })}
          {secondaryMobileNav.length > 0 && (
            <button
              type="button"
              onClick={() => setMobileMenuOpen((open) => !open)}
              className={`flex min-w-0 flex-col items-center justify-center gap-1.5 rounded-2xl px-1 py-2 text-[10px] font-semibold leading-none tracking-normal transition ${
                mobileMenuOpen || secondaryActive
                  ? "bg-foreground text-background shadow-lg shadow-black/20"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Menu className="h-4 w-4 shrink-0" />
              <span className="w-full truncate text-center">Menu</span>
            </button>
          )}
        </div>
      </nav>

      <PwaInstallGuide />
    </div>
  );
}

function capitalize(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function PremiumPlanStatusCard({ billing }: { billing: BillingSummary }) {
  const hasStripePlan = isStripePlan(billing.plan);
  const active = billing.premiumActive;
  const date = futureBillingDate(billing.nextBillingAt) ?? futureBillingDate(billing.trialEndsAt);
  const remaining = getBillingDaysRemaining(billing);
  const dateTitle =
    billing.status === "trialing" && hasStripePlan
      ? "Primeira cobrança"
      : active
        ? "Próxima renovação"
        : "Regularização";
  const title = hasStripePlan
    ? `${formatBillingPlan(billing.plan)} ativo`
    : active
      ? "Teste gratuito ativo"
      : "Plano pendente";
  const subtitle = hasStripePlan
    ? billing.status === "trialing"
      ? "O plano premium já está configurado e a primeira cobrança fica agendada para o fim do período experimental."
      : "A assinatura está sincronizada com a Stripe e o acesso premium está liberado."
    : "Escolha um plano quando quiser manter o acesso premium depois do teste.";

  return (
    <section className="mb-5 overflow-hidden rounded-[1.35rem] border border-emerald-700/20 bg-[linear-gradient(135deg,rgba(16,185,129,0.13),rgba(255,255,255,0.03)_45%,rgba(14,165,233,0.08))] p-4 shadow-sm shadow-black/5 md:mb-7 md:rounded-[1.55rem] md:p-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white shadow-sm">
              <BadgeCheck className="h-3.5 w-3.5" />
              {active ? "Premium ativo" : "Ação necessária"}
            </span>
            {!active && (
              <span className="rounded-full border border-border/70 bg-background/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {getBillingStatusLabel(billing.status, hasStripePlan, active)}
              </span>
            )}
          </div>
          <h2 className="mt-3 text-xl font-light tracking-tight md:text-2xl">{title}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {subtitle}
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-3 lg:min-w-[30rem]">
          <BillingMiniStat label="Plano atual" value={formatBillingPlan(billing.plan)} />
          <BillingMiniStat label={dateTitle} value={formatBillingDate(date)} />
          {!hasStripePlan && (
            <BillingMiniStat
              label="Dias restantes"
              value={remaining === null ? "A sincronizar" : `${remaining} dias`}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function BillingMiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border/70 bg-background/72 px-3.5 py-3 shadow-sm">
      <p className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-semibold">{value}</p>
    </div>
  );
}

function isStripePlan(plan?: string | null) {
  return plan === "monthly" || plan === "quarterly" || plan === "yearly";
}

function formatBillingPlan(plan?: string | null) {
  const labels: Record<string, string> = {
    trial: "Teste gratuito",
    monthly: "Premium Mensal",
    quarterly: "Premium Trimestral",
    yearly: "Premium Anual",
    pro: "Premium",
  };
  return labels[plan ?? ""] ?? "Não definido";
}

function getBillingStatusLabel(status?: string | null, hasStripePlan = false, active = false) {
  if (active && hasStripePlan) return "Ativa";
  if (status === "trialing" && hasStripePlan) return "Período experimental";
  const labels: Record<string, string> = {
    trialing: "Teste gratuito",
    active: "Ativa",
    past_due: "Pagamento pendente",
    canceled: "Cancelada",
    unpaid: "Por regularizar",
    incomplete: "A confirmar",
    incomplete_expired: "Expirada",
    paused: "Pausada",
  };
  return labels[status ?? ""] ?? "A sincronizar";
}

function formatBillingDate(value?: string | null) {
  if (!value) return "A sincronizar";
  return new Date(value).toLocaleDateString("pt-PT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getBillingDaysRemaining(billing: BillingSummary) {
  if (typeof billing.daysRemaining === "number") return billing.daysRemaining;
  const target =
    billing.status === "trialing" ? billing.trialEndsAt ?? billing.nextBillingAt : billing.nextBillingAt;
  if (!target) return null;
  return Math.max(0, Math.ceil((new Date(target).getTime() - Date.now()) / 86400000));
}

function futureBillingDate(value?: string | null) {
  if (!value) return null;
  return new Date(value).getTime() > Date.now() ? value : null;
}





