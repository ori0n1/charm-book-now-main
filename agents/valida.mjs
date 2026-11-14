import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const guard = fileURLToPath(new URL("./local-test-guard.cjs", import.meta.url));
export const TEST_CASES = Object.freeze([
  { file: "tests/agenda-payment-summary.test.mjs", areas: ["agenda", "pagamentos"] },
  { file: "tests/account-booking-phone.test.mjs", areas: ["agenda", "reservas"] },
  { file: "tests/client-duplicates.test.mjs", areas: ["clientes"] },
  { file: "tests/client-profile-archive.test.mjs", areas: ["clientes"] },
  { file: "tests/booking-payment-phone.test.mjs", areas: ["reservas", "pagamentos"] },
  { file: "tests/smart-whatsapp-reminder.test.mjs", areas: ["notificacoes"] },
  { file: "tests/smart-whatsapp-cron-isolation.test.mjs", areas: ["notificacoes"] },
]);
export const AREA_ORDER = Object.freeze(["agenda", "clientes", "reservas", "notificacoes", "pagamentos"]);

export function syntheticEnvironment(input = process.env) {
  const output = {};
  const forbidden = /(?:TOKEN|SECRET|PASSWORD|_KEY$|SUPABASE|STRIPE|CLOUDFLARE|DATABASE|POSTGRES|^PG[A-Z_]*$|TWILIO|SENDDM|RESEND|ARARA|VAPID|GOOGLE|AWS|AZURE|OPENAI|ANTHROPIC|NODE_OPTIONS|NODE_PATH|^APPDATA$|^LOCALAPPDATA$|^USERPROFILE$)/i;
  for (const [name, value] of Object.entries(input)) {
    if (!forbidden.test(name)) output[name] = value;
  }
  output.BELLZA_SYNTHETIC_ONLY = "true";
  return output;
}

export function runApprovedTest(testCase, { timeoutMs = 15_000 } = {}) {
  if (!TEST_CASES.some((item) => item.file === testCase.file)) {
    return { file: "not-allowlisted", state: "INDETERMINATE", reason: "TEST_NOT_ALLOWLISTED", durationMs: 0 };
  }
  const file = join(root, testCase.file);
  if (!existsSync(file)) {
    return { file: testCase.file, state: "INDETERMINATE", reason: "TEST_FILE_MISSING", durationMs: 0 };
  }
  const started = Date.now();
  const result = spawnSync(process.execPath, ["--require", guard, "--test", file], {
    cwd: root,
    env: syntheticEnvironment(),
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 256_000,
  });
  const durationMs = Date.now() - started;
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.error?.code === "ETIMEDOUT") {
    return { file: testCase.file, state: "INDETERMINATE", reason: "TEST_TIMEOUT", durationMs };
  }
  if (result.error || result.status === null) {
    return { file: testCase.file, state: "INDETERMINATE", reason: "TEST_RUNNER_UNAVAILABLE", durationMs };
  }
  if (result.status === 0) {
    return { file: testCase.file, state: "PASS", reason: null, durationMs };
  }
  if (/ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|Cannot find module/.test(output)) {
    return { file: testCase.file, state: "INDETERMINATE", reason: "DEPENDENCY_UNAVAILABLE", durationMs };
  }
  if (/BELLZA_TEST_NETWORK_DENIED/.test(output)) {
    return { file: testCase.file, state: "FAIL", reason: "NETWORK_ATTEMPT_BLOCKED", durationMs };
  }
  return { file: testCase.file, state: "FAIL", reason: "SYNTHETIC_TEST_FAILED", durationMs };
}

