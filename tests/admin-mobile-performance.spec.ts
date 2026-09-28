import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("mobile admin avoids duplicate reference queries and nonessential analytics work", async () => {
  const [studioHook, shell, overview, notifications] = await Promise.all([
    readFile("src/hooks/use-current-studio.ts", "utf8"),
    readFile("src/routes/_authenticated/admin.tsx", "utf8"),
    readFile("src/routes/_authenticated/admin.index.tsx", "utf8"),
    readFile("src/components/admin-notifications.tsx", "utf8"),
  ]);

  expect(studioHook).toContain("ADMIN_REFERENCE_STALE_MS");
  expect(studioHook).toContain("refetchOnMount: false");
  expect(studioHook).toContain('studios.filter((studio) => studio.role === "staff")');
  expect(studioHook).toContain("if (staffStudios.length === 0) return studios");
  expect(shell).not.toContain("sessionReady");
  expect(shell).toContain("platformSubscriptionSummaryQueryKey(studio?.id)");
  expect(shell).toContain('import("@/components/admin-notifications")');
  expect(shell).toContain("notificationsReady ? (");
  expect(overview).toContain("platformSubscriptionSummaryQueryKey(studio?.id)");
  expect(overview).toContain("Date.now() - 60 * DAY_MS");
  expect(overview).toContain("staleTime: ADMIN_REFERENCE_STALE_MS");
  expect(overview).toContain("gcTime: ADMIN_REFERENCE_GC_MS");
  expect(overview).toContain("refetchOnMount: false");
  expect(overview).toContain('.select("id", { count: "exact", head: true })');
  expect(overview).not.toContain("total_spent,total_visits");
  expect(overview).toContain("desktopLayout && (");
  expect(overview).toContain("reportsOpen && (");
  expect(overview).toContain('import("@/components/dashboard/daily-movement-chart")');
  expect(overview).not.toContain('from "recharts"');
  expect(notifications).toContain("scheduleNonCriticalNotificationTask");
  expect(notifications).toContain("NOTIFICATION_BACKGROUND_DELAY_MS");
});
