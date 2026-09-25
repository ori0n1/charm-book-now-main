export type AppointmentPaymentStatus =
  | "pending"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "no_show"
  | "pending_payment"
  | string;

export type OnlinePaymentRow = {
  id?: string | null;
  appointment_id: string | null;
  amount_cents: number;
  status: string;
  dispute_status?: string | null;
  disputed_amount_cents?: number | null;
};

export type OnsitePaymentRow = {
  id?: string | null;
  appointment_id: string | null;
  amount: number;
  movement_type: string;
};

export type RefundRow = {
  id?: string | null;
  appointment_id: string | null;
  payment_intent_id?: string | null;
  /** Canonical amount for partial refunds. Null legacy rows are full refunds. */
  amount_cents?: number | null;
  /** Temporary compatibility alias for pre-migration fixtures/callers. */
  refund_amount_cents?: number | null;
  status: string;
  payment_intents?: { amount_cents?: number | null } | { amount_cents?: number | null }[] | null;
};

export type AppointmentPaymentFacts = {
  appointmentId: string;
  onlineGrossCents: number;
  onsiteGrossCents: number;
  refundedCents: number;
  disputedLostCents?: number;
  onlineNetCents: number;
  onsiteNetCents: number;
  receivedCents: number;
};

export type AppointmentLedger = AppointmentPaymentFacts & {
  totalCents: number;
  scheduledCents: number;
  realizedCents: number;
  pendingCents: number;
  overpaidCents: number;
  lostRevenueCents: number;
  identityApplies: boolean;
};

export type CommissionLine = {
  price: number;
  studio_commission_percent_snapshot?: number | null;
  services?: { commission_percent?: number | null } | null;
};

export type CommissionAppointment = {
  total_price: number;
  status?: AppointmentPaymentStatus | null;
  studio_commission_percent_snapshot?: number | null;
  staff?: { commission_percent?: number | null } | null;
  appointment_services?: CommissionLine[] | null;
};

export type AppointmentCommissionSplit = {
  eligibleCents: number;
  studioCents: number;
  teamCents: number;
  appliedStudioPercents: number[];
};

export type AppointmentFinancialSplit = {
  total: number;
  serviceTotal: number;
  realized: number;
  confirmed: number;
  predicted: number;
  deposit: number;
  remaining: number;
  commissionBase: number;
  commission: number;
  professional: number;
  studio: number;
  signalProfessional: number;
  signalStudio: number;
  received: number;
  receivedOnline: number;
  receivedOnsite: number;
  refunded: number;
  pending: number;
  lostRevenue: number;
  commissionPercent: number;
  appliedStudioPercents: number[];
  identityApplies: boolean;
};

export type PeriodFinancialAppointment = CommissionAppointment & {
  id: string;
  starts_at: string;
};

export type FinancialPeriodSummary = {
  appointmentCount: number;
  scheduledCents: number;
  realizedCents: number;
  receivedCents: number;
  pendingCents: number;
  onlineCents: number;
  onsiteCents: number;
  refundedCents: number;
  lostRevenueCents: number;
  studioCents: number;
  teamCents: number;
};

export function toCents(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100)) : 0;
}

export function fromCents(cents: number) {
  return Math.round(Number(cents || 0)) / 100;
}

export function clampPercent(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 0;
}

