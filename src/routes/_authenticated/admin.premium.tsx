import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, BadgeCheck, CreditCard, RefreshCcw, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  PlanComparison,
  PlanPeriodToggle,
  PlanSummaryCard,
  type BillingCycle,
} from "@/components/plans/plan-presentation";
import { useCurrentStudio } from "@/hooks/use-current-studio";
import { PLAN_COMPARISON } from "@/lib/landing-content";
import { PLAN_DEFINITIONS, type PlanTier } from "@/lib/plan-entitlements";
import {
  createPlatformBillingPortalSession,
  getPlatformSubscriptionSummary,
  reactivatePlatformSubscription,
  schedulePlatformSubscriptionCancellation,
  syncPlatformCheckoutReturn,
  updatePlatformSubscriptionPlan,
} from "@/lib/subscriptions.functions";
import {
  isPaidPlanWorking,
  PlatformCheckoutError,
  prepareStripeBillingNavigation,
  requestPlatformCheckout,
  type BillingAction,
} from "@/lib/subscription-checkout";
import { platformSubscriptionSummaryQueryKey } from "@/lib/admin-query-cache";

export const Route = createFileRoute("/_authenticated/admin/premium")({
  head: () => ({ meta: [{ title: "Planos - Bellza" }] }),
  component: PlansPage,
});

type PaidPlanId = "pro_monthly" | "pro_yearly" | "premium_monthly" | "premium_yearly";

type BillingSummary = {
  premiumActive: boolean;
  subscriptionActive?: boolean;
  effectivePlan?: PlanTier;
  trialActive?: boolean;
  status: string;
  plan?: string | null;
  planTier?: string | null;
  nextBillingAt: string | null;
  trialEndsAt?: string | null;
  daysRemaining?: number | null;
  cancelAtPeriodEnd?: boolean;
  pendingChange?: {
    plan: string;
    effectiveAt: string;
    amount?: number | null;
    currency?: string | null;
  } | null;
};

const FEATURES: Record<PlanTier, readonly string[]> = {
  free: [
    "Agenda e reservas online",
    "Página pública do seu estúdio",
    "Serviços, clientes e 1 profissional",
  ],
  pro: [
    "Equipa e agendas até 3 profissionais",
    "Pagamentos, sinais e notificações",
    "Clientes, presença e relatórios",
  ],
  premium: [
    "WhatsApp e automações com franquia controlada",
    "Fidelidade, promoções e campanhas",
    "Financeiro, equipa e relatórios avançados",
  ],
};

