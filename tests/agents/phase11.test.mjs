import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertPublicRequest, classifyPublicSnapshot, parsePublicSitemap,
  probePublicPages } from "../../agents/public-probes.mjs";
import { publicFixture } from "../../agents/public-fixtures.mjs";
import { runPublicCheck } from "../../agents/public-flow.mjs";

const validation = () => ({ agent: "valida", status: "APPROVED",
  tests: Array.from({ length: 7 }, () => ({ state: "PASS" })) });
const isolated = async (fn) => {
  const dir = mkdtempSync(join(tmpdir(), "bellza-public-"));
  try { await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

test("barreira limita método, origem, páginas e assets descobertos", () => {
  const asset = "https://bellza.pt/assets/index-FAKE.js";
  assert.equal(assertPublicRequest("GET", "https://bellza.pt/s/studio27braga"), "page");
  assert.equal(assertPublicRequest("HEAD", asset, new Set(["/assets/index-FAKE.js"])), "asset");
  for (const [method, url, known] of [
    ["POST", "https://bellza.pt/"], ["GET", asset],
    ["HEAD", "https://bellza.pt/s/studio27braga"],
    ["GET", "https://bellza.pt/api/create-checkout-session"],
    ["GET", "https://bellza.pt/s/studio27braga?book=1"],
    ["GET", "https://evil.example/s/studio27braga"],
    ["HEAD", "https://bellza.pt/assets/other.js", new Set(["/assets/index-FAKE.js"])],
  ]) assert.throws(() => assertPublicRequest(method, url, known),
    { message: "PUBLIC_OPERATION_DENIED" });
});

test("sitemap descobre somente páginas públicas permitidas", () => {
  const parsed = parsePublicSitemap('<urlset>' +
    '<loc>https://bellza.pt/s/novo-estudio</loc>' +
    '<loc>https://bellza.pt/blog/artigo</loc>' +
    '<loc>https://bellza.pt/api/create-checkout-session</loc>' +
    '<loc>https://evil.example/s/estudio</loc>' +
    '</urlset>');
  assert.deepEqual(parsed.paths, ["/s/novo-estudio", "/blog/artigo"]);
  assert.equal(parsed.rejected, 2);
  assert.equal(assertPublicRequest("GET", "https://bellza.pt/s/novo-estudio",
    new Set(), new Set(parsed.paths)), "page");
  assert.throws(() => assertPublicRequest("GET", "https://bellza.pt/s/novo-estudio"),
    { message: "PUBLIC_OPERATION_DENIED" });
});

test("sitemap indisponível não permite declarar cobertura pública completa", async () => isolated(async (stateDir) => {
  const fixture = publicFixture("healthy");
  const result = await runPublicCheck({ mode: "live", stateDir, validate: validation,
    fetchImpl: (url, options) => new URL(url).pathname === "/sitemap.xml"
      ? Promise.resolve(new Response("", { status: 503 })) : fixture(url, options) });
  assert.equal(result.report.discoveryStatus, "SITEMAP_UNAVAILABLE");
  assert.equal(result.report.coverageComplete, false);
  assert.equal(result.report.status, "INDETERMINADO");
  assert(result.report.pages.some((page) => page.path === "/s/capivarabarbearia"));
  assert(result.report.pages.some((page) => page.path === "/s/studio27braga"));
}));

test("Sentinela usa só GET/HEAD, não guarda HTML e não declara agenda operacional", async () => {
  const seen = [];
  const fixture = publicFixture("healthy");
  const snapshot = await probePublicPages({ fetchImpl: async (url, options) => {
    seen.push([options.method, new URL(url).pathname]);
    return fixture(url, options);
  } });
  assert(snapshot.requests > snapshot.checkedPages);
  assert(snapshot.requests <= 90);
  assert.equal(snapshot.checkedPages, 17);
  assert.equal(snapshot.expectedPages, 17);
  assert.equal(snapshot.discoveryStatus, "OK");
  assert(snapshot.pages.some((page) => page.path === "/s/outroestudio"));
  assert(snapshot.pages.some((page) => page.path === "/blog/post-sintetico"));
  assert.equal(snapshot.agendaInteractivity, "NAO_VERIFICAVEL");
  assert(snapshot.pages.every((page) => page.complete));
  assert.deepEqual(classifyPublicSnapshot(snapshot), []);
  assert(seen.every(([method]) => ["GET", "HEAD"].includes(method)));
  assert(!JSON.stringify(snapshot).includes("SYNTHETIC_PRIVATE_MARKER"));
});

test("falha de Studio 27 é isolada, deduplicada e recuperação é registada", async () => isolated(async (stateDir) => {
  const first = await runPublicCheck({ mode: "synthetic", scenario: "studio-failure",
    stateDir, validate: validation });
  const second = await runPublicCheck({ mode: "synthetic", scenario: "studio-failure",
    stateDir, validate: validation });
  const recovered = await runPublicCheck({ mode: "synthetic", scenario: "healthy",
    stateDir, validate: validation });
  assert.equal(first.report.anomalies.length, 1);
  assert.deepEqual(first.report.anomalies[0].studioCode, "STUDIO_27");
  assert.deepEqual(first.report.anomalies[0].scope, "STUDIO_SPECIFIC");
  assert.deepEqual(first.report.events.map((event) => event.kind), ["NEW"]);
  assert.equal(second.report.events.length, 0);
  assert.deepEqual(recovered.report.events.map((event) => event.kind), ["RECOVERED"]);
  assert.equal(first.report.steps.length, 5);
  assert.equal(first.report.steps[4].agent, "guardiao");
  assert.equal(first.report.steps[4].dependencies.length, 4);
  assert.equal(first.report.opinion, "INDETERMINADO");
  assert.equal(first.report.remoteWrites, false);
  assert(!readFileSync(first.reportPath, "utf8").includes("SYNTHETIC_PRIVATE_MARKER"));
}));

test("recurso JS ausente afeta ambos os estúdios sem provar causa", async () => isolated(async (stateDir) => {
  const result = await runPublicCheck({ mode: "synthetic", scenario: "resource-failure",
    stateDir, validate: validation });
  assert.equal(result.report.anomalies.length, 3);
  assert(result.report.anomalies.every((item) => item.code === "PUBLIC_RESOURCE_FAILED"));
  assert(result.report.anomalies.every((item) => item.scope === "MULTI_STUDIO"));
  assert.equal(result.report.proposalSummary, "plano de investigação não aplicado");
  assert.equal(result.report.publicationAuthorized, false);
}));

test("falha de rede não gera recuperação indevida", async () => isolated(async (stateDir) => {
  await runPublicCheck({ mode: "synthetic", scenario: "studio-failure",
    stateDir, validate: validation });
  const uncertain = await runPublicCheck({ mode: "synthetic", scenario: "network-failure",
    stateDir, validate: validation });
  assert(uncertain.report.events.some((item) => item.kind === "NEW"));
  assert(!uncertain.report.events.some((item) => item.kind === "RECOVERED"));
  assert.equal(uncertain.report.agendaInteractivity, "NAO_VERIFICAVEL");
}));

test("Atlas bloqueia execução simultânea pelo lock local", async () => isolated(async (stateDir) => {
  writeFileSync(join(stateDir, "atlas.lock"), JSON.stringify({ id: "other-run" }));
  await assert.rejects(() => runPublicCheck({ mode: "synthetic", stateDir,
    validate: validation }), { code: "CONFLICTING_RUN_ACTIVE" });
}));
