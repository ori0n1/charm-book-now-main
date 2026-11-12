import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatSentinelaReport } from "./sentinela.mjs";
import { diagnoseSentinela, formatSherlockReport } from "./sherlock.mjs";
import { TEST_CASES, formatValidaReport, runValida, syntheticEnvironment } from "./valida.mjs";
import { formatForgeReport, planCorrection } from "./forge.mjs";
import { formatGuardiaoReport, reviewProposal } from "./guardiao.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_STATE_DIR = join(root, ".bellza-agent-state");
export const AGENT_REGISTRY = Object.freeze({
  sentinela: Object.freeze({
    responsibility: "Cloudflare e endpoints públicos, somente leitura",
    permissions: ["cloudflare:metadata:get", "public:fixed-endpoints:get", "local:report:write"],
    maxDurationMs: 90_000,
    maxCloudflareRequests: 4,
    maxPublicRequests: 2,
    maxOutputBytes: 128_000,
  }),
  sherlock: Object.freeze({
    responsibility: "Diagnóstico local de relatórios sanitizados da Sentinela",
    permissions: ["local:sentinela-report:read", "local:report:write"],
    maxDurationMs: 20_000,
    maxOutputBytes: 128_000,
  }),
  valida: Object.freeze({
    responsibility: "Testes locais e sintéticos sem rede ou credenciais de produção",
    permissions: ["local:approved-tests:run", "local:report:write"],
    maxDurationMs: 150_000,
    maxOutputBytes: 128_000,
    maxTests: TEST_CASES.length,
  }),
  forge: Object.freeze({
    responsibility: "Planos locais de correção, sem aplicar patches",
    permissions: ["local:sanitized-reports:read", "local:proposal:write"],
    maxDurationMs: 20_000,
    maxOutputBytes: 128_000,
  }),
  guardiao: Object.freeze({
    responsibility: "Parecer técnico local, sem publicar",
    permissions: ["local:sanitized-reports:read", "local:review:write"],
    maxDurationMs: 20_000,
    maxOutputBytes: 128_000,
  }),
  diagnostico: Object.freeze({ status: "DISABLED" }),
  qualidade: Object.freeze({ status: "DISABLED" }),
  correcao: Object.freeze({ status: "DISABLED" }),
  seguranca_deploy: Object.freeze({ status: "DISABLED" }),
});

export class AtlasError extends Error {
  constructor(code) {
    super(code);
    this.name = "AtlasError";
    this.code = code;
  }
}

function acquireLock(stateDir, id, agent, now) {
  mkdirSync(stateDir, { recursive: true });
  const lockPath = join(stateDir, "atlas.lock");
  let fd;
  try {
    fd = openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") throw new AtlasError("CONFLICTING_RUN_ACTIVE");
    throw new AtlasError("LOCAL_STATE_UNAVAILABLE");
  }
  try {
    writeFileSync(fd, JSON.stringify({ id, agent, pid: process.pid, startedAt: now().toISOString() }));
  } finally {
    closeSync(fd);
  }
  return () => {
    try {
      const current = JSON.parse(readFileSync(lockPath, "utf8"));
      if (current.id === id) unlinkSync(lockPath);
    } catch {
      // Fail closed: an uncertain lock is left for manual inspection.
    }
  };
}

function appendEvent(stateDir, event) {
  const file = join(stateDir, "history.jsonl");
  const rows = existsSync(file)
    ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean)
    : [];
  rows.push(JSON.stringify(event));
  writeFileSync(file, `${rows.slice(-200).join("\n")}\n`, { mode: 0o600 });
}

