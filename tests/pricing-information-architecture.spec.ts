import { expect, test } from "@playwright/test";

const COLD_LANDING_HYDRATION_TIMEOUT_MS = 45_000;

test("landing presents concise plans in a mobile-first carousel", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator('[data-landing-interactive="true"]')).toBeVisible({
    timeout: COLD_LANDING_HYDRATION_TIMEOUT_MS,
  });
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "A forma simples e profissional de gerir o seu espaço.",
    }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Experimentar 14 dias grátis", exact: true }).first()).toHaveAttribute(
    "href",
    /signup/,
  );
  await expect(page.getByRole("link", { name: "Ver o produto", exact: true })).toHaveAttribute(
    "href",
    "#produto",
  );

  await expect(page.locator('[data-plan-card="free"]')).toBeVisible();
  await expect(page.locator('[data-plan-card="pro"]')).toBeVisible();
  await expect(page.locator('[data-plan-card="premium"]')).toBeVisible();
  for (const tier of ["free", "pro", "premium"]) {
    await expect(page.locator(`[data-plan-card="${tier}"] li`)).toHaveCount(3);
  }

  const plansCarousel = page.getByRole("region", { name: "Planos Bellza", exact: true });
  await expect(plansCarousel.locator('[data-snap-slide][data-active="true"]')).toContainText("Pro");
  await expect
    .poll(async () => plansCarousel.evaluate((element) => {
      const active = element.querySelector<HTMLElement>('[data-snap-slide][data-active="true"]');
      if (!active) return Number.POSITIVE_INFINITY;
      const rail = element.getBoundingClientRect();
      const slide = active.getBoundingClientRect();
      return Math.abs((rail.left + rail.width / 2) - (slide.left + slide.width / 2));
    }))
    .toBeLessThan(3);
  await page.getByRole("button", { name: "Mostrar Premium", exact: true }).click();
  await expect(plansCarousel.locator('[data-snap-slide][data-active="true"]')).toContainText("Premium");

  const mobileGeometry = await plansCarousel.evaluate((element) => {
    const firstSlide = element.querySelector<HTMLElement>("[data-snap-slide]");
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      slideWidth: firstSlide?.getBoundingClientRect().width ?? 0,
    };
  });
  expect(mobileGeometry.scrollWidth).toBeGreaterThan(mobileGeometry.clientWidth);
  expect(mobileGeometry.clientWidth).toBeLessThanOrEqual(390);
  expect(mobileGeometry.slideWidth).toBeLessThan(mobileGeometry.clientWidth);

  const monthlyButton = page.getByRole("button", { name: "Mensal", exact: true });
  const monthlyBox = await monthlyButton.boundingBox();
  expect(monthlyBox?.height ?? 0).toBeGreaterThanOrEqual(44);

  await page.getByRole("button", { name: "Anual −17%", exact: true }).click();
  await expect(page.locator('[data-plan-card="pro"]')).toContainText("129 €");
  await expect(page.locator('[data-plan-card="pro"]')).toContainText("Poupe 26,88 € por ano");

  const comparison = page.getByTestId("plan-comparison");
  await expect(comparison).not.toHaveAttribute("open", "");
  await comparison.locator("summary").click();
  await expect(comparison).toHaveAttribute("open", "");

  await comparison.getByRole("button", { name: "Premium", exact: true }).click();
  await expect(comparison.getByText("Recursos no Premium", { exact: true })).toBeVisible();
  await expect(
    comparison.getByTestId("mobile-plan-comparison").getByText("Incluído*", { exact: true }),
  ).toBeVisible();
});

test("product preview uses real screenshots in a compact swipe carousel", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/#produto");
  await expect(page.locator('[data-landing-interactive="true"]')).toBeVisible({
    timeout: COLD_LANDING_HYDRATION_TIMEOUT_MS,
  });

  await expect(
    page.getByText("Veja a Bellza a trabalhar antes de experimentar.", { exact: true }),
  ).toBeVisible();
  const pathnameBeforeSwitch = await page.evaluate(() => window.location.pathname);
  const productCarousel = page.getByRole("region", {
    name: "Demonstrações reais do produto Bellza",
    exact: true,
  });
  await expect(productCarousel.locator("[data-product-story]")).toHaveCount(5);
  await expect(productCarousel.locator('img[loading="lazy"]')).toHaveCount(5);
  await expect(productCarousel.locator('img[src*="/landing/product-2026/"]')).toHaveCount(5);
  await expect(productCarousel.locator('[data-snap-slide][data-active="true"]')).toContainText(
    "O dia todo sob controlo",
  );
  await page.getByRole("button", { name: "Mostrar Cada cliente com contexto", exact: true }).click();
  await expect(productCarousel.locator('[data-snap-slide][data-active="true"]')).toContainText(
    "Cada cliente com contexto",
  );
  await expect.poll(() => page.evaluate(() => window.location.pathname)).toBe(pathnameBeforeSwitch);
});

test("landing has no horizontal overflow at required breakpoints", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-landing-interactive="true"]')).toBeVisible({
    timeout: COLD_LANDING_HYDRATION_TIMEOUT_MS,
  });

  for (const width of [320, 375, 390, 430, 768, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width);
    const dimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
    }));
    expect(dimensions.scrollWidth, `overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewport);
    if (width === 390) {
      expect(
        dimensions.scrollHeight,
        "mobile landing should remain materially shorter than the previous 12,238px layout",
      ).toBeLessThan(9_000);
    }
  }
});

test("landing keeps its light premium theme and readable pricing in dark mode", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/#planos");

  await expect(page.locator(".public-landing-theme")).toHaveCSS("color-scheme", "light");

  const colors = await page.locator('[data-plan-card="pro"]').evaluate((element) => {
    const style = window.getComputedStyle(element);
    return { background: style.backgroundColor, foreground: style.color };
  });
  expect(colors.background).not.toBe(colors.foreground);
  expect(contrastRatio(colors.background, colors.foreground)).toBeGreaterThanOrEqual(4.5);
  await expect(page.getByRole("button", { name: "Escolher Pro", exact: true })).toBeVisible();
});

test("landing exposes accessible navigation, imagery and SEO metadata", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#produto");
  await expect(page.locator('[data-landing-interactive="true"]')).toBeVisible({
    timeout: COLD_LANDING_HYDRATION_TIMEOUT_MS,
  });

  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://bellza.pt/");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    /Gestão simples e profissional/,
  );

  const imagesWithoutAlt = await page.locator("img").evaluateAll((images) =>
    images.filter((image) => !image.getAttribute("alt")?.trim()).length,
  );
  expect(imagesWithoutAlt).toBe(0);

  const primaryCta = page.getByRole("link", { name: "Experimentar 14 dias grátis", exact: true }).first();
  const ctaBounds = await primaryCta.boundingBox();
  expect(ctaBounds?.height ?? 0).toBeGreaterThanOrEqual(44);

  const productCarousel = page.getByRole("region", {
    name: "Demonstrações reais do produto Bellza",
    exact: true,
  });
  await productCarousel.focus();
  await productCarousel.press("ArrowRight");
  await expect(productCarousel.locator('[data-snap-slide][data-active="true"]')).toContainText(
    "Cada cliente com contexto",
  );
});

function contrastRatio(background: string, foreground: string) {
  const luminance = (color: string) => {
    const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
    if (channels.length !== 3) throw new Error(`Unsupported CSS colour: ${color}`);
    const [red, green, blue] = channels.map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const first = luminance(background);
  const second = luminance(foreground);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}
