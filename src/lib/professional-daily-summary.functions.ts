import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { computeAppointmentFinancialSplit, toCents } from "@/lib/financial-ledger";
import { assertStudioAccessWithOptions } from "@/lib/server-security";
import { getAdminClient } from "@/lib/supabase-admin.server";
import { getStudioDateKey, getZonedDateParts, normalizeStudioTimeZone } from "@/lib/studio-time";

export type ProfessionalDailySummary = {
  staffId: string;
  date: string;
  timezone: string;
  completed: number;
  commissionCents: number;
  studioCents: number;
  baseCents: number;
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
  .inputValidator((input) => z.object({ studioId: z.string().uuid() }).parse(input))
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
    const { date, from, until } = studioTodayBounds(timezone);
    const result: Record<string, ProfessionalDailySummary> = {};
    for (const member of staff ?? []) {
      result[member.id] = { staffId: member.id, date, timezone, completed: 0, commissionCents: 0, studioCents: 0, baseCents: 0 };
    }
    if (!staff?.length) return result;
    const staffById = new Map(staff.map((member: { id: string; commission_percent: number | null }) => [member.id, member]));
    const seen = new Set<string>();
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      const { data: appointments, error } = await admin.from("appointments")
        .select("id,staff_id,status,total_price,studio_commission_percent_snapshot,appointment_services(price,service_state,studio_commission_percent_snapshot,services(commission_percent))")
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
        summary.completed++;
        summary.baseCents += baseCents;
        summary.commissionCents += commissionCents;
        summary.studioCents += studioCents;
      }
      if ((appointments ?? []).length < pageSize) break;
    }
    for (let offset = 0; ; offset += pageSize) {
      const { data: lines, error } = await admin.from("appointment_services")
        .select("id,staff_id,price,service_state,professional_commission_percent_snapshot,appointments!inner(studio_id)")
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
        summary.completed++;
        summary.baseCents += baseCents;
        summary.commissionCents += commissionCents;
        summary.studioCents += baseCents - commissionCents;
      }
      if ((lines ?? []).length < pageSize) break;
    }
    return result;
  });
