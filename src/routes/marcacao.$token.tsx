import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CalendarDays, CheckCircle2, Clock, Loader2, MessageCircle, RefreshCcw, ShieldCheck, XCircle } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  cancelClientAppointment,
  getClientAppointment,
  getClientRescheduleSlots,
  logClientAppointmentAction,
  requestClientRefund,
  rescheduleClientAppointment,
} from "@/lib/client-appointment.functions";
import { formatStudioDate, formatStudioDateTime, formatStudioTimeRange } from "@/lib/studio-time";

export const Route = createFileRoute("/marcacao/$token")({
  head: () => ({ meta: [{ title: "Detalhes da marcação" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    acao: typeof search.acao === "string" ? search.acao : undefined,
  }),
  component: ClientAppointmentPage,
});

type AppointmentView = {
  status: string;
  startsAt: string;
  endsAt: string;
  totalPrice: number;
  clientName: string;
  studioName: string;
  studioSlug: string;
  studioTimezone: string;
  studioPhone: string;
  staffName: string;
  services: { name: string; price: number; durationMin: number }[];
  paidAmount: number;
  refundRequest: { id: string; status: string; created_at: string } | null;
  cancellationText: string | null;
  policy: {
    noticeHours: number;
    rescheduleNoticeHours: number;
    deadlineAt: string;
    rescheduleDeadlineAt: string;
    createdAt: string | null;
    nowAt: string;
    beforeDeadline: boolean;
    beforeRescheduleDeadline: boolean;
    createdAfterDeadline: boolean;
    createdAfterRescheduleDeadline: boolean;
    happened: boolean;
    cancelled: boolean;
    refundable: boolean;
    canCancel: boolean;
    canReschedule: boolean;
    canRequestRefund: boolean;
    blockReason: string;
    rescheduleBlockReason: string;
    refundBlockReason: string;
    refundPolicy: string;
    statusReason: "available" | "created_after_deadline" | "deadline_expired" | "happened" | "cancelled";
    rescheduleStatusReason: "available" | "created_after_deadline" | "deadline_expired" | "happened" | "cancelled";
    manageabilityText: string;
    rescheduleManageabilityText: string;
    deadlineText: string;
    rescheduleDeadlineText: string;
  };
};

type RescheduleSlot = { staffId: string; startsAt: string; label: string };

function ClientAppointmentPage() {
  const { token } = Route.useParams();
  const search = Route.useSearch();
  const loadAppointment = useServerFn(getClientAppointment);
  const cancelAppointment = useServerFn(cancelClientAppointment);
  const logAction = useServerFn(logClientAppointmentAction);
  const loadSlots = useServerFn(getClientRescheduleSlots);
  const rescheduleAppointment = useServerFn(rescheduleClientAppointment);
  const requestRefund = useServerFn(requestClientRefund);
  const [appointment, setAppointment] = useState<AppointmentView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [panel, setPanel] = useState<"" | "reschedule" | "cancel">("");
  const [rescheduleDate, setRescheduleDate] = useState(() => formatInputDate(new Date(Date.now() + 24 * 60 * 60 * 1000)));
  const [slots, setSlots] = useState<RescheduleSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setAppointment((await loadAppointment({ data: { token } })) as AppointmentView);
    } catch {
      setAppointment(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [token]);

  useEffect(() => {
    if (search.acao === "remarcar") {
      setPanel("reschedule");
      void logAction({ data: { token, action: "reschedule_open" } });
    } else if (search.acao === "cancelar") {
      setPanel("cancel");
      void logAction({ data: { token, action: "cancel_open" } });
    } else if (search.acao === "contactar") {
      void logAction({ data: { token, action: "contact_whatsapp" } });
      window.setTimeout(() => document.getElementById("contact-studio-link")?.click(), 250);
    }
  }, [search.acao, token]);

  useEffect(() => {
    if (panel !== "reschedule" || !appointment?.policy.canReschedule) return;
    let cancelled = false;
    setSlotsLoading(true);
    loadSlots({ data: { token, date: rescheduleDate } })
      .then((result) => {
        if (!cancelled) setSlots(((result as any).slots ?? []) as RescheduleSlot[]);
      })
      .catch((error) => {
        if (!cancelled) {
          setSlots([]);
          toast.error(error instanceof Error ? error.message : "Não foi possível carregar horários.");
        }
      })
      .finally(() => {
        if (!cancelled) setSlotsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [panel, appointment?.policy.canReschedule, rescheduleDate, token]);

  const serviceLabel = useMemo(
    () => appointment?.services.map((service) => service.name).join(", ") || "Serviço",
    [appointment],
  );

  async function onCancel() {
    if (!appointment || busy) return;
    setBusy("cancel");
    try {
      setAppointment((await cancelAppointment({ data: { token } })) as AppointmentView);
      toast.success("Marcação cancelada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível cancelar.");
    } finally {
      setBusy("");
    }
  }

  async function onReschedule(slot: RescheduleSlot) {
    if (!appointment || busy) return;
    setBusy(`reschedule:${slot.startsAt}`);
    try {
      setAppointment((await rescheduleAppointment({ data: { token, staffId: slot.staffId, startsAt: slot.startsAt } })) as AppointmentView);
      setPanel("");
      toast.success("Marcação remarcada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível remarcar.");
    } finally {
      setBusy("");
    }
  }

  async function onRefund() {
    if (!appointment || busy) return;
    setBusy("refund");
    try {
      await requestRefund({ data: { token, reason: refundReason || "Pedido enviado pela pessoa cliente." } });
      toast.success("Pedido de reembolso enviado.");
      await load();
      setRefundReason("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível pedir reembolso.");
    } finally {
      setBusy("");
    }
  }

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-background px-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (!appointment) {
    return (
      <main className="grid min-h-screen place-items-center bg-background px-6 py-12">
        <div className="max-w-sm text-center">
          <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Marcação</p>
          <h1 className="mt-3 text-2xl font-light tracking-tight">Link indisponível</h1>
          <p className="mt-2 text-sm text-muted-foreground">Confirme o link recebido pelo WhatsApp.</p>
        </div>
      </main>
    );
  }

  const waPhone = normalizePhone(appointment.studioPhone);
  const waText = encodeURIComponent(
    [
      "Olá! Tenho uma reserva na Bellza e gostaria de obter mais informações sobre o meu agendamento.",
      "",
      `Nome: ${appointment.clientName}`,
      `Serviço: ${serviceLabel}`,
      `Profissional: ${appointment.staffName}`,
      `Data e hora: ${formatDateTime(appointment.startsAt, appointment.studioTimezone)}`,
      `Código da reserva: ${token}`,
    ].join("\n"),
  );
  const manageabilityMessage =
    appointment.policy.manageabilityText ||
    appointment.policy.blockReason ||
    "Esta marcação já não permite alterações.";
  const rescheduleManageabilityMessage =
    appointment.policy.rescheduleManageabilityText &&
    appointment.policy.rescheduleManageabilityText !== appointment.policy.manageabilityText
      ? ` ${appointment.policy.rescheduleManageabilityText}`
      : "";
  const isFullPay =
    (appointment as any).paymentPolicy === "pre_payment" &&
    Number((appointment as any).depositPercent ?? 100) >= 100;

  return (
    <main className="min-h-screen bg-background px-4 py-5 sm:px-6 sm:py-10">
      <div className="mx-auto w-full max-w-xl">
        <section className="rounded-3xl border border-border bg-card p-5 shadow-2xl shadow-black/5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                {appointment.studioName}
              </p>
              <h1 className="mt-2 text-2xl font-light tracking-tight">A sua marcação</h1>
            </div>
            <StatusBadge status={appointment.status} />
          </div>

          <div className="mt-6 grid gap-3">
            <InfoRow icon={<CalendarDays className="h-4 w-4" />} label="Data" value={formatDate(appointment.startsAt, appointment.studioTimezone)} />
            <InfoRow icon={<Clock className="h-4 w-4" />} label="Hora" value={formatTimeRange(appointment.startsAt, appointment.endsAt, appointment.studioTimezone)} />
            <InfoRow icon={<CheckCircle2 className="h-4 w-4" />} label="Serviço" value={serviceLabel} />
            <InfoRow icon={<ShieldCheck className="h-4 w-4" />} label="Profissional" value={appointment.staffName} />
          </div>

          <div className="mt-5 rounded-2xl border border-border bg-background/70 p-4">
            <p className="text-sm font-semibold">
              {isFullPay ? "Pagamento e cancelamento" : "Sinal e cancelamento"}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {manageabilityMessage}
              {rescheduleManageabilityMessage}
              {appointment.policy.refundable
                ? " Se cancelou dentro do prazo, pode pedir o reembolso do pagamento."
                : isFullPay
                  ? " O pagamento integral não é reembolsável nesta marcação."
                  : " O sinal não é reembolsável nesta marcação."}
            </p>
            {appointment.cancellationText && (
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {appointment.cancellationText}
              </p>
            )}
            {appointment.refundRequest && (
              <p className="mt-3 rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
                Pedido de reembolso: {refundStatusLabel(appointment.refundRequest.status)}.
              </p>
            )}
          </div>

          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => {
                setPanel(panel === "reschedule" ? "" : "reschedule");
                void logAction({ data: { token, action: "reschedule_open" } });
              }}
              disabled={!appointment.policy.canReschedule}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-border text-sm font-semibold disabled:opacity-45"
            >
              <RefreshCcw className="h-4 w-4" />
              Remarcar
            </button>
            <button
              type="button"
              onClick={() => {
                setPanel(panel === "cancel" ? "" : "cancel");
                void logAction({ data: { token, action: "cancel_open" } });
              }}
              disabled={!appointment.policy.canCancel || busy === "cancel"}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-border text-sm font-semibold disabled:opacity-45"
            >
              {busy === "cancel" ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
              Cancelar
            </button>
            {appointment.policy.refundable ? (
              <button
                type="button"
                onClick={onRefund}
                disabled={!appointment.policy.canRequestRefund || !!appointment.refundRequest || busy === "refund"}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-foreground text-sm font-semibold text-background disabled:opacity-45 sm:col-span-2"
              >
                {busy === "refund" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Solicitar reembolso
              </button>
            ) : null}
            <a
              id="contact-studio-link"
              href={waPhone ? `https://wa.me/${waPhone}?text=${waText}` : undefined}
              onClick={() => void logAction({ data: { token, action: "contact_whatsapp" } })}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-border text-sm font-semibold sm:col-span-2"
            >
              <MessageCircle className="h-4 w-4" />
              Falar com o estúdio
            </a>
          </div>

          {panel === "reschedule" && (
            <section className="mt-5 rounded-2xl border border-border bg-background/70 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold">Escolha uma nova data</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Mantemos o mesmo serviço e profissional, respeitando a disponibilidade atual.
                  </p>
                </div>
                <input
                  type="date"
                  value={rescheduleDate}
                  min={formatInputDate(new Date())}
                  onChange={(event) => setRescheduleDate(event.target.value)}
                  className="h-11 rounded-2xl border border-border bg-card px-3 text-sm"
                />
              </div>
              {!appointment.policy.canReschedule ? (
                <p className="mt-4 rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
                  {appointment.policy.rescheduleBlockReason || appointment.policy.blockReason}
                </p>
              ) : slotsLoading ? (
                <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  A carregar horários...
                </div>
              ) : slots.length === 0 ? (
                <p className="mt-4 rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
                  Sem horários disponíveis nesta data.
                </p>
              ) : (
                <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {slots.map((slot) => (
                    <button
                      key={`${slot.staffId}-${slot.startsAt}`}
                      type="button"
                      onClick={() => onReschedule(slot)}
                      disabled={busy === `reschedule:${slot.startsAt}`}
                      className="h-10 rounded-xl border border-border bg-card text-sm font-semibold disabled:opacity-50"
                    >
                      {busy === `reschedule:${slot.startsAt}` ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : slot.label}
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          {panel === "cancel" && (
            <section className="mt-5 rounded-2xl border border-red-500/20 bg-red-500/5 p-4">
              <p className="text-sm font-semibold text-red-700 dark:text-red-300">Confirmar cancelamento</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Esta ação atualiza a reserva e avisa o estúdio. O cancelamento respeita a política configurada:
                {" "}
                {appointment.policy.canCancel ? appointment.policy.deadlineText : appointment.policy.blockReason}
              </p>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => setPanel("")}
                  className="inline-flex h-11 flex-1 items-center justify-center rounded-2xl border border-border text-sm font-semibold"
                >
                  Voltar
                </button>
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={!appointment.policy.canCancel || busy === "cancel"}
                  className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-red-600 text-sm font-semibold text-white disabled:opacity-45"
                >
                  {busy === "cancel" ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                  Cancelar marcação
                </button>
              </div>
            </section>
          )}
        </section>
      </div>
    </main>
  );
}

function InfoRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-background/70 px-3 py-3">
      <span className="grid size-9 place-items-center rounded-xl bg-muted text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const label = status === "cancelled" ? "Cancelada" : status === "completed" ? "Realizada" : "Confirmada";
  return <span className="rounded-full bg-muted px-3 py-1 text-[11px] font-semibold">{label}</span>;
}

function formatDate(value: string, timeZone?: string | null) {
  return formatStudioDate(value, timeZone, { weekday: "long" });
}

function formatDateTime(value: string, timeZone?: string | null) {
  return formatStudioDateTime(value, timeZone);
}

function formatTimeRange(start: string, end: string, timeZone?: string | null) {
  return formatStudioTimeRange(start, end, timeZone);
}

function formatInputDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("351") || digits.length > 9) return digits;
  return `351${digits}`;
}

function refundStatusLabel(status: string) {
  if (status === "approved") return "aprovado";
  if (status === "rejected") return "recusado";
  return "em análise";
}
