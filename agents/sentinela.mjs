import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  AgentPolicyError,
  DISABLED_INTEGRATIONS,
  PUBLIC_URLS,
  SCRIPT_PATH,
  createBudget,
} from "./policy.mjs";
import { createReadOnlyTransport } from "./transport.mjs";
export { inspectFunctionalSnapshot } from "./functional-contract.mjs";

const referencePath = fileURLToPath(new URL("./reference.json", import.meta.url));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const sorted = (values) => [...values].sort();
const bindingKeys = (bindings) => sorted(bindings.map((item) => `${item.name}:${item.type}`));
const expectedBindingKeys = (reference) => sorted([
  ...reference.plainNames.map((name) => `${name}:plain_text`),
  ...reference.secretNames.map((name) => `${name}:secret_text`),
]);
const runtimeShape = (runtime = {}) => ({
  compatibility_date: runtime.compatibility_date ?? null,
  compatibility_flags: sorted(runtime.compatibility_flags ?? []),
  usage_model: runtime.usage_model ?? null,
});
const errorCode = (error) => error instanceof AgentPolicyError
  ? error.code
  : "READ_FAILED";

export function loadReference() {
  return JSON.parse(readFileSync(referencePath, "utf8"));
}

export function classifyVersion(observed, observedCreatedAt, reference) {
  if (observed === reference.observedVersion) return null;
  const newer = Number.isFinite(Date.parse(observedCreatedAt ?? "")) &&
    Date.parse(observedCreatedAt) > Date.parse(reference.observedAt);
  return newer ? "REFERENCE_OUTDATED" : "VERSION_DIVERGENCE_UNEXPLAINED";
}

export async function runSentinela({
  reference = loadReference(),
  transport,
  signal,
  now = () => new Date(),
} = {}) {
  const budget = transport?.budget ?? createBudget();
  const reader = transport ?? createReadOnlyTransport({ budget });
  const report = {
    agent: "sentinela",
    observedAt: now().toISOString(),
    status: "OK",
    reference: {
      observedVersion: reference.observedVersion,
      officialRecordedVersion: reference.officialRecordedVersion,
      observedAt: reference.observedAt,
    },
    observed: { activeVersion: null, bindings: null, bindingDiff: null, runtime: null, crons: null },
    checks: [],
    anomalies: [],
    recommendations: [],
    integrations: DISABLED_INTEGRATIONS.map((name) => ({
      name,
      status: "DISABLED_NO_SAFE_READ_ACCESS",
    })),
  };
  const addAnomaly = (code, severity, detail) => {
    report.anomalies.push({ code, severity, detail });
  };

  try {
    const deployments = await reader.request("GET", `https://api.cloudflare.com${SCRIPT_PATH}/deployments`, { signal });
    const latest = deployments.deployments?.[0];
    const traffic = latest?.versions ?? [];
    const active = traffic.filter((item) => item.percentage === 100);
    if (active.length !== 1) {
      report.checks.push({ name: "cloudflare_traffic", status: "FAILED" });
      addAnomaly("TRAFFIC_NOT_SINGLE_100", "critical", "Não existe uma única versão com 100% do tráfego.");
    } else {
      const versionId = active[0].version_id;
      report.checks.push({ name: "cloudflare_traffic", status: "PASS", version: versionId, percentage: 100 });
      const versionResult = await reader.request(
        "GET", `https://api.cloudflare.com${SCRIPT_PATH}/versions/${versionId}`, { signal },
      );
      if (versionResult.id !== versionId) throw new AgentPolicyError("INVALID_RESPONSE");
      report.observed.activeVersion = versionId;
      if (versionId === reference.observedVersion &&
          reference.officialRecordedVersion !== reference.observedVersion) {
        addAnomaly("OFFICIAL_RECORD_OUTDATED", "warning",
          "A referência oficial difere da versão ativa observada pela Cloudflare.");
      }
      const versionCode = classifyVersion(versionId, versionResult.metadata?.created_on, reference);
      if (versionCode) {
        addAnomaly(
          versionCode,
          "warning",
          versionCode === "REFERENCE_OUTDATED"
            ? "A versão ativa é posterior à observação do manifesto; atualizar a referência após verificar a origem."
            : "A versão ativa difere da referência sem prova de que esta esteja apenas desatualizada.",
        );
      }
      const actualBindings = bindingKeys(versionResult.resources?.bindings ?? []);
      const expectedBindings = expectedBindingKeys(reference);
      report.observed.bindings = actualBindings;
      report.observed.bindingDiff = {
        missing: expectedBindings.filter((item) => !actualBindings.includes(item)),
        unexpected: actualBindings.filter((item) => !expectedBindings.includes(item)),
      };
      if (!same(actualBindings, expectedBindings)) {
        report.checks.push({ name: "bindings", status: "FAILED", count: actualBindings.length });
        addAnomaly("BINDINGS_DIVERGENCE_CONFIRMED", "critical",
          "Os nomes ou tipos dos bindings da versão ativa diferem do manifesto.");
      } else {
        report.checks.push({ name: "bindings", status: "PASS", count: actualBindings.length });
      }
      const runtime = runtimeShape(versionResult.resources?.script_runtime);
      report.observed.runtime = runtime;
      if (!same(runtime, runtimeShape(reference.runtime))) {
        report.checks.push({ name: "runtime", status: "FAILED" });
        addAnomaly("RUNTIME_DIVERGENCE_CONFIRMED", "critical",
          "O runtime da versão ativa difere do manifesto.");
      } else {
        report.checks.push({ name: "runtime", status: "PASS" });
      }
      const settings = await reader.request("GET", `https://api.cloudflare.com${SCRIPT_PATH}/settings`, { signal });
      if (!same(bindingKeys(settings.bindings ?? []), actualBindings)) {
        report.checks.push({ name: "script_settings", status: "REVIEW" });
        addAnomaly("SETTINGS_VERSION_MISMATCH", "warning",
          "Os bindings das definições do script diferem dos da versão ativa.");
      } else {
        report.checks.push({ name: "script_settings", status: "PASS" });
      }
    }
    const schedules = await reader.request("GET", `https://api.cloudflare.com${SCRIPT_PATH}/schedules`, { signal });
    const crons = sorted((schedules.schedules ?? schedules).map((item) => item.cron));
    report.observed.crons = crons;
    if (!same(crons, sorted(reference.crons))) {
      report.checks.push({ name: "crons", status: "FAILED", count: crons.length });
      addAnomaly("CRONS_DIVERGENCE_CONFIRMED", "critical",
        "Os crons ativos diferem do manifesto.");
    } else {
      report.checks.push({ name: "crons", status: "PASS", count: crons.length });
    }
  } catch (error) {
    const code = errorCode(error);
    report.checks.push({ name: "cloudflare_read", status: "BLOCKED", reason: code });
    addAnomaly(code, "blocked", "Não foi possível concluir a leitura autorizada da Cloudflare.");
  }

  for (const url of PUBLIC_URLS) {
    if (signal?.aborted) break;
    try {
      const response = await reader.request("GET", url, { signal });
      const available = response.status >= 200 && response.status < 400;
      report.checks.push({ name: "public_endpoint", path: new URL(url).pathname, status: available ? "PASS" : "FAILED", httpStatus: response.status });
      if (!available) addAnomaly("PUBLIC_ENDPOINT_UNAVAILABLE", "warning",
        `Endpoint público ${new URL(url).pathname} respondeu HTTP ${response.status}.`);
    } catch (error) {
      const code = errorCode(error);
      report.checks.push({ name: "public_endpoint", path: new URL(url).pathname, status: "BLOCKED", reason: code });
      addAnomaly("PUBLIC_ENDPOINT_READ_BLOCKED", "blocked",
        `Endpoint público ${new URL(url).pathname} não pôde ser verificado.`);
    }
  }

  if (report.anomalies.some((item) => item.severity === "critical")) report.status = "ALERTA";
  else if (report.anomalies.some((item) => item.severity === "blocked")) report.status = "INDETERMINADO";
  else if (report.anomalies.length) report.status = "ATENCAO";
  if (report.anomalies.some((item) => item.code === "OFFICIAL_RECORD_OUTDATED" || item.code === "REFERENCE_OUTDATED")) {
    report.recommendations.push("Reconciliar a referência Git com o Worker ativo após comprovar a origem do artefacto.");
  }
  if (report.status === "INDETERMINADO") {
    report.recommendations.push("Restabelecer o acesso de leitura autorizado e repetir a verificação manual.");
  }
  if (report.status === "ALERTA") {
    report.recommendations.push("Investigar a divergência sem modificar produção; qualquer correção exige aprovação específica.");
  }
  report.usage = budget.snapshot();
  return report;
}

