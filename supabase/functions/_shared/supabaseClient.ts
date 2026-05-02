// Service-role Supabase client factory for Deno Edge Functions.
//
// Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the platform-
// provided env (auto-set by Supabase on every Edge Function). Returns
// a client with auth.persistSession=false and autoRefreshToken=false —
// Edge Function invocations are stateless; persisting/refreshing
// tokens makes no sense.
//
// Used by:
//   - draft-autopick (Phase 3 / chunk 10c, Phase 4)
//   - any future v2 worker that needs service-role DB access

import {
  createClient,
  SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2";

export function createServiceRoleClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error(
      "createServiceRoleClient: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
