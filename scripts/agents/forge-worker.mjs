import { planCorrection } from "../../agents/forge.mjs";

try {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk.toString("utf8");
    if (Buffer.byteLength(input) > 128_000) throw new Error("INPUT_LIMIT");
  }
  process.stdout.write(JSON.stringify(planCorrection(JSON.parse(input))));
} catch {
  process.exitCode = 1;
}
