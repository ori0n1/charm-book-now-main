import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { normalizeAppointmentStart } from "@/lib/appointment-datetime";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dispatchPendingStudioPushNotifications } from "@/lib/notification-dispatcher.server";
import { assertAppointmentAccess, assertStudioAccess } from "@/lib/server-security";
import { getAdminClient } from "@/lib/supabase-admin.server";
import { sendAppointmentLifecycleMessage } from "@/lib/whatsapp.functions";
import { notifyClientAppointmentChange } from "@/lib/public-client.functions";
import { releaseOwnerPaymentHolds } from "@/lib/owner-payment-hold.server";
import { formatStudioDateTime } from "@/lib/studio-time";

const StudioRescheduleInput = z.object({
  studioId: z.string().uuid(),
  appointmentId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
});

const StudioCancelInput = z.object({
  studioId: z.string().uuid(),
  appointmentId: z.string().uuid(),
});

const StudioLocalDateTimeInput = z.object({
  studioId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
});

const SchedulePreviewInput = z.object({
  studioId: z.string().uuid(),
  staffId: z.string().uuid(),
  startsAt: z.string().transform(normalizeAppointmentStart),
  durationMin: z.number().int().min(5).max(720),
  ignoreAppointmentIds: z.array(z.string().uuid()).max(2).default([]),
});

const MoveStudioAppointmentInput = z.object({
  studioId: z.string().uuid(),
  appointmentId: z.string().uuid(),
  startsAt: z.string().transform(normalizeAppointmentStart),
  durationMin: z.number().int().min(5).max(720),
  confirmOverlap: z.boolean().default(false),
  expectedConflictIds: z.array(z.string().uuid()).max(20).default([]),
  operation: z.enum(["move", "duration"]).default("move"),
});

const SwapStudioAppointmentsInput = z.object({
  studioId: z.string().uuid(),
  firstAppointmentId: z.string().uuid(),
  secondAppointmentId: z.string().uuid(),
  confirmOverlap: z.boolean().default(false),
  expectedConflictIds: z.array(z.string().uuid()).max(20).default([]),
});

const CreateStudioManualFitInput = z.object({
  studioId: z.string().uuid(),
  assignments: z
    .array(
      z.object({
        serviceId: z.string().uuid(),
        staffId: z.string().uuid(),
        durationMin: z.number().int().min(5).max(720).optional(),
      }),
    )
    .min(1)
    .max(20),
  startsAt: z.string().datetime(),
  clientId: z.string().uuid().nullable(),
  clientName: z.string().trim().max(160).nullable(),
  clientPhone: z.string().trim().max(40).nullable(),
  notes: z.string().trim().max(2000).nullable(),
  confirmOverlap: z.boolean().default(false),
  expectedConflictIds: z.array(z.string().uuid()).max(20).default([]),
  expectedPaymentHoldIds: z.array(z.string().uuid()).max(20).default([]),
});

export type StudioScheduleConflict = {
  appointmentId: string;
  clientName: string;
  professionalName: string;
  serviceName: string;
  startsAt: string;
  endsAt: string;
  overlapStartsAt: string;
  overlapEndsAt: string;
};

export type StudioSchedulePreview = {
  startsAt: string;
  endsAt: string;
  durationMin: number;
  conflicts: StudioScheduleConflict[];
  blocks: Array<{ blockId: string; reason: string | null; startsAt: string; endsAt: string }>;
  paymentHolds: Array<{ requestId: string; startsAt: string; endsAt: string; status: string }>;
  staffAvailable: boolean;
  withinAvailability: boolean;
  hasConflict: boolean;
  hardBlocked: boolean;
  canOverride: boolean;
};

export const resolveStudioLocalDateTime = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => StudioLocalDateTimeInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = getAdminClient() as any;
    const userId = String((context as any).userId ?? "");
    await assertStudioAccess(sb, userId, data.studioId);
    const { data: startsAt, error } = await sb.rpc("resolve_studio_local_datetime", {
      p_studio_id: data.studioId,
      p_local_date: data.date,
      p_local_time: data.time,
    });
    if (error || !startsAt) throw new Error(translateScheduleMutationError(error));
    return { startsAt: new Date(String(startsAt)).toISOString() };
  });

