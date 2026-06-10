import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _adminClient: SupabaseClient | null = null;

/**
 * Get the shared admin Supabase client singleton.
 * Uses service role key for server-side operations.
 * IMPORTANT: Only use this on the server, never expose to client.
 */
export function getAdminClient(): SupabaseClient {
  if (!_adminClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      throw new Error(
        "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables"
      );
    }

    _adminClient = createClient(url, key, {
      auth: { persistSession: false },
    });
  }

  return _adminClient;
}

/**
 * Reset admin client (for testing only)
 */
export function resetAdminClient() {
  _adminClient = null;
}
