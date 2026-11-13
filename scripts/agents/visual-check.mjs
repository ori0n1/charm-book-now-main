import { runVisualCheck } from "../../agents/visual-flow.mjs";

const arg = process.argv[2];
const scenario = arg?.startsWith("--simulate=") ? arg.slice(11) : null;
if (process.argv.length > 3 || (arg && !scenario) ||
    (scenario && !["healthy", "js-error", "missing-main", "asset-404",
      "offline", "mobile-overflow"].includes(scenario))) {
  process.stderr.write("Uso: node scripts/agents/visual-check.mjs [--simulate=healthy|js-error|missing-main|asset-404|offline|mobile-overflow]\n");
  process.exitCode = 3;
} else {
  try {
    const result = await runVisualCheck({ mode: scenario ? "synthetic" : "live",
      scenario: scenario ?? "healthy" });
    const report = result.report;
    process.stdout.write([
      `Atlas visual: ${report.status} (${report.mode})`,
      `Fluxo: ${result.id}; páginas: ${report.selectedCount}/${report.discoveredCount}; renderizações: ${report.pages.length}; pedidos: ${report.requests}`,
      ...report.issues.map((issue) => `- ${issue.path} ${issue.viewport}: ${issue.code} [${issue.severity}]`),
      `Alertas locais: ${report.events.length}; Valida: ${report.validaStatus}; Guardião: ${report.guardiaoStatus}`,
      `Relatório: ${result.reportPath}`, "",
    ].join("\n"));
    if (report.status === "FALHAS_OBSERVADAS" || report.validaStatus !== "APPROVED")
      process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`Atlas visual: ${["CONFLICTING_RUN_ACTIVE", "VISUAL_STATE_INVALID",
      "INVALID_VISUAL_MODE", "INVALID_VISUAL_SCENARIO"].includes(error?.message)
      ? error.message : "LOCAL_FAILURE"}\n`);
    process.exitCode = 3;
  }
}
