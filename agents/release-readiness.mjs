const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const sorted = (values) => Array.isArray(values) &&
  values.every((value) => typeof value === "string") ?
  [...values].sort() : null;
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

// A read-only review of evidence. No credentials or deployment operation.
export function reviewReleaseEvidence({ active, candidate, tests, guardian,
  rollback, now = new Date() } = {}) {
  const missing = [];
  const observed = Date.parse(active?.observedAt ?? "");
  if (!UUID.test(active?.version ?? "") ||
      active?.authSource !== "WRANGLER_OAUTH_READ_ONLY" ||
      !Number.isFinite(observed) || now.getTime() - observed < 0 ||
      now.getTime() - observed > 30 * 60_000)
    missing.push("ACTIVE_VERSION_NOT_FRESH");
  if (candidate?.baseVersion !== active?.version ||
      !SHA.test(candidate?.artifactHash ?? "") ||
      candidate?.artifactVerified !== true ||
      candidate?.activeDiffReviewed !== true)
    missing.push("CANDIDATE_ORIGIN_UNVERIFIED");
  if (!sorted(active?.bindings) || !sorted(candidate?.bindings) ||
      !same(sorted(active.bindings), sorted(candidate.bindings)) ||
      !sorted(active?.crons) || !sorted(candidate?.crons) ||
      !same(sorted(active.crons), sorted(candidate.crons)) ||
      !active?.runtime || !candidate?.runtime ||
      !same(active.runtime, candidate.runtime))
    missing.push("EFFECTIVE_CONFIG_MISMATCH");
  if (candidate?.scopeReviewed !== true ||
      candidate?.protectedFeaturesReviewed !== true)
    missing.push("FUNCTIONAL_PRESERVATION_UNVERIFIED");
  if (tests?.local !== "PASS" ||
      !["PASS", "UNAVAILABLE_EXPLAINED"].includes(tests?.staging))
    missing.push("TEST_EVIDENCE_MISSING");
  if (guardian?.status !== "APTO")
    missing.push("GUARDIAN_REVIEW_MISSING");
  if (rollback?.validated !== true ||
      rollback?.version !== active?.version)
    missing.push("ROLLBACK_NOT_VALIDATED");
  return Object.freeze({
    status: missing.length ? "BLOQUEADO" : "PRONTO_PARA_REVISAO_HUMANA",
    missing, publicationAuthorized: false,
    canaryAuthorized: false, promotionAuthorized: false,
  });
}
