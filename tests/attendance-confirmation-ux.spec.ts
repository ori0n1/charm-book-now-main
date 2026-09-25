import { expect, test, type Page } from "@playwright/test";

async function mountAttendanceSheet(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "lumiere.cookies.preferences",
      JSON.stringify({ essential: true, analytics: false, marketing: false }),
    );
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !("$_TSR" in window));
  await page.locator("body").evaluate((body) => {
    const root = document.createElement("main");
    root.id = "attendance-test-root";
    body.append(root);
  });
  await page.addScriptTag({
    type: "module",
    url: "/tests/fixtures/attendance-confirmation-harness.tsx",
  });
  await expect(page.getByTestId("attendance-pending-sheet")).toBeVisible();
}

for (const viewport of [
  { name: "mobile-320", width: 320, height: 720 },
  { name: "tablet-768", width: 768, height: 900 },
  { name: "desktop-1440", width: 1440, height: 1000 },
]) {
  test(`grouped attendance sheet is compact and usable on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await mountAttendanceSheet(page);

    const items = page.getByTestId("attendance-pending-item");
    await expect(items).toHaveCount(12);
    await expect(page.getByRole("heading", { name: "Atendimentos por confirmar" })).toBeVisible();

    await page.screenshot({
      path: `artifacts/attendance-confirmation-${viewport.name}.png`,
      fullPage: false,
    });
  });
}

test("resolved item disappears immediately from the grouped sheet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mountAttendanceSheet(page);
  const attendedButtons = page.getByRole("button", { name: "Compareceu" });
  expect(await attendedButtons.count()).toBe(12);
  await attendedButtons.first().click();
  await expect(page.getByTestId("attendance-pending-item")).toHaveCount(11);
  await expect(page.getByText("Cliente 1", { exact: true })).toHaveCount(0);
});

test("select all resolves the complete grouped review in one bulk action", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mountAttendanceSheet(page);
  await page.getByRole("checkbox", { name: /Selecionar todos/ }).check();
  await expect(page.getByText("12 de 12")).toBeVisible();
  await page.getByTestId("attendance-bulk-completed").click();
  await expect(page.getByTestId("attendance-pending-sheet")).toHaveCount(0);
});
