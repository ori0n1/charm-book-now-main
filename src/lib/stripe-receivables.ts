export type StripeFinancialMovement = {
  accountId: string;
  id: string;
  type: string;
  reportingCategory: string;
  amountCents: number;
  feeCents: number;
  netCents: number;
  currency: string;
  status: string;
  paymentStatus?: string | null;
  createdAt: string;
  availableOn: string | null;
  sourceId: string | null;
  chargeId: string | null;
  paymentIntentId: string | null;
  method: string | null;
  refundedAmountCents: number;
};

export type StoredPaymentLink = {
  accountId: string | null;
  id: string;
  appointmentId: string | null;
  bookingRequestId: string | null;
  amountCents: number;
  currency: string;
  method: string | null;
  status: string;
  createdAt: string;
  stripePaymentIntentId: string | null;
  stripeChargeId: string | null;
  stripeBalanceTransactionId: string | null;
  grossAmountCents: number | null;
  stripeFeeCents: number | null;
  netAmountCents: number | null;
  availableOn: string | null;
  financialDetailsStatus: string | null;
  clientName: string | null;
  appointmentStartsAt: string | null;
};

export type StripePayoutSnapshot = {
  accountId: string;
  id: string;
  amountCents: number;
  currency: string;
  status: string;
  createdAt: string;
  arrivalAt: string | null;
  destinationMasked: string | null;
};

export type ConnectFinancialSummary = {
  availableCents: number;
  pendingCents: number;
  inTransitCents: number;
  grossReceivedCents: number;
  stripeFeesCents: number;
  netReceivedCents: number;
  refundedCents: number;
  stripeFeeSchedule: {
    label: string;
    source: "configured" | "stripe_standard_pt";
  };
  pendingFinancialDetailsCount: number;
  paymentCount: number;
  currency: string;
  hasMoreStripeTransactions: boolean;
  dataSource: "stripe_live" | "stored_balance_transactions" | "not_connected";
  recentPayments: Array<{
    id: string;
    transactionType: "payment" | "refund";
    amountCents: number;
    grossAmountCents: number | null;
    stripeFeeCents: number | null;
    netAmountCents: number | null;
    refundedAmountCents: number;
    currency: string;
    method: string | null;
    status: string;
    paymentStatus: string | null;
    financialDetailsStatus: string | null;
    stripePaymentIntentId: string | null;
    stripeChargeId: string | null;
    stripeBalanceTransactionId: string | null;
    availableOn: string | null;
    payoutId: string | null;
    clientName: string | null;
    appointmentId: string | null;
    appointmentStartsAt: string | null;
    createdAt: string;
  }>;
  payouts: StripePayoutSnapshot[];
  payout: {
    scheduleLabel: string | null;
    nextAvailableAt: string | null;
    nextPayoutAt: string | null;
    nextPayoutStatus: string | null;
    nextPayoutAmountCents: number | null;
    lastPayoutAt: string | null;
    lastPayoutStatus: string | null;
    lastPayoutAmountCents: number | null;
  };
};

const RECEIVED_PAYMENT_STATUSES = new Set(["succeeded", "paid", "completed"]);
const PENDING_PAYMENT_STATUSES = new Set(["processing", "requires_action", "pending"]);
const PAYMENT_TRANSACTION_TYPES = new Set(["charge", "payment"]);
const REFUND_TRANSACTION_TYPES = new Set(["refund", "payment_refund"]);

function isPaymentMovement(movement: StripeFinancialMovement) {
  return (
    movement.reportingCategory === "charge" ||
    PAYMENT_TRANSACTION_TYPES.has(movement.type)
  );
}

function isRefundMovement(movement: StripeFinancialMovement) {
  return (
    movement.reportingCategory === "refund" ||
    REFUND_TRANSACTION_TYPES.has(movement.type)
  );
}

function matchesStoredPayment(movement: StripeFinancialMovement, row: StoredPaymentLink) {
  return Boolean(
    (movement.id && movement.id === row.stripeBalanceTransactionId) ||
      (movement.chargeId && movement.chargeId === row.stripeChargeId) ||
      (movement.paymentIntentId && movement.paymentIntentId === row.stripePaymentIntentId),
  );
}

