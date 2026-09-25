import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  csvCell,
  escapeHtml,
  serializeJsonForHtmlScript,
} from "../src/lib/output-safety";
import { isTrustedWebPushEndpoint } from "../src/lib/web-push.server";

const projectFile = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("JSON-LD serialization cannot terminate an inline script", () => {
  const serialized = serializeJsonForHtmlScript({
    name: '</script><script>globalThis.pwned=true</script>',
  });
  expect(serialized).not.toContain("</script>");
  expect(serialized).toContain("\\u003c/script\\u003e");
});

test("agenda exports escape HTML and neutralize spreadsheet formulas", () => {
  expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe(
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
  );
  expect(csvCell("=HYPERLINK(\"https://example.invalid\")")).toBe(
    '"\'=HYPERLINK(""https://example.invalid"")"',
  );
});

test("web push egress is restricted to HTTPS provider endpoints", () => {
  expect(isTrustedWebPushEndpoint("https://fcm.googleapis.com/fcm/send/token")).toBe(true);
  expect(isTrustedWebPushEndpoint("https://updates.push.services.mozilla.com/wpush/token")).toBe(
    true,
  );
  expect(isTrustedWebPushEndpoint("https://wns2-par02p.notify.windows.com/w/token")).toBe(true);
  expect(isTrustedWebPushEndpoint("http://127.0.0.1:5432/private")).toBe(false);
  expect(isTrustedWebPushEndpoint("https://169.254.169.254/latest/meta-data")).toBe(false);
  expect(isTrustedWebPushEndpoint("https://fcm.googleapis.com.evil.invalid/send")).toBe(false);
});

test("manual appointment writes use the transactional database routines", () => {
  const agenda = projectFile("src/routes/_authenticated/admin.agenda.tsx");
  expect(agenda).toContain('"create_manual_appointment"');
  expect(agenda).toContain('"update_manual_appointment_service"');
  expect(agenda).toContain("useServerFn(createStudioManualFit)");
  expect(agenda).toContain("p_is_fit: false");
});

test("public invite lookup hides the code and acceptance requires it", () => {
  const access = projectFile("src/lib/access.functions.ts");
  const lookup = access.slice(
    access.indexOf("export const getStaffInviteLink"),
    access.indexOf("export const acceptStaffInviteLink"),
  );
  expect(lookup).toContain("requiresCode: Boolean(staff.invite_code)");
  expect(lookup).not.toContain("inviteCode: staff.invite_code");
  expect(access).toContain("staff.invite_code && data.code?.trim().toUpperCase() !== staff.invite_code");
  expect(access).toContain("staff-invite-accept:");
});

test("security migration closes public base-table access and role escalation", () => {
  const migration = projectFile(
    "supabase/migrations/20260823220000_prelaunch_security_hardening.sql",
  );
  expect(migration).toContain('DROP POLICY IF EXISTS "Public read active staff"');
  expect(migration).toContain('DROP POLICY IF EXISTS "Public can read active studios"');
  expect(migration).toContain('DROP POLICY IF EXISTS "Studio owners manage roles"');
  expect(migration).toContain("REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM authenticated");
  expect(migration).toContain("booking_payment_requests_no_active_overlap");
  expect(migration).toContain("CREATE OR REPLACE FUNCTION public.confirm_studio_appointment_payment");
});

test("paid booking conflicts have a durable automatic Stripe refund path", () => {
  const webhook = projectFile("src/routes/api/public/payments/webhook.ts");
  expect(webhook).toContain("automaticallyRefundPaidBookingConflict");
  expect(webhook).toContain("paid-booking-conflict-refund:");
  expect(webhook).toContain('status: "refunded"');
});

test("agenda privacy is enforced server-side and by row-level policies", () => {
  const agenda = projectFile("src/routes/_authenticated/admin.agenda.tsx");
  const balcao = projectFile("src/routes/_authenticated/admin.balcao.tsx");
  const access = projectFile("src/lib/agenda-access.functions.ts");
  const migration = projectFile(
    "supabase/migrations/20260823231500_agenda_privacy_and_trial_antifraud.sql",
  );

  expect(agenda).toContain("getProtectedAgendaData");
  expect(agenda).not.toContain("async function fetchAgendaAppointments");
  expect(access).toContain("maskTeamAppointment");
  expect(access).toContain('public_token: null');
  expect(access).toContain('clients: null');
  expect(balcao).toContain("searchProtectedStudioClients");
  expect(balcao).not.toContain('supabase.from("clients").select("id,name,phone")');
  expect(migration).toContain('DROP POLICY IF EXISTS "Members manage appointments"');
  expect(migration).toContain('CREATE POLICY "Professionals read served clients"');
  expect(migration).toContain("public.staff_owns_appointment(auth.uid(), id)");
});

