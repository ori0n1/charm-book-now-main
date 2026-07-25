import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getAdminClient } from "@/lib/supabase-admin.server";
import {
  buildPlatformMetrics,
  resolveMetricsPeriod,
  type PlatformBillingEventSource,
  type PlatformMetrics,
  type PlatformMetricsFilters,
  type PlatformStudioIdentity,
} from "@/lib/platform-metrics-core";

export type {
  PlatformMetrics,
  PlatformMetricsFilters,
  PlatformMetricPoint,
  PlatformStudioRow,
} from "@/lib/platform-metrics-core";

export type PlatformStudioOption = {
  id: string;
  name: string;
  timezone: string;
};

export type PlatformMetricsResponse = {
  metrics: PlatformMetrics;
  studioOptions: PlatformStudioOption[];
};

const filtersSchema = z.object({
  studioId: z.string().uuid().nullable().default(null),
  preset: z.enum(["today", "7d", "30d", "month", "year", "custom"]).default("30d"),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  plan: z.enum(["all", "trial", "monthly", "quarterly", "yearly"]).default("all"),
  accountStatus: z.enum(["all", "active", "blocked", "cancelled"]).default("all"),
  subscriptionStatus: z
    .enum(["all", "trialing", "active", "past_due", "canceled"])
    .default("all"),
});

const exportSchema = filtersSchema.extend({
  format: z.enum(["csv", "excel"]),
});

const DEFAULT_FILTERS: PlatformMetricsFilters = {
  studioId: null,
  preset: "30d",
  from: null,
  to: null,
  plan: "all",
  accountStatus: "all",
  subscriptionStatus: "all",
};

function admin(): any {
  return getAdminClient();
}

async function assertSaasOwner(userId: string) {
  const sb = admin();
  const { data, error } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "saas_owner")
    .maybeSingle();
  if (error || data?.role !== "saas_owner") {
    throw new Response("forbidden", { status: 403 });
  }
}

