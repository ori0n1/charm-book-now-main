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

test("production build injects and validates the public VAPID key from JSONC", async () => {
  const [viteConfig, browserPush, worker] = await Promise.all([
    readFile("vite.config.ts", "utf8"),
    readFile("src/lib/pwa-push.ts", "utf8"),
    readFile("public/sw.js", "utf8"),
  ]);

  expect(viteConfig).toContain('"VITE_VAPID_PUBLIC_KEY"\\s*:\\s*');
  expect(viteConfig).not.toContain("JSON.parse(readFileSync");
  expect(viteConfig).toContain("VITE_VAPID_PUBLIC_KEY is required");
  expect(browserPush).toContain("bytes.length === 65 && bytes[0] === 4");
  expect(worker).toContain('self.addEventListener("push"');
  expect(worker).toContain('self.addEventListener("notificationclick"');
});

test("push activation has explicit iOS, permission, worker and subscription states", async () => {
  const [browserPush, admin, booking] = await Promise.all([
    readFile("src/lib/pwa-push.ts", "utf8"),
    readFile("src/components/admin-notifications.tsx", "utf8"),
    readFile("src/components/booking-experience.tsx", "utf8"),
  ]);

  for (const state of [
    "pwa_install_required",
    "service_worker_timeout",
    "service_worker_failed",
    "subscription_failed",
    "invalid_subscription",
  ]) {
    expect(browserPush).toContain(`"${state}"`);
  }
  expect(browserPush).toContain("await Notification.requestPermission()");
  expect(browserPush.indexOf("await Notification.requestPermission()")).toBeLessThan(
    browserPush.indexOf("await getReadyServiceWorkerRegistration()"),
  );
  expect(admin).toContain("Notificações ativadas neste dispositivo");
  expect(admin).toContain("Reativar notificações");
  expect(booking).toContain("pushActivationMessage(permission)");
});

test("sends Web Push with high urgency", async () => {
  const source = await readFile("src/lib/web-push.server.ts", "utf8");
  expect(source).toContain('Urgency: "high"');
});

test("studio push uses a durable claimed delivery queue with retries", async () => {
  const [source, migration, selfHealingMigration] = await Promise.all([
    readFile("src/lib/notification-dispatcher.server.ts", "utf8"),
    readFile(
      "supabase/migrations/20260729130000_reliable_studio_notifications.sql",
      "utf8",
    ),
    readFile(
      "supabase/migrations/20260729170000_push_subscription_self_healing.sql",
      "utf8",
    ),
  ]);
  expect(source).toContain('rpc("claim_studio_notification_deliveries"');
  expect(source).toContain('result.status === "retry"');
  expect(source).toContain("retryDelayMs");
  expect(migration).toContain("for update of d skip locked");
  expect(migration).toContain("unique(notification_id, subscription_id)");
  expect(migration).toContain("attempt_count < 12");
  expect(selfHealingMigration).toContain("trg_fanout_studio_notification_delivery");
  expect(selfHealingMigration).toContain("no_active_studio_push_subscription");
});

test("revoked endpoints are renewed instead of silently reactivated", async () => {
  const [subscriptions, admin, dispatcher] = await Promise.all([
    readFile("src/lib/push-subscriptions.functions.ts", "utf8"),
    readFile("src/components/admin-notifications.tsx", "utf8"),
    readFile("src/lib/notification-dispatcher.server.ts", "utf8"),
  ]);

  expect(subscriptions).toContain("revoked_endpoint_reused");
  expect(subscriptions).toContain("requiresRenewal: true");
  expect(admin).toContain("saved.requiresRenewal");
  expect(admin).toContain("forceRenew = true");
  expect(dispatcher).toContain(
    "result.status === 400 || result.status === 404 || result.status === 410",
  );
});

test("logout revokes and unsubscribes the current device", async () => {
  const [layout, subscriptions, browserPush] = await Promise.all([
    readFile("src/routes/_authenticated/admin.tsx", "utf8"),
    readFile("src/lib/push-subscriptions.functions.ts", "utf8"),
    readFile("src/lib/pwa-push.ts", "utf8"),
  ]);

  expect(layout).toContain("revokeCurrentDevicePushSubscription");
  expect(layout).toContain("unsubscribeCurrentPushSubscription");
  expect(subscriptions).toContain('revocation_reason: "user_logout"');
  expect(browserPush).toContain("subscription.unsubscribe()");
});

test("service worker renews changed push subscriptions and informs every open tab", async () => {
  const worker = await readFile("public/sw.js", "utf8");
  expect(worker).toContain("renewChangedPushSubscription(event)");
  expect(worker).toContain("event.oldSubscription?.options?.applicationServerKey");
  expect(worker).toContain('type: "BELLZA_PUSH_SUBSCRIPTION_CHANGED"');
  expect(worker).toContain('includeUncontrolled: true');
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

test("studio registration renews the browser endpoint when the database has no active device", async () => {
  const [admin, subscriptions] = await Promise.all([
    readFile("src/components/admin-notifications.tsx", "utf8"),
    readFile("src/lib/push-subscriptions.functions.ts", "utf8"),
  ]);

  expect(admin).toContain("getStudioPushHealth");
  expect(admin).toContain("Number(health.activeDevices ?? 0) === 0");
  expect(subscriptions).toContain("activeDevices: active.length");
  expect(subscriptions).toContain('.in("audience", ["studio", "both"])');
});

test("studio push fanout and send both revalidate current studio membership", async () => {
  const [dispatcher, migration] = await Promise.all([
    readFile("src/lib/notification-dispatcher.server.ts", "utf8"),
    readFile(
      "supabase/migrations/20260729193000_push_device_receipts_and_membership_scope.sql",
      "utf8",
    ),
  ]);

  expect(dispatcher).toContain("subscription_user_not_studio_member");
  expect(dispatcher).toContain('.from("user_roles")');
  expect(migration).toContain("studio_membership_removed");
  expect(migration).toContain("where ur.user_id = ps.user_id");
  expect(migration).toContain("and ur.studio_id = new.studio_id");
});

test("provider acceptance is distinct from device receipt and notification display", async () => {
  const [dispatcher, worker, route, migration] = await Promise.all([
    readFile("src/lib/notification-dispatcher.server.ts", "utf8"),
    readFile("public/sw.js", "utf8"),
    readFile("src/routes/api/public/push/receipt.ts", "utf8"),
    readFile(
      "supabase/migrations/20260729193000_push_device_receipts_and_membership_scope.sql",
      "utf8",
    ),
  ]);

  expect(dispatcher).toContain("receiptToken");
  expect(worker).toContain('acknowledgePushReceipt(receipt, "received")');
  expect(worker).toContain('acknowledgePushReceipt(receipt, "displayed")');
  expect(route).toContain("acknowledge_studio_notification_delivery");
  expect(migration).toContain("received_at timestamptz");
  expect(migration).toContain("displayed_at timestamptz");
  expect(migration).toContain("studio_notification_device_receipt");
});
