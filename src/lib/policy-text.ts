export type RefundPolicyValue = "refund_allowed" | "reschedule_only" | "non_refundable";

export type PolicySource = {
  cancellation_min_notice_hours?: number | null;
  cancellation_after_deadline_policy?: string | null;
};

export function readCancellationNoticeHours(source: PolicySource | null | undefined): number {
  const raw = Number(source?.cancellation_min_notice_hours ?? 24);
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 24;
}

export function readRefundPolicy(source: PolicySource | null | undefined): RefundPolicyValue {
  const policy = source?.cancellation_after_deadline_policy;
  if (policy === "refund_allowed" || policy === "reschedule_only" || policy === "non_refundable") {
    return policy;
  }
  return "non_refundable";
}

export type PolicyTextParts = {
  policy: RefundPolicyValue;
  hours: number;
  rescheduleLabel: string;
  rescheduleBody: string;
  refundLabel: string;
  refundBody: string;
  refundTone: "info" | "muted" | "warning";
  nonRefundable: boolean;
  badge: string | null;
  optionTitle: string;
  optionSubtitle: string;
};

export function getPolicyParts(policy: RefundPolicyValue, hours: number): PolicyTextParts {
  const rescheduleBody = `Pode cancelar ou remarcar até ${hours} horas antes. Depois disso, fale diretamente com o estúdio para ver alternativas.`;

  if (policy === "refund_allowed") {
    return {
      policy,
      hours,
      rescheduleLabel: "Cancelamento",
      rescheduleBody,
      refundLabel: "Regra do sinal",
      refundBody:
        "Dentro do prazo, pode pedir a devolução do sinal. O estúdio confirma o reembolso depois de analisar o pedido.",
      refundTone: "info",
      nonRefundable: false,
      badge: null,
      optionTitle: "Reembolso possível",
      optionSubtitle: "O estúdio analisa o pedido",
    };
  }

  if (policy === "reschedule_only") {
    return {
      policy,
      hours,
      rescheduleLabel: "Cancelamento",
      rescheduleBody,
      refundLabel: "Regra do sinal",
      refundBody:
        "O sinal não é devolvido em dinheiro. Se cancelar dentro do prazo, pode ser usado numa nova marcação no mesmo estúdio.",
      refundTone: "muted",
      nonRefundable: false,
      badge: "Sinal válido para remarcar",
      optionTitle: "Só remarcação",
      optionSubtitle: "Sem devolução em dinheiro",
    };
  }

  return {
    policy,
    hours,
    rescheduleLabel: "Cancelamento",
    rescheduleBody,
    refundLabel: "Regra do sinal",
    refundBody:
      "O sinal não é reembolsável. Ao cancelar, o horário fica livre, mas o valor pago não é devolvido.",
    refundTone: "warning",
    nonRefundable: true,
    badge: "Sinal não reembolsável",
    optionTitle: "Não reembolsável",
    optionSubtitle: "Sinal nunca devolvido em dinheiro",
  };
}

export function buildPolicyPlainText(
  policy: RefundPolicyValue,
  hours: number,
  options?: { withDepositIntro?: boolean },
): string {
  const parts = getPolicyParts(policy, hours);
  const intro = options?.withDepositIntro
    ? "O sinal reserva o horário e é descontado no valor final do serviço. "
    : "";
  return `${intro}${parts.rescheduleBody} ${parts.refundBody}`;
}

export function getPolicyPartsFromSource(source: PolicySource | null | undefined): PolicyTextParts {
  return getPolicyParts(readRefundPolicy(source), readCancellationNoticeHours(source));
}
