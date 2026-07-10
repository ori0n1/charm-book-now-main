import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sortAppointmentsChronologically } from "@/lib/appointment-ordering";
import { loadCustomerLoyaltySummaryForClient } from "@/lib/customer-loyalty.functions";
import { canAttachAppointmentClientToSession, normalizePublicClientEmail } from "@/lib/public-client-identity";
import { getAdminClient } from "@/lib/supabase-admin.server";
import { sendWebPush } from "@/lib/web-push.server";

const PublicClientInput = z.object({
  studioId: z.string().uuid(),
});

const PUBLIC_CLIENT_SELECT =
  "id,name,phone,email,avatar_url,date_of_birth,auth_user_id,account_kind,contact_consent_at,contact_consent_version,policy_accepted_at,policy_version,total_visits,total_spent,updated_at";

const PublicNotificationReadInput = z.object({
  studioId: z.string().uuid(),
  notificationId: z.string().uuid(),
});

const FinalizePublicClientBookingInput = z.object({
  studioId: z.string().uuid(),
  appointmentId: z.string().uuid().optional().nullable(),
  bookingRequestId: z.string().uuid().optional().nullable(),
});

const EnsurePublicClientProfileInput = z.object({
  studioId: z.string().uuid(),
  name: z.string().trim().min(2).optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().email().optional(),
  avatarUrl: z.string().trim().url().optional().nullable(),
  dateOfBirth: z.string().trim().optional().nullable(),
  contactConsent: z.boolean().optional(),
  policyAccepted: z.boolean().optional(),
  policyVersion: z.string().trim().optional().nullable(),
});

type AppointmentRow = {
  id: string;
  studio_id?: string | null;
  public_token: string | null;
  starts_at: string;
  ends_at: string | null;
  status: string;
  total_price: number | null;
  clients: { id: string; name: string; phone: string; email: string | null; auth_user_id?: string | null } | null;
  staff: { name: string | null } | null;
};

type PaymentRow = {
  appointment_id: string | null;
  booking_request_id: string | null;
  amount_cents: number | null;
  status: string | null;
  method: string | null;
};

type ClientNotificationRow = {
  id: string;
  kind: string;
  payload: Record<string, unknown> | null;
  status: string;
  created_at: string;
};

