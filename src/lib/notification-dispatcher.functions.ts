import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SyncStudioPushInput = z.object({
  studioId: z.string().uuid(),
});

const DispatchRecentStudioAppointmentInput = z.object({
  studioId: z.string().uuid(),
  appointmentId: z.string().uuid(),
});

export const syncStudioPushNotifications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => SyncStudioPushInput.parse(input))
  .handler(async ({ data, context }) => {
    const userId = String((context as any).userId ?? "").trim();
    if (!userId) throw new Response("Unauthorized", { status: 401 });

    const [{ getAdminClient }, { assertStudioAccess, assertStudioEntitlement }, dispatcher] =
      await Promise.all([
        import("@/lib/supabase-admin.server"),
        import("@/lib/server-security"),
        import("@/lib/notification-dispatcher.server"),
      ]);
    const sb = getAdminClient();
    await assertStudioAccess(sb, userId, data.studioId);
    await assertStudioEntitlement(sb, data.studioId, "notifications");
    return dispatcher.dispatchPendingStudioPushNotifications({ studioId: data.studioId });
  });

export const dispatchRecentStudioAppointmentPushNotification = createServerFn({ method: "POST" })
  .inputValidator((input) => DispatchRecentStudioAppointmentInput.parse(input))
  .handler(async ({ data }) => {
    const dispatcher = await import("@/lib/notification-dispatcher.server");
    return dispatcher.dispatchRecentStudioAppointmentPushNotification(data);
  });
