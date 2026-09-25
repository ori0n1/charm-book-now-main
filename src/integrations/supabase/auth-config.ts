// The browser and the Worker must be built for the same Supabase project.
// Never fall back to production when Vite is building a staging bundle.
const viteEnv = import.meta.env;
const nodeTestFallback = !viteEnv;
export const PUBLIC_SUPABASE_URL = (
  viteEnv?.VITE_SUPABASE_URL ||
  (nodeTestFallback
    ? process.env.VITE_SUPABASE_URL || "https://pwmdzpvnatrvfpgcvnzg.supabase.co"
    : "")
).trim();
export const PUBLIC_SUPABASE_PUBLISHABLE_KEY = (
  viteEnv?.VITE_SUPABASE_PUBLISHABLE_KEY ||
  (nodeTestFallback
    ? process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_F76-CiLv1Rvar307TdLRjg_8pphwxQP"
    : "")
).trim();

if (!PUBLIC_SUPABASE_URL || !PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
  throw new Error("supabase_public_build_configuration_missing");
}

const projectRef = new URL(PUBLIC_SUPABASE_URL).hostname.split(".")[0];

export const SUPABASE_AUTH_COOKIE_NAME = `sb-${projectRef}-auth-token`;
export const LEGACY_AUTH_STORAGE_KEYS = [
  "bellza.supabase.auth",
  SUPABASE_AUTH_COOKIE_NAME,
] as const;

export function getSupabaseServerConfig() {
  const supabaseUrl =
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !publishableKey) {
    throw new Error("supabase_public_configuration_missing");
  }
  if (
    new URL(supabaseUrl).origin !== new URL(PUBLIC_SUPABASE_URL).origin ||
    publishableKey !== PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ) {
    throw new Error("supabase_runtime_build_project_mismatch");
  }

  return { supabaseUrl, publishableKey };
}
