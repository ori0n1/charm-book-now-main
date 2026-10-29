import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import ts from "typescript";

const output = execFileSync("supabase", ["status", "--workdir", "tmp/agenda-disposable", "-o", "json"], { encoding: "utf8" });
const status = JSON.parse(output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1));
assert.equal(status.API_URL, "http://127.0.0.1:57921");
const sb = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const source = readFileSync("src/lib/server-security.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
const requireLocal = (name) => {
  if (name === "@tanstack/react-start/server") return { getRequest: () => null };
  if (name === "@/lib/supabase-admin.server") return { getAdminClient: () => sb };
  throw new Error(`Unexpected dependency: ${name}`);
};
new Function("require", "module", "exports", compiled)(requireLocal, module, module.exports);
const { assertAgendaStudioAccess, assertAgendaAppointmentAccess, assertStudioAccess } = module.exports;

const studio = "11111111-1111-4111-8111-111111111111";
const ownAppointment = "44444444-4444-4444-8444-000000000001";
const otherAppointment = "44444444-4444-4444-8444-000000000002";
const roles = ["studio_owner", "manager", "staff", "desk_staff"];
const forbidden = async (operation) => assert.rejects(operation, (error) => error instanceof Response && error.status === 403);
const accountIds = [];
for (let index = 0; index < roles.length + 1; index++) {
  const email = `agenda-${roles[index] ?? "other"}-${crypto.randomUUID()}@synthetic.invalid`;
  const password = `AgendaLocal-${crypto.randomUUID()}!`;
  const { data: created, error: createError } = await sb.auth.admin.createUser({ email, password, email_confirm: true });
  if (createError || !created.user) throw createError ?? new Error("synthetic_user_not_created");
  const client = createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false } });
  const { data: signedIn, error: loginError } = await client.auth.signInWithPassword({ email, password });
  if (loginError || !signedIn.session) throw loginError ?? new Error("synthetic_login_failed");
  const { data: verified, error: verifyError } = await sb.auth.getUser(signedIn.session.access_token);
  if (verifyError || verified.user?.id !== created.user.id) throw verifyError ?? new Error("synthetic_identity_mismatch");
  accountIds.push(created.user.id);
  const roleStudio = index < roles.length ? studio : "99999999-9999-4999-8999-999999999999";
  const { error: roleError } = await sb.from("user_roles").update({ user_id: created.user.id })
    .eq("studio_id", roleStudio).eq("role", roles[index] ?? "studio_owner");
  if (roleError) throw roleError;
  if (index === 2 || index === 3) {
    const staffId = `33333333-3333-4333-8333-${String(index - 1).padStart(12, "0")}`;
    const { error: staffError } = await sb.from("staff").update({ user_id: created.user.id }).eq("id", staffId);
    if (staffError) throw staffError;
  }
}
const actor = (index) => accountIds[index];

for (let index = 0; index < roles.length; index++) {
  await assertAgendaStudioAccess(sb, actor(index), studio);
  await assertAgendaAppointmentAccess(sb, actor(index), ownAppointment);
  await forbidden(() => assertAgendaAppointmentAccess(sb, actor(index), otherAppointment));
}
await forbidden(() => assertStudioAccess(sb, actor(3), studio));
await forbidden(() => assertAgendaStudioAccess(sb, actor(8), studio));

const deskStaffId = "33333333-3333-4333-8333-000000000002";
try {
  const { error: disableError } = await sb.from("staff").update({ is_active: false }).eq("id", deskStaffId);
  if (disableError) throw disableError;
  await forbidden(() => assertAgendaStudioAccess(sb, actor(3), studio));
} finally {
  const { error: restoreError } = await sb.from("staff").update({ is_active: true }).eq("id", deskStaffId);
  if (restoreError) throw restoreError;
}

console.log("Local agenda server access: 4 synthetic roles, studio isolation and inactive desk guard OK");
