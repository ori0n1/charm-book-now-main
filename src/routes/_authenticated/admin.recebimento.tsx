import { createFileRoute, useSearch } from "@tanstack/react-router";
import { type ElementType, type ReactNode, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertCircle,
  ArrowUpRight,
  BadgeCheck,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Clock3,
  Copy,
  CreditCard,
  ExternalLink,
  FileText,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Wallet,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import {
  createConnectLoginLink,
  createConnectOnboardingLink,
  getConnectAccountStatus,
  syncConnectAccountStatus,
  type ConnectAccountStatus,
  type ConnectFinancialSummary,
  type ConnectStatusPayload,
} from "@/lib/stripe-connect.functions";
import { useCurrentStudio } from "@/hooks/use-current-studio";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/recebimento")({
  head: () => ({ meta: [{ title: "Recebimento de Sinal - Painel" }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    connect: typeof s.connect === "string" ? s.connect : undefined,
  }),
  component: RecebimentoPage,
});


type StatusConfig = {
  label: string;
  description: string;
  color: string;
  bg: string;
  icon: ElementType;
};

const STATUS_CONFIG: Record<ConnectAccountStatus, StatusConfig> = {
  not_connected: {
    label: "Não conectado",
    description: "Conecte a sua conta Stripe para receber os sinais dos clientes diretamente na sua conta.",
    color: "text-muted-foreground",
    bg: "bg-muted/40",
    icon: Wallet,
  },
  pending: {
    label: "A configurar",
    description: "Complete o registo na Stripe para ativar o recebimento.",
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-500/8",
    icon: Clock3,
  },
  pending_verification: {
    label: "Em verificação",
    description: "A Stripe está a verificar os seus documentos. Aguarde o e-mail de confirmação.",
    color: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-500/8",
    icon: ShieldCheck,
  },
  active: {
    label: "Recebimento ativo",
    description: "Os sinais dos clientes chegam diretamente à sua conta Stripe.",
    color: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-500/8",
    icon: BadgeCheck,
  },
  restricted: {
    label: "Ação necessária",
    description: "A Stripe precisa de informações adicionais. Aceda ao painel para resolver.",
    color: "text-red-600 dark:text-red-400",
    bg: "bg-red-500/8",
    icon: AlertCircle,
  },
};


function openExternalWindowPlaceholder() {
  if (typeof window === "undefined") return null;
  try {
    const opened = window.open("about:blank", "_blank");
    if (opened) {
      opened.opener = null;
    }
    return opened;
  } catch {
    return null;
  }
}

function openExternalUrl(url: string, pendingWindow: Window | null) {
  if (pendingWindow && !pendingWindow.closed) {
    pendingWindow.location.href = url;
    return;
  }
  window.location.assign(url);
}

