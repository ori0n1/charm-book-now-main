import { expect, test } from "@playwright/test";
import { CRITICAL_PAINT_CSS, PWA_STARTUP_SCRIPT } from "../src/lib/pwa-startup";
import { BELLZA_APP_ICON_192, BELLZA_MANIFEST } from "../src/lib/brand-assets";

test("local HTTP keeps report-only security headers without forcing unavailable HTTPS", async ({
  request,
}) => {
  const response = await request.get("/");
  expect(response.ok()).toBeTruthy();

  const headers = response.headers();
  expect(headers["content-security-policy-report-only"]).toContain("base-uri 'self'");
  expect(headers["content-security-policy-report-only"]).not.toContain("unsafe-eval");
  expect(headers["content-security-policy"]).toBeUndefined();
  expect(headers["strict-transport-security"]).toBeUndefined();
});

test("PWA update activates and refreshes installed clients once", async ({ page }) => {
  const swResponse = await page.request.get("/sw.js");
  expect(swResponse.ok()).toBeTruthy();
  const sw = await swResponse.text();

  expect(sw).toContain("self.skipWaiting()");
  expect(sw).toContain("const IS_UPDATE = Boolean(self.registration.active)");
  expect(sw).toContain("if (!IS_UPDATE) return");
  expect(sw).toContain("client.navigate(client.url)");
  expect(sw).not.toContain("BELLZA_SW_SKIP_WAITING");
  expect(sw).not.toContain("location.reload");
  expect(sw).toContain("pushsubscriptionchange");
  expect(sw).toContain("notificationclick");

  const manifestResponse = await page.request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBeTruthy();
  const manifest = await manifestResponse.json();

  expect(manifest.display).toBe("standalone");
  expect(manifest.scope).toBe("/");
  expect(manifest.start_url).toBe("/admin/agenda");
  expect(manifest.start_url).not.toContain("pwa_v=");
  expect(manifest.id).toBe("/admin");
  expect(
    manifest.icons.every((icon: { src?: string }) => icon.src?.includes("v=20260911-push-pwa-v2")),
  ).toBeTruthy();
  expect(sw).toContain('const CACHE_VERSION = "bellza-pwa-v20260911-push-pwa-v2"');
  expect(sw).toContain("STATIC_ASSET_PATHS");
});

test("PWA update checks preserve browser storage across reloads", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    window.localStorage.setItem("bellza:pwa-update-test", "session-kept");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem("bellza:pwa-update-test")))
    .toBe("session-kept");
});

test("active browser PWA cache contains only the current versioned Bellza identity", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const state = await page.evaluate(
    async ({ iconUrl, manifestUrl }) => {
      const registration = await navigator.serviceWorker.ready;
      await registration.update();
      const cacheKeys = await caches.keys();
      const currentCache = await caches.open("bellza-pwa-v20260911-push-pwa-v2-app");
      return {
        controller: navigator.serviceWorker.controller?.scriptURL ?? null,
        cacheKeys,
        iconCached: Boolean(await currentCache.match(iconUrl)),
        manifestHref: document.querySelector('link[rel="manifest"]')?.getAttribute("href") ?? null,
        manifestStatus: await fetch(manifestUrl, { cache: "no-store" }).then(
          (response) => response.status,
        ),
      };
    },
    { iconUrl: BELLZA_APP_ICON_192, manifestUrl: BELLZA_MANIFEST },
  );

  expect(state.controller).toContain("/sw.js");
  expect(state.cacheKeys).toContain("bellza-pwa-v20260911-push-pwa-v2-app");
  expect(state.cacheKeys.filter((key) => key.startsWith("bellza-pwa-"))).toHaveLength(1);
  expect(state.iconCached).toBeTruthy();
  expect(state.manifestHref).toBe(BELLZA_MANIFEST);
  expect(state.manifestStatus).toBe(200);
});

test("legacy installed PWA launches resolve to Agenda before React", async ({ page }) => {
  await page.route("**/admin", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<html><head><script>${PWA_STARTUP_SCRIPT}</script></head><body>Início</body></html>`,
    }),
  );
  await page.route("**/admin/agenda", (route) =>
    route.fulfill({ contentType: "text/html", body: "<html><body>Agenda</body></html>" }),
  );
  await page.addInitScript(() => {
    const nativeMatchMedia = window.matchMedia.bind(window);
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) =>
        query === "(display-mode: standalone)"
          ? {
              matches: true,
              media: query,
              onchange: null,
              addListener() {},
              removeListener() {},
              addEventListener() {},
              removeEventListener() {},
              dispatchEvent: () => false,
            }
          : nativeMatchMedia(query),
    });
  });

  await page.goto("/admin", { waitUntil: "domcontentloaded" });
  await expect.poll(() => new URL(page.url()).pathname).toBe("/admin/agenda");

  expect(PWA_STARTUP_SCRIPT).toContain('p==="/admin"');
  expect(PWA_STARTUP_SCRIPT).toContain('location.replace("/admin/agenda"');
});

test("initial document includes Bellza background before app CSS loads", async ({ page }) => {
  const response = await page.request.get("/");
  expect(response.ok()).toBeTruthy();
  const html = await response.text();

  expect(CRITICAL_PAINT_CSS).toContain("background:#f7f3ed");
  expect(html.indexOf(CRITICAL_PAINT_CSS)).toBeGreaterThan(-1);
  expect(html.indexOf(CRITICAL_PAINT_CSS)).toBeLessThan(html.indexOf("</head>"));
  expect(html.indexOf(CRITICAL_PAINT_CSS)).toBeLessThan(html.indexOf("<body"));
});
