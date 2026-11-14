export const STUDIO_CODE = /^STUDIO_[A-Z0-9_]{1,24}$/;
export const DOMAINS = Object.freeze({
  agenda: Object.freeze(["loadErrors", "queryErrors", "availabilityMismatches", "availableSlots"]),
  reservas: Object.freeze(["stateInconsistencies", "processingFailures", "observedCount"]),
  processamento: Object.freeze(["errorCount"]),
  notificacoes: Object.freeze(["failedCount"]),
  pagamentos: Object.freeze(["mismatchCount"]),
});

const exact = (value, keys) => value !== null && typeof value === "object" &&
  !Array.isArray(value) && Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

export function validateResult(value, { studioCode, domain } = {}) {
  if (!STUDIO_CODE.test(studioCode ?? "") || !Object.hasOwn(DOMAINS, domain ?? "") ||
      !exact(value, ["studioCode", "domain", "source", "observedAt", "windowMinutes", "coverage", "metrics"]) ||
      value.studioCode !== studioCode || value.domain !== domain ||
      !["SYNTHETIC_FIXTURE", "RLS_AGGREGATE_READ"].includes(value.source) ||
      !Number.isFinite(Date.parse(value.observedAt)) ||
      value.windowMinutes !== 30 ||
      !["OBSERVED", "PARTIAL", "NOT_VERIFIABLE"].includes(value.coverage)) {
    throw new Error("PRIVATE_API_UNSAFE_RESULT");
  }
  if (value.coverage === "NOT_VERIFIABLE") {
    if (value.metrics !== null) throw new Error("PRIVATE_API_UNSAFE_RESULT");
  } else {
    if (!exact(value.metrics, DOMAINS[domain]) ||
        Object.values(value.metrics).some((count) =>
          count !== null && (!Number.isSafeInteger(count) || count < 0 || count > 1000))) {
      throw new Error("PRIVATE_API_UNSAFE_RESULT");
    }
    const counts = Object.values(value.metrics);
    if (value.coverage === "OBSERVED" && counts.some((count) => count === null) ||
        value.coverage === "PARTIAL" &&
          (counts.every((count) => count === null) ||
           counts.every((count) => count !== null))) {
      throw new Error("PRIVATE_API_UNSAFE_RESULT");
    }
  }
  return value;
}
