import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import type { InputHTMLAttributes, ReactNode, RefObject } from "react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Calendar,
  ChevronDown,
  CreditCard,
  Euro,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { ShareStudioCard } from "@/components/share-studio-card";
import { UpsellMetricsCard } from "@/components/upsell-metrics-card";
import { ClientAvatar } from "@/components/client-avatar";
import { ExpandableList } from "@/components/ui/expandable-list";
import { InternationalPhoneInput } from "@/components/ui/international-phone-input";
import { useCurrentStudio } from "@/hooks/use-current-studio";
import { sortAppointmentsChronologically } from "@/lib/appointment-ordering";
import { getPlatformSubscriptionSummary } from "@/lib/subscriptions.functions";
import {
  allocateAuthoritativeLineTotals,
  computeFinancialSplit,
  computeAttendanceRevenue,
  formatAppointmentStatus,
  formatEUR,
  isFinanciallyRelevantAppointment,
  type FinancialRuleSource,
} from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  normalizePlanTier,
  planHasFeature,
  PLAN_DEFINITIONS,
  type PlanTier,
} from "@/lib/plan-entitlements";
import {
  ADMIN_REFERENCE_GC_MS,
  ADMIN_REFERENCE_STALE_MS,
  platformSubscriptionSummaryQueryKey,
} from "@/lib/admin-query-cache";
import {
  prepareStripeBillingNavigation,
  requestPlatformCheckout,
} from "@/lib/subscription-checkout";
import { getTrialNotice, TRIAL_DURATION_DAYS } from "@/lib/trial-notice";
import {
  buildAppointmentPaymentFacts,
  computeAppointmentFinancialSplit,
  toCents,
  type AppointmentPaymentFacts,
  type OnsitePaymentRow,
  type RefundRow,
} from "@/lib/financial-ledger";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: OverviewPage,
});

type ServiceLine = {
  price: number;
  studio_commission_percent_snapshot?: number | null;
  services: ({ name: string } & FinancialRuleSource) | null;
};

type Appt = {
  id: string;
  starts_at: string;
  status: string;
  total_price: number;
  studio_commission_percent_snapshot?: number | null;
  clients: {
    id?: string | null;
    name: string;
    avatar_url?: string | null;
  } | null;
  staff: ({ id: string; name: string } & FinancialRuleSource) | null;
  appointment_services?: ServiceLine[];
};

type PaidRow = {
  id?: string | null;
  appointment_id: string | null;
  amount_cents: number;
  status: string;
};

type DailyChartDay = {
  key: string;
  day: string;
  fullDate: string;
  total: number;
  received: number;
  pending: number;
  appointments: number;
};

type StaffMetrics = {
  id: string;
  name: string;
  appointmentsDone: number;
  appointmentsFuture: number;
  generated: number;
  confirmed: number;
  professional: number;
  studio: number;
  received: number;
  pending: number;
  commission: number;
  predicted: number;
};

type SummaryPeriod = 7 | 15 | 30;
type DashboardPeriodMode = "7d" | "30d" | "month" | "custom";
type PlanId = "pro_monthly" | "pro_yearly" | "premium_monthly" | "premium_yearly";

type BillingSummary = {
  available: boolean;
  plan: string;
  status: string;
  nextBillingAt: string | null;
  trialEndsAt?: string | null;
  daysRemaining?: number | null;
  cancelAtPeriodEnd: boolean;
  premiumActive: boolean;
  subscriptionActive?: boolean;
  hasStripeSubscription?: boolean;
  effectivePlan?: PlanTier;
  trialActive?: boolean;
};

type WithdrawalSummary = {
  settings: null | {
    fiscalName: string;
    nif: string;
    payoutMethod: "iban" | "mb_way";
    iban: string | null;
    mbWayPhone: string | null;
  };
  paidOnlineCents: number;
  reservedCents: number;
  availableCents: number;
  requests: {
    id: string;
    amountCents: number;
    currency: string;
    status: "in_review" | "processing" | "completed" | "failed" | "canceled";
    payoutMethod: "iban" | "mb_way";
    requestedAt: string;
    reviewedAt: string | null;
    processedAt: string | null;
    paidAt: string | null;
    updatedAt: string | null;
    proofUrl: string | null;
    failureReason: string | null;
  }[];
};

const SUMMARY_PERIODS: SummaryPeriod[] = [7, 15, 30];
const DASHBOARD_PERIOD_OPTIONS: Array<{ value: DashboardPeriodMode; label: string }> = [
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "month", label: "Este mês" },
  { value: "custom", label: "Personalizado" },
];
const DAY_MS = 86400000;
const LazyDailyMovementChart = lazy(() =>
  import("@/components/dashboard/daily-movement-chart").then((module) => ({
    default: module.DailyMovementChart,
  })),
);

