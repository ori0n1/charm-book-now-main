import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  HandCoins,
  RefreshCcw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useCurrentStudio } from "@/hooks/use-current-studio";
import {
  getRefundOperations,
  markRefundCompleted,
  rejectApprovedRefund,
} from "@/lib/refund-operations.functions";
import {
  getWithdrawalOperations,
  markWithdrawalCompleted,
  markWithdrawalProcessing,
  rejectWithdrawalRequest,
} from "@/lib/withdrawals.functions";
import { formatEUR } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/central-levantamentos")({
  head: () => ({ meta: [{ title: "Central Financeira - Bellza" }] }),
  component: FinancialOperationsPage,
});

type OperationRequest = {
  id: string;
  studioId: string;
  studioName: string;
  studioSlug: string | null;
  amountCents: number;
  currency: string;
  status: "in_review" | "processing" | "completed" | "failed" | "canceled";
  payoutMethod: "iban" | "mb_way";
  payoutMode: "manual" | "stripe_automatic";
  fiscalName: string;
  nif: string;
  ibanLast4: string | null;
  mbWayPhone: string | null;
  requestedAt: string;
  reviewedAt: string | null;
  processedAt: string | null;
  paidAt: string | null;
  updatedAt: string | null;
  proofUrl: string | null;
  failureReason: string | null;
  adminNotes: string | null;
  confirmedLiveCents: number;
  reservedCents: number;
  liveAvailableForRequestCents: number;
  coveredByLiveBalance: boolean;
};

type RefundOperation = {
  id: string;
  studioId: string;
  studioName: string;
  clientName: string;
  clientPhone: string | null;
  clientEmail: string | null;
  amountCents: number;
  currency: string;
  serviceName: string;
  reason: string;
  status: "approved" | "refunded" | "rejected";
  decisionNote: string | null;
  adminNotes: string | null;
  paymentMethod: string;
  stripePaymentIntentId: string | null;
  stripeCheckoutSessionId: string | null;
  stripeRefundId: string | null;
  refundMethod: string | null;
  paidAt: string | null;
  appointmentAt: string | null;
  requestedAt: string;
  reviewedAt: string | null;
  processedAt: string | null;
  coveredByLivePayment: boolean;
};