export const rescheduleStudioAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => StudioRescheduleInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = getAdminClient() as any;
    const userId = String((context as any).userId ?? "");
    await assertStudioAccess(sb, userId, data.studioId);
    await assertAppointmentAccess(sb, userId, data.appointmentId);

    const { data: result, error } = await sb
      .rpc("reschedule_studio_appointment", {
        p_appointment_id: data.appointmentId,
        p_studio_id: data.studioId,
        p_local_date: data.date,
        p_local_time: data.time,
      })
      .maybeSingle();

    if (error) {
      const { data: availabilityDiagnosis, error: diagnosisError } = await sb.rpc(
        "diagnose_studio_reschedule_slot",
        {
          p_appointment_id: data.appointmentId,
          p_studio_id: data.studioId,
          p_local_date: data.date,
          p_local_time: data.time,
        },
      );
      console.error("[studio-reschedule] database mutation failed", {
        appointmentId: data.appointmentId,
        studioId: data.studioId,
        selectedDate: data.date,
        selectedTime: data.time,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
        availabilityDiagnosis,
        diagnosisError: diagnosisError
          ? {
              code: diagnosisError.code,
              message: diagnosisError.message,
              details: diagnosisError.details,
            }
          : null,
      });
      throw new Error(translateRescheduleDatabaseError(error));
    }
    if (!result?.appointment_id) {
      console.error("[studio-reschedule] database returned no appointment", {
        appointmentId: data.appointmentId,
        studioId: data.studioId,
        selectedDate: data.date,
        selectedTime: data.time,
      });
      throw new Error("reschedule_failed");
    }

    console.info("[studio-reschedule] appointment updated", {
      appointmentId: result.appointment_id,
      studioId: data.studioId,
      startsAt: result.starts_at,
      endsAt: result.ends_at,
      rescheduled: result.rescheduled,
    });

    if (result.rescheduled) {
      await sendAppointmentLifecycleMessage(sb, result.appointment_id, "reschedule").catch(
        (notificationError) =>
          console.error("[studio-reschedule] client notification failed", {
            appointmentId: result.appointment_id,
            studioId: data.studioId,
            error:
              notificationError instanceof Error
                ? notificationError.message
                : String(notificationError),
          }),
      );
      await dispatchPendingStudioPushNotifications({
        studioId: data.studioId,
        appointmentId: result.appointment_id,
      }).catch((notificationError) =>
        console.error("[studio-reschedule] studio push failed", {
          appointmentId: result.appointment_id,
          studioId: data.studioId,
          error:
            notificationError instanceof Error
              ? notificationError.message
              : String(notificationError),
        }),
      );
      await notifyClientReschedule(sb, data.studioId, result.appointment_id);
    }

    return {
      appointmentId: result.appointment_id as string,
      startsAt: result.starts_at as string,
      endsAt: result.ends_at as string,
      rescheduled: Boolean(result.rescheduled),
    };
  });

export const cancelStudioAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => StudioCancelInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = getAdminClient() as any;
    const userId = String((context as any).userId ?? "");
    await assertStudioAccess(sb, userId, data.studioId);
    await assertAppointmentAccess(sb, userId, data.appointmentId);
    const { data: jointLines, error: jointError } = await sb
      .from("appointment_services")
      .select("id")
      .eq("appointment_id", data.appointmentId)
      .not("service_state", "is", null)
      .limit(1);
    if (jointError) throw jointError;
    if (jointLines?.length) throw new Error("cancel_joint_services_individually");
    const { data: updated, error } = await sb
      .from("appointments")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", data.appointmentId)
      .eq("studio_id", data.studioId)
      .neq("status", "cancelled")
      .select("id,studio_id,client_id,starts_at,public_token,clients:clients!appointments_client_same_studio(name,auth_user_id),studios(name,timezone)")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated?.id) throw new Error("appointment_already_cancelled_or_missing");
    await Promise.allSettled([
      sendAppointmentLifecycleMessage(sb, updated.id, "cancellation"),
      notifyClientAppointmentChange(sb, normalizeAppointmentRelations(updated), "appointment_cancelled"),
      notifyStudioCancellation(sb, updated),
    ]).then((results) => results.forEach((result, index) => {
      if (result.status === "rejected") console.error("[studio-cancel] notification failed", { index, error: result.reason });
    }));
    return { appointmentId: updated.id, status: "cancelled" };
  });

