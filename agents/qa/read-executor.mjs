import { QA_IDENTITIES } from "./auth-session.mjs";
import { validateResult } from "../private-api/contract.mjs";

const READ_OPERATIONS = Object.freeze({ agenda: "agenda", reservas: "reservas" });

// Atlas, Sherlock and Valida may request only these fixed operations.
// enableLiveRead is a local integration switch, not evidence of real RLS.
// It remains false in every active component until isolation is proved.
export function createQaReadExecutor({ sources = new Map(), enableLiveRead = false,
  now = () => new Date() } = {}) {
  if (!(sources instanceof Map) || typeof now !== "function" ||
      typeof enableLiveRead !== "boolean") throw new Error("QA_EXECUTOR_CONFIG_INVALID");
  const active = new Set();
  return {
    capabilities: () => ({ qaStudios: Object.keys(QA_IDENTITIES),
      operations: Object.keys(READ_OPERATIONS), liveReadEnabled: enableLiveRead,
      writeOperations: [] }),
    async run({ studioCode, operation } = {}) {
      if (!Object.hasOwn(QA_IDENTITIES, studioCode ?? "") ||
          !Object.hasOwn(READ_OPERATIONS, operation ?? "")) {
        throw new Error("QA_OPERATION_DENIED");
      }
      if (!enableLiveRead) throw new Error("QA_RLS_PROOF_PENDING");
      if (active.has(studioCode)) throw new Error("QA_BUSY");
      const source = sources.get(studioCode);
      if (source?.kind !== "PREPARED_POSTGREST_RLS_GET" ||
          typeof source.read !== "function" ||
          source.status?.() !== "PROOF_SUPPLIED_NOT_LIVE_VALIDATED") {
        throw new Error("QA_SOURCE_UNAVAILABLE");
      }
      active.add(studioCode);
      const controller = new AbortController();
      let timer;
      let timedOut = false;
      const readPromise = Promise.resolve().then(() => source.read({ studioCode,
        domain: READ_OPERATIONS[operation], signal: controller.signal }));
      // If a source ignores abort, keep its studio lock until it settles.
      readPromise.then(() => { if (timedOut) active.delete(studioCode); },
        () => { if (timedOut) active.delete(studioCode); });
      try {
        const observed = await Promise.race([
          readPromise,
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              timedOut = true;
              controller.abort();
              reject(new Error("QA_TIMEOUT"));
            }, 2_500);
          }),
        ]);
        const result = validateResult(observed,
        { studioCode, domain: operation });
        if (result.source !== "RLS_AGGREGATE_READ") throw new Error("QA_SOURCE_UNAVAILABLE");
        return { studioCode, operation, coverage: result.coverage,
          metrics: result.metrics, observedAt: result.observedAt,
          evaluatedAt: now().toISOString() };
      } finally {
        clearTimeout(timer);
        if (!timedOut) active.delete(studioCode);
      }
    },
  };
}
