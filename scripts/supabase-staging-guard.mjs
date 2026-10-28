import {
  assertStagingSupabaseContext,
  sanitizedGuardResult,
} from "./lib/staging-supabase-guard.mjs";

const args = new Set(process.argv.slice(2));
if (!args.has("--check-only")) {
  throw new Error(
    "This command is preflight-only. Pass --check-only; it never performs a remote mutation.",
  );
}

const context = assertStagingSupabaseContext({ operation: "admin-maintenance" });
process.stdout.write(
  `${JSON.stringify({ ...sanitizedGuardResult(context), stoppedBeforeMutation: true }, null, 2)}\n`,
);
