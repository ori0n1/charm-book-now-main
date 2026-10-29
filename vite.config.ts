// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { readFileSync } from "node:fs";
import { loadEnv } from "vite";

function readPublicWranglerVar(name: string) {
  const config = readFileSync(new URL("./wrangler.jsonc", import.meta.url), "utf8");
  const match = config.match(new RegExp(`"${name}"\\s*:\\s*"([^"]+)"`));
  return match?.[1] ?? "";
}

if (process.env.CLOUDFLARE_ENV === "staging") {
  const stagingEnv = loadEnv("staging", process.cwd(), "VITE_");
  const stageUrl = (process.env.VITE_SUPABASE_URL || stagingEnv.VITE_SUPABASE_URL || "").trim();
  const stageKey = (
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    stagingEnv.VITE_SUPABASE_PUBLISHABLE_KEY ||
    ""
  ).trim();
  const productionUrl = "https://pwmdzpvnatrvfpgcvnzg.supabase.co";
  let stageOrigin = "";
  try {
    const parsed = new URL(stageUrl);
    if (parsed.protocol === "https:" && /^[a-z0-9-]+\.supabase\.co$/i.test(parsed.hostname)) {
      stageOrigin = parsed.origin;
    }
  } catch {
    // Invalid or missing staging URL fails closed below.
  }
  if (!stageOrigin || !stageKey || stageOrigin === productionUrl) {
    throw new Error("staging_supabase_public_config_missing_or_production");
  }
  const stageVapidKey = cleanPublicVapidKey(
    process.env.VITE_VAPID_PUBLIC_KEY || stagingEnv.VITE_VAPID_PUBLIC_KEY,
  );
  if (!stageVapidKey) {
    throw new Error("staging_vapid_public_key_missing");
  }
  process.env.VITE_SUPABASE_URL = stageOrigin;
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = stageKey;
  process.env.VITE_VAPID_PUBLIC_KEY = stageVapidKey;
} else {
  // Local dev has no .env file; the public production values live in Wrangler.
  // Only staging is forbidden from borrowing these values.
  process.env.VITE_SUPABASE_URL ||= readPublicWranglerVar("VITE_SUPABASE_URL");
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||= readPublicWranglerVar(
    "VITE_SUPABASE_PUBLISHABLE_KEY",
  );
}

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
      "__REFERRAL_PREMIUM_AWARDS_ENABLED__": JSON.stringify(
        process.env.REFERRAL_PREMIUM_AWARDS_ENABLED !== "false",
      ),
    },
    // Exact production hosts are accepted only so local edge tests can exercise
    // canonical redirects through the Worker. Wildcard hosts remain forbidden.
    server: {
      allowedHosts: ["bellza.pt", "www.bellza.pt"],
    },
  },
  tanstackStart: {
    server: { entry: "server" },
  },
});
