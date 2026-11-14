import { randomBytes } from "node:crypto";
import { signRequest } from "./auth.mjs";
import { DOMAINS, STUDIO_CODE, validateResult } from "./contract.mjs";

export function createPrivateApiClient({ baseUrl, clientId, key,
  fetchImpl = fetch, now = () => Date.now() } = {}) {
  let parsed;
  try { parsed = new URL(baseUrl); } catch { throw new Error("PRIVATE_API_CLIENT_INVALID"); }
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" ||
      parsed.username || parsed.password || parsed.pathname !== "/" ||
      parsed.search || parsed.hash || !/^[A-Za-z0-9_-]{1,32}$/.test(clientId ?? "") ||
      !Buffer.isBuffer(key) || key.length < 32) throw new Error("PRIVATE_API_CLIENT_INVALID");
  return async function read({ studioCode, domain }) {
    if (!STUDIO_CODE.test(studioCode ?? "") || !Object.hasOwn(DOMAINS, domain ?? "")) {
      throw new Error("PRIVATE_API_REQUEST_DENIED");
    }
    const path = `/v1/studios/${studioCode}/${domain}`;
    const timestamp = String(now());
    const nonce = randomBytes(18).toString("base64url");
    const signature = signRequest({ key, path, timestamp, nonce });
    const response = await fetchImpl(`${parsed.origin}${path}`, {
      method: "GET", redirect: "manual", cache: "no-store",
      signal: AbortSignal.timeout(5_000),
      headers: { "x-bellza-client": clientId, "x-bellza-time": timestamp,
        "x-bellza-nonce": nonce, "x-bellza-signature": signature },
    });
    if (response.status !== 200) throw new Error(`PRIVATE_API_${response.status}`);
    const text = await response.text();
    if (Buffer.byteLength(text) > 2048) throw new Error("PRIVATE_API_RESPONSE_TOO_LARGE");
    return validateResult(JSON.parse(text), { studioCode, domain });
  };
}
