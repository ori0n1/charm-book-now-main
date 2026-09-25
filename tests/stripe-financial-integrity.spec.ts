import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  assertDirectChargeAccount,
  assertExactStripeAmount,
  assertWithdrawalWebhookBinding,
  minimalStripeEventAudit,
  resolveBookingPaymentStatus,
} from "../src/lib/stripe-financial-integrity";
import {
  assertStripeRuntimeConfig,
  getConfiguredStripeEnv,
  resolveStripeAppBaseUrl,
  verifyWebhookBody,
} from "../src/lib/stripe.server";
import { getSupabaseServerConfig } from "../src/integrations/supabase/auth-config";

const projectFile = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

function readReconciliationConfigurationReport(stderr: string) {
  const jsonStart = stderr.indexOf("{\n");
  expect(jsonStart).toBeGreaterThanOrEqual(0);
  return JSON.parse(stderr.slice(jsonStart));
}

const reconciliationGuardEnv = (supabaseUrl: string, projectRef: string) => ({
  ...process.env,
  STRIPE_ENV: "sandbox",
  STRIPE_SANDBOX_API_KEY: "sk_test_guard_only_no_network",
  STRIPE_RECONCILIATION_SUPABASE_URL: supabaseUrl,
  STRIPE_RECONCILIATION_SUPABASE_SERVICE_ROLE_KEY: "synthetic_test_value",
  STRIPE_RECONCILIATION_EXPECTED_SUPABASE_PROJECT_REF: projectRef,
  STRIPE_RECONCILIATION_STUDIO_IDS: "studio_test_a,studio_test_b",
  STRIPE_SANDBOX_CONNECTED_ACCOUNT_IDS: "acct_test_a,acct_test_b",
  STRIPE_SANDBOX_PRICE_PRO_MONTHLY: "price_test_pro_monthly",
  STRIPE_SANDBOX_PRICE_PRO_YEARLY: "price_test_pro_yearly",
  STRIPE_SANDBOX_PRICE_PREMIUM_MONTHLY: "price_test_premium_monthly",
  STRIPE_SANDBOX_PRICE_PREMIUM_YEARLY: "price_test_premium_yearly",
});

test("read-only reconciliation refuses a LIVE Stripe key before network access", () => {
  const result = spawnSync(process.execPath, ["scripts/stripe-reconciliation-audit.mjs"], {
    cwd: process.cwd(),
    env: {
      ...reconciliationGuardEnv("https://stagingguardonly.supabase.co", "stagingguardonly"),
      STRIPE_SANDBOX_API_KEY: "sk_live_rejected_test_only",
    },
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  });
  expect(result.status).toBe(1);
  const report = readReconciliationConfigurationReport(result.stderr);
  expect(report.phase).toBe("configuration");
  expect(report.mutated_stripe_objects).toBe(0);
  expect(report.mutated_supabase_rows).toBe(0);
  expect(report.failures).toContain("LIVE Stripe keys are forbidden");
});

test("read-only reconciliation refuses the production Supabase project before network access", () => {
  const productionUrl = projectFile("wrangler.jsonc").match(
    /"VITE_SUPABASE_URL"\s*:\s*"([^"]+)"/,
  )?.[1];
  expect(productionUrl).toBeTruthy();
  const projectRef = new URL(productionUrl as string).hostname.split(".")[0];
  const result = spawnSync(process.execPath, ["scripts/stripe-reconciliation-audit.mjs"], {
    cwd: process.cwd(),
    env: reconciliationGuardEnv(productionUrl as string, projectRef),
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  });
  expect(result.status).toBe(1);
  const report = readReconciliationConfigurationReport(result.stderr);
  expect(report.phase).toBe("configuration");
  expect(report.mutated_stripe_objects).toBe(0);
  expect(report.mutated_supabase_rows).toBe(0);
  expect(report.failures).toContain(
    "Reconciliation target matches the production Supabase project in wrangler.jsonc",
  );
});

test("sandbox preflight reads the connected balance in Stripe-Account context", () => {
  const preflight = projectFile("scripts/stripe-sandbox-preflight.mjs");
  const reconciliation = projectFile("scripts/stripe-reconciliation-audit.mjs");
  expect(preflight).toContain("stripe.balance.retrieve({}, { stripeAccount: accountId })");
  expect(preflight.indexOf('loadDotEnv(".env.local")')).toBeLessThan(
    preflight.indexOf('loadDotEnv(".env")'),
  );
  expect(reconciliation.indexOf('loadDotEnv(".env.local")')).toBeLessThan(
    reconciliation.indexOf('loadDotEnv(".env")'),
  );
});