function RecebimentoPage() {
  const { studio, loading: studioLoading } = useCurrentStudio();
  const studioId = studio?.id ?? null;
  const search = useSearch({ from: "/_authenticated/admin/recebimento" });
  const connectParam = (search as any).connect as string | undefined;

  const getStatusFn = useServerFn(getConnectAccountStatus);
  const syncStatusFn = useServerFn(syncConnectAccountStatus);
  const onboardFn = useServerFn(createConnectOnboardingLink);
  const loginLinkFn = useServerFn(createConnectLoginLink);

  const [status, setStatus] = useState<ConnectStatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [showAllRecentPayments, setShowAllRecentPayments] = useState(false);

  // Ref to cancel in-flight async calls on unmount / studioId change
  const cancelRef = useRef(false);

  function loadStatus(stId: string, shouldSync: boolean) {
    cancelRef.current = false;
    setLoading(true);
    setError(null);

    // Hard timeout: 12 seconds
    const timeoutId = setTimeout(() => {
      if (!cancelRef.current) {
        cancelRef.current = true;
        setLoading(false);
        setError("A ligação está a demorar demasiado. Verifique a sua ligação e tente atualizar.");
      }
    }, 12_000);

    (async () => {
      try {
        const result = shouldSync
          ? await syncStatusFn({ data: { studioId: stId } })
          : await getStatusFn({ data: { studioId: stId } });

        if (cancelRef.current) return;
        setStatus(result);

        if (connectParam === "success" && result.chargesEnabled) {
          toast.success("Conta Stripe conectada. Os sinais vão diretamente para si.");
        } else if (connectParam === "success") {
          toast.info("A Stripe está a verificar os seus dados. Aguarde o e-mail de confirmação.");
        }
      } catch {
        if (!cancelRef.current) {
          setError("Não foi possível carregar o estado da conta. Tente atualizar ou conectar novamente.");
        }
      } finally {
        clearTimeout(timeoutId);
        if (!cancelRef.current) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelRef.current = true;
      clearTimeout(timeoutId);
    };
  }

  // Load status once studioId is known. While the studio query is still in-flight,
  // keep loading=true silently (no timeout). Only start the timeout after the
  // studio query resolves but still returns no studio (e.g. no role assigned).
  useEffect(() => {
    // Studio query still loading - stay in loading state, do nothing
    if (studioLoading) return;

    // Studio query resolved but no studio found (no role / wrong account)
    if (!studioId) {
      const waitTimeout = setTimeout(() => {
        setLoading(false);
        setError("Não foi possível identificar o estúdio. Certifique-se de que tem sessão iniciada e recarregue a página.");
      }, 500); // very short - studio query already finished, this is a real miss
      return () => clearTimeout(waitTimeout);
    }

    const shouldSync = connectParam === "success" || connectParam === "refresh";
    return loadStatus(studioId, shouldSync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioId, studioLoading, connectParam]);

  function extractErrorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === "string") return err;
    try { return JSON.stringify(err); } catch { return "Erro desconhecido"; }
  }

  async function handleConnect() {
    if (!studioId) return;
    setActionLoading(true);
    setError(null);
    try {
      const { url } = await onboardFn({ data: { studioId } });
      // Redirect to Stripe onboarding; page will unmount, no setActionLoading(false) needed.
      window.location.href = url;
    } catch (err) {
      const msg = extractErrorMessage(err);
      console.error("[recebimento] handleConnect failed:", msg);
      setError("Não foi possível iniciar a ligação à Stripe. Tente novamente.");
      setActionLoading(false);
    }
  }

  async function handleManage() {
    if (!studioId) return;
    const pendingWindow = openExternalWindowPlaceholder();
    setActionLoading(true);
    try {
      const { url } = await loginLinkFn({ data: { studioId } });
      openExternalUrl(url, pendingWindow);
    } catch (err) {
      pendingWindow?.close();
      const msg = extractErrorMessage(err);
      console.error("[recebimento] handleManage failed:", msg);
      toast.error("Não foi possível abrir o painel Stripe. Tente novamente.");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRefresh() {
    if (!studioId) return;
    setActionLoading(true);
    setError(null);
    try {
      const result = await syncStatusFn({ data: { studioId } });
      setStatus(result);
      toast.success("Estado atualizado.");
    } catch (err) {
      const msg = extractErrorMessage(err);
      console.error("[recebimento] handleRefresh failed:", msg);
      setError("Não foi possível atualizar o estado. Tente novamente.");
    } finally {
      setActionLoading(false);
    }
  }

  const currentStatus: ConnectAccountStatus = status?.status ?? "not_connected";
  const cfg = STATUS_CONFIG[currentStatus];
  const StatusIcon = cfg.icon;
  const isActive = currentStatus === "active";
  const isConnected = !!status?.accountId;
  const needsAction = currentStatus === "restricted" || currentStatus === "pending";
  const financial = status?.financial;
  const recentPayments = financial?.recentPayments ?? [];
  const hasMoreRecentPayments = recentPayments.length > 4;
  const visibleRecentPayments = showAllRecentPayments ? recentPayments : recentPayments.slice(0, 4);
  const effectiveFeeLabel = getEffectiveStripeFeeLabel(
    financial?.grossReceivedCents ?? 0,
    financial?.stripeFeesCents ?? 0,
  );

  return (
    <div className="space-y-3 pb-6 xl:mx-auto xl:max-w-[88rem]">
      <section className="rounded-[1.25rem] border border-border bg-card p-4 shadow-sm md:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="grid size-8 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <CreditCard className="h-4 w-4" />
              </span>
              <span className="text-[10px] font-black uppercase tracking-[0.18em]">Stripe Connect</span>
            </div>
            <h1 className="mt-2 text-xl font-extrabold tracking-tight md:text-2xl">Recebimentos pela Stripe</h1>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground md:text-sm">
              Acompanhe sinais pagos online, taxas e valores líquidos recebidos pelo estúdio.
            </p>
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading || actionLoading}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 text-xs font-bold text-muted-foreground transition hover:text-foreground disabled:opacity-40"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", (loading || actionLoading) && "animate-spin")} />
            Atualizar
          </button>
        </div>
      </section>

      {loading && (
        <section className="rounded-[1.25rem] border border-border bg-card p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-4">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="h-24 animate-pulse rounded-2xl bg-muted/60" />
            ))}
          </div>
          <div className="mt-4 flex items-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            A carregar recebimentos
          </div>
        </section>
      )}

      {!loading && error && (
        <section className="rounded-[1.25rem] border border-red-200/60 bg-red-50/70 p-4 shadow-sm dark:border-red-800/30 dark:bg-red-900/10">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-red-700 dark:text-red-300">Não foi possível carregar</p>
              <p className="mt-1 text-xs leading-relaxed text-red-600/80 dark:text-red-400/80">{error}</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <ActionButton variant="secondary" onClick={handleRefresh} disabled={actionLoading} icon={RefreshCw}>
              Tentar novamente
            </ActionButton>
            <ActionButton onClick={handleConnect} disabled={actionLoading} icon={actionLoading ? Loader2 : Zap}>
              Ativar recebimento
            </ActionButton>
          </div>
        </section>
      )}

      {!loading && !error && (
        <>
          <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <MetricCard
              icon={Wallet}
              label="Saldo disponível"
              value={formatMoneyCents(financial?.availableCents ?? 0, financial?.currency)}
              detail="Já pode ser transferido."
              tone="emerald"
            />
            <MetricCard
              icon={Clock3}
              label="Bruto recebido"
              value={formatMoneyCents(financial?.grossReceivedCents ?? 0, financial?.currency)}
              detail="Antes das taxas."
              tone="amber"
            />
            <MetricCard
              icon={BadgeCheck}
              label="Taxas Stripe"
              value={formatMoneyCents(financial?.stripeFeesCents ?? 0, financial?.currency)}
              detail={effectiveFeeLabel ?? "Valor descontado."}
              tone="blue"
            />
            <MetricCard
              icon={CreditCard}
              label="Líquido recebido"
              value={formatMoneyCents(financial?.netReceivedCents ?? 0, financial?.currency)}
              detail={
                financial?.pendingFinancialDetailsCount
                  ? `${financial.pendingFinancialDetailsCount} registo${financial.pendingFinancialDetailsCount === 1 ? "" : "s"} em atualização.`
                  : "Bruto menos taxas da Stripe."
              }
              tone="neutral"
            />
          </section>

          <section className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_25rem]">
            <div className="rounded-[1.35rem] border border-border bg-card p-4 shadow-sm md:p-5">
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                <div className="flex min-w-0 gap-3">
                  <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", cfg.bg)}>
                    <StatusIcon className={cn("h-5 w-5", cfg.color)} />
                  </span>
                  <div className="min-w-0">
                    <p className={cn("text-sm font-extrabold", cfg.color)}>{cfg.label}</p>
                    <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">{cfg.description}</p>
                  </div>
                </div>
                <div className="flex w-full flex-col gap-2 md:w-auto md:min-w-[13rem] md:items-end">
                  {isActive ? (
                    <ActionButton
                      onClick={handleManage}
                      disabled={actionLoading}
                      icon={actionLoading ? Loader2 : ExternalLink}
                      className="w-full md:min-w-40"
                    >
                      Gerir Stripe
                    </ActionButton>
                  ) : (
                    <ActionButton
                      onClick={handleConnect}
                      disabled={actionLoading}
                      icon={actionLoading ? Loader2 : Zap}
                      className="w-full md:min-w-44"
                    >
                      {isConnected ? "Continuar configuração" : "Ativar recebimento"}
                    </ActionButton>
                  )}
                  {isConnected && !isActive && (
                    <ActionButton
                      variant="secondary"
                      onClick={handleManage}
                      disabled={actionLoading}
                      icon={ArrowUpRight}
                      className="w-full md:w-auto"
                    >
                      Painel Stripe
                    </ActionButton>
                  )}
                </div>
              </div>

              {isConnected ? (
                <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
                  <InfoChip label="Pagamentos" value={status?.chargesEnabled ? "Ativos" : "Inativos"} ok={status?.chargesEnabled} />
                  <InfoChip label="MB WAY" value={status?.mbWayPaymentsEnabled ? "Ativo" : "Inativo"} ok={status?.mbWayPaymentsEnabled} />
                  <InfoChip label="Repasses" value={status?.payoutsEnabled ? "Ativos" : "Inativos"} ok={status?.payoutsEnabled} />
                  <InfoChip label="Registo" value={status?.onboardingCompleted ? "Completo" : "Incompleto"} ok={status?.onboardingCompleted} />
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-dashed border-border bg-muted/20 p-4 text-sm leading-relaxed text-muted-foreground">
                  Conecte uma conta Stripe para receber sinais online diretamente na conta do estúdio. O processo costuma demorar poucos minutos.
                </div>
              )}
            </div>

            <StripeTransferCard financial={financial} />
          </section>

          {needsAction && (
            <section className="rounded-[1.35rem] border border-amber-200/70 bg-amber-50/70 p-4 shadow-sm dark:border-amber-800/30 dark:bg-amber-900/10">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div>
                  <p className="text-sm font-bold text-amber-700 dark:text-amber-300">
                    {currentStatus === "restricted" ? "A Stripe precisa de mais informações" : "Configuração incompleta"}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-amber-700/80 dark:text-amber-300/80">
                    Complete os dados no painel Stripe para ativar totalmente os recebimentos online.
                  </p>
                </div>
              </div>
            </section>
          )}

          <section className="grid gap-3">
            <div className="rounded-[1.8rem] border border-border bg-card p-4 shadow-sm md:p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-2xl font-black tracking-tight text-foreground md:text-3xl">Últimos recebimentos</h2>
                  <p className="mt-1.5 text-sm font-medium text-muted-foreground md:text-base">Sinais online confirmados recentemente.</p>
                </div>
                {hasMoreRecentPayments && (
                  <button
                    type="button"
                    onClick={() => setShowAllRecentPayments((value) => !value)}
                    className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-2xl border border-border bg-background px-4 text-sm font-extrabold text-emerald-700 shadow-sm transition hover:border-emerald-500/40 hover:bg-emerald-500/5 dark:text-emerald-300"
                  >
                    <FileText className="h-5 w-5" />
                    {showAllRecentPayments ? "Ver menos" : "Ver todos"}
                  </button>
                )}
              </div>
              <div className="mt-5">
                {recentPayments.length ? (
                  <div className="space-y-3">
                    {visibleRecentPayments.map((payment) => (
                      <PaymentRow key={payment.id} payment={payment} />
                    ))}
                  </div>
                ) : (
                  <EmptyState />
                )}
              </div>
            </div>

            <div className="grid gap-3 xl:grid-cols-2">
              <CompactDetails
                icon={Zap}
                title="Como funciona"
                description="Veja o fluxo dos sinais online em poucos passos."
              >
                <StepRow n={1} icon={Zap} title="Conta conectada" body="A pessoa responsável liga ou cria uma conta Stripe Express para receber pagamentos online." />
                <StepRow n={2} icon={CreditCard} title="Sinal pago online" body="Quando o sinal é pago, o valor é processado pela Stripe e associado à reserva." />
                <StepRow n={3} icon={CheckCircle2} title="Repasse automático" body="A Stripe disponibiliza e transfere o valor conforme o calendário da conta conectada." />
              </CompactDetails>
              <CompactDetails
                icon={FileText}
                title="Perguntas frequentes"
                description="Respostas rápidas sobre recebimentos online."
              >
                <FaqRow q="O Bellza processa ou guarda este dinheiro?" a="Não. Os pagamentos são processados pela Stripe e transferidos diretamente para a conta conectada do estúdio." />
                <FaqRow q="Quanto tempo demora para ficar disponível?" a="Normalmente alguns dias, dependendo do país, da conta conectada e das configurações da Stripe." />
                <FaqRow q="O Bellza cobra percentagem do sinal?" a="Não. O Bellza apenas apresenta os registos financeiros da plataforma." />
              </CompactDetails>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function ActionButton({
  children,
  icon: Icon,
  onClick,
  disabled,
  variant = "primary",
  className,
}: {
  children: ReactNode;
  icon: ElementType;
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary";
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-[13px] font-bold transition disabled:opacity-45 sm:min-h-10 sm:px-3.5 sm:text-xs",
        variant === "primary"
          ? "bg-foreground text-background hover:opacity-90"
          : "border border-border bg-background text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", disabled && Icon === Loader2 && "animate-spin")} />
      {children}
    </button>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: ElementType;
  label: string;
  value: string;
  detail: string;
  tone: "emerald" | "amber" | "blue" | "neutral";
}) {
  const toneClass = {
    emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    neutral: "bg-muted text-muted-foreground",
  }[tone];
  return (
    <article className="min-w-0 rounded-[1.1rem] border border-border bg-card p-3 shadow-sm md:p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[9px] font-black uppercase tracking-[0.12em] text-muted-foreground sm:text-[10px]">{label}</p>
          <p className="mt-1.5 whitespace-nowrap text-lg font-extrabold tracking-tight text-foreground sm:text-xl md:text-2xl">{value}</p>
        </div>
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-xl", toneClass)}>
          <Icon className="h-3.5 w-3.5" />
        </span>
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground sm:text-xs">{detail}</p>
    </article>
  );
}

