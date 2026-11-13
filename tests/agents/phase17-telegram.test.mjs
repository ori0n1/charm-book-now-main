import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BOT_KEYS, TOOLS, validateGatewayConfig } from "../../agents/telegram-gateway/config.mjs";
import { createGateway, prepareAlertBatch } from "../../agents/telegram-gateway/gateway.mjs";
import { createOpenAiAdapter } from "../../agents/telegram-gateway/ai.mjs";
import { createTelegramClient } from "../../agents/telegram-gateway/telegram.mjs";
import { acquireSingleton, readSingleton } from "../../agents/telegram-gateway/singleton.mjs";
import { createAgentTools } from "../../agents/telegram-gateway/tools.mjs";

const root = mkdtempSync(join(tmpdir(), "bellza-telegram-phase17-"));
process.on("exit", () => rmSync(root, { recursive: true, force: true }));
let counter = 0;
function fixture() {
  const stateDir = join(root, `state-${++counter}`);
  const config = validateGatewayConfig({ schema: 1, ownerUserId: 12345,
    ownerChatId: 12345, stateDir, monitorStateDir: join(root, "monitor"),
    alertsEnabled: false,
    ai: { model: "gpt-6-luna", maxCallsPerDay: 12,
      maxTokensPerDay: 10000, maxDailyUsd: 0.25,
      inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.5 },
    bots: Object.fromEntries(BOT_KEYS.map((key) => [key,
      { username: `bellza_${key}_bot`, secretName: `telegram-${key}`,
        enabled: true }])) });
  const aiByBot = Object.fromEntries(BOT_KEYS.map((key) => [key, {
    route: async () => ({ choice: { tool: TOOLS[key][0],
      studio: null, hours: 24 } }),
    answer: async ({ evidence }) => ({ text: `${key}: ${evidence.status}` }),
  }]));
  const calls = [];
  const toolRunner = Object.fromEntries(new Set(Object.values(TOOLS).flat())
    .values().map((key) => [key, async (args) => {
      calls.push({ key, args }); return { status: "SIMULADO",
        source: "SYNTHETIC_LOCAL" }; }]));
  const clients = Object.fromEntries(BOT_KEYS.map((key) => [key, {
    getUpdates: async () => [], sendOwnerMessage: async () => {},
  }]));
  const gateway = createGateway({ config, aiByBot, toolRunner, clients,
    now: () => new Date("2026-11-13T12:00:00Z") });
  return { gateway, config, aiByBot, toolRunner, clients, calls };
}
function update(id, text = "Como está a Bellza?", extras = {}) {
  return { update_id: id, message: { text,
    from: { id: 12345, is_bot: false },
    chat: { id: 12345, type: "private" }, ...extras } };
}

test("seis identidades encaminham somente suas ferramentas e separam histórico", async () => {
  const f = fixture();
  for (let i = 0; i < BOT_KEYS.length; i++) {
    const key = BOT_KEYS[i];
    const result = await f.gateway.handleUpdate(key, update(i + 1,
      `${key}, verifica o teu estado.`));
    assert.equal(result.status, "HANDLED");
    assert.equal(result.tool, TOOLS[key][0]);
    assert.match(result.reply, new RegExp(key));
  }
  assert.equal(f.calls.length, 6);
  assert.deepEqual(BOT_KEYS.map((key) => f.gateway.readState().bots[key].length),
    [1, 1, 1, 1, 1, 1]);
  assert.equal(f.gateway.readState().bots.atlas[0].source, "SYNTHETIC_LOCAL");
});

test("grupos, outro utilizador e dados sensíveis são rejeitados sem IA", async () => {
  const f = fixture();
  assert.equal((await f.gateway.handleUpdate("atlas", update(1, "oi",
    { chat: { id: -55, type: "supergroup" } }))).status, "REJECTED");
  assert.equal((await f.gateway.handleUpdate("atlas", update(2, "oi",
    { from: { id: 777, is_bot: false } }))).status, "REJECTED");
  assert.equal((await f.gateway.handleUpdate("atlas", update(3,
    "Contactar teste@example.com"))).status, "INPUT_DENIED");
  assert.equal(f.calls.length, 0);
  assert.equal(f.gateway.readState().quota.calls, 0);
});