function OverviewPage() {
  const { studio } = useCurrentStudio();
  const loadBilling = useServerFn(getPlatformSubscriptionSummary);
  const [summaryPeriod, setSummaryPeriod] = useState<SummaryPeriod>(30);
  const [dashboardPeriod, setDashboardPeriod] = useState<DashboardPeriodMode>("30d");
  const [customPeriodStart, setCustomPeriodStart] = useState(() =>
    formatDateInput(addCalendarDays(startOfLocalDay(new Date()), -6)),
  );
  const [customPeriodEnd, setCustomPeriodEnd] = useState(() =>
    formatDateInput(startOfLocalDay(new Date())),
  );
  const [checkoutPlan, setCheckoutPlan] = useState<PlanId | null>(null);
  const [planChooserOpen, setPlanChooserOpen] = useState(false);
  const [desktopLayout, setDesktopLayout] = useState(false);
  const [reportsOpen, setReportsOpen] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const update = () => setDesktopLayout(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const billing = useQuery({
    queryKey: platformSubscriptionSummaryQueryKey(studio?.id),
    enabled: !!studio,
    staleTime: ADMIN_REFERENCE_STALE_MS,
    gcTime: ADMIN_REFERENCE_GC_MS,
    refetchOnMount: false,
    refetchOnWindowFocus: true,
    retry: 1,
    queryFn: async () => (await loadBilling({ data: { studioId: studio!.id } })) as BillingSummary,
  });
  const effectivePlan = normalizePlanTier(billing.data?.effectivePlan ?? studio?.plan_tier);
  const financeEnabled = planHasFeature(effectivePlan, "finance_basic");
  const overview = useQuery({
    queryKey: [
      "admin-finance-overview",
      studio?.id,
      studio?.role,
      studio?.staff_id,
      financeEnabled,
    ],
    enabled: Boolean(studio),
    staleTime: ADMIN_REFERENCE_STALE_MS,
    gcTime: ADMIN_REFERENCE_GC_MS,
    refetchOnMount: false,
    queryFn: async () => {
      const db = supabase as any;
      const since = new Date(Date.now() - 60 * DAY_MS).toISOString();
      const [
        appointmentResult,
        { count: staffCount },
        { count: serviceCount },
        { data: payments },
        { data: cashPayments },
        { data: refunds },
      ] = await Promise.all([
        fetchAppointments(studio!.id, since, studio?.role === "staff" ? studio.staff_id : null),
        supabase
          .from("staff")
          .select("id", { count: "exact", head: true })
          .eq("studio_id", studio!.id)
          .eq("is_active", true),
        supabase
          .from("services")
          .select("id", { count: "exact", head: true })
          .eq("studio_id", studio!.id)
          .eq("is_active", true),
        financeEnabled
          ? supabase
              .from("payment_intents")
              .select("id,appointment_id,amount_cents,status")
              .eq("studio_id", studio!.id)
          : Promise.resolve({ data: [] }),
        financeEnabled
          ? db
              .from("cash_register_movements")
              .select("id,appointment_id,amount,movement_type")
              .eq("studio_id", studio!.id)
              .eq("movement_type", "service_payment")
          : Promise.resolve({ data: [] }),
        financeEnabled
          ? db
              .from("refund_requests")
              .select("id,appointment_id,payment_intent_id,status,payment_intents(amount_cents)")
              .eq("studio_id", studio!.id)
              .eq("status", "refunded")
          : Promise.resolve({ data: [] }),
      ]);

      return {
        appts: (appointmentResult ?? []) as unknown as Appt[],
        counts: { services: Number(serviceCount ?? 0), staff: Number(staffCount ?? 0) },
        paidRows: (payments ?? []) as PaidRow[],
        cashPaymentRows: (cashPayments ?? []) as unknown as OnsitePaymentRow[],
        refundRows: (refunds ?? []) as unknown as RefundRow[],
      };
    },
  });
  const refetchOverview = overview.refetch;

  useEffect(() => {
    if (!studio?.id) return;
    let refreshTimer: number | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        void refetchOverview();
      }, 650);
    };
    const channel = supabase
      .channel(`admin-overview-live-${studio.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "appointments",
          filter: `studio_id=eq.${studio.id}`,
        },
        scheduleRefresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "payment_intents",
          filter: `studio_id=eq.${studio.id}`,
        },
        scheduleRefresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "booking_payment_requests",
          filter: `studio_id=eq.${studio.id}`,
        },
        scheduleRefresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "appointment_services" },
        scheduleRefresh,
      )
      .subscribe();
    return () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [refetchOverview, studio?.id]);

  if (!studio || overview.isLoading)
    return <p className="text-sm text-muted-foreground">A carregar...</p>;

  if (studio.role === "staff") {
    return (
      <ProfessionalOverview
        appointments={overview.data?.appts ?? []}
        paidRows={overview.data?.paidRows ?? []}
        cashPaymentRows={overview.data?.cashPaymentRows ?? []}
        refundRows={overview.data?.refundRows ?? []}
        studio={studio}
        period={summaryPeriod}
        onPeriodChange={setSummaryPeriod}
      />
    );
  }

  if (effectivePlan === "free") {
    return (
      <FreeOverview
        studioName={studio.name}
        studioSlug={studio.slug}
        appointments={overview.data?.appts ?? []}
        serviceCount={overview.data?.counts.services ?? 0}
        staffCount={overview.data?.counts.staff ?? 0}
        trialExpired={billing.data?.status === "expired_trial"}
      />
    );
  }

  async function activatePremium(plan: PlanId = "premium_yearly") {
    if (!studio) return;
    const navigation = prepareStripeBillingNavigation();
    setPlanChooserOpen(false);
    setCheckoutPlan(plan);
    try {
      const url = await requestPlatformCheckout({ studioId: studio.id, plan });
      navigation.complete(url);
    } catch {
      navigation.cancel();
      toast.error("Não foi possível abrir o pagamento seguro. Tente novamente.");
    } finally {
      setCheckoutPlan(null);
    }
  }

  const appts = overview.data?.appts ?? [];
  const counts = overview.data?.counts ?? { services: 0, staff: 0 };
  const paymentFacts = buildAppointmentPaymentFacts(
    overview.data?.paidRows ?? [],
    overview.data?.cashPaymentRows ?? [],
    overview.data?.refundRows ?? [],
  );
  const paidByAppointment = new Map<string, number>();
  for (const [appointmentId, facts] of paymentFacts) {
    paidByAppointment.set(appointmentId, facts.receivedCents / 100);
  }

  const now = Date.now();
  const today = sortAppointmentsChronologically(
    appts.filter((a) => new Date(a.starts_at).toDateString() === new Date().toDateString()),
    "future",
  );
  const upcoming = sortAppointmentsChronologically(
    appts.filter((a) => new Date(a.starts_at).getTime() >= now && isBillable(a.status)),
    "future",
  );
  const billable = appts.filter((a) =>
    isFinanciallyRelevantAppointment(a.status, paidByAppointment.get(a.id) ?? 0),
  );

  const rows = billable.map((a) => {
    const split = computeAppointmentSplit(a, studio, paymentFacts.get(a.id) ?? null);
    return { appointment: a, split };
  });

  const dashboardRange = getDashboardPeriodRange(
    dashboardPeriod,
    customPeriodStart,
    customPeriodEnd,
    new Date(now),
  );
  const {
    start: periodStart,
    end: periodEnd,
    days: periodDays,
    label: periodLabel,
  } = dashboardRange;
  const previousPeriodStart = addCalendarDays(periodStart, -periodDays);
  const periodRows = rows.filter((row) => {
    const startsAt = new Date(row.appointment.starts_at);
    return startsAt >= periodStart && startsAt < periodEnd;
  });
  const previousRows = rows.filter((row) => {
    const startsAt = new Date(row.appointment.starts_at);
    return startsAt >= previousPeriodStart && startsAt < periodStart;
  });
  const totals = sumFinancialRows(periodRows);
  const previousTotals = sumFinancialRows(previousRows);
  const periodAppointments = appts.filter((a) => {
    const startsAt = new Date(a.starts_at);
    return (
      startsAt >= periodStart && startsAt < periodEnd && isScheduledPerformanceStatus(a.status)
    );
  });
  const previousAppointments = appts.filter((a) => {
    const startsAt = new Date(a.starts_at);
    return (
      startsAt >= previousPeriodStart &&
      startsAt < periodStart &&
      isScheduledPerformanceStatus(a.status)
    );
  });
  const effectiveStudioPercent =
    totals.realized > 0
      ? Math.round((totals.studio * 10_000) / totals.realized) / 100
      : Number(studio.commission_percent ?? 0);
  const commissionCaption =
    Math.abs(effectiveStudioPercent - Number(studio.commission_percent ?? 0)) < 0.005
      ? `Divisão aplicada: estúdio ${effectiveStudioPercent}% · equipa ${100 - effectiveStudioPercent}%`
      : `Divisão efetiva: estúdio ${effectiveStudioPercent}% · equipa ${100 - effectiveStudioPercent}% (regra padrão ${studio.commission_percent ?? 0}%)`;
  const attendedCount = periodAppointments.filter((a) => a.status === "completed").length;
  const missedCount = periodAppointments.filter((a) => a.status === "no_show").length;
  const closedAttendanceCount = attendedCount + missedCount;
  const attendanceRate =
    closedAttendanceCount > 0 ? Math.round((attendedCount / closedAttendanceCount) * 100) : 0;
  const appointmentGrowth = getGrowthPercent(
    periodAppointments.length,
    previousAppointments.length,
  );
  const revenueGrowth = getGrowthPercent(totals.total, previousTotals.total);
  const agendaTrend =
    appointmentGrowth >= 10
      ? "Agenda em alta"
      : appointmentGrowth <= -10
        ? "Agenda em queda"
        : "Agenda estável";
  const attendanceSignal =
    closedAttendanceCount === 0
      ? "Aguardando presenças"
      : attendanceRate >= 75
        ? "Comparecimento bom"
        : "Muitas faltas neste período";

  const chartData = buildDailyData(periodRows, periodStart, periodEnd);
  return (
    <>
      <TrialPremiumBanner
        billing={billing.data ?? null}
        checkoutPlan={checkoutPlan}
        onChoosePremiumPlan={() => setPlanChooserOpen(true)}
      />

      <MobileOverview
        today={today}
        upcoming={upcoming}
        totals={totals}
        scheduledCount={periodRows.length}
        paidByAppointment={paidByAppointment}
        studio={studio}
      />

      {!desktopLayout && (
        <div className="mt-3 md:hidden">
          <Suspense
            fallback={
              <div className="h-80 animate-pulse rounded-2xl border border-border bg-muted/35" />
            }
          >
            <LazyDailyMovementChart
              data={chartData}
              periodControls={
                <DashboardPeriodControls
                  value={dashboardPeriod}
                  customStart={customPeriodStart}
                  customEnd={customPeriodEnd}
                  onChange={setDashboardPeriod}
                  onCustomStartChange={(value) => {
                    setCustomPeriodStart(value);
                    if (value > customPeriodEnd) setCustomPeriodEnd(value);
                  }}
                  onCustomEndChange={(value) => {
                    setCustomPeriodEnd(value);
                    if (value < customPeriodStart) setCustomPeriodStart(value);
                  }}
                />
              }
            />
          </Suspense>
        </div>
      )}

      {desktopLayout && (
        <div className="hidden space-y-4 md:block">
          <ShareStudioCard
            studioName={studio.name}
            studioSlug={studio.slug}
            variant="compact"
            className="w-full"
          />

          <section className="grid auto-rows-fr gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)]">
            <div className="flex h-full min-w-0 flex-col rounded-[1.35rem] border border-border bg-card p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
                    Operação de hoje
                  </p>
                  <h1 className="mt-2 text-2xl font-light tracking-tight">Resumo do estúdio</h1>
                </div>
                <Link
                  to="/admin/agenda"
                  className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                  Ver agenda
                </Link>
              </div>

              <div className="mt-5 grid flex-1 auto-rows-fr gap-3 sm:grid-cols-3">
                <DashboardFocusCard
                  label="Agenda de hoje"
                  value={formatEUR(
                    today.reduce(
                      (sum, appointment) =>
                        sum +
                        computeAppointmentSplit(
                          appointment,
                          studio,
                          paidByAppointment.get(appointment.id) ?? 0,
                        ).total,
                      0,
                    ),
                  )}
                  detail="Valor previsto das marcações válidas de hoje."
                  featured
                />
                <DashboardFocusCard
                  label="Marcações de hoje"
                  value={String(today.length)}
                  detail="Agendamentos previstos para hoje."
                />
                <DashboardFocusCard
                  label="Por receber"
                  value={formatEUR(totals.pending)}
                  detail="Valor que ainda falta receber."
                />
              </div>
            </div>

            <Link
              to="/admin/recebimento"
              search={{ connect: undefined }}
              className="flex h-full min-w-0 flex-col rounded-[1.35rem] border border-border bg-card p-5 shadow-sm transition hover:border-emerald-700/30 hover:bg-muted/20"
            >
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
                Recebimentos online
              </p>
              <MoneyValue
                value={formatEUR(totals.receivedOnline)}
                className="mt-3 max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[clamp(1.55rem,2.2vw,1.875rem)] leading-tight"
              />
              <p className="mt-2 text-sm leading-snug text-muted-foreground">
                Pagamentos online já enviados para a conta do estúdio.
              </p>
              <span className="mt-auto inline-flex w-fit items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-foreground">
                Ver acompanhamento
                <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </Link>
          </section>

          <section className="rounded-[1.35rem] border border-border bg-card p-4 shadow-sm md:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Euro className="h-4 w-4" />
                  <span className="text-[10px] uppercase tracking-[0.2em]">
                    Resumo · {periodLabel}
                  </span>
                </div>
                <MoneyValue value={formatEUR(totals.total)} className="mt-2 text-3xl" />
                <p className="mt-1 hidden text-xs text-muted-foreground md:block">
                  Valor das marcações confirmadas no período · {periodRows.length} marcações
                </p>
              </div>
              <DashboardPeriodControls
                value={dashboardPeriod}
                customStart={customPeriodStart}
                customEnd={customPeriodEnd}
                onChange={setDashboardPeriod}
                onCustomStartChange={(value) => {
                  setCustomPeriodStart(value);
                  if (value > customPeriodEnd) setCustomPeriodEnd(value);
                }}
                onCustomEndChange={(value) => {
                  setCustomPeriodEnd(value);
                  if (value < customPeriodStart) setCustomPeriodStart(value);
                }}
              />
            </div>

            <div className="mt-5 grid auto-rows-fr gap-3 lg:grid-cols-3">
              <FinanceSummaryCard
                title="Receita agendada"
                icon={<Euro className="h-4 w-4" />}
                value={formatEUR(totals.total)}
                caption={`${periodRows.length} ${periodRows.length === 1 ? "marcação confirmada" : "marcações confirmadas"}`}
                featured
                items={[
                  { label: "Recebido", value: formatEUR(totals.received) },
                  { label: "Por receber", value: formatEUR(totals.pending) },
                ]}
              />
              <FinanceSummaryCard
                title="Recebido"
                icon={<Wallet className="h-4 w-4" />}
                value={formatEUR(totals.received)}
                caption="Dinheiro efetivamente recebido, líquido de reembolsos."
                items={[
                  { label: "Online", value: formatEUR(totals.receivedOnline) },
                  { label: "Presencial", value: formatEUR(totals.receivedOnsite) },
                ]}
              />
              <FinanceSummaryCard
                title="Receita realizada"
                icon={<Users className="h-4 w-4" />}
                value={formatEUR(totals.realized)}
                caption={`Apenas atendimentos concluídos · ${commissionCaption}`}
                items={[
                  { label: "Estúdio", value: formatEUR(totals.studio) },
                  { label: "Equipa", value: formatEUR(totals.professional) },
                ]}
              />
            </div>

            <details
              className="group mt-4 overflow-hidden rounded-[1.25rem] border border-border bg-background/35"
              onToggle={(event) => setReportsOpen(event.currentTarget.open)}
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                    Desempenho e relatórios
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    Gráfico diário, presença, divisão financeira e upsells.
                  </p>
                </div>
                <span className="rounded-full border border-border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  Abrir
                </span>
              </summary>
              {reportsOpen && (
                <div className="grid min-w-0 gap-3 border-t border-border p-3 xl:grid-cols-[minmax(0,1fr)_17rem] 2xl:grid-cols-[minmax(0,1fr)_18rem]">
                  <div className="min-w-0">
                    <Suspense
                      fallback={
                        <div className="h-80 animate-pulse rounded-2xl border border-border/70 bg-muted/35" />
                      }
                    >
                      <LazyDailyMovementChart data={chartData} />
                    </Suspense>
                  </div>
                  <div className="min-w-0 rounded-2xl border border-border bg-card p-4">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                      Leitura rápida
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      Comissão sobre o total do serviço. O pré-pagamento indica apenas o que já foi
                      pago.
                    </p>
                    <div className="mt-4 space-y-2.5">
                      <SignalLine
                        label={agendaTrend}
                        value={`${appointmentGrowth >= 0 ? "+" : ""}${appointmentGrowth}%`}
                      />
                      <SignalLine
                        label="Receita vs período anterior"
                        value={`${revenueGrowth >= 0 ? "+" : ""}${revenueGrowth}%`}
                      />
                      <SignalLine label={attendanceSignal} value={`${attendanceRate}%`} />
                      <ProgressLine
                        label="Parte do estúdio"
                        value={totals.studio}
                        total={totals.realized}
                      />
                      <ProgressLine
                        label="Parte da equipa"
                        value={totals.professional}
                        total={totals.realized}
                      />
                      <ProgressLine label="Recebido" value={totals.received} total={totals.total} />
                      <ProgressLine
                        label="Por receber"
                        value={totals.pending}
                        total={totals.total}
                      />
                    </div>
                  </div>
                  <div className="min-w-0 xl:col-span-2">
                    <UpsellMetricsCard studioId={studio.id} />
                  </div>
                </div>
              )}
            </details>
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Agenda futura
              </h3>
              <Link to="/admin/agenda" className="text-xs uppercase tracking-wide hover:underline">
                Ver todas
              </Link>
            </div>
            <div className="divide-y divide-border overflow-hidden rounded-[1.25rem] border border-border bg-card shadow-sm">
              {upcoming.length === 0 && (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  Sem marcações futuras.
                </p>
              )}
              {upcoming.slice(0, 5).map((a) => {
                const split = computeAppointmentSplit(a, studio, paidByAppointment.get(a.id) ?? 0);
                return (
                  <div key={a.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <ClientAvatar
                      name={a.clients?.name}
                      avatarUrl={a.clients?.avatar_url}
                      className="size-9 text-xs"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-medium leading-snug">
                        {a.clients?.name ?? "-"}
                      </p>
                      <p className="break-words text-xs leading-snug text-muted-foreground">
                        {new Date(a.starts_at).toLocaleString("pt-PT", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}{" "}
                        · {a.staff?.name ?? "-"}
                      </p>
                    </div>
                    <div className="text-right">
                      <MoneyValue value={formatEUR(split.total)} className="text-sm" />
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {formatAppointmentStatus(a.status)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {planChooserOpen && (
        <PlanChooserModal
          checkoutPlan={checkoutPlan}
          onClose={() => setPlanChooserOpen(false)}
          onChoose={activatePremium}
        />
      )}
    </>
  );
}

function ProfessionalOverview({
  appointments,
  paidRows,
  cashPaymentRows,
  refundRows,
  studio,
  period,
  onPeriodChange,
}: {
  appointments: Appt[];
  paidRows: PaidRow[];
  cashPaymentRows: OnsitePaymentRow[];
  refundRows: RefundRow[];
  studio: FinancialRuleSource & {
    name: string;
    staff_name?: string | null;
    deposit_percent: number;
    payment_policy: string;
  };
  period: SummaryPeriod;
  onPeriodChange: (period: SummaryPeriod) => void;
}) {
  const paymentFacts = buildAppointmentPaymentFacts(paidRows, cashPaymentRows, refundRows);
  const paidByAppointment = new Map<string, number>();
  for (const [appointmentId, facts] of paymentFacts) {
    paidByAppointment.set(appointmentId, facts.receivedCents / 100);
  }

  const now = Date.now();
  const periodStart = getPeriodStart(period, now);
  const periodEnd = new Date(now);
  periodEnd.setHours(24, 0, 0, 0);
  const previousPeriodStart = new Date(periodStart.getTime() - period * DAY_MS);
  const ownRows = appointments
    .filter((appointment) =>
      isFinanciallyRelevantAppointment(
        appointment.status,
        paidByAppointment.get(appointment.id) ?? 0,
      ),
    )
    .map((appointment) => ({
      appointment,
      split: computeAppointmentSplit(appointment, studio, paymentFacts.get(appointment.id) ?? null),
    }));
  const periodRows = ownRows.filter((row) => {
    const startsAt = new Date(row.appointment.starts_at);
    return startsAt >= periodStart && startsAt < periodEnd;
  });
  const previousRows = ownRows.filter((row) => {
    const startsAt = new Date(row.appointment.starts_at);
    return startsAt >= previousPeriodStart && startsAt < periodStart;
  });
  const totals = sumFinancialRows(periodRows);
  const previousTotals = sumFinancialRows(previousRows);
  const attended = periodRows.filter((row) => row.appointment.status === "completed").length;
  const ticket = periodRows.length ? totals.total / periodRows.length : 0;
  const revenueGrowth = getGrowthPercent(totals.total, previousTotals.total);
  const upcoming = sortAppointmentsChronologically(
    appointments.filter((appointment) => new Date(appointment.starts_at).getTime() >= now),
    "future",
  );
  const topServices = buildServiceRanking(periodRows);
  const chartData = buildDailyData(periodRows, periodStart, periodEnd);
  const maxDayTotal = Math.max(1, ...chartData.map((day) => day.total));
  const professionalName = studio.staff_name ?? "Profissional";
  const [privacyOpen, setPrivacyOpen] = useState(false);

  return (
    <div className="mx-auto w-full max-w-[88rem] space-y-3 pb-2 md:space-y-4 md:pb-8">
      <section className="overflow-hidden rounded-[1.35rem] border border-border bg-card shadow-sm">
        <div className="bg-[linear-gradient(135deg,rgba(16,185,129,0.14),rgba(255,255,255,0.02)_52%,rgba(14,165,233,0.08))] px-4 py-4 md:px-5">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
            Painel da profissional
          </p>
          <h1 className="mt-1 text-2xl font-light tracking-tight md:text-3xl">
            Olá, {professionalName}
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Acompanhe apenas a sua agenda, os seus clientes e o seu resultado individual.
          </p>
        </div>

        <div className="grid auto-rows-fr grid-cols-2 gap-2 p-3 sm:gap-2.5 lg:grid-cols-3 xl:grid-cols-6">
          <ProfessionalMetric
            label="Faturação"
            value={formatEUR(totals.total)}
            detail={`${revenueGrowth >= 0 ? "+" : ""}${revenueGrowth}% vs. período anterior`}
            icon={<Euro className="h-4 w-4" />}
            featured
          />
          <ProfessionalMetric
            label="Parte prevista"
            value={formatEUR(totals.professional)}
            detail="Parcela da equipa nas marcações válidas."
            icon={<Wallet className="h-4 w-4" />}
          />
          <ProfessionalMetric
            label="Atendimentos"
            value={String(attended)}
            detail={`${periodRows.length} marcações no período`}
            icon={<Calendar className="h-4 w-4" />}
          />
          <ProfessionalMetric
            label="Ticket médio"
            value={formatEUR(ticket)}
            detail="Média por marcação"
            icon={<TrendingUp className="h-4 w-4" />}
          />
          <ProfessionalMetric
            label="Parte já recebida"
            value={formatEUR(totals.signalProfessional)}
            detail="Parcela proporcional ao dinheiro recebido."
            icon={<CreditCard className="h-4 w-4" />}
          />
          <ProfessionalMetric
            label="Próximas"
            value={String(upcoming.length)}
            detail="Na sua agenda"
            icon={<Calendar className="h-4 w-4" />}
          />
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(17rem,21rem)]">
        <div className="rounded-[1.25rem] border border-border bg-card p-3.5 shadow-sm sm:p-4">
          <div className="flex flex-col gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                Evolução
              </p>
              <p className="mt-1 text-sm leading-snug text-muted-foreground">
                Valores dos seus atendimentos no período escolhido.
              </p>
            </div>
            <div className="grid w-full grid-cols-3 rounded-2xl border border-border bg-background/55 p-1">
              {SUMMARY_PERIODS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onPeriodChange(value)}
                  className={`min-w-0 rounded-xl px-2.5 py-2 text-center text-xs font-semibold transition ${
                    period === value
                      ? "bg-foreground text-background shadow-sm"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {value} dias
                </button>
              ))}
            </div>
          </div>
          <ProfessionalEvolutionChart data={chartData} maxTotal={maxDayTotal} />
        </div>

        <div className="space-y-3">
          <div className="rounded-[1.25rem] border border-border bg-card p-3.5 shadow-sm sm:p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
              Próxima marcação
            </p>
            {upcoming[0] ? (
              <div className="mt-3 rounded-2xl bg-muted/35 p-3">
                <p className="text-sm font-semibold">{upcoming[0].clients?.name ?? "Cliente"}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Date(upcoming[0].starts_at).toLocaleString("pt-PT", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">Sem marcações futuras.</p>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-[1.25rem] border border-border bg-card p-3.5 shadow-sm sm:p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
            Serviços mais realizados
          </p>
          <div className="mt-3 space-y-2">
            {topServices.length === 0 && (
              <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                Ainda não existem atendimentos neste período.
              </p>
            )}
            {topServices.map((service) => (
              <div
                key={service.name}
                className="flex items-center justify-between gap-3 rounded-2xl bg-muted/35 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold leading-snug">{service.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {service.count} atendimento{service.count === 1 ? "" : "s"}
                  </p>
                </div>
                <MoneyValue value={formatEUR(service.total)} className="text-sm" />
              </div>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded-[1.25rem] border border-border bg-card shadow-sm">
          <button
            type="button"
            onClick={() => setPrivacyOpen((open) => !open)}
            className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left transition hover:bg-muted/30 sm:px-4"
            aria-expanded={privacyOpen}
          >
            <span className="min-w-0">
              <span className="block text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                Privacidade do painel
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                O seu acesso fica limitado ao seu trabalho.
              </span>
            </span>
            <span className="grid size-8 shrink-0 place-items-center rounded-full border border-border bg-background/70 text-muted-foreground">
              <ChevronDown
                className={`h-4 w-4 transition-transform duration-200 ${privacyOpen ? "rotate-180" : ""}`}
              />
            </span>
          </button>
          <div
            className={`grid transition-[grid-template-rows] duration-200 ease-out ${
              privacyOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
            }`}
          >
            <div className="min-h-0 overflow-hidden">
              <div className="space-y-2 border-t border-border/70 px-3.5 py-3 text-sm sm:px-4">
                {[
                  "Agenda, clientes e horários mostram apenas o seu trabalho.",
                  "Dados globais do estúdio, relatórios e configurações ficam ocultos.",
                  "Indicadores financeiros compartilhados dependem das permissões da dona.",
                ].map((item) => (
                  <div
                    key={item}
                    className="rounded-2xl border border-border/70 bg-background/55 px-3 py-2 text-muted-foreground"
                  >
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function ProfessionalMetric({
  label,
  value,
  detail,
  icon,
  featured,
}: {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
  featured?: boolean;
}) {
  return (
    <div
      className={`flex h-full min-h-[7rem] min-w-0 flex-col rounded-2xl border p-3 shadow-sm sm:p-3.5 ${
        featured ? "border-emerald-700/25 bg-emerald-500/10" : "border-border/75 bg-background/65"
      }`}
    >
      <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
        <span className="grid size-8 place-items-center rounded-xl bg-card/80">{icon}</span>
        <p className="min-w-0 whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.12em]">
          {label}
        </p>
      </div>
      <p className="mt-2 max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[clamp(1.1rem,3.8vw,1.5rem)] font-semibold leading-tight tracking-tight">
        {value}
      </p>
      <p className="mt-auto pt-1 text-xs leading-snug text-muted-foreground">{detail}</p>
    </div>
  );
}

function ProfessionalEvolutionChart({
  data,
  maxTotal,
}: {
  data: DailyChartDay[];
  maxTotal: number;
}) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const width = useElementWidth(chartRef);
  const labelStep = useMemo(() => getEvolutionLabelStep(data.length, width), [data.length, width]);

  if (data.length === 0) {
    return (
      <div className="mt-3 flex h-52 items-center justify-center rounded-2xl border border-border/70 bg-background/45 px-4 text-center text-sm text-muted-foreground">
        Sem dados financeiros neste período.
      </div>
    );
  }

  return (
    <div
      ref={chartRef}
      className="mt-3 rounded-2xl border border-border/70 bg-background/45 px-3 pb-3 pt-4 sm:px-4"
    >
      <div
        className="grid h-40 items-end gap-1 sm:gap-1.5"
        style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }}
      >
        {data.map((day, index) => {
          const height = day.total > 0 ? Math.max(5, (day.total / maxTotal) * 100) : 0;
          const tooltipAlign =
            index === 0
              ? "left-0 translate-x-0"
              : index === data.length - 1
                ? "right-0 translate-x-0"
                : "left-1/2 -translate-x-1/2";
          return (
            <button
              key={day.key}
              type="button"
              className="group relative flex h-full min-w-0 cursor-default flex-col justify-end rounded-xl bg-muted/25 px-0.5 outline-none ring-0 transition hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-emerald-500/45 sm:px-1"
              aria-label={`${day.fullDate}: ${formatEUR(day.total)}`}
              title={`${day.fullDate}: ${formatEUR(day.total)}`}
            >
              <span
                className={`pointer-events-none absolute bottom-[calc(100%+0.5rem)] z-20 hidden w-max max-w-[10.5rem] rounded-xl border border-border bg-popover px-2.5 py-2 text-left text-[11px] leading-snug text-popover-foreground opacity-0 shadow-lg transition group-hover:block group-hover:opacity-100 group-focus:block group-focus:opacity-100 ${tooltipAlign}`}
              >
                <span className="block font-semibold">{day.fullDate}</span>
                <span className="block text-muted-foreground">{formatEUR(day.total)}</span>
              </span>
              <span
                className="mx-auto block w-full max-w-5 rounded-t-lg bg-emerald-600 shadow-[0_0_18px_rgba(16,185,129,0.16)] transition-[height,background-color] duration-200 group-hover:bg-emerald-500"
                style={{ height: `${height}%` }}
              />
            </button>
          );
        })}
      </div>
      <div
        className="mt-2 grid gap-1 text-center text-[10px] leading-none text-muted-foreground sm:text-[11px]"
        style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }}
      >
        {data.map((day, index) => {
          const show = shouldShowEvolutionLabel(index, data.length, labelStep);
          return (
            <span
              key={day.key}
              className={`min-w-0 overflow-hidden text-ellipsis whitespace-nowrap tabular-nums ${
                show ? "visible" : "invisible"
              }`}
              aria-hidden={!show}
            >
              {day.day}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function useElementWidth(ref: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;

    const updateWidth = () => setWidth(Math.round(element.getBoundingClientRect().width));
    updateWidth();
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}

function getEvolutionLabelStep(totalDays: number, width: number) {
  if (totalDays <= 1) return 1;
  if (!width) {
    if (totalDays <= 7) return 1;
    if (totalDays <= 15) return 3;
    return 5;
  }
  const minimumLabelWidth = width < 380 ? 54 : 62;
  const maxLabels = Math.max(2, Math.floor(width / minimumLabelWidth));
  return Math.max(1, Math.ceil(totalDays / maxLabels));
}

function shouldShowEvolutionLabel(index: number, totalDays: number, step: number) {
  if (index === 0 || index === totalDays - 1) return true;
  if (totalDays - 1 - index < Math.max(1, Math.floor(step / 2))) return false;
  return index % step === 0;
}

function MobileOverview({
  today,
  upcoming,
  totals,
  scheduledCount,
  paidByAppointment,
  studio,
}: {
  today: Appt[];
  upcoming: Appt[];
  totals: {
    total: number;
    confirmed: number;
    received: number;
    pending: number;
    professional: number;
    studio: number;
    commission: number;
    deposit: number;
    predicted: number;
  };
  scheduledCount: number;
  paidByAppointment: Map<string, number>;
  studio: FinancialRuleSource & {
    name: string;
    slug: string;
    deposit_percent: number;
    payment_policy: string;
  };
}) {
  const next = upcoming[0];
  const nextSplit = next
    ? computeAppointmentSplit(next, studio, paidByAppointment.get(next.id) ?? 0)
    : null;

  return (
    <div className="space-y-4 md:hidden">
      <section className="grid grid-cols-2 gap-3">
        <MobileMiniMetric
          label="Marcações hoje"
          value={String(today.length)}
          detail="Agendamentos previstos"
        />
        <MobileMiniMetric
          label="Receita agendada"
          value={formatEUR(totals.total)}
          detail={`${scheduledCount} ${scheduledCount === 1 ? "marcação confirmada" : "marcações confirmadas"}`}
          money
        />
      </section>

      <ShareStudioCard
        studioName={studio.name}
        studioSlug={studio.slug}
        variant="compact"
        className="w-full"
      />

      <section className="rounded-[1.35rem] border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Próxima marcação</h2>
          <Link to="/admin/agenda" className="text-xs font-medium text-muted-foreground">
            Ver agenda
          </Link>
        </div>
        {next ? (
          <div className="mt-4 flex items-center gap-3">
            <ClientAvatar
              name={next.clients?.name}
              avatarUrl={next.clients?.avatar_url}
              className="size-12 text-sm"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="break-words text-sm font-semibold leading-snug">
                  {next.clients?.name ?? "Cliente"}
                </p>
                <span className="shrink-0 rounded-full bg-emerald-600/10 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                  {new Date(next.starts_at).toLocaleTimeString("pt-PT", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <p className="break-words text-xs leading-snug text-muted-foreground">
                {next.staff?.name ?? "Profissional"} · {formatEUR(nextSplit?.total ?? 0)}
              </p>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">Sem marcações futuras.</p>
        )}
      </section>

      <section className="rounded-[1.35rem] border border-border bg-card p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Atalhos rápidos</h2>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <MobileShortcut to="/admin/equipa" label="Profissionais" />
          <MobileShortcut to="/admin/comissoes" label="Comissões" />
          <MobileShortcut to="/admin/sinal" label="Sinal" />
          <MobileShortcut to="/admin/servicos" label="Serviços" />
        </div>
      </section>

      <section className="rounded-[1.35rem] border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Marcações de hoje</h2>
          <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">
            {today.length} marcações
          </span>
        </div>
        <div className="mt-3 space-y-2">
          {today.length === 0 && (
            <p className="py-3 text-sm text-muted-foreground">Ainda não há marcações para hoje.</p>
          )}
          {today.slice(0, 3).map((item) => (
            <Link
              key={item.id}
              to="/admin/agenda"
              className="flex items-center gap-3 rounded-2xl bg-background/65 px-3 py-3"
            >
              <span className="w-12 shrink-0 text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                {new Date(item.starts_at).toLocaleTimeString("pt-PT", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              <ClientAvatar
                name={item.clients?.name}
                avatarUrl={item.clients?.avatar_url}
                className="size-9 text-xs"
              />
              <span className="min-w-0 flex-1">
                <span className="block break-words text-sm font-medium leading-snug">
                  {item.clients?.name ?? "Cliente"}
                </span>
                <span className="block break-words text-xs leading-snug text-muted-foreground">
                  {item.staff?.name ?? "Profissional"}
                </span>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function FreeOverview({
  studioName,
  studioSlug,
  appointments,
  serviceCount,
  staffCount,
  trialExpired,
}: {
  studioName: string;
  studioSlug: string;
  appointments: Appt[];
  serviceCount: number;
  staffCount: number;
  trialExpired: boolean;
}) {
  const now = new Date();
  const todayCount = appointments.filter(
    (appointment) =>
      new Date(appointment.starts_at).toDateString() === now.toDateString() &&
      !["cancelled", "no_show"].includes(appointment.status),
  ).length;
  const upcomingCount = appointments.filter(
    (appointment) =>
      Date.parse(appointment.starts_at) >= now.getTime() &&
      !["cancelled", "no_show"].includes(appointment.status),
  ).length;

  return (
    <div className="mx-auto w-full max-w-6xl min-w-0 space-y-4 py-2 md:py-5">
      <section className="min-w-0 rounded-[1.5rem] border border-border bg-card p-5 shadow-sm md:p-7">
        <div className="flex min-w-0 flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <span className="inline-flex rounded-full bg-emerald-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">
              {trialExpired ? "Trial encerrado · Plano Free" : "Plano Free"}
            </span>
            <h1 className="mt-3 break-words text-2xl font-light tracking-tight md:text-4xl">
              {trialExpired
                ? `${studioName}, o teste terminou e os seus dados continuam seguros.`
                : `${studioName}, o essencial está pronto.`}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {trialExpired
                ? "A conta passou automaticamente para o Free. A agenda, os clientes, os serviços e as marcações foram preservados."
                : "Receba marcações online, organize a agenda e mantenha clientes e serviços num painel simples."}
            </p>
          </div>
          <Link
            to="/admin/premium"
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-foreground px-5 text-xs font-bold uppercase tracking-wide text-background sm:w-auto"
          >
            {trialExpired ? "Fazer upgrade" : "Conhecer o Pro"} <ArrowRight className="size-4" />
          </Link>
        </div>
      </section>

      <section className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <DashboardFocusCard
          label="Hoje"
          value={String(todayCount)}
          detail="Marcações válidas para hoje."
          featured
        />
        <DashboardFocusCard
          label="Próximas"
          value={String(upcomingCount)}
          detail="Marcações futuras na agenda."
        />
        <DashboardFocusCard
          label="Serviços"
          value={String(serviceCount)}
          detail="Serviços ativos na página."
        />
        <DashboardFocusCard
          label="Profissionais"
          value={`${staffCount}/1`}
          detail="Limite incluído no Free."
        />
      </section>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.72fr)]">
        <ShareStudioCard
          studioName={studioName}
          studioSlug={studioSlug}
          variant="compact"
          className="w-full min-w-0"
        />
        <section className="min-w-0 rounded-[1.35rem] border border-emerald-500/20 bg-emerald-500/[0.045] p-5">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">
            Quando precisar
          </p>
          <h2 className="mt-2 break-words text-lg font-semibold">
            Receba sinal antes da marcação.
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Pagamentos online, notificações e gestão de equipa estão disponíveis no Pro.
          </p>
          <Link
            to="/admin/premium"
            className="mt-4 inline-flex items-center gap-2 text-xs font-bold text-emerald-700 dark:text-emerald-300"
          >
            Comparar planos <ArrowRight className="size-3.5" />
          </Link>
        </section>
      </div>
    </div>
  );
}

function TrialPremiumBanner({
  billing,
  checkoutPlan,
  onChoosePremiumPlan,
}: {
  billing: BillingSummary | null;
  checkoutPlan: PlanId | null;
  onChoosePremiumPlan: () => void;
}) {
  if (!billing?.trialActive || billing.status !== "trialing") return null;
  const hasStripeSubscription = Boolean(billing.hasStripeSubscription);
  const notice = getTrialNotice(billing.trialEndsAt);
  if (!notice) return null;
  const remaining = notice.daysRemaining;
  const urgent = notice.level === "warning" || notice.level === "critical";
  const critical = notice.level === "critical";
  const planLabel = formatPlan(billing.plan);
  const dateLabel = formatDate(billing.nextBillingAt ?? billing.trialEndsAt);
  const progress =
    Math.min(100, Math.max(6, ((TRIAL_DURATION_DAYS - remaining) / TRIAL_DURATION_DAYS) * 100));

  return (
    <section
      className={`mb-4 overflow-hidden rounded-[1.35rem] border p-4 shadow-lg md:rounded-[1.6rem] md:p-5 ${
        critical
          ? "border-rose-500/40 bg-[linear-gradient(135deg,rgba(244,63,94,0.16),rgba(255,255,255,0.02)_48%,rgba(245,158,11,0.08))] shadow-rose-950/10"
          : urgent
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
                {hasStripeSubscription ? `${planLabel} · ${notice.title}` : notice.title}
              </h2>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                {hasStripeSubscription
                  ? `A assinatura está preparada e o período experimental termina em ${dateLabel}.`
                  : notice.description}
              </p>
            </div>
            <span className="w-fit rounded-full bg-background/80 px-3 py-1.5 text-xs font-semibold text-foreground shadow-sm">
              {dateLabel}
            </span>
          </div>
          <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-background/75 ring-1 ring-border/60">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                critical ? "bg-rose-500" : urgent ? "bg-amber-500" : "bg-emerald-600"
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:w-72 lg:grid-cols-1">
          {hasStripeSubscription ? (
            <Link
              to="/admin/pagamentos"
              className="flex h-11 items-center justify-center gap-2 rounded-2xl bg-foreground px-4 text-xs font-bold uppercase tracking-wide text-background transition hover:opacity-90"
            >
              Gerir assinatura
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          ) : (
            <button
              type="button"
              onClick={onChoosePremiumPlan}
              disabled={checkoutPlan !== null}
              className="flex h-11 items-center justify-center gap-2 rounded-2xl bg-foreground px-4 text-xs font-bold uppercase tracking-wide text-background transition hover:opacity-90 disabled:opacity-60"
            >
              {checkoutPlan ? "A abrir pagamento..." : "Fazer upgrade"}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
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

function SubscriptionSnapshotCard({
  billing,
  compact,
}: {
  billing: BillingSummary | null;
  compact?: boolean;
}) {
  const remaining = billing ? getRemainingDays(billing) : null;
  const hasStripeSubscription = [
    "pro_monthly",
    "pro_yearly",
    "premium_monthly",
    "premium_yearly",
  ].includes(billing?.plan ?? "");
  const dateLabel = formatDate(billing?.nextBillingAt ?? billing?.trialEndsAt);
  return (
    <section
      className={`rounded-[1.35rem] border border-border bg-card shadow-sm ${
        compact ? "p-4" : "p-4 md:p-5"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-muted-foreground">
          <CreditCard className="h-4 w-4" />
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em]">Assinatura</p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
            billing?.subscriptionActive
              ? "bg-emerald-600 text-white"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {billing?.subscriptionActive ? "Ativo" : "Pendente"}
        </span>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <SnapshotItem label="Plano atual" value={formatPlan(billing?.plan)} />
        <SnapshotItem label="Estado" value={formatSubscriptionStatus(billing?.status)} />
        <SnapshotItem
          label={hasStripeSubscription ? "Primeira cobrança" : "Próxima cobrança"}
          value={dateLabel}
        />
        <SnapshotItem
          label={hasStripeSubscription ? "Dias até cobrança" : "Dias restantes"}
          value={remaining === null ? "Não disponível" : `${remaining} dias`}
        />
      </div>
    </section>
  );
}

function SnapshotItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/55 px-3 py-3">
      <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold leading-snug">{value}</p>
    </div>
  );
}

function WithdrawalStatusCard({
  withdrawal,
  compact,
  onEditSettings,
}: {
  withdrawal: WithdrawalSummary | null;
  compact?: boolean;
  onEditSettings: () => void;
}) {
  const latest = withdrawal?.requests?.[0] ?? null;
  if (!latest && !withdrawal?.settings) return null;
  const requests = withdrawal?.requests ?? [];
  return (
    <section
      className={`overflow-hidden rounded-[1.35rem] border border-border bg-card shadow-sm ${
        compact ? "p-4" : "p-4 md:p-5"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Recebimentos online
          </p>
          <h2 className="mt-1 text-sm font-semibold">Sinais recebidos online</h2>
        </div>
        <span className="shrink-0 rounded-full bg-emerald-600 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">
          {formatEUR((withdrawal?.availableCents ?? 0) / 100)}
        </span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="rounded-2xl border border-border/70 bg-background/55 px-3 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Dados de recebimento
          </p>
          <p className="mt-1 text-sm font-semibold">
            {withdrawal?.settings
              ? formatPayoutMethod(withdrawal.settings.payoutMethod)
              : "Por configurar"}
          </p>
          {withdrawal?.settings && (
            <p className="mt-1 text-xs text-muted-foreground">
              {withdrawal.settings.fiscalName} · NIF {withdrawal.settings.nif}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onEditSettings}
          className="bellza-panel-action bellza-panel-action-secondary"
        >
          {withdrawal?.settings ? "Editar dados" : "Adicionar dados"}
        </button>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Histórico financeiro
          </p>
          {latest && (
            <span className="rounded-full bg-muted px-2 py-1 text-[10px] font-semibold text-muted-foreground">
              Último: {formatWithdrawalStatus(latest.status)}
            </span>
          )}
        </div>
        {requests.length > 0 ? (
          <ExpandableList
            items={requests}
            initialCount={5}
            className="mt-3 space-y-3"
            getKey={(request) => request.id}
            moreLabel={(hidden) => `Ver mais ${hidden} registo${hidden !== 1 ? "s" : ""}`}
            renderItem={(request) => (
              <article className="rounded-[1.15rem] border border-border/70 bg-background/60 p-3.5 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold">
                        {formatWithdrawalStatus(request.status)}
                      </p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${withdrawalStatusPill(request.status)}`}
                      >
                        {formatWithdrawalStatus(request.status)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Registo em {formatDate(request.requestedAt)} ·{" "}
                      {formatPayoutMethod(request.payoutMethod)}
                    </p>
                    {request.failureReason && (
                      <p className="mt-2 text-xs leading-relaxed text-red-600 dark:text-red-400">
                        {request.failureReason}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 sm:text-right">
                    <p className="font-mono text-base font-semibold text-emerald-700 dark:text-emerald-400">
                      {formatCents(request.amountCents, request.currency)}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Atualizado em {formatDate(request.updatedAt ?? request.requestedAt)}
                    </p>
                  </div>
                </div>

                <WithdrawalTimeline request={request} />

                <div className="mt-3 flex flex-col gap-2 border-t border-border/60 pt-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-muted-foreground">
                    {withdrawalStatusDescription(request)}
                  </p>
                  {request.status === "completed" && request.proofUrl && (
                    <a
                      href={request.proofUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-10 items-center justify-center rounded-2xl bg-foreground px-4 text-xs font-bold uppercase tracking-wide text-background transition hover:opacity-90"
                    >
                      Descarregar comprovativo
                    </a>
                  )}
                </div>
              </article>
            )}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Dados financeiros guardados. Ainda não existem registos online neste período.
          </p>
        )}
      </div>
    </section>
  );
}

function WithdrawalTimeline({ request }: { request: WithdrawalSummary["requests"][number] }) {
  const steps: {
    key: WithdrawalSummary["requests"][number]["status"];
    label: string;
    date: string | null;
  }[] = [
    { key: "in_review", label: "Em análise", date: request.reviewedAt ?? request.requestedAt },
    { key: "processing", label: "Processando", date: request.processedAt },
    { key: "completed", label: "Concluído", date: request.paidAt },
  ];
  const currentIndex = withdrawalStepIndex(request.status);
  const terminalFailed = request.status === "failed" || request.status === "canceled";

  return (
    <div className="mt-4 grid gap-2 sm:grid-cols-3">
      {steps.map((step, index) => {
        const active = index <= currentIndex && !terminalFailed;
        const current = index === currentIndex && !terminalFailed;
        return (
          <div
            key={step.key}
            className={`relative rounded-2xl border px-3 py-2.5 ${
              active
                ? "border-emerald-700/25 bg-emerald-950/5 dark:bg-emerald-400/[0.06]"
                : "border-border/70 bg-muted/30"
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`grid size-5 place-items-center rounded-full text-[10px] font-bold ${
                  active ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground"
                }`}
              >
                {index + 1}
              </span>
              <span className="text-xs font-semibold">{step.label}</span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {step.date ? formatDate(step.date) : current ? "A decorrer" : "A aguardar"}
            </p>
          </div>
        );
      })}
      {terminalFailed && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 px-3 py-2.5 sm:col-span-3">
          <p className="text-xs font-semibold text-red-600 dark:text-red-400">
            {request.status === "failed" ? "O registo falhou." : "O registo foi cancelado."}
          </p>
        </div>
      )}
    </div>
  );
}

function PlanChooserModal({
  checkoutPlan,
  onClose,
  onChoose,
}: {
  checkoutPlan: PlanId | null;
  onClose: () => void;
  onChoose: (plan: PlanId) => void;
}) {
  const plans: { id: PlanId; name: string; price: string; detail: string; badge?: string }[] = [
    {
      id: "pro_monthly",
      name: "Pro Mensal",
      price: `${formatCents(PLAN_DEFINITIONS.pro.monthlyCents)}/mês`,
      detail: "Gestão, pagamentos e até 3 profissionais.",
      badge: "Mais escolhido",
    },
    {
      id: "pro_yearly",
      name: "Pro Anual",
      price: `${formatCents(PLAN_DEFINITIONS.pro.yearlyCents)}/ano`,
      detail: "Poupe 26,88 € por ano.",
    },
    {
      id: "premium_monthly",
      name: "Premium Mensal",
      price: `${formatCents(PLAN_DEFINITIONS.premium.monthlyCents)}/mês`,
      detail: "WhatsApp, fidelidade e recursos avançados.",
    },
    {
      id: "premium_yearly",
      name: "Premium Anual",
      price: `${formatCents(PLAN_DEFINITIONS.premium.yearlyCents)}/ano`,
      detail: "WhatsApp, fidelidade e recursos avançados.",
      badge: "Melhor valor",
    },
  ];

  return (
    <ModalShell onClose={onClose} title="Escolha o plano">
      <p className="text-sm leading-relaxed text-muted-foreground">
        Pode escolher o plano agora e manter o teste gratuito até ao fim. O pagamento é confirmado
        com segurança antes de libertar o acesso premium. As funcionalidades atuais estão incluídas
        nesta fase de lançamento.
      </p>
      <div className="mt-5 grid gap-3">
        {plans.map((plan) => (
          <button
            key={plan.id}
            type="button"
            onClick={() => onChoose(plan.id)}
            disabled={checkoutPlan !== null}
            className="rounded-2xl border border-border bg-background/65 p-4 text-left transition hover:border-emerald-700/35 hover:bg-emerald-950/5 disabled:opacity-60"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{plan.name}</span>
                  {plan.badge && (
                    <span className="rounded-full bg-foreground px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-background">
                      {plan.badge}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{plan.detail}</p>
              </div>
              <span className="shrink-0 text-sm font-semibold">{plan.price}</span>
            </div>
          </button>
        ))}
      </div>
    </ModalShell>
  );
}

function WithdrawalSetupModal({
  defaultValues,
  onClose,
  onSave,
}: {
  defaultValues: WithdrawalSummary["settings"];
  onClose: () => void;
  onSave: (input: {
    fiscalName: string;
    nif: string;
    payoutMethod: "iban" | "mb_way";
    iban: string;
    mbWayPhone: string;
  }) => Promise<void>;
}) {
  const [fiscalName, setFiscalName] = useState(defaultValues?.fiscalName ?? "");
  const [nif, setNif] = useState(defaultValues?.nif ?? "");
  const initialMethod = defaultValues?.payoutMethod === "mb_way" ? "mb_way" : "iban";
  const [payoutMethod, setPayoutMethod] = useState<"iban" | "mb_way">(initialMethod);
  const [iban, setIban] = useState(defaultValues?.iban ?? "");
  const [mbWayPhone, setMbWayPhone] = useState(defaultValues?.mbWayPhone ?? "");
  const [saving, setSaving] = useState(false);

  async function submit() {
    const cleanNif = nif.replace(/\D/g, "");
    if (!fiscalName.trim() || !cleanNif) {
      toast.error("Preencha o nome fiscal e o NIF.");
      return;
    }
    if (!/^\d{9}$/.test(cleanNif)) {
      toast.error("O NIF deve ter 9 dígitos.");
      return;
    }
    if (payoutMethod === "iban" && !iban.trim()) {
      toast.error("Indique o IBAN para transferência.");
      return;
    }
    if (payoutMethod === "mb_way" && !mbWayPhone.trim()) {
      toast.error("Indique o contacto MB WAY.");
      return;
    }
    setSaving(true);
    try {
      await onSave({
        fiscalName: fiscalName.trim(),
        nif: cleanNif,
        payoutMethod,
        iban,
        mbWayPhone,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("invalid_iban")) {
        toast.error("Confirme o IBAN indicado.");
      } else if (message.includes("invalid_mb_way_phone")) {
        toast.error("Confirme o contacto MB WAY indicado.");
      } else {
        toast.error("Não foi possível guardar os dados financeiros.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell onClose={onClose} title="Dados financeiros do estúdio">
      <div className="rounded-2xl border border-emerald-700/20 bg-emerald-950/[0.03] px-4 py-3 dark:bg-emerald-400/[0.05]">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Estes dados são usados apenas para identificar a conta de pagamentos online. Os valores
          são enviados diretamente para a conta do estúdio.
        </p>
      </div>
      <div className="mt-5 grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <LabeledInput label="Nome fiscal" value={fiscalName} onChange={setFiscalName} />
          <LabeledInput
            label="NIF"
            value={nif}
            onChange={(value) => setNif(value.replace(/\D/g, "").slice(0, 9))}
            inputMode="numeric"
            placeholder="9 dígitos"
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <ChoiceButton
            active={payoutMethod === "iban"}
            label="Transferência bancária"
            text="Receber no IBAN indicado."
            onClick={() => setPayoutMethod("iban")}
          />
          <ChoiceButton
            active={payoutMethod === "mb_way"}
            label="MB WAY"
            text="Receber no contacto indicado."
            onClick={() => setPayoutMethod("mb_way")}
          />
        </div>
        {payoutMethod === "iban" ? (
          <LabeledInput
            label="IBAN"
            value={iban}
            onChange={(value) => setIban(value.toUpperCase())}
            placeholder="PT50..."
          />
        ) : (
          <InternationalPhoneInput
            label="Contacto MB WAY"
            value={mbWayPhone}
            onChange={setMbWayPhone}
          />
        )}
      </div>
      <button
        type="button"
        onClick={() => void submit()}
        disabled={saving}
        className="mt-5 h-12 w-full rounded-2xl bg-foreground px-4 text-xs font-bold uppercase tracking-wide text-background shadow-lg shadow-black/10 transition hover:opacity-90 disabled:opacity-60"
      >
        {saving ? "A guardar..." : "Guardar e continuar"}
      </button>
    </ModalShell>
  );
}

function ModalShell({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-background/65 px-3 py-3 backdrop-blur-md sm:place-items-center">
      <button type="button" className="absolute inset-0" aria-label="Fechar" onClick={onClose} />
      <section className="relative flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-[1.5rem] border border-border bg-card shadow-2xl shadow-black/25">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border/70 px-5 py-5">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-400">
              Bellza
            </p>
            <h2 className="mt-1 text-xl font-light tracking-tight">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-9 shrink-0 place-items-center rounded-2xl border border-border bg-background/70 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label="Fechar"
          >
            ×
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto px-5 py-5">{children}</div>
      </section>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </span>
      <input
        value={value}
        placeholder={placeholder}
        inputMode={inputMode}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 h-12 w-full rounded-2xl border border-border bg-background/80 px-3.5 text-sm outline-none transition placeholder:text-muted-foreground/55 focus:border-emerald-700/40 focus:ring-2 focus:ring-emerald-700/10"
      />
    </label>
  );
}

function ChoiceButton({
  active,
  label,
  text,
  onClick,
}: {
  active: boolean;
  label: string;
  text: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border p-3.5 text-left transition ${
        active
          ? "border-emerald-700/45 bg-emerald-950/5 shadow-sm dark:bg-emerald-400/[0.06]"
          : "border-border bg-background/60 hover:border-foreground/15 hover:bg-muted/60"
      }`}
    >
      <span className="block text-sm font-semibold">{label}</span>
      <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{text}</span>
    </button>
  );
}

function MobileMiniMetric({
  label,
  value,
  detail,
  money,
}: {
  label: string;
  value: string;
  detail?: string;
  money?: boolean;
}) {
  return (
    <div className="flex min-h-[6.6rem] min-w-0 flex-col rounded-[1.15rem] border border-border bg-card p-3 shadow-sm">
      <p className="whitespace-nowrap text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground min-[380px]:text-[10px]">
        {label}
      </p>
      <p
        className={`mt-1.5 max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[clamp(1.15rem,5vw,1.25rem)] font-semibold leading-tight ${money ? "text-emerald-700 dark:text-emerald-400" : ""}`}
      >
        {value}
      </p>
      {detail && (
        <p className="mt-auto pt-1 text-[11px] leading-snug text-muted-foreground">{detail}</p>
      )}
    </div>
  );
}

function MobileShortcut({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="rounded-2xl border border-border bg-background/65 px-3 py-3 text-center text-xs font-semibold"
    >
      {label}
    </Link>
  );
}

async function fetchAppointments(studioId: string, since: string, staffId?: string | null) {
  const nowIso = new Date().toISOString();
  const mergeById = (groups: Array<unknown[] | null | undefined>) => {
    const byId = new Map<string, unknown>();
    for (const group of groups) {
      for (const row of group ?? []) {
        const id = String((row as { id?: unknown }).id ?? "");
        if (id) byId.set(id, row);
      }
    }
    return sortAppointmentsChronologically(Array.from(byId.values()) as Appt[], "future");
  };

  const loadPair = async (select: string, limit: number) => {
    const basePast = supabase
      .from("appointments")
      .select(select)
      .eq("studio_id", studioId)
      .match(staffId ? { staff_id: staffId } : {});
    const baseFuture = supabase
      .from("appointments")
      .select(select)
      .eq("studio_id", studioId)
      .match(staffId ? { staff_id: staffId } : {});
    const [recent, future] = await Promise.all([
      basePast
        .gte("starts_at", since)
        .lt("starts_at", nowIso)
        .order("starts_at", { ascending: false })
        .limit(limit),
      baseFuture.gte("starts_at", nowIso).order("starts_at", { ascending: true }).limit(limit),
    ]);
    if (recent.error || future.error) return { error: recent.error ?? future.error, data: null };
    return { error: null, data: mergeById([recent.data, future.data]) };
  };

  const withAvatar = await loadPair(
    "id,starts_at,status,total_price,studio_commission_percent_snapshot,clients(id,name,avatar_url),staff(id,name,commission_percent,deposit_recipient,deposit_professional_percent),appointment_services(price,studio_commission_percent_snapshot,services(name,commission_percent,deposit_recipient,deposit_professional_percent))",
    500,
  );
  if (!withAvatar.error) return withAvatar.data ?? [];

  const full = await loadPair(
    "id,starts_at,status,total_price,studio_commission_percent_snapshot,clients(id,name),staff(id,name,commission_percent,deposit_recipient,deposit_professional_percent),appointment_services(price,studio_commission_percent_snapshot,services(name,commission_percent,deposit_recipient,deposit_professional_percent))",
    500,
  );
  if (!full.error) return full.data ?? [];

  const legacy = await loadPair(
    "id,starts_at,status,total_price,clients(name),staff(id,name),appointment_services(price,services(name))",
    500,
  );
  if (legacy.error) throw legacy.error;
  return legacy.data ?? [];
}

function computeAppointmentSplit(
  a: Appt,
  studio: FinancialRuleSource & { deposit_percent: number; payment_policy: string },
  payment: AppointmentPaymentFacts | number | null,
) {
  const facts =
    typeof payment === "number"
      ? {
          appointmentId: a.id,
          onlineGrossCents: toCents(payment),
          onsiteGrossCents: 0,
          refundedCents: 0,
          onlineNetCents: toCents(payment),
          onsiteNetCents: 0,
          receivedCents: toCents(payment),
        }
      : payment;
  return computeAppointmentFinancialSplit(a.id, a, studio.commission_percent ?? 0, facts);
}

function buildStaffMetrics(
  staffRows: { id: string; name: string }[],
  rows: { appointment: Appt; split: ReturnType<typeof computeAppointmentSplit> }[],
  now: number,
): StaffMetrics[] {
  const map = new Map(
    staffRows.map((s) => [
      s.id,
      {
        id: s.id,
        name: s.name,
        appointmentsDone: 0,
        appointmentsFuture: 0,
        generated: 0,
        confirmed: 0,
        professional: 0,
        studio: 0,
        received: 0,
        pending: 0,
        commission: 0,
        predicted: 0,
      },
    ]),
  );
  for (const row of rows) {
    const staff = row.appointment.staff;
    if (!staff) continue;
    const current = map.get(staff.id) ?? {
      id: staff.id,
      name: staff.name,
      appointmentsDone: 0,
      appointmentsFuture: 0,
      generated: 0,
      confirmed: 0,
      professional: 0,
      studio: 0,
      received: 0,
      pending: 0,
      commission: 0,
      predicted: 0,
    };
    if (new Date(row.appointment.starts_at).getTime() >= now) current.appointmentsFuture += 1;
    else current.appointmentsDone += 1;
    current.generated += row.split.total;
    current.confirmed += row.split.total;
    current.professional += row.split.professional;
    current.studio += row.split.studio;
    current.received += row.split.received;
    current.pending += row.split.pending;
    current.commission += row.split.commission;
    map.set(staff.id, current);
  }
  return Array.from(map.values()).sort((a, b) => b.generated - a.generated);
}

function buildDailyData(
  rows: { appointment: Appt; split: ReturnType<typeof computeAppointmentSplit> }[],
  startInclusive: Date,
  endExclusive: Date,
) {
  const map = new Map<
    string,
    {
      key: string;
      day: string;
      fullDate: string;
      total: number;
      received: number;
      pending: number;
      appointments: number;
    }
  >();
  for (let date = new Date(startInclusive); date < endExclusive; date = addCalendarDays(date, 1)) {
    const key = formatDateInput(date);
    map.set(key, {
      key,
      day: date.toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit" }),
      fullDate: date.toLocaleDateString("pt-PT", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      }),
      total: 0,
      received: 0,
      pending: 0,
      appointments: 0,
    });
  }
  for (const row of rows) {
    const date = new Date(row.appointment.starts_at);
    const key = formatDateInput(date);
    const current = map.get(key) ?? {
      key,
      day: date.toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit" }),
      fullDate: date.toLocaleDateString("pt-PT", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      }),
      total: 0,
      received: 0,
      pending: 0,
      appointments: 0,
    };
    current.total += row.split.total;
    current.received += row.split.received;
    current.pending += row.split.pending;
    current.appointments += 1;
    map.set(key, current);
  }
  return Array.from(map.values()).map((d) => ({
    ...d,
    total: round(d.total),
    received: round(d.received),
    pending: round(d.pending),
  }));
}

function buildServiceRanking(
  rows: { appointment: Appt; split: ReturnType<typeof computeAppointmentSplit> }[],
) {
  const map = new Map<string, { name: string; count: number; total: number }>();
  for (const row of rows) {
    const services =
      row.appointment.appointment_services?.map((line) => ({
        name: line.services?.name ?? "Serviço",
        price: Number(line.price ?? 0),
      })) ?? [];
    const fallback = services.length ? services : [{ name: "Serviço", price: row.split.total }];
    for (const service of fallback) {
      const current = map.get(service.name) ?? { name: service.name, count: 0, total: 0 };
      current.count += 1;
      current.total += service.price;
      map.set(service.name, current);
    }
  }
  return Array.from(map.values())
    .sort((a, b) => b.count - a.count || b.total - a.total)
    .slice(0, 5);
}

function sumFinancialRows(rows: { split: ReturnType<typeof computeAppointmentSplit> }[]) {
  const cents = rows.reduce(
    (acc, row) => {
      for (const key of Object.keys(acc) as Array<keyof typeof acc>) {
        acc[key] += toCents(row.split[key]);
      }
      return acc;
    },
    {
      total: 0,
      realized: 0,
      confirmed: 0,
      professional: 0,
      studio: 0,
      received: 0,
      pending: 0,
      commission: 0,
      deposit: 0,
      predicted: 0,
      receivedOnline: 0,
      receivedOnsite: 0,
      refunded: 0,
      signalProfessional: 0,
      signalStudio: 0,
    },
  );
  return Object.fromEntries(
    Object.entries(cents).map(([key, value]) => [key, value / 100]),
  ) as typeof cents;
}

function getPeriodStart(periodDays: SummaryPeriod, now: number) {
  const start = new Date(now - (periodDays - 1) * DAY_MS);
  start.setHours(0, 0, 0, 0);
  return start;
}

function DashboardPeriodControls({
  value,
  customStart,
  customEnd,
  onChange,
  onCustomStartChange,
  onCustomEndChange,
}: {
  value: DashboardPeriodMode;
  customStart: string;
  customEnd: string;
  onChange: (value: DashboardPeriodMode) => void;
  onCustomStartChange: (value: string) => void;
  onCustomEndChange: (value: string) => void;
}) {
  const today = startOfLocalDay(new Date());
  const minDate = formatDateInput(addCalendarDays(today, -59));
  const maxDate = formatDateInput(today);

  return (
    <div className="w-full max-w-xl space-y-2 lg:w-auto">
      <div className="grid grid-cols-2 gap-1 rounded-2xl border border-border bg-background/45 p-1 sm:grid-cols-4">
        {DASHBOARD_PERIOD_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={value === option.value}
            className={`min-w-0 rounded-xl px-2.5 py-2 text-xs font-semibold transition ${
              value === option.value
                ? "bg-emerald-600 text-white shadow-sm shadow-emerald-950/15"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {value === "custom" && (
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-border/70 bg-background/35 p-2">
          <label className="min-w-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            De
            <input
              type="date"
              min={minDate}
              max={customEnd || maxDate}
              value={customStart}
              onChange={(event) => onCustomStartChange(event.target.value)}
              className="mt-1 h-9 w-full min-w-0 rounded-lg border border-border bg-background px-2 text-xs font-medium text-foreground outline-none focus:border-emerald-500"
            />
          </label>
          <label className="min-w-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Até
            <input
              type="date"
              min={customStart || minDate}
              max={maxDate}
              value={customEnd}
              onChange={(event) => onCustomEndChange(event.target.value)}
              className="mt-1 h-9 w-full min-w-0 rounded-lg border border-border bg-background px-2 text-xs font-medium text-foreground outline-none focus:border-emerald-500"
            />
          </label>
          <p className="col-span-2 text-[10px] leading-snug text-muted-foreground">
            Intervalo disponível: últimos 60 dias.
          </p>
        </div>
      )}
    </div>
  );
}

function getDashboardPeriodRange(
  mode: DashboardPeriodMode,
  customStart: string,
  customEnd: string,
  now: Date,
) {
  const today = startOfLocalDay(now);
  const end = addCalendarDays(today, 1);
  const earliest = addCalendarDays(today, -59);

  if (mode === "7d" || mode === "30d") {
    const days = mode === "7d" ? 7 : 30;
    return {
      start: addCalendarDays(today, -(days - 1)),
      end,
      days,
      label: `${days} dias`,
    };
  }

  if (mode === "month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return {
      start,
      end,
      days: countCalendarDays(start, end),
      label: "este mês",
    };
  }

  const requestedStart = clampDate(parseDateInput(customStart, earliest), earliest, today);
  const requestedEnd = clampDate(parseDateInput(customEnd, today), requestedStart, today);
  return {
    start: requestedStart,
    end: addCalendarDays(requestedEnd, 1),
    days: countCalendarDays(requestedStart, addCalendarDays(requestedEnd, 1)),
    label: `${requestedStart.toLocaleDateString("pt-PT")}–${requestedEnd.toLocaleDateString("pt-PT")}`,
  };
}

function startOfLocalDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addCalendarDays(value: Date, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function countCalendarDays(startInclusive: Date, endExclusive: Date) {
  let count = 0;
  for (
    let cursor = new Date(startInclusive);
    cursor < endExclusive;
    cursor = addCalendarDays(cursor, 1)
  ) {
    count += 1;
  }
  return Math.max(1, count);
}

function parseDateInput(value: string, fallback: Date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return new Date(fallback);
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? new Date(fallback) : startOfLocalDay(date);
}

function clampDate(value: Date, min: Date, max: Date) {
  if (value < min) return new Date(min);
  if (value > max) return new Date(max);
  return new Date(value);
}

function formatDateInput(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getGrowthPercent(current: number, previous: number) {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function getRemainingDays(billing: BillingSummary) {
  if (typeof billing.daysRemaining === "number") return billing.daysRemaining;
  const target = billing.status === "trialing" ? billing.trialEndsAt : billing.nextBillingAt;
  if (!target) return null;
  return Math.max(0, Math.ceil((new Date(target).getTime() - Date.now()) / DAY_MS));
}

function formatPlan(plan?: string | null) {
  const labels: Record<string, string> = {
    trial: "Teste gratuito",
    pro_monthly: "Pro Mensal",
    pro_yearly: "Pro Anual",
    premium_monthly: "Premium Mensal",
    premium_yearly: "Premium Anual",
    monthly: "Premium Mensal",
    quarterly: "Premium Trimestral",
    yearly: "Premium Anual",
    pro: "Premium",
    starter: "Starter",
    business: "Business",
  };
  return labels[plan ?? ""] ?? "Não definido";
}

function formatSubscriptionStatus(status?: string | null) {
  const labels: Record<string, string> = {
    trialing: "Em teste",
    active: "Ativa",
    past_due: "Pagamento em atraso",
    canceled: "Cancelada",
    unpaid: "Por regularizar",
    incomplete: "Incompleta",
    incomplete_expired: "Expirada",
    paused: "Pausada",
  };
  return labels[status ?? ""] ?? "N\u00e3o dispon\u00edvel";
}

function formatDate(value?: string | null) {
  if (!value) return "Não disponível";
  return new Date(value).toLocaleDateString("pt-PT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatCents(value: number, currency = "eur") {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format((value || 0) / 100);
}

function formatWithdrawalStatus(status?: string | null) {
  const labels: Record<string, string> = {
    pending: "Em análise",
    in_review: "Em an\u00e1lise",
    processing: "Processando",
    completed: "Conclu\u00eddo",
    failed: "Falhou",
    canceled: "Cancelado",
    paid: "Conclu\u00eddo",
    rejected: "Cancelado",
  };
  return labels[status ?? ""] ?? "N\u00e3o dispon\u00edvel";
}

function withdrawalStepIndex(status: string) {
  if (status === "completed") return 2;
  if (status === "processing") return 1;
  return 0;
}

function withdrawalStatusPill(status: string) {
  if (status === "completed") return "bg-emerald-600 text-white";
  if (status === "processing") return "bg-blue-600 text-white";
  if (status === "failed") return "bg-red-600 text-white";
  if (status === "canceled") return "bg-muted text-muted-foreground";
  return "bg-amber-500 text-white";
}

function withdrawalStatusDescription(request: WithdrawalSummary["requests"][number]) {
  if (request.status === "completed") {
    return request.proofUrl
      ? "Comprovativo disponível para descarga."
      : "Registo concluído. O comprovativo ficará disponível quando for emitido.";
  }
  if (request.status === "processing") return "O registo está a ser processado.";
  if (request.status === "failed") return "Não foi possível concluir este registo.";
  if (request.status === "canceled") return "Este registo foi cancelado.";
  return "O registo foi recebido e está em validação.";
}

function formatPayoutMethod(method?: string | null) {
  const labels: Record<string, string> = {
    iban: "Transferência bancária",
    mb_way: "MB WAY",
    stripe: "Transferência bancária",
  };
  return labels[method ?? ""] ?? "Transferência";
}

function isScheduledPerformanceStatus(status: string) {
  return status === "confirmed" || status === "completed" || status === "no_show";
}

function isBillable(status: string) {
  return status === "confirmed" || status === "completed";
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function ProgressLine({ label, value, total }: { label: string; value: number; total: number }) {
  const width = total > 0 ? Math.min(100, Math.max(2, (value / total) * 100)) : 0;
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
          {formatEUR(value)}
        </span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-muted">
        <div className="h-2 rounded-full bg-emerald-600" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-[10px] uppercase tracking-[0.2em]">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-light">{value}</p>
    </div>
  );
}

function DashboardFocusCard({
  label,
  value,
  detail,
  featured,
}: {
  label: string;
  value: string;
  detail: string;
  featured?: boolean;
}) {
  return (
    <article
      className={`flex min-h-[8rem] min-w-0 flex-col rounded-2xl border p-4 shadow-sm ${
        featured
          ? "border-emerald-700/25 bg-[linear-gradient(135deg,rgba(16,185,129,0.13),rgba(255,255,255,0.02))]"
          : "border-border bg-background/55"
      }`}
    >
      <p className="whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[clamp(1.45rem,2.1vw,1.5rem)] font-light leading-tight tracking-tight text-foreground">
        {value}
      </p>
      <p className="mt-auto pt-3 text-xs leading-snug text-muted-foreground">{detail}</p>
    </article>
  );
}

function FinanceSummaryCard({
  title,
  value,
  caption,
  icon,
  items,
  featured,
}: {
  title: string;
  value: string;
  caption: string;
  icon: React.ReactNode;
  featured?: boolean;
  items: { label: string; value: string; danger?: boolean }[];
}) {
  return (
    <article
      className={`flex min-h-[146px] min-w-0 flex-col rounded-2xl border p-4 shadow-sm transition-colors ${
        featured
          ? "border-emerald-700/25 bg-[linear-gradient(135deg,rgba(16,185,129,0.12),rgba(255,255,255,0.02))]"
          : "border-border bg-muted/25 hover:bg-muted/35"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-xl border border-border bg-background/70 text-muted-foreground">
            {icon}
          </span>
          <p className="whitespace-nowrap text-[10px] font-semibold uppercase leading-4 tracking-[0.12em] text-muted-foreground">
            {title}
          </p>
        </div>
      </div>
      <p className="mt-3 max-w-full overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[clamp(1.05rem,1.7vw,1.5rem)] font-semibold leading-tight tracking-tight text-emerald-700 dark:text-emerald-400">
        {value}
      </p>
      <p className="mt-2 text-[11px] leading-4 text-muted-foreground">{caption}</p>
      <div className="mt-auto grid grid-cols-2 gap-2 pt-3">
        {items.map((item) => (
          <div key={item.label} className="min-w-0 rounded-xl bg-background/55 px-2.5 py-2">
            <p className="whitespace-nowrap text-[9px] uppercase tracking-[0.08em] text-muted-foreground min-[1180px]:text-[10px]">
              {item.label}
            </p>
            <p
              className={`mt-1 max-w-full overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs font-semibold ${
                item.danger ? "text-red-500" : "text-foreground"
              }`}
            >
              {item.value}
            </p>
          </div>
        ))}
      </div>
    </article>
  );
}

function MoneyCard({
  label,
  value,
  icon,
  note,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  note?: string;
}) {
  return (
    <div className="flex min-h-[148px] flex-col rounded-2xl border border-border bg-muted/30 p-4 shadow-sm transition-colors hover:border-emerald-500/25 hover:bg-muted/40">
      <div className="flex min-h-10 items-start gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border bg-background/70 text-muted-foreground">
          {icon}
        </span>
        <span className="pt-1 text-[10px] font-semibold uppercase leading-4 tracking-[0.18em] text-muted-foreground">
          {label}
        </span>
      </div>
      <MoneyValue
        value={formatEUR(value)}
        className="mt-4 whitespace-nowrap text-2xl leading-none tabular-nums"
      />
      <p className="mt-auto min-h-8 pt-4 text-[11px] leading-4 text-muted-foreground">{note}</p>
    </div>
  );
}

function InsightCard({
  label,
  value,
  note,
  danger,
}: {
  label: string;
  value: string;
  note: string;
  danger?: boolean;
}) {
  return (
    <div className="flex min-h-[112px] flex-col rounded-2xl border border-border bg-muted/30 p-4 shadow-sm">
      <p className="min-h-4 text-[10px] font-semibold uppercase leading-4 tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-3 text-2xl font-semibold leading-none tabular-nums ${danger ? "text-red-500" : ""}`}
      >
        {value}
      </p>
      <p className="mt-auto min-h-5 pt-3 text-[11px] leading-4 text-muted-foreground">{note}</p>
    </div>
  );
}

function SignalLine({ label, value }: { label: string; value: string }) {
  const negative = value.startsWith("-");
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-background/40 px-3 py-2.5 text-xs">
      <span className="min-w-0 leading-snug text-muted-foreground">{label}</span>
      <span
        className={`shrink-0 font-mono font-semibold ${
          negative ? "text-red-500" : "text-emerald-700 dark:text-emerald-400"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/30 px-2.5 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
        {value}
      </span>
    </div>
  );
}

function MoneyValue({ value, className = "" }: { value: string; className?: string }) {
  return (
    <p
      className={`font-semibold tracking-tight text-emerald-700 dark:text-emerald-400 ${className}`}
    >
      {value}
    </p>
  );
}
