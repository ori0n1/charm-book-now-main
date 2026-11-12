import { runPublicCheck } from "../../agents/public-flow.mjs";

const arg = process.argv[2];
const scenario = arg?.startsWith("--simulate=") ? arg.slice(11) : null;
if (process.argv.length > 3 || (arg && !scenario) ||
    (scenario && !["healthy", "studio-failure", "resource-failure", "network-failure"].includes(scenario))) {
  process.stderr.write("Uso: node scripts/agents/public-check.mjs [--simulate=healthy|studio-failure|resource-failure|network-failure]\n");
  process.exitCode = 3;
} else {
  try {
    const result = await runPublicCheck({ mode: scenario ? "synthetic" : "live",
      scenario: scenario ?? "healthy" });
    const report = result.report;
    process.stdout.write([
      `Atlas público: ${report.status} (${report.mode})`,
      `Fluxo: ${result.id}; GET/HEAD: ${report.requests}`,
      ...report.pages.map((page) => `- ${page.studioCode}: ${page.status} (HTTP ${page.httpStatus ?? "indisponível"})`),
      `Anomalias: ${report.anomalies.length}; alertas novos/recuperados: ${report.events.length}`,
      ...report.events.map((item) => `- ${item.kind} ${item.severity}: ${item.studioCode} / ${item.code}`),
      `Sherlock: ${report.causeSummary}; Forge: ${report.proposalSummary}`,
      `Valida: ${report.tests}; Guardião: ${report.opinion}`,
      "Agenda interativa e reservas: NÃO VERIFICÁVEIS sem dados ou autenticação.",
      `Relatório: ${result.reportPath}`, "",
    ].join("\n"));
    if (report.status !== "PAGINAS_E_RECURSOS_OK" || report.tests !== "APPROVED")
      process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`Atlas público: ${["CONFLICTING_RUN_ACTIVE", "PUBLIC_STATE_INVALID",
      "INVALID_PUBLIC_MODE", "PUBLIC_VALIDATION_INVALID"].includes(error?.message)
      ? error.message : "LOCAL_FAILURE"}\n`);
    process.exitCode = 3;
  }
}
