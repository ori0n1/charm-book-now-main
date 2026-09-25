import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertStudioAccess, rateLimitOrThrow } from "@/lib/server-security";
import { getAdminClient } from "@/lib/supabase-admin.server";

const StudioInput = z.object({ studioId: z.string().uuid() });
const ResolveAttendanceInput = StudioInput.extend({
  appointmentIds: z.array(z.string().uuid()).min(1).max(100),
  outcome: z.enum(["completed", "no_show"]),
});
const ClientSearchInput = StudioInput.extend({
  query: z.string().trim().min(2).max(80),
});

type StudioRole = "saas_owner" | "studio_owner" | "manager" | "staff" | "desk_staff";
type AgendaVisibility = "private" | "team_busy" | "team_basic";

const FULL_ROLES = new Set<StudioRole>(["saas_owner", "studio_owner", "manager"]);

export const getProtectedAgendaData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => StudioInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = getAdminClient() as any;
    const userId = String((context as any).userId ?? "");
    await assertStudioAccess(admin, userId, data.studioId);

    const access = await resolveStudioRole(admin, userId, data.studioId);
    if (access.role === "desk_staff") throw new Response("forbidden", { status: 403 });

    const { data: studio, error: studioError } = await admin
      .from("studios")
      .select("staff_agenda_visibility,appointment_reminder_minutes,attendance_grace_minutes")
      .eq("id", data.studioId)
      .maybeSingle();
    if (studioError || !studio) throw new Error("agenda_studio_not_found");

    const visibility = normalizeVisibility(studio.staff_agenda_visibility);
    const ownStaffId = access.role === "staff" ? access.staffId : null;
    if (access.role === "staff" && !ownStaffId) {
      throw new Response("staff_identity_required", { status: 403 });
    }

    let appointmentsQuery = admin
      .from("appointments")
      .select(
        "id,public_token,starts_at,ends_at,status,total_price,total_duration_min,studio_commission_percent_snapshot,notes,is_manual_fit,duration_overridden,clients(name,phone,avatar_url,date_of_birth),staff(id,name,commission_percent,deposit_recipient,deposit_professional_percent),appointment_services(price,studio_commission_percent_snapshot,services(name,commission_percent,deposit_recipient,deposit_professional_percent))",
      )
      .eq("studio_id", data.studioId)
      .order("starts_at", { ascending: true })
      .limit(1000);

    if (access.role === "staff" && visibility === "private") {
      appointmentsQuery = appointmentsQuery.eq("staff_id", ownStaffId);
    }

    const [appointmentsResult, staffResult, availabilityResult] = await Promise.all([
      appointmentsQuery,
      admin
        .from("staff")
        .select("id,name,photo_url,is_active")
        .eq("studio_id", data.studioId)
        .eq("is_active", true)
        .order("sort_order")
        .order("name"),
      admin
        .from("staff_availability")
        .select("staff_id,weekday,start_time,end_time")
        .eq("studio_id", data.studioId),
    ]);

    if (appointmentsResult.error) throw appointmentsResult.error;
    if (staffResult.error) throw staffResult.error;
    if (availabilityResult.error) throw availabilityResult.error;

    const rawAppointments = (appointmentsResult.data ?? []) as any[];
    const ownAppointments =
      access.role === "staff"
        ? rawAppointments.filter((row) => relationOne(row.staff)?.id === ownStaffId)
        : rawAppointments;
    const sensitiveAppointmentIds = ownAppointments.map((row) => String(row.id));

    const [payments, scheduleEvents, cashPayments, refunds, messageLogs] = await Promise.all([
      loadAppointmentRows(
        admin
          .from("payment_intents")
          .select("id,appointment_id,amount_cents,status,dispute_status,disputed_amount_cents")
          .eq("studio_id", data.studioId),
        sensitiveAppointmentIds,
      ),
      loadAppointmentRows(
        admin
          .from("appointment_schedule_events")
          .select(
            "appointment_id,related_appointment_id,operation,overlap_confirmed,previous_state,next_state,created_at",
          )
          .eq("studio_id", data.studioId)
          .order("created_at", { ascending: false })
          .limit(1000),
        sensitiveAppointmentIds,
      ),
      loadAppointmentRows(
        admin
          .from("cash_register_movements")
          .select("id,appointment_id,amount,movement_type")
          .eq("studio_id", data.studioId)
          .eq("movement_type", "service_payment"),
        sensitiveAppointmentIds,
      ),
      loadAppointmentRows(
        admin
          .from("refund_requests")
          .select("id,appointment_id,payment_intent_id,amount_cents,status,payment_intents(amount_cents)")
          .eq("studio_id", data.studioId)
          .eq("status", "refunded"),
        sensitiveAppointmentIds,
      ),
      loadAppointmentRows(
        admin
          .from("whatsapp_message_logs")
          .select("appointment_id,status,reason,created_at")
          .eq("studio_id", data.studioId)
          .order("created_at", { ascending: false }),
        sensitiveAppointmentIds,
      ),
    ]);

    const appointments =
      access.role === "staff"
        ? rawAppointments
            .filter(
              (row) =>
                relationOne(row.staff)?.id === ownStaffId ||
                !["cancelled", "canceled"].includes(String(row.status).toLowerCase()),
            )
            .map((row) =>
              relationOne(row.staff)?.id === ownStaffId
                ? row
                : maskTeamAppointment(row, visibility),
            )
        : rawAppointments;

    return {
      appointments,
      staff: staffResult.data ?? [],
      availability: availabilityResult.data ?? [],
      lifecycleSettings: {
        reminderMinutes: Number(studio.appointment_reminder_minutes ?? 120),
        graceMinutes: Number(studio.attendance_grace_minutes ?? 30),
      },
      payments,
      cashPayments,
      refunds,
      messageLogs,
      scheduleEvents,
    };
  });

