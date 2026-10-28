import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../../../.tmp-bellza-sql-isolated/node_modules/@electric-sql/pglite/dist/index.js";
import { buildAppointmentPaymentFacts, computeAppointmentLedger } from "../src/lib/financial-ledger.ts";

const db = await PGlite.create();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const studio = "00000000-0000-4000-8000-000000000001";
const owner = "00000000-0000-4000-8000-000000000002";
const appt = "00000000-0000-4000-8000-000000000003";
const movement = "00000000-0000-4000-8000-000000000004";
const stripeAppt = "00000000-0000-4000-8000-000000000005";
const jointAppt = "00000000-0000-4000-8000-000000000006";
const closedAppt = "00000000-0000-4000-8000-000000000007";
const cancelledAppt = "00000000-0000-4000-8000-000000000008";
const noShowAppt = "00000000-0000-4000-8000-000000000016";
const openSession = "00000000-0000-4000-8000-000000000009";
const closedSession = "00000000-0000-4000-8000-000000000010";
const migration = readFileSync("supabase/migrations/20261027190000_undo_mistaken_onsite_receipt.sql", "utf8");
const rollback = readFileSync("supabase/rollback/20261027190000_undo_mistaken_onsite_receipt.sql", "utf8");
try {
  await db.exec([
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;",
    "CREATE SCHEMA auth;",
    "CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'service_role'::text $$;",
    "CREATE TYPE public.appointment_status AS ENUM ('confirmed','completed','no_show','cancelled');",
    "CREATE TABLE public.user_roles(user_id uuid, studio_id uuid, role text);",
    "CREATE TABLE public.appointments(id uuid PRIMARY KEY, studio_id uuid, status public.appointment_status, total_price numeric DEFAULT 50);",
    "CREATE TABLE public.appointment_services(appointment_id uuid, service_state text);",
    "CREATE TABLE public.payment_intents(appointment_id uuid, studio_id uuid, status text);",
    "CREATE TABLE public.customer_loyalty_stamp_entries(studio_id uuid, source_appointment_id uuid, source_type text);",
    "CREATE TABLE public.customer_referrals(studio_id uuid,status text,appointment_id uuid,booking_request_id uuid);",
    "CREATE TABLE public.booking_payment_requests(id uuid,appointment_id uuid);",
    "CREATE TABLE public.cash_register_sessions(id uuid PRIMARY KEY,status text,opening_amount numeric DEFAULT 10,closing_counted_amount numeric DEFAULT 60,expected_cash_amount numeric DEFAULT 60,difference_amount numeric DEFAULT 0,summary jsonb DEFAULT '{}'::jsonb,updated_at timestamptz DEFAULT now());",
    "CREATE TABLE public.cash_register_movements(id uuid PRIMARY KEY,session_id uuid,studio_id uuid,appointment_id uuid,movement_type text,payment_method text,amount numeric,description text,source_key text UNIQUE,created_at timestamptz DEFAULT now());",
    "CREATE TABLE public.financial_audit_logs(studio_id uuid,actor_user_id uuid,entity_type text,entity_id uuid,action text,amount_cents integer,metadata jsonb);",
    "CREATE FUNCTION public.correct_appointment_attendance(uuid,uuid,text,uuid) RETURNS public.appointments LANGUAGE plpgsql AS $$ DECLARE v public.appointments%ROWTYPE; BEGIN UPDATE public.appointments SET status=$3::public.appointment_status WHERE id=$1 AND studio_id=$2 RETURNING * INTO v; RETURN v; END $$;",
    "CREATE FUNCTION public.correct_owner_appointment_action(uuid,uuid,text,uuid,text) RETURNS public.appointments LANGUAGE plpgsql AS $$ DECLARE v public.appointments%ROWTYPE; BEGIN UPDATE public.appointments SET status=$3::public.appointment_status WHERE id=$2 AND studio_id=$1 RETURNING * INTO v; RETURN v; END $$;",
  ].join("\n"));
  await q("INSERT INTO user_roles VALUES ($1,$2,'studio_owner')", [owner, studio]);
  for (const [id, status] of [[appt,"completed"],[stripeAppt,"completed"],[jointAppt,"completed"],[closedAppt,"completed"],[cancelledAppt,"cancelled"],[noShowAppt,"no_show"]]) {
    await q("INSERT INTO appointments(id,studio_id,status) VALUES ($1,$2,$3)", [id,studio,status]);
  }
  await q("INSERT INTO cash_register_sessions(id,status) VALUES ($1,'open'),($2,'closed')", [openSession,closedSession]);
  for (const [id,appointmentId,sessionId] of [[movement,appt,openSession],["00000000-0000-4000-8000-000000000011",stripeAppt,openSession],["00000000-0000-4000-8000-000000000012",jointAppt,openSession],["00000000-0000-4000-8000-000000000013",closedAppt,closedSession],["00000000-0000-4000-8000-000000000014",cancelledAppt,openSession],["00000000-0000-4000-8000-000000000017",noShowAppt,openSession]]) {
    await q("INSERT INTO cash_register_movements(id,session_id,studio_id,appointment_id,movement_type,payment_method,amount,description,source_key) VALUES($1,$2,$3,$4,'service_payment','mb_way',50,'Liquidação presencial',$5)", [id,sessionId,studio,appointmentId,"attendance-settlement:"+appointmentId]);
  }
  await q("INSERT INTO payment_intents VALUES ($1,$2,'succeeded')", [stripeAppt,studio]);
  await q("INSERT INTO appointment_services VALUES ($1,'completed')", [jointAppt]);
  await db.exec(migration);
  assert.equal((await q("SELECT prosecdef FROM pg_proc WHERE proname='undo_mistaken_onsite_attendance_receipt'"))[0].prosecdef,true);
  for (const [id,error] of [[stripeAppt,/confirmed_external_payment/],[jointAppt,/joint_services_require/]]) {
    await assert.rejects(q("SELECT public.undo_mistaken_onsite_attendance_receipt($1,$2,$3,$4)",[studio,id,owner,"Registo por engano"]),error);
    assert.equal((await q("SELECT status FROM appointments WHERE id=$1",[id]))[0].status,"completed");
  }
  await q("SELECT public.undo_mistaken_onsite_attendance_receipt($1,$2,$3,$4)",[studio,appt,owner,"Registo por engano"]);
  const after=(await q("SELECT status,amount,source_key,description FROM appointments a JOIN cash_register_movements m ON m.appointment_id=a.id WHERE a.id=$1",[appt]))[0];
  assert.equal(after.status,"confirmed");
  assert.equal(Number((await q("SELECT total_price FROM appointments WHERE id=$1",[appt]))[0].total_price),50);
  assert.equal(Number(after.amount),0);
  assert.equal(after.source_key,"voided:"+movement);
  assert.match(after.description,/ANULADO/);
  assert.equal((await q("SELECT count(*)::int AS n FROM cash_register_movements WHERE appointment_id=$1",[appt]))[0].n,1);
  assert.equal((await q("SELECT count(*)::int AS n FROM financial_audit_logs WHERE action='mistaken_onsite_receipt_voided'"))[0].n,1);
  const facts=buildAppointmentPaymentFacts([], [{id:movement,appointment_id:appt,movement_type:"service_payment",amount:0}]).get(appt);
  assert.ok(facts);
  const ledger=computeAppointmentLedger(appt,50,"confirmed",facts);
  assert.equal(ledger.receivedCents,0);
  assert.equal(ledger.pendingCents,5000);
  await assert.rejects(q("SELECT public.undo_mistaken_onsite_attendance_receipt($1,$2,$3,$4)",[studio,appt,owner,"Repetição indevida"]),/onsite_receipt_not_found/);
  await q("INSERT INTO cash_register_movements(id,session_id,studio_id,appointment_id,movement_type,payment_method,amount,description,source_key) VALUES($1,$2,$3,$4,'service_payment','cash',50,'Novo recebimento válido',$5)", ["00000000-0000-4000-8000-000000000015",openSession,studio,appt,"attendance-settlement:"+appt]);
  assert.equal((await q("SELECT count(*)::int AS n FROM cash_register_movements WHERE appointment_id=$1 AND amount>0",[appt]))[0].n,1);
  assert.equal((await q("SELECT count(*)::int AS n FROM appointments WHERE id=$1",[appt]))[0].n,1);
  await q("SELECT public.undo_mistaken_onsite_attendance_receipt($1,$2,$3,$4)",[studio,cancelledAppt,owner,"Cancelamento por engano"]);
  assert.equal((await q("SELECT status FROM appointments WHERE id=$1",[cancelledAppt]))[0].status,"confirmed");
  await q("SELECT public.undo_mistaken_onsite_attendance_receipt($1,$2,$3,$4)",[studio,noShowAppt,owner,"Falta por engano"]);
  assert.equal((await q("SELECT status FROM appointments WHERE id=$1",[noShowAppt]))[0].status,"confirmed");
  await q("SELECT public.undo_mistaken_onsite_attendance_receipt($1,$2,$3,$4)",[studio,closedAppt,owner,"Registo fechado incorreto"]);
  const closed=(await q("SELECT status,expected_cash_amount,difference_amount,summary FROM cash_register_sessions WHERE id=$1",[closedSession]))[0];
  assert.equal(closed.status,"closed");
  assert.equal(Number(closed.expected_cash_amount),10);
  assert.equal(Number(closed.difference_amount),50);
  assert.equal(Number(closed.summary.by_method.mb_way),0);
  assert.equal(Number(closed.summary.service_payments),0);
  assert.equal((await q("SELECT status FROM appointments WHERE id=$1",[closedAppt]))[0].status,"confirmed");
  await db.exec(rollback);
  assert.equal((await q("SELECT count(*)::int AS n FROM pg_proc WHERE proname='undo_mistaken_onsite_attendance_receipt'"))[0].n,0);
  assert.equal(Number((await q("SELECT amount FROM cash_register_movements WHERE id=$1",[movement]))[0].amount),0);
  assert.equal((await q("SELECT count(*)::int AS n FROM financial_audit_logs"))[0].n,4);
  console.log("Reversão manual, proteções, caixa pendente, idempotência e rollback: OK");
} finally {
  await db.close();
}
