import Stripe from "stripe";

export const STRIPE_PRODUCTION_APP_URL = "https://bellza.pt";
export const STRIPE_PRODUCTION_APP_ORIGINS = new Set([
  STRIPE_PRODUCTION_APP_URL,
  "https://www.bellza.pt",
]);

const getEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is not configured`);
  return value;
};

export type StripeEnv = "sandbox" | "live";

function optionalEnv(...keys: string[]) {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  return null;
}

function isLiveRuntime(env?: StripeEnv) {
  if (env) return env === "live";
  if (process.env.STRIPE_ENV === "live" || process.env.STRIPE_ENV === "sandbox") {
    return process.env.STRIPE_ENV === "live";
  }
  return process.env.NODE_ENV === "production";
}

export function getConfiguredStripeEnv(): StripeEnv {
  const env = process.env.STRIPE_ENV;
  if (env === "live" || env === "sandbox") return env;
  throw new Error("stripe_environment_not_configured");
}

function assertNotTestStripeKey(key: string, name: string) {
  if (/^(sk|rk)_test_/i.test(key)) {
    throw new Error(`stripe_live_required: ${name} is a test key`);
  }
}

function webhookSecrets(env: StripeEnv) {
  const live = env === "live";
  const legacy = live
    ? optionalEnv("PAYMENTS_LIVE_WEBHOOK_SECRET", "STRIPE_LIVE_WEBHOOK_SECRET", "STRIPE_WEBHOOK_SECRET")
    : optionalEnv("PAYMENTS_SANDBOX_WEBHOOK_SECRET", "STRIPE_SANDBOX_WEBHOOK_SECRET");
  const platform = live
    ? optionalEnv("PAYMENTS_LIVE_PLATFORM_WEBHOOK_SECRET", "STRIPE_LIVE_PLATFORM_WEBHOOK_SECRET")
    : optionalEnv("PAYMENTS_SANDBOX_PLATFORM_WEBHOOK_SECRET", "STRIPE_SANDBOX_PLATFORM_WEBHOOK_SECRET");
  const connect = live
    ? optionalEnv("PAYMENTS_LIVE_CONNECT_WEBHOOK_SECRET", "STRIPE_LIVE_CONNECT_WEBHOOK_SECRET")
    : optionalEnv("PAYMENTS_SANDBOX_CONNECT_WEBHOOK_SECRET", "STRIPE_SANDBOX_CONNECT_WEBHOOK_SECRET");
  return {
    platform: platform ?? legacy,
    connect: connect ?? legacy,
    usesSharedLegacy: Boolean(legacy && !platform && !connect),
  };
}

function assertWebhookSecrets(env: StripeEnv) {
  const secrets = webhookSecrets(env);
  if (!secrets.platform) throw new Error(`stripe_${env}_platform_webhook_secret_missing`);
  if (!secrets.connect) throw new Error(`stripe_${env}_connect_webhook_secret_missing`);
  if (secrets.platform === secrets.connect && !secrets.usesSharedLegacy) {
    throw new Error(`stripe_${env}_webhook_secrets_must_be_distinct`);
  }
}

export function assertStripeProductionConfig(env: StripeEnv = "live") {
  if (!isLiveRuntime(env)) return;
  if (process.env.STRIPE_ENV !== "live") {
    throw new Error("stripe_live_required: STRIPE_ENV must be 'live' in production");
  }

  const secretKey = optionalEnv("STRIPE_LIVE_API_KEY", "STRIPE_SECRET_KEY");
  if (!secretKey) throw new Error("stripe_live_secret_key_missing");
  assertNotTestStripeKey(secretKey, "STRIPE_LIVE_API_KEY");
  if (!/^(sk|rk)_live_/i.test(secretKey)) {
    throw new Error("stripe_live_required: STRIPE_LIVE_API_KEY must be a live key");
  }

  const publishableKey = optionalEnv("STRIPE_LIVE_PUBLISHABLE_KEY", "STRIPE_PUBLISHABLE_KEY");
  if (publishableKey && /^pk_test_/i.test(publishableKey)) {
    throw new Error("stripe_live_required: STRIPE_PUBLISHABLE_KEY is a test key");
  }

  assertWebhookSecrets("live");
}

export function assertStripeSandboxConfig(env: StripeEnv = "sandbox") {
  if (env !== "sandbox" || getConfiguredStripeEnv() !== "sandbox") {
    throw new Error("stripe_sandbox_required");
  }
  const secretKey = optionalEnv("STRIPE_SANDBOX_API_KEY", "STRIPE_SECRET_KEY");
  if (!secretKey) throw new Error("stripe_sandbox_secret_key_missing");
  if (!/^(sk|rk)_test_/i.test(secretKey)) {
    throw new Error("stripe_sandbox_key_mismatch: test key required");
  }
  assertWebhookSecrets("sandbox");
}

export function assertStripeRuntimeConfig(env = getConfiguredStripeEnv()) {
  if (env === "live") assertStripeProductionConfig(env);
  else assertStripeSandboxConfig(env);
}

export function resolveStripeAppBaseUrl(options: { request?: Request | null; fallback?: string } = {}) {
  const configured = optionalEnv("APP_URL", "PUBLIC_APP_URL", "VITE_APP_URL")?.replace(/\/$/, "") ?? "";
  if (isLiveRuntime()) {
    if (!configured) throw new Error("stripe_production_app_url_missing");
    if (!STRIPE_PRODUCTION_APP_ORIGINS.has(configured)) {
      throw new Error(`stripe_production_app_url_invalid: unexpected origin ${configured}`);
    }

    // PWA storage and authentication are origin-scoped. Keep legacy
    // installations opened from www.bellza.pt on that origin after Stripe,
    // while rejecting every host outside the explicit production allow-list.
    if (options.request) {
      const requestOrigin = new URL(options.request.url).origin;
      if (STRIPE_PRODUCTION_APP_ORIGINS.has(requestOrigin)) return requestOrigin;
    }
    return configured;
  }

  if (configured) {
    const parsed = new URL(configured);
    const origin = parsed.origin;
    if (STRIPE_PRODUCTION_APP_ORIGINS.has(origin)) {
      throw new Error("stripe_sandbox_app_url_must_not_be_production");
    }
    const localHttp = parsed.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    if ((parsed.protocol !== "https:" && !localHttp) || parsed.username || parsed.password) {
      throw new Error("stripe_sandbox_app_url_invalid");
    }
    return origin;
  }
  const request = options.request ?? null;
  if (request) {
    const origin = new URL(request.url).origin;
    if (STRIPE_PRODUCTION_APP_ORIGINS.has(origin)) {
      throw new Error("stripe_sandbox_app_url_must_not_be_production");
    }
    return origin;
  }
  return options.fallback ?? "http://127.0.0.1:5173";
}

export function getConnectionApiKey(env: StripeEnv): string {
  if (env === "live") {
    assertStripeProductionConfig(env);
    return optionalEnv("STRIPE_LIVE_API_KEY", "STRIPE_SECRET_KEY")!;
  }

  const key = optionalEnv("STRIPE_SANDBOX_API_KEY", "STRIPE_SECRET_KEY") ?? getEnv("STRIPE_SANDBOX_API_KEY");
  if (/^(sk|rk)_live_/i.test(key)) {
    throw new Error("stripe_sandbox_key_mismatch: live key configured for sandbox");
  }
  if (!/^(sk|rk)_test_/i.test(key)) {
    throw new Error("stripe_sandbox_key_mismatch: test key required");
  }
  return key;
}

export function createStripeClient(env: StripeEnv): Stripe {
  return new Stripe(getConnectionApiKey(env), {
    apiVersion: "2026-03-25.dahlia",
  });
}

export async function verifyWebhook(
  req: Request,
  env: StripeEnv,
): Promise<{ id?: string; type: string; livemode?: boolean; data: { object: unknown } }> {
  const signature = req.headers.get("stripe-signature");
  const body = await req.text();
  return verifyWebhookBody(body, signature, env);
}

export async function verifyWebhookBody(
  body: string,
  signature: string | null,
  env: StripeEnv,
): Promise<{ id?: string; type: string; livemode?: boolean; data: { object: unknown } }> {
  if (!signature || !body) throw new Error("Missing signature or body");
  const secrets = webhookSecrets(env);
  const scopedSecrets = (["platform", "connect"] as const)
    .map((scope) => ({ scope, secret: secrets[scope] }))
    .filter((entry): entry is { scope: "platform" | "connect"; secret: string } => Boolean(entry.secret));
  if (scopedSecrets.length === 0) throw new Error("Stripe webhook secrets are not configured");

  let timestamp: string | undefined;
  const v1Signatures: string[] = [];
  for (const part of signature.split(",")) {
    const [key, value] = part.split("=", 2);
    if (key === "t") timestamp = value;
    if (key === "v1") v1Signatures.push(value);
  }

  if (!timestamp || v1Signatures.length === 0) throw new Error("Invalid signature format");

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 300) throw new Error("Webhook timestamp too old");

  const enc = new TextEncoder();
  const signedPayload = enc.encode(`${timestamp}.${body}`);

  // Verify cryptographically before parsing the untrusted JSON. Trying both
  // endpoint secrets is safe; the matched scope is checked after parsing.
  const matchedScopes = new Set<"platform" | "connect">();
  for (const entry of scopedSecrets) {
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(entry.secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    for (const candidate of v1Signatures) {
      if (candidate.length !== 64) continue;
      const candidateBytes = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        candidateBytes[i] = parseInt(candidate.slice(i * 2, i * 2 + 2), 16);
      }
      if (await crypto.subtle.verify("HMAC", key, candidateBytes, signedPayload)) {
        matchedScopes.add(entry.scope);
      }
    }
  }
  if (matchedScopes.size === 0) throw new Error("Invalid webhook signature");

  const parsed = JSON.parse(body) as {
    id?: string;
    type: string;
    account?: string;
    livemode?: boolean;
    data: { object: unknown };
  };
  const expectedScope = parsed.account ? "connect" : "platform";
  if (!matchedScopes.has(expectedScope)) throw new Error("Invalid webhook signature scope");

  return parsed;
}
