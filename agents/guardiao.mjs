const ALLOWED_SCOPE = new Set(["agents/reference.json"]);

export function reviewPublic({ monitoring, diagnosis, proposal, validation,
  now = () => new Date() } = {}) {
  const linked = diagnosis?.source === monitoring?.runId &&
    proposal?.source === diagnosis?.runId;
  const noPatch = proposal?.proposedPatch === null &&
    proposal?.plan?.applied !== true && proposal?.publicationAuthorized === false;
  const testsPassed = validation?.status === "APPROVED";
  return {
    agent: "guardiao", observedAt: now().toISOString(),
    sources: { sentinela: monitoring?.runId, sherlock: diagnosis?.runId,
      forge: proposal?.runId, valida: validation?.runId },
    status: !linked || !noPatch || validation?.status === "FAILED" ? "BLOQUEADO" :
      "INDETERMINADO",
    checks: [
      { name: "evidence_chain", status: linked ? "PASS" : "FAIL" },
      { name: "no_applied_patch", status: noPatch ? "PASS" : "FAIL" },
      { name: "synthetic_tests", status: testsPassed ? "PASS" :
        validation?.status === "FAILED" ? "FAIL" : "UNKNOWN" },
    ],
    risks: ["AGENDA_INTERACTIVITY_NOT_VERIFIED", "PRODUCTION_PARITY_NOT_VERIFIED"],
    publicationAuthorized: false, deployAllowed: false,
  };
}

export function reviewFunctional({ monitoring, diagnosis, proposal, validation,
  now = () => new Date() } = {}) {
  const report = {
    agent: "guardiao", runId: null, observedAt: now().toISOString(),
    status: "INDETERMINADO",
    sources: { sentinela: monitoring?.runId ?? null,
      sherlock: diagnosis?.runId ?? null, forge: proposal?.runId ?? null,
      valida: validation?.runId ?? null },
    checks: [], risks: ["NO_AUTHORIZED_FUNCTIONAL_RLS_READ",
      "PRODUCTION_PARITY_NOT_VERIFIED"],
    publicationAuthorized: false, deployAllowed: false,
  };
  const linked = diagnosis?.source === monitoring?.runId &&
    proposal?.source === diagnosis?.runId &&
    monitoring?.mode === "SYNTHETIC_SIMULATION";
  const testsPassed = validation?.status === "APPROVED" &&
    validation.tests?.length === 7 &&
    validation.tests.every((item) => item.state === "PASS");
  report.checks = [
    { name: "evidence_chain", status: monitoring?.mode !== "SYNTHETIC_SIMULATION"
      ? "UNKNOWN" : linked ? "PASS" : "FAIL" },
    { name: "isolated_tests", status: testsPassed ? "PASS" :
      validation?.status === "FAILED" ? "FAIL" : "UNKNOWN" },
    { name: "proposal_not_applied", status:
      proposal?.proposedPatch === null && proposal?.publicationAuthorized === false &&
      proposal?.plan?.applied !== true ? "PASS" : "FAIL" },
  ];
  if (report.checks.some((item) => item.status === "FAIL")) report.status = "BLOQUEADO";
  return report;
}

