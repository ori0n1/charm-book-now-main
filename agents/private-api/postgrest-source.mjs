import { DOMAINS, STUDIO_CODE, validateResult } from "./contract.mjs";

const ORIGIN = "https://pwmdzpvnatrvfpgcvnzg.supabase.co";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const ALLOWED_ROLES = new Set(["saas_owner", "studio_owner", "manager", "staff", "desk_staff"]);
const REVIEWED_TABLES = ["appointments", "booking_payment_requests", "studios", "user_roles"];
const PAGE_LIMIT = 201; // 200 rows maximum; the 201st makes coverage indeterminate.
const MAX_BYTES = 64 * 1024;

function approved(proof, nowMs) {
  return proof?.projectRef === "pwmdzpvnatrvfpgcvnzg" &&
    proof?.role === "authenticated" &&
    proof?.rlsEffective === true && proof?.studioIsolationVerified === true &&
    proof?.policyFunctionsReviewed === true &&
    Array.isArray(proof?.reviewedTables) &&
    proof.reviewedTables.length === REVIEWED_TABLES.length &&
    REVIEWED_TABLES.every((table) => proof.reviewedTables.includes(table)) &&
    Number.isFinite(Date.parse(proof?.expiresAt)) &&
    Date.parse(proof.expiresAt) > nowMs &&
    Date.parse(proof.expiresAt) - nowMs <= 24 * 60 * 60_000;
}

function exact(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}

function authenticatedJwt(token) {
  if (typeof token !== "string" || token.length > 4096 || !JWT.test(token)) return false;
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return payload?.role === "authenticated" && UUID.test(payload?.sub ?? "");
  } catch { return false; }
}

function params(table, studioId, now) {
  const url = new URL(`/rest/v1/${table}`, ORIGIN);
  url.searchParams.set("select", table === "appointments"
    ? "studio_id,status,starts_at" : "studio_id,status,created_at");
  url.searchParams.set("studio_id", `eq.${studioId}`);
  const column = table === "appointments" ? "starts_at" : "created_at";
  const start = table === "appointments" ? now : now - 30 * 60_000;
  const end = table === "appointments" ? now + 30 * 60_000 : now;
  url.searchParams.append(column, `gte.${new Date(start).toISOString()}`);
  url.searchParams.append(column, `lt.${new Date(end).toISOString()}`);
  url.searchParams.set("limit", String(PAGE_LIMIT));
  return url;
}

async function limitedJson(response) {
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES || !response.body) throw new Error("SOURCE_UNAVAILABLE");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) throw new Error("SOURCE_UNAVAILABLE");
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks, total).toString("utf8")); }
  catch { throw new Error("SOURCE_UNAVAILABLE"); }
}

