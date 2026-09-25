import assert from "node:assert/strict";

const stagingRef = "qflwsdrgdkkcxjnbxmis";
const baseUrl = process.env.STAGING_SUPABASE_URL?.replace(/\/$/, "");
const anonKey = process.env.STAGING_ANON_KEY;
const serviceKey = process.env.STAGING_SERVICE_ROLE_KEY;

if (!baseUrl || !anonKey || !serviceKey) {
  throw new Error("staging_credentials_missing");
}

const target = new URL(baseUrl);
if (
  target.protocol !== "https:" ||
  target.hostname !== `${stagingRef}.supabase.co` ||
  process.env.STAGING_SUPABASE_PROJECT_REF !== stagingRef
) {
  throw new Error("this_audit_only_accepts_verified_bellza_staging");
}

const publicViews = {
  public_booking_studios: new Set([
    "id", "slug", "name", "tagline", "description", "hero_image_url",
    "hero_gallery_urls", "logo_url", "brand_color", "location", "phone",
    "email", "whatsapp", "instagram", "timezone", "currency", "is_active",
    "rating", "reviews_count", "updated_at", "payment_policy",
    "accepted_payment_methods", "deposit_percent", "public_amenities",
    "min_booking_notice_min", "business_segment",
    "cancellation_min_notice_hours", "cancellation_after_deadline_policy",
    "refund_requests_enabled", "cancellation_policy_text", "legal_policy_version",
    "booking_flow_mode", "booking_request_professional_mode",
    "online_payment_ready", "mb_way_payment_ready",
    "public_notifications_available",
  ]),
  public_booking_staff: new Set([
    "id", "studio_id", "name", "role", "bio", "photo_url", "rating",
    "reviews_count", "is_active", "sort_order", "booking_availability_status",
  ]),
  public_service_categories: new Set(["id", "studio_id", "label", "sort_order"]),
  public_services: new Set([
    "id", "studio_id", "category_id", "name", "description", "duration_min",
    "price", "is_recommended", "is_active", "media", "sort_order",
  ]),
  public_staff_services: new Set(["studio_id", "staff_id", "service_id"]),
  public_upsell_offers: new Set([
    "id", "studio_id", "trigger_service_id", "offered_service_id",
    "discounted_price", "description", "is_active", "discount_type",
    "discount_value", "display_mode", "duration_min",
  ]),
};

const privateRelations = [
  "studios",
  "public_studios",
  "staff",
  "public_staff",
  "services",
  "clients",
  "appointments",
  "booking_payment_requests",
  "payment_intents",
  "refund_requests",
  "subscriptions",
  "platform_billing_events",
  "withdrawal_requests",
  "user_roles",
  "profiles",
  "server_rate_limits",
  "referrals",
  "referral_credits",
];

const forbiddenPublicNames = [
  /^stripe_/i,
  /customer_id/i,
  /subscription/i,
  /billing/i,
  /financial/i,
  /internal/i,
  /secret/i,
  /webhook/i,
  /service_role/i,
];

async function api(path, { role = "anon", method = "GET", body } = {}) {
  const key = role === "service" ? serviceKey : anonKey;
  const useSecretApiKey = role === "service" && key.startsWith("sb_secret_");
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      apikey: key,
      ...(!useSecretApiKey ? { Authorization: `Bearer ${key}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON error bodies are still reported below without credentials.
  }
  return { status: response.status, json, text };
}

const catalogue = {};
for (const [view, allowed] of Object.entries(publicViews)) {
  const result = await api(`/rest/v1/${view}?select=*&limit=1000`);
  assert.equal(result.status, 200, `${view}: HTTP ${result.status} ${result.text.slice(0, 180)}`);
  assert.ok(Array.isArray(result.json), `${view}: response_not_array`);
  for (const row of result.json) {
    for (const key of Object.keys(row)) {
      assert.ok(allowed.has(key), `${view}: unexpected_public_column:${key}`);
      assert.ok(
        forbiddenPublicNames.every((pattern) => !pattern.test(key)),
        `${view}: forbidden_public_column:${key}`,
      );
    }
  }
  catalogue[view] = result.json.length;
}

const privateChecks = {};
for (const relation of privateRelations) {
  const result = await api(`/rest/v1/${relation}?select=*&limit=1`);
  const denied = [401, 403, 404].includes(result.status);
  const empty = result.status === 200 && Array.isArray(result.json) && result.json.length === 0;
  assert.ok(denied || empty, `${relation}: anonymous_data_exposed HTTP ${result.status}`);
  privateChecks[relation] = denied ? `DENIED_${result.status}` : "EMPTY_BY_RLS";
}

for (const [view] of Object.entries(publicViews)) {
  for (const forbidden of ["stripe_connect_account_id", "stripe_customer_id", "subscription_status"]) {
    const result = await api(`/rest/v1/${view}?select=${forbidden}&limit=1`);
    assert.ok([400, 404].includes(result.status), `${view}: forbidden_column_selectable:${forbidden}`);
  }
}

const rootSpec = await api("/rest/v1/");
if (rootSpec.status === 200 && rootSpec.json && typeof rootSpec.json === "object") {
  const serialized = JSON.stringify(rootSpec.json);
  for (const name of privateRelations) {
    assert.ok(!serialized.includes(`/${name}`), `openapi_exposes_private_relation:${name}`);
  }
}

const buckets = await api("/storage/v1/bucket", { role: "service" });
assert.equal(buckets.status, 200, `storage_bucket_inventory: HTTP ${buckets.status}`);
const bucketRows = Array.isArray(buckets.json) ? buckets.json : [];
const unexpectedPublicBuckets = bucketRows
  .filter((bucket) => bucket.public)
  .map((bucket) => bucket.id)
  .filter((id) => !["studio-assets", "logo-bellza.png"].includes(id));
assert.deepEqual(unexpectedPublicBuckets, [], "unexpected_public_storage_bucket");

const storageObjects = {};
for (const bucket of bucketRows) {
  const listed = await api(`/storage/v1/object/list/${encodeURIComponent(bucket.id)}`, {
    role: "service",
    method: "POST",
    body: { prefix: "", limit: 1000, offset: 0, sortBy: { column: "name", order: "asc" } },
  });
  assert.equal(listed.status, 200, `${bucket.id}: object_inventory HTTP ${listed.status}`);
  storageObjects[bucket.id] = Array.isArray(listed.json) ? listed.json.length : 0;
}

console.log(JSON.stringify({
  result: "PASSOU",
  target: stagingRef,
  public_catalogue_rows: catalogue,
  private_relations: privateChecks,
  openapi_status: rootSpec.status,
  public_buckets: bucketRows.filter((bucket) => bucket.public).map((bucket) => bucket.id),
  root_storage_entries: storageObjects,
}));