test("modelo não consegue selecionar shell, SQL, outra ferramenta ou argumentos hostis", async () => {
  const f = fixture();
  f.aiByBot.forge.route = async () => ({ choice: { tool: "run_shell" } });
  assert.equal((await f.gateway.handleUpdate("forge", update(1,
    "Executa um comando"))).status, "TOOL_DENIED");
  f.aiByBot.forge.route = async () => ({ choice: { tool: "monitor_status" } });
  assert.equal((await f.gateway.handleUpdate("forge", update(2))).status,
    "TOOL_DENIED");
  f.aiByBot.forge.route = async () => ({ choice: { tool: "prepare_investigation",
    studio: "Capivara; DROP TABLE", hours: 24 } });
  assert.equal((await f.gateway.handleUpdate("forge", update(3))).status,
    "TOOL_DENIED");
  assert.equal(f.calls.length, 0);
});

test("falha de IA e resposta insegura não vazam secrets nem simulam publicação", async () => {
  const f = fixture();
  f.aiByBot.atlas.route = async () => { throw new Error("sk-SECRET_IN_ERROR"); };
  const failed = await f.gateway.handleUpdate("atlas", update(1));
  assert.equal(failed.status, "AI_UNAVAILABLE");
  assert.doesNotMatch(failed.reply, /SECRET/);
  assert.equal(f.gateway.readState().bots.atlas.at(-1).status, "AI_UNAVAILABLE");
  f.aiByBot.atlas.route = async () => ({ choice: { tool: "monitor_status",
    studio: null, hours: 24 } });
  f.aiByBot.atlas.answer = async () => ({ text: "Deploy concluído." });
  const unsafe = await f.gateway.handleUpdate("atlas", update(2));
  assert.equal(unsafe.status, "HANDLED");
  assert.doesNotMatch(unsafe.reply, /Deploy concluído/);
});

test("limites diários, por minuto e deduplicação de atualização", async () => {
  const f = fixture();
  const first = await f.gateway.handleUpdate("atlas", update(1));
  assert.equal(first.status, "HANDLED");
  assert.equal((await f.gateway.handleUpdate("atlas", update(1))).status,
    "DUPLICATE");
  for (let n = 2; n <= 6; n++) await f.gateway.handleUpdate("atlas", update(n));
  assert.equal((await f.gateway.handleUpdate("atlas", update(7))).status,
    "RATE_LIMIT");
  assert.equal(f.calls.length, 6);
});

test("orçamento de IA interrompe novas consultas sem ferramenta adicional", async () => {
  const f = fixture();
  f.config.ai.maxCallsPerDay = 1;
  const first = await f.gateway.handleUpdate("atlas", update(1));
  assert.equal(first.status, "HANDLED");
  assert.match(first.reply, /IA indisponível/);
  const second = await f.gateway.handleUpdate("atlas", update(2));
  assert.equal(second.status, "AI_BUDGET_EXCEEDED");
  assert.match(second.reply, /limite local/);
  assert.equal(f.calls.length, 1);
});

test("polling responde só ao proprietário e não repete atualização antiga", async () => {
  const f = fixture();
  const sent = [];
  f.clients.atlas.getUpdates = async () => [update(1), update(2, "oi",
    { from: { id: 999, is_bot: false } })];
  f.clients.atlas.sendOwnerMessage = async (chatId, text) =>
    sent.push({ chatId, text });
  assert.equal(await f.gateway.pollOnce("atlas"), 2);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chatId, 12345);
  assert.equal(await f.gateway.pollOnce("atlas"), 2);
  assert.equal(sent.length, 1);
});

