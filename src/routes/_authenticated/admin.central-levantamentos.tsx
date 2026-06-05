import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, Clock3, HandCoins, ShieldCheck, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useCurrentStudio } from "@/hooks/use-current-studio";
import {
  getWithdrawalOperations,
  markWithdrawalCompleted,
  markWithdrawalProcessing,
  rejectWithdrawalRequest,
} from "@/lib/withdrawals.functions";
import { formatEUR } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/central-levantamentos")({
  head: () => ({ meta: [{ title: "Central de Levantamentos - Bellza" }] }),
  component: WithdrawalOperationsPage,
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

function WithdrawalOperationsPage() {
  const { studio } = useCurrentStudio();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const loadOperations = useServerFn(getWithdrawalOperations);
  const markProcessing = useServerFn(markWithdrawalProcessing);
  const markCompleted = useServerFn(markWithdrawalCompleted);
  const rejectRequest = useServerFn(rejectWithdrawalRequest);
  const [busyId, setBusyId] = useState<string | null>(null);

  const operations = useQuery({
    queryKey: ["withdrawal-operations"],
    enabled: studio?.role === "saas_owner",
    staleTime: 10 * 1000,
    refetchInterval: 30 * 1000,
    retry: 1,
    queryFn: async () => (await loadOperations()) as OperationRequest[],
  });

  useEffect(() => {
    if (studio && studio.role !== "saas_owner") {
      navigate({ to: "/admin", replace: true });
    }
  }, [navigate, studio]);

  if (studio?.role !== "saas_owner") {
    return <p className="text-sm text-muted-foreground">A abrir painel...</p>;
  }

  const requests = operations.data ?? [];
  const pending = requests.filter((request) => ["in_review", "processing"].includes(request.status));
  const blocked = pending.filter((request) => !request.coveredByLiveBalance).length;

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["withdrawal-operations"] });
  }

  async function runAction(requestId: string, action: "processing" | "completed" | "failed") {
    const request = requests.find((item) => item.id === requestId);
    if (!request) return;
    if (action !== "failed" && !request.coveredByLiveBalance) {
      toast.error("Este pedido não está coberto por saldo live confirmado.");
      return;
    }

    const note =
      action === "completed"
        ? window.prompt("Comprovativo/nota interna opcional:", request.adminNotes ?? "")?.trim()
        : request.adminNotes ?? "";
    if (action === "failed") {
      const reason = window.prompt("Indique o motivo da recusa:");
      if (!reason?.trim()) return;
      setBusyId(requestId);
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

    setBusyId(requestId);
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

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <section className="rounded-[1.5rem] border border-emerald-700/25 bg-[linear-gradient(135deg,rgba(16,185,129,0.12),rgba(255,255,255,0.02)_54%,rgba(14,165,233,0.07))] p-5 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white">
              <ShieldCheck className="h-3.5 w-3.5" />
              Operação segura
            </div>
            <h1 className="mt-4 text-2xl font-light tracking-tight md:text-3xl">
              Central de levantamentos
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Aprove apenas pedidos cobertos por pagamentos live confirmados. MB WAY e IBAN continuam
              em processamento manual.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 lg:min-w-[34rem]">
            <Stat label="Pendentes" value={String(pending.length)} />
            <Stat label="Bloqueados" value={String(blocked)} tone={blocked > 0 ? "danger" : "neutral"} />
            <Stat label="Atualização" value={operations.isFetching ? "A validar" : "Em dia"} />
          </div>
        </div>
      </section>

      {operations.isLoading ? (
        <p className="rounded-3xl border border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
          A carregar pedidos...
        </p>
      ) : requests.length === 0 ? (
        <p className="rounded-3xl border border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
          Ainda não existem pedidos de levantamento.
        </p>
      ) : (
        <div className="grid gap-4">
          {requests.map((request) => (
            <WithdrawalOperationCard
              key={request.id}
              request={request}
              busy={busyId === request.id}
              onProcessing={() => void runAction(request.id, "processing")}
              onCompleted={() => void runAction(request.id, "completed")}
              onRejected={() => void runAction(request.id, "failed")}
            />
          ))}
        </div>
      )}
    </div>
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
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${statusClass(request.status)}`}>
              {statusIcon(request.status)}
              {statusLabel(request.status)}
            </span>
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${
              request.coveredByLiveBalance
                ? "bg-emerald-600 text-white"
                : "bg-red-500/10 text-red-600 dark:text-red-300"
            }`}>
              {request.coveredByLiveBalance ? "Saldo live confirmado" : "Bloqueado"}
            </span>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <div className="min-w-0">
              <h2 className="truncate text-xl font-semibold">{request.studioName}</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Pedido em {formatDateTime(request.requestedAt)}
              </p>
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
            <Info label="Cobertura deste pedido" value={formatEUR(request.liveAvailableForRequestCents / 100)} />
          </div>

          {!request.coveredByLiveBalance && (
            <div className="mt-4 flex gap-2 rounded-2xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-700 dark:text-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                Este pedido não pode ser pago porque o valor não está coberto por pagamentos live
                confirmados ou já foi reservado por outro pedido.
              </p>
            </div>
          )}
        </div>

        <div className="grid gap-2 sm:grid-cols-3 xl:w-56 xl:grid-cols-1">
          <button
            type="button"
            onClick={onProcessing}
            disabled={busy || actionDisabled || !request.coveredByLiveBalance || request.status === "processing"}
            className="h-11 rounded-2xl border border-border bg-background px-4 text-xs font-bold uppercase tracking-wide transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45"
          >
            Validar
          </button>
          <button
            type="button"
            onClick={onCompleted}
            disabled={!canPay}
            className="h-11 rounded-2xl bg-emerald-600 px-4 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-45"
          >
            Marcar pago
          </button>
          <button
            type="button"
            onClick={onRejected}
            disabled={busy || actionDisabled}
            className="h-11 rounded-2xl border border-red-500/25 px-4 text-xs font-bold uppercase tracking-wide text-red-600 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-45"
          >
            Recusar
          </button>
        </div>
      </div>
    </article>
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

function formatPayoutMethod(method: OperationRequest["payoutMethod"]) {
  return method === "mb_way" ? "MB WAY" : "Transferência bancária";
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
