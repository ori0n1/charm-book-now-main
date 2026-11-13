import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export const BOT_KEYS = Object.freeze([
  "atlas", "sentinela", "sherlock", "valida", "forge", "guardiao",
]);
export const TOOLS = Object.freeze({
  atlas: ["monitor_status", "monitor_history", "public_status",
    "task_overview", "task_coordinate", "task_monitor", "task_watch", "task_investigate",
    "task_validate", "task_propose"],
  sentinela: ["monitor_status", "monitor_alerts", "public_status",
    "task_monitor", "task_watch"],
  sherlock: ["diagnose_anomaly", "task_investigate"],
  valida: ["run_synthetic_tests", "task_validate"],
  forge: ["prepare_investigation", "task_propose"],
  guardiao: ["review_proposal"],
});
export const IDENTITIES = Object.freeze({
  atlas: "Coordenador Bellza: resume estados e histórico com datas e fontes.",
  sentinela: "Monitor Bellza: distingue leitura recente, histórica e cobertura parcial.",
  sherlock: "Diagnóstico Bellza: aponta evidências e mantém causas não comprovadas como indeterminadas.",
  valida: "Qualidade Bellza: relata apenas os contratos sintéticos locais executados.",
  forge: "Correções Bellza: prepara só investigação ou proposta não aplicada; nunca edita código.",
  guardiao: "Segurança Bellza: dá parecer técnico; nunca autoriza publicação.",
});
const positiveId = (value) => Number.isSafeInteger(value) && value > 0;

export function botIdentityMatches(bot, me) {
  if (!bot || !me) return false;
  return bot.expectedBotId ? me.id === bot.expectedBotId :
    typeof me.username === "string" &&
    me.username.toLowerCase() === bot.username?.toLowerCase();
}

export function validateGatewayConfig(config) {
  if (!config || config.schema !== 1 || !positiveId(config.ownerUserId) ||
      config.ownerChatId !== config.ownerUserId ||
      !isAbsolute(config.stateDir ?? "") ||
      !isAbsolute(config.monitorStateDir ?? "") ||
      typeof config.alertsEnabled !== "boolean" ||
      !config.ai || !/^[A-Za-z0-9._-]{3,80}$/.test(config.ai.model ?? "") ||
      !Number.isInteger(config.ai.maxCallsPerDay) ||
      config.ai.maxCallsPerDay < 1 || config.ai.maxCallsPerDay > 200 ||
      !Number.isInteger(config.ai.maxTokensPerDay) ||
      config.ai.maxTokensPerDay < 1000 || config.ai.maxTokensPerDay > 200000 ||
      !Number.isFinite(config.ai.maxDailyUsd) ||
      config.ai.maxDailyUsd <= 0 || config.ai.maxDailyUsd > 10 ||
      !Number.isFinite(config.ai.inputUsdPerMillion) ||
      config.ai.inputUsdPerMillion < 0 ||
      !Number.isFinite(config.ai.outputUsdPerMillion) ||
      config.ai.outputUsdPerMillion < 0 ||
      !config.bots || Object.keys(config.bots).sort().join(",") !==
        [...BOT_KEYS].sort().join(",")) throw new Error("GATEWAY_CONFIG_INVALID");
  for (const key of BOT_KEYS) {
    const bot = config.bots[key];
    if (!bot || !/^[A-Za-z0-9_]{5,32}$/.test(bot.username ?? "") ||
        bot.secretName !== `telegram-${key}` ||
        typeof bot.enabled !== "boolean" ||
        (bot.expectedBotId !== null && bot.expectedBotId !== undefined &&
          !positiveId(bot.expectedBotId)))
      throw new Error("GATEWAY_CONFIG_INVALID");
  }
  if (!BOT_KEYS.some((key) => config.bots[key].enabled))
    throw new Error("GATEWAY_CONFIG_INVALID");
  return Object.freeze({ ...config, stateDir: resolve(config.stateDir),
    monitorStateDir: resolve(config.monitorStateDir) });
}

export function loadGatewayConfig(path) {
  if (!isAbsolute(path ?? "")) throw new Error("GATEWAY_CONFIG_MISSING");
  let config;
  try { config = JSON.parse(readFileSync(path, "utf8")); }
  catch { throw new Error("GATEWAY_CONFIG_MISSING"); }
  return validateGatewayConfig(config);
}