export const resolveProtectedAppointmentAttendance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ResolveAttendanceInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = getAdminClient() as any;
    const userId = String((context as any).userId ?? "");
    await assertStudioAccess(admin, userId, data.studioId);
    await rateLimitOrThrow({
      key: `appointment-attendance:${data.studioId}:${userId}`,
      limit: 60,
      windowMs: 60_000,
    });

    const appointmentIds = [...new Set(data.appointmentIds)];
    const [access, appointmentResult] = await Promise.all([
      resolveStudioRole(admin, userId, data.studioId),
      admin
        .from("appointments")
        .select("id,studio_id,staff_id,status")
        .in("id", appointmentIds)
        .eq("studio_id", data.studioId),
    ]);
    if (
      appointmentResult.error ||
      !appointmentResult.data ||
      appointmentResult.data.length !== appointmentIds.length
    ) {
      throw new Response("appointment_not_found", { status: 404 });
    }
    if (access.role === "desk_staff") throw new Response("forbidden", { status: 403 });
    if (
      access.role === "staff" &&
      appointmentResult.data.some((appointment: any) => appointment.staff_id !== access.staffId)
    ) {
      throw new Response("forbidden", { status: 403 });
    }

    const { data: resolved, error } = await admin.rpc("resolve_appointment_attendance_batch", {
      p_appointment_ids: appointmentIds,
      p_studio_id: data.studioId,
      p_outcome: data.outcome,
      p_actor_id: userId,
      p_payment_method: "cash",
    });
    if (error) throw new Error(error.message);
    return { ok: true, ...resolved };
  });

