import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AgentPolicyError,
  assertAllowedOperation,
  createBudget,
} from "./policy.mjs";

const MAX_RESPONSE_BYTES = 512_000;

export function readOAuthToken({ appData = process.env.APPDATA, readFile = readFileSync } = {}) {
  if (!appData) throw new AgentPolicyError("AUTH_UNAVAILABLE");
  try {
    const config = readFile(join(appData, "xdg.config", ".wrangler", "config", "default.toml"), "utf8");
    const token = config.match(/^\s*oauth_token\s*=\s*"([^"]+)"/m)?.[1];
    if (!token) throw new AgentPolicyError("AUTH_UNAVAILABLE");
    return token;
  } catch {
    throw new AgentPolicyError("AUTH_UNAVAILABLE");
  }
}

export function createReadOnlyTransport({
  fetchImpl = fetch,
  tokenProvider = () => readOAuthToken(),
  budget = createBudget(),
} = {}) {
  async function request(method, url, { signal } = {}) {
    const kind = assertAllowedOperation(method, url);
    budget.consume(kind);
    const headers = kind === "cloudflare"
      ? { Authorization: `Bearer ${tokenProvider()}` }
      : { Accept: "text/html" };
    let response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers,
        redirect: "manual",
        cache: "no-store",
        signal,
      });
    } catch {
      throw new AgentPolicyError("NETWORK_UNAVAILABLE");
    }
    if (kind === "public") {
      await response.body?.cancel?.();
      return { status: response.status };
    }
    if (response.status === 401 || response.status === 403) {
      throw new AgentPolicyError("AUTH_REJECTED");
    }
    if (response.status === 429)
      throw new AgentPolicyError("CLOUDFLARE_RATE_LIMITED");
    if (response.status === 404)
      throw new AgentPolicyError("CLOUDFLARE_ENDPOINT_NOT_FOUND");
    if (response.status >= 500)
      throw new AgentPolicyError("CLOUDFLARE_API_UNAVAILABLE");
    if (!response.ok) throw new AgentPolicyError("CLOUDFLARE_READ_FAILED");
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_RESPONSE_BYTES) throw new AgentPolicyError("RESPONSE_TOO_LARGE");
    let bytes;
    try {
      bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > MAX_RESPONSE_BYTES) throw new AgentPolicyError("RESPONSE_TOO_LARGE");
      const parsed = JSON.parse(bytes.toString("utf8"));
      if (parsed.success !== true) throw new AgentPolicyError("CLOUDFLARE_READ_FAILED");
      return parsed.result;
    } catch (error) {
      if (error instanceof AgentPolicyError) throw error;
      throw new AgentPolicyError("INVALID_RESPONSE");
    }
  }
  return { request, budget };
}
