import { expect, test } from "@playwright/test";

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
