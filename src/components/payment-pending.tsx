import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Copy, Loader2, ShieldCheck } from "lucide-react";
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

type PaymentMethod = "mb_way" | "multibanco";

type IntentInfo = {
  method: PaymentMethod;
  status: string;
  client_secret: string | null;
  mb_way_phone?: string | null;
  checkout_url?: string | null;
  multibanco_entity: string | null;
  multibanco_reference: string | null;
  amount_cents: number;
  total_cents?: number;
  deposit_percent?: number;
  remaining_cents?: number;
  currency: string;
  hosted_voucher_url: string | null;
  expires_at: string | null;
};

type StatusResponse = {
  appointmentStatus: string | null;
  reservationStatus?: string | null;
  payment: (IntentInfo & { status: string }) | null;
};

type StripeJs = {
  confirmMbWayPayment: (
    clientSecret: string,
    data: { payment_method: { billing_details: { phone: string } } },
  ) => Promise<{ error?: { message?: string }; paymentIntent?: { status?: string } }>;
};

declare global {
  interface Window {
    Stripe?: (publishableKey: string) => StripeJs;
  }
}

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
  const [loading, setLoading] = useState(false);
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
    setLoading(true);
    try {
      const res = (await createIntent({
        data: { ...targetPayload, method: nextMethod },
      })) as IntentInfo & { payment_intent_id: string };

      if (isTerminalFailure(res.status)) {
        throw new Error("O pagamento não pôde ser iniciado. O horário voltou a ficar disponível.");
      }

      if (res.checkout_url) {
        toast.message("A abrir pagamento seguro...");
        window.location.assign(res.checkout_url);
        return;
      }

      if (res.method === "mb_way") {
        await confirmMbWayPayment(res);
      }

      setMethod(res.method);
      setIntent(res);
      toast.message(
        res.method === "multibanco"
          ? "Referência criada. O horário fica reservado até ao fim do prazo."
          : "Pedido MB WAY enviado. Confirme na app do seu banco.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao iniciar pagamento.");
      setMethod(null);
      setIntent(null);
    } finally {
      setLoading(false);
    }
  }

  async function confirmMbWayPayment(payment: IntentInfo) {
    if (!payment.client_secret || !payment.mb_way_phone) {
      throw new Error("Não foi possível iniciar MB WAY. Verifique o número de telemóvel.");
    }
    const stripe = await loadStripe();
    const result = await stripe.confirmMbWayPayment(payment.client_secret, {
      payment_method: {
        billing_details: {
          phone: payment.mb_way_phone,
        },
      },
    });
    if (result.error) {
      if (targetPayload) {
        await checkStatus({ data: targetPayload }).catch(() => {
          // Best effort sync; the next reservation attempt will also expire stale payments.
        });
      }
      throw new Error(result.error.message || "O pagamento MB WAY não foi confirmado.");
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copiado");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  }

  const allowedMethods = acceptedMethods.filter(
    (item): item is PaymentMethod => item === "mb_way" || item === "multibanco",
  );

  const depositPct = intent?.deposit_percent ?? 100;
  const isDeposit = depositPct < 100;
  const remaining = formatMoney(intent?.remaining_cents ?? 0, intent?.currency ?? "eur");
  const expiresLabel = intent?.expires_at ? formatDateTime(intent.expires_at) : null;

  return (
    <div className="mx-auto max-w-md p-6">
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          Horário reservado
        </div>
        <h2 className="mt-3 text-2xl font-light tracking-tight">
          {isDeposit ? "Pague o sinal para confirmar" : "Confirme o pagamento da reserva"}
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          O horário fica bloqueado enquanto aguardamos a confirmação do pagamento.
        </p>

        <div className="mt-4 rounded-2xl border border-border bg-muted/35 p-4 text-sm">
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
          <div className="mt-4 rounded-2xl border border-border bg-background p-4 text-xs leading-relaxed text-muted-foreground">
            <p className="font-semibold text-foreground">Sinal, cancelamento e reembolso</p>
            <p className="mt-1">{policySummary}</p>
          </div>
        )}

        {!intent && !expired && (
          <div className="mt-6 space-y-3">
            {allowedMethods.includes("mb_way") && (
              <PaymentMethodButton
                disabled={loading}
                title="MB WAY"
                description="Confirme na app do seu banco"
                onClick={() => start("mb_way")}
              />
            )}
            {allowedMethods.includes("multibanco") && (
              <PaymentMethodButton
                disabled={loading}
                title="Multibanco"
                description="Use a entidade e referência dentro do prazo"
                onClick={() => start("multibanco")}
              />
            )}
            {allowedMethods.length === 0 && (
              <ErrorPanel text="Este estúdio ainda não tem métodos de pagamento online disponíveis." />
            )}
            {loading && <StatusLine text="A reservar horário e preparar pagamento..." />}
          </div>
        )}

        {expired && (
          <div className="mt-6 space-y-3">
            <ErrorPanel text="O prazo de pagamento terminou. Escolha novamente o horário para garantir disponibilidade." />
            <button
              onClick={onCancel}
              className="w-full rounded-xl bg-foreground px-4 py-3 text-sm font-semibold text-background transition hover:opacity-90"
            >
              Escolher outro horário
            </button>
          </div>
        )}

        {intent && method === "multibanco" && !expired && (
          <div className="mt-6 space-y-4 rounded-2xl border border-border bg-muted/40 p-4 text-sm">
            <ReferenceRow label="Entidade" value={intent.multibanco_entity} onCopy={copy} />
            <ReferenceRow label="Referência" value={intent.multibanco_reference} onCopy={copy} />
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Valor</p>
              <p className="mt-1 font-mono text-lg">{formatMoney(intent.amount_cents, intent.currency)}</p>
            </div>
            {expiresLabel && (
              <p className="rounded-xl bg-background px-3 py-2 text-xs text-muted-foreground">
                Referência válida até {expiresLabel}. O horário fica reservado até esse prazo.
              </p>
            )}
            {intent.hosted_voucher_url && (
              <a
                href={intent.hosted_voucher_url}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full rounded-xl border border-border px-4 py-2 text-center text-xs font-semibold uppercase tracking-wide hover:bg-background"
              >
                Abrir comprovativo
              </a>
            )}
            {polling && <StatusLine text="A aguardar confirmação do pagamento..." compact />}
          </div>
        )}

        {intent && method === "mb_way" && !expired && (
          <div className="mt-6 space-y-3 rounded-2xl border border-border bg-muted/40 p-4 text-sm">
            <p>Verifique a notificação no telemóvel e confirme o pagamento na app do seu banco.</p>
            {expiresLabel && <p className="text-xs text-muted-foreground">Pedido válido até {expiresLabel}.</p>}
            {polling && <StatusLine text="A aguardar confirmação..." compact />}
          </div>
        )}

        {!expired && (
          <button onClick={onCancel} className="mt-6 w-full text-xs text-muted-foreground underline">
            Cancelar reserva
          </button>
        )}
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
  onClick,
}: {
  disabled: boolean;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="w-full rounded-2xl border border-border px-4 py-3 text-left text-sm transition hover:bg-muted disabled:opacity-50"
    >
      <span className="block font-medium">{title}</span>
      <span className="text-xs text-muted-foreground">{description}</span>
    </button>
  );
}

