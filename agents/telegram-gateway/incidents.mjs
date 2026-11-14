import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync,
  renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { diagnosePublic, diagnoseSentinela } from "../sherlock.mjs";
import { planCorrection } from "../forge.mjs";
import { reviewIncidentEvidence } from "../guardiao.mjs";
import { TEST_CASES, runApprovedTest, runValida } from "../valida.mjs";

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const CODE = /^[A-Z][A-Z0-9_]{2,79}$/;
const STUDIO = /^[A-Z0-9_]{2,40}$/;
const KINDS = new Set(["NEW", "CHANGED", "RECOVERED", "PERSISTENT"]);
const SEVERITIES = new Set(["critical", "warning", "info"]);
const ACCESS_CODES = new Set(["AUTH_UNAVAILABLE", "AUTH_REJECTED",
  "AUTH_REFRESH_UNAVAILABLE", "AUTH_CHECK_UNAVAILABLE", "AUTH_EXPIRED",
  "NETWORK_UNAVAILABLE", "AUTH_SCOPE_UNSAFE", "CLOUDFLARE_RATE_LIMITED",
  "CLOUDFLARE_ENDPOINT_NOT_FOUND", "CLOUDFLARE_API_UNAVAILABLE",
  "CLOUDFLARE_READ_FAILED",
  "AGENT_PROCESS_FAILED", "PUBLIC_ENDPOINT_READ_BLOCKED"]);
const CLOUD_ACCESS_CODES = new Set([...ACCESS_CODES].filter((code) =>
  code !== "PUBLIC_ENDPOINT_READ_BLOCKED"));
const MONITOR_CODES = new Set([...ACCESS_CODES,
  "VISUAL_REQUEST_FAILED", "VISUAL_CHECK_FAILED",
  "VISUAL_SITEMAP_UNAVAILABLE"]);
const STABILIZE_MS = 30 * 60_000;
const FLAP_WINDOW_MS = 2 * 60 * 60_000;
const MAX_WARNING_NEW_PER_HOUR = 3;
const DESCRIPTIONS = Object.freeze({
  PUBLIC_PAGE_HTTP_ERROR: "página pública com erro HTTP",
  PUBLIC_NETWORK_UNAVAILABLE: "página pública sem resposta de rede",
  PUBLIC_RESOURCE_FAILURE: "recurso essencial indisponível",
  VISUAL_PAGE_UNAVAILABLE: "página não renderizada",
  VISUAL_JS_ERROR: "erro JavaScript observado",
  PUBLIC_ENDPOINT_UNAVAILABLE: "endpoint público indisponível",
  PUBLIC_ENDPOINT_READ_BLOCKED: "leitura do endpoint público bloqueada",
  AUTH_UNAVAILABLE: "acesso Cloudflare indisponível",
  AUTH_REJECTED: "leitura Cloudflare rejeitada",
  AUTH_REFRESH_UNAVAILABLE: "renovação OAuth não concluída",
  AUTH_CHECK_UNAVAILABLE: "verificação OAuth não concluída",
  AUTH_EXPIRED: "sessão OAuth expirada após tentativa de renovação",
  CLOUDFLARE_RATE_LIMITED: "limite de pedidos Cloudflare",
  CLOUDFLARE_ENDPOINT_NOT_FOUND: "endpoint Cloudflare não encontrado",
  CLOUDFLARE_API_UNAVAILABLE: "API Cloudflare indisponível",
  NETWORK_UNAVAILABLE: "rede de monitorização indisponível",
  VISUAL_REQUEST_FAILED: "leitura visual incompleta",
});
const MAX_STATE_BYTES = 2_000_000;
const MAX_EVENTS = 2000;
const MAX_INCIDENTS = 200;
const MAX_OUTBOX = 500;
const VALIDA_CODES = /AGENDA|BOOKING|RESERV|CLIENT|PAYMENT|WHATSAPP|PUBLIC_PAGE_HTTP_ERROR|PUBLIC_RESOURCE_FAILURE|VISUAL_JS_ERROR/;
const digest = (value) => createHash("sha256").update(value).digest("hex").slice(0, 24);

