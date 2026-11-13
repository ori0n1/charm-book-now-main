import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync,
  writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTaskManager, approvalButtons } from
  "../../agents/telegram-gateway/tasks.mjs";
import { createGateway } from "../../agents/telegram-gateway/gateway.mjs";
import { createTelegramClient } from "../../agents/telegram-gateway/telegram.mjs";
import { prepareReferencePatchWorkspace } from
  "../../agents/telegram-gateway/patch-worktree.mjs";
import { createAgentTools } from
  "../../agents/telegram-gateway/tools.mjs";
import { BOT_KEYS, validateGatewayConfig } from
  "../../agents/telegram-gateway/config.mjs";

const root = mkdtempSync(join(tmpdir(), "bellza-phase23-"));
process.on("exit", () => rmSync(root, { recursive: true, force: true }));
let count = 0;
function fixture() {
  const stateDir = join(root, `case-${++count}`);
  let time = new Date("2026-11-13T12:00:00Z");
  const calls = [];
  const toolRunner = {
    monitor_status: () => { calls.push("monitor"); return {
      source: "MONITOR_HISTORY", status: "ATENCAO",
      observedAt: "2026-11-13T11:30:00Z" }; },
    monitor_alerts: () => { calls.push("watch"); return {
      source: "HISTORY", status: "HISTORICO" }; },
    diagnose_anomaly: () => { calls.push("sherlock"); return {
      source: "ACTIVE_READ_ONLY", status: "INDETERMINADO",
      findings: [{ code: "VISUAL_JS_ERROR",
        causeStatus: "NAO_DETERMINADA" }] }; },
    run_synthetic_tests: () => { calls.push("valida"); return {
      source: "SYNTHETIC_LOCAL", status: "APPROVED" }; },
    prepare_investigation: () => { calls.push("forge"); return {
      source: "SYNTHETIC_LOCAL", status: "PROPOSTA", applied: false }; },
  };
  const manager = createTaskManager({ stateDir, toolRunner,
    now: () => time });
  const request = (botKey, tool, updateId, message = "pedido") =>
    manager.request({ botKey, tool, updateId, message });
  return { manager, request, calls, stateDir, toolRunner,
    advance: (ms) => { time = new Date(time.getTime() + ms); },
    now: () => time };
}

test("Atlas regista tarefas persistentes e encaminha por agente", async () => {
  const f = fixture();
  const first = await f.request("atlas", "task_monitor", 1);
  assert.equal(first.task.agent, "sentinela");
  assert.equal(first.task.status, "CONCLUIDA");
  assert.deepEqual(f.calls, ["monitor"]);
  assert.equal(f.manager.list()[0].evidence.observedAt,
    "2026-11-13T11:30:00Z");
  const duplicate = await f.request("atlas", "task_monitor", 1);
  assert.equal(duplicate.status, "DUPLICATE");
  assert.deepEqual(f.calls, ["monitor"]);
  const reopened = createTaskManager({ stateDir: f.stateDir,
    toolRunner: f.toolRunner, now: f.now });
  assert.equal(reopened.list()[0].id, first.task.id);
  assert.match((await f.request("atlas", "task_overview", 2)).reply,
    /sentinela CONCLUIDA/);
});

test("Sherlock não comprova causa inexistente; Forge não executa proposta", async () => {
  const f = fixture();
  const diagnostic = await f.request("sherlock", "task_investigate", 1,
    "Investiga a falha da Capivara");
  assert.equal(diagnostic.task.evidence.causeStatus, "NAO_DETERMINADA");
  const proposal = await f.request("forge", "task_propose", 2,
    `Prepara proposta para ${diagnostic.task.id}`);
  assert.equal(proposal.task.status, "BLOQUEADA");
  assert.equal(proposal.task.dependencyId, diagnostic.task.id);
  assert.deepEqual(f.calls, ["sherlock"]);
  assert.equal(f.manager.read().tasks[1].events.at(-1).code,
    "CAUSE_NOT_PROVEN");
});

test("Valida só executa após botão autorizado; decisão é de uso único", async () => {
  const f = fixture();
  const ask = await f.request("valida", "task_validate", 1,
    "Executa testes sintéticos locais");
  assert.equal(ask.task.status, "AGUARDANDO_APROVACAO");
  assert.deepEqual(f.calls, []);
  assert.equal(approvalButtons(ask.approval.id).inline_keyboard[0].length, 3);
  assert.equal((await f.manager.callback({ botKey: "valida",
    data: `t:${ask.approval.id}:D` })).status, "DETAILS");
  assert.equal((await f.manager.callback({ botKey: "atlas",
    data: `t:${ask.approval.id}:A` })).status, "REJECTED");
  assert.deepEqual(f.calls, []);
  const approved = await f.manager.callback({ botKey: "valida",
    data: `t:${ask.approval.id}:A` });
  assert.equal(approved.task.status, "CONCLUIDA");
  assert.deepEqual(f.calls, ["valida"]);
  assert.equal((await f.manager.callback({ botKey: "valida",
    data: `t:${ask.approval.id}:A` })).status, "REPLAY");
  assert.deepEqual(f.calls, ["valida"]);
});

