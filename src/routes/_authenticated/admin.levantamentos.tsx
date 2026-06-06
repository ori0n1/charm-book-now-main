import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, ChevronDown, Download, HandCoins, Pencil, Search, Wallet } from "lucide-react";
import { useState, type InputHTMLAttributes } from "react";
import { toast } from "sonner";
import { useCurrentStudio } from "@/hooks/use-current-studio";
import {
  cancelStudioWithdrawal,
  getWithdrawalSummary,
  requestStudioWithdrawal,
  savePayoutSettings,
} from "@/lib/withdrawals.functions";
import { formatEUR } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/admin/levantamentos")({
  head: () => ({ meta: [{ title: "Levantamentos - Bellza" }] }),
  component: WithdrawalsPage,
});

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

function WithdrawalsPage() {
  const { studio } = useCurrentStudio();
  const queryClient = useQueryClient();
  const loadWithdrawal = useServerFn(getWithdrawalSummary);
  const requestWithdrawal = useServerFn(requestStudioWithdrawal);
  const cancelWithdrawal = useServerFn(cancelStudioWithdrawal);
  const saveWithdrawalSettings = useServerFn(savePayoutSettings);
  const [setupOpen, setSetupOpen] = useState(false);
  const [financialDetailsOpen, setFinancialDetailsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [expandedRequestId, setExpandedRequestId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | WithdrawalSummary["requests"][number]["status"]>("all");
  const [methodFilter, setMethodFilter] = useState<"all" | "iban" | "mb_way">("all");
  const [search, setSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const withdrawal = useQuery({
    queryKey: ["withdrawals-page-summary", studio?.id],
    enabled: !!studio,
    staleTime: 20 * 1000,
    refetchInterval: (query) => {
      const data = query.state.data as WithdrawalSummary | undefined;
      return data?.requests?.some((request) => ["in_review", "processing"].includes(request.status))
        ? 30000
        : false;
    },
    retry: 1,
    queryFn: async () =>
      (await loadWithdrawal({ data: { studioId: studio!.id } })) as WithdrawalSummary,
  });

  const data = withdrawal.data ?? null;
  const available = (data?.availableCents ?? 0) / 100;
  const reserved = (data?.reservedCents ?? 0) / 100;
  const paidOnline = (data?.paidOnlineCents ?? 0) / 100;
  const latest = data?.requests?.[0] ?? null;
  const requests = data?.requests ?? [];
  const visibleRequests = requests
    .filter((request, index) => request.status === "in_review" || request.status === "processing" || index < 3)
    .slice(0, 5);
  const filteredHistory = requests.filter((request) => {
    const query = search.trim().toLowerCase();
    const matchesStatus = statusFilter === "all" || request.status === statusFilter;
    const matchesMethod = methodFilter === "all" || request.payoutMethod === methodFilter;
    const haystack = [
      formatCents(request.amountCents, request.currency),
      formatWithdrawalStatus(request.status),
      formatPayoutMethod(request.payoutMethod),
      formatDate(request.requestedAt),
      request.requestedAt,
    ]
      .join(" ")
      .toLowerCase();
    return matchesStatus && matchesMethod && (!query || haystack.includes(query));
  });

  async function requestWithdraw() {
    if (!studio) return;
    if (available <= 0) {
      toast.message("Ainda não existem sinais online disponíveis para levantamento.");
      return;
    }
    if (!data?.settings) {
      setSetupOpen(true);
      return;
    }
    setSubmitting(true);
    try {
      const result = (await requestWithdrawal({ data: { studioId: studio.id } })) as {
        needsSetup?: boolean;
      };
      if (result.needsSetup) {
        setSetupOpen(true);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["withdrawals-page-summary", studio.id] });
      toast.success("Pedido de levantamento criado.");
    } catch {
      toast.error("Não foi possível criar o pedido de levantamento.");
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelRequest(requestId: string) {
    if (!studio) return;
    setCancellingId(requestId);
    try {
      await cancelWithdrawal({ data: { studioId: studio.id, requestId } });
      await queryClient.invalidateQueries({ queryKey: ["withdrawals-page-summary", studio.id] });
      toast.success("Pedido cancelado. O saldo foi libertado.");
    } catch {
      toast.error("Não foi possível cancelar este pedido.");
    } finally {
      setCancellingId(null);
    }
  }

  async function saveSettings(input: {
    fiscalName: string;
    nif: string;
    payoutMethod: "iban" | "mb_way";
    iban: string;
    mbWayPhone: string;
  }) {
    if (!studio) return;
    await saveWithdrawalSettings({
      data: {
        studioId: studio.id,
        fiscalName: input.fiscalName,
        nif: input.nif,
        payoutMethod: input.payoutMethod,
        iban: input.iban,
        mbWayPhone: input.mbWayPhone,
      },
    });
    await queryClient.invalidateQueries({ queryKey: ["withdrawals-page-summary", studio.id] });
    setSetupOpen(false);
    toast.success("Dados financeiros guardados.");
  }

  if (!studio || withdrawal.isLoading) {
    return <p className="text-sm text-muted-foreground">A carregar levantamentos...</p>;
  }

  return (
    <>
      <div className="mx-auto max-w-6xl space-y-5">
        <section className="overflow-hidden rounded-[1.6rem] border border-emerald-700/25 bg-[linear-gradient(135deg,rgba(16,185,129,0.14),rgba(255,255,255,0.02)_52%,rgba(16,185,129,0.05))] p-4 shadow-lg shadow-black/5 md:p-5">
          <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                <HandCoins className="h-4 w-4" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em]">
                  Saldo disponível
                </p>
              </div>
              <p className="mt-3 font-mono text-4xl font-semibold tracking-tight text-emerald-700 dark:text-emerald-400">
                {formatEUR(available)}
              </p>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Valor disponível a partir dos sinais pagos online pelas clientes. O restante dos
                serviços continua a ser recebido presencialmente no estúdio.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void requestWithdraw()}
              disabled={submitting}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 text-xs font-bold uppercase tracking-wide text-white shadow-lg shadow-emerald-950/15 transition hover:bg-emerald-700 disabled:opacity-60"
            >
              {submitting ? "A solicitar..." : "Solicitar levantamento"}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-3">
          <MetricCard label="Sinais recebidos" value={formatEUR(paidOnline)} icon={<Wallet className="h-4 w-4" />} />
          <MetricCard label="Em análise" value={formatEUR(reserved)} icon={<HandCoins className="h-4 w-4" />} />
          <MetricCard
            label="Último pedido"
            value={latest ? formatWithdrawalStatus(latest.status) : "Sem pedidos"}
            icon={<Download className="h-4 w-4" />}
          />
        </section>

        {reserved > 0 && available <= 0 && (
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
            O saldo recebido está reservado em pedidos de levantamento em análise. Cancele um pedido
            pendente se quiser libertar esse valor para um novo levantamento.
          </div>
        )}

        <section className="grid gap-4 lg:grid-cols-[0.72fr_1.28fr]">
          <article className="rounded-[1.25rem] border border-border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Dados financeiros
                </p>
                <h2 className="mt-1 text-lg font-semibold">Recebimento</h2>
              </div>
              <button
                type="button"
                onClick={() => setSetupOpen(true)}
                className="grid size-10 place-items-center rounded-2xl border border-border bg-background/70 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                aria-label="Editar dados financeiros"
              >
                <Pencil className="h-4 w-4" />
              </button>
            </div>

            {data?.settings ? (
              <div className="mt-4 space-y-3">
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  <InfoLine label="Método" value={formatPayoutMethod(data.settings.payoutMethod)} />
                  <InfoLine label="Nome fiscal" value={data.settings.fiscalName} />
                </div>
                <button
                  type="button"
                  onClick={() => setFinancialDetailsOpen((open) => !open)}
                  className="flex h-10 w-full items-center justify-between rounded-2xl border border-border bg-background/65 px-3 text-xs font-bold uppercase tracking-wide text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                  Detalhes financeiros
                  <ChevronDown className={`h-4 w-4 transition ${financialDetailsOpen ? "rotate-180" : ""}`} />
                </button>
                {financialDetailsOpen && (
                  <div className="grid gap-2 rounded-2xl border border-border/70 bg-background/45 p-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                    <InfoLine label="NIF" value={data.settings.nif} />
                    <InfoLine
                      label={data.settings.payoutMethod === "iban" ? "IBAN" : "MB WAY"}
                      value={
                        data.settings.payoutMethod === "iban"
                          ? data.settings.iban ?? "-"
                          : data.settings.mbWayPhone ?? "-"
                      }
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-border bg-background/55 p-4">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Adicione os dados financeiros para poder solicitar levantamentos.
                </p>
                <button
                  type="button"
                  onClick={() => setSetupOpen(true)}
                  className="mt-4 h-10 rounded-2xl bg-foreground px-4 text-xs font-bold uppercase tracking-wide text-background"
                >
                  Adicionar dados
                </button>
              </div>
            )}
          </article>

          <article className="rounded-[1.25rem] border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Histórico
                </p>
                <h2 className="mt-1 text-lg font-semibold">Pedidos de levantamento</h2>
              </div>
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                {data?.requests?.length ?? 0} pedidos
              </span>
            </div>

            <div className="mt-4 space-y-3">
              {visibleRequests.length ? (
                visibleRequests.map((request) => (
                  <WithdrawalRequestCard
                    key={request.id}
                    request={request}
                    expanded={expandedRequestId === request.id}
                    cancelling={cancellingId === request.id}
                    onToggle={() => setExpandedRequestId((id) => (id === request.id ? null : request.id))}
                    onCancel={() => cancelRequest(request.id)}
                  />
                ))
              ) : (
                <p className="rounded-2xl border border-dashed border-border bg-background/55 px-4 py-8 text-center text-sm text-muted-foreground">
                  Ainda não existem pedidos de levantamento.
                </p>
              )}
            </div>

            {requests.length > visibleRequests.length && (
              <div className="mt-4 rounded-2xl border border-border/70 bg-background/45">
                <button
                  type="button"
                  onClick={() => setHistoryOpen((open) => !open)}
                  className="flex h-12 w-full items-center justify-between px-4 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground transition hover:text-foreground"
                >
                  Ver histórico completo
                  <ChevronDown className={`h-4 w-4 transition ${historyOpen ? "rotate-180" : ""}`} />
                </button>
                {historyOpen && (
                  <div className="space-y-3 border-t border-border/70 p-3">
                    <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
                      <label className="flex h-11 items-center gap-2 rounded-2xl border border-border bg-card px-3">
                        <Search className="h-4 w-4 text-muted-foreground" />
                        <input
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                          placeholder="Pesquisar por valor, data ou status"
                          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                        />
                      </label>
                      <Select
                        value={statusFilter}
                        onValueChange={(value) =>
                          setStatusFilter(value as "all" | WithdrawalSummary["requests"][number]["status"])
                        }
                      >
                        <SelectTrigger className="h-11 rounded-2xl border-border bg-card px-3 text-xs font-semibold shadow-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-2xl border-border bg-popover/98 p-1.5 shadow-xl">
                          <SelectItem value="all" className="rounded-xl px-3 py-2.5 text-sm">Todos os status</SelectItem>
                          <SelectItem value="in_review" className="rounded-xl px-3 py-2.5 text-sm">Em análise</SelectItem>
                          <SelectItem value="processing" className="rounded-xl px-3 py-2.5 text-sm">Processando</SelectItem>
                          <SelectItem value="completed" className="rounded-xl px-3 py-2.5 text-sm">Concluído</SelectItem>
                          <SelectItem value="canceled" className="rounded-xl px-3 py-2.5 text-sm">Cancelado</SelectItem>
                          <SelectItem value="failed" className="rounded-xl px-3 py-2.5 text-sm">Falhou</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select
                        value={methodFilter}
                        onValueChange={(value) => setMethodFilter(value as "all" | "iban" | "mb_way")}
                      >
                        <SelectTrigger className="h-11 rounded-2xl border-border bg-card px-3 text-xs font-semibold shadow-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-2xl border-border bg-popover/98 p-1.5 shadow-xl">
                          <SelectItem value="all" className="rounded-xl px-3 py-2.5 text-sm">Todos os métodos</SelectItem>
                          <SelectItem value="mb_way" className="rounded-xl px-3 py-2.5 text-sm">MB WAY</SelectItem>
                          <SelectItem value="iban" className="rounded-xl px-3 py-2.5 text-sm">IBAN</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      {filteredHistory.length ? (
                        filteredHistory.map((request) => (
                          <WithdrawalRequestCard
                            key={`history-${request.id}`}
                            request={request}
                            expanded={expandedRequestId === `history-${request.id}`}
                            cancelling={cancellingId === request.id}
                            onToggle={() =>
                              setExpandedRequestId((id) =>
                                id === `history-${request.id}` ? null : `history-${request.id}`,
                              )
                            }
                            onCancel={() => cancelRequest(request.id)}
                          />
                        ))
                      ) : (
                        <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                          Nenhum pedido encontrado.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </article>
        </section>
      </div>

      {setupOpen && (
        <WithdrawalSetupModal
          defaultValues={data?.settings ?? null}
          onClose={() => setSetupOpen(false)}
          onSave={saveSettings}
        />
      )}
    </>
  );
}

function MetricCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em]">{label}</p>
      </div>
      <p className="mt-3 truncate font-mono text-xl font-semibold">{value}</p>
    </article>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-2xl bg-background/60 px-3 py-2.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-xs font-semibold">{value}</span>
    </div>
  );
}

function WithdrawalRequestCard({
  request,
  expanded,
  cancelling,
  onToggle,
  onCancel,
}: {
  request: WithdrawalSummary["requests"][number];
  expanded: boolean;
  cancelling: boolean;
  onToggle: () => void;
  onCancel: () => void;
}) {
  return (
    <article className="rounded-2xl border border-border/70 bg-background/60 p-3 transition hover:border-emerald-700/20">
      <button
        type="button"
        onClick={onToggle}
        className="grid w-full gap-3 text-left sm:grid-cols-[1fr_auto] sm:items-center"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-base font-semibold">
              {formatCents(request.amountCents, request.currency)}
            </p>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusClass(request.status)}`}>
              {formatWithdrawalStatus(request.status)}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatDate(request.requestedAt)} · {formatPayoutMethod(request.payoutMethod)}
          </p>
        </div>
        <div className="flex items-center justify-between gap-2 sm:justify-end">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {expanded ? "Ocultar" : "Detalhes"}
          </span>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition ${expanded ? "rotate-180" : ""}`} />
        </div>
      </button>
      {expanded && (
        <div className="mt-3 border-t border-border/60 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            {request.status === "in_review" && (
              <button
                type="button"
                onClick={onCancel}
                disabled={cancelling}
                className="inline-flex h-10 items-center justify-center rounded-2xl border border-border px-4 text-xs font-bold uppercase tracking-wide text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
              >
                {cancelling ? "A cancelar..." : "Cancelar pedido"}
              </button>
            )}
            {request.status === "completed" && request.proofUrl && (
              <a
                href={request.proofUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-foreground px-4 text-xs font-bold uppercase tracking-wide text-background"
              >
                <Download className="h-3.5 w-3.5" />
                Descarregar comprovativo
              </a>
            )}
          </div>
          <WithdrawalTimeline request={request} />
          {request.failureReason && (
            <p className="mt-3 text-xs leading-relaxed text-red-600 dark:text-red-400">
              {request.failureReason}
            </p>
          )}
        </div>
      )}
    </article>
  );
}

function WithdrawalTimeline({ request }: { request: WithdrawalSummary["requests"][number] }) {
  const steps = [
    { key: "in_review", label: "Em análise", date: request.reviewedAt ?? request.requestedAt },
    { key: "processing", label: "Processando", date: request.processedAt },
    { key: "completed", label: "Concluído", date: request.paidAt },
  ] as const;
  const index = stepIndex(request.status);
  const failed = request.status === "failed" || request.status === "canceled";

  return (
    <div className="mt-4 grid gap-2 sm:grid-cols-3">
      {steps.map((step, stepIndexValue) => {
        const active = stepIndexValue <= index && !failed;
        return (
          <div
            key={step.key}
            className={`rounded-2xl border px-3 py-2.5 ${
              active ? "border-emerald-700/25 bg-emerald-950/5" : "border-border/70 bg-muted/30"
            }`}
          >
            <p className="text-xs font-semibold">{step.label}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {step.date ? formatDate(step.date) : "A aguardar"}
            </p>
          </div>
        );
      })}
      {failed && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 px-3 py-2.5 sm:col-span-3">
          <p className="text-xs font-semibold text-red-600 dark:text-red-400">
            {request.status === "failed" ? "O levantamento falhou." : "O levantamento foi cancelado."}
          </p>
        </div>
      )}
    </div>
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
  const [payoutMethod, setPayoutMethod] = useState<"iban" | "mb_way">(
    defaultValues?.payoutMethod === "mb_way" ? "mb_way" : "iban",
  );
  const [iban, setIban] = useState(defaultValues?.iban ?? "");
  const [mbWayPhone, setMbWayPhone] = useState(defaultValues?.mbWayPhone ?? "");
  const [saving, setSaving] = useState(false);

  async function submit() {
    const cleanNif = nif.replace(/\D/g, "");
    if (!fiscalName.trim() || !/^\d{9}$/.test(cleanNif)) {
      toast.error("Preencha o nome fiscal e um NIF válido.");
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
    } catch {
      toast.error("Não foi possível guardar os dados financeiros.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-background/55 px-3 py-3 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-xl rounded-[1.5rem] border border-border bg-card p-4 shadow-2xl sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Levantamentos
            </p>
            <h2 className="mt-1 text-lg font-semibold">Dados financeiros</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-border px-3 py-2 text-xs font-semibold"
          >
            Fechar
          </button>
        </div>
        <div className="mt-5 grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <LabeledInput label="Nome fiscal" value={fiscalName} onChange={setFiscalName} />
            <LabeledInput
              label="NIF"
              value={nif}
              onChange={(value) => setNif(value.replace(/\D/g, "").slice(0, 9))}
              inputMode="numeric"
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <ChoiceButton
              active={payoutMethod === "iban"}
              label="Transferência bancária"
              onClick={() => setPayoutMethod("iban")}
            />
            <ChoiceButton
              active={payoutMethod === "mb_way"}
              label="MB WAY"
              onClick={() => setPayoutMethod("mb_way")}
            />
          </div>
          {payoutMethod === "iban" ? (
            <LabeledInput label="IBAN" value={iban} onChange={(value) => setIban(value.toUpperCase())} />
          ) : (
            <LabeledInput label="Contacto MB WAY" value={mbWayPhone} onChange={setMbWayPhone} />
          )}
        </div>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving}
          className="mt-5 h-12 w-full rounded-2xl bg-foreground px-4 text-xs font-bold uppercase tracking-wide text-background disabled:opacity-60"
        >
          {saving ? "A guardar..." : "Guardar dados"}
        </button>
      </div>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  ...props
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value">) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 h-11 w-full rounded-2xl border border-border bg-background px-3 text-sm outline-none transition focus:border-emerald-700/45"
        {...props}
      />
    </label>
  );
}

function ChoiceButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition ${
        active ? "border-emerald-700/35 bg-emerald-950/5" : "border-border bg-background/60"
      }`}
    >
      {label}
    </button>
  );
}

function formatWithdrawalStatus(status: WithdrawalSummary["requests"][number]["status"]) {
  const map = {
    in_review: "Em análise",
    processing: "Processando",
    completed: "Concluído",
    failed: "Falhou",
    canceled: "Cancelado",
  };
  return map[status];
}

function statusClass(status: WithdrawalSummary["requests"][number]["status"]) {
  if (status === "completed") return "bg-emerald-600 text-white";
  if (status === "failed" || status === "canceled") return "bg-red-500/10 text-red-600";
  return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
}

function formatPayoutMethod(method?: "iban" | "mb_way" | null) {
  return method === "mb_way" ? "MB WAY" : "Transferência bancária";
}

function formatCents(value: number, currency = "eur") {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(value / 100);
}

function formatDate(value?: string | null) {
  if (!value) return "Data não disponível";
  return new Date(value).toLocaleDateString("pt-PT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function stepIndex(status: WithdrawalSummary["requests"][number]["status"]) {
  if (status === "processing") return 1;
  if (status === "completed") return 2;
  return 0;
}


