const knownFindings = Object.freeze({
  OFFICIAL_RECORD_OUTDATED: {
    affected: ["controlo-de-versoes"],
    hypothesis: "A referência Git ainda não foi reconciliada com a observação Cloudflare.",
    basis: "A Sentinela registou versões diferentes no manifesto e na referência oficial.",
  },
  REFERENCE_OUTDATED: {
    affected: ["controlo-de-versoes"],
    hypothesis: "O Worker foi atualizado depois da observação do manifesto.",
    basis: "A Sentinela comparou a data da versão ativa com a data do manifesto.",
  },
  VERSION_DIVERGENCE_UNEXPLAINED: {
    affected: ["controlo-de-versoes"],
    hypothesis: null,
    basis: "A versão ativa difere da referência; a origem não foi comprovada.",
  },
  AUTH_UNAVAILABLE: {
    affected: ["monitorizacao-cloudflare"],
    hypothesis: "A sessão OAuth pode estar ausente ou expirada.",
    basis: "A leitura Cloudflare foi bloqueada antes da consulta.",
  },
  AUTH_REJECTED: {
    affected: ["monitorizacao-cloudflare"],
    hypothesis: "A sessão OAuth pode ter expirado ou não ter a permissão necessária.",
    basis: "A API rejeitou a leitura autorizada.",
  },
  AUTH_REFRESH_UNAVAILABLE: {
    affected: ["monitorizacao-cloudflare"], hypothesis: null,
    basis: "A renovação OAuth não terminou; a causa da falha ainda não foi identificada.",
  },
  AUTH_CHECK_UNAVAILABLE: {
    affected: ["monitorizacao-cloudflare"], hypothesis: null,
    basis: "A verificação OAuth falhou antes da consulta Cloudflare.",
  },
  AUTH_EXPIRED: {
    affected: ["monitorizacao-cloudflare"], hypothesis: null,
    basis: "A validade da sessão continuou insuficiente após a tentativa de renovação.",
  },
  CLOUDFLARE_RATE_LIMITED: {
    affected: ["monitorizacao-cloudflare"], hypothesis: null,
    basis: "A API respondeu HTTP 429; a aplicação não foi verificada.",
  },
  CLOUDFLARE_ENDPOINT_NOT_FOUND: {
    affected: ["monitorizacao-cloudflare"], hypothesis: null,
    basis: "A API respondeu HTTP 404; a rota ou configuração requer verificação.",
  },
  CLOUDFLARE_API_UNAVAILABLE: {
    affected: ["monitorizacao-cloudflare"], hypothesis: null,
    basis: "A API respondeu com erro de servidor; a aplicação não foi verificada.",
  },
  NETWORK_UNAVAILABLE: {
    affected: ["monitorizacao-cloudflare", "monitorizacao-publica"],
    hypothesis: "A rede ou o sandbox local pode ter bloqueado a consulta.",
    basis: "A Sentinela registou falha de rede.",
  },
  BINDINGS_DIVERGENCE_CONFIRMED: {
    affected: ["integracoes-do-worker"],
    hypothesis: null,
    basis: "Nomes ou tipos de bindings da versão ativa diferem do manifesto.",
  },
  RUNTIME_DIVERGENCE_CONFIRMED: {
    affected: ["worker"],
    hypothesis: null,
    basis: "A configuração de runtime da versão ativa difere do manifesto.",
  },
  CRONS_DIVERGENCE_CONFIRMED: {
    affected: ["tarefas-agendadas", "notificacoes-potenciais"],
    hypothesis: null,
    basis: "Os crons ativos diferem do manifesto; o efeito funcional requer verificação.",
  },
  PUBLIC_ENDPOINT_UNAVAILABLE: {
    affected: ["site-publico", "autenticacao-potencial"],
    hypothesis: null,
    basis: "Um endpoint público fixo não respondeu com HTTP de sucesso.",
  },
  PUBLIC_ENDPOINT_READ_BLOCKED: {
    affected: ["monitorizacao-publica"],
    hypothesis: null,
    basis: "Um endpoint público fixo não pôde ser verificado.",
  },
  TRAFFIC_NOT_SINGLE_100: {
    affected: ["worker"],
    hypothesis: null,
    basis: "A Sentinela não encontrou uma única versão com 100% do tráfego.",
  },
  SETTINGS_VERSION_MISMATCH: {
    affected: ["configuracao-cloudflare"],
    hypothesis: "Pode existir uma versão candidata ainda não ativa.",
    basis: "As definições do script e os bindings da versão ativa não coincidem.",
  },
});

