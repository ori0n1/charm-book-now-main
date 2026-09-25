import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AUTH_CSRF_COOKIE_NAME,
  AUTH_CSRF_HEADER_NAME,
  validateCookieMutationCsrf,
} from "../src/integrations/supabase/auth-csrf";
import { SUPABASE_AUTH_COOKIE_NAME } from "../src/integrations/supabase/auth-config";
import { sanitizePrivateReturnTo } from "../src/lib/auth-return";

test("anonymous private HTML redirects to login and preserves a safe return path", async ({
  request,
}) => {
  const response = await request.get("/admin/agenda?view=week", { maxRedirects: 0 });

  expect([302, 303, 307]).toContain(response.status());
  const location = response.headers()["location"];
  expect(location).toBeTruthy();
  const redirect = new URL(location, "http://127.0.0.1:4178");
  expect(redirect.pathname).toBe("/login");
  expect(redirect.searchParams.get("returnTo")).toBe("/admin/agenda?view=week");
  expect(response.headers()["cache-control"]).toContain("private");
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["vary"]).toContain("Cookie");
});

test("anonymous session JSON returns 401 without cacheable identity data", async ({ request }) => {
  const response = await request.get("/api/auth/session");

  expect(response.status()).toBe(401);
  await expect(response.json()).resolves.toEqual({ authenticated: false });
  expect(response.headers()["cache-control"]).toContain("private");
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["vary"]).toContain("Cookie");
  expect(response.headers()["vary"]).toContain("Authorization");
});

test("credential-bearing auth pages disable referrer propagation", async ({ request }) => {
  for (const path of [
    "/auth/callback?code=synthetic-code",
    "/reset-password?code=synthetic-code",
    "/convite-equipa/synthetic-token",
  ]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.headers()["referrer-policy"]).toBe("no-referrer");
  }
});

test("private return targets are same-origin and allowlisted", () => {
  expect(sanitizePrivateReturnTo("/admin/agenda?view=week")).toBe("/admin/agenda?view=week");
  expect(sanitizePrivateReturnTo("/onboarding")).toBe("/onboarding");
  expect(sanitizePrivateReturnTo("//evil.example/admin")).toBeUndefined();
  expect(sanitizePrivateReturnTo("https://evil.example/admin")).toBeUndefined();
  expect(sanitizePrivateReturnTo("/auth/callback?code=secret")).toBeUndefined();
  expect(sanitizePrivateReturnTo("/admin#access_token=secret")).toBeUndefined();
});

test("cookie-authenticated mutations require same-origin double-submit CSRF", () => {
  const csrf = "a".repeat(64);
  const authCookie = `${SUPABASE_AUTH_COOKIE_NAME}=session-value`;

  const accepted = new Request("https://bellza.pt/_serverFn/example", {
    method: "POST",
    headers: {
      cookie: `${authCookie}; ${AUTH_CSRF_COOKIE_NAME}=${csrf}`,
      origin: "https://bellza.pt",
      "sec-fetch-site": "same-origin",
      [AUTH_CSRF_HEADER_NAME]: csrf,
    },
  });
  expect(validateCookieMutationCsrf(accepted)).toEqual({ ok: true });

  const missingToken = new Request("https://bellza.pt/_serverFn/example", {
    method: "POST",
    headers: { cookie: authCookie, origin: "https://bellza.pt" },
  });
  expect(validateCookieMutationCsrf(missingToken)).toEqual({
    ok: false,
    reason: "csrf_token_missing",
  });

  const crossSite = new Request("https://bellza.pt/_serverFn/example", {
    method: "POST",
    headers: {
      cookie: `${authCookie}; ${AUTH_CSRF_COOKIE_NAME}=${csrf}`,
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
      [AUTH_CSRF_HEADER_NAME]: csrf,
    },
  });
  expect(validateCookieMutationCsrf(crossSite)).toEqual({
    ok: false,
    reason: "csrf_origin_mismatch",
  });

  const legacyBearerOnly = new Request("https://bellza.pt/_serverFn/example", {
    method: "POST",
  });
  expect(validateCookieMutationCsrf(legacyBearerOnly)).toEqual({ ok: true });
});

test("production auth source no longer persists diagnostic events", () => {
  const projectRoot = process.cwd();
  const files = [
    "src/integrations/supabase/client.ts",
    "src/lib/auth-landing.ts",
    "src/routes/login.tsx",
    "src/routes/auth.callback.tsx",
    "src/components/google-auth-button.tsx",
  ];
  const source = files
    .map((file) => readFileSync(join(projectRoot, file), "utf8"))
    .join("\n");

  expect(source).not.toContain("recordAuthDebugEvent");
  expect(source).not.toContain("AUTH_DEBUG_STORAGE_KEY");
  expect(source).not.toContain("bellza:auth-debug-events");
  expect(source).not.toContain("pkce-code:${code}");
});

test("credential forms cannot fall back to native GET before hydration", () => {
  const projectRoot = process.cwd();
  for (const file of [
    "src/routes/login.tsx",
    "src/routes/signup.tsx",
    "src/routes/reset-password.tsx",
    "src/routes/convite-equipa.$token.tsx",
    "src/components/booking-experience.tsx",
  ]) {
    const source = readFileSync(join(projectRoot, file), "utf8");
    expect(source).not.toMatch(/<form\s+onSubmit=/);
    expect(source).toMatch(/<form\s+method="post"/);
  }
});

test("anonymous browser auth bootstrap settles without a migration loop", async ({ page }) => {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async () => {
    const modulePath = "/src/integrations/supabase/client.ts";
    const module = (await import(modulePath)) as {
      ensureBrowserAuthReady: () => Promise<boolean>;
    };
    return Promise.race([
      module.ensureBrowserAuthReady().then((authenticated) => ({ state: "settled", authenticated })),
      new Promise<{ state: "timeout"; authenticated: false }>((resolve) =>
        window.setTimeout(() => resolve({ state: "timeout", authenticated: false }), 5_000),
      ),
    ]);
  });
  expect(result).toEqual({ state: "settled", authenticated: false });
  const settled = await page.evaluate(async () => {
    const modulePath = "/src/lib/auth-landing.ts";
    const module = (await import(modulePath)) as {
      settleSessionFromCurrentUrl: (path: string) => Promise<unknown>;
    };
    return Promise.race([
      module.settleSessionFromCurrentUrl("/login").then((session) => ({
        state: "settled",
        hasSession: Boolean(session),
      })),
      new Promise<{ state: "timeout"; hasSession: false }>((resolve) =>
        window.setTimeout(() => resolve({ state: "timeout", hasSession: false }), 5_000),
      ),
    ]);
  });
  expect(settled).toEqual({ state: "settled", hasSession: false });
  await expect(page.getByRole("button", { name: "Entrar", exact: true })).toBeEnabled({
    timeout: 10_000,
  });
});
