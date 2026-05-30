import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Calendar, Euro, HandCoins, Scissors, TrendingUp, Users, Wallet } from "lucide-react";
import { toast } from "sonner";
import { ShareStudioCard } from "@/components/share-studio-card";
import { UpsellMetricsCard } from "@/components/upsell-metrics-card";
import { useCurrentStudio } from "@/hooks/use-current-studio";
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
  professional: number;
  studio: number;
  received: number;
  pending: number;
  commission: number;
  predicted: number;
};

type SummaryPeriod = 7 | 15 | 30;

const SUMMARY_PERIODS: SummaryPeriod[] = [7, 15, 30];
const DAY_MS = 86400000;

function OverviewPage() {
  const { studio } = useCurrentStudio();
  const [summaryPeriod, setSummaryPeriod] = useState<SummaryPeriod>(30);
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

  const availableBalance = (overview.data?.paidRows ?? []).reduce(
    (sum, payment) =>
      payment.status === "succeeded" ? sum + Number(payment.amount_cents || 0) / 100 : sum,
    0,
  );
  const staffMetrics = buildStaffMetrics(overview.data?.staffRows ?? [], rows, now);
  const chartData = buildDailyData(periodRows, summaryPeriod);
  const maxDayTotal = Math.max(1, ...chartData.map((d) => d.total));
  const requestWithdraw = () => {
    if (availableBalance <= 0) {
      toast.message("Ainda não existem sinais online para levantar.");
      return;
    }
    toast.success("Pedido de levantamento iniciado.");
  };

  return (
    <>
      <MobileOverview
        availableBalance={availableBalance}
        today={today}
        upcoming={upcoming}
        totals={totals}
        paidByAppointment={paidByAppointment}
        studio={studio}
        requestWithdraw={requestWithdraw}
      />

      <div className="hidden space-y-7 md:block">
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

        <section className="overflow-hidden rounded-2xl border border-emerald-700/25 bg-[linear-gradient(135deg,rgba(16,185,129,0.12),rgba(16,185,129,0.03))] p-4 shadow-sm md:p-5">
          <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <div className="flex items-center gap-2 text-emerald-700">
                <HandCoins className="h-4 w-4" />
                <span className="text-[10px] uppercase tracking-[0.2em]">
                  Saldo disponível para levantamento
                </span>
              </div>
              <MoneyValue value={formatEUR(availableBalance)} className="mt-2 text-3xl" />
              <p className="mt-2 max-w-xl text-xs leading-relaxed text-muted-foreground md:text-sm">
                Este valor inclui apenas os sinais já pagos online. O restante será recebido
                presencialmente no estúdio.
              </p>
            </div>
            <button
              type="button"
              onClick={requestWithdraw}
              className="rounded-xl bg-emerald-600 px-5 py-3 text-xs font-bold uppercase tracking-wide text-white shadow-lg shadow-emerald-900/10 transition hover:bg-emerald-700"
            >
              Levantar saldo
            </button>
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
                Faturamento confirmado · estúdio {studio.commission_percent}% · equipa{" "}
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

          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-6">
            <MoneyCard
              label="Confirmado"
              value={totals.total}
              note="Receita real"
              icon={<Euro className="h-3.5 w-3.5" />}
            />
            <MoneyCard
              label="Sinal online"
              value={totals.received}
              note="Pago no período"
              icon={<Wallet className="h-3.5 w-3.5" />}
            />
            <MoneyCard
              label="Valor previsto"
              value={totals.predicted}
              note="Ainda futuro"
              icon={<Calendar className="h-3.5 w-3.5" />}
            />
            <InsightCard label="Agendamentos" value={String(periodAppointments.length)} note={agendaTrend} />
            <InsightCard
              label="Compareceu"
              value={String(attendedCount)}
              note={`${attendanceRate}% de taxa`}
            />
            <InsightCard
              label="Faltou"
              value={String(missedCount)}
              note={attendanceSignal}
              danger={missedCount > attendedCount && missedCount > 0}
            />
          </div>

          <div className="mt-4 hidden gap-4 md:grid lg:grid-cols-[1.4fr_0.8fr]">
            <div className="rounded-2xl border border-border bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] p-4">
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Movimento diário
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Evolução diária de receita e agendamentos.
              </p>
              <div className="mt-5 flex h-44 items-end gap-2 rounded-2xl bg-background/35 p-3">
                {chartData.length === 0 && (
                  <p className="w-full self-center text-center text-sm text-muted-foreground">
                    Sem dados financeiros neste período.
                  </p>
                )}
                {chartData.map((day) => (
                  <div key={day.key} className="group relative flex min-w-0 flex-1 flex-col items-center gap-2">
                    <div className="flex h-32 w-full items-end overflow-hidden rounded-xl bg-muted/70 ring-1 ring-border/40">
                      <div
                        className="w-full rounded-t-xl bg-gradient-to-t from-emerald-700 to-emerald-400 transition-all duration-300 group-hover:from-emerald-600 group-hover:to-emerald-300"
                        style={{ height: `${Math.max(6, (day.total / maxDayTotal) * 100)}%` }}
                      />
                    </div>
                    <span className="truncate text-[10px] text-muted-foreground">{day.day}</span>
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-3 w-44 -translate-x-1/2 rounded-2xl border border-border bg-popover/98 p-3 text-xs opacity-0 shadow-2xl shadow-black/20 transition duration-150 group-hover:opacity-100">
                      <p className="font-semibold text-foreground">{day.fullDate}</p>
                      <p className="mt-1 text-muted-foreground">
                        Valor:{" "}
                        <span className="font-mono text-emerald-600 dark:text-emerald-300">
                          {formatEUR(day.total)}
                        </span>
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
                Divisão simples
              </p>
              <div className="mt-4 space-y-3">
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
                  label="Sinal pago online"
                  value={totals.received}
                  total={totals.total}
                />
                <ProgressLine
                  label="Valor previsto"
                  value={totals.predicted}
                  total={totals.total + totals.predicted}
                />
                <ProgressLine
                  label="Parte da equipa"
                  value={totals.professional}
                  total={totals.total}
                />
              </div>
            </div>
          </div>
        </section>

        <section className="hidden md:block">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Ganhos por profissional
            </h3>
            <Link to="/admin/agenda" className="text-xs uppercase tracking-wide hover:underline">
              Histórico
            </Link>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {staffMetrics.map((m) => (
              <article
                key={m.id}
                className="rounded-2xl border border-border bg-card p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="font-medium">{m.name}</h4>
                    <p className="text-xs text-muted-foreground">
                      {m.appointmentsDone} realizados · {m.appointmentsFuture} futuros
                    </p>
                  </div>
                  <MoneyValue value={formatEUR(m.generated)} className="text-sm" />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                  <Line label="Parte da profissional" value={formatEUR(m.professional)} />
                  <Line label="Parte do estúdio" value={formatEUR(m.studio)} />
                  <Line label="Sinal online" value={formatEUR(m.received)} />
                  <Line label="Valor previsto" value={formatEUR(m.pending)} />
                </div>
              </article>
            ))}
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
    </>
  );
}

function MobileOverview({
  availableBalance,
  today,
  upcoming,
  totals,
  paidByAppointment,
  studio,
  requestWithdraw,
}: {
  availableBalance: number;
  today: Appt[];
  upcoming: Appt[];
  totals: {
    total: number;
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
  requestWithdraw: () => void;
}) {
  const next = upcoming[0];
  const nextSplit = next
    ? computeAppointmentSplit(next, studio, paidByAppointment.get(next.id) ?? 0)
    : null;

  return (
    <div className="space-y-4 md:hidden">
      <section className="rounded-[1.35rem] border border-emerald-700/25 bg-[linear-gradient(135deg,rgba(16,185,129,0.16),rgba(255,255,255,0.02)_48%,rgba(16,185,129,0.06))] p-4 shadow-lg shadow-black/15">
        <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-400">
          Saldo disponível
        </p>
        <MoneyValue value={formatEUR(availableBalance)} className="mt-2 text-4xl" />
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Apenas sinais pagos online.
        </p>
        <button
          type="button"
          onClick={requestWithdraw}
          className="mt-4 h-11 w-full rounded-2xl bg-emerald-600 px-4 text-xs font-bold uppercase tracking-wide text-white shadow-lg shadow-emerald-950/20"
        >
          Levantar saldo
        </button>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <MobileMiniMetric label="Hoje" value={String(today.length)} />
        <MobileMiniMetric label="Confirmado" value={formatEUR(totals.total)} money />
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
      const lineRevenue =
        Number(a.total_price) > 0
          ? (revenue.confirmed * Number(line.price)) / Number(a.total_price)
          : Number(line.price);
      const linePredicted =
        Number(a.total_price) > 0
          ? (revenue.predicted * Number(line.price)) / Number(a.total_price)
          : 0;
      const split = computeFinancialSplit(lineRevenue, studioPercent, {
        depositPercent: studio.deposit_percent,
        requiresDeposit: false,
        receivedAmount: lineRevenue,
      });
      const onlinePaid = round(Math.min(Number(line.price), Math.max(0, linePaid)));
      return {
        total: acc.total + round(lineRevenue),
        professional: acc.professional + split.professional,
        studio: acc.studio + split.studio,
        received: acc.received + onlinePaid,
        pending: acc.pending + round(linePredicted),
        commission: acc.commission + split.commission,
        deposit: acc.deposit + split.deposit,
        predicted: acc.predicted + round(linePredicted),
      };
    },
    {
      total: 0,
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
      professional: 0,
      studio: 0,
      received: 0,
      pending: 0,
      commission: 0,
    };
    if (new Date(row.appointment.starts_at).getTime() >= now) current.appointmentsFuture += 1;
    else current.appointmentsDone += 1;
    current.generated += row.split.total;
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
    { key: string; day: string; fullDate: string; total: number; received: number; appointments: number }
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
        received: 0,
        appointments: 0,
      };
    current.total += row.split.total;
    current.received += row.split.received;
    current.appointments += 1;
    map.set(key, current);
  }
  return Array.from(map.values()).map((d) => ({
    ...d,
    total: round(d.total),
    received: round(d.received),
  }));
}

function sumFinancialRows(rows: { split: ReturnType<typeof computeAppointmentSplit> }[]) {
  return rows.reduce(
    (acc, row) => ({
      total: acc.total + row.split.total,
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
    <div className="rounded-2xl border border-border bg-muted/30 p-3">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-[10px] uppercase tracking-[0.2em]">{label}</span>
      </div>
      <MoneyValue value={formatEUR(value)} className="mt-1 text-xl" />
      {note && <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{note}</p>}
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
    <div className="rounded-2xl border border-border bg-muted/30 p-3">
      <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${danger ? "text-red-500" : ""}`}>{value}</p>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{note}</p>
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