export function diagnosePublic({ monitoring, now = () => new Date() } = {}) {
  if (monitoring?.agent !== "sentinela" || !Array.isArray(monitoring.anomalies))
    throw new Error("PUBLIC_EVIDENCE_INVALID");
  return {
    agent: "sherlock", observedAt: now().toISOString(), source: monitoring.runId,
    status: monitoring.anomalies.length ? "DIAGNOSTICADO" : "SEM_ANOMALIAS",
    findings: monitoring.anomalies.map((item) => ({
      studioCode: item.studioCode, code: item.code, scope: item.scope,
      causeStatus: "NAO_DETERMINADA", affected: item.studioCode === "GLOBAL"
        ? ["site-publico"] : ["pagina-publica-do-estudio", "interface-de-agendamento"],
      evidence: item.evidence,
    })),
  };
}

export function diagnoseFunctional({ monitoring, syntheticProof = null,
  now = () => new Date() } = {}) {
  const report = {
    agent: "sherlock", runId: null, observedAt: now().toISOString(),
    status: "INDETERMINADO", source: monitoring?.runId ?? null,
    findings: [],
  };
  if (!monitoring || monitoring.agent !== "sentinela" ||
      !Array.isArray(monitoring.anomalies) ||
      !["SYNTHETIC_SIMULATION", "ADAPTER_SIMULATION"].includes(monitoring.mode)) return report;
  const proofValid = monitoring.mode === "SYNTHETIC_SIMULATION" &&
    monitoring.anomalies.length === 1 &&
    syntheticProof?.studioCode === monitoring.anomalies[0].studioCode &&
    syntheticProof?.code === monitoring.anomalies[0].code &&
    syntheticProof?.causeCode === "SYNTHETIC_CAPACITY_RULE_MISMATCH" &&
    syntheticProof.code === "AGENDA_AVAILABILITY_MISMATCH";
  report.findings = monitoring.anomalies.map((item) => ({
    studioCode: item.studioCode, domain: item.domain, code: item.code,
    evidence: { aggregateCount: item.evidence.aggregateCount },
    causeStatus: proofValid ? "CONFIRMADA_EM_SIMULACAO" : "NAO_DETERMINADA",
    causeCode: proofValid ? syntheticProof.causeCode : null,
    affected: [item.domain],
  }));
  report.status = report.findings.length ? "DIAGNOSTICADO" : "SEM_ANOMALIAS";
  return report;
}

const safeCheck = (check) => ({
  name: check.name,
  status: check.status,
  ...(check.reason ? { reason: check.reason } : {}),
  ...(check.path ? { path: check.path } : {}),
  ...(Number.isInteger(check.httpStatus) ? { httpStatus: check.httpStatus } : {}),
});

