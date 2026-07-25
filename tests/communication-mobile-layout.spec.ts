import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("communication campaign cards use a compact two-column mobile grid", async () => {
  const source = await readFile("src/routes/_authenticated/admin.whatsapp.tsx", "utf8");

  expect(source).toContain("grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]");
  expect(source).toContain("min-h-[6.25rem]");
  expect(source).toContain("sm:min-h-[3.9rem] sm:flex-row");
  expect(source).toContain("grid grid-cols-2 gap-2.5 lg:grid-cols-[1fr_auto_auto]");
});
