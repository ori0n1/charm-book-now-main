import Stripe from "stripe";

const env = process.env.STRIPE_ENV?.trim();
const key = process.env.STRIPE_SANDBOX_API_KEY?.trim();

if (env !== "sandbox") {
  throw new Error("stripe_catalog_bootstrap_requires_sandbox");
}
if (!key || !/^(sk|rk)_test_/i.test(key) || /^(sk|rk)_live_/i.test(key)) {
  throw new Error("stripe_catalog_bootstrap_requires_test_key");
}

const stripe = new Stripe(key, { apiVersion: "2026-03-25.dahlia" });
const catalogVersion = "bellza-subscriptions-v2";
const planSpecs = [
  {
    id: "pro_monthly",
    env: "STRIPE_SANDBOX_PRICE_PRO_MONTHLY",
    lookupKey: "bellza_pro_monthly_v2",
    nickname: "Bellza Pro Mensal",
    amount: 1_299,
    interval: "month",
  },
  {
    id: "pro_yearly",
    env: "STRIPE_SANDBOX_PRICE_PRO_YEARLY",
    lookupKey: "bellza_pro_yearly_v2",
    nickname: "Bellza Pro Anual",
    amount: 12_900,
    interval: "year",
  },
  {
    id: "premium_monthly",
    env: "STRIPE_SANDBOX_PRICE_PREMIUM_MONTHLY",
    lookupKey: "bellza_premium_monthly_v2",
    nickname: "Bellza Premium Mensal",
    amount: 2_499,
    interval: "month",
  },
  {
    id: "premium_yearly",
    env: "STRIPE_SANDBOX_PRICE_PREMIUM_YEARLY",
    lookupKey: "bellza_premium_yearly_v2",
    nickname: "Bellza Premium Anual",
    amount: 24_900,
    interval: "year",
  },
];

function assertPrice(price, spec, productId) {
  const valid =
    price.livemode === false &&
    price.active === true &&
    price.currency === "eur" &&
    price.unit_amount === spec.amount &&
    price.recurring?.interval === spec.interval &&
    (price.recurring?.interval_count ?? 1) === 1 &&
    (typeof price.product === "string" ? price.product : price.product?.id) === productId;
  if (!valid) throw new Error(`stripe_catalog_existing_price_incompatible:${spec.id}`);
}

const products = await stripe.products.list({ active: true, limit: 100 });
let product = products.data.find(
  (candidate) =>
    candidate.livemode === false &&
    candidate.metadata?.app === "bellza" &&
    candidate.metadata?.catalog_version === catalogVersion,
);

if (!product) {
  product = await stripe.products.create(
    {
      name: "Bellza",
      description: "Planos Pro e Premium da plataforma Bellza.",
      metadata: {
        app: "bellza",
        kind: "platform_subscription",
        catalog_version: catalogVersion,
      },
    },
    { idempotencyKey: `${catalogVersion}:product` },
  );
}
if (product.livemode !== false) throw new Error("stripe_catalog_product_is_live");

const result = {};
for (const spec of planSpecs) {
  const existing = await stripe.prices.list({
    lookup_keys: [spec.lookupKey],
    active: true,
    limit: 2,
  });
  if (existing.data.length > 1) {
    throw new Error(`stripe_catalog_duplicate_lookup_key:${spec.id}`);
  }
  let price = existing.data[0];
  if (!price) {
    price = await stripe.prices.create(
      {
        product: product.id,
        currency: "eur",
        unit_amount: spec.amount,
        recurring: { interval: spec.interval, interval_count: 1 },
        nickname: spec.nickname,
        lookup_key: spec.lookupKey,
        metadata: {
          app: "bellza",
          plan_id: spec.id,
          catalog_version: catalogVersion,
        },
      },
      { idempotencyKey: `${catalogVersion}:price:${spec.id}` },
    );
  }
  assertPrice(price, spec, product.id);
  result[spec.env] = price.id;
}

console.log(
  JSON.stringify(
    {
      ok: true,
      mode: "test",
      livemode: false,
      product_id: product.id,
      prices: result,
    },
    null,
    2,
  ),
);
