import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("Central metrics keeps compact responsive cards and unbroken monetary values", async () => {
  const [ui, metricsPage] = await Promise.all([
    readFile("src/components/central/central-ui.tsx", "utf8"),
    readFile("src/routes/_authenticated/admin.central-metricas.tsx", "utf8"),
  ]);

  expect(ui).toContain("inline-flex flex-nowrap whitespace-nowrap");
  expect(ui).toContain("text-[clamp(1rem,4.2vw,1.8rem)]");
  expect(metricsPage.match(/grid-cols-2/g)?.length).toBeGreaterThanOrEqual(2);
  expect(metricsPage).toContain('label="Receita Bellza"');
  expect(metricsPage).toContain('label="Volume dos estúdios"');
  expect(metricsPage).toContain('label="Pendentes"');
  expect(metricsPage).toContain('label="Não compareceram"');
});

test("Central routes and exports remain restricted to the SaaS owner", async () => {
  const source = await readFile("src/lib/platform-metrics.functions.ts", "utf8");

  expect(source.match(/assertSaasOwner/g)?.length).toBeGreaterThanOrEqual(3);
  expect(source.match(/middleware\(\[requireSupabaseAuth\]\)/g)?.length).toBeGreaterThanOrEqual(2);
  expect(source).toContain('format: z.enum(["csv", "excel"])');
  expect(source).not.toContain("client_name");
  expect(source).not.toContain("client_phone");
});
