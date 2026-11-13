import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentTools } from "../../agents/telegram-gateway/tools.mjs";
import { createTaskManager } from "../../agents/telegram-gateway/tasks.mjs";
import { createGateway } from "../../agents/telegram-gateway/gateway.mjs";
import { BOT_KEYS, validateGatewayConfig } from "../../agents/telegram-gateway/config.mjs";

const root = mkdtempSync(join(tmpdir(), "bellza-phase25-"));
process.on("exit", () => rmSync(root, { recursive: true, force: true }));
let counter = 0;
const now = () => new Date("2026-11-13T18:00:00Z");
const id = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
function write(path, value) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}
function fixture({ missingCurrent = false } = {}) {
  const base = join(root, `case-${++counter}`);
  const monitorStateDir = join(base, "monitor");
  const stateDir = join(base, "gateway");
  const previous = id(1);
  const current = id(2);
  const publicRunId = id(3);
  const visualRunId = id(4);
  const at = "2026-11-13T17:30:00Z";
  write(join(monitorStateDir, "monitor-state.json"), {
    journal: [
      { monitorId: id(11), sentinelaRunId: previous,
        at: "2026-11-13T17:00:00Z", overallStatus: "ATENCAO" },
      { monitorId: id(12), sentinelaRunId: current, publicRunId,
        visualRunId, at, overallStatus: "INDETERMINADO",
        eventCodes: ["NEW:AUTH_UNAVAILABLE"] },
    ], alerts: [],
  });
  write(join(monitorStateDir, "runs", `${previous}.json`), {
    agent: "sentinela", runId: previous, status: "ATENCAO",
    anomalies: [{ code: "OFFICIAL_RECORD_OUTDATED" }], checks: [],
  });
  if (!missingCurrent) write(join(monitorStateDir, "runs", `${current}.json`), {
    agent: "sentinela", runId: current, status: "INDETERMINADO",
    anomalies: [{ code: "AUTH_UNAVAILABLE", severity: "warning" }],
    checks: [{ name: "cloudflare_auth", status: "UNAVAILABLE" }],
  });
  write(join(monitorStateDir, "public-integrated", "public-state.json"), {
    history: [{ flowId: publicRunId }], issues: [],
  });
  write(join(monitorStateDir, "visual-prepared", "visual-state.json"), {
    history: [{ flowId: visualRunId }], issues: [],
  });
  write(join(stateDir, "incidents", "incident-state.json"), {
    incidents: [{ state: "OPEN", code: "AUTH_UNAVAILABLE",
      lastObservedMonitorId: id(12), steps: { sherlock: "INDETERMINADO" } }],
  });
  const tools = createAgentTools({ monitorStateDir, stateDir, now });
  const manager = createTaskManager({ stateDir, toolRunner: tools, now });
  return { stateDir, monitorStateDir, tools, manager };
}

test("Sherlock consulta o relatório Cloudflare atual; Forge avalia a mesma tarefa", async () => {
  const f = fixture();
  const sherlock = await f.manager.request({ botKey: "sherlock",
    tool: "task_investigate", updateId: 1,
    message: "Investiga por que a última monitorização Cloudflare ficou indeterminada." });
  assert.equal(sherlock.task.status, "BLOQUEADA");
  assert.equal(sherlock.task.evidence.monitorId, id(12));
  assert.deepEqual(sherlock.task.evidence.codes, ["AUTH_UNAVAILABLE"]);
  assert(sherlock.task.evidence.sourcesConsulted.includes("CURRENT_SENTINELA_REPORT"));
  const forge = await f.manager.request({ botKey: "forge",
    tool: "task_propose", updateId: 2,
    message: `Analisa o diagnóstico do Sherlock ${sherlock.task.id} e verifica a proposta.` });
  assert.equal(forge.task.dependencyId, sherlock.task.id);
  assert.equal(forge.task.status, "BLOQUEADA");
  assert.equal(forge.task.evidence.reason, "CAUSE_NOT_PROVEN");
  assert(forge.task.evidence.sourcesConsulted.includes("SHERLOCK_TASK_DIAGNOSIS"));
  assert.equal(forge.task.evidence.applied, false);
  assert.match((await f.manager.request({ botKey: "atlas",
    tool: "task_overview", updateId: 3, message: "Acompanha as tarefas" })).reply,
  /sherlock BLOQUEADA.*forge BLOQUEADA/);
  assert.equal(JSON.parse(readFileSync(join(f.stateDir, "shared",
    `proposal-${forge.task.id}.json`))).applied, false);
});

