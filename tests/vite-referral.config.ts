import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

export default defineConfig({
  root: projectRoot,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: "@tanstack/react-router", replacement: fileURLToPath(new URL("./referral-router-stub.ts", import.meta.url)) },
      { find: "@tanstack/react-start", replacement: fileURLToPath(new URL("./referral-start-stub.ts", import.meta.url)) },
      { find: "@/lib/referrals.functions", replacement: fileURLToPath(new URL("./referral-server-stub.ts", import.meta.url)) },
      { find: "@/hooks/use-current-studio", replacement: fileURLToPath(new URL("./referral-studio-stub.ts", import.meta.url)) },
      { find: /^@\//, replacement: `${fileURLToPath(new URL("../src/", import.meta.url))}` },
    ],
  },
  server: { host: "127.0.0.1", port: 4180, strictPort: true },
});