function PlansPage() {
  const { studio } = useCurrentStudio();
  const loadBilling = useServerFn(getPlatformSubscriptionSummary);
  const openBillingPortal = useServerFn(createPlatformBillingPortalSession);
  const changePlan = useServerFn(updatePlatformSubscriptionPlan);
  const scheduleCancellation = useServerFn(schedulePlatformSubscriptionCancellation);
  const reactivateSubscription = useServerFn(reactivatePlatformSubscription);
  const syncCheckoutReturn = useServerFn(syncPlatformCheckoutReturn);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");
  const [workingPlan, setWorkingPlan] = useState<BillingAction>(null);

  const billing = useQuery({
    queryKey: platformSubscriptionSummaryQueryKey(studio?.id),
    enabled: Boolean(studio),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    queryFn: async () =>
      (await loadBilling({ data: { studioId: studio!.id } })) as BillingSummary,
  });

  useEffect(() => {
    const refresh = () => void billing.refetch();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [billing]);

  useEffect(() => {
    const resetAfterBrowserRestore = () => setWorkingPlan(null);
    window.addEventListener("pageshow", resetAfterBrowserRestore);
    return () => window.removeEventListener("pageshow", resetAfterBrowserRestore);
  }, []);

  useEffect(() => {
    if (!studio?.id) return;
    const params = new URLSearchParams(window.location.search);
    const billingResult = params.get("billing");
    const sessionId = params.get("session_id");
    if (billingResult !== "success" && billingResult !== "cancelled") return;

    const clearBillingSearch = () => {
      params.delete("billing");
      params.delete("session_id");
      const search = params.toString();
      window.history.replaceState(
        window.history.state,
        document.title,
        `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`,
      );
    };

    if (billingResult === "cancelled") {
      setWorkingPlan(null);
      toast.info("Checkout cancelado. O seu plano não foi alterado.");
      clearBillingSearch();
      return;
    }

    if (!sessionId) {
      setWorkingPlan(null);
      toast.error("A confirmação do checkout está incompleta. Atualize a página.");
      clearBillingSearch();
      return;
    }

    let active = true;
    clearBillingSearch();
    setWorkingPlan("sync");
    void syncCheckoutReturn({ data: { studioId: studio.id, sessionId } })
      .then(async () => {
        if (!active) return;
        await billing.refetch();
        toast.success("Assinatura confirmada e plano atualizado.");
      })
      .catch((error) => {
        if (active) toast.error(readableBillingError(error));
      })
      .finally(() => {
        if (!active) return;
        setWorkingPlan(null);
      });

    return () => {
      active = false;
    };
  }, [billing, studio?.id, syncCheckoutReturn]);

  const summary = billing.data;
  const effectivePlan = summary?.effectivePlan ?? "free";
  const currentPaidPlan = isPaidPlanId(summary?.plan) ? summary.plan : null;
  const paidSubscriptionActive = Boolean(
    currentPaidPlan &&
      summary?.subscriptionActive &&
      !summary?.trialActive &&
      !isPaymentProblem(summary.status),
  );
  const managedSubscription = Boolean(
    currentPaidPlan &&
      ["active", "trialing", "past_due", "unpaid", "incomplete", "paused"].includes(
        summary?.status ?? "",
      ),
  );
  const pendingPlan = isPaidPlanId(summary?.pendingChange?.plan)
    ? summary?.pendingChange?.plan
    : null;
  const plans = useMemo(() => ["free", "pro", "premium"] as const, []);

  async function activate(plan: PaidPlanId) {
    if (!studio) return;
    const navigation = prepareStripeBillingNavigation();
    setWorkingPlan(plan);
    try {
      const url = await requestPlatformCheckout({ studioId: studio.id, plan });
      navigation.complete(url);
    } catch (error) {
      navigation.cancel();
      toast.error(readableBillingError(error));
    } finally {
      setWorkingPlan(null);
    }
  }

  async function switchPaidPlan(plan: PaidPlanId) {
    if (!studio || plan === currentPaidPlan || plan === pendingPlan) return;
    setWorkingPlan(plan);
    try {
      const result = (await changePlan({ data: { studioId: studio.id, plan } })) as {
        pending?: boolean;
      };
      await billing.refetch();
      toast.success(result.pending ? "Mudança agendada para o próximo ciclo." : "Plano atualizado.");
    } catch (error) {
      toast.error(readableBillingError(error));
    } finally {
      setWorkingPlan(null);
    }
  }

  async function manageSubscription(action: "manage" | "cancel" = "manage") {
    if (!studio) return;
    const navigation = prepareStripeBillingNavigation();
    setWorkingPlan(action);
    try {
      const result = (await openBillingPortal({ data: { studioId: studio.id, action } })) as {
        url?: string | null;
      };
      if (!result.url) throw new Error("portal_unavailable");
      navigation.complete(result.url);
    } catch (error) {
      navigation.cancel();
      toast.error(readableBillingError(error));
    } finally {
      setWorkingPlan(null);
    }
  }

  async function changeToFree() {
    if (!studio || !managedSubscription || summary?.cancelAtPeriodEnd) return;
    setWorkingPlan("free");
    try {
      const result = (await scheduleCancellation({ data: { studioId: studio.id } })) as {
        scheduled?: boolean;
        effectiveAt?: string | null;
      };
      await billing.refetch();
      toast.success(
        result.scheduled && result.effectiveAt
          ? `Mudança para Free agendada para ${formatDate(result.effectiveAt)}.`
          : "O estúdio já continuará no plano Free.",
      );
    } catch (error) {
      toast.error(readableBillingError(error));
    } finally {
      setWorkingPlan(null);
    }
  }

  async function reactivate() {
    if (!studio || !summary?.cancelAtPeriodEnd) return;
    setWorkingPlan("reactivate");
    try {
      const result = (await reactivateSubscription({ data: { studioId: studio.id } })) as {
        reactivated?: boolean;
        requiresCheckout?: boolean;
        paidAccess?: boolean;
      };
      await billing.refetch();
      if (result.requiresCheckout) {
        document.getElementById("opcoes-planos")?.scrollIntoView({ behavior: "smooth" });
        toast.info("A assinatura anterior terminou. Escolha um plano para iniciar um novo Checkout.");
      } else if (result.paidAccess) {
        toast.success("Cancelamento removido. A assinatura continua ativa.");
      } else {
        toast.info("Cancelamento removido. Regularize o pagamento no portal Stripe para recuperar o acesso.");
      }
    } catch (error) {
      toast.error(readableBillingError(error));
    } finally {
      setWorkingPlan(null);
    }
  }

  if (!studio || billing.isLoading) {
    return (
      <div className="flex min-h-[24rem] items-center justify-center">
        <RefreshCcw className="size-5 animate-spin text-muted-foreground" aria-label="A carregar planos" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-5 py-1 md:py-4">
      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Conta</p>
          <h1 className="mt-1 break-words text-2xl font-light tracking-tight md:text-3xl">Planos e faturação</h1>
        </div>
        <div className="shrink-0">
          <PlanPeriodToggle value={billingCycle} onChange={setBillingCycle} tone="admin" />
        </div>
      </div>

      <section className="flex min-w-0 flex-col gap-4 rounded-2xl border border-border/80 bg-card p-4 shadow-[0_10px_30px_rgba(24,24,27,0.045)] sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex min-w-0 items-start gap-3.5">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/10 dark:text-emerald-300">
            {summary?.trialActive ? <Sparkles className="size-5" /> : <BadgeCheck className="size-5" />}
          </span>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <p className="break-words text-sm font-semibold">
                {summary?.trialActive
                  ? "Premium · Teste"
                  : `${PLAN_DEFINITIONS[effectivePlan].name} · ${summary?.cancelAtPeriodEnd ? "Até ao fim do ciclo" : "Plano atual"}`}
              </p>
              {summary?.cancelAtPeriodEnd && (
                <span className="rounded-full bg-amber-500/12 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                  Cancelamento agendado
                </span>
              )}
            </div>
            <p className="mt-1.5 max-w-2xl break-words text-xs leading-relaxed text-muted-foreground">
              {summary?.trialActive
                ? `${summary.daysRemaining ?? 0} dias restantes · depois pode escolher um plano ou continuar no Free.`
                : effectivePlan === "free"
                  ? "Agenda, clientes e marcações disponíveis sem custo."
                  : summary?.nextBillingAt
                    ? `${summary?.cancelAtPeriodEnd ? "Termina" : "Próxima renovação"} em ${formatDate(summary.nextBillingAt)}.`
                    : "Assinatura ativa."}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 pl-[3.625rem] sm:pl-0">
          {managedSubscription ? (
            <button
              type="button"
              onClick={() => void manageSubscription("manage")}
              disabled={workingPlan !== null}
              className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold transition hover:bg-muted disabled:opacity-60"
            >
              <CreditCard className="size-3.5" /> Gerir assinatura
            </button>
          ) : (
            <a
              href="#opcoes-planos"
              className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold transition hover:bg-muted"
            >
              Escolher plano <ArrowRight className="size-3.5" />
            </a>
          )}
          {managedSubscription && summary?.cancelAtPeriodEnd && (
            <button
              type="button"
              onClick={() => void reactivate()}
              disabled={workingPlan !== null}
              className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-foreground px-3 text-xs font-semibold text-background transition hover:-translate-y-0.5 disabled:opacity-60"
            >
              <RefreshCcw className="size-3.5" /> Reativar assinatura
            </button>
          )}
          {paidSubscriptionActive && !summary?.cancelAtPeriodEnd && (
            <button
              type="button"
              onClick={() => void changeToFree()}
              disabled={workingPlan !== null}
              className="min-h-9 rounded-lg px-3 text-xs font-semibold text-muted-foreground transition hover:bg-muted disabled:opacity-60"
            >
              Usar Free no fim do ciclo
            </button>
          )}
        </div>
      </section>

      {isPaymentProblem(summary?.status) && (
        <div className="flex min-w-0 items-start gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-100">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" />
          <p className="min-w-0 break-words">
            O pagamento precisa de atenção. O acesso efetivo é Free até a Stripe confirmar a regularização.
          </p>
        </div>
      )}

      {pendingPlan && summary?.pendingChange?.effectiveAt && (
        <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4 text-sm">
          <p className="font-semibold">Mudança agendada</p>
          <p className="mt-1 text-muted-foreground">
            {formatPlanId(pendingPlan)} entra em {formatDate(summary.pendingChange.effectiveAt)}. Até lá, o plano atual continua válido.
          </p>
        </div>
      )}

      <section id="opcoes-planos" className="grid min-w-0 scroll-mt-24 items-stretch gap-3 md:grid-cols-3">
        {plans.map((tier) => {
          const definition = PLAN_DEFINITIONS[tier];
          const planId = tier === "free" ? null : (`${tier}_${billingCycle}` as PaidPlanId);
          const current = effectivePlan === tier;
          const selectedPrice = billingCycle === "monthly" ? definition.monthlyCents : definition.yearlyCents;
          const isPro = tier === "pro";
          const samePaidPlan = planId === currentPaidPlan && paidSubscriptionActive;
          const pending = planId === pendingPlan;
          const processing =
            tier === "free"
              ? workingPlan === "free"
              : isPaidPlanWorking(workingPlan, planId);
          const freeChangeAvailable = managedSubscription && !summary?.cancelAtPeriodEnd;
          const actionLabel = processing
            ? "A processar..."
            : pending
              ? "Mudança agendada"
              : samePaidPlan || (tier === "free" && current && !freeChangeAvailable)
                ? "Plano atual"
                : tier === "free"
                  ? summary?.cancelAtPeriodEnd
                    ? "Free agendado"
                    : summary?.trialActive && !managedSubscription
                      ? "Free após o teste"
                      : "Mudar para Free no fim do ciclo"
                  : managedSubscription && isPaymentProblem(summary?.status)
                    ? "Regularizar assinatura"
                    : paidSubscriptionActive
                      ? `Mudar para ${definition.name}`
                      : `Escolher ${definition.name}`;
          return (
            <PlanSummaryCard
              key={tier}
              name={definition.name}
              positioning={tier === "free" ? "Começar" : tier === "pro" ? "Gerir" : "Crescer"}
              tagline={definition.tagline}
              price={formatMoney(selectedPrice)}
              period={billingCycle === "monthly" ? "mês" : "ano"}
              highlights={FEATURES[tier]}
              saving={
                billingCycle === "yearly" && tier !== "free"
                  ? tier === "pro"
                    ? "Poupe 26,88 € por ano"
                    : "Poupe 50,88 € por ano"
                  : null
              }
              recommended={isPro}
              current={current && !summary?.trialActive}
              tone="admin"
              action={(
                <button
                  type="button"
                  disabled={
                    workingPlan !== null ||
                    samePaidPlan ||
                    pending ||
                    (tier === "free" && !freeChangeAvailable)
                  }
                  onClick={() => {
                    if (tier === "free") {
                      if (freeChangeAvailable) void changeToFree();
                      return;
                    }
                    if (!planId) return;
                    if (managedSubscription && isPaymentProblem(summary?.status)) {
                      void manageSubscription("manage");
                    } else if (paidSubscriptionActive) void switchPaidPlan(planId);
                    else void activate(planId);
                  }}
                  className={`inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-3 text-center text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-65 ${
                    current
                      ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : "bg-foreground text-background hover:-translate-y-0.5"
                  }`}
                >
                  <span className="min-w-0 break-words">{actionLabel}</span>
                  {!current && <ArrowRight className="size-3.5 shrink-0" />}
                </button>
              )}
            />
          );
        })}
      </section>

      <PlanComparison rows={PLAN_COMPARISON} tone="admin" />

      <p className="mx-auto max-w-3xl text-center text-[11px] leading-relaxed text-muted-foreground">
        Downgrades nunca apagam clientes, profissionais, marcações ou configurações. Os recursos ficam apenas indisponíveis até um novo upgrade.
      </p>
    </div>
  );
}

function isPaidPlanId(value?: string | null): value is PaidPlanId {
  return ["pro_monthly", "pro_yearly", "premium_monthly", "premium_yearly"].includes(value ?? "");
}

function isPaymentProblem(status?: string | null) {
  return ["past_due", "unpaid", "incomplete", "incomplete_expired"].includes(status ?? "");
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("pt-PT", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatPlanId(plan: PaidPlanId) {
  const [tier, interval] = plan.split("_");
  return `${tier === "pro" ? "Pro" : "Premium"} ${interval === "yearly" ? "Anual" : "Mensal"}`;
}

function readableBillingError(error: unknown) {
  const message = error instanceof PlatformCheckoutError
    ? error.code
    : error instanceof Error
      ? error.message
      : String(error);
  if (message.includes("stripe_subscription_price_not_configured")) {
    return "Este plano ainda não está configurado no checkout. Contacte o suporte Bellza.";
  }
  if (message.includes("subscription_already_exists")) {
    return "Já existe uma assinatura Stripe para este estúdio. Utilize Gerir assinatura.";
  }
  if (message.includes("unauthorized")) {
    return "A sessão expirou. Inicie sessão novamente antes de escolher o plano.";
  }
  return "Não foi possível concluir a operação de assinatura. Tente novamente.";
}
