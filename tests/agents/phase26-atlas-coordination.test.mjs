import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTaskManager } from "../../agents/telegram-gateway/tasks.mjs";
import { createGateway } from "../../agents/telegram-gateway/gateway.mjs";
import { createOpenAiAdapter } from
  "../../agents/telegram-gateway/ai.mjs";
import { createTelegramClient } from
  "../../agents/telegram-gateway/telegram.mjs";
import { BOT_KEYS, TOOLS, validateGatewayConfig } from
  "../../agents/telegram-gateway/config.mjs";

const root = mkdtempSync(join(tmpdir(), "bellza-phase26-"));
process.on("exit", () => rmSync(root, { recursive: true, force: true }));
let sequence = 0;
const monitorId = "00000000-0000-4000-8000-000000000026";
function fixture({ code = "AUTH_UNAVAILABLE", cause = "NAO_DETERMINADA",
  diagnosisStatus = "DIAGNOSTICADO", fail = null } = {}) {
  const stateDir = join(root, `case-${++sequence}`);
  let clock = new Date("2026-11-13T18:00:00Z");
  const calls = [];
  const runner = {
    monitor_status: () => {
      calls.push("sentinela");
      if (fail === "sentinela") throw new Error("EVIDENCE_UNAVAILABLE");
      return { source: "MONITOR_HISTORY", status: "ATENCAO",
        monitorId, observedAt: "2026-11-13T17:30:00Z" };
    },
    diagnose_anomaly: () => {
      calls.push("sherlock");
      if (fail === "sherlock") throw new Error("EVIDENCE_UNAVAILABLE");
      return { source: "MONITOR_HISTORY", status: diagnosisStatus,
        monitorId, observedAt: "2026-11-13T17:30:00Z",
        sourcesConsulted: ["MONITOR_JOURNAL", "CURRENT_SENTINELA_REPORT"],
        sourcesUnavailable: [],
        findings: [{ code, causeStatus: cause }] };
    },
    run_synthetic_tests: () => {
      calls.push("valida");
      return { source: "SYNTHETIC_LOCAL",
        status: fail === "valida" ? "FAILED" : "APPROVED" };
    },
    prepare_investigation: ({ dependencyId }) => {
      calls.push("forge");
      return { source: "SHERLOCK_TASK_DIAGNOSIS",
        status: "PROPOSTA_DE_INVESTIGACAO",
        plan: "Rever apenas a regra indicada pelo diagnóstico.",
        findings: [{ code, causeStatus: cause }],
        dependencyId, applied: false };
    },
  };
  const now = () => clock;
  const manager = createTaskManager({ stateDir, toolRunner: runner, now });
  const ask = (updateId, message = "Atlas, investiga o último problema da Bellza, chama os agentes necessários e apresenta uma solução.") =>
    manager.request({ botKey: "atlas", tool: "task_coordinate",
      message, updateId });
  return { stateDir, runner, calls, manager, now, ask,
    advance: (ms) => { clock = new Date(clock.getTime() + ms); } };
}
const children = (manager, parent) => parent.childIds.map((id) =>
  manager.read().tasks.find((item) => item.id === id));

