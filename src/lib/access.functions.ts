import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type AccessRole = "manager" | "staff" | "desk_staff";
type InviteStatus =
  | "pending"
  | "sent"
  | "viewed"
  | "password_created"
  | "active"
  | "cancelled"
  | "expired";

let _admin: ReturnType<typeof createClient> | null = null;
function admin(): any {
  if (!_admin) {
    _admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
  }
  return _admin;
}

const OWNER_ROLES = ["saas_owner", "studio_owner", "manager"];
const MANAGED_ROLES: AccessRole[] = ["manager", "staff", "desk_staff"];

export const getTeamAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ studioId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const sb = admin();
    await assertCanManageStudioAccess(sb, (context as any).userId, data.studioId);

    const { data: staffRows, error: staffError } = await sb
      .from("staff")
      .select(
        "id,name,user_id,whatsapp,photo_url,invite_token,invite_role,invite_status,invite_expires_at,invite_code",
      )
      .eq("studio_id", data.studioId);
    if (staffError) throw new Error(staffError.message);

    const userIds = [...new Set((staffRows ?? []).map((row: any) => row.user_id).filter(Boolean))];
    if (userIds.length === 0) return (staffRows ?? []).map(inviteAccessRow).filter(Boolean);

    const [{ data: roles, error: rolesError }, authUsers] = await Promise.all([
      sb
        .from("user_roles")
        .select("user_id,role")
        .eq("studio_id", data.studioId)
        .in("user_id", userIds)
        .in("role", MANAGED_ROLES),
      listAllUsers(sb),
    ]);
    if (rolesError) throw new Error(rolesError.message);

    const roleByUser = new Map((roles ?? []).map((row: any) => [row.user_id, row.role as AccessRole]));
    const userById = new Map(authUsers.map((user: any) => [user.id, user]));

    return (staffRows ?? [])
      .map((staff: any) => {
        if (!staff.user_id) return inviteAccessRow(staff);
        const user = userById.get(staff.user_id);
        const role = roleByUser.get(staff.user_id);
        if (!user || !role) return null;
        return {
          staffId: staff.id,
          userId: staff.user_id,
          email: user.email ?? "",
          role,
          status: user.email_confirmed_at || user.last_sign_in_at ? "active" : "pending",
          inviteStatus: (staff.invite_status as InviteStatus | null) ?? "active",
          inviteUrl: staff.invite_token ? `${getOrigin()}/convite-equipa/${staff.invite_token}` : null,
          inviteCode: staff.invite_code ?? null,
          inviteExpiresAt: staff.invite_expires_at ?? null,
          whatsapp: staff.whatsapp ?? null,
          staffName: staff.name,
          photoUrl: staff.photo_url ?? null,
          invitedAt: user.invited_at ?? user.created_at ?? null,
          lastSignInAt: user.last_sign_in_at ?? null,
        };
      })
      .filter(Boolean);
  });

export const createStaffInviteLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        studioId: z.string().uuid(),
        staffId: z.string().uuid(),
        role: z.enum(["manager", "staff", "desk_staff"]).default("desk_staff"),
        expiresAt: z.string().datetime().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const sb = admin();
    await assertCanManageStudioAccess(sb, (context as any).userId, data.studioId);
    const staff = await assertStaffInStudio(sb, data.staffId, data.studioId);

    if (!staff.whatsapp?.trim()) {
      throw new Error("Adicione o WhatsApp da profissional antes de criar o convite.");
    }

    if (staff.user_id) {
      return {
        ok: true,
        status: "active",
        staffId: staff.id,
        staffName: staff.name,
        whatsapp: staff.whatsapp ?? null,
        role: data.role,
        inviteUrl: `${getOrigin()}/admin`,
        inviteCode: null,
        inviteExpiresAt: null,
      };
    }

    const token = generateInviteToken();
    const inviteCode = generateInviteCode();
    const { error } = await sb
      .from("staff")
      .update({
        invite_token: token,
        invite_code: inviteCode,
        invite_role: data.role,
        invite_status: "pending",
        invite_expires_at: data.expiresAt ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.staffId)
      .eq("studio_id", data.studioId);
    if (error) throw new Error(error.message);

    return {
      ok: true,
      status: "pending",
      staffId: staff.id,
      staffName: staff.name,
      whatsapp: staff.whatsapp ?? null,
      role: data.role,
      inviteUrl: `${getOrigin()}/convite-equipa/${token}`,
      inviteCode,
      inviteExpiresAt: data.expiresAt ?? null,
    };
  });

