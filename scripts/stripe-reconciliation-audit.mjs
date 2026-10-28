import fs from "node:fs";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

function loadDotEnv(path) {
  if (!fs.existsSync(path)) return;
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (process.env[key]) continue;
    process.env[key] = rest.join("=").replace(/^["']|["']$/g, "");
  }
}

loadDotEnv(".env.local");
loadDotEnv(".env");

const configurationFailures = [];
const discrepancies = [];
const warnings = [];

function required(key) {
  const value = process.env[key]?.trim();
  if (!value) configurationFailures.push(`${key} is required`);
  return value ?? "";
}

function expectConfiguration(condition, message) {
  if (!condition) configurationFailures.push(message);
}

function discrepancy(code, entity, expected, actual) {
  discrepancies.push({ code, entity, expected, actual });
}

function ids(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function objectId(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof value.id === "string") return value.id;
  return null;
}

function currentPeriodEnd(subscription) {
  const direct = Number(subscription.current_period_end ?? 0);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const item = Number(subscription.items?.data?.[0]?.current_period_end ?? 0);
  return Number.isFinite(item) && item > 0 ? item : null;
}

function unixSeconds(value) {
  if (!value) return null;
  const milliseconds = new Date(value).getTime();
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : null;
}

function paymentStatusMatches(databaseStatus, stripeStatus) {
  const accepted = {
    succeeded: new Set(["succeeded", "paid", "completed"]),
    processing: new Set(["processing", "pending"]),
    requires_action: new Set(["requires_action"]),
    requires_capture: new Set(["requires_capture"]),
    requires_confirmation: new Set(["requires_confirmation"]),
    requires_payment_method: new Set(["requires_payment_method", "failed"]),
    canceled: new Set(["canceled", "cancelled"]),
  };
  return accepted[stripeStatus]?.has(String(databaseStatus ?? "").toLowerCase()) ?? false;
}

async function selectRows(query, label) {
  const { data, error, count } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return { rows: data ?? [], count: count ?? data?.length ?? 0 };
}

const stripeEnv = process.env.STRIPE_ENV?.trim();
const stripeKey = required("STRIPE_SANDBOX_API_KEY");
const supabaseUrl = required("STRIPE_RECONCILIATION_SUPABASE_URL");
const supabaseKey = required("STRIPE_RECONCILIATION_SUPABASE_SERVICE_ROLE_KEY");
const expectedProjectRef = required("STRIPE_RECONCILIATION_EXPECTED_SUPABASE_PROJECT_REF");
const studioIds = ids(required("STRIPE_RECONCILIATION_STUDIO_IDS"));
const connectedAccountIds = ids(required("STRIPE_SANDBOX_CONNECTED_ACCOUNT_IDS"));
const canonicalPriceIds = new Set(
  [
    required("STRIPE_SANDBOX_PRICE_PRO_MONTHLY"),
    required("STRIPE_SANDBOX_PRICE_PRO_YEARLY"),
    required("STRIPE_SANDBOX_PRICE_PREMIUM_MONTHLY"),
    required("STRIPE_SANDBOX_PRICE_PREMIUM_YEARLY"),
  ].filter(Boolean),
);
const paymentLimit = Math.min(
  Math.max(Number.parseInt(process.env.STRIPE_RECONCILIATION_PAYMENT_LIMIT ?? "100", 10) || 100, 1),
  500,
);

expectConfiguration(stripeEnv === "sandbox", "STRIPE_ENV must equal sandbox");
expectConfiguration(/^(sk|rk)_test_/i.test(stripeKey), "Stripe reconciliation requires a test key");
expectConfiguration(!/^(sk|rk)_live_/i.test(stripeKey), "LIVE Stripe keys are forbidden");
expectConfiguration(studioIds.length >= 2, "At least two staging studio IDs are required");
expectConfiguration(
  new Set(studioIds).size === studioIds.length,
  "Staging studio IDs must be unique",
);
expectConfiguration(
  connectedAccountIds.length >= 2,
  "At least two sandbox Connected Accounts are required",
);
expectConfiguration(
  new Set(connectedAccountIds).size === connectedAccountIds.length,
  "Sandbox Connected Account IDs must be unique",
);
expectConfiguration(
  canonicalPriceIds.size === 4,
  "Four distinct canonical sandbox Price IDs are required",
);

let supabaseHost = "";
try {
  const parsed = new URL(supabaseUrl);
  expectConfiguration(parsed.protocol === "https:", "Staging Supabase URL must use HTTPS");
  supabaseHost = parsed.hostname.toLowerCase();
} catch {
  configurationFailures.push("STRIPE_RECONCILIATION_SUPABASE_URL must be a valid URL");
}
expectConfiguration(
  Boolean(expectedProjectRef) && supabaseHost === `${expectedProjectRef.toLowerCase()}.supabase.co`,
  "Supabase URL does not match the explicitly expected staging project ref",
);
try {
  const wranglerConfig = fs.readFileSync("wrangler.jsonc", "utf8");
  const productionUrl = wranglerConfig.match(/"VITE_SUPABASE_URL"\s*:\s*"([^"]+)"/)?.[1];
  if (!productionUrl) throw new Error("missing_production_project_url");
  expectConfiguration(
    supabaseHost !== new URL(productionUrl).hostname.toLowerCase(),
    "Reconciliation target matches the production Supabase project in wrangler.jsonc",
  );
} catch {
  configurationFailures.push(
    "Cannot verify the production Supabase project guard from wrangler.jsonc",
  );
}

