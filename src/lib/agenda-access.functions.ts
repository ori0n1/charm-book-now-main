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
const UndoAttendanceInput = StudioInput.extend({
  appointmentId: z.string().uuid(),
  expectedOutcome: z.enum(["completed", "no_show"]),
  expectedResolvedAt: z.string().datetime({ offset: true }).nullable(),
});
const CorrectAttendanceInput = StudioInput.extend({
  appointmentId: z.string().uuid(),
  outcome: z.enum(["confirmed", "completed", "no_show"]),
});
const CorrectOwnerActionInput = StudioInput.extend({
  appointmentId: z.string().uuid(),
  outcome: z.enum(["confirmed", "cancelled"]),
  reason: z.string().trim().max(500).optional(),
});
const UndoMistakenReceiptInput = StudioInput.extend({
  appointmentId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
});
const CorrectPaymentMethodInput = StudioInput.extend({
  appointmentId: z.string().uuid(),
  movementId: z.string().uuid(),
  method: z.enum(["cash", "mb_way", "card", "bank_transfer", "other"]),
});
const UpdateResolvedNotesInput = StudioInput.extend({
  appointmentId: z.string().uuid(),
  expectedStatus: z.enum(["completed", "no_show"]),
  notes: z.string().max(5000),
});
const UpdateResolvedReservationInput = StudioInput.extend({
  appointmentId: z.string().uuid(),
  expectedStatus: z.enum(["completed", "no_show"]),
  startsAt: z.string().datetime({ offset: true }),
  durationMin: z.number().int().min(5).max(720),
  notes: z.string().max(5000),
});
const UpdateResolvedFullInput = StudioInput.extend({
  appointmentId: z.string().uuid(),
  expectedStatus: z.enum(["confirmed", "completed", "no_show"]),
  startsAt: z.string().datetime({ offset: true }),
  assignments: z.array(z.object({
    lineId: z.string().uuid(),
    serviceId: z.string().uuid(),
    staffId: z.string().uuid(),
    durationMin: z.number().int().min(5).max(720),
  })).min(1).max(20),
  totalPrice: z.number().finite().min(0).max(99999999.99),
  notes: z.string().max(5000),
});
const CashAttributionInput = StudioInput.extend({
  sessionIds: z.array(z.string().uuid()).max(100),
});
const ClientSearchInput = StudioInput.extend({
  query: z.string().trim().min(2).max(80),
});
const JointServiceStateInput = StudioInput.extend({
  serviceLineId: z.string().uuid(),
  nextState: z.enum(["completed", "cancelled", "no_show"]),
});
const JointServiceRescheduleInput = StudioInput.extend({
  serviceLineId: z.string().uuid(),
  staffId: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }),
});
const JointPaymentStatusInput = StudioInput.extend({ appointmentId: z.string().uuid() });
const JointPaymentRecordInput = JointPaymentStatusInput.extend({
  serviceLineId: z.string().uuid().nullable(),
  method: z.enum(["cash", "card", "mb_way", "other"]),
  requestKey: z.string().uuid(),
  expectedCents: z.number().int().positive(),
});

type StudioRole = "saas_owner" | "studio_owner" | "manager" | "staff" | "desk_staff";
type AgendaVisibility = "private" | "team_busy" | "team_basic";

const FULL_ROLES = new Set<StudioRole>(["saas_owner", "studio_owner", "manager"]);

async function assertJointServiceOwner(admin: any, userId: string, studioId: string) {
  await assertStudioAccess(admin, userId, studioId);
  const access = await resolveStudioRole(admin, userId, studioId);
  if (access.role !== "saas_owner" && access.role !== "studio_owner") {
    throw new Response("forbidden", { status: 403 });
  }
}

export const getProtectedJointPaymentStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => JointPaymentStatusInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = getAdminClient() as any;
    await assertJointServiceOwner(admin, String((context as any).userId ?? ""), data.studioId);
    const { data: result, error } = await admin.rpc("joint_service_payment_status", {
      p_studio_id: data.studioId,
      p_appointment_id: data.appointmentId,
    });
    if (error) throw error;
    return result as {
      total_due_cents: number;
      pending_mbway: boolean;
      services: Array<{ service_line_id: string; due_cents: number; service_state: string }>;
    };
  });

