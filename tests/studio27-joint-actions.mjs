import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright";

const root = process.cwd();
const server = await createServer({ root, configFile: false, appType: "mpa", cacheDir: resolve(root, "test-results", "studio27-vite-cache"), optimizeDeps: { noDiscovery: true, include: ["react", "react-dom", "react-dom/client", "react/jsx-dev-runtime", "react/jsx-runtime"] }, resolve: { alias: { "@": resolve(root, "src") } }, server: { host: "127.0.0.1", port: 0 } });
let browser;
try {
  await server.listen();
  const baseUrl = server.resolvedUrls?.local[0];
  assert.ok(baseUrl);
  browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
  mkdirSync("test-results/studio27-joint-validation", { recursive: true });
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 720 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${baseUrl}tests/studio27-joint-fixture.html`);
    await page.getByRole("button", { name: "Abrir atendimento conjunto" }).click({ timeout: 5000 }).catch(async (error) => {
      throw new Error(`${error.message}\nPage: ${(await page.locator("body").innerText()).slice(0, 800)}\nErrors: ${errors.join("; ")}`);
    });
    const primary = page.locator('aside [aria-label="Ações principais da marcação"] button');
    assert.deepEqual(await Promise.all([0, 1, 2].map((index) => primary.nth(index).isEnabled())), [true, true, true]);
    assert.equal(await page.getByRole("button", { name: "Editar reserva" }).isVisible(), true);
    assert.equal(await page.getByRole("button", { name: "Receber pagamento" }).isVisible(), true);
    await page.screenshot({ path: `test-results/studio27-joint-validation/${viewport.width}.png` });
    await page.getByRole("button", { name: "Editar reserva" }).click();
    assert.equal(await page.getByTestId("edit-count").innerText(), "1");
    await primary.nth(0).click();
    await page.getByTestId("joint-service-action-picker").getByRole("button", { name: /Gel \/ Blindagem/ }).click();
    assert.equal(await page.getByTestId("service-states").innerText(), "completed,confirmed");
    await primary.nth(1).click();
    await page.getByTestId("joint-service-action-picker").getByRole("button", { name: /Extensão de Pestanas/ }).click();
    assert.equal(await page.getByTestId("service-states").innerText(), "completed,no_show");
    assert.deepEqual(await Promise.all([0, 1, 2].map((index) => primary.nth(index).isDisabled())), [true, true, true]);
    await page.getByRole("button", { name: "Fechar detalhes" }).click({ position: { x: 5, y: 5 } });
    await page.getByRole("button", { name: "Abrir atendimento conjunto" }).click();
    await primary.nth(2).click();
    await page.getByTestId("joint-service-action-picker").getByRole("button", { name: /Gel \/ Blindagem/ }).click();
    assert.equal(await page.getByTestId("service-states").innerText(), "confirmed,confirmed");
    await page.getByTestId("joint-service-action-picker").getByRole("button", { name: "Confirmar cancelamento" }).click();
    assert.equal(await page.getByTestId("service-states").innerText(), "cancelled,confirmed");
    assert.equal(await page.getByTestId("whole-cancel-count").innerText(), "0");
    await page.getByRole("button", { name: "Fechar detalhes" }).click({ position: { x: 5, y: 5 } });
    await page.getByRole("button", { name: "Abrir conjunto manual" }).click();
    assert.deepEqual(await Promise.all([0, 1, 2].map((index) => primary.nth(index).isEnabled())), [true, true, true]);
    assert.equal(await page.getByRole("button", { name: "Editar reserva" }).isVisible(), true);
    assert.equal(await page.getByRole("button", { name: "Receber pagamento" }).count(), 0);
    await primary.nth(0).click();
    assert.equal(await page.getByTestId("attendance-status").innerText(), "completed");
    assert.equal(await page.getByTestId("joint-service-action-picker").count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log("Studio 27 joint controls: mobile and desktop OK");
} finally {
  await browser?.close();
  await server.close();
}