export const getStaffInviteLink = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ token: z.string().min(12) }).parse(input))
  .handler(async ({ data }) => {
    const sb = admin();
    const { data: staff, error } = await sb
      .from("staff")
      .select(
        "id,studio_id,name,role,whatsapp,photo_url,user_id,invite_status,invite_expires_at,invite_code,studios:studio_id(name)",
      )
      .eq("invite_token", data.token)
      .maybeSingle();
    if (error || !staff?.id) throw new Response("invite_not_found", { status: 404 });

    const expiresAt = staff.invite_expires_at ? new Date(staff.invite_expires_at) : null;
    const expired = Boolean(expiresAt && expiresAt.getTime() < Date.now());
    if (!staff.user_id && expired && staff.invite_status !== "expired") {
      await sb
        .from("staff")
        .update({ invite_status: "expired", updated_at: new Date().toISOString() })
        .eq("id", staff.id);
    }

    if (!staff.user_id && !expired && ["pending", "sent"].includes(staff.invite_status ?? "pending")) {
      await sb
        .from("staff")
        .update({ invite_status: "viewed", updated_at: new Date().toISOString() })
        .eq("id", staff.id);
    }

    return {
      staffId: staff.id,
      staffName: staff.name,
      staffRole: staff.role ?? "",
      studioName: staff.studios?.name ?? "estudio",
      whatsapp: staff.whatsapp ?? "",
      photoUrl: staff.photo_url ?? null,
      status: staff.user_id ? "active" : expired ? "expired" : (staff.invite_status ?? "pending"),
      inviteCode: staff.invite_code ?? null,
      expiresAt: staff.invite_expires_at ?? null,
    };
  });

export const acceptStaffInviteLink = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        token: z.string().min(12),
        password: z.string().min(6),
        code: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const sb = admin();
    const { data: staff, error } = await sb
      .from("staff")
      .select(
        "id,studio_id,name,whatsapp,user_id,invite_role,invite_status,invite_expires_at,invite_code,studios:studio_id(name)",
      )
      .eq("invite_token", data.token)
      .maybeSingle();
    if (error || !staff?.id) throw new Response("invite_not_found", { status: 404 });
    if (staff.user_id || ["active", "password_created"].includes(staff.invite_status ?? "")) {
      throw new Error("Esta conta ja esta ativa. Entre pelo login.");
    }
    if (["cancelled", "expired"].includes(staff.invite_status ?? "")) {
      throw new Error("Este convite ja nao esta ativo.");
    }
    if (staff.invite_expires_at && new Date(staff.invite_expires_at).getTime() < Date.now()) {
      await sb
        .from("staff")
        .update({ invite_status: "expired", updated_at: new Date().toISOString() })
        .eq("id", staff.id);
      throw new Error("Este convite expirou.");
    }
    if (staff.invite_code && data.code?.trim() && data.code.trim().toUpperCase() !== staff.invite_code) {
      throw new Error("Codigo de acesso invalido.");
    }

    const role = (staff.invite_role as AccessRole | null) ?? "desk_staff";
    const email = syntheticInviteEmail(staff.whatsapp);
    const emailCandidates = syntheticInviteEmailCandidates(staff.whatsapp);
    let userId = staff.user_id as string | null;
    let loginEmail = email;

    if (userId) {
      loginEmail = await updateInviteUserPassword(sb, userId, email, data.password);
    } else {
      const existing = await findUserByEmails(sb, emailCandidates);
      if (existing) {
        userId = existing.id;
        loginEmail = await updateInviteUserPassword(sb, userId, email, data.password);
      } else {
        const { data: created, error: createError } = await sb.auth.admin.createUser({
          email,
          password: data.password,
          email_confirm: true,
          user_metadata: {
            full_name: staff.name,
            staff_name: staff.name,
            studio_name: staff.studios?.name,
            whatsapp: staff.whatsapp,
            access_role: role,
          },
        });
        if (createError) throw new Error(createError.message);
        userId = created.user?.id ?? null;
        loginEmail = created.user?.email ?? email;
      }
    }

    if (!userId) throw new Error("Nao foi possivel ativar a conta.");
    await sb
      .from("staff")
      .update({ user_id: userId, invite_status: "password_created", updated_at: new Date().toISOString() })
      .eq("id", staff.id);
    await replaceRole(sb, staff.studio_id, userId, role);
    const { error: updateError } = await sb
      .from("staff")
      .update({
        user_id: userId,
        invite_token: null,
        invite_code: null,
        invite_status: "active",
        updated_at: new Date().toISOString(),
      })
      .eq("id", staff.id);
    if (updateError) throw new Error(updateError.message);

    return { ok: true, email: loginEmail, landing: role === "desk_staff" ? "/admin/balcao" : "/admin" };
  });

