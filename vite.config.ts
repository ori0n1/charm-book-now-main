// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { readFileSync } from "node:fs";

function readPublicVapidKey() {
  if (process.env.VITE_VAPID_PUBLIC_KEY) return process.env.VITE_VAPID_PUBLIC_KEY;

  try {
    const config = JSON.parse(readFileSync(new URL("./wrangler.jsonc", import.meta.url), "utf8")) as {
      vars?: Record<string, string>;
    };
    return config.vars?.VITE_VAPID_PUBLIC_KEY ?? "";
  } catch {
    return "";
  }
}

const publicVapidKey = readPublicVapidKey();

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
