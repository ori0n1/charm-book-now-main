import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { allocateCents, clampPercent, fromCents, toCents } from "@/lib/financial-ledger";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatAppointmentStatus(status?: string | null) {
  const labels: Record<string, string> = {
    pending: "Pendente",
    confirmed: "Confirmada",
    completed: "Concluída",
    cancelled: "Cancelada",
    no_show: "Falta",
    pending_payment: "Pagamento pendente",
  };

  return labels[status ?? ""] ?? "Pendente";
}

export function formatEUR(value: number) {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
  }).format(Number(value || 0));
}

/**
 * Allocates the immutable appointment total across its stored service lines.
 * The total_price snapshot is authoritative; line prices are weights used for
 * commission reporting. Integer cents guarantee that allocations reconcile.
 */
export function allocateAuthoritativeLineTotals(total: number, linePrices: number[]) {
  return allocateCents(
    toCents(total),
    linePrices.map((price) => toCents(price)),
  ).map(fromCents);
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
  const totalCents = toCents(total);
  const paidCents = Math.min(totalCents, toCents(paidAmount));
  const paid = fromCents(paidCents);
  const isOnlinePaid = paid > 0;
  const active = status === "confirmed" || status === "completed";
  const retainedNoShow = status === "no_show" && paidCents > 0;
  const excluded = !active && !retainedNoShow;
  if (excluded) {
    return {
      isOnlinePaid,
      confirmed: 0,
      predicted: 0,
      depositReceived: paid,
      remaining: 0,
    };
  }
  const confirmed = paid;
  const predicted = retainedNoShow ? 0 : fromCents(totalCents - paidCents);

  return {
    isOnlinePaid,
    confirmed,
    predicted,
    depositReceived: paid,
    remaining: predicted,
  };
}

export function isFinanciallyRelevantAppointment(status: string, paidAmount = 0) {
  if (status === "pending_payment") return false;
  if (status === "cancelled" || status === "no_show") return paidAmount > 0;
  return status === "confirmed" || status === "completed";
}

/**
 * Repartição financeira de um serviço.
 * - O sinal é apenas a parte do total já paga online, nunca um valor extra.
 * - A percentagem configurada representa a parte da profissional/equipa.
 * - O restante pertence ao estúdio.
 */
export function computeFinancialSplit(
  total: number,
  professionalPercent: number,
  options?: {
    depositPercent?: number;
    requiresDeposit?: boolean;
    depositProfessionalPercent?: number;
    receivedAmount?: number;
    isFullyPaid?: boolean;
  },
): FinancialSplit {
  const totalCents = toCents(total);
  const safeTotal = fromCents(totalCents);
  const pct = clampPercent(professionalPercent);
  const requires = options?.requiresDeposit ?? false;
  const depositPct = requires ? clampPercent(options?.depositPercent ?? 0) : 0;
  const depositCents = Math.round((totalCents * depositPct) / 100);
  const receivedCents = options?.isFullyPaid
    ? totalCents
    : Math.min(totalCents, toCents(options?.receivedAmount ?? fromCents(depositCents)));
  const pendingCents = totalCents - receivedCents;
  const professionalCents = Math.round((totalCents * pct) / 100);
  const studioCents = totalCents - professionalCents;
  const deposit = fromCents(depositCents);
  const received = fromCents(receivedCents);
  const pending = fromCents(pendingCents);
  const studio = fromCents(studioCents);
  const professional = fromCents(professionalCents);

  return {
    total: safeTotal,
    deposit,
    remaining: pending,
    depositToProfessional: 0,
    depositToStudio: 0,
    commissionBase: safeTotal,
    commission: professional,
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

function roundMoney(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}
