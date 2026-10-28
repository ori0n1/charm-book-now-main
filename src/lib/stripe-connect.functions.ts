import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import type Stripe from "stripe";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertStudioEntitlement, assertStudioOwnerAccess } from "@/lib/server-security";
import { getAdminClient } from "@/lib/supabase-admin.server";
import { createStripeClient, getConfiguredStripeEnv, resolveStripeAppBaseUrl, type StripeEnv } from "@/lib/stripe.server";
import {
  assertNewStandardAccountConfiguration,
  CONNECT_ACCOUNT_MODEL,
  readConnectedAccountResponsibility,
  requireNewConnectAccountModel,
} from "@/lib/stripe-connect-integrity.server";
import {
  buildConnectFinancialSummary,
  type ConnectFinancialSummary,
  type StoredPaymentLink,
  type StripeFinancialMovement,
  type StripePayoutSnapshot,
} from "@/lib/stripe-receivables";

export type { ConnectFinancialSummary } from "@/lib/stripe-receivables";

const StudioInput = z.object({ studioId: z.string().uuid() });

async function assertStudioFinancialReadAccess(userId: string, studioId: string) {
  if (!userId || !studioId) throw new Response("forbidden", { status: 403 });
  const { data, error } = await sb()
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("studio_id", studioId)
    .in("role", ["saas_owner", "studio_owner", "manager"])
    .limit(1)
    .maybeSingle();
  if (error || !data?.role) throw new Response("forbidden", { status: 403 });
  await assertStudioEntitlement(sb(), studioId, "online_payments");
}

function sb() {
  return getAdminClient();
}

/**
 * Resolve o ambiente Stripe para Connect.
 * STRIPE_ENV é uma decisão exclusiva do servidor. O cliente nunca escolhe
 * entre sandbox e live, evitando mistura de objetos entre ambientes.
 */
function connectStripeEnv(): StripeEnv {
  return getConfiguredStripeEnv();
}

function appBaseUrl(): string {
  return resolveStripeAppBaseUrl({ request: getRequest() });
}

// ── Types ────────────────────────────────────────────────────────────────────

export type ConnectAccountStatus =
  | "not_connected"
  | "pending"
  | "pending_verification"
  | "active"
  | "restricted";

