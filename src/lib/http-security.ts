import { PUBLIC_SUPABASE_URL } from "@/integrations/supabase/auth-config";

const CANONICAL_HOST = "bellza.pt";
const CSP_REPORT_PATH = "/api/security/csp-report";
const CSP_REPORT_MAX_BYTES = 16 * 1024;
const CSP_REPORT_WINDOW_MS = 60_000;
const CSP_REPORT_LIMIT = 30;

const SUPABASE_ORIGIN = new URL(PUBLIC_SUPABASE_URL).origin;
const SUPABASE_REALTIME_ORIGIN = SUPABASE_ORIGIN.replace(/^https:/, "wss:");

type HtmlElementLike = {
  getAttribute: (name: string) => string | null;
  setAttribute: (name: string, value: string) => void;
};

type HtmlRewriterLike = {
  on: (
    selector: string,
    handlers: { element: (element: HtmlElementLike) => void },
  ) => HtmlRewriterLike;
  transform: (response: Response) => Response;
};

type HtmlRewriterConstructor = new () => HtmlRewriterLike;

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type SafeCspReport = {
  document_uri: string;
  blocked_uri: string | null;
  effective_directive: string;
  disposition: "report-only";
  status_code: number | null;
};

const cspReportBuckets = new Map<string, RateLimitBucket>();

export function getCanonicalRedirectLocation(request: Request): string | null {
  const url = new URL(request.url);
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const isBellzaHost = hostname === CANONICAL_HOST || hostname === `www.${CANONICAL_HOST}`;

  // Local development and preview hosts must remain reachable over HTTP.
  if (!isBellzaHost) return null;
  if (url.protocol === "https:" && hostname === CANONICAL_HOST) return null;

  url.protocol = "https:";
  url.hostname = CANONICAL_HOST;
  url.port = "";
  return url.toString();
}

export function isSensitivePublicPath(pathname: string): boolean {
  const normalized = decodePathForSecurity(pathname);
  if (normalized.includes("\0")) return true;

  const segments = normalized.replace(/\\/g, "/").toLowerCase().split("/").filter(Boolean);
  if (segments.length === 0) return false;

  if (
    segments.some(
      (segment) =>
        segment === ".git" ||
        segment.startsWith(".git") ||
        segment === ".svn" ||
        segment === ".hg" ||
        segment === ".aws" ||
        segment === "backup" ||
        segment === "backups" ||
        segment === "dump" ||
        segment === "dumps",
    )
  ) {
    return true;
  }

  const filename = segments.at(-1) ?? "";
  return (
    /^\.env(?:$|[._-])/.test(filename) ||
    /^(?:phpinfo|info|test|wp-config|config)\.php$/.test(filename) ||
    /^(?:\.htaccess|\.htpasswd|\.npmrc|\.netrc|\.dockercfg|web\.config)$/.test(filename) ||
    /^(?:id_rsa|id_dsa|credentials(?:\.json|\.csv)?|aws[-_]credentials?)$/.test(filename) ||
    /(?:^|[-_.])aws[-_]access[-_]keys?(?:[-_.]|$)/.test(filename) ||
    /(?:\.bak|\.backup|\.old|\.orig|\.save|\.swp|\.sql|\.sqlite3?|\.dump)(?:\.gz)?$/.test(
      filename,
    ) ||
    filename === "terraform.tfstate" ||
    filename === "server-status" ||
    filename === "server-info"
  );
}

function decodePathForSecurity(pathname: string): string {
  let decoded = pathname;
  for (let pass = 0; pass < 3; pass += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      return `${decoded}\0`;
    }
  }
  return decoded;
}

export function buildCspReportOnlyPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://accounts.google.com https://connect.facebook.net`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: ${SUPABASE_ORIGIN} https://www.facebook.com`,
    `connect-src 'self' ${SUPABASE_ORIGIN} ${SUPABASE_REALTIME_ORIGIN} https://accounts.google.com https://people.googleapis.com https://www.facebook.com`,
    "font-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-src https://accounts.google.com",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `report-uri ${CSP_REPORT_PATH}`,
  ].join("; ");
}

export async function withCspReportOnly(request: Request, response: Response): Promise<Response> {
  const contentType = response.headers.get("content-type") ?? "";
  const isHtml = contentType.toLowerCase().includes("text/html");
  if (!isHtml) return response;

  const nonce = createCspNonce();
  const headers = new Headers(response.headers);
  headers.delete("Content-Security-Policy");
  headers.set("Content-Security-Policy-Report-Only", buildCspReportOnlyPolicy(nonce));
  headers.delete("Content-Length");
  headers.delete("ETag");

  const htmlResponse = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });

  if (request.method === "HEAD" || !htmlResponse.body) return htmlResponse;

  const RuntimeHtmlRewriter = (
    globalThis as typeof globalThis & { HTMLRewriter?: HtmlRewriterConstructor }
  ).HTMLRewriter;

  if (RuntimeHtmlRewriter) {
    return new RuntimeHtmlRewriter()
      .on("script", {
        element(element) {
          if (element.getAttribute("src") === null) {
            element.setAttribute("nonce", nonce);
          }
        },
      })
      .transform(htmlResponse);
  }

  // Node-based previews do not always expose Cloudflare's streaming HTMLRewriter.
  // Buffering is a local/runtime fallback; production Workers use the branch above.
  const bufferedHeaders = new Headers(htmlResponse.headers);
  bufferedHeaders.delete("Content-Encoding");
  const html = await htmlResponse.text();
  const withNonces = html.replace(/<script\b([^>]*)>/gi, (openingTag, attributes: string) => {
    if (/\bsrc\s*=/i.test(attributes)) return openingTag;
    const withoutPreviousNonce = attributes.replace(
      /\snonce\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i,
      "",
    );
    return `<script nonce="${nonce}"${withoutPreviousNonce}>`;
  });
  return new Response(withNonces, {
    status: htmlResponse.status,
    statusText: htmlResponse.statusText,
    headers: bufferedHeaders,
  });
}

function createCspNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export async function handleCspReport(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== CSP_REPORT_PATH) return null;

  if (request.method !== "POST") {
    return cspReportResponse(405, "Method Not Allowed", { Allow: "POST" });
  }

  const contentType = (request.headers.get("content-type") ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (
    contentType !== "application/csp-report" &&
    contentType !== "application/reports+json" &&
    contentType !== "application/json"
  ) {
    return cspReportResponse(415, "Unsupported Media Type");
  }

  const rateLimit = consumeCspReportRateLimit(request);
  if (!rateLimit.allowed) {
    return cspReportResponse(429, "Too Many Requests", {
      "Retry-After": String(rateLimit.retryAfterSeconds),
    });
  }

  let payload: unknown;
  try {
    payload = await readLimitedJson(request, CSP_REPORT_MAX_BYTES);
  } catch (error) {
    if (error instanceof CspPayloadTooLargeError) {
      return cspReportResponse(413, "Payload Too Large");
    }
    return cspReportResponse(400, "Invalid CSP report");
  }

  const reports = parseCspReports(payload);
  if (reports.length === 0) {
    return cspReportResponse(400, "Invalid CSP report");
  }

  for (const report of reports) {
    console.warn(
      JSON.stringify({
        event: "csp_violation",
        recorded_at: new Date().toISOString(),
        ...report,
      }),
    );
  }

  return cspReportResponse(204);
}

function cspReportResponse(
  status: number,
  body?: string,
  extraHeaders?: Record<string, string>,
): Response {
  const headers = new Headers(extraHeaders);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  if (body) headers.set("Content-Type", "text/plain; charset=utf-8");
  return new Response(body, { status, headers });
}

function consumeCspReportRateLimit(request: Request): {
  allowed: boolean;
  retryAfterSeconds: number;
} {
  const now = Date.now();
  if (cspReportBuckets.size >= 512) {
    for (const [key, bucket] of cspReportBuckets) {
      if (bucket.resetAt <= now) cspReportBuckets.delete(key);
    }
  }

  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  const candidate = request.headers.get("cf-connecting-ip") ?? forwarded ?? "unknown";
  const key = cspReportBuckets.size < 1024 ? candidate.slice(0, 128) : "overflow";
  const current = cspReportBuckets.get(key);

  if (!current || current.resetAt <= now) {
    cspReportBuckets.set(key, { count: 1, resetAt: now + CSP_REPORT_WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (current.count >= CSP_REPORT_LIMIT) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }

  current.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

class CspPayloadTooLargeError extends Error {}

async function readLimitedJson(request: Request, maxBytes: number): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new CspPayloadTooLargeError();
  }
  if (!request.body) throw new Error("missing_body");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new CspPayloadTooLargeError();
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return JSON.parse(new TextDecoder().decode(bytes));
}

function parseCspReports(payload: unknown): SafeCspReport[] {
  const candidates = Array.isArray(payload) ? payload : [payload];
  if (candidates.length === 0 || candidates.length > 10) return [];

  const reports: SafeCspReport[] = [];
  for (const candidate of candidates) {
    const envelope = asRecord(candidate);
    if (!envelope) continue;
    const report = asRecord(envelope["csp-report"]) ?? asRecord(envelope.body) ?? envelope;

    const documentUri = boundedString(
      report["document-uri"] ?? report.documentURI ?? report.documentURL,
      4096,
    );
    const blockedUri = boundedString(
      report["blocked-uri"] ?? report.blockedURI ?? report.blockedURL,
      4096,
    );
    const directive = boundedString(
      report["effective-directive"] ?? report.effectiveDirective ?? report["violated-directive"],
      128,
    );

    if (!documentUri || !directive || !/^[a-z0-9-]{1,64}$/i.test(directive)) continue;
    const safeDocumentUri = sanitizeCspReportUri(documentUri);
    if (!safeDocumentUri) continue;

    const rawStatus = report["status-code"] ?? report.statusCode;
    const statusCode =
      typeof rawStatus === "number" &&
      Number.isInteger(rawStatus) &&
      rawStatus >= 0 &&
      rawStatus <= 599
        ? rawStatus
        : null;

    reports.push({
      document_uri: safeDocumentUri,
      blocked_uri: blockedUri ? sanitizeCspReportUri(blockedUri) : null,
      effective_directive: directive.toLowerCase(),
      disposition: "report-only",
      status_code: statusCode,
    });
  }
  return reports;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function boundedString(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength ? value : null;
}

export function sanitizeCspReportUri(value: string): string | null {
  const normalized = value.trim();
  if (!normalized || normalized.length > 4096) return null;

  const keyword = normalized.toLowerCase();
  if (["inline", "eval", "self", "none"].includes(keyword)) return keyword;
  if (keyword.startsWith("data:")) return "data:";
  if (keyword.startsWith("blob:")) return "blob:";

  try {
    const url = new URL(normalized);
    if (
      url.protocol !== "http:" &&
      url.protocol !== "https:" &&
      url.protocol !== "ws:" &&
      url.protocol !== "wss:"
    ) {
      return `${url.protocol}`;
    }
    // Keep only the origin and route family. Query strings, fragments, capability
    // tokens, slugs and object names never reach logs.
    const routeFamily = url.pathname.split("/").filter(Boolean)[0];
    return `${url.origin}${routeFamily ? `/${routeFamily}` : ""}`;
  } catch {
    return null;
  }
}
