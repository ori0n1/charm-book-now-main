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
  XCircle,
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

type PlanId = "monthly" | "yearly";

type BillingSummary = {
  premiumActive: boolean;
  status: string;
  plan?: string | null;
  nextBillingAt: string | null;
  trialEndsAt?: string | null;
  daysRemaining?: number | null;
  cancelAtPeriodEnd?: boolean;
  pendingChange?: {
    plan: string;
    effectiveAt: string;
    amount?: number | null;
    currency?: string | null;
    immediateCharge?: boolean;
  } | null;
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
    id: "yearly",
    name: "Anual",
    price: "89,99 €",
    cadence: "por ano",
    savings: "Poupe cerca de 17%",
    highlighted: true,
  },
];

const PLAN_FEATURES = [
  "Marcações online",
  "Painel financeiro completo",
  "Múltiplos profissionais",
  "WhatsApp de confirmação automático",
  "Página pública personalizada",
  "Suporte por email prioritário",
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
  const [actionFeedback, setActionFeedback] = useState<
    "updating" | "syncing" | "success" | "error" | null
  >(null);

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
  const pendingPlan = isStripePlan(summary?.pendingChange?.plan)
    ? (summary?.pendingChange?.plan as PlanId)
    : null;
  const hasStripeSubscription = Boolean(currentPlan);
  const paymentPending = isPaymentPending(summary?.status);
  // Subscription was cancelled but access still valid until period end
  const canceledButValid = Boolean(
    hasStripeSubscription && summary?.cancelAtPeriodEnd && summary.premiumActive,
  );
  // Subscription existed but period has now expired (no more access)
  const canceledExpired = Boolean(
    hasStripeSubscription && !summary?.premiumActive && !paymentPending &&
    summary?.status === "canceled",
  );
  const activeSubscription = Boolean(
    hasStripeSubscription && summary?.premiumActive && !paymentPending && !canceledButValid,
  );
  const trialOnly = Boolean(!hasStripeSubscription && summary?.status === "trialing" && summary.premiumActive);
  const locked = Boolean(summary && !summary.premiumActive && !hasStripeSubscription);
  // Access end date: for cancelled subscription shows when access ends; for active shows renewal
  const renewalDate = summary?.nextBillingAt
    ? new Date(summary.nextBillingAt).getTime() > Date.now()
      ? summary.nextBillingAt
      : null
    : null;
  // For cancelled subscriptions, even past dates matter (to show "access ended on X")
  const accessUntilDate = canceledButValid ? renewalDate : null;
  const trialDate = futureDate(summary?.trialEndsAt);
  const status = getVisualStatus({
    activeSubscription,
    canceledButValid,
    canceledExpired,
    paymentPending,
    trialOnly,
    locked,
  });
  const titlePlan = currentPlan ? formatPlan(currentPlan) : formatPlan(summary?.plan);
  const pendingPlanTitle = pendingPlan ? formatPlan(pendingPlan) : null;
  const renewalText = getRenewalText({
    activeSubscription,
    canceledButValid,
    canceledExpired,
    renewalDate,
    accessUntilDate,
    trialOnly,
    trialDate,
  });
  const pendingEffectiveDate = futureDate(summary?.pendingChange?.effectiveAt);

  // Build the hero description dynamically for cancelled states
  const heroDescription = canceledButValid
    ? `A sua assinatura foi cancelada. O acesso Premium continua disponível até ${formatDate(accessUntilDate ?? renewalDate)}. Após essa data, será necessário renovar a assinatura para continuar a usar o Bellza.`
    : canceledExpired
      ? "A sua assinatura expirou. Escolha um plano para renovar e recuperar o acesso Premium."
      : status.description;

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
    if (!studio || plan === currentPlan || plan === pendingPlan) return;
    setChangingPlan(plan);
    setActionFeedback("updating");
    try {
      const result = (await changePlan({ data: { studioId: studio.id, plan } })) as {
        pending?: boolean;
      };
      setActionFeedback("syncing");
      await billing.refetch();
      setActionFeedback("success");
      toast.success(result.pending ? "Mudança agendada." : "Plano atualizado.");
      window.setTimeout(() => setActionFeedback(null), 2600);
    } catch {
      setActionFeedback("error");
      toast.error("Não foi possível alterar o plano. Abra a gestão da assinatura ou tente novamente.");
      window.setTimeout(() => setActionFeedback(null), 4200);
    } finally {
      setChangingPlan(null);
    }
  }

  const syncNotice =
    actionFeedback === "updating"
      ? "A atualizar assinatura..."
      : actionFeedback === "syncing"
        ? "A confirmar alteração..."
        : actionFeedback === "success"
          ? pendingPlan
            ? "Mudança agendada com sucesso."
            : "Alteração confirmada."
          : actionFeedback === "error"
            ? "Não foi possível confirmar a alteração."
            : billing.isFetching
              ? paymentPending
                ? "Aguardando confirmação do pagamento."
                : "A atualizar dados..."
              : null;

  if (!studio || billing.isLoading || billing.isFetching) {
    return (
      <div className="mx-auto flex min-h-[24rem] max-w-5xl items-center justify-center py-10">
        <div className="rounded-3xl border border-border bg-card px-5 py-4 text-center shadow-sm">
          <RefreshCcw className="mx-auto size-5 animate-spin text-muted-foreground" />
          <p className="mt-3 text-sm font-semibold text-foreground">A confirmar assinatura atual...</p>
          <p className="mt-1 text-xs text-muted-foreground">Estamos a carregar os dados mais recentes.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 py-1 md:gap-5 md:py-4">
      <section className="overflow-hidden rounded-[1.35rem] border border-border bg-card shadow-sm md:rounded-[1.55rem]">
        <div className="grid min-h-[9.5rem] gap-0 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex flex-col justify-center p-4 md:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.15em] shadow-sm ${status.badgeClass}`}>
                <status.icon className="h-3 w-3" />
                {status.badge}
              </span>
              {activeSubscription && (
                <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.15em] text-emerald-700 dark:text-emerald-300">
                  Conta validada
                </span>
              )}
            </div>
            <h1 className="mt-3 text-2xl font-light tracking-tight text-foreground md:text-4xl">
              {activeSubscription || canceledButValid || canceledExpired ? titlePlan : status.title}
            </h1>
            <p className="mt-2 max-w-xl text-xs font-medium leading-5 text-muted-foreground md:text-sm">
              {renewalText || heroDescription}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <MiniMetric label="Estado" value={
                canceledButValid ? "Cancelada" :
                canceledExpired ? "Expirada" :
                formatStatus(summary?.status, activeSubscription)
              } />
              {!canceledExpired && (
              <MiniMetric
                label={canceledButValid ? "Acesso até" : "Renovação"}
                value={formatDate(
                  canceledButValid ? (accessUntilDate ?? renewalDate) :
                  activeSubscription ? renewalDate :
                  trialDate,
                  activeSubscription
                )}
              />
              )}
              {pendingPlanTitle && pendingEffectiveDate && (
                <MiniMetric label="Próximo plano" value={pendingPlanTitle} />
              )}
            </div>
          </div>

          <aside className="flex items-stretch border-t border-border bg-muted/25 p-3 lg:border-l lg:border-t-0 md:p-4">
            <div className="grid w-full content-center gap-2">
              {hasStripeSubscription ? (
                <>
                  <SummaryTile label="Plano" value={titlePlan} />
                  {canceledButValid ? (
                    <>
                      <SummaryTile label="Acesso Premium até" value={formatDate(accessUntilDate ?? renewalDate)} />
                      <SummaryTile label="Estado" value="Cancelada" />
                    </>
                  ) : canceledExpired ? (
                    <SummaryTile label="Estado" value="Expirada — sem acesso Premium" />
                  ) : (
                    <>
                      <SummaryTile
                        label={pendingPlanTitle ? "Alteração" : "Próxima cobrança"}
                        value={
                          pendingPlanTitle && pendingEffectiveDate
                            ? formatDate(pendingEffectiveDate, true)
                            : formatDate(renewalDate, activeSubscription)
                        }
                      />
                      <SummaryTile label="Estado" value={formatStatus(summary?.status, activeSubscription)} />
                    </>
                  )}
                </>
              ) : (
                <>
                  <SummaryTile label="Plano atual" value={formatPlan(summary?.plan)} />
                  <SummaryTile
                    label={trialOnly ? "Fim do teste" : "Acesso"}
                    value={trialOnly ? formatDate(trialDate) : locked ? "Bloqueado" : "Pendente"}
                  />
                </>
              )}
            </div>
          </aside>
        </div>
      </section>

      {syncNotice && (
        <StatusNotice
          kind={actionFeedback ?? (paymentPending ? "updating" : "syncing")}
          text={syncNotice}
        />
      )}

      {pendingPlanTitle && pendingEffectiveDate && currentPlan && (
        <PendingChangePanel
          currentPlan={formatPlan(currentPlan)}
          nextPlan={pendingPlanTitle}
          effectiveAt={pendingEffectiveDate}
          amount={summary?.pendingChange?.amount}
          currency={summary?.pendingChange?.currency}
        />
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        {/* Active subscription: manage + cancel */}
        {activeSubscription && !canceledButValid && (
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
        {/* Cancelled but still valid: manage + reactivate. NO cancel button. */}
        {canceledButValid && (
          <>
            <ActionButton
              label={portalLoading ? "A abrir gestão..." : "Gerir assinatura"}
              icon={CreditCard}
              disabled={portalLoading}
              onClick={() => void manageSubscription("manage")}
              primary
            />
            <ActionButton
              label="Reativar assinatura"
              icon={RefreshCcw}
              disabled={portalLoading}
              onClick={() => void manageSubscription("manage")}
            />
          </>
        )}
        {/* Payment issues: update payment */}
        {paymentPending && (
          <ActionButton
            label="Atualizar pagamento"
            icon={RefreshCcw}
            disabled={portalLoading}
            onClick={() => void manageSubscription("manage")}
            primary
          />
        )}
        {/* No subscription or expired: choose plan */}
        {(!hasStripeSubscription || canceledExpired) && (
          <ActionButton
            label="Renovar assinatura Premium"
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
          className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-border bg-card px-4 text-xs font-bold uppercase tracking-wide text-muted-foreground shadow-sm transition hover:-translate-y-0.5 hover:bg-muted hover:text-foreground"
        >
          <LifeBuoy className="h-4 w-4" />
          Contactar suporte
        </a>
      </div>

      <section className="rounded-[1.75rem] border border-border bg-card p-4 shadow-sm md:p-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <span className="mb-2 inline-flex rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">
              Condições especiais de lançamento
            </span>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Planos disponíveis
            </p>
            <h2 className="mt-1 text-2xl font-light tracking-tight">
              {canceledButValid || canceledExpired ? "Renovar assinatura" : hasStripeSubscription ? "Alterar plano" : "Escolha o plano ideal"}
            </h2>
          </div>
        </div>

        <div className="mt-5 grid items-stretch gap-4 sm:grid-cols-2 lg:mx-auto lg:max-w-[44rem]">
          {PLANS.map((plan) => {
            const current = plan.id === currentPlan;
            const currentAndActive = current && activeSubscription;
            const currentAndCanceled = current && (canceledButValid || canceledExpired);
            const pending = plan.id === pendingPlan;
            const canSwitch = activeSubscription && !canceledButValid && !canceledExpired;
            return (
              <article
                key={plan.id}
                className={`relative flex min-h-[15rem] flex-col rounded-[1.35rem] border p-5 transition ${
                  currentAndActive
                    ? "border-emerald-500/55 bg-emerald-500/[0.035] shadow-[0_14px_34px_rgba(16,185,129,0.08)]"
                    : currentAndCanceled
                      ? "border-amber-500/35 bg-amber-500/[0.035]"
                      : plan.highlighted
                        ? "border-foreground/15 bg-background shadow-sm hover:-translate-y-0.5 hover:shadow-lg"
                        : "border-border bg-background shadow-sm hover:-translate-y-0.5 hover:shadow-lg"
                }`}
              >
                <div className="flex min-h-7 items-start justify-between gap-3">
                  <h3 className="text-lg font-semibold leading-7">{plan.name}</h3>
                  {current && (
                    <PlanBadge
                      label={
                        currentAndActive ? "Plano atual"
                        : canceledButValid ? "Cancelado"
                        : canceledExpired ? "Expirado"
                        : "Último plano"
                      }
                      muted={canceledButValid || canceledExpired || !currentAndActive}
                    />
                  )}
                  {!current && pending && <PlanBadge label="Agendado" muted />}
                </div>
                <div className="mt-5 rounded-2xl border border-border bg-muted/25 px-4 py-4">
                  <p className="text-3xl font-light leading-none tracking-tight">{plan.price}</p>
                  <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {plan.cadence}
                  </p>
                  <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                    Inclui todas as funcionalidades disponíveis nesta fase de lançamento.
                  </p>
                </div>
                <ul className="mt-4 space-y-2">
                  {PLAN_FEATURES.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <BadgeCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <div className="mt-4 min-h-7">
                  {(currentAndActive || pending || plan.savings) && !canceledButValid && !canceledExpired && (
                    <span className="inline-flex rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                      {currentAndActive
                        ? "Ativo"
                        : pending && pendingEffectiveDate
                          ? `Entra em ${formatDate(pendingEffectiveDate, true)}`
                          : plan.savings}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  disabled={checkoutPlan !== null || changingPlan !== null || (currentAndActive && !canceledButValid)}
                  onClick={() =>
                    canSwitch && !currentAndActive ? void switchPlan(plan.id) : void activate(plan.id)
                  }
                  className={`mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-xs font-bold uppercase tracking-wide transition disabled:cursor-not-allowed disabled:opacity-70 ${
                    currentAndActive
                      ? "border border-emerald-600/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : "bg-foreground text-background shadow-sm hover:-translate-y-0.5 hover:opacity-90"
                  }`}
                >
                  {currentAndActive
                    ? "Plano atual"
                    : pending
                      ? "Troca agendada"
                    : changingPlan === plan.id
                      ? "A alterar..."
                      : checkoutPlan === plan.id
                        ? "A abrir checkout..."
                        : canceledButValid && current
                          ? "Reativar este plano"
                          : canceledExpired && current
                            ? "Renovar este plano"
                            : canSwitch
                              ? "Agendar troca"
                              : "Escolher plano"}
                  {!currentAndActive && <ArrowRight className="h-3.5 w-3.5" />}
                </button>
              </article>
            );
          })}
        </div>
        <p className="mx-auto mt-5 max-w-2xl text-center text-xs leading-relaxed text-muted-foreground">
          A Bellza está em evolução contínua. No futuro poderão surgir novos planos, funcionalidades e condições
          comerciais, sem afetar retroativamente aquilo que for contratado, salvo comunicação prévia e nos termos aplicáveis.
        </p>
      </section>
    </div>
  );
}

function PendingChangePanel({
  currentPlan,
  nextPlan,
  effectiveAt,
  amount,
  currency,
}: {
  currentPlan: string;
  nextPlan: string;
  effectiveAt: string;
  amount?: number | null;
  currency?: string | null;
}) {
  return (
    <section className="grid gap-3 rounded-[1.35rem] border border-emerald-500/25 bg-emerald-500/[0.035] p-4 shadow-sm md:grid-cols-[1.1fr_1fr] md:p-5">
      <div>
        <span className="inline-flex rounded-full bg-emerald-600 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white">
          Mudança agendada
        </span>
        <h2 className="mt-3 text-xl font-semibold tracking-tight text-foreground">
          {nextPlan} entra em {formatDate(effectiveAt, true)}
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Até essa data, {currentPlan} continua ativo. A página só será atualizada como
          novo plano ativo depois da confirmação oficial.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-1">
        <SummaryTile label="Plano atual" value={currentPlan} />
        <SummaryTile label="Próximo plano" value={nextPlan} />
        <SummaryTile label="Próxima cobrança" value={formatMoney(amount, currency)} />
        <SummaryTile label="Cobrança imediata" value="Não" />
      </div>
    </section>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-border bg-muted/35 px-2.5 text-[11px] font-semibold">
      <span className="text-[9px] uppercase tracking-[0.13em] text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
    </span>
  );
}

function StatusNotice({
  kind,
  text,
}: {
  kind: "updating" | "syncing" | "success" | "error";
  text: string;
}) {
  const tone =
    kind === "success"
      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : kind === "error"
        ? "border-destructive/20 bg-destructive/10 text-destructive"
        : "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300";

  return (
    <div className={`flex min-h-12 items-center justify-between gap-3 rounded-2xl border px-4 text-sm font-semibold shadow-sm ${tone}`}>
      <span>{text}</span>
      {(kind === "updating" || kind === "syncing") && (
        <RefreshCcw className="h-4 w-4 animate-spin" />
      )}
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-card px-3 py-2 shadow-sm">
      <p className="truncate text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 truncate text-xs font-semibold text-foreground">{value}</p>
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
      className={`flex min-h-10 items-center justify-center gap-2 rounded-xl px-3.5 text-[11px] font-bold uppercase tracking-wide transition disabled:opacity-60 ${
        primary
          ? "bg-foreground text-background shadow-sm hover:-translate-y-0.5 hover:opacity-90"
          : "border border-border bg-card text-muted-foreground shadow-sm hover:-translate-y-0.5 hover:bg-muted hover:text-foreground"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
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
  return plan === "monthly" || plan === "yearly";
}

function isPaymentPending(status?: string | null) {
  return status === "past_due" || status === "unpaid" || status === "incomplete";
}

function futureDate(value?: string | null) {
  if (!value) return null;
  return new Date(value).getTime() > Date.now() ? value : null;
}

function formatMoney(amount?: number | null, currency?: string | null) {
  if (typeof amount !== "number" || !currency) return "A confirmar";
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100);
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
    canceled: "Cancelada",
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
  canceledExpired: boolean;
  renewalDate: string | null;
  accessUntilDate: string | null;
  trialOnly: boolean;
  trialDate: string | null;
}) {
  // canceledButValid: description is handled by heroDescription, not here
  if (input.canceledButValid) return null;
  if (input.canceledExpired) return null;
  if (input.activeSubscription) {
    return input.renewalDate ? `Renovação em ${formatDate(input.renewalDate, true)}` : "Assinatura ativa";
  }
  if (input.trialOnly) return `Termina em ${formatDate(input.trialDate)}`;
  return null;
}

function getVisualStatus(input: {
  activeSubscription: boolean;
  canceledButValid: boolean;
  canceledExpired: boolean;
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
      badge: "Assinatura cancelada",
      title: "Assinatura cancelada",
      description: "", // overridden by heroDescription
      icon: XCircle,
      badgeClass: "bg-amber-500 text-amber-950",
      heroClass: "bg-amber-50 dark:bg-amber-950/10",
    };
  }
  if (input.canceledExpired) {
    return {
      badge: "Assinatura expirada",
      title: "Acesso Premium terminado",
      description: "A sua assinatura expirou. Escolha um plano para renovar e recuperar o acesso Premium.",
      icon: XCircle,
      badgeClass: "bg-foreground text-background",
      heroClass: "bg-muted/40",
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
