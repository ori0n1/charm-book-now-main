import { expect, test, type Page } from "@playwright/test";

const PUBLIC_URL = process.env.BELLZA_PUBLIC_BOOKING_URL ?? "";
const bookingTarget = PUBLIC_URL ? new URL(PUBLIC_URL) : null;
test.skip(
  !bookingTarget || !["127.0.0.1", "localhost", "qflwsdrgdkkcxjnbxmis.supabase.co"].includes(bookingTarget.hostname),
  "Requires an explicit local/staging booking fixture; production reads are forbidden.",
);
const FUTURE_DAY_PATTERN = /seg/i;

function nextMondayDayNumber() {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  const daysUntilMonday = (8 - date.getDay()) % 7 || 7;
  date.setDate(date.getDate() + daysUntilMonday);
  return String(date.getDate());
}

async function selectNextMonday(page: Page) {
  const target = page
    .getByRole("button", {
      name: new RegExp(`${FUTURE_DAY_PATTERN.source}\\s*${nextMondayDayNumber()}`, "i"),
    })
    .first();

  if (!(await target.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: /Próxima semana/i }).click();
  }

  await expect(target).toBeVisible({ timeout: 10_000 });
  await target.click();
}

type RpcCapture = {
  url: string;
  status: number;
  payload: string | null;
  responsePreview: string;
};

async function preparePage(page: Page, captures: RpcCapture[]) {
  page.on("response", async (response) => {
    if (!response.url().includes("/rpc/get_available_slots")) return;
    let responsePreview = "";
    try {
      responsePreview = (await response.text()).slice(0, 700);
    } catch {
      responsePreview = "<unreadable>";
    }
    captures.push({
      url: response.url(),
      status: response.status(),
      payload: response.request().postData(),
      responsePreview,
    });
  });

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
}

async function pickServiceProfessionalAndDate(page: Page, serviceName: string, staffName: string) {
  await page.goto(PUBLIC_URL, { waitUntil: "domcontentloaded" });
  const showMore = page.getByRole("button", { name: /Ver mais \d+ servi.+os/i }).first();
  const service = page.getByText(serviceName, { exact: false }).first();
  const search = page.getByPlaceholder(/Pesquisar serviço/i).first();
  await expect(async () => {
    if (await service.isVisible().catch(() => false)) return;
    if (await showMore.isVisible().catch(() => false)) await showMore.click();
    if (!(await service.isVisible().catch(() => false)) && (await search.isVisible().catch(() => false))) {
      await search.fill(serviceName);
    }
    await expect(service).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });

  await page
    .locator("article")
    .filter({ hasText: serviceName })
    .getByRole("button", { name: /^agendar$/i })
    .first()
    .click();
  await page.getByRole("button", { name: /^continuar$/i }).click();

  await selectNextMonday(page);

  const staffButton = page.getByRole("button", { name: new RegExp(staffName, "i") }).first();
  await expect(staffButton).toBeVisible({ timeout: 10_000 });
  await staffButton.click();
}

async function expectSlots(page: Page) {
  const timeButtons = page.locator("button").filter({ hasText: /^\d{2}:\d{2}$/ });
  await expect(timeButtons.first()).toBeVisible({ timeout: 15_000 });
  expect(await timeButtons.count()).toBeGreaterThan(0);
  await expect(page.getByText(/Não encontramos horários livres/i)).toHaveCount(0);
  await expect(page.getByText(/sem profissionais disponíveis/i)).toHaveCount(0);
}

async function runStudio27AvailabilityAudit(page: Page, suffix: string) {
  const captures: RpcCapture[] = [];
  await preparePage(page, captures);

  const cases = [
    { service: "Corte de cabelo", staff: "Paula", screenshot: `artifacts/studio27-corte-paula-slots-${suffix}.png` },
    { service: "Corte de cabelo", staff: "Ana Silva", screenshot: `artifacts/studio27-corte-ana-slots-${suffix}.png` },
    { service: "Brushing", staff: "Ana Silva", screenshot: `artifacts/studio27-brushing-ana-slots-${suffix}.png` },
    { service: "Hidratação capilar", staff: "Paula", screenshot: `artifacts/studio27-hidratacao-paula-slots-${suffix}.png` },
  ];

  for (const item of cases) {
    await pickServiceProfessionalAndDate(page, item.service, item.staff);
    await expectSlots(page);
    await page.screenshot({ path: item.screenshot, fullPage: true });
  }

  expect(captures.length).toBeGreaterThanOrEqual(cases.length);
  const capturesWithSlots = captures.filter((capture) => capture.responsePreview.includes("slot_label"));
  expect(capturesWithSlots.length).toBeGreaterThanOrEqual(cases.length);
  for (const capture of captures) {
    expect(capture.status).toBe(200);
  }
  console.info("[availability-root-cause-network]", JSON.stringify(captures, null, 2));
}

test("studio27 real booking flow shows availability for three services and two professionals on mobile", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await runStudio27AvailabilityAudit(page, "mobile");
});

test("studio27 real booking flow shows availability for three services and two professionals on desktop", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  await runStudio27AvailabilityAudit(page, "desktop");
});
