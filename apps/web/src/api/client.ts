/**
 * API Client — base HTTP client for communicating with the Citrus API server.
 *
 * Automatically attaches the Supabase JWT from the current auth session.
 * All API calls go through this client instead of calling Supabase directly.
 *
 * Usage:
 *   import { apiClient } from '@/api/client';
 *   const leagues = await apiClient.get('/api/leagues');
 */

import { isAuthApiError } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

// In development, use empty string (same-origin) so requests go through
// the Vite proxy which forwards /api/* to the API server. In production,
// VITE_API_URL should be set to the deployed API server URL.
export const API_BASE_URL = import.meta.env.VITE_API_URL || '';

/*
 * SWEEP (2026-08-15) — relative '/api/*' works on the web because
 * Firebase Hosting rewrites it to Cloud Run. Inside the iOS shell the
 * origin is capacitor://localhost: there IS no rewrite, so every
 * relative request fails — silently, as generic network errors.
 * Fail LOUDLY at first use instead: the fix is setting VITE_API_URL to
 * the absolute API origin in the native build (docs/apple/IOS_BUILD.md),
 * and scripts/build-native.mjs asserts it at build time. This runtime
 * check is the belt to that suspender, and it costs the web path one
 * boolean that is always false there.
 */
import { Capacitor } from '@capacitor/core';
if (Capacitor.isNativePlatform() && !API_BASE_URL) {
  throw new Error(
    '[api/client] Native build has no VITE_API_URL — every API call would ' +
    'silently fail against capacitor://localhost. Set VITE_API_URL and ' +
    'rebuild via npm run ios:sync (see docs/apple/IOS_BUILD.md).',
  );
}

interface ApiResponse<T = unknown> {
  data?: T;
  error?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
  };
}

// Default timeout for API requests (15 seconds). During the April 10
// incident, Cloud Run 429/503 responses hung the fetch indefinitely,
// locking the draft UI forever because the `finally` block that resets
// the pick-in-progress state never ran.
const DEFAULT_TIMEOUT_MS = 15_000;

// Transient HTTP status codes that should be retried automatically.
// 429 is deliberately NOT retryable. A rate limit is the server saying
// "slow down"; retrying spends two more slots against the same window and
// makes the limit bite harder and longer. Only transient upstream failures
// (bad gateway / unavailable / timeout) are worth a second attempt.
// (2026-08-25: retrying 429 turned a single throttled Stormy question into
// three, which is how a 10/min cap started rejecting the 4th question.)
const RETRYABLE_STATUSES = new Set([502, 503, 504]);

interface RequestOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Max retry attempts for transient errors (429/503/timeout). Default 2. */
  retries?: number;
}

// ── Token refresh lock ──────────────────────────────────────────────────
// When multiple concurrent requests hit 401, only ONE refresh runs.
// All others await the same promise to avoid a stampede of refreshSession() calls.
let refreshPromise: Promise<string | null> | null = null;

// F19 (2026-07-31): allowlist of positively-identified credential-failure
// codes. supabase.auth.refreshSession() RESOLVES with an
// AuthRetryableFetchError on network failure (it does not reject), so the
// pre-fix code — which called signOut() on any truthy `error` — destroyed
// local sessions on wifi blips, logging users out of a running draft.
// Amendment 1 (architect 2026-07-31): allowlist credentials, default to
// transient. The set of "the refresh token is dead" errors is small,
// stable and enumerable; the set of "the network broke" errors grows with
// every runtime, proxy and browser. Allowlist rots slower than denylist.
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

async function refreshTokenOnce(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = supabase.auth.refreshSession().then(({ data, error }) => {
    refreshPromise = null;
    if (error) {
      // Amendment 1: only positively-identified credential failures
      // trigger signOut. Everything else (AuthRetryableFetchError,
      // unrecognised shapes, undefined errors) is treated as transient:
      // return null, let the caller fail gracefully, let the user retry
      // when connectivity returns. The refresh token in localStorage is
      // still valid across network blips.
      if (isCredentialFailure(error)) {
        supabase.auth.signOut().catch(() => {});
      }
      return null;
    }
    if (!data.session) {
      // No error AND no session — treat as no-session (defensive; this
      // shouldn't happen without an error). Do not sign out.
      return null;
    }
    return data.session.access_token;
  }).catch(() => {
    // Amendment 4 (architect 2026-07-31): the .catch() branch NEVER
    // signs out, full stop. supabase-js resolves-with-error for
    // network faults today, so a rejection here is by definition
    // unexpected — the weakest possible evidence that credentials
    // are bad. Simpler and strictly safer than mirroring the
    // discrimination.
    refreshPromise = null;
    return null;
  });

  return refreshPromise;
}

