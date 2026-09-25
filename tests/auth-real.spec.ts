import { expect, test } from "@playwright/test";
import { LEGACY_AUTH_STORAGE_KEYS, SUPABASE_AUTH_COOKIE_NAME } from "../src/integrations/supabase/auth-config";

const email = process.env.BELLZA_E2E_EMAIL;
const password = process.env.BELLZA_E2E_PASSWORD;

test.describe("real cookie-backed Supabase session", () => {
  test.skip(!email || !password, "BELLZA_E2E_EMAIL/BELLZA_E2E_PASSWORD were not provided");
  test.describe.configure({ mode: "serial" });

  test("login, refresh, PWA-style reopen and logout", async ({ page, context }) => {
    test.setTimeout(120_000);
    await login(page, email!, password!);

    const authCookies = (await context.cookies()).filter(
      (cookie) =>
        cookie.name === SUPABASE_AUTH_COOKIE_NAME ||
        cookie.name.startsWith(`${SUPABASE_AUTH_COOKIE_NAME}.`),
    );
    expect(authCookies.length).toBeGreaterThan(0);
    for (const cookie of authCookies) {
      expect(cookie.httpOnly).toBe(false);
      expect(cookie.sameSite).toBe("Lax");
      expect(cookie.path).toBe("/");
      // The repository test server is HTTP. Production HTTPS is configured to
      // set Secure=true and is reported separately from this local assertion.
      expect(cookie.secure).toBe(false);
    }

    await expectLegacyAuthStorageToBeEmpty(page);
    await expectAuthenticatedSessionEndpoint(context);

    const refresh = await page.evaluate(async () => {
      const modulePath = "/src/integrations/supabase/client.ts";
      const { supabase } = (await import(modulePath)) as {
        supabase: { auth: { refreshSession: () => Promise<{ error: { name?: string } | null }> } };
      };
      const { error } = await supabase.auth.refreshSession();
      return { ok: !error, errorName: error?.name ?? null };
    });
    expect(refresh).toEqual({ ok: true, errorName: null });
    await expectAuthenticatedSessionEndpoint(context);

    await page.close();
    const reopened = await context.newPage();
    await reopened.goto("/admin/agenda", { waitUntil: "domcontentloaded" });
    await expect.poll(() => new URL(reopened.url()).pathname).not.toBe("/login");
    await expectAuthenticatedSessionEndpoint(context);

    const logout = await reopened.evaluate(async () => {
      const modulePath = "/src/integrations/supabase/client.ts";
      const { supabase } = (await import(modulePath)) as {
        supabase: { auth: { signOut: () => Promise<{ error: { name?: string } | null }> } };
      };
      const { error } = await supabase.auth.signOut();
      return { ok: !error, errorName: error?.name ?? null };
    });
    expect(logout).toEqual({ ok: true, errorName: null });

    const anonymous = await context.request.get("/api/auth/session");
    expect(anonymous.status()).toBe(401);
    await reopened.goto("/admin/agenda", { waitUntil: "domcontentloaded" });
    await expect.poll(() => new URL(reopened.url()).pathname).toBe("/login");

    // Leave the shared demo credentials usable and prove a fresh login after
    // the explicit global logout still creates a valid cookie session.
    await login(reopened, email!, password!);
    await expectLegacyAuthStorageToBeEmpty(reopened);
    await expectAuthenticatedSessionEndpoint(context);
  });
});

async function login(page: import("@playwright/test").Page, loginEmail: string, loginPassword: string) {
  const authResponses: Array<{ status: number; code: string | null }> = [];
  page.on("response", async (response) => {
    const url = new URL(response.url());
    if (!url.hostname.endsWith("supabase.co") || url.pathname !== "/auth/v1/token") return;
    const payload = (await response.json().catch(() => ({}))) as { error_code?: unknown; code?: unknown };
    const code = payload.error_code ?? payload.code;
    authResponses.push({ status: response.status(), code: typeof code === "string" ? code : null });
  });

  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect
    .poll(
      () => page.evaluate(() => !("$_TSR" in window)),
      { timeout: 60_000, message: "TanStack client hydration did not complete" },
    )
    .toBe(true);
  await page.locator('input[name="identifier"]').fill(loginEmail);
  await page.locator('input[name="password"]').fill(loginPassword);
  const submit = page.getByRole("button", { name: "Entrar", exact: true });
  await expect(submit).toBeEnabled({ timeout: 15_000 });
  await submit.click();
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (/^\/(admin(?:\/.*)?|onboarding)$/.test(new URL(page.url()).pathname)) return;
    const toast = page.locator("[data-sonner-toast]").first();
    if (await toast.isVisible().catch(() => false)) {
      throw new Error(`login_rejected:${sanitizeDiagnostic(await toast.innerText())}`);
    }
    await page.waitForTimeout(200);
  }

  const sessionStatus = await page.context().request
    .get("/api/auth/session")
    .then((response) => response.status())
    .catch(() => 0);
  throw new Error(
    `login_not_completed:auth=${JSON.stringify(authResponses)};session=${sessionStatus};submit=${sanitizeDiagnostic(await submit.innerText())}`,
  );
}

function sanitizeDiagnostic(value: string) {
  return value
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "redacted_email")
    .replace(/[A-Za-z0-9_-]{80,}/g, "redacted_token")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

async function expectLegacyAuthStorageToBeEmpty(page: import("@playwright/test").Page) {
  await expect
    .poll(() =>
      page.evaluate(
        (keys) => keys.map((key) => window.localStorage.getItem(key)),
        [...LEGACY_AUTH_STORAGE_KEYS],
      ),
    )
    .toEqual(LEGACY_AUTH_STORAGE_KEYS.map(() => null));
}

async function expectAuthenticatedSessionEndpoint(context: import("@playwright/test").BrowserContext) {
  const response = await context.request.get("/api/auth/session");
  expect(response.status()).toBe(200);
  const payload = (await response.json()) as { authenticated?: boolean; userId?: string };
  expect(payload.authenticated).toBe(true);
  expect(typeof payload.userId).toBe("string");
  expect(response.headers()["cache-control"]).toContain("private");
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["vary"]).toContain("Cookie");
}