export type ConnectStatusPayload = {
  accountId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  onboardingCompleted: boolean;
  mbWayPaymentsEnabled: boolean;
  status: ConnectAccountStatus;
  responsibility?: {
    feesPayer: string | null;
    lossesCollector: string | null;
    dashboardType: string | null;
    compatibleWithStudioPaysFees: boolean;
  };
  financial?: ConnectFinancialSummary;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

async function loadStudioConnect(studioId: string) {
  const { data, error } = await sb()
    .from("studios")
    .select(
      "id, stripe_connect_account_id, stripe_connect_charges_enabled, stripe_connect_payouts_enabled, stripe_connect_onboarding_completed, stripe_connect_mb_way_payments_enabled, stripe_connect_status",
    )
    .eq("id", studioId)
    .maybeSingle();
  if (error || !data) throw new Error("studio_not_found");
  return data as {
    id: string;
    stripe_connect_account_id: string | null;
    stripe_connect_charges_enabled: boolean | null;
    stripe_connect_payouts_enabled: boolean | null;
    stripe_connect_onboarding_completed: boolean | null;
    stripe_connect_mb_way_payments_enabled?: boolean | null;
    stripe_connect_status: string | null;
  };
}

function deriveStatus(account: {
  charges_enabled: boolean;
  payouts_enabled?: boolean | null;
  details_submitted?: boolean | null;
  requirements?: { disabled_reason?: string | null } | null;
}): ConnectAccountStatus {
  if (account.charges_enabled) return "active";
  if (account.requirements?.disabled_reason) return "restricted";
  if (account.details_submitted) return "pending_verification";
  return "pending";
}

function isMbWayPaymentsActive(account: { capabilities?: Record<string, unknown> | null }) {
  return account.capabilities?.mb_way_payments === "active";
}

async function ensureMbWayCapabilityRequested(stripe: ReturnType<typeof createStripeClient>, accountId: string) {
  try {
    const capability = await stripe.accounts.retrieveCapability(accountId, "mb_way_payments" as any);
    if (capability.status === "active" || capability.requested) return;
  } catch {
    // Some old accounts can return not_found before the capability is requested.
  }

  try {
    await stripe.accounts.update(accountId, {
      capabilities: {
        mb_way_payments: { requested: true },
      },
    } as any);
  } catch (error) {
    console.warn("[stripe-connect] mb_way_capability_request_failed", {
      accountId,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

async function patchStudioConnect(
  studioId: string,
  patch: Record<string, unknown>,
) {
  await sb()
    .from("studios")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", studioId);
}

type PaymentRow = {
  id: string;
  appointment_id: string | null;
  booking_request_id: string | null;
  amount_cents: number | null;
  currency: string | null;
  method: string | null;
  status: string | null;
  stripe_payment_intent_id?: string | null;
  stripe_connect_account_id?: string | null;
  stripe_charge_id?: string | null;
  stripe_balance_transaction_id?: string | null;
  gross_amount_cents?: number | null;
  stripe_fee_cents?: number | null;
  net_amount_cents?: number | null;
  available_on?: string | null;
  financial_details_status?: string | null;
  created_at: string | null;
};

function unixTime(value?: number | null) {
  return value ? new Date(value * 1000).toISOString() : null;
}

function stripeMovement(accountId: string, item: Stripe.BalanceTransaction): StripeFinancialMovement {
  const source = typeof item.source === "object" && item.source ? (item.source as any) : null;
  const sourceId = typeof item.source === "string" ? item.source : source?.id ?? null;
  const charge = source?.object === "charge" ? source : null;
  const refund = source?.object === "refund" ? source : null;
  const chargeId = charge?.id ?? (typeof refund?.charge === "string" ? refund.charge : refund?.charge?.id) ?? null;
  const paymentIntentId =
    (typeof charge?.payment_intent === "string" ? charge.payment_intent : charge?.payment_intent?.id) ??
    (typeof refund?.payment_intent === "string" ? refund.payment_intent : refund?.payment_intent?.id) ??
    null;

  return {
    accountId,
    id: item.id,
    type: String(item.type ?? ""),
    reportingCategory: String(item.reporting_category ?? ""),
    amountCents: Number(item.amount || 0),
    feeCents: Number(item.fee || 0),
    netCents: Number(item.net || 0),
    currency: String(item.currency ?? "eur").toLowerCase(),
    status: String(item.status ?? ""),
    paymentStatus: charge?.paid === true || charge?.status === "succeeded"
      ? "succeeded"
      : typeof charge?.status === "string" ? charge.status : null,
    createdAt: unixTime(item.created) ?? new Date(0).toISOString(),
    availableOn: unixTime(item.available_on),
    sourceId,
    chargeId,
    paymentIntentId,
    method: charge?.payment_method_details?.type ?? null,
    refundedAmountCents: Number(charge?.amount_refunded || 0),
  };
}

function stripePayout(accountId: string, payout: Stripe.Payout): StripePayoutSnapshot {
  const destination = typeof payout.destination === "object" && payout.destination
    ? (payout.destination as any)
    : null;
  const last4 = typeof destination?.last4 === "string" ? destination.last4 : null;
  return {
    accountId,
    id: payout.id,
    amountCents: Number(payout.amount || 0),
    currency: String(payout.currency ?? "eur").toLowerCase(),
    status: String(payout.status ?? ""),
    createdAt: unixTime(payout.created) ?? new Date(0).toISOString(),
    arrivalAt: unixTime(payout.arrival_date),
    destinationMasked: last4 ? `•••• ${last4}` : null,
  };
}

async function enrichStoredPayments(studioId: string, rows: PaymentRow[]): Promise<StoredPaymentLink[]> {
  const appointmentIds = [...new Set(rows.map((row) => row.appointment_id).filter(Boolean))] as string[];
  const bookingRequestIds = [...new Set(rows.map((row) => row.booking_request_id).filter(Boolean))] as string[];
  const [appointmentsResult, bookingRequestsResult] = await Promise.all([
    appointmentIds.length
      ? sb()
          .from("appointments")
          .select("id,starts_at,clients:clients!appointments_client_same_studio(name)")
          .eq("studio_id", studioId)
          .in("id", appointmentIds)
      : Promise.resolve({ data: [], error: null }),
    bookingRequestIds.length
      ? sb()
          .from("booking_payment_requests")
          .select("id,client_name,starts_at")
          .eq("studio_id", studioId)
          .in("id", bookingRequestIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (appointmentsResult.error) throw new Error(appointmentsResult.error.message);
  if (bookingRequestsResult.error) throw new Error(bookingRequestsResult.error.message);

  const appointments = new Map(
    ((appointmentsResult.data ?? []) as any[]).map((row) => [row.id, row]),
  );
  const bookingRequests = new Map(
    ((bookingRequestsResult.data ?? []) as any[]).map((row) => [row.id, row]),
  );

  return rows.map((row) => {
    const appointment = row.appointment_id ? appointments.get(row.appointment_id) : null;
    const booking = row.booking_request_id ? bookingRequests.get(row.booking_request_id) : null;
    const clientRelation = Array.isArray(appointment?.clients)
      ? appointment.clients[0]
      : appointment?.clients;
    return {
      accountId: row.stripe_connect_account_id ?? null,
      id: row.id,
      appointmentId: row.appointment_id,
      bookingRequestId: row.booking_request_id,
      amountCents: Number(row.amount_cents || 0),
      currency: String(row.currency ?? "eur").toLowerCase(),
      method: row.method,
      status: String(row.status ?? ""),
      createdAt: row.created_at ?? new Date(0).toISOString(),
      stripePaymentIntentId: row.stripe_payment_intent_id ?? null,
      stripeChargeId: row.stripe_charge_id ?? null,
      stripeBalanceTransactionId: row.stripe_balance_transaction_id ?? null,
      grossAmountCents: row.gross_amount_cents ?? null,
      stripeFeeCents: row.stripe_fee_cents ?? null,
      netAmountCents: row.net_amount_cents ?? null,
      availableOn: row.available_on ?? null,
      financialDetailsStatus: row.financial_details_status ?? null,
      clientName: clientRelation?.name ?? booking?.client_name ?? null,
      appointmentStartsAt: appointment?.starts_at ?? booking?.starts_at ?? null,
    };
  });
}

function storedFinancialMovements(accountId: string, rows: StoredPaymentLink[]) {
  return rows
    .filter(
      (row) =>
        row.accountId === accountId &&
        row.financialDetailsStatus === "confirmed" &&
        row.stripeBalanceTransactionId &&
        row.grossAmountCents != null &&
        row.stripeFeeCents != null &&
        row.netAmountCents != null,
    )
    .map<StripeFinancialMovement>((row) => ({
      accountId,
      id: row.stripeBalanceTransactionId as string,
      type: "charge",
      reportingCategory: "charge",
      amountCents: Number(row.grossAmountCents),
      feeCents: Number(row.stripeFeeCents),
      netCents: Number(row.netAmountCents),
      currency: row.currency,
      status: "available",
      paymentStatus: row.status,
      createdAt: row.createdAt,
      availableOn: row.availableOn,
      sourceId: row.stripeChargeId,
      chargeId: row.stripeChargeId,
      paymentIntentId: row.stripePaymentIntentId,
      method: row.method,
      refundedAmountCents: 0,
    }));
}

async function loadPayoutTransactionMap(
  stripe: ReturnType<typeof createStripeClient>,
  accountId: string,
  payouts: Stripe.Payout[],
) {
  const relevant = [
    payouts.find((payout) => ["pending", "in_transit"].includes(String(payout.status))),
    payouts.find((payout) => payout.status === "paid"),
  ].filter((payout, index, all): payout is Stripe.Payout =>
    Boolean(payout && all.findIndex((item) => item?.id === payout.id) === index),
  );
  const results = await Promise.allSettled(
    relevant.map(async (payout) => ({
      payoutId: payout.id,
      transactions: await stripe.balanceTransactions.list(
        { payout: payout.id, limit: 100 } as any,
        { stripeAccount: accountId },
      ),
    })),
  );
  const payoutByTransaction = new Map<string, string>();
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const transaction of result.value.transactions.data) {
      payoutByTransaction.set(transaction.id, result.value.payoutId);
    }
  }
  return payoutByTransaction;
}

async function loadConnectFinancialSummary(
  studioId: string,
  accountId?: string | null,
  knownAccount?: Stripe.Account,
): Promise<{
  financial: ConnectFinancialSummary;
  responsibility?: ConnectStatusPayload["responsibility"];
}> {
  const { data: payments, error } = await sb()
    .from("payment_intents")
    .select("id,appointment_id,booking_request_id,amount_cents,currency,method,status,created_at,stripe_payment_intent_id,stripe_connect_account_id,stripe_charge_id,stripe_balance_transaction_id,gross_amount_cents,stripe_fee_cents,net_amount_cents,available_on,financial_details_status")
    .eq("studio_id", studioId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  const rows = (payments ?? []) as PaymentRow[];
  const storedPayments = await enrichStoredPayments(studioId, rows);
  const scopedRows = accountId
    ? storedPayments.filter((row) => row.accountId === accountId)
    : storedPayments.filter((row) => !row.accountId);
  const currency = String(scopedRows[0]?.currency ?? "eur").toLowerCase();
  const stripeFeeSchedule = getStripeFeeSchedule();

  if (!accountId) {
    return {
      financial: buildConnectFinancialSummary({
        accountId: null,
        storedPayments,
        movements: [],
        payouts: [],
        availableCents: 0,
        pendingCents: 0,
        currency,
        scheduleLabel: null,
        nextAvailableAt: null,
        stripeFeeSchedule,
        stripeLive: false,
      }),
    };
  }

  try {
    const stripe = createStripeClient(connectStripeEnv());
    const [balance, accountResult, payoutList, balanceTransactions] = await Promise.all([
      stripe.balance.retrieve({}, { stripeAccount: accountId }),
      knownAccount ? Promise.resolve(knownAccount) : stripe.accounts.retrieve(accountId),
      stripe.payouts.list(
        { limit: 10, expand: ["data.destination"] },
        { stripeAccount: accountId },
      ),
      stripe.balanceTransactions.list(
        { limit: 100, expand: ["data.source"] },
        { stripeAccount: accountId },
      ),
    ]);
    const account = accountResult as Stripe.Account;
    const movements = balanceTransactions.data.map((item) => stripeMovement(accountId, item));
    const stripeCurrency =
      movements.find((item) => item.currency)?.currency ??
      balance.available[0]?.currency ??
      balance.pending[0]?.currency ??
      currency;
    const availableForCurrency =
      balance.available.find((item) => item.currency === stripeCurrency) ?? balance.available[0];
    const pendingForCurrency =
      balance.pending.find((item) => item.currency === stripeCurrency) ?? balance.pending[0];
    const pendingAvailability = movements
      .filter(
        (item) =>
          item.currency === stripeCurrency &&
          item.status === "pending" &&
          item.netCents > 0 &&
          item.availableOn,
      )
      .map((item) => item.availableOn as string)
      .sort();
    const payoutByBalanceTransactionId = await loadPayoutTransactionMap(
      stripe,
      accountId,
      payoutList.data,
    );
    const responsibility = readConnectedAccountResponsibility(account);

    return {
      responsibility: {
        ...responsibility,
        compatibleWithStudioPaysFees:
          responsibility.feesPayer === "account" &&
          responsibility.lossesCollector === "stripe",
      },
      financial: buildConnectFinancialSummary({
        accountId,
        storedPayments,
        movements,
        payouts: payoutList.data.map((payout) => stripePayout(accountId, payout)),
        payoutByBalanceTransactionId,
        availableCents: Number(availableForCurrency?.amount || 0),
        pendingCents: Number(pendingForCurrency?.amount || 0),
        currency: stripeCurrency,
        scheduleLabel: formatPayoutSchedule((account as any).settings?.payouts?.schedule),
        nextAvailableAt: pendingAvailability[0] ?? null,
        stripeFeeSchedule,
        hasMoreStripeTransactions: balanceTransactions.has_more,
        stripeLive: true,
      }),
    };
  } catch (err) {
    console.warn("[stripe-connect] live financial summary unavailable", {
      studioId,
      accountId,
      error: err instanceof Error ? err.message : String(err),
    });
    const movements = storedFinancialMovements(accountId, storedPayments);
    return {
      financial: buildConnectFinancialSummary({
        accountId,
        storedPayments,
        movements,
        payouts: [],
        availableCents: 0,
        pendingCents: 0,
        currency,
        scheduleLabel: null,
        nextAvailableAt: null,
        stripeFeeSchedule,
        stripeLive: false,
      }),
    };
  }
}

function formatPayoutSchedule(schedule: any) {
  if (!schedule) return null;
  const delay = schedule.delay_days ? `saldo disponível em ${schedule.delay_days} dias` : null;
  const interval = String(schedule.interval ?? "");
  if (interval === "daily") return delay ? `Diário, ${delay}` : "Diário";
  if (interval === "weekly") return delay ? `Semanal, ${delay}` : "Semanal";
  if (interval === "monthly") return delay ? `Mensal, ${delay}` : "Mensal";
  if (interval === "manual") return "Transferências manuais no painel Stripe";
  return delay ?? null;
}

function getStripeFeeSchedule(): ConnectFinancialSummary["stripeFeeSchedule"] {
  const configuredMbWay = process.env.STRIPE_MB_WAY_FEE_LABEL?.trim();
  const configuredCard = process.env.STRIPE_CARD_FEE_LABEL?.trim();
  if (configuredMbWay && configuredMbWay === configuredCard) {
    return {
      label: configuredMbWay,
      source: "configured",
    };
  }
  if (configuredMbWay || configuredCard) {
    return {
      label: configuredMbWay || configuredCard || "Consultar painel Stripe",
      source: "configured",
    };
  }

  return {
    label: "1,5% + 0,25 €",
    source: "stripe_standard_pt",
  };
}

// ── Server functions ──────────────────────────────────────────────────────────

/** Returns the current account status plus a live, account-scoped Stripe summary. */
export const getConnectAccountStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => StudioInput.parse(input))
  .handler(async ({ data, context }): Promise<ConnectStatusPayload> => {
    await assertStudioFinancialReadAccess((context as any).userId, data.studioId);
    const studio = await loadStudioConnect(data.studioId);
    const connectedData = await loadConnectFinancialSummary(
      data.studioId,
      studio.stripe_connect_account_id,
    );
    return {
      accountId: studio.stripe_connect_account_id ?? null,
      chargesEnabled: studio.stripe_connect_charges_enabled ?? false,
      payoutsEnabled: studio.stripe_connect_payouts_enabled ?? false,
      onboardingCompleted: studio.stripe_connect_onboarding_completed ?? false,
      mbWayPaymentsEnabled: studio.stripe_connect_mb_way_payments_enabled ?? false,
      status: (studio.stripe_connect_status as ConnectAccountStatus) ?? "not_connected",
      responsibility: connectedData.responsibility,
      financial: connectedData.financial,
    };
  });

/**
 * Creates a Stripe Connect Standard/full-dashboard account (if needed) and returns an
 * onboarding link URL. Call this when the studio clicks "Conectar Stripe".
 */
export const createConnectOnboardingLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => StudioInput.parse(input))
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    await assertStudioOwnerAccess(sb(), (context as any).userId, data.studioId, {
      entitlement: "online_payments",
    });
    const studio = await loadStudioConnect(data.studioId);
    const env = connectStripeEnv();
    const stripe = createStripeClient(env);

    let accountId = studio.stripe_connect_account_id;

    // New account creation is enabled only for the explicitly configured model.
    // Existing linked accounts bypass this branch and are never converted or recreated.
    if (!accountId) {
      requireNewConnectAccountModel(process.env.STRIPE_CONNECT_NEW_ACCOUNT_MODEL);
      let account;
      try {
        account = await stripe.accounts.create(
          {
            type: "standard",
            country: "PT",
            default_currency: "eur",
            capabilities: {
              card_payments: { requested: true },
              mb_way_payments: { requested: true },
              transfers: { requested: true },
            } as any,
            metadata: { studio_id: data.studioId },
          },
          {
            idempotencyKey: `bellza-connect:${env}:${data.studioId}:${CONNECT_ACCOUNT_MODEL}`,
          },
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[stripe-connect] accounts.create failed", {
          studioId: data.studioId,
          error: msg,
        });
        throw new Error(`stripe_account_create_failed: ${msg}`);
      }

      accountId = account.id;
      assertNewStandardAccountConfiguration(account, data.studioId);
      await patchStudioConnect(data.studioId, {
        stripe_connect_account_id: accountId,
        stripe_connect_status: "pending",
        stripe_connect_charges_enabled: false,
        stripe_connect_payouts_enabled: false,
        stripe_connect_onboarding_completed: false,
        stripe_connect_mb_way_payments_enabled: false,
      });
    } else {
      await ensureMbWayCapabilityRequested(stripe, accountId);
    }

    const base = appBaseUrl();
    let link;
    try {
      link = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: `${base}/admin/recebimento?connect=refresh`,
        return_url: `${base}/admin/recebimento?connect=success`,
        type: "account_onboarding",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[stripe-connect] accountLinks.create failed", {
        studioId: data.studioId,
        accountId,
        error: msg,
      });
      throw new Error(`stripe_link_create_failed: ${msg}`);
    }

    return { url: link.url };
  });

