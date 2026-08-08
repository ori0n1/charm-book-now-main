import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("reschedule modal and its pickers use an ordered portal layer", async () => {
  const [agenda, datePicker] = await Promise.all([
    readFile("src/routes/_authenticated/admin.agenda.tsx", "utf8"),
    readFile("src/components/ui/premium-date-picker.tsx", "utf8"),
  ]);

  expect(agenda).toContain("return createPortal(");
  expect(agenda).toContain("document.body");
  expect(agenda).toContain('title="Reagendar marcação"');
  expect(agenda).toContain('portalLayer="modal"');
  expect(agenda).toContain('aria-modal="true"');

  expect(datePicker).toContain('portalLayer?: "default" | "modal"');
  expect(datePicker).toContain('portalLayer === "modal" && "z-[120]"');
  expect(datePicker).toContain('portalLayer === "modal" && "z-[130]"');
  expect(datePicker).toContain("collisionPadding={12}");
});
