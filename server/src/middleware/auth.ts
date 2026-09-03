import { Context, Next } from 'hono';
import { createClient, isAuthApiError, type AuthError } from '@supabase/supabase-js';
import type { Env } from '../app';
import { logger } from '@citrus/shared';
import { verifyAccessTokenLocally, isTokenExpiredUnsafe } from '../lib/verifyAccessToken';

// NOTE: env vars are read inside each middleware function (not at module scope)
// because ESM import hoisting causes module-level code to run before .env is loaded.

// F15 (2026-07-31): allowlist of positively-identified credential-failure
// codes returned by supabase-js / GoTrue. Anything not on this list — and
// anything not an AuthApiError with 400/401 status — is treated as
// provider-unreachable (503, retryable). The default is transient because
// the cost asymmetry is stark: a network failure misread as a credential
// failure tells the user their session is dead (F15+F19 pre-fix chain);
// a credential failure misread as transient produces a "can't reach server"
// banner and the session survives. The set of "your token is dead" errors
// is small, stable and enumerable; the set of "the network broke" errors
// grows with every runtime, proxy and browser. Allowlist rots slower than
// denylist.
const CREDENTIAL_FAILURE_CODES = new Set([
  'invalid_grant',
  'refresh_token_not_found',
  'refresh_token_already_used',
  'bad_jwt',
  'token_expired',
  'invalid_token',
  'session_not_found',
  // DRAFT-NIGHT FIX (2026-08-18) — codes GoTrue emits for a credential
  // that will never become valid again. Each previously fell through to
  // the transient-503 default, so the client retried forever.
  'user_not_found',
  'session_expired',
  'jwt_expired',
  'user_banned',
]);

function isCredentialFailure(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  if (isAuthApiError(err)) {
    // DRAFT-NIGHT FIX (2026-08-18): 403 added. GoTrue answers 403 for a
    // revoked session and for "user from sub claim does not exist" — both
    // are unambiguously about the credential, not provider health. Under
    // the old 400/401-only test they fell through to the 503 default and
    // surfaced as "Cannot verify your session right now. Please retry.",
    // which the client then RETRIED with backoff. Garrett hit exactly this
    // after signing out mid-draft-night: a permanent condition presented
    // as a transient one, with no path to sign-in.
    if (err.status === 400 || err.status === 401 || err.status === 403) return true;
  }
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' && CREDENTIAL_FAILURE_CODES.has(code)) return true;
  return false;
}

/**
 * Auth middleware — validates Supabase JWT from Authorization header.
 * Sets userId and userToken on the request context.
 *
 * Usage:
 *   app.use('/api/leagues/*', authMiddleware);
 *   // Then in handler: c.get('userId'), c.get('userToken')
 */
