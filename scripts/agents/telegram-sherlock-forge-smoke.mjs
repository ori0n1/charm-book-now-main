import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { createAgentTools } from "../../agents/telegram-gateway/tools.mjs";
import { createTaskManager } from "../../agents/telegram-gateway/tasks.mjs";

const monitorStateDir = process.argv[2];
if (!isAbsolute(monitorStateDir ?? ""))
  throw new Error("MONITOR_STATE_PATH_REQUIRED");
const stateDir = mkdtempSync(join(tmpdir(), "bellza-sherlock-forge-readonly-"));
try {
  const tools = createAgentTools({ monitorStateDir, stateDir });
  const manager = createTaskManager({ stateDir, toolRunner: tools });
  const sherlock = await manager.request({ botKey: "sherlock",
    tool: "task_investigate", updateId: 1,
    message: "Investiga a última monitorização Cloudflare indeterminada" });
  const forge = await manager.request({ botKey: "forge",
    tool: "task_propose", updateId: 2,
    message: `Analisa o diagnóstico ${sherlock.task.id}` });
  const present = (task) => ({ id: task.id, status: task.status,
    dependencyId: task.dependencyId,
    codes: task.evidence?.codes ?? [],
    historicalCodes: task.evidence?.historicalCodes ?? [],
    observedAt: task.evidence?.observedAt ?? null,
    sourcesConsulted: task.evidence?.sourcesConsulted ?? [],
    sourcesUnavailable: task.evidence?.sourcesUnavailable ?? [],
    reason: task.evidence?.reason ?? null,
    applied: task.evidence?.applied ?? false });
  process.stdout.write(JSON.stringify({ source: "LOCAL_MONITOR_REPORTS",
    sherlock: present(sherlock.task), forge: present(forge.task),
    remoteWrites: 0 }, null, 2) + "\n");
} finally {
  const target = resolve(stateDir);
  if (!target.startsWith(resolve(tmpdir()) + sep))
    throw new Error("TEMP_DIRECTORY_INVALID");
  rmSync(target, { recursive: true, force: true });
}
