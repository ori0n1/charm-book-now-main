import { atlasStatus, runAtlas, AtlasError } from "../../agents/atlas.mjs";

const [command, agent] = process.argv.slice(2);
if (command === "status" && !agent) {
  process.stdout.write(`${JSON.stringify(atlasStatus(), null, 2)}\n`);
} else if (command === "run" && ["sentinela", "sherlock", "valida"].includes(agent)) {
  try {
    const result = await runAtlas({ agent });
    process.stdout.write(`Atlas: ${result.status}\nRelatório: ${result.reportPath}\n`);
    if (!["OK", "SEM_ANOMALIAS", "DIAGNOSTICADO", "APPROVED"].includes(result.status)) process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`Atlas: ${error instanceof AtlasError ? error.code : "LOCAL_FAILURE"}\n`);
    process.exitCode = 3;
  }
} else {
  process.stderr.write("Uso: atlas.mjs run sentinela|sherlock|valida | status\n");
  process.exitCode = 3;
}
