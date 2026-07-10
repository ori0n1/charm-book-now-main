import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, Check, CreditCard, Loader2, ShieldCheck, Smartphone } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { createBookingPaymentIntent, getPaymentStatus } from "@/lib/payments.functions";

type Props = {
  appointmentId?: string;
  bookingRequestId?: string;
  acceptedMethods: string[];
  totalPrice: number;
  reservationSummary?: {
    service: string;
    professional: string;
    date: string;
    time: string;
    clientName: string;
    clientPhone: string;
    depositLabel: string;
  };
  policySummary?: string;
  onConfirmed: () => void;
  onCancel: () => void;
};

type PaymentMethod = "card" | "mb_way";

type IntentInfo = {
  method: PaymentMethod;
  status: string;
  checkout_url?: string | null;
  amount_cents: number;
  total_cents?: number;
  deposit_percent?: number;
  remaining_cents?: number;
  currency: string;
  expires_at: string | null;
};

type StatusResponse = {
  appointmentStatus: string | null;
  reservationStatus?: string | null;
  payment: (IntentInfo & { status: string }) | null;
};

export function PaymentPendingView({
  appointmentId,
  bookingRequestId,
  acceptedMethods,
  totalPrice,
  reservationSummary,
  policySummary,
  onConfirmed,
  onCancel,
}: Props) {
  const createIntent = useServerFn(createBookingPaymentIntent);
  const checkStatus = useServerFn(getPaymentStatus);
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [intent, setIntent] = useState<IntentInfo | null>(null);
  const [loading, setLoading] = useState<PaymentMethod | null>(null);
  const [polling, setPolling] = useState(false);
  const [expired, setExpired] = useState(false);

  const targetPayload = useMemo(
    () =>
      bookingRequestId
        ? { bookingRequestId }
        : appointmentId
          ? { appointmentId }
          : null,
    [appointmentId, bookingRequestId],
  );

  useEffect(() => {
    if (!intent || intent.status === "succeeded" || !targetPayload || expired) return;
    const activeIntent = intent;
    let stopped = false;
    setPolling(true);

    async function tick() {
      if (stopped) return;
      if (activeIntent.expires_at && new Date(activeIntent.expires_at).getTime() <= Date.now()) {
        setExpired(true);
        setPolling(false);
        toast.error("O prazo de pagamento terminou. O horário voltou a ficar disponível.");
        return;
      }

      try {
        const res = (await checkStatus({ data: targetPayload })) as StatusResponse;
        if (
          res.appointmentStatus === "confirmed" ||
          res.reservationStatus === "confirmed" ||
          res.payment?.status === "succeeded"
        ) {
          stopped = true;
          setPolling(false);
          toast.success("Pagamento confirmado. Horário reservado com sucesso.");
          onConfirmed();
          return;
        }

        if (isTerminalFailure(res.payment?.status) || isTerminalFailure(res.reservationStatus)) {
          stopped = true;
          setPolling(false);
          setExpired(res.payment?.status === "expired" || res.reservationStatus === "expired");
          toast.error("O pagamento não foi confirmado. O horário voltou a ficar disponível.");
          setIntent(null);
          setMethod(null);
        }
      } catch {
        // Transient polling failures should not interrupt the customer.
      }
    }

    void tick();
    const interval = window.setInterval(tick, 4000);
    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [intent, targetPayload, checkStatus, onConfirmed, expired]);

  async function start(nextMethod: PaymentMethod) {
    if (!targetPayload) {
      toast.error("Reserva inválida. Recomece a marcação.");
      return;
    }
    setMethod(nextMethod);
    setExpired(false);
    setLoading(nextMethod);
    try {
      const res = (await createIntent({
        data: { ...targetPayload, method: nextMethod },
      })) as IntentInfo & { payment_intent_id: string };

      if (isTerminalFailure(res.status)) {
        throw new Error("O pagamento não pôde ser iniciado. O horário voltou a ficar disponível.");
      }

      if (!res.checkout_url) {
        throw new Error("Não foi possível abrir o checkout seguro. Tente novamente.");
      }

      setMethod(res.method);
      setIntent(res);
      toast.message("A abrir checkout seguro...");
      window.location.assign(res.checkout_url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao iniciar pagamento.");
      setMethod(null);
      setIntent(null);
    } finally {
      setLoading(null);
    }
  }

  const acceptedSet = new Set(acceptedMethods);
  const allowedMethods: PaymentMethod[] = (["card", "mb_way"] as PaymentMethod[]).filter((item) =>
    acceptedSet.has(item),
  );
  const hasCard = allowedMethods.includes("card");
  const hasMbWay = allowedMethods.includes("mb_way");

  const depositPct = intent?.deposit_percent ?? 100;
  const isDeposit = depositPct < 100;
  const remaining = formatMoney(intent?.remaining_cents ?? 0, intent?.currency ?? "eur");
  const expiresLabel = intent?.expires_at ? formatDateTime(intent.expires_at) : null;

  return (
    <div className="mx-auto w-full max-w-lg overflow-x-hidden px-3 py-5 sm:px-6">
      <div className="overflow-hidden rounded-[1.35rem] border border-border/80 bg-card shadow-xl shadow-black/5 sm:rounded-[1.65rem]">
        <div className="border-b border-border/70 bg-muted/20 px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          Checkout seguro
        </div>
        <h2 className="mt-3 text-xl font-semibold tracking-tight sm:text-[1.7rem]">
          {isDeposit ? "Pague o sinal para confirmar" : "Pagamento integral do serviço"}
        </h2>
        <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          O horário fica reservado enquanto conclui o pagamento.
        </p>
        </div>

        <div className="space-y-3 px-4 py-4 sm:px-6 sm:py-5">
          {reservationSummary && (
            <div className="overflow-hidden rounded-[1.1rem] border border-border/80 bg-background/70 p-3 text-sm shadow-sm sm:p-4">
              <SummaryRow label="Serviço" value={reservationSummary.service} />
              <SummaryRow className="mt-3" label="Profissional" value={reservationSummary.professional} />
              <SummaryRow className="mt-3" label="Data" value={reservationSummary.date} />
              <SummaryRow className="mt-3" label="Hora" value={reservationSummary.time} />
              <SummaryRow className="mt-3" label="Cliente" value={reservationSummary.clientName} />
              <SummaryRow className="mt-3" label="WhatsApp" value={reservationSummary.clientPhone} />
              <SummaryRow className="mt-3" label={isDeposit ? "Sinal" : "Pagamento"} value={reservationSummary.depositLabel} />
            </div>
          )}

        <div className="rounded-2xl border border-border/80 bg-background/70 p-4 text-sm shadow-sm">
          <SummaryRow label="Total do serviço" value={formatMoney(totalPrice * 100, "eur")} />
          {intent && isDeposit && (
            <>
              <SummaryRow
                className="mt-3"
                label="Sinal agora"
                value={`${formatMoney(intent.amount_cents, intent.currency)} (${depositPct}%)`}
              />
              <SummaryRow className="mt-3" label="Restante no estúdio" value={remaining} />
            </>
          )}
          {intent && !isDeposit && (
            <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
              Serviço pago integralmente online. Não há valor a pagar no estúdio.
            </p>
          )}
        </div>

        {policySummary && (
          <div className="rounded-[1.1rem] border border-border/70 bg-muted/25 p-3 text-xs leading-relaxed text-muted-foreground sm:p-4">
            <p className="font-semibold text-foreground">{isDeposit ? "Sinal, cancelamento e reembolso" : "Pagamento e cancelamento"}</p>
            <p className="mt-1">{policySummary}</p>
          </div>
        )}

        {!intent && !expired && (
          <div className="space-y-3">
            {hasCard && (
              <PaymentMethodButton
                disabled={loading !== null}
                title="Cartão de crédito / débito"
                description="Visa · Mastercard · Pagamento 3D Secure"
                loading={loading === "card"}
                onClick={() => start("card")}
                icon={<CardLogo />}
              />
            )}
            {hasMbWay && (
              <PaymentMethodButton
                disabled={loading !== null}
                title="MB WAY"
                description="Confirme na app do banco em segundos."
                loading={loading === "mb_way"}
                onClick={() => start("mb_way")}
                icon={<MbWayLogo />}
              />
            )}
            {allowedMethods.length === 0 && (
              <ErrorPanel text="Este estúdio ainda não tem métodos de pagamento online disponíveis." />
            )}
          </div>
        )}

        {expired && (
          <div className="space-y-3">
            <ErrorPanel text="O prazo de pagamento terminou. Escolha novamente o horário para garantir disponibilidade." />
            <button
              onClick={onCancel}
              className="w-full rounded-xl bg-foreground px-4 py-3 text-sm font-semibold text-background transition hover:opacity-90"
            >
              Escolher outro horário
            </button>
          </div>
        )}

        {intent && !expired && (
          <div className="space-y-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm">
            <p>Aguardamos a confirmação do checkout seguro para fechar a reserva.</p>
            {expiresLabel && <p className="text-xs text-muted-foreground">Pedido válido até {expiresLabel}.</p>}
            {polling && <StatusLine text="A confirmar pagamento..." compact />}
          </div>
        )}

        {!expired && (
          <button onClick={onCancel} className="w-full rounded-xl px-4 py-2 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground">
            Cancelar reserva
          </button>
        )}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-center gap-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        <Check className="h-3 w-3" /> Pagamento seguro
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={`grid min-w-0 grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] items-start gap-3 ${className ?? ""}`}>
      <span className="min-w-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 overflow-hidden text-ellipsis break-words text-right font-semibold text-foreground" title={value}>
        {value}
      </span>
    </div>
  );
}

/* ── Payment logos ─────────────────────────────────────── */
function MbWayLogo() {
  return (
    <svg viewBox="0 0 64 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-8 w-auto">
      <rect width="64" height="40" rx="6" fill="#E3001B"/>
      <text x="8" y="27" fontFamily="Arial,sans-serif" fontWeight="900" fontSize="15" fill="white" letterSpacing="-0.5">MB</text>
      <text x="32" y="27" fontFamily="Arial,sans-serif" fontWeight="700" fontSize="11" fill="white" letterSpacing="0">WAY</text>
      <circle cx="56" cy="20" r="4" fill="white" fillOpacity="0.25"/>
    </svg>
  );
}

function CardLogo() {
  return (
    <span className="flex items-center gap-1">
      {/* Visa */}
      <svg viewBox="0 0 38 24" xmlns="http://www.w3.org/2000/svg" className="h-5 w-auto">
        <rect width="38" height="24" rx="4" fill="#1A1F71"/>
        <text x="4" y="17" fontFamily="Arial,sans-serif" fontWeight="900" fontSize="11" fill="#F7A600" letterSpacing="-0.5">VISA</text>
      </svg>
      {/* Mastercard */}
      <svg viewBox="0 0 38 24" xmlns="http://www.w3.org/2000/svg" className="h-5 w-auto">
        <rect width="38" height="24" rx="4" fill="#252525"/>
        <circle cx="14" cy="12" r="8" fill="#EB001B"/>
        <circle cx="24" cy="12" r="8" fill="#F79E1B"/>
        <path d="M19 5.8a8 8 0 010 12.4A8 8 0 0119 5.8z" fill="#FF5F00"/>
      </svg>
    </span>
  );
}

function PaymentMethodButton({
  disabled,
  title,
  description,
  icon,
  loading,
  onClick,
  featured = false,
}: {
  disabled: boolean;
  title: string;
  description: string;
  icon: ReactNode;
  loading: boolean;
  onClick: () => void;
  featured?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[1.1rem] border px-3 py-3 text-left text-sm shadow-sm transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-50 ${
        featured
          ? "border-emerald-500/30 bg-emerald-500/[0.08] shadow-emerald-950/5 hover:border-emerald-500/45 hover:bg-emerald-500/[0.12]"
          : "border-border bg-background/70 hover:border-foreground/20 hover:bg-muted"
      }`}
    >
      <span className="min-w-0">
        <span className="block truncate font-semibold">{title}</span>
        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{description}</span>
      </span>
      <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-background/75 shadow-sm">
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-foreground" /> : icon}
      </span>
    </button>
  );
}

function StatusLine({ text, compact }: { text: string; compact?: boolean }) {
  return (
    <div className={`flex items-center gap-2 text-muted-foreground ${compact ? "text-xs" : "text-sm"}`}>
      <Loader2 className="h-4 w-4 animate-spin" />
      {text}
    </div>
  );
}

function ErrorPanel({ text }: { text: string }) {
  return (
    <div className="flex gap-2 rounded-2xl border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{text}</p>
    </div>
  );
}

function isTerminalFailure(status?: string | null) {
  return status === "failed" || status === "canceled" || status === "expired";
}

function formatMoney(cents: number, currency: string) {
  const amount = (cents / 100).toLocaleString("pt-PT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${amount}${currency.toLowerCase() === "eur" ? "\u20ac" : currency.toUpperCase()}`;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("pt-PT", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
