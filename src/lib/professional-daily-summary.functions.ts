import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { computeAppointmentFinancialSplit, toCents } from "@/lib/financial-ledger";
import { assertStudioAccessWithOptions } from "@/lib/server-security";
import { getAdminClient } from "@/lib/supabase-admin.server";
import { getStudioDateKey, getZonedDateParts, normalizeStudioTimeZone } from "@/lib/studio-time";
import { periodDateKeys, summarizeProfessionalHistory, type AttendanceEvent, type ServiceEvent } from "@/lib/professional-history";

export type ProfessionalDailySummary = {
  staffId: string;
  date: string;
  timezone: string;
  completed: number;
  commissionCents: number;
  studioCents: number;
  baseCents: number;
  evolution: { date: string; completed: number }[];
  topServices: { serviceId: string; name: string; count: number; percent: number }[];
};

function midnightUtc(dateKey: string, timezone: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day);
  let utc = target;
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = getZonedDateParts(new Date(utc), timezone);
    utc += target - Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  }
  return new Date(utc).toISOString();
}

export function studioTodayBounds(timezone: string, now = new Date()) {
  const date = getStudioDateKey(now, timezone);
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const nextDate = next.toISOString().slice(0, 10);
  return { date, from: midnightUtc(date, timezone), until: midnightUtc(nextDate, timezone) };
}

export const getProfessionalDailySummaries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ studioId: z.string().uuid(), days: z.union([z.literal(1), z.literal(7), z.literal(15), z.literal(30)]).default(1) }).parse(input))
  .handler(async ({ data, context }): Promise<Record<string, ProfessionalDailySummary>> => {
    const admin = getAdminClient() as any;
    const userId = String((context as any).userId ?? "");
    await assertStudioAccessWithOptions(admin, userId, data.studioId);

    const [{ data: roles, error: rolesError }, { data: studio, error: studioError }] = await Promise.all([
      admin.from("user_roles").select("role").eq("studio_id", data.studioId).eq("user_id", userId),
      admin.from("studios").select("id,timezone,commission_percent").eq("id", data.studioId).single(),
    ]);
    if (rolesError || !roles?.length || studioError || !studio?.id) throw new Error("professional_summary_access_failed");
    const manager = roles.some((row: { role: string }) => ["saas_owner", "studio_owner", "manager"].includes(row.role));
    const staffQuery = admin.from("staff").select("id,commission_percent,user_id").eq("studio_id", data.studioId);
    const { data: staff, error: staffError } = await (manager ? staffQuery : staffQuery.eq("user_id", userId));
    if (staffError || (!manager && (!roles.some((row: { role: string }) => row.role === "staff") || !staff?.length))) {
      throw new Error("professional_summary_access_failed");
    }

    const timezone = normalizeStudioTimeZone(studio.timezone);
    const { date, until } = studioTodayBounds(timezone);
    const days = data.days;
    const dateKeys = periodDateKeys(date, days);
    const firstDate = dateKeys[0];
    const from = midnightUtc(firstDate, timezone);
    const result: Record<string, ProfessionalDailySummary> = {};
    for (const member of staff ?? []) {
      result[member.id] = { staffId: member.id, date, timezone, completed: 0, commissionCents: 0, studioCents: 0, baseCents: 0,
        evolution: dateKeys.map((key) => ({ date: key, completed: 0 })), topServices: [] };
    }
    if (!staff?.length) return result;
    const staffById = new Map(staff.map((member: { id: string; commission_percent: number | null }) => [member.id, member]));
    const seen = new Set<string>();
    const attendanceEvents: AttendanceEvent[] = [];
    const serviceEvents: ServiceEvent[] = [];
    const recordAttendance = (staffId: string, appointmentId: string, startsAt: string) => {
      attendanceEvents.push({ staffId, appointmentId, date: getStudioDateKey(new Date(startsAt), timezone) });
    };
    const recordService = (staffId: string, lineId: string, serviceId: string, name: string | null | undefined) => {
      serviceEvents.push({ staffId, lineId, serviceId, name });
    };
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      const { data: appointments, error } = await admin.from("appointments")
        .select("id,staff_id,starts_at,status,total_price,studio_commission_percent_snapshot,appointment_services(id,service_id,price,service_state,studio_commission_percent_snapshot,services(name,commission_percent))")
        .eq("studio_id", data.studioId)
        .eq("status", "completed")
        .gte("starts_at", from)
        .lt("starts_at", until)
        .order("starts_at", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      for (const appointment of appointments ?? []) {
        if (seen.has(appointment.id)) continue;
        seen.add(appointment.id);
        if (appointment.appointment_services?.some((line: { service_state?: string | null }) =>
          line.service_state != null)) continue;
        const member = staffById.get(appointment.staff_id) as { commission_percent: number | null } | undefined;
        const summary = result[appointment.staff_id];
        if (!member || !summary) continue;
        const split = computeAppointmentFinancialSplit(
          appointment.id,
          { ...appointment, staff: member },
          Number(studio.commission_percent ?? 0),
        );
        const baseCents = toCents(split.commissionBase);
        const commissionCents = toCents(split.professional);
        const studioCents = toCents(split.studio);
        if (commissionCents + studioCents !== baseCents) throw new Error("professional_summary_reconciliation_failed");
        recordAttendance(appointment.staff_id, appointment.id, appointment.starts_at);
        for (const line of appointment.appointment_services ?? []) {
          recordService(appointment.staff_id, line.id, line.service_id, line.services?.name);
        }
        summary.baseCents += baseCents;
        summary.commissionCents += commissionCents;
        summary.studioCents += studioCents;
      }
      if ((appointments ?? []).length < pageSize) break;
    }
    for (let offset = 0; ; offset += pageSize) {
      const { data: lines, error } = await admin.from("appointment_services")
        .select("id,appointment_id,service_id,staff_id,starts_at,price,service_state,professional_commission_percent_snapshot,services(name),appointments!inner(studio_id)")
        .eq("appointments.studio_id", data.studioId)
        .eq("service_state", "completed")
        .gte("starts_at", from)
        .lt("starts_at", until)
        .order("starts_at", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      for (const line of lines ?? []) {
        const summary = result[line.staff_id];
        if (!summary) continue;
        const baseCents = toCents(line.price);
        const percent = Math.max(0, Math.min(100,
          Number(line.professional_commission_percent_snapshot ??
            (staffById.get(line.staff_id) as { commission_percent: number | null } | undefined)?.commission_percent ??
            studio.commission_percent ?? 0)));
        const commissionCents = Math.round(baseCents * percent / 100);
        recordAttendance(line.staff_id, line.appointment_id, line.starts_at);
        recordService(line.staff_id, line.id, line.service_id, line.services?.name);
        summary.baseCents += baseCents;
        summary.commissionCents += commissionCents;
        summary.studioCents += baseCents - commissionCents;
      }
      if ((lines ?? []).length < pageSize) break;
    }
    const history = summarizeProfessionalHistory(Object.keys(result), dateKeys, attendanceEvents, serviceEvents);
    for (const [staffId, values] of Object.entries(history)) {
      result[staffId].completed = values.completed;
      result[staffId].evolution = values.evolution;
      result[staffId].topServices = values.topServices;
    }
    return result;
  });
