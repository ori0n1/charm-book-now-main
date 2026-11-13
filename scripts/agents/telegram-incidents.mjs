import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIncidentCoordinator, formatIncidentAlert,
  normalizeIncidentEvent } from "../../agents/telegram-gateway/incidents.mjs";

const dir = mkdtempSync(join(tmpdir(), "bellza-incidents-synthetic-"));
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const first = { monitorId: id(1), sourceRunId: id(1), kind: "NEW",
  code: "PUBLIC_PAGE_HTTP_ERROR", severity: "warning",
  studioCode: "CAPIVARA", path: "/s/capivara",
  observedAt: "2026-11-13T10:00:00Z",
  evidence: { source: "public", httpStatus: 503 } };
const coordinator = createIncidentCoordinator({ stateDir: dir,
  runCase: (testCase) => ({ file: testCase.file, state: "PASS",
    reason: "SYNTHETIC_FIXTURE", durationMs: 1 }) });
try {
  const base = { mode: "SYNTHETIC_SIMULATION", active: [],
    latest: { monitorId: id(1), observedAt: first.observedAt } };
  await coordinator.process({ ...base, events: [first] });
  await coordinator.process({ ...base, events: [first] });
  await coordinator.process({ ...base, events: [], active: [first],
    latest: { monitorId: id(2), observedAt: "2026-11-13T10:45:00Z" } });
  const recovered = { ...first, monitorId: id(3), sourceRunId: id(3),
    kind: "RECOVERED", severity: "info",
    observedAt: "2026-11-13T11:00:00Z" };
  await coordinator.process({ ...base, events: [recovered] });
  const state = coordinator.readState();
  const incident = state.incidents[0];
  const preview = state.outbox.map((item) => ({ kind: item.kind,
    text: formatIncidentAlert(incident,
      normalizeIncidentEvent(item.event)) }));
  process.stdout.write(`${JSON.stringify({ mode: "SYNTHETIC_SIMULATION",
    incidentId: incident.id, state: incident.state,
    cause: incident.steps.sherlock.findings[0]?.causeStatus ?? "NAO_DETERMINADA",
    tests: incident.steps.valida.status,
    forge: incident.steps.forge.status, patchApplied: false,
    guardiao: incident.steps.guardiao.status,
    preparedAlerts: preview, realMessagesSent: 0 }, null, 2)}\n`);
} finally { rmSync(dir, { recursive: true, force: true }); }