test("Valida distingue falha e resultado indeterminado dos testes", async () => {
  for (const [resultStatus, expected] of [["FAILED", "FALHOU"],
    ["INDETERMINATE", "BLOQUEADA"]]) {
    const f = fixture();
    f.toolRunner.run_synthetic_tests = () => ({
      source: "SYNTHETIC_LOCAL", status: resultStatus });
    const ask = await f.request("valida", "task_validate", 1);
    const outcome = await f.manager.callback({ botKey: "valida",
      data: `t:${ask.approval.id}:A` });
    assert.equal(outcome.task.status, expected);
  }
});

test("rejeição, expiração, concorrência e recuperação são bloqueantes", async () => {
  const f = fixture();
  const rejected = await f.request("valida", "task_validate", 1);
  assert.equal((await f.manager.callback({ botKey: "valida",
    data: `t:${rejected.approval.id}:R` })).status, "REJECTED");
  const expired = await f.request("valida", "task_validate", 2);
  f.advance(16 * 60_000);
  assert.equal((await f.manager.callback({ botKey: "valida",
    data: `t:${expired.approval.id}:A` })).status, "EXPIRED");
  assert.deepEqual(f.calls, []);
  const state = f.manager.read();
  state.tasks[0].status = "EM_EXECUCAO";
  writeFileSync(join(f.stateDir, "tasks-state.json"), JSON.stringify(state));
  const resumed = createTaskManager({ stateDir: f.stateDir,
    toolRunner: f.toolRunner, now: f.now });
  assert.equal(resumed.recover().blockedAfterRestart, 1);
  assert.equal(resumed.list()[0].status, "BLOQUEADA");
  state.tasks[0].status = "EM_EXECUCAO";
  writeFileSync(join(f.stateDir, "tasks-state.json"), JSON.stringify(state));
  assert.equal((await f.request("sentinela", "task_monitor", 3)).status,
    "TASK_BUSY");
});

test("papéis e dados persistidos excluem operações perigosas e texto pessoal", async () => {
  const f = fixture();
  assert.equal((await f.request("forge", "task_validate", 1)).status,
    "TOOL_DENIED");
  assert.equal((await f.request("guardiao", "task_monitor", 2)).status,
    "TOOL_DENIED");
  assert.equal((await f.request("atlas", "run_shell", 3)).status,
    "TOOL_DENIED");
  await f.request("atlas", "task_monitor", 4,
    "Minha senha é sk-12345678901234567890 e email x@y.com");
  const persisted = readFileSync(join(f.stateDir, "tasks-state.json"), "utf8");
  assert.doesNotMatch(persisted, /sk-12345678901234567890|x@y.com|senha/);
});

test("acompanhamento associa evento novo do estúdio sem duplicar nem alertar", async () => {
  const f = fixture();
  const watch = await f.manager.request({ botKey: "sentinela",
    tool: "task_watch", updateId: 1, message: "Avisa se Capivara falhar",
    studio: "CAPIVARA", hours: 24 });
  assert.equal(watch.task.status, "PENDENTE");
  assert.deepEqual(f.calls, []);
  const event = { monitorId: "00000000-0000-4000-8000-000000000023",
    kind: "NEW", code: "VISUAL_JS_ERROR", studioCode: "CAPIVARA",
    observedAt: "2026-11-13T12:30:00Z" };
  assert.equal(f.manager.recordMonitorEvents([{ ...event,
    studioCode: "STUDIO_27" }]).matched, 0);
  assert.equal(f.manager.recordMonitorEvents([event]).matched, 1);
  assert.equal(f.manager.recordMonitorEvents([event]).matched, 0);
  assert.equal(f.manager.list()[0].evidence.codes[0], "VISUAL_JS_ERROR");
  assert.equal(f.manager.list()[0].evidence.monitorId, event.monitorId);
});

