import { QA_AUTH_IDENTITIES, QA_IDENTITIES } from "./auth-session.mjs";

const ORIGIN = "https://pwmdzpvnatrvfpgcvnzg.supabase.co";
const COUNT = /^\d+-\d+\/(\d+)$|^\*\/(\d+)$/;

export async function readQaIsolation({ studioCode, accessToken, publishableKey,
  fetchImpl = fetch } = {}) {
  const own = QA_AUTH_IDENTITIES[studioCode];
  if (!own || typeof accessToken !== "string" || !accessToken ||
    typeof publishableKey !== "string" || !publishableKey) {
    throw new Error("QA_RLS_CONFIG_INVALID");
  }
  const foreign = QA_IDENTITIES[own.studioId === QA_IDENTITIES.STUDIO_QA_A.studioId
    ? "STUDIO_QA_B" : "STUDIO_QA_A"];
  async function count(table, studioId) {
    const url = new URL(`/rest/v1/${table}`, ORIGIN);
    url.searchParams.set("select", table === "user_roles" ? "user_id" : "id");
    url.searchParams.set("studio_id", `eq.${studioId}`);
    const response = await fetchImpl(url, {
      method: "HEAD", redirect: "manual", cache: "no-store",
      signal: AbortSignal.timeout(5_000),
      headers: { apikey: publishableKey, authorization: `Bearer ${accessToken}`,
        prefer: "count=exact", accept: "application/json" },
    });
    if (response.status !== 200 && response.status !== 206) throw new Error("QA_RLS_READ_FAILED");
    const match = COUNT.exec(response.headers.get("content-range") ?? "");
    if (!match) throw new Error("QA_RLS_COUNT_UNAVAILABLE");
    return Number(match[1] ?? match[2]);
  }
  const ownRoles = await count("user_roles", own.studioId);
  const foreignRoles = await count("user_roles", foreign.studioId);
  const foreignAppointments = await count("appointments", foreign.studioId);
  if (ownRoles < 1 || foreignRoles !== 0 || foreignAppointments !== 0) {
    throw new Error("QA_RLS_ISOLATION_FAILED");
  }
  return { ownRoles, foreignRoles, foreignAppointments };
}
