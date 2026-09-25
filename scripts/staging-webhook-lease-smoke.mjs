import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

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
  throw new Error("this_smoke_test_only_accepts_verified_bellza_staging");
}

const eventId = `evt_staging_lease_${randomUUID()}`;

async function request(path, { method = "GET", role = "service", body, prefer } = {}) {
  const token = role === "service" ? serviceKey : anonKey;
  const useSecretApiKey = role === "service" && token.startsWith("sb_secret_");
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      apikey: token,
      ...(!useSecretApiKey ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: response.status, text, json };
}

function assertOk(result, label) {
  assert.ok(result.status >= 200 && result.status < 300, `${label}: HTTP ${result.status} ${result.text}`);
}

async function claim(role = "service") {
  return request("/rest/v1/rpc/claim_stripe_webhook_event", {
    method: "POST",
    role,
    body: {
      p_event_id: eventId,
      p_event_type: "invoice.paid",
      p_studio_id: null,
      p_payload: { id: eventId, type: "invoice.paid", synthetic: true },
      p_lease_seconds: 120,
    },
  });
}

try {
  const denied = await claim("anon");
  assert.ok([401, 403, 404].includes(denied.status), `anon_rpc_not_denied: HTTP ${denied.status}`);

  const first = await claim();
  assertOk(first, "first_claim");
  assert.equal(first.json?.state, "claimed");
  assert.ok(first.json?.token, "first_claim_token_missing");

  const concurrent = await claim();
  assertOk(concurrent, "concurrent_claim");
  assert.equal(concurrent.json?.state, "busy");

  const failed = await request("/rest/v1/rpc/fail_stripe_webhook_event", {
    method: "POST",
    body: {
      p_event_id: eventId,
      p_processing_token: first.json.token,
      p_error: "synthetic_staging_probe",
    },
  });
  assertOk(failed, "mark_failed");
  assert.equal(failed.json, true);

  const retried = await claim();
  assertOk(retried, "retry_failed_claim");
  assert.equal(retried.json?.state, "claimed");
  assert.ok(retried.json?.token, "retry_claim_token_missing");
  assert.notEqual(retried.json.token, first.json.token);

  const staleCompletion = await request("/rest/v1/rpc/complete_stripe_webhook_event", {
    method: "POST",
    body: { p_event_id: eventId, p_processing_token: first.json.token },
  });
  assertOk(staleCompletion, "stale_completion");
  assert.equal(staleCompletion.json, false);

  const completed = await request("/rest/v1/rpc/complete_stripe_webhook_event", {
    method: "POST",
    body: { p_event_id: eventId, p_processing_token: retried.json.token },
  });
  assertOk(completed, "mark_processed");
  assert.equal(completed.json, true);

  const duplicate = await claim();
  assertOk(duplicate, "processed_duplicate");
  assert.equal(duplicate.json?.state, "processed");

  const row = await request(`/rest/v1/platform_billing_events?select=processing_state,attempt_count,last_error&stripe_event_id=eq.${encodeURIComponent(eventId)}`);
  assertOk(row, "read_final_state");
  assert.equal(row.json?.[0]?.processing_state, "processed");
  assert.equal(row.json?.[0]?.attempt_count, 2);
  assert.equal(row.json?.[0]?.last_error, null);

  console.log(JSON.stringify({
    result: "PASSOU",
    target: stagingRef,
    anonymous_rpc: "DENIED",
    first_claim: first.json.state,
    concurrent_claim: concurrent.json.state,
    failed_retry: retried.json.state,
    stale_completion: "FENCED",
    processed_duplicate: duplicate.json.state,
    attempt_count: row.json[0].attempt_count,
  }));
} finally {
  const cleanup = await request(`/rest/v1/platform_billing_events?stripe_event_id=eq.${encodeURIComponent(eventId)}`, {
    method: "DELETE",
    prefer: "return=minimal",
  });
  if (![200, 204].includes(cleanup.status)) {
    console.error(`cleanup_failed: HTTP ${cleanup.status} ${cleanup.text}`);
    process.exitCode = 1;
  }
}
