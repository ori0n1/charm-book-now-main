// Deliberately separate from the Cloudflare transport: no OAuth or cookies enter
// this public-only monitor. Dynamic page paths must be listed in the public
// sitemap; asset paths must first be discovered in a checked page.
export const PUBLIC_PAGES = Object.freeze([
  { studioCode: "GLOBAL", path: "/" },
  { studioCode: "GLOBAL", path: "/blog" },
  { studioCode: "GLOBAL", path: "/contacto" },
  { studioCode: "GLOBAL", path: "/privacidade" },
  { studioCode: "GLOBAL", path: "/cookies" },
  { studioCode: "GLOBAL", path: "/termos" },
  { studioCode: "GLOBAL", path: "/rgpd" },
  { studioCode: "GLOBAL", path: "/politica-cancelamento" },
  { studioCode: "GLOBAL", path: "/politica-reembolso" },
  { studioCode: "GLOBAL", path: "/login" },
  { studioCode: "GLOBAL", path: "/signup" },
  { studioCode: "GLOBAL", path: "/forgot-password" },
  { studioCode: "GLOBAL", path: "/reset-password" },
  { studioCode: "CAPIVARA", path: "/s/capivarabarbearia" },
  { studioCode: "STUDIO_27", path: "/s/studio27braga" },
]);
const ORIGIN = "https://bellza.pt";
const ASSET = /^\/assets\/[A-Za-z0-9_.-]+\.(?:js|css)$/;
const DYNAMIC_PAGE = /^\/(?:s|blog)\/[a-z0-9][a-z0-9-]*$/;
const MAX_REQUESTS = 90;
const MAX_PAGES = 60;
const MAX_HTML_BYTES = 128_000;
const MAX_DURATION_MS = 150_000;

export function assertPublicRequest(method, url, discoveredAssets = new Set(),
  discoveredPages = new Set()) {
  if (method !== "GET" && method !== "HEAD") throw new Error("PUBLIC_OPERATION_DENIED");
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error("PUBLIC_OPERATION_DENIED"); }
  if (parsed.origin !== ORIGIN || parsed.username || parsed.password ||
      parsed.search || parsed.hash) throw new Error("PUBLIC_OPERATION_DENIED");
  if (method === "GET" && parsed.pathname === "/sitemap.xml") return "sitemap";
  if (method === "GET" && (PUBLIC_PAGES.some((page) => page.path === parsed.pathname) ||
      (DYNAMIC_PAGE.test(parsed.pathname) && discoveredPages.has(parsed.pathname)))) return "page";
  if (method === "HEAD" && ASSET.test(parsed.pathname) &&
      discoveredAssets.has(parsed.pathname)) return "asset";
  throw new Error("PUBLIC_OPERATION_DENIED");
}

async function boundedText(response) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_HTML_BYTES) throw new Error("PUBLIC_RESPONSE_TOO_LARGE");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_HTML_BYTES) throw new Error("PUBLIC_RESPONSE_TOO_LARGE");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString("utf8");
}

function routeStem(path) {
  if (path === "/") return "index";
  if (path === "/blog") return "blog.index";
  if (path.startsWith("/blog/")) return "blog._slug";
  if (path.startsWith("/s/")) return "s._slug";
  return path.slice(1);
}