export function buildConnectFinancialSummary(input: {
  accountId: string | null;
  storedPayments: StoredPaymentLink[];
  movements: StripeFinancialMovement[];
  payouts: StripePayoutSnapshot[];
  payoutByBalanceTransactionId?: ReadonlyMap<string, string>;
  availableCents: number;
  pendingCents: number;
  currency: string;
  scheduleLabel: string | null;
  nextAvailableAt: string | null;
  stripeFeeSchedule: ConnectFinancialSummary["stripeFeeSchedule"];
  hasMoreStripeTransactions?: boolean;
  stripeLive: boolean;
}): ConnectFinancialSummary {
  const scopedStored = input.accountId
    ? input.storedPayments.filter((row) => row.accountId === input.accountId)
    : input.storedPayments.filter((row) => !row.accountId);
  const scopedMovements = input.accountId
    ? input.movements.filter((movement) => movement.accountId === input.accountId)
    : [];
  const scopedPayouts = input.accountId
    ? input.payouts.filter((payout) => payout.accountId === input.accountId)
    : [];
  const paymentMovements = scopedMovements.filter(isPaymentMovement);
  const refundMovements = scopedMovements.filter(isRefundMovement);
  const payoutByTransaction = input.payoutByBalanceTransactionId ?? new Map<string, string>();

  const movementRows = [...paymentMovements, ...refundMovements]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 20)
    .map((movement) => {
      const stored = scopedStored.find((row) => matchesStoredPayment(movement, row));
      const refund = isRefundMovement(movement);
      return {
        id: movement.id,
        transactionType: refund ? ("refund" as const) : ("payment" as const),
        amountCents: Math.abs(movement.amountCents),
        grossAmountCents: Math.abs(movement.amountCents),
        stripeFeeCents: Math.abs(movement.feeCents),
        netAmountCents: Math.abs(movement.netCents),
        refundedAmountCents: refund
          ? Math.abs(movement.amountCents)
          : Math.max(0, movement.refundedAmountCents),
        currency: movement.currency,
        method: movement.method ?? stored?.method ?? null,
        status: movement.status,
        paymentStatus: stored?.status ?? movement.paymentStatus ?? null,
        financialDetailsStatus: "confirmed",
        stripePaymentIntentId: movement.paymentIntentId ?? stored?.stripePaymentIntentId ?? null,
        stripeChargeId: movement.chargeId ?? stored?.stripeChargeId ?? null,
        stripeBalanceTransactionId: movement.id,
        availableOn: movement.availableOn,
        payoutId: payoutByTransaction.get(movement.id) ?? null,
        clientName: stored?.clientName ?? null,
        appointmentId: stored?.appointmentId ?? null,
        appointmentStartsAt: stored?.appointmentStartsAt ?? null,
        createdAt: movement.createdAt,
      };
    });

  const movementIds = new Set(movementRows.map((row) => row.stripeBalanceTransactionId));
  const pendingRows = scopedStored
    .filter(
      (row) =>
        PENDING_PAYMENT_STATUSES.has(row.status) &&
        (!row.stripeBalanceTransactionId || !movementIds.has(row.stripeBalanceTransactionId)),
    )
    .map((row) => ({
      id: row.id,
      transactionType: "payment" as const,
      amountCents: row.amountCents,
      grossAmountCents: row.grossAmountCents,
      stripeFeeCents: row.stripeFeeCents,
      netAmountCents: row.netAmountCents,
      refundedAmountCents: 0,
      currency: row.currency,
      method: row.method,
      status: row.status,
      paymentStatus: row.status,
      financialDetailsStatus: row.financialDetailsStatus,
      stripePaymentIntentId: row.stripePaymentIntentId,
      stripeChargeId: row.stripeChargeId,
      stripeBalanceTransactionId: row.stripeBalanceTransactionId,
      availableOn: row.availableOn,
      payoutId: row.stripeBalanceTransactionId
        ? payoutByTransaction.get(row.stripeBalanceTransactionId) ?? null
        : null,
      clientName: row.clientName,
      appointmentId: row.appointmentId,
      appointmentStartsAt: row.appointmentStartsAt,
      createdAt: row.createdAt,
    }));

  const recentPayments = [...movementRows, ...pendingRows]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 20);
  const pendingFinancialDetailsCount = scopedStored.filter(
    (row) =>
      RECEIVED_PAYMENT_STATUSES.has(row.status) &&
      row.financialDetailsStatus !== "confirmed",
  ).length;
  const nextPayout = scopedPayouts.find((payout) =>
    ["pending", "in_transit"].includes(payout.status),
  );
  const lastPayout = scopedPayouts.find((payout) => payout.status === "paid");

  return {
    availableCents: input.availableCents,
    pendingCents: input.pendingCents,
    inTransitCents: scopedPayouts
      .filter((payout) => payout.status === "in_transit")
      .reduce((sum, payout) => sum + payout.amountCents, 0),
    grossReceivedCents: paymentMovements.reduce(
      (sum, movement) => sum + Math.max(0, movement.amountCents),
      0,
    ),
    stripeFeesCents: paymentMovements.reduce(
      (sum, movement) => sum + Math.max(0, movement.feeCents),
      0,
    ),
    netReceivedCents: paymentMovements.reduce(
      (sum, movement) => sum + Math.max(0, movement.netCents),
      0,
    ),
    refundedCents: refundMovements.reduce(
      (sum, movement) => sum + Math.abs(movement.amountCents),
      0,
    ),
    stripeFeeSchedule: input.stripeFeeSchedule,
    pendingFinancialDetailsCount,
    paymentCount: paymentMovements.length,
    currency: input.currency,
    hasMoreStripeTransactions: Boolean(input.hasMoreStripeTransactions),
    dataSource: input.accountId
      ? input.stripeLive
        ? "stripe_live"
        : "stored_balance_transactions"
      : "not_connected",
    recentPayments,
    payouts: scopedPayouts.slice(0, 10),
    payout: {
      scheduleLabel: input.scheduleLabel,
      nextAvailableAt: input.nextAvailableAt,
      nextPayoutAt: nextPayout?.arrivalAt ?? null,
      nextPayoutStatus: nextPayout?.status ?? null,
      nextPayoutAmountCents: nextPayout?.amountCents ?? null,
      lastPayoutAt: lastPayout?.arrivalAt ?? null,
      lastPayoutStatus: lastPayout?.status ?? null,
      lastPayoutAmountCents: lastPayout?.amountCents ?? null,
    },
  };
}