test("alertas exigem ativação e IDs persistidos evitam repetição", () => {
  const f = fixture();
  const event = { monitorId: "00000000-0000-4000-8000-000000000001",
    kind: "NEW", code: "PUBLIC_HTTP_ERROR", severity: "warning" };
  assert.deepEqual(prepareAlertBatch([event], [], { enabled: false,
    ownerChatId: 12345 }), []);
  const batch = prepareAlertBatch([event], [], { enabled: true,
    ownerChatId: 12345 });
  assert.equal(batch.length, 1);
  const studios = prepareAlertBatch([
    { ...event, studioCode: "CAPIVARA" },
    { ...event, studioCode: "CAPIVARA" },
    { ...event, studioCode: "STUDIO_27" },
    { ...event, kind: "PERSISTENT", studioCode: "CAPIVARA" },
  ], [], { enabled: true, ownerChatId: 12345 });
  assert.equal(studios.length, 3);
  assert.notEqual(studios[0].id, studios[1].id);
  f.gateway.markAlertSent(batch[0].id);
  assert.deepEqual(prepareAlertBatch([event], f.gateway.readState().alertIds,
    { enabled: true, ownerChatId: 12345 }), []);
});

test("adaptador OpenAI usa esquema estrito, store false e endpoint fixo", async () => {
  let request;
  const ai = createOpenAiAdapter({ apiKey: "synthetic-key", model: "gpt-6-luna",
    fetchImpl: async (url, options) => { request = { url, options };
      return new Response(JSON.stringify({ status: "completed", output: [
        { type: "message", content: [{ type: "output_text",
          text: '{"tool":"monitor_status","studio":null,"hours":24}' }] }],
        usage: { input_tokens: 10, output_tokens: 10 } }),
      { status: 200 }); } });
  const result = await ai.route({ identity: "atlas", tools: TOOLS.atlas,
    message: "estado", history: [] });
  assert.equal(result.choice.tool, "monitor_status");
  assert.equal(request.url, "https://api.openai.com/v1/responses");
  const body = JSON.parse(request.options.body);
  assert.equal(body.store, false);
  assert.equal(body.text.format.strict, true);
  assert.equal(body.max_output_tokens, 220);
});

test("seleção da IA aceita primeiro JSON completo e rejeita parâmetros extras", async () => {
  let output = '{"tool":"monitor_status","studio":null,"hours":24}' +
    "\nExplicação adicional ignorada.";
  const ai = createOpenAiAdapter({ apiKey: "synthetic-key", model: "gpt-6-luna",
    fetchImpl: async () => new Response(JSON.stringify({ status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: output }] }],
      usage: { input_tokens: 10, output_tokens: 20 } }), { status: 200 }) });
  const args = { identity: "atlas", tools: TOOLS.atlas,
    message: "estado", history: [] };
  assert.equal((await ai.route(args)).choice.tool, "monitor_status");
  output = '{"tool":"monitor_status","studio":null,"hours":24,"shell":"echo hi"}';
  await assert.rejects(ai.route(args), /AI_TOOL_DENIED/);
  output = '{"tool":"run_shell","studio":null,"hours":24}';
  await assert.rejects(ai.route(args), /AI_TOOL_DENIED/);
  output = '{"tool":"monitor_status","studio":null,"hours":24';
  await assert.rejects(ai.route(args), /AI_ROUTE_JSON_INVALID/);
});

test("cliente Telegram só usa métodos fixos e relata falhas de rede", async () => {
  const requests = [];
  const client = createTelegramClient({ token: `123456:${"x".repeat(25)}`,
    fetchImpl: async (url, options) => { requests.push({ url, options });
      return new Response(JSON.stringify({ ok: true, result: [] }),
        { status: 200 }); } });
  await client.getUpdates(0);
  assert.match(requests[0].url, /\/getUpdates$/);
  assert.deepEqual(JSON.parse(requests[0].options.body).allowed_updates,
    ["message", "callback_query"]);
  const offline = createTelegramClient({ token: `123456:${"x".repeat(25)}`,
    fetchImpl: async () => { throw new Error("offline secret"); } });
  await assert.rejects(offline.getUpdates(0), /TELEGRAM_NETWORK_UNAVAILABLE/);
  const unauthorized = createTelegramClient({ token: `123456:${"x".repeat(25)}`,
    fetchImpl: async () => new Response(JSON.stringify({ ok: false }),
      { status: 401 }) });
  await assert.rejects(unauthorized.getUpdates(0), /TELEGRAM_AUTH_UNAVAILABLE/);
});

