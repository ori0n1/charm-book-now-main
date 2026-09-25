import { expect, test } from "@playwright/test";

const PUBLIC_BOOKING_URL = process.env.BELLZA_PUBLIC_BOOKING_URL ?? "";
const bookingTarget = PUBLIC_BOOKING_URL ? new URL(PUBLIC_BOOKING_URL) : null;
test.skip(
  !bookingTarget || !["127.0.0.1", "localhost", "qflwsdrgdkkcxjnbxmis.supabase.co"].includes(bookingTarget.hostname),
  "Requires an explicit local/staging booking fixture; production reads are forbidden.",
);

function nextMondayDayNumber() {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  const daysUntilMonday = (8 - date.getDay()) % 7 || 7;
  date.setDate(date.getDate() + daysUntilMonday);
  return String(date.getDate());
}

async function selectNextMonday(page: import("@playwright/test").Page) {
  const target = page
    .getByRole("button", { name: new RegExp(`seg\\s*${nextMondayDayNumber()}`, "i") })
    .first();

  if (!(await target.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: /Próxima semana/i }).click();
  }

  await expect(target).toBeVisible({ timeout: 10_000 });
  await target.click();
}

async function assertFutureAvailability(page: import("@playwright/test").Page, screenshotPath: string) {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "lumiere.cookies.preferences",
      JSON.stringify({
        essential: true,
        analytics: false,
        marketing: false,
        savedAt: new Date().toISOString(),
      }),
    );
  });
  await page.goto(PUBLIC_BOOKING_URL, { waitUntil: "domcontentloaded" });

  await expect(page.getByText("Corte masculino", { exact: false }).first()).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: /^agendar$/i }).last().click();
  await page.getByRole("button", { name: /^continuar$/i }).click();
  await expect(page.getByRole("heading", { name: "Disponibilidade" })).toBeVisible({
    timeout: 10_000,
  });

  const professionalButton = page.getByRole("button", { name: /teste/i }).first();
  if (await professionalButton.isVisible().catch(() => false)) {
    await professionalButton.click();
  }

  await selectNextMonday(page);

  const timeButtons = page.locator("button").filter({ hasText: /^\d{2}:\d{2}$/ });
  await expect(timeButtons.first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Não encontramos horários livres/i)).toHaveCount(0);
  await expect(page.getByText(/sem profissionais disponíveis/i)).toHaveCount(0);
  expect(await timeButtons.count()).toBeGreaterThan(0);

  await page.screenshot({
    path: screenshotPath,
    fullPage: true,
  });
}

test("public booking shows available slots for a free future working day on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await assertFutureAvailability(page, "artifacts/booking-availability-future-slots-mobile.png");
});

test("public booking shows available slots for a free future working day on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await assertFutureAvailability(page, "artifacts/booking-availability-future-slots-desktop.png");
});
