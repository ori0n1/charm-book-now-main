import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  BookOpenCheck,
  Calendar,
  CalendarPlus,
  Check,
  Clock,
  CreditCard,
  Gift,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Scissors,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { AdminNotifications } from "@/components/admin-notifications";
import { PwaInstallGuide } from "@/components/pwa-install-guide";
import { ThemeToggle } from "@/components/theme-toggle";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentStudio, type AppRole } from "@/hooks/use-current-studio";
import { APP_BRAND } from "@/lib/app-brand";
import { getSegmentConfig } from "@/lib/segments";
import { getPlatformSubscriptionSummary } from "@/lib/subscriptions.functions";
import { getSettledSession } from "@/lib/auth-landing";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: APP_BRAND.name }] }),
  component: AdminLayout,
});

const NAV = [
  {
    to: "/admin",
    label: "Início",
    mobileLabel: "Início",
    icon: LayoutDashboard,
    exact: true,
    group: "Operação",
    primary: true,
  },
  { to: "/admin/balcao", label: "Balcão", mobileLabel: "Balcão", icon: CalendarPlus, exact: false, group: "Operação", primary: true },
  { to: "/admin/agenda", label: "Agenda", mobileLabel: "Agenda", icon: Calendar, exact: false, group: "Operação", primary: true },
  {
    to: "/admin/clientes",
    label: "Clientes",
    mobileLabel: "Clientes",
    icon: UserRound,
    exact: false,
    group: "Operação",
    primary: true,
  },
  {
    to: "/admin/servicos",
    label: "Serviços",
    mobileLabel: "Serviços",
    icon: Scissors,
    exact: false,
    group: "Operação",
    primary: true,
  },
  { to: "/admin/equipa", label: "Profissionais", mobileLabel: "Prof.", icon: Users, exact: false, group: "Operação", primary: true },
  { to: "/admin/horarios", label: "Horários", mobileLabel: "Horas", icon: Clock, exact: false, group: "Operação", primary: true },
  {
    to: "/admin/pagamentos",
    label: "Financeiro",
    mobileLabel: "Financeiro",
    icon: CreditCard,
    exact: false,
    group: "Gestão",
  },
  {
    to: "/admin/recebimento",
    label: "Recebimento",
    mobileLabel: "Receb.",
    icon: Wallet,
    exact: false,
    group: "Gestão",
  },
  {
    to: "/admin/whatsapp",
    label: "Comunicação",
    mobileLabel: "Avisos",
    icon: MessageCircle,
    exact: false,
    group: "Gestão",
  },
  {
    to: "/admin/fidelidade",
    label: "Fidelidade",
    mobileLabel: "Fidel.",
    icon: Sparkles,
    exact: false,
    group: "Gestão",
  },
  {
    to: "/admin/indicacoes",
    label: "Indicações",
    mobileLabel: "Indicar",
    icon: Gift,
    exact: false,
    group: "Gestão",
  },
  { to: "/admin/marca", label: "Marca", mobileLabel: "Marca", icon: Palette, exact: false, group: "Configuração" },
  {
    to: "/admin/politicas",
    label: "Políticas",
    mobileLabel: "Políticas",
    icon: ShieldCheck,
    exact: false,
    group: "Configuração",
  },
  {
    to: "/admin/premium",
    label: "Assinatura",
    mobileLabel: "Plano",
    icon: BadgeCheck,
    exact: false,
    group: "Configuração",
  },
  {
    to: "/admin/guia-rapido",
    label: "Guia Rápido",
    mobileLabel: "Guia",
    icon: BookOpenCheck,
    exact: false,
    group: "Configuração",
  },
  {
    to: "/admin/central",
    label: "Central",
    mobileLabel: "Central",
    icon: ShieldCheck,
    exact: false,
    saasOnly: true,
    group: "Administração",
  },
] as const;

const ADMIN_TOUR_STORAGE_PREFIX = "bellza:admin-quick-tour";

