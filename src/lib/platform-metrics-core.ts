import { getStudioDateKey, normalizeStudioTimeZone } from "@/lib/studio-time";

export type MetricsPreset = "today" | "7d" | "30d" | "month" | "year" | "custom";
export type AccountFilter = "all" | "active" | "blocked" | "cancelled";
export type SubscriptionFilter =
  | "all"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled";
export type PlanFilter = "all" | "trial" | "monthly" | "quarterly" | "yearly";

export type PlatformMetricsFilters = {
  studioId: string | null;
  preset: MetricsPreset;
  from: string | null;
  to: string | null;
  plan: PlanFilter;
  accountStatus: AccountFilter;
  subscriptionStatus: SubscriptionFilter;
};

export type PlatformStudioSource = {
  id: string;
  name: string;
  owner_name?: string | null;
  email?: string | null;
  is_active?: boolean | null;
  plan?: string | null;
  subscription_status?: string | null;
  subscription_current_period_end?: string | null;
  trial_ends_at?: string | null;
  trial_claimed_at?: string | null;
  premium_access_until?: string | null;
  timezone?: string | null;
  created_at: string;
};

export type PlatformSubscriptionSource = {
  id: string;
  studio_id: string | null;
  user_id?: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  plan?: string | null;
  status?: string | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean | null;
  created_at: string;
  updated_at: string;
};

export type PlatformAppointmentSource = {
  id: string;
  studio_id: string;
  status: string;
  starts_at: string;
  created_at: string;
  total_price?: number | string | null;
};

export type PlatformClientSource = {
  id: string;
  studio_id: string;
  created_at: string;
};

export type PlatformBillingEventSource = {
  id: string;
  studio_id: string | null;
  resolved_studio_id?: string | null;
  event_type: string;
  created_at: string;
  payload?: unknown;
};

export type PlatformStudioIdentity = {
  studioId: string;
  ownerName: string | null;
  ownerEmail: string | null;
  lastAccessAt: string | null;
};

export type PlatformMetricPoint = {
  key: string;
  label: string;
  studios: number;
  platformRevenueCents: number;
  studioVolumeCents: number;
  appointments: number;
  trials: number;
  conversions: number;
  cancellations: number;
};

export type PlatformStudioRow = {
  id: string;
  name: string;
  ownerName: string;
  email: string;
  createdAt: string;
  lastAccessAt: string | null;
  timezone: string;
  plan: string;
  trialDaysRemaining: number;
  accountStatus: "active" | "blocked" | "cancelled";
  subscriptionStatus: string;
  subscriptionEndsAt: string | null;
  revenueCents: number;
  volumeCents: number;
  appointments: number;
  completedAppointments: number;
  clients: number;
  newClients: number;
};

export type PlatformMetrics = {
  generatedAt: string;
  period: {
    from: string;
    to: string;
    label: string;
    timezone: string;
  };
  selectedStudio: PlatformStudioRow | null;
  studios: {
    total: number;
    active: number;
    blocked: number;
    cancelled: number;
    newInPeriod: number;
    trial: number;
    paidActive: number;
    expired: number;
    subscriptionCancelled: number;
  };
  finances: {
    platformRevenueCents: number;
    studioVolumeCents: number;
    averageAppointmentCents: number;
  };
  appointments: {
    total: number;
    completed: number;
    cancelled: number;
    pending: number;
    noShow: number;
  };
  clients: {
    total: number;
    newInPeriod: number;
  };
  rates: {
    trialConversion: number;
    subscriptionCancellation: number;
  };
  timeline: PlatformMetricPoint[];
  rankings: {
    byVolume: PlatformStudioRow[];
    byAppointments: PlatformStudioRow[];
    lowUsage: PlatformStudioRow[];
    inactive: PlatformStudioRow[];
  };
  studioRows: PlatformStudioRow[];
};

export type PlatformMetricsInput = {
  filters: PlatformMetricsFilters;
  studios: PlatformStudioSource[];
  subscriptions: PlatformSubscriptionSource[];
  appointments: PlatformAppointmentSource[];
  clients: PlatformClientSource[];
  billingEvents: PlatformBillingEventSource[];
  identities: PlatformStudioIdentity[];
  now?: Date;
};

type PaidInvoice = {
  id: string;
  studioId: string | null;
  createdAt: string;
  amountCents: number;
};

