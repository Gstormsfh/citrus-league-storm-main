import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Read env vars lazily — Cloud Run may inject them after module load,
// and the server must start (for health checks) even if they're missing.
function getSupabaseUrl(): string {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  if (!url) throw new Error('Missing SUPABASE_URL environment variable');
  return url;
}

function getSupabaseAnonKey(): string {
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!key) throw new Error('Missing SUPABASE_ANON_KEY environment variable');
  return key;
}

/**
 * Admin Supabase client — uses service role key to bypass RLS.
 * ONLY use for admin operations and background jobs.
 * Never use for user-facing requests.
 *
 * Lazily initialized on first access so the server can start without env vars.
 */
let _adminClient: SupabaseClient | null = null;
export function getSupabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY not set: admin client unavailable');
    }
    _adminClient = createClient(getSupabaseUrl(), serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-client-info': 'citrus-api-admin' } },
    });
  }
  return _adminClient;
}

/** @deprecated Use getSupabaseAdmin() — kept for backward compatibility */
export const supabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    return (getSupabaseAdmin() as any)[prop];
  },
});

/**
 * Create a per-request Supabase client using the user's JWT.
 * This preserves RLS — the user can only access their own data.
 *
 * @param userToken - The user's JWT from the Authorization header
 */
export function createUserClient(userToken: string): SupabaseClient {
  return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: `Bearer ${userToken}`,
        'x-client-info': 'citrus-api-user',
      },
    },
  });
}
