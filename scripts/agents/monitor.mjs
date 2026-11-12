import { join } from "node:path";
import { DEFAULT_STATE_DIR } from "../../agents/atlas.mjs";
import { runMonitorOnce } from "../../agents/monitor.mjs";

const argument = process.argv[2];
const scenarios = ["baseline", "version-change", "metadata-change", "outage", "auth-unavailable", "recovery"];
const simulation = argument?.startsWith("--simulate=") ? argument.slice("--simulate=".length) : null;
if (process.argv.length > 3 || (argument && !simulation) ||
    (simulation && !scenarios.includes(simulation))) {
  process.stderr.write("Uso: npm run agents:monitor [-- --simulate=baseline|version-change|metadata-change|outage|auth-unavailable|recovery]\n");
  process.exitCode = 3;
} else {
  try {
    const result = await runMonitorOnce({
      mode: simulation ? "synthetic" : "live",
      scenario: simulation ?? "baseline",
      stateDir: simulation ? join(DEFAULT_STATE_DIR, "monitor-simulated") : DEFAULT_STATE_DIR,
    });
    process.stdout.write([
      `Monitor: ${result.status} (${result.mode})`,
      `Run Sentinela: ${result.sentinelaRunId}`,
      `Alertas locais novos: ${result.events.length}`,
      ...result.events.map((item) => `- ${item.kind} ${item.severity}: ${item.code}`),
      `Pendências conhecidas: ${result.knownPending.join(", ") || "nenhuma"}`,
      `Relatório: ${result.reportPath}`, "",
    ].join("\n"));
    if (["ALERTA", "INDETERMINADO"].includes(result.status)) process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`Monitor: ${["MONITOR_CONFLICTING_RUN", "MONITOR_STATE_INVALID",
      "INVALID_MONITOR_SCENARIO"].includes(error?.message) ? error.message : "LOCAL_FAILURE"}\n`);
    process.exitCode = 3;
  }
}