function StripeTransferCard({ financial }: { financial?: ConnectFinancialSummary }) {
  const payout = financial?.payout;
  const lastPayout = payout?.lastPayoutAt ? formatDate(payout.lastPayoutAt) : null;
  const nextPayout = payout?.nextPayoutAt ? formatDate(payout.nextPayoutAt) : null;
  const schedule = payout?.scheduleLabel ?? "Calendário não informado pela Stripe";
  const availabilityText = buildPayoutAvailabilityText(payout?.scheduleLabel);
  return (
    <article className="rounded-[1.35rem] border border-border bg-card p-4 shadow-sm md:p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-extrabold text-foreground">Repasses pela Stripe</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{availabilityText}</p>
        </div>
      </div>
      <div className="mt-4 grid gap-2">
        <MiniFact label="Frequência" value={schedule} />
        <MiniFact label="Próximo repasse" value={nextPayout ?? "A Stripe não informou uma data prevista"} />
        <MiniFact label="Último repasse" value={lastPayout ?? "Ainda sem repasse registado"} />
        {payout?.lastPayoutAmountCents != null && (
          <MiniFact label="Valor" value={formatMoneyCents(payout.lastPayoutAmountCents, financial?.currency)} />
        )}
      </div>
    </article>
  );
}

function MiniFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-background/60 px-3 py-2">
      <span className="text-[10px] font-black uppercase tracking-[0.12em] text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right text-xs font-bold leading-snug text-foreground">{value}</span>
    </div>
  );
}

