import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getAdminClient } from "@/lib/supabase-admin.server";
import { buildCentralOverview, type CentralOverview } from "@/lib/platform-central-core";

export type { CentralOverview, CentralStudio } from "@/lib/platform-central-core";

// Keep the overview bounded. A reached cap is an unavailable section, never a partial total.
async function pagedRows(
  createQuery: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>,
) {
  const rows: any[] = [];
  const pageSize = 500;
  for (let page = 0; page < 20; page += 1) {
    const { data, error } = await createQuery(page * pageSize, (page + 1) * pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
  throw new Error("central_result_limit");
}

export const getCentralOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CentralOverview> => {
    const sb: any = getAdminClient();
    const { data: roles, error: rolesError } = await sb
      .from("user_roles")
      .select("role")
      .eq("user_id", (context as any).userId)
      .eq("role", "saas_owner")
      .limit(1);
    if (rolesError) throw new Error("central_access_lookup_failed");
    if (!roles?.length) throw new Response("forbidden", { status: 403 });

    const now = new Date();
    const from = new Date(now);
    from.setUTCDate(from.getUTCDate() - 32);
    const until = new Date(now);
    until.setUTCDate(until.getUTCDate() + 1);
    const [studios, subscriptions, activity, billing] = await Promise.all([
      pagedRows((start, end) =>
        sb
          .from("studios")
          .select(
            "id,name,owner_name,email,is_active,plan,subscription_status,trial_ends_at,created_at",
          )
          .order("created_at", { ascending: true })
          .range(start, end),
      ),
      pagedRows((start, end) =>
        sb
          .from("subscriptions")
          .select("id,studio_id,plan,status,created_at,updated_at")
          .order("updated_at", { ascending: true })
          .range(start, end),
      ),
      pagedRows((start, end) =>
        sb
          .from("appointments")
          .select("id,studio_id,status,starts_at,total_price")
          .gte("starts_at", from.toISOString())
          .lte("starts_at", until.toISOString())
          .order("starts_at", { ascending: true })
          .range(start, end),
      ).then(
        (rows) => rows,
        () => null,
      ),
      pagedRows((start, end) =>
        sb
          .from("platform_billing_events")
          .select("id,event_type,created_at,payload")
          .in("event_type", ["invoice.paid", "invoice.payment_succeeded"])
          .gte("created_at", from.toISOString())
          .lte("created_at", until.toISOString())
          .order("created_at", { ascending: true })
          .range(start, end),
      ).then(
        (rows) => rows,
        () => null,
      ),
    ]);
    return buildCentralOverview({
      studios,
      subscriptions,
      appointments: activity,
      billingEvents: billing,
      now,
    });
  });
