import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTaskManager } from "../../agents/telegram-gateway/tasks.mjs";

const stateDir = mkdtempSync(join(tmpdir(), "bellza-tasks-synthetic-"));
try {
  const manager = createTaskManager({ stateDir, toolRunner: {
    monitor_status: () => ({ source: "SYNTHETIC_LOCAL", status: "ATENCAO",
      monitorId: "00000000-0000-4000-8000-000000000023",
      observedAt: "2026-11-13T12:00:00Z" }),
    diagnose_anomaly: () => ({ source: "SYNTHETIC_LOCAL",
      status: "DIAGNOSTICADO", monitorId:
      "00000000-0000-4000-8000-000000000023",
      findings: [{ code: "VISUAL_JS_ERROR",
        causeStatus: "NAO_DETERMINADA" }] }),
    run_synthetic_tests: () => ({ source: "SYNTHETIC_LOCAL",
      status: "APPROVED" }),
  } });
  const sentinela = await manager.request({ botKey: "atlas",
    tool: "task_monitor", message: "Verifica a Bellza", updateId: 1 });
  const sherlock = await manager.request({ botKey: "atlas",
    tool: "task_investigate", message: "Investiga a falha", updateId: 2 });
  const forge = await manager.request({ botKey: "forge",
    tool: "task_propose", message: `Prepara proposta para ${sherlock.task.id}`,
    updateId: 3 });
  const valida = await manager.request({ botKey: "valida",
    tool: "task_validate", message: "Testa localmente", updateId: 4 });
  const decision = await manager.callback({ botKey: "valida",
    data: `t:${valida.approval.id}:A` });
  process.stdout.write(JSON.stringify({ mode: "SYNTHETIC_LOCAL",
    tasks: [sentinela, sherlock, forge, decision].map((item) => ({
      id: item.task.id, agent: item.task.agent,
      status: item.task.status,
      dependencyId: item.task.dependencyId })),
    approval: "LOCAL_ONLY_CONSUMED", remoteWrites: 0,
    forgePatchApplied: false }, null, 2) + "\n");
} finally {
  rmSync(stateDir, { recursive: true, force: true });
}
