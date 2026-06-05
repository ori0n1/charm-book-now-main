import { useEffect, useState } from "react";
import { Check, Copy, Loader2, ShieldCheck } from "lucide-react";
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

type IntentInfo = {
  method: "mb_way" | "multibanco";
  status: string;
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
  const [method, setMethod] = useState<"mb_way" | "multibanco" | null>(null);
  const [intent, setIntent] = useState<IntentInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);

  const targetPayload = bookingRequestId
    ? { bookingRequestId }
    : appointmentId
      ? { appointmentId }
      : null;

  useEffect(() => {
    if (!intent || intent.status === "succeeded" || !targetPayload) return;
    setPolling(true);
    const interval = setInterval(async () => {
      try {
        const res = (await checkStatus({ data: targetPayload })) as {
          appointmentStatus: string | null;
          reservationStatus?: string | null;
          payment: { status: string } | null;
        };
        if (
          res.appointmentStatus === "confirmed" ||
          res.reservationStatus === "confirmed" ||
          res.payment?.status === "succeeded"
        ) {
          clearInterval(interval);
          setPolling(false);
          toast.success("Pagamento confirmado. Horário reservado com sucesso.");
          onConfirmed();
          return;
        }
        if (
          res.payment?.status === "failed" ||
          res.payment?.status === "canceled" ||
          res.payment?.status === "expired" ||
          res.reservationStatus === "failed" ||
          res.reservationStatus === "canceled" ||
          res.reservationStatus === "expired"
        ) {
          clearInterval(interval);
          setPolling(false);
          toast.error("O pagamento não foi confirmado. O horário voltou a ficar disponível.");
          setIntent(null);
          setMethod(null);
        }
      } catch {
        // Keep polling; transient status checks should not interrupt the client.
      }
    }, 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent, bookingRequestId, appointmentId]);

  async function start(nextMethod: "mb_way" | "multibanco") {
    if (!targetPayload) {
      toast.error("Reserva inválida. Recomece a marcação.");
      return;
    }
    setMethod(nextMethod);
    setLoading(true);
    try {
      const res = (await createIntent({
        data: { ...targetPayload, method: nextMethod },
      })) as IntentInfo & {
        payment_intent_id: string;
      };
      setIntent(res);
      toast.message("Horário reservado temporariamente. Aguardamos a confirmação do pagamento.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao iniciar pagamento.");
      setMethod(null);
    } finally {
      setLoading(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copiado");
    } catch {
      /* noop */
    }
  }

  const allowedMethods = acceptedMethods.filter(
    (item): item is "mb_way" | "multibanco" => item === "mb_way" || item === "multibanco",
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
          O horário fica bloqueado temporariamente enquanto aguardamos a confirmação do pagamento.
        </p>

        <div className="mt-4 rounded-2xl border border-border bg-muted/35 p-4 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Total do serviço</span>
            <span className="font-semibold text-foreground">{formatMoney(totalPrice * 100, "eur")}</span>
          </div>
          {intent && isDeposit && (
            <>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Sinal agora</span>
                <span className="font-semibold text-foreground">
                  {formatMoney(intent.amount_cents, intent.currency)} ({depositPct}%)
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Restante no estúdio</span>
                <span className="font-semibold text-foreground">{remaining}</span>
              </div>
            </>
          )}
        </div>

        {policySummary && (
          <div className="mt-4 rounded-2xl border border-border bg-background p-4 text-xs leading-relaxed text-muted-foreground">
            <p className="font-semibold text-foreground">Sinal, cancelamento e reembolso</p>
            <p className="mt-1">{policySummary}</p>
          </div>
        )}

        {!intent && (
          <div className="mt-6 space-y-3">
            {allowedMethods.includes("mb_way") && (
              <PaymentMethodButton
                disabled={loading}
                title="MB WAY"
                description="Confirme em segundos na app do seu banco"
                onClick={() => start("mb_way")}
              />
            )}
            {allowedMethods.includes("multibanco") && (
              <PaymentMethodButton
                disabled={loading}
                title="Multibanco"
                description="Use a entidade e referência dentro do prazo indicado"
                onClick={() => start("multibanco")}
              />
            )}
            {loading && (
              <StatusLine text="A reservar horário e preparar pagamento..." />
            )}
          </div>
        )}

        {intent && method === "multibanco" && (
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

        {intent && method === "mb_way" && (
          <div className="mt-6 space-y-3 rounded-2xl border border-border bg-muted/40 p-4 text-sm">
            <p>
              Verifique a notificação no seu telemóvel e confirme o pagamento na app do seu banco.
            </p>
            {expiresLabel && (
              <p className="text-xs text-muted-foreground">
                Pedido válido até {expiresLabel}.
              </p>
            )}
            {polling && <StatusLine text="A aguardar confirmação..." compact />}
          </div>
        )}

        <button onClick={onCancel} className="mt-6 w-full text-xs text-muted-foreground underline">
          Cancelar reserva
        </button>
      </div>

      <div className="mt-4 flex items-center justify-center gap-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        <Check className="h-3 w-3" /> Pagamento seguro
      </div>
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
