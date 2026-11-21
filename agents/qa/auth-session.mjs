const ORIGIN = "https://pwmdzpvnatrvfpgcvnzg.supabase.co";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^sb_publishable_[A-Za-z0-9_-]{12,}$/;
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export const QA_IDENTITIES = Object.freeze({
  STUDIO_QA_A: Object.freeze({
    studioId: "e2663064-7774-41c5-95cb-e5e6afc4fab4",
    userId: "ec3128b3-a366-4358-afb6-cabd41b68e79",
    email: "qa-owner-20261025@bellza.invalid",
  }),
  STUDIO_QA_B: Object.freeze({
    studioId: "2cc1683e-ab91-4488-a702-6a8feb60f379",
    userId: "900acc24-5759-4571-a5d9-01588406f84d",
    email: "qa-owner-b-20261116@bellza.invalid",
  }),
});

export const QA_AUTH_IDENTITIES = Object.freeze({
  ...QA_IDENTITIES,
  STUDIO_QA_A_PROFESSIONAL: Object.freeze({
    studioId: "e2663064-7774-41c5-95cb-e5e6afc4fab4",
    userId: "9aef1eae-90b1-4ae7-9c5f-aee93abfb212",
    email: "qa-professional-20261025@bellza.invalid",
  }),
});

async function smallJson(response) {
  if (!response.headers.get("content-type")?.startsWith("application/json")) {
    throw new Error("QA_AUTH_UNAVAILABLE");
  }
  if (Number(response.headers.get("content-length") ?? 0) > 16_384 || !response.body) {
    throw new Error("QA_AUTH_UNAVAILABLE");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 16_384) throw new Error("QA_AUTH_UNAVAILABLE");
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks, bytes).toString("utf8")); }
  catch { throw new Error("QA_AUTH_UNAVAILABLE"); }
}

// Official Supabase Auth password grant. The password and returned JWT stay in
// this short-lived local process; callers must never log or persist either.
export async function signInQa({ studioCode, password, publishableKey,
  legacyVaultPassword = false, fetchImpl = fetch } = {}) {
  const identity = QA_AUTH_IDENTITIES[studioCode];
  // QA B retains its protected legacy password. New vault entries require 12.
  const minimumLength = legacyVaultPassword === true &&
    studioCode === "STUDIO_QA_B" ? 8 : 12;
  if (!identity || typeof password !== "string" || password.length < minimumLength ||
      password.length > 512 || !KEY.test(publishableKey ?? "") ||
      typeof fetchImpl !== "function") throw new Error("QA_AUTH_CONFIG_INVALID");
  let tokenResponse;
  try {
    tokenResponse = await fetchImpl(`${ORIGIN}/auth/v1/token?grant_type=password`, {
      method: "POST", redirect: "manual", cache: "no-store",
      signal: AbortSignal.timeout(5_000),
      headers: { apikey: publishableKey, "content-type": "application/json",
        accept: "application/json" },
      body: JSON.stringify({ email: identity.email, password }),
    });
  } catch { throw new Error("QA_AUTH_UNAVAILABLE"); }
  if (tokenResponse.status !== 200) {
    let reason = "UNSPECIFIED";
    try {
      const errorData = await smallJson(tokenResponse);
      const code = errorData?.error_code;
      if (["invalid_credentials", "weak_password", "email_not_confirmed",
        "user_banned"].includes(code)) reason = code.toUpperCase();
    } catch { /* Keep only a safe, fixed diagnostic code. */ }
    throw new Error(`QA_AUTH_DENIED_${reason}`);
  }
  const tokenData = await smallJson(tokenResponse);
  const token = tokenData?.access_token;
  if (typeof token !== "string" || token.length > 4096 || !JWT.test(token) ||
      !Number.isInteger(tokenData?.expires_in) || tokenData.expires_in < 30) {
    throw new Error("QA_AUTH_DENIED");
  }
  let payload;
  try { payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")); }
  catch { throw new Error("QA_AUTH_DENIED"); }
  if (payload?.sub !== identity.userId || payload?.role !== "authenticated") {
    throw new Error("QA_AUTH_DENIED");
  }
  let userResponse;
  try {
    userResponse = await fetchImpl(`${ORIGIN}/auth/v1/user`, {
      method: "GET", redirect: "manual", cache: "no-store",
      signal: AbortSignal.timeout(5_000),
      headers: { apikey: publishableKey, authorization: `Bearer ${token}`,
        accept: "application/json" },
    });
  } catch { throw new Error("QA_AUTH_UNAVAILABLE"); }
  if (userResponse.status !== 200) throw new Error("QA_AUTH_DENIED");
  const user = await smallJson(userResponse);
  if (user?.id !== identity.userId || user?.role !== "authenticated") {
    throw new Error("QA_AUTH_DENIED");
  }
  return { accessToken: token, expiresAt: Date.now() + tokenData.expires_in * 1_000,
    userId: identity.userId, studioCode };
}
