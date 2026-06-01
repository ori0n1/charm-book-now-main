import fs from "node:fs";
import Stripe from "stripe";

function loadDotEnv(path) {
  if (!fs.existsSync(path)) return;
  const text = fs.readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (process.env[key]) continue;
    process.env[key] = rest.join("=").replace(/^["']|["']$/g, "");
  }
}

loadDotEnv(".env");
loadDotEnv(".env.local");

const env = process.env.STRIPE_ENV === "live" ? "live" : "sandbox";
const key =
  env === "live"
    ? process.env.STRIPE_LIVE_API_KEY || process.env.STRIPE_SECRET_KEY
    : process.env.STRIPE_SANDBOX_API_KEY || process.env.STRIPE_SECRET_KEY;

if (!key) {
  console.error("Missing Stripe API key. Configure STRIPE_SANDBOX_API_KEY or STRIPE_LIVE_API_KEY.");
  process.exit(1);
}

const stripe = new Stripe(key, { apiVersion: "2026-03-25.dahlia" });

const product = await stripe.products.create(
  {
    name: "Bellza Premium",
    description: "Subscrição premium Bellza para estúdios de beleza e barbearias.",
    metadata: { app: "bellza", kind: "platform_subscription" },
  },
  { idempotencyKey: "bellza-premium-product-v1" },
);

const plans = [
  {
    key: "STRIPE_PRICE_MONTHLY",
    lookup_key: "bellza_premium_monthly",
    nickname: "Premium Mensal",
    unit_amount: 899,
    recurring: { interval: "month", interval_count: 1 },
  },
  {
    key: "STRIPE_PRICE_QUARTERLY",
    lookup_key: "bellza_premium_quarterly",
    nickname: "Premium Trimestral",
    unit_amount: 2249,
    recurring: { interval: "month", interval_count: 3 },
  },
  {
    key: "STRIPE_PRICE_YEARLY",
    lookup_key: "bellza_premium_yearly",
    nickname: "Premium Anual",
    unit_amount: 7199,
    recurring: { interval: "year", interval_count: 1 },
  },
];

const results = [];

for (const plan of plans) {
  const existing = await stripe.prices.list({
    lookup_keys: [plan.lookup_key],
    active: true,
    limit: 1,
  });

  const price =
    existing.data[0] ??
    (await stripe.prices.create(
      {
        product: product.id,
        currency: "eur",
        unit_amount: plan.unit_amount,
        recurring: plan.recurring,
        nickname: plan.nickname,
        lookup_key: plan.lookup_key,
        metadata: { app: "bellza", plan: plan.lookup_key.replace("bellza_premium_", "") },
      },
      { idempotencyKey: `bellza-${plan.lookup_key}-price-v1` },
    ));

  results.push({ env: env.toUpperCase(), variable: plan.key, price_id: price.id });
}

console.table(results);
