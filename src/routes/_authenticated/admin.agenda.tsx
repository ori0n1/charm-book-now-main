import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { CalendarDays, ChevronDown, Clock, Euro, Filter, Search, SlidersHorizontal, Users, X } from "lucide-react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PremiumDatePicker } from "@/components/ui/premium-date-picker";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentStudio } from "@/hooks/use-current-studio";
import {
  computeAttendanceRevenue,
  computeFinancialSplit,
  formatAppointmentStatus,
  formatEUR,
  isFinanciallyRelevantAppointment,
  type FinancialRuleSource,
} from "@/lib/utils";
import { sendAppointmentConfirmationForAppointment } from "@/lib/whatsapp.functions";

export const Route = createFileRoute("/_authenticated/admin/agenda")({
  component: AgendaPage,
});

type Appt = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  total_price: number;
  notes: string | null;
  clients: { name: string; phone: string } | null;
  staff: ({ id: string; name: string } & FinancialRuleSource) | null;
  appointment_services?: {
    price: number;
    services: ({ name: string } & FinancialRuleSource) | null;
  }[];
};

type PaidRow = { appointment_id: string | null; amount_cents: number; status: string };
type MessageLog = {
  appointment_id: string | null;
  status: "pending" | "sent" | "failed" | "skipped";
  reason: string | null;
  created_at: string;
};

type AgendaFilters = {
  dateMode: "all" | "today" | "upcoming" | "specific";
  date: string;
  staffId: string;
  service: string;
  status: string;
  client: string;
  payment: "all" | "online" | "studio" | "pending";
  confirmation: "all" | "confirmed" | "unconfirmed";
  attendance: "all" | "attended" | "missed";
};

const EMPTY_FILTERS: AgendaFilters = {
  dateMode: "all",
  date: "",
  staffId: "all",
  service: "all",
  status: "all",
  client: "",
  payment: "all",
  confirmation: "all",
  attendance: "all",
};

