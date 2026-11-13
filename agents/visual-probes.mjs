import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { PUBLIC_PAGES, parsePublicSitemap } from "./public-probes.mjs";

const ORIGIN = "https://bellza.pt";
const ASSET = /^\/assets\/[A-Za-z0-9_.-]+\.(?:js|css|svg|png|jpe?g|webp|avif|woff2?)$/;
const PRIORITY = ["/", "/login", "/signup", "/forgot-password", "/blog",
  "/contacto", "/s/capivarabarbearia", "/s/studio27braga"];
const MOBILE = new Set(["/", "/login", "/s/capivarabarbearia", "/s/studio27braga"]);
const VIEWPORTS = Object.freeze({ desktop: { width: 1366, height: 768 },
  mobile: { width: 390, height: 844 } });
const MAX_REQUESTS = 350;
const MAX_DURATION_MS = 110_000;

export function chooseVisualTargets(sitemapXml) {
  const discovered = parsePublicSitemap(sitemapXml);
  const known = new Map(PUBLIC_PAGES.map((item) => [item.path, item]));
  for (const path of discovered.paths) if (!known.has(path)) {
    known.set(path, { path, studioCode: path.startsWith("/s/")
      ? `STUDIO:${path.slice(3)}` : "GLOBAL" });
  }
  return { targets: PRIORITY.map((path) => known.get(path)).filter(Boolean),
    discoveredCount: known.size, sitemapUrls: discovered.paths.length,
    rejectedUrls: discovered.rejected };
}

export function allowBrowserRequest(method, url, selectedPaths) {
  if (method !== "GET" && method !== "HEAD") return null;
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.origin !== ORIGIN || parsed.username || parsed.password ||
      parsed.search || parsed.hash) return null;
  if (method === "GET" && selectedPaths.has(parsed.pathname)) return "page";
  if (ASSET.test(parsed.pathname)) return "asset";
  return null;
}

function safeError(error) {
  const message = String(error?.message ?? "");
  const name = ["TypeError", "ReferenceError", "SyntaxError", "RangeError",
    "Error"].includes(error?.name) ? error.name : "Error";
  return { name, fingerprint: createHash("sha256").update(message).digest("hex").slice(0, 12),
    networkLike: /Failed to fetch|NetworkError|ERR_FAILED|Load failed|fetch failed/i.test(message) };
}

export function classifyVisualObservation(observation) {
  const issues = [];
  const add = (code, severity, evidence = {}) => issues.push({
    studioCode: observation.studioCode, path: observation.path,
    viewport: observation.viewport, code, severity,
    scope: observation.path.startsWith("/s/") ? "STUDIO_SPECIFIC" : "PUBLIC_PAGE",
    evidence,
  });
  if (observation.httpStatus !== null && observation.httpStatus >= 400)
    add("VISUAL_PAGE_UNAVAILABLE", "critical", { httpStatus: observation.httpStatus });
  if (observation.status === "OBSERVED" &&
      observation.httpStatus !== null && observation.httpStatus < 400 &&
      (!observation.dom?.mainVisible || !observation.dom?.hasHeading))
    add("VISUAL_MAIN_MISSING", "critical", {
      mainVisible: Boolean(observation.dom?.mainVisible),
      hasHeading: Boolean(observation.dom?.hasHeading),
    });
  if (observation.status === "OBSERVED" && observation.path === "/login" &&
      observation.httpStatus === 200 &&
      !observation.dom?.hasForm) add("VISUAL_LOGIN_FORM_MISSING", "critical");
  if (observation.status === "OBSERVED" && observation.path === "/" &&
      observation.httpStatus === 200 &&
      (!observation.dom?.hasLoginLink || !observation.dom?.hasSignupLink))
    add("VISUAL_NAV_LINK_MISSING", "warning");
  if (observation.dom?.horizontalOverflow)
    add("VISUAL_HORIZONTAL_OVERFLOW", "warning");
  if (observation.requestFailures > 0)
    add("VISUAL_REQUEST_FAILED", "warning", { count: observation.requestFailures });
  for (const asset of observation.assetFailures.slice(0, 4))
    add("VISUAL_ASSET_FAILED", "critical", { assetType: asset.type,
      httpStatus: asset.httpStatus });
  for (const error of observation.jsErrors.slice(0, 4)) {
    if (error.networkLike && observation.blockedRequests > 0) continue;
    add("VISUAL_JS_UNHANDLED", "critical", { errorName: error.name,
      fingerprint: error.fingerprint });
  }
  return issues;
}

