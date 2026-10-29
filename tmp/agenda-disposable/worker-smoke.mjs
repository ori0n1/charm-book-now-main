import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const output = execFileSync("supabase", ["status", "--workdir", "tmp/agenda-disposable", "-o", "json"], { encoding: "utf8" });
const local = JSON.parse(output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1));
assert.equal(local.API_URL, "http://127.0.0.1:57921");
process.env.VITE_SUPABASE_URL = local.API_URL;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = local.PUBLISHABLE_KEY;
process.env.SUPABASE_URL = local.API_URL;
process.env.SUPABASE_PUBLISHABLE_KEY = local.PUBLISHABLE_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = local.SERVICE_ROLE_KEY;

const { createServer } = await import("vite");
const server = await createServer({ server: { host: "127.0.0.1", port: 4195, strictPort: true } });
try {
  await server.listen();
  const response = await fetch("http://127.0.0.1:4195/admin/agenda", { redirect: "manual" });
  assert.ok([200, 302, 303, 307, 308].includes(response.status), `Unexpected status: ${response.status}`);
  console.log(`Local agenda Worker route: HTTP ${response.status}, isolated Supabase URL OK`);
} finally {
  await server.close();
}
