import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentTools } from "../../agents/telegram-gateway/tools.mjs";
import { createGateway } from "../../agents/telegram-gateway/gateway.mjs";
import { BOT_KEYS, botIdentityMatches,
  validateGatewayConfig } from "../../agents/telegram-gateway/config.mjs";
import { createOpenAiAdapter, checkOpenAiModel } from "../../agents/telegram-gateway/ai.mjs";
import { createTelegramClient } from "../../agents/telegram-gateway/telegram.mjs";

const root = mkdtempSync(join(tmpdir(), "bellza-telegram-phase18-"));
process.on("exit", () => rmSync(root, { recursive: true, force: true }));
const at = "2026-11-13T12:00:00Z";
const monitorId = "00000000-0000-4000-8000-000000000021";
const publicId = "00000000-0000-4000-8000-000000000022";
const visualId = "00000000-0000-4000-8000-000000000023";

function syntheticReports() {
  const monitorStateDir = join(root, "monitor");
  mkdirSync(join(monitorStateDir, "runs"), { recursive: true });
  mkdirSync(join(monitorStateDir, "public-integrated", "public-runs"),
    { recursive: true });
  mkdirSync(join(monitorStateDir, "visual-prepared", "visual-runs"),
    { recursive: true });
  const put = (path, value) => writeFileSync(path, JSON.stringify(value));
  put(join(monitorStateDir, "monitor-state.json"), { journal: [{
    monitorId, sentinelaRunId: monitorId, publicRunId: publicId,
    visualRunId: visualId, at, overallStatus: "ATENCAO" }], alerts: [] });
  put(join(monitorStateDir, "runs", `${monitorId}.json`), {
    agent: "sentinela", status: "ATENCAO", anomalies: [], observed: {} });
  put(join(monitorStateDir, "public-integrated", "public-state.json"), {
    history: [{ flowId: publicId }], issues: [], alerts: [] });
  put(join(monitorStateDir, "public-integrated", "public-runs",
    `${publicId}.json`), { flowId: publicId, observedAt: at,
    status: "PARCIAL", checkedPages: 3, expectedPages: 3,
    coverageComplete: true, agendaInteractivity: "NAO_VERIFICAVEL",
    pages: [
      { studioCode: "GLOBAL", path: "/", status: "PAGE_AND_ASSETS_OK",
        complete: true, httpStatus: 200 },
      { studioCode: "CAPIVARA", path: "/s/capivarabarbearia",
        status: "PAGE_AND_ASSETS_OK", complete: true, httpStatus: 200 },
      { studioCode: "STUDIO_27", path: "/s/studio27",
        status: "RESOURCE_FAILURE", complete: false, httpStatus: 200 },
    ] });
  put(join(monitorStateDir, "visual-prepared", "visual-state.json"), {
    history: [{ flowId: visualId }], issues: [], alerts: [] });
  put(join(monitorStateDir, "visual-prepared", "visual-runs",
    `${visualId}.json`), { flowId: visualId, observedAt: at,
    pages: [{ studioCode: "CAPIVARA", path: "/s/capivarabarbearia",
      viewport: "mobile", status: "OBSERVED",
      coverage: "AGENDA_NAO_VERIFICAVEL", jsErrors: [],
      assetFailures: [] }] });
  return monitorStateDir;
}

test("estado por estúdio distingue HTTP, renderização e agenda não verificável", () => {
  const monitorStateDir = syntheticReports();
  const tools = createAgentTools({ monitorStateDir,
    stateDir: join(root, "gateway"),
    now: () => new Date("2026-11-13T12:15:00Z") });
  const capivara = tools.public_status({ studio: "Capivara" });
  assert.equal(capivara.status, "PAGINAS_E_RECURSOS_OK");
  assert.equal(capivara.overallStatus, "PARCIAL");
  assert.equal(capivara.agendaInteractivity, "NAO_VERIFICAVEL");
  assert.equal(capivara.pages[0].visual[0].coverage,
    "AGENDA_NAO_VERIFICAVEL");
  assert.equal(capivara.studios.length, 1);
  const studio27 = tools.public_status({ studio: "Studio 27" });
  assert.equal(studio27.status, "FALHA_PUBLICA");
  assert.equal(studio27.studios[0].httpFailures, 1);
  const all = tools.public_status();
  assert.equal(all.studios.length, 2);
  assert.equal(all.studios.find((item) => item.studioCode === "CAPIVARA")
    .httpFailures, 0);
  assert.equal(tools.public_status({ studio: "Inexistente" }).status,
    "NAO_VERIFICAVEL");
  const visualFile = join(monitorStateDir, "visual-prepared", "visual-runs",
    `${visualId}.json`);
  writeFileSync(visualFile, JSON.stringify({ flowId: visualId,
    observedAt: at, pages: [{ studioCode: "CAPIVARA",
      path: "/s/capivarabarbearia", viewport: "mobile",
      status: "OBSERVED", coverage: "OBSERVED",
      jsErrors: ["synthetic-error"], assetFailures: [] }] }));
  assert.equal(tools.public_status({ studio: "Capivara" }).status,
    "FALHA_VISUAL");
});

