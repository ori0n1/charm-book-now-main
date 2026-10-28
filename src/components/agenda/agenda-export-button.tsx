import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Download, FileSpreadsheet, FileText, Loader2, Printer } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getProtectedAgendaData } from "@/lib/agenda-access.functions";
import { sortAppointmentsChronologically } from "@/lib/appointment-ordering";
import { DEFAULT_ATTENDANCE_GRACE_MINUTES, getAppointmentLifecycleStage, lifecycleStageLabel } from "@/lib/appointment-lifecycle";
import { buildAppointmentPaymentFacts, type RefundRow } from "@/lib/financial-ledger";
import { csvCell, escapeHtml, neutralizeSpreadsheetFormula } from "@/lib/output-safety";
import { formatStudioDate, formatStudioTime } from "@/lib/studio-time";
import { formatEUR } from "@/lib/utils";

type ExportAppointment = {
  id: string;
  starts_at: string;
  status: string;
  total_price: number;
  clients: { name: string; phone: string } | null;
  staff: { id: string; name: string } | null;
  appointment_services?: {
    position?: number | null;
    starts_at?: string | null;
    staff?: { id: string } | null;
    services: { name: string } | null;
  }[];
};
type PaidRow = {
  id?: string | null;
  appointment_id: string | null;
  amount_cents: number;
  status: string;
  method?: string | null;
};
type CashPaymentRow = {
  id?: string | null;
  appointment_id: string | null;
  amount: number;
  movement_type: string;
  payment_method?: string | null;
  responsible_name?: string | null;
};
type ExportPayload = {
  appointments: ExportAppointment[];
  payments: PaidRow[];
  cashPayments: CashPaymentRow[];
  refunds: RefundRow[];
  lifecycleSettings?: { graceMinutes?: number };
};
type ExportStudio = { id: string; role: string; staff_id: string | null; staff_agenda_visibility?: string | null; timezone?: string | null };

