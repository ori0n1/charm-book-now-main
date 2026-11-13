import { join } from "node:path";
import { DEFAULT_STATE_DIR } from "../../agents/atlas.mjs";
import { runMonitorOnce } from "../../agents/monitor.mjs";

// Manual synthetic preview only. The Windows task still invokes monitor.mjs.
const result = await runMonitorOnce({
  mode: "synthetic", scenario: "baseline", includePublic: true,
  includeVisual: true,
  stateDir: join(DEFAULT_STATE_DIR, "monitor-visual-preview"),
});
process.stdout.write(`Atlas: ${result.overallStatus}; Cloudflare: ${result.status}; ` +
  `HTTP: ${result.publicStatus}; visual: ${result.visualStatus}; ` +
  `vistas: ${result.visualObservedPages ?? 0}; alertas: ${result.events.length}\n` +
  `Relatório: ${result.reportPath}\n`);
if (result.visualStatus === "INDETERMINADO" || result.visualFailureCode)
  process.exitCode = 2;
