import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  PRODUCTION_PROJECT_REF,
  STAGING_PROJECT_REF,
  STAGING_SUPABASE_URL,
  assertStagingSupabaseContext,
} from "../scripts/lib/staging-supabase-guard.mjs";

const goodEnv = () => ({
  EXPECTED_SUPABASE_PROJECT_REF: STAGING_PROJECT_REF,
  TARGET_SUPABASE_PROJECT_REF: STAGING_PROJECT_REF,
  STAGING_SUPABASE_URL,
});

function emptyWorkspace() {
  return mkdtempSync(join(tmpdir(), "bellza-stage-guard-"));
}

function linkedWorkspace(ref) {
  const root = emptyWorkspace();
  const temp = join(root, "supabase", ".temp");
  mkdirSync(temp, { recursive: true });
  writeFileSync(join(temp, "project-ref"), `${ref}\n`);
  return root;
}

test("correct explicit staging context reaches the pre-mutation boundary", () => {
  const result = assertStagingSupabaseContext({
    env: goodEnv(),
    cwd: emptyWorkspace(),
    operation: "admin-maintenance",
  });
  assert.equal(result.projectRef, STAGING_PROJECT_REF);
  assert.equal(result.mutation, true);
});

test("wrong expected ref fails closed", () => {
  assert.throws(
    () =>
      assertStagingSupabaseContext({
        env: { ...goodEnv(), EXPECTED_SUPABASE_PROJECT_REF: "aaaaaaaaaaaaaaaaaaaa" },
        cwd: emptyWorkspace(),
        operation: "db-push",
      }),
    /WRONG_EXPECTED_REF/u,
  );
});

test("missing explicit target fails closed", () => {
  const env = goodEnv();
  delete env.TARGET_SUPABASE_PROJECT_REF;
  assert.throws(
    () => assertStagingSupabaseContext({ env, cwd: emptyWorkspace(), operation: "db-push" }),
    /MISSING_ENV/u,
  );
});

test("production URL fails closed", () => {
  assert.throws(
    () =>
      assertStagingSupabaseContext({
        env: {
          ...goodEnv(),
          STAGING_SUPABASE_URL: `https://${PRODUCTION_PROJECT_REF}.supabase.co`,
        },
        cwd: emptyWorkspace(),
        operation: "db-push",
      }),
    /URL_MISMATCH|PRODUCTION_TARGET/u,
  );
});

test("missing database credential fails closed for direct database access", () => {
  assert.throws(
    () =>
      assertStagingSupabaseContext({
        env: goodEnv(),
        cwd: emptyWorkspace(),
        operation: "remote-sql",
        requireDatabaseUrl: true,
      }),
    /MISSING_DB_URL/u,
  );
});

test("database credential for another project fails closed", () => {
  assert.throws(
    () =>
      assertStagingSupabaseContext({
        env: {
          ...goodEnv(),
          STAGING_DATABASE_URL:
            "postgresql://postgres.aaaaaaaaaaaaaaaaaaaa:redacted@pooler.supabase.com:6543/postgres",
        },
        cwd: emptyWorkspace(),
        operation: "remote-sql",
        requireDatabaseUrl: true,
      }),
    /DB_URL_MISMATCH/u,
  );
});

test("a wrong local link aborts even a read-only audit", () => {
  assert.throws(
    () =>
      assertStagingSupabaseContext({
        env: goodEnv(),
        cwd: linkedWorkspace(PRODUCTION_PROJECT_REF),
        operation: "migration-list-readonly",
        allowValidatedLinkForReadOnly: true,
      }),
    /LINK_MISMATCH/u,
  );
});

test("a validated staging link is still forbidden for mutation", () => {
  assert.throws(
    () =>
      assertStagingSupabaseContext({
        env: goodEnv(),
        cwd: linkedWorkspace(STAGING_PROJECT_REF),
        operation: "migration-repair",
        allowValidatedLinkForReadOnly: true,
      }),
    /IMPLICIT_LINK_FORBIDDEN/u,
  );
});
