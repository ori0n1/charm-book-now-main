import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertStudioOwnerAccess } from "@/lib/server-security";
import { getAdminClient } from "@/lib/supabase-admin.server";
import { createStripeClient, getConfiguredStripeEnv, resolveStripeAppBaseUrl, type StripeEnv } from "@/lib/stripe.server";
import { readConnectedAccountResponsibility } from "@/lib/stripe-connect-integrity.server";

const StudioInput = z.object({ studioId: z.string().uuid() });

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

const SANDBOX_CONNECT_ACCOUNT_MODEL = "standard_full_v1";

function requireNewConnectAccountModel(env: StripeEnv) {
  if (env !== "sandbox") {
    throw new Error("stripe_connect_new_account_creation_sandbox_only");
  }
  if (process.env.STRIPE_CONNECT_NEW_ACCOUNT_MODEL?.trim() !== SANDBOX_CONNECT_ACCOUNT_MODEL) {
    throw new Error("stripe_connect_new_account_model_not_configured");
  }
  return SANDBOX_CONNECT_ACCOUNT_MODEL;
}

function assertNewStandardAccountConfiguration(
  account: { id: string; livemode?: boolean; type?: string; metadata?: Record<string, string> | null },
  env: StripeEnv,
  studioId: string,
) {
  if (env !== "sandbox" || account.livemode !== false) {
    throw new Error("stripe_connect_created_account_environment_mismatch");
  }
  if (account.type !== "standard" || account.metadata?.studio_id !== studioId) {
    throw new Error("stripe_connect_created_account_identity_mismatch");
  }
  const responsibility = readConnectedAccountResponsibility(account as any);
  if (
    responsibility.feesPayer !== "account" ||
    responsibility.lossesCollector !== "stripe" ||
    responsibility.dashboardType !== "full"
  ) {
    throw new Error("stripe_connect_created_account_controller_incompatible");
  }
  return responsibility;
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

export type ConnectFinancialSummary = {
  availableCents: number;
  pendingCents: number;
  grossReceivedCents: number;
  stripeFeesCents: number;
  netReceivedCents: number;
  stripeFeeSchedule: {
    label: string;
    source: "configured" | "stripe_standard_pt";
  };
  effectiveStripeFeeGrossCents: number;
  effectiveStripeFeeCents: number;
  pendingFinancialDetailsCount: number;
  totalReceivedCents: number;
  paymentCount: number;
  currency: string;
  recentPayments: Array<{
    id: string;
    amountCents: number;
    grossAmountCents: number | null;
    stripeFeeCents: number | null;
    netAmountCents: number | null;
    currency: string;
    method: string | null;
    status: string;
    financialDetailsStatus: string | null;
    stripePaymentIntentId: string | null;
    stripeChargeId: string | null;
    stripeBalanceTransactionId: string | null;
    availableOn: string | null;
    createdAt: string;
  }>;
  payout: {
    scheduleLabel: string | null;
    nextAvailableAt: string | null;
    nextPayoutAt: string | null;
    nextPayoutStatus: string | null;
    nextPayoutAmountCents: number | null;
    lastPayoutAt: string | null;
    lastPayoutStatus: string | null;
    lastPayoutAmountCents: number | null;
  };
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

const RECEIVED_PAYMENT_STATUSES = ["succeeded", "paid", "completed"];
const PENDING_PAYMENT_STATUSES = ["processing", "requires_action", "pending"];

async function refreshMissingConnectedFinancialDetails(
  rows: Array<{
    id: string;
    status: string | null;
    stripe_payment_intent_id?: string | null;
    stripe_connect_account_id?: string | null;
    financial_details_status?: string | null;
    stripe_fee_cents?: number | null;
    gross_amount_cents?: number | null;
    net_amount_cents?: number | null;
    stripe_charge_id?: string | null;
    stripe_balance_transaction_id?: string | null;
    available_on?: string | null;
  }>,
  accountId: string,
) {
  const candidates = rows
    .filter(
      (row) =>
        RECEIVED_PAYMENT_STATUSES.includes(String(row.status ?? "")) &&
        row.stripe_connect_account_id === accountId &&
        row.stripe_payment_intent_id &&
        row.financial_details_status !== "confirmed",
    )
    .slice(0, 8);
  if (!candidates.length) return;

  const stripe = createStripeClient(connectStripeEnv());
  for (const row of candidates) {
    const pi = await stripe.paymentIntents.retrieve(row.stripe_payment_intent_id as string, {}, { stripeAccount: accountId });
    const latestCharge = (pi as any).latest_charge;
    const chargeId = typeof latestCharge === "string" ? latestCharge : latestCharge?.id;
    if (!chargeId) continue;

    const charge = await stripe.charges.retrieve(
      chargeId,
      { expand: ["balance_transaction"] },
      { stripeAccount: accountId },
    );
    const balanceTransaction =
      typeof charge.balance_transaction === "object" && charge.balance_transaction
        ? charge.balance_transaction
        : null;
    if (!balanceTransaction) continue;

    const patch = {
      stripe_charge_id: charge.id,
      stripe_balance_transaction_id: balanceTransaction.id,
      gross_amount_cents: Number(balanceTransaction.amount || charge.amount || pi.amount_received || pi.amount || 0),
      stripe_fee_cents: Number(balanceTransaction.fee || 0),
      net_amount_cents: Number(balanceTransaction.net || 0),
      available_on: balanceTransaction.available_on
        ? new Date(balanceTransaction.available_on * 1000).toISOString()
        : null,
      financial_details_status: "confirmed",
      updated_at: new Date().toISOString(),
    };

    const { error } = await sb().from("payment_intents").update(patch).eq("id", row.id);
    if (error) throw new Error(error.message);
    Object.assign(row, patch);
  }
}

async function loadConnectFinancialSummary(studioId: string, accountId?: string | null): Promise<ConnectFinancialSummary> {
  const { data: payments, error } = await sb()
    .from("payment_intents")
    .select("id,amount_cents,currency,method,status,created_at,stripe_payment_intent_id,stripe_connect_account_id,stripe_charge_id,stripe_balance_transaction_id,gross_amount_cents,stripe_fee_cents,net_amount_cents,available_on,financial_details_status")
    .eq("studio_id", studioId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);

  const rows = (payments ?? []) as Array<{
    id: string;
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
  }>;
  const received = rows.filter((row) => RECEIVED_PAYMENT_STATUSES.includes(String(row.status ?? "")));
  const pending = rows.filter((row) => PENDING_PAYMENT_STATUSES.includes(String(row.status ?? "")));
  const currency = String(received[0]?.currency ?? rows[0]?.currency ?? "eur").toLowerCase();
  let availableCents = received.reduce((sum, row) => sum + Number(row.amount_cents || 0), 0);
  let pendingCents = pending.reduce((sum, row) => sum + Number(row.amount_cents || 0), 0);
  let scheduleLabel: string | null = null;
  let nextAvailableAt: string | null = null;
  let nextPayoutAt: string | null = null;
  let nextPayoutStatus: string | null = null;
  let nextPayoutAmountCents: number | null = null;
  let lastPayoutAt: string | null = null;
  let lastPayoutStatus: string | null = null;
  let lastPayoutAmountCents: number | null = null;
  const scopedRows = accountId
    ? rows.filter((row) => row.stripe_connect_account_id === accountId)
    : rows.filter((row) => !row.stripe_connect_account_id);
  const scopedReceived = scopedRows.filter((row) => RECEIVED_PAYMENT_STATUSES.includes(String(row.status ?? "")));

  if (accountId) {
    await refreshMissingConnectedFinancialDetails(rows, accountId).catch((err) => {
      console.warn("[stripe-connect] financial details refresh skipped", {
        studioId,
        accountId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  if (accountId) {
    try {
      const stripe = createStripeClient(connectStripeEnv());
      const [balance, account, payouts, balanceTransactions] = await Promise.all([
        stripe.balance.retrieve({}, { stripeAccount: accountId }),
        stripe.accounts.retrieve(accountId),
        stripe.payouts.list({ limit: 10 }, { stripeAccount: accountId }),
        stripe.balanceTransactions.list({ limit: 100 }, { stripeAccount: accountId }),
      ]);
      const availableForCurrency = balance.available.find((item) => item.currency === currency) ?? balance.available[0];
      const pendingForCurrency = balance.pending.find((item) => item.currency === currency) ?? balance.pending[0];
      if (availableForCurrency) availableCents = Number(availableForCurrency.amount || 0);
      if (pendingForCurrency) pendingCents = Number(pendingForCurrency.amount || 0);

      const payoutsSchedule = (account as any).settings?.payouts?.schedule;
      scheduleLabel = formatPayoutSchedule(payoutsSchedule);
      const pendingAvailability = balanceTransactions.data
        .filter((item) => item.currency === currency && item.status === "pending" && Number(item.net || 0) > 0 && item.available_on)
        .map((item) => Number(item.available_on))
        .filter((value) => Number.isFinite(value) && value > 0)
        .sort((a, b) => a - b);
      nextAvailableAt = pendingAvailability[0] ? new Date(pendingAvailability[0] * 1000).toISOString() : null;
      const nextPayout = payouts.data.find((item) => ["pending", "in_transit"].includes(String(item.status)));
      if (nextPayout) {
        nextPayoutAt = nextPayout.arrival_date ? new Date(nextPayout.arrival_date * 1000).toISOString() : null;
        nextPayoutStatus = String(nextPayout.status ?? "");
        nextPayoutAmountCents = Number(nextPayout.amount || 0);
      }
      const lastPayout = payouts.data.find((item) => item.status === "paid") ?? payouts.data[0];
      if (lastPayout) {
        lastPayoutAt = lastPayout.arrival_date ? new Date(lastPayout.arrival_date * 1000).toISOString() : null;
        lastPayoutStatus = String(lastPayout.status ?? "");
        lastPayoutAmountCents = Number(lastPayout.amount || 0);
      }
    } catch (err) {
      console.warn("[stripe-connect] optional balance summary failed", {
        studioId,
        accountId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const confirmedFinancialRows = scopedReceived.filter(
    (row) => Number(row.gross_amount_cents ?? 0) > 0 && row.stripe_fee_cents != null,
  );
  const effectiveStripeFeeGrossCents = confirmedFinancialRows.reduce(
    (sum, row) => sum + Number(row.gross_amount_cents ?? 0),
    0,
  );
  const effectiveStripeFeeCents = confirmedFinancialRows.reduce(
    (sum, row) => sum + Number(row.stripe_fee_cents ?? 0),
    0,
  );
  const stripeFeeSchedule = getStripeFeeSchedule();

  return {
    availableCents,
    pendingCents,
    grossReceivedCents: confirmedFinancialRows.reduce(
      (sum, row) => sum + Number(row.gross_amount_cents ?? 0),
      0,
    ),
    stripeFeesCents: confirmedFinancialRows.reduce((sum, row) => sum + Number(row.stripe_fee_cents ?? 0), 0),
    netReceivedCents: confirmedFinancialRows.reduce(
      (sum, row) => sum + Number(row.net_amount_cents ?? 0),
      0,
    ),
    stripeFeeSchedule,
    effectiveStripeFeeGrossCents,
    effectiveStripeFeeCents,
    pendingFinancialDetailsCount: scopedReceived.filter((row) => row.financial_details_status !== "confirmed").length,
    totalReceivedCents: confirmedFinancialRows.reduce((sum, row) => sum + Number(row.gross_amount_cents ?? 0), 0),
    paymentCount: scopedReceived.length,
    currency,
    recentPayments: scopedReceived.slice(0, 5).map((row) => ({
      id: row.id,
      amountCents: Number(row.amount_cents || 0),
      grossAmountCents: row.gross_amount_cents ?? null,
      stripeFeeCents: row.stripe_fee_cents ?? null,
      netAmountCents: row.net_amount_cents ?? null,
      currency: String(row.currency ?? currency).toLowerCase(),
      method: row.method,
      status: String(row.status ?? ""),
      financialDetailsStatus: row.financial_details_status ?? null,
      stripePaymentIntentId: row.stripe_payment_intent_id ?? null,
      stripeChargeId: row.stripe_charge_id ?? null,
      stripeBalanceTransactionId: row.stripe_balance_transaction_id ?? null,
      availableOn: row.available_on ?? null,
      createdAt: row.created_at ?? new Date(0).toISOString(),
    })),
    payout: {
      scheduleLabel,
      nextAvailableAt,
      nextPayoutAt,
      nextPayoutStatus,
      nextPayoutAmountCents,
      lastPayoutAt,
      lastPayoutStatus,
      lastPayoutAmountCents,
    },
  };
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

/**
 * Returns the current Stripe Connect status for a studio.
 * Reads only from the database — no Stripe API call.
 */
export const getConnectAccountStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => StudioInput.parse(input))
  .handler(async ({ data, context }): Promise<ConnectStatusPayload> => {
    await assertStudioOwnerAccess(sb(), (context as any).userId, data.studioId, {
      entitlement: "online_payments",
    });
    const studio = await loadStudioConnect(data.studioId);
    return {
      accountId: studio.stripe_connect_account_id ?? null,
      chargesEnabled: studio.stripe_connect_charges_enabled ?? false,
      payoutsEnabled: studio.stripe_connect_payouts_enabled ?? false,
      onboardingCompleted: studio.stripe_connect_onboarding_completed ?? false,
      mbWayPaymentsEnabled: studio.stripe_connect_mb_way_payments_enabled ?? false,
      status: (studio.stripe_connect_status as ConnectAccountStatus) ?? "not_connected",
      financial: await loadConnectFinancialSummary(data.studioId, studio.stripe_connect_account_id),
    };
  });

/**
 * Creates a Stripe Connect Standard/full-dashboard test account (if needed) and returns an
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

    // New account creation is deliberately sandbox-only. Existing linked
    // accounts bypass this branch and are never converted or recreated.
    if (!accountId) {
      requireNewConnectAccountModel(env);
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
            idempotencyKey: `bellza-connect:${env}:${data.studioId}:${SANDBOX_CONNECT_ACCOUNT_MODEL}`,
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
      assertNewStandardAccountConfiguration(account, env, data.studioId);
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
      return {
        accountId: null,
        chargesEnabled: false,
        payoutsEnabled: false,
        onboardingCompleted: false,
        mbWayPaymentsEnabled: false,
        status: "not_connected",
        financial: await loadConnectFinancialSummary(data.studioId, null),
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

    return {
      accountId: studio.stripe_connect_account_id,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled ?? false,
      onboardingCompleted: account.details_submitted ?? false,
      mbWayPaymentsEnabled,
      status,
      responsibility: {
        ...responsibility,
        compatibleWithStudioPaysFees:
          responsibility.feesPayer === "account" &&
          responsibility.lossesCollector === "stripe",
      },
      financial: await loadConnectFinancialSummary(data.studioId, studio.stripe_connect_account_id),
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
