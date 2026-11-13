import { join, resolve } from "node:path";
import { loadGatewayConfig } from "../../agents/telegram-gateway/config.mjs";
import { createTaskManager } from "../../agents/telegram-gateway/tasks.mjs";

if (process.argv[2] !== "status" || !process.env.LOCALAPPDATA) {
  process.stderr.write("Uso: node scripts/agents/telegram-tasks.mjs status\n");
  process.exitCode = 2;
} else {
  try {
    const config = loadGatewayConfig(resolve(process.env.LOCALAPPDATA,
      "Bellza", "TelegramGateway", "config.json"));
    const manager = createTaskManager({
      stateDir: join(config.stateDir, "tasks"), toolRunner: {} });
    process.stdout.write(JSON.stringify(manager.list().map((task) => ({
      id: task.id, agent: task.agent, status: task.status,
      dependencyId: task.dependencyId, updatedAt: task.updatedAt,
      source: task.evidence?.source ?? null,
      result: task.evidence?.status ?? null,
    })), null, 2) + "\n");
  } catch {
    process.stderr.write("TASK_STATUS_UNAVAILABLE\n");
    process.exitCode = 2;
  }
}