function assetPaths(html, path) {
  const assets = [...new Set([...html.matchAll(/\/assets\/[A-Za-z0-9_.-]+\.(?:js|css)(?=["'])/g)]
    .map((match) => match[0]))];
  const css = assets.find((path) => path.endsWith(".css"));
  const entry = assets.find((path) => /\/index-[A-Za-z0-9_.-]+\.js$/.test(path)) ??
    assets.find((path) => path.endsWith(".js"));
  const prefix = `/assets/${routeStem(path)}-`;
  const matches = assets.filter((asset) =>
    asset.startsWith(prefix) && asset.endsWith(".js"));
  const route = path === "/" ? matches.at(-1) : matches[0];
  return { selected: [...new Set([css, entry, route].filter(Boolean))],
    hasCss: Boolean(css), hasEntry: Boolean(entry), route };
}

export function parsePublicSitemap(xml) {
  if (!/<urlset\b/i.test(xml) || !/<\/urlset>/i.test(xml))
    throw new Error("PUBLIC_SITEMAP_INVALID");
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((match) => match[1]);
  if (!locs.length || locs.length > 5000) throw new Error("PUBLIC_SITEMAP_INVALID");
  const paths = new Set();
  let rejected = 0;
  for (const loc of locs) {
    let url;
    try { url = new URL(loc); } catch { rejected++; continue; }
    if (url.origin !== ORIGIN || url.search || url.hash || url.username || url.password ||
        !(PUBLIC_PAGES.some((page) => page.path === url.pathname) ||
          DYNAMIC_PAGE.test(url.pathname))) { rejected++; continue; }
    paths.add(url.pathname);
  }
  return { paths: [...paths], rejected };
}

export async function probePublicPages({ fetchImpl = fetch, now = () => new Date(),
  delayMs = 0, maxDurationMs = MAX_DURATION_MS } = {}) {
  if (!Number.isInteger(maxDurationMs) || maxDurationMs < 1 ||
      maxDurationMs > MAX_DURATION_MS) throw new Error("PUBLIC_DURATION_UNSAFE");
  const discovered = new Set();
  const discoveredPages = new Set();
  const assetCache = new Map();
  const pages = [];
  let requests = 0;
  const started = now().getTime();
  let lastRequestAt = 0;
  async function request(method, path) {
    const url = `${ORIGIN}${path}`;
    assertPublicRequest(method, url, discovered, discoveredPages);
    if (requests >= MAX_REQUESTS) throw new Error("PUBLIC_BUDGET_EXCEEDED");
    const wait = Math.max(0, delayMs - (Date.now() - lastRequestAt));
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
    const remaining = maxDurationMs - (now().getTime() - started);
    if (remaining <= 0) throw new Error("PUBLIC_DURATION_EXCEEDED");
    requests++;
    return fetchImpl(url, {
      method, redirect: "manual", credentials: "omit", cache: "no-store",
      referrerPolicy: "no-referrer", headers: { Accept: method === "GET" ? "text/html" : "*/*" },
      signal: AbortSignal.timeout(Math.min(7_000, remaining)),
    });
  }
  let discoveryStatus = "OK";
  let sitemapUrls = 0;
  try {
    const sitemap = await request("GET", "/sitemap.xml");
    if (!sitemap.ok || !/\bxml\b/i.test(sitemap.headers.get("content-type") ?? "")) {
      discoveryStatus = "SITEMAP_UNAVAILABLE";
      await sitemap.body?.cancel?.();
    } else {
      const parsed = parsePublicSitemap(await boundedText(sitemap));
      sitemapUrls = parsed.paths.length;
      if (parsed.rejected) discoveryStatus = "SITEMAP_UNSAFE_URLS_REJECTED";
      for (const path of parsed.paths) if (DYNAMIC_PAGE.test(path)) discoveredPages.add(path);
    }
  } catch { discoveryStatus = "SITEMAP_UNAVAILABLE"; }
  const known = new Map(PUBLIC_PAGES.map((page) => [page.path, page]));
  for (const path of discoveredPages) if (!known.has(path)) {
    known.set(path, { studioCode: path.startsWith("/s/")
      ? `STUDIO:${path.slice(3)}` : "GLOBAL", path });
  }
  if (known.size > MAX_PAGES) discoveryStatus = "PAGE_LIMIT_EXCEEDED";
  const selectedPages = [...known.values()].slice(0, MAX_PAGES);
  for (const page of selectedPages) {
    const result = { studioCode: page.studioCode, path: page.path,
      status: "UNKNOWN", httpStatus: null, html: false, bookingShell: false,
      script: "UNKNOWN", style: "UNKNOWN", routeScript: "UNKNOWN",
      assetsChecked: 0, complete: false };
    pages.push(result);
    if (requests >= MAX_REQUESTS || now().getTime() - started >= maxDurationMs) {
      result.status = "NOT_CHECKED_LIMIT";
      continue;
    }
    let response;
    try { response = await request("GET", page.path); }
    catch (error) {
      result.status = ["PUBLIC_BUDGET_EXCEEDED", "PUBLIC_DURATION_EXCEEDED"]
        .includes(error?.message) ? "NOT_CHECKED_LIMIT" : "NETWORK_ERROR";
      continue;
    }
    result.httpStatus = response.status;
    if (!response.ok) { result.status = "HTTP_ERROR"; await response.body?.cancel?.(); continue; }
    if (!/^text\/html\b/i.test(response.headers.get("content-type") ?? "")) {
      result.status = "INVALID_HTML_TYPE";
      await response.body?.cancel?.();
      continue;
    }
    let html;
    try { html = await boundedText(response); }
    catch { result.status = "HTML_READ_ERROR"; continue; }
    result.html = /<html\b/i.test(html);
    result.bookingShell = page.studioCode !== "GLOBAL" &&
      /(?:marcaç[aã]o online|solicitaç[aã]o de agendamento)/i.test(html) &&
      /A carregar est[uú]dio/i.test(html);
    const assets = assetPaths(html, page.path);
    for (const path of assets.selected) discovered.add(path);
    result.script = assets.hasEntry ? "PENDING" : "MISSING";
    result.style = assets.hasCss ? "PENDING" : "MISSING";
    result.routeScript = assets.route ? "PENDING" : "MISSING";
    for (const path of assets.selected) {
      if (!assetCache.has(path)) {
        let assetStatus = "NETWORK_ERROR";
        try {
          const asset = await request("HEAD", path);
          const type = asset.headers.get("content-type") ?? "";
          assetStatus = !asset.ok ? "HTTP_ERROR" :
            path.endsWith(".js") && !/(?:javascript|ecmascript)/i.test(type) ? "INVALID_TYPE" :
            path.endsWith(".css") && !/text\/css/i.test(type) ? "INVALID_TYPE" : "OK";
          await asset.body?.cancel?.();
        } catch (error) {
          if (["PUBLIC_BUDGET_EXCEEDED", "PUBLIC_DURATION_EXCEEDED"]
            .includes(error?.message)) { result.status = "NOT_CHECKED_LIMIT"; break; }
          // A network error remains an explicit unknown.
        }
        assetCache.set(path, assetStatus);
      }
      if (result.status === "NOT_CHECKED_LIMIT") break;
      result.assetsChecked++;
      const value = assetCache.get(path);
      if (path.endsWith(".css")) result.style = value;
      else if (path === assets.route) result.routeScript = value;
      else result.script = value;
    }
    if (result.status === "NOT_CHECKED_LIMIT") continue;
    result.status = !result.html ? "HTML_INVALID" :
      [result.script, result.style, result.routeScript].includes("MISSING") ? "RESOURCE_MISSING" :
      [result.script, result.style, result.routeScript].some((value) =>
        ["HTTP_ERROR", "INVALID_TYPE"].includes(value)) ? "RESOURCE_FAILED" :
      [result.script, result.style, result.routeScript].includes("NETWORK_ERROR") ? "RESOURCE_UNKNOWN" :
      page.studioCode !== "GLOBAL" && !result.bookingShell ? "BOOKING_SHELL_MISSING" : "PAGE_AND_ASSETS_OK";
    result.complete = result.status === "PAGE_AND_ASSETS_OK";
  }
  if (pages.some((page) => page.status === "NOT_CHECKED_LIMIT") &&
      discoveryStatus === "OK") discoveryStatus = "REQUEST_OR_DURATION_LIMIT";
  return { observedAt: now().toISOString(), pages, requests,
    discoveryStatus, sitemapUrls, expectedPages: known.size,
    checkedPages: pages.filter((page) => page.status !== "NOT_CHECKED_LIMIT").length,
    agendaInteractivity: "NAO_VERIFICAVEL", reservations: "NAO_VERIFICAVEL" };
}

export function classifyPublicSnapshot(snapshot) {
  const rootFailed = snapshot.pages[0]?.status !== "PAGE_AND_ASSETS_OK";
  const studios = snapshot.pages.filter((page) => page.path.startsWith("/s/"));
  return snapshot.pages.flatMap((page) => {
    if (["PAGE_AND_ASSETS_OK", "NOT_CHECKED_LIMIT"].includes(page.status)) return [];
    const code = {
      NETWORK_ERROR: "PUBLIC_NETWORK_UNAVAILABLE", HTTP_ERROR: "PUBLIC_PAGE_HTTP_ERROR",
      INVALID_HTML_TYPE: "PUBLIC_HTML_TYPE_INVALID", HTML_READ_ERROR: "PUBLIC_HTML_UNREADABLE",
      HTML_INVALID: "PUBLIC_HTML_INVALID", RESOURCE_MISSING: "PUBLIC_RESOURCE_MISSING",
      RESOURCE_FAILED: "PUBLIC_RESOURCE_FAILED", RESOURCE_UNKNOWN: "PUBLIC_RESOURCE_UNVERIFIED",
      BOOKING_SHELL_MISSING: "PUBLIC_BOOKING_SHELL_MISSING",
    }[page.status] ?? "PUBLIC_CHECK_INDETERMINATE";
    return [{ studioCode: page.studioCode, path: page.path, code,
      severity: page.status === "RESOURCE_UNKNOWN" || page.status === "NETWORK_ERROR" ?
        "warning" : "critical",
      scope: page.studioCode === "GLOBAL" ? "PUBLIC_PAGE" :
        rootFailed && studios.every((item) => item.status === page.status)
          ? "GENERAL_OR_NETWORK" :
        studios.length > 1 && studios.every((item) => item.status === page.status)
          ? "MULTI_STUDIO" : "STUDIO_SPECIFIC",
      evidence: { httpStatus: page.httpStatus, script: page.script,
        style: page.style, routeScript: page.routeScript },
    }];
  });
}
