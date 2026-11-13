import { existsSync, mkdirSync, readFileSync, renameSync,
  writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { BOT_KEYS, IDENTITIES, TOOLS,
  validateGatewayConfig } from "./config.mjs";

const MAX_HISTORY = 20;
const MAX_MESSAGE = 1200;
const MAX_REPLY = 1200;
const MAX_MINUTE = 6;
const MAX_DAY_MESSAGES = 60;
const sensitive = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b(?:\+?\d[\s-]?){9,}\b|\bsk-[A-Za-z0-9_-]{12,}\b|\b\d{13,19}\b/i;
const safeText = (value) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, MAX_REPLY);
const day = (now) => now.toISOString().slice(0, 10);
const minute = (now) => Math.floor(now.getTime() / 60_000);
const emptyState = () => ({ schema: 1,
  offsets: Object.fromEntries(BOT_KEYS.map((key) => [key, 0])),
  bots: Object.fromEntries(BOT_KEYS.map((key) => [key, []])),
  quota: { day: "", calls: 0, reservedTokens: 0, reservedUsd: 0,
    messages: 0, minute: 0, minuteCount: 0 },
  alertIds: [] });
function loadState(stateDir) {
  const path = join(stateDir, "gateway-state.json");
  if (!existsSync(path)) return emptyState();
  let state;
  try { state = JSON.parse(readFileSync(path, "utf8")); }
  catch { throw new Error("GATEWAY_STATE_INVALID"); }
  if (state?.schema !== 1 || !state.offsets || !state.bots ||
      !state.quota || !Array.isArray(state.alertIds) ||
      state.alertIds.length > 500 || BOT_KEYS.some((key) =>
        !Number.isSafeInteger(state.offsets[key]) ||
        !Array.isArray(state.bots[key]) ||
        state.bots[key].length > MAX_HISTORY))
    throw new Error("GATEWAY_STATE_INVALID");
  return state;
}
function saveState(stateDir, state) {
  mkdirSync(stateDir, { recursive: true });
  const path = join(stateDir, "gateway-state.json");
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  renameSync(temp, path);
}
function resetQuota(state, now) {
  if (state.quota.day !== day(now)) {
    state.quota = { day: day(now), calls: 0, reservedTokens: 0,
      reservedUsd: 0, messages: 0, minute: minute(now), minuteCount: 0 };
  }
  if (state.quota.minute !== minute(now)) {
    state.quota.minute = minute(now);
    state.quota.minuteCount = 0;
  }
}
function reserveAi(state, config, inputChars, maxOutputTokens) {
  // UTF-8 byte count plus protocol overhead is a conservative token ceiling.
  const inputTokens = inputChars + 400;
  const tokens = inputTokens + maxOutputTokens;
  const usd = inputTokens * config.ai.inputUsdPerMillion / 1_000_000 +
    maxOutputTokens * config.ai.outputUsdPerMillion / 1_000_000;
  if (state.quota.calls + 1 > config.ai.maxCallsPerDay ||
      state.quota.reservedTokens + tokens > config.ai.maxTokensPerDay ||
      state.quota.reservedUsd + usd > config.ai.maxDailyUsd)
    throw new Error("AI_BUDGET_EXCEEDED");
  // Charge the upper estimate before the request; errors never release budget.
  state.quota.calls++;
  state.quota.reservedTokens += tokens;
  state.quota.reservedUsd += usd;
}
function allowMessage(config, update) {
  const msg = update?.message;
  return msg?.chat?.type === "private" &&
    msg.chat.id === config.ownerChatId &&
    msg.from?.id === config.ownerUserId &&
    !msg.from?.is_bot && typeof msg.text === "string";
}
function contextEntry(tool, evidence, now) {
  return { at: now.toISOString(), tool,
    status: String(evidence?.status ?? "INDISPONIVEL").slice(0, 40),
    source: String(evidence?.source ?? "INDISPONIVEL").slice(0, 40),
    codes: Array.isArray(evidence?.findings) ? evidence.findings
      .map((item) => item.code).filter((code) => typeof code === "string")
      .slice(0, 4) : [] };
}
export function prepareAlertBatch(events, sentIds = [], { enabled = false,
  ownerChatId } = {}) {
  if (!enabled) return [];
  if (!Number.isSafeInteger(ownerChatId) || ownerChatId <= 0)
    throw new Error("ALERT_TARGET_INVALID");
  const sent = new Set(sentIds);
  const eventId = (item) => {
    const studio = /^[A-Z0-9_]{2,40}$/.test(item.studioCode ?? "")
      ? item.studioCode : "GLOBAL";
    const issue = createHash("sha256").update(String(item.issueKey ??
      item.path ?? "")).digest("hex").slice(0, 12);
    return `${item.monitorId}:${item.kind}:${item.code}:${studio}:${issue}`;
  };
  return events.filter((item) => {
    if (!item || !/^[0-9a-f-]{36}$/.test(item.monitorId ?? "") ||
        !["NEW", "RECOVERED", "CHANGED", "PERSISTENT"].includes(item.kind) ||
        !/^[A-Z0-9_]{3,80}$/.test(item.code ?? "") ||
        !["critical", "warning", "info"].includes(item.severity)) return false;
    const id = eventId(item);
    if (sent.has(id)) return false;
    sent.add(id);
    return true;
  })
    .slice(0, 10).map((item) => ({
      id: eventId(item),
      chatId: ownerChatId,
      text: `Bellza ${item.kind}: ${item.code} [${item.severity}]. ` +
        `Estúdio: ${/^[A-Z0-9_]{2,40}$/.test(item.studioCode ?? "")
          ? item.studioCode : "GLOBAL"}. Fonte: monitor ${item.monitorId}.`,
    }));
}

