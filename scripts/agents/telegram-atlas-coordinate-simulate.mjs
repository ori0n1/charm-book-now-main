import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createTaskManager } from "../../agents/telegram-gateway/tasks.mjs";

const stateDir = mkdtempSync(join(tmpdir(), "bellza-atlas-coordinate-"));
const monitorId = "00000000-0000-4000-8000-000000000026";
const now = () => new Date();
try {
  const calls = [];
  const manager = createTaskManager({ stateDir, now, toolRunner: {
    monitor_status: () => {
      calls.push("sentinela");
      return { source: "SYNTHETIC_LOCAL", status: "ATENCAO",
        monitorId, observedAt: now().toISOString() };
    },
    diagnose_anomaly: () => {
      calls.push("sherlock");
      return { source: "SYNTHETIC_LOCAL", status: "DIAGNOSTICADO",
        monitorId, observedAt: now().toISOString(),
        sourcesConsulted: ["SYNTHETIC_FIXTURE"],
        findings: [{ code: "VISUAL_JS_ERROR",
          causeStatus: "CONFIRMADA" }] };
    },
    run_synthetic_tests: () => {
      calls.push("valida");
      return { source: "SYNTHETIC_LOCAL", status: "APPROVED" };
    },
    prepare_investigation: () => {
      calls.push("forge");
      return { source: "SYNTHETIC_LOCAL",
        status: "PROPOSTA_DE_INVESTIGACAO",
        plan: "Rever apenas a regra indicada pelo diagnóstico sintético.",
        findings: [{ code: "VISUAL_JS_ERROR",
          causeStatus: "CONFIRMADA" }], applied: false };
    },
  } });
  const request = await manager.request({ botKey: "atlas",
    tool: "task_coordinate", updateId: 1,
    message: "Atlas, investiga o último problema, chama os agentes necessários e apresenta uma solução." });
  if (request.status !== "APPROVAL_REQUIRED")
    throw new Error("SYNTHETIC_APPROVAL_MISSING");
  // Aprovação exclusivamente simulada neste diretório temporário.
  const decision = await manager.callback({ botKey: "atlas",
    data: `t:${request.approval.id}:A` });
  const state = manager.read();
  const parent = state.tasks.find((item) => item.id === request.task.id);
  process.stdout.write(JSON.stringify({ mode: "SYNTHETIC_LOCAL",
    approval: "SYNTHETIC_ONLY", parentId: parent.id,
    parentStatus: parent.status,
    steps: parent.childIds.map((id) => {
      const task = state.tasks.find((item) => item.id === id);
      return { id: task.id, agent: task.agent, status: task.status,
        dependencyId: task.dependencyId,
        causeStatus: task.evidence?.causeStatus ?? null,
        applied: task.evidence?.applied ?? false };
    }), calls, summary: decision.followupMessage,
    remoteWrites: 0 }, null, 2) + "\n");
} finally {
  const target = resolve(stateDir);
  if (!target.startsWith(resolve(tmpdir()) + sep))
    throw new Error("TEMP_DIRECTORY_INVALID");
  rmSync(target, { recursive: true, force: true });
}
