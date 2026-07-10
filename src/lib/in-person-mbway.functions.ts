import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertStudioAccess, getRequestFingerprint, rateLimitOrThrow } from "@/lib/server-security";
import { createStripeClient, type StripeEnv } from "@/lib/stripe.server";
import { getAdminClient } from "@/lib/supabase-admin.server";

const CreateInPersonMbWayInput = z.object({
  appointmentId: z.string().uuid(),
  phone: z.string().trim().min(6).max(32),
});

type StripePayload = {
  id?: string;
  amount?: number | null;
  amount_received?: number | null;
  currency?: string | null;
  status?: string | null;
  latest_charge?: string | { id?: string } | null;
  metadata?: Record<string, string | undefined>;
};

type FinalizeResult = {
  handled: boolean;
  appointmentId?: string | null;
  studioId?: string | null;
  previousStatus?: string | null;
  status?: string | null;
};

function sb() {
  return getAdminClient();
}

function stripeEnv(): StripeEnv {
  if (process.env.STRIPE_ENV !== "live") {
    throw new Error("stripe_live_required");
  }
  return "live";
}

export function isInPersonMbWayEnabled() {
  return process.env.ENABLE_IN_PERSON_MB_WAY === "true";
}

function normalizePortugueseMobile(phone?: string | null) {
  const raw = phone?.trim() ?? "";
  const digits = raw.replace(/\D/g, "");
  if (/^9\d{8}$/.test(digits)) return `+351${digits}`;
  if (/^3519\d{8}$/.test(digits)) return `+${digits}`;
  if (/^003519\d{8}$/.test(digits)) return `+${digits.slice(2)}`;
  if (/^\+3519\d{8}$/.test(raw)) return raw;
  return null;
}

function normalizeStripeStatus(status?: string | null) {
  if (status === "succeeded") return "succeeded";
  if (status === "processing") return "processing";
  if (status === "canceled") return "canceled";
  if (status === "requires_payment_method") return "failed";
  return "requires_action";
}

function extractLatestChargeId(pi: StripePayload) {
  const latest = pi.latest_charge;
  if (typeof latest === "string") return latest;
  if (latest && typeof latest === "object" && typeof latest.id === "string") return latest.id;
  return null;
}

async function loadFinancialPatch(pi: StripePayload, stripeAccount: string | null) {
  const chargeId = extractLatestChargeId(pi);
  if (!chargeId) return { financial_details_status: "pending" };

  const stripe = createStripeClient(stripeEnv());
  const charge = await stripe.charges.retrieve(
    chargeId,
    { expand: ["balance_transaction"] },
    stripeAccount ? { stripeAccount } : undefined,
  );
  const balanceTransaction =
    typeof charge.balance_transaction === "object" && charge.balance_transaction
      ? charge.balance_transaction
      : null;
  if (!balanceTransaction) {
    return { stripe_charge_id: charge.id, financial_details_status: "pending" };
  }
  return {
    stripe_charge_id: charge.id,
    stripe_balance_transaction_id: balanceTransaction.id,
    gross_amount_cents: Number(balanceTransaction.amount || charge.amount || pi.amount_received || pi.amount || 0),
    stripe_fee_cents: Number(balanceTransaction.fee || 0),
    net_amount_cents: Number(balanceTransaction.net || 0),
    available_on: balanceTransaction.available_on
      ? new Date(balanceTransaction.available_on * 1000).toISOString()
      : null,
    financial_details_status: "confirmed",
  };
}

async function loadAppointmentSource(appointmentId: string) {
  const { data: appt, error } = await sb()
    .from("appointments")
    .select("id,studio_id,client_id,starts_at,status,total_price,clients(id,name,phone,email)")
    .eq("id", appointmentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!appt?.id) throw new Error("appointment_not_found");

  const { data: studio, error: studioError } = await sb()
    .from("studios")
    .select("id,name,currency,stripe_connect_account_id,stripe_connect_charges_enabled,stripe_connect_onboarding_completed")
    .eq("id", appt.studio_id as string)
    .maybeSingle();
  if (studioError) throw new Error(studioError.message);
  if (!studio?.id) throw new Error("studio_not_found");

  return { appt, studio };
}

