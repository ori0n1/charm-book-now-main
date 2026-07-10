import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => ((m as { default?: ServerEntry }).default ?? (m as unknown as ServerEntry)),
    );
  }
  return serverEntryPromise;
}

function brandedErrorResponse(): Response {
  return withSecurityHeaders(new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  }));
}

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  headers.set(
    "Permissions-Policy",
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
  );
  headers.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isPrivateIndexingPath(pathname: string): boolean {
  return (
    pathname.startsWith("/admin") ||
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/painel") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/onboarding") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/forgot-password") ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/marcacao") ||
    pathname.startsWith("/r/")
  );
}

function canonicalUrlForRequest(request: Request): string {
  const url = new URL(request.url);
  const pathname = url.pathname !== "/" ? url.pathname.replace(/\/+$/, "") : "/";
  return `https://bellza.pt${pathname}`;
}

function withSeoHeaders(request: Request, response: Response): Response {
  const url = new URL(request.url);
  const headers = new Headers(response.headers);
  const isPrivate = isPrivateIndexingPath(url.pathname);

  if (isPrivate) {
    headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  } else if (
    (request.method === "GET" || request.method === "HEAD") &&
    (headers.get("content-type") ?? "").includes("text/html")
  ) {
    headers.set("Link", `<${canonicalUrlForRequest(request)}>; rel="canonical"`);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function withPwaUpdateHeaders(request: Request, response: Response): Response {
  const url = new URL(request.url);
  const headers = new Headers(response.headers);
  const contentType = headers.get("content-type") ?? "";
  const isPwaMetadata =
    url.pathname === "/sw.js" ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname.startsWith("/api/public/studio-manifest/");

  if (isPwaMetadata) {
    headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    headers.set("Pragma", "no-cache");
    headers.set("Expires", "0");
  } else if (
    (request.method === "GET" || request.method === "HEAD") &&
    contentType.includes("text/html")
  ) {
    headers.set("Cache-Control", "no-cache, must-revalidate");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function canonicalHostRedirect(request: Request): Response | null {
  // Do not redirect between bellza.pt and www.bellza.pt. Installed PWAs are
  // origin-scoped; redirecting an existing www installation to the bare domain
  // can make the OS open the target as a normal browser tab instead of the app.
  return null;
}

function isCatastrophicSsrErrorBody(body: string, responseStatus: number): boolean {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return false;
  }

  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return false;
  }

  const fields = payload as Record<string, unknown>;
  const expectedKeys = new Set(["message", "status", "unhandled"]);
  if (!Object.keys(fields).every((key) => expectedKeys.has(key))) {
    return false;
  }

  return (
    fields.unhandled === true &&
    fields.message === "HTTPError" &&
    (fields.status === undefined || fields.status === responseStatus)
  );
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isCatastrophicSsrErrorBody(body, response.status)) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return brandedErrorResponse();
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const redirect = canonicalHostRedirect(request);
      if (redirect) return withSecurityHeaders(redirect);

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return withPwaUpdateHeaders(
        request,
        withSeoHeaders(request, withSecurityHeaders(await normalizeCatastrophicSsrResponse(response))),
      );
    } catch (error) {
      console.error(error);
      return brandedErrorResponse();
    }
  },
  async scheduled(_event: unknown, _env: unknown, ctx: { waitUntil: (promise: Promise<unknown>) => void }) {
    ctx.waitUntil(
      Promise.all([
        import("./lib/notification-dispatcher.server")
          .then((module) => module.dispatchPendingStudioPushNotifications())
          .catch((error) => console.error("studio_push_dispatch_failed", error)),
        import("./lib/public-client.functions")
          .then((module) =>
            Promise.all([
              module.dispatchPendingClientPushNotifications(),
              module.dispatchPendingClientCenterPushNotifications(),
            ]),
          )
          .catch((error) => console.error("client_push_dispatch_failed", error)),
      ]),
    );
  },
};