async function readSitemap(fetchImpl) {
  const response = await fetchImpl(`${ORIGIN}/sitemap.xml`, {
    method: "GET", credentials: "omit", redirect: "manual", cache: "no-store",
    signal: AbortSignal.timeout(7_000),
  });
  if (response.status !== 200 || !/xml/i.test(response.headers.get("content-type") ?? ""))
    throw new Error("VISUAL_SITEMAP_UNAVAILABLE");
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > 64_000) throw new Error("VISUAL_SITEMAP_TOO_LARGE");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("VISUAL_SITEMAP_UNAVAILABLE");
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 64_000) throw new Error("VISUAL_SITEMAP_TOO_LARGE");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString("utf8");
}

export async function inspectVisualPage(page, target, viewport, counters) {
  const observation = { path: target.path, studioCode: target.studioCode,
    viewport, httpStatus: null, dom: null, jsErrors: [], assetFailures: [],
    blockedRequests: 0, requestFailures: 0, screenshotBytes: 0,
    status: "NOT_VERIFIABLE" };
  const allowed = new WeakSet();
  const onPageError = (error) => observation.jsErrors.push(safeError(error));
  const onResponse = (response) => {
    const request = response.request();
    if (!allowed.has(request) || response.status() < 400) return;
    const type = request.resourceType();
    if (type !== "document") observation.assetFailures.push({ type,
      httpStatus: response.status() });
  };
  const onRequestFailed = (request) => {
    if (allowed.has(request)) observation.requestFailures++;
  };
  page.on("pageerror", onPageError);
  page.on("response", onResponse);
  page.on("requestfailed", onRequestFailed);
  const routeHandler = async (route) => {
    const request = route.request();
    const kind = allowBrowserRequest(request.method(), request.url(), counters.paths);
    const cacheable = kind === "asset" && /\.(?:js|css|woff2?)$/.test(new URL(request.url()).pathname);
    const cached = cacheable ? counters.assetCache.get(request.url()) : null;
    if (!kind || (!cached && counters.requests >= MAX_REQUESTS) ||
        Date.now() >= counters.deadline) {
      observation.blockedRequests++;
      if (counters.requests >= MAX_REQUESTS || Date.now() >= counters.deadline)
        counters.limitReached = true;
      await route.abort("blockedbyclient");
      return;
    }
    allowed.add(request);
    if (cached) { await route.fulfill(cached); return; }
    counters.requests++;
    if (counters.routeResponder) { await counters.routeResponder(route); return; }
    if (cacheable) {
      try {
        const response = await route.fetch({ maxRedirects: 0, timeout: 7_000 });
        const body = await response.body();
        const headers = { ...response.headers() };
        delete headers["set-cookie"];
        delete headers["content-encoding"];
        delete headers["content-length"];
        delete headers["transfer-encoding"];
        const value = { status: response.status(), headers, body };
        if (response.ok() && body.byteLength <= 1_000_000 &&
            counters.cacheBytes + body.byteLength <= 12_000_000) {
          counters.assetCache.set(request.url(), value);
          counters.cacheBytes += body.byteLength;
        }
        await route.fulfill(value);
      } catch { await route.abort("failed").catch(() => {}); }
      return;
    }
    await route.continue();
  };
  await page.route("**/*", routeHandler);
  try {
    const response = await page.goto(`${ORIGIN}${target.path}`, {
      waitUntil: "domcontentloaded", timeout: 12_000,
    });
    observation.httpStatus = response?.status() ?? null;
    await page.waitForTimeout(1_200);
    observation.dom = await page.evaluate(() => {
      const main = document.querySelector("main");
      const box = main?.getBoundingClientRect();
      const style = main ? getComputedStyle(main) : null;
      return { mainVisible: Boolean(box && box.width > 0 && box.height > 40 &&
        style?.display !== "none" && style?.visibility !== "hidden"),
      hasHeading: Boolean(document.querySelector("h1")),
      hasForm: Boolean(document.querySelector("form")),
      hasLoginLink: Boolean(document.querySelector('a[href="/login"]')),
      hasSignupLink: Boolean(document.querySelector('a[href^="/signup"]')),
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 20,
      studioLoading: Boolean(document.body?.innerText.includes("A carregar estúdio")) };
    });
    // Capture a rendered frame in memory only. Neither pixels nor page text
    // are written to the report or filesystem.
    observation.screenshotBytes = (await page.screenshot({ type: "png",
      animations: "disabled", timeout: 5_000 })).byteLength;
    observation.status = "OBSERVED";
  } catch { observation.status = "NOT_VERIFIABLE"; }
  finally {
    await page.unroute("**/*", routeHandler).catch(() => {});
    page.off("pageerror", onPageError);
    page.off("response", onResponse);
    page.off("requestfailed", onRequestFailed);
  }
  observation.issues = classifyVisualObservation(observation);
  observation.coverage = target.path.startsWith("/s/") &&
    (observation.blockedRequests > 0 || observation.dom?.studioLoading)
    ? "AGENDA_NAO_VERIFICAVEL" : observation.status;
  return observation;
}