function PaymentRow({
  payment,
}: {
  payment: ConnectFinancialSummary["recentPayments"][number];
}) {
  const gross = getPaymentGrossCents(payment);
  const stripeFee = getPaymentStripeFeeCents(payment);
  const net = getPaymentNetCents(payment);
  const transactionId =
    payment.stripeBalanceTransactionId ?? payment.stripeChargeId ?? payment.stripePaymentIntentId;

  const copyTransactionId = async () => {
    if (!transactionId) return;
    try {
      await navigator.clipboard.writeText(transactionId);
      toast.success("Transação copiada.");
    } catch {
      toast.error("Não foi possível copiar a transação.");
    }
  };

  return (
    <article className="overflow-hidden rounded-[1.35rem] border border-zinc-200 bg-white px-4 py-3 shadow-[0_10px_28px_rgba(15,23,42,0.04)] dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300 md:size-11">
          <span className="grid size-6 place-items-center rounded-full border-2 border-current md:size-7">
            <CheckCircle2 className="h-4 w-4 md:h-5 md:w-5" />
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
            <p className="whitespace-nowrap text-sm font-black leading-tight text-zinc-950 dark:text-zinc-50 sm:text-base md:text-lg">
              Sinal recebido via {formatPaymentMethod(payment.method)}
            </p>
            <p className="whitespace-nowrap text-base font-black leading-tight text-emerald-600 dark:text-emerald-300 md:text-lg">
              {formatMoneyCents(gross, payment.currency)}
            </p>
          </div>
          <p className="mt-1 flex min-w-0 items-center gap-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">
            <Clock3 className="h-4 w-4 shrink-0" />
            <span>{formatDate(payment.createdAt)}</span>
          </p>
        </div>
        <ChevronRight className="mt-2 hidden h-5 w-5 shrink-0 text-zinc-400 sm:block" />
      </div>

      <div className="mt-3 grid grid-cols-3 border-y border-zinc-200 py-2.5 dark:border-zinc-800">
        <PaymentAmountBox label="Bruto" value={formatMoneyCents(gross, payment.currency)} />
        <PaymentAmountBox
          label="Taxa Stripe"
          value={formatMoneyCents(stripeFee, payment.currency)}
          tone="fee"
        />
        <PaymentAmountBox
          label="Líquido"
          value={formatMoneyCents(net, payment.currency)}
          tone="success"
        />
      </div>

      {transactionId && (
        <div className="mt-2 flex min-w-0 items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 md:text-sm">
          <p className="min-w-0 whitespace-nowrap leading-relaxed">
            <span className="font-semibold">Transação:</span> {transactionId}
          </p>
          <button
            type="button"
            onClick={copyTransactionId}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 transition hover:border-emerald-500/40 hover:text-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400"
            aria-label="Copiar transação Stripe"
            title="Copiar transação"
          >
            <Copy className="h-4 w-4" />
          </button>
        </div>
      )}
    </article>
  );
}