export const ensurePublicClientProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => EnsurePublicClientProfileInput.parse(input))
  .handler(async ({ data, context }) => {
    const claims = (context as any).claims as Record<string, any>;
    const userId = String((context as any).userId ?? claims?.sub ?? "").trim();
    const email = String(data.email ?? claims?.email ?? "").trim().toLowerCase();
    const inferredName = inferName(claims);
    const name = String(data.name ?? inferredName ?? email.split("@")[0] ?? "").trim();
    const phone = normalizePhone(data.phone ?? inferPhone(claims));
    const storedPhone = phone || existingAccountPhone(userId);
    const avatarUrl = data.avatarUrl ?? inferAvatarUrl(claims);
    const hasDateOfBirthInput = Object.prototype.hasOwnProperty.call(data, "dateOfBirth");
    const dateOfBirth = hasDateOfBirthInput
      ? normalizeDateOfBirth(data.dateOfBirth)
      : normalizeDateOfBirth(inferDateOfBirth(claims));

    if (!userId) throw new Response("public_client_auth_missing", { status: 401 });
    if (!email) throw new Error("public_client_email_missing");
    if (name.length < 2) throw new Error("public_client_name_missing");

    const sb = getAdminClient();
    const { data: studio, error: studioError } = await sb
      .from("studios")
      .select("id")
      .eq("id", data.studioId)
      .eq("is_active", true)
      .maybeSingle();
    if (studioError) throw new Error(studioError.message);
    if (!studio) throw new Response("studio_not_found", { status: 404 });

    const { data: byUserRows, error: byUserError } = await sb
      .from("clients")
      .select(PUBLIC_CLIENT_SELECT)
      .eq("studio_id", data.studioId)
      .eq("auth_user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(20);
    if (byUserError) throw new Error(byUserError.message);
    const existing = chooseCanonicalPublicClient(byUserRows ?? [], {
      sessionEmail: email,
      phone: storedPhone,
    }) ?? (await findAttachableLegacyClient(sb, {
      studioId: data.studioId,
      sessionEmail: email,
      phone: storedPhone,
    }));

    const now = new Date().toISOString();
    const policyVersion = String(data.policyVersion ?? "").trim() || null;
    const payload = {
      studio_id: data.studioId,
      name,
      phone: phone || existing?.phone || storedPhone,
      email,
      avatar_url: avatarUrl ?? existing?.avatar_url ?? null,
      date_of_birth: dateOfBirth ?? (hasDateOfBirthInput ? null : existing?.date_of_birth ?? null),
      auth_user_id: userId,
      account_kind: "account",
      ...(data.contactConsent
        ? { contact_consent_at: existing?.contact_consent_at ?? now, contact_consent_version: "booking-v1" }
        : {}),
      ...(data.policyAccepted && policyVersion
        ? { policy_accepted_at: now, policy_version: policyVersion }
        : {}),
      updated_at: now,
    };

    if (!payload.phone) {
      if (existing?.id && (avatarUrl || hasDateOfBirthInput || dateOfBirth)) {
        await sb
          .from("clients")
          .update({
            ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
            ...(dateOfBirth ? { date_of_birth: dateOfBirth } : {}),
            ...(hasDateOfBirthInput && !dateOfBirth ? { date_of_birth: null } : {}),
            ...(data.contactConsent
              ? { contact_consent_at: existing.contact_consent_at ?? now, contact_consent_version: "booking-v1" }
              : {}),
            ...(data.policyAccepted && policyVersion
              ? { policy_accepted_at: now, policy_version: policyVersion }
              : {}),
            auth_user_id: userId,
            account_kind: "account",
            updated_at: payload.updated_at,
          })
          .eq("id", existing.id)
          .eq("studio_id", data.studioId);
      }
      return {
        profile: {
          id: existing?.id ?? null,
          name,
          phone: "",
          email,
          avatarUrl,
          dateOfBirth: dateOfBirth ?? existing?.date_of_birth ?? null,
          accountKind: "account",
          needsPhone: true,
        },
      };
    }

    const query = existing?.id
      ? sb.from("clients").update(payload).eq("id", existing.id).select("id,name,phone,email,avatar_url,date_of_birth,account_kind,contact_consent_at,contact_consent_version,policy_accepted_at,policy_version").single()
      : sb.from("clients").insert(payload).select("id,name,phone,email,avatar_url,date_of_birth,account_kind,contact_consent_at,contact_consent_version,policy_accepted_at,policy_version").single();

    const { data: client, error } = await query;
    if (error) throw new Error(error.message);

    return {
      profile: {
        id: client.id,
        name: client.name,
        phone: publicPhone(client.phone),
        email: client.email,
        avatarUrl: client.avatar_url,
        dateOfBirth: client.date_of_birth,
        accountKind: client.account_kind,
        contactConsentAt: client.contact_consent_at,
        contactConsentVersion: client.contact_consent_version,
        policyAcceptedAt: client.policy_accepted_at,
        policyVersion: client.policy_version,
        needsPhone: !publicPhone(client.phone),
      },
    };
  });

export const getPublicClientArea = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => PublicClientInput.parse(input))
  .handler(async ({ data, context }) => {
    const userId = String((context as any).userId ?? "").trim();
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

    await attachLegacyClientsByVerifiedEmail(sb, {
      studioId: data.studioId,
      userId,
      email,
    });

    const { data: clientsByUser, error: clientsByUserError } = userId
      ? await sb
          .from("clients")
          .select("id,name,phone,email,avatar_url,date_of_birth,total_spent,total_visits,updated_at,contact_consent_at,contact_consent_version,policy_accepted_at,policy_version")
          .eq("studio_id", data.studioId)
          .eq("auth_user_id", userId)
      : { data: [], error: null };
    if (clientsByUserError) throw new Error(clientsByUserError.message);

    const clientMap = new Map<string, any>();
    for (const client of clientsByUser ?? []) {
      clientMap.set(client.id, client);
    }
    const clients = Array.from(clientMap.values());

    const clientIds = (clients ?? []).map((client: any) => client.id);
    const latestClient = chooseCanonicalPublicClient(clients ?? [], {
      sessionEmail: email,
    });

    const inferredAvatarUrl = inferAvatarUrl((context as any).claims);
    if (latestClient?.id && inferredAvatarUrl && latestClient.avatar_url !== inferredAvatarUrl) {
      await sb
        .from("clients")
        .update({ avatar_url: inferredAvatarUrl, updated_at: new Date().toISOString() })
        .eq("id", latestClient.id)
        .eq("studio_id", data.studioId);
      latestClient.avatar_url = inferredAvatarUrl;
    }

    const profile = {
      name: latestClient?.name ?? inferName((context as any).claims),
      phone: publicPhone(latestClient?.phone),
      email,
      avatarUrl: latestClient?.avatar_url ?? inferredAvatarUrl,
      dateOfBirth: latestClient?.date_of_birth ?? null,
      contactConsentAt: latestClient?.contact_consent_at ?? null,
      contactConsentVersion: latestClient?.contact_consent_version ?? null,
      policyAcceptedAt: latestClient?.policy_accepted_at ?? null,
      policyVersion: latestClient?.policy_version ?? null,
      totalVisits: Number(latestClient?.total_visits ?? 0),
      totalSpent: Number(latestClient?.total_spent ?? 0),
    };

    if (clientIds.length === 0) {
      return {
        profile,
        appointments: [],
        pendingPayments: [],
        totals: { paid: 0, deposits: 0, pending: 0 },
        loyalty: null,
        notifications: await loadClientNotifications(sb, data.studioId, userId),
      };
    }

    const { data: appointments, error: appointmentError } = await sb
      .from("appointments")
      .select(
        "id,public_token,starts_at,ends_at,status,total_price,clients(id,name,phone,email),staff(name)",
      )
      .eq("studio_id", data.studioId)
      .in("client_id", clientIds)
      .order("starts_at", { ascending: true });
    if (appointmentError) throw new Error(appointmentError.message);

    const appointmentRows = ((appointments ?? []) as any[]).map(normalizeAppointmentRow);
    const appointmentIds = appointmentRows.map((appointment) => appointment.id);
    const [servicesByAppointment, payments, reviewedAppointmentIds] = await Promise.all([
      loadServicesByAppointment(sb, appointmentIds),
      loadPayments(sb, data.studioId, appointmentIds),
      loadReviewedAppointmentIds(sb, userId, appointmentIds),
    ]);

    const paymentMap = new Map<string, PaymentRow[]>();
    for (const payment of payments) {
      if (!payment.appointment_id) continue;
      const current = paymentMap.get(payment.appointment_id) ?? [];
      current.push(payment);
      paymentMap.set(payment.appointment_id, current);
    }

    const now = Date.now();
    const normalizedAppointments = sortAppointmentsChronologically(appointmentRows.map((appointment) => {
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
        // Upcoming = appointment hasn't ended yet (or hasn't started if no end time)
        isUpcoming: new Date(appointment.ends_at ?? appointment.starts_at).getTime() >= now,
      };
    }), "future");

    const pendingPayments = payments
      .filter((payment) => ["pending", "processing"].includes(String(payment.status ?? "")))
      .map((payment) => ({
        appointmentId: payment.appointment_id,
        bookingRequestId: payment.booking_request_id,
        amount: Number(payment.amount_cents ?? 0) / 100,
        method: payment.method ?? "card",
        status: payment.status ?? "pending",
      }));

    // Compute totals from normalised appointments so deposit vs. full-payment
    // distinction is derived from paidAmount vs totalPrice, not a missing type field.
    const totals = normalizedAppointments.reduce(
      (acc, appt) => {
        acc.paid += appt.paidAmount;
        // A "sinal" (deposit) is a partial payment: paid > 0 but less than total
        if (appt.paidAmount > 0 && appt.totalPrice > 0 && appt.paidAmount < appt.totalPrice) {
          acc.deposits += appt.paidAmount;
        }
        acc.pending += appt.pendingAmount;
        return acc;
      },
      { paid: 0, deposits: 0, pending: 0 },
    );

    await ensureClientDerivedNotifications(sb, {
      studioId: data.studioId,
      userId,
      appointments: normalizedAppointments,
      reviewedAppointmentIds,
    });

    return {
      profile,
      appointments: normalizedAppointments,
      pendingPayments,
      totals,
      loyalty: await loadCustomerLoyaltySummaryForClient({
        studioId: data.studioId,
        studioSlug: studio.slug,
        clientId: latestClient?.id ?? clientIds[0] ?? null,
      }),
      reviewedAppointmentIds,
      notifications: await loadClientNotifications(sb, data.studioId, userId),
    };
  });

