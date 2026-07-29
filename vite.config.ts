// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { readFileSync } from "node:fs";

function readPublicVapidKey() {
  const fromEnvironment = cleanPublicVapidKey(process.env.VITE_VAPID_PUBLIC_KEY);
  if (fromEnvironment) return fromEnvironment;

  try {
    // wrangler.jsonc is JSONC (comments and trailing commas), so JSON.parse silently
    // made production builds lose this public key. Extract only this public value.
    const config = readFileSync(new URL("./wrangler.jsonc", import.meta.url), "utf8");
    const match = config.match(/"VITE_VAPID_PUBLIC_KEY"\s*:\s*"([A-Za-z0-9_-]+)"/);
    return cleanPublicVapidKey(match?.[1]);
  } catch {
    return "";
  }
}

function cleanPublicVapidKey(value: string | undefined) {
  const key = String(value ?? "").trim().replace(/\s+/g, "").replace(/=+$/g, "");
  // An uncompressed P-256 public key is 65 bytes and starts with 0x04.
  return /^[A-Za-z0-9_-]{86,88}$/.test(key) ? key : "";
}

const publicVapidKey = readPublicVapidKey();
if (!publicVapidKey) {
  throw new Error(
    "VITE_VAPID_PUBLIC_KEY is required to build browser push notifications.",
  );
}

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
export default defineConfig({
  vite: {
    define: {
      "import.meta.env.VITE_VAPID_PUBLIC_KEY": JSON.stringify(publicVapidKey),
    },
  },
  tanstackStart: {
    server: { entry: "server" },
  },
});