export function createPreparedPostgrestSource({ publishableKey, sessionProvider,
  studioIds, proof = null, fetchImpl = fetch, now = () => Date.now() } = {}) {
  if (typeof publishableKey !== "string" ||
      !/^sb_publishable_[A-Za-z0-9_-]{12,}$/.test(publishableKey) ||
      typeof sessionProvider !== "function" || typeof fetchImpl !== "function" ||
      !(studioIds instanceof Map) || studioIds.size < 1 || studioIds.size > 10 ||
      [...studioIds].some(([code, id]) => !STUDIO_CODE.test(code) || !UUID.test(id)) ||
      new Set(studioIds.values()).size !== studioIds.size) {
    throw new Error("POSTGREST_SOURCE_CONFIG_INVALID");
  }
  const approvedStudios = new Map(studioIds);
  const reviewedProof = proof ? { ...proof,
    reviewedTables: Array.isArray(proof.reviewedTables) ? [...proof.reviewedTables] : null } : null;
  async function get(url, token, signal) {
    if (url.origin !== ORIGIN || !["/auth/v1/user", "/rest/v1/user_roles",
      "/rest/v1/studios", "/rest/v1/appointments",
      "/rest/v1/booking_payment_requests"].includes(url.pathname)) {
      throw new Error("POSTGREST_PATH_DENIED");
    }
    let response;
    try {
      response = await fetchImpl(url.href, {
        method: "GET", redirect: "manual", cache: "no-store", signal,
        headers: { apikey: publishableKey,
          Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
    } catch { throw new Error("SOURCE_UNAVAILABLE"); }
    if (response.status === 401 || response.status === 403) {
      throw new Error("POSTGREST_AUTH_DENIED");
    }
    if (response.status !== 200) throw new Error("SOURCE_UNAVAILABLE");
    if (!response.headers.get("content-type")?.startsWith("application/json")) {
      throw new Error("SOURCE_UNAVAILABLE");
    }
    return limitedJson(response);
  }
  return {
    kind: "PREPARED_POSTGREST_RLS_GET",
    status: () => approved(reviewedProof, now()) ? "PROOF_SUPPLIED_NOT_LIVE_VALIDATED"
      : "BLOCKED_RLS_PROOF_MISSING",
    async read({ studioCode, domain, signal } = {}) {
      if (!STUDIO_CODE.test(studioCode ?? "") ||
          !Object.hasOwn(DOMAINS, domain ?? "") || !approvedStudios.has(studioCode)) {
        throw new Error("POSTGREST_STUDIO_DENIED");
      }
      // A caller-supplied proof is only a precondition. It does not establish
      // production RLS by itself; live activation still requires review.
      if (!approved(reviewedProof, now())) throw new Error("POSTGREST_PROOF_MISSING");
      let session;
      try { session = await sessionProvider(); }
      catch { throw new Error("POSTGREST_SESSION_UNAVAILABLE"); }
      if (!session || !authenticatedJwt(session.accessToken) ||
          !Number.isFinite(session.expiresAt) ||
          session.expiresAt <= now() + 10_000) {
        throw new Error("POSTGREST_SESSION_UNAVAILABLE");
      }
      const token = session.accessToken;
      const deadline = AbortSignal.timeout(1_800);
      const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
      const user = await get(new URL("/auth/v1/user", ORIGIN), token, combined);
      if (!UUID.test(user?.id ?? "") || user?.role !== "authenticated") {
        throw new Error("POSTGREST_AUTH_DENIED");
      }
      const jwtSubject = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")).sub;
      if (user.id !== jwtSubject) throw new Error("POSTGREST_AUTH_DENIED");
      const studioId = approvedStudios.get(studioCode);
      const membershipUrl = new URL("/rest/v1/user_roles", ORIGIN);
      membershipUrl.searchParams.set("select", "user_id,studio_id,role");
      membershipUrl.searchParams.set("user_id", `eq.${user.id}`);
      membershipUrl.searchParams.set("studio_id", `eq.${studioId}`);
      membershipUrl.searchParams.set("limit", "11");
      const memberships = await get(membershipUrl, token, combined);
      if (!Array.isArray(memberships) || memberships.length < 1 ||
          memberships.length > 10 || memberships.some((row) =>
            !exact(row, ["user_id", "studio_id", "role"]) ||
            row.user_id !== user.id || row.studio_id !== studioId ||
            !ALLOWED_ROLES.has(row.role))) {
        throw new Error("POSTGREST_STUDIO_DENIED");
      }
      const studioUrl = new URL("/rest/v1/studios", ORIGIN);
      studioUrl.searchParams.set("select", "id,is_active");
      studioUrl.searchParams.set("id", `eq.${studioId}`);
      studioUrl.searchParams.set("limit", "1");
      const studios = await get(studioUrl, token, combined);
      if (!Array.isArray(studios) || studios.length !== 1 ||
          !exact(studios[0], ["id", "is_active"]) ||
          studios[0].id !== studioId || studios[0].is_active !== true) {
        throw new Error("POSTGREST_STUDIO_DENIED");
      }
      const base = { studioCode, domain, source: "RLS_AGGREGATE_READ",
        observedAt: new Date(now()).toISOString(), windowMinutes: 30 };
      if (!["agenda", "reservas"].includes(domain)) {
        return validateResult({ ...base, coverage: "NOT_VERIFIABLE", metrics: null },
          { studioCode, domain });
      }
      const table = domain === "agenda" ? "appointments" : "booking_payment_requests";
      const rows = await get(params(table, studioId, now()), token, combined);
      if (!Array.isArray(rows) || rows.length > PAGE_LIMIT || rows.some((row) =>
          !exact(row, ["studio_id", "status", domain === "agenda" ? "starts_at" : "created_at"]) ||
          row.studio_id !== studioId || typeof row.status !== "string" ||
          row.status.length > 32)) {
        throw new Error("POSTGREST_STUDIO_DENIED");
      }
      if (rows.length === PAGE_LIMIT) {
        return validateResult({ ...base, coverage: "NOT_VERIFIABLE", metrics: null },
          { studioCode, domain });
      }
      const metrics = domain === "agenda"
        ? { loadErrors: null, queryErrors: 0,
          availabilityMismatches: null, availableSlots: null }
        : { stateInconsistencies: null, processingFailures: null,
          observedCount: rows.length };
      return validateResult({ ...base, coverage: "PARTIAL", metrics },
        { studioCode, domain });
    },
  };
}
