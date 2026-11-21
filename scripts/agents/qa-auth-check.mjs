import { signInQa } from "../../agents/qa/auth-session.mjs";
import { readQaIsolation } from "../../agents/qa/rls-read.mjs";

const args = process.argv.slice(2);
const studioCode = args.length === 4 && args[0] === "--studio" &&
  args[2] === "--operation" && ["auth-check", "rls-read"].includes(args[3])
  ? args[1] : null;
const operation = args[3];
const password = process.env.BELLZA_QA_PASSWORD;
const publishableKey = process.env.BELLZA_QA_PUBLISHABLE;
delete process.env.BELLZA_QA_PASSWORD;
delete process.env.BELLZA_QA_PUBLISHABLE;
if (!studioCode || !password || !publishableKey) {
  process.stderr.write("QA_AUTH_CONFIG_INVALID\n");
  process.exitCode = 2;
} else {
  try {
    const session = await signInQa({ studioCode, password, publishableKey,
      legacyVaultPassword: studioCode === "STUDIO_QA_B" });
    const rls = operation === "rls-read" ? await readQaIsolation({
      studioCode, accessToken: session.accessToken, publishableKey }) : null;
    process.stdout.write(JSON.stringify({ studioCode: session.studioCode,
      authenticated: true, userId: session.userId, source: "SUPABASE_AUTH",
      dataAccess: rls ? "RLS_HEAD" : "NOT_TESTED", ...(rls ?? {}) }) + "\n");
  } catch (error) {
    process.stderr.write(`${/^QA_[A-Z_]+$/.test(error?.message ?? "")
      ? error.message : "QA_AUTH_UNAVAILABLE"}\n`);
    process.exitCode = 1;
  }
}