test("o diagnóstico não mistura duas execuções da Sentinela", async () => {
  const f = fixture();
  f.toolRunner.monitor_status = () => ({ source: "MONITOR_HISTORY",
    status: "ATENCAO", monitorId:
      "00000000-0000-4000-8000-000000000023" });
  f.toolRunner.diagnose_anomaly = () => ({ source: "ACTIVE_READ_ONLY",
    status: "DIAGNOSTICADO", monitorId:
      "00000000-0000-4000-8000-000000000024",
    findings: [{ code: "VISUAL_JS_ERROR",
      causeStatus: "NAO_DETERMINADA" }] });
  await f.request("atlas", "task_monitor", 1);
  const diagnosis = await f.request("atlas", "task_investigate", 2);
  assert.equal(diagnosis.task.status, "BLOQUEADA");
  assert.equal(diagnosis.task.events.at(-1).code, "SOURCE_RUN_MISMATCH");
});

test("Forge exige prova e aprovação para proposta de patch isolada", async () => {
  const f = fixture();
  const from = "00000000-0000-4000-8000-000000000021";
  const to = "00000000-0000-4000-8000-000000000022";
  f.toolRunner.diagnose_anomaly = () => ({ source: "ACTIVE_READ_ONLY",
    status: "DIAGNOSTICADO", findings: [{ code: "OFFICIAL_RECORD_OUTDATED",
      causeStatus: "CONFIRMADA" }],
    patchProof: { from, to, sourceVerified: true,
      verifiedAt: "2026-11-13T12:00:00Z" } });
  f.toolRunner.prepare_patch_workspace = ({ taskId, proof }) => {
    f.calls.push(`patch:${taskId}`);
    assert.deepEqual(proof, { from, to, sourceVerified: true,
      verifiedAt: "2026-11-13T12:00:00Z" });
    return { source: "LOCAL_WORKTREE", status: "PROPOSTA_LOCAL",
      applied: false };
  };
  const diagnosis = await f.request("sherlock", "task_investigate", 1);
  const proposal = await f.request("forge", "task_propose", 2,
    `Proposta para ${diagnosis.task.id}`);
  assert.equal(proposal.status, "APPROVAL_REQUIRED");
  assert.equal(proposal.task.status, "AGUARDANDO_APROVACAO");
  assert.deepEqual(f.calls, []);
  const decided = await f.manager.callback({ botKey: "forge",
    data: `t:${proposal.approval.id}:A` });
  assert.equal(decided.task.status, "CONCLUIDA");
  assert.equal(f.calls.length, 1);
  assert.equal(f.manager.read().tasks[1].evidence.applied, false);
});