test("Worker refuses a Supabase project different from the browser bundle", () => {
  const previousUrl = process.env.SUPABASE_URL;
  process.env.SUPABASE_URL = "https://another-studio.supabase.co";
  try {
    expect(() => getSupabaseServerConfig()).toThrow("supabase_runtime_build_project_mismatch");
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
  }
  const authConfig = projectFile("src/integrations/supabase/auth-config.ts");
  expect(authConfig).toContain("viteEnv?.VITE_SUPABASE_URL");
  expect(authConfig).toContain("supabase_public_build_configuration_missing");
});

test("staging build refuses the production Supabase origin even with a trailing slash", () => {
  const result = spawnSync(process.execPath, ["scripts/build-staging.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      VITE_SUPABASE_URL: "https://pwmdzpvnatrvfpgcvnzg.supabase.co/",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic_test_only",
    },
    encoding: "utf8",
    timeout: 20_000,
    windowsHide: true,
  });
  expect(result.status).toBe(1);
  expect(result.stderr + result.stdout).toContain(
    "staging_supabase_public_config_missing_or_production",
  );
  const workerConfig = projectFile("wrangler.jsonc");
  expect(workerConfig).toContain('"workers_dev": true');
  expect(workerConfig).toContain('"STRIPE_ENV": "sandbox"');
});

test("Direct Charge webhook requires the reserved connected account", () => {
  expect(() => assertDirectChargeAccount("acct_studio_a", "acct_studio_a")).not.toThrow();
  expect(() => assertDirectChargeAccount("acct_studio_a", "acct_studio_b")).toThrow(
    "payment_connected_account_mismatch",
  );
  expect(() => assertDirectChargeAccount("acct_studio_a", null)).toThrow(
    "connect_event_account_missing",
  );
});

test("withdrawal webhook binds request, studio, Connect account and Stripe object", () => {
  const valid = {
    requestId: "request_a",
    metadataRequestId: "request_a",
    studioId: "studio_a",
    metadataStudioId: "studio_a",
    expectedConnectAccountId: "acct_a",
    studioConnectAccountId: "acct_a",
    eventConnectAccountId: "acct_a",
    expectedStripeObjectId: "po_a",
    eventStripeObjectId: "po_a",
    payoutMethod: "stripe",
    payoutMode: "stripe_automatic",
  };
  expect(() => assertWithdrawalWebhookBinding(valid)).not.toThrow();
  for (const changed of [
    { metadataRequestId: "request_b" },
    { metadataStudioId: "studio_b" },
  ]) {
    expect(() => assertWithdrawalWebhookBinding({ ...valid, ...changed })).toThrow(
      "withdrawal_tenant_binding_mismatch",
    );
  }
  for (const changed of [
    { expectedConnectAccountId: "acct_b" },
    { studioConnectAccountId: "acct_b" },
    { eventConnectAccountId: "acct_b" },
  ]) {
    expect(() => assertWithdrawalWebhookBinding({ ...valid, ...changed })).toThrow(
      "withdrawal_connected_account_mismatch",
    );
  }
  expect(() => assertWithdrawalWebhookBinding({ ...valid, eventConnectAccountId: null })).toThrow(
    "withdrawal_connected_account_missing",
  );
  expect(() => assertWithdrawalWebhookBinding({ ...valid, eventStripeObjectId: "po_b" })).toThrow(
    "withdrawal_stripe_object_mismatch",
  );
  expect(() => assertWithdrawalWebhookBinding({ ...valid, expectedStripeObjectId: null })).toThrow(
    "withdrawal_stripe_object_mismatch",
  );
  expect(() => assertWithdrawalWebhookBinding({ ...valid, payoutMethod: "iban" })).toThrow(
    "withdrawal_not_stripe_automatic",
  );
});

test("booking amount must match exactly, including amount_received", () => {
  expect(() =>
    assertExactStripeAmount({
      expectedAmountCents: 2_000,
      stripeAmountCents: 2_000,
      receivedAmountCents: 2_000,
      succeeded: true,
    }),
  ).not.toThrow();
  for (const amount of [0, 20, 1_999, 2_001]) {
    expect(() =>
      assertExactStripeAmount({
        expectedAmountCents: 2_000,
        stripeAmountCents: amount,
        receivedAmountCents: amount,
        succeeded: true,
      }),
    ).toThrow("payment_amount_mismatch");
  }
});

