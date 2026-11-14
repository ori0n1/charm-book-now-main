import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync,
  writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIncidentCoordinator, formatIncidentAlert,
  normalizeIncidentEvent, readIncidentDetails } from "../../agents/telegram-gateway/incidents.mjs";
import { readIncidentSource } from "../../agents/telegram-gateway/incident-source.mjs";

const root = mkdtempSync(join(tmpdir(), "bellza-phase20-"));
process.on("exit", () => rmSync(root, { recursive: true, force: true }));
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let sequence = 0;
const stateDir = () => join(root, `incidents-${++sequence}`);
const at = "2026-11-13T10:00:00Z";
const event = (monitor = id(1), kind = "NEW", extra = {}) => ({
  monitorId: monitor, sourceRunId: monitor, kind,
  code: "PUBLIC_PAGE_HTTP_ERROR", severity: kind === "RECOVERED" ? "info" : "warning",
  studioCode: "CAPIVARA", path: "/s/capivara", observedAt: at,
  evidence: { source: "public", httpStatus: 503 }, ...extra,
});
const snapshot = (events, extra = {}) => ({ mode: "SYNTHETIC_SIMULATION",
  events, active: [], latest: { monitorId: id(1), observedAt: at }, ...extra });
const runCase = (testCase) => ({ file: testCase.file, state: "PASS",
  reason: null, durationMs: 1 });

test("Atlas encadeia Sentinela, Sherlock, Valida e Forge por incidente", async () => {
  const coordinator = createIncidentCoordinator({ stateDir: stateDir(), runCase });
  const result = await coordinator.process(snapshot([event()]));
  assert.equal(result.processed.length, 1);
  assert.equal(result.sent, 0);
  const state = coordinator.readState();
  const incident = state.incidents[0];
  assert.match(incident.id, /^[0-9a-f-]{36}$/);
  assert.equal(incident.studioCode, "CAPIVARA");
  assert.equal(incident.steps.sentinela.status, "OBSERVED");
  assert.equal(incident.steps.atlas.status, "REGISTERED");
  assert.equal(incident.steps.sherlock.findings[0].causeStatus, "NAO_DETERMINADA");
  assert.equal(incident.steps.valida.status, "APPROVED");
  assert.equal(incident.steps.valida.tests.length, 2);
  assert.equal(incident.steps.forge.status, "BLOCKED_CAUSE_UNDETERMINED");
  assert.equal(incident.steps.forge.applied, false);
  assert.equal(incident.steps.guardiao.status, "INDETERMINADO");
  assert.equal(incident.steps.guardiao.publicationAuthorized, false);
  assert.equal(incident.steps.guardiao.checks.find((item) =>
    item.name === "rollback").status, "UNKNOWN");
  assert.deepEqual(incident.steps.sherlock.dependencies, [id(1)]);
  assert.equal(state.outbox[0].status, "READY");
});

test("evento repetido não cria novo incidente; recuperação não nasce de leitura inconclusiva", async () => {
  const coordinator = createIncidentCoordinator({ stateDir: stateDir(), runCase });
  await coordinator.process(snapshot([event()]));
  assert.equal((await coordinator.process(snapshot([event()]))).processed.length, 0);
  await coordinator.process(snapshot([], { latest: { monitorId: id(2),
    observedAt: "2026-11-13T10:45:00Z" }, active: [] }));
  assert.equal(coordinator.readState().incidents[0].state, "OPEN");
  assert.equal(coordinator.readState().outbox.length, 1);
  await coordinator.process(snapshot([event(id(3), "RECOVERED", {
    observedAt: "2026-11-13T11:00:00Z" })]));
  assert.equal(coordinator.readState().incidents[0].state, "RECOVERED");
  assert.equal(coordinator.readState().outbox.length, 0);
  await coordinator.process(snapshot([event(id(3), "RECOVERED", {
    observedAt: "2026-11-13T11:00:00Z" })]));
  assert.equal(coordinator.readState().outbox.length, 0);
  await coordinator.process(snapshot([event(id(4), "NEW", {
    observedAt: "2026-11-13T12:00:00Z" })]));
  assert.equal(coordinator.readState().incidents.length, 1);
  assert.equal(coordinator.readState().incidents[0].oscillations, 1);
});

