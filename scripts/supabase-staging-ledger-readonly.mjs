import { spawnSync } from "node:child_process";
import {
  buildLedgerReadOnlyInvocation,
  buildReadOnlyChildEnvironment,
} from "./lib/staging-ledger-readonly.mjs";
import { assertStagingReadOnlyDatabaseUrl } from "./lib/staging-supabase-guard.mjs";

if (process.argv.length !== 2) {
  throw new Error(
    "This audit accepts no arguments; provide only STAGING_DATABASE_URL through the environment.",
  );
}

// The URL is the sole credential/target input. The child receives no Supabase
// access token, linked-project selector or generic DATABASE_URL.
const context = assertStagingReadOnlyDatabaseUrl(process.env.STAGING_DATABASE_URL);

const command = process.platform === "win32" ? "supabase.exe" : "supabase";
const result = spawnSync(command, buildLedgerReadOnlyInvocation(context.databaseUrl), {
  encoding: "utf8",
  env: buildReadOnlyChildEnvironment(),
  maxBuffer: 16 * 1024 * 1024,
});

if (result.status !== 0) {
  const safeError = String(result.stderr || result.stdout || "Supabase migration list failed")
    .replace(/postgres(?:ql)?:\/\/[^\s]+/giu, "[database-url-redacted]")
    .slice(0, 4000);
  throw new Error(safeError);
}

process.stdout.write(String(result.stdout ?? ""));
