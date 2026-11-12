import { atlasStatus, runAtlas, AtlasError } from "../../agents/atlas.mjs";

const [command, agent] = process.argv.slice(2);
if (command === "status" && !agent) {
  process.stdout.write(`${JSON.stringify(atlasStatus(), null, 2)}\n`);
} else if (command === "run" && agent === "sentinela") {
  try {
    const result = await runAtlas();
    process.stdout.write(`Atlas: ${result.status}\nRelatório: ${result.reportPath}\n`);
    if (result.status !== "OK") process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`Atlas: ${error instanceof AtlasError ? error.code : "LOCAL_FAILURE"}\n`);
    process.exitCode = 3;
  }
} else {
  process.stderr.write("Uso: atlas.mjs run sentinela | status\n");
  process.exitCode = 3;
}