export const resolveTeamLoginIdentifier = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ identifier: z.string().min(1) }).parse(input))
  .handler(async ({ data }) => {
    const raw = data.identifier.trim();
    if (raw.includes("@")) return { loginId: raw.toLowerCase() };

    const normalized = normalizeInvitePhone(raw);
    if (!normalized) return { loginId: raw };

    const sb = admin();
    const { data: rows, error } = await sb
      .from("staff")
      .select("id,whatsapp,user_id")
      .not("user_id", "is", null);
    if (error) throw new Error(error.message);

    const staff = (rows ?? []).find((row: any) => normalizeInvitePhone(row.whatsapp) === normalized);
    if (staff?.user_id) {
      const user = await getUserById(sb, staff.user_id);
      if (user?.email) return { loginId: user.email.toLowerCase() };
    }

    return { loginId: syntheticInviteEmail(raw) };
  });

export const inviteStaffAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        studioId: z.string().uuid(),
        staffId: z.string().uuid(),
        email: z.string().email(),
        role: z.enum(["manager", "staff", "desk_staff"]).default("desk_staff"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const sb = admin();
    await assertCanManageStudioAccess(sb, (context as any).userId, data.studioId);
    const staff = await assertStaffInStudio(sb, data.staffId, data.studioId);
    const studio = await loadStudioName(sb, data.studioId);

    const email = data.email.trim().toLowerCase();
    const user = await findOrInviteUser(sb, email, {
      studioName: studio.name,
      staffName: staff.name,
      role: data.role,
    });

    await replaceRole(sb, data.studioId, user.id, data.role);

    const { error: updateError } = await sb
      .from("staff")
      .update({ user_id: user.id, updated_at: new Date().toISOString() })
      .eq("id", data.staffId)
      .eq("studio_id", data.studioId);
    if (updateError) throw new Error(updateError.message);

    return {
      ok: true,
      email,
      role: data.role,
      accessUrl: `${getOrigin()}/login`,
    };
  });

export const resendStaffInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ studioId: z.string().uuid(), staffId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const sb = admin();
    await assertCanManageStudioAccess(sb, (context as any).userId, data.studioId);
    const staff = await assertStaffInStudio(sb, data.staffId, data.studioId);
    if (!staff.user_id) {
      const shouldRegenerate =
        !staff.invite_token ||
        ["cancelled", "expired"].includes(staff.invite_status ?? "") ||
        Boolean(staff.invite_expires_at && new Date(staff.invite_expires_at).getTime() < Date.now());
      const token = shouldRegenerate ? generateInviteToken() : staff.invite_token;
      const inviteCode = shouldRegenerate ? generateInviteCode() : staff.invite_code;
      const { error } = await sb
        .from("staff")
        .update({
          invite_token: token,
          invite_code: inviteCode,
          invite_status: "sent",
          invite_expires_at: shouldRegenerate ? null : staff.invite_expires_at,
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.staffId)
        .eq("studio_id", data.studioId);
      if (error) throw new Error(error.message);
      return {
        ok: true,
        staffId: staff.id,
        staffName: staff.name,
        role: (staff.invite_role as AccessRole | null) ?? "desk_staff",
        status: "sent",
        inviteUrl: `${getOrigin()}/convite-equipa/${token}`,
        inviteCode,
        inviteExpiresAt: shouldRegenerate ? null : staff.invite_expires_at,
        whatsapp: staff.whatsapp ?? null,
      };
    }
    if (!staff.user_id) throw new Error("Esta profissional ainda não tem acesso configurado.");

    const user = await getUserById(sb, staff.user_id);
    if (!user?.email) throw new Error("Não foi possível encontrar o email da profissional.");

    const { error } = await sb.auth.admin.inviteUserByEmail(user.email, {
      redirectTo: `${getOrigin()}/reset-password?invite=team`,
      data: { studio_name: await studioNameForMetadata(sb, data.studioId), staff_name: staff.name },
    });
    if (error) throw new Error(error.message);
    return { ok: true, email: user.email };
  });