test("patch proposto fica em worktree nova e não altera o código fonte", () => {
  const dir = mkdtempSync(join(root, "git-"));
  const repo = join(dir, "repo");
  const parentDir = join(dir, "proposals");
  mkdirSync(join(repo, "agents"), { recursive: true });
  const from = "00000000-0000-4000-8000-000000000021";
  const to = "00000000-0000-4000-8000-000000000022";
  const original = JSON.stringify({ observedVersion: to,
    officialRecordedVersion: from }, null, 2) + "\n";
  writeFileSync(join(repo, "agents", "reference.json"), original);
  const git = (args) => {
    const r = spawnSync("git", ["-C", repo, ...args],
      { encoding: "utf8", shell: false });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git(["init"]);
  git(["-c", "user.name=Bellza Synthetic",
    "-c", "user.email=synthetic@example.invalid", "add", "."]);
  git(["-c", "user.name=Bellza Synthetic",
    "-c", "user.email=synthetic@example.invalid", "commit", "-m", "fixture"]);
  const taskId = "00000000-0000-4000-8000-000000000023";
  assert.throws(() => prepareReferencePatchWorkspace({ repositoryRoot: repo,
    parentDir, taskId, proof: { from, to, sourceVerified: false } }),
  /PATCH_PROOF_INVALID/);
  const result = prepareReferencePatchWorkspace({ repositoryRoot: repo,
    parentDir, taskId, proof: { from, to, sourceVerified: true } });
  assert.equal(result.status, "PROPOSTA_LOCAL");
  assert.equal(result.applied, false);
  assert.equal(readFileSync(join(repo, "agents", "reference.json"), "utf8"),
    original);
  const workspace = join(parentDir, taskId);
  assert.equal(readFileSync(join(workspace, "agents", "reference.json"),
    "utf8").replaceAll("\r\n", "\n"), original);
  const proposal = readFileSync(join(workspace, "proposal.patch"), "utf8");
  assert.match(proposal, /\+  "officialRecordedVersion"/);
  const check = spawnSync("git", ["-C", workspace, "apply", "--check",
    "proposal.patch"], { encoding: "utf8", shell: false });
  assert.equal(check.status, 0, check.stderr);
});

test("Forge lê o diagnóstico da tarefa indicada, não o último de outro bot", () => {
  const f = fixture();
  const shared = join(f.stateDir, "shared");
  mkdirSync(shared, { recursive: true });
  const id = "00000000-0000-4000-8000-000000000023";
  const record = (studioCode) => ({ at: f.now().toISOString(),
    source: "ACTIVE_READ_ONLY", diagnosis: { agent: "sherlock",
      runId: "00000000-0000-4000-8000-000000000024",
      findings: [{ studioCode, code: "PUBLIC_PAGE_HTTP_ERROR",
        causeStatus: "NAO_DETERMINADA" }] } });
  writeFileSync(join(shared, `diagnosis-${id}.json`),
    JSON.stringify(record("CAPIVARA")));
  writeFileSync(join(shared, "diagnosis.json"),
    JSON.stringify(record("STUDIO_27")));
  const tools = createAgentTools({ stateDir: f.stateDir,
    monitorStateDir: join(root, "not-used"), now: f.now });
  const proposal = tools.prepare_investigation({ dependencyId: id });
  assert.deepEqual(proposal.scope, ["CAPIVARA:PUBLIC_PAGE_HTTP_ERROR"]);
  assert.equal(proposal.applied, false);
});

test("gateway encaminha linguagem natural e callback privado sem envio real", async () => {
  const f = fixture();
  const config = validateGatewayConfig({ schema: 1, ownerUserId: 12345,
    ownerChatId: 12345, stateDir: join(root, `gateway-${count}`),
    monitorStateDir: join(root, "monitor"), alertsEnabled: false,
    ai: { model: "gpt-6-luna", maxCallsPerDay: 12,
      maxTokensPerDay: 10000, maxDailyUsd: 0.25,
      inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.5 },
    bots: Object.fromEntries(BOT_KEYS.map((key) => [key,
      { username: `bellza_${key}_bot`, secretName: `telegram-${key}`,
        expectedBotId: key === "valida" ? 9065362375 : null,
        enabled: key !== "guardiao" }])) });
  const aiByBot = { valida: { route: async ({ tools }) => {
    assert(tools.includes("task_validate"));
    assert(!tools.includes("run_synthetic_tests"));
    return { choice: { tool: "task_validate", studio: null, hours: 24 } };
  },
    answer: async () => { throw new Error("ANSWER_NOT_NEEDED"); } } };
  let sent = null;
  const clients = { valida: { sendOwnerApproval: async (_, text, buttons) => {
    sent = { text, buttons }; }, answerCallbackQuery: async () => {} } };
  const gateway = createGateway({ config, aiByBot, clients,
    toolRunner: f.toolRunner, taskManager: f.manager, now: f.now });
  const msg = { update_id: 1, message: { text: "Valida, testa localmente",
    from: { id: 12345, is_bot: false },
    chat: { id: 12345, type: "private" } } };
  const result = await gateway.handleUpdate("valida", msg);
  assert.equal(result.status, "APPROVAL_REQUIRED");
  assert.equal(sent, null); // handleUpdate never sends externally.
  const data = `t:${result.approval.id}:A`;
  const bad = { update_id: 2, callback_query: { id: "abc", data,
    from: { id: 777, is_bot: false }, message: {
      from: { id: 9065362375 }, chat: { id: 12345, type: "private" } } } };
  assert.equal((await gateway.handleUpdate("valida", bad)).status, "REJECTED");
  assert.deepEqual(f.calls, []);
  const good = structuredClone(bad);
  good.update_id = 3;
  good.callback_query.from.id = 12345;
  assert.equal((await gateway.handleUpdate("valida", good)).status,
    "APPROVED");
  assert.deepEqual(f.calls, ["valida"]);
});

test("cliente Telegram limita botões e responde callbacks pelo método fixo", async () => {
  const calls = [];
  const client = createTelegramClient({ token: `123456:${"x".repeat(25)}`,
    fetchImpl: async (url, options) => {
      calls.push({ method: url.split("/").at(-1),
        body: JSON.parse(options.body) });
      return new Response(JSON.stringify({ ok: true, result: true }),
        { status: 200 });
    } });
  const id = "00000000-0000-4000-8000-000000000023";
  await client.sendOwnerApproval(12345, "Teste sintético", approvalButtons(id));
  await client.answerCallbackQuery("synthetic_id", "Aprovação registada");
  assert.deepEqual(calls.map((c) => c.method),
    ["sendMessage", "answerCallbackQuery"]);
  assert.equal(calls[0].body.chat_id, 12345);
  assert.equal(calls[0].body.reply_markup.inline_keyboard[0][0]
    .callback_data, `t:${id}:A`);
  await assert.rejects(client.sendOwnerApproval(12345, "x", {
    inline_keyboard: [[{ text: "Deploy", callback_data: "deploy" }]] }),
  /TELEGRAM_SEND_DENIED/);
});
