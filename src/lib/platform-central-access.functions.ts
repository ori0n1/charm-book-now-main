import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getAdminClient } from "@/lib/supabase-admin.server";
import {
  buildCentralAccessSnapshot,
  type CentralAccessSnapshot,
} from "@/lib/platform-central-access-core";

export type { CentralAccessSnapshot, CentralStudioAccess } from "@/lib/platform-central-access-core";

export const getCentralAccessSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CentralAccessSnapshot> => {
    const sb = getAdminClient();
    const { data: access, error: accessError } = await sb
      .from("user_roles")
      .select("role")
      .eq("user_id", (context as { userId: string }).userId)
      .eq("role", "saas_owner")
      .limit(1);
    if (accessError) throw new Error("central_access_lookup_failed");
    if (!access?.length) throw new Response("forbidden", { status: 403 });

    const roles: Array<{ user_id: string; studio_id: string | null; role: string }> = [];
    for (let page = 0; page < 20; page += 1) {
      const { data, error } = await sb
        .from("user_roles")
        .select("user_id,studio_id,role")
        .not("studio_id", "is", null)
        .order("studio_id", { ascending: true })
        .range(page * 500, (page + 1) * 500 - 1);
      if (error) throw new Error("central_roles_unavailable");
      roles.push(...(data ?? []));
      if (!data || data.length < 500) break;
      if (page === 19) throw new Error("central_roles_limit");
    }

    const users: Array<{ id: string; email?: string | null; last_sign_in_at?: string | null }> = [];
    for (let page = 1; page <= 20; page += 1) {
      const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw new Error("central_auth_users_unavailable");
      users.push(...(data.users ?? []));
      if (!data.users || data.users.length < 1000) break;
      if (page === 20) throw new Error("central_auth_users_limit");
    }

    return buildCentralAccessSnapshot({ users, roles });
  });
