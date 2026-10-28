const manualReviewCodes = new Set([
  "paid_booking_requires_manual_review",
  "slot_unavailable_after_payment",
  "booking_studio_binding_invalid",
  "paid_request_was_canceled",
  "converted_appointment_missing",
]);

function messageFromError(error: unknown) {
  return error && typeof error === "object" && "message" in error &&
    typeof error.message === "string" ? error.message : "";
}

export function paidBookingRecoveryErrorCode(error: unknown) {
  const message = messageFromError(error);
  if (manualReviewCodes.has(message)) return message;
  if (/^(?:payment|checkout)_(?:studio|booking|currency|amount|client_phone|intent)_mismatch$/.test(message)) {
    return "payment_identity_mismatch";
  }
  if (message === "payment_state_disagreement_requires_manual_review") return "payment_state_disagreement";
  return "reconciliation_retryable_error";
}

export function isTerminalPaidBookingError(error: unknown) {
  return manualReviewCodes.has(messageFromError(error));
}

/** Log only bounded error identifiers; provider messages can contain customer data. */
export function paidBookingCheckpointErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error &&
      typeof error.code === "string" && /^[A-Z0-9]{3,10}$/.test(error.code)) {
    return error.code;
  }
  const message = messageFromError(error);
  if (/too many subrequests/i.test(message)) return "subrequest_limit";
  if (/\b(fetch failed|network|timeout|timed out)\b/i.test(message)) return "network_failure";
  return "unclassified_write_failure";
}
