import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

const agendaSource = readFile("src/routes/_authenticated/admin.agenda.tsx", "utf8");
const agendaAccessSource = readFile("src/lib/agenda-access.functions.ts", "utf8");
const drawerSource = readFile(
  "src/components/agenda/timeline-appointment-drawer.tsx",
  "utf8",
);

test("appointment details use the existing client profile avatar with a shared fallback", async () => {
  const [agenda, agendaAccess, drawer] = await Promise.all([
    agendaSource,
    agendaAccessSource,
    drawerSource,
  ]);

  expect(agendaAccess).toContain("clients(name,phone,avatar_url,date_of_birth)");
  expect(agenda).toContain("clientAvatarUrl: timelineDetailAppt.clients?.avatar_url");
  expect(drawer).toContain('import { ClientAvatar } from "@/components/client-avatar"');
  expect(drawer).toContain("avatarUrl={details.clientAvatarUrl}");
});

test("cancel action spans the full final row without changing its handler", async () => {
  const drawer = await drawerSource;

  expect(drawer).toContain('action.id === "cancel" ? "col-span-2 w-full" : ""');
  expect(drawer).toContain(
    'action.id === "cancel" ? () => setConfirmingCancel(true) : action.onClick',
  );
  expect(drawer).toContain("onClick={onConfirmCancel}");
});