async function computeRemainingCents(appointmentId: string, totalPrice: unknown) {
  const totalCents = Math.round(Number(totalPrice || 0) * 100);
  if (totalCents <= 0) throw new Error("invalid_amount");

  const [{ data: onlineRows, error: onlineError }, { data: cashRows, error: cashError }] =
    await Promise.all([
      sb()
        .from("payment_intents")
        .select("amount_cents,status")
        .eq("appointment_id", appointmentId)
        .eq("status", "succeeded"),
      (sb() as any)
        .from("cash_register_movements")
        .select("amount,movement_type")
        .eq("appointment_id", appointmentId)
        .eq("movement_type", "service_payment"),
    ]);
  if (onlineError) throw new Error(onlineError.message);
  if (cashError) throw new Error(cashError.message);

  const paidOnlineCents = (onlineRows ?? []).reduce(
    (sum: number, row: { amount_cents?: number | null }) => sum + Number(row.amount_cents || 0),
    0,
  );
  const paidStudioCents = (cashRows ?? []).reduce(
    (sum: number, row: { amount?: number | null }) => sum + Math.round(Number(row.amount || 0) * 100),
    0,
  );
  return Math.max(0, totalCents - paidOnlineCents - paidStudioCents);
}

async function findReusablePendingIntent(appointmentId: string, amountCents: number) {
  const { data, error } = await sb()
    .from("payment_intents")
    .select("id,stripe_payment_intent_id,status,amount_cents,currency,expires_at")
    .eq("appointment_id", appointmentId)
    .eq("method", "mb_way")
    .in("status", ["requires_action", "processing"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.id) return null;
  if (Number(data.amount_cents || 0) !== amountCents) return null;
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) return null;
  return data;
}

export const getInPersonMbWaySettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => ({
    enableInPersonMbWay: isInPersonMbWayEnabled(),
  }));