export const updateStaffAccessRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        studioId: z.string().uuid(),
        staffId: z.string().uuid(),
        role: z.enum(["manager", "staff", "desk_staff"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const sb = admin();
    await assertCanManageStudioAccess(sb, (context as any).userId, data.studioId);
    const staff = await assertStaffInStudio(sb, data.staffId, data.studioId);
    if (!staff.user_id) throw new Error("Esta profissional ainda não tem acesso configurado.");
    await replaceRole(sb, data.studioId, staff.user_id, data.role);
    return { ok: true };
  });

export const removeStaffAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ studioId: z.string().uuid(), staffId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const sb = admin();
    await assertCanManageStudioAccess(sb, (context as any).userId, data.studioId);
    const staff = await assertStaffInStudio(sb, data.staffId, data.studioId);
    if (staff.user_id) {
      const { error } = await sb
        .from("user_roles")
        .delete()
        .eq("studio_id", data.studioId)
        .eq("user_id", staff.user_id)
        .in("role", MANAGED_ROLES);
      if (error) throw new Error(error.message);
    }
    const { error: updateError } = await sb
      .from("staff")
      .update({
        user_id: null,
        invite_token: null,
        invite_code: null,
        invite_expires_at: null,
        invite_status: "cancelled",
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.staffId)
      .eq("studio_id", data.studioId);
    if (updateError) throw new Error(updateError.message);
    return { ok: true };
  });

async function assertCanManageStudioAccess(sb: any, userId: string, studioId: string) {
  const { data, error } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("studio_id", studioId)
    .in("role", OWNER_ROLES)
    .limit(1)
    .maybeSingle();

  if (error || !data?.role) throw new Response("forbidden", { status: 403 });
}

async function assertStaffInStudio(sb: any, staffId: string, studioId: string) {
  const { data, error } = await sb
    .from("staff")
    .select("id,name,user_id,whatsapp,invite_token,invite_code,invite_role,invite_status,invite_expires_at")
    .eq("id", staffId)
    .eq("studio_id", studioId)
    .maybeSingle();
  if (error || !data?.id) throw new Response("staff_not_found", { status: 404 });
  return data;
}

function inviteAccessRow(staff: any) {
  if (!staff.invite_token) return null;
  return {
    staffId: staff.id,
    userId: staff.user_id ?? "",
    email: "",
    role: (staff.invite_role as AccessRole | null) ?? "desk_staff",
    status: staff.invite_status === "active" ? "active" : "pending",
    inviteStatus: (staff.invite_status as InviteStatus | null) ?? "pending",
    inviteUrl: `${getOrigin()}/convite-equipa/${staff.invite_token}`,
    inviteCode: staff.invite_code ?? null,
    inviteExpiresAt: staff.invite_expires_at ?? null,
    whatsapp: staff.whatsapp ?? null,
    staffName: staff.name,
    photoUrl: staff.photo_url ?? null,
    invitedAt: null,
    lastSignInAt: null,
  };
}

async function loadStudioName(sb: any, studioId: string) {
  const { data, error } = await sb.from("studios").select("name").eq("id", studioId).maybeSingle();
  if (error || !data?.name) throw new Response("studio_not_found", { status: 404 });
  return data;
}

