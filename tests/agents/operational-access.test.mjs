import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyNoninteractiveReadOnlyOAuth } from "../../agents/monitor-auth.mjs";
import { createReadOnlyTransport } from "../../agents/transport.mjs";
import { SCRIPT_PATH } from "../../agents/policy.mjs";
import { assessLocalAccess } from "../../agents/access-status.mjs";
import { normalizeIncidentEvent } from "../../agents/telegram-gateway/incidents.mjs";

const now = new Date("2026-11-14T00:00:00Z");
const runId = "00000000-0000-4000-8000-000000000027";
const oauth = (expiration) => ({ status: "READ_ONLY_SCOPES", expiration });

test("OAuth distingue renovação pendente e validade insuficiente sem expor tokens", () => {
  assert.deepEqual(verifyNoninteractiveReadOnlyOAuth({
    inspect: () => oauth("2026-11-13T23:00:00Z"),
    whoami: () => false, now: () => now }),
  { status: "AUTH_REFRESH_UNAVAILABLE" });
  assert.deepEqual(verifyNoninteractiveReadOnlyOAuth({
    inspect: () => oauth("2026-11-14T02:00:00Z"),
    whoami: () => false, now: () => now }),
  { status: "AUTH_CHECK_UNAVAILABLE" });
  assert.deepEqual(verifyNoninteractiveReadOnlyOAuth({
    inspect: () => oauth("2026-11-14T00:01:00Z"),
    whoami: () => true, now: () => now }),
  { status: "AUTH_EXPIRED" });
});

test("transporte de leitura distingue rate limit, rota ausente e erro de servidor", async () => {
  for (const [status, code] of [
    [401, "AUTH_REJECTED"], [429, "CLOUDFLARE_RATE_LIMITED"],
    [404, "CLOUDFLARE_ENDPOINT_NOT_FOUND"],
    [503, "CLOUDFLARE_API_UNAVAILABLE"],
  ]) {
    const transport = createReadOnlyTransport({
      tokenProvider: () => "SYNTHETIC",
      fetchImpl: async (_url, options) => {
        assert.equal(options.method, "GET");
        return new Response("", { status });
      },
    });
    await assert.rejects(transport.request("GET",
      `https://api.cloudflare.com${SCRIPT_PATH}/deployments`),
    { code });
  }
});

test("estado persistente só declara leitura recente com relatório válido", () => {
  const read = (path) => path.endsWith("monitor-state.json")
    ? { journal: [{ mode: "LIVE_READ_ONLY", sentinelaRunId: runId,
      at: "2026-11-13T23:40:00Z" }] }
    : { agent: "sentinela", runId,
      checks: [{ name: "cloudflare_traffic", status: "PASS" }],
      observed: { activeVersion: runId } };
  const ready = assessLocalAccess({ monitorStateDir: "synthetic",
    oauth: oauth("2026-11-14T02:00:00Z"), now, read });
  assert.equal(ready.cloudflare.status, "OPERACIONAL_RECENTE");
  assert.equal(ready.supabase.status, "BLOQUEADO");
  assert.equal(ready.stripe.status, "BLOQUEADO");
  const stale = assessLocalAccess({ monitorStateDir: "synthetic",
    oauth: oauth("2026-11-14T06:00:00Z"),
    now: new Date("2026-11-14T03:00:00Z"), read });
  assert.equal(stale.cloudflare.reason, "LAST_REPORT_STALE");
  const expired = assessLocalAccess({ monitorStateDir: "synthetic",
    oauth: oauth("2026-11-13T23:00:00Z"), now, read });
  assert.equal(expired.cloudflare.reason, "AUTH_REFRESH_NEEDED");
});

test("falha do monitor continua classificada como acesso, sem diagnóstico da aplicação", () => {
  const event = normalizeIncidentEvent({ monitorId: runId, kind: "NEW",
    code: "CLOUDFLARE_RATE_LIMITED", severity: "warning",
    studioCode: "GLOBAL", observedAt: now.toISOString(),
    evidence: { source: "cloudflare" } });
  assert(event);
  assert.equal(event.code, "CLOUDFLARE_RATE_LIMITED");
  assert.equal(event.studioCode, "GLOBAL");
});
