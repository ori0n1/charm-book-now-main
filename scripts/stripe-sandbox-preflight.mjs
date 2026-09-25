import fs from "node:fs";
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

const failures = [];
const requireEnv = (key) => {
  const value = process.env[key]?.trim();
  if (!value) failures.push(`${key} is required`);
  return value ?? "";
};
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};
const idRef = (value) => (value ? `…${value.slice(-8)}` : "missing");

expect(process.env.STRIPE_ENV === "sandbox", "STRIPE_ENV must equal sandbox");
expect(
  process.env.STRIPE_CONNECT_NEW_ACCOUNT_MODEL === "standard_full_v1",
  "STRIPE_CONNECT_NEW_ACCOUNT_MODEL must equal standard_full_v1",
);
const apiKey = requireEnv("STRIPE_SANDBOX_API_KEY");
expect(/^(sk|rk)_test_/i.test(apiKey), "STRIPE_SANDBOX_API_KEY must be a test key");
expect(!/^(sk|rk)_live_/i.test(apiKey), "A LIVE Stripe key is forbidden in sandbox preflight");

const platformWebhookSecret = requireEnv("STRIPE_SANDBOX_PLATFORM_WEBHOOK_SECRET");
const connectWebhookSecret = requireEnv("STRIPE_SANDBOX_CONNECT_WEBHOOK_SECRET");
expect(/^whsec_/i.test(platformWebhookSecret), "Platform webhook secret must start with whsec_");
expect(/^whsec_/i.test(connectWebhookSecret), "Connect webhook secret must start with whsec_");
expect(
  platformWebhookSecret !== connectWebhookSecret,
  "Platform and Connect webhook signing secrets must be distinct",
);

const platformEndpointId = requireEnv("STRIPE_SANDBOX_PLATFORM_WEBHOOK_ENDPOINT_ID");
const connectEndpointId = requireEnv("STRIPE_SANDBOX_CONNECT_WEBHOOK_ENDPOINT_ID");
expect(platformEndpointId !== connectEndpointId, "Platform and Connect endpoint IDs must be distinct");
const expectedWebhookUrl = requireEnv("STRIPE_SANDBOX_WEBHOOK_URL");

const planSpecs = [
  ["pro_monthly", "STRIPE_SANDBOX_PRICE_PRO_MONTHLY", 1_299, "month"],
  ["pro_yearly", "STRIPE_SANDBOX_PRICE_PRO_YEARLY", 12_900, "year"],
  ["premium_monthly", "STRIPE_SANDBOX_PRICE_PREMIUM_MONTHLY", 2_499, "month"],
  ["premium_yearly", "STRIPE_SANDBOX_PRICE_PREMIUM_YEARLY", 24_900, "year"],
].map(([plan, key, amount, interval]) => ({
  plan,
  key,
  priceId: requireEnv(key),
  amount,
  interval,
}));

const connectedAccountIds = requireEnv("STRIPE_SANDBOX_CONNECTED_ACCOUNT_IDS")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
expect(connectedAccountIds.length >= 2, "At least two sandbox Connected Accounts are required");
expect(new Set(connectedAccountIds).size === connectedAccountIds.length, "Connected Account IDs must be unique");

if (failures.length > 0) {
  console.error(JSON.stringify({ ok: false, phase: "configuration", failures }, null, 2));
  process.exit(1);
}

const stripe = new Stripe(apiKey, { apiVersion: "2026-03-25.dahlia" });
const platformEvents = [
  "checkout.session.completed",
  "checkout.session.expired",
  "invoice.paid",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
];
const connectEvents = [
  "payment_intent.succeeded",
  "payment_intent.processing",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
  "charge.refunded",
  "refund.created",
  "refund.updated",
  "refund.failed",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated",
  "account.updated",
  "balance.available",
  "payout.created",
  "payout.paid",
  "payout.failed",
  "payout.canceled",
];

function missingEvents(endpoint, required) {
  if (endpoint.enabled_events.includes("*")) return [];
  return required.filter((event) => !endpoint.enabled_events.includes(event));
}

