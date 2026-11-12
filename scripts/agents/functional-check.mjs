import { join } from "node:path";
import { DEFAULT_STATE_DIR } from "../../agents/atlas.mjs";
import { runFunctionalCheck } from "../../agents/functional-flow.mjs";

const argument = process.argv[2];
const scenarios = ["baseline", "issues", "recovery", "proof", "agenda-reservas"];
const scenario = argument?.startsWith("--simulate=")
  ? argument.slice("--simulate=".length) : null;
if (process.argv.length > 3 || (argument && !scenario) ||
    (scenario && !scenarios.includes(scenario))) {
  process.stderr.write("Uso: npm run agents:functional-check [-- --simulate=baseline|issues|recovery|proof|agenda-reservas]\n");
  process.exitCode = 3;
} else {
  try {
    const result = await runFunctionalCheck({
      mode: scenario ? "synthetic" : "live",
      scenario: scenario ?? "baseline",
      stateDir: join(DEFAULT_STATE_DIR,
        scenario ? "functional-simulated" : "functional-manual"),
    });
    const report = result.report;
    process.stdout.write([
      `Atlas funcional: ${report.status} (${report.mode})`,
      `Integração: ${report.integrationState}; acesso agenda/reservas: ${report.accessStatus ?? "simulação"}`,
      `Fluxo: ${result.id}`,
      `Anomalias: ${report.anomalies.length}; alertas locais novos: ${report.events.length}`,
      ...report.events.map((item) =>
        `- ${item.kind} ${item.severity}: ${item.studioCode} / ${item.code}`),
      `Causa: ${report.causeSummary}`,
      `Forge: ${report.proposalSummary}`,
      `Valida: ${report.testSummary} (testes locais sintéticos); Guardião: ${report.opinion}`,
      `Relatório: ${result.reportPath}`, "",
    ].join("\n"));
    if (report.mode !== "SYNTHETIC_SIMULATION" ||
        report.anomalies.length || report.testSummary !== "APPROVED") process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`Atlas funcional: ${[
      "CONFLICTING_RUN_ACTIVE", "FUNCTIONAL_STATE_INVALID",
      "INVALID_FUNCTIONAL_SCENARIO", "FUNCTIONAL_INPUT_UNSAFE",
    ].includes(error?.message) ? error.message : "LOCAL_FAILURE"}\n`);
    process.exitCode = 3;
  }
}
