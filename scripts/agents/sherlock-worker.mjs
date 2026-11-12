import { diagnoseSentinela } from "../../agents/sherlock.mjs";

try {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk.toString("utf8");
    if (Buffer.byteLength(input) > 128_000) throw new Error("INPUT_LIMIT");
  }
  const payload = JSON.parse(input);
  process.stdout.write(JSON.stringify(diagnoseSentinela({
    sourceReport: payload.sourceReport,
    recentEvents: payload.recentEvents,
    syntheticProof: payload.syntheticProof,
  })));
} catch {
  process.exitCode = 1;
}
