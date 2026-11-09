import { getStudioDateKey } from "@/lib/studio-time";
import {
  resolveMetricsPeriod,
  type PlatformMetricsFilters,
  type PlatformStudioSource,
  type PlatformSubscriptionSource,
} from "@/lib/platform-metrics-core";

export type CentralStudio = {
  id: string;
  name: string;
  ownerName: string;
  email: string;
  plan: string;
  accountStatus: "active" | "blocked" | "cancelled";
  subscriptionStatus: string;
  trialEndsAt: string | null;
  trialDaysRemaining: number;
  appointments: number | null;
  completedAppointments: number | null;
  volumeCents: number | null;
  clients: number | null;
  isBusinessActive: boolean | null;
};

export type CentralOverview = {
  generatedAt: string;
  period: { from: string; to: string; label: string };
  studios: CentralStudio[];
  counts: {
    total: number;
    active: number;
    blocked: number;
    cancelled: number;
    trial: number;
    paidActive: number;
    paymentIssues: number;
    expiringTrials: number;
    businessActive: number | null;
    businessTrial: number | null;
    businessPaidActive: number | null;
    businessClients: number | null;
    businessAttention: number | null;
  };
  activity: { appointments: number; completed: number; volumeCents: number } | null;
  billing: { revenueCents: number; paidInvoices: number } | null;
  issues: string[];
};

type Appointment = {
  id: string;
  studio_id: string;
  status: string;
  starts_at: string;
  total_price: number | string | null;
};
type BillingEvent = { id: string; event_type: string; created_at: string; payload: unknown };
type Client = { studio_id: string };

function inOverviewPeriod(value: string, from: string, to: string) {
  const date = new Date(value);
  const utcDay = date.toISOString().slice(0, 10);
  // Every UTC day strictly inside the range is also inside it in Lisbon.
  // Only dates at the edges need the more expensive timezone conversion.
  if (utcDay > from && utcDay < to) return true;
  const localDay = getStudioDateKey(date, "Europe/Lisbon");
  return localDay >= from && localDay <= to;
}

const filters: PlatformMetricsFilters = {
  studioId: null,
  preset: "30d",
  from: null,
  to: null,
  plan: "all",
  accountStatus: "all",
  subscriptionStatus: "all",
};

