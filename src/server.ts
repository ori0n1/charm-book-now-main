import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import {
  getCanonicalRedirectLocation,
  handleCspReport,
  isSensitivePublicPath,
  withCspReportOnly,
} from "./lib/http-security";
import { SUPABASE_AUTH_COOKIE_NAME } from "./integrations/supabase/auth-config";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m as { default?: ServerEntry }).default ?? (m as unknown as ServerEntry),
    );
  }
  return serverEntryPromise;
}

function brandedErrorResponse(request?: Request): Response {
  return withSecurityHeaders(
    new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
    request,
  );
}

function withSecurityHeaders(response: Response, request?: Request): Response {
  const headers = new Headers(response.headers);
  const isSecureRequest = request ? new URL(request.url).protocol === "https:" : true;
  headers.set("X-Content-Type-Options", "nosniff");
  const pathname = request ? new URL(request.url).pathname : "";
  headers.set(
    "Referrer-Policy",
    isCredentialBearingAuthPath(pathname) ? "no-referrer" : "strict-origin-when-cross-origin",
  );
  headers.set("X-Frame-Options", "DENY");
  if (isSecureRequest) {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  } else {
    headers.delete("Strict-Transport-Security");
  }
  headers.set(
    "Permissions-Policy",
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
  );
  headers.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  // CSP is intentionally observation-only during this rollout. Enforcing it
  // before production violation data is reviewed could break auth or payments.
  headers.delete("Content-Security-Policy");
  headers.set("X-Permitted-Cross-Domain-Policies", "none");

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
    pathname.startsWith("/convite-equipa") ||
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
  const isSandbox = process.env.STRIPE_ENV === "sandbox";

  if (isPrivate || isSandbox) {
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
  const isVersionedAsset = url.pathname.startsWith("/assets/");
  const isPwaMetadata =
    url.pathname === "/sw.js" ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname.startsWith("/api/public/studio-manifest/");

  const carriesAuth = requestCarriesAuth(request) || response.headers.has("set-cookie");

  if (isPrivateHtmlPath(url.pathname)) {
    setPrivateNoStore(headers);
  } else if (isVersionedAsset) {
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
  } else if (isPwaMetadata) {
    headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    headers.set("Pragma", "no-cache");
    headers.set("Expires", "0");
  } else if (
    (request.method === "GET" || request.method === "HEAD") &&
    contentType.includes("text/html")
  ) {
    if (carriesAuth) setPrivateNoStore(headers);
    else headers.set("Cache-Control", "no-cache, must-revalidate");
  } else if (carriesAuth && isDynamicApplicationPath(url.pathname)) {
    setPrivateNoStore(headers);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isPrivateHtmlPath(pathname: string) {
  return (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/onboarding" ||
    pathname.startsWith("/onboarding/")
  );
}

function isCredentialBearingAuthPath(pathname: string) {
  return (
    pathname === "/auth/callback" ||
    pathname === "/reset-password" ||
    pathname.startsWith("/convite-equipa/")
  );
}

function isDynamicApplicationPath(pathname: string) {
  return pathname.startsWith("/api/") || pathname.startsWith("/_serverFn/");
}

function requestCarriesAuth(request: Request) {
  if (request.headers.has("authorization")) return true;
  const cookie = request.headers.get("cookie") ?? "";
  return cookie
    .split(";")
    .map((part) => part.slice(0, Math.max(part.indexOf("="), 0)).trim())
    .some(
      (name) => name === SUPABASE_AUTH_COOKIE_NAME || name.startsWith(`${SUPABASE_AUTH_COOKIE_NAME}.`),
    );
}

function setPrivateNoStore(headers: Headers) {
  headers.set("Cache-Control", "private, no-store");
  headers.set("Pragma", "no-cache");
  headers.set("Expires", "0");
  mergeVary(headers, "Cookie");
  mergeVary(headers, "Authorization");
}

function mergeVary(headers: Headers, value: string) {
  const values = new Set(
    (headers.get("Vary") ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  values.add(value);
  headers.set("Vary", [...values].join(", "));
}

function canonicalHostRedirect(request: Request): Response | null {
  const location = getCanonicalRedirectLocation(request);
  if (!location) return null;

  return new Response(null, {
    status: 308,
    headers: {
      Location: location,
      "Cache-Control": "public, max-age=3600",
    },
  });
}

function sensitivePathNotFound(): Response {
  return new Response("Not Found", {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
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
      const internalPath = new URL(request.url).pathname;
      if (internalPath.startsWith("/api/private/lifecycle-dispatch/")) {
        if (request.method !== "POST") return new Response(null, { status: 405 });
        const configured = String((env as Record<string, unknown>)?.LIFECYCLE_CRON_TOKEN ?? "");
        const provided = request.headers.get("x-bellza-scheduler-token") ?? "";
        if (!configured || !constantTimeTokenEquals(configured, provided)) {
          return new Response(null, { status: 404 });
        }
        try {
          const job = internalPath.slice("/api/private/lifecycle-dispatch/".length);
          if (job === "enqueue") {
            const { getAdminClient } = await import("./lib/supabase-admin.server");
            const sb = getAdminClient() as any;
            const advance = await sb.rpc("enqueue_24h_appointment_push_reminders");
            if (advance.error && advance.error.code !== "PGRST202") throw new Error(advance.error.message);
            const lifecycle = await sb.rpc("enqueue_due_appointment_lifecycle_notifications");
            if (lifecycle.error && lifecycle.error.code !== "PGRST202" &&
                !String(lifecycle.error.message).includes("Could not find")) {
              throw new Error(lifecycle.error.message);
            }
          } else if (job === "studio-push") {
            const { dispatchPendingStudioPushNotifications } = await import("./lib/notification-dispatcher.server");
            await dispatchPendingStudioPushNotifications({ batchSize: 5, maxBatches: 1 });
          } else if (job === "client-derived") {
            const { dispatchPendingClientPushNotifications } = await import("./lib/public-client.functions");
            const pageParam = new URL(request.url).searchParams.get("page");
            const page = pageParam === null ? 0 : Number(pageParam);
            if (!Number.isInteger(page) || page < 0 || page >= 20) return new Response(null, { status: 400 });
            await dispatchPendingClientPushNotifications({ page, pageSize: 15 });
          } else if (job === "client-center") {
            const { dispatchPendingClientCenterPushNotifications } = await import("./lib/public-client.functions");
            await dispatchPendingClientCenterPushNotifications();
          } else if (job === "whatsapp-reminder") {
            const { dispatchDueAraraTwoHourReminders } = await import("./lib/whatsapp.functions");
            await dispatchDueAraraTwoHourReminders();
          } else if (job === "whatsapp-reconcile") {
            const { reconcilePendingWhatsAppMessages, recoverInterruptedAppointmentWhatsAppMessages } = await import("./lib/whatsapp.functions");
            await reconcilePendingWhatsAppMessages();
            await recoverInterruptedAppointmentWhatsAppMessages();
          } else if (job === "whatsapp-confirmations") {
            const { dispatchMissingAppointmentWhatsAppConfirmations } = await import("./lib/whatsapp.functions");
            await dispatchMissingAppointmentWhatsAppConfirmations();
          } else {
            return new Response(null, { status: 404 });
          }
          return new Response(null, { status: 204 });
        } catch (error) {
          console.error("lifecycle_internal_dispatch_failed", error);
          return new Response("dispatch_failed", { status: 503 });
        }
      }
      const redirect = canonicalHostRedirect(request);
      if (redirect) return withSecurityHeaders(redirect, request);

      const url = new URL(request.url);
      if (isSensitivePublicPath(url.pathname)) {
        return withSecurityHeaders(sensitivePathNotFound(), request);
      }

      const cspReport = await handleCspReport(request);
      if (cspReport) return withSecurityHeaders(cspReport, request);

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return withCspReportOnly(
        request,
        withPwaUpdateHeaders(
          request,
          withSeoHeaders(
            request,
            withSecurityHeaders(await normalizeCatastrophicSsrResponse(response), request),
          ),
        ),
      );
    } catch (error) {
      console.error(error);
      return withCspReportOnly(request, brandedErrorResponse(request));
    }
  },
  async scheduled(
    event: { cron?: string },
    _env: unknown,
    ctx: { waitUntil: (promise: Promise<unknown>) => void },
  ) {
    if (event.cron === "*/10 * * * *") {
      ctx.waitUntil(
        import("./lib/payments.functions")
          .then((module) => module.reconcileUnlinkedBookingPayments())
          .then((result) => {
            if (result.failures > 0) throw new Error("booking_payment_reconciliation_incomplete");
          })
          .catch(() => {
            console.error("booking_payment_reconciliation_failed");
            throw new Error("booking_payment_reconciliation_failed");
          }),
      );
      return;
    }
    if (event.cron === "*/5 * * * *") {
      ctx.waitUntil(
        Promise.all([
          import("./lib/appointment-lifecycle.server")
            .then((module) => module.dispatchDueAppointmentLifecycle())
            .catch((error) => console.error("appointment_lifecycle_dispatch_failed", error)),
          import("./lib/whatsapp.functions")
            .then(async (module) => {
              await module.dispatchDueAraraTwoHourReminders();
              await module.reconcilePendingWhatsAppMessages();
              return module.recoverInterruptedAppointmentWhatsAppMessages();
            })
            .catch((error) => console.error("booking_reminder_dispatch_failed", error)),
        ]),
      );
      return;
    }
    ctx.waitUntil(
      Promise.all([
        import("./lib/appointment-lifecycle.server")
          .then((module) => module.dispatchDueAppointmentLifecycle())
          .catch((error) => console.error("appointment_lifecycle_dispatch_failed", error)),
        import("./lib/whatsapp.functions")
          .then(async (module) => {
            await module.dispatchMissingAppointmentWhatsAppConfirmations();
            await module.reconcilePendingWhatsAppMessages();
            return module.recoverInterruptedAppointmentWhatsAppMessages();
          })
          .catch((error) => console.error("whatsapp_reconciliation_failed", error)),
      ]),
    );
  },
};

function constantTimeTokenEquals(expected: string, actual: string) {
  if (expected.length !== actual.length || expected.length < 32) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
  }
  return difference === 0;
}