test("indisponibilidade persistente exige nova observação ativa após 30 minutos", async () => {
  const coordinator = createIncidentCoordinator({ stateDir: stateDir(), runCase });
  await coordinator.process(snapshot([event()]));
  const later = snapshot([], { active: [event(id(2))],
    latest: { monitorId: id(2), observedAt: "2026-11-13T10:45:00Z" } });
  await coordinator.process(later);
  const state = coordinator.readState();
  assert.equal(state.incidents[0].observations, 2);
  assert.equal(state.outbox.filter((item) => item.kind === "PERSISTENT").length, 1);
  assert.equal(state.outbox.find((item) => item.kind === "PERSISTENT")
    .event.evidence.httpStatus, 503);
  await coordinator.process(later);
  assert.equal(coordinator.readState().outbox.length, 2);
});

test("falha do Sherlock não bloqueia Valida e nunca libera Forge", async () => {
  const coordinator = createIncidentCoordinator({ stateDir: stateDir(), runCase,
    diagnose: () => { throw new Error("synthetic secret error"); } });
  await coordinator.process(snapshot([event()]));
  const steps = coordinator.readState().incidents[0].steps;
  assert.equal(steps.sherlock.status, "FAILED");
  assert.equal(steps.valida.status, "APPROVED");
  assert.equal(steps.forge.status, "BLOCKED_CAUSE_UNDETERMINED");
  assert.doesNotMatch(JSON.stringify(coordinator.readState()), /synthetic secret error/);
});

test("Guardião bloqueia proposta quando teste local falha", async () => {
  const coordinator = createIncidentCoordinator({ stateDir: stateDir(),
    runCase: (testCase) => ({ file: testCase.file, state: "FAIL",
      reason: "synthetic", durationMs: 1 }) });
  await coordinator.process(snapshot([event(id(74))]));
  const guardiao = coordinator.readState().incidents[0].steps.guardiao;
  assert.equal(guardiao.status, "BLOQUEADO");
  assert.equal(guardiao.deployAllowed, false);
});

test("causa comprovada só em simulação produz proposta não aplicada", async () => {
  const observed = id(21);
  const official = id(22);
  const report = { agent: "sentinela", runId: id(10), status: "ATENCAO",
    observedAt: at, syntheticScenario: true,
    checks: [{ name: "cloudflare_traffic", status: "PASS", version: observed }],
    anomalies: [{ code: "OFFICIAL_RECORD_OUTDATED", severity: "warning" }],
    reference: { observedVersion: observed, officialRecordedVersion: official } };
  const proof = { kind: "SYNTHETIC_OFFICIAL_RECORD_PROOF",
    sourceRunId: id(10), observedVersion: observed,
    officialRecordedVersion: official };
  const coordinator = createIncidentCoordinator({ stateDir: stateDir(), runCase });
  await coordinator.process(snapshot([{ monitorId: id(11), sourceRunId: id(10),
    kind: "NEW", code: "OFFICIAL_RECORD_OUTDATED", severity: "warning",
    studioCode: "GLOBAL", observedAt: at,
    evidence: { source: "cloudflare" } }],
  { reportFor: () => report, syntheticProof: proof }));
  const steps = coordinator.readState().incidents[0].steps;
  assert.equal(steps.sherlock.findings[0].causeStatus, "CONFIRMADA");
  assert.equal(steps.forge.status, "PROPOSTA");
  assert.equal(steps.forge.proposedPatch.applied, false);
  assert.equal(steps.forge.publicationAuthorized, false);
  assert.equal(steps.valida.status, "NOT_RELEVANT");
});

