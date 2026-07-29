import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("does not force-renew healthy browser push subscriptions during automatic registration", async () => {
  const [admin, booking] = await Promise.all([
    readFile("src/components/admin-notifications.tsx", "utf8"),
    readFile("src/components/booking-experience.tsx", "utf8"),
  ]);

  expect(admin).toContain("requestPushSubscription()");
  expect(booking).toContain("requestPushSubscription()");
  expect(admin).not.toContain("forceRenew: shouldRefreshStoredPushSubscription");
  expect(booking).not.toContain("forceRenew: shouldRefreshStoredPushSubscription");
});

test("sends Web Push with high urgency", async () => {
  const source = await readFile("src/lib/web-push.server.ts", "utf8");
  expect(source).toContain('Urgency: "high"');
});

test("studio push uses a durable claimed delivery queue with retries", async () => {
  const [source, migration] = await Promise.all([
    readFile("src/lib/notification-dispatcher.server.ts", "utf8"),
    readFile(
      "supabase/migrations/20260729130000_reliable_studio_notifications.sql",
      "utf8",
    ),
  ]);
  expect(source).toContain('rpc("claim_studio_notification_deliveries"');
  expect(source).toContain('result.status === "retry"');
  expect(source).toContain("retryDelayMs");
  expect(migration).toContain("for update of d skip locked");
  expect(migration).toContain("unique(notification_id, subscription_id)");
  expect(migration).toContain("attempt_count < 12");
});

test("studio events are idempotent and cover the critical operational lifecycle", async () => {
  const migration = await readFile(
    "supabase/migrations/20260729130000_reliable_studio_notifications.sql",
    "utf8",
  );
  for (const kind of [
    "new_appointment",
    "appointment_rescheduled",
    "appointment_cancelled",
    "payment_confirmed",
    "payment_failed",
    "new_client",
    "new_review",
    "refund_request",
    "withdrawal_requested",
    "critical_request",
  ]) {
    expect(migration).toContain(`'${kind}'`);
  }
  expect(migration).toContain("idx_studio_notifications_event_key");
  expect(migration).toContain("on conflict (studio_id, event_key)");
  expect(migration).toContain("notification_client_studio_mismatch");
  expect(migration).toContain("notification_review_studio_mismatch");
});

test("notification center recovers after reconnect and routes each event", async () => {
  const source = await readFile("src/components/admin-notifications.tsx", "utf8");
  expect(source).toContain('window.addEventListener("online", recoverNotifications)');
  expect(source).toContain('document.addEventListener("visibilitychange", recoverNotifications)');
  expect(source).toContain('select("id", { count: "exact", head: true })');
  expect(source).toContain("notificationActionUrl(item)");
  expect(source).toContain("Marcar todas como lidas");
  expect(source).not.toContain("showBrowserNotification(next, studioName)");
});

test("creation, reschedule, cancellation, review and payment flows request immediate dispatch", async () => {
  const [booking, clientActions, reviews, payments, subscriptions] = await Promise.all([
    readFile("src/components/booking-experience.tsx", "utf8"),
    readFile("src/lib/client-appointment.functions.ts", "utf8"),
    readFile("src/lib/reviews.functions.ts", "utf8"),
    readFile("src/routes/api/public/payments/webhook.ts", "utf8"),
    readFile("src/lib/push-subscriptions.functions.ts", "utf8"),
  ]);
  expect(booking).toContain("dispatchRecentStudioAppointmentPushNotification");
  expect(clientActions).toContain("reschedule push failed");
  expect(clientActions).toContain("cancellation push failed");
  expect(reviews).toContain("[reviews] studio_push_dispatch_failed");
  expect(payments).toContain("studio_push_dispatch_after_payment");
  expect(subscriptions).toContain("pending_studio_delivery_after_subscription_failed");
});

test("client push prioritizes the most recently active subscriptions before limiting targets", async () => {
  const source = await readFile("src/lib/public-client.functions.ts", "utf8");
  const activeClientSubscriptions = source.match(
    /\.in\("audience", \["client", "both"\]\)[\s\S]*?\.limit\(8\)/,
  )?.[0];

  expect(activeClientSubscriptions).toBeTruthy();
  expect(activeClientSubscriptions).toContain('.order("updated_at", { ascending: false })');
  expect(activeClientSubscriptions?.indexOf(".order(")).toBeLessThan(
    activeClientSubscriptions?.indexOf(".limit(8)") ?? -1,
  );
});
