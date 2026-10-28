import {
  allocateCents,
  buildAppointmentPaymentFacts,
  computeAppointmentFinancialSplit,
  toCents,
  type CommissionAppointment,
  type OnsitePaymentRow,
  type OnlinePaymentRow,
  type RefundRow,
} from "./financial-ledger.ts";

export type ProfessionalFinanceAppointment = CommissionAppointment & {
  id: string;
  studio_id: string;
  starts_at: string;
};

export type ProfessionalFinanceSummary = {
  completed: number;
  grossCents: number;
  commissionCents: number;
  studioCents: number;
  clientReceivedCents: number;
  receivedOnlineCents: number;
  receivedOnsiteCents: number;
  clientPendingCents: number;
  appliedPercents: number[];
  onsiteMethods: Array<{ method: string; cents: number }>;
};

export function completedFinancePeriodBounds(days: number, now = new Date()) {
  const from = new Date(now);
  from.setDate(from.getDate() - (days - 1));
  from.setHours(0, 0, 0, 0);
  const until = new Date(now);
  until.setHours(24, 0, 0, 0);
  return { from, until };
}

export function summarizeProfessionalFinance(input: {
  studioId: string;
  appointments: ProfessionalFinanceAppointment[];
  onlinePayments: OnlinePaymentRow[];
  onsitePayments: OnsitePaymentRow[];
  refunds: RefundRow[];
  defaultProfessionalPercent: number;
  from: Date;
  until: Date;
}): ProfessionalFinanceSummary {
  const paymentFacts = buildAppointmentPaymentFacts(
    input.onlinePayments,
    input.onsitePayments,
    input.refunds,
  );
  const appliedPercents = new Set<number>();
  const onsiteMethods = new Map<string, number>();
  const onsiteByAppointment = new Map<string, OnsitePaymentRow[]>();
  const seenOnsite = new Set<string>();
  for (const [index, row] of input.onsitePayments.entries()) {
    if (!row.appointment_id || row.movement_type !== "service_payment") continue;
    const key = row.id ?? `row:${index}`;
    if (seenOnsite.has(key)) continue;
    seenOnsite.add(key);
    const rows = onsiteByAppointment.get(row.appointment_id) ?? [];
    rows.push(row);
    onsiteByAppointment.set(row.appointment_id, rows);
  }
  const summary: ProfessionalFinanceSummary = {
    completed: 0,
    grossCents: 0,
    commissionCents: 0,
    studioCents: 0,
    clientReceivedCents: 0,
    receivedOnlineCents: 0,
    receivedOnsiteCents: 0,
    clientPendingCents: 0,
    appliedPercents: [],
    onsiteMethods: [],
  };
  const seenAppointments = new Set<string>();
  for (const appointment of input.appointments) {
    const hasCompletedJointService = appointment.appointment_services?.some(
      (line) => line.service_state === "completed",
    );
    if (appointment.studio_id !== input.studioId || seenAppointments.has(appointment.id) ||
        (appointment.status !== "completed" && !hasCompletedJointService)) continue;
    const startsAt = new Date(appointment.starts_at).getTime();
    if (!Number.isFinite(startsAt) || startsAt < input.from.getTime() || startsAt >= input.until.getTime()) continue;
    seenAppointments.add(appointment.id);
    const split = computeAppointmentFinancialSplit(
      appointment.id,
      appointment,
      input.defaultProfessionalPercent,
      paymentFacts.get(appointment.id),
    );
    summary.completed++;
    summary.grossCents += toCents(split.realized);
    summary.commissionCents += toCents(split.professional);
    summary.studioCents += toCents(split.studio);
    summary.clientReceivedCents += toCents(split.received);
    summary.receivedOnlineCents += toCents(split.receivedOnline);
    summary.receivedOnsiteCents += toCents(split.receivedOnsite);
    summary.clientPendingCents += toCents(split.pending);
    split.appliedProfessionalPercents.forEach((percent) => appliedPercents.add(percent));

    const onsiteRows = onsiteByAppointment.get(appointment.id) ?? [];
    const allocations = allocateCents(
      toCents(split.receivedOnsite),
      onsiteRows.map((row) => toCents(row.amount)),
    );
    onsiteRows.forEach((row, index) => {
      const method = String(row.payment_method || "other").toLowerCase();
      onsiteMethods.set(method, (onsiteMethods.get(method) ?? 0) + (allocations[index] ?? 0));
    });
  }
  summary.appliedPercents = [...appliedPercents].sort((a, b) => a - b);
  summary.onsiteMethods = [...onsiteMethods]
    .filter(([, cents]) => cents > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([method, cents]) => ({ method, cents }));
  return summary;
}