function safeFailure(id, code, now, agent = "sentinela") {
  if (agent === "forge") return {
    agent, runId: id, observedAt: now().toISOString(), status: "INDETERMINADO",
    source: null, plan: null, proposedPatch: null, handoff: ["valida", "guardiao"],
    recommendations: ["A execução local não foi concluída."], publicationAuthorized: false,
    failureCode: code,
  };
  if (agent === "guardiao") return {
    agent, runId: id, observedAt: now().toISOString(), status: "INDETERMINADO",
    sources: { forge: null, valida: null, sherlock: null, sentinela: null },
    checks: [], risks: ["LOCAL_RUN_FAILED"], publicationAuthorized: false, deployAllowed: false,
    recommendation: "A execução local não foi concluída; publicação proibida.", failureCode: code,
  };
  if (agent === "sherlock") {
    return {
      agent, runId: id, observedAt: now().toISOString(), status: "INDETERMINADO",
      source: null, findings: [],
      recommendations: ["A execução local não foi concluída; rever o estado antes de repetir."],
      usage: { reportsRead: 0, historyEventsRead: 0 },
      failureCode: code,
    };
  }
  if (agent === "valida") {
    return {
      agent, runId: id, observedAt: now().toISOString(), status: "INDETERMINATE",
      areas: [], tests: [],
      recommendations: ["A execução local não foi concluída; nenhum teste com dados reais foi autorizado."],
      usage: { testsRun: 0, maxTests: TEST_CASES.length },
      failureCode: code,
    };
  }
  return {
    agent: "sentinela",
    runId: id,
    observedAt: now().toISOString(),
    status: "INDETERMINADO",
    reference: { observedVersion: "indisponivel", officialRecordedVersion: "indisponivel" },
    checks: [{ name: "agent_process", status: "BLOCKED", reason: code }],
    anomalies: [{ code, severity: "blocked", detail: "A execução local não foi concluída." }],
    recommendations: ["Inspecionar a execução local antes de repetir; nenhuma escrita em produção foi realizada."],
    integrations: [],
    usage: { cloudflare: 0, public: 0 },
  };
}

function validateChildReport(report) {
  if (!report || report.agent !== "sentinela" ||
      !["OK", "ATENCAO", "ALERTA", "INDETERMINADO"].includes(report.status) ||
      !Array.isArray(report.checks) || !Array.isArray(report.anomalies) ||
      !Array.isArray(report.recommendations) ||
      typeof report.observedAt !== "string") {
    throw new AtlasError("INVALID_AGENT_REPORT");
  }
  const idPattern = /^(?:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|indisponivel)$/;
  const codePattern = /^[A-Z][A-Z0-9_]{2,50}$/;
  const allowedChecks = new Set([
    "cloudflare_traffic", "bindings", "runtime", "script_settings",
    "crons", "cloudflare_read", "public_endpoint",
  ]);
  const allowedStates = new Set(["PASS", "FAILED", "BLOCKED", "REVIEW"]);
  const safeCheck = (check) => {
    if (!allowedChecks.has(check.name) || !allowedStates.has(check.status)) {
      throw new AtlasError("INVALID_AGENT_REPORT");
    }
    const item = { name: check.name, status: check.status };
    if (check.path !== undefined) {
      if (!["/", "/login"].includes(check.path)) throw new AtlasError("INVALID_AGENT_REPORT");
      item.path = check.path;
    }
    if (check.version !== undefined) {
      if (!idPattern.test(check.version)) throw new AtlasError("INVALID_AGENT_REPORT");
      item.version = check.version;
    }
    if (check.reason !== undefined) {
      if (!codePattern.test(check.reason)) throw new AtlasError("INVALID_AGENT_REPORT");
      item.reason = check.reason;
    }
    for (const key of ["count", "percentage", "httpStatus"]) {
      if (check[key] !== undefined) {
        if (!Number.isInteger(check[key]) || check[key] < 0 || check[key] > 1000) {
          throw new AtlasError("INVALID_AGENT_REPORT");
        }
        item[key] = check[key];
      }
    }
    return item;
  };
  const descriptions = {
    OFFICIAL_RECORD_OUTDATED: "A referência oficial difere do manifesto de leitura.",
    REFERENCE_OUTDATED: "A produção mudou após a observação do manifesto.",
    VERSION_DIVERGENCE_UNEXPLAINED: "A versão ativa difere sem origem comprovada.",
    TRAFFIC_NOT_SINGLE_100: "O tráfego não está concentrado numa única versão.",
    BINDINGS_DIVERGENCE_CONFIRMED: "Nomes ou tipos de bindings divergem.",
    RUNTIME_DIVERGENCE_CONFIRMED: "O runtime diverge.",
    SETTINGS_VERSION_MISMATCH: "As definições do script diferem da versão ativa.",
    CRONS_DIVERGENCE_CONFIRMED: "Os crons divergem.",
    PUBLIC_ENDPOINT_UNAVAILABLE: "Um endpoint público não respondeu com sucesso.",
    PUBLIC_ENDPOINT_READ_BLOCKED: "Não foi possível ler um endpoint público.",
    AUTH_UNAVAILABLE: "OAuth Cloudflare indisponível.",
    AUTH_REJECTED: "OAuth Cloudflare rejeitado.",
    NETWORK_UNAVAILABLE: "Rede indisponível.",
    CLOUDFLARE_READ_FAILED: "Leitura Cloudflare falhou.",
    RESPONSE_TOO_LARGE: "Resposta excedeu o limite.",
    INVALID_RESPONSE: "Resposta inválida.",
    BUDGET_EXCEEDED: "Limite de consultas excedido.",
    OPERATION_DENIED: "Operação fora da lista permitida.",
    READ_FAILED: "Leitura falhou.",
  };
  const anomalies = report.anomalies.map((item) => {
    if (!(item.code in descriptions) || !["warning", "critical", "blocked"].includes(item.severity)) {
      throw new AtlasError("INVALID_AGENT_REPORT");
    }
    return { code: item.code, severity: item.severity, detail: descriptions[item.code] };
  });
  const reference = {
    observedVersion: report.reference?.observedVersion,
    officialRecordedVersion: report.reference?.officialRecordedVersion,
  };
  if (!idPattern.test(reference.observedVersion) || !idPattern.test(reference.officialRecordedVersion) ||
      !Number.isFinite(Date.parse(report.observedAt))) {
    throw new AtlasError("INVALID_AGENT_REPORT");
  }
  const usage = {
    cloudflare: report.usage?.cloudflare,
    public: report.usage?.public,
  };
  if (!Number.isInteger(usage.cloudflare) || usage.cloudflare < 0 || usage.cloudflare > 4 ||
      !Number.isInteger(usage.public) || usage.public < 0 || usage.public > 2) {
    throw new AtlasError("INVALID_AGENT_REPORT");
  }
  return {
    agent: "sentinela",
    observedAt: report.observedAt,
    status: report.status,
    reference,
    checks: report.checks.map(safeCheck),
    anomalies,
    recommendations: anomalies.some((item) => item.code.includes("OUTDATED"))
      ? ["Reconciliar a referência após comprovar a origem do artefacto."]
      : report.status === "OK"
        ? ["Manter verificações manuais somente de leitura."]
        : ["Investigar sem modificar produção; qualquer correção exige aprovação específica."],
    integrations: [],
    usage,
  };
}

