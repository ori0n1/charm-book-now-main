import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatAppointmentStatus(status?: string | null) {
  const labels: Record<string, string> = {
    pending: "Por confirmar",
    confirmed: "Marcação confirmada",
    completed: "Concluído",
    cancelled: "Cancelado",
    no_show: "Faltou",
    pending_payment: "A aguardar sinal",
  };

  return labels[status ?? ""] ?? "Por confirmar";
}

export function formatEUR(value: number) {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
  }).format(Number(value || 0));
}

export type FinancialSplit = {
  total: number;
  deposit: number;
  remaining: number;
  depositToProfessional: number;
  depositToStudio: number;
  commissionBase: number;
  commission: number;
  professional: number;
  studio: number;
  received: number;
  pending: number;
  commissionPercent: number;
  depositProfessionalPercent: number;
};

export type AttendanceRevenue = {
  isOnlinePaid: boolean;
  confirmed: number;
  predicted: number;
  depositReceived: number;
  remaining: number;
};

export function computeAttendanceRevenue(total: number, paidAmount: number, status?: string | null) {
  const safeTotal = roundMoney(Math.max(0, Number(total) || 0));
  const paid = roundMoney(Math.min(safeTotal, Math.max(0, Number(paidAmount) || 0)));
  const isOnlinePaid = paid > 0;
  const attended = status === "completed";
  const missed = status === "no_show";
  const excluded = status === "cancelled" || status === "pending_payment" || (missed && !isOnlinePaid);
  if (excluded) {
    return {
      isOnlinePaid,
      confirmed: 0,
      predicted: 0,
      depositReceived: paid,
      remaining: roundMoney(Math.max(0, safeTotal - paid)),
    };
  }
  const confirmed = isOnlinePaid && !attended ? paid : safeTotal;
  const predicted = isOnlinePaid && !attended && !missed ? roundMoney(safeTotal - paid) : 0;

  return {
    isOnlinePaid,
    confirmed,
    predicted,
    depositReceived: paid,
    remaining: roundMoney(Math.max(0, safeTotal - paid)),
  };
}

export function isFinanciallyRelevantAppointment(status: string, paidAmount = 0) {
  if (status === "cancelled" || status === "pending_payment") return false;
  if (status === "no_show") return paidAmount > 0;
  return status === "confirmed" || status === "completed";
}

/**
 * Repartição financeira de um serviço.
 * - O sinal é apenas a parte do total já paga online, nunca um valor extra.
 * - A parte do estúdio é calculada sobre o valor total do serviço.
 * - O restante pertence à profissional/equipa.
 */
export function computeFinancialSplit(
  total: number,
  studioPercent: number,
  options?: {
    depositPercent?: number;
    requiresDeposit?: boolean;
    depositProfessionalPercent?: number;
    receivedAmount?: number;
    isFullyPaid?: boolean;
  },
): FinancialSplit {
  const safeTotal = roundMoney(Math.max(0, Number(total) || 0));
  const pct = clampPercent(studioPercent);
  const requires = options?.requiresDeposit ?? false;
  const depositPct = requires ? clampPercent(options?.depositPercent ?? 0) : 0;
  const deposit = roundMoney(safeTotal * (depositPct / 100));
  const received = options?.isFullyPaid
    ? safeTotal
    : roundMoney(Math.min(safeTotal, Math.max(0, options?.receivedAmount ?? deposit)));
  const pending = roundMoney(Math.max(0, safeTotal - received));
  const studio = roundMoney(safeTotal * (pct / 100));
  const professional = roundMoney(safeTotal - studio);

  return {
    total: safeTotal,
    deposit,
    remaining: pending,
    depositToProfessional: 0,
    depositToStudio: 0,
    commissionBase: safeTotal,
    commission: studio,
    professional,
    studio,
    received,
    pending,
    commissionPercent: pct,
    depositProfessionalPercent: 0,
  };
}

export type DepositRuleMode = "studio" | "professional" | "split";

export type FinancialRuleSource = {
  commission_percent?: number | null;
  deposit_recipient?: DepositRuleMode | string | null;
  deposit_professional_percent?: number | null;
};

export function resolveDepositProfessionalPercent(rule?: FinancialRuleSource | null) {
  const mode = rule?.deposit_recipient ?? "studio";
  if (mode === "professional") return 100;
  if (mode === "split") return clampPercent(rule?.deposit_professional_percent ?? 50);
  return 0;
}

export function describeDepositRule(percent: number) {
  clampPercent(percent);
  return "O sinal conta como parte do valor total";
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, Number(value) || 0));
}

function roundMoney(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}
