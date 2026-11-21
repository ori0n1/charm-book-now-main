import assert from "node:assert/strict";
import { test } from "node:test";
import { QA_IDENTITIES, signInQa } from "../../agents/qa/auth-session.mjs";
import { readQaIsolation } from "../../agents/qa/rls-read.mjs";
import { createQaReadExecutor } from "../../agents/qa/read-executor.mjs";

const KEY = "sb_publishable_synthetic_only";
const jwt = (studioCode, role = "authenticated") =>
  `e30.${Buffer.from(JSON.stringify({ sub: QA_IDENTITIES[studioCode].userId,
    role })).toString("base64url")}.c2ln`;
const fixture = (studioCode, domain = "agenda") => ({ studioCode, domain,
  source: "RLS_AGGREGATE_READ", observedAt: "2026-11-16T12:00:00.000Z",
  windowMinutes: 30, coverage: "PARTIAL", metrics: domain === "agenda"
    ? { loadErrors: null, queryErrors: 0, availabilityMismatches: null,
      availableSlots: null }
    : { stateInconsistencies: null, processingFailures: null, observedCount: 1 } });

test("QA Auth usa apenas a identidade prevista e não devolve senha", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method, redirect: options.redirect,
      body: options.body });
    return url.endsWith("/auth/v1/user")
      ? Response.json({ id: QA_IDENTITIES.STUDIO_QA_B.userId,
        role: "authenticated" })
      : Response.json({ access_token: jwt("STUDIO_QA_B"), expires_in: 120 });
  };
  const session = await signInQa({ studioCode: "STUDIO_QA_B",
    password: "synthetic-password-only", publishableKey: KEY, fetchImpl });
  assert.equal(session.userId, QA_IDENTITIES.STUDIO_QA_B.userId);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[1].method, "GET");
  assert.ok(calls.every((call) => call.redirect === "manual"));
  assert.equal(JSON.parse(calls[0].body).email, QA_IDENTITIES.STUDIO_QA_B.email);
  assert.doesNotMatch(JSON.stringify({ studioCode: session.studioCode,
    userId: session.userId }), /password|token/i);
});

test("QA Auth rejeita token de outra identidade e autenticação falhada", async () => {
  await assert.rejects(signInQa({ studioCode: "STUDIO_QA_A",
    password: "synthetic-password-only", publishableKey: KEY,
    fetchImpl: async () => Response.json({ access_token: jwt("STUDIO_QA_B"),
      expires_in: 120 }) }), /QA_AUTH_DENIED/);
  await assert.rejects(signInQa({ studioCode: "STUDIO_QA_A",
    password: "synthetic-password-only", publishableKey: KEY,
    fetchImpl: async () => Response.json({}, { status: 401 }) }), /QA_AUTH_DENIED/);
});

test("senhas QA legadas só entram pelo opt-in do cofre; novas continuam com mínimo 12", async () => {
  const shortPassword = "qaLegacy8";
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    return url.endsWith("/auth/v1/user")
      ? Response.json({ id: QA_IDENTITIES.STUDIO_QA_A.userId, role: "authenticated" })
      : Response.json({ access_token: jwt("STUDIO_QA_A"), expires_in: 120 });
  };
  await assert.rejects(signInQa({ studioCode: "STUDIO_QA_A",
    password: shortPassword, publishableKey: KEY, fetchImpl }), /QA_AUTH_CONFIG_INVALID/);
  assert.equal(calls, 0);
  const session = await signInQa({ studioCode: "STUDIO_QA_A",
    password: shortPassword, publishableKey: KEY, legacyVaultPassword: true, fetchImpl });
  assert.equal(session.userId, QA_IDENTITIES.STUDIO_QA_A.userId);
  assert.equal(calls, 2);
  await assert.rejects(signInQa({ studioCode: "STUDIO_QA_A",
    password: "short7!", publishableKey: KEY, legacyVaultPassword: true,
    fetchImpl }), /QA_AUTH_CONFIG_INVALID/);
  assert.equal(calls, 2);
});

