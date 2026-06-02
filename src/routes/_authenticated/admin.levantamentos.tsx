import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Download, HandCoins, Pencil, Wallet } from "lucide-react";
import { useState, type InputHTMLAttributes } from "react";
import { toast } from "sonner";
import { useCurrentStudio } from "@/hooks/use-current-studio";
import {
  getWithdrawalSummary,
  requestStudioWithdrawal,
  savePayoutSettings,
} from "@/lib/withdrawals.functions";
import { formatEUR } from "@/lib/utils";

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
  const saveWithdrawalSettings = useServerFn(savePayoutSettings);
  const [setupOpen, setSetupOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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

  async function requestWithdraw() {
    if (!studio) return;
    if (available <= 0) {
      toast.message("Ainda não existem sinais online disponÃ­veis para levantamento.");
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
      toast.error("NÃ£o foi possÃ­vel criar o pedido de levantamento.");
    } finally {
      setSubmitting(false);
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
                  Saldo disponÃ­vel
                </p>
              </div>
              <p className="mt-3 font-mono text-4xl font-semibold tracking-tight text-emerald-700 dark:text-emerald-400">
                {formatEUR(available)}
              </p>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Valor disponÃ­vel a partir dos sinais pagos online pelas clientes. O restante dos
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

        <section className="grid gap-5 lg:grid-cols-[0.75fr_1.25fr]">
          <article className="rounded-[1.35rem] border border-border bg-card p-4 shadow-sm md:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Dados financeiros
                </p>
                <h2 className="mt-2 text-lg font-semibold">Recebimento</h2>
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
              <div className="mt-4 space-y-2 text-sm">
                <InfoLine label="Método" value={formatPayoutMethod(data.settings.payoutMethod)} />
                <InfoLine label="Nome fiscal" value={data.settings.fiscalName} />
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

          <article className="rounded-[1.35rem] border border-border bg-card p-4 shadow-sm md:p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Histórico
                </p>
                <h2 className="mt-2 text-lg font-semibold">Pedidos de levantamento</h2>
              </div>
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                {data?.requests?.length ?? 0} pedidos
              </span>
            </div>

            <div className="mt-4 space-y-3">
              {data?.requests?.length ? (
                data.requests.map((request) => (
                  <article
                    key={request.id}
                    className="rounded-2xl border border-border/70 bg-background/60 p-3.5"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold">
                            {formatCents(request.amountCents, request.currency)}
                          </p>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusClass(request.status)}`}>
                            {formatWithdrawalStatus(request.status)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatDate(request.requestedAt)} Â· {formatPayoutMethod(request.payoutMethod)}
                        </p>
                      </div>
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
                  </article>
                ))
              ) : (
                <p className="rounded-2xl border border-dashed border-border bg-background/55 px-4 py-8 text-center text-sm text-muted-foreground">
                  Ainda não existem pedidos de levantamento.
                </p>
              )}
            </div>
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
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-background/60 px-3 py-2.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-xs font-semibold">{value}</span>
    </div>
  );
}

function WithdrawalTimeline({ request }: { request: WithdrawalSummary["requests"][number] }) {
  const steps = [
    { key: "in_review", label: "Em análise", date: request.reviewedAt ?? request.requestedAt },
    { key: "processing", label: "Processando", date: request.processedAt },
    { key: "completed", label: "ConcluÃ­do", date: request.paidAt },
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
      toast.error("Preencha o nome fiscal e um NIF vÃ¡lido.");
      return;
    }
    if (payoutMethod === "iban" && !iban.trim()) {
      toast.error("Indique o IBAN para transferÃªncia.");
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
      toast.error("NÃ£o foi possÃ­vel guardar os dados financeiros.");
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
              label="TransferÃªncia bancÃ¡ria"
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
    completed: "ConcluÃ­do",
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
  return method === "mb_way" ? "MB WAY" : "TransferÃªncia bancÃ¡ria";
}

function formatCents(value: number, currency = "eur") {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(value / 100);
}

function formatDate(value?: string | null) {
  if (!value) return "Data não disponÃ­vel";
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