export function createGateway({ config, aiByBot, clients, toolRunner,
  now = () => new Date(), stateDir = config?.stateDir,
  minMessageUnix = null } = {}) {
  config = validateGatewayConfig(config);
  if (!stateDir || !aiByBot || !clients || !toolRunner)
    throw new Error("GATEWAY_DEPENDENCY_INVALID");
  if (minMessageUnix !== null &&
      (!Number.isSafeInteger(minMessageUnix) || minMessageUnix <= 0))
    throw new Error("GATEWAY_PILOT_INVALID");
  let queue = Promise.resolve();
  async function processUpdate(botKey, update) {
    if (!BOT_KEYS.includes(botKey) || !Number.isSafeInteger(update?.update_id))
      throw new Error("GATEWAY_UPDATE_INVALID");
    if (!config.bots[botKey].enabled)
      return { status: "BOT_DISABLED", reply: null };
    const state = loadState(stateDir);
    if (update.update_id < state.offsets[botKey])
      return { status: "DUPLICATE", reply: null };
    const mark = () => { state.offsets[botKey] = update.update_id + 1;
      saveState(stateDir, state); };
    if (!allowMessage(config, update)) {
      mark();
      return { status: "REJECTED", reply: null };
    }
    if (minMessageUnix !== null &&
        (!Number.isSafeInteger(update.message.date) ||
          update.message.date < minMessageUnix)) {
      mark();
      return { status: "HISTORICAL_IGNORED", reply: null };
    }
    const message = update.message.text.trim();
    if (!message || message.length > MAX_MESSAGE || sensitive.test(message)) {
      mark();
      return { status: "INPUT_DENIED", reply:
        "Mensagem não processada: tamanho ou conteúdo sensível." };
    }
    const time = now();
    resetQuota(state, time);
    if (state.quota.minuteCount >= MAX_MINUTE ||
        state.quota.messages >= MAX_DAY_MESSAGES) {
      mark();
      return { status: "RATE_LIMIT", reply:
        "Limite de mensagens atingido. Tente mais tarde." };
    }
    state.quota.minuteCount++;
    state.quota.messages++;
    const history = state.bots[botKey].slice(-5);
    const ai = aiByBot[botKey];
    if (!ai || typeof ai.route !== "function" ||
        typeof ai.answer !== "function") {
      mark();
      return { status: "AI_UNAVAILABLE", reply:
        "A interpretação por IA não está configurada." };
    }
    let route;
    try {
      reserveAi(state, config, Buffer.byteLength(message + JSON.stringify(history)), 220);
      saveState(stateDir, state);
      route = await ai.route({ identity: IDENTITIES[botKey],
        tools: TOOLS[botKey], message, history });
    } catch (error) {
      const code = /^AI_[A-Za-z0-9_.]+$/.test(error?.message ?? "")
        ? error.message.slice(0, 100) : "AI_UNAVAILABLE";
      state.bots[botKey] = [...state.bots[botKey],
        { at: time.toISOString(), tool: "ai_route", status: code,
          source: "OPENAI_API", codes: [] }].slice(-MAX_HISTORY);
      mark();
      return { status: error?.message === "AI_BUDGET_EXCEEDED"
        ? "AI_BUDGET_EXCEEDED" : "AI_UNAVAILABLE",
      reply: error?.message === "AI_BUDGET_EXCEEDED"
        ? "O limite local de uso da IA foi atingido. Tente amanhã."
        : "A IA não concluiu esta consulta. Tente novamente; nenhum relatório foi interpretado." };
    }
    const choice = route?.choice;
    if (!choice || !["none", ...TOOLS[botKey]].includes(choice.tool) ||
        (choice.studio !== null && choice.studio !== undefined &&
          (typeof choice.studio !== "string" ||
            !/^[\p{L}\p{N} _-]{1,40}$/u.test(choice.studio))) ||
        (choice.hours !== null && choice.hours !== undefined &&
          (!Number.isInteger(choice.hours) || choice.hours < 1 ||
            choice.hours > 24))) {
      mark();
      return { status: "TOOL_DENIED", reply:
        "Pedido recusado: operação fora das permissões deste agente." };
    }
    if (choice.tool === "none") {
      mark();
      return { status: "NO_ALLOWED_TOOL", reply:
        "Este bot só pode consultar as ferramentas de leitura e testes locais autorizados." };
    }
    let evidence;
    try {
      const tool = toolRunner[choice.tool];
      if (typeof tool !== "function") throw new Error("TOOL_UNAVAILABLE");
      evidence = await tool({ studio: choice.studio ?? null,
        hours: choice.hours ?? 24 });
    } catch {
      evidence = { source: "INDISPONIVEL", status: "INDETERMINADO" };
    }
    let reply;
    try {
      reserveAi(state, config, Buffer.byteLength(message + JSON.stringify(evidence)), 350);
      saveState(stateDir, state);
      const answer = await ai.answer({ identity: IDENTITIES[botKey],
        message, evidence });
      reply = safeText(answer?.text);
      if (!reply || sensitive.test(reply) ||
          /(?:publiquei|publicamos|deploy (?:feito|conclu[ií]do)|patch aplicado|corre[cç][aã]o aplicada)/i.test(reply) ||
          (evidence.agendaInteractivity === "NAO_VERIFICAVEL" &&
            /agenda.{0,45}(?:funciona|operacional|dispon[ií]vel|normal)/i.test(reply)) ||
          (evidence.status === "NAO_VERIFICAVEL" &&
            /(?:página|site|estúdio).{0,45}(?:funciona|operacional|normal)/i.test(reply)))
        throw new Error("ANSWER_UNSAFE");
    } catch {
      reply = `Resultado ${evidence.status ?? "INDETERMINADO"}; ` +
        `fonte ${evidence.source ?? "INDISPONIVEL"}. ` +
        "Resposta por IA indisponível; consulte o relatório local.";
    }
    const provenance = `Fonte ${evidence.source ?? "INDISPONIVEL"}; ` +
      `verificação ${evidence.observedAt ?? "sem data"}; ` +
      `${evidence.freshness ?? "atualidade não confirmada"}. `;
    reply = safeText(provenance + reply);
    state.bots[botKey] = [...state.bots[botKey],
      contextEntry(choice.tool, evidence, time)].slice(-MAX_HISTORY);
    mark();
    return { status: "HANDLED", tool: choice.tool, evidence,
      reply: safeText(reply) };
  }
  return Object.freeze({
    handleUpdate(botKey, update) {
      const result = queue.then(() => processUpdate(botKey, update));
      queue = result.catch(() => {});
      return result;
    },
    async pollOnce(botKey, signal) {
      if (!BOT_KEYS.includes(botKey) || !config.bots[botKey].enabled)
        throw new Error("GATEWAY_BOT_INVALID");
      const offset = loadState(stateDir).offsets[botKey];
      const updates = await clients[botKey].getUpdates(offset, signal);
      for (const update of updates) {
        const outcome = await this.handleUpdate(botKey, update);
        if (outcome.reply && outcome.status !== "REJECTED") {
          try { await clients[botKey].sendOwnerMessage(config.ownerChatId,
            outcome.reply); }
          catch { /* Offset already saved: do not risk a duplicate reply. */ }
        }
      }
      return updates.length;
    },
    readState: () => loadState(stateDir),
    markAlertSent(id) {
      if (!/^[0-9a-f-]{36}:(NEW|RECOVERED|CHANGED|PERSISTENT):[A-Z0-9_]{3,80}:[A-Z0-9_]{2,40}:[0-9a-f]{12}$/.test(id))
        throw new Error("ALERT_ID_INVALID");
      const state = loadState(stateDir);
      state.alertIds = [...new Set([...state.alertIds, id])].slice(-500);
      saveState(stateDir, state);
    },
  });
}