export const recordProtectedJointPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => JointPaymentRecordInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = getAdminClient() as any;
    const userId = String((context as any).userId ?? "");
    await assertJointServiceOwner(admin, userId, data.studioId);
    await rateLimitOrThrow({ key: `joint-payment:${userId}`, limit: 20, windowMs: 60_000 });
    const { data: result, error } = await admin.rpc("record_joint_onsite_payment", {
      p_studio_id: data.studioId,
      p_appointment_id: data.appointmentId,
      p_service_line_id: data.serviceLineId,
      p_method: data.method,
      p_request_key: data.requestKey,
      p_expected_cents: data.expectedCents,
      p_actor_id: userId,
    });
    if (error) throw error;
    return result as { movement_id: string | null; amount_cents: number; idempotent: boolean };
  });

export const resolveProtectedJointServiceState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => JointServiceStateInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = getAdminClient() as any;
    const userId = String((context as any).userId ?? "");
    await assertJointServiceOwner(admin, userId, data.studioId);
    await rateLimitOrThrow({ key: `joint-service-state:${userId}`, limit: 20, windowMs: 60_000 });
    const { data: result, error } = await admin.rpc("resolve_joint_service_state", {
      p_studio_id: data.studioId,
      p_service_line_id: data.serviceLineId,
      p_next_state: data.nextState,
      p_actor_id: userId,
    });
    if (error) throw error;
    return result;
  });

