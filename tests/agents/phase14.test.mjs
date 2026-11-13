import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync,
  writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chooseVisualTargets, scanVisualPages } from "../../agents/visual-probes.mjs";
import { runVisualCheck } from "../../agents/visual-flow.mjs";
import { runMonitorOnce } from "../../agents/monitor.mjs";
import { visualFixture } from "../../agents/visual-fixtures.mjs";
import { PUBLIC_PAGES } from "../../agents/public-probes.mjs";
import { publicFixture } from "../../agents/public-fixtures.mjs";
import { runPublicCheck } from "../../agents/public-flow.mjs";

const paths = ["/", "/login", "/s/capivarabarbearia", "/s/studio27braga",
  ...Array.from({ length: 25 }, (_, i) => `/blog/fixture-${i}`)];
const xml = (list = paths) => `<urlset>${list.map((path) =>
  `<url><loc>https://bellza.pt${path}</loc></url>`).join("")}</urlset>`;
const response = (body, status = 200, type = "application/xml") =>
  new Response(body, { status, headers: { "content-type": type } });
const unavailableBrowser = async () => { throw new Error("SYNTHETIC_BROWSER_UNAVAILABLE"); };
const isolated = async (fn) => {
  const dir = mkdtempSync(join(tmpdir(), "bellza-visual14-"));
  try { await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};
const validate = () => ({ agent: "valida", status: "APPROVED",
  tests: Array.from({ length: 7 }, () => ({ state: "PASS" })) });

test("40 páginas rodam em nove ciclos sem perder páginas prioritárias", () => {
  const seen = new Set();
  for (let cycle = 0; cycle < 9; cycle++) {
    const selected = chooseVisualTargets(xml(), cycle);
    assert.equal(selected.targets.length, 8);
    for (const path of paths.slice(0, 4))
      assert(selected.targets.some((item) => item.path === path));
    for (const item of selected.targets) seen.add(item.path);
  }
  assert.deepEqual([...seen].sort(), [...new Set([
    ...PUBLIC_PAGES.map((item) => item.path), ...paths])].sort());
});

test("sitemap distingue rede, HTTP e mudança; fallback fica desatualizado", async () => {
  const cache = { paths, observedAt: "2026-11-12T00:00:00.000Z" };
  for (const [fetchImpl, failure, httpStatus] of [
    [async () => { throw new Error("network"); }, "NETWORK_ERROR", null],
    [async () => response("offline", 503), "HTTP_ERROR", 503],
    [async () => response("<html>changed</html>"), "INVALID_SITEMAP", null],
  ]) {
    const result = await scanVisualPages({ fetchImpl, cachedSitemap: cache,
      browserLauncher: unavailableBrowser });
    assert.equal(result.sitemapStatus, "FALLBACK_STALE");
    assert.equal(result.sitemapFailure, failure);
    assert.equal(result.sitemapHttpStatus ?? null, httpStatus);
    assert.equal(result.selectedCount, 8);
    assert.equal(result.status, "BROWSER_UNAVAILABLE");
  }
  const noBaseline = await scanVisualPages({
    fetchImpl: async () => response("offline", 503),
    browserLauncher: unavailableBrowser });
  assert.equal(noBaseline.sitemapStatus, "NO_VALID_BASELINE");
  assert.equal(noBaseline.pages.length, 0);
  const changed = await scanVisualPages({
    fetchImpl: async () => response(xml([...paths, "/blog/new-public"])),
    cachedSitemap: cache, browserLauncher: unavailableBrowser });
  assert.equal(changed.sitemapStatus, "CHANGED");
  assert.equal(changed.sitemapSnapshot.paths.length, paths.length + 1);
});

test("falha transitória gera só um alerta após repetição e recuperação", async () => isolated(async (stateDir) => {
  const scan = (sitemapFailure) => async () => ({ status: "OBSERVED",
    pages: [], selectedCount: 0, discoveredCount: 40, requests: 1,
    sitemapStatus: sitemapFailure ? "FALLBACK_STALE" : "OK",
    sitemapFailure, sitemapSnapshot: sitemapFailure ? null :
      { paths, observedAt: "2026-11-13T00:00:00.000Z" } });
  const opts = { mode: "synthetic", stateDir, validate };
  await runVisualCheck({ ...opts, scan: scan(null) });
  const first = await runVisualCheck({ ...opts, scan: scan("NETWORK_ERROR") });
  const second = await runVisualCheck({ ...opts, scan: scan("NETWORK_ERROR") });
  const third = await runVisualCheck({ ...opts, scan: scan("NETWORK_ERROR") });
  const recovered = await runVisualCheck({ ...opts, scan: scan(null) });
  assert.equal(first.report.events.length, 0);
  assert.deepEqual(second.report.events.map((item) => item.kind), ["NEW"]);
  assert.equal(third.report.events.length, 0);
  assert.deepEqual(recovered.report.events.map((item) => item.kind), ["RECOVERED"]);
  const state = JSON.parse(readFileSync(join(stateDir, "visual-state.json"), "utf8"));
  assert.equal(state.sitemapFailureStreak, 0);
  assert.equal(state.sitemapCache.paths.length, paths.length);
}));

test("HTTP público reutiliza lista válida sem declarar cobertura completa", async () => isolated(async (stateDir) => {
  const source = publicFixture();
  const first = await runPublicCheck({ mode: "live", stateDir, fetchImpl: source,
    validate });
  const unavailable = (url, options) => new URL(url).pathname === "/sitemap.xml"
    ? Promise.resolve(response("offline", 503)) : source(url, options);
  const fallback = await runPublicCheck({ mode: "live", stateDir,
    fetchImpl: unavailable, validate });
  assert.equal(first.report.discoveryStatus, "OK");
  assert.equal(fallback.report.discoveryStatus, "FALLBACK_STALE");
  assert.equal(fallback.report.discoveryFailure, "HTTP_ERROR");
  assert.equal(fallback.report.sitemapHttpStatus, 503);
  assert.equal(fallback.report.expectedPages, first.report.expectedPages);
  assert.equal(fallback.report.coverageComplete, false);
  assert.equal(fallback.report.status, "INDETERMINADO");
  const state = JSON.parse(readFileSync(join(stateDir, "public-state.json"), "utf8"));
  assert.equal(state.sitemapFailureStreak, 1);
  assert(state.sitemapCache.paths.length > 0);
}));

test("Chromium indisponível e timeout ficam não verificáveis", async () => {
  const fixture = visualFixture();
  const blocked = await scanVisualPages({ ...fixture,
    browserLauncher: unavailableBrowser });
  assert.equal(blocked.status, "BROWSER_UNAVAILABLE");
  assert.equal(blocked.pages.length, 0);
  assert(blocked.peakNodeRssBytes > 0);
  const timed = await scanVisualPages({ ...fixture,
    targets: [{ path: "/", studioCode: "GLOBAL" }], maxDurationMs: 250,
    routeResponder: async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.fulfill({ status: 200, contentType: "text/html",
        body: "<main><h1>synthetic</h1></main>" }).catch(() => {});
    } });
  assert.equal(timed.status, "PARTIAL_LIMIT");
  assert(timed.pages.some((page) => page.status === "NOT_VERIFIABLE_LIMIT"));
  assert(timed.elapsedMs < 5_000);
});

