export const CLOUDFLARE_ACCOUNT = "5c4cb61495df81feda4da7d1098e098e";
export const WORKER = "tanstack-start-app";
export const API_ORIGIN = "https://api.cloudflare.com";
export const SCRIPT_PATH = `/client/v4/accounts/${CLOUDFLARE_ACCOUNT}/workers/scripts/${WORKER}`;
export const PUBLIC_URLS = Object.freeze([
  "https://bellza.pt/",
  "https://bellza.pt/login",
]);
export const DISABLED_INTEGRATIONS = Object.freeze([
  "supabase",
  "agenda",
  "reservas",
  "stripe",
  "notificacoes",
]);

export class AgentPolicyError extends Error {
  constructor(code) {
    super(code);
    this.name = "AgentPolicyError";
    this.code = code;
  }
}

export function assertAllowedOperation(method, url) {
  if (method !== "GET") throw new AgentPolicyError("OPERATION_DENIED");
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new AgentPolicyError("OPERATION_DENIED");
  }
  if (parsed.username || parsed.password || parsed.hash || parsed.search) {
    throw new AgentPolicyError("OPERATION_DENIED");
  }
  if (PUBLIC_URLS.includes(parsed.href)) return "public";
  if (parsed.origin !== API_ORIGIN) throw new AgentPolicyError("OPERATION_DENIED");
  const path = parsed.pathname;
  const fixed = new Set([
    `${SCRIPT_PATH}/deployments`,
    `${SCRIPT_PATH}/settings`,
    `${SCRIPT_PATH}/schedules`,
  ]);
  if (fixed.has(path)) return "cloudflare";
  if (new RegExp(`^${SCRIPT_PATH}/versions/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$`).test(path)) {
    return "cloudflare";
  }
  throw new AgentPolicyError("OPERATION_DENIED");
}

export function createBudget({ maxCloudflareRequests = 4, maxPublicRequests = 2 } = {}) {
  const used = { cloudflare: 0, public: 0 };
  return {
    consume(kind) {
      if (!(kind in used)) throw new AgentPolicyError("OPERATION_DENIED");
      const limit = kind === "cloudflare" ? maxCloudflareRequests : maxPublicRequests;
      if (used[kind] >= limit) throw new AgentPolicyError("BUDGET_EXCEEDED");
      used[kind]++;
    },
    snapshot() {
      return { ...used, maxCloudflareRequests, maxPublicRequests };
    },
  };
}
