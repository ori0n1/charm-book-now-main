import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  formatStudioDateTime,
  formatStudioTime,
  getStudioDateKey,
  getZonedMinutes,
} from "../src/lib/studio-time";
import { layoutProfessionalAppointments } from "../src/components/agenda/professional-timeline-utils";

const root = process.cwd();
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

test("09:15 em Portugal permanece 09:15 em todos os formatadores", () => {
  const startsAt = "2026-09-07T08:15:00.000Z";
  expect(formatStudioTime(startsAt, "Europe/Lisbon")).toBe("09:15");
  expect(formatStudioDateTime(startsAt, "Europe/Lisbon")).toContain("09:15");
  expect(getStudioDateKey(startsAt, "Europe/Lisbon")).toBe("2026-09-07");
  expect(getZonedMinutes(startsAt, "Europe/Lisbon")).toBe(9 * 60 + 15);
});

test("Europe/Lisbon aplica horário de verão sem somas manuais", () => {
  expect(formatStudioTime("2026-03-28T09:15:00.000Z", "Europe/Lisbon")).toBe("09:15");
  expect(formatStudioTime("2026-03-29T08:15:00.000Z", "Europe/Lisbon")).toBe("09:15");
  expect(formatStudioTime("2026-10-24T08:15:00.000Z", "Europe/Lisbon")).toBe("09:15");
  expect(formatStudioTime("2026-10-25T09:15:00.000Z", "Europe/Lisbon")).toBe("09:15");
});

test("posição na agenda deriva da mesma hora do estúdio", () => {
  const [positioned] = layoutProfessionalAppointments(
    [{
      id: "appointment-1",
      staffId: "staff-1",
      startsAt: "2026-09-07T08:15:00.000Z",
      endsAt: "2026-09-07T09:15:00.000Z",
      status: "confirmed",
      clientName: "Cliente",
      serviceName: "Serviço",
      professionalName: "Profissional",
      durationLabel: "60 min",
      privateDetails: true,
    }],
    8,
    60,
    "Europe/Lisbon",
  );
  expect(positioned.top).toBe(75);
  expect(positioned.height).toBe(60);
});

test("painel limpa tenant anterior e rejeita eventos realtime de outro estúdio", () => {
  const notifications = source("src/components/admin-notifications.tsx");
  const shell = source("src/routes/_authenticated/admin.tsx");
  expect(shell).toContain("key={studio.id}");
  expect(notifications).toContain("setItems([])");
  expect(notifications).toContain(".filter((item) => item.studio_id === studioId)");
  expect(notifications).toContain("appointments:appointment_id(starts_at,studio_id)");
  expect(notifications).toContain("appointment?.studio_id === item.studio_id");
  expect(notifications.match(/if \(raw\.studio_id !== studioId\) return;/g)).toHaveLength(2);
  expect(notifications).toContain('filter: `studio_id=eq.${studioId}`');
});

test("banco impõe vínculo estrutural e hora canónica da marcação", () => {
  const migration = source(
    "supabase/migrations/20260906210000_notification_tenant_time_consistency.sql",
  );
  const freshnessMigration = source(
    "supabase/migrations/20260907165000_notification_reminder_freshness.sql",
  );
  expect(migration).toContain("REFERENCES public.appointments(id) ON DELETE SET NULL");
  expect(migration).toContain("v_appointment_studio_id <> NEW.studio_id");
  expect(migration).toContain("notification_payload_studio_mismatch");
  expect(migration).toContain("'{starts_at}'");
  expect(migration).toContain("n.studio_id = NEW.studio_id");
  expect(migration).toContain("ps.studio_id = NEW.studio_id");
  expect(migration).toContain("ur.studio_id = NEW.studio_id");
  expect(freshnessMigration).toContain("idx_notifications_log_client_event_once");
  expect(freshnessMigration).toContain("legacy-duplicate:");
});

test("push de cliente usa timezone do estúdio e não duplica para membros da equipa", () => {
  const clientNotifications = source("src/lib/public-client.functions.ts");
  expect(clientNotifications).toContain("formatStudioDateTime(");
  expect(clientNotifications).toContain("notificationStudio?.timezone");
  expect(clientNotifications).toContain("studio_member_receives_studio_push");
  expect(clientNotifications).toContain('.limit(3)');
});

test("push do estúdio limita dispositivos recentes e remove associações antigas", () => {
  const subscriptions = source("src/lib/push-subscriptions.functions.ts");
  const dispatcher = source("src/lib/notification-dispatcher.server.ts");
  const migration = source(
    "supabase/migrations/20260906213000_push_audience_dedup_timezone.sql",
  );
  expect(subscriptions).toContain("MAX_ACTIVE_PUSH_SUBSCRIPTIONS_PER_STUDIO_USER = 3");
  expect(subscriptions).toContain("device_moved_to_another_studio");
  expect(dispatcher).toContain("cleanupStaleStudioPushSubscriptions");
  expect(migration).toContain("device_rank > 3");
  expect(migration).toContain("device_inactive_30_days");
});

test("log, entrega e histórico validam o mesmo tenant no banco", () => {
  const migration = source(
    "supabase/migrations/20260907165000_notification_reminder_freshness.sql",
  );
  expect(migration).toContain("notification_log_appointment_studio_mismatch");
  expect(migration).toContain("a.studio_id = NEW.studio_id");
  expect(migration).toContain("n.studio_id = NEW.studio_id");
  expect(migration).toContain("ps.studio_id = NEW.studio_id");
  expect(migration).toContain("ur.studio_id = NEW.studio_id");
});