function FinancialOperationsPage() {
  const { studio } = useCurrentStudio();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const loadWithdrawals = useServerFn(getWithdrawalOperations);
  const loadRefunds = useServerFn(getRefundOperations);
  const markProcessing = useServerFn(markWithdrawalProcessing);
  const markCompleted = useServerFn(markWithdrawalCompleted);
  const rejectRequest = useServerFn(rejectWithdrawalRequest);
  const completeRefund = useServerFn(markRefundCompleted);
  const rejectRefund = useServerFn(rejectApprovedRefund);
  const [busyId, setBusyId] = useState<string | null>(null);

  const withdrawals = useQuery({
    queryKey: ["withdrawal-operations"],
    enabled: studio?.role === "saas_owner",
    staleTime: 10 * 1000,
    refetchInterval: 30 * 1000,
    retry: 1,
    queryFn: async () => (await loadWithdrawals()) as OperationRequest[],
  });

  const refunds = useQuery({
    queryKey: ["refund-operations"],
    enabled: studio?.role === "saas_owner",
    staleTime: 10 * 1000,
    refetchInterval: 30 * 1000,
    retry: 1,
    queryFn: async () => (await loadRefunds()) as RefundOperation[],
  });

  useEffect(() => {
    if (studio && studio.role !== "saas_owner") {
      navigate({ to: "/admin", replace: true });
    }
  }, [navigate, studio]);

  if (studio?.role !== "saas_owner") {
    return <p className="text-sm text-muted-foreground">A abrir painel...</p>;
  }

  const withdrawalRequests = withdrawals.data ?? [];
  const refundRequests = refunds.data ?? [];
  const pendingWithdrawals = withdrawalRequests.filter((request) =>
    ["in_review", "processing"].includes(request.status),
  );
  const blockedWithdrawals = pendingWithdrawals.filter((request) => !request.coveredByLiveBalance).length;
  const pendingRefunds = refundRequests.filter((request) => request.status === "approved");
  const blockedRefunds = pendingRefunds.filter((request) => !request.coveredByLivePayment).length;

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["withdrawal-operations"] }),
      queryClient.invalidateQueries({ queryKey: ["refund-operations"] }),
    ]);
  }

  async function runWithdrawalAction(requestId: string, action: "processing" | "completed" | "failed") {
    const request = withdrawalRequests.find((item) => item.id === requestId);
    if (!request) return;
    if (action !== "failed" && !request.coveredByLiveBalance) {
      toast.error("Este pedido não está coberto por saldo live confirmado.");
      return;
    }

    if (action === "failed") {
      const reason = window.prompt("Indique o motivo da recusa:");
      if (!reason?.trim()) return;
      setBusyId(`withdrawal:${requestId}`);
      try {
        await rejectRequest({ data: { requestId, reason: reason.trim() } });
        await refresh();
        toast.success("Pedido recusado e saldo libertado.");
      } catch {
        toast.error("Não foi possível recusar este pedido.");
      } finally {
        setBusyId(null);
      }
      return;
    }

    const note =
      action === "completed"
        ? window.prompt("Comprovativo/nota interna opcional:", request.adminNotes ?? "")?.trim()
        : request.adminNotes ?? "";
    setBusyId(`withdrawal:${requestId}`);
    try {
      if (action === "processing") {
        await markProcessing({ data: { requestId, note } });
        toast.success("Pedido validado para processamento.");
      } else {
        await markCompleted({ data: { requestId, note } });
        toast.success("Levantamento marcado como pago.");
      }
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      toast.error(
        message.includes("withdrawal_not_covered")
          ? "O saldo live confirmado já não cobre este pedido."
          : "Não foi possível atualizar o pedido.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function runRefundAction(requestId: string, action: "completed" | "rejected") {
    const request = refundRequests.find((item) => item.id === requestId);
    if (!request) return;
    if (action === "completed" && !request.coveredByLivePayment) {
      toast.error("Este reembolso não está ligado a um pagamento live confirmado.");
      return;
    }

    if (action === "rejected") {
      const reason = window.prompt("Indique o motivo para não processar este reembolso:");
      if (!reason?.trim()) return;
      setBusyId(`refund:${requestId}`);
      try {
        await rejectRefund({ data: { requestId, reason: reason.trim() } });
        await refresh();
        toast.success("Reembolso recusado pela operação.");
      } catch {
        toast.error("Não foi possível recusar este reembolso.");
      } finally {
        setBusyId(null);
      }
      return;
    }

    const note = window.prompt("Referência/comprovativo opcional:", request.adminNotes ?? "")?.trim();
    setBusyId(`refund:${requestId}`);
    try {
      await completeRefund({ data: { requestId, note, refundMethod: "manual" } });
      await refresh();
      toast.success("Reembolso marcado como processado.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      toast.error(
        message.includes("refund_payment_not_live")
          ? "Este reembolso não está ligado a um pagamento live confirmado."
          : "Não foi possível processar este reembolso.",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <section className="rounded-[1.5rem] border border-emerald-700/25 bg-[linear-gradient(135deg,rgba(16,185,129,0.12),rgba(255,255,255,0.02)_54%,rgba(14,165,233,0.07))] p-5 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white">
              <ShieldCheck className="h-3.5 w-3.5" />
              Operação segura
            </div>
            <h1 className="mt-4 text-2xl font-light tracking-tight md:text-3xl">Central financeira</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Controle levantamentos e reembolsos usando apenas pagamentos live confirmados.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-4 lg:min-w-[42rem]">
            <Stat label="Levantamentos" value={String(pendingWithdrawals.length)} />
            <Stat label="Reembolsos" value={String(pendingRefunds.length)} />
            <Stat label="Bloqueios" value={String(blockedWithdrawals + blockedRefunds)} tone={blockedWithdrawals + blockedRefunds > 0 ? "danger" : "neutral"} />
            <Stat label="Estado" value={withdrawals.isFetching || refunds.isFetching ? "A validar" : "Em dia"} />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeading
          icon={<HandCoins className="h-4 w-4" />}
          title="Pedidos de levantamento"
          subtitle="Saídas para estúdios por MB WAY ou IBAN."
        />
        {withdrawals.isLoading ? (
          <EmptyState>A carregar pedidos...</EmptyState>
        ) : withdrawalRequests.length === 0 ? (
          <EmptyState>Ainda não existem pedidos de levantamento.</EmptyState>
        ) : (
          <div className="grid gap-4">
            {withdrawalRequests.map((request) => (
              <WithdrawalOperationCard
                key={request.id}
                request={request}
                busy={busyId === `withdrawal:${request.id}`}
                onProcessing={() => void runWithdrawalAction(request.id, "processing")}
                onCompleted={() => void runWithdrawalAction(request.id, "completed")}
                onRejected={() => void runWithdrawalAction(request.id, "failed")}
              />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <SectionHeading
          icon={<RefreshCcw className="h-4 w-4" />}
          title="Reembolsos aprovados"
          subtitle="Valores já retirados do saldo disponível do estúdio e pendentes de processamento."
        />
        {refunds.isLoading ? (
          <EmptyState>A carregar reembolsos...</EmptyState>
        ) : refundRequests.length === 0 ? (
          <EmptyState>Ainda não existem reembolsos aprovados.</EmptyState>
        ) : (
          <div className="grid gap-4">
            {refundRequests.map((request) => (
              <RefundOperationCard
                key={request.id}
                request={request}
                busy={busyId === `refund:${request.id}`}
                onCompleted={() => void runRefundAction(request.id, "completed")}
                onRejected={() => void runRefundAction(request.id, "rejected")}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SectionHeading({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div>
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <p className="text-[10px] font-bold uppercase tracking-[0.18em]">{title}</p>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-3xl border border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

function WithdrawalOperationCard({
  request,
  busy,
  onProcessing,
  onCompleted,
  onRejected,
}: {
  request: OperationRequest;
  busy: boolean;
  onProcessing: () => void;
  onCompleted: () => void;
  onRejected: () => void;
}) {
  const actionDisabled = busy || !["in_review", "processing"].includes(request.status);
  const canPay = !actionDisabled && request.coveredByLiveBalance;

  return (
    <article className="rounded-[1.35rem] border border-border bg-card p-4 shadow-sm md:p-5">
      <div className="grid gap-4 xl:grid-cols-[1fr_auto] xl:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={request.status} />
            <SafetyPill ok={request.coveredByLiveBalance} okText="Saldo live confirmado" failText="Bloqueado" />
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <div className="min-w-0">
              <h2 className="truncate text-xl font-semibold">{request.studioName}</h2>
              <p className="mt-1 text-xs text-muted-foreground">Pedido em {formatDateTime(request.requestedAt)}</p>
            </div>
            <p className="font-mono text-3xl font-semibold tracking-tight">
              {formatMoney(request.amountCents, request.currency)}
            </p>
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-4">
            <Info label="Método" value={formatPayoutMethod(request.payoutMethod)} />
            <Info label="Destino" value={formatDestination(request)} />
            <Info label="Nome fiscal" value={request.fiscalName} />
            <Info label="NIF" value={request.nif} />
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            <Info label="Live confirmado" value={formatEUR(request.confirmedLiveCents / 100)} />
            <Info label="Reservado" value={formatEUR(request.reservedCents / 100)} />
            <Info label="Cobertura" value={formatEUR(request.liveAvailableForRequestCents / 100)} />
          </div>
          {!request.coveredByLiveBalance && (
            <RiskNote>
              Este pedido não pode ser pago porque o valor não está coberto por pagamentos live confirmados
              ou já foi reservado por outro pedido.
            </RiskNote>
          )}
        </div>
        <div className="grid gap-2 sm:grid-cols-3 xl:w-56 xl:grid-cols-1">
          <ActionButton onClick={onProcessing} disabled={busy || actionDisabled || !request.coveredByLiveBalance || request.status === "processing"}>
            Validar
          </ActionButton>
          <ActionButton variant="primary" onClick={onCompleted} disabled={!canPay}>
            Marcar pago
          </ActionButton>
          <ActionButton variant="danger" onClick={onRejected} disabled={busy || actionDisabled}>
            Recusar
          </ActionButton>
        </div>
      </div>
    </article>
  );
}

function RefundOperationCard({
  request,
  busy,
  onCompleted,
  onRejected,
}: {
  request: RefundOperation;
  busy: boolean;
  onCompleted: () => void;
  onRejected: () => void;
}) {
  const locked = request.status !== "approved";
  return (
    <article className="rounded-[1.35rem] border border-border bg-card p-4 shadow-sm md:p-5">
      <div className="grid gap-4 xl:grid-cols-[1fr_auto] xl:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <RefundStatusPill status={request.status} />
            <SafetyPill ok={request.coveredByLivePayment} okText="Pagamento live confirmado" failText="Verificar pagamento" />
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <div className="min-w-0">
              <h2 className="truncate text-xl font-semibold">{request.clientName}</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {request.studioName} · {request.serviceName}
              </p>
            </div>
            <p className="font-mono text-3xl font-semibold tracking-tight">
              {formatMoney(request.amountCents, request.currency)}
            </p>
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-4">
            <Info label="Pedido" value={formatDateTime(request.requestedAt)} />
            <Info label="Pagamento" value={request.paidAt ? formatDateTime(request.paidAt) : "Sem data"} />
            <Info label="Método original" value={formatPaymentMethod(request.paymentMethod)} />
            <Info label="Referência" value={request.stripePaymentIntentId ?? "Sem referência"} />
          </div>
          <div className="mt-3 rounded-2xl border border-border/70 bg-background/55 px-4 py-3">
            <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Motivo</p>
            <p className="mt-1 text-sm leading-relaxed text-foreground/90">{request.reason}</p>
          </div>
          <RefundTimeline request={request} />
          {!request.coveredByLivePayment && (
            <RiskNote>Este reembolso não deve ser processado sem ligação a pagamento live confirmado.</RiskNote>
          )}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:w-56 xl:grid-cols-1">
          <ActionButton variant="primary" onClick={onCompleted} disabled={busy || locked || !request.coveredByLivePayment}>
            Marcar reembolsado
          </ActionButton>
          <ActionButton variant="danger" onClick={onRejected} disabled={busy || locked}>
            Recusar
          </ActionButton>
        </div>
      </div>
    </article>
  );
}

function RefundTimeline({ request }: { request: RefundOperation }) {
  const steps = [
    { label: "Pagamento recebido", date: request.paidAt, active: true },
    { label: "Pedido de reembolso", date: request.requestedAt, active: true },
    { label: "Aprovado pelo estúdio", date: request.reviewedAt, active: request.status === "approved" || request.status === "refunded" },
    { label: request.status === "refunded" ? "Reembolsado" : "Aguardando admin", date: request.processedAt, active: request.status === "refunded" },
  ];
  return (
    <div className="mt-3 grid gap-2 md:grid-cols-4">
      {steps.map((step) => (
        <div
          key={step.label}
          className={`rounded-2xl border px-3 py-2.5 ${
            step.active ? "border-emerald-700/25 bg-emerald-950/5" : "border-border/70 bg-muted/30"
          }`}
        >
          <p className="text-xs font-semibold">{step.label}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">{step.date ? formatDateTime(step.date) : "Pendente"}</p>
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "danger" }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/70 px-3 py-2.5">
      <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className={`mt-1 text-sm font-semibold ${tone === "danger" ? "text-red-600" : ""}`}>{value}</p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border/70 bg-background/55 px-3 py-2.5">
      <p className="truncate text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-xs font-semibold">{value}</p>
    </div>
  );
}

function ActionButton({
  children,
  disabled,
  onClick,
  variant = "default",
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
  variant?: "default" | "primary" | "danger";
}) {
  const classes =
    variant === "primary"
      ? "bg-emerald-600 text-white hover:bg-emerald-700"
      : variant === "danger"
        ? "border border-red-500/25 text-red-600 hover:bg-red-500/10"
        : "border border-border bg-background hover:bg-muted";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`h-11 rounded-2xl px-4 text-xs font-bold uppercase tracking-wide transition disabled:cursor-not-allowed disabled:opacity-45 ${classes}`}
    >
      {children}
    </button>
  );
}

function RiskNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 flex gap-2 rounded-2xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-700 dark:text-red-200">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{children}</p>
    </div>
  );
}

function SafetyPill({ ok, okText, failText }: { ok: boolean; okText: string; failText: string }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${
        ok ? "bg-emerald-600 text-white" : "bg-red-500/10 text-red-600 dark:text-red-300"
      }`}
    >
      {ok ? okText : failText}
    </span>
  );
}

function StatusPill({ status }: { status: OperationRequest["status"] }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${statusClass(status)}`}>
      {statusIcon(status)}
      {statusLabel(status)}
    </span>
  );
}

function RefundStatusPill({ status }: { status: RefundOperation["status"] }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${refundStatusClass(status)}`}>
      {status === "refunded" ? <CheckCircle2 className="h-3.5 w-3.5" /> : status === "rejected" ? <XCircle className="h-3.5 w-3.5" /> : <RefreshCcw className="h-3.5 w-3.5" />}
      {refundStatusLabel(status)}
    </span>
  );
}

function statusIcon(status: OperationRequest["status"]) {
  if (status === "completed") return <CheckCircle2 className="h-3.5 w-3.5" />;
  if (status === "failed" || status === "canceled") return <XCircle className="h-3.5 w-3.5" />;
  if (status === "processing") return <Clock3 className="h-3.5 w-3.5" />;
  return <HandCoins className="h-3.5 w-3.5" />;
}

function statusClass(status: OperationRequest["status"]) {
  if (status === "completed") return "bg-emerald-600 text-white";
  if (status === "failed" || status === "canceled") return "bg-red-500/10 text-red-600 dark:text-red-300";
  if (status === "processing") return "bg-sky-500/10 text-sky-700 dark:text-sky-300";
  return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
}

function refundStatusClass(status: RefundOperation["status"]) {
  if (status === "refunded") return "bg-emerald-600 text-white";
  if (status === "rejected") return "bg-red-500/10 text-red-600 dark:text-red-300";
  return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
}

function statusLabel(status: OperationRequest["status"]) {
  const labels = {
    in_review: "Em análise",
    processing: "Processando",
    completed: "Pago",
    failed: "Recusado",
    canceled: "Cancelado",
  };
  return labels[status];
}

function refundStatusLabel(status: RefundOperation["status"]) {
  if (status === "refunded") return "Reembolsado";
  if (status === "rejected") return "Recusado";
  return "Aguardando processamento";
}

function formatPayoutMethod(method: OperationRequest["payoutMethod"]) {
  return method === "mb_way" ? "MB WAY" : "Transferência bancária";
}

function formatPaymentMethod(method: string) {
  if (method === "mb_way") return "MB WAY";
  if (method === "card") return "Cartão";
  return method || "Online";
}

function formatDestination(request: OperationRequest) {
  if (request.payoutMethod === "mb_way") return request.mbWayPhone ?? "Sem contacto";
  return request.ibanLast4 ? `IBAN terminado em ${request.ibanLast4}` : "IBAN registado";
}

function formatMoney(value: number, currency = "eur") {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(value / 100);
}

function formatDateTime(value?: string | null) {
  if (!value) return "Data não disponível";
  return new Date(value).toLocaleString("pt-PT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
