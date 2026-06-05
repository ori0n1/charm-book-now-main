import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, Check, CreditCard, Loader2, ShieldCheck, Smartphone } from "lucide-react";
import { SiApplepay, SiGooglepay } from "react-icons/si";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { createBookingPaymentIntent, getPaymentStatus } from "@/lib/payments.functions";

type Props = {
  appointmentId?: string;
  bookingRequestId?: string;
  acceptedMethods: string[];
  totalPrice: number;
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

  const allowedMethods = acceptedMethods.filter(
    (item): item is PaymentMethod => item === "mb_way" || item === "card",
  );
  const hasCard = allowedMethods.includes("card");
  const hasMbWay = allowedMethods.includes("mb_way");

  const depositPct = intent?.deposit_percent ?? 100;
  const isDeposit = depositPct < 100;
  const remaining = formatMoney(intent?.remaining_cents ?? 0, intent?.currency ?? "eur");
  const expiresLabel = intent?.expires_at ? formatDateTime(intent.expires_at) : null;

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-6 sm:px-6">
      <div className="overflow-hidden rounded-[1.65rem] border border-border/80 bg-card shadow-xl shadow-black/5">
        <div className="border-b border-border/70 bg-muted/20 px-5 py-5 sm:px-6">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          Checkout seguro
        </div>
        <h2 className="mt-3 text-2xl font-light tracking-tight sm:text-[1.7rem]">
          {isDeposit ? "Pague o sinal para confirmar" : "Confirme o pagamento da reserva"}
        </h2>
        <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          O horário fica reservado enquanto conclui o pagamento.
        </p>
        </div>

        <div className="space-y-5 px-5 py-5 sm:px-6">
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
        </div>

        {policySummary && (
          <div className="rounded-2xl border border-border/70 bg-muted/25 p-4 text-xs leading-relaxed text-muted-foreground">
            <p className="font-semibold text-foreground">Sinal, cancelamento e reembolso</p>
            <p className="mt-1">{policySummary}</p>
          </div>
        )}

        {!intent && !expired && (
          <div className="space-y-3">
            {hasCard && (
              <PaymentMethodButton
                disabled={loading !== null}
                title="Apple Pay, Google Pay ou cartão"
                description="O checkout mostra automaticamente a opção mais rápida"
                loading={loading === "card"}
                onClick={() => start("card")}
                featured
                icon={
                  <div className="flex items-center gap-1.5">
                    <SiApplepay className="h-5 w-8" />
                    <SiGooglepay className="h-5 w-8" />
                    <CreditCard className="h-4 w-4" />
                  </div>
                }
              />
            )}
            {hasMbWay && (
              <PaymentMethodButton
                disabled={loading !== null}
                title="MB WAY"
                description="Confirme em segundos na app do seu banco"
                loading={loading === "mb_way"}
                onClick={() => start("mb_way")}
                icon={<Smartphone className="h-5 w-5" />}
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
    <div className={`flex items-center justify-between gap-3 ${className ?? ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground">{value}</span>
    </div>
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
      className={`flex w-full items-center justify-between gap-4 rounded-2xl border px-4 py-4 text-left text-sm shadow-sm transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-50 ${
        featured
          ? "border-emerald-500/30 bg-emerald-500/[0.08] shadow-emerald-950/5 hover:border-emerald-500/45 hover:bg-emerald-500/[0.12]"
          : "border-border bg-background/70 hover:border-foreground/20 hover:bg-muted"
      }`}
    >
      <span className="min-w-0">
        <span className="block font-semibold">{title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
      </span>
      <span className="grid min-w-16 place-items-center rounded-xl bg-background/75 px-2 py-1.5 text-foreground shadow-sm">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
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
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("pt-PT", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
