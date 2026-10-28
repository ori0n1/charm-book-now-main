import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildFinancialReport, type FinancialReportFilters } from "@/lib/financial-report";
import { assertStudioFinancialReadAccess, rateLimitOrThrow } from "@/lib/server-security";
import { getAdminClient } from "@/lib/supabase-admin.server";
import { getZonedDateParts, normalizeStudioTimeZone } from "@/lib/studio-time";

export const FINANCIAL_PERIOD_PRESETS = [
  "this_month",
  "last_30_days",
  "this_year",
  "all",
  "custom",
] as const;

export type FinancialPeriodPreset = (typeof FINANCIAL_PERIOD_PRESETS)[number];

const FinancialReportInput = z
  .object({
    studioId: z.string().uuid(),
    period: z.enum(FINANCIAL_PERIOD_PRESETS).default("this_month"),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    staffId: z.string().uuid().optional().nullable(),
    paymentMethod: z
      .enum(["cash", "mb_way", "multibanco", "card", "bank_transfer", "other"])
      .optional()
      .nullable(),
    source: z.enum(["all", "appointment", "manual", "walk_in"]).default("all"),
  })
  .superRefine((input, context) => {
    if (input.period !== "custom") return;
    if (!input.startDate || !input.endDate) {
      context.addIssue({ code: "custom", message: "custom_period_dates_required" });
      return;
    }
    if (input.startDate > input.endDate) {
      context.addIssue({ code: "custom", message: "custom_period_invalid" });
    }
  });

type FinancialReportRequest = z.infer<typeof FinancialReportInput>;

export type UnlinkedPaidDeposit = {
  id: string;
  bookingRequestId: string;
  clientName: string;
  requestedStartsAt: string | null;
  reservationStatus: string | null;
  amountCents: number;
  currency: string;
  method: string;
  initiatedAt: string;
};

export type FinancialReportPayload = ReturnType<typeof buildFinancialReport> & {
  period: {
    preset: FinancialPeriodPreset;
    label: string;
    startDate: string | null;
    endDate: string | null;
    startsAtInclusive: string | null;
    endsAtExclusive: string | null;
    timezone: string;
  };
  staffOptions: Array<{ id: string; name: string }>;
  unlinkedPaidDeposits: UnlinkedPaidDeposit[];
  unlinkedPaidDepositCount: number;
  generatedAt: string;
};

export const getFinancialReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => FinancialReportInput.parse(input))
  .handler(async ({ data, context }): Promise<FinancialReportPayload> => {
    const admin = getAdminClient() as any;
    const userId = String((context as any).userId ?? "");
    await assertStudioFinancialReadAccess(admin, userId, data.studioId, {
      entitlement: "finance_basic",
    });
    await rateLimitOrThrow({
      key: `financial-report:${data.studioId}:${userId}`,
      limit: 120,
      windowMs: 60_000,
    });

    const { data: studio, error: studioError } = await admin
      .from("studios")
      .select("id,timezone,commission_percent")
      .eq("id", data.studioId)
      .maybeSingle();
    if (studioError || !studio?.id) throw new Error("financial_studio_not_found");

    const timezone = normalizeStudioTimeZone(studio.timezone);
    const period = resolveFinancialReportPeriod(data, timezone);
    const unlinkedPaid = await loadUnlinkedPaidDeposits(admin, data.studioId);
    const includeAppointments = data.source === "all" || data.source === "appointment";
    const includeManualEntries = data.source !== "appointment";
    const [appointments, manualEntries, staff] = await Promise.all([
      includeAppointments
        ? loadAppointments(admin, data.studioId, period, data.staffId ?? null)
        : Promise.resolve([]),
      includeManualEntries
        ? loadManualEntries(
            admin,
            data.studioId,
            period,
            data.staffId ?? null,
            data.source === "manual" || data.source === "walk_in" ? data.source : null,
          )
        : Promise.resolve([]),
      loadStaff(admin, data.studioId),
    ]);
    const appointmentIds = appointments.map((appointment) => String(appointment.id));
    const [onlinePayments, onsitePayments, refunds] = await Promise.all([
      loadRowsByAppointmentIds(
        admin,
        "payment_intents",
        data.studioId,
        appointmentIds,
        "id,appointment_id,amount_cents,status,method",
        (query) => query.eq("status", "succeeded"),
      ),
      loadRowsByAppointmentIds(
        admin,
        "cash_register_movements",
        data.studioId,
        appointmentIds,
        "id,appointment_id,amount,movement_type,payment_method",
        (query) => query.eq("movement_type", "service_payment"),
      ),
      loadRowsByAppointmentIds(
        admin,
        "refund_requests",
        data.studioId,
        appointmentIds,
        "id,appointment_id,payment_intent_id,status,payment_intents(amount_cents)",
        (query) => query.eq("status", "refunded"),
      ),
    ]);

    const refundsWithAuditedAmounts = await attachAuditedRefundAmounts(
      admin,
      data.studioId,
      refunds,
    );
    const filters: FinancialReportFilters = {
      staffId: data.staffId ?? null,
      paymentMethod: data.paymentMethod ?? null,
      source: data.source,
      startsAtInclusive: period.startsAtInclusive,
      endsAtExclusive: period.endsAtExclusive,
    };
    const report = buildFinancialReport({
      appointments,
      onlinePayments,
      onsitePayments,
      refunds: refundsWithAuditedAmounts,
      manualEntries,
      staff,
      studioCommissionPercent: Number(studio.commission_percent ?? 0),
      filters,
    });

    if (
      !report.reconciliation.receivedComponentsMatch ||
      !report.reconciliation.staffReceivedMatches
    ) {
      console.error("[financial-report] reconciliation_failed", {
        studioId: data.studioId,
        filters,
      });
      throw new Error("financial_report_reconciliation_failed");
    }

    return {
      ...report,
      period: {
        ...period,
        preset: data.period,
        timezone,
      },
      staffOptions: staff,
      unlinkedPaidDeposits: unlinkedPaid.rows,
      unlinkedPaidDepositCount: unlinkedPaid.count,
      generatedAt: new Date().toISOString(),
    };
  });