test("leitura RLS QA usa apenas HEAD autenticado e recusa resultados cruzados", async () => {
  const seen = [];
  const fetchImpl = async (url, options) => {
    seen.push({ url: String(url), method: options.method });
    const own = String(url).includes(QA_IDENTITIES.STUDIO_QA_B.studioId);
    return new Response(null, { status: 200,
      headers: { "content-range": own ? "0-0/1" : "*/0" } });
  };
  const result = await readQaIsolation({ studioCode: "STUDIO_QA_B",
    accessToken: "synthetic-jwt", publishableKey: KEY, fetchImpl });
  assert.deepEqual(result, { ownRoles: 1, foreignRoles: 0, foreignAppointments: 0 });
  assert.equal(seen.length, 3);
  assert.ok(seen.every((call) => call.method === "HEAD" &&
    call.url.startsWith("https://pwmdzpvnatrvfpgcvnzg.supabase.co/rest/v1/")));
  await assert.rejects(readQaIsolation({ studioCode: "STUDIO_QA_B",
    accessToken: "synthetic-jwt", publishableKey: KEY,
    fetchImpl: async () => new Response(null, { status: 200,
      headers: { "content-range": "0-0/1" } }) }), /QA_RLS_ISOLATION_FAILED/);
});

test("executor não aceita estúdios reais, escrita nem leitura sem prova", async () => {
  const executor = createQaReadExecutor();
  assert.deepEqual(executor.capabilities().writeOperations, []);
  await assert.rejects(executor.run({ studioCode: "STUDIO_27", operation: "agenda" }),
    /QA_OPERATION_DENIED/);
  await assert.rejects(executor.run({ studioCode: "STUDIO_QA_A", operation: "insert" }),
    /QA_OPERATION_DENIED/);
  await assert.rejects(executor.run({ studioCode: "STUDIO_QA_A", operation: "agenda" }),
    /QA_RLS_PROOF_PENDING/);
});

test("executor preserva código QA, valida agregado e bloqueia concorrência", async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const source = { kind: "PREPARED_POSTGREST_RLS_GET",
    status: () => "PROOF_SUPPLIED_NOT_LIVE_VALIDATED",
    read: async () => pending };
  const executor = createQaReadExecutor({
    sources: new Map([["STUDIO_QA_A", source]]), enableLiveRead: true,
    now: () => new Date("2026-11-16T12:01:00Z") });
  const first = executor.run({ studioCode: "STUDIO_QA_A", operation: "agenda" });
  await assert.rejects(executor.run({ studioCode: "STUDIO_QA_A", operation: "agenda" }),
    /QA_BUSY/);
  finish(fixture("STUDIO_QA_A"));
  const result = await first;
  assert.equal(result.coverage, "PARTIAL");
  assert.equal(result.studioCode, "STUDIO_QA_A");
  assert.doesNotMatch(JSON.stringify(result), /client|email|phone|token|secret/i);
  const crossed = createQaReadExecutor({
    sources: new Map([["STUDIO_QA_A", { ...source,
      read: async () => fixture("STUDIO_QA_B") }]]), enableLiveRead: true });
  await assert.rejects(crossed.run({ studioCode: "STUDIO_QA_A", operation: "agenda" }),
    /PRIVATE_API_UNSAFE_RESULT/);
});

test("fonte que ignora timeout mantém bloqueio até terminar", async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const source = { kind: "PREPARED_POSTGREST_RLS_GET",
    status: () => "PROOF_SUPPLIED_NOT_LIVE_VALIDATED",
    read: async () => pending };
  const executor = createQaReadExecutor({
    sources: new Map([["STUDIO_QA_B", source]]), enableLiveRead: true });
  await assert.rejects(executor.run({ studioCode: "STUDIO_QA_B", operation: "agenda" }),
    /QA_TIMEOUT/);
  await assert.rejects(executor.run({ studioCode: "STUDIO_QA_B", operation: "agenda" }),
    /QA_BUSY/);
  finish(fixture("STUDIO_QA_B"));
  await new Promise((resolve) => setImmediate(resolve));
});
