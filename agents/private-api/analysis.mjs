import { FUNCTIONAL_DOMAINS } from "../functional-contract.mjs";
import { validateResult } from "./contract.mjs";

// Reuses Sentinela's existing anomaly codes without manufacturing zeroes for
// domains that have no authorized source.
export function inspectPrivateAggregate(result) {
  const safe = validateResult(result, {
    studioCode: result?.studioCode, domain: result?.domain,
  });
  if (safe.coverage !== "OBSERVED" ||
      !Object.hasOwn(FUNCTIONAL_DOMAINS, safe.domain)) return [];
  return Object.entries(FUNCTIONAL_DOMAINS[safe.domain])
    .filter(([metric]) => safe.metrics[metric] > 0)
    .map(([metric, [code, severity]]) => ({
      studioCode: safe.studioCode, domain: safe.domain, code, severity,
      evidence: { aggregateCount: safe.metrics[metric] },
      source: safe.source, observedAt: safe.observedAt,
    }));
}