function PaymentAmountBox({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail?: string | null;
  tone?: "success" | "fee";
}) {
  return (
    <div
      className={cn(
        "min-w-0 border-l border-zinc-200 px-1.5 text-center first:border-l-0 dark:border-zinc-800 sm:px-4",
        tone === "success" && "px-2 sm:px-4",
      )}
    >
      <div
        className={cn(
          "min-w-0 rounded-2xl px-0 py-0",
          tone === "success" && "bg-emerald-50 px-2 py-2 dark:bg-emerald-950/40 sm:px-3",
        )}
      >
        <p className="whitespace-nowrap text-[11px] font-medium leading-snug text-zinc-500 dark:text-zinc-400 sm:text-xs md:text-sm">{label}</p>
      <p
        className={cn(
          "mt-1.5 whitespace-nowrap text-[13px] font-black leading-tight text-zinc-950 dark:text-zinc-50 sm:text-lg",
          tone === "success" && "text-emerald-700 dark:text-emerald-300",
          tone === "fee" && "text-orange-600 dark:text-orange-400",
        )}
      >
          {value}
          {detail && <span className="ml-1 text-[11px] font-bold text-orange-600 dark:text-orange-400 sm:ml-2 sm:text-xs">({detail})</span>}
        </p>
      </div>
    </div>
  );
}

