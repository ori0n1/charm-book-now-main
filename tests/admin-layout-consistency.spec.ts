import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("the admin shell exposes the wide Recebimentos layout rhythm to every panel page", async () => {
  const source = await readFile("src/routes/_authenticated/admin.tsx", "utf8");

  expect(source).toContain("admin-content mx-auto max-w-[88rem]");
  expect(source).toContain("md:px-5");
  expect(source).toContain("md:pt-5");
});

test("Comunicação uses a compact responsive header and wide content grid", async () => {
  const source = await readFile("src/routes/_authenticated/admin.whatsapp.tsx", "utf8");

  expect(source).toContain("max-w-[88rem]");
  expect(source).toContain("lg:grid-cols-[minmax(0,1fr)_23rem]");
  expect(source).toContain("xl:grid-cols-[minmax(0,1fr)_23rem]");
  expect(source).toContain("xl:sticky xl:top-24");
});

test("desktop navigation exposes signal and commission settings beside financial management", async () => {
  const [shellSource, overviewSource] = await Promise.all([
    readFile("src/routes/_authenticated/admin.tsx", "utf8"),
    readFile("src/routes/_authenticated/admin.index.tsx", "utf8"),
  ]);

  expect(shellSource).toContain('to: "/admin/sinal"');
  expect(shellSource).toContain('label: "Sinal online"');
  expect(shellSource).toContain('to: "/admin/comissoes"');
  expect(shellSource).toContain('label: "Comissões"');
  expect(shellSource.indexOf('to: "/admin/recebimento"')).toBeLessThan(
    shellSource.indexOf('to: "/admin/sinal"'),
  );
  expect(shellSource.indexOf('to: "/admin/sinal"')).toBeLessThan(
    shellSource.indexOf('to: "/admin/comissoes"'),
  );
  expect(overviewSource).toContain('<MobileShortcut to="/admin/comissoes" label="Comissões" />');
  expect(overviewSource).toContain('<MobileShortcut to="/admin/sinal" label="Sinal" />');
});

test("dense panel collections gain columns instead of extending vertical lists", async () => {
  const [services, referrals, premium] = await Promise.all([
    readFile("src/routes/_authenticated/admin.servicos.tsx", "utf8"),
    readFile("src/routes/_authenticated/admin.indicacoes.tsx", "utf8"),
    readFile("src/routes/_authenticated/admin.premium.tsx", "utf8"),
  ]);

  expect(services).toContain("md:grid-cols-2 xl:grid-cols-3");
  expect(referrals).toContain("xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]");
  expect(premium).toContain('id="opcoes-planos" className="grid min-w-0 scroll-mt-24 items-stretch gap-3 md:grid-cols-3"');
});

test("pricing pages share a compact decision-first information architecture", async () => {
  const [landing, premium, shell, presentation] = await Promise.all([
    readFile("src/routes/index.tsx", "utf8"),
    readFile("src/routes/_authenticated/admin.premium.tsx", "utf8"),
    readFile("src/routes/_authenticated/admin.tsx", "utf8"),
    readFile("src/components/plans/plan-presentation.tsx", "utf8"),
  ]);

  for (const source of [landing, premium]) {
    expect(source).toContain("PlanPeriodToggle");
    expect(source).toContain("PlanSummaryCard");
    expect(source).toContain("PlanComparison");
  }
  expect(presentation).toContain('<details data-testid="plan-comparison"');
  expect(presentation).toContain('const [mobileTier, setMobileTier]');
  expect(presentation).toContain('className="md:hidden"');
  expect(presentation).toContain("min-h-11 rounded-xl");
  expect(landing).toContain("<SnapCarousel");
  expect(landing).toContain("<ProductShowcase />");
  expect(landing).not.toContain("plan.limitations.map");
  expect(premium).not.toContain("O plano certo para cada fase do seu negócio.");

  const header = shell.slice(shell.indexOf("<header"), shell.indexOf("</header>"));
  expect(header).not.toContain('to="/admin/premium"');
  expect(shell).toContain('to: "/admin/premium"');
  expect(shell).toContain('label: "Assinatura"');
  expect(premium).toContain("rounded-2xl border border-border/80 bg-card p-4");
  expect(premium).toContain("grid size-11 shrink-0 place-items-center");
});

test("all panel text containers have a safe overflow fallback", async () => {
  const source = await readFile("src/styles.css", "utf8");

  expect(source).toContain(".admin-content > *");
  expect(source).toContain(".admin-content :where(p, h1, h2, h3, h4, label, span)");
  expect(source).toContain("overflow-wrap: anywhere");
});
