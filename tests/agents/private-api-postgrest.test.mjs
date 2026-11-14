import assert from "node:assert/strict";
import { test } from "node:test";
import { createPreparedPostgrestSource } from "../../agents/private-api/postgrest-source.mjs";
import { startPrivateApi } from "../../agents/private-api/server.mjs";

const A = "STUDIO_CAPIVARA";
const B = "STUDIO_27";
const A_ID = "11111111-1111-4111-8111-111111111111";
const B_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const NOW = Date.UTC(2026, 10, 14, 12);
const jwt = (role = "authenticated", sub = USER_ID) =>
  `e30.${Buffer.from(JSON.stringify({ role, sub })).toString("base64url")}.c2ln`;
const proof = () => ({ projectRef: "pwmdzpvnatrvfpgcvnzg",
  role: "authenticated", rlsEffective: true, studioIsolationVerified: true,
  policyFunctionsReviewed: true,
  reviewedTables: ["appointments", "booking_payment_requests", "studios", "user_roles"],
  expiresAt: new Date(NOW + 60_000).toISOString() });

function setup({ access = proof(), token = jwt(), responses = {}, statuses = {},
  session = true } = {}) {
  const calls = [];
  let sessionCalls = 0;
  const fetchImpl = async (href, options) => {
    const url = new URL(href);
    calls.push({ url, method: options.method, redirect: options.redirect,
      hasPublishableKey: options.headers.apikey.startsWith("sb_publishable_"),
      bearerRole: options.headers.Authorization.startsWith("Bearer ") });
    let rows;
    if (url.pathname === "/auth/v1/user") {
      rows = { id: USER_ID, role: "authenticated", email: "not-returned@example.test" };
    } else if (url.pathname === "/rest/v1/user_roles") {
      rows = [{ user_id: USER_ID, studio_id: A_ID, role: "studio_owner" }];
    } else if (url.pathname === "/rest/v1/studios") {
      rows = [{ id: A_ID, is_active: true }];
    } else if (url.pathname === "/rest/v1/appointments") {
      rows = [{ studio_id: A_ID, status: "confirmed", starts_at: new Date(NOW).toISOString() }];
    } else if (url.pathname === "/rest/v1/booking_payment_requests") {
      rows = [{ studio_id: A_ID, status: "pending", created_at: new Date(NOW).toISOString() }];
    } else throw new Error("unexpected path");
    return Response.json(responses[url.pathname] ?? rows,
      { status: statuses[url.pathname] ?? 200 });
  };
  const source = createPreparedPostgrestSource({
    publishableKey: "sb_publishable_synthetic_only", studioIds: new Map([[A, A_ID], [B, B_ID]]),
    proof: access, now: () => NOW, fetchImpl,
    sessionProvider: async () => {
      sessionCalls++;
      return session ? { accessToken: token, expiresAt: NOW + 60_000 } : null;
    },
  });
  return { source, calls, get sessionCalls() { return sessionCalls; } };
}

test("sem prova ou sessao nenhuma consulta ocorre", async () => {
  const noProof = setup({ access: null });
  assert.equal(noProof.source.status(), "BLOCKED_RLS_PROOF_MISSING");
  await assert.rejects(noProof.source.read({ studioCode: A, domain: "agenda" }), /PROOF_MISSING/);
  assert.equal(noProof.sessionCalls, 0);
  assert.equal(noProof.calls.length, 0);
  const noSession = setup({ session: false });
  await assert.rejects(noSession.source.read({ studioCode: A, domain: "agenda" }), /SESSION_UNAVAILABLE/);
  assert.equal(noSession.calls.length, 0);
});

test("papel privilegiado ou sessao invalida e recusado antes da rede", async () => {
  for (const token of [jwt("service_role"), "invalid", jwt("anon")]) {
    const env = setup({ token });
    await assert.rejects(env.source.read({ studioCode: A, domain: "reservas" }), /SESSION_UNAVAILABLE/);
    assert.equal(env.calls.length, 0);
  }
});

test("Auth API rejeitada impede consulta de tabelas", async () => {
  const env = setup({ statuses: { "/auth/v1/user": 401 } });
  await assert.rejects(env.source.read({ studioCode: A, domain: "agenda" }), /AUTH_DENIED/);
  assert.deepEqual(env.calls.map((call) => call.url.pathname), ["/auth/v1/user"]);
});

test("GET fixos produzem apenas observacao parcial de agenda e reservas", async () => {
  const env = setup();
  const agenda = await env.source.read({ studioCode: A, domain: "agenda" });
  const reservas = await env.source.read({ studioCode: A, domain: "reservas" });
  assert.equal(agenda.coverage, "PARTIAL");
  assert.equal(agenda.metrics.availableSlots, null);
  assert.equal(agenda.metrics.queryErrors, 0);
  assert.equal(reservas.metrics.observedCount, 1);
  assert.equal(reservas.metrics.stateInconsistencies, null);
  assert.equal(env.calls.length, 8);
  assert.ok(env.calls.every((call) => call.url.origin === "https://pwmdzpvnatrvfpgcvnzg.supabase.co" &&
    call.method === "GET" && call.redirect === "manual" &&
    call.hasPublishableKey && call.bearerRole &&
    !call.url.pathname.includes("rpc") && !call.url.pathname.includes("sql")));
  assert.deepEqual(new Set(env.calls.map((call) => call.url.pathname)), new Set([
    "/auth/v1/user", "/rest/v1/user_roles", "/rest/v1/studios",
    "/rest/v1/appointments", "/rest/v1/booking_payment_requests",
  ]));
  assert.doesNotMatch(JSON.stringify([agenda, reservas]), /email|phone|client|token|secret/i);
});

