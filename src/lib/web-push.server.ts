type PushSubscriptionRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

type PushPayload = {
  title: string;
  body: string;
  url?: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: Record<string, unknown>;
};

const encoder = new TextEncoder();

const TRUSTED_PUSH_HOSTS = new Set([
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "push.services.mozilla.com",
  "web.push.apple.com",
]);

const TRUSTED_PUSH_HOST_SUFFIXES = [".notify.windows.com", ".push.apple.com"];

export function isTrustedWebPushEndpoint(value: string) {
  try {
    const endpoint = new URL(value.trim());
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) return false;
    if (endpoint.port && endpoint.port !== "443") return false;
    const hostname = endpoint.hostname.toLowerCase().replace(/\.$/, "");
    return (
      TRUSTED_PUSH_HOSTS.has(hostname) ||
      TRUSTED_PUSH_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
    );
  } catch {
    return false;
  }
}

export async function sendWebPush(subscription: PushSubscriptionRow, payload: PushPayload) {
  try {
    const privateKey = cleanBase64Url(process.env.VAPID_PRIVATE_KEY);
    const publicKey = cleanBase64Url(process.env.VITE_VAPID_PUBLIC_KEY);
    const subject = String(process.env.VAPID_SUBJECT || "mailto:info@bellza.pt").trim();
    if (!privateKey || !publicKey) {
      return { ok: false, skipped: "missing_vapid_keys" as const };
    }

    const endpoint = new URL(subscription.endpoint.trim());
    if (!isTrustedWebPushEndpoint(endpoint.href)) {
      return { ok: false, skipped: "untrusted_push_endpoint" as const, attempts: 0 };
    }
    const vapidToken = await createVapidToken({
      audience: endpoint.origin,
      subject,
      publicKey,
      privateKey,
    });
    const body = await encryptPayload(
      {
        endpoint: subscription.endpoint.trim(),
        p256dh: cleanBase64Url(subscription.p256dh),
        auth: cleanBase64Url(subscription.auth),
      },
      JSON.stringify(payload),
    );

    let lastStatus = 0;
    let lastError = "web_push_network_error";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(endpoint.href, {
          method: "POST",
          redirect: "manual",
          headers: {
            Authorization: `vapid t=${vapidToken}, k=${publicKey}`,
            "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream",
            TTL: "3600",
            Urgency: "high",
          },
          body,
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (response.ok || !isRetryablePushStatus(response.status) || attempt === 2) {
          return { ok: response.ok, status: response.status, attempts: attempt + 1 };
        }

        lastStatus = response.status;
        await sleep(readRetryAfterMs(response.headers.get("retry-after")) ?? 350 * (attempt + 1));
      } catch (error) {
        clearTimeout(timeout);
        lastError = error instanceof Error && error.name === "AbortError" ? "web_push_timeout" : "web_push_fetch_failed";
        if (attempt === 2) {
          return {
            ok: false,
            skipped: lastError as "web_push_timeout" | "web_push_fetch_failed",
            attempts: attempt + 1,
          };
        }
        await sleep(350 * (attempt + 1));
      }
    }

    return lastStatus > 0
      ? { ok: false, status: lastStatus, attempts: 3 }
      : { ok: false, skipped: lastError as "web_push_network_error", attempts: 3 };
  } catch (error) {
    return { ok: false, skipped: describeWebPushSetupError(error), attempts: 0 };
  }
}

function isRetryablePushStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status < 600);
}

function readRetryAfterMs(value: string | null) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds * 1000, 250), 5000);
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return null;
  return Math.min(Math.max(date - Date.now(), 250), 5000);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createVapidToken({
  audience,
  subject,
  publicKey,
  privateKey,
}: {
  audience: string;
  subject: string;
  publicKey: string;
  privateKey: string;
}) {
  const rawPublic = base64UrlToBytes(publicKey);
  const x = rawPublic.slice(1, 33);
  const y = rawPublic.slice(33, 65);
  const d = base64UrlToBytes(privateKey);
  const key = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: bytesToBase64Url(x),
      y: bytesToBase64Url(y),
      d: bytesToBase64Url(d),
      ext: true,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );

  const header = bytesToBase64Url(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = bytesToBase64Url(
    encoder.encode(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        sub: subject,
      }),
    ),
  );
  const data = `${header}.${claims}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    encoder.encode(data),
  );

  return `${data}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

async function encryptPayload(subscription: PushSubscriptionRow, payload: string) {
  const recipientPublicKey = base64UrlToBytes(subscription.p256dh);
  const authSecret = base64UrlToBytes(subscription.auth);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const localKeys = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const localPublicKey = new Uint8Array(await crypto.subtle.exportKey("raw", localKeys.publicKey));
  const remoteKey = await crypto.subtle.importKey(
    "raw",
    recipientPublicKey,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: remoteKey }, localKeys.privateKey, 256),
  );
  const authPrk = await hmac(authSecret, sharedSecret);
  const ikm = await hkdfExpand(
    authPrk,
    concatBytes(encoder.encode("WebPush: info\0"), recipientPublicKey, localPublicKey),
    32,
  );
  const prk = await hmac(salt, ikm);
  const cek = await hkdfExpand(prk, "Content-Encoding: aes128gcm\0", 16);
  const nonce = await hkdfExpand(prk, "Content-Encoding: nonce\0", 12);
  const plaintext = new Uint8Array([...encoder.encode(payload), 0x02]);
  const cryptoKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, cryptoKey, plaintext),
  );

  const recordSize = new Uint8Array([0x00, 0x00, 0x10, 0x00]);
  return concatBytes(salt, recordSize, new Uint8Array([localPublicKey.length]), localPublicKey, ciphertext);
}

async function hmac(keyBytes: Uint8Array, data: Uint8Array) {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
}

async function hkdfExpand(prk: Uint8Array, info: string | Uint8Array, length: number) {
  const infoBytes = typeof info === "string" ? encoder.encode(info) : info;
  const input = new Uint8Array([...infoBytes, 1]);
  return (await hmac(prk, input)).slice(0, length);
}

function base64UrlToBytes(value: string) {
  const cleaned = cleanBase64Url(value);
  if (!cleaned) throw new Error("empty_base64url");
  const base64 = cleaned.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function cleanBase64Url(value: string | undefined | null) {
  let text = String(value ?? "").trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1).trim();
  }
  return text.replace(/\s+/g, "");
}

function describeWebPushSetupError(error: unknown) {
  const raw =
    error instanceof DOMException
      ? error.name || error.message
      : error instanceof Error
        ? error.message || error.name
        : String(error);
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9_ -]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
  return normalized ? (`web_push_setup_${normalized}` as const) : ("web_push_setup_failed" as const);
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function concatBytes(...chunks: Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