export const rescheduleProtectedJointService = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => JointServiceRescheduleInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = getAdminClient() as any;
    const userId = String((context as any).userId ?? "");
    await assertJointServiceOwner(admin, userId, data.studioId);
    await rateLimitOrThrow({ key: `joint-service-move:${userId}`, limit: 20, windowMs: 60_000 });
    const { data: result, error } = await admin.rpc("reschedule_joint_service", {
      p_studio_id: data.studioId,
      p_service_line_id: data.serviceLineId,
      p_staff_id: data.staffId,
      p_starts_at: data.startsAt,
      p_actor_id: userId,
    });
    if (error) throw error;
    return result;
  });

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
      .select(
        "staff_agenda_visibility,appointment_reminder_minutes,attendance_grace_minutes,whatsapp_auto_send_enabled",
      )
      .eq("id", data.studioId)
      .maybeSingle();
    if (studioError || !studio) throw new Error("agenda_studio_not_found");

    const visibility = normalizeVisibility(studio.staff_agenda_visibility);
    const ownStaffId = access.role === "staff" ? access.staffId : null;
    if (access.role === "staff" && !ownStaffId) {
      throw new Response("staff_identity_required", { status: 403 });
    }

    const [rawAppointments, staffResult, availabilityResult, whatsappEntitlementResult] =
      await Promise.all([
      loadAgendaAppointments(admin, data.studioId),
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
      admin.rpc("studio_has_entitlement", {
        _studio_id: data.studioId,
        _feature: "whatsapp",
      }),
    ]);

    if (staffResult.error) throw staffResult.error;
    if (availabilityResult.error) throw availabilityResult.error;

    const ownAppointments =
      access.role === "staff"
        ? rawAppointments.filter((row) => appointmentIncludesStaff(row, ownStaffId))
        : rawAppointments;
    const sensitiveAppointmentIds = ownAppointments.map((row) => String(row.id));

    const [payments, scheduleEvents, cashPayments, refunds, messageLogs] = await Promise.all([
      loadAppointmentRows(
        () => admin
          .from("payment_intents")
          .select("id,appointment_id,amount_cents,status,method,stripe_payment_intent_id")
          .eq("studio_id", data.studioId),
        sensitiveAppointmentIds,
      ),
      loadAppointmentRows(
        () => admin
          .from("appointment_schedule_events")
          .select(
            "appointment_id,related_appointment_id,operation,overlap_confirmed,previous_state,next_state,created_at",
          )
          .eq("studio_id", data.studioId)
          .order("created_at", { ascending: false }),
        sensitiveAppointmentIds,
      ),
      loadAppointmentRows(
        () => admin
          .from("cash_register_movements")
          .select("id,appointment_id,amount,movement_type,payment_method,created_by,source_key")
          .eq("studio_id", data.studioId)
          .eq("movement_type", "service_payment"),
        sensitiveAppointmentIds,
      ),
      loadAppointmentRows(
        () => admin
          .from("refund_requests")
          .select("id,appointment_id,payment_intent_id,status,payment_intents(amount_cents)")
          .eq("studio_id", data.studioId)
          .eq("status", "refunded"),
        sensitiveAppointmentIds,
      ),
      loadAppointmentRows(
        () => admin
          .from("whatsapp_message_logs")
          .select("appointment_id,status,reason,created_at")
          .eq("studio_id", data.studioId)
          .order("created_at", { ascending: false }),
        sensitiveAppointmentIds,
      ),
    ]);

    const [refundAudits, disputeAudits] = await Promise.all([
      loadEntityAuditRows(
        () => admin.from("financial_audit_logs")
          .select("entity_id,amount_cents,created_at")
          .eq("studio_id", data.studioId)
          .eq("entity_type", "refund_request")
          .eq("action", "stripe_refund_succeeded")
          .order("created_at", { ascending: false }),
        refunds.map((row: any) => String(row.id)),
      ),
      loadEntityAuditRows(
        () => admin.from("financial_audit_logs")
          .select("id,entity_id,action,amount_cents,metadata,created_at")
          .eq("studio_id", data.studioId)
          .eq("entity_type", "payment_intent")
          .like("action", "stripe_dispute_%")
          .order("created_at", { ascending: false }),
        payments.map((row: any) => String(row.id)),
      ),
    ]);
    const refundAmountById = new Map<string, number>();
    for (const audit of refundAudits) {
      const id = String(audit.entity_id ?? "");
      const amount = Number(audit.amount_cents);
      if (id && Number.isInteger(amount) && amount > 0 && !refundAmountById.has(id)) {
        refundAmountById.set(id, amount);
      }
    }
    const latestDisputeById = new Map<string, any>();
    for (const audit of disputeAudits) {
      const disputeId = String(audit.metadata?.stripe_dispute_id ?? "");
      if (!disputeId) continue;
      const id = `${audit.entity_id}:${disputeId}`;
      if (!latestDisputeById.has(id)) latestDisputeById.set(id, audit);
    }
    const lostDisputeAmountByPaymentId = new Map<string, number>();
    for (const audit of latestDisputeById.values()) {
      if (audit.action !== "stripe_dispute_lost") continue;
      const id = String(audit.entity_id ?? "");
      const amount = Number(audit.amount_cents);
      if (id && Number.isInteger(amount) && amount > 0) {
        lostDisputeAmountByPaymentId.set(id, (lostDisputeAmountByPaymentId.get(id) ?? 0) + amount);
      }
    }

    const cashActorIds = [...new Set(cashPayments.map((row: any) => row.created_by).filter(Boolean))];
    const { data: cashActors, error: cashActorsError } = cashActorIds.length
      ? await admin.from("profiles").select("id,full_name").in("id", cashActorIds)
      : { data: [], error: null };
    const cashActorNames = new Map((cashActorsError ? [] : cashActors ?? []).map((row: any) => [row.id, row.full_name]));
    const appointments = selectVisibleAgendaAppointments(rawAppointments, access, visibility);

    return {
      appointments,
      staff: staffResult.data ?? [],
      availability: availabilityResult.data ?? [],
      lifecycleSettings: {
        reminderMinutes: Number(studio.appointment_reminder_minutes ?? 120),
        graceMinutes: Number(studio.attendance_grace_minutes ?? 30),
      },
      communicationSettings: {
        whatsappAvailable: Boolean(
          studio.whatsapp_auto_send_enabled && whatsappEntitlementResult.data === true,
        ),
      },
      payments: payments.map((row: any) => ({
        ...row,
        ...(lostDisputeAmountByPaymentId.has(String(row.id))
          ? { dispute_status: "lost", disputed_amount_cents: lostDisputeAmountByPaymentId.get(String(row.id)) }
          : {}),
      })),
      cashPayments: cashPayments.map((row: any) => ({
        ...row,
        responsible_name: cashActorNames.get(row.created_by) ?? null,
      })),
      refunds: refunds.map((row: any) => ({
        ...row,
        amount_cents: refundAmountById.get(String(row.id)) ?? null,
      })),
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

export const undoProtectedAppointmentAttendance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => UndoAttendanceInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = getAdminClient() as any;
    const userId = String((context as any).userId ?? "");
    await assertStudioAccess(admin, userId, data.studioId);
    await rateLimitOrThrow({
      key: `appointment-attendance:${data.studioId}:${userId}`,
      limit: 60,
      windowMs: 60_000,
    });
    const access = await resolveStudioRole(admin, userId, data.studioId);
    if (!FULL_ROLES.has(access.role)) throw new Response("forbidden", { status: 403 });

    let update = admin
      .from("appointments")
      .update({
        status: "confirmed",
        attendance_resolved_at: null,
        attendance_resolved_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.appointmentId)
      .eq("studio_id", data.studioId)
      .eq("status", data.expectedOutcome);
    update = data.expectedResolvedAt
      ? update.eq("attendance_resolved_at", data.expectedResolvedAt)
      : update.is("attendance_resolved_at", null);
    const { data: rows, error } = await update.select("id");
    if (error) throw new Error(error.message);
    if (rows?.length !== 1) throw new Error("attendance_changed_reload");
    return { ok: true };
  });