test("envio requer fonte real, faz bootstrap sem alerta antigo e deduplica", async () => {
  const sent = [];
  const coordinator = createIncidentCoordinator({ stateDir: stateDir(),
    ownerChatId: 12345, sendAlert: async (chat, text) => sent.push({ chat, text }),
    runCase });
  await assert.rejects(coordinator.process(snapshot([event()]),
    { notify: true }), /INCIDENT_SEND_DENIED/);
  const live = (events, latestId = id(1)) => ({ mode: "LIVE_READ_ONLY",
    events, active: [], latest: { monitorId: latestId, observedAt: at } });
  const baseline = await coordinator.process(live([event()]), { notify: true });
  assert.equal(baseline.bootstrapped, true);
  assert.equal(sent.length, 0);
  const newer = event(id(2), "NEW", { path: "/s/studio27",
    studioCode: "STUDIO_27", observedAt: "2026-11-13T11:00:00Z" });
  await coordinator.process(live([event(), newer], id(2)), { notify: true });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chat, 12345);
  assert.match(sent[0].text, /STUDIO 27/);
  assert.match(sent[0].text, /Portugal continental/);
  assert.match(sent[0].text, /Atlas abriu investigação/);
  assert.ok(sent[0].text.length >= 150 && sent[0].text.length <= 300);
  assert.doesNotMatch(sent[0].text, /Incidente [0-9a-f]{8}|\*/);
  await coordinator.process(live([event(), newer], id(2)), { notify: true });
  assert.equal(sent.length, 1);
});

test("ocorrência informativa sem relevância não dispara alerta", async () => {
  const coordinator = createIncidentCoordinator({ stateDir: stateDir(), runCase });
  await coordinator.process(snapshot([event(id(71), "NEW", { severity: "info" })]));
  assert.equal(coordinator.readState().incidents.length, 0);
  assert.equal(coordinator.readState().outbox.length, 0);
});

test("falha ambígua no envio não é repetida automaticamente", async () => {
  let attempts = 0;
  const coordinator = createIncidentCoordinator({ stateDir: stateDir(),
    ownerChatId: 12345, runCase,
    sendAlert: async () => { attempts++; throw new Error("network uncertain"); } });
  const live = (events) => ({ mode: "LIVE_READ_ONLY", events, active: [],
    latest: { monitorId: id(1), observedAt: at } });
  await coordinator.process(live([]), { notify: true });
  await coordinator.process(live([event()]), { notify: true });
  assert.equal(attempts, 1);
  assert.equal(coordinator.readState().outbox[0].status, "UNKNOWN");
  await coordinator.process(live([event()]), { notify: true });
  assert.equal(attempts, 1);
});

test("limites, lock e entradas hostis bloqueiam ações fora do escopo", async () => {
  const dir = stateDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "incident.lock"), "held");
  const coordinator = createIncidentCoordinator({ stateDir: dir,
    runCase, maxIncidentsPerRun: 1 });
  await assert.rejects(coordinator.process(snapshot([event()])),
    /INCIDENT_CONFLICTING_RUN/);
  rmSync(join(dir, "incident.lock"));
  const malicious = event(id(5), "NEW", { code: "RUN_SHELL;DROP_TABLE",
    path: "/s/private@example.com", evidence: { source: "public" } });
  assert.equal(normalizeIncidentEvent(malicious), null);
  const first = await coordinator.process(snapshot([event(),
    event(id(6), "NEW", { studioCode: "STUDIO_27", path: "/s/studio27" })]));
  assert.equal(first.processed.length, 1);
  assert.equal(coordinator.readState().incidents.length, 1);
  const second = await coordinator.process(snapshot([malicious,
    event(id(6), "NEW", { studioCode: "STUDIO_27", path: "/s/studio27" })]));
  assert.equal(second.processed.length, 1);
  assert.doesNotMatch(JSON.stringify(coordinator.readState()), /private@example.com/);
});

