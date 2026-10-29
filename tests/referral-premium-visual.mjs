import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const output = new URL("../tmp/referral-premium-visual/", import.meta.url);
await mkdir(output, { recursive: true });
try {
  for (const [name, width, height] of [
    ["desktop", 1280, 900],
    ["mobile", 390, 844],
  ]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("http://127.0.0.1:4180/tests/referral-premium-fixture.html", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.getByText("Receba 14 dias de Premium quando elegível.").waitFor();
    const text = await page.locator("body").innerText();
    if (text.includes("8,99")) throw new Error(`${name}: old amount visible`);
    if (!text.includes("TESTE123") || !text.includes("+14 dias Premium")) {
      throw new Error(`${name}: link, code or earned reward missing`);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (overflow) throw new Error(`${name}: horizontal overflow`);
    if (errors.length) throw new Error(`${name}: ${errors.join("; ")}`);
    await page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, output)), fullPage: true });
    console.log(`${name}: text, reward, link, code and width OK`);
    await page.close();
  }
} finally {
  await browser.close();
}
