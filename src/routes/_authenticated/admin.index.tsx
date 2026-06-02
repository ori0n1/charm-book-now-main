import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import type { InputHTMLAttributes, ReactNode } from "react";
import { useState } from "react";
import {
  ArrowRight,
  Calendar,
  CreditCard,
  Euro,
  Scissors,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { ShareStudioCard } from "@/components/share-studio-card";
import { UpsellMetricsCard } from "@/components/upsell-metrics-card";
import { useCurrentStudio } from "@/hooks/use-current-studio";
import {
  createPlatformCheckoutSession,
  getPlatformSubscriptionSummary,
} from "@/lib/subscriptions.functions";
import {
  computeFinancialSplit,
  computeAttendanceRevenue,
  formatAppointmentStatus,
  formatEUR,
  isFinanciallyRelevantAppointment,
  type FinancialRuleSource,
} from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: OverviewPage,
});

type ServiceLine = {
  price: number;
  services: ({ name: string } & FinancialRuleSource) | null;
};

type Appt = {
  id: string;
  starts_at: string;
  status: string;
  total_price: number;
  clients: { name: string } | null;
  staff: ({ id: string; name: string } & FinancialRuleSource) | null;
  appointment_services?: ServiceLine[];
};

type PaidRow = {
  appointment_id: string | null;
  amount_cents: number;
  status: string;
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
type PlanId = "monthly" | "quarterly" | "yearly";

type BillingSummary = {
  available: boolean;
  plan: string;
  status: string;
  nextBillingAt: string | null;
  trialEndsAt?: string | null;
  daysRemaining?: number | null;
  cancelAtPeriodEnd: boolean;
  premiumActive: boolean;
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
const DAY_MS = 86400000;

function OverviewPage() {
  const { studio } = useCurrentStudio();
  const loadBilling = useServerFn(getPlatformSubscriptionSummary);
  const startCheckout = useServerFn(createPlatformCheckoutSession);
  const [summaryPeriod, setSummaryPeriod] = useState<SummaryPeriod>(30);
  const [checkoutPlan, setCheckoutPlan] = useState<PlanId | null>(null);
  const [planChooserOpen, setPlanChooserOpen] = useState(false);
  const billing = useQuery({
    queryKey: ["dashboard-subscription-summary", studio?.id],
    enabled: !!studio,
    staleTime: 30 * 1000,
    retry: 1,
    queryFn: async () =>
      (await loadBilling({ data: { studioId: studio!.id } })) as BillingSummary,
  });
  const overview = useQuery({
    queryKey: ["admin-finance-overview", studio?.id],
    enabled: !!studio,
    staleTime: 20 * 1000,
    queryFn: async () => {
      const since = new Date(Date.now() - 60 * DAY_MS).toISOString();
      const [appointmentResult, { data: staffRows }, { data: serviceRows }, { data: payments }] =
        await Promise.all([
          fetchAppointments(studio!.id, since),
          supabase
            .from("staff")
            .select("id,name")
            .eq("studio_id", studio!.id)
            .eq("is_active", true),
          supabase.from("services").select("id").eq("studio_id", studio!.id).eq("is_active", true),
          supabase
            .from("payment_intents")
            .select("appointment_id,amount_cents,status")
            .eq("studio_id", studio!.id),
        ]);

      return {
        appts: (appointmentResult ?? []) as unknown as Appt[],
        staffRows: (staffRows ?? []) as { id: string; name: string }[],
        counts: { services: serviceRows?.length ?? 0, staff: staffRows?.length ?? 0 },
        paidRows: (payments ?? []) as PaidRow[],
      };
    },
  });

  if (!studio || overview.isLoading)
    return <p className="text-sm text-muted-foreground">A carregar...</p>;

  async function activatePremium(plan: PlanId = "yearly") {
    if (!studio) return;
    setPlanChooserOpen(false);
    setCheckoutPlan(plan);
    try {
      const result = (await startCheckout({ data: { studioId: studio.id, plan } })) as {
        url?: string | null;
      };
      if (!result.url) throw new Error("checkout_unavailable");
      window.location.href = result.url;
    } catch {
      toast.error("Não foi possível abrir o pagamento seguro. Tente novamente.");
    } finally {
      setCheckoutPlan(null);
    }
  }

  const appts = overview.data?.appts ?? [];
  const counts = overview.data?.counts ?? { services: 0, staff: 0 };
  const paidByAppointment = new Map<string, number>();
  for (const p of overview.data?.paidRows ?? []) {
    if (!p.appointment_id || p.status !== "succeeded") continue;
    paidByAppointment.set(
      p.appointment_id,
      (paidByAppointment.get(p.appointment_id) ?? 0) + p.amount_cents / 100,
    );
  }

  const now = Date.now();
  const today = appts.filter(
    (a) => new Date(a.starts_at).toDateString() === new Date().toDateString(),
  );
  const upcoming = appts.filter(
    (a) => new Date(a.starts_at).getTime() >= now && isBillable(a.status),
  );
  const billable = appts.filter((a) =>
    isFinanciallyRelevantAppointment(a.status, paidByAppointment.get(a.id) ?? 0),
  );

  const rows = billable.map((a) => {
    const split = computeAppointmentSplit(a, studio, paidByAppointment.get(a.id) ?? 0);
    return { appointment: a, split };
  });

  const periodStart = getPeriodStart(summaryPeriod, now);
  const previousPeriodStart = new Date(periodStart.getTime() - summaryPeriod * DAY_MS);
  const periodRows = rows.filter((row) => new Date(row.appointment.starts_at) >= periodStart);
  const previousRows = rows.filter((row) => {
    const startsAt = new Date(row.appointment.starts_at);
    return startsAt >= previousPeriodStart && startsAt < periodStart;
  });
  const totals = sumFinancialRows(periodRows);
  const previousTotals = sumFinancialRows(previousRows);
  const periodAppointments = appts.filter((a) => {
    const startsAt = new Date(a.starts_at);
    return startsAt >= periodStart && isScheduledPerformanceStatus(a.status);
  });
  const previousAppointments = appts.filter((a) => {
    const startsAt = new Date(a.starts_at);
    return (
      startsAt >= previousPeriodStart &&
      startsAt < periodStart &&
      isScheduledPerformanceStatus(a.status)
    );
  });
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

  const chartData = buildDailyData(periodRows, summaryPeriod);
  const maxDayTotal = Math.max(1, ...chartData.map((d) => d.total));

  return (
    <>
      <MobileOverview
        today={today}
        upcoming={upcoming}
        totals={totals}
        paidByAppointment={paidByAppointment}
        studio={studio}
        billing={billing.data ?? null}
        checkoutPlan={checkoutPlan}
        onChoosePremiumPlan={() => setPlanChooserOpen(true)}
      />

      <div className="hidden space-y-7 md:block">
        <TrialPremiumBanner
          billing={billing.data ?? null}
          checkoutPlan={checkoutPlan}
          onChoosePremiumPlan={() => setPlanChooserOpen(true)}
        />

        <div className="hidden md:block">
          <ShareStudioCard studioName={studio.name} studioSlug={studio.slug} />
        </div>

        <section className="hidden rounded-2xl border border-border bg-card p-4 shadow-sm md:block md:p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                Atalhos rápido do estúdio
              </p>
              <h2 className="mt-2 text-lg font-semibold">Navegue rápido</h2>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Link
              to="/admin/balcao"
              className="rounded-2xl border border-border bg-background/70 px-4 py-4 text-center text-sm font-semibold transition hover:border-emerald-700/50 hover:bg-emerald-950/5"
            >
              Balcão
            </Link>
            <Link
              to="/admin/comissoes"
              className="rounded-2xl border border-border bg-background/70 px-4 py-4 text-center text-sm font-semibold transition hover:border-emerald-700/50 hover:bg-emerald-950/5"
            >
              Comissões
            </Link>
            <Link
              to="/admin/sinal"
              className="rounded-2xl border border-border bg-background/70 px-4 py-4 text-center text-sm font-semibold transition hover:border-emerald-700/50 hover:bg-emerald-950/5"
            >
              Sinal
            </Link>
            <Link
              to="/admin/servicos"
              className="rounded-2xl border border-border bg-background/70 px-4 py-4 text-center text-sm font-semibold transition hover:border-emerald-700/50 hover:bg-emerald-950/5"
            >
              Serviços
            </Link>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Hoje" value={String(today.length)} icon={<Calendar className="h-4 w-4" />} />
          <Stat
            label="Previstos"
            value={String(upcoming.length)}
            icon={<TrendingUp className="h-4 w-4" />}
          />
          <div className="hidden lg:block">
            <Stat
              label="Serviços"
              value={String(counts.services)}
              icon={<Scissors className="h-4 w-4" />}
            />
          </div>
          <div className="hidden lg:block">
            <Stat
              label="Equipa"
              value={String(counts.staff)}
              icon={<Users className="h-4 w-4" />}
            />
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm md:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Euro className="h-4 w-4" />
                <span className="text-[10px] uppercase tracking-[0.2em]">
                  Resumo {summaryPeriod} dias
                </span>
              </div>
              <MoneyValue value={formatEUR(totals.total)} className="mt-2 text-3xl" />
              <p className="mt-1 hidden text-xs text-muted-foreground md:block">
                Previsão sobre o valor total dos serviços · estúdio {studio.commission_percent}% · equipa{" "}
                {100 - studio.commission_percent}%
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-background/45 p-1">
              {SUMMARY_PERIODS.map((period) => (
                <button
                  key={period}
                  type="button"
                  onClick={() => setSummaryPeriod(period)}
                  className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
                    summaryPeriod === period
                      ? "bg-emerald-600 text-white shadow-lg shadow-emerald-950/15"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {period} dias
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 grid auto-rows-fr gap-3 lg:grid-cols-2 xl:grid-cols-4">
            <FinanceSummaryCard
              title="Receita total"
              icon={<Euro className="h-4 w-4" />}
              value={formatEUR(totals.total)}
              caption="Valor total dos serviços"
              featured
              items={[
                { label: "Confirmado", value: formatEUR(totals.confirmed) },
                { label: "Pendente", value: formatEUR(totals.pending) },
              ]}
            />
            <FinanceSummaryCard
              title="Pagamentos"
              icon={<Wallet className="h-4 w-4" />}
              value={formatEUR(totals.received)}
              caption="Sinais pagos online"
              items={[
                { label: "No estúdio", value: formatEUR(totals.pending) },
                { label: "Recebido", value: formatEUR(totals.received) },
              ]}
            />
            <FinanceSummaryCard
              title="Divisão"
              icon={<Users className="h-4 w-4" />}
              value={formatEUR(totals.studio)}
              caption={`Estúdio ${studio.commission_percent}% · equipa ${100 - studio.commission_percent}%`}
              items={[
                { label: "Estúdio", value: formatEUR(totals.studio) },
                { label: "Equipa", value: formatEUR(totals.professional) },
              ]}
            />
            <FinanceSummaryCard
              title="Agenda"
              icon={<Calendar className="h-4 w-4" />}
              value={String(periodAppointments.length)}
              caption={agendaTrend}
              items={[
                { label: "Compareceu", value: `${attendanceRate}%` },
                {
                  label: "Faltou",
                  value: String(missedCount),
                  danger: missedCount > attendedCount && missedCount > 0,
                },
              ]}
            />
          </div>

          <div className="mt-4 hidden gap-3 md:grid lg:grid-cols-[1.45fr_0.75fr]">
            <div className="rounded-2xl border border-border bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] p-4">
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Movimento diário
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Previsão diária, receita confirmada e sinais já recebidos.
              </p>
              <div className="mt-4 flex h-40 items-end gap-2 rounded-2xl bg-background/35 p-3">
                {chartData.length === 0 && (
                  <p className="w-full self-center text-center text-sm text-muted-foreground">
                    Sem dados financeiros neste período.
                  </p>
                )}
                {chartData.map((day) => (
                  <div key={day.key} className="group relative flex min-w-0 flex-1 flex-col items-center gap-2">
                    <div className="flex h-28 w-full items-end gap-1 overflow-hidden rounded-xl bg-muted/70 p-1 ring-1 ring-border/40">
                      <div
                        className="flex-1 rounded-t-lg bg-gradient-to-t from-emerald-700 to-emerald-400 transition-all duration-300 group-hover:from-emerald-600 group-hover:to-emerald-300"
                        style={{ height: `${Math.max(6, (day.total / maxDayTotal) * 100)}%` }}
                      />
                      <div
                        className="flex-1 rounded-t-lg bg-gradient-to-t from-sky-700 to-sky-400 opacity-85 transition-all duration-300"
                        style={{ height: `${day.confirmed > 0 ? Math.max(6, (day.confirmed / maxDayTotal) * 100) : 2}%` }}
                      />
                      <div
                        className="flex-1 rounded-t-lg bg-gradient-to-t from-zinc-500 to-zinc-300 opacity-80 transition-all duration-300 dark:from-zinc-600 dark:to-zinc-400"
                        style={{ height: `${day.received > 0 ? Math.max(6, (day.received / maxDayTotal) * 100) : 2}%` }}
                      />
                    </div>
                    <span className="truncate text-[10px] text-muted-foreground">{day.day}</span>
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-3 w-44 -translate-x-1/2 rounded-2xl border border-border bg-popover/98 p-3 text-xs opacity-0 shadow-2xl shadow-black/20 transition duration-150 group-hover:opacity-100">
                      <p className="font-semibold text-foreground">{day.fullDate}</p>
                      <p className="mt-1 text-muted-foreground">
                        Previsto:{" "}
                        <span className="font-mono text-emerald-600 dark:text-emerald-300">
                          {formatEUR(day.total)}
                        </span>
                      </p>
                      <p className="text-muted-foreground">
                        Confirmado:{" "}
                        <span className="font-mono text-sky-600 dark:text-sky-300">
                          {formatEUR(day.confirmed)}
                        </span>
                      </p>
                      <p className="text-muted-foreground">
                        Sinal recebido:{" "}
                        <span className="font-mono text-foreground">{formatEUR(day.received)}</span>
                      </p>
                      <p className="text-muted-foreground">
                        Agendamentos:{" "}
                        <span className="font-semibold text-foreground">{day.appointments}</span>
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] p-4">
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Leitura rápida
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Comissão sobre o total do serviço. O sinal indica apenas o que já foi pago.
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
                  total={totals.total}
                />
                <ProgressLine
                  label="Parte da equipa"
                  value={totals.professional}
                  total={totals.total}
                />
                <ProgressLine
                  label="Sinal já recebido"
                  value={totals.received}
                  total={totals.total}
                />
                <ProgressLine
                  label="Restante no estúdio"
                  value={totals.pending}
                  total={totals.total}
                />
              </div>
            </div>
          </div>
        </section>

        <div className="hidden md:block">
          <UpsellMetricsCard studioId={studio.id} />
        </div>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Agenda futura
            </h3>
            <Link to="/admin/agenda" className="text-xs uppercase tracking-wide hover:underline">
              Ver todas
            </Link>
          </div>
          <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            {upcoming.length === 0 && (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                Sem marcações futuras.
              </p>
            )}
            {upcoming.slice(0, 5).map((a) => {
              const split = computeAppointmentSplit(a, studio, paidByAppointment.get(a.id) ?? 0);
              return (
                <div key={a.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{a.clients?.name ?? "-"}</p>
                    <p className="truncate text-xs text-muted-foreground">
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

function MobileOverview({
  today,
  upcoming,
  totals,
  paidByAppointment,
  studio,
  billing,
  checkoutPlan,
  onChoosePremiumPlan,
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
  paidByAppointment: Map<string, number>;
  studio: FinancialRuleSource & { deposit_percent: number; payment_policy: string };
  billing: BillingSummary | null;
  checkoutPlan: PlanId | null;
  onChoosePremiumPlan: () => void;
}) {
  const next = upcoming[0];
  const nextSplit = next
    ? computeAppointmentSplit(next, studio, paidByAppointment.get(next.id) ?? 0)
    : null;

  return (
    <div className="space-y-4 md:hidden">
      <TrialPremiumBanner
        billing={billing}
        checkoutPlan={checkoutPlan}
        onChoosePremiumPlan={onChoosePremiumPlan}
      />

      <section className="grid grid-cols-2 gap-3">
        <MobileMiniMetric label="Hoje" value={String(today.length)} />
        <MobileMiniMetric label="Receita prevista" value={formatEUR(totals.total)} money />
      </section>

      <ShareStudioCard
        studioName={studio.name}
        studioSlug={studio.slug}
        variant="compact"
        className="w-full"
      />

      <section className="rounded-[1.35rem] border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Próximo agendamento</h2>
          <Link to="/admin/agenda" className="text-xs font-medium text-muted-foreground">
            Ver agenda
          </Link>
        </div>
        {next ? (
          <div className="mt-4 flex items-center gap-3">
            <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-emerald-600/10 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
              {new Date(next.starts_at).toLocaleTimeString("pt-PT", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{next.clients?.name ?? "Cliente"}</p>
              <p className="truncate text-xs text-muted-foreground">
                {next.staff?.name ?? "Profissional"} · {formatEUR(nextSplit?.total ?? 0)}
              </p>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">Sem agendamentos futuros.</p>
        )}
      </section>

      <section className="rounded-[1.35rem] border border-border bg-card p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Atalhos rápidos</h2>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <MobileShortcut to="/admin/balcao" label="Balcão" />
          <MobileShortcut to="/admin/comissoes" label="Comissões" />
          <MobileShortcut to="/admin/sinal" label="Sinal" />
          <MobileShortcut to="/admin/servicos" label="Serviços" />
        </div>
      </section>

      <section className="rounded-[1.35rem] border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Hoje</h2>
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
              <span className="w-12 shrink-0 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                {new Date(item.starts_at).toLocaleTimeString("pt-PT", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {item.clients?.name ?? "Cliente"}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
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

function TrialPremiumBanner({
  billing,
  checkoutPlan,
  onChoosePremiumPlan,
}: {
  billing: BillingSummary | null;
  checkoutPlan: PlanId | null;
  onChoosePremiumPlan: () => void;
}) {
  if (!billing || billing.status !== "trialing") return null;
  const remaining = getRemainingDays(billing);
  const urgent = remaining !== null && remaining <= 3;
  const progress = remaining === null ? 35 : Math.min(100, Math.max(6, ((14 - remaining) / 14) * 100));

  return (
    <section
      className={`overflow-hidden rounded-[1.35rem] border p-4 shadow-lg md:rounded-[1.6rem] md:p-5 ${
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
                Pode escolher um plano antecipadamente sem cancelar o teste atual.
              </p>
            </div>
            <span className="w-fit rounded-full bg-background/80 px-3 py-1.5 text-xs font-semibold text-foreground shadow-sm">
              {formatDate(billing.trialEndsAt ?? billing.nextBillingAt)}
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
          <button
            type="button"
            onClick={onChoosePremiumPlan}
            disabled={checkoutPlan !== null}
            className="flex h-11 items-center justify-center gap-2 rounded-2xl bg-foreground px-4 text-xs font-bold uppercase tracking-wide text-background transition hover:opacity-90 disabled:opacity-60"
          >
            {checkoutPlan ? "A abrir pagamento..." : "Ativar Premium"}
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
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
            billing?.premiumActive
              ? "bg-emerald-600 text-white"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {billing?.premiumActive ? "Ativo" : "Pendente"}
        </span>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <SnapshotItem label="Plano atual" value={formatPlan(billing?.plan)} />
        <SnapshotItem label="Estado" value={formatSubscriptionStatus(billing?.status)} />
        <SnapshotItem label="Próxima cobrança" value={formatDate(billing?.nextBillingAt)} />
        <SnapshotItem
          label="Dias restantes"
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
      <p className="mt-1 truncate text-sm font-semibold">{value}</p>
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
            Levantamentos
          </p>
          <h2 className="mt-1 text-sm font-semibold">Sinais pagos pelas clientes</h2>
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
            {withdrawal?.settings ? formatPayoutMethod(withdrawal.settings.payoutMethod) : "Por configurar"}
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
          className="h-11 rounded-2xl border border-border px-4 text-xs font-bold uppercase tracking-wide text-foreground transition hover:bg-muted"
        >
          {withdrawal?.settings ? "Editar dados" : "Adicionar dados"}
        </button>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Histórico de levantamentos
          </p>
          {latest && (
            <span className="rounded-full bg-muted px-2 py-1 text-[10px] font-semibold text-muted-foreground">
              Último: {formatWithdrawalStatus(latest.status)}
            </span>
          )}
        </div>
        {requests.length > 0 ? (
          <div className="mt-3 max-h-[26rem] space-y-3 overflow-y-auto pr-1">
            {requests.map((request) => (
              <article
                key={request.id}
                className="rounded-[1.15rem] border border-border/70 bg-background/60 p-3.5 shadow-sm"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold">{formatWithdrawalStatus(request.status)}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${withdrawalStatusPill(request.status)}`}>
                        {formatWithdrawalStatus(request.status)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Pedido em {formatDate(request.requestedAt)} · {formatPayoutMethod(request.payoutMethod)}
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
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Dados financeiros guardados. Ainda não existem pedidos de levantamento.
          </p>
        )}
      </div>
    </section>
  );
}

function WithdrawalTimeline({ request }: { request: WithdrawalSummary["requests"][number] }) {
  const steps: { key: WithdrawalSummary["requests"][number]["status"]; label: string; date: string | null }[] = [
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
            {request.status === "failed" ? "O levantamento falhou." : "O levantamento foi cancelado."}
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
    { id: "monthly", name: "Mensal", price: "8,99 €/mês", detail: "Flexível, sem fidelização." },
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
    },
  ];

  return (
    <ModalShell onClose={onClose} title="Escolha o plano Premium">
      <p className="text-sm leading-relaxed text-muted-foreground">
        Pode escolher o plano agora e manter o teste gratuito até ao fim. O pagamento é
        confirmado com segurança antes de libertar o acesso premium.
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
      await onSave({ fiscalName: fiscalName.trim(), nif: cleanNif, payoutMethod, iban, mbWayPhone });
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
          Estes dados são usados apenas para receber levantamentos dos sinais pagos pelas clientes.
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
          <LabeledInput
            label="Contacto MB WAY"
            value={mbWayPhone}
            onChange={setMbWayPhone}
            placeholder="+351 ..."
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
  money,
}: {
  label: string;
  value: string;
  money?: boolean;
}) {
  return (
    <div className="rounded-[1.15rem] border border-border bg-card p-3 shadow-sm">
      <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p
        className={`mt-2 truncate text-xl font-semibold ${money ? "text-emerald-700 dark:text-emerald-400" : ""}`}
      >
        {value}
      </p>
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

async function fetchAppointments(studioId: string, since: string) {
  const full = await supabase
    .from("appointments")
    .select(
      "id,starts_at,status,total_price,clients(name),staff(id,name,commission_percent,deposit_recipient,deposit_professional_percent),appointment_services(price,services(name,commission_percent,deposit_recipient,deposit_professional_percent))",
    )
    .eq("studio_id", studioId)
    .gte("starts_at", since)
    .order("starts_at", { ascending: false })
    .limit(80);
  if (!full.error) return full.data ?? [];

  const legacy = await supabase
    .from("appointments")
    .select(
      "id,starts_at,status,total_price,clients(name),staff(id,name),appointment_services(price,services(name))",
    )
    .eq("studio_id", studioId)
    .gte("starts_at", since)
    .order("starts_at", { ascending: false })
    .limit(80);
  if (legacy.error) throw legacy.error;
  return legacy.data ?? [];
}

function computeAppointmentSplit(
  a: Appt,
  studio: FinancialRuleSource & { deposit_percent: number; payment_policy: string },
  paidAmount: number,
) {
  const revenue = computeAttendanceRevenue(Number(a.total_price), paidAmount, a.status);
  const lines = a.appointment_services?.length
    ? a.appointment_services
    : [{ price: Number(a.total_price), services: null }];
  return lines.reduce(
    (acc, line) => {
      const rule = line.services ?? a.staff ?? studio;
      const studioPercent =
        rule.commission_percent ?? a.staff?.commission_percent ?? studio.commission_percent ?? 0;
      const linePaid =
        Number(a.total_price) > 0 ? (paidAmount * Number(line.price)) / Number(a.total_price) : 0;
      const lineConfirmed =
        Number(a.total_price) > 0
          ? (revenue.confirmed * Number(line.price)) / Number(a.total_price)
          : Number(line.price);
      const linePredicted =
        Number(a.total_price) > 0
          ? (revenue.predicted * Number(line.price)) / Number(a.total_price)
          : 0;
      const lineTotal = round(lineConfirmed + linePredicted);
      const onlinePaid = round(Math.min(Number(line.price), Math.max(0, linePaid)));
      const split = computeFinancialSplit(lineTotal, studioPercent, {
        depositPercent: studio.deposit_percent,
        requiresDeposit: false,
        receivedAmount: onlinePaid,
      });
      return {
        total: acc.total + lineTotal,
        confirmed: acc.confirmed + round(lineConfirmed),
        professional: acc.professional + split.professional,
        studio: acc.studio + split.studio,
        received: acc.received + onlinePaid,
        pending: acc.pending + split.pending,
        commission: acc.commission + split.commission,
        deposit: acc.deposit + split.deposit,
        predicted: acc.predicted + round(linePredicted),
      };
    },
    {
      total: 0,
      confirmed: 0,
      professional: 0,
      studio: 0,
      received: 0,
      pending: 0,
      commission: 0,
      deposit: 0,
      predicted: 0,
    },
  );
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
    };
    if (new Date(row.appointment.starts_at).getTime() >= now) current.appointmentsFuture += 1;
    else current.appointmentsDone += 1;
    current.generated += row.split.total;
    current.confirmed += row.split.confirmed;
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
  periodDays: SummaryPeriod,
) {
  const map = new Map<
    string,
    {
      key: string;
      day: string;
      fullDate: string;
      total: number;
      confirmed: number;
      received: number;
      appointments: number;
    }
  >();
  for (let index = periodDays - 1; index >= 0; index -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - index);
    const key = date.toISOString().slice(0, 10);
    map.set(key, {
      key,
      day: date.toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit" }),
      fullDate: date.toLocaleDateString("pt-PT", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      }),
      total: 0,
      confirmed: 0,
      received: 0,
      appointments: 0,
    });
  }
  for (const row of rows) {
    const date = new Date(row.appointment.starts_at);
    const key = date.toISOString().slice(0, 10);
    const current =
      map.get(key) ?? {
        key,
        day: date.toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit" }),
        fullDate: date.toLocaleDateString("pt-PT", {
          day: "2-digit",
          month: "long",
          year: "numeric",
        }),
        total: 0,
        confirmed: 0,
        received: 0,
        appointments: 0,
      };
    current.total += row.split.total;
    current.confirmed += row.split.confirmed;
    current.received += row.split.received;
    current.appointments += 1;
    map.set(key, current);
  }
  return Array.from(map.values()).map((d) => ({
    ...d,
      total: round(d.total),
      confirmed: round(d.confirmed),
      received: round(d.received),
  }));
}

function sumFinancialRows(rows: { split: ReturnType<typeof computeAppointmentSplit> }[]) {
  return rows.reduce(
    (acc, row) => ({
      total: acc.total + row.split.total,
      confirmed: acc.confirmed + row.split.confirmed,
      professional: acc.professional + row.split.professional,
      studio: acc.studio + row.split.studio,
      received: acc.received + row.split.received,
      pending: acc.pending + row.split.pending,
      commission: acc.commission + row.split.commission,
      deposit: acc.deposit + row.split.deposit,
      predicted: acc.predicted + row.split.predicted,
    }),
    {
      total: 0,
      confirmed: 0,
      professional: 0,
      studio: 0,
      received: 0,
      pending: 0,
      commission: 0,
      deposit: 0,
      predicted: 0,
    },
  );
}

function getPeriodStart(periodDays: SummaryPeriod, now: number) {
  const start = new Date(now - (periodDays - 1) * DAY_MS);
  start.setHours(0, 0, 0, 0);
  return start;
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
      : "Levantamento concluído. O comprovativo ficará disponível quando for emitido.";
  }
  if (request.status === "processing") return "O pedido está a ser processado.";
  if (request.status === "failed") return "Não foi possível concluir este levantamento.";
  if (request.status === "canceled") return "Este pedido foi cancelado.";
  return "O pedido foi recebido e está em validação.";
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
      className={`flex min-h-[138px] flex-col rounded-2xl border p-4 shadow-sm transition-colors ${
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
          <p className="truncate text-[10px] font-semibold uppercase leading-4 tracking-[0.18em] text-muted-foreground">
            {title}
          </p>
        </div>
      </div>
      <p className="mt-3 truncate font-mono text-2xl font-semibold leading-none tracking-tight text-emerald-700 dark:text-emerald-400">
        {value}
      </p>
      <p className="mt-2 truncate text-[11px] leading-4 text-muted-foreground">{caption}</p>
      <div className="mt-auto grid grid-cols-2 gap-2 pt-3">
        {items.map((item) => (
          <div key={item.label} className="min-w-0 rounded-xl bg-background/55 px-2.5 py-2">
            <p className="truncate text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              {item.label}
            </p>
            <p
              className={`mt-1 truncate font-mono text-xs font-semibold ${
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
      <MoneyValue value={formatEUR(value)} className="mt-4 whitespace-nowrap text-2xl leading-none tabular-nums" />
      <p className="mt-auto min-h-8 pt-4 text-[11px] leading-4 text-muted-foreground">
        {note}
      </p>
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
      <p className={`mt-3 text-2xl font-semibold leading-none tabular-nums ${danger ? "text-red-500" : ""}`}>
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



