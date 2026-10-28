import { fromCents, toCents } from "@/lib/financial-ledger";

export type AgendaPaymentPresentation = {
  stateLabel: string;
  tone: "success" | "warning" | "muted";
  splitAvailable: boolean;
  needsStudioPaymentConfirmation: boolean;
  isDepositPaid: boolean;
  items: Array<{ label: string; value: number; emphasis?: boolean }>;
};

export type AgendaModalPaymentPresentation = {
  stateLabel: string;
  items?: Array<{ label: string; value: number }>;
};

export function confirmedStripePaymentRows<T extends {
  status: string;
  stripe_payment_intent_id?: string | null;
}>(rows: T[]): T[] {
  return rows.filter((row) =>
    row.status === "succeeded" && /^pi_[A-Za-z0-9]+$/.test(row.stripe_payment_intent_id ?? ""),
  );
}

export function buildAgendaPaymentPresentation(input: {
  appointmentStatus: string;
  totalAmount: number;
  paidAmount: number;
  hasPendingOnlinePayment?: boolean;
}): AgendaPaymentPresentation {
  const totalCents = toCents(input.totalAmount);
  const paidCents = Math.min(totalCents, toCents(input.paidAmount));
  const remainingCents = Math.max(0, totalCents - paidCents);
  const completed = input.appointmentStatus === "completed";
  const paidInFull = totalCents > 0 && paidCents >= totalCents;
  const isDepositPaid = paidCents > 0 && !paidInFull;
  const total = fromCents(totalCents);
  const paid = fromCents(paidCents);
  const remaining = fromCents(remainingCents);

  if (paidInFull) {
    return {
      stateLabel: completed ? "Pago" : "Pago integralmente",
      tone: "success",
      splitAvailable: true,
      needsStudioPaymentConfirmation: false,
      isDepositPaid: false,
      items: [{ label: "Valor do serviço", value: total, emphasis: true }],
    };
  }

  if (isDepositPaid) {
    return {
      stateLabel: "Sinal pago",
      tone: "success",
      splitAvailable: true,
      needsStudioPaymentConfirmation: false,
      isDepositPaid: true,
      items: [
        { label: "Valor total do serviço", value: total, emphasis: true },
        { label: "Sinal pago", value: paid },
        { label: "Restante no estúdio", value: remaining, emphasis: true },
      ],
    };
  }

  if (input.appointmentStatus === "pending_payment" || input.hasPendingOnlinePayment) {
    return {
      stateLabel: "Aguardando pagamento online",
      tone: "warning",
      splitAvailable: false,
      needsStudioPaymentConfirmation: false,
      isDepositPaid: false,
      items: [{ label: "Valor aguardando pagamento", value: total, emphasis: true }],
    };
  }

  return {
    stateLabel: "Aguardando pagamento presencial",
    tone: "muted",
    splitAvailable: false,
    needsStudioPaymentConfirmation: !["cancelled", "no_show"].includes(input.appointmentStatus),
    isDepositPaid: false,
    items: [{ label: "Valor do serviço", value: total, emphasis: true }],
  };
}

export function canResolvePaidAppointmentAttendance(input: {
  appointmentStatus: string;
  paidAmount: number;
}) {
  return input.appointmentStatus === "confirmed" && toCents(input.paidAmount) > 0;
}

export function buildAgendaModalPaymentPresentation(
  paidAmount: number,
  totalAmount: number,
): AgendaModalPaymentPresentation {
  const totalCents = toCents(totalAmount);
  const paidCents = Math.max(0, toCents(paidAmount));
  const remainingCents = Math.max(0, totalCents - paidCents);
  return {
    stateLabel: paidCents > 0
      ? remainingCents > 0 ? "Parcial" : "Pago"
      : "Pendente",
    items: [
      { label: "Pago", value: fromCents(paidCents) },
      ...(remainingCents > 0 ? [{ label: "Restante", value: fromCents(remainingCents) }] : []),
      { label: "Total", value: fromCents(totalCents) },
    ],
  };
}
