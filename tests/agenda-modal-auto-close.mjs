import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright";

const root = process.cwd();
const server = await createServer({
  root, configFile: false, appType: "mpa",
  resolve: { alias: { "@": resolve(root, "src") } },
  optimizeDeps: { noDiscovery: true, include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"] },
  server: { host: "127.0.0.1", port: 4189, strictPort: true },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));

    const open = async (joint = false) => {
      await page.goto(`http://127.0.0.1:4189/tests/visual-modal-fixture.html?auto-close${joint ? "&joint" : ""}`);
      try { await page.getByRole("button", { name: "Abrir detalhes" }).click({ timeout: 5000 }); }
      catch (error) { console.error((await page.locator("body").innerText()).slice(0, 500), errors); throw error; }
      await page.locator("aside").waitFor();
    };
    const verify = async (status) => {
      await page.locator("aside").waitFor({ state: "hidden" });
      assert.equal(await page.getByTestId("agenda-card-status").textContent(), status);
    };

    await open();
    await page.getByRole("button", { name: "Receber pagamento" }).click();
    await page.getByRole("button", { name: "Falhar próxima ação" }).click();
    await page.getByRole("button", { name: "Confirmar recebimento" }).click();
    assert.equal(await page.locator("aside").isVisible(), true);
    assert.equal(await page.getByTestId("agenda-card-status").textContent(), "confirmed");
    await page.getByRole("button", { name: "Confirmar recebimento" }).click();
    await verify("completed");

    await open();
    await page.getByRole("button", { name: "Falhar próxima ação" }).click();
    await page.getByRole("button", { name: "Compareceu" }).click();
    assert.equal(await page.locator("aside").isVisible(), true);
    await page.getByRole("button", { name: "Compareceu" }).click();
    await verify("completed");

    await open();
    await page.getByRole("button", { name: "Faltou" }).click();
    await verify("no_show");

    await open();
    await page.getByRole("button", { name: "Cancelar marcação" }).click();
    await page.getByRole("button", { name: "Falhar próxima ação" }).click();
    await page.getByRole("button", { name: "Confirmar cancelamento" }).click();
    assert.equal(await page.locator("aside").isVisible(), true);
    await page.getByRole("button", { name: "Confirmar cancelamento" }).click();
    await verify("cancelled");

    await open(true);
    await page.getByRole("button", { name: "Compareceu" }).click();
    await page.getByRole("button", { name: /Serviço sintético.*Profissional de teste/ }).click();
    await verify("completed");

    await open(true);
    await page.getByRole("button", { name: "Cancelar marcação" }).click();
    await page.getByRole("button", { name: /Serviço sintético.*Profissional de teste/ }).click();
    await page.getByRole("button", { name: "Confirmar cancelamento" }).first().click();
    await verify("cancelled");
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`agenda modal auto-close: ${viewport.width}px success/failure/payment/attendance/no-show/cancellation/service OK`);
  }
} finally {
  await browser?.close();
  await server.close();
}