function addDays(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function startOfMonth(dateKey: string) {
  return `${dateKey.slice(0, 7)}-01`;
}

function startOfYear(dateKey: string) {
  return `${dateKey.slice(0, 4)}-01-01`;
}

function daysBetween(from: string, to: string) {
  return Math.max(
    0,
    Math.round(
      (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) /
        86400000,
    ),
  );
}

function periodLabel(from: string, to: string) {
  const format = (value: string) =>
    new Intl.DateTimeFormat("pt-PT", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${value}T12:00:00.000Z`));
  return from === to ? format(from) : `${format(from)} – ${format(to)}`;
}

export function resolveMetricsPeriod(
  filters: PlatformMetricsFilters,
  timezone: string,
  now = new Date(),
) {
  const safeTimezone = normalizeStudioTimeZone(timezone);
  const today = getStudioDateKey(now, safeTimezone);
  let from = today;
  let to = today;

  if (filters.preset === "7d") from = addDays(today, -6);
  if (filters.preset === "30d") from = addDays(today, -29);
  if (filters.preset === "month") from = startOfMonth(today);
  if (filters.preset === "year") from = startOfYear(today);
  if (filters.preset === "custom") {
    from = filters.from || today;
    to = filters.to || today;
  }
  if (from > to) [from, to] = [to, from];

  return { from, to, label: periodLabel(from, to), timezone: safeTimezone };
}

function inPeriod(value: string | null | undefined, from: string, to: string, timezone: string) {
  if (!value) return false;
  const key = getStudioDateKey(value, timezone);
  return key >= from && key <= to;
}

function normalizeSubscriptionStatus(value?: string | null) {
  const status = String(value || "trialing").toLowerCase();
  return status === "cancelled" ? "canceled" : status;
}

function accountStatus(
  studio: PlatformStudioSource,
  subscription?: PlatformSubscriptionSource | null,
): PlatformStudioRow["accountStatus"] {
  if (
    normalizeSubscriptionStatus(subscription?.status || studio.subscription_status) === "canceled"
  ) {
    return "cancelled";
  }
  if (studio.is_active === false) return "blocked";
  return "active";
}

function latestSubscriptions(subscriptions: PlatformSubscriptionSource[]) {
  const byStudio = new Map<string, PlatformSubscriptionSource>();
  for (const subscription of subscriptions) {
    if (!subscription.studio_id) continue;
    const previous = byStudio.get(subscription.studio_id);
    if (
      !previous ||
      Date.parse(subscription.updated_at || subscription.created_at) >
        Date.parse(previous.updated_at || previous.created_at)
    ) {
      byStudio.set(subscription.studio_id, subscription);
    }
  }
  return byStudio;
}

function studioPlan(
  studio: PlatformStudioSource,
  subscription?: PlatformSubscriptionSource | null,
) {
  const plan = String(subscription?.plan || studio.plan || "trial").toLowerCase();
  if (["monthly", "quarterly", "yearly"].includes(plan)) return plan;
  return normalizeSubscriptionStatus(studio.subscription_status) === "trialing" ? "trial" : plan;
}

function matchesStudioFilters(
  studio: PlatformStudioSource,
  subscription: PlatformSubscriptionSource | undefined,
  filters: PlatformMetricsFilters,
) {
  if (filters.studioId && studio.id !== filters.studioId) return false;
  if (filters.plan !== "all" && studioPlan(studio, subscription) !== filters.plan) return false;
  if (
    filters.accountStatus !== "all" &&
    accountStatus(studio, subscription) !== filters.accountStatus
  ) {
    return false;
  }
  const status = normalizeSubscriptionStatus(
    subscription?.status || studio.subscription_status,
  );
  if (filters.subscriptionStatus === "past_due") {
    return ["past_due", "unpaid", "incomplete", "incomplete_expired", "paused"].includes(status);
  }
  return filters.subscriptionStatus === "all" || status === filters.subscriptionStatus;
}

function objectFromPayload(payload: unknown): Record<string, any> | null {
  if (!payload || typeof payload !== "object") return null;
  const event = payload as Record<string, any>;
  const object = event.data?.object;
  return object && typeof object === "object" ? object : null;
}

function paidInvoices(events: PlatformBillingEventSource[]): PaidInvoice[] {
  const invoices = new Map<string, PaidInvoice>();
  for (const event of events) {
    if (!["invoice.paid", "invoice.payment_succeeded"].includes(event.event_type)) continue;
    const object = objectFromPayload(event.payload);
    if (!object) continue;
    const id = String(object.id || event.id);
    if (invoices.has(id)) continue;
    const amountCents = Math.max(0, Number(object.amount_paid || 0));
    if (amountCents <= 0 || (object.currency && String(object.currency).toLowerCase() !== "eur")) {
      continue;
    }
    invoices.set(id, {
      id,
      studioId:
        event.resolved_studio_id ||
        event.studio_id ||
        object.metadata?.studio_id ||
        object.subscription_details?.metadata?.studio_id ||
        null,
      createdAt: event.created_at,
      amountCents,
    });
  }
  return [...invoices.values()];
}

function cancellationEvents(events: PlatformBillingEventSource[]) {
  const cancellations = new Map<string, { studioId: string | null; createdAt: string }>();
  for (const event of events) {
    if (event.event_type !== "customer.subscription.deleted") continue;
    const object = objectFromPayload(event.payload);
    const id = String(object?.id || event.id);
    if (cancellations.has(id)) continue;
    cancellations.set(id, {
      studioId:
        event.resolved_studio_id ||
        event.studio_id ||
        object?.metadata?.studio_id ||
        null,
      createdAt: event.created_at,
    });
  }
  return [...cancellations.values()];
}

function bucketKeys(from: string, to: string) {
  const span = daysBetween(from, to);
  if (span <= 31) {
    const keys: { key: string; label: string; from: string; to: string }[] = [];
    for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) {
      keys.push({
        key: cursor,
        label: new Intl.DateTimeFormat("pt-PT", {
          day: "2-digit",
          month: "short",
          timeZone: "UTC",
        }).format(new Date(`${cursor}T12:00:00.000Z`)),
        from: cursor,
        to: cursor,
      });
    }
    return keys;
  }

  if (span <= 180) {
    const keys: { key: string; label: string; from: string; to: string }[] = [];
    for (let cursor = from, index = 1; cursor <= to; cursor = addDays(cursor, 7), index += 1) {
      const bucketTo = [addDays(cursor, 6), to].sort()[0];
      keys.push({ key: cursor, label: `Sem. ${index}`, from: cursor, to: bucketTo });
    }
    return keys;
  }

  const keys: { key: string; label: string; from: string; to: string }[] = [];
  let cursor = startOfMonth(from);
  while (cursor <= to) {
    const [year, month] = cursor.split("-").map(Number);
    const nextMonth = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
    const bucketFrom = cursor < from ? from : cursor;
    const bucketTo = addDays(nextMonth, -1) > to ? to : addDays(nextMonth, -1);
    keys.push({
      key: cursor.slice(0, 7),
      label: new Intl.DateTimeFormat("pt-PT", {
        month: "short",
        year: "2-digit",
        timeZone: "UTC",
      }).format(new Date(`${cursor}T12:00:00.000Z`)),
      from: bucketFrom,
      to: bucketTo,
    });
    cursor = nextMonth;
  }
  return keys;
}

function withinBucket(
  value: string | null | undefined,
  bucket: { from: string; to: string },
  timezone: string,
) {
  return inPeriod(value, bucket.from, bucket.to, timezone);
}

function safePercent(numerator: number, denominator: number) {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}

function trialDaysRemaining(studio: PlatformStudioSource, now: Date) {
  if (!studio.trial_ends_at) return 0;
  return Math.max(0, Math.ceil((Date.parse(studio.trial_ends_at) - now.getTime()) / 86400000));
}

export function buildPlatformMetrics(input: PlatformMetricsInput): PlatformMetrics {
  const now = input.now ?? new Date();
  const latestByStudio = latestSubscriptions(input.subscriptions);
  const selectedTimezone =
    input.studios.find((studio) => studio.id === input.filters.studioId)?.timezone ||
    "Europe/Lisbon";
  const period = resolveMetricsPeriod(input.filters, selectedTimezone, now);
  const scopedStudios = input.studios.filter((studio) =>
    matchesStudioFilters(studio, latestByStudio.get(studio.id), input.filters),
  );
  const studioIds = new Set(scopedStudios.map((studio) => studio.id));
  const timezoneByStudio = new Map(
    scopedStudios.map((studio) => [studio.id, normalizeStudioTimeZone(studio.timezone)]),
  );
  const timezoneForStudio = (studioId: string | null | undefined) =>
    (studioId && timezoneByStudio.get(studioId)) || period.timezone;
  const identities = new Map(input.identities.map((identity) => [identity.studioId, identity]));
  const invoices = paidInvoices(input.billingEvents);
  const cancellations = cancellationEvents(input.billingEvents);

  const periodAppointments = input.appointments.filter(
    (appointment) =>
      studioIds.has(appointment.studio_id) &&
      inPeriod(
        appointment.starts_at,
        period.from,
        period.to,
        timezoneForStudio(appointment.studio_id),
      ),
  );
  const scopedClients = input.clients.filter((client) => studioIds.has(client.studio_id));
  const periodInvoices = invoices.filter(
    (invoice) =>
      !!invoice.studioId &&
      studioIds.has(invoice.studioId) &&
      inPeriod(invoice.createdAt, period.from, period.to, timezoneForStudio(invoice.studioId)),
  );

  const studioRows: PlatformStudioRow[] = scopedStudios.map((studio) => {
    const subscription = latestByStudio.get(studio.id);
    const identity = identities.get(studio.id);
    const studioAppointments = periodAppointments.filter(
      (appointment) => appointment.studio_id === studio.id,
    );
    const completed = studioAppointments.filter(
      (appointment) => appointment.status === "completed",
    );
    const studioClients = scopedClients.filter((client) => client.studio_id === studio.id);
    return {
      id: studio.id,
      name: studio.name,
      ownerName: identity?.ownerName || studio.owner_name || "Não informado",
      email: identity?.ownerEmail || studio.email || "Não informado",
      createdAt: studio.created_at,
      lastAccessAt: identity?.lastAccessAt || null,
      timezone: normalizeStudioTimeZone(studio.timezone),
      plan: studioPlan(studio, subscription),
      trialDaysRemaining: trialDaysRemaining(studio, now),
      accountStatus: accountStatus(studio, subscription),
      subscriptionStatus: normalizeSubscriptionStatus(
        subscription?.status || studio.subscription_status,
      ),
      subscriptionEndsAt:
        subscription?.current_period_end ||
        studio.subscription_current_period_end ||
        studio.trial_ends_at ||
        null,
      revenueCents: periodInvoices
        .filter((invoice) => invoice.studioId === studio.id)
        .reduce((total, invoice) => total + invoice.amountCents, 0),
      volumeCents: completed.reduce(
        (total, appointment) => total + Math.round(Number(appointment.total_price || 0) * 100),
        0,
      ),
      appointments: studioAppointments.length,
      completedAppointments: completed.length,
      clients: studioClients.length,
      newClients: studioClients.filter((client) =>
        inPeriod(client.created_at, period.from, period.to, timezoneForStudio(studio.id)),
      ).length,
    };
  });

  const completedAppointments = periodAppointments.filter(
    (appointment) => appointment.status === "completed",
  );
  const studioVolumeCents = studioRows.reduce((total, studio) => total + studio.volumeCents, 0);
  const trialsInPeriod = scopedStudios.filter((studio) =>
    inPeriod(
      studio.trial_claimed_at || studio.created_at,
      period.from,
      period.to,
      timezoneForStudio(studio.id),
    ),
  );
  const paidStudioIds = new Set(
    invoices
      .filter((invoice) => invoice.studioId && studioIds.has(invoice.studioId))
      .map((invoice) => invoice.studioId as string),
  );
  const convertedTrials = trialsInPeriod.filter((studio) => paidStudioIds.has(studio.id));
  const periodCancellations = cancellations.filter(
    (event) =>
      !!event.studioId &&
      studioIds.has(event.studioId) &&
      inPeriod(event.createdAt, period.from, period.to, timezoneForStudio(event.studioId)),
  );
  const currentSubscriptionStatus = (studio: PlatformStudioSource) =>
    normalizeSubscriptionStatus(
      latestByStudio.get(studio.id)?.status || studio.subscription_status,
    );
  const paidActive = scopedStudios.filter(
    (studio) => currentSubscriptionStatus(studio) === "active",
  ).length;

  const buckets = bucketKeys(period.from, period.to);
  const timeline = buckets.map((bucket): PlatformMetricPoint => {
    const bucketTrials = scopedStudios.filter((studio) =>
      withinBucket(
        studio.trial_claimed_at || studio.created_at,
        bucket,
        timezoneForStudio(studio.id),
      ),
    );
    return {
      key: bucket.key,
      label: bucket.label,
      studios: scopedStudios.filter((studio) =>
        withinBucket(studio.created_at, bucket, timezoneForStudio(studio.id)),
      ).length,
      platformRevenueCents: periodInvoices
        .filter((invoice) =>
          withinBucket(invoice.createdAt, bucket, timezoneForStudio(invoice.studioId)),
        )
        .reduce((total, invoice) => total + invoice.amountCents, 0),
      studioVolumeCents: completedAppointments
        .filter((appointment) =>
          withinBucket(
            appointment.starts_at,
            bucket,
            timezoneForStudio(appointment.studio_id),
          ),
        )
        .reduce(
          (total, appointment) =>
            total + Math.round(Number(appointment.total_price || 0) * 100),
          0,
        ),
      appointments: periodAppointments.filter((appointment) =>
        withinBucket(
          appointment.starts_at,
          bucket,
          timezoneForStudio(appointment.studio_id),
        ),
      ).length,
      trials: bucketTrials.length,
      conversions: bucketTrials.filter((studio) => paidStudioIds.has(studio.id)).length,
      cancellations: periodCancellations.filter((event) =>
        withinBucket(event.createdAt, bucket, timezoneForStudio(event.studioId)),
      ).length,
    };
  });

  const inactiveThreshold = now.getTime() - 30 * 86400000;
  const byVolume = [...studioRows].sort((a, b) => b.volumeCents - a.volumeCents).slice(0, 10);
  const byAppointments = [...studioRows]
    .sort((a, b) => b.appointments - a.appointments)
    .slice(0, 10);
  const lowUsage = studioRows
    .filter((studio) => studio.appointments <= 2)
    .sort((a, b) => a.appointments - b.appointments || a.name.localeCompare(b.name))
    .slice(0, 15);
  const inactive = studioRows
    .filter(
      (studio) =>
        !studio.lastAccessAt || Date.parse(studio.lastAccessAt) < inactiveThreshold,
    )
    .sort(
      (a, b) =>
        Date.parse(a.lastAccessAt || "1970-01-01") -
        Date.parse(b.lastAccessAt || "1970-01-01"),
    )
    .slice(0, 15);

  const selectedStudio =
    input.filters.studioId
      ? studioRows.find((studio) => studio.id === input.filters.studioId) || null
      : null;

  return {
    generatedAt: now.toISOString(),
    period,
    selectedStudio,
    studios: {
      total: scopedStudios.length,
      active: scopedStudios.filter(
        (studio) => accountStatus(studio, latestByStudio.get(studio.id)) === "active",
      ).length,
      blocked: scopedStudios.filter(
        (studio) => accountStatus(studio, latestByStudio.get(studio.id)) === "blocked",
      ).length,
      cancelled: scopedStudios.filter(
        (studio) => accountStatus(studio, latestByStudio.get(studio.id)) === "cancelled",
      ).length,
      newInPeriod: scopedStudios.filter((studio) =>
        inPeriod(
          studio.created_at,
          period.from,
          period.to,
          timezoneForStudio(studio.id),
        ),
      ).length,
      trial: scopedStudios.filter(
        (studio) => currentSubscriptionStatus(studio) === "trialing",
      ).length,
      paidActive,
      expired: scopedStudios.filter((studio) =>
        ["past_due", "unpaid", "incomplete", "incomplete_expired", "paused"].includes(
          currentSubscriptionStatus(studio),
        ),
      ).length,
      subscriptionCancelled: scopedStudios.filter(
        (studio) => currentSubscriptionStatus(studio) === "canceled",
      ).length,
    },
    finances: {
      platformRevenueCents: periodInvoices.reduce(
        (total, invoice) => total + invoice.amountCents,
        0,
      ),
      studioVolumeCents,
      averageAppointmentCents:
        completedAppointments.length > 0
          ? Math.round(studioVolumeCents / completedAppointments.length)
          : 0,
    },
    appointments: {
      total: periodAppointments.length,
      completed: completedAppointments.length,
      cancelled: periodAppointments.filter((appointment) => appointment.status === "cancelled")
        .length,
      pending: periodAppointments.filter((appointment) =>
        ["pending", "confirmed"].includes(appointment.status),
      ).length,
      noShow: periodAppointments.filter((appointment) => appointment.status === "no_show").length,
    },
    clients: {
      total: scopedClients.length,
      newInPeriod: scopedClients.filter((client) =>
        inPeriod(
          client.created_at,
          period.from,
          period.to,
          timezoneForStudio(client.studio_id),
        ),
      ).length,
    },
    rates: {
      trialConversion: safePercent(convertedTrials.length, trialsInPeriod.length),
      subscriptionCancellation: safePercent(
        periodCancellations.length,
        paidActive + periodCancellations.length,
      ),
    },
    timeline,
    rankings: { byVolume, byAppointments, lowUsage, inactive },
    studioRows,
  };
}
