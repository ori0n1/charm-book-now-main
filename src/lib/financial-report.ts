import {
  buildAppointmentPaymentFacts,
  computeAppointmentFinancialSplit,
  toCents,
  type OnsitePaymentRow,
  type OnlinePaymentRow,
  type RefundRow,
} from "@/lib/financial-ledger";

export type FinancialReportSource = "all" | "appointment" | "manual" | "walk_in";

export type FinancialReportFilters = {
  staffId: string | null;
  paymentMethod: string | null;
  source: FinancialReportSource;
  startsAtInclusive: string | null;
  endsAtExclusive: string | null;
};

export type FinancialReportAppointment = {
  id: string;
  staff_id: string;
  starts_at: string;
  status: string;
  total_price: number;
  studio_commission_percent_snapshot?: number | null;
  appointment_services?: Array<{
    price: number;
    studio_commission_percent_snapshot?: number | null;
    services?: { commission_percent?: number | null } | null;
  }> | null;
};

export type FinancialReportOnlinePayment = OnlinePaymentRow & {
  method: string;
};

export type FinancialReportOnsitePayment = OnsitePaymentRow & {
  payment_method: string;
};

export type FinancialReportManualEntry = {
  id: string;
  staff_id: string;
  performed_at: string;
  amount: number;
  payment_method: string;
  source: "manual" | "walk_in";
  serviceName?: string | null;
  staffName?: string | null;
  clientName?: string | null;
};

export type FinancialReportStaff = {
  id: string;
  name: string;
};

export type FinancialReport = {
  summary: {
    scheduledCents: number;
    realizedCents: number;
    receivedCents: number;
    receivedOnlineCents: number;
    receivedOnsiteCents: number;
    pendingCents: number;
    refundedCents: number;
    lostRevenueCents: number;
    appointmentCount: number;
    manualEntryCount: number;
  };
  byStaff: Array<{
    id: string;
    name: string;
    receivedCents: number;
    onlineCents: number;
    onsiteCents: number;
  }>;
  manualEntries: FinancialReportManualEntry[];
  reconciliation: {
    receivedComponentsMatch: boolean;
    staffReceivedMatches: boolean;
  };
};

type BuildFinancialReportInput = {
  appointments: FinancialReportAppointment[];
  onlinePayments: FinancialReportOnlinePayment[];
  onsitePayments: FinancialReportOnsitePayment[];
  refunds: RefundRow[];
  manualEntries: FinancialReportManualEntry[];
  staff: FinancialReportStaff[];
  studioCommissionPercent: number;
  filters: FinancialReportFilters;
};

function inPeriod(value: string, filters: FinancialReportFilters) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return false;
  if (
    filters.startsAtInclusive &&
    timestamp < new Date(filters.startsAtInclusive).getTime()
  ) {
    return false;
  }
  if (filters.endsAtExclusive && timestamp >= new Date(filters.endsAtExclusive).getTime()) {
    return false;
  }
  return true;
}

function matchesStaff(staffId: string, selectedStaffId: string | null) {
  return !selectedStaffId || staffId === selectedStaffId;
}

function includesAppointments(source: FinancialReportSource) {
  return source === "all" || source === "appointment";
}

function includesManualEntry(source: FinancialReportSource, entrySource: "manual" | "walk_in") {
  return source === "all" || source === entrySource;
}

