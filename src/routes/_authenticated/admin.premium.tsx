import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertCircle,
  ArrowRight,
  BadgeCheck,
  Check,
  CreditCard,
  LifeBuoy,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
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
  detail: string;
  savings?: string;
  highlighted?: boolean;
}[] = [
  {
    id: "monthly",
    name: "Mensal",
    price: "8,99 €",
    cadence: "por mês",
    detail: "Flexível, sem fidelização.",
  },
  {
    id: "quarterly",
    name: "Trimestral",
    price: "22,49 €",
    cadence: "a cada 3 meses",
    detail: "Equivale a 7,50 €/mês.",
    savings: "Poupa face ao mensal",
  },
  {
    id: "yearly",
    name: "Anual",
    price: "71,99 €",
    cadence: "por ano",
    detail: "Equivale a 6,00 €/mês.",
    savings: "Melhor valor",
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
    staleTime: 15 * 1000,
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

  async function manageSubscription() {
    if (!studio) return;
    setPortalLoading(true);
    try {
      const result = (await openBillingPortal({ data: { studioId: studio.id } })) as {
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
    <div className="mx-auto flex max-w-5xl flex-col gap-5 py-2 md:py-6">
      <section className="overflow-hidden rounded-[1.65rem] border border-border bg-card shadow-xl shadow-black/5">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className={`relative overflow-hidden p-6 md:p-8 ${status.heroClass}`}>
            <div className="relative">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ${status.badgeClass}`}>
                  <status.icon className="h-3.5 w-3.5" />
                  {status.badge}
                </span>
                {currentPlan && (
                  <span className="rounded-full border border-border/70 bg-background/72 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    {formatPlan(currentPlan)}
                  </span>
                )}
              </div>

              <h1 className="mt-5 max-w-2xl text-3xl font-light tracking-tight md:text-4xl">
                {status.title}
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground md:text-base">
                {status.description}
              </p>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {hasStripeSubscription && (
                  <>
                    <SummaryTile
                      label="Estado"
                      value={formatStatus(summary?.status, activeSubscription)}
                      helper={canceledButValid ? "Cancelamento agendado" : "Premium liberado"}
                    />
                    <SummaryTile
                      label={canceledButValid ? "Ativo até" : "Próxima renovação"}
                      value={formatDate(renewalDate, activeSubscription)}
                      helper={renewalDate ? "Plano em dia" : "Plano ativo"}
                    />
                  </>
                )}
                {!hasStripeSubscription && (
                  <>
                    <SummaryTile
                      label={trialOnly ? "Fim do teste" : "Acesso"}
                      value={trialOnly ? formatDate(trialDate) : locked ? "Bloqueado" : "A confirmar"}
                      helper={trialOnly ? `${summary?.daysRemaining ?? "--"} dias restantes` : "Escolha um plano premium"}
                    />
                    <SummaryTile
                      label="Plano atual"
                      value={formatPlan(summary?.plan)}
                      helper={trialOnly ? "Teste gratuito" : "Sem plano premium ativo"}
                    />
                  </>
                )}
              </div>
            </div>
          </div>

          <aside className="border-t border-border bg-background/65 p-5 lg:border-l lg:border-t-0 md:p-6">
            <div className="rounded-2xl border border-emerald-700/20 bg-emerald-950/5 p-4">
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                <Sparkles className="h-4 w-4" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em]">
                  Gestão premium
                </p>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Atualize pagamento, consulte faturas ou cancele quando precisar.
              </p>
            </div>

            <div className="mt-4 grid gap-2">
              {hasStripeSubscription && (
                <>
                  <ActionButton
                    label={portalLoading ? "A abrir gestão..." : "Gerir assinatura"}
                    icon={CreditCard}
                    disabled={portalLoading}
                    onClick={() => void manageSubscription()}
                    primary
                  />
                  <ActionButton
                    label="Cancelar assinatura"
                    icon={ShieldCheck}
                    disabled={portalLoading}
                    onClick={() => void manageSubscription()}
                  />
                </>
              )}
              {paymentPending && (
                <ActionButton
                  label="Atualizar pagamento"
                  icon={RefreshCcw}
                  disabled={portalLoading}
                  onClick={() => void manageSubscription()}
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
                className="flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-border bg-card px-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <LifeBuoy className="h-4 w-4" />
                Contactar suporte
              </a>
            </div>
          </aside>
        </div>
      </section>

      <section className="rounded-[1.5rem] border border-border bg-card p-5 shadow-sm md:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Planos disponíveis
            </p>
            <h2 className="mt-2 text-2xl font-light tracking-tight">
              {hasStripeSubscription ? "Alterar plano" : "Escolha o plano ideal"}
            </h2>
          </div>
          {hasStripeSubscription && (
            <p className="max-w-md text-sm text-muted-foreground">
              Escolha outro plano quando quiser ajustar o ciclo de pagamento.
            </p>
          )}
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          {PLANS.map((plan) => {
            const current = plan.id === currentPlan;
            return (
              <article
                key={plan.id}
                className={`flex min-h-[15rem] flex-col rounded-2xl border p-4 transition ${
                  current
                    ? "border-emerald-600 bg-emerald-950/5 shadow-lg shadow-emerald-950/5"
                    : plan.highlighted
                      ? "border-emerald-700/35 bg-emerald-950/5"
                      : "border-border bg-background/55"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-semibold">{plan.name}</h3>
                      {current && <PlanBadge label="Plano atual" />}
                      {!current && plan.savings && <PlanBadge label={plan.savings} muted />}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{plan.detail}</p>
                  </div>
                </div>
                <div className="mt-5">
                  <p className="text-3xl font-light tracking-tight">{plan.price}</p>
                  <p className="mt-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    {plan.cadence}
                  </p>
                </div>
                <div className="mt-5 space-y-2 text-sm text-muted-foreground">
                  <Feature text="Pagamento seguro" />
                  <Feature text="Cancelamento simples" />
                  <Feature text="Suporte por email" />
                </div>
                <button
                  type="button"
                  disabled={checkoutPlan !== null || changingPlan !== null || current}
                  onClick={() =>
                    hasStripeSubscription ? void switchPlan(plan.id) : void activate(plan.id)
                  }
                  className={`mt-auto flex h-11 w-full items-center justify-center gap-2 rounded-2xl text-xs font-bold uppercase tracking-wide transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    current
                      ? "border border-emerald-700/30 bg-emerald-950/5 text-emerald-700 dark:text-emerald-300"
                      : "bg-foreground text-background hover:opacity-90"
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

function SummaryTile({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border/70 bg-background/72 px-4 py-3 shadow-sm">
      <p className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 truncate text-base font-semibold">{value}</p>
      <p className="mt-1 truncate text-xs text-muted-foreground">{helper}</p>
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
      className={`flex min-h-11 items-center justify-center gap-2 rounded-2xl px-4 text-xs font-bold uppercase tracking-wide transition disabled:opacity-60 ${
        primary
          ? "bg-foreground text-background hover:opacity-90"
          : "border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
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

function Feature({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="grid size-5 place-items-center rounded-full bg-emerald-500 text-white">
        <Check className="h-3 w-3" />
      </span>
      {text}
    </div>
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
  if (!value) return activeSubscription ? "Plano ativo" : "Pendente";
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
      title: "Atualize o pagamento para manter o premium.",
      description:
        "Atualize o método de pagamento para manter o acesso premium.",
      icon: AlertCircle,
      badgeClass: "bg-amber-500 text-amber-950",
      heroClass: "bg-amber-50 dark:bg-amber-950/10",
    };
  }
  if (input.canceledButValid) {
    return {
      badge: "Premium ativo",
      title: "Plano premium ativo.",
      description:
        "O cancelamento está agendado. O acesso permanece disponível até ao fim do ciclo.",
      icon: BadgeCheck,
      badgeClass: "bg-emerald-600 text-white",
      heroClass: "bg-emerald-50 dark:bg-emerald-950/10",
    };
  }
  if (input.activeSubscription) {
    return {
      badge: "Premium ativo",
      title: "Plano premium ativo.",
      description:
        "Acesso premium liberado para a sua equipa.",
      icon: BadgeCheck,
      badgeClass: "bg-emerald-600 text-white",
      heroClass: "bg-emerald-50 dark:bg-emerald-950/10",
    };
  }
  if (input.trialOnly) {
    return {
      badge: "Teste gratuito",
      title: "Teste gratuito ativo.",
      description:
        "Escolha um plano quando quiser manter o acesso após o teste.",
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
