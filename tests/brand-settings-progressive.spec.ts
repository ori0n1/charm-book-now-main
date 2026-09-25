import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const email = process.env.BELLZA_CAPTURE_EMAIL;
const password = process.env.BELLZA_CAPTURE_PASSWORD;
const responsiveWidths = [320, 360, 375, 390, 430, 768, 1024, 1280];

test("brand settings keep the existing persistence contract inside a progressive UI", async () => {
  const source = await readFile("src/routes/_authenticated/admin.marca.tsx", "utf8");
  const persistedFields = [
    "name",
    "owner_name",
    "tagline",
    "description",
    "brand_color",
    "logo_url",
    "hero_image_url",
    "hero_gallery_urls",
    "location",
    "phone",
    "whatsapp",
    "email",
    "instagram",
    "accepted_payment_methods",
    "public_amenities",
    "business_segment",
    "booking_flow_mode",
    "booking_request_professional_mode",
  ];

  for (const field of persistedFields) {
    expect(source, `missing persisted field ${field}`).toContain(`${field}:`);
  }
  expect(source).toContain('type="single"');
  expect(source).toContain("value={openSection}");
  expect(source).toContain('data-testid="brand-mobile-save-bar"');
  expect(source).toContain('window.addEventListener("beforeunload"');
  expect(source).toContain("multiple");
  expect(source).toContain("void uploadHeroImages(e.target.files)");
  expect(source).toContain('void uploadImage("logo_url", file)');
});

test("visual identity uses one compact editor without changing upload contracts", async () => {
  const source = await readFile("src/routes/_authenticated/admin.marca.tsx", "utf8");
  const visualSection = source.slice(
    source.indexOf('data-testid="brand-section-visual"'),
    source.indexOf('<AccordionItem value="studio"'),
  );

  expect(visualSection).toContain('data-testid="visual-identity-editor"');
  expect(visualSection).toContain("<CompactLogoEditor");
  expect(visualSection).toContain("<CompactBannerEditor");
  expect(visualSection).toContain("<BrandColorField");
  expect(visualSection).not.toContain("summary={visualSummary}");
  expect(visualSection).not.toContain('hint="Formato quadrado."');
  expect(visualSection).not.toContain("<HeroGalleryPreview");
  expect(visualSection).not.toContain("<ImageField");

  expect(source).toContain("function setPrimaryHeroImage(url: string)");
  expect(source).toContain(
    "const nextGallery = [url, ...currentGallery.filter((item) => item !== url)]",
  );
  expect(source).toContain("hero_image_url: url");
  expect(source).toContain('data-testid="brand-banner-preview"');
  expect(source).toContain('data-testid="brand-banner-gallery"');
  expect(source).toContain('{images.length > 0 ? "Alterar banner" : "Adicionar banner"}');
  expect(source).toContain("studioName={data.name}");
  expect(source).toContain("Logótipo do estúdio");
  expect(source).toContain("Imagem de destaque da sua página pública");
  expect(source).toContain("Será exibido na sua página e nas notificações");
  expect(source).toContain('<legend className="sr-only">Cor primária</legend>');
  expect(source).toContain("Cor primária");
  expect(source).toContain("lg:grid-cols-2");
  expect(source).toContain("aspect-[8/3]");
  expect(source).toContain("min-h-11");
  expect(source).toContain("size-11");
});

