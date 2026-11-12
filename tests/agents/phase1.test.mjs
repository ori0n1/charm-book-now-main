import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  AgentPolicyError,
  PUBLIC_URLS,
  SCRIPT_PATH,
  assertAllowedOperation,
  createBudget,
} from "../../agents/policy.mjs";
import { createReadOnlyTransport, readOAuthToken } from "../../agents/transport.mjs";
import { loadReference, runSentinela, formatSentinelaReport } from "../../agents/sentinela.mjs";
import { atlasStatus, runAtlas } from "../../agents/atlas.mjs";

const base = `https://api.cloudflare.com${SCRIPT_PATH}`;
const reference = loadReference();
const bindings = [
  ...reference.plainNames.map((name) => ({ name, type: "plain_text", text: "SYNTHETIC_SECRET_MUST_NOT_APPEAR" })),
  ...reference.secretNames.map((name) => ({ name, type: "secret_text" })),
];
const jsonResponse = (result, status = 200) => new Response(
  JSON.stringify({ success: true, result }),
  { status, headers: { "content-type": "application/json" } },
);

function syntheticFetch({ authStatus } = {}) {
  return async (url, options) => {
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "manual");
    if (PUBLIC_URLS.includes(url)) return new Response("", { status: 200 });
    if (authStatus) return new Response("", { status: authStatus });
    if (url === `${base}/deployments`) {
      return jsonResponse({ deployments: [{ versions: [{ version_id: reference.observedVersion, percentage: 100 }] }] });
    }
    if (url === `${base}/versions/${reference.observedVersion}`) {
      return jsonResponse({
        id: reference.observedVersion,
        metadata: { created_on: "2026-11-12T11:28:41Z" },
        resources: { bindings, script_runtime: reference.runtime },
      });
    }
    if (url === `${base}/settings`) return jsonResponse({ bindings });
    if (url === `${base}/schedules`) {
      return jsonResponse({ schedules: reference.crons.map((cron) => ({ cron })) });
    }
    throw new Error("unexpected_synthetic_url");
  };
}

test("barreira permite apenas GET aos caminhos Cloudflare e públicos fixos", async () => {
  assert.equal(assertAllowedOperation("GET", `${base}/deployments`), "cloudflare");
  assert.equal(assertAllowedOperation("GET", PUBLIC_URLS[0]), "public");
  for (const [method, url] of [
    ["POST", `${base}/deployments`],
    ["DELETE", `${base}/versions/${reference.observedVersion}`],
    ["GET", `${base}/secrets`],
    ["GET", "https://bellza.pt/s/studio27braga"],
    ["GET", `${base}/deployments?foo=bar`],
    ["GET", "https://api.cloudflare.com/client/v4/accounts/other/workers/scripts/tanstack-start-app/deployments"],
  ]) {
    assert.throws(() => assertAllowedOperation(method, url), { code: "OPERATION_DENIED" });
  }
  const budget = createBudget({ maxCloudflareRequests: 1, maxPublicRequests: 0 });
  budget.consume("cloudflare");
  assert.throws(() => budget.consume("cloudflare"), { code: "BUDGET_EXCEEDED" });
  assert.throws(() => budget.consume("public"), { code: "BUDGET_EXCEEDED" });
});

test("Sentinela verifica metadados sintéticos e não expõe valores", async () => {
  const budget = createBudget();
  const transport = createReadOnlyTransport({
    fetchImpl: syntheticFetch(),
    tokenProvider: () => "SYNTHETIC_OAUTH_TOKEN_MUST_NOT_APPEAR",
    budget,
  });
  const report = await runSentinela({ reference, transport, now: () => new Date("2026-11-12T12:40:00Z") });
  assert.equal(report.status, "ATENCAO");
  assert.deepEqual(report.checks.filter((check) => check.status === "PASS").map((check) => check.name),
    ["cloudflare_traffic", "bindings", "runtime", "script_settings", "crons", "public_endpoint", "public_endpoint"]);
  assert.equal(report.integrations.length, 5);
  assert.equal(report.observed.activeVersion, reference.observedVersion);
  assert.equal(report.observed.bindings.length,
    reference.plainNames.length + reference.secretNames.length);
  assert.deepEqual(report.observed.bindingDiff, { missing: [], unexpected: [] });
  assert.deepEqual(report.observed.crons, [...reference.crons].sort());
  assert.deepEqual(report.usage, { cloudflare: 4, public: 2, maxCloudflareRequests: 4, maxPublicRequests: 2 });
  const output = JSON.stringify(report) + formatSentinelaReport(report);
  assert.doesNotMatch(output, /SYNTHETIC_SECRET_MUST_NOT_APPEAR|SYNTHETIC_OAUTH_TOKEN_MUST_NOT_APPEAR/);
  assert.match(output, /OFFICIAL_RECORD_OUTDATED/);
});

