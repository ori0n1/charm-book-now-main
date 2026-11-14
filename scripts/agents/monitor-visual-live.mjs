import { runMonitorOnce } from "../../agents/monitor.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { requireSharedMonitorStateDir } from "../../agents/monitor-shared-state.mjs";

// Keep the existing monitor history shared with the gateway. Never fall back
// to a new empty state directory when the local configuration is unavailable.
try {
  const configPath = join(process.env.LOCALAPPDATA ?? "",
    "Bellza", "TelegramGateway", "config.json");
  const stateDir = requireSharedMonitorStateDir(JSON.parse(
    readFileSync(configPath, "utf8")));
  const result = await runMonitorOnce({ mode: "live", includePublic: true,
    includeVisual: true, stateDir });
  process.stdout.write(`Atlas: ${result.overallStatus}; Cloudflare: ${result.status}; ` +
    `HTTP: ${result.publicStatus}; visual: ${result.visualStatus}; ` +
    `vistas: ${result.visualObservedPages ?? 0}; alertas: ${result.events.length}\n` +
    `Relatório: ${result.reportPath}\n`);
  if (["ALERTA", "INDETERMINADO"].includes(result.overallStatus))
    process.exitCode = 2;
} catch (error) {
  process.stderr.write(`Monitor preparado: ${error?.message === "MONITOR_CONFLICTING_RUN"
    ? "MONITOR_CONFLICTING_RUN" : "LOCAL_FAILURE"}\n`);
  process.exitCode = 3;
}