export function reviewProposal({ proposal, validation, diagnosis, monitoring, now = () => new Date() } = {}) {
  const report = {
    agent: "guardiao", observedAt: now().toISOString(), status: "INDETERMINADO",
    sources: {
      forge: proposal?.runId ?? null, valida: validation?.runId ?? null,
      sherlock: diagnosis?.runId ?? null, sentinela: monitoring?.runId ?? null,
    },
    checks: [], risks: [], publicationAuthorized: false, deployAllowed: false,
    recommendation: "Reunir proposta, diagnóstico, monitorização e testes locais válidos.",
  };
  if (!proposal || !validation || !diagnosis || !monitoring) {
    report.risks.push("EVIDENCE_INCOMPLETE");
    return report;
  }
  if (proposal.status === "INDETERMINADO") {
    report.risks.push("EVIDENCE_INCOMPLETE");
    return report;
  }
  if (proposal.status !== "PROPOSTA" || !proposal.plan || !proposal.proposedPatch) {
    report.status = "BLOQUEADO";
    report.risks.push("NO_ACTIONABLE_PROPOSAL");
    report.recommendation = "Forge deve apresentar uma proposta com causa comprovada.";
    return report;
  }
  const patch = proposal.proposedPatch;
  const scopeSafe = Array.isArray(proposal.plan.scope) && proposal.plan.scope.length === 1 &&
    proposal.plan.scope.every((item) => ALLOWED_SCOPE.has(item)) &&
    patch.file === proposal.plan.scope[0] && patch.operation === "review-version-replacement" &&
    patch.applied === false && proposal.publicationAuthorized === false;
  report.checks.push({ name: "scope", status: scopeSafe ? "PASS" : "FAIL" });
  const evidenceSafe = proposal.source === diagnosis.runId &&
    diagnosis.source?.runId === monitoring.runId &&
    diagnosis.findings?.length === 1 &&
    diagnosis.findings[0].causeStatus === "CONFIRMADA" &&
    diagnosis.findings[0].code === "OFFICIAL_RECORD_OUTDATED" &&
    patch.from === monitoring.reference?.officialRecordedVersion &&
    patch.to === monitoring.reference?.observedVersion && patch.from !== patch.to;
  report.checks.push({ name: "evidence", status: evidenceSafe ? "PASS" : "FAIL" });
  const completeTests = Array.isArray(validation.tests) && validation.tests.length === 7 &&
    validation.tests.every((item) => item.state === "PASS") &&
    validation.usage?.testsRun === 7;
  const freshTests = Number.isFinite(Date.parse(validation.observedAt)) &&
    Number.isFinite(Date.parse(proposal.observedAt)) &&
    Date.parse(validation.observedAt) > Date.parse(proposal.observedAt);
  const testStatus = validation.status === "FAILED" ? "FAIL" :
    validation.status === "APPROVED" && completeTests && freshTests ? "PASS" : "UNKNOWN";
  report.checks.push({ name: "synthetic_tests", status: testStatus });
  if (!scopeSafe || !evidenceSafe || testStatus === "FAIL") {
    report.status = "BLOQUEADO";
    if (!scopeSafe) report.risks.push("SCOPE_OR_PERMISSION_RISK");
    if (!evidenceSafe) report.risks.push("UNPROVEN_CAUSE_OR_VERSION");
    if (testStatus === "FAIL") report.risks.push("REGRESSION_TEST_FAILED");
    report.recommendation = "Corrigir as falhas locais antes de voltar a avaliar; publicação proibida.";
  } else if (testStatus === "UNKNOWN" || monitoring.status === "INDETERMINADO") {
    report.status = "INDETERMINADO";
    report.risks.push("EVIDENCE_INCOMPLETE");
  } else {
    report.status = "APTO";
    report.recommendation = "Proposta local apta a revisão humana; comparar artefacto, funções e configuração ativa antes de qualquer publicação.";
  }
  report.risks.push("PRODUCTION_PARITY_AND_ROLLBACK_NOT_VERIFIED");
  return report;
}

export function formatGuardiaoReport(report) {
  return [
    `# Guardião — ${report.status}`, "", `Execução: ${report.observedAt}`,
    "Parecer limitado à proposta local. Publicação: NÃO AUTORIZADA.", "",
    "## Fontes", "",
    ...Object.entries(report.sources).map(([name, id]) => `- ${name}: ${id ?? "indisponível"}`),
    "", "## Verificações", "",
    ...(report.checks.length ? report.checks.map((item) => `- ${item.name}: ${item.status}`) : ["- Evidências incompletas."]),
    "", "## Riscos", "",
    ...(report.risks.length ? report.risks.map((item) => `- ${item}`) : ["- Nenhum risco local adicional identificado."]),
    "", `Recomendação: ${report.recommendation}`, "",
    "APTO nunca equivale a autorização humana de deploy, migração ou rollback.", "",
  ].join("\n");
}