/**
 * Decode a JWT payload without verification (we just need the `exp` claim).
 * Returns null on any parse error so callers can fall back safely.
 */
function jwtExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

async function getAuthToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return null;

  // If the JWT is expired (or expires within 30 s), proactively refresh
  // BEFORE making the request.  This prevents the 401 → retry cascade that
  // floods the console when the page loads with a stale token in localStorage.
  const exp = jwtExpiry(token);
  if (exp !== null && Date.now() >= exp * 1000 - 30_000) {
    const freshToken = await refreshTokenOnce();
    // If refresh succeeded, use the new token.
    // If it failed, return null so the caller skips the auth header
    // (the request will fail cleanly instead of cascading).
    return freshToken;
  }

  return token;
}

async function doFetch(
  method: string,
  path: string,
  token: string | null,
  body?: unknown,
  options?: RequestOptions
): Promise<{ response: Response; json: any }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-client-info': 'citrus-web',
    ...options?.headers,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const url = `${API_BASE_URL}${path}`;

  // Apply a timeout to prevent hung fetches from locking the UI forever.
  // Callers can pass their own signal or override the timeout.
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let signal = options?.signal;
  if (!signal && typeof AbortSignal.timeout === 'function') {
    signal = AbortSignal.timeout(timeoutMs);
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });

  // Safely parse JSON — if the response is HTML (e.g. a proxy 404 page,
  // CDN error page, or Vite dev server fallback), avoid the cryptic
  // "Unexpected token '<'" error and surface a clear message instead.
  let json: any;
  try {
    json = await response.json();
  } catch {
    json = { error: `Server returned non-JSON response (${response.status} ${response.statusText})` };
  }
  return { response, json };
}

async function request<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  options?: RequestOptions
): Promise<ApiResponse<T>> {
  const maxAttempts = (options?.retries ?? 2) + 1; // retries + initial attempt
  let lastError: ApiError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const token = await getAuthToken();
      let { response, json } = await doFetch(method, path, token, body, options);

      // On 401, try refreshing the session and retry once.
      if (response.status === 401 && token) {
        const newToken = await refreshTokenOnce();
        if (newToken && newToken !== token) {
          ({ response, json } = await doFetch(method, path, newToken, body, options));
        }
      }

      // Retryable server error — back off and try again
      if (RETRYABLE_STATUSES.has(response.status) && attempt < maxAttempts) {
        const backoff = Math.min(1000 * Math.pow(2, attempt - 1), 4000);
        await new Promise(r => setTimeout(r, backoff));
        lastError = new ApiError(
          `Server returned ${response.status}`,
          response.status,
          json,
        );
        continue;
      }

      if (!response.ok) {
        const fallback = `API request failed with status ${response.status}`;
        const errorMsg = typeof json.error === 'string'
          ? json.error
          : json.error?.message || json.message || fallback;
        throw new ApiError(errorMsg, response.status, json);
      }

      return json;
    } catch (err) {
      // Timeout (AbortError) or network error — retry with backoff
      if (
        attempt < maxAttempts &&
        err instanceof Error &&
        (err.name === 'TimeoutError' || err.name === 'AbortError' || err.message === 'Failed to fetch')
      ) {
        const backoff = Math.min(1000 * Math.pow(2, attempt - 1), 4000);
        await new Promise(r => setTimeout(r, backoff));
        lastError = err instanceof ApiError
          ? err
          : new ApiError(
              err.name === 'TimeoutError' || err.name === 'AbortError'
                ? 'Request timed out. Retrying'
                : 'Network error. Retrying',
              0,
            );
        continue;
      }
      throw err;
    }
  }

  // All retries exhausted
  throw lastError || new ApiError('Request failed after retries', 0);
}

export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export const apiClient = {
  get<T = unknown>(path: string, options?: RequestOptions): Promise<ApiResponse<T>> {
    return request<T>('GET', path, undefined, options);
  },

  post<T = unknown>(path: string, body?: unknown, options?: RequestOptions): Promise<ApiResponse<T>> {
    return request<T>('POST', path, body, options);
  },

  put<T = unknown>(path: string, body?: unknown, options?: RequestOptions): Promise<ApiResponse<T>> {
    return request<T>('PUT', path, body, options);
  },

  patch<T = unknown>(path: string, body?: unknown, options?: RequestOptions): Promise<ApiResponse<T>> {
    return request<T>('PATCH', path, body, options);
  },

  delete<T = unknown>(path: string, options?: RequestOptions): Promise<ApiResponse<T>> {
    return request<T>('DELETE', path, undefined, options);
  },
};