function getPaymentGrossCents(payment: ConnectFinancialSummary["recentPayments"][number]) {
  return Number(payment.grossAmountCents ?? payment.amountCents ?? 0);
}

function getPaymentStripeFeeCents(payment: ConnectFinancialSummary["recentPayments"][number]) {
  if (payment.stripeFeeCents != null) return Number(payment.stripeFeeCents);
  if (payment.netAmountCents != null) return Math.max(0, getPaymentGrossCents(payment) - Number(payment.netAmountCents));
  return estimateStripeFeeCents(getPaymentGrossCents(payment));
}

function getPaymentNetCents(payment: ConnectFinancialSummary["recentPayments"][number]) {
  if (payment.netAmountCents != null) return Number(payment.netAmountCents);
  const fee = getPaymentStripeFeeCents(payment);
  if (fee != null) return Math.max(0, getPaymentGrossCents(payment) - fee);
  return getPaymentGrossCents(payment);
}

function getEffectiveStripeFeeLabel(grossCents: number, feeCents: number) {
  if (!grossCents || !feeCents) return "Taxa média indisponível.";
  const percent = (feeCents / grossCents) * 100;
  return `Taxa média efetiva ${percent.toFixed(2).replace(".", ",")}%.`;
}

function buildPayoutAvailabilityText(scheduleLabel?: string | null) {
  const label = String(scheduleLabel ?? "").toLowerCase();
  const delayMatch = label.match(/(\d+)\s+dias?/);
  if (delayMatch) {
    return `Os pagamentos ficam disponíveis cerca de ${delayMatch[1]} dias após a cobrança. Depois, a Stripe repassa conforme o calendário da conta.`;
  }
  if (label.includes("manual")) {
    return "Os pagamentos ficam na Stripe até serem transferidos manualmente no painel Stripe.";
  }
  return "A Stripe informa a disponibilidade e realiza os repasses conforme o calendário da conta conectada.";
}

