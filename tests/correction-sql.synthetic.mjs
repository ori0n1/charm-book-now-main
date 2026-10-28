import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../../../.tmp-bellza-sql-isolated/node_modules/@electric-sql/pglite/dist/index.js";

const db = await PGlite.create();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const studio = "00000000-0000-4000-8000-000000000001";
const owner = "00000000-0000-4000-8000-000000000002";
const appointment = "00000000-0000-4000-8000-000000000003";
const movement = "00000000-0000-4000-8000-000000000004";
const joint = "00000000-0000-4000-8000-000000000005";
const active = JSON.parse(readFileSync("supabase/active-cancellation-function-snapshot.json", "utf8"));
const migration = readFileSync("supabase/migrations/20261027160000_appointment_action_and_method_correction.sql", "utf8");
const rollback = readFileSync("supabase/rollback/20261027160000_appointment_action_and_method_correction.sql", "utf8");
const normal = (value) => value.replace(/--[^\n]*/g, "").replace(/\s+/g, "");
function bodyFromLive(value) {
  return value.split("AS $function$\n")[1].split("\n$function$")[0];
}
function bodyFromRollback(name) {
  const section = rollback.split("CREATE OR REPLACE FUNCTION public." + name + "(")[1];
  return section.split("AS $$\n")[1].split("\n$$;")[0];
}
for (const row of active) {
  assert.equal(normal(bodyFromRollback(row.proname)), normal(bodyFromLive(row.definition)),
    "rollback must restore the production function body: " + row.proname);
}
function bodyFromMigration(name) {
  const section = migration.split("CREATE OR REPLACE FUNCTION public." + name + "(")[1];
  return section.split("AS $$\n")[1].split("\n$$;")[0];
}
const activeByName = Object.fromEntries(active.map((row) => [row.proname, row.definition]));
const guardAdded = "  ELSIF OLD.status <> 'cancelled' AND NEW.status = 'cancelled' THEN";
const guardNext = "  ELSIF OLD.status = 'cancelled' THEN";
const guardBody = bodyFromMigration("guard_completed_appointment_cancellation");
assert.ok(guardBody.includes(guardAdded));
assert.equal(normal(guardBody.slice(0, guardBody.indexOf(guardAdded)) +
  guardBody.slice(guardBody.indexOf(guardNext))), normal(bodyFromLive(activeByName.guard_completed_appointment_cancellation)));
const cancelBody = bodyFromMigration("cancel_completed_appointment");
const auditStart = "  INSERT INTO public.financial_audit_logs";
assert.ok(cancelBody.includes(auditStart));
assert.equal(normal(cancelBody.slice(0, cancelBody.indexOf(auditStart)) +
  cancelBody.slice(cancelBody.indexOf("  RETURN true;", cancelBody.indexOf(auditStart)))),
  normal(bodyFromLive(activeByName.cancel_completed_appointment)));
