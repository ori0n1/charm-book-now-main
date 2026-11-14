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
      value.source !== "SYNTHETIC_FIXTURE" ||
      !Number.isFinite(Date.parse(value.observedAt)) ||
      value.windowMinutes !== 30 ||
      !["OBSERVED", "NOT_VERIFIABLE"].includes(value.coverage)) {
    throw new Error("PRIVATE_API_UNSAFE_RESULT");
  }
  if (value.coverage === "NOT_VERIFIABLE") {
    if (value.metrics !== null) throw new Error("PRIVATE_API_UNSAFE_RESULT");
  } else if (!exact(value.metrics, DOMAINS[domain]) ||
      Object.values(value.metrics).some((count) =>
        !Number.isSafeInteger(count) || count < 0 || count > 1000)) {
    throw new Error("PRIVATE_API_UNSAFE_RESULT");
  }
  return value;
}