test("relatório atual ausente não transforma evidência histórica em saúde atual", async () => {
  const f = fixture({ missingCurrent: true });
  const sherlock = await f.manager.request({ botKey: "atlas",
    tool: "task_investigate", updateId: 1,
    message: "Atlas, encaminha o problema ao Sherlock" });
  assert.equal(sherlock.task.evidence.status, "INDETERMINADO");
  assert.deepEqual(sherlock.task.evidence.codes, ["AUTH_UNAVAILABLE"]);
  assert.deepEqual(sherlock.task.evidence.historicalCodes,
    ["OFFICIAL_RECORD_OUTDATED"]);
  assert(sherlock.task.evidence.sourcesConsulted.includes("MONITOR_JOURNAL"));
  assert(sherlock.task.evidence.sourcesConsulted.includes("PRIOR_SENTINELA_REPORT"));
  assert(sherlock.task.evidence.sourcesUnavailable.includes("CURRENT_SENTINELA_REPORT"));
  assert.match(sherlock.reply, /Falta: Sentinela atual/);
  assert(sherlock.reply.length <= 320);
  const forge = await f.manager.request({ botKey: "forge",
    tool: "task_propose", updateId: 2,
    message: "Analisa o último diagnóstico do Sherlock" });
  assert.equal(forge.task.dependencyId, sherlock.task.id);
  assert.equal(forge.task.status, "BLOQUEADA");
  assert.equal(forge.task.evidence.reason, "CAUSE_NOT_PROVEN");
});

test("Forge não troca uma dependência explícita por outro diagnóstico", async () => {
  const f = fixture();
  const unknown = id(99);
  const request = await f.manager.request({ botKey: "forge",
    tool: "task_propose", updateId: 1,
    message: `Analisa o diagnóstico ${unknown}` });
  assert.equal(request.task.status, "BLOQUEADA");
  assert.equal(request.task.events.at(-1).code, "TASK_REFERENCE_NOT_FOUND");
  assert.equal(request.task.evidence, null);
});

test("causa confirmada sem prova de patch não autoriza proposta local", async () => {
  const stateDir = join(root, `proof-${++counter}`);
  const manager = createTaskManager({ stateDir, now, toolRunner: {
    diagnose_anomaly: () => ({ source: "SYNTHETIC_LOCAL",
      status: "DIAGNOSTICADO", findings: [{ code: "SYNTHETIC_CASE",
        causeStatus: "CONFIRMADA" }] }),
    prepare_investigation: () => ({ source: "SYNTHETIC_LOCAL",
      status: "PROPOSTA_DE_INVESTIGACAO", applied: false }),
  } });
  const diagnostic = await manager.request({ botKey: "sherlock",
    tool: "task_investigate", updateId: 1, message: "Investiga fixture" });
  const proposal = await manager.request({ botKey: "forge",
    tool: "task_propose", updateId: 2,
    message: `Analisa ${diagnostic.task.id}` });
  assert.equal(proposal.task.status, "BLOQUEADA");
  assert.equal(proposal.task.evidence.reason, "PATCH_PROOF_REQUIRED");
  assert.equal(proposal.task.evidence.applied, false);
});

test("gateway com tarefas oferece somente executor operacional a Sherlock e Forge", async () => {
  const f = fixture();
  const config = validateGatewayConfig({ schema: 1, ownerUserId: 12345,
    ownerChatId: 12345, stateDir: join(root, `bot-${counter}`),
    monitorStateDir: f.monitorStateDir, alertsEnabled: false,
    ai: { model: "synthetic", maxCallsPerDay: 12,
      maxTokensPerDay: 10000, maxDailyUsd: 0.25,
      inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.5 },
    bots: Object.fromEntries(BOT_KEYS.map((key) => [key,
      { username: `bellza_${key}_bot`, secretName: `telegram-${key}`,
        enabled: key !== "guardiao" }])) });
  const aiByBot = Object.fromEntries(["sherlock", "forge"].map((botKey) =>
    [botKey, { route: async ({ tools }) => {
      assert(tools.includes(botKey === "sherlock" ?
        "task_investigate" : "task_propose"));
      assert(!tools.includes(botKey === "sherlock" ?
        "diagnose_anomaly" : "prepare_investigation"));
      return { choice: { tool: botKey === "sherlock" ?
        "task_investigate" : "task_propose", studio: null, hours: 24 } };
    }, answer: async () => { throw new Error("UNEXPECTED_ANSWER"); } }]));
  const gateway = createGateway({ config, aiByBot, clients: {},
    toolRunner: f.tools, taskManager: f.manager, now });
  const update = (text, updateId) => ({ update_id: updateId,
    message: { text, from: { id: 12345, is_bot: false },
      chat: { id: 12345, type: "private" } } });
  const diagnostic = await gateway.handleUpdate("sherlock", update(
    "Investiga por que a última monitorização Cloudflare ficou indeterminada", 1));
  assert.equal(diagnostic.task.agent, "sherlock");
  assert.equal(diagnostic.task.evidence.codes[0], "AUTH_UNAVAILABLE");
  const proposal = await gateway.handleUpdate("forge", update(
    "Analisa o último diagnóstico do Sherlock", 2));
  assert.equal(proposal.task.agent, "forge");
  assert.equal(proposal.task.dependencyId, diagnostic.task.id);
  assert.equal(proposal.task.evidence.reason, "CAUSE_NOT_PROVEN");
});
