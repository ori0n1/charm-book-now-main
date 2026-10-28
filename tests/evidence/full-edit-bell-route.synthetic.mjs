import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const root = process.cwd();
const moduleSource = readFileSync(resolve(root, "src/lib/notification-deep-link.ts"), "utf8");
const compiled = ts.transpileModule(moduleSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
new Function("exports", compiled)(exports);
const { buildStudioNotificationDeepLink, resolveScopedNotificationEntity } = exports;

const studioId = "11111111-1111-4111-8111-111111111111";
const otherStudioId = "99999999-9999-4999-8999-999999999999";
const appointmentId = "77777777-7777-4777-8777-777777777777";
const url = buildStudioNotificationDeepLink({
  kind: "appointment_cancelled", studioId, appointmentId,
});
assert.equal(url, `/admin/agenda?appointment=${appointmentId}&studio=${studioId}`);
const target = new URL(url, "https://bellza.pt").searchParams;
const cancelledAppointment = { id: appointmentId, status: "cancelled" };
assert.equal(resolveScopedNotificationEntity({
  entityId: target.get("appointment"), targetStudioId: target.get("studio"),
  currentStudioId: studioId, availableEntityIds: [cancelledAppointment.id],
}), appointmentId);
assert.equal(resolveScopedNotificationEntity({
  entityId: target.get("appointment"), targetStudioId: target.get("studio"),
  currentStudioId: otherStudioId, availableEntityIds: [cancelledAppointment.id],
}), null);
assert.equal([cancelledAppointment].filter((row) => row.status !== "cancelled").length, 0);

const route = readFileSync(resolve(root, "src/routes/_authenticated/admin.agenda.tsx"), "utf8");
const access = readFileSync(resolve(root, "src/lib/agenda-access.functions.ts"), "utf8");
assert.match(route, /availableEntityIds:\s*appts\.map\(\(appointment\) => appointment\.id\)/);
assert.match(route, /if \(a\.status === "cancelled"\) return false/);
assert.match(route, /if \(!await correctPresence\("confirmed", "", timelineDetailAppt\)\) return;\s*setEditApptId\(timelineDetailAppt\.id\)/);
assert.match(access, /correctProtectedOwnerAppointmentAction = createServerFn\(\{ method: "POST" \}\)\s*\.middleware\(\[requireSupabaseAuth\]\)/);
assert.match(access, /if \(access\.role !== "studio_owner" && access\.role !== "saas_owner"\)/);
console.log("bell route: scoped cancelled deep link, owner auth guard, same appointment ID and Agenda exclusion OK");
