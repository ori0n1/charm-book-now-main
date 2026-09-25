import { expect, test, type Page } from "@playwright/test";

const demoEmail = process.env.BELLZA_DEMO_EMAIL;
const demoPassword = process.env.BELLZA_DEMO_PASSWORD;

test.describe("financeiro autenticado", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!demoEmail || !demoPassword, "Credenciais demo não configuradas para o smoke test ao vivo.");

  for (const viewport of [
    { name: "mobile", width: 390, height: 844 },
    { name: "desktop", width: 1440, height: 1000 },
  ]) {
    test(`${viewport.name}: KPIs reconciliam e filtros permanecem utilizáveis`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await login(page);
      await page.goto("/admin/pagamentos");
      await expect(page.getByRole("heading", { name: "Visão financeira" })).toBeVisible();

      const period = page.getByRole("combobox", { name: "Período do financeiro" });
      await period.click();
      await page.getByRole("option", { name: "Todo o histórico" }).click();

      const received = page.locator('[data-finance-kpi="received"] > [data-finance-cents]');
      const pending = page.locator('[data-finance-kpi="pending"] > [data-finance-cents]');
      const realized = page.locator('[data-finance-kpi="realized"] [data-finance-cents]');
      await expect(received).toHaveAttribute("data-finance-cents", /^\d+$/, { timeout: 20_000 });
      await expect(pending).toHaveAttribute("data-finance-cents", /^\d+$/);
      await expect(realized).toHaveAttribute("data-finance-cents", /^\d+$/);
      const receivedCents = Number(await received.getAttribute("data-finance-cents"));

      const receivedCard = page.locator('[data-finance-kpi="received"]');
      const components = await receivedCard.locator("dd[data-finance-cents]").evaluateAll((nodes) =>
        nodes.map((node) => Number(node.getAttribute("data-finance-cents") ?? 0)),
      );
      expect(components.reduce((sum, cents) => sum + cents, 0)).toBe(receivedCents);

      const showMoreStaff = page.getByRole("button", { name: /Ver mais .*profissiona/ });
      if (await showMoreStaff.count()) await showMoreStaff.click();
      const staffRows = page.locator("[data-staff-received-cents]");
      const visibleStaffTotal = await staffRows.evaluateAll((nodes) =>
        nodes.reduce(
          (sum, node) => sum + Number(node.getAttribute("data-staff-received-cents") ?? 0),
          0,
        ),
      );
      expect(visibleStaffTotal).toBe(receivedCents);

      await page.getByRole("button", { name: /Filtros/ }).click();
      await expect(page.getByRole("heading", { name: "Filtros do financeiro" })).toBeVisible();
      await expect(page.getByText("Forma de pagamento", { exact: true })).toBeVisible();

      const bodyWidth = await page.locator("body").evaluate((body) => body.scrollWidth);
      expect(bodyWidth).toBeLessThanOrEqual(viewport.width);
      await page.screenshot({ path: testInfo.outputPath(`financeiro-${viewport.name}.png`), fullPage: true });
    });
  }
});

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email ou WhatsApp").fill(demoEmail!);
  await page.getByLabel("Palavra-passe").fill(demoPassword!);
  await Promise.all([
    page.waitForURL(/\/admin(?:\/|$)/, { timeout: 20_000 }),
    page.getByRole("button", { name: "Entrar", exact: true }).click(),
  ]);
}