export const searchProtectedStudioClients = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ClientSearchInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = getAdminClient() as any;
    const userId = String((context as any).userId ?? "");
    await assertStudioAccess(admin, userId, data.studioId);
    await rateLimitOrThrow({
      key: `studio-client-search:${data.studioId}:${userId}`,
      limit: 60,
      windowMs: 60_000,
    });

    const access = await resolveStudioRole(admin, userId, data.studioId);
    const term = normalizeSearch(data.query);
    const digits = data.query.replace(/\D/g, "");

    if (access.role === "staff") {
      if (!access.staffId) throw new Response("staff_identity_required", { status: 403 });
      const { data: rows, error } = await admin
        .from("appointments")
        .select("clients(id,name,phone)")
        .eq("studio_id", data.studioId)
        .eq("staff_id", access.staffId)
        .not("client_id", "is", null)
        .order("starts_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return filterClientRows(
        (rows ?? []).map((row: any) => relationOne(row.clients)).filter(Boolean),
        term,
        digits,
      );
    }

    if (!FULL_ROLES.has(access.role) && access.role !== "desk_staff") {
      throw new Response("forbidden", { status: 403 });
    }

    const escaped = escapeLike(data.query.trim());
    const requests = [
      admin
        .from("clients")
        .select("id,name,phone")
        .eq("studio_id", data.studioId)
        .ilike("name", `%${escaped}%`)
        .order("name")
        .limit(10),
    ];
    if (digits.length >= 2) {
      requests.push(
        admin
          .from("clients")
          .select("id,name,phone")
          .eq("studio_id", data.studioId)
          .ilike("phone", `%${escapeLike(digits)}%`)
          .order("name")
          .limit(10),
      );
    }
    const results = await Promise.all(requests);
    const clients: any[] = [];
    for (const result of results) {
      if (result.error) throw result.error;
      clients.push(...(result.data ?? []));
    }
    return uniqueClients(clients).slice(0, 10);
  });

async function resolveStudioRole(admin: any, userId: string, studioId: string) {
  const { data: roles, error } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("studio_id", studioId);
  if (error || !roles?.length) throw new Response("forbidden", { status: 403 });

  const rank: StudioRole[] = ["saas_owner", "studio_owner", "manager", "staff", "desk_staff"];
  const role = rank.find((candidate) => roles.some((row: any) => row.role === candidate));
  if (!role) throw new Response("forbidden", { status: 403 });

  let staffId: string | null = null;
  if (role === "staff") {
    const { data: staff } = await admin
      .from("staff")
      .select("id")
      .eq("studio_id", studioId)
      .eq("user_id", userId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    staffId = staff?.id ?? null;
  }
  return { role, staffId };
}

async function loadAppointmentRows(query: any, appointmentIds: string[]) {
  if (appointmentIds.length === 0) return [];
  const { data, error } = await query.in("appointment_id", appointmentIds);
  if (error) throw error;
  return data ?? [];
}

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function normalizeVisibility(value: unknown): AgendaVisibility {
  return value === "team_busy" || value === "team_basic" ? value : "private";
}

function maskTeamAppointment(row: any, visibility: AgendaVisibility) {
  const staff = relationOne<any>(row.staff);
  const services = Array.isArray(row.appointment_services) ? row.appointment_services : [];
  return {
    id: row.id,
    public_token: null,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    status: "confirmed",
    total_price: 0,
    total_duration_min: row.total_duration_min,
    notes: null,
    clients: null,
    staff: staff ? { id: staff.id, name: staff.name } : null,
    appointment_services:
      visibility === "team_basic"
        ? services.map((item: any) => ({
            price: 0,
            services: relationOne<any>(item.services)?.name
              ? { name: relationOne<any>(item.services)?.name }
              : null,
          }))
        : [],
  };
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function filterClientRows(rows: any[], term: string, digits: string) {
  return uniqueClients(rows)
    .filter((client) => {
      const text = normalizeSearch(`${client.name ?? ""} ${client.phone ?? ""}`);
      const phone = String(client.phone ?? "").replace(/\D/g, "");
      return text.includes(term) || (digits.length >= 2 && phone.includes(digits));
    })
    .slice(0, 10);
}

function uniqueClients(rows: any[]) {
  const clients = new Map<string, { id: string; name: string; phone: string }>();
  for (const row of rows) {
    if (!row?.id) continue;
    clients.set(String(row.id), {
      id: String(row.id),
      name: String(row.name ?? "Cliente"),
      phone: String(row.phone ?? ""),
    });
  }
  return [...clients.values()];
}
