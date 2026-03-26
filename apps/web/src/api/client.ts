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

import { supabase } from '@/integrations/supabase/client';

// In development, use empty string (same-origin) so requests go through
// the Vite proxy which forwards /api/* to the API server. In production,
// VITE_API_URL should be set to the deployed API server URL.
const API_BASE_URL = import.meta.env.VITE_API_URL || '';

interface ApiResponse<T = unknown> {
  data?: T;
  error?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
  };
}

interface RequestOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

// ── Token refresh lock ──────────────────────────────────────────────────
// When multiple concurrent requests hit 401, only ONE refresh runs.
// All others await the same promise to avoid a stampede of refreshSession() calls.
let refreshPromise: Promise<string | null> | null = null;

async function refreshTokenOnce(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = supabase.auth.refreshSession().then(({ data, error }) => {
    refreshPromise = null;
    if (error || !data.session) {
      // Refresh token is dead (expired / revoked) — sign the user out so
      // they get a clean login prompt instead of being stuck in an error loop.
      // (Network errors hit the .catch() branch below and do NOT sign out.)
      supabase.auth.signOut().catch(() => {});
      return null;
    }
    return data.session.access_token;
  }).catch(() => {
    // Network / transient error — don't sign out; just return null so
    // the request fails gracefully.  The user can retry when connectivity
    // is restored.
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

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: options?.signal,
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
  const token = await getAuthToken();
  let { response, json } = await doFetch(method, path, token, body, options);

  // On 401, try refreshing the session and retry once.
  // Uses a lock so concurrent 401s share a single refreshSession() call.
  if (response.status === 401 && token) {
    const newToken = await refreshTokenOnce();
    if (newToken && newToken !== token) {
      ({ response, json } = await doFetch(method, path, newToken, body, options));
    }
  }

  if (!response.ok) {
    const fallback = `API request failed with status ${response.status}`;
    const errorMsg = typeof json.error === 'string'
      ? json.error
      : json.error?.message || json.message || fallback;
    throw new ApiError(errorMsg, response.status, json);
  }

  return json;
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
