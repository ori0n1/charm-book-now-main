import { join } from "node:path";
import { DEFAULT_STATE_DIR } from "../../agents/atlas.mjs";
import { runMonitorOnce } from "../../agents/monitor.mjs";

// Local fault injection; no Chromium launch and no change to the live monitor state.
const result = await runMonitorOnce({ mode: "live", includePublic: true,
  includeVisual: true, stateDir: join(DEFAULT_STATE_DIR, "phase15-fault"),
  visualCheck: async () => { throw new Error("SYNTHETIC_VISUAL_FAILURE"); } });
process.stdout.write(JSON.stringify({
  cloudflare: result.status, auth: result.authStatus,
  http: result.publicStatus, visual: result.visualStatus,
  visualFailure: result.visualFailureCode,
  publicChecked: result.publicCheckedPages,
  publicExpected: result.publicExpectedPages,
  reportPath: result.reportPath,
}) + "\n");
if (result.authStatus !== "READY" || result.publicStatus !==
    "PAGINAS_E_RECURSOS_OK" || result.visualStatus !== "INDETERMINADO" ||
    result.visualFailureCode !== "VISUAL_CHECK_FAILED") process.exitCode = 2;