export function formatSentinelaReport(report) {
  const lines = [
    `# Sentinela — ${report.status}`,
    "",
    `Execução: ${report.observedAt}`,
    `Referência observada: ${report.reference.observedVersion}`,
    `Referência oficial: ${report.reference.officialRecordedVersion}`,
    `Versão ativa confirmada: ${report.observed?.activeVersion ?? "indisponível"}`,
    "",
    "## Metadados observados (sem valores de bindings)",
    "",
    `Bindings por nome/tipo: ${report.observed?.bindings ? report.observed.bindings.length : "indisponíveis"}`,
    ...(report.observed?.bindings?.map((item) => `- ${item}`) ?? []),
    ...(report.observed?.bindingDiff?.missing?.length
      ? [`Em falta: ${report.observed.bindingDiff.missing.join(", ")}`] : []),
    ...(report.observed?.bindingDiff?.unexpected?.length
      ? [`Adicionais: ${report.observed.bindingDiff.unexpected.join(", ")}`] : []),
    `Runtime: ${report.observed?.runtime ? JSON.stringify(report.observed.runtime) : "indisponível"}`,
    `Crons: ${report.observed?.crons ? report.observed.crons.join(", ") || "nenhum" : "indisponíveis"}`,
    "",
    "## Verificações",
    "",
    ...report.checks.map((check) =>
      `- ${check.name}${check.path ? ` ${check.path}` : ""}: ${check.status}${check.httpStatus ? ` (HTTP ${check.httpStatus})` : ""}${check.reason ? ` (${check.reason})` : ""}`),
    "",
    "## Anomalias",
    "",
    ...(report.anomalies.length
      ? report.anomalies.map((item) => `- ${item.code} [${item.severity}]: ${item.detail}`)
      : ["- Nenhuma anomalia observada."]),
    "",
    "## Recomendações",
    "",
    ...(report.recommendations.length ? report.recommendations.map((item) => `- ${item}`) : ["- Manter verificações manuais somente de leitura."]),
    "",
    "Integrações futuras desativadas: Supabase, agenda, reservas, Stripe e notificações.",
    "",
  ];
  return lines.join("\n");
}