test("resposta portuguesa inclui origem e data do relatório, sem outro bot", async () => {
  const monitorStateDir = syntheticReports();
  const stateDir = join(root, "gateway-conversation");
  const config = validateGatewayConfig({ schema: 1,
    ownerUserId: 7996549141, ownerChatId: 7996549141,
    monitorStateDir, stateDir, alertsEnabled: false,
    ai: { model: "gpt-6-luna", maxCallsPerDay: 20,
      maxTokensPerDay: 20000, maxDailyUsd: 0.25,
      inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.5 },
    bots: Object.fromEntries(BOT_KEYS.map((key) => [key, {
      username: `bellza_${key}_bot`, secretName: `telegram-${key}`,
      enabled: key === "atlas" || key === "sentinela",
      expectedBotId: key === "atlas" ? 9159297873 :
        key === "sentinela" ? 9294057980 : null }])) });
  const tools = createAgentTools({ monitorStateDir, stateDir,
    now: () => new Date("2026-11-13T13:15:00Z") });
  const aiByBot = Object.fromEntries(["atlas", "sentinela"].map((key) =>
    [key, { route: async ({ message }) => ({ choice: {
      tool: /Capivara|estúdios/i.test(message) ? "public_status" :
        key === "atlas" ? "monitor_status" : "monitor_alerts",
      studio: /Capivara/i.test(message) ? "Capivara" : null, hours: 24 } }),
      answer: async ({ evidence }) => ({ text:
        `Resultado ${evidence.status}; agenda ${evidence.agendaInteractivity ?? "sem prova"}.` }) }]));
  const gateway = createGateway({ config, aiByBot,
    clients: { atlas: {}, sentinela: {} }, toolRunner: tools,
    now: () => new Date("2026-11-13T13:15:00Z") });
  const update = (id, text) => ({ update_id: id, message: {
    text, from: { id: 7996549141, is_bot: false },
    chat: { id: 7996549141, type: "private" } } });
  const capivara = await gateway.handleUpdate("atlas",
    update(1, "A página da Capivara está funcionando?"));
  assert.equal(capivara.tool, "public_status");
  assert.match(capivara.reply, /última verificação que tenho/);
  assert.match(capivara.reply, /13\/11\/2026.*12:00/);
  assert.match(capivara.reply, /dados estão desatualizados/);
  assert.doesNotMatch(capivara.reply, /MONITOR_HISTORY/);
  assert.match(capivara.reply, /NAO_VERIFICAVEL/);
  const sentinela = await gateway.handleUpdate("sentinela",
    update(1, "Quais estúdios apresentaram falhas?"));
  assert.equal(sentinela.tool, "public_status");
  assert.equal(sentinela.evidence.studios.find((item) =>
    item.studioCode === "STUDIO_27").httpFailures, 1);
  assert.equal(gateway.readState().bots.atlas.length, 1);
  assert.equal(gateway.readState().bots.sentinela.length, 1);
  assert.equal((await gateway.handleUpdate("sherlock",
    update(1, "Investiga"))).status, "BOT_DISABLED");
});

