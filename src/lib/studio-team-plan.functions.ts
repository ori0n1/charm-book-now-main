import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertStudioAccess, assertStudioFinancialReadAccess } from "@/lib/server-security";
import { getAdminClient } from "@/lib/supabase-admin.server";

/** Read only the effective tier for a manager, without exposing billing details. */
export const getStudioTeamPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ studioId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const sb = getAdminClient();
    const userId = (context as any).userId as string;
    await assertStudioAccess(sb, userId, data.studioId);
    await assertStudioFinancialReadAccess(sb, userId, data.studioId);

    const [premium, pro] = await Promise.all([
      sb.rpc("studio_has_entitlement", { _studio_id: data.studioId, _feature: "loyalty" }),
      sb.rpc("studio_has_entitlement", { _studio_id: data.studioId, _feature: "finance_basic" }),
    ]);
    if (premium.error) throw premium.error;
    if (pro.error) throw pro.error;
    return premium.data === true ? "premium" as const : pro.data === true ? "pro" as const : "free" as const;
  });