export function AgendaExportButton({ studio }: { studio: ExportStudio }) {
  const loadAgenda = useServerFn(getProtectedAgendaData);
  const [exporting, setExporting] = useState<"csv" | "excel" | "pdf" | null>(null);

  async function handleExport(format: "csv" | "excel" | "pdf") {
    setExporting(format);
    try {
      const payload = await loadAgenda({ data: { studioId: studio.id } }) as unknown as ExportPayload;
      const rows = buildAgendaExportRows(payload, studio, new Date());
      if (rows.length === 0) {
        toast.error("Nenhuma marcação para exportar.");
        return;
      }
      const headers = Object.keys(rows[0]);
      if (format === "csv") {
        const csvLines = [
          headers.map(csvCell).join(";"),
          ...rows.map((row) => headers.map((h) => csvCell((row as Record<string, string>)[h])).join(";")),
        ];
        triggerDownload(new Blob(["﻿" + csvLines.join("\n")], { type: "text/csv;charset=utf-8;" }), `marcacoes-${todayStr()}.csv`);
        toast.success("CSV exportado com sucesso.");
      } else if (format === "excel") {
        const th = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
        const trs = rows.map((row) =>
          `<tr>${headers.map((h) => `<td>${escapeHtml(neutralizeSpreadsheetFormula((row as Record<string, string>)[h]))}</td>`).join("")}</tr>`,
        ).join("");
        const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"></head><body><table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></body></html>`;
        triggerDownload(new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8;" }), `marcacoes-${todayStr()}.xls`);
        toast.success("Excel exportado com sucesso.");
      } else {
        const th = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
        const trs = rows.map((row) =>
          `<tr>${headers.map((h) => `<td>${escapeHtml((row as Record<string, string>)[h])}</td>`).join("")}</tr>`,
        ).join("");
        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Marcações</title><style>body{font-family:sans-serif;font-size:11px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:4px 8px;text-align:left}th{background:#f5f5f5}</style></head><body><h2>Marcações - ${new Date().toLocaleDateString("pt-PT")}</h2><table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></body></html>`;
        const win = window.open("", "_blank");
        if (win) {
          win.document.write(html);
          win.document.close();
          win.focus();
          win.print();
        }
        toast.success("Janela de impressão aberta.");
      }
    } catch {
      toast.error("Erro ao exportar. Tente novamente.");
    } finally {
      setExporting(null);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" disabled={exporting !== null}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border/70 bg-card px-3 text-xs font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
          aria-label="Exportar marcações">
          {exporting ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
          {exporting ? "A exportar..." : "Exportar"}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => void handleExport("csv")}><FileText />Exportar CSV</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void handleExport("excel")}><FileSpreadsheet />Exportar Excel (.xls)</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void handleExport("pdf")}><Printer />Imprimir / PDF</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function buildAgendaExportRows(payload: ExportPayload, studio: ExportStudio, now: Date) {
  const appointments = sortAppointmentsChronologically(
    (payload.appointments ?? []).filter((appointment) =>
      studio.role !== "staff" || appointmentIncludesStaff(appointment, studio.staff_id),
    ),
    "future",
  );
  const payments = payload.payments ?? [];
  const cashPayments = payload.cashPayments ?? [];
  const paymentFacts = buildAppointmentPaymentFacts(payments, cashPayments, payload.refunds ?? []);
  const pendingOnline = new Set(payments
    .filter((row) => row.appointment_id && ["requires_action", "processing"].includes(row.status))
    .map((row) => row.appointment_id));
  return appointments.map((appointment) => {
    const canSeeSensitive = studio.role !== "staff" || appointmentIncludesStaff(appointment, studio.staff_id);
    const canSeeBasic = canSeeSensitive || studio.staff_agenda_visibility === "team_basic";
    const paid = (paymentFacts.get(appointment.id)?.receivedCents ?? 0) / 100;
    const paymentState = formatPaymentState(appointment, paid, pendingOnline.has(appointment.id));
    const payLabel = paid > 0
      ? `${paymentState} · ${paymentAttribution(appointment.id, payments, cashPayments).join(" | ")}`
      : paymentState;
    return {
      Cliente: canSeeSensitive ? (appointment.clients?.name ?? "-") : "Reservado",
      Telefone: canSeeSensitive ? (appointment.clients?.phone ?? "-") : "-",
      Serviço: canSeeBasic ? appointmentServiceLabel(appointment) : "Ocupado",
      Profissional: appointment.staff?.name ?? "-",
      Data: formatStudioDate(appointment.starts_at, studio.timezone),
      Hora: formatStudioTime(appointment.starts_at, studio.timezone),
      Estado: canSeeSensitive
        ? lifecycleStageLabel(getAppointmentLifecycleStage({
            status: appointment.status,
            startsAt: appointment.starts_at,
            now,
            graceMinutes: Number(payload.lifecycleSettings?.graceMinutes ?? DEFAULT_ATTENDANCE_GRACE_MINUTES),
          }))
        : "Ocupado",
      Valor: canSeeSensitive ? formatEUR(appointment.total_price) : "-",
      Pagamento: canSeeSensitive ? payLabel : "-",
    };
  });
}

function appointmentIncludesStaff(appointment: ExportAppointment, staffId: string | null) {
  return Boolean(staffId && (appointment.staff?.id === staffId ||
    appointment.appointment_services?.some((line) => line.staff?.id === staffId)));
}

function appointmentServiceLabel(appointment: ExportAppointment) {
  return [...(appointment.appointment_services ?? [])]
    .sort((first, second) => Number(first.position ?? Number.MAX_SAFE_INTEGER) - Number(second.position ?? Number.MAX_SAFE_INTEGER)
      || String(first.starts_at ?? "").localeCompare(String(second.starts_at ?? "")))
    .map((line) => line.services?.name).filter(Boolean).join(", ") || "-";
}

function formatPaymentState(appointment: ExportAppointment, paid: number, hasPendingOnlinePayment = false) {
  if (paid > 0) {
    if (appointment.status === "completed") return "Pago + atendido";
    if (appointment.status === "no_show") return "Pago (mantido)";
    return "Pago";
  }
  if (appointment.status === "pending_payment" || hasPendingOnlinePayment) return "Aguardando pagamento online";
  if (appointment.status === "cancelled" || appointment.status === "no_show") return "Sem pagamento";
  return "No estudio";
}

function paymentAttribution(appointmentId: string, online: PaidRow[], onsite: CashPaymentRow[]) {
  const methodLabels: Record<string, string> = {
    mb_way: "MB WAY", card: "Cartão", cash: "Dinheiro", bank_transfer: "Transferência",
    other: "Outro", multibanco: "Multibanco",
  };
  const seen = new Set<string>();
  const records = [
    ...online.filter((row) => row.appointment_id === appointmentId && row.status === "succeeded")
      .map((row) => ({ id: row.id, source: "online", method: row.method, actor: null as string | null })),
    ...onsite.filter((row) => row.appointment_id === appointmentId && row.movement_type === "service_payment")
      .map((row) => ({ id: row.id, source: "onsite", method: row.payment_method, actor: row.responsible_name })),
  ];
  const labels = records.filter((row) => {
    const key = row.id ? `${row.source}:${row.id}` : null;
    if (!key || !seen.has(key)) {
      if (key) seen.add(key);
      return true;
    }
    return false;
  }).map((row) =>
    `${methodLabels[row.method ?? ""] ?? "Não registado"} · Recebido/registado por: ${row.actor?.trim() || "Não registado"}`,
  );
  return labels.length ? labels : ["Não registado · Recebido/registado por: Não registado"];
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