test("real brand settings are compact and overflow-safe at the required breakpoints", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  test.skip(!email || !password, "Credenciais DEMO não disponíveis neste ambiente.");
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.addInitScript(() => {
    window.localStorage.setItem(
      "lumiere.cookies.preferences",
      JSON.stringify({ essential: true, analytics: false, marketing: false }),
    );
    window.localStorage.setItem("bellza:pwa-install-dismissed", "true");
    window.localStorage.setItem("bellza:notification-prompt-dismissed", "true");
    window.localStorage.setItem("studio-pwa-install-guide", "never");
    const studioId = "a8f52b91-4e2f-4f77-9e64-9be7ad8dd901";
    for (const role of ["studio_owner", "manager", "staff", "desk_staff", "saas_owner"]) {
      window.localStorage.setItem(`bellza:admin-quick-tour:${studioId}:${role}`, "skipped");
    }
  });
  await login(page, email!, password!);
  await openBrandPage(page);

  await expect(page.getByRole("heading", { name: "Identidade visual" })).toBeVisible();
  const sectionTitles = ["Dados do estúdio", "Agendamentos", "Informações públicas"];
  for (const title of sectionTitles) {
    await expect(page.getByRole("button", { name: new RegExp(`^${title}`) })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: /^Dados do estúdio/ })).toHaveAttribute(
    "aria-expanded",
    "false",
  );

  const visualSection = page.getByTestId("brand-section-visual");
  await expect(visualSection.getByTestId("visual-identity-editor")).toBeVisible();
  await expect(visualSection.getByTestId("brand-section-summary")).toHaveCount(0);
  const emptyBanner = visualSection.getByTestId("brand-banner-empty");
  const bannerPreview = visualSection.getByTestId("brand-banner-preview");
  expect((await emptyBanner.count()) + (await bannerPreview.count())).toBe(1);

  for (const width of responsiveWidths) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      pageWidth: document
        .querySelector<HTMLElement>("[data-testid='brand-settings-page']")
        ?.getBoundingClientRect().width,
      visualWidth: document
        .querySelector<HTMLElement>("[data-testid='visual-identity-editor']")
        ?.getBoundingClientRect().width,
      visualSectionWidth: document
        .querySelector<HTMLElement>("[data-testid='brand-section-visual']")
        ?.getBoundingClientRect().width,
      visualSectionHeight: document
        .querySelector<HTMLElement>("[data-testid='brand-section-visual']")
        ?.getBoundingClientRect().height,
    }));
    expect(layout.documentWidth, `document overflow at ${width}px`).toBeLessThanOrEqual(
      layout.viewportWidth,
    );
    expect(layout.pageWidth, `page exceeds viewport at ${width}px`).toBeLessThanOrEqual(width);
    expect(layout.visualWidth, `visual editor exceeds section at ${width}px`).toBeLessThanOrEqual(
      layout.visualSectionWidth ?? width,
    );
    if (width <= 430) {
      expect(layout.visualSectionHeight, `visual section is too tall at ${width}px`).toBeLessThan(
        640,
      );
    }
    if (width === 390 || width === 1280) {
      await page.waitForTimeout(250);
      await page.screenshot({
        path: testInfo.outputPath(`brand-settings-${width}.png`),
        fullPage: true,
      });
    }
  }

  await dismissInterruptions(page);
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByText("Marca atualizada", { exact: true })).toBeVisible({
    timeout: 15_000,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await dismissInterruptions(page);
  await page.getByRole("button", { name: /^Dados do estúdio/ }).click();
  const studioName = page.getByLabel("Nome do estúdio");
  const originalName = await studioName.inputValue();
  await studioName.fill(`${originalName} `);
  await expect(page.getByTestId("brand-mobile-save-bar")).toBeVisible();
  await studioName.fill(originalName);
  await expect(page.getByTestId("brand-mobile-save-bar")).toBeHidden();

  await openBrandPage(page);
  await dismissInterruptions(page);
  await page.getByTestId("brand-section-public").getByRole("button").first().click();
  await page
    .getByTestId("brand-section-public")
    .getByRole("button", { name: /^Pagamentos/ })
    .click();
  await expect(page.getByRole("button", { name: /Concluir/ }).first()).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("brand-settings-page")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("visual-identity-editor")).toBeVisible();
  const unexpectedErrors = browserErrors.filter(
    (message) =>
      !(message.includes("A tree hydrated but some attributes") && message.includes('nonce=""')),
  );
  expect(unexpectedErrors).toEqual([]);
});

async function login(page: Page, userEmail: string, userPassword: string) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  if (new URL(page.url()).pathname.startsWith("/admin")) return;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const hydrated = await page.evaluate(() => !("$_TSR" in window)).catch(() => false);
    if (hydrated) break;
    await page.waitForTimeout(100);
  }
  await page.locator('input[name="identifier"]').waitFor({ state: "visible", timeout: 30_000 });
  await page.locator('input[name="identifier"]').fill(userEmail);
  await page.locator('input[name="password"]').fill(userPassword);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  for (let attempt = 0; attempt < 225; attempt += 1) {
    if (new URL(page.url()).pathname.startsWith("/admin")) return;
    const toast = page.locator("[data-sonner-toast]").first();
    if (await toast.isVisible().catch(() => false)) {
      throw new Error("O login DEMO foi recusado pelo ambiente de teste.");
    }
    await page.waitForTimeout(200);
  }
  throw new Error("O login DEMO não concluiu dentro do tempo esperado.");
}

async function openBrandPage(page: Page) {
  if (new URL(page.url()).pathname !== "/admin/marca") {
    await page.goto("/admin/marca", { waitUntil: "domcontentloaded" });
  }
  await expect(page.getByTestId("brand-settings-page")).toBeVisible({ timeout: 30_000 });
}

async function dismissInterruptions(page: Page) {
  for (const label of ["Fechar", "Pular", "Lembrar depois"]) {
    const buttons = page.getByRole("button", { name: label, exact: true });
    for (let index = 0; index < (await buttons.count()); index += 1) {
      const button = buttons.nth(index);
      if (await button.isVisible().catch(() => false)) {
        await button.click({ force: true });
      }
    }
  }
}
