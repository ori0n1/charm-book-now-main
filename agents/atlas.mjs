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
import { TEST_CASES, formatValidaReport, runValida,
  runReferenceRegression, syntheticEnvironment } from "./valida.mjs";
import { formatForgeReport, planCorrection,
  prepareLocalReferencePatch } from "./forge.mjs";
import { formatGuardiaoReport, reviewProposal,
  reviewLocalCorrection } from "./guardiao.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const activeFlows = new WeakSet();
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
    OFFICIAL_RECORD_OUTDATED: "A referência oficial difere da versão ativa confirmada.",
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
    AUTH_REFRESH_UNAVAILABLE: "A renovação OAuth não foi concluída.",
    AUTH_CHECK_UNAVAILABLE: "A verificação OAuth não foi concluída.",
    AUTH_EXPIRED: "OAuth expirado após a tentativa de renovação.",
    NETWORK_UNAVAILABLE: "Rede indisponível.",
    CLOUDFLARE_RATE_LIMITED: "A API Cloudflare limitou os pedidos.",
    CLOUDFLARE_ENDPOINT_NOT_FOUND: "Endpoint de leitura Cloudflare não encontrado.",
    CLOUDFLARE_API_UNAVAILABLE: "API Cloudflare indisponível.",
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
  const observedInput = report.observed;
  const pairPattern = /^[A-Za-z0-9_.-]{1,128}:[A-Za-z0-9_]{1,60}$/;
  const safePairs = (items) => {
    if (!Array.isArray(items) || items.length > 200 ||
        items.some((item) => typeof item !== "string" || !pairPattern.test(item)) ||
        new Set(items).size !== items.length) throw new AtlasError("INVALID_AGENT_REPORT");
    return [...items];
  };
  let observed = null;
  if (observedInput !== undefined && observedInput !== null) {
    if (!observedInput || typeof observedInput !== "object") throw new AtlasError("INVALID_AGENT_REPORT");
    const activeVersion = observedInput.activeVersion;
    if (activeVersion !== null && !idPattern.test(activeVersion)) throw new AtlasError("INVALID_AGENT_REPORT");
    const runtime = observedInput.runtime;
    if (runtime !== null && (!runtime ||
        (runtime.compatibility_date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(runtime.compatibility_date)) ||
        !Array.isArray(runtime.compatibility_flags) || runtime.compatibility_flags.length > 20 ||
        runtime.compatibility_flags.some((flag) => !/^[a-z0-9_]{1,50}$/.test(flag)) ||
        (runtime.usage_model !== null && !/^[a-z_]{1,40}$/.test(runtime.usage_model)))) {
      throw new AtlasError("INVALID_AGENT_REPORT");
    }
    const cronPattern = /^[A-Za-z0-9*/?,#@L -]{1,100}$/;
    if (observedInput.crons !== null && (!Array.isArray(observedInput.crons) ||
        observedInput.crons.length > 20 ||
        observedInput.crons.some((cron) => typeof cron !== "string" || !cronPattern.test(cron)))) {
      throw new AtlasError("INVALID_AGENT_REPORT");
    }
    const bindingDiff = observedInput.bindingDiff === null ? null : {
      missing: safePairs(observedInput.bindingDiff?.missing),
      unexpected: safePairs(observedInput.bindingDiff?.unexpected),
    };
    observed = {
      activeVersion,
      bindings: observedInput.bindings === null ? null : safePairs(observedInput.bindings),
      bindingDiff,
      runtime: runtime === null ? null : {
        compatibility_date: runtime.compatibility_date,
        compatibility_flags: [...runtime.compatibility_flags],
        usage_model: runtime.usage_model,
      },
      crons: observedInput.crons === null ? null : [...observedInput.crons],
    };
  }
  return {
    agent: "sentinela",
    observedAt: report.observedAt,
    status: report.status,
    reference,
    observed,
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
  flow,
} = {}) {
  if (!["sentinela", "sherlock", "valida", "forge", "guardiao"].includes(agent)) throw new AtlasError("AGENT_NOT_ENABLED");
  if (flow) {
    if (!activeFlows.has(flow) || flow.stateDir !== stateDir) throw new AtlasError("INVALID_FLOW_CONTEXT");
    try {
      const lock = JSON.parse(readFileSync(join(stateDir, "atlas.lock"), "utf8"));
      if (lock.id !== flow.id || lock.agent !== "integrated-check") throw new Error("LOCK_MISMATCH");
    } catch { throw new AtlasError("CONFLICTING_RUN_ACTIVE"); }
  }
  const limits = AGENT_REGISTRY[agent];
  const synthetic = flow?.mode === "synthetic";
  const worker = {
    sentinela: synthetic ? "../scripts/agents/synthetic-sentinela-worker.mjs" : "../scripts/agents/sentinela-worker.mjs",
    sherlock: "../scripts/agents/sherlock-worker.mjs",
    valida: synthetic ? "../scripts/agents/synthetic-valida-worker.mjs" : "../scripts/agents/valida-worker.mjs",
    forge: "../scripts/agents/forge-worker.mjs",
    guardiao: "../scripts/agents/guardiao-worker.mjs",
  }[agent];
  const args = childArgs ?? (["forge", "guardiao"].includes(agent) || synthetic
    ? ["--require", fileURLToPath(new URL("./local-test-guard.cjs", import.meta.url)),
      fileURLToPath(new URL(worker, import.meta.url))]
    : [fileURLToPath(new URL(worker, import.meta.url))]);
  const durationLimit = maxDurationMs ?? limits.maxDurationMs;
  const outputLimit = maxOutputBytes ?? limits.maxOutputBytes;
  const id = randomUUID();
  const release = flow ? () => {} : acquireLock(stateDir, id, agent, now);
  try {
    const dependencies = flow ? ({
      sentinela: [],
      sherlock: [flow.reports.sentinela?.runId],
      forge: [flow.reports.sherlock?.runId, flow.reports.sentinela?.runId],
      valida: [flow.reports.forge?.runId],
      guardiao: [flow.reports.forge?.runId, flow.reports.valida?.runId,
        flow.reports.sherlock?.runId, flow.reports.sentinela?.runId],
    })[agent].filter(Boolean) : [];
    appendEvent(stateDir, { id, agent, state: "RUNNING", flowId: flow?.id ?? null,
      dependencies, at: now().toISOString() });
    const input = flow ? agent === "sherlock" ? {
      sourceReport: flow.reports.sentinela ?? null, recentEvents: [],
      syntheticProof: synthetic && flow.scenario !== "unknown-cause" &&
        flow.scenario !== "auth-unavailable" ? {
          kind: "SYNTHETIC_OFFICIAL_RECORD_PROOF",
          sourceRunId: flow.reports.sentinela?.runId,
          observedVersion: flow.reports.sentinela?.reference?.observedVersion,
          officialRecordedVersion: flow.reports.sentinela?.reference?.officialRecordedVersion,
        } : null,
    } : agent === "forge" ? {
      diagnosis: flow.reports.sherlock ?? null, monitoring: flow.reports.sentinela ?? null,
    } : agent === "guardiao" ? {
      proposal: flow.reports.forge ?? null, validation: flow.reports.valida ?? null,
      diagnosis: flow.reports.sherlock ?? null, monitoring: flow.reports.sentinela ?? null,
    } : null : agent === "sherlock" ? latestSentinelaInput(stateDir)
      : ["forge", "guardiao"].includes(agent) ? phase3Input(stateDir, agent) : null;
    const stdinPayload = synthetic && ["sentinela", "valida"].includes(agent)
      ? { scenario: flow.scenario, proposal: flow.reports.forge ?? null }
      : input;
    const hasInput = ["sherlock", "forge", "guardiao"].includes(agent) ||
      (synthetic && ["sentinela", "valida"].includes(agent));
    let output = "";
    let exceeded = false;
    let timedOut = false;
    const result = await new Promise((resolveResult) => {
      const child = spawn(childCommand, args, {
        cwd: root,
        stdio: [hasInput ? "pipe" : "ignore", "pipe", "ignore"],
        windowsHide: true,
        env: agent === "sentinela" && !synthetic ? process.env : syntheticEnvironment(),
      });
      if (hasInput) child.stdin.end(JSON.stringify(stdinPayload));
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
    if (flow) {
      report.flowId = flow.id;
      report.dependencies = dependencies;
      report.evidenceMode = synthetic ? "SYNTHETIC_SIMULATION" : "LIVE_READ_ONLY";
      if (synthetic && agent === "sentinela" && !report.failureCode) report.syntheticScenario = true;
      flow.reports[agent] = report;
    }
    const runsDir = join(stateDir, "runs");
    mkdirSync(runsDir, { recursive: true });
    writeFileSync(join(runsDir, `${id}.json`), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    const markdown = flow && synthetic
      ? `> SIMULAÇÃO LOCAL — não é evidência de produção. Fluxo ${flow.id}.\n\n${formatReport(agent, report)}`
      : formatReport(agent, report);
    writeFileSync(join(stateDir, "latest.md"), markdown, { mode: 0o600 });
    writeFileSync(join(stateDir, `latest-${agent}.md`), markdown, { mode: 0o600 });
    appendEvent(stateDir, {
      id, agent, state: "COMPLETED", status: report.status,
      flowId: flow?.id ?? null, dependencies,
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

export async function runIntegratedCheck({
  mode = "live", scenario = "confirmed", stateDir = DEFAULT_STATE_DIR,
  now = () => new Date(),
} = {}) {
  if (!["live", "synthetic"].includes(mode) ||
      (mode === "synthetic" && !["confirmed", "unknown-cause", "test-failure", "auth-unavailable"].includes(scenario))) {
    throw new AtlasError("INVALID_CHECK_MODE");
  }
  const id = randomUUID();
  const release = acquireLock(stateDir, id, "integrated-check", now);
  const flow = { id, stateDir, mode, scenario, reports: {} };
  activeFlows.add(flow);
  try {
    appendEvent(stateDir, { id, agent: "atlas", state: "RUNNING", mode, at: now().toISOString() });
    const steps = [];
    for (const agent of ["sentinela", "sherlock", "forge", "valida", "guardiao"]) {
      const result = await runAtlas({ agent, stateDir, now, flow });
      steps.push({ agent, runId: result.id, status: result.status,
        dependencies: result.report.dependencies });
    }
    const { sentinela, sherlock, forge, valida, guardiao } = flow.reports;
    const nextSteps = sentinela.status === "INDETERMINADO"
      ? ["Restabelecer leitura autorizada e repetir; nenhuma correção foi autorizada."]
      : valida.status === "FAILED"
        ? ["Investigar falhas nos testes sintéticos antes de rever a proposta."]
        : forge.status !== "PROPOSTA"
          ? ["Comprovar a causa antes de preparar uma proposta local."]
          : guardiao.status === "APTO"
            ? ["Revisão humana da proposta; comprovar paridade e rollback antes de qualquer pedido de publicação."]
            : ["Reunir evidências e testes válidos antes de nova avaliação."];
    const report = {
      agent: "atlas", flowId: id, observedAt: now().toISOString(),
      mode: mode === "synthetic" ? "SYNTHETIC_SIMULATION" : "LIVE_READ_ONLY",
      scenario: mode === "synthetic" ? scenario : null,
      status: guardiao.status, steps,
      anomaly: sentinela.anomalies.map((item) => item.code),
      cause: sherlock.findings.map((item) => ({ code: item.code, status: item.causeStatus })),
      proposal: forge.proposedPatch,
      tests: valida.status, opinion: guardiao.status,
      publicationAuthorized: false, deployAllowed: false, nextSteps,
    };
    const flowsDir = join(stateDir, "flows");
    mkdirSync(flowsDir, { recursive: true });
    const reportPath = join(flowsDir, `${id}.md`);
    const markdown = formatIntegratedCheck(report);
    writeFileSync(join(flowsDir, `${id}.json`), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    writeFileSync(reportPath, markdown, { mode: 0o600 });
    writeFileSync(join(stateDir, "latest-check.md"), markdown, { mode: 0o600 });
    writeFileSync(join(stateDir, "latest.md"), markdown, { mode: 0o600 });
    appendEvent(stateDir, { id, agent: "atlas", state: "COMPLETED", status: report.status,
      mode: report.mode, at: now().toISOString() });
    return { id, status: report.status, report, reportPath };
  } finally {
    activeFlows.delete(flow);
    release();
  }
}

// Manual internal flow. The Telegram gateway does not call this function.
// Only the fixed, proof-bound reference recipe can write a local worktree.
export function runLocalCorrectionFlow({ monitoring, diagnosis, proof,
  repositoryRoot, parentDir, stateDir = DEFAULT_STATE_DIR,
  active, rollback, now = () => new Date(),
  prepare = prepareLocalReferencePatch,
  validate = runReferenceRegression } = {}) {
  const id = randomUUID();
  const release = acquireLock(stateDir, id, "local-correction", now);
  try {
    appendEvent(stateDir, { id, agent: "atlas", state: "RUNNING",
      at: now().toISOString(), mode: "LOCAL_ONLY" });
    const proposal = { ...planCorrection({ diagnosis, monitoring, now }),
      runId: randomUUID() };
    let patch = null;
    let validation = null;
    if (proposal.status === "PROPOSTA" && proof) {
      try {
        patch = prepare({ repositoryRoot, parentDir, taskId: id,
          proof, diagnosis, proposal });
        validation = validate({ workspace: patch.workspace });
      } catch (error) {
        patch = { status: "BLOCKED",
          reason: /^[A-Z_]{3,60}$/.test(error?.message ?? "")
            ? error.message : "LOCAL_PATCH_UNAVAILABLE" };
      }
    }
    const review = reviewLocalCorrection({ monitoring, diagnosis, proposal,
      patch, validation, active, rollback, now });
    const report = {
      agent: "atlas", flowId: id, mode: "LOCAL_ONLY",
      status: review.status,
      steps: [
        { agent: "sherlock", runId: diagnosis?.runId ?? null },
        { agent: "forge", runId: proposal.runId,
          status: proposal.status },
        { agent: "valida", status: validation?.status ?? "NOT_RUN" },
        { agent: "guardiao", status: review.status },
      ],
      patch: patch?.status === "LOCAL_PATCH_PREPARED" ? {
        status: patch.status, file: patch.file, workspace: patch.workspace,
        sourceCommit: patch.sourceCommit,
        beforeSha256: patch.beforeSha256,
        afterSha256: patch.afterSha256,
        appliedLocally: true, remoteWrites: false,
      } : { status: patch?.status ?? "NOT_PREPARED",
        reason: patch?.reason ?? "PROOF_OR_CAUSE_REQUIRED" },
      tests: validation?.status ?? "NOT_RUN",
      review, publicationAuthorized: false, deployAllowed: false,
    };
    const dir = join(stateDir, "flows");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${id}.json`),
      JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
    appendEvent(stateDir, { id, agent: "atlas", state: "COMPLETED",
      status: report.status, at: now().toISOString(), mode: "LOCAL_ONLY" });
    return report;
  } finally { release(); }
}

export function formatIntegratedCheck(report) {
  return [
    `# Atlas — ${report.status}`, "", `Fluxo: ${report.flowId}`,
    `Modo: ${report.mode}${report.scenario ? ` (${report.scenario})` : ""}`,
    report.mode === "SYNTHETIC_SIMULATION"
      ? "SIMULAÇÃO LOCAL: versões e respostas da Sentinela são fixtures; a Valida executa contratos locais. Não representa produção."
      : "Leituras remotas apenas pela Sentinela; nenhuma escrita remota.",
    "", "## Resumo", "",
    `- Anomalia: ${report.anomaly.join(", ") || "nenhuma observada"}.`,
    `- Causa: ${report.cause.map((item) => `${item.code} ${item.status}`).join(", ") || "não determinada"}.`,
    `- Proposta: ${report.proposal ? `${report.proposal.file}, não aplicada` : "nenhuma"}.`,
    `- Testes: ${report.tests}.`, `- Parecer: ${report.opinion} (somente proposta local).`,
    "", "## Execuções e dependências", "",
    ...report.steps.map((item) => `- ${item.agent} ${item.runId}: ${item.status}; depende de ${item.dependencies.join(", ") || "nenhuma"}.`),
    "", "## Próximos passos", "", ...report.nextSteps.map((item) => `- ${item}`),
    "", "Publicação e escrita em produção: NÃO AUTORIZADAS.", "",
  ].join("\n");
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

// Shared local coordination for opt-in functional checks. Existing flows keep
// their behavior and lock format.
export { acquireLock as acquireAtlasLock, appendEvent as appendAtlasEvent };
