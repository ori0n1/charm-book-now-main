import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../../../.tmp-bellza-sql-isolated/node_modules/@electric-sql/pglite/dist/index.js";

const db = await PGlite.create();
const query = async (sql, params = []) => (await db.query(sql, params)).rows;
const file = (path) => readFileSync(path, "utf8");
const studio = "11111111-1111-4111-8111-111111111111";
const otherStudio = "99999999-9999-4999-8999-999999999999";
const roles = ["studio_owner", "manager", "staff", "desk_staff"];
const actor = (index) => `22222222-2222-4222-8222-${String(index + 1).padStart(12, "0")}`;
const id = (group, index) => `${group}0000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
const signatures = [
  "public.correct_owner_appointment_action(uuid,uuid,text,uuid,text)",
  "public.guard_completed_appointment_cancellation()",
  "public.cancel_completed_appointment(uuid,uuid,text)",
  "public.edit_resolved_appointment_schedule(uuid,uuid,text,timestamptz,integer,text,uuid)",
  "public.edit_owner_resolved_appointment(uuid,uuid,text,timestamptz,jsonb,numeric,text,uuid)",
  "public.create_studio_walkin_appointment(uuid,jsonb,timestamptz,uuid,text,text,text)",
  "public.create_manual_multi_professional_appointment(uuid,jsonb,timestamptz,uuid,text,text,text)",
  "public.edit_studio_appointment(uuid,uuid,timestamptz,jsonb,numeric,text)",
  "public.create_studio_manual_multi_professional_fit(uuid,jsonb,timestamptz,uuid,text,text,text,boolean,uuid,uuid[])",
  "public.move_studio_appointment(uuid,uuid,timestamptz,integer,boolean,uuid,uuid[],text)",
  "public.swap_studio_appointments(uuid,uuid,uuid,boolean,uuid,uuid[])",
];
const definitions = async () => (await query(
  "SELECT pg_get_functiondef(to_regprocedure(x)) AS definition FROM unnest($1::text[]) x",
  [signatures],
)).map((row) => row.definition);

try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$
      SELECT current_setting('request.jwt.claim.role', true) $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE TYPE public.appointment_status AS ENUM ('confirmed','completed','no_show','cancelled');
    CREATE TABLE public.user_roles(user_id uuid, studio_id uuid, role text);
    CREATE TABLE public.services(id uuid PRIMARY KEY, studio_id uuid, is_active boolean DEFAULT true,
      duration_min integer, price numeric);
    CREATE TABLE public.studios(id uuid PRIMARY KEY, is_active boolean DEFAULT true);
    CREATE TABLE public.staff(id uuid PRIMARY KEY, studio_id uuid, user_id uuid, is_active boolean DEFAULT true,
      current_status text DEFAULT 'online');
    CREATE TABLE public.staff_services(staff_id uuid, service_id uuid);
    CREATE TABLE public.appointments(id uuid PRIMARY KEY, studio_id uuid, staff_id uuid,
      starts_at timestamptz, ends_at timestamptz, total_duration_min integer,
      status public.appointment_status, total_price numeric, notes text,
      studio_commission_percent_snapshot numeric, attendance_resolved_at timestamptz,
      attendance_resolved_by uuid, cancellation_reason text, cancelled_at timestamptz,
      cancelled_by uuid, updated_at timestamptz DEFAULT now(), duration_overridden boolean DEFAULT false,
      is_manual_fit boolean DEFAULT false);
    CREATE TABLE public.appointment_services(id uuid PRIMARY KEY, appointment_id uuid,
      service_id uuid, staff_id uuid, starts_at timestamptz, ends_at timestamptz,
      position integer, service_state text, duration_min integer, price numeric,
      studio_commission_percent_snapshot numeric, professional_commission_percent_snapshot numeric);
    CREATE TABLE public.cash_register_movements(id uuid PRIMARY KEY, studio_id uuid,
      appointment_id uuid, movement_type text, payment_method text, amount numeric);
    CREATE TABLE public.payment_intents(id uuid PRIMARY KEY, appointment_id uuid,
      amount_cents integer, status text);
    CREATE TABLE public.financial_audit_logs(studio_id uuid, actor_user_id uuid,
      entity_type text, entity_id uuid, action text, amount_cents integer, metadata jsonb);
    CREATE TABLE public.appointment_schedule_events(studio_id uuid, appointment_id uuid,
      actor_id uuid, operation text, previous_state jsonb, next_state jsonb);
    CREATE FUNCTION public.preview_studio_schedule_change(uuid,uuid,timestamptz,integer,uuid[])
      RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object(
        'hardBlocked', false, 'hasConflict', false, 'withinAvailability', true) $$;
    CREATE FUNCTION public.can_use_studio(p_user_id uuid, p_studio_id uuid)
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
      SELECT EXISTS (SELECT 1 FROM public.user_roles
        WHERE user_id = p_user_id AND studio_id = p_studio_id
          AND role IN ('studio_owner','manager','staff')) $$;
    CREATE FUNCTION public.create_studio_walkin_appointment(p_studio_id uuid, p_assignments jsonb,
      p_starts_at timestamptz, p_client_id uuid, p_client_name text, p_client_phone text, p_notes text)
      RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$
      SELECT public.can_use_studio(auth.uid(), p_studio_id) $$;
    CREATE FUNCTION public.create_manual_multi_professional_appointment(p_studio_id uuid, p_assignments jsonb,
      p_starts_at timestamptz, p_client_id uuid, p_client_name text, p_client_phone text, p_notes text)
      RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$
      SELECT public.can_use_studio(auth.uid(), p_studio_id) $$;
    CREATE FUNCTION public.edit_studio_appointment(p_studio_id uuid, p_appointment_id uuid,
      p_starts_at timestamptz, p_assignments jsonb, p_total_price numeric, p_notes text)
      RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$
      SELECT public.can_use_studio(auth.uid(), p_studio_id) $$;
    CREATE FUNCTION public.create_studio_manual_multi_professional_fit(p_studio_id uuid, p_assignments jsonb,
      p_starts_at timestamptz, p_client_id uuid, p_client_name text, p_client_phone text, p_notes text,
      p_confirm_overlap boolean, p_actor_id uuid, p_expected_conflict_ids uuid[])
      RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$
      SELECT public.can_use_studio(p_actor_id, p_studio_id) $$;
    CREATE FUNCTION public.move_studio_appointment(p_studio_id uuid, p_appointment_id uuid,
      p_starts_at timestamptz, p_duration_min integer, p_confirm_overlap boolean, p_actor_id uuid,
      p_expected_conflict_ids uuid[], p_operation text)
      RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$
      SELECT public.can_use_studio(p_actor_id, p_studio_id) $$;
    CREATE FUNCTION public.swap_studio_appointments(p_studio_id uuid, p_first_appointment_id uuid,
      p_second_appointment_id uuid, p_confirm_overlap boolean, p_actor_id uuid, p_expected_conflict_ids uuid[])
      RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$
      SELECT public.can_use_studio(p_actor_id, p_studio_id) $$;
  `);
  await db.exec(file("supabase/migrations/20261027160000_appointment_action_and_method_correction.sql"));
  await db.exec(file("supabase/migrations/20261027234500_resolved_appointment_schedule_edit.sql"));
  await db.exec(file("supabase/migrations/20261028010000_owner_resolved_full_edit.sql"));
  await db.exec(`CREATE TRIGGER synthetic_cancel_guard BEFORE UPDATE ON public.appointments
    FOR EACH ROW EXECUTE FUNCTION public.guard_completed_appointment_cancellation()`);

  const staffA = id("3", 0), staffB = id("3", 1);
  const serviceA = id("4", 0), serviceB = id("4", 1);
  await query("INSERT INTO public.studios(id) VALUES ($1),($2)", [studio, otherStudio]);
  await query("INSERT INTO public.staff(id,studio_id) VALUES ($1,$3),($2,$3)", [staffA, staffB, studio]);
  await query("UPDATE public.staff SET user_id=$1 WHERE id=$2", [actor(3), staffB]);
  await query("INSERT INTO public.services(id,studio_id,duration_min,price) VALUES ($1,$3,90,28),($2,$3,90,40)", [serviceA, serviceB, studio]);
  await query("INSERT INTO public.staff_services VALUES ($1,$3),($2,$4)", [staffA, staffB, serviceA, serviceB]);
  for (let index = 0; index < roles.length; index++) {
    await query("INSERT INTO public.user_roles VALUES ($1,$2,$3)", [actor(index), studio, roles[index]]);
  }
  await query("INSERT INTO public.user_roles VALUES ($1,$2,'staff')", [actor(8), otherStudio]);
  await query("SELECT set_config('request.jwt.claim.role','service_role',false)");
  await query("SELECT set_config('request.jwt.claim.sub',$1,false)", [actor(1)]);
  const before = await definitions();
  await assert.rejects(
    query("SELECT public.correct_owner_appointment_action($1,$2,'confirmed',$3,NULL)",
      [studio, id("5", 0), actor(1)]),
    /studio_owner_required/,
  );

  await db.exec(file("supabase/migrations/20261029230000_agenda_role_parity.sql"));
  assert.equal((await query("SELECT count(*)::int AS n FROM public.agenda_role_parity_function_backup_20261029"))[0].n, 11);
  const after = await definitions();
  for (let index = 0; index < signatures.length; index++) {
    const expected = index < 5 ? before[index].replace(
      /role\s+IN\s*\(\s*'studio_owner'\s*,\s*'saas_owner'\s*\)/i,
      "role IN ('studio_owner', 'saas_owner', 'manager', 'staff', 'desk_staff')",
    ) : before[index].replace(
      /public\.can_use_studio\(\s*(auth\.uid\(\)|p_actor_id)\s*,\s*p_studio_id\s*\)/i,
      "(public.can_use_studio($1, p_studio_id) OR public.can_use_agenda_desk($1, p_studio_id))",
    );
    assert.equal(after[index], expected,
      `only the role list may change: ${signatures[index]}`);
  }
  for (let index = 0; index < roles.length; index++) {
    await query("SELECT set_config('request.jwt.claim.sub',$1,false)", [actor(index)]);
    assert.equal((await query("SELECT public.create_studio_walkin_appointment($1,'[]',now(),NULL,NULL,NULL,NULL) AS allowed", [studio]))[0].allowed, true);
    assert.equal((await query("SELECT public.create_manual_multi_professional_appointment($1,'[]',now(),NULL,NULL,NULL,NULL) AS allowed", [studio]))[0].allowed, true);
    assert.equal((await query("SELECT public.edit_studio_appointment($1,$2,now(),'[]',0,NULL) AS allowed", [studio, id("5", 0)]))[0].allowed, true);
    assert.equal((await query("SELECT public.create_studio_manual_multi_professional_fit($1,'[]',now(),NULL,NULL,NULL,NULL,false,$2,'{}') AS allowed", [studio, actor(index)]))[0].allowed, true);
    assert.equal((await query("SELECT public.move_studio_appointment($1,$2,now(),90,false,$3,'{}','move') AS allowed", [studio, id("5", 0), actor(index)]))[0].allowed, true);
    assert.equal((await query("SELECT public.swap_studio_appointments($1,$2,$3,false,$4,'{}') AS allowed", [studio, id("5", 0), id("5", 1), actor(index)]))[0].allowed, true);
  }
  await query("SELECT set_config('request.jwt.claim.sub',$1,false)", [actor(8)]);
  assert.equal((await query("SELECT public.create_studio_walkin_appointment($1,'[]',now(),NULL,NULL,NULL,NULL) AS allowed", [studio]))[0].allowed, false);
  assert.equal((await query("SELECT public.move_studio_appointment($1,$2,now(),90,false,$3,'{}','move') AS allowed", [studio, id("5", 0), actor(8)]))[0].allowed, false);
  assert.equal((await query("SELECT public.can_use_agenda_desk($1,$2) AS allowed", [actor(3), otherStudio]))[0].allowed, false);
  await query("UPDATE public.staff SET is_active=false WHERE id=$1", [staffB]);
  assert.equal((await query("SELECT public.can_use_agenda_desk($1,$2) AS allowed", [actor(3), studio]))[0].allowed, false);
  await query("UPDATE public.staff SET is_active=true WHERE id=$1", [staffB]);

  for (let index = 0; index < roles.length; index++) {
    const cancelled = id("5", index), completed = id("6", index), joint = id("7", index);
    const firstLine = id("8", index * 2), secondLine = id("8", index * 2 + 1);
    const baseTime = new Date(Date.UTC(2030, 9, 29 + index, 9)).toISOString();
    const middle = new Date(Date.parse(baseTime) + 90 * 60_000).toISOString();
    const end = new Date(Date.parse(baseTime) + 180 * 60_000).toISOString();
    await query(`INSERT INTO public.appointments
      (id,studio_id,staff_id,starts_at,ends_at,total_duration_min,status,total_price,notes)
      VALUES ($1,$4,$5,$6,$7,90,'cancelled',28,'synthetic'),
             ($2,$4,$5,$6,$7,90,'completed',28,'synthetic'),
             ($3,$4,$5,$6,$8,180,'confirmed',68,'synthetic')`,
      [cancelled, completed, joint, studio, staffA, baseTime, middle, end]);
    await query(`INSERT INTO public.appointment_services
      (id,appointment_id,service_id,staff_id,starts_at,ends_at,position,service_state,duration_min,price)
      VALUES ($1,$4,$7,$9,$11,$12,0,NULL,90,28),
             ($2,$5,$7,$9,$11,$12,0,NULL,90,28),
             ($3,$6,$7,$9,$11,$12,0,'confirmed',90,28),
             ($8,$6,$10,$13,$12,$14,1,'confirmed',90,40)`,
      [id("a", index * 3), id("a", index * 3 + 1), firstLine,
        cancelled, completed, joint, serviceA, secondLine, staffA, serviceB,
        baseTime, middle, staffB, end]);

    await query("SELECT public.correct_owner_appointment_action($1,$2,'confirmed',$3,NULL)",
      [studio, cancelled, actor(index)]);
    assert.equal((await query("SELECT status FROM public.appointments WHERE id=$1", [cancelled]))[0].status, "confirmed");

    const movedResolved = new Date(Date.parse(baseTime) + 4 * 60 * 60_000).toISOString();
    const resolvedEdit = await query(`SELECT public.edit_resolved_appointment_schedule(
      $1,$2,'completed',$3,90,'resolved by ' || $4,$5) AS edited`,
      [studio, completed, movedResolved, roles[index], actor(index)]);
    assert.equal(resolvedEdit[0].edited.appointmentId, completed);
    assert.equal((await query("SELECT notes FROM public.appointments WHERE id=$1", [completed]))[0].notes,
      `resolved by ${roles[index]}`);

    await query("SELECT set_config('request.jwt.claim.role','authenticated',false)");
    await query("SELECT set_config('request.jwt.claim.sub',$1,false)", [actor(index)]);
    await query("SELECT public.cancel_completed_appointment($1,$2,'Correção sintética')", [studio, completed]);
    assert.equal((await query("SELECT status FROM public.appointments WHERE id=$1", [completed]))[0].status, "cancelled");
    await query("SELECT set_config('request.jwt.claim.role','service_role',false)");

    const movedJoint = new Date(Date.parse(baseTime) + 5 * 60 * 60_000).toISOString();
    const result = await query(`SELECT public.edit_owner_resolved_appointment(
      $1,$2,'confirmed',$3,$4::jsonb,68,'edited by ' || $5,$6) AS edited`,
      [studio, joint, movedJoint, JSON.stringify([
        { lineId: firstLine, serviceId: serviceA, staffId: staffA, durationMin: 90 },
        { lineId: secondLine, serviceId: serviceB, staffId: staffB, durationMin: 90 },
      ]), roles[index], actor(index)]);
    assert.equal(result[0].edited.appointmentId, joint);
    assert.equal((await query("SELECT notes FROM public.appointments WHERE id=$1", [joint]))[0].notes,
      `edited by ${roles[index]}`);
    assert.equal((await query("SELECT count(*)::int AS n FROM public.appointment_services WHERE appointment_id=$1", [joint]))[0].n, 2);
    const segments = await query("SELECT staff_id,starts_at,ends_at,price FROM public.appointment_services WHERE appointment_id=$1 ORDER BY position", [joint]);
    assert.equal(segments[0].staff_id, staffA);
    assert.equal(segments[1].staff_id, staffB);
    assert.equal(new Date(segments[0].starts_at).toISOString(), movedJoint);
    assert.equal(new Date(segments[1].starts_at).toISOString(), new Date(Date.parse(movedJoint) + 90 * 60_000).toISOString());
    assert.equal(Number(segments[0].price) + Number(segments[1].price), 68);
  }

  const paidJoint = id("9", 0), paidLineA = id("c", 0), paidLineB = id("c", 1);
  const paidStart = "2031-01-01T09:00:00.000Z";
  const paidMiddle = "2031-01-01T10:30:00.000Z";
  const paidEnd = "2031-01-01T12:00:00.000Z";
  const paidAssignments = JSON.stringify([
    { lineId: paidLineA, serviceId: serviceA, staffId: staffA, durationMin: 90 },
    { lineId: paidLineB, serviceId: serviceB, staffId: staffB, durationMin: 90 },
  ]);
  await query(`INSERT INTO public.appointments
    (id,studio_id,staff_id,starts_at,ends_at,total_duration_min,status,total_price)
    VALUES ($1,$2,$3,$4,$5,180,'confirmed',68)`, [paidJoint, studio, staffA, paidStart, paidEnd]);
  await query(`INSERT INTO public.appointment_services
    (id,appointment_id,service_id,staff_id,starts_at,ends_at,position,service_state,duration_min,price)
    VALUES ($1,$3,$4,$6,$8,$9,0,'confirmed',90,28),
           ($2,$3,$5,$7,$9,$10,1,'confirmed',90,40)`,
    [paidLineA, paidLineB, paidJoint, serviceA, serviceB,
      staffA, staffB, paidStart, paidMiddle, paidEnd]);
  await query("INSERT INTO public.payment_intents VALUES ($1,$2,6800,'succeeded')", [id("d", 0), paidJoint]);
  const stripeBefore = await query("SELECT to_jsonb(p) AS row FROM public.payment_intents p WHERE appointment_id=$1", [paidJoint]);
  await assert.rejects(query(`SELECT public.edit_owner_resolved_appointment(
    $1,$2,'confirmed',$3,$4::jsonb,60,'blocked',$5)`,
    [studio, paidJoint, paidStart, paidAssignments, actor(1)]), /price_below_recorded_receipts/);
  await assert.rejects(query(`SELECT public.edit_owner_resolved_appointment(
    $1,$2,'confirmed',$3,$4::jsonb,68,'blocked',$5)`,
    [studio, paidJoint, paidStart, JSON.stringify([
      { lineId: paidLineA, serviceId: serviceB, staffId: staffA, durationMin: 90 },
      { lineId: paidLineB, serviceId: serviceB, staffId: staffB, durationMin: 90 },
    ]), actor(1)]), /received_reservation_financial_fields_locked/);
  const paidMoved = "2031-01-01T13:00:00.000Z";
  await query(`SELECT public.edit_owner_resolved_appointment(
    $1,$2,'confirmed',$3,$4::jsonb,68,'paid schedule only',$5)`,
    [studio, paidJoint, paidMoved, paidAssignments, actor(1)]);
  assert.deepEqual(await query("SELECT to_jsonb(p) AS row FROM public.payment_intents p WHERE appointment_id=$1", [paidJoint]), stripeBefore);
  assert.equal((await query("SELECT notes FROM public.appointments WHERE id=$1", [paidJoint]))[0].notes, "paid schedule only");

  await assert.rejects(query("SELECT public.correct_owner_appointment_action($1,$2,'confirmed',$3,NULL)",
    [studio, id("5", 0), actor(8)]), /studio_owner_required/);
  await assert.rejects(query("SELECT public.correct_onsite_payment_method($1,$2,$3,'card',$4)",
    [studio, id("5", 0), id("b", 0), actor(1)]), /studio_owner_required/);
  assert.equal((await query("SELECT count(*)::int AS n FROM public.payment_intents"))[0].n, 1);
  assert.equal((await query("SELECT count(*)::int AS n FROM public.cash_register_movements"))[0].n, 0);

  const countsBeforeRollback = await query("SELECT count(*)::int AS n FROM public.appointments");
  await db.exec(file("supabase/rollback/20261029230000_agenda_role_parity.sql"));
  assert.deepEqual(await definitions(), before);
  assert.deepEqual(await query("SELECT count(*)::int AS n FROM public.appointments"), countsBeforeRollback);
  await assert.rejects(query("SELECT public.correct_owner_appointment_action($1,$2,'confirmed',$3,NULL)",
    [studio, id("5", 0), actor(1)]), /studio_owner_required/);
  console.log("Agenda role parity: 4 synthetic roles, simple/joint/completed/cancelled, financial guards and rollback OK");
} finally {
  await db.close();
}
