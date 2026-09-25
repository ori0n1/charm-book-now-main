import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { assessClientRisk, isActiveFutureAppointment } from "../src/lib/client-risk";

const visits = ["2026-01-01T10:00:00.000Z", "2026-01-31T10:00:00.000Z"];

test("client risk requires a learned return cadence and a real delay", () => {
  const insufficient = assessClientRisk({
    completedVisitDates: [visits[0]],
    hasFutureBooking: false,
    now: new Date("2026-06-01T10:00:00.000Z"),
  });
  const onBoundary = assessClientRisk({
    completedVisitDates: visits,
    hasFutureBooking: false,
    now: new Date("2026-03-13T10:00:00.000Z"),
  });
  const delayed = assessClientRisk({
    completedVisitDates: visits,
    hasFutureBooking: false,
    now: new Date("2026-03-14T10:00:00.000Z"),
  });

  expect(insufficient.isAtRisk).toBe(false);
  expect(onBoundary.isAtRisk).toBe(false);
  expect(delayed.isAtRisk).toBe(true);
  expect(delayed.averageIntervalDays).toBe(30);
  expect(delayed.riskStartedAt).toBe("2026-03-14T10:00:00.000Z");
});

test("a future booking always removes the client from the risk audience", () => {
  const assessment = assessClientRisk({
    completedVisitDates: visits,
    hasFutureBooking: true,
    now: new Date("2026-06-01T10:00:00.000Z"),
  });

  expect(assessment.isAtRisk).toBe(false);
  expect(
    isActiveFutureAppointment(
      "pending_payment",
      "2026-06-02T10:00:00.000Z",
      new Date("2026-06-01T10:00:00.000Z"),
    ),
  ).toBe(true);
});

test("reactivation uses a targeted audience and one delivery per risk episode", async () => {
  const [server, page, migration] = await Promise.all([
    readFile("src/lib/studio-follows.functions.ts", "utf8"),
    readFile("src/routes/_authenticated/admin.whatsapp.tsx", "utf8"),
    readFile("supabase/migrations/20260821211000_targeted_client_risk_reactivation.sql", "utf8"),
  ]);

  expect(server).toContain('if (data.kind === "client_at_risk")');
  expect(server).toContain("loadAtRiskAudience");
  expect(server).toContain("claimAtRiskNotifications");
  expect(server).toContain('event: "targeted_reactivation"');
  expect(server).toContain('skipped: "no_at_risk"');
  expect(server).toContain('skipped: "no_new_at_risk"');
  expect(page).toContain('`${riskStatus?.atRiskCount ?? 0} cliente');
  expect(page).toContain("riskSendUnavailable");
  expect(page).toContain("Sem novos clientes");
  expect(migration).toContain("notifications_log_client_risk_episode_unique");
  expect(migration).toContain("risk_episode_key");
});
