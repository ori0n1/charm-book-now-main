import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright";

const root = process.cwd();
const mobile = process.argv.includes("--mobile");
const viewport = mobile ? { width: 390, height: 844 } : { width: 1280, height: 720 };
const assetsDir = resolve(root, "dist", "client", "assets");
const cssFile = readdirSync(assetsDir).find((name) => /^styles-.*\.css$/.test(name));
assert.ok(cssFile, "build CSS must exist before the visual test");
const css = readFileSync(resolve(assetsDir, cssFile));
const server = await createServer({
  root, configFile: false, appType: "mpa",
  resolve: { alias: { "@": resolve(root, "src") } },
  server: { host: "127.0.0.1", port: 4191, strictPort: true },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/tests/visual-action-style.css", (route) =>
    route.fulfill({ status: 200, contentType: "text/css", body: css }));
  await page.goto("http://127.0.0.1:4191/tests/visual-action-fixture.html");
  await page.getByRole("button", { name: "Abrir marcação", exact: true }).click();
  const quick = page.getByTestId("appointment-quick-actions");
  const primary = page.locator('aside [aria-label="Ações principais da marcação"] button');
  const complete = primary.nth(0);
  const noShow = primary.nth(1);
  const cancel = primary.nth(2);
  const edit = page.getByRole("button", { name: /Editar reserva/ });
  const payment = page.getByRole("button", { name: "Receber pagamento", exact: true });
  await edit.waitFor();
  await page.waitForTimeout(350);
  assert.equal(await primary.count(), 3);
  assert.deepEqual((await primary.allTextContents()).map((value) => value.trim()),
    ["Compareceu", "Faltou", "Cancelar marcação"]);
  assert.equal(await page.getByRole("button", { name: "Editar e ações" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: /Encaixar/ }).count(), 0);
  assert.equal(await page.getByRole("button", { name: /Corrigir estado ou recebimento/ }).count(), 0);
  assert.equal(await payment.isVisible(), true);
  assert.ok(await edit.boundingBox().then((box) => box?.height >= 44));
  const positions = await Promise.all([complete, noShow, cancel].map((control) => control.boundingBox()));
  assert.ok(positions.every(Boolean));
  assert.ok(positions.every((box) => box.y >= 0 && box.y + box.height <= viewport.height),
    "primary controls fit without scrolling");
  assert.equal(await quick.evaluate((node) => node.scrollHeight > node.clientHeight), false);
  const colors = await primary.evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).backgroundColor));
  assert.equal(new Set(colors).size, 3, "attendance, absence and cancellation need distinct colors");
  mkdirSync("tests/evidence", { recursive: true });
  await page.screenshot({ path: `tests/evidence/appointment-buttons-v2-${mobile ? "mobile" : "desktop"}-open.png` });
  async function stable() {
    const current = await Promise.all([complete, noShow, cancel].map((control) => control.boundingBox()));
    current.forEach((box, index) => {
      assert.ok(box);
      assert.ok(Math.abs(box.x - positions[index].x) <= 1 &&
        Math.abs(box.y - positions[index].y) <= 1 &&
        Math.abs(box.width - positions[index].width) <= 1 &&
        Math.abs(box.height - positions[index].height) <= 1,
        "the three primary buttons must remain in place and keep their size");
    });
    assert.equal(await page.locator("aside").count(), 1);
  }
  await edit.click();
  assert.equal(await page.getByTestId("fixture-edit-count").innerText(), "1");
  await stable();
  await complete.click();
  assert.match(await page.getByTestId("fixture-status").innerText(), /Concluído · Por receber/);
  await edit.click();
  assert.equal(await page.getByTestId("fixture-edit-count").innerText(), "2");
  assert.equal(await page.getByTestId("fixture-agenda-status").innerText(), "Concluído");
  assert.equal(await page.getByTestId("fixture-agenda-status").innerText(), "Concluído");
  assert.equal(await complete.getAttribute("aria-pressed"), "true");
  assert.equal(await complete.isEnabled(), true);
  assert.equal(await noShow.isEnabled(), true);
  assert.equal(await page.getByText("Atual · Desfazer").count(), 0);
  await stable();
  await page.screenshot({ path: `tests/evidence/appointment-buttons-v2-${mobile ? "mobile" : "desktop"}-attended.png` });
  await noShow.click();
  assert.equal(await page.getByTestId("fixture-correction-count").innerText(), "1");
  assert.match(await page.getByTestId("fixture-status").innerText(), /Não compareceu · Por receber/);
  await edit.click();
  assert.equal(await page.getByTestId("fixture-edit-count").innerText(), "3");
  assert.equal(await page.getByTestId("fixture-agenda-status").innerText(), "Não compareceu");
  assert.equal(await page.getByTestId("fixture-agenda-status").innerText(), "Não compareceu");
  assert.equal(await noShow.getAttribute("aria-pressed"), "true");
  assert.equal(await complete.isEnabled(), true);
  await stable();
  await complete.click();
  assert.equal(await page.getByTestId("fixture-correction-count").innerText(), "2");
  assert.equal(await page.getByTestId("fixture-agenda-status").innerText(), "Concluído");
  await stable();
  await complete.click();
  assert.equal(await page.getByTestId("fixture-correction-count").innerText(), "3");
  assert.match(await page.getByTestId("fixture-status").innerText(), /Em aberto · Por receber/);
  await noShow.click();
  assert.equal(await page.getByTestId("fixture-agenda-status").innerText(), "Não compareceu");
  await noShow.click();
  assert.equal(await page.getByTestId("fixture-correction-count").innerText(), "4");
  assert.equal(await page.getByTestId("fixture-agenda-status").innerText(), "Em aberto");
  await payment.click();
  const inlinePayment = page.getByTestId("inline-payment");
  assert.ok(await inlinePayment.isVisible());
  assert.equal(await page.locator("[role=dialog]").count(), 0);
  assert.match(await inlinePayment.innerText(), /50,00/);
  assert.equal(await inlinePayment.locator("select").count(), 0);
  assert.ok(await inlinePayment.getByRole("combobox", { name: "Método de pagamento" }).isVisible());
  await page.screenshot({ path: `tests/evidence/appointment-payment-controls-${mobile ? "mobile" : "desktop"}.png` });
  await inlinePayment.getByRole("button", { name: "Confirmar recebimento" }).click();
  assert.match(await page.getByTestId("fixture-status").innerText(), /Concluído · Pago manualmente/);
  assert.equal(await page.getByText("Dinheiro · pagamento manual").count(), 1);
  await page.getByRole("button", { name: "Corrigir método de pagamento" }).click();
  assert.ok(await page.getByText("Altera apenas o método; o valor e o registro do pagamento são mantidos.").isVisible());
  await page.getByRole("combobox", { name: "Método correto" }).click();
  await page.getByRole("option", { name: "Cartão" }).click();
  assert.ok(await page.getByText("Dinheiro · pagamento manual").isVisible());
  await page.getByRole("button", { name: "Guardar correção" }).click();
  assert.ok(await page.getByText("Cartão · pagamento manual").isVisible());
  assert.match(await page.getByTestId("fixture-status").innerText(), /Pago manualmente/);
  assert.ok(await page.getByText("50,00 €").first().isVisible());
  await stable();
  const undoReceipt = page.getByRole("button", { name: "Desfazer recebimento" });
  assert.ok(await undoReceipt.isVisible());
  await undoReceipt.click();
  const undoConfirmation = page.getByTestId("undo-receipt-confirmation");
  await undoConfirmation.getByRole("textbox", { name: "Motivo da correção" }).fill("Recebimento sintético lançado por engano");
  await undoConfirmation.getByRole("checkbox").check();
  await undoConfirmation.getByRole("button", { name: "Confirmar anulação" }).click();
  assert.equal(await page.getByTestId("fixture-undo-count").innerText(), "1");
  assert.match(await page.getByTestId("fixture-status").innerText(), /Em aberto · Por receber/);
  assert.equal(await page.getByTestId("fixture-agenda-status").innerText(), "Em aberto");
  await stable();
  await cancel.click();
  const confirmation = page.getByTestId("cancel-confirmation");
  assert.ok(await confirmation.getByText("Cancelar esta marcação?").isVisible());
  assert.equal(await page.getByRole("dialog", { name: "Confirmar cancelamento" }).count(), 0);
  assert.match(await page.getByTestId("fixture-status").innerText(), /Em aberto/);
  await confirmation.getByRole("button", { name: "Voltar" }).click();
  await stable();
  await cancel.click();
  await confirmation.getByRole("button", { name: "Confirmar cancelamento" }).click();
  assert.match(await page.getByTestId("fixture-status").innerText(), /Cancelado/);
  assert.equal(await page.getByTestId("fixture-agenda-status").innerText(), "Cancelado");
  assert.equal(await cancel.getAttribute("aria-pressed"), "true");
  assert.equal(await page.getByTestId("fixture-cancellation-history").innerText(), "1");
  assert.equal(await page.getByTestId("fixture-appointment-id").innerText(), "synthetic-appointment-1");
  assert.equal(await page.getByTestId("fixture-appointment-count").innerText(), "1");
  await stable();
  await page.getByRole("button", { name: "Reabrir e editar" }).click();
  assert.equal(await page.getByTestId("fixture-edit-count").innerText(), "4");
  assert.match(await page.getByTestId("fixture-status").innerText(), /Em aberto/);
  assert.equal(await page.getByTestId("fixture-agenda-status").innerText(), "Em aberto");
  assert.equal(await page.getByTestId("fixture-cancellation-history").innerText(), "1");
  assert.equal(await page.getByTestId("fixture-appointment-count").innerText(), "1");
  await stable();
  await page.getByRole("button", { name: "Fechar detalhes" }).click({ position: { x: 5, y: 5 } });
  await page.getByRole("button", { name: "Abrir serviço conjunto" }).click();
  assert.equal(await primary.count(), 3);
  assert.deepEqual(await Promise.all([complete, noShow, cancel].map((control) => control.isDisabled())), [true, true, true]);
  assert.ok(await page.getByText("Atendimento conjunto").isVisible());
  await page.getByRole("button", { name: /Encaixar/ }).click();
  assert.equal(await page.getByTestId("fixture-fit-count").innerText(), "1");
  assert.ok(await payment.isVisible());
  await payment.click();
  assert.ok(await page.getByTestId("inline-payment").getByText("Saldo da reserva").isVisible());
  await page.getByTestId("inline-payment").getByRole("button", { name: "Confirmar recebimento" }).click();
  assert.match(await page.getByTestId("fixture-status").innerText(), /Em aberto · Pago manualmente/);
  assert.equal(await page.getByTestId("fixture-agenda-status").innerText(), "Em aberto");
  await page.screenshot({ path: `tests/evidence/appointment-buttons-v2-${mobile ? "mobile" : "desktop"}-joint.png` });
  await page.getByRole("button", { name: "Fechar detalhes" }).click({ position: { x: 5, y: 5 } });
  await page.getByRole("button", { name: "Abrir pagamento Stripe" }).click();
  assert.equal(await page.getByRole("button", { name: "Desfazer recebimento" }).count(), 0);
  assert.equal(await payment.count(), 0);
  assert.ok(await page.getByText("Stripe · pagamento confirmado").isVisible());
  assert.deepEqual(errors, []);
  console.log(`Botões fixos, estados, pagamento manual, confirmação e serviço conjunto (${mobile ? "mobile" : "desktop"}): OK`);
} finally {
  await browser?.close();
  await server.close();
}