export const previewStudioScheduleChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => SchedulePreviewInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = getAdminClient() as any;
    const userId = String((context as any).userId ?? "");
    await assertStudioAccess(sb, userId, data.studioId);
    await assertScheduleStaffAccess(sb, userId, data.studioId, data.staffId);
    const { data: preview, error } = await sb.rpc("preview_studio_schedule_change", {
      p_studio_id: data.studioId,
      p_staff_id: data.staffId,
      p_starts_at: data.startsAt,
      p_duration_min: data.durationMin,
      p_ignore_appointment_ids: data.ignoreAppointmentIds,
    });
    if (error) throw new Error(translateScheduleMutationError(error));
    return preview as StudioSchedulePreview;
  });

export const moveStudioAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => MoveStudioAppointmentInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = getAdminClient() as any;
    const userId = String((context as any).userId ?? "");
    await assertStudioAccess(sb, userId, data.studioId);
    await assertAppointmentAccess(sb, userId, data.appointmentId);
    const { data: result, error } = await sb.rpc("move_studio_appointment", {
      p_studio_id: data.studioId,
      p_appointment_id: data.appointmentId,
      p_starts_at: data.startsAt,
      p_duration_min: data.durationMin,
      p_confirm_overlap: data.confirmOverlap,
      p_actor_id: userId,
      p_expected_conflict_ids: data.expectedConflictIds,
      p_operation: data.operation,
    });
    if (error) throw new Error(translateScheduleMutationError(error));
    if (data.operation === "move" && result?.changed !== false) {
      await dispatchRescheduleNotifications(sb, data.studioId, [data.appointmentId]);
    }
    return result as {
      appointmentId: string;
      startsAt: string;
      endsAt: string;
      durationMin: number;
      changed: boolean;
      overlapConfirmed: boolean;
      conflicts: StudioScheduleConflict[];
    };
  });

export const swapStudioAppointments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => SwapStudioAppointmentsInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = getAdminClient() as any;
    const userId = String((context as any).userId ?? "");
    await assertStudioAccess(sb, userId, data.studioId);
    await Promise.all([
      assertAppointmentAccess(sb, userId, data.firstAppointmentId),
      assertAppointmentAccess(sb, userId, data.secondAppointmentId),
    ]);
    const { data: result, error } = await sb.rpc("swap_studio_appointments", {
      p_studio_id: data.studioId,
      p_first_appointment_id: data.firstAppointmentId,
      p_second_appointment_id: data.secondAppointmentId,
      p_confirm_overlap: data.confirmOverlap,
      p_actor_id: userId,
      p_expected_conflict_ids: data.expectedConflictIds,
    });
    if (error) throw new Error(translateScheduleMutationError(error));
    if (result?.changed !== false) {
      await dispatchRescheduleNotifications(sb, data.studioId, [
        data.firstAppointmentId,
        data.secondAppointmentId,
      ]);
    }
    return result as {
      firstAppointmentId: string;
      secondAppointmentId: string;
      firstStartsAt: string;
      secondStartsAt: string;
      changed: boolean;
      overlapConfirmed: boolean;
      conflicts: StudioScheduleConflict[];
    };
  });

export const createStudioManualFit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => CreateStudioManualFitInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = getAdminClient() as any;
    const userId = String((context as any).userId ?? "");
    await assertStudioAccess(sb, userId, data.studioId);
    await Promise.all(
      [...new Set(data.assignments.map((assignment) => assignment.staffId))].map((staffId) =>
        assertScheduleStaffAccess(sb, userId, data.studioId, staffId),
      ),
    );
    if (data.expectedPaymentHoldIds.length > 0) {
      await releaseOwnerPaymentHolds(sb, userId, data);
    }
    const { data: result, error } = await sb.rpc(
      "create_studio_manual_multi_professional_fit",
      {
        p_studio_id: data.studioId,
        p_assignments: data.assignments,
        p_starts_at: data.startsAt,
        p_client_id: data.clientId,
        p_client_name: data.clientName,
        p_client_phone: data.clientPhone,
        p_notes: data.notes,
        p_confirm_overlap: data.confirmOverlap,
        p_actor_id: userId,
        p_expected_conflict_ids: data.expectedConflictIds,
      },
    );
    if (error) throw new Error(translateScheduleMutationError(error));
    return result as {
      appointmentId: string;
      startsAt: string;
      endsAt: string;
      overlapConfirmed: boolean;
      conflicts: StudioScheduleConflict[];
    };
  });

async function dispatchRescheduleNotifications(
  sb: any,
  studioId: string,
  appointmentIds: string[],
) {
  await Promise.allSettled(
    appointmentIds.flatMap((appointmentId) => [
      sendAppointmentLifecycleMessage(sb, appointmentId, "reschedule"),
      dispatchPendingStudioPushNotifications({ studioId, appointmentId }),
      notifyClientReschedule(sb, studioId, appointmentId),
    ]),
  );
}