try {
  await db.exec([
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;",
    "CREATE SCHEMA auth;",
    "CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'service_role'::text $$;",
    "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '00000000-0000-4000-8000-000000000002'::uuid $$;",
    "CREATE TYPE public.appointment_status AS ENUM ('confirmed','completed','no_show','cancelled');",
    "CREATE TABLE public.user_roles(user_id uuid, studio_id uuid, role text);",
    "CREATE TABLE public.appointments(id uuid PRIMARY KEY, studio_id uuid, status public.appointment_status, cancellation_reason text, cancelled_at timestamptz, cancelled_by uuid, attendance_resolved_at timestamptz, attendance_resolved_by uuid, updated_at timestamptz DEFAULT now());",
    "CREATE TABLE public.appointment_services(appointment_id uuid, service_state text);",
    "CREATE TABLE public.cash_register_movements(id uuid PRIMARY KEY, studio_id uuid, appointment_id uuid, movement_type text, payment_method text, amount numeric);",
    "CREATE TABLE public.financial_audit_logs(id uuid DEFAULT gen_random_uuid(), studio_id uuid, actor_user_id uuid, entity_type text, entity_id uuid, action text, amount_cents integer, metadata jsonb, created_at timestamptz DEFAULT now());",
    "INSERT INTO public.user_roles VALUES ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','studio_owner');",
    "INSERT INTO public.appointments(id,studio_id,status) VALUES ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','completed'),('00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000001','completed');",
    "INSERT INTO public.appointment_services VALUES ('00000000-0000-4000-8000-000000000005','completed');",
    "INSERT INTO public.cash_register_movements VALUES ('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','service_payment','cash',25);"
  ].join("\n"));
  for (const row of active) await db.exec(row.definition + ";");
  await db.exec("CREATE TRIGGER guard_completed_appointment_cancellation BEFORE UPDATE OF status,cancellation_reason,cancelled_at,cancelled_by ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.guard_completed_appointment_cancellation();");
  await assert.rejects(q("SELECT public.cancel_completed_appointment($1,$2,$3)", [studio, joint, "Tentativa bloqueada"]), /cancel_joint_services_individually/);
  await db.exec(migration);
  assert.equal((await q("SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('cancel_completed_appointment','guard_completed_appointment_cancellation') AND p.prosecdef"))[0].n, 2);
  await assert.rejects(q("SELECT public.cancel_completed_appointment($1,$2,$3)", [studio, joint, "Tentativa bloqueada"]), /cancel_joint_services_individually/);
  await q("UPDATE appointments SET status='no_show' WHERE id=$1", [joint]);
  await assert.rejects(q("SELECT public.correct_owner_appointment_action($1,$2,$3,$4,$5)", [studio, joint, "cancelled", owner, "Tentativa bloqueada"]), /cancel_joint_services_individually/);
  await assert.rejects(q("UPDATE appointments SET status='cancelled',cancellation_reason='Tentativa bloqueada' WHERE id=$1", [joint]), /cancel_joint_services_individually/);
  assert.equal((await q("SELECT status FROM appointments WHERE id=$1", [joint]))[0].status, "no_show");
  await q("SELECT public.cancel_completed_appointment($1,$2,$3)", [studio, appointment, "Ação incorreta"]);
  assert.equal((await q("SELECT status FROM appointments WHERE id=$1", [appointment]))[0].status, "cancelled");
  await q("SELECT public.correct_owner_appointment_action($1,$2,$3,$4,$5)", [studio, appointment, "confirmed", owner, null]);
  assert.equal((await q("SELECT status FROM appointments WHERE id=$1", [appointment]))[0].status, "confirmed");
  await q("UPDATE appointments SET status='no_show' WHERE id=$1", [appointment]);
  await q("SELECT public.correct_owner_appointment_action($1,$2,$3,$4,$5)", [studio, appointment, "cancelled", owner, "Falta corrigida"]);
  assert.equal((await q("SELECT status FROM appointments WHERE id=$1", [appointment]))[0].status, "cancelled");
  await q("SELECT public.correct_onsite_payment_method($1,$2,$3,$4,$5)", [studio, appointment, movement, "mb_way", owner]);
  assert.deepEqual((await q("SELECT count(*)::int AS n, max(payment_method) AS method, max(amount)::int AS amount FROM cash_register_movements"))[0], { n: 1, method: "mb_way", amount: 25 });
  assert.equal((await q("SELECT count(*)::int AS n FROM financial_audit_logs"))[0].n, 4);
  await db.exec(rollback);
  await q("UPDATE appointments SET status='completed' WHERE id=$1", [joint]);
  await assert.rejects(q("SELECT public.cancel_completed_appointment($1,$2,$3)", [studio, joint, "Tentativa bloqueada"]), /cancel_joint_services_individually/);
  assert.equal((await q("SELECT count(*)::int AS n FROM cash_register_movements"))[0].n, 1);
  assert.equal((await q("SELECT count(*)::int AS n FROM financial_audit_logs"))[0].n, 4);
  assert.equal((await q("SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('cancel_completed_appointment','guard_completed_appointment_cancellation') AND p.prosecdef"))[0].n, 2);
  console.log("Proteção conjunta, correções, pagamentos, auditoria e rollback: OK");
} finally {
  await db.close();
}