export function buildCentralOverview(input: {
  studios: PlatformStudioSource[];
  subscriptions: PlatformSubscriptionSource[];
  appointments: Appointment[] | null;
  clients: Client[] | null;
  billingEvents: BillingEvent[] | null;
  now?: Date;
}): CentralOverview {
  const now = input.now ?? new Date();
  const period = resolveMetricsPeriod(filters, "Europe/Lisbon", now);
  const latest = new Map<string, PlatformSubscriptionSource>();
  for (const subscription of input.subscriptions) {
    if (!subscription.studio_id) continue;
    const previous = latest.get(subscription.studio_id);
    if (
      !previous ||
      Date.parse(subscription.updated_at || subscription.created_at) >
        Date.parse(previous.updated_at || previous.created_at)
    ) {
      latest.set(subscription.studio_id, subscription);
    }
  }
  const rows: CentralStudio[] = input.studios.map((studio) => {
    const subscription = latest.get(studio.id);
    const subscriptionStatus = String(
      subscription?.status || studio.subscription_status || "unknown",
    )
      .toLowerCase()
      .replace("cancelled", "canceled");
    const plan = String(subscription?.plan || studio.plan || "unknown").toLowerCase();
    const trialDaysRemaining = studio.trial_ends_at
      ? Math.max(0, Math.ceil((Date.parse(studio.trial_ends_at) - now.getTime()) / 86400000))
      : 0;
    return {
      id: studio.id,
      name: studio.name,
      ownerName: studio.owner_name || "Não informado",
      email: studio.email || "Não informado",
      plan,
      accountStatus:
        subscriptionStatus === "canceled"
          ? "cancelled"
          : studio.is_active === false
            ? "blocked"
            : "active",
      subscriptionStatus,
      trialEndsAt: studio.trial_ends_at || null,
      trialDaysRemaining,
      appointments: input.appointments ? 0 : null,
      completedAppointments: input.appointments ? 0 : null,
      volumeCents: input.appointments ? 0 : null,
      clients: input.clients ? 0 : null,
      isBusinessActive: null,
    };
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  let completed = 0;
  let volumeCents = 0;
  let appointments = 0;
  for (const appointment of input.appointments ?? []) {
    const row = byId.get(appointment.studio_id);
    if (
      !row ||
      !inOverviewPeriod(appointment.starts_at, period.from, period.to)
    )
      continue;
    appointments += 1;
    row.appointments! += 1;
    if (appointment.status === "completed") {
      completed += 1;
      const amount = Math.round(Number(appointment.total_price || 0) * 100);
      volumeCents += amount;
      row.completedAppointments! += 1;
      row.volumeCents! += amount;
    }
  }
  for (const client of input.clients ?? []) {
    const row = byId.get(client.studio_id);
    if (row) row.clients! += 1;
  }
  if (input.appointments && input.clients) {
    for (const row of rows) {
      row.isBusinessActive = row.accountStatus === "active" && row.volumeCents! > 0 && row.clients! > 0;
    }
  }
  const businessRows = rows.filter((row) => row.isBusinessActive === true);
  const invoices = new Set<string>();
  let revenueCents = 0;
  let paidInvoices = 0;
  for (const event of input.billingEvents ?? []) {
    if (event.event_type !== "invoice.paid" && event.event_type !== "invoice.payment_succeeded")
      continue;
    const object = (event.payload as { data?: { object?: Record<string, unknown> } } | null)?.data
      ?.object;
    if (!object) continue;
    const invoiceId = String(object.id || event.id);
    if (invoices.has(invoiceId)) continue;
    invoices.add(invoiceId);
    if (
      !inOverviewPeriod(event.created_at, period.from, period.to)
    )
      continue;
    const amount = Number(object.amount_paid || 0);
    if (amount > 0 && (!object.currency || String(object.currency).toLowerCase() === "eur")) {
      revenueCents += amount;
      paidInvoices += 1;
    }
  }
  const issues: string[] = [];
  if (!input.appointments) issues.push("Atividade e volume dos estúdios indisponíveis.");
  if (!input.clients) issues.push("Clientes e classificação de estúdios com movimento indisponíveis.");
  if (!input.billingEvents) issues.push("Receita de assinaturas indisponível.");
  return {
    generatedAt: now.toISOString(),
    period: { from: period.from, to: period.to, label: period.label },
    studios: rows,
    counts: {
      total: rows.length,
      active: rows.filter((row) => row.accountStatus === "active").length,
      blocked: rows.filter((row) => row.accountStatus === "blocked").length,
      cancelled: rows.filter((row) => row.accountStatus === "cancelled").length,
      trial: rows.filter((row) => row.subscriptionStatus === "trialing").length,
      paidActive: rows.filter((row) => row.subscriptionStatus === "active").length,
      paymentIssues: rows.filter((row) =>
        ["past_due", "unpaid", "incomplete", "incomplete_expired", "paused"].includes(
          row.subscriptionStatus,
        ),
      ).length,
      expiringTrials: rows.filter(
        (row) => row.subscriptionStatus === "trialing" && row.trialDaysRemaining <= 3,
      ).length,
      businessActive: input.appointments && input.clients ? businessRows.length : null,
      businessTrial: input.appointments && input.clients
        ? businessRows.filter((row) => row.subscriptionStatus === "trialing" && row.trialDaysRemaining > 0).length : null,
      businessPaidActive: input.appointments && input.clients
        ? businessRows.filter((row) => row.subscriptionStatus === "active").length : null,
      businessClients: input.appointments && input.clients
        ? businessRows.reduce((total, row) => total + (row.clients ?? 0), 0) : null,
      businessAttention: input.appointments && input.clients
        ? businessRows.filter((row) =>
          (row.subscriptionStatus === "trialing" && row.trialDaysRemaining <= 3) ||
          ["past_due", "unpaid", "incomplete", "incomplete_expired", "paused"].includes(row.subscriptionStatus),
        ).length : null,
    },
    activity: input.appointments ? { appointments, completed, volumeCents } : null,
    billing: input.billingEvents ? { revenueCents, paidInvoices } : null,
    issues,
  };
}