test("out-of-order failure cannot regress a succeeded booking payment", () => {
  expect(resolveBookingPaymentStatus("succeeded", "processing")).toBe("succeeded");
  expect(resolveBookingPaymentStatus("succeeded", "failed")).toBe("succeeded");
  expect(resolveBookingPaymentStatus("processing", "succeeded")).toBe("succeeded");
});

test("stored webhook envelope excludes Stripe customer payload and metadata PII", () => {
  const audit = minimalStripeEventAudit({
    id: "evt_test",
    type: "payment_intent.succeeded",
    created: 1,
    livemode: false,
    account: "acct_studio",
    data: {
      object: {
        id: "pi_test",
        object: "payment_intent",
        metadata: { payment_kind: "booking_deposit", client_phone: "+351900000000" },
      },
    },
  });
  expect(audit).toMatchObject({ object_id: "pi_test", payment_kind: "booking_deposit" });
  expect(JSON.stringify(audit)).not.toContain("client_phone");
  expect(JSON.stringify(audit)).not.toContain("+351");
});

test("financial hardening migration is additive and removes browser writes", () => {
  const migration = projectFile(
    "supabase/migrations/20260918190000_stripe_financial_integrity.sql",
  );
  expect(migration).toContain("studios_unique_stripe_connect_account");
  expect(migration).toContain("payment_intents_unique_stripe_charge");
  expect(migration).toContain("REVOKE INSERT, UPDATE, DELETE");
  expect(migration).toContain('DROP POLICY IF EXISTS "Plan permits refund access"');
  expect(migration).toContain('DROP POLICY IF EXISTS "Plan permits payment intent reads"');
  expect(migration).toContain("AS RESTRICTIVE FOR SELECT TO authenticated");
  expect(migration).toContain("REVOKE ALL ON public.payment_intents FROM PUBLIC, anon");
  expect(migration).toContain('DROP POLICY IF EXISTS "Members read platform billing events"');
  expect(migration).not.toMatch(/DROP TABLE|TRUNCATE TABLE|DELETE FROM public\./i);
});

test("webhook claims are recoverable after failure or a stale Worker lease", () => {
  const migration = projectFile(
    "supabase/migrations/20260922160000_stripe_webhook_processing_lease.sql",
  );
  const fencing = projectFile(
    "supabase/migrations/20260922170000_stripe_webhook_claim_fencing.sql",
  );
  const webhook = projectFile("src/routes/api/public/payments/webhook.ts");
  expect(migration).toContain("ON CONFLICT (stripe_event_id) DO NOTHING");
  expect(migration).toContain("processing_state = 'failed'");
  expect(migration).toContain("processing_started_at");
  expect(migration).toContain("RETURN 'busy'");
  expect(migration).toContain("attempt_count = attempt_count + 1");
  expect(migration).toContain("REVOKE ALL ON FUNCTION public.claim_stripe_webhook_event");
  expect(fencing).toContain("processing_token uuid");
  expect(fencing).toContain("AND processing_token = p_processing_token");
  expect(fencing).toContain("complete_stripe_webhook_event");
  expect(fencing).toContain("fail_stripe_webhook_event");
  expect(webhook).toContain('throw new Error("stripe_webhook_event_id_missing")');
  expect(webhook).toContain('throw new Error("stripe_webhook_completion_stale_claim")');
  expect(webhook).not.toContain("releaseBillingEventClaim");
  expect(webhook).not.toContain("appointments:appointment_id(id,studio_id,status,total_price)");
});

test("booking deposits are Direct Charges with no Bellza fee or client surcharge", () => {
  const checkout = projectFile("src/lib/payments.functions.ts");
  const inPerson = projectFile("src/lib/in-person-mbway.functions.ts");
  for (const source of [checkout, inPerson]) {
    expect(source).toContain("stripeAccount:");
    expect(source).not.toContain("application_fee_amount");
    expect(source).not.toContain("transfer_data");
    expect(source).not.toContain("on_behalf_of");
  }
  expect(checkout).toContain("unit_amount: amountCents");
  expect(checkout).not.toMatch(/stripe.*fee.*amount|taxa.*stripe.*amount/i);
});

