import { createHmac, timingSafeEqual } from "node:crypto";
import { STUDIO_CODE } from "./contract.mjs";

const CLIENT_ID = /^[A-Za-z0-9_-]{1,32}$/;
const NONCE = /^[A-Za-z0-9_-]{22,64}$/;
const SIGNATURE = /^[a-f0-9]{64}$/;

export function validateClients(clients) {
  if (!(clients instanceof Map) || clients.size < 1 || clients.size > 10) {
    throw new Error("PRIVATE_API_CONFIG_INVALID");
  }
  for (const [id, entry] of clients) {
    if (!CLIENT_ID.test(id) || !entry || !Buffer.isBuffer(entry.key) ||
        entry.key.length < 32 || !Array.isArray(entry.studios) ||
        entry.studios.length < 1 || entry.studios.length > 10 ||
        new Set(entry.studios).size !== entry.studios.length ||
        entry.studios.some((code) => !STUDIO_CODE.test(code))) {
      throw new Error("PRIVATE_API_CONFIG_INVALID");
    }
  }
}

export function signRequest({ key, path, timestamp, nonce }) {
  return createHmac("sha256", key)
    .update(`GET\n${path}\n${timestamp}\n${nonce}`, "utf8")
    .digest("hex");
}

export function createAuthenticator({ clients, now = () => Date.now(), maxSkewMs = 60_000 } = {}) {
  validateClients(clients);
  const nonces = new Map();
  return function authorize(headers, path, studioCode) {
    const id = headers["x-bellza-client"];
    const timestamp = headers["x-bellza-time"];
    const nonce = headers["x-bellza-nonce"];
    const signature = headers["x-bellza-signature"];
    if (typeof id !== "string" || !CLIENT_ID.test(id) ||
        typeof timestamp !== "string" || !/^[0-9]{10,13}$/.test(timestamp) ||
        typeof nonce !== "string" || !NONCE.test(nonce) ||
        typeof signature !== "string" || !SIGNATURE.test(signature)) return null;
    const entry = clients.get(id);
    const time = Number(timestamp);
    if (!entry || !Number.isSafeInteger(time) || Math.abs(now() - time) > maxSkewMs ||
        !entry.studios.includes(studioCode)) return null;
    const expected = Buffer.from(signRequest({ key: entry.key, path, timestamp, nonce }), "hex");
    if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) return null;
    for (const [key, expires] of nonces) if (expires <= now()) nonces.delete(key);
    if (nonces.size >= 1024 || nonces.has(`${id}:${nonce}`)) return null;
    nonces.set(`${id}:${nonce}`, now() + maxSkewMs);
    return id;
  };
}
