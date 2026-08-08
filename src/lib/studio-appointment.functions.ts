import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dispatchPendingStudioPushNotifications } from "@/lib/notification-dispatcher.server";
import { assertStudioAccess } from "@/lib/server-security";
import { getAdminClient } from "@/lib/supabase-admin.server";
import { sendAppointmentLifecycleMessage } from "@/lib/whatsapp.functions";

const StudioRescheduleInput = z.object({
  studioId: z.string().uuid(),
  appointmentId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
});

export const rescheduleStudioAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => StudioRescheduleInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = getAdminClient() as any;
    const userId = String((context as any).userId ?? "");
    await assertStudioAccess(sb, userId, data.studioId);

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
      await sendAppointmentLifecycleMessage(
        sb,
        result.appointment_id,
        "reschedule",
      ).catch((notificationError) =>
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
    }

    return {
      appointmentId: result.appointment_id as string,
      startsAt: result.starts_at as string,
      endsAt: result.ends_at as string,
      rescheduled: Boolean(result.rescheduled),
    };
  });

function translateRescheduleDatabaseError(error: {
  code?: string;
  message?: string;
  details?: string;
}) {
  const text = [error.code, error.message, error.details]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (
    text.includes("slot_unavailable") ||
    text.includes("23p01") ||
    text.includes("exclusion")
  ) {
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