export function diagnoseSentinela({
  sourceReport,
  recentEvents = [],
  syntheticProof = null,
  now = () => new Date(),
} = {}) {
  const report = {
    agent: "sherlock",
    observedAt: now().toISOString(),
    status: "INDETERMINADO",
    source: null,
    findings: [],
    recommendations: [],
    usage: { reportsRead: sourceReport ? 1 : 0, historyEventsRead: Math.min(recentEvents.length, 20) },
  };
  if (!sourceReport || sourceReport.agent !== "sentinela" ||
      !Array.isArray(sourceReport.anomalies) || !Array.isArray(sourceReport.checks)) {
    report.recommendations.push("Executar a Sentinela manualmente para obter um relatório estruturado.");
    return report;
  }
  report.source = {
    runId: sourceReport.runId ?? null,
    status: sourceReport.status,
    observedAt: sourceReport.observedAt,
  };
  const relevantEvents = recentEvents.filter((event) =>
    event.agent === "sentinela" && event.state === "COMPLETED").slice(-20);
  report.findings = sourceReport.anomalies.map((anomaly) => {
    const rule = knownFindings[anomaly.code];
    const evidence = sourceReport.checks
      .filter((check) => check.status !== "PASS")
      .map(safeCheck)
      .slice(0, 8);
    const priorOccurrences = relevantEvents.filter((event) =>
      event.id !== sourceReport.runId && event.anomalyCodes?.includes(anomaly.code)).length;
    // A synthetic proof is accepted only for the fixed local rehearsal. It is
    // never derived from a live Sentinela report or persisted as production evidence.
    const provenInSimulation = sourceReport.syntheticScenario === true &&
      anomaly.code === "OFFICIAL_RECORD_OUTDATED" &&
      sourceReport.anomalies.length === 1 &&
      sourceReport.checks.some((check) => check.name === "cloudflare_traffic" &&
        check.status === "PASS" && check.version === sourceReport.reference?.observedVersion) &&
      syntheticProof?.kind === "SYNTHETIC_OFFICIAL_RECORD_PROOF" &&
      syntheticProof.sourceRunId === sourceReport.runId &&
      syntheticProof.observedVersion === sourceReport.reference?.observedVersion &&
      syntheticProof.officialRecordedVersion === sourceReport.reference?.officialRecordedVersion &&
      syntheticProof.observedVersion !== syntheticProof.officialRecordedVersion;
    return {
      code: rule ? anomaly.code : "UNCLASSIFIED_ANOMALY",
      classification: anomaly.severity === "critical" ? "DIVERGENCIA_OBSERVADA" : "OBSERVACAO",
      causeStatus: provenInSimulation ? "CONFIRMADA" : "NAO_DETERMINADA",
      evidence,
      basis: rule?.basis ?? "A anomalia não tem regra de diagnóstico nesta fase.",
      hypothesis: rule?.hypothesis ?? null,
      affected: rule?.affected ?? ["nao-determinado"],
      priorOccurrences,
    };
  });
  report.status = sourceReport.status === "INDETERMINADO"
    ? "INDETERMINADO"
    : report.findings.length ? "DIAGNOSTICADO" : "SEM_ANOMALIAS";
  if (report.status === "INDETERMINADO") {
    report.recommendations.push("Restabelecer a evidência de leitura antes de concluir uma causa.");
  } else if (report.findings.length) {
    report.recommendations.push("Rever as hipóteses e a origem do artefacto; não alterar produção sem aprovação específica.");
  } else {
    report.recommendations.push("Nenhuma anomalia nos dados recebidos; manter monitorização manual.");
  }
  return report;
}

export function formatSherlockReport(report) {
  return [
    `# Sherlock — ${report.status}`,
    "",
    `Execução: ${report.observedAt}`,
    `Fonte Sentinela: ${report.source?.runId ?? "indisponível"}`,
    "",
    "## Diagnóstico",
    "",
    ...(report.findings.length
      ? report.findings.map((item) =>
        `- ${item.code}: ${item.basis} Causa: ${item.causeStatus}. ${item.hypothesis ? `Hipótese: ${item.hypothesis} ` : ""}Áreas possivelmente afetadas: ${item.affected.join(", ")}. Ocorrências anteriores: ${item.priorOccurrences}.`)
      : ["- Sem evidência suficiente ou sem anomalias."]),
    "",
    "## Recomendações",
    "",
    ...report.recommendations.map((item) => `- ${item}`),
    "",
  ].join("\n");
}
