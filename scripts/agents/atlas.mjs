import { atlasStatus, runAtlas, runIntegratedCheck, AtlasError } from "../../agents/atlas.mjs";

const [command, agent] = process.argv.slice(2);
if (command === "status" && !agent) {
  process.stdout.write(`${JSON.stringify(atlasStatus(), null, 2)}\n`);
} else if (command === "check" && (!agent || agent === "--synthetic" ||
    ["confirmed", "unknown-cause", "test-failure", "auth-unavailable"]
      .some((name) => agent === `--synthetic=${name}`))) {
  try {
    const mode = agent ? "synthetic" : "live";
    const scenario = agent?.split("=")[1] ?? "confirmed";
    const result = await runIntegratedCheck({ mode, scenario });
    const summary = result.report;
    process.stdout.write([
      `Atlas: ${result.status} (${summary.mode})`,
      `Anomalia: ${summary.anomaly.join(", ") || "nenhuma"}`,
      `Causa: ${summary.cause.map((item) => `${item.code} ${item.status}`).join(", ") || "não determinada"}`,
      `Proposta: ${summary.proposal ? `${summary.proposal.file} (não aplicada)` : "nenhuma"}`,
      `Testes: ${summary.tests}`,
      `Parecer: ${summary.opinion} (publicação não autorizada)`,
      `Próximo passo: ${summary.nextSteps[0]}`,
      `Relatório: ${result.reportPath}`,
      "",
    ].join("\n"));
    if (result.status !== "APTO") process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`Atlas: ${error instanceof AtlasError ? error.code : "LOCAL_FAILURE"}\n`);
    process.exitCode = 3;
  }
} else if (command === "run" && ["sentinela", "sherlock", "valida", "forge", "guardiao"].includes(agent)) {
  try {
    const result = await runAtlas({ agent });
    process.stdout.write(`Atlas: ${result.status}\nRelatório: ${result.reportPath}\n`);
    if (!["OK", "SEM_ANOMALIAS", "DIAGNOSTICADO", "APPROVED", "PROPOSTA", "APTO"].includes(result.status)) process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`Atlas: ${error instanceof AtlasError ? error.code : "LOCAL_FAILURE"}\n`);
    process.exitCode = 3;
  }
} else {
  process.stderr.write("Uso: atlas.mjs check [--synthetic[=confirmed|unknown-cause|test-failure|auth-unavailable]] | run sentinela|sherlock|valida|forge|guardiao | status\n");
  process.exitCode = 3;
}