function estimateStripeFeeCents(grossCents: number) {
  return Math.max(0, Math.round(Number(grossCents || 0) * 0.065));
}



function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-5 text-center">
      <p className="text-sm font-bold text-foreground">Ainda sem recebimentos confirmados</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Quando um sinal online for pago, o registo aparece aqui automaticamente.
      </p>
    </div>
  );
}

function CompactDetails({
  icon: Icon,
  title,
  description,
  children,
  defaultOpen,
}: {
  icon: ElementType;
  title: string;
  description: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} className="group overflow-hidden rounded-[1.2rem] border border-border bg-card shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 text-sm font-extrabold tracking-tight md:px-5 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted/60 text-muted-foreground">
            <Icon className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-extrabold text-foreground">{title}</span>
            <span className="mt-0.5 block text-xs font-medium text-muted-foreground">{description}</span>
          </span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition group-open:rotate-180" />
      </summary>
      <div className="space-y-2 border-t border-border/60 p-3 md:p-4">{children}</div>
    </details>
  );
}

function formatMoneyCents(cents: number, currency = "eur") {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: (currency || "eur").toUpperCase(),
  }).format(Number(cents || 0) / 100);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatPaymentMethod(method?: string | null) {
  if (method === "mb_way") return "MB Way";
  if (method === "card") return "Cartão";
  if (!method) return "Pagamento online";
  return method.replace(/_/g, " ");
}

function InfoChip({ label, value, ok }: { label: string; value: string; ok?: boolean | null }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border/60 bg-background/60 px-3 py-2">
      <span className="shrink-0">
        {ok ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        ) : (
          <XCircle className="h-4 w-4 text-muted-foreground/40" />
        )}
      </span>
      <div className="min-w-0">
        <p className="whitespace-nowrap text-[10px] font-black uppercase tracking-[0.1em] text-muted-foreground/70">{label}</p>
        <p className={cn("mt-0.5 whitespace-nowrap text-xs font-extrabold", ok ? "text-foreground" : "text-muted-foreground")}>{value}</p>
      </div>
    </div>
  );
}

function StepRow({
  n,
  icon: Icon,
  title,
  body,
}: {
  n: number;
  icon: ElementType;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-4 px-4 py-4 md:px-5">
      <span className="grid size-8 shrink-0 place-items-center rounded-xl border border-border bg-muted/40 text-xs font-bold text-muted-foreground">
        {n}
      </span>
      <div className="flex-1">
        <p className="text-sm font-medium tracking-tight">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{body}</p>
      </div>
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/40" />
    </div>
  );
}

function FaqRow({ q, a }: { q: string; a: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-background/60 px-4 py-4">
      <p className="text-sm font-extrabold leading-snug text-foreground">{q}</p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground md:text-sm">{a}</p>
    </div>
  );
}
