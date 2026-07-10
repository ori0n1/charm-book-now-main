import Stripe from "stripe";

export const STRIPE_PRODUCTION_APP_URL = "https://bellza.pt";

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
  return env === "live" || process.env.STRIPE_ENV === "live" || process.env.NODE_ENV === "production";
}

function assertNotTestStripeKey(key: string, name: string) {
  if (/^(sk|rk)_test_/i.test(key)) {
    throw new Error(`stripe_live_required: ${name} is a test key`);
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

  const webhookSecret = optionalEnv("PAYMENTS_LIVE_WEBHOOK_SECRET", "STRIPE_LIVE_WEBHOOK_SECRET", "STRIPE_WEBHOOK_SECRET");
  if (!webhookSecret) throw new Error("stripe_live_webhook_secret_missing");
}

export function resolveStripeAppBaseUrl(options: { request?: Request | null; fallback?: string } = {}) {
  const configured = optionalEnv("APP_URL", "PUBLIC_APP_URL", "VITE_APP_URL")?.replace(/\/$/, "") ?? "";
  if (isLiveRuntime()) {
    if (!configured) throw new Error("stripe_production_app_url_missing");
    if (configured !== STRIPE_PRODUCTION_APP_URL) {
      throw new Error(`stripe_production_app_url_invalid: expected ${STRIPE_PRODUCTION_APP_URL}`);
    }
    return configured;
  }

  if (configured) return configured;
  const request = options.request ?? null;
  const origin = request?.headers.get("origin");
  if (origin) return origin.replace(/\/$/, "");
  const host = request?.headers.get("host");
  if (host) {
    const proto = request?.headers.get("x-forwarded-proto") || "https";
    return `${proto}://${host}`.replace(/\/$/, "");
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
  const secret =
    env === "sandbox"
      ? process.env.PAYMENTS_SANDBOX_WEBHOOK_SECRET ?? getEnv("STRIPE_SANDBOX_WEBHOOK_SECRET")
      : optionalEnv("PAYMENTS_LIVE_WEBHOOK_SECRET", "STRIPE_LIVE_WEBHOOK_SECRET", "STRIPE_WEBHOOK_SECRET") ??
        getEnv("PAYMENTS_LIVE_WEBHOOK_SECRET");

  if (!signature || !body) throw new Error("Missing signature or body");

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
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const signedPayload = enc.encode(`${timestamp}.${body}`);

  // Verificação timing-safe: evita ataques de timing sobre a assinatura HMAC
  let valid = false;
  for (const candidate of v1Signatures) {
    // Converte o hex recebido para bytes para comparação via crypto.subtle.verify
    if (candidate.length !== 64) continue;
    const candidateBytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      candidateBytes[i] = parseInt(candidate.slice(i * 2, i * 2 + 2), 16);
    }
    const ok = await crypto.subtle.verify("HMAC", key, candidateBytes, signedPayload);
    if (ok) { valid = true; break; }
  }
  if (!valid) throw new Error("Invalid webhook signature");

  return JSON.parse(body);
}