test("public bookings use durable throttling and cannot overwrite client identity", () => {
  const component = projectFile("src/components/booking-experience.tsx");
  const server = projectFile("src/lib/public-booking.functions.ts");
  const legacyClient = projectFile("src/lib/booking.ts");
  const migration = projectFile(
    "supabase/migrations/20260823231600_public_booking_abuse_hardening.sql",
  );

  expect(component).toContain("createProtectedPublicBooking");
  expect(server).toContain("public-booking:ip:");
  expect(server).toContain("public-booking:phone:");
  expect(server).toContain("public-booking:slot:");
  expect(legacyClient).not.toContain('.rpc("create_public_booking"');
  expect(migration).toContain("ON CONFLICT (studio_id, phone) DO NOTHING");
  expect(migration).toContain("FROM PUBLIC, anon, authenticated");
  expect(migration).not.toContain("name = EXCLUDED.name");
});

test("trial creation trusts only server-derived antifraud signals", () => {
  const onboarding = projectFile("src/lib/onboarding.functions.ts");
  const migration = projectFile(
    "supabase/migrations/20260823231500_agenda_privacy_and_trial_antifraud.sql",
  );

  expect(onboarding).toContain("getAdminClient");
  expect(onboarding).toContain("trial-create:user:");
  expect(onboarding).toContain("trial-create:ip:");
  expect(onboarding).toContain("p_owner_user_id: userId");
  expect(migration).toContain("p_owner_user_id uuid");
  expect(migration).toContain("FROM PUBLIC, anon, authenticated, service_role");
});

test("privileged database functions use an explicit browser execute allowlist", () => {
  const migration = projectFile(
    "supabase/migrations/20260922120000_security_definer_execute_allowlist.sql",
  );
  const browserGrantStatements = migration
    .replace(/--.*$/gm, "")
    .split(";")
    .map((statement) => statement.replace(/\s+/g, " ").trim())
    .filter(
      (statement) =>
        statement.startsWith("GRANT EXECUTE ON FUNCTION") &&
        / TO (?:anon|authenticated)(?:, authenticated)?$/.test(statement),
    );

  expect(migration).toContain("AND function_row.prosecdef");
  expect(migration).toContain("FROM PUBLIC, anon, authenticated");
  expect(migration.match(/SET search_path = pg_catalog, public/g)).toHaveLength(8);
  expect(browserGrantStatements.join("\n")).toContain(
    "public.get_available_slots(text, uuid, date, integer, integer) TO anon, authenticated",
  );
  expect(browserGrantStatements.join("\n")).not.toMatch(
    /(?:confirm_paid_booking_request|create_public_booking|insert_studio_notification|consume_rate_limit|reserve_whatsapp_usage|track_upsell_)/,
  );

  const catalogMigration = projectFile(
    "supabase/migrations/20260922130000_private_catalog_invoker_views.sql",
  );
  const catalogSql = catalogMigration.replace(/--.*$/gm, "");
  expect(catalogMigration.match(/security_invoker = true/g)).toHaveLength(6);
  expect(catalogSql.match(/SECURITY DEFINER/g)).toHaveLength(6);
  expect(catalogMigration).toContain("CREATE SCHEMA IF NOT EXISTS private");
  expect(catalogMigration).toContain(
    "REVOKE EXECUTE ON FUNCTION public.studio_has_entitlement",
  );
  expect(catalogMigration).toContain(
    "REVOKE EXECUTE ON FUNCTION public.studio_staff_is_within_plan",
  );

  const extensionMigration = projectFile(
    "supabase/migrations/20260922140000_move_btree_gist_to_extensions.sql",
  );
  expect(extensionMigration).toContain("ALTER EXTENSION btree_gist SET SCHEMA extensions");
  expect(extensionMigration).toContain("IF current_schema <> 'extensions'");

  const internalTableMigration = projectFile(
    "supabase/migrations/20260922150000_revoke_browser_access_to_internal_tables.sql",
  );
  expect(internalTableMigration).toContain("FROM PUBLIC, anon, authenticated");
  expect(internalTableMigration).toContain("public.server_rate_limits");
  expect(internalTableMigration).toContain("public.referral_credits");
  expect(internalTableMigration).toContain("public.subscriptions_trial_reset_backup_20260807");
});
