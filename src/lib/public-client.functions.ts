import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getAdminClient } from "@/lib/supabase-admin.server";

const PublicClientInput = z.object({
  studioId: z.string().uuid(),
});

type AppointmentRow = {
  id: string;
  public_token: string | null;
  starts_at: string;
  ends_at: string | null;
  status: string;
  total_price: number | null;
  clients: { id: string; name: string; phone: string; email: string | null } | null;
  staff: { name: string | null } | null;
};

type PaymentRow = {
  appointment_id: string | null;
  booking_request_id: string | null;
  amount_cents: number | null;
  status: string | null;
  method: string | null;
};

export const getPublicClientArea = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => PublicClientInput.parse(input))
  .handler(async ({ data, context }) => {
    const email = String((context as any).claims?.email ?? "").trim().toLowerCase();
    if (!email) {
      return emptyPayload(null);
    }

    const sb = getAdminClient();
    const { data: studio, error: studioError } = await sb
      .from("studios")
      .select("id,name,slug")
      .eq("id", data.studioId)
      .eq("is_active", true)
      .maybeSingle();
    if (studioError) throw new Error(studioError.message);
    if (!studio) throw new Response("studio_not_found", { status: 404 });

    const { data: clients, error: clientError } = await sb
      .from("clients")
      .select("id,name,phone,email,total_spent,total_visits,updated_at")
      .eq("studio_id", data.studioId)
      .ilike("email", email);
    if (clientError) throw new Error(clientError.message);

    const clientIds = (clients ?? []).map((client: any) => client.id);
    const latestClient = [...(clients ?? [])].sort((a: any, b: any) =>
      String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")),
    )[0];

    const profile = {
      name: latestClient?.name ?? inferName((context as any).claims),
      phone: latestClient?.phone ?? "",
      email,
      avatarUrl: inferAvatarUrl((context as any).claims),
      totalVisits: Number(latestClient?.total_visits ?? 0),
      totalSpent: Number(latestClient?.total_spent ?? 0),
    };

    if (clientIds.length === 0) {
      return {
        profile,
        appointments: [],
        pendingPayments: [],
        totals: { paid: 0, deposits: 0, pending: 0 },
      };
    }

    const { data: appointments, error: appointmentError } = await sb
      .from("appointments")
      .select(
        "id,public_token,starts_at,ends_at,status,total_price,clients(id,name,phone,email),staff(name)",
      )
      .eq("studio_id", data.studioId)
      .in("client_id", clientIds)
      .order("starts_at", { ascending: false })
      .limit(40);
    if (appointmentError) throw new Error(appointmentError.message);

    const appointmentRows = ((appointments ?? []) as any[]).map(normalizeAppointmentRow);
    const appointmentIds = appointmentRows.map((appointment) => appointment.id);
    const [servicesByAppointment, payments] = await Promise.all([
      loadServicesByAppointment(sb, appointmentIds),
      loadPayments(sb, data.studioId, appointmentIds),
    ]);

    const paymentMap = new Map<string, PaymentRow[]>();
    for (const payment of payments) {
      if (!payment.appointment_id) continue;
      const current = paymentMap.get(payment.appointment_id) ?? [];
      current.push(payment);
      paymentMap.set(payment.appointment_id, current);
    }

    const now = Date.now();
    const normalizedAppointments = appointmentRows.map((appointment) => {
      const appointmentPayments = paymentMap.get(appointment.id) ?? [];
      const paidCents = appointmentPayments
        .filter((payment) => payment.status === "succeeded")
        .reduce((sum, payment) => sum + Number(payment.amount_cents ?? 0), 0);
      const pendingCents = appointmentPayments
        .filter((payment) => ["pending", "processing"].includes(String(payment.status ?? "")))
        .reduce((sum, payment) => sum + Number(payment.amount_cents ?? 0), 0);
      return {
        id: appointment.id,
        token: appointment.public_token,
        startsAt: appointment.starts_at,
        endsAt: appointment.ends_at,
        status: appointment.status,
        totalPrice: Number(appointment.total_price ?? 0),
        paidAmount: paidCents / 100,
        pendingAmount: pendingCents / 100,
        staffName: appointment.staff?.name ?? "Profissional",
        services: servicesByAppointment.get(appointment.id) ?? [],
        canOpen: Boolean(appointment.public_token),
        isUpcoming: new Date(appointment.starts_at).getTime() >= now,
      };
    });

    const pendingPayments = payments
      .filter((payment) => ["pending", "processing"].includes(String(payment.status ?? "")))
      .map((payment) => ({
        appointmentId: payment.appointment_id,
        bookingRequestId: payment.booking_request_id,
        amount: Number(payment.amount_cents ?? 0) / 100,
        method: payment.method ?? "card",
        status: payment.status ?? "pending",
      }));

    const totals = payments.reduce(
      (acc, payment) => {
        const amount = Number(payment.amount_cents ?? 0) / 100;
        if (payment.status === "succeeded") {
          acc.paid += amount;
          acc.deposits += amount;
        }
        if (["pending", "processing"].includes(String(payment.status ?? ""))) acc.pending += amount;
        return acc;
      },
      { paid: 0, deposits: 0, pending: 0 },
    );

    return {
      profile,
      appointments: normalizedAppointments,
      pendingPayments,
      totals,
    };
  });

function emptyPayload(email: string | null) {
  return {
    profile: { name: "", phone: "", email: email ?? "", avatarUrl: null, totalVisits: 0, totalSpent: 0 },
    appointments: [],
    pendingPayments: [],
    totals: { paid: 0, deposits: 0, pending: 0 },
  };
}

function normalizeAppointmentRow(row: any): AppointmentRow {
  return {
    ...row,
    clients: Array.isArray(row.clients) ? row.clients[0] ?? null : row.clients ?? null,
    staff: Array.isArray(row.staff) ? row.staff[0] ?? null : row.staff ?? null,
  };
}

function inferName(claims: Record<string, unknown>) {
  const metadata = (claims.user_metadata ?? claims.raw_user_meta_data ?? {}) as Record<string, unknown>;
  return String(metadata.full_name ?? metadata.name ?? "").trim();
}

function inferAvatarUrl(claims: Record<string, unknown>) {
  const metadata = (claims.user_metadata ?? claims.raw_user_meta_data ?? {}) as Record<string, unknown>;
  const value = metadata.avatar_url ?? metadata.picture;
  return typeof value === "string" && /^https?:\/\//.test(value) ? value : null;
}

async function loadServicesByAppointment(sb: any, appointmentIds: string[]) {
  const result = new Map<string, { name: string; price: number; durationMin: number }[]>();
  if (appointmentIds.length === 0) return result;
  const { data } = await sb
    .from("appointment_services")
    .select("appointment_id,price,duration_min,services(name)")
    .in("appointment_id", appointmentIds);
  for (const row of data ?? []) {
    const current = result.get(row.appointment_id) ?? [];
    current.push({
      name: row.services?.name ?? "Serviço",
      price: Number(row.price ?? 0),
      durationMin: Number(row.duration_min ?? 0),
    });
    result.set(row.appointment_id, current);
  }
  return result;
}

async function loadPayments(sb: any, studioId: string, appointmentIds: string[]) {
  if (appointmentIds.length === 0) return [] as PaymentRow[];
  const { data, error } = await sb
    .from("payment_intents")
    .select("appointment_id,booking_request_id,amount_cents,status,method")
    .eq("studio_id", studioId)
    .in("appointment_id", appointmentIds);
  if (error) throw new Error(error.message);
  return (data ?? []) as PaymentRow[];
}