// Fixed data contracts: never executes test code from the patch worktree.
export function runReferenceRegression({ workspace } = {}) {
  if (typeof workspace !== "string" || !existsSync(join(workspace,
    "agents", "reference.json")))
    return { status: "INDETERMINATE", tests: [],
      reason: "DIRECTED_TEST_UNAVAILABLE" };
  const git = (args) => spawnSync("git", ["-C", workspace, ...args],
    { shell: false, encoding: "utf8", windowsHide: true,
      timeout: 10_000, maxBuffer: 128_000 });
  const original = git(["show", "HEAD:agents/reference.json"]);
  const changed = git(["diff", "--name-only"]);
  if (original.status !== 0 || changed.status !== 0)
    return { agent: "valida", status: "INDETERMINATE", tests: [],
      reason: "GIT_EVIDENCE_UNAVAILABLE" };
  let before, after;
  try {
    before = JSON.parse(original.stdout);
    after = JSON.parse(readFileSync(join(workspace, "agents",
      "reference.json"), "utf8"));
  } catch {
    return { agent: "valida", status: "FAILED",
      tests: [{ file: "agents/reference.json",
        state: "FAIL" }], reason: "INVALID_REFERENCE_JSON" };
  }
  const keys = Object.keys(before).sort();
  const sameShape = JSON.stringify(keys) ===
    JSON.stringify(Object.keys(after).sort());
  const preserved = sameShape && keys.every((key) =>
    key === "officialRecordedVersion" ||
    JSON.stringify(before[key]) === JSON.stringify(after[key]));
  const scoped = changed.stdout.trim().replaceAll("\r", "") ===
    "agents/reference.json";
  const reconciled = typeof after.observedVersion === "string" &&
    after.officialRecordedVersion === after.observedVersion &&
    before.officialRecordedVersion !== after.officialRecordedVersion;
  const tests = [
    { file: "agents/reference.json:shape", state: preserved ? "PASS" : "FAIL" },
    { file: "agents/reference.json:scope", state: scoped ? "PASS" : "FAIL" },
    { file: "agents/reference.json:version", state: reconciled ? "PASS" : "FAIL" },
  ];
  return { agent: "valida",
    status: tests.every((item) => item.state === "PASS")
      ? "APPROVED" : "FAILED",
    tests, reason: tests.every((item) => item.state === "PASS")
      ? null : "REFERENCE_REGRESSION_FAILED" };
}

export function runValida({ cases = TEST_CASES, runCase = runApprovedTest, now = () => new Date() } = {}) {
  const observedAt = now().toISOString();
  const results = cases.map((testCase) => ({
    ...runCase(testCase),
    areas: [...testCase.areas],
  }));
  const areas = AREA_ORDER.map((name) => {
    const related = results.filter((item) => item.areas.includes(name));
    const status = related.some((item) => item.state === "FAIL") ? "FAILED"
      : related.some((item) => item.state === "INDETERMINATE") ? "INDETERMINATE"
      : "APPROVED";
    return { name, status, tests: related.length };
  });
  const status = areas.some((item) => item.status === "FAILED") ? "FAILED"
    : areas.some((item) => item.status === "INDETERMINATE") ? "INDETERMINATE"
    : "APPROVED";
  return {
    agent: "valida",
    observedAt,
    status,
    areas,
    tests: results,
    recommendations: status === "APPROVED"
      ? ["Os contratos sintéticos selecionados passaram; isso não comprova paridade de produção."]
      : status === "FAILED"
        ? ["Rever os testes falhados em ambiente local antes de propor qualquer correção."]
        : ["Resolver a indisponibilidade local e repetir os testes sintéticos."],
    usage: { testsRun: results.length, maxTests: TEST_CASES.length },
  };
}

export function formatValidaReport(report) {
  return [
    `# Valida — ${report.status}`,
    "",
    `Execução: ${report.observedAt}`,
    "",
    "## Áreas",
    "",
    ...report.areas.map((item) => `- ${item.name}: ${item.status} (${item.tests} ficheiros)`),
    "",
    "## Testes locais",
    "",
    ...report.tests.map((item) => `- ${item.file}: ${item.state}${item.reason ? ` (${item.reason})` : ""}`),
    "",
    "## Recomendação",
    "",
    ...report.recommendations.map((item) => `- ${item}`),
    "",
    "Nenhum teste usa credenciais de produção ou chamadas de rede permitidas.",
    "",
  ].join("\n");
}