async function replaceRole(sb: any, studioId: string, userId: string, role: AccessRole) {
  const { error: deleteError } = await sb
    .from("user_roles")
    .delete()
    .eq("studio_id", studioId)
    .eq("user_id", userId)
    .in("role", MANAGED_ROLES);
  if (deleteError) throw new Error(deleteError.message);

  const { error } = await sb.from("user_roles").insert({ user_id: userId, studio_id: studioId, role });
  if (error) throw new Error(error.message);
}

async function findOrInviteUser(
  sb: any,
  email: string,
  metadata: { studioName: string; staffName: string; role: AccessRole },
) {
  const existing = await findUserByEmail(sb, email);
  if (existing) return existing;

  const { data, error } = await sb.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${getOrigin()}/reset-password?invite=team`,
    data: {
      studio_name: metadata.studioName,
      staff_name: metadata.staffName,
      access_role: metadata.role,
      login_url: `${getOrigin()}/login`,
    },
  });
  if (error) {
    const retry = await findUserByEmail(sb, email);
    if (retry) return retry;
    throw new Error(error.message);
  }
  if (!data?.user?.id) throw new Error("Não foi possível criar o convite.");
  return data.user;
}

async function findUserByEmail(sb: any, email: string) {
  const users = await listAllUsers(sb);
  return users.find((user: { id: string; email?: string }) => user.email?.toLowerCase() === email);
}

async function getUserById(sb: any, userId: string) {
  const users = await listAllUsers(sb);
  return users.find((user: { id: string }) => user.id === userId);
}

async function listAllUsers(sb: any) {
  const users: any[] = [];
  let page = 1;
  while (page <= 10) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    users.push(...(data.users ?? []));
    if (!data.users || data.users.length < 1000) break;
    page += 1;
  }
  return users;
}

async function studioNameForMetadata(sb: any, studioId: string) {
  const studio = await loadStudioName(sb, studioId);
  return studio.name;
}

function getOrigin() {
  const request = getRequest();
  const origin = request?.headers.get("origin");
  if (origin) return origin;
  const host = request?.headers.get("host");
  const proto = request?.headers.get("x-forwarded-proto") || "https";
  return host ? `${proto}://${host}` : "http://localhost:8081";
}

function generateInviteCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function generateInviteToken() {
  return crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "").slice(0, 12);
}

function normalizeInvitePhone(value: string | null) {
  const digits = (value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("351") || digits.length > 9) return digits;
  return `351${digits}`;
}

function syntheticInviteEmail(whatsapp: string | null) {
  const normalized = normalizeInvitePhone(whatsapp);
  if (!normalized) throw new Error("Adicione o WhatsApp da profissional antes de criar o acesso.");
  return `${normalized}@balcao.local`;
}

function syntheticInviteEmailCandidates(whatsapp: string | null) {
  const digits = (whatsapp ?? "").replace(/\D/g, "");
  const normalized = normalizeInvitePhone(whatsapp);
  return [...new Set([normalized, digits].filter(Boolean).map((value) => `${value}@balcao.local`))];
}

async function findUserByEmails(sb: any, emails: string[]) {
  const lowered = new Set(emails.map((email) => email.toLowerCase()));
  const users = await listAllUsers(sb);
  return users.find((user: { id: string; email?: string }) => user.email && lowered.has(user.email.toLowerCase()));
}

async function updateInviteUserPassword(sb: any, userId: string, preferredEmail: string, password: string) {
  const current = await getUserById(sb, userId);
  const currentEmail = current?.email ?? preferredEmail;
  if (currentEmail.toLowerCase() !== preferredEmail.toLowerCase()) {
    const { data, error } = await sb.auth.admin.updateUserById(userId, {
      email: preferredEmail,
      password,
      email_confirm: true,
    });
    if (!error) return data.user?.email ?? preferredEmail;
  }

  const { data, error } = await sb.auth.admin.updateUserById(userId, {
    password,
    email_confirm: true,
  });
  if (error) throw new Error(error.message);
  return data.user?.email ?? currentEmail;
}
