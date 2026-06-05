import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertCircle,
  ArrowRight,
  BadgeCheck,
  CreditCard,
  LifeBuoy,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useCurrentStudio } from "@/hooks/use-current-studio";
import {
  createPlatformBillingPortalSession,
  createPlatformCheckoutSession,
  getPlatformSubscriptionSummary,
  updatePlatformSubscriptionPlan,
} from "@/lib/subscriptions.functions";

export const Route = createFileRoute("/_authenticated/admin/premium")({
  head: () => ({ meta: [{ title: "Assinatura - Bellza" }] }),
  component: PremiumAccessPage,
});

type PlanId = "monthly" | "quarterly" | "yearly";

type BillingSummary = {
  premiumActive: boolean;
  status: string;
  plan?: string | null;
  nextBillingAt: string | null;
  trialEndsAt?: string | null;
  daysRemaining?: number | null;
  cancelAtPeriodEnd?: boolean;
};

const PLANS: {
  id: PlanId;
  name: string;
  price: string;
  cadence: string;
  savings?: string;
  highlighted?: boolean;
}[] = [
  {
    id: "monthly",
    name: "Mensal",
    price: "8,99 €",
    cadence: "por mês",
  },
  {
    id: "quarterly",
    name: "Trimestral",
    price: "22,49 €",
    cadence: "a cada 3 meses",
    savings: "7,50 €/mês",
  },
  {
    id: "yearly",
    name: "Anual",
    price: "71,99 €",
    cadence: "por ano",
    savings: "6,00 €/mês",
    highlighted: true,
  },
];