function latestSentinelaInput(stateDir) {
  try {
    const events = readFileSync(join(stateDir, "history.jsonl"), "utf8")
      .trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const completed = events.filter((event) =>
      event.agent === "sentinela" && event.state === "COMPLETED");
    const latest = completed.at(-1);
    if (!latest || !/^[0-9a-f-]{36}$/.test(latest.id)) return { sourceReport: null, recentEvents: [] };
    const saved = JSON.parse(readFileSync(join(stateDir, "runs", `${latest.id}.json`), "utf8"));
    const sourceReport = validateChildReport(saved);
    sourceReport.runId = latest.id;
    return { sourceReport, recentEvents: completed.slice(-20) };
  } catch {
    return { sourceReport: null, recentEvents: [] };
  }
}

function latestCompletedReport(stateDir, agent) {
  try {
    const events = readFileSync(join(stateDir, "history.jsonl"), "utf8")
      .trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const event = events.filter((item) => item.agent === agent && item.state === "COMPLETED").at(-1);
    if (!event || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(event.id)) return null;
    const report = JSON.parse(readFileSync(join(stateDir, "runs", `${event.id}.json`), "utf8"));
    return report.agent === agent && report.runId === event.id ? report : null;
  } catch {
    return null;
  }
}

function phase3Input(stateDir, agent) {
  const monitoring = latestSentinelaInput(stateDir).sourceReport;
  const storedDiagnosis = latestCompletedReport(stateDir, "sherlock");
  let diagnosis = null;
  if (monitoring && storedDiagnosis?.source?.runId === monitoring.runId &&
      Number.isFinite(Date.parse(storedDiagnosis.observedAt))) {
    const expected = diagnoseSentinela({ sourceReport: monitoring,
      now: () => new Date(storedDiagnosis.observedAt) });
    if (expected.status === storedDiagnosis.status) {
      diagnosis = { ...expected, runId: storedDiagnosis.runId };
    }
  }
  if (agent === "forge") return { diagnosis, monitoring };
  const storedValidation = latestCompletedReport(stateDir, "valida");
  let validation = null;
  try {
    if (storedValidation) validation = {
      ...normalizePhase2Report("valida", storedValidation), runId: storedValidation.runId,
    };
  } catch { /* Invalid saved evidence cannot approve a proposal. */ }
  const storedProposal = latestCompletedReport(stateDir, "forge");
  let proposal = null;
  if (storedProposal && diagnosis && monitoring &&
      Number.isFinite(Date.parse(storedProposal.observedAt))) {
    const expected = planCorrection({ diagnosis, monitoring,
      now: () => new Date(storedProposal.observedAt) });
    if (expected.status === storedProposal.status) {
      proposal = { ...expected, runId: storedProposal.runId };
    }
  }
  return { proposal, validation, diagnosis, monitoring };
}

