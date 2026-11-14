import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allowBrowserRequest, chooseVisualTargets, scanVisualPages,
  classifyVisualObservation } from "../../agents/visual-probes.mjs";
import { visualFixture } from "../../agents/visual-fixtures.mjs";
import { runVisualCheck } from "../../agents/visual-flow.mjs";

const isolated = async (fn) => {
  const dir = mkdtempSync(join(tmpdir(), "bellza-visual-"));
  try { await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};
const validate = () => ({ agent: "valida", status: "APPROVED",
  tests: Array.from({ length: 7 }, () => ({ state: "PASS" })) });

test("barreira do navegador só permite GET/HEAD públicos definidos", () => {
  const selected = new Set(["/", "/login"]);
  assert.equal(allowBrowserRequest("GET", "https://bellza.pt/", selected), "page");
  assert.equal(allowBrowserRequest("GET", "https://bellza.pt/assets/app.js", selected), "asset");
  for (const [method, url] of [
    ["POST", "https://bellza.pt/login"],
    ["GET", "https://bellza.pt/api/create-checkout-session"],
    ["GET", "https://bellza.pt/s/studio27braga"],
    ["GET", "https://evil.example/assets/app.js"],
    ["GET", "https://bellza.pt/login?token=secret"],
    ["GET", "https://bellza.pt/assets/app.js?x=1"],
  ]) assert.equal(allowBrowserRequest(method, url, selected), null);
});

test("pedido visual abortado pelo monitor é cobertura inconclusiva", () => {
  const issues = classifyVisualObservation({ path: "/s/studio27braga",
    studioCode: "STUDIO_27", viewport: "mobile", httpStatus: 200,
    status: "OBSERVED", dom: { mainVisible: true, hasHeading: true },
    requestFailures: 1, monitorFetchFailures: 1, assetFailures: [],
    jsErrors: [], blockedRequests: 0 });
  assert.deepEqual(issues.map((item) => item.code), ["VISUAL_REQUEST_FAILED"]);
  assert.equal(issues[0].scope, "MONITOR_COVERAGE");
  assert.equal(issues[0].evidence.monitorFetchFailures, 1);
});

test("relatório visual não apresenta falha do monitor como falha da aplicação", async () => isolated(async (stateDir) => {
  const issue = { path: "/", studioCode: "GLOBAL", viewport: "desktop",
    code: "VISUAL_REQUEST_FAILED", severity: "warning",
    scope: "MONITOR_COVERAGE", evidence: { count: 1,
      monitorFetchFailures: 1 } };
  const scan = async () => ({ status: "OBSERVED", sitemapStatus: "OK",
    pages: [{ path: "/", studioCode: "GLOBAL", viewport: "desktop",
      status: "OBSERVED", coverage: "OBSERVED", blockedRequests: 0,
      issues: [issue] }], requests: 2 });
  const { report } = await runVisualCheck({ mode: "synthetic", stateDir,
    scan, validate });
  assert.equal(report.status, "PARCIAL");
  assert.equal(report.issues[0].scope, "MONITOR_COVERAGE");
  assert.equal(report.remoteWrites, false);
}));

test("alvos visuais reutilizam sitemap e páginas fixas da Sentinela", async () => {
  const fixture = visualFixture();
  const xml = await (await fixture.fetchImpl("https://bellza.pt/sitemap.xml",
    { method: "GET" })).text();
  const selection = chooseVisualTargets(xml);
  assert.equal(selection.targets.length, 8);
  assert(selection.targets.some((item) => item.path === "/s/capivarabarbearia"));
  assert(selection.targets.some((item) => item.path === "/s/studio27braga"));
  assert.equal(selection.rejectedUrls, 0);
});

test("Chromium identifica falhas após HTTP 200 e indisponibilidade", async () => {
  const expected = {
    healthy: null,
    "js-error": "VISUAL_JS_UNHANDLED",
    "missing-main": "VISUAL_MAIN_MISSING",
    "asset-404": "VISUAL_ASSET_FAILED",
    offline: "VISUAL_PAGE_UNAVAILABLE",
    "mobile-overflow": "VISUAL_HORIZONTAL_OVERFLOW",
  };
  for (const [scenario, code] of Object.entries(expected)) {
    const result = await scanVisualPages({ ...visualFixture(scenario),
      targets: [{ path: "/", studioCode: "GLOBAL" }] });
    assert.equal(result.pages.length, 2);
    const actual = result.pages.flatMap((page) => page.issues).map((item) => item.code);
    if (code) assert(actual.includes(code), `${scenario}: ${actual.join(",")}`);
    else assert.deepEqual(actual, []);
    if (scenario === "js-error") {
      assert.equal(result.pages[0].httpStatus, 200);
      assert(!JSON.stringify(result).includes("SYNTHETIC_ONLY"));
    }
  }
});

test("Atlas deduplica falha visual e registra recuperação com seis agentes", async () => isolated(async (stateDir) => {
  const issue = { path: "/", studioCode: "GLOBAL", viewport: "desktop",
    code: "VISUAL_JS_UNHANDLED", severity: "critical", scope: "PUBLIC_PAGE",
    evidence: { errorName: "Error", fingerprint: "abc123" } };
  const fakeScan = (withIssue) => async () => ({ status: "OBSERVED",
    discoveredCount: 15, selectedCount: 1, requests: 2,
    pages: [{ path: "/", studioCode: "GLOBAL", viewport: "desktop",
      status: "OBSERVED", coverage: "OBSERVED", httpStatus: 200,
      blockedRequests: 0, dom: { mainVisible: true, hasHeading: true },
      jsErrors: [], assetFailures: [], issues: withIssue ? [issue] : [] }] });
  const options = { mode: "synthetic", stateDir, validate };
  const first = await runVisualCheck({ ...options, scan: fakeScan(true) });
  const repeat = await runVisualCheck({ ...options, scan: fakeScan(true) });
  const recovered = await runVisualCheck({ ...options, scan: fakeScan(false) });
  assert.deepEqual(first.report.events.map((event) => event.kind), ["NEW"]);
  assert.equal(repeat.report.events.length, 0);
  assert.deepEqual(recovered.report.events.map((event) => event.kind), ["RECOVERED"]);
  assert.equal(first.report.sherlockStatus, "DIAGNOSTICADO");
  assert.equal(first.report.forgeStatus, "PROPOSTA_DE_INVESTIGACAO");
  assert.equal(first.report.guardiaoStatus, "INDETERMINADO");
  assert.equal(first.report.remoteWrites, false);
  assert(!readFileSync(first.reportPath, "utf8").includes("abc123"));
}));

test("Atlas bloqueia execução visual concorrente", async () => isolated(async (stateDir) => {
  writeFileSync(join(stateDir, "atlas.lock"), JSON.stringify({ id: "other" }));
  await assert.rejects(() => runVisualCheck({ mode: "synthetic", stateDir,
    validate }), { code: "CONFLICTING_RUN_ACTIVE" });
}));