test("erro da API de IA é genérico e não expõe resposta remota", async () => {
  const ai = createOpenAiAdapter({ apiKey: "synthetic-key", model: "gpt-6-luna",
    fetchImpl: async () => new Response("sensitive remote error", { status: 401 }) });
  await assert.rejects(ai.route({ identity: "atlas", tools: TOOLS.atlas,
    message: "estado", history: [] }), /AI_HTTP_401_UNKNOWN_NONE/);
});

test("lock de processo impede duas instâncias e só o dono remove", () => {
  const dir = join(root, `lock-${++counter}`);
  const release = acquireSingleton(dir, 12345);
  assert.equal(readSingleton(dir).pid, 12345);
  assert.throws(() => acquireSingleton(dir, 67890), /GATEWAY_ALREADY_LOCKED/);
  assert.equal(release(), true);
  const release2 = acquireSingleton(dir, 67890);
  assert.equal(release2(), true);
});

test("Sherlock, Forge, Valida e Guardião reutilizam relatórios sintéticos existentes", () => {
  const base = join(root, `agents-${++counter}`);
  const monitorStateDir = join(base, "monitor");
  const stateDir = join(base, "gateway");
  mkdirSync(join(monitorStateDir, "runs"), { recursive: true });
  mkdirSync(join(monitorStateDir, "public-integrated"), { recursive: true });
  const id = "00000000-0000-4000-8000-000000000010";
  const at = "2026-11-13T12:00:00Z";
  writeFileSync(join(monitorStateDir, "monitor-state.json"), JSON.stringify({
    journal: [{ monitorId: id, sentinelaRunId: id, publicRunId: id, at,
      overallStatus: "ATENCAO" }], alerts: [] }));
  writeFileSync(join(monitorStateDir, "runs", `${id}.json`), JSON.stringify({
    agent: "sentinela", runId: id, status: "ATENCAO", anomalies: [],
    checks: [], observed: {} }));
  writeFileSync(join(monitorStateDir, "public-integrated", "public-state.json"),
    JSON.stringify({ issues: [{ studioCode: "CAPIVARA",
      path: "/studios/capivara", code: "PUBLIC_JS_FAILURE",
      severity: "warning", evidence: { httpStatus: 200 } }],
      alerts: [], history: [{ flowId: id }] }));
  const tools = createAgentTools({ monitorStateDir, stateDir,
    now: () => new Date(at) });
  const diagnosis = tools.diagnose_anomaly({ studio: "Capivara" });
  assert.equal(diagnosis.status, "DIAGNOSTICADO");
  assert.equal(diagnosis.findings[0].causeStatus, "NAO_DETERMINADA");
  const proposal = tools.prepare_investigation();
  assert.equal(proposal.status, "BLOQUEADO");
  assert.equal(proposal.reason, "CAUSE_NOT_PROVEN");
  assert.equal(proposal.applied, false);
  assert.equal(tools.review_proposal().status, "INDETERMINADO");
  const atlasLock = join(monitorStateDir, "atlas.lock");
  writeFileSync(atlasLock, JSON.stringify({ agent: "sentinela" }));
  assert.throws(() => tools.run_synthetic_tests(), /MONITOR_CONFLICTING_RUN/);
  rmSync(atlasLock);
  const validation = tools.run_synthetic_tests();
  assert.equal(validation.source, "SYNTHETIC_LOCAL");
  assert.equal(validation.tests.length, 7);
  assert.equal(validation.status, "APPROVED");
  assert.equal(tools.review_proposal().publicationAuthorized, false);
});