test("refunds and disputes are reconciled in connected-account context", () => {
  const refunds = projectFile("src/lib/refund-operations.functions.ts");
  const webhook = projectFile("src/routes/api/public/payments/webhook.ts");
  expect(refunds).toContain("stripe.refunds.create");
  expect(refunds).toContain("stripeAccount: connectedAccountId");
  expect(refunds).toContain("idempotencyKey: `refund-request:");
  expect(webhook).toContain('case "refund.updated"');
  expect(webhook).toContain('case "charge.dispute.created"');
  expect(webhook).toContain("assertDirectChargeAccount(row.stripe_connect_account_id");
  expect(webhook).toContain("stripe.balanceTransactions.retrieve");
});

test("Connect responsibility must prove studio fees and Stripe loss liability", () => {
  const integrity = projectFile("src/lib/stripe-connect-integrity.server.ts");
  expect(integrity).toContain('responsibility.feesPayer !== "account"');
  expect(integrity).toContain('responsibility.lossesCollector !== "stripe"');
  expect(integrity).toContain("connect_fee_payer_incompatible");
  expect(integrity).toContain("connect_negative_balance_liability_incompatible");
});

test("new Connect onboarding is sandbox-only Standard/full and preserves existing accounts", () => {
  const connect = projectFile("src/lib/stripe-connect.functions.ts");
  const connectPage = projectFile("src/routes/_authenticated/admin.recebimento.tsx");
  const stagingConfig = projectFile("wrangler.jsonc");
  expect(connect).toContain('const SANDBOX_CONNECT_ACCOUNT_MODEL = "standard_full_v1"');
  expect(connect).toContain('env !== "sandbox"');
  expect(connect).toContain('type: "standard"');
  expect(connect).not.toContain('type: "express"');
  expect(connect).toContain("if (!accountId)");
  expect(connect).toContain("idempotencyKey: `bellza-connect:${env}:${data.studioId}");
  expect(connect).toContain("assertNewStandardAccountConfiguration(account, env, data.studioId)");
  expect(connect).toContain('responsibility.dashboardType !== "full"');
  expect(connect).toContain('responsibility.dashboardType === "full"');
  expect(connect).toContain('return { url: "https://dashboard.stripe.com/" }');
  expect(connect).toContain('refresh_url: `${base}/admin/recebimento?connect=refresh`');
  expect(connect).toContain('return_url: `${base}/admin/recebimento?connect=success`');
  expect(connect).toContain('type: "account_onboarding"');
  expect(connectPage).toContain('if (connectParam === "refresh")');
  expect(connectPage).toContain("await onboardFn({ data: { studioId } })");
  expect(connectPage).toContain("window.location.replace(url)");
  expect(connectPage).not.toContain("stripe=refresh");
  expect(stagingConfig).toContain('"STRIPE_CONNECT_NEW_ACCOUNT_MODEL": "standard_full_v1"');
  expect(connect).toContain("webhook_balance_read_skipped");
  expect(connect.indexOf("const account = await stripe.accounts.retrieve")).toBeLessThan(
    connect.indexOf("balance = await stripe.balance.retrieve"),
  );
});

test("sandbox subscription catalog bootstrap is canonical and idempotent", () => {
  const bootstrap = projectFile("scripts/create-stripe-subscription-plans.mjs");
  const artifactCheck = projectFile("scripts/check-staging-artifact.mjs");
  expect(bootstrap).toContain('env !== "sandbox"');
  expect(bootstrap).toContain('/^(sk|rk)_test_/i');
  expect(bootstrap).toContain('catalogVersion = "bellza-subscriptions-v2"');
  expect(bootstrap).toContain("amount: 1_299");
  expect(bootstrap).toContain("amount: 12_900");
  expect(bootstrap).toContain("amount: 2_499");
  expect(bootstrap).toContain("amount: 24_900");
  expect(bootstrap).toContain("lookup_keys: [spec.lookupKey]");
  expect(bootstrap).toContain("idempotencyKey: `${catalogVersion}:price:${spec.id}`");
  expect(artifactCheck).toContain(
    'vars.STRIPE_CONNECT_NEW_ACCOUNT_MODEL !== "standard_full_v1"',
  );
});

