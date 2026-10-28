import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { qaProductionIdentity } from "../../financial-privacy-20261025-candidate/tests/qa-production-secret.mjs";

const studioId = "e2663064-7774-41c5-95cb-e5e6afc4fab4";
const config = JSON.parse(await readFile(new URL("../wrangler.production.jsonc", import.meta.url), "utf8"));
const vars = config.env.production.vars;
const client = createClient(vars.VITE_SUPABASE_URL, vars.VITE_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const identity = await qaProductionIdentity("owner");
const { error: loginError } = await client.auth.signInWithPassword({ email: identity.email, password: identity.password });
if (loginError) throw new Error(`QA sign-in failed: ${loginError.code}`);
try {
  const checks = [
    ["payment_intents", "stripe_payment_intent_id"],
    ["payment_intents", "dispute_status"],
    ["payment_intents", "disputed_amount_cents"],
    ["payment_intents", "refunded_amount_cents"],
    ["refund_requests", "amount_cents"],
    ["refund_requests", "stripe_refund_status"],
    ["financial_audit_logs", "entity_id,entity_type,action,amount_cents,metadata,created_at"],
  ];
  for (const [table, column] of checks) {
    const { error } = await client.from(table).select(`id,${column}`).eq("studio_id", studioId).limit(1);
    console.log(JSON.stringify({ table, column, exists: !error, code: error?.code ?? null }));
  }
} finally {
  await client.auth.signOut();
}
