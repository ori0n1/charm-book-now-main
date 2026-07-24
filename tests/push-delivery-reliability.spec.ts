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

test("a temporary missing studio subscription does not permanently suppress delivery", async () => {
  const source = await readFile("src/lib/notification-dispatcher.server.ts", "utf8");
  expect(source).toContain("loggedNoTargetKeys");
  expect(source).toContain('log.error === "no_studio_push_subscription"');
  expect(source).toContain("!loggedNoTargetKeys.has(key)");
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