test("orçamento de duração interrompe a fila sem perder o evento", async () => {
  let tick = 0;
  const coordinator = createIncidentCoordinator({ stateDir: stateDir(),
    runCase, maxRunMs: 1_000, clock: () => { tick += 1_001; return tick; } });
  const result = await coordinator.process(snapshot([event()]));
  assert.equal(result.processed.length, 0);
  assert.equal(coordinator.readState().incidents.length, 0);
});

test("alerta usa Portugal e evidência mínima sem URL ou dados pessoais", () => {
  const normalized = normalizeIncidentEvent(event(id(7), "NEW", {
    observedAt: "2026-06-13T12:00:00Z",
    path: "/s/private@example.com", evidence: { source: "public",
      httpStatus: 503, token: "sk-SHOULD_NOT_APPEAR" } }));
  const text = formatIncidentAlert({ id: id(8) }, normalized);
  assert.match(text, /13\/06\/2026, 13:00 \(Portugal continental\)/);
  assert.match(text, /HTTP 503/);
  assert.doesNotMatch(text, /private@example.com|SHOULD_NOT_APPEAR/);
});

test("oscilação Cloudflare é agrupada; recuperação só após aviso enviado", async () => {
  const sent = [];
  const coordinator = createIncidentCoordinator({ stateDir: stateDir(),
    ownerChatId: 12345, sendAlert: async (_chat, text) => sent.push(text),
    runCase });
  const cloud = (monitorId, kind, observedAt) => event(monitorId, kind, {
    code: "AUTH_UNAVAILABLE", studioCode: "GLOBAL", path: null,
    severity: kind === "RECOVERED" ? "info" : "warning",
    evidence: { source: "cloudflare" }, observedAt });
  const live = (events, monitorId, observedAt, active = []) => ({
    mode: "LIVE_READ_ONLY", events, active,
    latest: { monitorId, observedAt },
  });
  await coordinator.process(live([], id(80), at), { notify: true });
  await coordinator.process(live([cloud(id(81), "NEW", at)], id(81), at),
    { notify: true });
  assert.equal(sent.length, 0);
  await coordinator.process(live([cloud(id(82), "RECOVERED",
    "2026-11-13T10:20:00Z")], id(82), "2026-11-13T10:20:00Z"),
  { notify: true });
  assert.equal(sent.length, 0);
  await coordinator.process(live([cloud(id(83), "NEW",
    "2026-11-13T10:40:00Z")], id(83), "2026-11-13T10:40:00Z"),
  { notify: true });
  assert.equal(coordinator.readState().incidents.length, 1);
  assert.equal(coordinator.readState().incidents[0].oscillations, 1);
  assert.equal(sent.length, 0);
  const later = "2026-11-13T11:15:00Z";
  await coordinator.process(live([], id(84), later,
    [cloud(id(84), "NEW", later)]), { notify: true });
  assert.equal(sent.length, 1);
  assert.match(sent[0], /estado da produção permanece inconclusivo/i);
  assert.doesNotMatch(sent[0], /saudável/i);
  assert.ok(sent[0].length >= 150 && sent[0].length <= 300);
  await coordinator.process(live([cloud(id(85), "RECOVERED",
    "2026-11-13T11:30:00Z")], id(85), "2026-11-13T11:30:00Z"),
  { notify: true });
  assert.equal(sent.length, 2);
  assert.match(sent[1], /leitura do monitor foi recuperada/i);
  assert.ok(sent[1].length >= 150 && sent[1].length <= 300);
  assert.equal(coordinator.readState().incidents[0].environment,
    "PRODUCTION_OBSERVATION_SOURCE_UNVERIFIED");
});