export async function authMiddleware(c: Context<Env>, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: { code: 'AUTHENTICATION_REQUIRED', message: 'Missing or invalid Authorization header' } }, 401);
  }

  const token = authHeader.slice(7); // Remove "Bearer "

  if (!token) {
    return c.json({ error: { code: 'AUTHENTICATION_REQUIRED', message: 'Empty Bearer token' } }, 401);
  }

  // ── PICK-LATENCY (2026-08-12) — local verification fast path ────────
  //
  // The token is a signed assertion of identity. Asking GoTrue to re-read
  // it for us cost an HTTPS round trip on EVERY request, and the topology
  // makes that expensive: Cloud Run runs in us-central1 (Iowa), both
  // Supabase projects live in ca-central-1 (Montreal). ~1,500 km, before
  // any actual work started.
  //
  // `lib/draftToken.ts` already established this pattern for the
  // WebSocket-upgrade path in July — "a local HMAC check (no Supabase
  // round-trip)". This brings the HTTP API in line with it.
  //
  // STRICTLY ADDITIVE: on any miss — no secret, wrong secret, asymmetric
  // token, malformed, bad signature, expired, or an anon-key JWT — we fall
  // through to the untouched getUser() path below, F15 taxonomy and all.
  // The fast path can only ever succeed sooner; it can never reject anyone
  // the old path would have accepted.
  const local = await verifyAccessTokenLocally(token);
  if (local.ok) {
    c.set('userId', local.userId);
    c.set('userToken', token);
    await next();
    return;
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    logger.error('[Auth] Missing env vars — SUPABASE_URL:', !!SUPABASE_URL, 'SUPABASE_ANON_KEY:', !!SUPABASE_ANON_KEY);
    return c.json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Server configuration error' } }, 500);
  }

  // Verify the JWT by calling Supabase auth
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  // F15 (2026-07-31): supabase-js generally resolves-with-error for
  // network failures (returning AuthRetryableFetchError on the `error`
  // field). Wrap in try/catch as defense against any code path that
  // still throws (rare, but avoids a 500 Internal Server Error masking
  // a provider-unreachable case as a bug in our middleware).
  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>['data']['user'] = null;
  let authError: AuthError | Error | null = null;
  try {
    const result = await supabase.auth.getUser(token);
    user = result.data.user;
    authError = result.error;
  } catch (err) {
    authError = err instanceof Error ? err : new Error(String(err));
  }

  if (authError || !user) {
    // Amendment 1 (2026-07-31 architect ruling): allowlist credential
    // failures; default everything else to 503 transient. Cost asymmetry
    // is stark — see block comment above CREDENTIAL_FAILURE_CODES.
    //
    // DRAFT-NIGHT FIX (2026-08-18) — deterministic backstop, checked FIRST.
    // The allowlist above depends on GoTrue's error taxonomy, which we do
    // not control and which shifts between versions. An expired `exp` is
    // ground truth we can read ourselves: no outage can make a stale token
    // valid, so it is always 401 and never "please retry". This closes the
    // dead-end class regardless of what shape the provider's error takes.
    if (isTokenExpiredUnsafe(token)) {
      logger.error('[Auth] token expired (local exp check):', { path: c.req.path });
      return c.json(
        {
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Your session expired. Please sign in again.',
          },
        },
        401,
      );
    }
    if (authError && isCredentialFailure(authError)) {
      logger.error('[Auth] credential failure:', {
        errorMessage: authError.message,
        errorStatus: (authError as { status?: unknown }).status,
        errorCode: (authError as { code?: unknown }).code,
        errorName: authError.name,
        path: c.req.path,
      });
      return c.json(
        { error: { code: 'AUTHENTICATION_REQUIRED', message: 'Invalid or expired token' } },
        401,
      );
    }
    // Provider unreachable OR unrecognised error shape — both go to 503.
    // apiClient retries 503 with exponential backoff automatically; from
    // the user's perspective this is a transient hiccup, not a logout.
    logger.error('[Auth] provider unreachable / unrecognised error:', {
      errorMessage: authError?.message,
      errorStatus: (authError as { status?: unknown } | null)?.status,
      errorCode: (authError as { code?: unknown } | null)?.code,
      errorName: authError?.name,
      supabaseUrl: SUPABASE_URL,
      anonKeyPrefix: SUPABASE_ANON_KEY.substring(0, 20) + '...',
      path: c.req.path,
    });
    return c.json(
      {
        error: {
          code: 'AUTH_PROVIDER_UNREACHABLE',
          message: 'Cannot verify your session right now. Please retry.',
        },
      },
      503,
    );
  }

  // Attach user info to context
  c.set('userId', user.id);
  c.set('userToken', token);

  await next();
}

/**
 * Optional auth middleware — attaches user info if token is present,
 * but allows anonymous access (for public endpoints like demo league).
 */
export async function optionalAuthMiddleware(c: Context<Env>, next: Next) {
  const authHeader = c.req.header('Authorization');

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);

    // Same fast path as authMiddleware; same fall-through on any miss.
    const local = await verifyAccessTokenLocally(token);
    if (local.ok) {
      c.set('userId', local.userId);
      c.set('userToken', token);
    } else if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      });

      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) {
        c.set('userId', user.id);
        c.set('userToken', token);
      }
    }
  }

  await next();
}