function normalizePhase2Report(agent, raw, input) {
  if (!raw || raw.agent !== agent || !Number.isFinite(Date.parse(raw.observedAt))) {
    throw new AtlasError("INVALID_AGENT_REPORT");
  }
  const now = () => new Date(raw.observedAt);
  if (agent === "sherlock") {
    const safe = diagnoseSentinela({ ...input, now });
    if (raw.status !== safe.status) throw new AtlasError("INVALID_AGENT_REPORT");
    return safe;
  }
  if (!Array.isArray(raw.tests) || raw.tests.length !== TEST_CASES.length) {
    throw new AtlasError("INVALID_AGENT_REPORT");
  }
  const allowedStates = new Set(["PASS", "FAIL", "INDETERMINATE"]);
  const allowedReasons = new Set([
    null, "TEST_TIMEOUT", "TEST_RUNNER_UNAVAILABLE", "DEPENDENCY_UNAVAILABLE",
    "NETWORK_ATTEMPT_BLOCKED", "SYNTHETIC_TEST_FAILED", "TEST_FILE_MISSING",
  ]);
  const results = new Map();
  for (const item of raw.tests) {
    if (!TEST_CASES.some((testCase) => testCase.file === item.file) ||
        results.has(item.file) || !allowedStates.has(item.state) ||
        !allowedReasons.has(item.reason) ||
        !Number.isInteger(item.durationMs) || item.durationMs < 0 || item.durationMs > 150_000) {
      throw new AtlasError("INVALID_AGENT_REPORT");
    }
    results.set(item.file, {
      file: item.file, state: item.state, reason: item.reason, durationMs: item.durationMs,
    });
  }
  const safe = runValida({
    cases: TEST_CASES,
    runCase: (testCase) => results.get(testCase.file),
    now,
  });
  if (raw.status !== safe.status) throw new AtlasError("INVALID_AGENT_REPORT");
  return safe;
}

function normalizePhase3Report(agent, raw, input) {
  if (!raw || raw.agent !== agent || !Number.isFinite(Date.parse(raw.observedAt))) {
    throw new AtlasError("INVALID_AGENT_REPORT");
  }
  const now = () => new Date(raw.observedAt);
  const safe = agent === "forge"
    ? planCorrection({ ...input, now })
    : reviewProposal({ ...input, now });
  if (raw.status !== safe.status) throw new AtlasError("INVALID_AGENT_REPORT");
  return safe;
}

function formatReport(agent, report) {
  if (agent === "sherlock") return formatSherlockReport(report);
  if (agent === "valida") return formatValidaReport(report);
  if (agent === "forge") return formatForgeReport(report);
  if (agent === "guardiao") return formatGuardiaoReport(report);
  return formatSentinelaReport(report);
}