export async function scanVisualPages({ fetchImpl = fetch,
  browserLauncher = () => chromium.launch({ headless: true }),
  routeResponder = null, targets = null, now = () => new Date() } = {}) {
  let selection;
  try { selection = chooseVisualTargets(await readSitemap(fetchImpl)); }
  catch { return { status: "DISCOVERY_UNAVAILABLE", pages: [],
    discoveredCount: 0, requests: 1, sitemapStatus: "UNAVAILABLE" }; }
  if (selection.rejectedUrls) return { status: "DISCOVERY_UNSAFE", pages: [],
    discoveredCount: selection.discoveredCount, requests: 1,
    sitemapStatus: "UNSAFE_URLS_REJECTED" };
  const selected = targets ?? selection.targets;
  if (!Array.isArray(selected) || selected.length > 8 ||
      selected.some((item) => !selection.targets.some((known) => known.path === item.path)))
    throw new Error("VISUAL_TARGETS_UNSAFE");
  const counters = { requests: 1, paths: new Set(selected.map((item) => item.path)),
    deadline: Date.now() + MAX_DURATION_MS, limitReached: false, routeResponder,
    assetCache: new Map(), cacheBytes: 0 };
  const pages = [];
  const browser = await browserLauncher();
  try {
    for (const viewport of ["desktop", "mobile"]) {
      const context = await browser.newContext({ viewport: VIEWPORTS[viewport],
        serviceWorkers: "block", acceptDownloads: false, permissions: [],
        ignoreHTTPSErrors: false });
      try {
        for (const target of selected) {
          if (viewport === "mobile" && !MOBILE.has(target.path)) continue;
          if (counters.limitReached || Date.now() >= counters.deadline) {
            pages.push({ path: target.path, studioCode: target.studioCode,
              viewport, status: "NOT_VERIFIABLE_LIMIT", coverage: "NOT_VERIFIABLE",
              issues: [] });
            continue;
          }
          const page = await context.newPage();
          try { pages.push(await inspectVisualPage(page, target, viewport, counters)); }
          finally { await page.close(); }
        }
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
  return { status: counters.limitReached ? "PARTIAL_LIMIT" : "OBSERVED",
    observedAt: now().toISOString(), pages,
    discoveredCount: selection.discoveredCount, selectedCount: selected.length,
    requests: counters.requests, sitemapStatus: "OK" };
}
