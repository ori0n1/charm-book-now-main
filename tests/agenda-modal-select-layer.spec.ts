import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

test("mantem os seletores da marcacao acima do modal e dentro do viewport", async () => {
  const agendaSource = await readFile(
    resolve(process.cwd(), "src/routes/_authenticated/admin.agenda.tsx"),
    "utf8",
  );
  const selectSource = await readFile(
    resolve(process.cwd(), "src/components/ui/select.tsx"),
    "utf8",
  );

  expect(agendaSource).toContain('fixed inset-0 z-[100]');
  expect(agendaSource).toContain('const modalSelectContentCls =');
  expect(agendaSource).toContain('"z-[120] rounded-2xl');
  const safelyLayeredSelectContents = agendaSource.match(/<SelectContent className=\{modalSelectContentCls\}>/g) ?? [];
  expect(safelyLayeredSelectContents).toHaveLength(5);

  expect(selectSource).toContain("<SelectPrimitive.Portal>");
  expect(selectSource).toContain('position = "popper"');
  expect(selectSource).toContain("var(--radix-select-content-available-height)");
  expect(selectSource).toContain("overflow-y-auto");
  expect(selectSource).toContain("collisionPadding={12}");
});