test("falha visual de pedido não comprova defeito da aplicação", async () => {
  const dir = stateDir();
  const coordinator = createIncidentCoordinator({ stateDir: dir, runCase });
  await coordinator.process(snapshot([event(id(90), "NEW", {
    code: "VISUAL_REQUEST_FAILED", path: "/s/studio27braga",
    studioCode: "STUDIO_27", evidence: { source: "visual" },
  })]));
  const state = coordinator.readState();
  assert.equal(state.outbox.length, 0);
  assert.equal(state.incidents[0].steps.sherlock.findings[0].causeStatus,
    "NAO_DETERMINADA");
  assert.equal(state.incidents[0].steps.forge.applied, false);
  assert.equal(state.incidents[0].environment, "SYNTHETIC_SIMULATION");
  const details = readIncidentDetails(dir, state.incidents[0].id);
  assert.match(details, /VISUAL_REQUEST_FAILED/);
  assert.match(details, /Origem do código de produção: não comprovada/);
});

test("limite horário reduz avisos comuns sem suprimir falhas críticas", async () => {
  const sent = [];
  const coordinator = createIncidentCoordinator({ stateDir: stateDir(),
    ownerChatId: 12345, sendAlert: async (_chat, text) => sent.push(text),
    runCase });
  const live = (events, monitorId) => ({ mode: "LIVE_READ_ONLY",
    events, active: [], latest: { monitorId, observedAt: at } });
  await coordinator.process(live([], id(100)), { notify: true });
  for (let n = 101; n <= 105; n++) {
    await coordinator.process(live([event(id(n), "NEW", {
      path: `/s/fixture-${n}`, severity: n === 105 ? "critical" : "warning",
    })], id(n)), { notify: true });
  }
  assert.equal(sent.length, 4);
  assert.equal(coordinator.readState().outbox.filter((item) =>
    item.status === "SUPPRESSED_RATE_LIMIT").length, 1);
});

test("adaptador local rejeita histórico simulado e enriquece estúdio público", () => {
  const base = join(root, `monitor-${++sequence}`);
  mkdirSync(join(base, "runs"), { recursive: true });
  mkdirSync(join(base, "public-integrated", "public-runs"),
    { recursive: true });
  const monitorId = id(30), sentinelaId = id(31), publicId = id(32);
  const put = (path, value) => writeFileSync(path, JSON.stringify(value));
  const journal = { monitorId, sentinelaRunId: sentinelaId, publicRunId: publicId,
    visualRunId: null, mode: "LIVE_READ_ONLY", at };
  put(join(base, "monitor-state.json"), { schema: 1, journal: [journal],
    alerts: [{ monitorId, sentinelaRunId: sentinelaId, at, kind: "NEW",
      code: "PUBLIC_PAGE_HTTP_ERROR", severity: "warning",
      evidence: { path: "/s/capivara" } }] });
  put(join(base, "runs", `${sentinelaId}.json`), { agent: "sentinela",
    runId: sentinelaId, status: "OK", anomalies: [], checks: [] });
  put(join(base, "public-integrated", "public-state.json"), { alerts: [
    { flowId: publicId, kind: "NEW", code: "PUBLIC_PAGE_HTTP_ERROR",
      studioCode: "CAPIVARA", path: "/s/capivara" }] });
  put(join(base, "public-integrated", "public-runs", `${publicId}.json`),
    { mode: "PUBLIC_READ_ONLY", pages: [{ path: "/s/capivara",
      httpStatus: 503 }], anomalies: [{ code: "PUBLIC_PAGE_HTTP_ERROR",
      severity: "warning", studioCode: "CAPIVARA", path: "/s/capivara" }] });
  const source = readIncidentSource(base);
  assert.equal(source.events[0].studioCode, "CAPIVARA");
  assert.equal(source.events[0].evidence.source, "public");
  assert.equal(source.events[0].evidence.httpStatus, 503);
  assert.equal(source.active[0].studioCode, "CAPIVARA");
  assert.equal(source.reportFor(monitorId).runId, sentinelaId);
  put(join(base, "monitor-state.json"), { schema: 1,
    journal: [{ ...journal, mode: "SYNTHETIC_SIMULATION" }], alerts: [] });
  assert.throws(() => readIncidentSource(base), /INCIDENT_LIVE_SOURCE_UNAVAILABLE/);
  assert.doesNotMatch(readFileSync(join(base, "monitor-state.json"), "utf8"), /token/);
});
