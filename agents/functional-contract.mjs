export const FUNCTIONAL_DOMAINS = Object.freeze({
  agenda: Object.freeze({
    loadErrors: ["AGENDA_LOAD_FAILED", "critical"],
    queryErrors: ["AGENDA_QUERY_FAILED", "critical"],
    availabilityMismatches: ["AGENDA_AVAILABILITY_MISMATCH", "warning"],
  }),
  reservas: Object.freeze({
    stateInconsistencies: ["RESERVATION_STATE_INCONSISTENT", "critical"],
    processingFailures: ["RESERVATION_PROCESSING_FAILED", "critical"],
  }),
  whatsapp: Object.freeze({
    sendFailures: ["WHATSAPP_SEND_FAILED", "warning"],
    confirmationFailures: ["WHATSAPP_CONFIRMATION_FAILED", "warning"],
    reminderFailures: ["WHATSAPP_REMINDER_FAILED", "warning"],
  }),
  pagamentos: Object.freeze({
    depositMismatches: ["PAYMENT_DEPOSIT_MISMATCH", "critical"],
    totalMismatches: ["PAYMENT_TOTAL_MISMATCH", "critical"],
    displayedStateMismatches: ["PAYMENT_DISPLAY_STATE_MISMATCH", "critical"],
  }),
  clientes: Object.freeze({
    accessFailures: ["CLIENT_ACCESS_FAILED", "critical"],
    phoneValidationFailures: ["CLIENT_PHONE_VALIDATION_FAILED", "warning"],
    duplicateCandidates: ["CLIENT_DUPLICATE_SUSPECTED", "warning"],
  }),
});

export const FUNCTIONAL_INTEGRATIONS = Object.freeze([
  { domain: "agenda", status: "PENDING_RLS_SCOPED_READ" },
  { domain: "reservas", status: "PENDING_RLS_SCOPED_READ" },
  { domain: "whatsapp", status: "PENDING_RLS_AND_PROVIDER_READ" },
  { domain: "pagamentos", status: "PENDING_RLS_AND_STRIPE_READ" },
  { domain: "clientes", status: "PENDING_RLS_SCOPED_READ" },
].map((item) => Object.freeze(item)));

const STUDIO_CODE = /^STUDIO_[A-Z0-9_]{1,24}$/;
const exactKeys = (value, expected) => value && typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).length === expected.length &&
  expected.every((key) => Object.hasOwn(value, key));

// The contract accepts aggregate counts only. Unknown fields (including PII)
// fail closed before any report or history write.
export function validateFunctionalSnapshot(input) {
  if (!exactKeys(input, ["schema", "source", "observedAt", "studios"]) ||
      input.schema !== 1 ||
      !["SYNTHETIC_FIXTURE", "RLS_AGGREGATE_READ"].includes(input.source) ||
      !Number.isFinite(Date.parse(input.observedAt)) ||
      !Array.isArray(input.studios) || input.studios.length < 1 ||
      input.studios.length > 10) throw new Error("FUNCTIONAL_INPUT_UNSAFE");
  const seen = new Set();
  const studios = input.studios.map((item) => {
    if (!exactKeys(item, ["studioCode", ...Object.keys(FUNCTIONAL_DOMAINS)]) ||
        !STUDIO_CODE.test(item.studioCode) || seen.has(item.studioCode)) {
      throw new Error("FUNCTIONAL_INPUT_UNSAFE");
    }
    seen.add(item.studioCode);
    const result = { studioCode: item.studioCode };
    for (const [domain, metrics] of Object.entries(FUNCTIONAL_DOMAINS)) {
      if (!exactKeys(item[domain], Object.keys(metrics))) {
        throw new Error("FUNCTIONAL_INPUT_UNSAFE");
      }
      result[domain] = {};
      for (const metric of Object.keys(metrics)) {
        const count = item[domain][metric];
        if (!Number.isSafeInteger(count) || count < 0 || count > 1000) {
          throw new Error("FUNCTIONAL_INPUT_UNSAFE");
        }
        result[domain][metric] = count;
      }
    }
    return result;
  });
  return { schema: 1, source: input.source,
    observedAt: input.observedAt, studios };
}

export function inspectFunctionalSnapshot(input) {
  const snapshot = validateFunctionalSnapshot(input);
  const anomalies = [];
  for (const studio of snapshot.studios) {
    for (const [domain, metrics] of Object.entries(FUNCTIONAL_DOMAINS)) {
      for (const [metric, [code, severity]] of Object.entries(metrics)) {
        const count = studio[domain][metric];
        if (count > 0) anomalies.push({
          studioCode: studio.studioCode, domain, code, severity,
          evidence: { aggregateCount: count },
        });
      }
    }
  }
  return anomalies;
}
