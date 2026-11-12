import { FUNCTIONAL_DOMAINS } from "./functional-contract.mjs";

const emptyStudio = (studioCode) => ({
  studioCode,
  ...Object.fromEntries(Object.entries(FUNCTIONAL_DOMAINS).map(([domain, metrics]) =>
    [domain, Object.fromEntries(Object.keys(metrics).map((metric) => [metric, 0]))])),
});

export function functionalFixture(scenario, { now = () => new Date() } = {}) {
  if (!["baseline", "issues", "recovery", "proof"].includes(scenario)) {
    throw new Error("INVALID_FUNCTIONAL_SCENARIO");
  }
  const studios = [emptyStudio("STUDIO_27"), emptyStudio("STUDIO_EXEMPLO")];
  let syntheticProof = null;
  if (scenario === "issues") {
    studios[0].agenda.loadErrors = 2;
    studios[0].reservas.processingFailures = 1;
    studios[0].whatsapp.reminderFailures = 3;
    studios[0].pagamentos.depositMismatches = 1;
    studios[0].clientes.duplicateCandidates = 2;
    studios[1].agenda.availabilityMismatches = 1;
    studios[1].clientes.phoneValidationFailures = 1;
  }
  if (scenario === "proof") {
    studios[0].agenda.availabilityMismatches = 1;
    syntheticProof = {
      studioCode: "STUDIO_27",
      code: "AGENDA_AVAILABILITY_MISMATCH",
      causeCode: "SYNTHETIC_CAPACITY_RULE_MISMATCH",
    };
  }
  return {
    snapshot: { schema: 1, source: "SYNTHETIC_FIXTURE",
      observedAt: now().toISOString(), studios },
    syntheticProof,
  };
}
