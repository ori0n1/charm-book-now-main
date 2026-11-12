const VERSION = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

// A proposal is data for human review. This module never opens or edits a source file.
export function planCorrection({ diagnosis, monitoring, now = () => new Date() } = {}) {
  const report = {
    agent: "forge", observedAt: now().toISOString(), status: "INDETERMINADO",
    source: diagnosis?.runId ?? null, plan: null, proposedPatch: null,
    handoff: ["valida", "guardiao"],
    recommendations: ["Obter diagnóstico estruturado e evidência suficiente antes de propor alteração."],
    publicationAuthorized: false,
  };
  if (!diagnosis || diagnosis.agent !== "sherlock" || !Array.isArray(diagnosis.findings)) return report;
  if (!diagnosis.findings.length || diagnosis.status === "INDETERMINADO") return report;
  const confirmed = diagnosis.findings.filter((item) => item.causeStatus === "CONFIRMADA");
  if (confirmed.length !== 1 || confirmed.length !== diagnosis.findings.length) {
    report.status = "BLOQUEADO";
    report.recommendations = ["Causa indeterminada ou múltipla; Sherlock deve comprovar a origem antes de qualquer proposta."];
    return report;
  }
  const finding = confirmed[0];
  const from = monitoring?.reference?.officialRecordedVersion;
  const to = monitoring?.reference?.observedVersion;
  if (finding.code !== "OFFICIAL_RECORD_OUTDATED" ||
      diagnosis.source?.runId !== monitoring?.runId ||
      monitoring.status === "INDETERMINADO" ||
      !VERSION.test(from ?? "") || !VERSION.test(to ?? "") || from === to) {
    report.status = "BLOQUEADO";
    report.recommendations = ["A causa confirmada não possui uma proposta mínima e comprovada nesta fase."];
    return report;
  }
  report.status = "PROPOSTA";
  report.plan = {
    scope: ["agents/reference.json"],
    purpose: "Reconciliar a referência de monitorização após comprovar a origem da versão ativa.",
    prerequisites: ["Confirmar correspondência entre artefacto ativo e código-fonte antes de alterar a referência."],
    validation: ["Valida: contratos sintéticos locais", "Guardião: escopo, evidências e riscos"],
  };
  report.proposedPatch = { file: "agents/reference.json", operation: "review-version-replacement", from, to, applied: false };
  report.recommendations = ["Submeter a proposta a Valida e Guardião; nenhum ficheiro foi alterado."];
  return report;
}

export function formatForgeReport(report) {
  return [
    `# Forge — ${report.status}`, "", `Execução: ${report.observedAt}`,
    `Diagnóstico Sherlock: ${report.source ?? "indisponível"}`, "",
    "## Proposta local", "",
    report.plan ? `- Escopo: ${report.plan.scope.join(", ")}` : "- Nenhuma proposta autorizada pelas evidências.",
    report.proposedPatch ? `- Substituição sugerida, não aplicada: ${report.proposedPatch.file} (${report.proposedPatch.from} → ${report.proposedPatch.to}).` : "- Nenhum patch preparado.",
    "", "## Encaminhamento", "", "- Valida: executar testes sintéticos manualmente.",
    "- Guardião: avaliar evidências e riscos manualmente.", "",
    ...report.recommendations.map((item) => `- ${item}`), "",
    "Este relatório não autoriza escrita em produção nem publicação.", "",
  ].join("\n");
}