export const finalizePublicClientBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => FinalizePublicClientBookingInput.parse(input))
  .handler(async ({ data, context }) => {
    const userId = String((context as any).userId ?? "").trim();
    const email = String((context as any).claims?.email ?? "").trim().toLowerCase();
    if (!userId) throw new Response("public_client_auth_missing", { status: 401 });

    const sb = getAdminClient();
    let appointmentId = data.appointmentId ?? null;

    if (!appointmentId && data.bookingRequestId) {
      const { data: bookingRequest, error } = await (sb as any)
        .from("booking_payment_requests")
        .select("appointment_id,studio_id")
        .eq("id", data.bookingRequestId)
        .eq("studio_id", data.studioId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      appointmentId = bookingRequest?.appointment_id ?? null;
    }

    if (!appointmentId) return { ok: true, appointmentId: null };

    const { data: appointment, error: appointmentError } = await sb
      .from("appointments")
      .select("id,studio_id,client_id,clients(id,auth_user_id,email)")
      .eq("id", appointmentId)
      .eq("studio_id", data.studioId)
      .maybeSingle();
    if (appointmentError) throw new Error(appointmentError.message);
    if (!appointment?.client_id) return { ok: true, appointmentId };

    const clientRecord = Array.isArray((appointment as any).clients)
      ? (appointment as any).clients[0]
      : (appointment as any).clients;
    const currentAuthUserId = String(clientRecord?.auth_user_id ?? "").trim();
    const canAttachToSession = canAttachAppointmentClientToSession({
      currentAuthUserId,
      clientEmail: clientRecord?.email,
      sessionUserId: userId,
      sessionEmail: email,
    });

    if (canAttachToSession) {
      const { error: clientError } = await sb
        .from("clients")
        .update({
          auth_user_id: userId,
          account_kind: "account",
          ...(email && !clientRecord?.email ? { email } : {}),
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", appointment.client_id)
        .eq("studio_id", data.studioId);
      if (clientError) throw new Error(clientError.message);
    } else {
      console.warn("[public-client] booking_link_rejected", {
        studio_id: data.studioId,
        appointment_id: appointmentId,
        user_id: userId,
        reason: currentAuthUserId && currentAuthUserId !== userId ? "client_already_linked" : "email_mismatch",
      });
    }

    const created = await ensureClientNotificationsForAppointment(sb, {
      studioId: data.studioId,
      userId,
      appointmentId,
    });
    console.info("[notifications] client_booking_finalized", {
      studio_id: data.studioId,
      appointment_id: appointmentId,
      user_id: userId,
      notifications_created: created,
    });

    return { ok: true, appointmentId };
  });

async function findAttachableLegacyClient(
  sb: any,
  input: { studioId: string; sessionEmail: string; phone?: string | null },
) {
  if (input.sessionEmail) {
    const { data, error } = await sb
      .from("clients")
      .select(PUBLIC_CLIENT_SELECT)
      .eq("studio_id", input.studioId)
      .is("auth_user_id", null)
      .ilike("email", input.sessionEmail)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data?.id) return data;
  }

  const phone = publicPhone(input.phone);
  if (!phone) return null;

  const { data, error } = await sb
    .from("clients")
    .select(PUBLIC_CLIENT_SELECT)
    .eq("studio_id", input.studioId)
    .eq("phone", phone)
    .is("auth_user_id", null)
    .order("updated_at", { ascending: false })
    .limit(5);
  if (error) throw new Error(error.message);
  return (
    (data ?? []).find((client: any) => {
      const clientEmail = normalizePublicClientEmail(client?.email);
      return !clientEmail || clientEmail === input.sessionEmail;
    }) ?? null
  );
}

async function attachLegacyClientsByVerifiedEmail(
  sb: any,
  input: { studioId: string; userId: string; email: string },
) {
  if (!input.userId || !input.email) return;
  const { error } = await sb
    .from("clients")
    .update({
      auth_user_id: input.userId,
      account_kind: "account",
      updated_at: new Date().toISOString(),
    })
    .eq("studio_id", input.studioId)
    .is("auth_user_id", null)
    .ilike("email", input.email);
  if (error) throw new Error(error.message);
}

function chooseCanonicalPublicClient(
  clients: any[],
  options: { sessionEmail?: string | null; phone?: string | null } = {},
) {
  if (!clients.length) return null;
  const sessionEmail = normalizePublicClientEmail(options.sessionEmail);
  const preferredPhone = publicPhone(options.phone);
  return [...clients].sort((a, b) => {
    const score = (client: any) => {
      const phone = publicPhone(client?.phone);
      const rawPhone = String(client?.phone ?? "");
      const clientEmail = normalizePublicClientEmail(client?.email);
      const totalVisits = Number(client?.total_visits ?? 0);
      const totalSpent = Number(client?.total_spent ?? 0);
      return (
        (preferredPhone && phone === preferredPhone ? 120 : 0) +
        (sessionEmail && clientEmail === sessionEmail ? 80 : 0) +
        (phone ? 60 : 0) +
        (rawPhone.startsWith("account:") ? -80 : 0) +
        (client?.contact_consent_at ? 35 : 0) +
        (client?.policy_accepted_at ? 35 : 0) +
        (totalVisits > 0 ? 20 : 0) +
        (totalSpent > 0 ? 15 : 0)
      );
    };
    const diff = score(b) - score(a);
    if (diff !== 0) return diff;
    return String(b?.updated_at ?? "").localeCompare(String(a?.updated_at ?? ""));
  })[0] ?? null;
}

export const markPublicClientNotificationRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => PublicNotificationReadInput.parse(input))
  .handler(async ({ data, context }) => {
    const userId = String((context as any).userId ?? "").trim();
    if (!userId) throw new Response("public_client_auth_missing", { status: 401 });

    const sb = getAdminClient();
    const { error } = await (sb as any)
      .from("notifications_log")
      .update({ status: "read" })
      .eq("id", data.notificationId)
      .eq("studio_id", data.studioId)
      .eq("channel", "client_center")
      .eq("recipient", `user:${userId}`);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const markAllPublicClientNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => PublicClientInput.parse(input))
  .handler(async ({ data, context }) => {
    const userId = String((context as any).userId ?? "").trim();
    if (!userId) throw new Response("public_client_auth_missing", { status: 401 });

    const sb = getAdminClient();
    const { error } = await (sb as any)
      .from("notifications_log")
      .update({ status: "read" })
      .eq("studio_id", data.studioId)
      .eq("channel", "client_center")
      .eq("recipient", `user:${userId}`)
      .neq("status", "read");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export async function dispatchPendingClientPushNotifications(options?: { studioId?: string }) {
  const sb = getAdminClient();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const until = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  let query = sb
    .from("appointments")
    .select("id,public_token,studio_id,starts_at,ends_at,status,total_price,clients(id,name,phone,email,auth_user_id),staff(name)")
    .gte("starts_at", since)
    .lte("starts_at", until)
    .in("status", ["confirmed", "completed", "cancelled", "no_show"])
    .order("updated_at", { ascending: false })
    .limit(300);

  if (options?.studioId) query = query.eq("studio_id", options.studioId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const appointmentRows = ((data ?? []) as any[])
    .map(normalizeAppointmentRow)
    .filter((row) => row?.studio_id && row.clients?.auth_user_id);
  if (appointmentRows.length === 0) return { created: 0 };

  const appointmentIds = appointmentRows.map((row) => row.id);
  const servicesByAppointment = await loadServicesByAppointment(sb, appointmentIds);
  const paymentsByAppointment = groupPayments(await loadPayments(sb, options?.studioId ?? "", appointmentIds));
  const grouped = new Map<string, { studioId: string; userId: string; appointments: ReturnType<typeof normalizeClientAppointment>[] }>();

  for (const row of appointmentRows) {
    const userId = row.clients?.auth_user_id;
    if (!userId || !row.studio_id) continue;
    const studioId = row.studio_id as string;
    const key = `${studioId}:${userId}`;
    const current = grouped.get(key) ?? { studioId, userId, appointments: [] };
    current.appointments.push(
      normalizeClientAppointment(row, servicesByAppointment, paymentsByAppointment),
    );
    grouped.set(key, current);
  }

  let created = 0;
  for (const group of grouped.values()) {
    const reviewedAppointmentIds = await loadReviewedAppointmentIds(
      sb,
      group.userId,
      group.appointments.map((appointment) => appointment.id),
    );
    created += await ensureClientDerivedNotifications(sb, {
      studioId: group.studioId,
      userId: group.userId,
      appointments: group.appointments,
      reviewedAppointmentIds,
    });
  }
  created += await ensureAutomaticReturnReminders(sb, options);

  return { created };
}

export async function dispatchPendingClientCenterPushNotifications(options?: { studioId?: string }) {
  const sb = getAdminClient();
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  let query = (sb as any)
    .from("notifications_log")
    .select("id,studio_id,kind,recipient,status,payload,created_at")
    .eq("channel", "client_center")
    .eq("status", "unread")
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(100);

  if (options?.studioId) query = query.eq("studio_id", options.studioId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = ((data ?? []) as ClientCenterNotificationRow[]).filter((row) =>
    row.recipient?.startsWith("user:"),
  );
  if (rows.length === 0) return { sent: 0, skipped: 0 };

  const pending: ClientCenterNotificationRow[] = [];
  for (const row of rows) {
    const hasSentPush = await hasConfirmedClientPushForCenterRow(sb, row);
    if (!hasSentPush) pending.push(row);
  }

  const grouped = new Map<string, ClientCenterNotificationRow[]>();
  for (const row of pending) {
    const userId = row.recipient.replace(/^user:/, "");
    const key = `${row.studio_id}:${userId}`;
    const current = grouped.get(key) ?? [];
    current.push(row);
    grouped.set(key, current);
  }

  let sent = 0;
  for (const [key, groupRows] of grouped.entries()) {
    const [studioId, userId] = key.split(":");
    await dispatchClientCenterPush(sb, {
      studioId,
      userId,
      rows: groupRows.map((row) => ({
        id: row.id,
        kind: row.kind,
        payload: row.payload ?? {},
      })),
    });
    sent += groupRows.length;
  }

  return { sent, skipped: rows.length - pending.length };
}

function emptyPayload(email: string | null) {
  return {
    profile: {
      name: "",
      phone: "",
      email: email ?? "",
      avatarUrl: null,
      dateOfBirth: null,
      contactConsentAt: null,
      contactConsentVersion: null,
      policyAcceptedAt: null,
      policyVersion: null,
      totalVisits: 0,
      totalSpent: 0,
    },
    appointments: [],
    pendingPayments: [],
    totals: { paid: 0, deposits: 0, pending: 0 },
    loyalty: null,
    notifications: [],
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

function inferPhone(claims: Record<string, unknown>) {
  const metadata = (claims.user_metadata ?? claims.raw_user_meta_data ?? {}) as Record<string, unknown>;
  return typeof metadata.phone === "string"
    ? metadata.phone
    : typeof metadata.phone_number === "string"
      ? metadata.phone_number
      : "";
}

function inferDateOfBirth(claims: Record<string, unknown>) {
  const metadata = (claims.user_metadata ?? claims.raw_user_meta_data ?? {}) as Record<string, unknown>;
  const direct =
    metadata.date_of_birth ??
    metadata.birthdate ??
    metadata.birthday ??
    metadata.dob ??
    claims.date_of_birth ??
    claims.birthdate ??
    claims.birthday;
  const normalizedDirect = normalizeDateOfBirth(direct);
  if (normalizedDirect) return normalizedDirect;

  const birthdays = metadata.birthdays ?? claims.birthdays;
  if (Array.isArray(birthdays)) {
    for (const birthday of birthdays) {
      const normalized = normalizeGoogleBirthdayObject(birthday);
      if (normalized) return normalized;
    }
  }

  return null;
}

function normalizeGoogleBirthdayObject(value: unknown) {
  const birthday = value as { date?: { year?: number; month?: number; day?: number } };
  const date = birthday?.date;
  if (!date?.month || !date?.day) return null;
  const year = date.year && date.year > 0 ? date.year : 1900;
  return normalizeDateOfBirth(`${year}-${date.month}-${date.day}`);
}

function normalizeDateOfBirth(value: unknown) {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;

  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const european = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  const monthDay = raw.match(/^(\d{1,2})[./-](\d{1,2})$/);
  const match = iso
    ? { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) }
    : european
      ? { year: Number(european[3]), month: Number(european[2]), day: Number(european[1]) }
      : monthDay
        ? { year: 1900, month: Number(monthDay[1]), day: Number(monthDay[2]) }
        : null;
  if (!match) return null;

  const date = new Date(Date.UTC(match.year, match.month - 1, match.day));
  if (
    date.getUTCFullYear() !== match.year ||
    date.getUTCMonth() !== match.month - 1 ||
    date.getUTCDate() !== match.day
  ) {
    return null;
  }

  return `${String(match.year).padStart(4, "0")}-${String(match.month).padStart(2, "0")}-${String(
    match.day,
  ).padStart(2, "0")}`;
}

function normalizePhone(value: string | undefined | null) {
  return String(value ?? "")
    .trim()
    .replace(/[^\d+\s]/g, "")
    .replace(/\s+/g, " ");
}

function existingAccountPhone(userId: string) {
  return `account:${userId}`;
}

function isAccountProfilePhone(value: unknown) {
  return typeof value === "string" && value.startsWith("account:");
}

function publicPhone(value: unknown) {
  const phone = typeof value === "string" ? value : "";
  return isAccountProfilePhone(phone) ? "" : phone;
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
  let query = sb
    .from("payment_intents")
    .select("appointment_id,booking_request_id,amount_cents,status,method")
    .in("appointment_id", appointmentIds);
  if (studioId) query = query.eq("studio_id", studioId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as PaymentRow[];
}

function groupPayments(payments: PaymentRow[]) {
  const paymentMap = new Map<string, PaymentRow[]>();
  for (const payment of payments) {
    if (!payment.appointment_id) continue;
    const current = paymentMap.get(payment.appointment_id) ?? [];
    current.push(payment);
    paymentMap.set(payment.appointment_id, current);
  }
  return paymentMap;
}

function normalizeClientAppointment(
  appointment: AppointmentRow,
  servicesByAppointment: Map<string, { name: string; price: number; durationMin: number }[]>,
  paymentMap: Map<string, PaymentRow[]>,
) {
  const now = Date.now();
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
    isUpcoming: new Date(appointment.ends_at ?? appointment.starts_at).getTime() >= now,
  };
}

async function loadReviewedAppointmentIds(
  sb: any,
  userId: string,
  appointmentIds: string[],
): Promise<string[]> {
  if (!userId || appointmentIds.length === 0) return [];
  try {
    const { data } = await sb
      .from("studio_reviews")
      .select("appointment_id")
      .eq("user_id", userId)
      .in("appointment_id", appointmentIds);
    return ((data ?? []) as any[])
      .map((row: any) => row.appointment_id)
      .filter(Boolean) as string[];
  } catch {
    return [];
  }
}

async function loadClientNotifications(
  sb: any,
  studioId: string,
  userId: string,
): Promise<
  Array<{
    id: string;
    kind: string;
    title: string;
    body: string;
    status: string;
    createdAt: string;
  }>
> {
  if (!userId) return [];
  const { data, error } = await (sb as any)
    .from("notifications_log")
    .select("id,kind,payload,status,created_at")
    .eq("studio_id", studioId)
    .eq("channel", "client_center")
    .eq("recipient", `user:${userId}`)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);

  return ((data ?? []) as ClientNotificationRow[]).map((row) => ({
    id: row.id,
    kind: row.kind,
    title: sanitizeNotificationText(readPayloadText(row.payload, "title"), notificationKindTitle(row.kind)),
    body: sanitizeNotificationText(readPayloadText(row.payload, "body"), notificationKindBody(row.kind)),
    status: row.status,
    createdAt: row.created_at,
  }));
}

function readPayloadText(payload: Record<string, unknown> | null, key: string) {
  const value = payload?.[key];
  return typeof value === "string" ? value : "";
}

function notificationKindTitle(kind: string) {
  if (kind === "staff_online") return "Agenda disponível";
  if (kind === "payment_confirmed") return "Pagamento confirmado";
  if (kind === "appointment_confirmed") return "Marcação confirmada";
  if (kind === "review_request") return "Avaliação disponível";
  return "Notificação";
}

function notificationKindBody(kind: string) {
  if (kind === "staff_online") return "Um profissional tem horários disponíveis para reserva.";
  if (kind === "payment_confirmed") return "O pagamento foi confirmado com sucesso.";
  if (kind === "appointment_confirmed") return "A sua marcação foi confirmada pelo estúdio.";
  if (kind === "review_request") return "Pode avaliar o atendimento concluido.";
  if (kind === "promotion") return "Há uma promoção especial no seu estúdio favorito.";
  if (kind === "new_service") return "O estúdio adicionou um novo serviço.";
  if (kind === "available_slot") return "Existe um horário vago para marcar.";
  if (kind === "cancelled_slot") return "Um cancelamento abriu uma vaga para marcar.";
  return "Tem uma nova notificação do estúdio.";
}

function sanitizeNotificationText(value: string, fallback: string) {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  const technicalPattern =
    /\b(from|insert|update|delete|upsert|select|payload|schema|table|row|uuid|endpoint|subscription|webhook)\b|notifications_log|studio_notifications|push_subscriptions|appointment_created|update_professional_status|client_center|push_client|push_studio|[_{}[\]"`]/i;
  if (technicalPattern.test(text)) return fallback;
  return text.replace(/\s+from\s+\S+$/i, "").trim() || fallback;
}

async function ensureClientDerivedNotifications(
  sb: any,
  {
    studioId,
    userId,
    appointments,
    reviewedAppointmentIds,
  }: {
    studioId: string;
    userId: string;
    appointments: Array<{
      id: string;
      startsAt: string;
      status: string;
      paidAmount: number;
      services: Array<{ name: string; price: number; durationMin: number }>;
      staffName: string;
      isUpcoming: boolean;
    }>;
    reviewedAppointmentIds: string[];
  },
) {
  if (!userId || appointments.length === 0) return 0;

  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const candidates: Array<{
    key: string;
    kind: string;
    appointmentId: string;
    title: string;
    body: string;
  }> = [];
  const reviewed = new Set(reviewedAppointmentIds);

  for (const appointment of appointments) {
    const startsAt = new Date(appointment.startsAt).getTime();
    if (!Number.isFinite(startsAt)) continue;
    if (!appointment.isUpcoming && startsAt < cutoff) continue;

    const service = appointment.services[0]?.name ?? "Serviço";
    const dateText = new Intl.DateTimeFormat("pt-PT", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(appointment.startsAt));

    if (appointment.status === "confirmed" && appointment.isUpcoming) {
      candidates.push({
        key: `appointment_confirmed:${appointment.id}`,
        kind: "appointment_confirmed",
        appointmentId: appointment.id,
        title: "Marcação confirmada",
        body: `${service} está confirmado para ${dateText}.`,
      });
    }

    if (appointment.paidAmount > 0) {
      candidates.push({
        key: `payment_confirmed:${appointment.id}`,
        kind: "payment_confirmed",
        appointmentId: appointment.id,
        title: "Pagamento confirmado",
        body: `Recebemos o pagamento de ${service}.`,
      });
    }

    if (appointment.status === "completed" && appointment.paidAmount > 0 && !reviewed.has(appointment.id)) {
      candidates.push({
        key: `review_request:${appointment.id}`,
        kind: "review_request",
        appointmentId: appointment.id,
        title: "Avaliação disponível",
        body: `Conte como foi o atendimento de ${service}.`,
      });
    }
  }

  if (candidates.length === 0) return 0;

  const { data: existing, error } = await (sb as any)
    .from("notifications_log")
    .select("payload")
    .eq("studio_id", studioId)
    .eq("channel", "client_center")
    .eq("recipient", `user:${userId}`)
    .limit(500);
  if (error) throw new Error(error.message);

  const existingKeys = new Set(
    ((existing ?? []) as Array<{ payload: Record<string, unknown> | null }>)
      .map((row) => readPayloadText(row.payload, "key"))
      .filter(Boolean),
  );

  const rows = candidates
    .filter((item) => !existingKeys.has(item.key))
    .map((item) => ({
      studio_id: studioId,
      appointment_id: item.appointmentId,
      channel: "client_center",
      kind: item.kind,
      recipient: `user:${userId}`,
      status: "unread",
      payload: {
        key: item.key,
        title: item.title,
        body: item.body,
        recipient_user_id: userId,
        event: item.kind,
      },
    }));

  if (rows.length > 0) {
    const { error: insertError } = await (sb as any).from("notifications_log").insert(rows);
    if (insertError) throw new Error(insertError.message);
    await dispatchClientCenterPush(sb, { studioId, userId, rows });
  }
  return rows.length;
}

async function ensureClientNotificationsForAppointment(
  sb: any,
  {
    studioId,
    userId,
    appointmentId,
  }: {
    studioId: string;
    userId: string;
    appointmentId: string;
  },
) {
  const { data: appointment, error } = await sb
    .from("appointments")
    .select("id,public_token,starts_at,ends_at,status,total_price,clients(id,name,phone,email),staff(name)")
    .eq("id", appointmentId)
    .eq("studio_id", studioId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!appointment) return 0;

  const normalizedAppointment = normalizeAppointmentRow(appointment);
  const appointmentIds = [appointmentId];
  const [servicesByAppointment, payments, reviewedAppointmentIds] = await Promise.all([
    loadServicesByAppointment(sb, appointmentIds),
    loadPayments(sb, studioId, appointmentIds),
    loadReviewedAppointmentIds(sb, userId, appointmentIds),
  ]);
  const created = await ensureClientDerivedNotifications(sb, {
    studioId,
    userId,
    appointments: [
      normalizeClientAppointment(normalizedAppointment, servicesByAppointment, groupPayments(payments)),
    ],
    reviewedAppointmentIds,
  });
  if (created > 0) {
    console.info("[notifications] client_center_created", {
      studio_id: studioId,
      appointment_id: appointmentId,
      user_id: userId,
      created,
    });
  }
  return created;
}

async function ensureAutomaticReturnReminders(sb: any, options?: { studioId?: string }) {
  const since = new Date(Date.now() - 420 * 24 * 60 * 60 * 1000).toISOString();
  const until = new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString();
  let query = (sb as any)
    .from("appointments")
    .select("id,studio_id,starts_at,status,clients(id,name,auth_user_id)")
    .gte("starts_at", since)
    .lte("starts_at", until)
    .in("status", ["confirmed", "completed"])
    .order("starts_at", { ascending: true })
    .limit(2500);

  if (options?.studioId) query = query.eq("studio_id", options.studioId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  type ReturnAppointment = {
    id: string;
    studio_id?: string | null;
    starts_at: string;
    status: string;
    clients?: { id?: string | null; name?: string | null; auth_user_id?: string | null } | null;
  };
  type ReturnGroup = {
    studioId: string;
    userId: string;
    clientId: string;
    clientName: string;
    completed: Array<{ id: string; startsAt: string }>;
    future: Array<{ id: string; startsAt: string }>;
  };

  const now = Date.now();
  const groups = new Map<string, ReturnGroup>();

  for (const row of ((data ?? []) as ReturnAppointment[])) {
    const studioId = String(row.studio_id ?? "");
    const userId = String(row.clients?.auth_user_id ?? "");
    const clientId = String(row.clients?.id ?? "");
    if (!studioId || !userId || !clientId) continue;

    const startsAt = new Date(row.starts_at).getTime();
    if (!Number.isFinite(startsAt)) continue;

    const key = `${studioId}:${userId}:${clientId}`;
    const group =
      groups.get(key) ??
      {
        studioId,
        userId,
        clientId,
        clientName: String(row.clients?.name ?? "cliente").trim() || "cliente",
        completed: [],
        future: [],
      };

    if (row.status === "completed" && startsAt < now) {
      group.completed.push({ id: row.id, startsAt: row.starts_at });
    }
    if (row.status === "confirmed" && startsAt >= now) {
      group.future.push({ id: row.id, startsAt: row.starts_at });
    }

    groups.set(key, group);
  }

  const candidates: Array<{
    studioId: string;
    userId: string;
    clientId: string;
    key: string;
    title: string;
    body: string;
    dueAt: string;
    lastCompletedAt: string;
    avgIntervalDays: number;
  }> = [];

  for (const group of groups.values()) {
    if (group.future.length > 0 || group.completed.length < 2) continue;

    const completed = group.completed
      .slice()
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    const intervals = completed.slice(1).map((item, index) =>
      Math.max(
        1,
        Math.round(
          (new Date(item.startsAt).getTime() - new Date(completed[index].startsAt).getTime()) /
            86400000,
        ),
      ),
    );
    if (intervals.length === 0) continue;

    const avgIntervalDays = Math.round(
      intervals.reduce((sum, days) => sum + days, 0) / intervals.length,
    );
    if (!Number.isFinite(avgIntervalDays) || avgIntervalDays < 7) continue;

    const lastCompleted = completed.at(-1);
    if (!lastCompleted) continue;

    const dueAtMs = new Date(lastCompleted.startsAt).getTime() + avgIntervalDays * 86400000;
    const delayDays = Math.floor((now - dueAtMs) / 86400000);
    if (delayDays < 1) continue;

    candidates.push({
      studioId: group.studioId,
      userId: group.userId,
      clientId: group.clientId,
      key: `return_reminder:${group.clientId}:${lastCompleted.id}`,
      title: "Está na altura de voltar",
      body: `${group.clientName}, já passou o período habitual desde a sua última visita. Pode reservar um novo horário pelo app.`,
      dueAt: new Date(dueAtMs).toISOString(),
      lastCompletedAt: lastCompleted.startsAt,
      avgIntervalDays,
    });
  }

  if (candidates.length === 0) return 0;

  const studioIds = Array.from(new Set(candidates.map((item) => item.studioId)));
  let existingQuery = (sb as any)
    .from("notifications_log")
    .select("payload")
    .eq("channel", "client_center")
    .eq("kind", "return_reminder")
    .in("studio_id", studioIds)
    .limit(2500);

  if (options?.studioId) existingQuery = existingQuery.eq("studio_id", options.studioId);

  const { data: existing, error: existingError } = await existingQuery;
  if (existingError) throw new Error(existingError.message);

  const existingKeys = new Set(
    ((existing ?? []) as Array<{ payload: Record<string, unknown> | null }>)
      .map((row) => readPayloadText(row.payload, "key"))
      .filter(Boolean),
  );

  const rows = candidates
    .filter((item) => !existingKeys.has(item.key))
    .map((item) => ({
      studio_id: item.studioId,
      appointment_id: null,
      channel: "client_center",
      kind: "return_reminder",
      recipient: `user:${item.userId}`,
      status: "unread",
      payload: {
        key: item.key,
        title: item.title,
        body: item.body,
        recipient_user_id: item.userId,
        client_id: item.clientId,
        event: "auto_return_reminder",
        return_due_at: item.dueAt,
        last_completed_at: item.lastCompletedAt,
        avg_interval_days: item.avgIntervalDays,
      },
    }));

  if (rows.length === 0) return 0;

  const { data: inserted, error: insertError } = await (sb as any)
    .from("notifications_log")
    .insert(rows)
    .select("id,studio_id,kind,recipient,status,payload,created_at");
  if (insertError) throw new Error(insertError.message);

  const byUser = new Map<string, Array<{ id?: string; kind: string; payload: Record<string, unknown> }>>();
  for (const row of ((inserted ?? rows) as any[])) {
    const userId = String(readPayloadText(row.payload, "recipient_user_id") || row.recipient?.replace(/^user:/, "") || "");
    if (!userId) continue;
    const key = `${row.studio_id}:${userId}`;
    const current = byUser.get(key) ?? [];
    current.push({ id: row.id, kind: row.kind, payload: row.payload ?? {} });
    byUser.set(key, current);
  }

  for (const [key, userRows] of byUser) {
    const [studioId, userId] = key.split(":");
    if (!studioId || !userId) continue;
    await dispatchClientCenterPush(sb, { studioId, userId, rows: userRows });
  }

  return rows.length;
}

async function dispatchClientCenterPush(
  sb: any,
  {
    studioId,
    userId,
    rows,
  }: {
    studioId: string;
    userId: string;
    rows: Array<{
      id?: string;
      kind: string;
      payload: Record<string, unknown>;
    }>;
  },
) {
  const { data: studio } = await sb
    .from("studios")
    .select("slug,logo_url,updated_at")
    .eq("id", studioId)
    .maybeSingle();
  const { data: subscriptions, error } = await (sb as any)
    .from("push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth")
    .eq("studio_id", studioId)
    .eq("user_id", userId)
    .in("audience", ["client", "both"])
    .is("revoked_at", null)
    .limit(8);
  if (error) throw new Error(error.message);

  if (!subscriptions?.length) {
    await insertNotificationLog(sb, {
      studioId,
      channel: "push_client",
      kind: "client_center_sync",
      recipient: `user:${userId}`,
      status: "skipped",
      error: "no_client_push_subscription",
      payload: { event: "client_center_push", count: rows.length },
    });
    return;
  }

  for (const row of rows) {
    const title = sanitizeNotificationText(readPayloadText(row.payload, "title"), notificationKindTitle(row.kind));
    const body = sanitizeNotificationText(readPayloadText(row.payload, "body"), notificationKindBody(row.kind));
    const key = readPayloadText(row.payload, "key") || `${row.kind}:${Date.now()}`;
    const payload = {
      title,
      body,
      url: studio?.slug ? `/s/${studio.slug}` : "/",
      icon: withPushAssetVersion(studio?.logo_url || "/pwa-icon.svg", studio?.updated_at),
      badge: "/pwa-icon.svg",
      tag: `client-${key}`,
      data: { studioId, kind: row.kind, key, notificationId: row.id },
    };

    for (const subscription of subscriptions) {
      const result = await sendWebPush(subscription, payload);
      if (result.ok) {
        await insertNotificationLog(sb, {
          studioId,
          channel: "push_client",
          kind: row.kind,
          recipient: `user:${userId}`,
          status: "sent",
          payload: {
            event: "client_center_push",
            key,
            client_center_id: row.id ?? null,
            endpoint: maskEndpoint(subscription.endpoint),
          },
        });
      } else {
        await insertNotificationLog(sb, {
          studioId,
          channel: "push_client",
          kind: row.kind,
          recipient: `user:${userId}`,
          status: "failed",
          error: webPushFailureReason(result),
          payload: {
            event: "client_center_push",
            key,
            client_center_id: row.id ?? null,
            endpoint: maskEndpoint(subscription.endpoint),
          },
        });
        if ("status" in result && (result.status === 404 || result.status === 410)) {
          await (sb as any)
            .from("push_subscriptions")
            .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq("id", subscription.id);
        }
      }
    }
  }
}

type ClientCenterNotificationRow = {
  id: string;
  studio_id: string;
  kind: string;
  recipient: string;
  status: string;
  payload: Record<string, unknown> | null;
  created_at: string;
};

async function hasConfirmedClientPushForCenterRow(sb: any, row: ClientCenterNotificationRow) {
  const key = readPayloadText(row.payload, "key");
  let query = (sb as any)
    .from("notifications_log")
    .select("id")
    .eq("studio_id", row.studio_id)
    .eq("channel", "push_client")
    .eq("kind", row.kind)
    .eq("recipient", row.recipient)
    .eq("status", "sent")
    .gte("created_at", row.created_at)
    .limit(1);

  if (key) {
    query = query.contains("payload", { key });
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return Boolean(data?.length);
}

async function insertNotificationLog(
  sb: any,
  row: {
    studioId: string;
    channel: string;
    kind: string;
    recipient: string;
    status: string;
    payload?: Record<string, unknown>;
    error?: string;
  },
) {
  await (sb as any).from("notifications_log").insert({
    studio_id: row.studioId,
    channel: row.channel,
    kind: row.kind,
    recipient: row.recipient,
    payload: row.payload ?? {},
    status: row.status,
    error: row.error ?? null,
  });
}

function webPushFailureReason(result: Awaited<ReturnType<typeof sendWebPush>>) {
  if ("status" in result) return `web_push_${result.status}`;
  if ("skipped" in result) return result.skipped;
  return "web_push_failed";
}

function maskEndpoint(endpoint: string) {
  return endpoint.length <= 22 ? endpoint : `${endpoint.slice(0, 16)}...${endpoint.slice(-6)}`;
}

function withPushAssetVersion(url: string, version?: string | null) {
  if (!version) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(version)}`;
}