export function buildFinancialReport(input: BuildFinancialReportInput): FinancialReport {
  const selectedAppointments = includesAppointments(input.filters.source)
    ? input.appointments.filter(
        (appointment) =>
          matchesStaff(appointment.staff_id, input.filters.staffId) &&
          inPeriod(appointment.starts_at, input.filters),
      )
    : [];
  const selectedManualEntries = input.manualEntries.filter(
    (entry) =>
      includesManualEntry(input.filters.source, entry.source) &&
      matchesStaff(entry.staff_id, input.filters.staffId) &&
      inPeriod(entry.performed_at, input.filters),
  );
  const appointmentIds = new Set(selectedAppointments.map((appointment) => appointment.id));
  const allOnlineRows = input.onlinePayments.filter((row) =>
    row.appointment_id ? appointmentIds.has(row.appointment_id) : false,
  );
  const allOnsiteRows = input.onsitePayments.filter((row) =>
    row.appointment_id ? appointmentIds.has(row.appointment_id) : false,
  );
  const allRefundRows = input.refunds.filter((row) =>
    row.appointment_id ? appointmentIds.has(row.appointment_id) : false,
  );
  const allPaymentFacts = buildAppointmentPaymentFacts(
    allOnlineRows,
    allOnsiteRows,
    allRefundRows,
  );

  const selectedOnlineRows = input.filters.paymentMethod
    ? allOnlineRows.filter((row) => row.method === input.filters.paymentMethod)
    : allOnlineRows;
  const selectedOnsiteRows = input.filters.paymentMethod
    ? allOnsiteRows.filter((row) => row.payment_method === input.filters.paymentMethod)
    : allOnsiteRows;
  const selectedOnlineIds = new Set(
    selectedOnlineRows.map((row) => row.id).filter((id): id is string => Boolean(id)),
  );
  const selectedRefundRows = input.filters.paymentMethod
    ? allRefundRows.filter(
        (row) => Boolean(row.payment_intent_id && selectedOnlineIds.has(row.payment_intent_id)),
      )
    : allRefundRows;
  const selectedPaymentFacts = buildAppointmentPaymentFacts(
    selectedOnlineRows,
    selectedOnsiteRows,
    selectedRefundRows,
  );

  const staffNames = new Map(input.staff.map((member) => [member.id, member.name]));
  const byStaff = new Map<
    string,
    { id: string; name: string; receivedCents: number; onlineCents: number; onsiteCents: number }
  >();
  const ensureStaff = (staffId: string, fallbackName?: string | null) => {
    const current = byStaff.get(staffId);
    if (current) return current;
    const created = {
      id: staffId,
      name: staffNames.get(staffId) || fallbackName || "Profissional removido",
      receivedCents: 0,
      onlineCents: 0,
      onsiteCents: 0,
    };
    byStaff.set(staffId, created);
    return created;
  };

  const summary: FinancialReport["summary"] = {
    scheduledCents: 0,
    realizedCents: 0,
    receivedCents: 0,
    receivedOnlineCents: 0,
    receivedOnsiteCents: 0,
    pendingCents: 0,
    refundedCents: 0,
    lostRevenueCents: 0,
    appointmentCount: selectedAppointments.length,
    manualEntryCount: selectedManualEntries.length,
  };

  for (const appointment of selectedAppointments) {
    const accountingSplit = computeAppointmentFinancialSplit(
      appointment.id,
      appointment,
      input.studioCommissionPercent,
      allPaymentFacts.get(appointment.id),
    );
    const receivedSplit = computeAppointmentFinancialSplit(
      appointment.id,
      appointment,
      input.studioCommissionPercent,
      selectedPaymentFacts.get(appointment.id),
    );
    const onlineCents = toCents(receivedSplit.receivedOnline);
    const onsiteCents = toCents(receivedSplit.receivedOnsite);
    const receivedCents = onlineCents + onsiteCents;
    summary.scheduledCents += toCents(accountingSplit.total);
    summary.realizedCents += toCents(accountingSplit.realized);
    summary.pendingCents += toCents(accountingSplit.pending);
    summary.lostRevenueCents += toCents(accountingSplit.lostRevenue);
    summary.refundedCents += toCents(receivedSplit.refunded);
    summary.receivedOnlineCents += onlineCents;
    summary.receivedOnsiteCents += onsiteCents;
    summary.receivedCents += receivedCents;
    if (receivedCents > 0) {
      const staff = ensureStaff(appointment.staff_id);
      staff.onlineCents += onlineCents;
      staff.onsiteCents += onsiteCents;
      staff.receivedCents += receivedCents;
    }
  }

  const visibleManualEntries = selectedManualEntries.filter(
    (entry) =>
      !input.filters.paymentMethod || entry.payment_method === input.filters.paymentMethod,
  );
  for (const entry of selectedManualEntries) {
    summary.realizedCents += toCents(entry.amount);
  }
  for (const entry of visibleManualEntries) {
    const cents = toCents(entry.amount);
    summary.receivedOnsiteCents += cents;
    summary.receivedCents += cents;
    const staff = ensureStaff(entry.staff_id, entry.staffName);
    staff.onsiteCents += cents;
    staff.receivedCents += cents;
  }

  const staffRows = Array.from(byStaff.values())
    .filter((member) => member.receivedCents > 0)
    .sort((left, right) => right.receivedCents - left.receivedCents || left.name.localeCompare(right.name));
  const staffReceivedCents = staffRows.reduce((sum, member) => sum + member.receivedCents, 0);

  return {
    summary,
    byStaff: staffRows,
    manualEntries: visibleManualEntries
      .slice()
      .sort(
        (left, right) =>
          new Date(right.performed_at).getTime() - new Date(left.performed_at).getTime(),
      ),
    reconciliation: {
      receivedComponentsMatch:
        summary.receivedCents ===
        summary.receivedOnlineCents + summary.receivedOnsiteCents,
      staffReceivedMatches: staffReceivedCents === summary.receivedCents,
    },
  };
}
