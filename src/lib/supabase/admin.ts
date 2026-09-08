import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. NEVER import this into a Client
 * Component or anything that ships to the browser — it bypasses RLS.
 * Used by: the GitHub sync script, and the server-side manager-allowlist
 * check during login.
 */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
