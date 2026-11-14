import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewReleaseEvidence } from "../../agents/release-readiness.mjs";

const version = "00000000-0000-4000-8000-000000000028";
const now = new Date("2026-11-14T00:00:00Z");
const evidence = () => ({
  now,
  active: { version, authSource: "WRANGLER_OAUTH_READ_ONLY",
    observedAt: "2026-11-13T23:50:00Z",
    bindings: ["A:secret_text", "B:plain_text"],
    crons: ["0 * * * *"], runtime: { compatibility_date: "2026-11-01" } },
  candidate: { baseVersion: version, artifactHash: "a".repeat(64),
    artifactVerified: true, activeDiffReviewed: true,
    bindings: ["B:plain_text", "A:secret_text"],
    crons: ["0 * * * *"], runtime: { compatibility_date: "2026-11-01" },
    scopeReviewed: true, protectedFeaturesReviewed: true },
  tests: { local: "PASS", staging: "UNAVAILABLE_EXPLAINED" },
  guardian: { status: "APTO" },
  rollback: { validated: true, version },
});

test("evidência completa só permite revisão humana, nunca publicação", () => {
  const result = reviewReleaseEvidence(evidence());
  assert.equal(result.status, "PRONTO_PARA_REVISAO_HUMANA");
  assert.equal(result.publicationAuthorized, false);
  assert.equal(result.canaryAuthorized, false);
  assert.equal(result.promotionAuthorized, false);
});

test("versão antiga, configuração, testes, Guardião e rollback bloqueiam", () => {
  const input = evidence();
  input.active.observedAt = "2026-11-13T22:00:00Z";
  input.candidate.bindings = ["A:secret_text"];
  input.tests.local = "FAILED";
  input.guardian.status = "DISABLED";
  input.rollback.validated = false;
  const result = reviewReleaseEvidence(input);
  assert.equal(result.status, "BLOQUEADO");
  assert.deepEqual(result.missing, [
    "ACTIVE_VERSION_NOT_FRESH", "EFFECTIVE_CONFIG_MISMATCH",
    "TEST_EVIDENCE_MISSING", "GUARDIAN_REVIEW_MISSING",
    "ROLLBACK_NOT_VALIDATED",
  ]);
});
