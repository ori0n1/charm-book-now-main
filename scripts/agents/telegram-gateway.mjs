import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BOT_KEYS, IDENTITIES, TOOLS, botIdentityMatches,
  loadGatewayConfig } from "../../agents/telegram-gateway/config.mjs";
import { createOpenAiAdapter, checkOpenAiModel } from "../../agents/telegram-gateway/ai.mjs";
import { createTelegramClient } from "../../agents/telegram-gateway/telegram.mjs";
import { createAgentTools } from "../../agents/telegram-gateway/tools.mjs";
import { createGateway } from "../../agents/telegram-gateway/gateway.mjs";
import { createTaskManager } from "../../agents/telegram-gateway/tasks.mjs";
import { createIncidentCoordinator } from "../../agents/telegram-gateway/incidents.mjs";
import { readIncidentSource } from "../../agents/telegram-gateway/incident-source.mjs";
import { acquireSingleton, readSingleton } from "../../agents/telegram-gateway/singleton.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const configPath = join(process.env.LOCALAPPDATA ?? "", "Bellza",
  "TelegramGateway", "config.json");
const secretScript = join(scriptDir, "telegram-secrets.ps1");
const mode = process.argv[2] ?? "status";
const monitorEvents = process.argv.includes("--monitor-events");
const tasksEnabled = process.argv.includes("--tasks");
const permitted = new Set(["serve", "pilot", "status", "stop", "auth-check",
  "ai-check", "alert-test"]);
if (!permitted.has(mode)) {
  process.stderr.write("Modo inválido: serve, pilot, status, stop, auth-check, ai-check ou alert-test.\n");
  process.exitCode = 2;
} else if (process.platform !== "win32" || !process.env.LOCALAPPDATA) {
  process.stderr.write("Gateway disponível apenas no Windows com perfil local.\n");
  process.exitCode = 2;
} else {
  await main();
}

function readSecret(name) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive",
    "-File", secretScript, "-Mode", "read",
    "-Name", name], { encoding: "utf8", windowsHide: true,
    timeout: 10_000, maxBuffer: 4096,
    env: { ...process.env, PSModulePath: join(
      process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\WINDOWS",
      "System32", "WindowsPowerShell", "v1.0", "Modules") } });
  if (result.status === 2) throw new Error("CREDENTIAL_MISSING");
  if (result.status !== 0 || !result.stdout?.trim())
    throw new Error("SECRET_UNAVAILABLE");
  return result.stdout.trim();
}

function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === "EPERM"; }
}
function waitForNextScan(signal) {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const finish = () => { clearTimeout(timer);
      signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, 5 * 60_000);
    signal.addEventListener("abort", finish, { once: true });
  });
}

