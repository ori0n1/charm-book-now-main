import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright";

const root = process.cwd();
const server = await createServer({
  root, configFile: false, appType: "mpa",
  resolve: { alias: { "@": resolve(root, "src") } },
  server: { host: "127.0.0.1", port: 4189, strictPort: true },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:4189/tests/visual-modal-fixture.html");
  await page.getByRole("button", { name: "Abrir detalhes" }).click();
  const drawer = page.locator("aside .overflow-y-auto").first();
  await drawer.waitFor();
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).overflow), "hidden");
  await drawer.hover();
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(200);
  const drawerScroll = await drawer.evaluate((node) => node.scrollTop);
  assert.ok(drawerScroll > 0, "drawer must scroll internally");
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  await page.mouse.move(600, 350);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  mkdirSync("tests/evidence", { recursive: true });
  await page.screenshot({ path: "tests/evidence/modal-drawer-desktop.png" });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.body).overflow), "hidden");
  await page.mouse.move(700, 500);
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(150);
  assert.ok(await page.evaluate(() => window.scrollY > 0), "background must scroll after close");
  await page.evaluate(() => window.scrollTo(0, 0));

  await page.getByRole("button", { name: "Abrir diálogo" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await dialog.hover();
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(200);
  const dialogScroll = await dialog.evaluate((node) => node.scrollTop);
  assert.ok(dialogScroll > 0, "dialog must scroll internally");
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  await page.screenshot({ path: "tests/evidence/modal-dialog-desktop.png" });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  await page.mouse.move(700, 500);
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(150);
  assert.ok(await page.evaluate(() => window.scrollY > 0), "background must scroll after dialog close");
  assert.deepEqual(errors, []);
  writeFileSync("tests/evidence/modal-scroll-desktop.json", JSON.stringify({ viewport: "1280x720", drawerScroll, dialogScroll, backgroundLocked: true, backgroundRestored: true, pageErrors: errors }, null, 2));
  console.log(JSON.stringify({ drawerScroll, dialogScroll, backgroundLocked: true, backgroundRestored: true, pageErrors: errors }));
} finally {
  await browser?.close();
  await server.close();
}
