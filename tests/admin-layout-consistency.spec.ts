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

test("dense panel collections gain columns instead of extending vertical lists", async () => {
  const [services, referrals, premium] = await Promise.all([
    readFile("src/routes/_authenticated/admin.servicos.tsx", "utf8"),
    readFile("src/routes/_authenticated/admin.indicacoes.tsx", "utf8"),
    readFile("src/routes/_authenticated/admin.premium.tsx", "utf8"),
  ]);

  expect(services).toContain("md:grid-cols-2 xl:grid-cols-3");
  expect(referrals).toContain("xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]");
  expect(premium).toContain('className="mt-5 grid items-stretch gap-4 sm:grid-cols-2"');
});

test("all panel text containers have a safe overflow fallback", async () => {
  const source = await readFile("src/styles.css", "utf8");

  expect(source).toContain(".admin-content > *");
  expect(source).toContain(".admin-content :where(p, h1, h2, h3, h4, label, span)");
  expect(source).toContain("overflow-wrap: anywhere");
});
