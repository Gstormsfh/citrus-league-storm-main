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

async function getAuthToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || null;
}

async function request<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  options?: RequestOptions
): Promise<ApiResponse<T>> {
  const token = await getAuthToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-client-info': 'citrus-web',
    ...options?.headers,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const url = `${API_BASE_URL}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: options?.signal,
    });
  } catch (err) {
    throw new ApiError(
      'Unable to reach the API server. Please check your connection.',
      0
    );
  }

  let json: ApiResponse<T>;
  try {
    json = await response.json();
  } catch {
    throw new ApiError(
      `API returned non-JSON response (HTTP ${response.status})`,
      response.status
    );
  }

  if (!response.ok) {
    const fallback = `API request failed with status ${response.status}`;
    const errorMsg = typeof json.error === 'string'
      ? json.error
      : (json as Record<string, unknown>).message as string || fallback;
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
