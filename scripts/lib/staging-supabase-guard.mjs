import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const STAGING_PROJECT_REF = "qflwsdrgdkkcxjnbxmis";
export const PRODUCTION_PROJECT_REF = "pwmdzpvnatrvfpgcvnzg";
export const STAGING_SUPABASE_URL = `https://${STAGING_PROJECT_REF}.supabase.co`;

const MUTATING_OPERATIONS = new Set([
  "db-push",
  "migration-up",
  "migration-repair",
  "remote-sql",
  "functions-deploy",
  "secrets-set",
  "admin-maintenance",
  "data-import",
]);

export class StagingGuardError extends Error {
  constructor(code, message) {
    super(`[STAGING_GUARD:${code}] ${message}`);
    this.name = "StagingGuardError";
    this.code = code;
  }
}

export function projectRefFromSupabaseUrl(value) {
  if (!value) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  const match = parsed.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/u);
  return match?.[1] ?? null;
}

export function projectRefFromDatabaseUrl(value) {
  if (!value) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  const directHost = parsed.hostname.match(/^db\.([a-z0-9]{20})\.supabase\.co$/u);
  if (directHost) return directHost[1];

  const pooledUser = decodeURIComponent(parsed.username).match(/^[A-Za-z0-9_]+\.([a-z0-9]{20})$/u);
  return pooledUser?.[1] ?? null;
}

export function assertStagingReadOnlyDatabaseUrl(value) {
  const databaseUrl = String(value ?? "").trim();
  if (!databaseUrl) {
    throw new StagingGuardError(
      "MISSING_DB_URL",
      "STAGING_DATABASE_URL is the only accepted credential input",
    );
  }
  if (databaseUrl.includes(PRODUCTION_PROJECT_REF)) {
    throw new StagingGuardError("PRODUCTION_TARGET", "STAGING_DATABASE_URL identifies production");
  }
  if (projectRefFromDatabaseUrl(databaseUrl) !== STAGING_PROJECT_REF) {
    throw new StagingGuardError(
      "DB_URL_MISMATCH",
      "STAGING_DATABASE_URL cannot be bound to the authorized staging project",
    );
  }
  return Object.freeze({ databaseUrl, projectRef: STAGING_PROJECT_REF });
}

export function readLocalLinkedProjectRef(cwd = process.cwd()) {
  const path = resolve(cwd, "supabase", ".temp", "project-ref");
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8").trim() || null;
}

function required(env, name) {
  const value = String(env[name] ?? "").trim();
  if (!value) throw new StagingGuardError("MISSING_ENV", `${name} is required`);
  return value;
}

function rejectProductionMarker(name, value) {
  if (String(value ?? "").includes(PRODUCTION_PROJECT_REF)) {
    throw new StagingGuardError("PRODUCTION_TARGET", `${name} identifies the production project`);
  }
}

export function assertStagingSupabaseContext({
  env = process.env,
  cwd = process.cwd(),
  operation,
  requireDatabaseUrl = false,
  allowValidatedLinkForReadOnly = false,
} = {}) {
  const expectedRef = required(env, "EXPECTED_SUPABASE_PROJECT_REF");
  const targetRef = required(env, "TARGET_SUPABASE_PROJECT_REF");
  const stagingUrl = required(env, "STAGING_SUPABASE_URL").replace(/\/$/u, "");

  if (expectedRef !== STAGING_PROJECT_REF) {
    throw new StagingGuardError(
      "WRONG_EXPECTED_REF",
      "EXPECTED_SUPABASE_PROJECT_REF is not the authorized staging project",
    );
  }
  if (targetRef !== expectedRef) {
    throw new StagingGuardError(
      "TARGET_MISMATCH",
      "TARGET_SUPABASE_PROJECT_REF does not match the explicitly expected project",
    );
  }
  if (
    stagingUrl !== STAGING_SUPABASE_URL ||
    projectRefFromSupabaseUrl(stagingUrl) !== expectedRef
  ) {
    throw new StagingGuardError(
      "URL_MISMATCH",
      "STAGING_SUPABASE_URL does not identify the authorized staging project",
    );
  }

  for (const name of [
    "EXPECTED_SUPABASE_PROJECT_REF",
    "TARGET_SUPABASE_PROJECT_REF",
    "STAGING_SUPABASE_URL",
    "SUPABASE_URL",
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_PROJECT_ID",
    "SUPABASE_PROJECT_REF",
    "STAGING_DATABASE_URL",
    "DATABASE_URL",
  ]) {
    rejectProductionMarker(name, env[name]);
  }

  for (const [name, value] of [
    ["SUPABASE_URL", env.SUPABASE_URL],
    ["VITE_SUPABASE_URL", env.VITE_SUPABASE_URL],
    ["VITE_SUPABASE_PROJECT_ID", env.VITE_SUPABASE_PROJECT_ID],
    ["SUPABASE_PROJECT_REF", env.SUPABASE_PROJECT_REF],
  ]) {
    if (!value) continue;
    const actual = name.endsWith("URL") ? projectRefFromSupabaseUrl(value) : String(value).trim();
    if (actual !== expectedRef) {
      throw new StagingGuardError(
        "AMBIGUOUS_ENV",
        `${name} conflicts with the authorized staging project`,
      );
    }
  }

  const databaseUrl = String(env.STAGING_DATABASE_URL ?? "").trim();
  if (requireDatabaseUrl) {
    if (!databaseUrl)
      throw new StagingGuardError(
        "MISSING_DB_URL",
        "STAGING_DATABASE_URL is required for explicit remote database access",
      );
    if (projectRefFromDatabaseUrl(databaseUrl) !== expectedRef) {
      throw new StagingGuardError(
        "DB_URL_MISMATCH",
        "STAGING_DATABASE_URL cannot be bound to the authorized staging project",
      );
    }
  }

  const linkedRef = readLocalLinkedProjectRef(cwd);
  const mutating = MUTATING_OPERATIONS.has(operation);
  if (linkedRef && linkedRef !== expectedRef) {
    throw new StagingGuardError(
      "LINK_MISMATCH",
      "the local Supabase link points outside authorized staging",
    );
  }
  if (linkedRef && (mutating || !allowValidatedLinkForReadOnly)) {
    throw new StagingGuardError(
      "IMPLICIT_LINK_FORBIDDEN",
      "remove the local Supabase link and provide an explicit staging target",
    );
  }
  if (allowValidatedLinkForReadOnly && mutating) {
    throw new StagingGuardError(
      "MUTATION_VIA_LINK_FORBIDDEN",
      "a linked project may be used only by the dedicated read-only ledger audit",
    );
  }

  return Object.freeze({
    operation: operation || "unspecified",
    projectRef: expectedRef,
    supabaseUrl: stagingUrl,
    databaseUrl: databaseUrl || null,
    linkedProjectRef: linkedRef,
    mutation: mutating,
  });
}

export function sanitizedGuardResult(context) {
  return {
    allowed: true,
    operation: context.operation,
    projectRef: context.projectRef,
    supabaseUrl: context.supabaseUrl,
    linkedProject: context.linkedProjectRef ? "validated-for-read-only" : "absent",
    databaseCredential: context.databaseUrl ? "explicit-staging-url-present" : "not-required",
    mutation: context.mutation,
  };
}
