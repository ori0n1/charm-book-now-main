import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { signRequest } from "../../agents/private-api/auth.mjs";
import { inspectPrivateAggregate } from "../../agents/private-api/analysis.mjs";
import { createPrivateApiClient } from "../../agents/private-api/client.mjs";
import { createSyntheticSource } from "../../agents/private-api/fixtures.mjs";
import { startPrivateApi } from "../../agents/private-api/server.mjs";

const A = "STUDIO_CAPIVARA";
const B = "STUDIO_27";
const path = (studio, domain = "agenda") => `/v1/studios/${studio}/${domain}`;

async function setup({ source = createSyntheticSource(), limit = 30,
  readTimeoutMs = 2_000, maxInFlight = 2 } = {}) {
  const key = randomBytes(32);
  const api = await startPrivateApi({
    clients: new Map([["atlas", { key, studios: [A] }],
      ["sentinela", { key: randomBytes(32), studios: [B] }]]),
    source, maxRequestsPerMinute: limit, readTimeoutMs, maxInFlight,
  });
  return { ...api, key, read: createPrivateApiClient({
    baseUrl: api.url, clientId: "atlas", key }),
    async request(studio, domain = "agenda", options = {}) {
      const target = path(studio, domain);
      const timestamp = String(Date.now());
      const nonce = options.nonce ?? randomBytes(18).toString("base64url");
      const signature = options.signature ?? signRequest({ key, path: target,
        timestamp: options.timestamp ?? timestamp, nonce });
      return fetch(`${api.url}${options.path ?? target}`, {
        method: options.method ?? "GET", redirect: "manual",
        headers: { "x-bellza-client": "atlas",
          "x-bellza-time": options.timestamp ?? timestamp,
          "x-bellza-nonce": nonce, "x-bellza-signature": signature },
      });
    },
  };
}

test("agenda e reservas respondem apenas com agregados sinteticos", async () => {
  const env = await setup();
  try {
    const agenda = await env.read({ studioCode: A, domain: "agenda" });
    const reservas = await env.read({ studioCode: A, domain: "reservas" });
    assert.equal(agenda.source, "SYNTHETIC_FIXTURE");
    assert.equal(agenda.metrics.loadErrors, 1);
    assert.equal(reservas.metrics.observedCount, 3);
    assert.deepEqual(inspectPrivateAggregate(agenda).map((item) => item.code),
      ["AGENDA_LOAD_FAILED"]);
    assert.doesNotMatch(JSON.stringify([agenda, reservas]), /phone|email|clientName|token|secret/i);
  } finally { await env.close(); }
});

test("notificacoes e pagamentos sem fonte nao aparecem como saudaveis", async () => {
  const env = await setup();
  try {
    for (const domain of ["notificacoes", "pagamentos"]) {
      const result = await env.read({ studioCode: A, domain });
      assert.equal(result.coverage, "NOT_VERIFIABLE");
      assert.equal(result.metrics, null);
      assert.deepEqual(inspectPrivateAggregate(result), []);
    }
  } finally { await env.close(); }
});

test("autenticacao, replay, expiracao e isolamento por estudio", async () => {
  const env = await setup();
  try {
    assert.equal((await fetch(`${env.url}${path(A)}`)).status, 401);
    assert.equal((await env.request(A, "agenda", { signature: "0".repeat(64) })).status, 401);
    assert.equal((await env.request(A, "agenda", { timestamp: String(Date.now() - 120_000) })).status, 401);
    assert.equal((await env.request(B)).status, 401);
    const nonce = randomBytes(18).toString("base64url");
    // Reuse exact signed headers: the second call is rejected.
    const timestamp = String(Date.now());
    const signature = signRequest({ key: env.key, path: path(A), timestamp, nonce });
    const options = { nonce, timestamp, signature };
    assert.equal((await env.request(A, "agenda", options)).status, 200);
    assert.equal((await env.request(A, "agenda", options)).status, 401);
  } finally { await env.close(); }
});

test("metodos, caminhos e consultas arbitrarias sao recusados", async () => {
  const env = await setup();
  try {
    assert.equal((await env.request(A, "agenda", { method: "POST" })).status, 405);
    assert.equal((await env.request(A, "agenda", { path: `${path(A)}?sql=SELECT` })).status, 404);
    assert.equal((await env.request(A, "agenda", { path: "/v1/sql" })).status, 404);
    await assert.rejects(env.read({ studioCode: A, domain: "sql" }), /REQUEST_DENIED/);
  } finally { await env.close(); }
});

test("limite de frequencia e tempo", async () => {
  const limited = await setup({ limit: 1 });
  try {
    assert.equal((await limited.request(A)).status, 200);
    assert.equal((await limited.request(A)).status, 429);
  } finally { await limited.close(); }
  const slow = await setup({ readTimeoutMs: 100,
    source: { kind: "SYNTHETIC_ONLY", read: () => new Promise(() => {}) } });
  try {
    const result = await slow.request(A);
    assert.equal(result.status, 503);
    assert.deepEqual(await result.json(), { status: "SOURCE_TIMEOUT" });
  } finally { await slow.close(); }
});

test("consultas simultaneas excedentes sao bloqueadas", async () => {
  let started;
  let release;
  const entered = new Promise((resolve) => { started = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const fixture = createSyntheticSource();
  const env = await setup({ maxInFlight: 1,
    source: { kind: "SYNTHETIC_ONLY", async read(args) {
      started();
      await gate;
      return fixture.read(args);
    } } });
  try {
    const first = env.request(A);
    await entered;
    assert.equal((await env.request(A, "reservas")).status, 429);
    release();
    assert.equal((await first).status, 200);
  } finally { release(); await env.close(); }
});

test("resultado cruzado ou com dados pessoais falha fechado", async () => {
  for (const mutate of [
    (value) => ({ ...value, studioCode: B }),
    (value) => ({ ...value, clientPhone: "synthetic" }),
  ]) {
    const fixture = createSyntheticSource();
    const env = await setup({ source: { kind: "SYNTHETIC_ONLY",
      read: async (args) => mutate(await fixture.read(args)) } });
    try {
      const response = await env.request(A);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { status: "SOURCE_UNAVAILABLE" });
    } finally { await env.close(); }
  }
});

test("adaptador real ou segredo fraco nao pode iniciar", async () => {
  await assert.rejects(startPrivateApi({
    clients: new Map([["atlas", { key: randomBytes(32), studios: [A] }]]),
    source: { kind: "SUPABASE", read: async () => ({}) },
  }), /CONFIG_INVALID/);
  await assert.rejects(startPrivateApi({
    clients: new Map([["atlas", { key: Buffer.from("weak"), studios: [A] }]]),
    source: createSyntheticSource(),
  }), /CONFIG_INVALID/);
});