test("webhook signature is accepted only inside the replay window", async () => {
  const previous = process.env.PAYMENTS_SANDBOX_WEBHOOK_SECRET;
  const secret = "whsec_local_contract_test_only";
  process.env.PAYMENTS_SANDBOX_WEBHOOK_SECRET = secret;
  try {
    const body = JSON.stringify({
      id: "evt_test",
      type: "payment_intent.succeeded",
      data: { object: {} },
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signatureBytes = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`)),
    );
    const signature = [...signatureBytes]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    await expect(
      verifyWebhookBody(body, `t=${timestamp},v1=${signature}`, "sandbox"),
    ).resolves.toMatchObject({ id: "evt_test" });
    await expect(
      verifyWebhookBody(body, `t=${timestamp},v1=${"0".repeat(64)}`, "sandbox"),
    ).rejects.toThrow("Invalid webhook signature");
    await expect(
      verifyWebhookBody(body, `t=${timestamp - 301},v1=${signature}`, "sandbox"),
    ).rejects.toThrow("Webhook timestamp too old");
  } finally {
    if (previous === undefined) delete process.env.PAYMENTS_SANDBOX_WEBHOOK_SECRET;
    else process.env.PAYMENTS_SANDBOX_WEBHOOK_SECRET = previous;
  }
});

test("platform and Connect webhooks require separate signing secrets", async () => {
  const keys = [
    "PAYMENTS_SANDBOX_PLATFORM_WEBHOOK_SECRET",
    "PAYMENTS_SANDBOX_CONNECT_WEBHOOK_SECRET",
  ] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.PAYMENTS_SANDBOX_PLATFORM_WEBHOOK_SECRET = "whsec_platform_contract_test";
  process.env.PAYMENTS_SANDBOX_CONNECT_WEBHOOK_SECRET = "whsec_connect_contract_test";
  const body = JSON.stringify({
    id: "evt_connect",
    type: "payment_intent.succeeded",
    account: "acct_test_studio",
    livemode: false,
    data: { object: {} },
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = async (secret: string) => {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const bytes = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`)),
    );
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  };
  try {
    const wrong = await sign(process.env.PAYMENTS_SANDBOX_PLATFORM_WEBHOOK_SECRET);
    const correct = await sign(process.env.PAYMENTS_SANDBOX_CONNECT_WEBHOOK_SECRET);
    await expect(verifyWebhookBody(body, `t=${timestamp},v1=${wrong}`, "sandbox")).rejects.toThrow(
      "Invalid webhook signature",
    );
    await expect(
      verifyWebhookBody(body, `t=${timestamp},v1=${correct}`, "sandbox"),
    ).resolves.toMatchObject({ account: "acct_test_studio" });
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("server configuration isolates sandbox even when NODE_ENV is production", () => {
  const keys = [
    "NODE_ENV",
    "STRIPE_ENV",
    "STRIPE_SANDBOX_API_KEY",
    "PAYMENTS_SANDBOX_PLATFORM_WEBHOOK_SECRET",
    "PAYMENTS_SANDBOX_CONNECT_WEBHOOK_SECRET",
    "APP_URL",
  ] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.NODE_ENV = "production";
    process.env.STRIPE_ENV = "sandbox";
    process.env.STRIPE_SANDBOX_API_KEY = "rk_test_contract_only";
    process.env.PAYMENTS_SANDBOX_PLATFORM_WEBHOOK_SECRET = "whsec_platform_contract";
    process.env.PAYMENTS_SANDBOX_CONNECT_WEBHOOK_SECRET = "whsec_connect_contract";
    process.env.APP_URL = "https://sandbox.bellza.invalid";
    expect(getConfiguredStripeEnv()).toBe("sandbox");
    expect(() => assertStripeRuntimeConfig()).not.toThrow();
    expect(resolveStripeAppBaseUrl()).toBe("https://sandbox.bellza.invalid");
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("sandbox checkout return URL cannot resolve to production or an untrusted Origin header", () => {
  const previousStripeEnv = process.env.STRIPE_ENV;
  const previousAppUrl = process.env.APP_URL;
  try {
    process.env.STRIPE_ENV = "sandbox";
    process.env.APP_URL = "https://bellza.pt";
    expect(() => resolveStripeAppBaseUrl()).toThrow(
      "stripe_sandbox_app_url_must_not_be_production",
    );
    process.env.APP_URL = "http://sandbox.bellza.invalid";
    expect(() => resolveStripeAppBaseUrl()).toThrow("stripe_sandbox_app_url_invalid");
    delete process.env.APP_URL;
    expect(
      resolveStripeAppBaseUrl({
        request: new Request("https://sandbox.bellza.invalid/api/checkout", {
          headers: { origin: "https://bellza.pt" },
        }),
      }),
    ).toBe("https://sandbox.bellza.invalid");
  } finally {
    if (previousStripeEnv === undefined) delete process.env.STRIPE_ENV;
    else process.env.STRIPE_ENV = previousStripeEnv;
    if (previousAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previousAppUrl;
  }
});
