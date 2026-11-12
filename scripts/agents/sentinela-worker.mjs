import { runSentinela } from "../../agents/sentinela.mjs";

try {
  const report = await runSentinela();
  process.stdout.write(JSON.stringify(report));
} catch {
  // Atlas records a bounded, generic failure without exposing raw errors.
  process.exitCode = 1;
}
