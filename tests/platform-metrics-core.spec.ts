import { expect, test } from "@playwright/test";
import {
  buildPlatformMetrics,
  type PlatformMetricsFilters,
  type PlatformMetricsInput,
} from "../src/lib/platform-metrics-core";

const baseFilters: PlatformMetricsFilters = {
  studioId: null,
  preset: "today",
  from: null,
  to: null,
  plan: "all",
  accountStatus: "all",
  subscriptionStatus: "all",
};

function fixture(filters: PlatformMetricsFilters = baseFilters): PlatformMetricsInput {
  return {
    filters,
    now: new Date("2026-07-25T12:00:00.000Z"),
    studios: [
      {
        id: "studio-a",
        name: "Studio A",
        created_at: "2026-07-25T08:00:00.000Z",
        timezone: "Europe/Lisbon",
        is_active: true,
        plan: "pro",
        subscription_status: "active",
        trial_claimed_at: "2026-07-25T08:00:00.000Z",
      },
      {
        id: "studio-b",
        name: "Studio B",
        created_at: "2026-07-20T08:00:00.000Z",
        timezone: "America/New_York",
        is_active: true,
        plan: "pro",
        subscription_status: "active",
        trial_claimed_at: "2026-07-20T08:00:00.000Z",
      },
    ],
    subscriptions: [
      {
        id: "sub-a",
        studio_id: "studio-a",
        plan: "monthly",
        status: "active",
        stripe_customer_id: "cus-a",
        stripe_subscription_id: "stripe-sub-a",
        created_at: "2026-07-25T08:00:00.000Z",
        updated_at: "2026-07-25T08:00:00.000Z",
      },
      {
        id: "sub-b",
        studio_id: "studio-b",
        plan: "yearly",
        status: "active",
        stripe_customer_id: "cus-b",
        stripe_subscription_id: "stripe-sub-b",
        created_at: "2026-07-20T08:00:00.000Z",
        updated_at: "2026-07-20T08:00:00.000Z",
      },
    ],
    appointments: [
      {
        id: "appt-a-completed",
        studio_id: "studio-a",
        status: "completed",
        starts_at: "2026-07-24T23:30:00.000Z",
        created_at: "2026-07-24T22:00:00.000Z",
        total_price: 100,
      },
      {
        id: "appt-a-cancelled",
        studio_id: "studio-a",
        status: "cancelled",
        starts_at: "2026-07-25T10:00:00.000Z",
        created_at: "2026-07-25T08:00:00.000Z",
        total_price: 200,
      },
      {
        id: "appt-b-completed",
        studio_id: "studio-b",
        status: "completed",
        starts_at: "2026-07-25T10:00:00.000Z",
        created_at: "2026-07-25T08:00:00.000Z",
        total_price: 300,
      },
      {
        id: "appt-b-previous-local-day",
        studio_id: "studio-b",
        status: "completed",
        starts_at: "2026-07-25T00:30:00.000Z",
        created_at: "2026-07-25T00:00:00.000Z",
        total_price: 700,
      },
    ],
    clients: [
      { id: "client-a", studio_id: "studio-a", created_at: "2026-07-25T09:00:00.000Z" },
      { id: "client-b", studio_id: "studio-b", created_at: "2026-07-25T09:00:00.000Z" },
    ],
    billingEvents: [
      {
        id: "event-a-paid",
        studio_id: "studio-a",
        event_type: "invoice.paid",
        created_at: "2026-07-25T09:00:00.000Z",
        payload: { data: { object: { id: "invoice-a", amount_paid: 899, currency: "eur" } } },
      },
      {
        id: "event-a-succeeded-duplicate",
        studio_id: "studio-a",
        event_type: "invoice.payment_succeeded",
        created_at: "2026-07-25T09:00:01.000Z",
        payload: { data: { object: { id: "invoice-a", amount_paid: 899, currency: "eur" } } },
      },
      {
        id: "event-b-paid",
        studio_id: "studio-b",
        event_type: "invoice.paid",
        created_at: "2026-07-25T09:00:00.000Z",
        payload: { data: { object: { id: "invoice-b", amount_paid: 8999, currency: "eur" } } },
      },
    ],
    identities: [
      {
        studioId: "studio-a",
        ownerName: "Ana",
        ownerEmail: "ana@example.com",
        lastAccessAt: "2026-07-25T10:00:00.000Z",
      },
      {
        studioId: "studio-b",
        ownerName: "Bruno",
        ownerEmail: "bruno@example.com",
        lastAccessAt: "2026-07-25T10:00:00.000Z",
      },
    ],
  };
}

test("keeps Bellza subscription revenue separate from studio appointment volume", () => {
  const metrics = buildPlatformMetrics(fixture());

  expect(metrics.finances.platformRevenueCents).toBe(9898);
  expect(metrics.finances.studioVolumeCents).toBe(40000);
  expect(metrics.finances.averageAppointmentCents).toBe(20000);
  expect(metrics.appointments.total).toBe(3);
  expect(metrics.appointments.completed).toBe(2);
  expect(metrics.appointments.cancelled).toBe(1);
});

test("deduplicates Stripe invoice events and isolates a selected studio", () => {
  const metrics = buildPlatformMetrics(
    fixture({ ...baseFilters, studioId: "studio-a" }),
  );

  expect(metrics.studios.total).toBe(1);
  expect(metrics.selectedStudio?.name).toBe("Studio A");
  expect(metrics.finances.platformRevenueCents).toBe(899);
  expect(metrics.finances.studioVolumeCents).toBe(10000);
  expect(metrics.appointments.total).toBe(2);
  expect(metrics.clients.total).toBe(1);
  expect(metrics.studioRows).toHaveLength(1);
  expect(metrics.studioRows[0].id).toBe("studio-a");
});

test("uses each studio timezone at day boundaries without mixing local dates", () => {
  const metrics = buildPlatformMetrics(
    fixture({ ...baseFilters, studioId: "studio-a" }),
  );

  expect(metrics.period.timezone).toBe("Europe/Lisbon");
  expect(metrics.period.from).toBe("2026-07-25");
  expect(metrics.appointments.completed).toBe(1);
  expect(metrics.finances.studioVolumeCents).toBe(10000);

  const allStudios = buildPlatformMetrics(fixture());
  expect(allStudios.appointments.total).toBe(3);
  expect(allStudios.finances.studioVolumeCents).toBe(40000);
});

test("applies plan filters before aggregating any studio data", () => {
  const metrics = buildPlatformMetrics(
    fixture({ ...baseFilters, plan: "yearly" }),
  );

  expect(metrics.studios.total).toBe(1);
  expect(metrics.studioRows[0].id).toBe("studio-b");
  expect(metrics.finances.platformRevenueCents).toBe(8999);
  expect(metrics.finances.studioVolumeCents).toBe(30000);
});
