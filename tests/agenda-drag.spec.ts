import { test, expect } from "@playwright/test";

const fixture = "http://127.0.0.1:4178/";
test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => route.request().url().includes("tanstack-start-client-entry")
    ? route.abort() : route.continue());
});

test("desktop drag shows a target in another professional column", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(fixture, { waitUntil: "domcontentloaded" });
  await page.addScriptTag({ url: "/tests/agenda-drag-harness.tsx", type: "module" });
  const card = page.getByRole("button", { name: /Cliente sintética/ });
  const target = page.locator('[data-agenda-staff-column="staff-b"]');
  await expect(card).toBeVisible();
  await card.dragTo(target, { targetPosition: { x: 60, y: 180 } });
  await expect.poll(() => page.evaluate(() => (window as any).__drops.length)).toBe(1);
  const drop = await page.evaluate(() => (window as any).__drops[0]);
  expect(drop.id).toBe("appointment-a:line-a");
  expect(drop.staffId).toBe("staff-b");
  expect(drop.minutes % 15).toBe(0);
});

test("mobile long press moves to a professional tab without opening details", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(fixture, { waitUntil: "domcontentloaded" });
  await page.addScriptTag({ url: "/tests/agenda-drag-harness.tsx", type: "module" });
  const card = page.getByRole("button", { name: /Cliente sintética/ });
  const tab = page.locator('[data-agenda-professional-tab="staff-b"]');
  await expect(card).toBeVisible();
  const start = await card.boundingBox();
  const end = await tab.boundingBox();
  expect(start && end).toBeTruthy();
  await page.evaluate(async ({ start, end }) => {
    const card = document.querySelector('[data-timeline-entry="appointment"]')!;
    const x = start!.x + start!.width / 2;
    const y = start!.y + start!.height / 2;
    const touch = (target: EventTarget, clientX: number, clientY: number) =>
      new Touch({ identifier: 1, target, clientX, clientY });
    card.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [touch(card, x, y)], targetTouches: [touch(card, x, y)], changedTouches: [touch(card, x, y)] }));
    await new Promise(resolve => setTimeout(resolve, 520));
    const targetX = end!.x + end!.width / 2;
    const targetY = end!.y + end!.height / 2;
    window.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, cancelable: true,
      touches: [touch(card, targetX, targetY)], changedTouches: [touch(card, targetX, targetY)] }));
    window.dispatchEvent(new TouchEvent("touchend", { bubbles: true, changedTouches: [touch(card, targetX, targetY)] }));
  }, { start, end });
  await expect.poll(() => page.evaluate(() => (window as any).__drops)).toEqual([
    { id: "appointment-a:line-a", staffId: "staff-b", minutes: 600 },
  ]);
  expect(await page.evaluate(() => (window as any).__opened)).toBe(0);
});

test("successful attendance closes details on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${fixture}?drawer=success`, { waitUntil: "domcontentloaded" });
  await page.addScriptTag({ url: "/tests/agenda-drag-harness.tsx", type: "module" });
  await page.getByRole("button", { name: "Compareceu" }).click();
  await expect(page.getByText("Detalhes da marcação")).toHaveCount(0);
});

test("failed action keeps details open on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${fixture}?drawer=failure`, { waitUntil: "domcontentloaded" });
  await page.addScriptTag({ url: "/tests/agenda-drag-harness.tsx", type: "module" });
  await page.getByRole("button", { name: "Compareceu" }).click();
  await expect(page.getByText("Detalhes da marcação")).toBeVisible();
  await page.getByRole("button", { name: "Cancelar marcação" }).click();
  await page.getByRole("button", { name: "Confirmar cancelamento" }).click();
  await expect(page.getByText("Detalhes da marcação")).toBeVisible();
});

test("color preference persists per studio after a reload", async ({ page }) => {
  await page.goto(`${fixture}?color=studio-a`, { waitUntil: "domcontentloaded" });
  await page.addScriptTag({ url: "/tests/agenda-drag-harness.tsx", type: "module" });
  await page.getByRole("button", { name: "Verde água" }).click();
  await expect(page.getByTestId("agenda-color-value")).toHaveText("teal");
  await page.reload();
  await page.addScriptTag({ url: "/tests/agenda-drag-harness.tsx", type: "module" });
  await expect(page.getByTestId("agenda-color-value")).toHaveText("teal");
  await page.goto(`${fixture}?color=studio-b`, { waitUntil: "domcontentloaded" });
  await page.addScriptTag({ url: "/tests/agenda-drag-harness.tsx", type: "module" });
  await expect(page.getByTestId("agenda-color-value")).toHaveText("sky");
});
