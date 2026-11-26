import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertStudioOwnerAccess } from "@/lib/server-security";
import { notificationCategories } from "@/lib/studio-notification-preferences";

const studioInput = z.object({ studioId: z.string().uuid() });
const saveInput = studioInput.extend({
  category: z.enum(notificationCategories.map((item) => item.id) as [
    (typeof notificationCategories)[number]["id"],
    ...(typeof notificationCategories)[number]["id"][],
  ]),
  enabled: z.boolean(),
});

export const getStudioNotificationPreferences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => studioInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const userId = String(context.userId ?? "");
    await assertStudioOwnerAccess(sb, userId, data.studioId);
    const { data: rows, error } = await sb.from("studio_notification_preferences")
      .select("category,enabled")
      .eq("studio_id", data.studioId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return (rows ?? []) as Array<{ category: string; enabled: boolean }>;
  });

export const saveStudioNotificationPreference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => saveInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const userId = String(context.userId ?? "");
    await assertStudioOwnerAccess(sb, userId, data.studioId);
    const { error } = await sb.from("studio_notification_preferences").upsert({
      studio_id: data.studioId,
      user_id: userId,
      category: data.category,
      enabled: data.enabled,
      updated_at: new Date().toISOString(),
    }, { onConflict: "studio_id,user_id,category" });
    if (error) throw new Error(error.message);
    return { category: data.category, enabled: data.enabled };
  });