export const createInPersonMbWayPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => CreateInPersonMbWayInput.parse(input))
  .handler(async ({ data, context }) => {
    if (!isInPersonMbWayEnabled()) throw new Error("in_person_mb_way_disabled");

    await rateLimitOrThrow({
      key: `in-person-mbway:${data.appointmentId}:${getRequestFingerprint()}`,
      limit: 5,
      windowMs: 10 * 60 * 1000,
    });

    const source = await loadAppointmentSource(data.appointmentId);
    await assertStudioAccess(sb(), (context as any).userId, source.appt.studio_id as string);

    if (["cancelled", "no_show"].includes(String(source.appt.status))) {
      throw new Error("appointment_not_payable");
    }

    const phone = normalizePortugueseMobile(data.phone || (source.appt.clients as any)?.phone);
    if (!phone) throw new Error("mb_way_phone_invalid");

    if (
      !source.studio.stripe_connect_account_id ||
      !source.studio.stripe_connect_charges_enabled ||
      !source.studio.stripe_connect_onboarding_completed
    ) {
      throw new Error("connect_account_not_ready");
    }

    const amountCents = await computeRemainingCents(data.appointmentId, source.appt.total_price);
    if (amountCents < 50) throw new Error("appointment_already_paid");

    const existing = await findReusablePendingIntent(data.appointmentId, amountCents);
    if (existing?.stripe_payment_intent_id) {
      return {
        paymentIntentId: existing.id,
        stripePaymentIntentId: existing.stripe_payment_intent_id,
        status: existing.status,
        amountCents,
        reused: true,
      };
    }

    if (source.appt.client_id && phone !== (source.appt.clients as any)?.phone) {
      await sb()
        .from("clients")
        .update({ phone, updated_at: new Date().toISOString() } as any)
        .eq("id", source.appt.client_id as string)
        .eq("studio_id", source.appt.studio_id as string);
    }

    const stripe = createStripeClient(stripeEnv());
    const stripePaymentIntent = await stripe.paymentIntents.create(
      {
        amount: amountCents,
        currency: "eur",
        payment_method_types: ["mb_way"],
        payment_method_data: {
          type: "mb_way",
          billing_details: {
            name: (source.appt.clients as any)?.name || "Cliente Bellza",
            email: (source.appt.clients as any)?.email || undefined,
            phone,
          },
        },
        confirm: true,
        metadata: {
          payment_kind: "studio_in_person_mb_way",
          appointment_id: data.appointmentId,
          studio_id: source.appt.studio_id as string,
          client_id: (source.appt.client_id as string | null) ?? "",
        },
        description: `Pagamento MB WAY presencial - ${source.studio.name}`,
      } as any,
      {
        stripeAccount: source.studio.stripe_connect_account_id as string,
        idempotencyKey: `studio-in-person-mbway:${data.appointmentId}:${amountCents}`,
      },
    );

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const status = normalizeStripeStatus(stripePaymentIntent.status);
    const reservedStatus = status === "succeeded" ? "processing" : status;
    const { data: row, error } = await sb()
      .from("payment_intents")
      .insert({
        studio_id: source.appt.studio_id,
        appointment_id: data.appointmentId,
        booking_request_id: null,
        stripe_payment_intent_id: stripePaymentIntent.id,
        stripe_connect_account_id: source.studio.stripe_connect_account_id,
        client_secret: stripePaymentIntent.client_secret ?? null,
        amount_cents: amountCents,
        currency: "eur",
        method: "mb_way",
        status: reservedStatus,
        expires_at: expiresAt,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    console.info("[in-person-mbway] charge_created", {
      appointmentId: data.appointmentId,
      studioId: source.appt.studio_id,
      stripePaymentIntentId: stripePaymentIntent.id,
      status,
      reservedStatus,
      amountCents,
    });

    return {
      paymentIntentId: row.id,
      stripePaymentIntentId: stripePaymentIntent.id,
      status,
      amountCents,
      reused: false,
    };
  });

export async function handleInPersonMbWayPaymentIntent(
  stripePaymentIntent: StripePayload,
  kind: "succeeded" | "failed" | "processing" | "canceled",
): Promise<FinalizeResult> {
  if (stripePaymentIntent.metadata?.payment_kind !== "studio_in_person_mb_way") {
    return { handled: false };
  }

  const appointmentId = stripePaymentIntent.metadata.appointment_id ?? null;
  const studioId = stripePaymentIntent.metadata.studio_id ?? null;
  if (!stripePaymentIntent.id || !appointmentId || !studioId) {
    throw new Error("in_person_mbway_metadata_missing");
  }

    const { data: paymentRow, error } = await sb()
    .from("payment_intents")
    .select("id,status,amount_cents,currency,appointment_id,studio_id,stripe_connect_account_id")
    .eq("stripe_payment_intent_id", stripePaymentIntent.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!paymentRow?.id) throw new Error("in_person_mbway_payment_missing");
  if (paymentRow.appointment_id !== appointmentId || paymentRow.studio_id !== studioId) {
    throw new Error("in_person_mbway_scope_mismatch");
  }
  if (String(paymentRow.currency || "eur").toLowerCase() !== String(stripePaymentIntent.currency || "eur").toLowerCase()) {
    throw new Error("in_person_mbway_currency_mismatch");
  }

  const expectedAmount = Number(paymentRow.amount_cents || 0);
  const receivedAmount = Number(stripePaymentIntent.amount_received ?? stripePaymentIntent.amount ?? 0);
  if (kind === "succeeded" && (expectedAmount <= 0 || receivedAmount < expectedAmount)) {
    throw new Error("in_person_mbway_amount_mismatch");
  }

  const status = kind === "succeeded"
    ? "succeeded"
    : kind === "processing"
      ? "processing"
      : kind === "canceled"
        ? "canceled"
        : "failed";

  const financialPatch =
    kind === "succeeded"
      ? await loadFinancialPatch(stripePaymentIntent, paymentRow.stripe_connect_account_id as string | null).catch((error) => {
          console.error("[in-person-mbway] financial_details_load_failed", {
            appointmentId,
            studioId,
            stripePaymentIntentId: stripePaymentIntent.id,
            reason: error instanceof Error ? error.message : String(error),
          });
          return { financial_details_status: "pending" };
        })
      : {};

  await sb()
    .from("payment_intents")
    .update({ status, ...financialPatch, updated_at: new Date().toISOString() })
    .eq("id", paymentRow.id);

  if (kind === "succeeded" && paymentRow.status !== "succeeded") {
    await sb()
      .from("appointments")
      .update({ status: "completed", updated_at: new Date().toISOString() } as any)
      .eq("id", appointmentId)
      .eq("studio_id", studioId)
      .not("status", "in", "(cancelled,no_show)");
  }

  console.info("[in-person-mbway] webhook_processed", {
    appointmentId,
    studioId,
    stripePaymentIntentId: stripePaymentIntent.id,
    status,
    previousStatus: paymentRow.status,
  });

  return {
    handled: true,
    appointmentId,
    studioId,
    previousStatus: paymentRow.status,
    status,
  };
}