function validTime(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
function safeStudio(value) {
  return STUDIO.test(value ?? "") ? value : "UNKNOWN";
}
function safeEvidence(value) {
  return {
    httpStatus: Number.isInteger(value?.httpStatus) && value.httpStatus >= 100 &&
      value.httpStatus <= 599 ? value.httpStatus : null,
    viewport: ["mobile", "desktop"].includes(value?.viewport)
      ? value.viewport : null,
    source: ["cloudflare", "public", "visual", "functional"].includes(value?.source)
      ? value.source : "unknown",
  };
}
export function normalizeIncidentEvent(value) {
  if (!value || !UUID.test(value.monitorId ?? "") ||
      !KINDS.has(value.kind) || !CODE.test(value.code ?? "") ||
      !SEVERITIES.has(value.severity) || !validTime(value.observedAt))
    return null;
  const studioCode = safeStudio(value.studioCode);
  const evidence = safeEvidence(value.evidence);
  const pathHash = typeof value.path === "string" && value.path.startsWith("/") &&
    value.path.length <= 160 ? digest(value.path) : "none";
  const viewport = evidence.viewport ?? "none";
  const change = value.kind === "CHANGED" && typeof value.changeHash === "string" &&
    /^[a-f0-9]{24}$/.test(value.changeHash) ? value.changeHash : "none";
  const keyCode = CLOUD_ACCESS_CODES.has(value.code)
    ? "CLOUDFLARE_READ_BLOCKED" : value.code;
  const key = digest(`${keyCode}|${studioCode}|${pathHash}|${viewport}|${change}`);
  return { id: digest(`${value.monitorId}|${value.kind}|${key}`),
    key, monitorId: value.monitorId,
    sourceRunId: UUID.test(value.sourceRunId ?? "")
      ? value.sourceRunId : value.monitorId,
    kind: value.kind, code: value.code,
    severity: value.severity, studioCode, observedAt: value.observedAt,
    evidence };
}

function emptyState() {
  return { schema: 1, initialized: false, processedEventIds: [],
    incidents: [], outbox: [] };
}
function readState(stateDir) {
  const path = join(stateDir, "incident-state.json");
  if (!existsSync(path)) return emptyState();
  if (statSync(path).size > MAX_STATE_BYTES) throw new Error("INCIDENT_STATE_TOO_LARGE");
  let state;
  try { state = JSON.parse(readFileSync(path, "utf8")); }
  catch { throw new Error("INCIDENT_STATE_INVALID"); }
  if (state?.schema !== 1 || typeof state.initialized !== "boolean" ||
      !Array.isArray(state.processedEventIds) ||
      !Array.isArray(state.incidents) || !Array.isArray(state.outbox) ||
      state.processedEventIds.length > MAX_EVENTS ||
      state.incidents.length > MAX_INCIDENTS || state.outbox.length > MAX_OUTBOX)
    throw new Error("INCIDENT_STATE_INVALID");
  return state;
}
function saveState(stateDir, state) {
  mkdirSync(stateDir, { recursive: true });
  const path = join(stateDir, "incident-state.json");
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  renameSync(temp, path);
}
function acquireLock(stateDir) {
  mkdirSync(stateDir, { recursive: true });
  const path = join(stateDir, "incident.lock");
  const id = randomUUID();
  let fd;
  try { fd = openSync(path, "wx", 0o600); }
  catch { throw new Error("INCIDENT_CONFLICTING_RUN"); }
  try { writeFileSync(fd, JSON.stringify({ id, pid: process.pid })); }
  finally { closeSync(fd); }
  return () => {
    try { if (JSON.parse(readFileSync(path, "utf8")).id === id) unlinkSync(path); }
    catch { /* An uncertain lock remains for manual inspection. */ }
  };
}
function portugalTime(at) {
  return new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon",
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit",
    minute: "2-digit", hour12: false }).format(new Date(at));
}
function evidenceSummary(event) {
  const parts = [];
  if (event.evidence.httpStatus) parts.push(`HTTP ${event.evidence.httpStatus}`);
  if (event.evidence.viewport) parts.push(`vista ${event.evidence.viewport}`);
  if (!parts.length) parts.push(event.evidence.source === "unknown"
    ? "evidência técnica limitada" : `verificação ${event.evidence.source}`);
  return parts.join(", ");
}
export function formatIncidentAlert(incident, event) {
  const monitor = MONITOR_CODES.has(event.code);
  const studio = event.studioCode === "GLOBAL" ? "aplicação" :
    event.studioCode === "UNKNOWN" ? "não identificado" :
      event.studioCode.replaceAll("_", " ");
  const description = DESCRIPTIONS[event.code] ?? "anomalia em verificação";
  const when = `${portugalTime(event.observedAt)} (Portugal continental)`;
  if (event.kind === "RECOVERED") return monitor
    ? `A leitura do monitor foi recuperada para ${studio} em ${when}. A Sentinela voltou a recolher evidências; a recuperação da aplicação não foi inferida. Ver detalhes no botão.`
    : `A falha comunicada em ${studio} deixou de ser observada em ${when}. A Sentinela confirmou a recuperação na verificação pública. Ver detalhes no botão.`;
  const publicPage = /^(PUBLIC_|VISUAL_)/.test(event.code);
  const impact = monitor ? "O estado da produção permanece inconclusivo."
    : publicPage
      ? "Há impacto observado na página pública; outras funções não foram confirmadas."
      : "O impacto na produção ainda não foi comprovado.";
  const action = monitor ? "Atlas e Sherlock analisam a leitura; nenhuma alteração foi feita."
    : "Atlas abriu investigação; não houve alteração na produção.";
  const lead = event.kind === "PERSISTENT" ? "A falha persiste" :
    event.kind === "CHANGED" ? "Houve uma alteração" : "A Sentinela detetou";
  const severity = event.severity === "critical" ? "crítica" : "moderada";
  const full = `${lead} em ${studio} (gravidade ${severity}): ` +
    `${description} (${evidenceSummary(event)}). ` +
    `${impact} ${action} ${when}. Ver detalhes no botão.`;
  return full.length <= 300 ? full :
    `${lead} em ${studio} (gravidade ${severity}): ${description}. ${impact} ` +
    `Atlas acompanha; sem alterações. ${when}. Ver detalhes no botão.`;
}
export function readIncidentDetails(stateDir, id) {
  if (!UUID.test(id ?? "")) return null;
  const state = readState(stateDir);
  const incident = state.incidents.find((item) => item.id === id);
  if (!incident) return null;
  const evidence = state.outbox.findLast((item) =>
    item.incidentId === id)?.event?.evidence;
  return `Incidente ${id}\nEstado: ${incident.state}; estúdio: ${incident.studioCode}. ` +
    `Código: ${incident.code}; gravidade: ${incident.severity}. ` +
    `Primeira observação: ${portugalTime(incident.openedAt)} (Portugal continental). ` +
    `Última observação: ${portugalTime(incident.updatedAt)}. ` +
    `Evidência: ${evidence ? evidenceSummary({ evidence }) : "não disponível"}. ` +
    `Sherlock: ${incident.steps?.sherlock?.status ?? "indisponível"}; ` +
    `Valida: ${incident.steps?.valida?.status ?? "indisponível"}; ` +
    `Forge: ${incident.steps?.forge?.status ?? "indisponível"}; ` +
    `Guardião: ${incident.steps?.guardiao?.status ?? "indisponível"}. ` +
    `Origem do código de produção: não comprovada. Nenhuma alteração remota autorizada.`;
}
function compactDiagnosis(report) {
  return { status: report?.status ?? "INDETERMINADO",
    sourceRunId: typeof report?.source === "string" ? report.source :
      report?.source?.runId ?? null,
    findings: (report?.findings ?? []).slice(0, 4).map((item) => ({
      code: CODE.test(item.code ?? "") ? item.code : "UNCLASSIFIED_ANOMALY",
      causeStatus: item.causeStatus === "CONFIRMADA" ||
        item.causeStatus === "CONFIRMADA_EM_SIMULACAO" ? item.causeStatus :
        "NAO_DETERMINADA",
      affected: (item.affected ?? []).filter((name) =>
        typeof name === "string" && /^[a-z0-9-]{2,40}$/.test(name)).slice(0, 4),
      evidence: Array.isArray(item.evidence) ? item.evidence.slice(0, 4)
        .map((check) => ({ check: typeof check.name === "string" &&
          /^[a-z_]{2,40}$/.test(check.name) ? check.name : "unknown",
        status: ["FAILED", "BLOCKED", "REVIEW"].includes(check.status)
          ? check.status : "UNKNOWN" })) : safeEvidence(item.evidence),
    })) };
}
function diagnoseEvent(event, report, syntheticProof, now) {
  if (MONITOR_CODES.has(event.code))
    return { status: "INDETERMINADO", source: event.monitorId, findings: [{
      code: event.code, causeStatus: "NAO_DETERMINADA", affected: [],
      evidence: [{ name: "monitor_read", status: "BLOCKED" }] }] };
  if (event.evidence.source === "public" || event.evidence.source === "visual" ||
      event.evidence.source === "functional") {
    return diagnosePublic({ monitoring: { agent: "sentinela", runId: event.monitorId,
      anomalies: [{ studioCode: event.studioCode, code: event.code,
        scope: event.evidence.source, evidence: event.evidence }] }, now });
  }
  if (report?.agent !== "sentinela" || !Array.isArray(report.anomalies) ||
      !Array.isArray(report.checks) || report.runId !== event.sourceRunId)
    return { status: "INDETERMINADO", source: event.monitorId, findings: [] };
  const matching = report.anomalies.filter((item) => item.code === event.code);
  if (!matching.length)
    return { status: "INDETERMINADO", source: event.monitorId, findings: [] };
  return diagnoseSentinela({ sourceReport: { ...report, anomalies: matching },
    syntheticProof, now });
}
function relevantCases(event) {
  if (!VALIDA_CODES.test(event.code) && event.studioCode === "GLOBAL") return [];
  return TEST_CASES.filter((item) => item.areas.includes("agenda") ||
    item.areas.includes("reservas")).slice(0, 2);
}
function compactValidation(report) {
  return { status: report.status, source: "SYNTHETIC_LOCAL",
    tests: report.tests.map((item) => ({ file: item.file, state: item.state,
      reason: item.reason ?? null })) };
}
function compactProposal(report) {
  return { status: report.status, sourceRunId: report.source ?? null,
    scope: Array.isArray(report.plan?.scope) ? report.plan.scope.filter((item) =>
      item === "agents/reference.json").slice(0, 4) : [],
    proposedPatch: report.proposedPatch?.file === "agents/reference.json" ? {
      file: "agents/reference.json", operation: "review-version-replacement",
      applied: false } : null,
    applied: false, publicationAuthorized: false };
}
function addOutbox(state, incident, event) {
  const id = `${incident.id}:${event.kind}:${incident.cycle ?? 0}`;
  if (state.outbox.some((item) => item.id === id)) return;
  while (state.outbox.length >= MAX_OUTBOX) {
    const sent = state.outbox.findIndex((item) => item.status === "SENT");
    if (sent < 0) break;
    state.outbox.splice(sent, 1);
  }
  if (state.outbox.length >= MAX_OUTBOX) throw new Error("INCIDENT_OUTBOX_FULL");
  state.outbox.push({ id, incidentId: incident.id, kind: event.kind,
    cycle: incident.cycle ?? 0,
    status: "READY", at: event.observedAt,
    event: { monitorId: event.monitorId, kind: event.kind, code: event.code,
      severity: event.severity, studioCode: event.studioCode,
      observedAt: event.observedAt, evidence: event.evidence } });
}