/**
 * Fetches the latest account status from Stripe and syncs it to the DB.
 * Call this on the return_url page or when the user reopens the dashboard.
 */
export const syncConnectAccountStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => StudioInput.parse(input))
  .handler(async ({ data, context }): Promise<ConnectStatusPayload> => {
    await assertStudioOwnerAccess(sb(), (context as any).userId, data.studioId, {
      entitlement: "online_payments",
    });
    const studio = await loadStudioConnect(data.studioId);

    if (!studio.stripe_connect_account_id) {
      const disconnectedData = await loadConnectFinancialSummary(data.studioId, null);
      return {
        accountId: null,
        chargesEnabled: false,
        payoutsEnabled: false,
        onboardingCompleted: false,
        mbWayPaymentsEnabled: false,
        status: "not_connected",
        financial: disconnectedData.financial,
      };
    }

    const stripe = createStripeClient(connectStripeEnv());
    await ensureMbWayCapabilityRequested(stripe, studio.stripe_connect_account_id);
    const account = await stripe.accounts.retrieve(studio.stripe_connect_account_id);
    const status = deriveStatus(account as any);
    const mbWayPaymentsEnabled = isMbWayPaymentsActive(account as any);
    const responsibility = readConnectedAccountResponsibility(account);

    await patchStudioConnect(data.studioId, {
      stripe_connect_charges_enabled: account.charges_enabled,
      stripe_connect_payouts_enabled: account.payouts_enabled ?? false,
      stripe_connect_onboarding_completed: account.details_submitted ?? false,
      stripe_connect_mb_way_payments_enabled: mbWayPaymentsEnabled,
      stripe_connect_status: status,
    });
    const connectedData = await loadConnectFinancialSummary(
      data.studioId,
      studio.stripe_connect_account_id,
      account as Stripe.Account,
    );

    return {
      accountId: studio.stripe_connect_account_id,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled ?? false,
      onboardingCompleted: account.details_submitted ?? false,
      mbWayPaymentsEnabled,
      status,
      responsibility: connectedData.responsibility ?? {
        ...responsibility,
        compatibleWithStudioPaysFees:
          responsibility.feesPayer === "account" &&
          responsibility.lossesCollector === "stripe",
      },
      financial: connectedData.financial,
    };
  });

