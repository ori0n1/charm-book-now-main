import { useEffect, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { createBookingPaymentIntent, getPaymentStatus } from "@/lib/payments.functions";
import { toast } from "sonner";

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

  // Polling for status
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
          toast.error("O pagamento não foi aprovado. Pode tentar novamente ou escolher outro método.");
          setIntent(null);
          setMethod(null);
        }
      } catch (e) {
        // ignore
      }
    }, 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent, bookingRequestId, appointmentId]);

  async function start(m: "mb_way" | "multibanco") {
    if (!targetPayload) {
      toast.error("Reserva inválida. Recomece a marcação.");
      return;
    }
    setMethod(m);
    setLoading(true);
    try {
      const res = (await createIntent({ data: { ...targetPayload, method: m } })) as IntentInfo & {
        payment_intent_id: string;
      };
      setIntent(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao iniciar pagamento.");
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
    (m): m is "mb_way" | "multibanco" => m === "mb_way" || m === "multibanco",
  );

  const depositPct = intent?.deposit_percent ?? 100;
  const isDeposit = depositPct < 100;
  const remaining = ((intent?.remaining_cents ?? 0) / 100).toFixed(2);

  return (
    <div className="mx-auto max-w-md p-6">
      <div className="rounded-2xl border border-border bg-card p-6">
        <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
          {isDeposit ? "Sinal da reserva" : "Pagamento da reserva"}
        </p>
        <h2 className="mt-2 text-2xl font-light tracking-tight">
          {isDeposit ? "Pague o sinal para garantir o horário" : "Conclua para garantir o horário"}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Total do serviço:{" "}
          <span className="font-medium text-foreground">{totalPrice.toFixed(2)} €</span>
          {intent && isDeposit && (
            <>
              <br />
              Sinal agora:{" "}
              <span className="font-medium text-foreground">
                {(intent.amount_cents / 100).toFixed(2)} €
              </span>{" "}
              ({depositPct}%)
              <br />
              Restante <span className="font-medium text-foreground">{remaining} €</span> pago no
              estúdio no dia da sessão.
            </>
          )}
        </p>

        {policySummary && (
          <div className="mt-4 rounded-2xl border border-border bg-muted/35 p-4 text-xs leading-relaxed text-muted-foreground">
            <p className="font-semibold text-foreground">Sinal, cancelamento e reembolso</p>
            <p className="mt-1">{policySummary}</p>
          </div>
        )}

        {!intent && (
          <div className="mt-6 space-y-3">
            {allowedMethods.includes("multibanco") && (
              <button
                disabled={loading}
                onClick={() => start("multibanco")}
                className="w-full rounded-md border border-border px-4 py-3 text-left text-sm hover:bg-muted disabled:opacity-50"
              >
                <span className="block font-medium">Multibanco</span>
                <span className="text-xs text-muted-foreground">
                  Pague na ATM ou homebanking — válido 24h
                </span>
              </button>
            )}
            {allowedMethods.includes("mb_way") && (
              <button
                disabled={loading}
                onClick={() => start("mb_way")}
                className="w-full rounded-md border border-border px-4 py-3 text-left text-sm hover:bg-muted disabled:opacity-50"
              >
                <span className="block font-medium">MB WAY</span>
                <span className="text-xs text-muted-foreground">
                  Confirme em segundos na app do seu banco
                </span>
              </button>
            )}
            {loading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> A preparar pagamento…
              </div>
            )}
          </div>
        )}

        {intent && method === "multibanco" && (
          <div className="mt-6 space-y-4 rounded-lg border border-border bg-muted/40 p-4 text-sm">
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Entidade
              </p>
              <div className="mt-1 flex items-center justify-between">
                <span className="font-mono text-lg">{intent.multibanco_entity}</span>
                <button
                  onClick={() => copy(intent.multibanco_entity || "")}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Referência
              </p>
              <div className="mt-1 flex items-center justify-between">
                <span className="font-mono text-lg">{intent.multibanco_reference}</span>
                <button
                  onClick={() => copy(intent.multibanco_reference || "")}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Valor</p>
              <p className="mt-1 font-mono text-lg">{(intent.amount_cents / 100).toFixed(2)} €</p>
            </div>
            {intent.hosted_voucher_url && (
              <a
                href={intent.hosted_voucher_url}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full rounded-md border border-border px-4 py-2 text-center text-xs uppercase tracking-wide hover:bg-background"
              >
                Abrir comprovativo
              </a>
            )}
            {polling && (
              <div className="flex items-center gap-2 pt-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> A aguardar confirmação do pagamento…
              </div>
            )}
          </div>
        )}

        {intent && method === "mb_way" && (
          <div className="mt-6 space-y-3 rounded-lg border border-border bg-muted/40 p-4 text-sm">
            <p>
              Verifique a notificação no seu telemóvel e confirme o pagamento na app do seu banco.
            </p>
            {polling && (
              <div className="flex items-center gap-2 pt-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> A aguardar confirmação…
              </div>
            )}
          </div>
        )}

        <button onClick={onCancel} className="mt-6 w-full text-xs text-muted-foreground underline">
          Cancelar reserva
        </button>
      </div>

      <div className="mt-4 flex items-center justify-center gap-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        <Check className="h-3 w-3" /> Pagamento seguro via Stripe
      </div>
    </div>
  );
}
