import http from "node:http";
import { createAuthenticator } from "./auth.mjs";
import { DOMAINS, STUDIO_CODE, validateResult } from "./contract.mjs";

const PATH = /^\/v1\/studios\/(STUDIO_[A-Z0-9_]{1,24})\/(agenda|reservas|processamento|notificacoes|pagamentos)$/;

function respond(res, status, code, data = null) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(data === null ? { status: code } : data));
}

export function createPrivateApiServer({ clients, source, now = () => Date.now(),
  maxRequestsPerMinute = 30, maxInFlight = 2, readTimeoutMs = 2_000,
  log = () => {} } = {}) {
  // The only enabled source is local synthetic data. Adding a production
  // source requires a separate code change and explicit approval.
  if (source?.kind !== "SYNTHETIC_ONLY" || typeof source.read !== "function" ||
      !Number.isInteger(maxRequestsPerMinute) || maxRequestsPerMinute < 1 ||
      maxRequestsPerMinute > 60 || !Number.isInteger(maxInFlight) ||
      maxInFlight < 1 || maxInFlight > 4 || !Number.isInteger(readTimeoutMs) ||
      readTimeoutMs < 100 || readTimeoutMs > 5_000 || typeof log !== "function") {
    throw new Error("PRIVATE_API_CONFIG_INVALID");
  }
  const authorize = createAuthenticator({ clients, now });
  const buckets = new Map();
  let inFlight = 0;
  const server = http.createServer({ maxHeaderSize: 8192, requestTimeout: 5_000 }, async (req, res) => {
    const fail = (status, code) => { log({ code }); respond(res, status, code); };
    if (req.method !== "GET" || req.headers["content-length"] ||
        req.headers["transfer-encoding"]) return fail(405, "METHOD_DENIED");
    const path = req.url;
    if (typeof path !== "string" || path.length > 120 ||
        path.includes("?") || path.includes("#") || path.includes("%")) {
      return fail(404, "PATH_DENIED");
    }
    const match = PATH.exec(path);
    if (!match || !STUDIO_CODE.test(match[1]) || !Object.hasOwn(DOMAINS, match[2])) {
      return fail(404, "PATH_DENIED");
    }
    const [, studioCode, domain] = match;
    const clientId = authorize(req.headers, path, studioCode);
    if (!clientId) return fail(401, "AUTH_DENIED");
    const minute = Math.floor(now() / 60_000);
    const bucket = buckets.get(clientId);
    const count = bucket?.minute === minute ? bucket.count : 0;
    if (count >= maxRequestsPerMinute) return fail(429, "RATE_LIMITED");
    buckets.set(clientId, { minute, count: count + 1 });
    if (inFlight >= maxInFlight) return fail(429, "BUSY");
    inFlight++;
    const controller = new AbortController();
    let timer;
    try {
      const result = await Promise.race([
        source.read({ studioCode, domain, signal: controller.signal }),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("SOURCE_TIMEOUT"));
          }, readTimeoutMs);
        }),
      ]);
      const safe = validateResult(result, { studioCode, domain });
      respond(res, 200, "OK", safe);
    } catch (error) {
      fail(503, error?.message === "SOURCE_TIMEOUT" ? "SOURCE_TIMEOUT" : "SOURCE_UNAVAILABLE");
    } finally {
      clearTimeout(timer);
      inFlight--;
    }
  });
  return server;
}

export async function startPrivateApi(options) {
  const server = createPrivateApiServer(options);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return { url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())) };
}
