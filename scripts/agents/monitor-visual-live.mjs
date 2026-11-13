import { runMonitorOnce } from "../../agents/monitor.mjs";

// Prepared entry point. No Windows task invokes this file in phase 14.
try {
  const result = await runMonitorOnce({ mode: "live", includePublic: true,
    includeVisual: true });
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
