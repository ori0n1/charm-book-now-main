import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, LifeBuoy, LockKeyhole, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useCurrentStudio } from "@/hooks/use-current-studio";
import {
  createPlatformBillingPortalSession,
  createPlatformCheckoutSession,
  getPlatformSubscriptionSummary,
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
  detail: string;
  badge?: string;
  highlighted?: boolean;
}[] = [
  {
    id: "monthly",
    name: "Mensal",
    price: "8,99 €/mês",
    detail: "Flexível, sem fidelização.",
  },
  {
    id: "quarterly",
    name: "Trimestral",
    price: "22,49 € total",
    detail: "Equivale a 7,50 €/mês.",
    badge: "Mais popular",
  },
  {
    id: "yearly",
    name: "Anual",
    price: "71,99 € total",
    detail: "Equivale a 6,00 €/mês.",
    badge: "Melhor valor",
    highlighted: true,
  },
];

function PremiumAccessPage() {
  const { studio } = useCurrentStudio();
  const loadBilling = useServerFn(getPlatformSubscriptionSummary);
  const startCheckout = useServerFn(createPlatformCheckoutSession);
  const openBillingPortal = useServerFn(createPlatformBillingPortalSession);
  const [checkoutPlan, setCheckoutPlan] = useState<PlanId | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const billing = useQuery({
    queryKey: ["premium-page-subscription-summary", studio?.id],
    enabled: !!studio,
    staleTime: 30 * 1000,
    queryFn: async () =>
      (await loadBilling({ data: { studioId: studio!.id } })) as BillingSummary,
  });
  const summary = billing.data;
  const hasStripeSubscription = Boolean(
    summary &&
      (summary.status === "active" ||
        summary.cancelAtPeriodEnd ||
        ["monthly", "quarterly", "yearly"].includes(summary.plan ?? "")),
  );
  const trialActive = summary?.premiumActive && summary.status === "trialing";
  const ended = summary && !summary.premiumActive;
  const daysRemaining =
    typeof summary?.daysRemaining === "number"
      ? summary.daysRemaining
      : getDaysRemaining(summary?.trialEndsAt ?? summary?.nextBillingAt);

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

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 py-2 md:py-6">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SubscriptionMetric label="Plano atual" value={formatPlan(summary?.plan)} />
        <SubscriptionMetric label="Estado" value={formatStatus(summary?.status)} />
        <SubscriptionMetric
          label={hasStripeSubscription ? "Primeira cobrança" : trialActive ? "Fim do teste" : "Renovação"}
          value={formatDate(summary?.nextBillingAt)}
        />
        <SubscriptionMetric
          label="Dias restantes"
          value={daysRemaining === null ? "Não disponível" : `${daysRemaining} dias`}
        />
      </section>

      <section className="overflow-hidden rounded-[1.75rem] border border-border bg-card shadow-xl shadow-black/5">
        <div className="grid gap-0 lg:grid-cols-[1fr_0.9fr]">
          <div className="relative overflow-hidden bg-foreground p-6 text-background md:p-8">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.16),transparent_32%),radial-gradient(circle_at_80%_0%,rgba(16,185,129,0.18),transparent_30%)]" />
            <div className="relative">
              <span className="inline-flex items-center gap-2 rounded-full bg-background/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-background/80">
                <LockKeyhole className="h-3.5 w-3.5" />
                Assinatura
              </span>
              <h1 className="mt-5 max-w-xl text-3xl font-light tracking-tight md:text-4xl">
                {ended
                  ? "O seu teste gratuito terminou."
                  : hasStripeSubscription && trialActive
                    ? `${formatPlan(summary?.plan)} ativo em período experimental.`
                    : trialActive
                    ? "Teste gratuito ativo."
                    : "Assinatura Premium do Bellza."}
              </h1>
              <p className="mt-4 max-w-xl text-sm leading-relaxed text-background/72 md:text-base">
                {ended
                  ? "Escolha um plano premium para continuar a usar o Bellza."
                  : hasStripeSubscription && trialActive
                    ? `O cartão foi validado e a primeira cobrança está agendada para ${formatDate(summary?.nextBillingAt)}.`
                  : trialActive
                    ? `Ainda tem ${daysRemaining ?? "--"} dias de teste. Pode escolher um plano antecipadamente sem cancelar o período gratuito.`
                    : "Consulte o estado da assinatura, renove, altere o plano ou faça a gestão de cancelamento quando necessário."}
              </p>
              {trialActive && (
                <div className="mt-5 inline-flex rounded-full bg-background/10 px-3 py-1.5 text-xs text-background/78">
                  Termina em {formatDate(summary?.trialEndsAt ?? summary?.nextBillingAt)}
                </div>
              )}
              {summary?.cancelAtPeriodEnd && (
                <div className="mt-5 inline-flex rounded-full bg-amber-400/15 px-3 py-1.5 text-xs text-amber-100">
                  Cancelamento agendado no fim do período atual
                </div>
              )}
              <div className="mt-6 grid gap-2 text-sm text-background/78 sm:grid-cols-2">
                {["Checkout seguro", "Sem fidelização", "Cancelamento simples", "Suporte por email"].map(
                  (item) => (
                    <div key={item} className="flex items-center gap-2">
                      <span className="grid size-5 place-items-center rounded-full bg-emerald-400 text-emerald-950">
                        <Check className="h-3 w-3" />
                      </span>
                      {item}
                    </div>
                  ),
                )}
              </div>
            </div>
          </div>

          <div className="bg-background/65 p-5 md:p-6">
            <div className="rounded-2xl border border-emerald-700/20 bg-emerald-950/5 p-4">
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                <Sparkles className="h-4 w-4" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em]">
                  Planos Bellza
                </p>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                O acesso é atualizado automaticamente depois da confirmação oficial do pagamento.
              </p>
            </div>

            {hasStripeSubscription && (
              <button
                type="button"
                onClick={() => void manageSubscription()}
                disabled={portalLoading}
                className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-foreground text-xs font-bold uppercase tracking-wide text-background transition hover:opacity-90 disabled:opacity-60"
              >
                {portalLoading ? "A abrir gestão..." : "Gerir assinatura"}
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}

            <div className="mt-4 grid gap-3">
              {PLANS.map((plan) => (
                <article
                  key={plan.id}
                  className={`rounded-2xl border p-4 transition ${
                    plan.highlighted
                      ? "border-emerald-700/40 bg-emerald-950/5 shadow-lg shadow-emerald-950/5"
                      : "border-border bg-card"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-semibold">{plan.name}</h2>
                        {plan.badge && (
                          <span className="rounded-full bg-foreground px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-background">
                            {plan.badge}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{plan.detail}</p>
                    </div>
                    <p className="shrink-0 text-right text-sm font-semibold">{plan.price}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      hasStripeSubscription ? void manageSubscription() : void activate(plan.id)
                    }
                    disabled={checkoutPlan !== null || portalLoading}
                    className={`mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-2xl text-xs font-bold uppercase tracking-wide transition disabled:opacity-60 ${
                      plan.highlighted
                        ? "bg-emerald-600 text-white shadow-lg shadow-emerald-950/15 hover:bg-emerald-700"
                        : "bg-foreground text-background hover:opacity-90"
                    }`}
                  >
                    {hasStripeSubscription
                      ? portalLoading
                        ? "A abrir gestão..."
                        : "Gerir assinatura"
                      : checkoutPlan === plan.id
                        ? "A abrir checkout..."
                        : "Escolher plano"}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </article>
              ))}
            </div>

            <a
              href="mailto:info@bellza.pt"
              className="mt-4 flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-border bg-card px-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <LifeBuoy className="h-4 w-4" />
              Contactar suporte
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}

function SubscriptionMetric({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 truncate text-sm font-semibold">{value}</p>
    </article>
  );
}

function getDaysRemaining(value?: string | null) {
  if (!value) return null;
  return Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 86400000));
}

function formatDate(value?: string | null) {
  if (!value) return "Data não disponível";
  return new Date(value).toLocaleDateString("pt-PT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatPlan(plan?: string | null) {
  const map: Record<string, string> = {
    trial: "Teste gratuito",
    monthly: "Premium mensal",
    quarterly: "Premium trimestral",
    yearly: "Premium anual",
  };
  return map[plan ?? "trial"] ?? "Premium";
}

function formatStatus(status?: string | null) {
  const map: Record<string, string> = {
    active: "Ativa",
    trialing: "Teste gratuito",
    past_due: "Pagamento pendente",
    canceled: "Cancelada",
    incomplete: "Incompleta",
    unpaid: "Por regularizar",
  };
  return map[status ?? "trialing"] ?? "Em análise";
}
