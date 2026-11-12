import { runSentinela } from "../../agents/sentinela.mjs";
import { AgentPolicyError, assertAllowedOperation, createBudget, PUBLIC_URLS } from "../../agents/policy.mjs";

const official = "11111111-1111-4111-8111-111111111111";
const observed = "22222222-2222-4222-8222-222222222222";
const reference = {
  observedVersion: observed, officialRecordedVersion: official,
  observedAt: "2026-01-01T00:00:00Z", plainNames: [], secretNames: [], crons: [],
  runtime: { compatibility_date: "2025-01-01", compatibility_flags: [], usage_model: "standard" },
};

try {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk.toString("utf8");
    if (Buffer.byteLength(input) > 4096) throw new Error("INPUT_LIMIT");
  }
  const { scenario } = JSON.parse(input);
  if (!["confirmed", "unknown-cause", "test-failure", "auth-unavailable"].includes(scenario)) {
    throw new Error("INVALID_SYNTHETIC_SCENARIO");
  }
  const budget = createBudget();
  const transport = {
    budget,
    async request(method, url) {
      const kind = assertAllowedOperation(method, url);
      budget.consume(kind);
      if (kind === "cloudflare" && scenario === "auth-unavailable") {
        throw new AgentPolicyError("AUTH_UNAVAILABLE");
      }
      if (PUBLIC_URLS.includes(url)) return { status: 200 };
      const path = new URL(url).pathname;
      if (path.endsWith("/deployments")) {
        return { deployments: [{ versions: [{ version_id: observed, percentage: 100 }] }] };
      }
      if (path.endsWith(`/versions/${observed}`)) {
        return { id: observed, resources: { bindings: [], script_runtime: reference.runtime } };
      }
      if (path.endsWith("/settings")) return { bindings: [] };
      if (path.endsWith("/schedules")) return { schedules: [] };
      throw new AgentPolicyError("OPERATION_DENIED");
    },
  };
  process.stdout.write(JSON.stringify(await runSentinela({ reference, transport })));
} catch {
  process.exitCode = 1;
}