async function loadUnlinkedPaidDeposits(admin: any, studioId: string): Promise<{
  rows: UnlinkedPaidDeposit[];
  count: number;
}> {
  const { data, error, count } = await admin.from("payment_intents")
    .select("id,booking_request_id,amount_cents,currency,method,created_at,booking_payment_requests:booking_request_id(client_name,starts_at,status)", { count: "exact" })
    .eq("studio_id", studioId)
    .eq("status", "succeeded")
    .is("appointment_id", null)
    .not("booking_request_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error("financial_unlinked_paid_deposits_load_failed");
  return {
    rows: (data ?? []).map((row: any) => {
      const request = Array.isArray(row.booking_payment_requests)
        ? row.booking_payment_requests[0] : row.booking_payment_requests;
      return {
        id: String(row.id),
        bookingRequestId: String(row.booking_request_id),
        clientName: String(request?.client_name ?? "Cliente por confirmar"),
        requestedStartsAt: request?.starts_at ?? null,
        reservationStatus: request?.status ?? null,
        amountCents: Number(row.amount_cents ?? 0),
        currency: String(row.currency ?? "eur"),
        method: String(row.method ?? "other"),
        initiatedAt: String(row.created_at),
      };
    }),
    count: Number(count ?? data?.length ?? 0),
  };
}

export function resolveFinancialReportPeriod(
  input: Pick<FinancialReportRequest, "period" | "startDate" | "endDate">,
  timezone: string,
  now = new Date(),
) {
  if (input.period === "all") {
    return {
      label: "Todo o histórico",
      startDate: null,
      endDate: null,
      startsAtInclusive: null,
      endsAtExclusive: null,
    };
  }

  const current = getZonedDateParts(now, timezone);
  const today = dateKey(current.year, current.month, current.day);
  let startDate: string;
  let endDate: string;
  let label: string;
  if (input.period === "custom") {
    startDate = String(input.startDate);
    endDate = String(input.endDate);
    label = `${formatDateKey(startDate)} – ${formatDateKey(endDate)}`;
  } else if (input.period === "last_30_days") {
    startDate = shiftDateKey(today, -29);
    endDate = today;
    label = "Últimos 30 dias";
  } else if (input.period === "this_year") {
    startDate = dateKey(current.year, 1, 1);
    endDate = dateKey(current.year, 12, 31);
    label = "Este ano";
  } else {
    startDate = dateKey(current.year, current.month, 1);
    endDate = shiftDateKey(dateKey(current.year, current.month + 1, 1), -1);
    label = "Este mês";
  }

  return {
    label,
    startDate,
    endDate,
    startsAtInclusive: zonedMidnightToUtc(startDate, timezone).toISOString(),
    endsAtExclusive: zonedMidnightToUtc(shiftDateKey(endDate, 1), timezone).toISOString(),
  };
}

function dateKey(year: number, month: number, day: number) {
  const normalized = new Date(Date.UTC(year, month - 1, day));
  return `${normalized.getUTCFullYear()}-${String(normalized.getUTCMonth() + 1).padStart(2, "0")}-${String(normalized.getUTCDate()).padStart(2, "0")}`;
}

function shiftDateKey(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return dateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function formatDateKey(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function zonedMidnightToUtc(value: string, timezone: string) {
  const [year, month, day] = value.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day, 0, 0, 0);
  let utc = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = getZonedDateParts(new Date(utc), timezone);
    const represented = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    utc += target - represented;
  }
  return new Date(utc);
}

async function loadAppointments(
  admin: any,
  studioId: string,
  period: ReturnType<typeof resolveFinancialReportPeriod>,
  staffId: string | null,
) {
  return loadAllPages((from, to) => {
    let query = admin
      .from("appointments")
      .select("id,staff_id,starts_at,status,total_price")
      .eq("studio_id", studioId)
      .order("starts_at", { ascending: false });
    if (period.startsAtInclusive) query = query.gte("starts_at", period.startsAtInclusive);
    if (period.endsAtExclusive) query = query.lt("starts_at", period.endsAtExclusive);
    if (staffId) query = query.eq("staff_id", staffId);
    return query.range(from, to);
  });
}

async function loadManualEntries(
  admin: any,
  studioId: string,
  period: ReturnType<typeof resolveFinancialReportPeriod>,
  staffId: string | null,
  source: "manual" | "walk_in" | null,
) {
  const rows = await loadAllPages((from, to) => {
    let query = admin
      .from("manual_service_entries")
      .select("id,staff_id,performed_at,amount,payment_method,source,services(name),staff(name),clients(name)")
      .eq("studio_id", studioId)
      .order("performed_at", { ascending: false });
    if (period.startsAtInclusive) query = query.gte("performed_at", period.startsAtInclusive);
    if (period.endsAtExclusive) query = query.lt("performed_at", period.endsAtExclusive);
    if (staffId) query = query.eq("staff_id", staffId);
    if (source) query = query.eq("source", source);
    return query.range(from, to);
  });
  return rows.map((row: any) => ({
    id: String(row.id),
    staff_id: String(row.staff_id),
    performed_at: String(row.performed_at),
    amount: Number(row.amount ?? 0),
    payment_method: String(row.payment_method ?? "other"),
    source: (row.source === "walk_in" ? "walk_in" : "manual") as "manual" | "walk_in",
    serviceName: relationOne(row.services)?.name ?? null,
    staffName: relationOne(row.staff)?.name ?? null,
    clientName: relationOne(row.clients)?.name ?? null,
  }));
}

async function loadStaff(admin: any, studioId: string) {
  const { data, error } = await admin
    .from("staff")
    .select("id,name")
    .eq("studio_id", studioId)
    .order("sort_order")
    .order("name");
  if (error) throw error;
  return (data ?? []).map((member: any) => ({ id: String(member.id), name: String(member.name) }));
}

async function loadRowsByAppointmentIds(
  admin: any,
  table: string,
  studioId: string,
  appointmentIds: string[],
  columns: string,
  configure: (query: any) => any = (query) => query,
) {
  if (appointmentIds.length === 0) return [];
  const chunks: string[][] = [];
  for (let index = 0; index < appointmentIds.length; index += 200) {
    chunks.push(appointmentIds.slice(index, index + 200));
  }
  const results = await Promise.all(
    chunks.map(async (ids) => {
      const query = admin
        .from(table)
        .select(columns)
        .eq("studio_id", studioId)
        .in("appointment_id", ids);
      const { data, error } = await configure(query);
      if (error) throw error;
      return data ?? [];
    }),
  );
  return results.flat();
}

async function attachAuditedRefundAmounts(admin: any, studioId: string, refunds: any[]) {
  const refundIds = refunds.map((refund) => String(refund.id ?? "")).filter(Boolean);
  if (refundIds.length === 0) return refunds;

  const chunks: string[][] = [];
  for (let index = 0; index < refundIds.length; index += 200) {
    chunks.push(refundIds.slice(index, index + 200));
  }
  const results = await Promise.all(
    chunks.map(async (ids) => {
      const { data, error } = await admin
        .from("financial_audit_logs")
        .select("entity_id,amount_cents,created_at")
        .eq("studio_id", studioId)
        .eq("entity_type", "refund_request")
        .eq("action", "stripe_refund_succeeded")
        .in("entity_id", ids)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    }),
  );
  const amountByRefundId = new Map<string, number>();
  for (const audit of results.flat()) {
    const refundId = String(audit.entity_id ?? "");
    const amountCents = Number(audit.amount_cents);
    if (refundId && Number.isInteger(amountCents) && amountCents > 0 && !amountByRefundId.has(refundId)) {
      amountByRefundId.set(refundId, amountCents);
    }
  }
  return refunds.map((refund) => {
    const amountCents = amountByRefundId.get(String(refund.id ?? ""));
    return amountCents == null ? refund : { ...refund, amount_cents: amountCents };
  });
}

async function loadAllPages(buildQuery: (from: number, to: number) => any) {
  const pageSize = 500;
  const rows: any[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery(from, from + pageSize - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}