test("falha de OAuth produz indisponibilidade explícita e mantém checks públicos", async () => {
  assert.throws(() => readOAuthToken({ appData: "", readFile: () => "" }), { code: "AUTH_UNAVAILABLE" });
  const transport = createReadOnlyTransport({
    fetchImpl: syntheticFetch(),
    tokenProvider: () => { throw new AgentPolicyError("AUTH_UNAVAILABLE"); },
  });
  const report = await runSentinela({ reference, transport });
  assert.equal(report.status, "INDETERMINADO");
  assert.ok(report.anomalies.some((item) => item.code === "AUTH_UNAVAILABLE"));
  assert.ok(!report.anomalies.some((item) => item.code === "OFFICIAL_RECORD_OUTDATED"));
  assert.equal(report.observed.activeVersion, null);
  assert.equal(report.checks.filter((item) => item.name === "public_endpoint" && item.status === "PASS").length, 2);
});

test("versão posterior é referência desatualizada, não defeito confirmado", async () => {
  const oldReference = { ...reference, observedVersion: "2aab3166-5ff6-4803-868e-8f36303fc81c", observedAt: "2026-11-07T00:00:00Z" };
  const transport = createReadOnlyTransport({ fetchImpl: syntheticFetch(), tokenProvider: () => "synthetic" });
  const report = await runSentinela({ reference: oldReference, transport });
  assert.ok(report.anomalies.some((item) => item.code === "REFERENCE_OUTDATED"));
  assert.ok(!report.anomalies.some((item) => item.code === "BINDINGS_DIVERGENCE_CONFIRMED"));
});

function tempState(t) {
  const dir = mkdtempSync(join(tmpdir(), "bellza-agents-test-"));
  t.after(() => {
    const actual = realpathSync(dir);
    const expectedRoot = realpathSync(tmpdir());
    assert.ok(actual.startsWith(expectedRoot + (process.platform === "win32" ? "\\" : "/")));
    rmSync(actual, { recursive: true, force: true });
  });
  return dir;
}

const childReport = {
  agent: "sentinela",
  observedAt: "2026-11-12T12:40:00Z",
  status: "OK",
  reference: { observedVersion: "indisponivel", officialRecordedVersion: "indisponivel" },
  checks: [],
  anomalies: [],
  recommendations: ["SYNTHETIC_SECRET_MUST_NOT_APPEAR"],
  usage: { cloudflare: 0, public: 0 },
  leak: "SYNTHETIC_SECRET_MUST_NOT_APPEAR",
};

test("Atlas bloqueia concorrência e grava apenas histórico sanitizado", async (t) => {
  const stateDir = tempState(t);
  const script = `setTimeout(() => process.stdout.write(JSON.stringify(${JSON.stringify(childReport)})), 300)`;
  const first = runAtlas({ stateDir, childArgs: ["-e", script] });
  for (let index = 0; index < 50 && !existsSync(join(stateDir, "atlas.lock")); index++) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  await assert.rejects(() => runAtlas({ stateDir, childArgs: ["-e", script] }), { code: "CONFLICTING_RUN_ACTIVE" });
  const result = await first;
  assert.equal(result.status, "OK");
  assert.equal(atlasStatus(stateDir).running, null);
  const saved = readFileSync(join(stateDir, "runs", `${result.id}.json`), "utf8") +
    readFileSync(join(stateDir, "latest.md"), "utf8") +
    readFileSync(join(stateDir, "history.jsonl"), "utf8");
  assert.doesNotMatch(saved, /SYNTHETIC_SECRET_MUST_NOT_APPEAR/);
  assert.match(saved, /COMPLETED/);
});

test("Atlas limita duração e recusa agentes não ativados", async (t) => {
  const stateDir = tempState(t);
  await assert.rejects(() => runAtlas({ agent: "correcao", stateDir }), { code: "AGENT_NOT_ENABLED" });
  const result = await runAtlas({
    stateDir,
    childArgs: ["-e", "setTimeout(() => {}, 5000)"],
    maxDurationMs: 100,
  });
  assert.equal(result.status, "INDETERMINADO");
  assert.ok(result.report.anomalies.some((item) => item.code === "DURATION_EXCEEDED"));
});

test("Atlas recusa valores de bindings disfarçados como nomes", async (t) => {
  const stateDir = tempState(t);
  const injected = { ...childReport, observed: {
    activeVersion: null,
    bindings: ["SECRET_KEY:secret_text:VALUE_MUST_NOT_APPEAR"],
    bindingDiff: { missing: [], unexpected: [] }, runtime: null, crons: null,
  } };
  const result = await runAtlas({ stateDir,
    childArgs: ["-e", `process.stdout.write(JSON.stringify(${JSON.stringify(injected)}))`],
  });
  assert.equal(result.status, "INDETERMINADO");
  assert.ok(result.report.anomalies.some((item) => item.code === "INVALID_AGENT_REPORT"));
  assert.doesNotMatch(readFileSync(result.reportPath, "utf8"), /VALUE_MUST_NOT_APPEAR/);
});