async function pagedRows(
  createQuery: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>,
) {
  const rows: any[] = [];
  const pageSize = 1000;
  for (let page = 0; page < 100; page += 1) {
    const from = page * pageSize;
    const { data, error } = await createQuery(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function listAllAuthUsers(sb: any) {
  const users: any[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    users.push(...(data.users ?? []));
    if (!data.users || data.users.length < 1000) break;
  }
  return users;
}

function payloadObject(payload: unknown): Record<string, any> | null {
  if (!payload || typeof payload !== "object") return null;
  const object = (payload as any).data?.object;
  return object && typeof object === "object" ? object : null;
}

function resolveEventStudioIds(events: any[], subscriptions: any[]) {
  const bySubscription = new Map<string, string>();
  const byCustomer = new Map<string, string>();
  for (const subscription of subscriptions) {
    if (!subscription.studio_id) continue;
    if (subscription.stripe_subscription_id) {
      bySubscription.set(subscription.stripe_subscription_id, subscription.studio_id);
    }
    if (subscription.stripe_customer_id) {
      byCustomer.set(subscription.stripe_customer_id, subscription.studio_id);
    }
  }

  return events.map((event): PlatformBillingEventSource => {
    const object = payloadObject(event.payload);
    const subscriptionId =
      typeof object?.subscription === "string"
        ? object.subscription
        : object?.subscription?.id || object?.id;
    const customerId =
      typeof object?.customer === "string" ? object.customer : object?.customer?.id;
    return {
      ...event,
      resolved_studio_id:
        event.studio_id ||
        object?.metadata?.studio_id ||
        object?.subscription_details?.metadata?.studio_id ||
        bySubscription.get(subscriptionId) ||
        byCustomer.get(customerId) ||
        null,
    };
  });
}

function buildIdentities(roles: any[], profiles: any[], authUsers: any[]) {
  const userById = new Map(authUsers.map((user) => [user.id, user]));
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const rolesByStudio = new Map<string, any[]>();
  for (const role of roles) {
    if (!role.studio_id) continue;
    const current = rolesByStudio.get(role.studio_id) ?? [];
    current.push(role);
    rolesByStudio.set(role.studio_id, current);
  }

  const identities: PlatformStudioIdentity[] = [];
  for (const [studioId, studioRoles] of rolesByStudio) {
    const owner = studioRoles.find((role) => role.role === "studio_owner");
    const ownerUser = owner ? userById.get(owner.user_id) : null;
    const ownerProfile = owner ? profileById.get(owner.user_id) : null;
    const lastAccessAt =
      studioRoles
        .map((role) => userById.get(role.user_id)?.last_sign_in_at)
        .filter(Boolean)
        .sort()
        .at(-1) ?? null;
    identities.push({
      studioId,
      ownerName:
        ownerProfile?.full_name ||
        ownerUser?.user_metadata?.full_name ||
        ownerUser?.user_metadata?.name ||
        null,
      ownerEmail: ownerUser?.email || null,
      lastAccessAt,
    });
  }
  return identities;
}

function broadDateBounds(period: { from: string; to: string }) {
  const from = new Date(`${period.from}T00:00:00.000Z`);
  const to = new Date(`${period.to}T23:59:59.999Z`);
  from.setUTCDate(from.getUTCDate() - 1);
  to.setUTCDate(to.getUTCDate() + 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

async function loadPlatformData(filters: PlatformMetricsFilters): Promise<PlatformMetricsResponse> {
  const sb = admin();

  const [studios, subscriptions, roles, authUsers] = await Promise.all([
    pagedRows((from, to) =>
      sb
        .from("studios")
        .select(
          "id,name,owner_name,email,is_active,plan,subscription_status,subscription_current_period_end,trial_ends_at,trial_claimed_at,premium_access_until,timezone,created_at",
        )
        .order("created_at", { ascending: true })
        .range(from, to),
    ),
    pagedRows((from, to) =>
      sb
        .from("subscriptions")
        .select(
          "id,studio_id,user_id,stripe_customer_id,stripe_subscription_id,plan,status,current_period_end,cancel_at_period_end,created_at,updated_at",
        )
        .order("updated_at", { ascending: true })
        .range(from, to),
    ),
    pagedRows((from, to) =>
      sb
        .from("user_roles")
        .select("user_id,studio_id,role")
        .not("studio_id", "is", null)
        .range(from, to),
    ),
    listAllAuthUsers(sb),
  ]);

  if (filters.studioId && !studios.some((studio) => studio.id === filters.studioId)) {
    throw new Response("studio_not_found", { status: 404 });
  }
  const selectedTimezone =
    studios.find((studio) => studio.id === filters.studioId)?.timezone || "Europe/Lisbon";
  const bounds = broadDateBounds(resolveMetricsPeriod(filters, selectedTimezone));

  const userIds = [...new Set(roles.map((role) => role.user_id).filter(Boolean))];
  const profiles =
    userIds.length > 0
      ? await pagedRows((from, to) =>
          sb
            .from("profiles")
            .select("id,full_name")
            .in("id", userIds)
            .range(from, to),
        )
      : [];

  const [appointments, clients, billingEvents] = await Promise.all([
    pagedRows((from, to) => {
      let query = sb
        .from("appointments")
        .select("id,studio_id,status,starts_at,created_at,total_price")
        .order("starts_at", { ascending: true });
      if (filters.studioId) query = query.eq("studio_id", filters.studioId);
      if (bounds) query = query.gte("starts_at", bounds.from).lte("starts_at", bounds.to);
      return query.range(from, to);
    }),
    pagedRows((from, to) => {
      let query = sb
        .from("clients")
        .select("id,studio_id,created_at")
        .order("created_at", { ascending: true });
      if (filters.studioId) query = query.eq("studio_id", filters.studioId);
      return query.range(from, to);
    }),
    pagedRows((from, to) => {
      const query = sb
        .from("platform_billing_events")
        .select("id,studio_id,event_type,payload,created_at")
        .in("event_type", [
          "invoice.paid",
          "invoice.payment_succeeded",
          "customer.subscription.deleted",
        ])
        .order("created_at", { ascending: true });
      // Events without studio_id are retained because the subscription/customer fallback
      // below may still resolve them to a selected studio.
      return query.range(from, to);
    }),
  ]);

  const identities = buildIdentities(roles, profiles, authUsers);
  const resolvedBillingEvents = resolveEventStudioIds(billingEvents, subscriptions);
  const metrics = buildPlatformMetrics({
    filters,
    studios,
    subscriptions,
    appointments,
    clients,
    billingEvents: resolvedBillingEvents,
    identities,
  });

  return {
    metrics,
    studioOptions: studios
      .map((studio) => ({
        id: studio.id as string,
        name: studio.name as string,
        timezone: studio.timezone || "Europe/Lisbon",
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt")),
  };
}

export const getPlatformMetrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => filtersSchema.parse(input ?? DEFAULT_FILTERS))
  .handler(async ({ data, context }): Promise<PlatformMetricsResponse> => {
    await assertSaasOwner((context as any).userId);
    return loadPlatformData(data);
  });

function csvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function xmlCell(value: unknown, type: "String" | "Number" = "String") {
  const text = String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return `<Cell><Data ss:Type="${type}">${text}</Data></Cell>`;
}

function exportRows(metrics: PlatformMetrics) {
  const summary: Array<[string, string | number]> = [
    ["Período", metrics.period.label],
    ["Fuso horário", metrics.period.timezone],
    ["Estúdios", metrics.studios.total],
    ["Estúdios ativos", metrics.studios.active],
    ["Estúdios bloqueados", metrics.studios.blocked],
    ["Estúdios cancelados", metrics.studios.cancelled],
    ["Receita Bellza (€)", (metrics.finances.platformRevenueCents / 100).toFixed(2)],
    ["Volume dos estúdios (€)", (metrics.finances.studioVolumeCents / 100).toFixed(2)],
    ["Marcações", metrics.appointments.total],
    ["Marcações concluídas", metrics.appointments.completed],
    ["Clientes", metrics.clients.total],
    ["Novos clientes", metrics.clients.newInPeriod],
    ["Conversão teste → pago (%)", metrics.rates.trialConversion],
    ["Cancelamento de assinaturas (%)", metrics.rates.subscriptionCancellation],
  ];
  const headers = [
    "Estúdio",
    "Responsável",
    "E-mail",
    "Criação",
    "Último acesso",
    "Plano",
    "Estado da conta",
    "Estado da assinatura",
    "Receita Bellza (€)",
    "Volume do estúdio (€)",
    "Marcações",
    "Clientes",
  ];
  const studios = metrics.studioRows.map((studio) => [
    studio.name,
    studio.ownerName,
    studio.email,
    studio.createdAt,
    studio.lastAccessAt || "",
    studio.plan,
    studio.accountStatus,
    studio.subscriptionStatus,
    (studio.revenueCents / 100).toFixed(2),
    (studio.volumeCents / 100).toFixed(2),
    studio.appointments,
    studio.clients,
  ]);
  return { summary, headers, studios };
}

export const exportPlatformMetrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => exportSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertSaasOwner((context as any).userId);
    const { format, ...filters } = data;
    const { metrics } = await loadPlatformData(filters);
    const rows = exportRows(metrics);
    const stamp = `${metrics.period.from}_${metrics.period.to}`;

    if (format === "csv") {
      const content = [
        ...rows.summary.map((row) => row.map(csvCell).join(";")),
        "",
        rows.headers.map(csvCell).join(";"),
        ...rows.studios.map((row) => row.map(csvCell).join(";")),
      ].join("\r\n");
      return {
        filename: `bellza-metricas-${stamp}.csv`,
        mimeType: "text/csv;charset=utf-8",
        content: `\uFEFF${content}`,
      };
    }

    const summaryRows = rows.summary
      .map(
        ([label, value]) =>
          `<Row>${xmlCell(label)}${xmlCell(
            value,
            typeof value === "number" ? "Number" : "String",
          )}</Row>`,
      )
      .join("");
    const studioRows = [
      `<Row>${rows.headers.map((header) => xmlCell(header)).join("")}</Row>`,
      ...rows.studios.map(
        (row) =>
          `<Row>${row
            .map((value) => xmlCell(value, typeof value === "number" ? "Number" : "String"))
            .join("")}</Row>`,
      ),
    ].join("");
    return {
      filename: `bellza-metricas-${stamp}.xls`,
      mimeType: "application/vnd.ms-excel;charset=utf-8",
      content: `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="Resumo"><Table>${summaryRows}</Table></Worksheet>
<Worksheet ss:Name="Estúdios"><Table>${studioRows}</Table></Worksheet>
</Workbook>`,
    };
  });