test("getMe e consulta OpenAI autenticam sem enviar mensagem ou gerar resposta", async () => {
  const telegramMethods = [];
  const client = createTelegramClient({ token: `123456:${"x".repeat(25)}`,
    fetchImpl: async (url) => { telegramMethods.push(url.split("/").at(-1));
      return new Response(JSON.stringify({ ok: true, result: {
        id: 9159297873, username: "bellza_atlas_bot", is_bot: true } }),
      { status: 200 }); } });
  assert.equal((await client.getMe()).id, 9159297873);
  assert.equal(botIdentityMatches({ expectedBotId: 9159297873 },
    { id: 9159297873, username: "any" }), true);
  assert.equal(botIdentityMatches({ expectedBotId: 9159297873 },
    { id: 9294057980, username: "any" }), false);
  assert.deepEqual(telegramMethods, ["getMe"]);
  let request;
  const model = await checkOpenAiModel({ apiKey: "synthetic-key",
    model: "gpt-6-luna", fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ object: "model", id: "gpt-6-luna" }),
        { status: 200 }); } });
  assert.equal(model.status, "READY");
  assert.equal(request.options.method, "GET");
  assert.equal(request.url, "https://api.openai.com/v1/models/gpt-6-luna");
});

test("erro OpenAI expõe só estado, código e parâmetro seguros", async () => {
  const ai = createOpenAiAdapter({ apiKey: "synthetic-key", model: "gpt-6-luna",
    fetchImpl: async () => new Response(JSON.stringify({ error: {
      message: "private request text", type: "invalid_request_error",
      code: "invalid_json_schema", param: "text.format.schema" } }),
    { status: 400 }) });
  await assert.rejects(ai.route({ identity: "atlas",
    tools: ["monitor_status"], message: "texto privado", history: [] }),
  (error) => error.message ===
    "AI_HTTP_400_invalid_json_schema_text.format.schema");
});

test("IA não pode afirmar que a agenda funciona quando a interação não foi verificada", async () => {
  const monitorStateDir = syntheticReports();
  const stateDir = join(root, "gateway-unsafe-answer");
  const config = validateGatewayConfig({ schema: 1,
    ownerUserId: 7996549141, ownerChatId: 7996549141,
    monitorStateDir, stateDir, alertsEnabled: false,
    ai: { model: "gpt-6-luna", maxCallsPerDay: 20,
      maxTokensPerDay: 20000, maxDailyUsd: 0.25,
      inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.5 },
    bots: Object.fromEntries(BOT_KEYS.map((key) => [key, {
      username: `bellza_${key}_bot`, secretName: `telegram-${key}`,
      enabled: key === "atlas" || key === "sentinela" }])) });
  const gateway = createGateway({ config, clients: { atlas: {} },
    aiByBot: { atlas: { route: async () => ({ choice: {
      tool: "public_status", studio: "Capivara", hours: 24 } }),
      answer: async () => ({ text: "A agenda da Capivara funciona normalmente." }) } },
    toolRunner: createAgentTools({ monitorStateDir, stateDir }),
    now: () => new Date("2026-11-13T12:15:00Z") });
  const response = await gateway.handleUpdate("atlas", { update_id: 1,
    message: { text: "A agenda funciona?",
      from: { id: 7996549141, is_bot: false },
      chat: { id: 7996549141, type: "private" } } });
  assert.doesNotMatch(response.reply, /funciona normalmente/);
  assert.match(response.reply, /última verificação que tenho/);
});

test("piloto descarta mensagens antigas antes da IA e preserva o offset", async () => {
  const monitorStateDir = syntheticReports();
  const stateDir = join(root, "gateway-pilot-cutoff");
  const config = validateGatewayConfig({ schema: 1,
    ownerUserId: 7996549141, ownerChatId: 7996549141,
    monitorStateDir, stateDir, alertsEnabled: false,
    ai: { model: "gpt-6-luna", maxCallsPerDay: 20,
      maxTokensPerDay: 20000, maxDailyUsd: 0.25,
      inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.5 },
    bots: Object.fromEntries(BOT_KEYS.map((key) => [key, {
      username: `bellza_${key}_bot`, secretName: `telegram-${key}`,
      enabled: key === "atlas" || key === "sentinela" }])) });
  let calls = 0;
  const gateway = createGateway({ config, clients: {}, toolRunner: {},
    aiByBot: { atlas: { route: async () => { calls++; return { choice: {
      tool: "none", studio: null, hours: 24 } }; }, answer: async () => ({}) } },
    minMessageUnix: 1_763_039_200 });
  const old = await gateway.handleUpdate("atlas", { update_id: 1,
    message: { date: 1_763_039_199, text: "mensagem antiga",
      from: { id: 7996549141, is_bot: false },
      chat: { id: 7996549141, type: "private" } } });
  assert.equal(old.status, "HISTORICAL_IGNORED");
  assert.equal(calls, 0);
  assert.equal(gateway.readState().offsets.atlas, 2);
});