test("Sherlock e Forge respondem naturalmente e isolam os próprios detalhes", async () => {
  const f = fixture();
  const investigation = await f.manager.request({ botKey: "sherlock",
    tool: "task_investigate", updateId: 1,
    message: "Investiga a última falha Cloudflare" });
  const proposal = await f.manager.request({ botKey: "forge",
    tool: "task_propose", updateId: 2,
    message: `Analisa ${investigation.task.id}` });
  assert.match(investigation.reply, /causa ainda não foi comprovada/i);
  assert.match(proposal.reply, /correção|plano de investigação/i);
  for (const result of [investigation, proposal]) {
    assert(result.reply.length <= 320);
    assert.doesNotMatch(result.reply, /AUTH_UNAVAILABLE|PATCH_PROOF_REQUIRED|[\x2a\x60#]/);
    assert.equal(result.buttons.inline_keyboard[0][0].text, "Ver detalhes");
    const details = await f.manager.callback({ botKey: result.task.agent,
      data: `v:${result.task.id}` });
    assert.equal(details.status, "DETAILS");
    assert.match(details.detailMessage, new RegExp(result.task.id));
  }
  assert.equal((await f.manager.callback({ botKey: "forge",
    data: `v:${investigation.task.id}` })).status, "REJECTED");
});

test("um pedido cria Atlas, Sentinela e Sherlock sem chamar agentes desnecessários", async () => {
  const f = fixture();
  const result = await f.ask(1);
  assert.equal(result.task.agent, "atlas");
  assert.equal(result.task.status, "CONCLUIDA");
  assert.deepEqual(f.calls, ["sentinela", "sherlock"]);
  const steps = children(f.manager, result.task);
  assert.deepEqual(steps.map((item) => item.agent), ["sentinela", "sherlock"]);
  assert.equal(steps[1].dependencyId, steps[0].id);
  assert.match(result.reply, /A leitura Cloudflare ficou indisponível/);
  assert.match(result.reply, /Causa ainda não comprovada/);
  assert.match(result.reply, /Nenhuma alteração foi aplicada/);
  assert.doesNotMatch(result.reply, /AUTH_UNAVAILABLE|[\x2a\x60#]/);
  assert(result.reply.length <= 320);
  assert.equal(result.buttons.inline_keyboard[0][0].text, "Ver detalhes");
  const details = await f.manager.callback({ botKey: "atlas",
    data: `v:${result.task.id}` });
  assert.equal(details.status, "DETAILS");
  assert.match(details.detailMessage, /AUTH_UNAVAILABLE/);
  assert.match(details.detailMessage, /Fontes consultadas: MONITOR_JOURNAL/);
  assert.match(details.detailMessage, new RegExp(steps[1].id));
  assert.equal((await f.manager.callback({ botKey: "forge",
    data: `v:${result.task.id}` })).status, "REJECTED");
  assert.equal((await f.ask(1)).status, "DUPLICATE");
  assert.deepEqual(f.calls, ["sentinela", "sherlock"]);
});

test("pedido relevante espera aprovação; após aprovação executa Valida e Forge só com causa comprovada", async () => {
  const f = fixture({ code: "VISUAL_JS_ERROR", cause: "CONFIRMADA" });
  const request = await f.ask(1);
  assert.equal(request.status, "APPROVAL_REQUIRED");
  assert.equal(request.task.status, "AGUARDANDO_APROVACAO");
  assert.deepEqual(f.calls, ["sentinela", "sherlock"]);
  assert.equal(request.buttons.inline_keyboard[0].length, 3);
  assert(request.reply.length <= 320);
  const pending = children(f.manager, request.task);
  assert.deepEqual(pending.map((item) => item.agent),
    ["sentinela", "sherlock", "valida"]);
  assert.equal(pending[2].dependencyId, pending[1].id);
  const details = await f.manager.callback({ botKey: "atlas",
    data: `t:${request.approval.id}:D` });
  assert.match(details.detailMessage, /VISUAL_JS_ERROR/);
  assert.deepEqual(f.calls, ["sentinela", "sherlock"]);
  const decided = await f.manager.callback({ botKey: "atlas",
    data: `t:${request.approval.id}:A` });
  assert.equal(decided.status, "APPROVED");
  assert.deepEqual(f.calls, ["sentinela", "sherlock", "valida", "forge"]);
  const done = f.manager.read().tasks.find((item) =>
    item.id === request.task.id);
  assert.equal(done.status, "CONCLUIDA");
  const all = children(f.manager, done);
  assert.equal(all[3].dependencyId, all[1].id);
  assert.equal(all[3].status, "BLOQUEADA");
  assert.equal(all[3].evidence.reason, "PATCH_PROOF_REQUIRED");
  assert.equal(all[3].evidence.applied, false);
  assert.match(decided.followupMessage, /plano; patch bloqueado/);
  assert.equal((await f.manager.callback({ botKey: "atlas",
    data: `t:${request.approval.id}:A` })).status, "REPLAY");
});

test("causa indeterminada permite testes locais aprovados, mas não chama Forge", async () => {
  const f = fixture({ code: "VISUAL_JS_ERROR" });
  const request = await f.ask(1);
  await f.manager.callback({ botKey: "atlas",
    data: `t:${request.approval.id}:A` });
  assert.deepEqual(f.calls, ["sentinela", "sherlock", "valida"]);
  assert.equal(f.manager.read().tasks.find((item) =>
    item.id === request.task.id).status, "CONCLUIDA");
});

test("falha de Sherlock ou de Valida não dispara Forge", async () => {
  const sherlock = fixture({ fail: "sherlock" });
  const first = await sherlock.ask(1);
  assert.equal(first.task.status, "BLOQUEADA");
  assert.deepEqual(sherlock.calls, ["sentinela", "sherlock"]);
  const valida = fixture({ code: "VISUAL_JS_ERROR",
    cause: "CONFIRMADA", fail: "valida" });
  const pending = await valida.ask(1);
  await valida.manager.callback({ botKey: "atlas",
    data: `t:${pending.approval.id}:A` });
  assert.deepEqual(valida.calls, ["sentinela", "sherlock", "valida"]);
  assert.equal(valida.manager.read().tasks.find((item) =>
    item.id === pending.task.id).status, "BLOQUEADA");
  const sentinela = fixture({ fail: "sentinela" });
  const partial = await sentinela.ask(1);
  assert.match(partial.reply, /leitura da Sentinela falhou/);
  assert(partial.reply.length <= 320);
});

test("rejeição, expiração e reinício não executam testes sem aprovação válida", async () => {
  const rejected = fixture({ code: "VISUAL_JS_ERROR" });
  const ask = await rejected.ask(1);
  const no = await rejected.manager.callback({ botKey: "atlas",
    data: `t:${ask.approval.id}:R` });
  assert.equal(no.status, "REJECTED");
  assert.equal(rejected.manager.read().tasks.find((item) =>
    item.id === ask.task.id).status, "BLOQUEADA");
  assert.deepEqual(rejected.calls, ["sentinela", "sherlock"]);
  const expired = fixture({ code: "VISUAL_JS_ERROR" });
  const waiting = await expired.ask(1);
  expired.advance(16 * 60_000);
  const reopened = createTaskManager({ stateDir: expired.stateDir,
    toolRunner: expired.runner, now: expired.now });
  reopened.recover();
  assert.equal(reopened.read().tasks.find((item) =>
    item.id === waiting.task.id).status, "BLOQUEADA");
  assert.notEqual((await reopened.callback({ botKey: "atlas",
    data: `t:${waiting.approval.id}:A` })).status, "APPROVED");
  assert.deepEqual(expired.calls, ["sentinela", "sherlock"]);
  const interrupted = fixture({ code: "VISUAL_JS_ERROR" });
  const mid = await interrupted.ask(1);
  const state = interrupted.manager.read();
  state.approvals[0].status = "APROVADA";
  writeFileSync(join(interrupted.stateDir, "tasks-state.json"),
    JSON.stringify(state));
  const restarted = createTaskManager({ stateDir: interrupted.stateDir,
    toolRunner: interrupted.runner, now: interrupted.now });
  restarted.recover();
  assert.equal(restarted.read().tasks.find((item) =>
    item.id === mid.task.id).status, "BLOQUEADA");
  assert.deepEqual(interrupted.calls, ["sentinela", "sherlock"]);
});

test("resultado recente da mesma execução é reutilizado sem repetir Sherlock", async () => {
  const f = fixture();
  const first = await f.ask(1);
  const second = await f.ask(2);
  assert.equal(second.task.status, "CONCLUIDA");
  assert.deepEqual(f.calls, ["sentinela", "sherlock", "sentinela"]);
  const previousSherlock = children(f.manager, first.task)[1];
  const reused = children(f.manager, second.task)[1];
  assert.equal(reused.reusedFromTaskId, previousSherlock.id);
  assert(reused.events.some((event) =>
    event.code === "RECENT_EVIDENCE_REUSED"));
});

test("concorrência serializa outra tarefa enquanto Atlas coordena", async () => {
  const f = fixture();
  let release;
  f.runner.monitor_status = () => new Promise((resolve) => {
    release = () => resolve({ source: "MONITOR_HISTORY", status: "ATENCAO",
      monitorId, observedAt: "2026-11-13T17:30:00Z" });
  });
  const running = f.ask(1);
  await new Promise((resolve) => setImmediate(resolve));
  let settled = false;
  const concurrent = f.manager.request({ botKey: "sherlock",
    tool: "task_investigate", message: "investiga", updateId: 2 })
    .then((result) => { settled = true; return result; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  release();
  await running;
  assert.equal((await concurrent).task.status, "CONCLUIDA");
  assert.deepEqual(f.calls, ["sherlock", "sherlock"]);
});

test("eventos do monitor aguardam a coordenação e preservam o histórico", async () => {
  const f = fixture();
  const watch = await f.manager.request({ botKey: "sentinela",
    tool: "task_watch", updateId: 1, message: "Acompanha este incidente" });
  let release;
  f.runner.monitor_status = () => new Promise((resolve) => {
    release = () => resolve({ source: "MONITOR_HISTORY", status: "ATENCAO",
      monitorId, observedAt: "2026-11-13T17:30:00Z" });
  });
  const running = f.ask(2);
  await new Promise((resolve) => setImmediate(resolve));
  let settled = false;
  const event = f.manager.recordMonitorEvents([{ monitorId, kind: "NEW",
    code: "VISUAL_JS_ERROR", studioCode: "GLOBAL",
    observedAt: "2026-11-13T18:05:00Z" }]).then((value) => {
    settled = true;
    return value;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  release();
  await running;
  assert.equal((await event).matched, 1);
  assert.equal(f.manager.read().tasks.find((item) =>
    item.id === watch.task.id).status, "CONCLUIDA");
});

test("gateway interpreta pedido natural, protege chat e devolve detalhes sem Telegram real", async () => {
  const f = fixture();
  const gatewayStateDir = join(root, `gateway-${++sequence}`);
  const config = validateGatewayConfig({ schema: 1, ownerUserId: 12345,
    ownerChatId: 12345, stateDir: gatewayStateDir,
    monitorStateDir: join(root, "monitor"), alertsEnabled: true,
    ai: { model: "synthetic", maxCallsPerDay: 12,
      maxTokensPerDay: 10000, maxDailyUsd: 0.25,
      inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.5 },
    bots: Object.fromEntries(BOT_KEYS.map((key) => [key,
      { username: `bellza_${key}_bot`, secretName: `telegram-${key}`,
        enabled: key !== "guardiao" }])) });
  const aiByBot = { atlas: { route: async ({ tools, message }) => {
    assert(tools.includes("task_coordinate"));
    assert.match(message, /chama os agentes necessários/);
    return { choice: { tool: "task_coordinate", studio: null, hours: 24 } };
  }, answer: async () => { throw new Error("ANSWER_NOT_NEEDED"); } } };
  const sent = [];
  const clients = { atlas: {
    getUpdates: async () => [],
    sendOwnerDetails: async (_chat, reply, buttons) =>
      sent.push({ reply, buttons }),
    sendOwnerMessage: async (_chat, reply) => sent.push({ reply }),
    answerCallbackQuery: async () => {},
  } };
  const gateway = createGateway({ config, aiByBot, clients,
    toolRunner: f.runner, taskManager: f.manager, now: f.now });
  const text = "Atlas, investiga o último problema da Bellza, chama os agentes necessários e apresenta uma solução.";
  const update = { update_id: 1, message: { text,
    from: { id: 12345, is_bot: false },
    chat: { id: 12345, type: "private" } } };
  const result = await gateway.handleUpdate("atlas", update);
  assert.equal(result.task.tool, "task_coordinate");
  assert.deepEqual(sent, []); // handleUpdate não envia mensagens.
  const bad = { update_id: 2, callback_query: {
    id: "callback1", data: `v:${result.task.id}`,
    from: { id: 777, is_bot: false },
    message: { from: { username: "bellza_atlas_bot" },
      chat: { id: 12345, type: "private" } } } };
  assert.equal((await gateway.handleUpdate("atlas", bad)).status, "REJECTED");
  const good = structuredClone(bad);
  good.update_id = 3;
  good.callback_query.from.id = 12345;
  const shown = await gateway.handleUpdate("atlas", good);
  assert.equal(shown.status, "DETAILS");
  assert.match(shown.detailMessage, /AUTH_UNAVAILABLE/);
  assert.equal(sent.length, 0);
  assert.doesNotMatch(readFileSync(join(f.stateDir, "tasks-state.json"), "utf8"),
    /chama os agentes necessários|senha|token/);
});

test("polling sintético envia resumo e detalhes por botões validados", async () => {
  const f = fixture();
  const gatewayStateDir = join(root, `poll-${++sequence}`);
  const config = validateGatewayConfig({ schema: 1, ownerUserId: 12345,
    ownerChatId: 12345, stateDir: gatewayStateDir,
    monitorStateDir: join(root, "monitor"), alertsEnabled: false,
    ai: { model: "synthetic", maxCallsPerDay: 12,
      maxTokensPerDay: 10000, maxDailyUsd: 0.25,
      inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.5 },
    bots: Object.fromEntries(BOT_KEYS.map((key) => [key,
      { username: `bellza_${key}_bot`, secretName: `telegram-${key}`,
        enabled: key !== "guardiao" }])) });
  const sent = [];
  let parentId;
  let round = 0;
  const client = {
    getUpdates: async () => ++round === 1 ? [{ update_id: 1,
      message: { text: "Atlas, investiga o último problema da Bellza, chama os agentes necessários e apresenta uma solução.",
        from: { id: 12345, is_bot: false },
        chat: { id: 12345, type: "private" } } }] : [{
      update_id: 2, callback_query: { id: "detail2",
        data: `v:${parentId}`, from: { id: 12345, is_bot: false },
        message: { from: { username: "bellza_atlas_bot" },
          chat: { id: 12345, type: "private" } } } }],
    sendOwnerDetails: async (_chat, reply, buttons) => {
      sent.push({ kind: "summary", reply, buttons });
      parentId = buttons.inline_keyboard[0][0].callback_data.slice(2);
    },
    sendOwnerMessage: async (_chat, reply) =>
      sent.push({ kind: "details", reply }),
    answerCallbackQuery: async () => {},
  };
  const gateway = createGateway({ config,
    aiByBot: { atlas: { route: async () => ({ choice: {
      tool: "task_coordinate", studio: null, hours: 24 } }),
    answer: async () => { throw new Error("UNEXPECTED_ANSWER"); } } },
    clients: { atlas: client }, toolRunner: f.runner,
    taskManager: f.manager, now: f.now });
  await gateway.pollOnce("atlas");
  assert.equal(sent[0].kind, "summary");
  assert.match(sent[0].reply, /Causa ainda não comprovada/);
  await gateway.pollOnce("atlas");
  assert.equal(sent[1].kind, "details");
  assert.match(sent[1].reply, /AUTH_UNAVAILABLE/);
  assert.match(sent[1].reply, new RegExp(parentId));
  const calls = [];
  const telegram = createTelegramClient({ token: "123456:abcdefghijklmnopqrstuvwxyz",
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({ ok: true, result: {} }),
        { status: 200, headers: { "Content-Type": "application/json" } });
    } });
  await telegram.sendOwnerDetails(12345, "Resumo",
    sent[0].buttons);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /sendMessage$/);
  await assert.rejects(telegram.sendOwnerDetails(12345, "Resumo",
    { inline_keyboard: [[{ text: "Aprovar", callback_data: "run_shell" }]] }),
  /TELEGRAM_SEND_DENIED/);
});

test("Ver detalhes divide evidências extensas sem perder IDs ou fontes", async () => {
  const code = "VISUAL_" + "X".repeat(42);
  const f = fixture({ code, cause: "CONFIRMADA" });
  f.runner.diagnose_anomaly = () => ({
    source: "MONITOR_HISTORY", status: "DIAGNOSTICADO",
    monitorId, observedAt: "2026-11-13T17:30:00Z",
    sourcesConsulted: Array.from({ length: 6 }, (_, index) =>
      "SOURCE_" + String.fromCharCode(65 + index).repeat(40)),
    sourcesUnavailable: Array.from({ length: 6 }, (_, index) =>
      "MISSING_" + String.fromCharCode(65 + index).repeat(39)),
    findings: [{ code, causeStatus: "CONFIRMADA" }],
  });
  const waiting = await f.ask(1);
  await f.manager.callback({ botKey: "atlas",
    data: `t:${waiting.approval.id}:A` });
  const details = await f.manager.callback({ botKey: "atlas",
    data: `v:${waiting.task.id}` });
  const chunks = [details.detailMessage, ...details.detailMessages];
  assert(chunks.length > 1);
  assert(chunks.every((part) => part.length <= 1200));
  const all = chunks.join("\n");
  for (const child of children(f.manager, waiting.task))
    assert(all.includes(child.id));
  assert(all.includes(code));
  assert(all.includes("Fontes indisponíveis"));
});

test("adaptador de IA oferece coordenação sem autorizar comandos livres", async () => {
  let sent;
  const ai = createOpenAiAdapter({ apiKey: "synthetic-key",
    model: "gpt-6-luna", fetchImpl: async (_url, options) => {
      sent = JSON.parse(options.body);
      return new Response(JSON.stringify({ status: "completed",
        output: [{ type: "message", content: [{ type: "output_text",
          text: '{"tool":"task_coordinate","studio":null,"hours":24}' }] }],
        usage: { input_tokens: 10, output_tokens: 10 } }), { status: 200 });
    } });
  const result = await ai.route({ identity: "atlas",
    tools: TOOLS.atlas, message: "Investiga e apresenta uma solução",
    history: [] });
  assert.equal(result.choice.tool, "task_coordinate");
  assert.equal(sent.store, false);
  assert(sent.input.includes("task_coordinate"));
  assert(!sent.input.includes("run_shell"));
});
