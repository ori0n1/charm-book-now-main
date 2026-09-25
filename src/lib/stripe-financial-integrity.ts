export type BookingPaymentStatus =
  | "requires_action"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled"
  | string;

export function assertDirectChargeAccount(
  expectedAccountId: string | null | undefined,
  eventAccountId: string | null | undefined,
) {
  if (!expectedAccountId) throw new Error("payment_connected_account_missing");
  if (!eventAccountId) throw new Error("connect_event_account_missing");
  if (eventAccountId !== expectedAccountId) {
    throw new Error("payment_connected_account_mismatch");
  }
}

export function assertWithdrawalWebhookBinding(input: {
  requestId: string;
  metadataRequestId: string | null | undefined;
  studioId: string;
  metadataStudioId: string | null | undefined;
  expectedConnectAccountId: string | null | undefined;
  studioConnectAccountId: string | null | undefined;
  eventConnectAccountId: string | null | undefined;
  expectedStripeObjectId: string | null | undefined;
  eventStripeObjectId: string | null | undefined;
  payoutMethod: string | null | undefined;
  payoutMode: string | null | undefined;
}) {
  if (
    !input.requestId ||
    !input.metadataRequestId ||
    input.requestId !== input.metadataRequestId ||
    !input.studioId ||
    !input.metadataStudioId ||
    input.studioId !== input.metadataStudioId
  ) {
    throw new Error("withdrawal_tenant_binding_mismatch");
  }
  if (input.payoutMethod !== "stripe" || input.payoutMode !== "stripe_automatic") {
    throw new Error("withdrawal_not_stripe_automatic");
  }
  if (!input.expectedConnectAccountId || !input.studioConnectAccountId || !input.eventConnectAccountId) {
    throw new Error("withdrawal_connected_account_missing");
  }
  if (
    input.expectedConnectAccountId !== input.studioConnectAccountId ||
    input.expectedConnectAccountId !== input.eventConnectAccountId
  ) {
    throw new Error("withdrawal_connected_account_mismatch");
  }
  if (
    !input.expectedStripeObjectId ||
    !input.eventStripeObjectId ||
    input.expectedStripeObjectId !== input.eventStripeObjectId
  ) {
    throw new Error("withdrawal_stripe_object_mismatch");
  }
}

export function assertExactStripeAmount(input: {
  expectedAmountCents: number;
  stripeAmountCents: number;
  receivedAmountCents?: number | null;
  succeeded?: boolean;
}) {
  if (
    !Number.isInteger(input.expectedAmountCents) ||
    input.expectedAmountCents <= 0 ||
    !Number.isInteger(input.stripeAmountCents) ||
    input.stripeAmountCents !== input.expectedAmountCents
  ) {
    throw new Error("payment_amount_mismatch");
  }

  if (
    input.succeeded &&
    (!Number.isInteger(input.receivedAmountCents) ||
      input.receivedAmountCents !== input.expectedAmountCents)
  ) {
    throw new Error("payment_amount_mismatch");
  }
}

export function resolveBookingPaymentStatus(
  current: BookingPaymentStatus | null | undefined,
  incoming: BookingPaymentStatus,
) {
  if (current === "succeeded" && incoming !== "succeeded") return "succeeded";
  if (["failed", "canceled"].includes(String(current)) && incoming === "processing") {
    return current as BookingPaymentStatus;
  }
  return incoming;
}

export function minimalStripeEventAudit(event: {
  id?: string;
  type: string;
  created?: number;
  livemode?: boolean;
  account?: string;
  data: { object: { id?: string; object?: string; metadata?: Record<string, string | undefined> } };
}) {
  const object = event.data.object;
  return {
    event_id: event.id ?? null,
    event_type: event.type,
    event_created: event.created ?? null,
    livemode: event.livemode ?? null,
    connect_account: event.account ?? null,
    object_id: object.id ?? null,
    object_type: object.object ?? null,
    payment_kind: object.metadata?.payment_kind ?? null,
  };
}