function PremiumAccessPage() {
  const { studio } = useCurrentStudio();
  const loadBilling = useServerFn(getPlatformSubscriptionSummary);
  const startCheckout = useServerFn(createPlatformCheckoutSession);
  const openBillingPortal = useServerFn(createPlatformBillingPortalSession);
  const changePlan = useServerFn(updatePlatformSubscriptionPlan);
  const [checkoutPlan, setCheckoutPlan] = useState<PlanId | null>(null);
  const [changingPlan, setChangingPlan] = useState<PlanId | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);

  const billing = useQuery({
    queryKey: ["premium-page-subscription-summary", studio?.id],
    enabled: !!studio,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    queryFn: async () =>
      (await loadBilling({ data: { studioId: studio!.id } })) as BillingSummary,
  });

  const summary = billing.data;
  const currentPlan = isStripePlan(summary?.plan) ? (summary?.plan as PlanId) : null;
  const hasStripeSubscription = Boolean(currentPlan);
  const paymentPending = isPaymentPending(summary?.status);
  const canceledButValid = Boolean(
    hasStripeSubscription && summary?.cancelAtPeriodEnd && summary.premiumActive,
  );
  const activeSubscription = Boolean(
    hasStripeSubscription && summary?.premiumActive && !paymentPending,
  );
  const trialOnly = Boolean(!hasStripeSubscription && summary?.status === "trialing" && summary.premiumActive);
  const locked = Boolean(summary && !summary.premiumActive && !hasStripeSubscription);
  const renewalDate = futureDate(summary?.nextBillingAt);
  const trialDate = futureDate(summary?.trialEndsAt);
  const status = getVisualStatus({
    activeSubscription,
    canceledButValid,
    paymentPending,
    trialOnly,
    locked,
  });
  const titlePlan = currentPlan ? formatPlan(currentPlan) : formatPlan(summary?.plan);
  const renewalText = getRenewalText({
    activeSubscription,
    canceledButValid,
    renewalDate,
    trialOnly,
    trialDate,
  });

  useEffect(() => {
    const refresh = () => {
      if (studio) void billing.refetch();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [billing, studio]);

  async function activate(plan: PlanId) {
    if (!studio) return;
    setCheckoutPlan(plan);
    try {
      const result = (await startCheckout({ data: { studioId: studio.id, plan } })) as {
        url?: string | null;
      };
      if (!result.url) throw new Error("checkout_unavailable");
      window.location.href = result.url;
    } catch {
      toast.error("Não foi possível abrir o checkout seguro. Tente novamente.");
    } finally {
      setCheckoutPlan(null);
    }
  }

  async function manageSubscription(action: "manage" | "cancel" = "manage") {
    if (!studio) return;
    setPortalLoading(true);
    try {
      const result = (await openBillingPortal({ data: { studioId: studio.id, action } })) as {
        url?: string | null;
      };
      if (!result.url) throw new Error("portal_unavailable");
      window.location.href = result.url;
    } catch {
      toast.error("Não foi possível abrir a gestão da assinatura.");
    } finally {
      setPortalLoading(false);
    }
  }

  async function switchPlan(plan: PlanId) {
    if (!studio || plan === currentPlan) return;
    setChangingPlan(plan);
    try {
      await changePlan({ data: { studioId: studio.id, plan } });
      toast.success("Plano atualizado.");
      await billing.refetch();
    } catch {
      toast.error("Não foi possível alterar o plano. Abra a gestão da assinatura ou tente novamente.");
    } finally {
      setChangingPlan(null);
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 py-2 md:py-6">
      <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-[#080808] text-white shadow-[0_24px_70px_rgba(0,0,0,0.18)]">
        <div className="grid gap-0 overflow-hidden lg:grid-cols-[minmax(0,1fr)_23rem]">
          <div className="relative p-6 md:p-10 lg:p-12">
            <div className="relative max-w-2xl">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] shadow-sm ${status.badgeClass}`}>
                  <status.icon className="h-3.5 w-3.5" />
                  {status.badge}
                </span>
              </div>

              <h1 className="mt-6 text-4xl font-light tracking-tight md:text-5xl">
                {activeSubscription || canceledButValid ? titlePlan : status.title}
              </h1>
              <p className="mt-4 text-base font-medium text-white/68">
                {renewalText || status.description}
              </p>
            </div>
          </div>

          <aside className="border-t border-white/10 bg-white/[0.055] p-5 lg:border-l lg:border-t-0 md:p-6">
            <div className="mb-4 grid gap-3">
              {hasStripeSubscription && (
                <>
                  <SummaryTile label="Plano atual" value={titlePlan} />
                  <SummaryTile
                    label={canceledButValid ? "Ativo até" : "Próxima cobrança"}
                    value={formatDate(renewalDate, activeSubscription)}
                  />
                  <SummaryTile label="Estado" value={formatStatus(summary?.status, activeSubscription)} />
                </>
              )}
              {!hasStripeSubscription && (
                <>
                  <SummaryTile label="Plano atual" value={formatPlan(summary?.plan)} />
                  <SummaryTile
                    label={trialOnly ? "Fim do teste" : "Acesso"}
                    value={trialOnly ? formatDate(trialDate) : locked ? "Bloqueado" : "Pendente"}
                  />
                </>
              )}
            </div>
            <div className="grid gap-2">
              {hasStripeSubscription && (
                <>
                  <ActionButton
                    label={portalLoading ? "A abrir gestão..." : "Gerir assinatura"}
                    icon={CreditCard}
                    disabled={portalLoading}
                    onClick={() => void manageSubscription("manage")}
                    primary
                  />
                  <ActionButton
                    label="Cancelar assinatura"
                    icon={ShieldCheck}
                    disabled={portalLoading}
                    onClick={() => void manageSubscription("cancel")}
                  />
                </>
              )}
              {paymentPending && (
                <ActionButton
                  label="Atualizar pagamento"
                  icon={RefreshCcw}
                  disabled={portalLoading}
                  onClick={() => void manageSubscription("manage")}
                  primary
                />
              )}
              {!hasStripeSubscription && (
                <ActionButton
                  label="Escolher plano premium"
                  icon={ArrowRight}
                  disabled={false}
                  onClick={() => {
                    const plan = PLANS.find((item) => item.highlighted)?.id ?? "monthly";
                    void activate(plan);
                  }}
                  primary
                />
              )}
              <a
                href="mailto:info@bellza.pt"
                className="flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-white/12 bg-white/[0.04] px-4 text-xs font-semibold uppercase tracking-wide text-white/62 transition hover:bg-white/[0.1] hover:text-white"
              >
                <LifeBuoy className="h-4 w-4" />
                Contactar suporte
              </a>
            </div>
          </aside>
        </div>
      </section>

      <section className="rounded-[1.5rem] border border-border bg-card p-5 shadow-sm md:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Planos disponíveis
            </p>
            <h2 className="mt-2 text-2xl font-light tracking-tight">
              {hasStripeSubscription ? "Alterar plano" : "Escolha o plano ideal"}
            </h2>
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          {PLANS.map((plan) => {
            const current = plan.id === currentPlan;
            return (
              <article
                key={plan.id}
                className={`relative flex min-h-[13.5rem] flex-col overflow-hidden rounded-[1.35rem] border p-5 transition ${
                  current
                    ? "border-emerald-500/70 bg-emerald-500/5 shadow-[0_18px_40px_rgba(16,185,129,0.10)]"
                    : plan.highlighted
                      ? "border-foreground/15 bg-background/80 shadow-sm hover:-translate-y-0.5 hover:shadow-xl"
                      : "border-border bg-background/70 shadow-sm hover:-translate-y-0.5 hover:shadow-xl"
                }`}
              >
                {current && <div className="absolute inset-x-5 top-0 h-px bg-emerald-400" />}
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-xl font-semibold">{plan.name}</h3>
                  {current && <PlanBadge label="Plano atual" />}
                </div>
                <div className="mt-5">
                  <p className="text-4xl font-light tracking-tight">{plan.price}</p>
                  <p className="mt-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    {plan.cadence}
                  </p>
                </div>
                <p className="mt-4 min-h-5 text-sm font-medium text-emerald-600 dark:text-emerald-300">
                  {current ? "Ativo" : plan.savings ?? ""}
                </p>
                <button
                  type="button"
                  disabled={checkoutPlan !== null || changingPlan !== null || current}
                  onClick={() =>
                    hasStripeSubscription ? void switchPlan(plan.id) : void activate(plan.id)
                  }
                  className={`mt-auto flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-xs font-bold uppercase tracking-wide transition disabled:cursor-not-allowed disabled:opacity-70 ${
                    current
                      ? "border border-emerald-600/25 bg-emerald-950/5 text-emerald-700 dark:text-emerald-300"
                      : "bg-foreground text-background shadow-lg shadow-black/10 hover:-translate-y-0.5 hover:opacity-90"
                  }`}
                >
                  {current
                    ? "Plano atual"
                    : changingPlan === plan.id
                      ? "A alterar..."
                      : checkoutPlan === plan.id
                        ? "A abrir checkout..."
                        : hasStripeSubscription
                          ? "Alterar para este plano"
                          : "Escolher plano"}
                  {!current && <ArrowRight className="h-3.5 w-3.5" />}
                </button>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.075] px-4 py-3 shadow-[0_14px_34px_rgba(0,0,0,0.16)]">
      <p className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-white/48">
        {label}
      </p>
      <p className="mt-1 truncate text-base font-semibold text-white">{value}</p>
    </div>
  );
}

function ActionButton({
  label,
  icon: Icon,
  disabled,
  onClick,
  primary,
}: {
  label: string;
  icon: typeof ArrowRight;
  disabled: boolean;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex min-h-12 items-center justify-center gap-2 rounded-2xl px-4 text-xs font-bold uppercase tracking-wide transition disabled:opacity-60 ${
        primary
          ? "bg-white text-black shadow-lg shadow-black/20 hover:-translate-y-0.5 hover:bg-white/92"
          : "border border-white/12 bg-white/[0.06] text-white/72 hover:-translate-y-0.5 hover:bg-white/[0.1] hover:text-white"
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function PlanBadge({ label, muted }: { label: string; muted?: boolean }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
        muted
          ? "bg-muted text-muted-foreground"
          : "bg-emerald-600 text-white shadow-sm"
      }`}
    >
      {label}
    </span>
  );
}

function isStripePlan(plan?: string | null): plan is PlanId {
  return plan === "monthly" || plan === "quarterly" || plan === "yearly";
}

function isPaymentPending(status?: string | null) {
  return status === "past_due" || status === "unpaid" || status === "incomplete";
}

function futureDate(value?: string | null) {
  if (!value) return null;
  return new Date(value).getTime() > Date.now() ? value : null;
}

function formatDate(value?: string | null, activeSubscription = false) {
  if (!value) return activeSubscription ? "Ativa" : "Pendente";
  return new Date(value).toLocaleDateString("pt-PT", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatPlan(plan?: string | null) {
  const map: Record<string, string> = {
    trial: "Teste gratuito",
    monthly: "Premium Mensal",
    quarterly: "Premium Trimestral",
    yearly: "Premium Anual",
    pro: "Premium",
  };
  return map[plan ?? "trial"] ?? "Premium";
}

function formatStatus(status?: string | null, activeSubscription = false) {
  if (activeSubscription && status !== "past_due" && status !== "unpaid") return "Ativo";
  const map: Record<string, string> = {
    active: "Ativo",
    trialing: "Teste gratuito",
    past_due: "Pagamento pendente",
    canceled: "Cancelamento agendado",
    incomplete: "Pagamento a confirmar",
    incomplete_expired: "Expirada",
    unpaid: "Por regularizar",
    paused: "Pausada",
  };
  return map[status ?? ""] ?? "Ativo";
}

function getRenewalText(input: {
  activeSubscription: boolean;
  canceledButValid: boolean;
  renewalDate: string | null;
  trialOnly: boolean;
  trialDate: string | null;
}) {
  if (input.canceledButValid) return `Ativo até ${formatDate(input.renewalDate, true)}`;
  if (input.activeSubscription) {
    return input.renewalDate ? `Renovação em ${formatDate(input.renewalDate, true)}` : "Assinatura ativa";
  }
  if (input.trialOnly) return `Termina em ${formatDate(input.trialDate)}`;
  return null;
}

function getVisualStatus(input: {
  activeSubscription: boolean;
  canceledButValid: boolean;
  paymentPending: boolean;
  trialOnly: boolean;
  locked: boolean;
}) {
  if (input.paymentPending) {
    return {
      badge: "Pagamento pendente",
      title: "Pagamento pendente",
      description: "Atualize o pagamento para manter o acesso premium.",
      icon: AlertCircle,
      badgeClass: "bg-amber-500 text-amber-950",
      heroClass: "bg-amber-50 dark:bg-amber-950/10",
    };
  }
  if (input.canceledButValid) {
    return {
      badge: "Premium ativo",
      title: "Plano premium ativo",
      description: "Acesso disponível até ao fim do ciclo.",
      icon: BadgeCheck,
      badgeClass: "bg-emerald-600 text-white",
      heroClass: "bg-emerald-50 dark:bg-emerald-950/10",
    };
  }
  if (input.activeSubscription) {
    return {
      badge: "Premium ativo",
      title: "Plano premium ativo",
      description: "Acesso premium liberado.",
      icon: BadgeCheck,
      badgeClass: "bg-emerald-600 text-white",
      heroClass: "bg-emerald-50 dark:bg-emerald-950/10",
    };
  }
  if (input.trialOnly) {
    return {
      badge: "Teste gratuito",
      title: "Teste gratuito ativo",
      description: "Escolha um plano para manter o acesso.",
      icon: Sparkles,
      badgeClass: "bg-sky-600 text-white",
      heroClass: "bg-sky-50 dark:bg-sky-950/10",
    };
  }
  return {
    badge: "Ação necessária",
    title: "Escolha um plano para continuar.",
    description:
      "O teste terminou e não existe uma assinatura premium ativa associada a esta conta.",
    icon: AlertCircle,
    badgeClass: "bg-foreground text-background",
    heroClass: "bg-muted/40",
  };
}
