import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CalendarDays, CheckCircle2, Clock, Loader2, MessageCircle, RefreshCcw, ShieldCheck, XCircle } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  cancelClientAppointment,
  getClientAppointment,
  requestClientRefund,
} from "@/lib/client-appointment.functions";

export const Route = createFileRoute("/marcacao/$token")({
  head: () => ({ meta: [{ title: "Detalhes da marcação" }] }),
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
  studioPhone: string;
  staffName: string;
  services: { name: string; price: number; durationMin: number }[];
  paidAmount: number;
  refundRequest: { id: string; status: string; created_at: string } | null;
  cancellationText: string | null;
  policy: {
    noticeHours: number;
    deadlineAt: string;
    beforeDeadline: boolean;
    happened: boolean;
    cancelled: boolean;
    refundable: boolean;
    canCancel: boolean;
    canRequestRefund: boolean;
    blockReason: string;
    refundBlockReason: string;
    refundPolicy: string;
  };
};

function ClientAppointmentPage() {
  const { token } = Route.useParams();
  const loadAppointment = useServerFn(getClientAppointment);
  const cancelAppointment = useServerFn(cancelClientAppointment);
  const requestRefund = useServerFn(requestClientRefund);
  const [appointment, setAppointment] = useState<AppointmentView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [refundReason, setRefundReason] = useState("");

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

  const serviceLabel = useMemo(
    () => appointment?.services.map((service) => service.name).join(", ") || "Serviço",
    [appointment],
  );

  async function onCancel() {
    if (!appointment || busy) return;
    if (!confirm("Cancelar esta marcação?")) return;
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

  async function onRefund() {
    if (!appointment || busy) return;
    setBusy("refund");
    try {
      await requestRefund({ data: { token, reason: refundReason || "Pedido enviado pela cliente." } });
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

  const when = new Date(appointment.startsAt);
  const waPhone = normalizePhone(appointment.studioPhone);
  const waText = encodeURIComponent(`Olá, tenho uma questão sobre a minha marcação de ${serviceLabel}.`);
  const canAct = !appointment.policy.happened && !appointment.policy.cancelled;

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
            <InfoRow icon={<CalendarDays className="h-4 w-4" />} label="Data" value={formatDate(when)} />
            <InfoRow icon={<Clock className="h-4 w-4" />} label="Hora" value={formatTimeRange(appointment.startsAt, appointment.endsAt)} />
            <InfoRow icon={<CheckCircle2 className="h-4 w-4" />} label="Serviço" value={serviceLabel} />
            <InfoRow icon={<ShieldCheck className="h-4 w-4" />} label="Profissional" value={appointment.staffName} />
          </div>

          <div className="mt-5 rounded-2xl border border-border bg-background/70 p-4">
            <p className="text-sm font-semibold">Sinal e cancelamento</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Pode cancelar até {formatDateTime(appointment.policy.deadlineAt)}.
              {appointment.policy.refundable
                ? " Se cancelou dentro do prazo, pode pedir o reembolso do sinal."
                : " O sinal não é reembolsável nesta marcação."}
            </p>
            {appointment.cancellationText && (
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {appointment.cancellationText}
              </p>
            )}
            {!canAct && (
              <p className="mt-3 rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
                {appointment.policy.blockReason || "Esta marcação já não permite alterações."}
              </p>
            )}
            {appointment.refundRequest && (
              <p className="mt-3 rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
                Pedido de reembolso: {refundStatusLabel(appointment.refundRequest.status)}.
              </p>
            )}
          </div>

          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            <Link
              to="/s/$slug"
              params={{ slug: appointment.studioSlug }}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-border text-sm font-semibold"
            >
              <RefreshCcw className="h-4 w-4" />
              Remarcar
            </Link>
            <button
              type="button"
              onClick={onCancel}
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
              href={waPhone ? `https://wa.me/${waPhone}?text=${waText}` : undefined}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-border text-sm font-semibold sm:col-span-2"
            >
              <MessageCircle className="h-4 w-4" />
              Falar com o estúdio
            </a>
          </div>
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

function formatDate(date: Date) {
  return date.toLocaleDateString("pt-PT", { weekday: "long", day: "2-digit", month: "long" });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleDateString("pt-PT", {
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTimeRange(start: string, end: string) {
  const opts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
  return `${new Date(start).toLocaleTimeString("pt-PT", opts)} - ${new Date(end).toLocaleTimeString("pt-PT", opts)}`;
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