test("Atlas preserva Cloudflare e HTTP quando visual falha; tarefa padrão segue sem visual", async () => isolated(async (stateDir) => {
  const options = { mode: "synthetic", stateDir, includePublic: true };
  const old = await runMonitorOnce(options);
  assert.equal(old.visualStatus, "DESATIVADO");
  const prepared = await runMonitorOnce({ ...options, includeVisual: true,
    visualCheck: async () => { throw new Error("SYNTHETIC_SECRET"); } });
  assert.equal(prepared.status, "ATENCAO");
  assert.equal(prepared.publicStatus, "PAGINAS_E_RECURSOS_OK");
  assert.equal(prepared.visualStatus, "INDETERMINADO");
  assert.equal(prepared.visualFailureCode, "VISUAL_CHECK_FAILED");
  assert.doesNotMatch(readFileSync(prepared.reportPath, "utf8"), /SYNTHETIC_SECRET/);
}));

test("Atlas bloqueia ciclo concorrente durante visual preparado", async () => isolated(async (stateDir) => {
  let release;
  const pending = runMonitorOnce({ mode: "synthetic", stateDir,
    includeVisual: true, visualCheck: () => new Promise((resolve) => { release = resolve; }) });
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(() => runMonitorOnce({ mode: "synthetic", stateDir }),
    { message: "MONITOR_CONFLICTING_RUN" });
  release({ id: "synthetic", reportPath: "synthetic", report: {
    status: "PARCIAL", pages: [], events: [] } });
  await pending;
}));

test("retenção visual remove apenas relatório antigo reconhecido", async () => isolated(async (stateDir) => {
  const oldId = randomUUID();
  const history = [oldId, ...Array.from({ length: 59 }, () => randomUUID())]
    .map((flowId) => ({ flowId }));
  writeFileSync(join(stateDir, "visual-state.json"), JSON.stringify({
    schema: 1, issues: [], history, alerts: [],
  }));
  const reports = join(stateDir, "visual-runs");
  mkdirSync(reports);
  writeFileSync(join(reports, `${oldId}.json`), JSON.stringify({ flowId: oldId,
    mode: "SYNTHETIC_SIMULATION" }));
  writeFileSync(join(reports, `${oldId}.md`), "synthetic");
  writeFileSync(join(reports, "unrelated.json"), "keep");
  await runVisualCheck({ mode: "synthetic", stateDir, validate,
    scan: async () => ({ status: "OBSERVED", sitemapStatus: "OK",
      sitemapFailure: null, pages: [], requests: 0 }) });
  assert.equal(existsSync(join(reports, `${oldId}.json`)), false);
  assert.equal(existsSync(join(reports, `${oldId}.md`)), false);
  assert.equal(readFileSync(join(reports, "unrelated.json"), "utf8"), "keep");
}));