const ADMIN_TOUR_STEPS = [
  {
    target: "admin-header",
    route: "/admin",
    title: "O painel abre sempre com o essencial",
    body: "Veja o estúdio, notificações e ações principais.",
  },
  {
    target: "nav-dashboard",
    route: "/admin",
    title: "Comece pelo resumo",
    body: "Acompanhe o dia e o que precisa de atenção.",
  },
  {
    target: "nav-agenda",
    route: "/admin/agenda",
    title: "A agenda é o centro da operação",
    body: "Consulte reservas, horários e estados das marcações.",
  },
  {
    target: "nav-services",
    route: "/admin/servicos",
    mobileMenu: true,
    title: "Serviços bem definidos evitam dúvidas",
    body: "Revise preços, duração e disponibilidade.",
  },
  {
    target: "nav-brand",
    route: "/admin/marca",
    mobileMenu: true,
    title: "A marca alimenta a página pública",
    body: "Atualize contactos, imagens e link público.",
  },
  {
    target: "nav-guide",
    route: "/admin/guia-rapido",
    mobileMenu: true,
    title: "O guia fica sempre disponível",
    body: "Volte ao Guia Rápido sempre que quiser rever o fluxo.",
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
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname.startsWith("/admin/central")) {
    return <Outlet />;
  }

  return <AdminPanelLayout pathname={pathname} />;
}

