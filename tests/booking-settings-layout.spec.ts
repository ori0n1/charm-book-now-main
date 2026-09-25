import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

const widths = [320, 375, 390, 430, 768, 1280];

test("booking settings cards wrap all content without horizontal overflow", async ({ page }) => {
  const source = await readFile("src/routes/_authenticated/admin.marca.tsx", "utf8");
  expect(source).toContain("w-full min-w-0 max-w-full !whitespace-normal");
  expect(source).toContain('data-testid="booking-mode-description"');
  expect(source).toContain("[overflow-wrap:anywhere]");

  await page.goto("/login");
  await page.setContent(`
    <link rel="stylesheet" href="/src/styles.css" />
    <main class="admin-content w-full p-3">
      <section data-testid="booking-flow-settings" class="min-w-0 max-w-full space-y-4 border p-3 md:p-4">
        <div class="grid w-full min-w-0 max-w-full gap-2 md:grid-cols-2">
          ${option("Agendamento online", "Mantém a confirmação, disponibilidade e pagamentos atuais.")}
          ${option("Solicitação pelo WhatsApp", "Recolhe a preferência; o estúdio confirma depois na Agenda.")}
        </div>
        <div class="w-full min-w-0 max-w-full rounded-2xl border p-3">
          <p class="mb-2 max-w-full break-words text-xs font-semibold">Como os profissionais devem aparecer?</p>
          <div class="grid w-full min-w-0 max-w-full gap-2 lg:grid-cols-3">
            ${option("Não mostrar profissionais", "O estúdio distribui o atendimento.")}
            ${option("Mostrar equipa sem escolha", "A equipa fica visível apenas como catálogo.")}
            ${option("Permitir preferência", "O cliente indica uma preferência não garantida.")}
          </div>
          <p class="mt-3 max-w-full break-words text-xs leading-relaxed [overflow-wrap:anywhere]">Nenhuma solicitação cria marcação, bloqueia horário ou gera receita. WhatsApp configurado: sim.</p>
        </div>
      </section>
    </main>
  `);
  await page.locator("[data-testid='booking-flow-settings']").waitFor({ state: "visible" });

  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    const result = await page.evaluate(() => {
      const cards = [...document.querySelectorAll<HTMLElement>("[data-testid='booking-mode-option']")];
      const descriptions = [...document.querySelectorAll<HTMLElement>("[data-testid='booking-mode-description']")];
      return {
        viewport: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        cards: cards.map((card) => {
          const rect = card.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            scrollWidth: card.scrollWidth,
            clientWidth: card.clientWidth,
            scrollHeight: card.scrollHeight,
            clientHeight: card.clientHeight,
          };
        }),
        descriptions: descriptions.map((description) => {
          const rect = description.getBoundingClientRect();
          const cardRect = description.closest("button")!.getBoundingClientRect();
          const style = getComputedStyle(description);
          return {
            left: rect.left,
            right: rect.right,
            cardLeft: cardRect.left,
            cardRight: cardRect.right,
            scrollWidth: description.scrollWidth,
            clientWidth: description.clientWidth,
            whiteSpace: style.whiteSpace,
            overflowWrap: style.overflowWrap,
          };
        }),
      };
    });

    expect(result.documentWidth, `document overflow at ${width}px`).toBeLessThanOrEqual(result.viewport);
    for (const card of result.cards) {
      expect(card.left, `card left edge at ${width}px`).toBeGreaterThanOrEqual(0);
      expect(card.right, `card right edge at ${width}px`).toBeLessThanOrEqual(width);
      expect(card.scrollWidth, `card content width at ${width}px`).toBeLessThanOrEqual(card.clientWidth);
      expect(card.scrollHeight, `card content height at ${width}px`).toBeLessThanOrEqual(card.clientHeight);
    }
    for (const description of result.descriptions) {
      expect(description.left).toBeGreaterThanOrEqual(description.cardLeft);
      expect(description.right).toBeLessThanOrEqual(description.cardRight);
      expect(description.scrollWidth).toBeLessThanOrEqual(description.clientWidth);
      expect(description.whiteSpace).toBe("normal");
      expect(description.overflowWrap).toBe("anywhere");
    }
  }
});

function option(title: string, description: string) {
  return `
    <button type="button" data-testid="booking-mode-option" class="h-auto w-full min-w-0 max-w-full !whitespace-normal rounded-2xl border p-3 text-left align-top">
      <span class="flex min-w-0 max-w-full items-start gap-2">
        <span class="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border"></span>
        <span class="min-w-0 max-w-full flex-1">
          <span class="block max-w-full !whitespace-normal text-sm font-semibold leading-snug [overflow-wrap:anywhere]">${title}</span>
          <span data-testid="booking-mode-description" class="mt-1 block max-w-full !whitespace-normal text-xs leading-relaxed [overflow-wrap:anywhere]">${description}</span>
        </span>
      </span>
    </button>`;
}
