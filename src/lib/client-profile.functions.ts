import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { clientProfileInput, updateClientProfileForOwner } from "@/lib/client-profile-core";

export const getClientProfileEditPermission = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ studioId: z.string().uuid() }).strict().parse(input))
  .handler(async ({ data, context }) => {
    const { data: owner, error } = await context.supabase
      .from("user_roles")
      .select("user_id")
      .eq("user_id", context.userId)
      .eq("studio_id", data.studioId)
      .eq("role", "studio_owner")
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return { canEdit: Boolean(owner) };
  });

export const updateClientProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => clientProfileInput.parse(input))
  .handler(({ data, context }) => updateClientProfileForOwner(context.supabase, context.userId, data));