function AdminPanelLayout({ pathname }: { pathname: string }) {
  const navigate = useNavigate();
  const { studio, studios, loading, error, refetch } = useCurrentStudio();
  const loadBilling = useServerFn(getPlatformSubscriptionSummary);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false);
  const [sidebarStateReady, setSidebarStateReady] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [studioResolveTimedOut, setStudioResolveTimedOut] = useState(false);
  const studioRecoveryAttempted = useRef(false);
  const accessMode =
    studio?.role === "desk_staff" ? "desk" : studio?.role === "staff" ? "limited" : "full";
  const billingQuery = useQuery({
    queryKey: ["platform-subscription-summary", studio?.id],
    enabled: sessionReady && !!studio,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    retry: 1,
    queryFn: async () =>
      (await loadBilling({ data: { studioId: studio!.id } })) as BillingSummary,
  });
  const premiumLocked = Boolean(billingQuery.data && !billingQuery.data.premiumActive);
  const premiumActive = Boolean(accessMode === "full" && billingQuery.data?.premiumActive);
  const premiumCancelScheduled = Boolean(
    premiumActive && billingQuery.data && isPaidSubscriptionBilling(billingQuery.data) && billingQuery.data.cancelAtPeriodEnd,
  );
  const premiumIndicatorVisible = Boolean(accessMode === "full" && billingQuery.data && (premiumActive || premiumLocked));
  const premiumIndicatorTone = premiumLocked ? "expired" : premiumCancelScheduled ? "scheduled" : "active";
  const ownerGreeting = studio
    ? getOwnerGreeting(studio)
    : { title: APP_BRAND.shortName, subtitle: "Bem-vinda ao painel Bellza" };
  const premiumTooltip = getPremiumHeaderTooltip(billingQuery.data);
  const isPremiumPage = pathname.startsWith("/admin/premium");
  const isDashboardPage = pathname === "/admin";
  const isBalcaoPage = pathname.startsWith("/admin/balcao");
  const showTrialBanner = Boolean(
    accessMode === "full" &&
      billingQuery.data &&
      isPureTrialBilling(billingQuery.data) &&
      !isDashboardPage &&
      !isPremiumPage,
  );
  const showCancellationBanner = Boolean(
    accessMode === "full" &&
      billingQuery.data &&
      isPaidSubscriptionBilling(billingQuery.data) &&
      billingQuery.data.cancelAtPeriodEnd &&
      billingQuery.data.premiumActive &&
      !isPremiumPage,
  );

  useEffect(() => {
    let cancelled = false;
    void getSettledSession().then((session) => {
      if (!cancelled) {
        setSessionReady(Boolean(session?.access_token));
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sessionReady) return;
    if (!loading && studios.length === 0) {
      navigate({ to: "/onboarding", replace: true });
    }
  }, [loading, sessionReady, studios.length, navigate]);

  useEffect(() => {
    if (!sessionReady || loading || studio || studioRecoveryAttempted.current) return;
    studioRecoveryAttempted.current = true;
    void refetch();
  }, [loading, refetch, sessionReady, studio]);

  useEffect(() => {
    if (loading || studio) {
      setStudioResolveTimedOut(false);
      return;
    }
    const timer = window.setTimeout(() => setStudioResolveTimedOut(true), 5000);
    return () => window.clearTimeout(timer);
  }, [loading, studio]);

  useEffect(() => {
    if (loading || accessMode === "full" || premiumLocked) return;
    const allowedPaths =
      accessMode === "desk"
        ? ["/admin/balcao"]
        : ["/admin", "/admin/agenda", "/admin/clientes", "/admin/balcao", "/admin/horarios"];
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

  if (studio && (billingQuery.isLoading || billingQuery.isFetching)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <p className="text-sm text-muted-foreground">A confirmar dados atuais...</p>
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
        {!studioResolveTimedOut ? (
          <p className="text-sm text-muted-foreground">A carregar o painel...</p>
        ) : (
          <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-5 text-center shadow-sm">
            <p className="text-sm font-semibold">Não foi possível abrir a configuração.</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              A sessão foi encontrada, mas o estúdio ainda não ficou disponível neste PWA.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setStudioResolveTimedOut(false);
                  studioRecoveryAttempted.current = false;
                  void refetch();
                }}
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
        )}
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
            ["/admin", "/admin/agenda", "/admin/clientes", "/admin/balcao", "/admin/horarios"].includes(item.to),
          )
        : NAV.filter((item) => !("saasOnly" in item) || studio.role === "saas_owner");
  const roleNav = allowedNav;

  const navGroups = groupNavItems(roleNav);
  const primaryMobileNav = roleNav.filter((item) => "primary" in item && item.primary).slice(0, 4);
  const directMobileNav =
    accessMode === "desk" ? roleNav : accessMode === "limited" ? roleNav : primaryMobileNav;
  const secondaryMobileNav =
    accessMode === "limited" ? [] : roleNav.filter((item) => !directMobileNav.includes(item));
  const secondaryMobileGroups = groupNavItems(secondaryMobileNav);
  const secondaryActive = secondaryMobileNav.some((item) => isActive(item.to, item.exact));
  const navLabel = (item: (typeof NAV)[number]) =>
    accessMode === "limited" && item.to === "/admin" ? "Financeiro" : item.label;
  const mobileNavLabel = (item: (typeof NAV)[number]) =>
    accessMode === "limited" && item.to === "/admin"
      ? "Financeiro"
      : accessMode === "limited" && item.to === "/admin/horarios"
        ? "Horários"
        : item.mobileLabel;
  const tourTargetFor = (to: string) =>
    to === "/admin"
      ? "nav-dashboard"
      : to === "/admin/agenda"
        ? "nav-agenda"
        : to === "/admin/servicos"
          ? "nav-services"
          : to === "/admin/marca"
            ? "nav-brand"
            : to === "/admin/guia-rapido"
              ? "nav-guide"
              : undefined;

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
                  <div className="mt-1.5 flex min-w-0 items-center gap-2">
                    <h1 className="truncate text-lg font-light tracking-tight">{studio.name}</h1>
                    {premiumIndicatorVisible && (
                      <PremiumHeaderBadge
                        tone={premiumIndicatorTone}
                        tooltip={premiumTooltip}
                        showTooltip={false}
                      />
                    )}
                  </div>
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
          className={`admin-sidebar-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain pb-3 pr-1.5 ${
            desktopSidebarCollapsed ? "flex flex-col items-stretch gap-1.5 px-3 pt-1" : "flex flex-col gap-2 px-3 pt-1"
          }`}
        >
          {navGroups.map((group) => {
            return (
              <div
                key={group.label}
                className={desktopSidebarCollapsed ? "border-t border-border/45 pt-1.5 first:border-t-0 first:pt-0" : ""}
              >
                {!desktopSidebarCollapsed && (
                  <p className="px-2 pb-1 text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground/70">
                    {group.label}
                  </p>
                )}
                <div className={desktopSidebarCollapsed ? "space-y-1" : "space-y-0.5"}>
                  {group.items.map((item) => {
                    const active = isActive(item.to, item.exact);
                    const Icon = item.icon;
                    const primary = "primary" in item && item.primary;
                    return (
                      <Link
                        key={item.to}
                        to={item.to}
                        data-tour={tourTargetFor(item.to)}
                        title={desktopSidebarCollapsed ? navLabel(item) : undefined}
                        className={`group relative flex items-center rounded-lg text-[13px] font-medium tracking-normal transition-all duration-200 ease-out ${
                          desktopSidebarCollapsed ? "h-9 justify-center px-0" : "h-8 gap-2.5 px-2.5"
                        } ${
                          active
                            ? "bg-foreground text-background shadow-[0_1px_2px_rgba(0,0,0,0.08),0_4px_12px_rgba(0,0,0,0.06)]"
                            : primary
                              ? "text-foreground hover:bg-muted/70"
                              : "text-muted-foreground hover:bg-muted/65 hover:text-foreground"
                        }`}
                      >
                        {!desktopSidebarCollapsed && primary && !active && (
                          <span className="absolute left-1 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-emerald-500/55" />
                        )}
                        <Icon
                          className={`h-4 w-4 shrink-0 transition-transform duration-200 ease-out ${
                            active ? "" : "group-hover:scale-[1.04]"
                          }`}
                          strokeWidth={active ? 2.1 : 1.75}
                        />
                        {!desktopSidebarCollapsed && <span className="truncate">{navLabel(item)}</span>}
                      </Link>
                    );
                  })}
                </div>
              </div>
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
        data-tour="admin-header"
        className={`sticky top-0 z-20 flex items-center justify-between border-b border-border/70 bg-background/88 px-4 py-3 backdrop-blur-2xl transition-[margin] duration-300 ease-out md:px-8 md:py-4 ${
          desktopSidebarCollapsed ? "md:ml-20" : "md:ml-60"
        }`}
      >
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-[17px] font-light tracking-tight md:text-xl">
              {ownerGreeting.title}
            </h1>
            {premiumIndicatorVisible && (
              <PremiumHeaderBadge
                tone={premiumIndicatorTone}
                tooltip={premiumTooltip}
              />
            )}
          </div>
          <p className="mt-0.5 truncate text-[11px] font-medium text-muted-foreground md:text-xs">
            {ownerGreeting.subtitle}
          </p>
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
        <div
          className={`admin-content mx-auto max-w-6xl px-3 pt-3 sm:px-4 md:px-8 md:pb-10 md:pt-8 ${
            isBalcaoPage
              ? "pb-[calc(env(safe-area-inset-bottom)+5.75rem)]"
              : "pb-[calc(env(safe-area-inset-bottom)+5.75rem)]"
          }`}
        >
          {showCancellationBanner && (
            <CancellationScheduledBanner endDate={billingQuery.data!.nextBillingAt} />
          )}
          {showTrialBanner && <TrialPremiumBanner billing={billingQuery.data!} />}
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
          <div className="absolute inset-x-3 bottom-[calc(max(env(safe-area-inset-bottom),8px)+5rem)] top-[calc(max(env(safe-area-inset-top),0px)+0.75rem)] flex min-h-0 flex-col overflow-hidden rounded-[1.2rem] border border-border/80 bg-card/98 shadow-2xl shadow-black/35">
            <div className="flex shrink-0 items-center justify-between border-b border-border/70 px-3.5 py-2.5">
              <div>
                <p className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
                  Menu
                </p>
                <p className="text-sm font-medium">Navegação do painel</p>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="grid size-8 place-items-center rounded-xl border border-border bg-background/80 text-muted-foreground"
                aria-label="Fechar menu"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-2 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-2">
              {secondaryMobileGroups.map((group) => {
                return (
                  <section key={group.label}>
                    <p className="px-2 pb-1 text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground/75">
                      {group.label}
                    </p>
                    <div className="space-y-1">
                      {group.items.map((item) => {
                        const active = isActive(item.to, item.exact);
                        const Icon = item.icon;
                        const primary = "primary" in item && item.primary;
                        return (
                      <Link
                            key={item.to}
                            to={item.to}
                            data-tour={tourTargetFor(item.to)}
                            onClick={() => setMobileMenuOpen(false)}
                            className={`flex min-h-11 items-center gap-2.5 rounded-xl px-2.5 text-sm transition ${
                              active
                                ? "bg-foreground text-background shadow-sm"
                                : primary
                                  ? "text-foreground hover:bg-muted/70"
                                  : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                            }`}
                          >
                            <span
                              className={`grid size-8 shrink-0 place-items-center rounded-lg ${
                                active
                                  ? "bg-background/15 text-background"
                                  : primary
                                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                    : "bg-muted text-muted-foreground"
                              }`}
                            >
                              <Icon className="h-4 w-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold">{navLabel(item)}</span>
                              <span
                                className={`block truncate text-[11px] ${
                                  active ? "text-background/70" : "text-muted-foreground"
                                }`}
                              >
                                {item.to === "/admin/servicos" && "Serviços, categorias e preços"}
                                {item.to === "/admin/equipa" && segment.labels.teamDescription}
                                {item.to === "/admin/horarios" && "Disponibilidade e folgas"}
                                {item.to === "/admin/whatsapp" && "Seguidores e WhatsApp"}
                                {item.to === "/admin/marca" && "Marca e página pública"}
                                {item.to === "/admin/politicas" && "Cancelamentos e reembolsos"}
                                {item.to === "/admin/indicacoes" && "Convide estúdios"}
                                {item.to === "/admin/premium" && "Plano e renovação"}
                                {item.to === "/admin/guia-rapido" && "Primeiros passos"}
                                {item.to === "/admin/recebimento" && "Conta Stripe e sinais"}
                                {item.to === "/admin/pagamentos" && "Pagamentos e financeiro"}
                                {item.to === "/admin/central" && "Operações Bellza"}
                              </span>
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-card/96 px-3 pb-[max(env(safe-area-inset-bottom),8px)] pt-2 shadow-[0_-16px_36px_rgba(0,0,0,0.35)] backdrop-blur-2xl md:hidden">
        <div className="mx-auto flex w-fit max-w-full items-center justify-center gap-1.5 overflow-x-auto rounded-[1.65rem] bg-background/35 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {directMobileNav.map((item) => {
            const active = isActive(item.to, item.exact);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                data-tour={tourTargetFor(item.to)}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex h-14 min-w-[4.25rem] shrink-0 flex-col items-center justify-center gap-1.5 rounded-2xl px-2 text-[10px] font-semibold leading-none tracking-normal transition ${
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
              data-tour="nav-more"
              onClick={() => setMobileMenuOpen((open) => !open)}
              className={`flex h-14 min-w-[4.25rem] shrink-0 flex-col items-center justify-center gap-1.5 rounded-2xl px-2 text-[10px] font-semibold leading-none tracking-normal transition ${
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
      {accessMode === "full" && (
        <AdminQuickTour
          role={studio.role}
          setMobileMenuOpen={setMobileMenuOpen}
          studioId={studio.id}
        />
      )}
    </div>
  );
}

function groupNavItems(items: Array<(typeof NAV)[number]>) {
  const groups = ["Operação", "Gestão", "Configuração", "Administração"] as const;
  return groups
    .map((label) => ({
      label,
      items: items.filter((item) => item.group === label),
    }))
    .filter((group) => group.items.length > 0);
}

function AdminQuickTour({
  studioId,
  role,
  setMobileMenuOpen,
}: {
  studioId: string;
  role: AppRole;
  setMobileMenuOpen: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const currentStep = ADMIN_TOUR_STEPS[stepIndex];
  const storageKey = `${ADMIN_TOUR_STORAGE_PREFIX}:${studioId}:${role}`;
  const isLast = stepIndex === ADMIN_TOUR_STEPS.length - 1;

  useEffect(() => {
    if (role !== "studio_owner" && role !== "manager" && role !== "saas_owner") return;
    if (pathname.startsWith("/admin/guia-rapido")) return;
    const stored = window.localStorage.getItem(storageKey);
    if (stored === "done" || stored === "skipped") return;
    const timer = window.setTimeout(() => {
      setReady(true);
      setOpen(true);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [pathname, role, storageKey]);

  useEffect(() => {
    const startTour = () => {
      setStepIndex(0);
      setReady(true);
      setOpen(true);
    };
    window.addEventListener("bellza:start-admin-tour", startTour);
    return () => window.removeEventListener("bellza:start-admin-tour", startTour);
  }, []);

  useEffect(() => {
    if (!open) {
      setTargetRect(null);
      return;
    }

    let cancelled = false;
    let retryTimer: number | null = null;
    let scrollTimer: number | null = null;

    setTargetRect(null);

    const mobileViewport = () => window.matchMedia("(max-width: 767px)").matches;
    const pathCompatible = isTourPathCompatible(pathname, currentStep.route);

    if (!pathCompatible) {
      setMobileMenuOpen(false);
      navigate({ to: currentStep.route as never, replace: false });
      return;
    }

    setMobileMenuOpen(Boolean("mobileMenu" in currentStep && currentStep.mobileMenu && mobileViewport()));

    const update = (attempt = 0) => {
      if (cancelled) return;
      const targets = Array.from(
        document.querySelectorAll<HTMLElement>(`[data-tour="${currentStep.target}"]`),
      );
      const target =
        targets.find((candidate) => {
          const candidateRect = candidate.getBoundingClientRect();
          return candidateRect.width > 0 && candidateRect.height > 0;
        }) ?? targets[0];
      if (!target) {
        setTargetRect(null);
        if (attempt < 40) {
          retryTimer = window.setTimeout(() => update(attempt + 1), 100);
        } else if (!isLast) {
          setStepIndex((index) => Math.min(ADMIN_TOUR_STEPS.length - 1, index + 1));
        } else {
          window.localStorage.setItem(storageKey, "done");
          setMobileMenuOpen(false);
          setOpen(false);
        }
        return;
      }

      const rect = target.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        setTargetRect(null);
        if (attempt < 40) {
          retryTimer = window.setTimeout(() => update(attempt + 1), 100);
        } else if (!isLast) {
          setStepIndex((index) => Math.min(ADMIN_TOUR_STEPS.length - 1, index + 1));
        } else {
          window.localStorage.setItem(storageKey, "done");
          setMobileMenuOpen(false);
          setOpen(false);
        }
        return;
      }

      const outsideViewport =
        rect.bottom <= 8 ||
        rect.top >= window.innerHeight - 8 ||
        rect.right <= 8 ||
        rect.left >= window.innerWidth - 8;
      if (outsideViewport) {
        target.scrollIntoView({
          block: "center",
          inline: "nearest",
          behavior: mobileViewport() ? "smooth" : "auto",
        });
        scrollTimer = window.setTimeout(() => update(attempt + 1), mobileViewport() ? 320 : 80);
        return;
      }

      setTargetRect(rect);
    };

    const refresh = () => update();

    update();
    window.addEventListener("resize", refresh);
    window.addEventListener("scroll", refresh, true);
    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      if (scrollTimer) window.clearTimeout(scrollTimer);
      window.removeEventListener("resize", refresh);
      window.removeEventListener("scroll", refresh, true);
    };
  }, [currentStep, isLast, navigate, open, pathname, setMobileMenuOpen, storageKey]);

  if (!ready || !open || !targetRect) return null;

  const progress = `${stepIndex + 1}/${ADMIN_TOUR_STEPS.length}`;

  function skipTour() {
    window.localStorage.setItem(storageKey, "skipped");
    setMobileMenuOpen(false);
    setOpen(false);
  }

  function finishTour() {
    window.localStorage.setItem(storageKey, "done");
    setMobileMenuOpen(false);
    setOpen(false);
  }

  return (
    <>
      {targetRect && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-50 rounded-2xl border border-emerald-400/85 shadow-[0_0_0_9999px_rgba(15,23,42,0.10),0_0_0_6px_rgba(16,185,129,0.15),0_16px_40px_rgba(0,0,0,0.18)] transition-all duration-300 ease-out"
          style={{
            left: Math.max(8, targetRect.left - 6),
            top: Math.max(8, targetRect.top - 6),
            width: Math.min(window.innerWidth - Math.max(8, targetRect.left - 6) - 8, targetRect.width + 12),
            height: Math.min(window.innerHeight - Math.max(8, targetRect.top - 6) - 8, targetRect.height + 12),
          }}
        />
      )}
      <section className="fixed inset-x-3 bottom-[calc(max(env(safe-area-inset-bottom),8px)+5.35rem)] z-50 mx-auto max-h-[min(62dvh,23rem)] max-w-md overflow-hidden rounded-[1.2rem] border border-border/80 bg-card/98 p-3.5 shadow-2xl shadow-black/25 backdrop-blur-2xl md:bottom-5 md:left-auto md:right-5 md:mx-0 md:max-h-[calc(100dvh-2.5rem)] md:w-[24rem]">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                Guia inicial
              </p>
              <span className="rounded-full bg-muted/60 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                {progress}
              </span>
            </div>
            <h2 className="mt-1 text-base font-semibold tracking-tight">{currentStep.title}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{currentStep.body}</p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-6 gap-1" aria-hidden="true">
          {ADMIN_TOUR_STEPS.map((step, index) => (
            <span
              key={step.target}
              className={`h-1.5 rounded-full transition-colors ${
                index <= stepIndex ? "bg-emerald-500" : "bg-muted"
              }`}
            />
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={skipTour}
            className="h-10 shrink-0 rounded-xl px-3 text-xs font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            Pular
          </button>
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setStepIndex((index) => Math.max(0, index - 1))}
              disabled={stepIndex === 0}
              className="h-10 shrink-0 rounded-xl border border-border bg-background/70 px-3 text-xs font-semibold transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45"
            >
              Voltar
            </button>
            <button
              type="button"
              onClick={isLast ? finishTour : () => setStepIndex((index) => Math.min(ADMIN_TOUR_STEPS.length - 1, index + 1))}
              className="inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-xl bg-foreground px-4 text-xs font-semibold text-background shadow-sm transition hover:-translate-y-0.5 hover:opacity-95"
            >
              <span className="truncate">{isLast ? "Concluir" : "Avançar"}</span>
              {!isLast && <ArrowRight className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </section>
    </>
  );
}

function isTourPathCompatible(pathname: string, route: string) {
  if (route === "/admin") return pathname === "/admin";
  return pathname === route || pathname.startsWith(`${route}/`);
}

function PremiumHeaderBadge({
  tone,
  tooltip,
  showTooltip = true,
}: {
  tone: "active" | "scheduled" | "expired";
  tooltip: string;
  showTooltip?: boolean;
}) {
  const [touchTooltipVisible, setTouchTooltipVisible] = useState(false);
  const touchTooltipTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (touchTooltipTimer.current) {
        window.clearTimeout(touchTooltipTimer.current);
      }
    };
  }, []);

  function showTouchTooltip() {
    if (!showTooltip) return;
    if (touchTooltipTimer.current) {
      window.clearTimeout(touchTooltipTimer.current);
    }
    setTouchTooltipVisible(true);
    touchTooltipTimer.current = window.setTimeout(() => {
      setTouchTooltipVisible(false);
      touchTooltipTimer.current = null;
    }, 4200);
  }

  const toneClass =
    tone === "scheduled"
      ? "text-amber-600 focus-visible:ring-amber-400 dark:text-amber-300"
      : tone === "expired"
        ? "text-muted-foreground focus-visible:ring-muted-foreground/40"
        : "text-emerald-600 focus-visible:ring-emerald-400 dark:text-emerald-300";

  return (
    <button
      type="button"
      tabIndex={showTooltip ? 0 : -1}
      aria-label={tooltip}
      onClick={showTouchTooltip}
      className={`group relative inline-grid size-5 shrink-0 place-items-center rounded-md outline-none transition hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-offset-2 ${toneClass}`}
    >
      <span className="relative inline-grid size-[18px] place-items-center">
        <BadgeCheck className="absolute inset-0 h-full w-full fill-current stroke-current" strokeWidth={1.8} />
        <Check className="relative h-3 w-3 text-background" strokeWidth={3} />
      </span>
      {showTooltip && (
        <span
          className={`pointer-events-none absolute left-1/2 top-[calc(100%+0.55rem)] z-40 w-max max-w-[min(16rem,calc(100vw-2rem))] -translate-x-1/2 translate-y-1 rounded-xl border border-border/85 bg-popover px-3.5 py-2.5 text-center text-[11px] font-medium leading-snug text-popover-foreground opacity-0 shadow-[0_16px_40px_rgba(0,0,0,0.14)] transition duration-150 ease-out ${
            touchTooltipVisible
              ? "visible translate-y-0 opacity-100"
              : "invisible group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:visible group-focus-visible:translate-y-0 group-focus-visible:opacity-100"
          }`}
        >
          {tooltip}
        </span>
      )}
    </button>
  );
}

function getOwnerGreeting(studio: { owner_name?: string | null; name: string; staff_name?: string | null }) {
  const name =
    getFirstName(studio.owner_name) ||
    getFirstName(studio.staff_name) ||
    getFirstName(studio.name) ||
    "bem-vinda";
  return {
    title: `${getDayGreeting()}, ${name}`,
    subtitle: "Bem-vinda ao painel Bellza",
  };
}

function getDayGreeting(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return "Bom dia";
  if (hour >= 12 && hour < 18) return "Boa tarde";
  return "Boa noite";
}

function getFirstName(value?: string | null) {
  return value?.trim().split(/\s+/)[0] ?? "";
}

function getPremiumHeaderTooltip(billing?: BillingSummary) {
  if (billing?.cancelAtPeriodEnd) {
    const date = billing.nextBillingAt
      ? new Date(billing.nextBillingAt).toLocaleDateString("pt-PT", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        })
      : "ao fim do ciclo";
    return `O seu plano está com cancelamento agendado e permanecerá ativo até ${date}.`;
  }
  if (billing && !billing.premiumActive && billing.status !== "trialing") {
    return "O seu plano Premium expirou.";
  }
  return "O seu plano Premium está ativo.";
}

function CancellationScheduledBanner({ endDate }: { endDate: string | null }) {
  const formatted = endDate
    ? new Date(endDate).toLocaleDateString("pt-PT", { day: "2-digit", month: "long", year: "numeric" })
    : null;
  return (
    <div className="mb-3 flex w-full flex-col items-center justify-center gap-3 rounded-[1.15rem] border border-amber-300/25 bg-[linear-gradient(135deg,rgba(245,158,11,0.12),rgba(255,255,255,0.025)_48%,rgba(251,191,36,0.08))] px-3.5 py-3 text-center shadow-sm shadow-black/5 md:mb-4 md:px-4">
      <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1.5">
        <div className="flex flex-col items-center justify-center gap-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/30 bg-background/65 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-amber-800 shadow-sm dark:text-amber-200">
            <BadgeCheck className="h-3 w-3 text-amber-500" />
            Cancelamento agendado
          </span>
          <span className="text-center text-[11px] font-medium text-muted-foreground">
            O Premium continua ativo até
          </span>
        </div>
        <p className="text-lg font-semibold leading-tight tracking-tight text-foreground md:text-xl">
          {formatted ?? "ao fim do ciclo"}
        </p>
        <p className="max-w-2xl text-[11px] leading-snug text-muted-foreground">
          Reative para manter o acesso sem interrupção.
        </p>
      </div>
      <Link
        to="/admin/premium"
        className="inline-flex h-9 shrink-0 items-center justify-center rounded-xl border border-amber-300/40 bg-amber-500/15 px-4 text-xs font-black text-amber-900 shadow-sm transition hover:-translate-y-0.5 hover:border-amber-300/65 hover:bg-amber-500/22 dark:text-amber-100"
      >
        Reativar assinatura
      </Link>
    </div>
  );
}

function TrialPremiumBanner({ billing }: { billing: BillingSummary }) {
  if (!isPureTrialBilling(billing)) return null;
  const remaining = getBillingDaysRemaining(billing);
  const urgent = remaining !== null && remaining <= 3;
  const dateLabel = formatBillingDate(billing.trialEndsAt ?? billing.nextBillingAt);
  const progress =
    remaining === null ? 35 : Math.min(100, Math.max(6, ((14 - remaining) / 14) * 100));
  return (
    <section
      className={`mb-4 overflow-hidden rounded-[1.35rem] border p-4 shadow-lg md:mb-5 md:rounded-[1.6rem] md:p-5 ${
        urgent
          ? "border-amber-500/35 bg-[linear-gradient(135deg,rgba(245,158,11,0.16),rgba(255,255,255,0.02)_48%,rgba(16,185,129,0.08))] shadow-amber-950/10"
          : "border-emerald-700/25 bg-[linear-gradient(135deg,rgba(16,185,129,0.14),rgba(255,255,255,0.02)_48%,rgba(16,185,129,0.05))] shadow-black/10"
      }`}
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
            <Sparkles className="h-4 w-4" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em]">
              Teste gratuito ativo
            </p>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-xl font-light tracking-tight md:text-2xl">
                {remaining === 1
                  ? "Resta 1 dia do teste gratuito"
                  : `Restam ${remaining ?? "--"} dias do teste gratuito`}
              </h2>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Após o fim do teste será necessário ativar uma assinatura Premium para continuar a utilizar o painel.
              </p>
            </div>
            <span className="w-fit rounded-full bg-background/80 px-3 py-1.5 text-xs font-semibold text-foreground shadow-sm">
              {dateLabel}
            </span>
          </div>
          <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-background/75 ring-1 ring-border/60">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                urgent ? "bg-amber-500" : "bg-emerald-600"
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:w-72 lg:grid-cols-1">
          <Link
            to="/admin/premium"
            className="flex h-11 items-center justify-center gap-2 rounded-2xl bg-foreground px-4 text-xs font-bold uppercase tracking-wide text-background transition hover:opacity-90"
          >
            Ativar Premium
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <Link
            to="/admin/premium"
            className="flex h-11 items-center justify-center rounded-2xl border border-border bg-background/70 px-4 text-xs font-bold uppercase tracking-wide text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            Ver planos
          </Link>
        </div>
      </div>
    </section>
  );
}

function isStripePlan(plan?: string | null) {
  return plan === "monthly" || plan === "quarterly" || plan === "yearly";
}

function isPureTrialBilling(billing: BillingSummary) {
  return Boolean(
    billing.premiumActive &&
      billing.status === "trialing" &&
      !isStripePlan(billing.plan) &&
      futureBillingDate(billing.trialEndsAt ?? billing.nextBillingAt),
  );
}

function isPaidSubscriptionBilling(billing: BillingSummary) {
  return Boolean(
    isStripePlan(billing.plan) &&
      billing.status !== "trialing" &&
      billing.status !== "checkout_pending",
  );
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