export function createIncidentCoordinator({ stateDir, ownerChatId = null,
  sendAlert = null, now = () => new Date(), clock = () => Date.now(),
  runCase = (testCase) => runApprovedTest(testCase, { timeoutMs: 8_000 }),
  diagnose = diagnoseEvent, plan = planCorrection,
  maxIncidentsPerRun = 2, maxRunMs = 60_000 } = {}) {
  if (!stateDir || !Number.isInteger(maxIncidentsPerRun) ||
      maxIncidentsPerRun < 1 || maxIncidentsPerRun > 5 ||
      !Number.isInteger(maxRunMs) || maxRunMs < 1_000 || maxRunMs > 90_000)
    throw new Error("INCIDENT_CONFIG_INVALID");
  async function process(snapshot, { notify = false } = {}) {
    if (!snapshot || !["LIVE_READ_ONLY", "SYNTHETIC_SIMULATION"].includes(snapshot.mode) ||
        !Array.isArray(snapshot.events) || snapshot.events.length > MAX_EVENTS ||
        !Array.isArray(snapshot.active) || snapshot.active.length > 100)
      throw new Error("INCIDENT_SOURCE_INVALID");
    if (notify && (snapshot.mode !== "LIVE_READ_ONLY" ||
        !Number.isSafeInteger(ownerChatId) || ownerChatId <= 0 ||
        typeof sendAlert !== "function")) throw new Error("INCIDENT_SEND_DENIED");
    const release = acquireLock(stateDir);
    const started = clock();
    try {
      const state = readState(stateDir);
      if (snapshot.mode === "LIVE_READ_ONLY" && notify && !state.initialized) {
        // Existing monitor history is a baseline, never a burst of old alerts.
        state.processedEventIds = snapshot.events.map(normalizeIncidentEvent)
          .filter(Boolean).map((event) => event.id).slice(-MAX_EVENTS);
        state.initialized = true;
        saveState(stateDir, state);
        return { bootstrapped: true, processed: [], sent: 0, pending: 0,
          unknown: 0, incidents: 0, elapsedMs: clock() - started };
      }
      const processed = [];
      let newIncidents = 0;
      for (const raw of snapshot.events) {
        if (clock() - started >= maxRunMs) break;
        const event = normalizeIncidentEvent(raw);
        if (!event || state.processedEventIds.includes(event.id)) continue;
        if ((event.kind === "NEW" || event.kind === "CHANGED") &&
            event.severity === "info") {
          state.processedEventIds.push(event.id);
          continue;
        }
        const open = state.incidents.find((item) => item.key === event.key &&
          item.state === "OPEN");
        const recent = !open && event.kind === "NEW" &&
          state.incidents.findLast((item) => item.key === event.key &&
            item.state === "RECOVERED" &&
            Date.parse(event.observedAt) >= Date.parse(item.updatedAt) &&
            Date.parse(event.observedAt) - Date.parse(item.updatedAt) < FLAP_WINDOW_MS);
        if ((event.kind === "NEW" || event.kind === "CHANGED") &&
            !open && !recent && newIncidents >= maxIncidentsPerRun) break;
        if (event.kind === "RECOVERED" && !open) {
          state.processedEventIds.push(event.id);
          continue;
        }
        if (event.kind === "PERSISTENT" && !open) {
          state.processedEventIds.push(event.id);
          continue;
        }
        let incident = open ?? recent;
        if (recent) {
          recent.state = "OPEN";
          recent.openedAt = event.observedAt;
          recent.observations = 1;
          recent.lastObservedMonitorId = event.monitorId;
          recent.persistentQueued = false;
          recent.cycle = (recent.cycle ?? 0) + 1;
          recent.oscillations = (recent.oscillations ?? 0) + 1;
          recent.code = event.code;
        }
        if (!incident) {
          if (state.incidents.filter((item) => item.state === "OPEN").length >= 50)
            throw new Error("INCIDENT_CAP_REACHED");
          incident = { id: randomUUID(), key: event.key, state: "OPEN",
            code: event.code, studioCode: event.studioCode,
            severity: event.severity, openedAt: event.observedAt,
            updatedAt: event.observedAt, lastObservedMonitorId: event.monitorId,
            observations: 1, persistentQueued: false, cycle: 0,
            oscillations: 0, events: [],
            environment: snapshot.mode === "LIVE_READ_ONLY"
              ? "PRODUCTION_OBSERVATION_SOURCE_UNVERIFIED"
              : "SYNTHETIC_SIMULATION",
            steps: { sentinela: { status: "OBSERVED", runId: event.sourceRunId },
              atlas: { status: "REGISTERED", dependencies: [event.monitorId] },
              sherlock: { status: "PENDING" }, valida: { status: "PENDING" },
              forge: { status: "PENDING" }, guardiao: { status: "PENDING" } } };
          state.incidents.push(incident);
          newIncidents++;
          const sourceReport = typeof snapshot.reportFor === "function"
            ? snapshot.reportFor(event.monitorId) : null;
          try {
            const proof = snapshot.mode === "SYNTHETIC_SIMULATION"
              ? snapshot.syntheticProof ?? null : null;
            const diagnosis = diagnose(event, sourceReport, proof, now);
            incident.steps.sherlock = { ...compactDiagnosis(diagnosis),
              dependencies: [event.monitorId] };
          } catch {
            incident.steps.sherlock = { status: "FAILED", findings: [],
              dependencies: [event.monitorId] };
          }
          const cases = relevantCases(event);
          if (cases.length && clock() - started < maxRunMs - 18_000) {
            try {
              const validation = runValida({ cases, runCase, now });
              incident.steps.valida = { ...compactValidation(validation),
                dependencies: [incident.id] };
            } catch {
              incident.steps.valida = { status: "FAILED", source: "SYNTHETIC_LOCAL",
                dependencies: [incident.id] };
            }
          } else incident.steps.valida = { status: cases.length ? "SKIPPED_BUDGET" :
            "NOT_RELEVANT", dependencies: [incident.id] };
          const confirmed = incident.steps.sherlock.findings?.length > 0 &&
            incident.steps.sherlock.findings.every((item) =>
              item.causeStatus === "CONFIRMADA" ||
              item.causeStatus === "CONFIRMADA_EM_SIMULACAO");
          if (confirmed) {
            try {
              const report = plan({ diagnosis: { agent: "sherlock",
                runId: incident.id, status: incident.steps.sherlock.status,
                source: { runId: event.sourceRunId },
                findings: incident.steps.sherlock.findings },
              monitoring: sourceReport, now });
              incident.steps.forge = { ...compactProposal(report),
                dependencies: [event.monitorId, incident.id] };
            } catch {
              incident.steps.forge = { status: "FAILED", applied: false,
                dependencies: [incident.id] };
            }
          } else incident.steps.forge = { status: "BLOCKED_CAUSE_UNDETERMINED",
            applied: false, dependencies: [incident.id] };
          incident.steps.guardiao = { ...reviewIncidentEvidence({
            diagnosis: incident.steps.sherlock,
            proposal: incident.steps.forge,
            validation: incident.steps.valida,
            environment: incident.environment }),
          dependencies: [incident.id] };
        }
        if (event.kind === "RECOVERED") {
          incident.state = "RECOVERED";
          const communicated = incident.notifiedCycle ===
            (incident.cycle ?? 0) || state.outbox.some((item) =>
            item.incidentId === incident.id && item.status === "SENT" &&
            (item.cycle ?? 0) === (incident.cycle ?? 0) &&
            item.kind !== "RECOVERED");
          // A recovery is meaningful only after the owner was informed.
          state.outbox = state.outbox.filter((item) =>
            item.incidentId !== incident.id || item.status !== "READY" ||
            (item.cycle ?? 0) !== (incident.cycle ?? 0));
          incident.recoveryNotifiable = communicated;
        }
        if (event.kind === "PERSISTENT") incident.persistentQueued = true;
        incident.updatedAt = event.observedAt;
        incident.events.push({ id: event.id, kind: event.kind,
          monitorId: event.monitorId, at: event.observedAt });
        incident.events = incident.events.slice(-20);
        const stabilized = event.severity === "critical" ||
          !MONITOR_CODES.has(event.code) || event.kind === "PERSISTENT";
        if ((event.kind === "RECOVERED" && incident.recoveryNotifiable) ||
            (event.kind === "PERSISTENT") ||
            ((event.kind === "NEW" || event.kind === "CHANGED") &&
              !open && !recent && stabilized) ||
            (recent && event.severity === "critical"))
          addOutbox(state, incident, event);
        state.processedEventIds = [...state.processedEventIds, event.id]
          .slice(-MAX_EVENTS);
        processed.push({ incidentId: incident.id, kind: event.kind,
          status: incident.state });
        const openNow = state.incidents.filter((item) => item.state === "OPEN");
        const closedNow = state.incidents.filter((item) => item.state !== "OPEN");
        state.incidents = [...closedNow.slice(-Math.max(0,
          MAX_INCIDENTS - openNow.length)), ...openNow];
        saveState(stateDir, state);
      }
      const latestId = snapshot.latest?.monitorId;
      const latestAt = snapshot.latest?.observedAt;
      if (UUID.test(latestId ?? "") && validTime(latestAt)) {
        const active = new Map(snapshot.active.map((item) => {
          const normalized = normalizeIncidentEvent({ ...item, kind: "NEW",
            monitorId: latestId, observedAt: latestAt });
          return normalized ? [normalized.key, { normalized, path: item.path }] : null;
        }).filter(Boolean));
        for (const incident of state.incidents.filter((item) => item.state === "OPEN")) {
          if (!active.has(incident.key) || incident.lastObservedMonitorId === latestId)
            continue;
          incident.observations++;
          incident.lastObservedMonitorId = latestId;
          if (incident.observations < 2 || incident.persistentQueued ||
              Date.parse(latestAt) - Date.parse(incident.openedAt) < STABILIZE_MS)
            continue;
          const observation = active.get(incident.key);
          const event = normalizeIncidentEvent({ monitorId: latestId,
            kind: "PERSISTENT", code: incident.code, severity: incident.severity,
            studioCode: incident.studioCode, observedAt: latestAt,
            evidence: observation.normalized.evidence,
            path: observation.path ?? null });
          if (!event) continue;
          incident.persistentQueued = true;
          incident.updatedAt = latestAt;
          incident.events.push({ id: event.id, kind: "PERSISTENT",
            monitorId: latestId, at: latestAt });
          addOutbox(state, incident, event);
          processed.push({ incidentId: incident.id, kind: "PERSISTENT",
            status: incident.state });
        }
      }
      const open = state.incidents.filter((item) => item.state === "OPEN");
      const closed = state.incidents.filter((item) => item.state !== "OPEN");
      state.incidents = [...closed.slice(-Math.max(0, MAX_INCIDENTS - open.length)),
        ...open];
      state.outbox = state.outbox.slice(-MAX_OUTBOX);
      saveState(stateDir, state);
      let sent = 0;
      if (notify) for (const item of state.outbox.filter((entry) =>
        entry.status === "READY").slice(0, 5)) {
        if (clock() - started >= maxRunMs) break;
        const current = state.incidents.find((entry) =>
          entry.id === item.incidentId);
        if (current?.state !== "OPEN" && item.kind !== "RECOVERED") {
          item.status = "SUPPRESSED_STALE";
          saveState(stateDir, state);
          continue;
        }
        if (item.event.severity !== "critical" &&
            ["NEW", "CHANGED"].includes(item.kind) &&
            state.outbox.filter((prior) => prior.status === "SENT" &&
              prior.event.severity !== "critical" &&
              ["NEW", "CHANGED"].includes(prior.kind) &&
              Number.isFinite(Date.parse(prior.sentAt ?? "")) &&
              clock() - Date.parse(prior.sentAt) < 60 * 60_000).length >=
              MAX_WARNING_NEW_PER_HOUR) {
          item.status = "SUPPRESSED_RATE_LIMIT";
          saveState(stateDir, state);
          continue;
        }
        // Telegram has no idempotency key. An uncertain send is never retried
        // automatically; this prevents duplicate owner notifications.
        item.status = "SENDING";
        saveState(stateDir, state);
        try {
          const incident = state.incidents.find((entry) =>
            entry.id === item.incidentId && UUID.test(entry.id));
          const event = normalizeIncidentEvent(item.event);
          if (!incident || !event || ![
            `${incident.id}:${event.kind}:${item.cycle ?? 0}`,
            `${incident.id}:${event.kind}`].includes(item.id))
            throw new Error("INCIDENT_OUTBOX_INVALID");
          await sendAlert(ownerChatId, formatIncidentAlert(incident, event),
            incident.id);
          item.status = "SENT";
          item.sentAt = new Date(clock()).toISOString();
          if (item.kind !== "RECOVERED")
            incident.notifiedCycle = item.cycle ?? 0;
          sent++;
        } catch { item.status = "UNKNOWN"; }
        saveState(stateDir, state);
      }
      return { processed, sent, pending: state.outbox.filter((item) =>
        item.status === "READY").length, unknown: state.outbox.filter((item) =>
        item.status === "UNKNOWN" || item.status === "SENDING").length,
      incidents: state.incidents.length, elapsedMs: clock() - started };
    } finally { release(); }
  }
  return Object.freeze({ process, readState: () => readState(stateDir) });
}
