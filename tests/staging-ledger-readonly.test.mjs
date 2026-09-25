import assert from "node:assert/strict";
import test from "node:test";

import {
  LEDGER_READ_ONLY_SQL,
  assertReadOnlyLedgerSql,
  buildLedgerReadOnlyInvocation,
  buildReadOnlyChildEnvironment,
} from "../scripts/lib/staging-ledger-readonly.mjs";
import {
  STAGING_PROJECT_REF,
  assertStagingReadOnlyDatabaseUrl,
} from "../scripts/lib/staging-supabase-guard.mjs";

const stagingUrl = `postgresql://bellza_staging_ledger_reader.${STAGING_PROJECT_REF}:redacted@aws-0-eu-west-1.pooler.supabase.com:6543/postgres`;

test("ledger reader accepts the staging URL as its only target", () => {
  const context = assertStagingReadOnlyDatabaseUrl(stagingUrl);
  assert.equal(context.projectRef, STAGING_PROJECT_REF);
});

test("ledger reader rejects a URL for another project", () => {
  assert.throws(
    () =>
      assertStagingReadOnlyDatabaseUrl(
        "postgresql://reader.aaaaaaaaaaaaaaaaaaaa:redacted@pooler.supabase.com:6543/postgres",
      ),
    /DB_URL_MISMATCH/u,
  );
});

test("ledger SQL is a fixed read-only transaction", () => {
  assert.equal(assertReadOnlyLedgerSql(), LEDGER_READ_ONLY_SQL);
  assert.throws(
    () => assertReadOnlyLedgerSql("UPDATE supabase_migrations.schema_migrations SET version='x'"),
    /mutation/u,
  );
});

test("ledger CLI invocation contains no mutable migration command", () => {
  const invocation = buildLedgerReadOnlyInvocation(stagingUrl);
  assert.deepEqual(invocation.slice(0, 2), ["db", "query"]);
  assert.equal(invocation.includes("--linked"), false);
  assert.equal(invocation.includes("repair"), false);
  assert.equal(invocation.at(-1), LEDGER_READ_ONLY_SQL);
});

test("ledger child process is read-only and receives no ambient credentials", () => {
  const child = buildReadOnlyChildEnvironment({
    Path: "safe-path",
    SUPABASE_ACCESS_TOKEN: "must-not-pass",
    DATABASE_URL: "must-not-pass",
    CLOUDFLARE_API_TOKEN: "must-not-pass",
  });
  assert.equal(child.Path, "safe-path");
  assert.equal(child.PGOPTIONS, "-c default_transaction_read_only=on");
  assert.equal("SUPABASE_ACCESS_TOKEN" in child, false);
  assert.equal("DATABASE_URL" in child, false);
  assert.equal("CLOUDFLARE_API_TOKEN" in child, false);
});