async function main() {
  let config;
  try { config = loadGatewayConfig(resolve(configPath)); }
  catch {
    process.stdout.write("CONFIG_INDISPONIVEL: configure config.json no perfil local.\n");
    process.exitCode = 2;
    return;
  }
  const stopPath = join(config.stateDir, "gateway.stop");
  if (mode === "status") {
    const current = readSingleton(config.stateDir);
    process.stdout.write(current && processAlive(current.pid)
      ? `EM_EXECUCAO PID ${current.pid}\n` : "PARADO\n");
    return;
  }
  if (mode === "stop") {
    const current = readSingleton(config.stateDir);
    if (!current || !processAlive(current.pid)) {
      process.stdout.write("PARADO\n");
      return;
    }
    writeFileSync(stopPath, `${current.pid}\n`, { mode: 0o600 });
    process.stdout.write("PARAGEM_SOLICITADA\n");
    return;
  }
  if (mode === "auth-check") {
    let allReady = true;
    for (const key of BOT_KEYS.filter((item) => config.bots[item].enabled)) {
      try {
        const token = readSecret(`telegram-${key}`);
        const me = await createTelegramClient({ token }).getMe();
        if (!botIdentityMatches(config.bots[key], me))
          throw new Error("TELEGRAM_IDENTITY_MISMATCH");
        process.stdout.write(`${key}: READY @${me.username}\n`);
      } catch (error) {
        allReady = false;
        const code = ["CREDENTIAL_MISSING", "SECRET_UNAVAILABLE",
          "TELEGRAM_IDENTITY_MISMATCH", "TELEGRAM_AUTH_UNAVAILABLE",
          "TELEGRAM_NETWORK_UNAVAILABLE"].includes(error?.message)
          ? error.message : "API_UNAVAILABLE";
        process.stdout.write(`${key}: ${code}\n`);
      }
    }
    try {
      const key = readSecret("openai-api");
      await checkOpenAiModel({ apiKey: key, model: config.ai.model });
      process.stdout.write(`openai: READY ${config.ai.model}\n`);
    } catch (error) {
      allReady = false;
      const code = ["CREDENTIAL_MISSING", "SECRET_UNAVAILABLE",
        "AI_AUTH_UNAVAILABLE", "AI_NETWORK_UNAVAILABLE",
        "AI_MODEL_UNAVAILABLE"].includes(error?.message)
        ? error.message : "API_UNAVAILABLE";
      process.stdout.write(`openai: ${code}\n`);
    }
    if (!allReady) process.exitCode = 2;
    return;
  }
  if (mode === "ai-check") {
    try {
      const apiKey = readSecret("openai-api");
      const ai = createOpenAiAdapter({ apiKey, model: config.ai.model });
      const typoForge = process.argv.includes("--forge-typo");
      const bot = typoForge ? "forge" : "atlas";
      const result = await ai.route({ identity: IDENTITIES[bot],
        tools: TOOLS[bot],
        message: typoForge
          ? "Froge, preapra uma propoosta de investigacao sem aplicar corecoes"
          : "Como está a Bellza hoje? Qual foi a última verificação?",
        history: [] });
      process.stdout.write(`AI_ROUTE_READY ferramenta=${result.choice.tool}; ` +
        `entrada=${result.usage.input}; saída=${result.usage.output}.\n`);
      if (process.argv.includes("--style")) {
        const answer = await ai.answer({ identity: IDENTITIES.atlas,
          message: "Como está a Bellza hoje?",
          evidence: { source: "SYNTHETIC_LOCAL", status: "ATENCAO",
            freshness: "DESATUALIZADO",
            observedAt: "2026-11-13T11:49:46.967Z",
            publicStatus: "PAGINAS_E_RECURSOS_OK",
            visualStatus: "PARCIAL" } });
        process.stdout.write(`AI_STYLE_SYNTHETIC: ${answer.text}\n`);
      }
    } catch (error) {
      const code = /^AI_[A-Za-z0-9_.]+$/.test(error?.message ?? "")
        ? error.message : "AI_CHECK_UNAVAILABLE";
      process.stdout.write(`${code}\n`);
      process.exitCode = 2;
    }
    return;
  }
  if (mode === "alert-test") {
    const at = new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon",
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
    const message = `TESTE SINTÉTICO Bellza. Envio de alerta da Sentinela ` +
      `para o chat privado autorizado. ${at} (Portugal continental). ` +
      `Esta mensagem não indica uma falha real.`;
    if (!process.argv.includes("--send-approved")) {
      process.stdout.write(`PREVIEW_SEM_ENVIO: ${message}\n`);
      return;
    }
    if (config.alertsEnabled !== true || !config.bots.sentinela.enabled) {
      process.stderr.write("INCIDENT_ALERTS_NOT_AUTHORIZED\n");
      process.exitCode = 2;
      return;
    }
    try {
      const client = createTelegramClient({ token: readSecret("telegram-sentinela") });
      if (!botIdentityMatches(config.bots.sentinela, await client.getMe()))
        throw new Error("TELEGRAM_IDENTITY_MISMATCH");
      await client.sendOwnerMessage(config.ownerChatId, message);
      process.stdout.write("SYNTHETIC_ALERT_SENT_TO_OWNER\n");
    } catch {
      process.stderr.write("SYNTHETIC_ALERT_SEND_UNAVAILABLE\n");
      process.exitCode = 2;
    }
    return;
  }
  // Validate all prerequisites before acquiring the singleton lock.
  let apiKey;
  const tokens = {};
  const enabledBots = BOT_KEYS.filter((key) => config.bots[key].enabled);
  if (monitorEvents && (mode !== "serve" || config.alertsEnabled !== true ||
      !config.bots.sentinela.enabled || config.bots.guardiao.enabled)) {
    process.stderr.write("INCIDENT_ALERTS_NOT_AUTHORIZED\n");
    process.exitCode = 2;
    return;
  }
  if (tasksEnabled && (!["serve", "pilot"].includes(mode) ||
      config.bots.guardiao.enabled)) {
    process.stderr.write("TASK_MODE_INVALID\n");
    process.exitCode = 2;
    return;
  }
  if (mode === "pilot" && enabledBots.join(",") !== "atlas,sentinela") {
    process.stderr.write("Piloto limitado a Atlas e Sentinela.\n");
    process.exitCode = 2;
    return;
  }
  try {
    apiKey = readSecret("openai-api");
    for (const key of enabledBots) tokens[key] = readSecret(`telegram-${key}`);
  } catch {
    process.stderr.write("Credenciais DPAPI ausentes ou ilegíveis neste perfil.\n");
    process.exitCode = 2;
    return;
  }
  try {
    for (const key of enabledBots) {
      const me = await createTelegramClient({ token: tokens[key] }).getMe();
      if (!botIdentityMatches(config.bots[key], me))
        throw new Error("TELEGRAM_IDENTITY_MISMATCH");
    }
    await checkOpenAiModel({ apiKey, model: config.ai.model });
  } catch {
    process.stderr.write("Autenticação ou identidade de bot indisponível.\n");
    process.exitCode = 2;
    return;
  }
  let release;
  try { release = acquireSingleton(config.stateDir); }
  catch {
    process.stderr.write("Gateway já bloqueado; confirme o processo antes de limpar um lock órfão.\n");
    process.exitCode = 2;
    return;
  }
  try {
    const aiByBot = Object.fromEntries(enabledBots.map((key) => [key,
      createOpenAiAdapter({ apiKey, model: config.ai.model })]));
    const clients = Object.fromEntries(enabledBots.map((key) => [key,
      createTelegramClient({ token: tokens[key] })]));
    apiKey = undefined;
    for (const key of BOT_KEYS) tokens[key] = undefined;
    const toolRunner = createAgentTools({ monitorStateDir: config.monitorStateDir,
      stateDir: config.stateDir });
    const taskManager = tasksEnabled ? createTaskManager({
      stateDir: join(config.stateDir, "tasks"), toolRunner }) : null;
    taskManager?.recover();
    const gateway = createGateway({ config, aiByBot, clients, toolRunner,
      taskManager,
      minMessageUnix: Math.floor(Date.now() / 1000) });
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    const pilotTimer = mode === "pilot"
      ? setTimeout(stop, 10 * 60_000) : null;
    const stopPoll = setInterval(() => {
      if (existsSync(stopPath)) controller.abort();
    }, 1000);
    process.stdout.write(`GATEWAY_READY ${enabledBots.join(",")}; ` +
      `alertas automáticos ${monitorEvents ? "ativados" : "desativados"}; ` +
      `tarefas ${tasksEnabled ? "ativadas" : "desativadas"}; ` +
      `${mode === "pilot" ? "piloto até 10 minutos" : "manual"}.\n`);
    try {
      const workers = enabledBots.map(async (key) => {
        let backoff = 1000;
        while (!controller.signal.aborted) {
          try {
            await gateway.pollOnce(key, controller.signal);
            backoff = 1000;
          } catch (error) {
            if (controller.signal.aborted) break;
            const code = ["TELEGRAM_AUTH_UNAVAILABLE", "TELEGRAM_WEBHOOK_CONFLICT"]
              .includes(error?.message) ? error.message : "POLL_UNAVAILABLE";
            process.stderr.write(`${key}: ${code}\n`);
            if (code !== "POLL_UNAVAILABLE") { controller.abort(); break; }
            await new Promise((done) => setTimeout(done, backoff));
            backoff = Math.min(backoff * 2, 30_000);
          }
        }
      });
      if (monitorEvents) {
        const coordinator = createIncidentCoordinator({
          stateDir: join(config.stateDir, "incidents"),
          ownerChatId: config.ownerChatId,
          sendAlert: (chatId, message) =>
            clients.sentinela.sendOwnerMessage(chatId, message),
        });
        workers.push((async () => {
          while (!controller.signal.aborted) {
            try {
              const source = readIncidentSource(config.monitorStateDir);
              await coordinator.process(source, { notify: true });
              taskManager?.recordMonitorEvents(source.events);
            } catch (error) {
              const code = /^INCIDENT_[A-Z0-9_]+$/.test(error?.message ?? "")
                ? error.message : "INCIDENT_SCAN_UNAVAILABLE";
              process.stderr.write(`${code}\n`);
            }
            await waitForNextScan(controller.signal);
          }
        })());
      }
      await Promise.all(workers);
    } finally {
      clearInterval(stopPoll);
      if (pilotTimer) clearTimeout(pilotTimer);
    }
  } finally {
    release();
    try { unlinkSync(stopPath); } catch { /* No stop request. */ }
  }
}
