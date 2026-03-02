import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL) {
  throw new Error('Missing SUPABASE_URL environment variable');
}

if (!SUPABASE_ANON_KEY) {
  throw new Error('Missing SUPABASE_ANON_KEY environment variable');
}

/**
 * Admin Supabase client — uses service role key to bypass RLS.
 * ONLY use for admin operations and background jobs.
 * Never use for user-facing requests.
 */
export const supabaseAdmin: SupabaseClient = SUPABASE_SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-client-info': 'citrus-api-admin' } },
    })
  : (() => { console.warn('SUPABASE_SERVICE_ROLE_KEY not set — admin client unavailable'); return null as any; })();

/**
 * Create a per-request Supabase client using the user's JWT.
 * This preserves RLS — the user can only access their own data.
 *
 * @param userToken - The user's JWT from the Authorization header
 */
export function createUserClient(userToken: string): SupabaseClient {
  return createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: `Bearer ${userToken}`,
        'x-client-info': 'citrus-api-user',
      },
    },
  });
}