export async function runAtlas({
  agent = "sentinela",
  stateDir = DEFAULT_STATE_DIR,
  now = () => new Date(),
  childCommand = process.execPath,
  childArgs,
  maxDurationMs,
  maxOutputBytes,
} = {}) {
  if (!["sentinela", "sherlock", "valida", "forge", "guardiao"].includes(agent)) throw new AtlasError("AGENT_NOT_ENABLED");
  const limits = AGENT_REGISTRY[agent];
  const worker = {
    sentinela: "../scripts/agents/sentinela-worker.mjs",
    sherlock: "../scripts/agents/sherlock-worker.mjs",
    valida: "../scripts/agents/valida-worker.mjs",
    forge: "../scripts/agents/forge-worker.mjs",
    guardiao: "../scripts/agents/guardiao-worker.mjs",
  }[agent];
  const args = childArgs ?? (["forge", "guardiao"].includes(agent)
    ? ["--require", fileURLToPath(new URL("./local-test-guard.cjs", import.meta.url)),
      fileURLToPath(new URL(worker, import.meta.url))]
    : [fileURLToPath(new URL(worker, import.meta.url))]);
  const durationLimit = maxDurationMs ?? limits.maxDurationMs;
  const outputLimit = maxOutputBytes ?? limits.maxOutputBytes;
  const id = randomUUID();
  const release = acquireLock(stateDir, id, agent, now);
  try {
    appendEvent(stateDir, { id, agent, state: "RUNNING", at: now().toISOString() });
    const input = agent === "sherlock" ? latestSentinelaInput(stateDir)
      : ["forge", "guardiao"].includes(agent) ? phase3Input(stateDir, agent) : null;
    let output = "";
    let exceeded = false;
    let timedOut = false;
    const result = await new Promise((resolveResult) => {
      const child = spawn(childCommand, args, {
        cwd: root,
        stdio: [["sherlock", "forge", "guardiao"].includes(agent) ? "pipe" : "ignore", "pipe", "ignore"],
        windowsHide: true,
        env: agent === "sentinela" ? process.env : syntheticEnvironment(),
      });
      if (["sherlock", "forge", "guardiao"].includes(agent)) child.stdin.end(JSON.stringify(input));
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, durationLimit);
      child.stdout.on("data", (chunk) => {
        output += chunk.toString("utf8");
        if (Buffer.byteLength(output) > outputLimit) {
          exceeded = true;
          child.kill();
        }
      });
      child.on("error", () => {
        clearTimeout(timer);
        resolveResult({ code: null, error: true });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolveResult({ code, error: false });
      });
    });
    let report;
    if (timedOut) report = safeFailure(id, "DURATION_EXCEEDED", now, agent);
    else if (exceeded) report = safeFailure(id, "OUTPUT_BUDGET_EXCEEDED", now, agent);
    else if (result.error || result.code !== 0) report = safeFailure(id, "AGENT_PROCESS_FAILED", now, agent);
    else {
      try {
        const raw = JSON.parse(output);
        report = agent === "sentinela" ? validateChildReport(raw)
          : ["forge", "guardiao"].includes(agent)
            ? normalizePhase3Report(agent, raw, input)
            : normalizePhase2Report(agent, raw, input);
        report.runId = id;
      } catch {
        report = safeFailure(id, "INVALID_AGENT_REPORT", now, agent);
      }
    }
    const runsDir = join(stateDir, "runs");
    mkdirSync(runsDir, { recursive: true });
    writeFileSync(join(runsDir, `${id}.json`), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    const markdown = formatReport(agent, report);
    writeFileSync(join(stateDir, "latest.md"), markdown, { mode: 0o600 });
    writeFileSync(join(stateDir, `latest-${agent}.md`), markdown, { mode: 0o600 });
    appendEvent(stateDir, {
      id, agent, state: "COMPLETED", status: report.status,
      anomalyCodes: report.anomalies?.map((item) => item.code) ??
        report.findings?.map((item) => item.code) ??
        report.tests?.filter((item) => item.state !== "PASS").map((item) => item.reason) ?? [],
      at: now().toISOString(),
    });
    return { id, status: report.status, report,
      reportPath: join(stateDir, agent === "sentinela" ? "latest.md" : `latest-${agent}.md`) };
  } finally {
    release();
  }
}

export function atlasStatus(stateDir = DEFAULT_STATE_DIR) {
  const lockPath = join(stateDir, "atlas.lock");
  let running = null;
  if (existsSync(lockPath)) {
    try {
      const lock = JSON.parse(readFileSync(lockPath, "utf8"));
      running = { id: lock.id, agent: lock.agent, startedAt: lock.startedAt };
    } catch {
      running = { status: "LOCK_UNREADABLE" };
    }
  }
  const historyPath = join(stateDir, "history.jsonl");
  const events = existsSync(historyPath)
    ? readFileSync(historyPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
    : [];
  return { running, recent: events.slice(-10) };
}