function normalizeAppointmentRelations(row: any) {
  return {
    ...row,
    clients: Array.isArray(row.clients) ? row.clients[0] : row.clients,
    studios: Array.isArray(row.studios) ? row.studios[0] : row.studios,
  };
}

async function notifyClientReschedule(sb: any, studioId: string, appointmentId: string) {
  const { data, error } = await sb
    .from("appointments")
    .select("id,studio_id,starts_at,public_token,clients:clients!appointments_client_same_studio(auth_user_id),studios(name,timezone)")
    .eq("id", appointmentId)
    .eq("studio_id", studioId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data?.id) await notifyClientAppointmentChange(sb, normalizeAppointmentRelations(data), "appointment_rescheduled");
}

async function notifyStudioCancellation(sb: any, appointment: any) {
  const row = normalizeAppointmentRelations(appointment);
  const { data: entitled, error: entitlementError } = await sb.rpc("studio_has_entitlement", {
    _studio_id: row.studio_id,
    _feature: "notifications",
  });
  if (entitlementError) throw new Error(entitlementError.message);
  if (!entitled) return;
  const when = formatStudioDateTime(row.starts_at, row.studios?.timezone);
  const { error } = await sb.rpc("insert_studio_notification", {
    p_studio_id: row.studio_id,
    p_kind: "appointment_cancelled",
    p_title: "Marcação cancelada",
    p_body: `A marcação de ${row.clients?.name ?? "Cliente"} para ${when} foi cancelada.`,
    p_payload: {
      appointment_id: row.id,
      client_id: row.client_id,
      starts_at: row.starts_at,
      event_key: `appointment:${row.id}:cancelled`,
      action_url: "/admin/agenda",
    },
  });
  if (error) throw new Error(error.message);
  await dispatchPendingStudioPushNotifications({ studioId: row.studio_id, appointmentId: row.id });
}

async function assertScheduleStaffAccess(
  sb: any,
  userId: string,
  studioId: string,
  staffId: string,
) {
  const { data: roles, error } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("studio_id", studioId);
  if (error || !roles?.length) throw new Response("forbidden", { status: 403 });
  if (
    roles.some((row: { role?: string }) =>
      ["saas_owner", "studio_owner", "manager"].includes(String(row.role)),
    )
  ) {
    return;
  }
  if (!roles.some((row: { role?: string }) => row.role === "staff")) {
    throw new Response("forbidden", { status: 403 });
  }
  const { data: staff, error: staffError } = await sb
    .from("staff")
    .select("id")
    .eq("studio_id", studioId)
    .eq("user_id", userId)
    .eq("id", staffId)
    .eq("is_active", true)
    .maybeSingle();
  if (staffError || !staff?.id) throw new Response("forbidden", { status: 403 });
}

function translateRescheduleDatabaseError(error: {
  code?: string;
  message?: string;
  details?: string;
}) {
  const text = [error.code, error.message, error.details].filter(Boolean).join(" ").toLowerCase();
  if (text.includes("slot_unavailable") || text.includes("23p01") || text.includes("exclusion")) {
    return "slot_unavailable";
  }
  if (text.includes("appointment_not_reschedulable")) {
    return "appointment_not_reschedulable";
  }
  if (text.includes("appointment_not_found")) return "appointment_not_found";
  if (text.includes("invalid_reschedule_datetime")) {
    return "invalid_reschedule_datetime";
  }
  return "reschedule_failed";
}

function translateScheduleMutationError(error: {
  code?: string;
  message?: string;
  details?: string;
}) {
  const text = [error.code, error.message, error.details].filter(Boolean).join(" ").toLowerCase();
  if (
    text.includes("schedule_conflict") ||
    text.includes("slot_unavailable") ||
    text.includes("23p01")
  ) {
    return "schedule_conflict";
  }
  if (text.includes("schedule_hard_blocked") || text.includes("staff_unavailable")) {
    return "schedule_hard_blocked";
  }
  if (text.includes("outside_staff_availability")) return "outside_staff_availability";
  if (text.includes("appointment_not_reschedulable")) return "appointment_not_reschedulable";
  if (text.includes("appointment_not_found")) return "appointment_not_found";
  if (text.includes("invalid_duration")) return "invalid_duration";
  if (text.includes("not_authorized")) return "not_authorized";
  return "schedule_change_failed";
}
