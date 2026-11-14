import { DOMAINS, STUDIO_CODE } from "./contract.mjs";

// Explicit simulation only. No Supabase connection or customer rows.
export function createSyntheticSource({ now = () => new Date() } = {}) {
  return {
    kind: "SYNTHETIC_ONLY",
    async read({ studioCode, domain }) {
      if (!STUDIO_CODE.test(studioCode) || !Object.hasOwn(DOMAINS, domain)) {
        throw new Error("PRIVATE_API_SOURCE_DENIED");
      }
      const available = ["agenda", "reservas", "processamento"].includes(domain);
      const capivara = studioCode === "STUDIO_CAPIVARA";
      const values = {
        agenda: { loadErrors: capivara ? 1 : 0, queryErrors: 0,
          availabilityMismatches: 0, availableSlots: capivara ? 4 : 7 },
        reservas: { stateInconsistencies: 0, processingFailures: 0,
          observedCount: capivara ? 3 : 2 },
        processamento: { errorCount: capivara ? 1 : 0 },
      };
      return { studioCode, domain, source: "SYNTHETIC_FIXTURE",
        observedAt: now().toISOString(), windowMinutes: 30,
        coverage: available ? "OBSERVED" : "NOT_VERIFIABLE",
        metrics: available ? values[domain] : null };
    },
  };
}
