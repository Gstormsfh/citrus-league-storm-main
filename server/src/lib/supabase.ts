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
    sealAdminAuth(_adminClient);
  }
  return _adminClient;
}

/**
 * ADMIN-SESSION POISONING (2026-09-09, TestFlight night). The signup route
 * called `admin.auth.signInWithPassword(...)` on THIS singleton. supabase-js
 * stores the resulting user session on the client even with
 * persistSession=false, and from then on every "admin" query from that
 * Cloud Run instance carried the new user's JWT instead of the service role:
 * edge logs showed `citrus-api-admin` requests with role=authenticated and
 * the new user's subject, and every admin write hit RLS (roster_assignments
 * inserts 403) while admin reads came back empty for leagues that user was
 * not in. To the testers that looked like the draft never closing, rosters
 * never loading and "team doesn't exist".
 *
 * A process-wide client must never hold a user session. Any code that needs
 * to sign a user in gets its own client from `createServiceClient()`.
 */
const SESSION_MUTATORS = new Set([
  'signInWithPassword',
  'signInWithOtp',
  'signInWithOAuth',
  'signInWithIdToken',
  'signInAnonymously',
  'signUp',
  'setSession',
  'refreshSession',
  'exchangeCodeForSession',
  'verifyOtp',
]);

function sealAdminAuth(client: SupabaseClient): void {
  const auth = client.auth as unknown as Record<string, unknown>;
  for (const name of SESSION_MUTATORS) {
    if (typeof auth[name] !== 'function') continue;
    Object.defineProperty(auth, name, {
      configurable: false,
      writable: false,
      value: () => {
        throw new Error(
          `admin client: auth.${name}() is forbidden on the shared service-role client. Use createServiceClient() for a per-request session.`,
        );
      },
    });
  }
}

/**
 * A fresh service-role client for ONE request. Use it wherever a user session
 * has to be created server-side (signup auto sign-in); it is discarded with
 * the request, so the session it holds cannot leak into other requests.
 */
export function createServiceClient(): SupabaseClient {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY not set: service client unavailable');
  }
  return createClient(getSupabaseUrl(), serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-client-info': 'citrus-api-service-request' } },
  });
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
