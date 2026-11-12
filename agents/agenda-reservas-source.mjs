import { existsSync } from "node:fs";
import { join } from "node:path";
import { FUNCTIONAL_DOMAINS, validateFunctionalSnapshot } from "./functional-contract.mjs";

const PROJECT_REF = "pwmdzpvnatrvfpgcvnzg";
const STUDIO_CODE = /^STUDIO_[A-Z0-9_]{1,24}$/;
const exactKeys = (value, expected) => value && typeof value === "object" &&
  !Array.isArray(value) && Object.keys(value).length === expected.length &&
  expected.every((key) => Object.hasOwn(value, key));

// Presence checks only. This never opens a vault, certificate or config file.
export function inspectLocalAgendaReservationAccess({
  localAppData = process.env.LOCALAPPDATA, exists = existsSync,
} = {}) {
  if (!localAppData) return { status: "BLOCKED_LOCAL_READ_CONFIG_MISSING" };
  const base = join(localAppData, "Bellza");
  if (!exists(join(base, "sql-catalog.json"))) {
    return { status: "BLOCKED_LOCAL_READ_CONFIG_MISSING" };
  }
  if (!exists(join(base, "prod-supabase-ca.crt"))) {
    return { status: "BLOCKED_CA_MISSING" };
  }
  if (!exists(join(base, "vault-unlock.clixml"))) {
    return { status: "BLOCKED_VAULT_ACCESS_MISSING" };
  }
  // Local files alone do not establish the effective database role, RLS or
  // absence of write privileges. No connection is attempted here.
  return { status: "BLOCKED_EFFECTIVE_ROLE_UNVERIFIED" };
}

export function assessAgendaReservationReadProof(proof) {
  if (!proof || proof.projectRef !== PROJECT_REF ||
      proof.transactionReadOnly !== true || proof.canLogin !== true ||
      proof.superuser !== false || proof.bypassRls !== false ||
      proof.canWrite !== false || proof.securityDefinerWrite !== false ||
      proof.rlsEffective !== true || proof.studioIsolationVerified !== true ||
      proof.roleMemberships !== 0 ||
      !/^[a-z][a-z0-9_]{2,62}$/.test(proof.roleName ?? "") ||
      ["postgres", "service_role", "supabase_admin"].includes(proof.roleName)) {
    return { status: "BLOCKED_READ_PROOF_UNSAFE" };
  }
  return { status: "READY_RLS_READ" };
}

export async function collectAgendaReservationAggregates({
  source, studioCodes, now = () => new Date(),
} = {}) {
  if (!source || source.kind !== "TRUSTED_RLS_AGGREGATE_READER" ||
      typeof source.openReadOnlySession !== "function" ||
      !Array.isArray(studioCodes) || studioCodes.length < 1 ||
      studioCodes.length > 10 || new Set(studioCodes).size !== studioCodes.length ||
      studioCodes.some((code) => !STUDIO_CODE.test(code))) {
    throw new Error("FUNCTIONAL_ACCESS_BLOCKED");
  }
  let session;
  try { session = await source.openReadOnlySession(); }
  catch { throw new Error("FUNCTIONAL_ACCESS_BLOCKED"); }
  if (!session || typeof session.verifyRole !== "function" ||
      typeof session.readAggregates !== "function" ||
      typeof session.close !== "function") {
    try { await session?.close?.(); } catch { /* Fail closed. */ }
    throw new Error("FUNCTIONAL_ACCESS_BLOCKED");
  }
  try {
    let proof;
    try { proof = await session.verifyRole(); }
    catch { throw new Error("FUNCTIONAL_ACCESS_BLOCKED"); }
    if (assessAgendaReservationReadProof(proof).status !== "READY_RLS_READ") {
      throw new Error("FUNCTIONAL_ACCESS_BLOCKED");
    }
    let rows;
    try { rows = await session.readAggregates([...studioCodes]); }
    catch { throw new Error("FUNCTIONAL_READ_FAILED"); }
    if (!Array.isArray(rows) || rows.length !== studioCodes.length) {
      throw new Error("FUNCTIONAL_STUDIO_ISOLATION_FAILED");
    }
    const expected = new Set(studioCodes);
    const observed = new Set();
    const studios = rows.map((row) => {
      if (!exactKeys(row, ["studioCode", "agenda", "reservas"]) ||
          !expected.has(row.studioCode) || observed.has(row.studioCode) ||
          !exactKeys(row.agenda, Object.keys(FUNCTIONAL_DOMAINS.agenda)) ||
          !exactKeys(row.reservas, Object.keys(FUNCTIONAL_DOMAINS.reservas))) {
        throw new Error("FUNCTIONAL_STUDIO_ISOLATION_FAILED");
      }
      observed.add(row.studioCode);
      return {
        studioCode: row.studioCode, agenda: row.agenda, reservas: row.reservas,
        ...Object.fromEntries(["whatsapp", "pagamentos", "clientes"].map((domain) =>
          [domain, Object.fromEntries(Object.keys(FUNCTIONAL_DOMAINS[domain])
            .map((metric) => [metric, 0]))])),
      };
    });
    return validateFunctionalSnapshot({
      schema: 1, source: "RLS_AGGREGATE_READ",
      observedAt: now().toISOString(), studios,
    });
  } finally {
    await session.close();
  }
}