try {
  const [prices, accounts, platformEndpoint, connectEndpoint] = await Promise.all([
    Promise.all(planSpecs.map(async (spec) => ({ spec, price: await stripe.prices.retrieve(spec.priceId) }))),
    Promise.all(connectedAccountIds.map(async (accountId) => {
      const [account, balance] = await Promise.all([
        stripe.accounts.retrieve(accountId),
        stripe.balance.retrieve({}, { stripeAccount: accountId }),
      ]);
      return { account, balance };
    })),
    stripe.webhookEndpoints.retrieve(platformEndpointId),
    stripe.webhookEndpoints.retrieve(connectEndpointId),
  ]);

  const priceReport = prices.map(({ spec, price }) => {
    const valid =
      price.livemode === false &&
      price.active === true &&
      price.currency === "eur" &&
      price.unit_amount === spec.amount &&
      price.recurring?.interval === spec.interval &&
      (price.recurring?.interval_count ?? 1) === 1;
    expect(valid, `${spec.plan} Price does not match Bellza's canonical amount/interval/test mode`);
    return {
      plan: spec.plan,
      price: idRef(price.id),
      amount_cents: price.unit_amount,
      currency: price.currency,
      interval: price.recurring?.interval ?? null,
      livemode: price.livemode,
      valid,
    };
  });

  const accountReport = accounts.map(({ account, balance }) => {
    const controller = account.controller;
    const capabilities = account.capabilities ?? {};
    const available = balance.available
      .filter((entry) => entry.currency === "eur")
      .reduce((sum, entry) => sum + entry.amount, 0);
    const pending = balance.pending
      .filter((entry) => entry.currency === "eur")
      .reduce((sum, entry) => sum + entry.amount, 0);
    const compatible =
      account.livemode === false &&
      account.type === "standard" &&
      account.details_submitted === true &&
      account.charges_enabled === true &&
      account.payouts_enabled === true &&
      !account.requirements?.disabled_reason &&
      capabilities.card_payments === "active" &&
      capabilities.mb_way_payments === "active" &&
      controller?.fees?.payer === "account" &&
      controller?.losses?.payments === "stripe" &&
      controller?.stripe_dashboard?.type === "full";
    expect(compatible, `Connected Account ${idRef(account.id)} is economically or operationally incompatible`);
    return {
      account: idRef(account.id),
      livemode: account.livemode,
      account_type: account.type,
      details_submitted: account.details_submitted,
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      disabled_reason: account.requirements?.disabled_reason ?? null,
      card_payments: capabilities.card_payments ?? null,
      mb_way_payments: capabilities.mb_way_payments ?? null,
      fees_payer: controller?.fees?.payer ?? null,
      losses_payments: controller?.losses?.payments ?? null,
      dashboard: controller?.stripe_dashboard?.type ?? null,
      available_eur_cents: available,
      pending_eur_cents: pending,
      compatible,
    };
  });

  const endpointReport = [
    ["platform", platformEndpoint, platformEvents],
    ["connect", connectEndpoint, connectEvents],
  ].map(([scope, endpoint, requiredEvents]) => {
    const missing = missingEvents(endpoint, requiredEvents);
    const valid =
      endpoint.livemode === false &&
      endpoint.status === "enabled" &&
      endpoint.url === expectedWebhookUrl &&
      missing.length === 0;
    expect(valid, `${scope} webhook endpoint is incomplete, disabled, LIVE, or points to another URL`);
    return {
      scope,
      endpoint: idRef(endpoint.id),
      livemode: endpoint.livemode,
      status: endpoint.status,
      url: endpoint.url,
      missing_events: missing,
      valid,
    };
  });

  console.log(JSON.stringify({
    ok: failures.length === 0,
    mode: "sandbox-read-only-preflight",
    mutated_stripe_objects: 0,
    prices: priceReport,
    connected_accounts: accountReport,
    webhook_endpoints: endpointReport,
    manual_evidence_required: [
      `Confirm in Stripe Dashboard that ${idRef(connectEndpoint.id)} was created with connect=true`,
      `Confirm in Stripe Dashboard that ${idRef(platformEndpoint.id)} is the platform/account endpoint`,
    ],
    failures,
  }, null, 2));
  if (failures.length > 0) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    phase: "stripe_read_only_api",
    error: error instanceof Error ? error.message : "unknown_error",
    failures,
  }, null, 2));
  process.exitCode = 1;
}