function ReferenceRow({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string | null;
  onCopy: (value: string) => void;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-center justify-between gap-3">
        <span className="break-all font-mono text-lg">{value ?? "A confirmar"}</span>
        {value && (
          <button
            onClick={() => onCopy(value)}
            className="text-muted-foreground hover:text-foreground"
            aria-label={`Copiar ${label}`}
          >
            <Copy className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
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

let stripePromise: Promise<StripeJs> | null = null;

function loadStripe() {
  if (stripePromise) return stripePromise;
  stripePromise = new Promise((resolve, reject) => {
    const publishableKey =
      (import.meta.env as Record<string, string | undefined>).VITE_STRIPE_PUBLISHABLE_KEY ?? "";
    if (!publishableKey) {
      reject(new Error("Configuração de pagamento indisponível."));
      return;
    }
    if (window.Stripe) {
      resolve(window.Stripe(publishableKey));
      return;
    }
    const script = document.createElement("script");
    script.src = "https://js.stripe.com/clover/stripe.js";
    script.async = true;
    script.onload = () => {
      if (!window.Stripe) {
        reject(new Error("Não foi possível carregar o pagamento seguro."));
        return;
      }
      resolve(window.Stripe(publishableKey));
    };
    script.onerror = () => reject(new Error("Não foi possível carregar o pagamento seguro."));
    document.head.appendChild(script);
  });
  return stripePromise;
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