function AgendaPage() {
  const { studio } = useCurrentStudio();
  const resendWhatsApp = useServerFn(sendAppointmentConfirmationForAppointment);
  const [appts, setAppts] = useState<Appt[]>([]);
  const [paidRows, setPaidRows] = useState<PaidRow[]>([]);
  const [messageLogs, setMessageLogs] = useState<MessageLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [savingPresenceId, setSavingPresenceId] = useState<string | null>(null);
  const [resendingMessageId, setResendingMessageId] = useState<string | null>(null);
  const [filters, setFilters] = useState<AgendaFilters>(EMPTY_FILTERS);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [showDepositSplit, setShowDepositSplit] = useState(false);

  useEffect(() => {
    setShowDepositSplit(localStorage.getItem("agenda-show-deposit-split") === "true");
  }, []);

  useEffect(() => {
    localStorage.setItem("agenda-show-deposit-split", String(showDepositSplit));
  }, [showDepositSplit]);

  useEffect(() => {
    if (!studio) return;
    (async () => {
      const [{ data }, { data: payments }, { data: logs }] = await Promise.all([
        fetchAgendaAppointments(studio.id),
        supabase
          .from("payment_intents")
          .select("appointment_id,amount_cents,status")
          .eq("studio_id", studio.id),
        (supabase as any)
          .from("whatsapp_message_logs")
          .select("appointment_id,status,reason,created_at")
          .eq("studio_id", studio.id)
          .order("created_at", { ascending: false }),
      ]);
      setAppts((data ?? []) as unknown as Appt[]);
      setPaidRows((payments ?? []) as PaidRow[]);
      setMessageLogs((logs ?? []) as MessageLog[]);
      setLoading(false);
    })();
  }, [studio]);

  const paidByAppointment = new Map<string, number>();
  for (const p of paidRows) {
    if (!p.appointment_id || p.status !== "succeeded") continue;
    paidByAppointment.set(
      p.appointment_id,
      (paidByAppointment.get(p.appointment_id) ?? 0) + p.amount_cents / 100,
    );
  }
  const latestMessageByAppointment = new Map<string, MessageLog>();
  for (const log of messageLogs) {
    if (!log.appointment_id || latestMessageByAppointment.has(log.appointment_id)) continue;
    latestMessageByAppointment.set(log.appointment_id, log);
  }

  const filterOptions = buildFilterOptions(appts);
  const activeFilterCount = countActiveFilters(filters);
  const filteredAppts = appts.filter((a) => appointmentMatchesFilters(a, filters, paidByAppointment));

  const groups = filteredAppts.reduce<Record<string, Appt[]>>((acc, a) => {
    const key = new Date(a.starts_at).toLocaleDateString("pt-PT", {
      weekday: "long",
      day: "2-digit",
      month: "long",
    });
    (acc[key] ??= []).push(a);
    return acc;
  }, {});

  const todayCount = filteredAppts.filter(
    (a) => new Date(a.starts_at).toDateString() === new Date().toDateString(),
  ).length;
  const futureCount = filteredAppts.filter((a) => new Date(a.starts_at).getTime() >= Date.now()).length;
  const totalValue = filteredAppts.reduce((sum, a) => {
    const paidAmount = paidByAppointment.get(a.id) ?? 0;
    if (!isFinanciallyRelevantAppointment(a.status, paidAmount)) return sum;
    return sum + computeAttendanceRevenue(a.total_price, paidAmount, a.status).confirmed;
  }, 0);

  function updateFilter<K extends keyof AgendaFilters>(key: K, value: AgendaFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function resetFilters() {
    setFilters(EMPTY_FILTERS);
    setMobileFiltersOpen(false);
  }

  async function markPresence(appointment: Appt, nextStatus: "completed" | "no_show") {
    if (!studio) return;
    setSavingPresenceId(appointment.id);
    const { error } = await supabase
      .from("appointments")
      .update({ status: nextStatus, updated_at: new Date().toISOString() } as any)
      .eq("id", appointment.id)
      .eq("studio_id", studio.id);
    setSavingPresenceId(null);

    if (error) {
      toast.error(error.message);
      return;
    }

    setAppts((current) =>
      current.map((item) => (item.id === appointment.id ? { ...item, status: nextStatus } : item)),
    );
    toast.success(nextStatus === "completed" ? "Atendimento confirmado." : "Falta registada.");
  }

  async function resendMessage(appointment: Appt) {
    setResendingMessageId(appointment.id);
    try {
      const log = (await resendWhatsApp({ data: { appointmentId: appointment.id } })) as MessageLog | null;
      if (log) setMessageLogs((current) => [log, ...current]);
      toast.success("Envio de WhatsApp atualizado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível reenviar.");
    } finally {
      setResendingMessageId(null);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">A carregar...</p>;

  return (
    <div className="space-y-4 md:space-y-6">
      <header className="rounded-2xl border border-border bg-card p-4 shadow-sm md:p-6">
        <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Agenda</p>
        <h1 className="mt-2 text-2xl font-light tracking-tight md:text-3xl">Marcações</h1>
        <p className="mt-2 hidden max-w-2xl text-sm leading-relaxed text-muted-foreground md:block">
          Consulte marcações, clientes, horários e repartição financeira de forma simples.
        </p>
        {studio && (
          <p className="mt-3 hidden text-xs text-muted-foreground md:block">
            Divisão padrão: estúdio{" "}
            <span className="font-mono font-semibold text-muted-foreground">
              {studio.commission_percent}%
            </span>{" "}
            · equipa {100 - studio.commission_percent}%
          </p>
        )}
      </header>

      <section className="rounded-2xl border border-border bg-card p-3 shadow-sm md:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid size-8 place-items-center rounded-xl bg-muted text-muted-foreground">
              <SlidersHorizontal className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">Filtros da agenda</p>
              <p className="truncate text-xs text-muted-foreground">
                {activeFilterCount > 0
                  ? `${activeFilterCount} filtro${activeFilterCount === 1 ? "" : "s"} ativo${activeFilterCount === 1 ? "" : "s"}`
                  : "Mostrando todas as marcações"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={resetFilters}
                className="hidden h-9 items-center rounded-full border border-border px-3 text-xs font-bold text-muted-foreground transition hover:bg-muted hover:text-foreground md:inline-flex"
              >
                Limpar filtros
              </button>
            )}
            <button
              type="button"
              onClick={() => setMobileFiltersOpen(true)}
              className="inline-flex h-9 items-center gap-2 rounded-full bg-foreground px-3 text-xs font-bold text-background shadow-sm transition hover:opacity-90 md:hidden"
            >
              <Filter className="h-3.5 w-3.5" />
              Filtrar
              {activeFilterCount > 0 && (
                <span className="grid size-5 place-items-center rounded-full bg-background/15 text-[10px]">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>
        </div>

        <QuickFilterChips
          filters={filters}
          setFilters={setFilters}
          resetFilters={resetFilters}
          activeFilterCount={activeFilterCount}
        />

        <div className="mt-4 hidden md:block">
          <AgendaFilterFields filters={filters} options={filterOptions} onChange={updateFilter} />
        </div>
      </section>

      {mobileFiltersOpen && (
        <div className="fixed inset-0 z-50 bg-background/45 backdrop-blur-sm md:hidden">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Fechar filtros"
            onClick={() => setMobileFiltersOpen(false)}
          />
          <div className="absolute inset-x-3 bottom-3 max-h-[82vh] overflow-hidden rounded-[1.35rem] border border-border bg-card shadow-2xl shadow-black/35">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Filtros</p>
                <p className="text-sm font-semibold">Organizar agenda</p>
              </div>
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(false)}
                className="grid size-9 place-items-center rounded-2xl border border-border bg-background text-muted-foreground"
                aria-label="Fechar filtros"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[calc(82vh-8rem)] overflow-y-auto px-4 py-4">
              <AgendaFilterFields filters={filters} options={filterOptions} onChange={updateFilter} mobile />
            </div>
            <div className="grid grid-cols-2 gap-2 border-t border-border p-3">
              <button
                type="button"
                onClick={resetFilters}
                className="h-11 rounded-2xl border border-border text-xs font-bold uppercase tracking-wide text-muted-foreground"
              >
                Limpar
              </button>
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(false)}
                className="h-11 rounded-2xl bg-foreground text-xs font-bold uppercase tracking-wide text-background"
              >
                Aplicar
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <AgendaMetric icon={<CalendarDays className="h-4 w-4" />} label="Hoje" value={todayCount} />
        <AgendaMetric icon={<Clock className="h-4 w-4" />} label="Futuras" value={futureCount} />
        <div className="hidden lg:block">
          <AgendaMetric icon={<Users className="h-4 w-4" />} label="Visíveis" value={filteredAppts.length} />
        </div>
        <div className="hidden lg:block">
          <AgendaMetric
            icon={<Euro className="h-4 w-4" />}
            label="Valor"
            value={formatEUR(totalValue)}
            money
          />
        </div>
      </section>

      {appts.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-card px-4 py-12 text-center shadow-sm">
          <p className="text-sm font-medium">Ainda não existem marcações.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Assim que uma cliente marcar online, a reserva aparece aqui.
          </p>
        </div>
      )}

      {appts.length > 0 && filteredAppts.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-card px-4 py-12 text-center shadow-sm">
          <p className="text-sm font-medium">Nenhuma marcação encontrada.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Ajuste os filtros ou limpe a pesquisa para voltar a ver a agenda.
          </p>
          <button
            type="button"
            onClick={resetFilters}
            className="mt-4 h-10 rounded-full bg-foreground px-4 text-xs font-bold uppercase tracking-wide text-background"
          >
            Limpar filtros
          </button>
        </div>
      )}

      {Object.entries(groups).map(([day, list]) => (
        <section
          key={day}
          className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/25 px-4 py-3">
            <h2 className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground md:text-xs md:tracking-[0.2em]">
              {day}
            </h2>
            <span className="rounded-full bg-background px-3 py-1 text-[11px] text-muted-foreground">
              {list.length} {list.length === 1 ? "marcação" : "marcações"}
            </span>
          </div>
          <div className="space-y-2 p-3">
            {list.map((a) => {
              const isOpen = expandedId === a.id;
              const paidAmount = paidByAppointment.get(a.id) ?? 0;
              const split = computeAppointmentSplit(a, studio, paidAmount);
              const revenue = computeAttendanceRevenue(a.total_price, paidAmount, a.status);
              const paymentLabel = formatPaymentState(a, paidAmount);
              const messageState = formatMessageState(
                a,
                paidAmount,
                latestMessageByAppointment.get(a.id),
              );
              const canConfirmPresence = revenue.isOnlinePaid && a.status !== "cancelled";
              const canResendMessage = messageState?.tone === "danger";
              const missed = a.status === "no_show";
              return (
                <article
                  key={a.id}
                  className={`rounded-2xl border bg-background/70 p-3 transition hover:shadow-sm ${
                    missed
                      ? "border-red-500/35 hover:border-red-500/45"
                      : "border-border hover:border-foreground/20"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setExpandedId(isOpen ? null : a.id)}
                    className="grid w-full gap-3 text-left sm:grid-cols-[1fr_auto] sm:items-center"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <div
                        className={`grid size-10 shrink-0 place-items-center rounded-2xl text-xs font-semibold ${
                          missed
                            ? "bg-red-500/10 text-red-700 dark:text-red-300"
                            : "bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"
                        }`}
                      >
                        {new Date(a.starts_at).toLocaleTimeString("pt-PT", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{a.clients?.name ?? "-"}</p>
                        <p
                          className={`mt-1 truncate text-xs ${
                            missed ? "text-red-700/85 dark:text-red-300/85" : "text-muted-foreground"
                          }`}
                        >
                          {new Date(a.starts_at).toLocaleTimeString("pt-PT", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {" - "}
                          {new Date(a.ends_at).toLocaleTimeString("pt-PT", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {" · "}
                          {a.staff?.name ?? "-"}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <StatusPill danger={missed}>{formatAppointmentStatus(a.status)}</StatusPill>
                          <span className="hidden md:inline-flex">
                            <StatusPill muted danger={missed}>
                              {paymentLabel}
                            </StatusPill>
                          </span>
                          {messageState && (
                            <StatusPill
                              muted={messageState.tone === "muted"}
                              danger={messageState.tone === "danger"}
                            >
                              {messageState.label}
                            </StatusPill>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-3">
                      <div className="text-right">
                        <MoneyText
                          value={formatEUR(split.confirmed)}
                          className={`hidden md:block ${missed ? "text-red-700 dark:text-red-300" : ""}`}
                        />
                        <p
                          className={`hidden text-[10px] uppercase tracking-wide md:block ${
                            missed ? "text-red-700/80 dark:text-red-300/80" : "text-muted-foreground"
                          }`}
                        >
                          {missed ? "faltou" : "confirmado"}
                        </p>
                      </div>
                      <ChevronDown
                        className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
                      />
                    </div>
                  </button>

                  {a.notes && (
                    <p className="mt-2 text-xs italic text-muted-foreground">"{a.notes}"</p>
                  )}

                  {isOpen && (
                    <div
                      className={`mt-3 rounded-2xl border p-4 ${
                        missed
                          ? "border-red-500/25 bg-red-500/5"
                          : "border-emerald-700/20 bg-emerald-950/5"
                      }`}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                            Repartição financeira automática
                          </p>
                          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                            A divisão é calculada sobre o valor total do serviço. O sinal mostra apenas
                            o que já foi recebido online.
                          </p>
                        </div>
                        <label className="flex shrink-0 items-center gap-2 rounded-2xl border border-border bg-background/60 px-3 py-2 text-[11px] font-semibold text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={showDepositSplit}
                            onChange={(event) => setShowDepositSplit(event.target.checked)}
                            className="h-3.5 w-3.5 accent-emerald-600"
                          />
                          Mostrar divisão do sinal
                        </label>
                      </div>
                      <p className="hidden text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                        Repartição financeira automática
                      </p>
                      <div className="mt-4 grid gap-2 md:grid-cols-4">
                        <FinancialMetricCard label="Valor total" value={formatEUR(split.serviceTotal)} featured />
                        <FinancialMetricCard label="Recebido online" value={formatEUR(split.received)} />
                        <FinancialMetricCard label="Restante no estúdio" value={formatEUR(split.pending)} />
                        <FinancialMetricCard
                          label={a.status === "completed" ? "Faturamento confirmado" : "Ainda pendente"}
                          value={formatEUR(split.confirmed)}
                          muted={a.status !== "completed"}
                        />
                      </div>
                      <dl className="mt-3 hidden gap-2 text-xs sm:grid-cols-2">
                        <Row label="Valor confirmado" value={formatEUR(split.confirmed)} />
                        <Row label="Sinal recebido" value={formatEUR(split.received)} muted />
                        <Row
                          label="Valor previsto"
                          value={formatEUR(split.predicted)}
                          muted
                        />
                        <Row label="Parte do estúdio" value={formatEUR(split.studio)} strong />
                        <Row
                          label="Parte da profissional"
                          value={formatEUR(split.professional)}
                          strong
                        />
                        <Row
                          label="Pagamento online"
                          value={formatEUR(split.received)}
                          muted
                        />
                        <Row label="Total do serviço" value={formatEUR(split.serviceTotal)} muted />
                        <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground sm:col-span-2">
                          Em agendamentos online, o restante só entra no faturamento depois de
                          confirmar que a cliente compareceu.
                        </p>
                      </dl>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        <FinancialMetricCard
                          label="Estúdio recebe"
                          value={formatEUR(split.studio)}
                          detail={`${split.commissionPercent}% do serviço total`}
                          featured
                        />
                        <FinancialMetricCard
                          label="Profissional recebe"
                          value={formatEUR(split.professional)}
                          detail={`${100 - split.commissionPercent}% do serviço total`}
                          featured
                        />
                      </div>
                      {showDepositSplit && split.received > 0 && (
                        <div className="mt-3 grid gap-2 md:grid-cols-2">
                          <FinancialMetricCard
                            label="Sinal: estúdio"
                            value={formatEUR(split.signalStudio)}
                            detail="Apenas referência do sinal recebido"
                            muted
                          />
                          <FinancialMetricCard
                            label="Sinal: profissional"
                            value={formatEUR(split.signalProfessional)}
                            detail="Apenas referência do sinal recebido"
                            muted
                          />
                        </div>
                      )}
                      <div className="mt-4 grid gap-2 text-xs md:grid-cols-3">
                        <FlowStep title="Sinal recebido online" value={formatEUR(split.received)} />
                        <FlowStep title="Restante pago no estúdio" value={formatEUR(split.pending)} />
                        <FlowStep
                          title="Divisão após presença"
                          value={a.status === "completed" ? "Confirmada" : missed ? "Sinal mantido" : "Pendente"}
                        />
                      </div>
                      {canConfirmPresence && (
                        <div className={`mt-4 grid gap-2 ${canResendMessage ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
                          <PresenceButton
                            active={a.status === "completed"}
                            disabled={savingPresenceId === a.id}
                            onClick={() => markPresence(a, "completed")}
                          >
                            Cliente compareceu
                          </PresenceButton>
                          <PresenceButton
                            active={a.status === "no_show"}
                            danger
                            disabled={savingPresenceId === a.id}
                            onClick={() => markPresence(a, "no_show")}
                          >
                            Cliente não compareceu
                          </PresenceButton>
                          {canResendMessage && (
                            <PresenceButton
                              active={false}
                              whatsapp
                              disabled={resendingMessageId === a.id}
                              onClick={() => resendMessage(a)}
                            >
                              {resendingMessageId === a.id ? "A reenviar..." : "Reenviar WhatsApp"}
                            </PresenceButton>
                          )}
                        </div>
                      )}
                      {!canConfirmPresence && a.status !== "cancelled" && (
                        <p className="mt-4 rounded-2xl border border-border bg-background/65 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                          Agendamento presencial: a presença não altera o faturamento e continua a
                          funcionar como já estava.
                        </p>
                      )}
                      {canResendMessage && !canConfirmPresence && (
                        <div className="mt-4 grid gap-2 sm:grid-cols-3">
                          <PresenceButton
                            active={false}
                            whatsapp
                            disabled={resendingMessageId === a.id}
                            onClick={() => resendMessage(a)}
                          >
                            {resendingMessageId === a.id ? "A reenviar..." : "Reenviar WhatsApp"}
                          </PresenceButton>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function buildFilterOptions(appts: Appt[]) {
  const professionals = new Map<string, string>();
  const services = new Set<string>();
  const statuses = new Set<string>();

  for (const appointment of appts) {
    if (appointment.staff?.id) professionals.set(appointment.staff.id, appointment.staff.name);
    appointment.appointment_services?.forEach((line) => {
      if (line.services?.name) services.add(line.services.name);
    });
    if (appointment.status) statuses.add(appointment.status);
  }

  return {
    professionals: Array.from(professionals.entries()).sort((a, b) => a[1].localeCompare(b[1])),
    services: Array.from(services).sort((a, b) => a.localeCompare(b)),
    statuses: Array.from(statuses).sort((a, b) =>
      formatAppointmentStatus(a).localeCompare(formatAppointmentStatus(b)),
    ),
  };
}

function appointmentMatchesFilters(
  appointment: Appt,
  filters: AgendaFilters,
  paidByAppointment: Map<string, number>,
) {
  const start = new Date(appointment.starts_at);
  const now = new Date();
  const paidAmount = paidByAppointment.get(appointment.id) ?? 0;
  const serviceNames = appointment.appointment_services
    ?.map((line) => line.services?.name)
    .filter(Boolean) as string[] | undefined;

  if (filters.dateMode === "today" && start.toDateString() !== now.toDateString()) return false;
  if (filters.dateMode === "upcoming" && start.getTime() < now.getTime()) return false;
  if (filters.dateMode === "specific" && filters.date) {
    if (toDateInputValue(start) !== filters.date) return false;
  }
  if (filters.staffId !== "all" && appointment.staff?.id !== filters.staffId) return false;
  if (filters.service !== "all" && !serviceNames?.includes(filters.service)) return false;
  if (filters.status !== "all" && appointment.status !== filters.status) return false;
  if (filters.client.trim()) {
    const query = normalizeFilterText(filters.client);
    const haystack = normalizeFilterText(
      `${appointment.clients?.name ?? ""} ${appointment.clients?.phone ?? ""}`,
    );
    if (!haystack.includes(query)) return false;
  }
  if (filters.payment === "online" && paidAmount <= 0) return false;
  if (filters.payment === "studio" && paidAmount > 0) return false;
  if (filters.payment === "pending" && appointment.status !== "pending_payment") return false;
  if (filters.confirmation === "confirmed" && !["confirmed", "completed"].includes(appointment.status)) {
    return false;
  }
  if (filters.confirmation === "unconfirmed" && ["confirmed", "completed"].includes(appointment.status)) {
    return false;
  }
  if (filters.attendance === "attended" && appointment.status !== "completed") return false;
  if (filters.attendance === "missed" && appointment.status !== "no_show") return false;

  return true;
}

function countActiveFilters(filters: AgendaFilters) {
  return [
    filters.dateMode !== "all",
    filters.dateMode === "specific" && !!filters.date,
    filters.staffId !== "all",
    filters.service !== "all",
    filters.status !== "all",
    !!filters.client.trim(),
    filters.payment !== "all",
    filters.confirmation !== "all",
    filters.attendance !== "all",
  ].filter(Boolean).length;
}

function QuickFilterChips({
  filters,
  setFilters,
  resetFilters,
  activeFilterCount,
}: {
  filters: AgendaFilters;
  setFilters: React.Dispatch<React.SetStateAction<AgendaFilters>>;
  resetFilters: () => void;
  activeFilterCount: number;
}) {
  const chips = [
    {
      label: "Hoje",
      active: filters.dateMode === "today",
      onClick: () => setFilters((current) => ({ ...current, dateMode: "today", date: "" })),
    },
    {
      label: "Próximos",
      active: filters.dateMode === "upcoming",
      onClick: () => setFilters((current) => ({ ...current, dateMode: "upcoming", date: "" })),
    },
    {
      label: "Cancelados",
      active: filters.status === "cancelled",
      onClick: () => setFilters((current) => ({ ...current, status: "cancelled" })),
    },
    {
      label: "Compareceu",
      active: filters.attendance === "attended",
      onClick: () => setFilters((current) => ({ ...current, attendance: "attended" })),
    },
    {
      label: "Faltou",
      active: filters.attendance === "missed",
      onClick: () => setFilters((current) => ({ ...current, attendance: "missed" })),
    },
  ];

  return (
    <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] md:flex-wrap md:overflow-visible md:pb-0 [&::-webkit-scrollbar]:hidden">
      {chips.map((chip) => (
        <button
          key={chip.label}
          type="button"
          onClick={chip.onClick}
          className={`h-8 shrink-0 rounded-full border px-3 text-xs font-bold transition ${
            chip.active
              ? "border-foreground bg-foreground text-background shadow-sm"
              : "border-border bg-background/70 text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          {chip.label}
        </button>
      ))}
      {activeFilterCount > 0 && (
        <button
          type="button"
          onClick={resetFilters}
          className="h-8 shrink-0 rounded-full border border-border px-3 text-xs font-bold text-muted-foreground transition hover:bg-muted hover:text-foreground md:hidden"
        >
          Limpar
        </button>
      )}
    </div>
  );
}

function AgendaFilterFields({
  filters,
  options,
  onChange,
  mobile,
}: {
  filters: AgendaFilters;
  options: ReturnType<typeof buildFilterOptions>;
  onChange: <K extends keyof AgendaFilters>(key: K, value: AgendaFilters[K]) => void;
  mobile?: boolean;
}) {
  return (
    <div className={`grid gap-3 ${mobile ? "" : "md:grid-cols-2 xl:grid-cols-4"}`}>
      <FilterField label="Data">
        <PremiumFilterSelect
          value={filters.dateMode}
          onValueChange={(nextValue) => {
            const value = nextValue as AgendaFilters["dateMode"];
            onChange("dateMode", value);
            if (value !== "specific") onChange("date", "");
          }}
          options={[
            ["all", "Todas as datas"],
            ["today", "Agendamentos do dia"],
            ["upcoming", "Próximos agendamentos"],
            ["specific", "Escolher data"],
          ]}
        />
      </FilterField>

      <FilterField label="Dia específico">
        <DateFilterPicker
          value={filters.date}
          onChange={(value) => {
            onChange("date", value);
            onChange("dateMode", value ? "specific" : "all");
          }}
        />
      </FilterField>

      <FilterField label="Profissional">
        <PremiumFilterSelect
          value={filters.staffId}
          onValueChange={(value) => onChange("staffId", value)}
          options={[["all", "Todos"], ...options.professionals]}
        />
      </FilterField>

      <FilterField label="Serviço">
        <PremiumFilterSelect
          value={filters.service}
          onValueChange={(value) => onChange("service", value)}
          options={[["all", "Todos"], ...options.services.map((service) => [service, service] as [string, string])]}
        />
      </FilterField>

      <FilterField label="Status">
        <PremiumFilterSelect
          value={filters.status}
          onValueChange={(value) => onChange("status", value)}
          options={[
            ["all", "Todos"],
            ...options.statuses.map((status) => [status, formatAppointmentStatus(status)] as [string, string]),
            ...(!options.statuses.includes("cancelled") ? [["cancelled", "Cancelado"] as [string, string]] : []),
          ]}
        />
      </FilterField>

      <FilterField label="Cliente">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={filters.client}
            onChange={(event) => onChange("client", event.target.value)}
            placeholder="Nome ou telefone"
            className={`${filterControlClass} pl-9`}
          />
        </div>
      </FilterField>

      <FilterField label="Pagamento">
        <PremiumFilterSelect
          value={filters.payment}
          onValueChange={(value) => onChange("payment", value as AgendaFilters["payment"])}
          options={[
            ["all", "Todas as formas"],
            ["online", "Pagamento online"],
            ["studio", "Pagamento no estúdio"],
            ["pending", "A aguardar sinal"],
          ]}
        />
      </FilterField>

      <FilterField label="Confirmação">
        <PremiumFilterSelect
          value={filters.confirmation}
          onValueChange={(value) => onChange("confirmation", value as AgendaFilters["confirmation"])}
          options={[
            ["all", "Todos"],
            ["confirmed", "Confirmados"],
            ["unconfirmed", "Não confirmados"],
          ]}
        />
      </FilterField>

      <FilterField label="Presença">
        <PremiumFilterSelect
          value={filters.attendance}
          onValueChange={(value) => onChange("attendance", value as AgendaFilters["attendance"])}
          options={[
            ["all", "Todos"],
            ["attended", "Compareceu"],
            ["missed", "Faltou"],
          ]}
        />
      </FilterField>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function DateFilterPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <PremiumDatePicker
      value={value}
      onChange={onChange}
      placeholder="Escolher data"
      className="h-10 bg-background/70"
    />
  );
}

function PremiumFilterSelect({
  value,
  onValueChange,
  options,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: [string, string][];
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="h-10 rounded-2xl border-border bg-background/70 px-3 text-sm shadow-none hover:bg-background focus:ring-2 focus:ring-foreground/10">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="rounded-3xl border-border/80 bg-popover/98 shadow-2xl shadow-black/10">
        {options.map(([optionValue, label]) => (
          <SelectItem key={optionValue} value={optionValue}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const filterControlClass =
  "h-10 w-full rounded-2xl border border-border bg-background/70 px-3 text-sm outline-none transition hover:bg-background focus:border-foreground/30 focus:ring-2 focus:ring-foreground/10";

function normalizeFilterText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateOnly(value: string) {
  if (!value) return "";
  return new Date(`${value}T12:00`).toLocaleDateString("pt-PT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

async function fetchAgendaAppointments(studioId: string) {
  const full = await supabase
    .from("appointments")
    .select(
      "id,starts_at,ends_at,status,total_price,notes,clients(name,phone),staff(id,name,commission_percent,deposit_recipient,deposit_professional_percent),appointment_services(price,services(name,commission_percent,deposit_recipient,deposit_professional_percent))",
    )
    .eq("studio_id", studioId)
    .order("starts_at", { ascending: false })
    .limit(100);
  if (!full.error) return full;

  return supabase
    .from("appointments")
    .select(
      "id,starts_at,ends_at,status,total_price,notes,clients(name,phone),staff(id,name),appointment_services(price,services(name))",
    )
    .eq("studio_id", studioId)
    .order("starts_at", { ascending: false })
    .limit(100);
}

function computeAppointmentSplit(
  a: Appt,
  studio: (FinancialRuleSource & { deposit_percent: number; payment_policy: string }) | null,
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
        rule?.commission_percent ?? a.staff?.commission_percent ?? studio?.commission_percent ?? 0;
      const linePaid =
        Number(a.total_price) > 0 ? (paidAmount * Number(line.price)) / Number(a.total_price) : 0;
      const lineTotal = Number(line.price);
      const lineConfirmed =
        Number(a.total_price) > 0 ? (revenue.confirmed * lineTotal) / Number(a.total_price) : lineTotal;
      const linePredicted =
        Number(a.total_price) > 0 ? (revenue.predicted * lineTotal) / Number(a.total_price) : 0;
      const finalSplit = computeFinancialSplit(lineTotal, studioPercent, {
        depositPercent: studio?.deposit_percent ?? 0,
        requiresDeposit: false,
        receivedAmount: linePaid,
      });
      const signalSplit = computeFinancialSplit(linePaid, studioPercent, {
        depositPercent: studio?.deposit_percent ?? 0,
        requiresDeposit: false,
        receivedAmount: linePaid,
      });
      return {
        total: acc.total + lineTotal,
        serviceTotal: acc.serviceTotal + lineTotal,
        confirmed: acc.confirmed + lineConfirmed,
        predicted: acc.predicted + linePredicted,
        deposit: acc.deposit + signalSplit.deposit,
        remaining: acc.remaining + linePredicted,
        commissionBase: acc.commissionBase + finalSplit.commissionBase,
        commission: acc.commission + finalSplit.commission,
        professional: acc.professional + finalSplit.professional,
        studio: acc.studio + finalSplit.studio,
        signalProfessional: acc.signalProfessional + signalSplit.professional,
        signalStudio: acc.signalStudio + signalSplit.studio,
        received: acc.received + Math.min(lineTotal, Math.max(0, linePaid)),
        pending: acc.pending + linePredicted,
        commissionPercent: studioPercent,
        depositProfessionalPercent: 0,
      };
    },
    {
      total: 0,
      serviceTotal: 0,
      confirmed: 0,
      predicted: 0,
      deposit: 0,
      remaining: 0,
      commissionBase: 0,
      commission: 0,
      professional: 0,
      studio: 0,
      signalProfessional: 0,
      signalStudio: 0,
      received: 0,
      pending: 0,
      commissionPercent: 0,
      depositProfessionalPercent: 0,
    },
  );
}

function formatPaymentState(a: Appt, paidAmount: number) {
  if (paidAmount > 0) {
    if (a.status === "completed") return "Online + atendimento realizado";
    if (a.status === "no_show") return "Sinal mantido";
    return "Sinal recebido · valor previsto";
  }
  if (a.status === "cancelled" || a.status === "no_show") return "Sem pagamento confirmado";
  return "Pagamento no estúdio";
}

function formatMessageState(a: Appt, paidAmount: number, log?: MessageLog) {
  if (paidAmount <= 0 && a.status === "pending_payment") {
    return { label: "Aguardando confirmacao do sinal", tone: "muted" as const };
  }
  if (!a.clients?.phone || !normalizePhoneForDisplay(a.clients.phone)) {
    return { label: "Telefone invalido", tone: "danger" as const };
  }
  if (!log) return { label: "WhatsApp pendente", tone: "muted" as const };
  if (log.status === "sent") return { label: "Mensagem enviada", tone: "success" as const };
  if (log.status === "failed" && log.reason?.includes("63015")) {
    return { label: "Cliente fora do Sandbox", tone: "danger" as const };
  }
  if (log.status === "failed") return { label: "Falha no envio", tone: "danger" as const };
  if (log.status === "skipped" && log.reason === "invalid_phone") {
    return { label: "Telefone invalido", tone: "danger" as const };
  }
  if (log.status === "skipped" && log.reason === "auto_send_disabled") {
    return { label: "Envio desligado", tone: "muted" as const };
  }
  return { label: "Aguardando envio", tone: "muted" as const };
}

function normalizePhoneForDisplay(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 9;
}

function Row({
  label,
  value,
  muted,
  strong,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-xl bg-background/65 px-3 py-2 ${muted ? "text-muted-foreground" : ""}`}
    >
      <dt className={strong ? "text-foreground" : undefined}>{label}</dt>
      <dd
        className={`font-mono ${strong ? "font-semibold text-emerald-700 dark:text-emerald-400" : "text-emerald-700/90 dark:text-emerald-400/90"}`}
      >
        {value}
      </dd>
    </div>
  );
}

function AgendaMetric({
  icon,
  label,
  value,
  money,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  money?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="grid size-8 place-items-center rounded-xl bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
          {icon}
        </span>
        <span className="text-[10px] uppercase tracking-[0.2em]">{label}</span>
      </div>
      <p
        className={`mt-3 text-2xl font-semibold tracking-tight ${
          money ? "text-emerald-700 dark:text-emerald-400" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function StatusPill({
  children,
  muted,
  danger,
}: {
  children: React.ReactNode;
  muted?: boolean;
  danger?: boolean;
}) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wide ${
        danger
          ? "bg-red-500/10 text-red-700 dark:text-red-300"
          : muted
            ? "bg-muted text-muted-foreground"
            : "bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"
      }`}
    >
      {children}
    </span>
  );
}

function FinancialMetricCard({
  label,
  value,
  detail,
  featured,
  muted,
}: {
  label: string;
  value: string;
  detail?: string;
  featured?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border px-3 py-3 ${
        featured
          ? "border-emerald-700/25 bg-emerald-950/5 dark:bg-emerald-400/[0.06]"
          : "border-border/70 bg-background/65"
      }`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <MoneyText value={value} className={`mt-2 text-base ${muted ? "opacity-80" : ""}`} />
      {detail && <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{detail}</p>}
    </div>
  );
}

function FlowStep({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/55 px-3 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {title}
      </p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}

function PresenceButton({
  children,
  active,
  danger,
  whatsapp,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  danger?: boolean;
  whatsapp?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex h-11 w-full items-center justify-center gap-2 rounded-2xl border px-3 text-center text-[11px] font-bold uppercase leading-tight tracking-[0.08em] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-wait disabled:opacity-60 sm:text-xs ${
        active
          ? danger
            ? "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
            : "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
          : whatsapp
            ? "border-emerald-500/25 bg-emerald-600/10 text-emerald-700 shadow-sm hover:border-emerald-600/35 hover:bg-emerald-600/15 dark:text-emerald-300"
            : "border-border bg-background/70 text-muted-foreground shadow-sm hover:border-foreground/15 hover:bg-muted hover:text-foreground"
      }`}
    >
      {whatsapp && <WhatsAppIcon className="h-4 w-4 shrink-0" />}
      {children}
    </button>
  );
}

function WhatsAppIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M20.52 3.49A11.82 11.82 0 0 0 12.1 0C5.55 0 .22 5.33.22 11.88c0 2.09.55 4.14 1.6 5.94L.12 24l6.32-1.66a11.9 11.9 0 0 0 5.66 1.44h.01c6.55 0 11.88-5.33 11.88-11.88 0-3.17-1.23-6.15-3.47-8.41Zm-8.42 18.3h-.01a9.86 9.86 0 0 1-5.03-1.38l-.36-.21-3.75.98 1-3.65-.24-.38a9.85 9.85 0 0 1-1.51-5.27c0-5.46 4.44-9.9 9.9-9.9 2.65 0 5.13 1.03 7 2.9a9.82 9.82 0 0 1 2.9 7c0 5.46-4.44 9.91-9.9 9.91Zm5.43-7.42c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.06 2.87 1.21 3.07c.15.2 2.09 3.19 5.06 4.47.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2-1.41.25-.69.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35Z" />
    </svg>
  );
}

function MoneyText({ value, className = "" }: { value: string; className?: string }) {
  return (
    <p
      className={`font-mono text-sm font-semibold text-emerald-700 dark:text-emerald-400 ${className}`}
    >
      {value}
    </p>
  );
}
