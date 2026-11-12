// Deliberately separate from the Cloudflare transport: no OAuth or cookies enter
// this public-only monitor. The three page paths are fixed, and asset paths must
// first be discovered in one of those pages.
export const PUBLIC_PAGES = Object.freeze([
  { studioCode: "GLOBAL", path: "/" },
  { studioCode: "CAPIVARA", path: "/s/capivarabarbearia" },
  { studioCode: "STUDIO_27", path: "/s/studio27braga" },
]);
const ORIGIN = "https://bellza.pt";
const ASSET = /^\/assets\/[A-Za-z0-9_.-]+\.(?:js|css)$/;
const MAX_REQUESTS = 8;
const MAX_HTML_BYTES = 128_000;

export function assertPublicRequest(method, url, discoveredAssets = new Set()) {
  if (method !== "GET" && method !== "HEAD") throw new Error("PUBLIC_OPERATION_DENIED");
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error("PUBLIC_OPERATION_DENIED"); }
  if (parsed.origin !== ORIGIN || parsed.username || parsed.password ||
      parsed.search || parsed.hash) throw new Error("PUBLIC_OPERATION_DENIED");
  if (method === "GET" && PUBLIC_PAGES.some((page) => page.path === parsed.pathname)) return "page";
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

function assetPaths(html, studioCode) {
  const assets = [...new Set([...html.matchAll(/\/assets\/[A-Za-z0-9_.-]+\.(?:js|css)(?=["'])/g)]
    .map((match) => match[0]))];
  const css = assets.find((path) => path.endsWith(".css"));
  const entry = assets.find((path) => /\/index-[A-Za-z0-9_.-]+\.js$/.test(path)) ??
    assets.find((path) => path.endsWith(".js"));
  const studioRoute = studioCode === "GLOBAL" ? null :
    assets.find((path) => /\/s\._slug-[A-Za-z0-9_.-]+\.js$/.test(path));
  return { selected: [...new Set([css, entry, studioRoute].filter(Boolean))],
    hasCss: Boolean(css), hasEntry: Boolean(entry), hasStudioRoute: Boolean(studioRoute) };
}

export async function probePublicPages({ fetchImpl = fetch, now = () => new Date() } = {}) {
  const discovered = new Set();
  const assetCache = new Map();
  const pages = [];
  let requests = 0;
  const started = now().getTime();
  async function request(method, path) {
    const url = `${ORIGIN}${path}`;
    assertPublicRequest(method, url, discovered);
    if (++requests > MAX_REQUESTS) throw new Error("PUBLIC_BUDGET_EXCEEDED");
    const remaining = 25_000 - (now().getTime() - started);
    if (remaining <= 0) throw new Error("PUBLIC_DURATION_EXCEEDED");
    return fetchImpl(url, {
      method, redirect: "manual", credentials: "omit", cache: "no-store",
      referrerPolicy: "no-referrer", headers: { Accept: method === "GET" ? "text/html" : "*/*" },
      signal: AbortSignal.timeout(Math.min(7_000, remaining)),
    });
  }
  for (const page of PUBLIC_PAGES) {
    const result = { studioCode: page.studioCode, path: page.path,
      status: "UNKNOWN", httpStatus: null, html: false, bookingShell: false,
      script: "UNKNOWN", style: "UNKNOWN", routeScript: "UNKNOWN",
      assetsChecked: 0, complete: false };
    pages.push(result);
    let response;
    try { response = await request("GET", page.path); }
    catch { result.status = "NETWORK_ERROR"; continue; }
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
    const assets = assetPaths(html, page.studioCode);
    for (const path of assets.selected) discovered.add(path);
    result.script = assets.hasEntry ? "PENDING" : "MISSING";
    result.style = assets.hasCss ? "PENDING" : "MISSING";
    result.routeScript = page.studioCode === "GLOBAL" ? "NOT_APPLICABLE" :
      assets.hasStudioRoute ? "PENDING" : "MISSING";
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
        } catch { /* A network error remains an explicit unknown. */ }
        assetCache.set(path, assetStatus);
      }
      result.assetsChecked++;
      const value = assetCache.get(path);
      if (path.endsWith(".css")) result.style = value;
      else if (/\/s\._slug-/.test(path)) result.routeScript = value;
      else result.script = value;
    }
    result.status = !result.html ? "HTML_INVALID" :
      [result.script, result.style, result.routeScript].includes("MISSING") ? "RESOURCE_MISSING" :
      [result.script, result.style, result.routeScript].some((value) =>
        ["HTTP_ERROR", "INVALID_TYPE"].includes(value)) ? "RESOURCE_FAILED" :
      [result.script, result.style, result.routeScript].includes("NETWORK_ERROR") ? "RESOURCE_UNKNOWN" :
      page.studioCode !== "GLOBAL" && !result.bookingShell ? "BOOKING_SHELL_MISSING" : "PAGE_AND_ASSETS_OK";
    result.complete = result.status === "PAGE_AND_ASSETS_OK";
  }
  return { observedAt: now().toISOString(), pages, requests,
    agendaInteractivity: "NAO_VERIFICAVEL", reservations: "NAO_VERIFICAVEL" };
}

export function classifyPublicSnapshot(snapshot) {
  const rootFailed = snapshot.pages[0]?.status !== "PAGE_AND_ASSETS_OK";
  return snapshot.pages.flatMap((page) => {
    if (page.status === "PAGE_AND_ASSETS_OK") return [];
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
      scope: page.studioCode === "GLOBAL" ||
        (rootFailed && snapshot.pages.slice(1).every((item) => item.status === page.status))
        ? "GENERAL_OR_NETWORK" :
        snapshot.pages.slice(1).every((item) => item.status === page.status)
          ? "MULTI_STUDIO" : "STUDIO_SPECIFIC",
      evidence: { httpStatus: page.httpStatus, script: page.script,
        style: page.style, routeScript: page.routeScript },
    }];
  });
}