test("estudio nao autorizado e linhas cruzadas falham fechado", async () => {
  const forbidden = setup();
  await assert.rejects(forbidden.source.read({ studioCode: "STUDIO_UNKNOWN", domain: "agenda" }),
    /STUDIO_DENIED/);
  assert.equal(forbidden.calls.length, 0);
  const crossed = setup({ responses: { "/rest/v1/appointments": [
    { studio_id: B_ID, status: "confirmed", starts_at: new Date(NOW).toISOString() },
  ] } });
  await assert.rejects(crossed.source.read({ studioCode: A, domain: "agenda" }), /STUDIO_DENIED/);
});

test("duas identidades sinteticas permanecem isoladas por estudio", async () => {
  const otherUser = "44444444-4444-4444-8444-444444444444";
  const profiles = [
    { userId: USER_ID, studioId: A_ID, studioCode: A },
    { userId: otherUser, studioId: B_ID, studioCode: B },
  ];
  for (const profile of profiles) {
    const token = jwt("authenticated", profile.userId);
    const calls = [];
    const fetchImpl = async (href, options) => {
      const url = new URL(href);
      calls.push(url.pathname);
      if (options.method !== "GET") throw new Error("write attempted");
      if (url.pathname === "/auth/v1/user") {
        return Response.json({ id: profile.userId, role: "authenticated" });
      }
      if (url.pathname === "/rest/v1/user_roles") {
        return Response.json(url.searchParams.get("studio_id") === `eq.${profile.studioId}`
          ? [{ user_id: profile.userId, studio_id: profile.studioId, role: "studio_owner" }]
          : []);
      }
      if (url.pathname === "/rest/v1/studios") {
        return Response.json([{ id: profile.studioId, is_active: true }]);
      }
      if (url.pathname === "/rest/v1/appointments") {
        return Response.json([{ studio_id: profile.studioId, status: "confirmed",
          starts_at: new Date(NOW).toISOString() }]);
      }
      throw new Error("unexpected path");
    };
    const source = createPreparedPostgrestSource({
      publishableKey: "sb_publishable_synthetic_only",
      studioIds: new Map([[A, A_ID], [B, B_ID]]),
      proof: proof(), now: () => NOW, fetchImpl,
      sessionProvider: async () => ({ accessToken: token, expiresAt: NOW + 60_000 }),
    });
    assert.equal((await source.read({ studioCode: profile.studioCode,
      domain: "agenda" })).coverage, "PARTIAL");
    const beforeCross = calls.filter((item) => item === "/rest/v1/appointments").length;
    const otherStudio = profile.studioCode === A ? B : A;
    await assert.rejects(source.read({ studioCode: otherStudio, domain: "agenda" }),
      /STUDIO_DENIED/);
    assert.equal(calls.filter((item) => item === "/rest/v1/appointments").length,
      beforeCross);
  }
});

test("sem membership ou estudio ativo a leitura e bloqueada", async () => {
  for (const responses of [
    { "/rest/v1/user_roles": [] },
    { "/rest/v1/user_roles": [{ user_id: USER_ID, studio_id: B_ID, role: "studio_owner" }] },
    { "/rest/v1/studios": [{ id: A_ID, is_active: false }] },
  ]) {
    const env = setup({ responses });
    await assert.rejects(env.source.read({ studioCode: A, domain: "agenda" }), /STUDIO_DENIED/);
    assert.ok(!env.calls.some((call) => call.url.pathname === "/rest/v1/appointments"));
  }
});

test("paginacao incompleta nao e declarada saudavel", async () => {
  const rows = Array.from({ length: 201 }, () => ({ studio_id: A_ID,
    status: "pending", created_at: new Date(NOW).toISOString() }));
  const env = setup({ responses: { "/rest/v1/booking_payment_requests": rows } });
  const result = await env.source.read({ studioCode: A, domain: "reservas" });
  assert.equal(result.coverage, "NOT_VERIFIABLE");
  assert.equal(result.metrics, null);
});

test("dominios sem fonte ficam indeterminados e servidor atual nao ativa fonte real", async () => {
  const env = setup();
  const result = await env.source.read({ studioCode: A, domain: "pagamentos" });
  assert.equal(result.coverage, "NOT_VERIFIABLE");
  assert.equal(result.metrics, null);
  assert.equal(env.calls.length, 3); // auth + membership + studio, no payment rows
  await assert.rejects(startPrivateApi({
    clients: new Map([["atlas", { key: Buffer.alloc(32, 1), studios: [A] }]]),
    source: env.source,
  }), /CONFIG_INVALID/);
});
