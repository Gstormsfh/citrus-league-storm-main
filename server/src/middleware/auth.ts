import { Context, Next } from 'hono';
import { createClient, isAuthApiError, type AuthError } from '@supabase/supabase-js';
import type { Env } from '../app';
import { logger } from '@citrus/shared';

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
]);

function isCredentialFailure(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  if (isAuthApiError(err)) {
    if (err.status === 400 || err.status === 401) return true;
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
          message: 'Cannot verify your session right now — please retry',
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

  if (authHeader && authHeader.startsWith('Bearer ') && SUPABASE_URL && SUPABASE_ANON_KEY) {
    const token = authHeader.slice(7);
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

  await next();
}
