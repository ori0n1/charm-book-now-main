import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("agenda appointment times stay on one line on mobile and desktop", async () => {
  const source = await readFile("src/routes/_authenticated/admin.agenda.tsx", "utf8");

  expect(source).toContain("grid-cols-[4rem_2.5rem_minmax(0,1fr)_2rem]");
  expect(source.match(/whitespace-nowrap/g)?.length).toBeGreaterThanOrEqual(2);
  expect(source).toContain("items-center justify-center whitespace-nowrap");
  expect(source).toContain("{time}");
  expect(source).toContain("{timeEnd}");
});

test("agenda revenue value keeps the amount and currency on one line", async () => {
  const source = await readFile("src/routes/_authenticated/admin.agenda.tsx", "utf8");

  expect(source).toContain("inline-flex max-w-full flex-nowrap items-center whitespace-nowrap");
  expect(source).toContain("text-[clamp(1.125rem,4.8vw,1.5rem)]");
});
