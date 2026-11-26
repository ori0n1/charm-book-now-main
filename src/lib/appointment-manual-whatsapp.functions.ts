import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertStudioAccess } from "@/lib/server-security";
import { getAdminClient } from "@/lib/supabase-admin.server";

const StudioInput = z.object({ studioId: z.string().uuid() });
const AppointmentsInput = StudioInput.extend({
  appointmentIds: z.array(z.string().uuid()).max(250),
});
const AppointmentInput = StudioInput.extend({ appointmentId: z.string().uuid() });

async function assertManualStudioOwner(admin: any, userId: string, studioId: string) {
  await assertStudioAccess(admin, userId, studioId);
  const { data: role, error } = await admin.from("user_roles")
    .select("role")
    .eq("studio_id", studioId)
    .eq("user_id", userId)
    .in("role", ["studio_owner", "saas_owner"])
    .limit(1)
    .maybeSingle();
  if (error || !role) throw new Response("forbidden", { status: 403 });
}

export const getStudioManualAppointmentWhatsAppStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => AppointmentsInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = getAdminClient() as any;
    const userId = String((context as any).userId ?? "");
    await assertManualStudioOwner(admin, userId, data.studioId);
    const { data: studio, error: studioError } = await admin.from("studios")
      .select("whatsapp_auto_send_enabled")
      .eq("id", data.studioId)
      .maybeSingle();
    if (studioError || !studio) throw new Error("studio_unavailable");
    const manualMode = studio.whatsapp_auto_send_enabled === false;
    if (!manualMode || data.appointmentIds.length === 0) {
      return { manualMode, openedAppointmentIds: [] as string[] };
    }
    const openedAppointmentIds = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const { data: rows, error } = await admin.from("appointment_manual_whatsapp_opens")
        .select("appointment_id")
        .eq("studio_id", data.studioId)
        .in("appointment_id", data.appointmentIds)
        .order("id", { ascending: true })
        .range(from, from + 999);
      if (error) throw error;
      for (const row of rows ?? []) {
        if (typeof row.appointment_id === "string") openedAppointmentIds.add(row.appointment_id);
      }
      if (!rows || rows.length < 1000) break;
    }
    return {
      manualMode: true,
      openedAppointmentIds: [...openedAppointmentIds],
    };
  });

export const recordManualAppointmentWhatsAppOpen = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => AppointmentInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = getAdminClient() as any;
    const userId = String((context as any).userId ?? "");
    await assertManualStudioOwner(admin, userId, data.studioId);
    const { data: openedAt, error } = await admin.rpc("record_appointment_manual_whatsapp_open", {
      p_studio_id: data.studioId,
      p_appointment_id: data.appointmentId,
      p_user_id: userId,
    });
    if (error || !openedAt) throw new Error("manual_whatsapp_open_not_recorded");
    return { appointmentId: data.appointmentId, openedAt: String(openedAt) };
  });