/**
 * Opens the appropriate Stripe dashboard for an already-connected account.
 * Express accounts use one-time login links; full-dashboard accounts sign in
 * directly with Stripe and never receive an Express login link.
 */
export const createConnectLoginLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => StudioInput.parse(input))
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    await assertStudioOwnerAccess(sb(), (context as any).userId, data.studioId, {
      entitlement: "online_payments",
    });
    const studio = await loadStudioConnect(data.studioId);

    if (!studio.stripe_connect_account_id) {
      throw new Error("connect_account_not_found");
    }

    const stripe = createStripeClient(connectStripeEnv());
    const account = await stripe.accounts.retrieve(studio.stripe_connect_account_id);
    const responsibility = readConnectedAccountResponsibility(account);
    if (responsibility.dashboardType === "full") {
      return { url: "https://dashboard.stripe.com/" };
    }
    if (responsibility.dashboardType !== "express") {
      throw new Error("connect_dashboard_access_unavailable");
    }
    const link = await stripe.accounts.createLoginLink(studio.stripe_connect_account_id);
    return { url: link.url };
  });

/**
 * Called from the Stripe Connect webhook (account.updated).
 * Syncs account status without requiring studio auth.
 * Only for internal webhook handler use.
 */
export async function syncConnectAccountFromWebhook(stripeAccountId: string) {
  const { data: studio, error } = await sb()
    .from("studios")
    .select("id")
    .eq("stripe_connect_account_id", stripeAccountId)
    .maybeSingle();
  if (error || !studio?.id) return;

  const stripe = createStripeClient(connectStripeEnv());
  await ensureMbWayCapabilityRequested(stripe, stripeAccountId);
  const account = await stripe.accounts.retrieve(stripeAccountId);
  let balance: Awaited<ReturnType<typeof stripe.balance.retrieve>> | undefined;
  try {
    balance = await stripe.balance.retrieve({}, { stripeAccount: stripeAccountId });
  } catch (error) {
    // Account status and capabilities must still converge when an intentionally
    // restricted Test key omits Balance Read. Financial reconciliation remains
    // fail-closed in the payment path until that permission is granted.
    console.warn("[stripe-connect] webhook_balance_read_skipped", {
      accountId: stripeAccountId,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  void balance;
  const status = deriveStatus(account as any);
  const mbWayPaymentsEnabled = isMbWayPaymentsActive(account as any);

  await patchStudioConnect(studio.id, {
    stripe_connect_charges_enabled: account.charges_enabled,
    stripe_connect_payouts_enabled: account.payouts_enabled ?? false,
    stripe_connect_onboarding_completed: account.details_submitted ?? false,
    stripe_connect_mb_way_payments_enabled: mbWayPaymentsEnabled,
    stripe_connect_status: status,
  });
}