export const correctProtectedAppointmentAttendance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => CorrectAttendanceInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = getAdminClient() as any;
    const userId = String((context as any).userId ?? "");
    await assertStudioAccess(admin, userId, data.studioId);
    await rateLimitOrThrow({
      key: `appointment-attendance:${data.studioId}:${userId}`,
      limit: 60,
      windowMs: 60_000,
    });
    const [access, appointmentResult] = await Promise.all([
      resolveStudioRole(admin, userId, data.studioId),
      admin.from("appointments").select("id,staff_id,status")
        .eq("id", data.appointmentId).eq("studio_id", data.studioId).maybeSingle(),
    ]);
    if (appointmentResult.error || !appointmentResult.data) {
      throw new Response("appointment_not_found", { status: 404 });
    }
    if (!FULL_ROLES.has(access.role)) {
      throw new Response("forbidden", { status: 403 });
    }
    const { error } = await admin.rpc("correct_appointment_attendance", {
      p_appointment_id: data.appointmentId,
      p_studio_id: data.studioId,
      p_outcome: data.outcome,
      p_actor_id: userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateProtectedResolvedAppointmentNotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => UpdateResolvedNotesInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = getAdminClient() as any;
    const userId = String((context as any).userId ?? "");
    await assertStudioAccess(admin, userId, data.studioId);
    await rateLimitOrThrow({
      key: `appointment-notes:${data.studioId}:${userId}`,
      limit: 30,
      windowMs: 60_000,
    });
    const access = await resolveStudioRole(admin, userId, data.studioId);
    if (access.role !== "studio_owner" && access.role !== "saas_owner") {
      throw new Response("studio_owner_required", { status: 403 });
    }
    const { data: updated, error } = await admin.from("appointments")
      .update({ notes: data.notes.trim() || null })
      .eq("id", data.appointmentId)
      .eq("studio_id", data.studioId)
      .eq("status", data.expectedStatus)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated) throw new Error("appointment_changed_reload");
    return { ok: true, appointmentId: updated.id };
  });

export const updateProtectedResolvedAppointmentReservation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => UpdateResolvedReservationInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = getAdminClient() as any;
    const userId = String((context as any).userId ?? "");
    await assertStudioAccess(admin, userId, data.studioId);
    await rateLimitOrThrow({
      key: `appointment-resolved-edit:${data.studioId}:${userId}`,
      limit: 20, windowMs: 60_000,
    });
    const access = await resolveStudioRole(admin, userId, data.studioId);
    if (access.role !== "studio_owner" && access.role !== "saas_owner") {
      throw new Response("studio_owner_required", { status: 403 });
    }
    const { data: result, error } = await admin.rpc("edit_resolved_appointment_schedule", {
      p_studio_id: data.studioId,
      p_appointment_id: data.appointmentId,
      p_expected_status: data.expectedStatus,
      p_starts_at: data.startsAt,
      p_duration_min: data.durationMin,
      p_notes: data.notes.trim() || null,
      p_actor_id: userId,
    });
    if (error) throw new Error(error.message);
    if (result?.appointmentId !== data.appointmentId || result?.status !== data.expectedStatus) {
      throw new Error("appointment_changed_reload");
    }
    return result;
  });