export function allocateCents(totalCents: number, weights: number[]) {
  const safeTotal = Math.max(0, Math.round(totalCents));
  if (weights.length === 0) return [];
  const safeWeights = weights.map((weight) => Math.max(0, Math.round(weight)));
  const weightTotal = safeWeights.reduce((sum, weight) => sum + weight, 0);
  if (weightTotal <= 0) return safeWeights.map((_, index) => (index === 0 ? safeTotal : 0));

  const provisional = safeWeights.map((weight, index) => {
    const exact = (safeTotal * weight) / weightTotal;
    const floor = Math.floor(exact);
    return { index, cents: floor, remainder: exact - floor };
  });
  let remaining = safeTotal - provisional.reduce((sum, item) => sum + item.cents, 0);
  provisional
    .slice()
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
    .forEach((item) => {
      if (remaining <= 0) return;
      provisional[item.index].cents += 1;
      remaining -= 1;
    });
  return provisional.map((item) => item.cents);
}

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function uniqueRows<T extends { id?: string | null }>(rows: T[]) {
  const seen = new Set<string>();
  return rows.filter((row, index) => {
    const key = row.id ? String(row.id) : `row:${index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildAppointmentPaymentFacts(
  onlineRows: OnlinePaymentRow[],
  onsiteRows: OnsitePaymentRow[],
  refundRows: RefundRow[] = [],
) {
  const facts = new Map<string, AppointmentPaymentFacts>();
  const onlinePaymentCentsById = new Map<string, number>();
  const refundedCentsByPayment = new Map<string, number>();
  const ensure = (appointmentId: string) => {
    const current = facts.get(appointmentId);
    if (current) return current;
    const created: AppointmentPaymentFacts = {
      appointmentId,
      onlineGrossCents: 0,
      onsiteGrossCents: 0,
      refundedCents: 0,
      disputedLostCents: 0,
      onlineNetCents: 0,
      onsiteNetCents: 0,
      receivedCents: 0,
    };
    facts.set(appointmentId, created);
    return created;
  };

  for (const row of uniqueRows(onlineRows)) {
    if (!row.appointment_id || row.status !== "succeeded") continue;
    const amountCents = Math.max(0, Math.round(Number(row.amount_cents) || 0));
    const current = ensure(row.appointment_id);
    current.onlineGrossCents += amountCents;
    if (row.dispute_status === "lost") {
      current.disputedLostCents =
        Number(current.disputedLostCents || 0) +
        Math.min(amountCents, Math.max(0, Math.round(Number(row.disputed_amount_cents) || 0)));
    }
    if (row.id) onlinePaymentCentsById.set(String(row.id), amountCents);
  }
  for (const row of uniqueRows(onsiteRows)) {
    if (!row.appointment_id || row.movement_type !== "service_payment") continue;
    ensure(row.appointment_id).onsiteGrossCents += toCents(row.amount);
  }
  for (const row of uniqueRows(refundRows)) {
    if (!row.appointment_id || row.status !== "refunded") continue;
    const payment = relationOne(row.payment_intents);
    const current = ensure(row.appointment_id);
    const paymentCents = Math.max(
      0,
      Math.round(
        onlinePaymentCentsById.get(String(row.payment_intent_id ?? "")) ??
          (Number(payment?.amount_cents) || current.onlineGrossCents),
      ),
    );
    const explicitRefundCents = row.amount_cents ?? row.refund_amount_cents;
    const requestedRefundCents =
      explicitRefundCents == null
        ? paymentCents
        : Math.max(0, Math.round(Number(explicitRefundCents) || 0));
    const paymentKey = `${row.appointment_id}:${row.payment_intent_id ?? "legacy"}`;
    const alreadyCounted = refundedCentsByPayment.get(paymentKey) ?? 0;
    const nextPaymentRefund = Math.min(paymentCents, alreadyCounted + requestedRefundCents);
    current.refundedCents += Math.max(0, nextPaymentRefund - alreadyCounted);
    refundedCentsByPayment.set(paymentKey, nextPaymentRefund);
  }
  for (const current of facts.values()) {
    // Refunds in the current Bellza model originate from online payment intents.
    // Per-payment and per-appointment caps protect the ledger from duplicate
    // finalised requests without ever manufacturing a negative onsite balance.
    current.refundedCents = Math.min(current.onlineGrossCents, current.refundedCents);
    const onlineRefund = Math.min(current.onlineGrossCents, current.refundedCents);
    const lostDispute = Math.min(
      current.onlineGrossCents - onlineRefund,
      Math.max(0, Math.round(Number(current.disputedLostCents) || 0)),
    );
    current.disputedLostCents = lostDispute;
    current.onlineNetCents = current.onlineGrossCents - onlineRefund - lostDispute;
    const remainingRefund = Math.max(0, current.refundedCents - onlineRefund);
    current.onsiteNetCents = Math.max(0, current.onsiteGrossCents - remainingRefund);
    current.receivedCents = current.onlineNetCents + current.onsiteNetCents;
  }
  return facts;
}

export function computeAppointmentLedger(
  appointmentId: string,
  total: number,
  status: AppointmentPaymentStatus | null | undefined,
  payment?: AppointmentPaymentFacts | null,
): AppointmentLedger {
  const totalCents = toCents(total);
  const empty: AppointmentPaymentFacts = {
    appointmentId,
    onlineGrossCents: 0,
    onsiteGrossCents: 0,
    refundedCents: 0,
    disputedLostCents: 0,
    onlineNetCents: 0,
    onsiteNetCents: 0,
    receivedCents: 0,
  };
  const facts = payment ?? empty;
  const receivedCents = Math.max(0, facts.receivedCents);
  const active = status === "confirmed" || status === "completed";
  const scheduledCents = active ? totalCents : 0;
  const realizedCents = status === "completed" ? totalCents : 0;
  const recognizedReceivedCents = Math.min(totalCents, receivedCents);
  const pendingCents = active ? Math.max(0, totalCents - recognizedReceivedCents) : 0;

  return {
    ...facts,
    receivedCents: recognizedReceivedCents,
    totalCents,
    scheduledCents,
    realizedCents,
    pendingCents,
    overpaidCents: Math.max(0, receivedCents - totalCents),
    lostRevenueCents: status === "no_show" ? Math.max(0, totalCents - recognizedReceivedCents) : 0,
    identityApplies: active,
  };
}

export function resolveStudioPercent(
  line: CommissionLine | null | undefined,
  appointment: CommissionAppointment,
  studioPercent: number,
) {
  return clampPercent(
    line?.studio_commission_percent_snapshot ??
      appointment.studio_commission_percent_snapshot ??
      line?.services?.commission_percent ??
      appointment.staff?.commission_percent ??
      studioPercent,
  );
}

export function computeAppointmentCommissionSplit(
  appointment: CommissionAppointment,
  studioPercent: number,
  eligibleCents = toCents(appointment.total_price),
): AppointmentCommissionSplit {
  const lines = appointment.appointment_services?.length
    ? appointment.appointment_services
    : [{ price: appointment.total_price }];
  const lineCents = allocateCents(
    eligibleCents,
    lines.map((line) => toCents(line.price)),
  );
  let studioCents = 0;
  const applied = new Set<number>();
  lines.forEach((line, index) => {
    const percent = resolveStudioPercent(line, appointment, studioPercent);
    applied.add(percent);
    studioCents += Math.round((lineCents[index] * percent) / 100);
  });
  studioCents = Math.min(eligibleCents, Math.max(0, studioCents));
  return {
    eligibleCents,
    studioCents,
    teamCents: eligibleCents - studioCents,
    appliedStudioPercents: Array.from(applied).sort((a, b) => a - b),
  };
}

export function computeAppointmentFinancialSplit(
  appointmentId: string,
  appointment: CommissionAppointment,
  studioPercent: number,
  payment?: AppointmentPaymentFacts | null,
): AppointmentFinancialSplit {
  const ledger = computeAppointmentLedger(
    appointmentId,
    appointment.total_price,
    appointment.status,
    payment,
  );
  const commission = computeAppointmentCommissionSplit(
    appointment,
    studioPercent,
    ledger.realizedCents,
  );
  const lines = appointment.appointment_services?.length
    ? appointment.appointment_services
    : [{ price: appointment.total_price }];
  const scheduledLineCents = allocateCents(
    ledger.scheduledCents,
    lines.map((line) => toCents(line.price)),
  );
  const receivedLineCents = allocateCents(ledger.receivedCents, scheduledLineCents);
  let receivedStudioCents = 0;
  lines.forEach((line, index) => {
    const percent = resolveStudioPercent(line, appointment, studioPercent);
    receivedStudioCents += Math.round((receivedLineCents[index] * percent) / 100);
  });
  receivedStudioCents = Math.min(ledger.receivedCents, Math.max(0, receivedStudioCents));
  const effectivePercent =
    commission.eligibleCents > 0
      ? Math.round((commission.studioCents * 10_000) / commission.eligibleCents) / 100
      : clampPercent(studioPercent);

  return {
    total: fromCents(ledger.scheduledCents),
    serviceTotal: fromCents(ledger.totalCents),
    realized: fromCents(ledger.realizedCents),
    confirmed: fromCents(ledger.receivedCents),
    predicted: fromCents(ledger.pendingCents),
    deposit: fromCents(ledger.onlineNetCents),
    remaining: fromCents(ledger.pendingCents),
    commissionBase: fromCents(commission.eligibleCents),
    commission: fromCents(commission.teamCents),
    professional: fromCents(commission.teamCents),
    studio: fromCents(commission.studioCents),
    signalProfessional: fromCents(ledger.receivedCents - receivedStudioCents),
    signalStudio: fromCents(receivedStudioCents),
    received: fromCents(ledger.receivedCents),
    receivedOnline: fromCents(Math.min(ledger.receivedCents, ledger.onlineNetCents)),
    receivedOnsite: fromCents(
      Math.min(Math.max(0, ledger.receivedCents - ledger.onlineNetCents), ledger.onsiteNetCents),
    ),
    refunded: fromCents(ledger.refundedCents),
    pending: fromCents(ledger.pendingCents),
    lostRevenue: fromCents(ledger.lostRevenueCents),
    commissionPercent: effectivePercent,
    appliedStudioPercents: commission.appliedStudioPercents,
    identityApplies: ledger.identityApplies,
  };
}

export function summarizeFinancialPeriod(
  appointments: PeriodFinancialAppointment[],
  paymentFacts: Map<string, AppointmentPaymentFacts>,
  studioPercent: number,
  startsAtInclusive: Date,
  endsAtExclusive: Date,
): FinancialPeriodSummary {
  const seen = new Set<string>();
  const summary: FinancialPeriodSummary = {
    appointmentCount: 0,
    scheduledCents: 0,
    realizedCents: 0,
    receivedCents: 0,
    pendingCents: 0,
    onlineCents: 0,
    onsiteCents: 0,
    refundedCents: 0,
    lostRevenueCents: 0,
    studioCents: 0,
    teamCents: 0,
  };
  for (const appointment of appointments) {
    if (seen.has(appointment.id)) continue;
    const timestamp = new Date(appointment.starts_at).getTime();
    if (timestamp < startsAtInclusive.getTime() || timestamp >= endsAtExclusive.getTime()) continue;
    seen.add(appointment.id);
    const split = computeAppointmentFinancialSplit(
      appointment.id,
      appointment,
      studioPercent,
      paymentFacts.get(appointment.id),
    );
    summary.appointmentCount += 1;
    summary.scheduledCents += toCents(split.total);
    summary.realizedCents += toCents(split.realized);
    summary.receivedCents += toCents(split.received);
    summary.pendingCents += toCents(split.pending);
    summary.onlineCents += toCents(split.receivedOnline);
    summary.onsiteCents += toCents(split.receivedOnsite);
    summary.refundedCents += toCents(split.refunded);
    summary.lostRevenueCents += toCents(split.lostRevenue);
    summary.studioCents += toCents(split.studio);
    summary.teamCents += toCents(split.professional);
  }
  return summary;
}