if (configurationFailures.length > 0) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        phase: "configuration",
        mode: "sandbox-read-only-reconciliation",
        mutated_stripe_objects: 0,
        mutated_supabase_rows: 0,
        failures: configurationFailures,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

const stripe = new Stripe(stripeKey, { apiVersion: "2026-03-25.dahlia" });
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

try {
  const [{ rows: studios }, { rows: subscriptions }, paymentsResult] = await Promise.all([
    selectRows(
      supabase
        .from("studios")
        .select(
          "id,stripe_customer_id,stripe_subscription_id,subscription_status,subscription_current_period_end,stripe_connect_account_id",
        )
        .in("id", studioIds),
      "studios",
    ),
    selectRows(
      supabase
        .from("subscriptions")
        .select(
          "id,studio_id,stripe_customer_id,stripe_subscription_id,stripe_price_id,plan,status,current_period_end,cancel_at_period_end",
        )
        .in("studio_id", studioIds),
      "subscriptions",
    ),
    selectRows(
      supabase
        .from("payment_intents")
        .select(
          "id,studio_id,appointment_id,booking_request_id,amount_cents,currency,status,stripe_payment_intent_id,stripe_connect_account_id,stripe_charge_id,stripe_balance_transaction_id,gross_amount_cents,stripe_fee_cents,net_amount_cents,financial_details_status,refund_status,refunded_amount_cents,stripe_dispute_id,dispute_status,disputed_amount_cents,created_at",
          { count: "exact" },
        )
        .in("studio_id", studioIds)
        .not("stripe_payment_intent_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(paymentLimit),
      "payment_intents",
    ),
  ]);

  if (studios.length !== studioIds.length) {
    discrepancy("staging_studio_scope_incomplete", "studios", studioIds.length, studios.length);
  }
  if (paymentsResult.count > paymentsResult.rows.length) {
    warnings.push({
      code: "payment_scope_truncated",
      total: paymentsResult.count,
      audited: paymentsResult.rows.length,
      limit: paymentLimit,
    });
  }

  const studiosById = new Map(studios.map((studio) => [studio.id, studio]));
  const subscriptionEvidence = [];
  const subscriptionRowsById = new Map(
    subscriptions.map((subscription) => [subscription.stripe_subscription_id, subscription]),
  );
  const stagingAccountIds = studios
    .map((studio) => studio.stripe_connect_account_id)
    .filter(Boolean);

  if (new Set(stagingAccountIds).size !== stagingAccountIds.length) {
    discrepancy(
      "connected_account_reused_between_studios",
      "studios",
      "one unique account per studio",
      stagingAccountIds,
    );
  }
  for (const studio of studios) {
    if (!connectedAccountIds.includes(studio.stripe_connect_account_id)) {
      discrepancy(
        "studio_connected_account_outside_sandbox_scope",
        studio.id,
        connectedAccountIds,
        studio.stripe_connect_account_id,
      );
    }
  }

  for (const studio of studios) {
    const subscriptionId = String(studio.stripe_subscription_id ?? "");
    if (subscriptionId.startsWith("sub_") && !subscriptionRowsById.has(subscriptionId)) {
      discrepancy("studio_subscription_row_missing", studio.id, subscriptionId, null);
    }
  }

  for (const row of subscriptions) {
    const entity = row.stripe_subscription_id;
    const studio = studiosById.get(row.studio_id);
    if (!studio) {
      discrepancy("subscription_studio_outside_scope", entity, row.studio_id, null);
      continue;
    }
    if (!String(entity).startsWith("sub_")) {
      discrepancy("invalid_subscription_id", row.id, "sub_*", entity);
      continue;
    }
    const subscription = await stripe.subscriptions.retrieve(entity, {
      expand: ["latest_invoice"],
    });
    const customerId = objectId(subscription.customer);
    const priceId = subscription.items.data[0]?.price?.id ?? null;
    const latestInvoice =
      subscription.latest_invoice && typeof subscription.latest_invoice === "object"
        ? subscription.latest_invoice
        : null;
    const stripePeriodEnd = currentPeriodEnd(subscription);
    const databasePeriodEnd = unixSeconds(row.current_period_end);

    if (subscription.livemode) discrepancy("billing_object_is_live", entity, false, true);
    if (customerId !== row.stripe_customer_id) {
      discrepancy("subscription_customer_mismatch", entity, row.stripe_customer_id, customerId);
    }
    if (studio.stripe_customer_id && customerId !== studio.stripe_customer_id) {
      discrepancy("studio_customer_mismatch", studio.id, studio.stripe_customer_id, customerId);
    }
    const isCurrentSubscription = studio.stripe_subscription_id === entity;
    if (!isCurrentSubscription && ["active", "trialing"].includes(subscription.status)) {
      discrepancy("active_subscription_not_current", entity, studio.stripe_subscription_id, entity);
    }
    if (priceId !== row.stripe_price_id) {
      discrepancy("subscription_price_mismatch", entity, row.stripe_price_id, priceId);
    }
    if (!priceId || !canonicalPriceIds.has(priceId)) {
      discrepancy("subscription_price_not_canonical", entity, [...canonicalPriceIds], priceId);
    }
    if (subscription.status !== row.status) {
      discrepancy("subscription_status_mismatch", entity, row.status, subscription.status);
    }
    if (
      isCurrentSubscription &&
      studio.subscription_status &&
      subscription.status !== studio.subscription_status
    ) {
      discrepancy(
        "studio_subscription_status_mismatch",
        studio.id,
        studio.subscription_status,
        subscription.status,
      );
    }
    if (
      stripePeriodEnd !== databasePeriodEnd &&
      Math.abs((stripePeriodEnd ?? 0) - (databasePeriodEnd ?? 0)) > 1
    ) {
      discrepancy("subscription_period_end_mismatch", entity, databasePeriodEnd, stripePeriodEnd);
    }
    if (Boolean(subscription.cancel_at_period_end) !== Boolean(row.cancel_at_period_end)) {
      discrepancy(
        "subscription_cancel_flag_mismatch",
        entity,
        Boolean(row.cancel_at_period_end),
        Boolean(subscription.cancel_at_period_end),
      );
    }
    if (subscription.metadata?.studio_id && subscription.metadata.studio_id !== row.studio_id) {
      discrepancy(
        "subscription_metadata_tenant_mismatch",
        entity,
        row.studio_id,
        subscription.metadata.studio_id,
      );
    }
    if (!subscription.metadata?.studio_id) {
      warnings.push({ code: "subscription_metadata_studio_missing", entity });
    }

    subscriptionEvidence.push({
      studio_id: row.studio_id,
      subscription_id: entity,
      customer_id: customerId,
      price_id: priceId,
      status: subscription.status,
      current_period_end: stripePeriodEnd,
      latest_invoice_id: latestInvoice?.id ?? objectId(subscription.latest_invoice),
      latest_invoice_status: latestInvoice?.status ?? null,
      latest_invoice_amount_paid_cents: latestInvoice?.amount_paid ?? null,
      latest_invoice_currency: latestInvoice?.currency ?? null,
      owner_scope: "bellza_platform",
      livemode: subscription.livemode,
    });
  }

  const directChargeEvidence = [];
  const accountUsage = new Map();

  for (const row of paymentsResult.rows) {
    const entity = row.stripe_payment_intent_id;
    const studio = studiosById.get(row.studio_id);
    const accountId = row.stripe_connect_account_id;
    if (!studio) {
      discrepancy("payment_studio_outside_scope", entity, row.studio_id, null);
      continue;
    }
    if (!accountId || accountId !== studio.stripe_connect_account_id) {
      discrepancy(
        "payment_connected_account_mismatch",
        entity,
        studio.stripe_connect_account_id,
        accountId,
      );
      continue;
    }
    if (!connectedAccountIds.includes(accountId)) {
      discrepancy("payment_account_not_in_sandbox_scope", entity, connectedAccountIds, accountId);
      continue;
    }
    if (!String(entity).startsWith("pi_")) {
      discrepancy("invalid_payment_intent_id", row.id, "pi_*", entity);
      continue;
    }
    accountUsage.set(accountId, (accountUsage.get(accountId) ?? 0) + 1);

    const paymentIntent = await stripe.paymentIntents.retrieve(
      entity,
      { expand: ["latest_charge.balance_transaction"] },
      { stripeAccount: accountId },
    );
    let charge =
      paymentIntent.latest_charge && typeof paymentIntent.latest_charge === "object"
        ? paymentIntent.latest_charge
        : null;
    const chargeId = objectId(paymentIntent.latest_charge);
    if (!charge && chargeId) {
      charge = await stripe.charges.retrieve(
        chargeId,
        { expand: ["balance_transaction"] },
        { stripeAccount: accountId },
      );
    }
    const balanceTransaction =
      charge?.balance_transaction && typeof charge.balance_transaction === "object"
        ? charge.balance_transaction
        : null;

    if (paymentIntent.livemode) discrepancy("direct_charge_is_live", entity, false, true);
    if (paymentIntent.amount !== row.amount_cents) {
      discrepancy("payment_amount_mismatch", entity, row.amount_cents, paymentIntent.amount);
    }
    if (paymentIntent.currency !== String(row.currency).toLowerCase()) {
      discrepancy(
        "payment_currency_mismatch",
        entity,
        String(row.currency).toLowerCase(),
        paymentIntent.currency,
      );
    }
    if (!paymentStatusMatches(row.status, paymentIntent.status)) {
      discrepancy("payment_status_mismatch", entity, row.status, paymentIntent.status);
    }
    if (paymentIntent.metadata?.studio_id !== row.studio_id) {
      discrepancy(
        "payment_metadata_tenant_mismatch",
        entity,
        row.studio_id,
        paymentIntent.metadata?.studio_id ?? null,
      );
    }
    if (
      row.booking_request_id &&
      paymentIntent.metadata?.booking_request_id !== row.booking_request_id
    ) {
      discrepancy(
        "payment_booking_mismatch",
        entity,
        row.booking_request_id,
        paymentIntent.metadata?.booking_request_id ?? null,
      );
    }
    if (row.appointment_id && paymentIntent.metadata?.appointment_id !== row.appointment_id) {
      discrepancy(
        "payment_appointment_mismatch",
        entity,
        row.appointment_id,
        paymentIntent.metadata?.appointment_id ?? null,
      );
    }
    if (Number(paymentIntent.application_fee_amount ?? 0) !== 0) {
      discrepancy(
        "payment_intent_application_fee_nonzero",
        entity,
        0,
        paymentIntent.application_fee_amount,
      );
    }
    if (charge && Number(charge.application_fee_amount ?? 0) !== 0) {
      discrepancy("charge_application_fee_nonzero", charge.id, 0, charge.application_fee_amount);
    }
    if (row.stripe_charge_id && chargeId !== row.stripe_charge_id) {
      discrepancy("charge_id_mismatch", entity, row.stripe_charge_id, chargeId);
    }
    if (paymentIntent.status === "succeeded") {
      if (!chargeId || !charge) {
        discrepancy("successful_charge_missing", entity, "Charge", chargeId);
      }
      if (!balanceTransaction) {
        discrepancy("successful_balance_transaction_missing", entity, "Balance Transaction", null);
      }
      if (!row.stripe_charge_id || !row.stripe_balance_transaction_id) {
        discrepancy(
          "successful_financial_ids_missing_in_database",
          entity,
          "Charge and Balance Transaction IDs",
          {
            charge_id: row.stripe_charge_id,
            balance_transaction_id: row.stripe_balance_transaction_id,
          },
        );
      }
      if (row.financial_details_status !== "confirmed") {
        discrepancy(
          "successful_financial_details_unconfirmed",
          entity,
          "confirmed",
          row.financial_details_status,
        );
      }
    }
    if (
      row.stripe_balance_transaction_id &&
      balanceTransaction?.id !== row.stripe_balance_transaction_id
    ) {
      discrepancy(
        "balance_transaction_id_mismatch",
        entity,
        row.stripe_balance_transaction_id,
        balanceTransaction?.id ?? null,
      );
    }
    if (balanceTransaction) {
      const comparisons = [
        ["gross_amount_mismatch", row.gross_amount_cents, balanceTransaction.amount],
        ["stripe_fee_mismatch", row.stripe_fee_cents, balanceTransaction.fee],
        ["net_amount_mismatch", row.net_amount_cents, balanceTransaction.net],
      ];
      for (const [code, stored, actual] of comparisons) {
        if (stored == null || Number(stored) !== Number(actual)) {
          discrepancy(code, entity, stored == null ? null : Number(stored), Number(actual));
        }
      }
      if (balanceTransaction.currency !== paymentIntent.currency) {
        discrepancy(
          "balance_transaction_currency_mismatch",
          entity,
          paymentIntent.currency,
          balanceTransaction.currency,
        );
      }
    }
    if (charge && Number(row.refunded_amount_cents ?? 0) !== Number(charge.amount_refunded ?? 0)) {
      discrepancy(
        "refunded_amount_mismatch",
        entity,
        Number(row.refunded_amount_cents ?? 0),
        Number(charge.amount_refunded ?? 0),
      );
    }

    let dispute = null;
    if (row.stripe_dispute_id) {
      dispute = await stripe.disputes.retrieve(
        row.stripe_dispute_id,
        {},
        { stripeAccount: accountId },
      );
      if (dispute.status !== row.dispute_status) {
        discrepancy(
          "dispute_status_mismatch",
          row.stripe_dispute_id,
          row.dispute_status,
          dispute.status,
        );
      }
      if (Number(dispute.amount) !== Number(row.disputed_amount_cents ?? 0)) {
        discrepancy(
          "disputed_amount_mismatch",
          row.stripe_dispute_id,
          Number(row.disputed_amount_cents ?? 0),
          Number(dispute.amount),
        );
      }
    } else if (charge?.disputed) {
      discrepancy("stripe_dispute_missing_in_database", charge.id, "stored dispute ID", null);
    }

    directChargeEvidence.push({
      studio_id: row.studio_id,
      connected_account_id: accountId,
      payment_intent_id: entity,
      payment_status: paymentIntent.status,
      amount_cents: paymentIntent.amount,
      currency: paymentIntent.currency,
      charge_id: chargeId,
      balance_transaction_id: balanceTransaction?.id ?? null,
      gross_cents: balanceTransaction?.amount ?? null,
      stripe_fee_cents: balanceTransaction?.fee ?? null,
      net_cents: balanceTransaction?.net ?? null,
      refunded_cents: charge?.amount_refunded ?? 0,
      dispute_id: dispute?.id ?? null,
      dispute_status: dispute?.status ?? null,
      application_fee_bellza_cents: Number(
        charge?.application_fee_amount ?? paymentIntent.application_fee_amount ?? 0,
      ),
      owner_scope: "connected_account",
      livemode: paymentIntent.livemode,
    });
  }

  for (const accountId of connectedAccountIds) {
    if (!accountUsage.has(accountId)) {
      discrepancy(
        "connected_account_without_payment_evidence",
        accountId,
        "at least one PaymentIntent",
        0,
      );
    }
  }
  if (subscriptionEvidence.length === 0) {
    discrepancy(
      "billing_evidence_missing",
      "subscriptions",
      "at least one sandbox subscription",
      0,
    );
  }
  if (directChargeEvidence.length === 0) {
    discrepancy(
      "direct_charge_evidence_missing",
      "payment_intents",
      "at least one sandbox Direct Charge",
      0,
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: discrepancies.length === 0,
        mode: "sandbox-read-only-reconciliation",
        mutated_stripe_objects: 0,
        mutated_supabase_rows: 0,
        scope: {
          staging_project_ref: expectedProjectRef,
          studio_count: studios.length,
          subscription_count: subscriptions.length,
          payment_count: paymentsResult.rows.length,
          payment_total_in_scope: paymentsResult.count,
        },
        evidence: {
          billing: subscriptionEvidence,
          direct_charges: directChargeEvidence,
        },
        warnings,
        discrepancies,
      },
      null,
      2,
    ),
  );
  if (discrepancies.length > 0) process.exitCode = 2;
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        phase: "read_only_reconciliation",
        mode: "sandbox-read-only-reconciliation",
        mutated_stripe_objects: 0,
        mutated_supabase_rows: 0,
        error: error instanceof Error ? error.message : "unknown_error",
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