export const updateProtectedResolvedAppointmentFull = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => UpdateResolvedFullInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = getAdminClient() as any;
    const userId = String((context as any).userId ?? "");
    await assertStudioAccess(admin, userId, data.studioId);
    await rateLimitOrThrow({
      key: `appointment-resolved-full-edit:${data.studioId}:${userId}`,
      limit: 20, windowMs: 60_000,
    });
    const access = await resolveStudioRole(admin, userId, data.studioId);
    if (access.role !== "studio_owner" && access.role !== "saas_owner") {
      throw new Response("studio_owner_required", { status: 403 });
    }
    const { data: result, error } = await admin.rpc("edit_owner_resolved_appointment", {
      p_studio_id: data.studioId,
      p_appointment_id: data.appointmentId,
      p_expected_status: data.expectedStatus,
      p_starts_at: data.startsAt,
      p_assignments: data.assignments,
      p_total_price: data.totalPrice,
      p_notes: data.notes.trim() || null,
      p_actor_id: userId,
    });
    if (error) throw new Error(error.message);
    if (result?.appointmentId !== data.appointmentId || result?.status !== data.expectedStatus) {
      throw new Error("appointment_changed_reload");
    }
    return result;
  });

export const correctProtectedOwnerAppointmentAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => CorrectOwnerActionInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = getAdminClient() as any;
    const userId = String((context as any).userId ?? "");
    await assertStudioAccess(admin, userId, data.studioId);
    await rateLimitOrThrow({ key: `appointment-correction:${data.studioId}:${userId}`, limit: 30, windowMs: 60_000 });
    const access = await resolveStudioRole(admin, userId, data.studioId);
    if (access.role !== "studio_owner" && access.role !== "saas_owner") {
      throw new Response("studio_owner_required", { status: 403 });
    }
    const { error } = await admin.rpc("correct_owner_appointment_action", {
      p_studio_id: data.studioId,
      p_appointment_id: data.appointmentId,
      p_outcome: data.outcome,
      p_actor_id: userId,
      p_reason: data.reason ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const undoProtectedMistakenOnsiteReceipt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => UndoMistakenReceiptInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = getAdminClient() as any;
    const userId = String((context as any).userId ?? "");
    await assertStudioAccess(admin, userId, data.studioId);
    await rateLimitOrThrow({ key: "receipt-undo:" + data.studioId + ":" + userId, limit: 10, windowMs: 60_000 });
    const access = await resolveStudioRole(admin, userId, data.studioId);
    if (access.role !== "studio_owner" && access.role !== "saas_owner") {
      throw new Response("studio_owner_required", { status: 403 });
    }
    const { error } = await admin.rpc("undo_mistaken_onsite_attendance_receipt", {
      p_studio_id: data.studioId,
      p_appointment_id: data.appointmentId,
      p_actor_id: userId,
      p_reason: data.reason,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const correctProtectedOnsitePaymentMethod = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => CorrectPaymentMethodInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = getAdminClient() as any;
    const userId = String((context as any).userId ?? "");
    await assertStudioAccess(admin, userId, data.studioId);
    await rateLimitOrThrow({ key: `payment-method-correction:${data.studioId}:${userId}`, limit: 20, windowMs: 60_000 });
    const access = await resolveStudioRole(admin, userId, data.studioId);
    if (access.role !== "studio_owner" && access.role !== "saas_owner") {
      throw new Response("studio_owner_required", { status: 403 });
    }
    const { error } = await admin.rpc("correct_onsite_payment_method", {
      p_studio_id: data.studioId,
      p_appointment_id: data.appointmentId,
      p_movement_id: data.movementId,
      p_new_method: data.method,
      p_actor_id: userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getProtectedCashAttribution = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => CashAttributionInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = getAdminClient() as any;
    const userId = String((context as any).userId ?? "");
    await assertStudioAccess(admin, userId, data.studioId);
    if (!data.sessionIds.length) return { sessions: [], movements: [] };
    const { data: sessions, error: sessionsError } = await admin.from("cash_register_sessions")
      .select("id,closed_by").eq("studio_id", data.studioId).in("id", data.sessionIds);
    if (sessionsError) throw sessionsError;
    const validIds = (sessions ?? []).map((session: any) => session.id);
    const movements: any[] = [];
    if (validIds.length) {
      for (let offset = 0; ; offset += 1000) {
        const { data: page, error } = await admin.from("cash_register_movements")
          .select("id,created_by,appointment_id,description,movement_type,source_key")
          .eq("studio_id", data.studioId).in("session_id", validIds)
          .order("id").range(offset, offset + 999);
        if (error) throw error;
        movements.push(...(page ?? []));
        if ((page ?? []).length < 1000) break;
      }
    }
    const appointmentIds = [...new Set((movements ?? []).map((row: any) => row.appointment_id).filter(Boolean))];
    const appointments: any[] = [];
    const refunds: any[] = [];
    const requests: any[] = [];
    const acceptances: any[] = [];
    const fitEvents: any[] = [];
    for (let offset = 0; offset < appointmentIds.length; offset += 200) {
      const ids = appointmentIds.slice(offset, offset + 200);
      const results = await Promise.all([
        admin.from("appointments").select("id,status,created_at,cancellation_reason,cancelled_at,cancelled_by").eq("studio_id", data.studioId).in("id", ids),
        admin.from("booking_payment_requests").select("appointment_id").eq("studio_id", data.studioId).in("appointment_id", ids),
        admin.from("booking_policy_acceptances").select("appointment_id").eq("studio_id", data.studioId).in("appointment_id", ids),
        admin.from("appointment_schedule_events").select("appointment_id,previous_state")
          .eq("studio_id", data.studioId).eq("operation", "manual_fit").in("appointment_id", ids),
        admin.from("refund_requests").select("appointment_id,status")
          .eq("studio_id", data.studioId).in("appointment_id", ids),
      ]);
      for (const result of results) if (result.error) throw result.error;
      appointments.push(...(results[0].data ?? []));
      requests.push(...(results[1].data ?? []));
      acceptances.push(...(results[2].data ?? []));
      fitEvents.push(...(results[3].data ?? []));
      refunds.push(...(results[4].data ?? []));
    }
    const statuses = new Map<string, string>((appointments ?? []).map((row: any) => [row.id, row.status]));
    const refundStatus = new Map<string, string>();
    for (const row of refunds) {
      if (!row.appointment_id) continue;
      if (row.status === "refunded") refundStatus.set(row.appointment_id, "refunded");
      else if (["pending", "in_review", "approved"].includes(row.status) && refundStatus.get(row.appointment_id) !== "refunded") refundStatus.set(row.appointment_id, "pending");
    }
    const cancelled = new Map<string, any>((appointments ?? [])
      .filter((row: any) => row.status === "cancelled" && row.cancelled_at)
      .map((row: any) => [row.id, row]));
    const createdAt = new Map<string, string>((appointments ?? []).map((row: any) => [row.id, row.created_at]));
    const onlineIds = new Set<string>([...(requests ?? []), ...(acceptances ?? [])].map((row: any) => row.appointment_id));
    const fitIds = new Set<string>((fitEvents ?? [])
      .filter((row: any) => !row.previous_state || Object.keys(row.previous_state).length === 0)
      .map((row: any) => row.appointment_id));
    const actorIds = [...new Set([
      ...(sessions ?? []).map((row: any) => row.closed_by),
      ...(movements ?? []).map((row: any) => row.created_by),
      ...(appointments ?? []).map((row: any) => row.cancelled_by),
    ].filter(Boolean))];
    const { data: actors, error: actorsError } = actorIds.length
      ? await admin.from("profiles").select("id,full_name").in("id", actorIds)
      : { data: [], error: null };
    if (actorsError) throw actorsError;
    const names = new Map<string, string | null>((actors ?? []).map((row: any) => [
      String(row.id), typeof row.full_name === "string" ? row.full_name : null,
    ]));
    return {
      sessions: (sessions ?? []).map((row: any) => ({ id: row.id, closed_by_name: names.get(row.closed_by) ?? null })),
      movements: (movements ?? []).map((row: any) => ({
        id: row.id,
        responsible_name: names.get(row.created_by) ?? null,
        appointment_status: row.appointment_id ? statuses.get(row.appointment_id) ?? null : null,
        refund_status: row.movement_type === "online_payment" && row.appointment_id
          ? refundStatus.get(row.appointment_id) ?? null : null,
        cancellation_reason: row.appointment_id ? cancelled.get(row.appointment_id)?.cancellation_reason ?? null : null,
        cancelled_at: row.appointment_id ? cancelled.get(row.appointment_id)?.cancelled_at ?? null : null,
        cancelled_by_name: row.appointment_id
          ? names.get(cancelled.get(row.appointment_id)?.cancelled_by) ?? cancelled.get(row.appointment_id)?.cancelled_by ?? null
          : null,
        appointment_origin: row.movement_type !== "service_payment" || !row.appointment_id ? null
          : row.description?.startsWith("Encaixe - ") || fitIds.has(row.appointment_id) ? "fit"
          : onlineIds.has(row.appointment_id) ? "online"
          : (createdAt.get(row.appointment_id) ?? "") >= "2026-09-25" ? "onsite" : null,
      })),
    };
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
        .select("clients:clients!appointments_client_same_studio(id,name,phone)")
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

async function loadAgendaAppointments(admin: any, studioId: string) {
  const appointments: any[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await admin
      .from("appointments")
      .select(
        "id,public_token,starts_at,ends_at,status,attendance_resolved_at,total_price,total_duration_min,studio_commission_percent_snapshot,notes,is_manual_fit,duration_overridden,clients:clients!appointments_client_same_studio(id,name,phone,avatar_url,date_of_birth),staff:staff!appointments_staff_same_studio(id,name,commission_percent,deposit_recipient,deposit_professional_percent),appointment_services(id,price,duration_min,position,starts_at,ends_at,service_state,potential_refund_cents,professional_commission_percent_snapshot,staff:staff!appointment_services_staff_id_fkey(id,name),studio_commission_percent_snapshot,services(id,name,commission_percent,deposit_recipient,deposit_professional_percent))",
      )
      .eq("studio_id", studioId)
      .order("starts_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    appointments.push(...(data ?? []));
    if ((data ?? []).length < pageSize) return appointments;
  }
}

async function loadAppointmentRows(query: () => any, appointmentIds: string[]) {
  if (appointmentIds.length === 0) return [];
  const rows: any[] = [];
  for (let index = 0; index < appointmentIds.length; index += 100) {
    const ids = appointmentIds.slice(index, index + 100);
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await query().in("appointment_id", ids).range(offset, offset + 999);
      if (error) throw error;
      rows.push(...(data ?? []));
      if ((data ?? []).length < 1000) break;
    }
  }
  return rows;
}

async function loadEntityAuditRows(query: () => any, entityIds: string[]) {
  if (entityIds.length === 0) return [];
  const rows: any[] = [];
  for (let index = 0; index < entityIds.length; index += 100) {
    const ids = entityIds.slice(index, index + 100);
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await query().in("entity_id", ids).range(offset, offset + 999);
      if (error) throw error;
      rows.push(...(data ?? []));
      if ((data ?? []).length < 1000) break;
    }
  }
  return rows;
}

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function normalizeVisibility(value: unknown): AgendaVisibility {
  return value === "team_busy" || value === "team_basic" ? value : "private";
}

export function selectVisibleAgendaAppointments(
  rawAppointments: any[],
  access: { role: StudioRole; staffId: string | null },
  visibility: AgendaVisibility,
) {
  if (access.role !== "staff") return rawAppointments;

  if (visibility === "private") {
    return rawAppointments.filter((row) => appointmentIncludesStaff(row, access.staffId));
  }

  return rawAppointments
    .filter(
      (row) =>
        appointmentIncludesStaff(row, access.staffId) ||
        !["cancelled", "canceled"].includes(String(row.status).toLowerCase()),
    )
    .map((row) =>
      appointmentIncludesStaff(row, access.staffId)
        ? row
        : maskTeamAppointment(row, visibility),
    );
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
            id: item.id,
            price: 0,
            duration_min: item.duration_min,
            position: item.position,
            starts_at: item.starts_at,
            ends_at: item.ends_at,
            staff: relationOne<any>(item.staff),
            services: relationOne<any>(item.services)?.name
              ? { name: relationOne<any>(item.services)?.name }
              : null,
          }))
        : [],
  };
}

function appointmentIncludesStaff(row: any, staffId: string | null) {
  if (!staffId) return false;
  if (relationOne<any>(row.staff)?.id === staffId) return true;
  const services = Array.isArray(row.appointment_services) ? row.appointment_services : [];
  return services.some((item: any) => relationOne<any>(item.staff)?.id === staffId);
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
