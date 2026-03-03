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

interface ApiResponse<T = any> {
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

async function request<T = any>(
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

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: options?.signal,
  });

  const json = await response.json();

  if (!response.ok) {
    throw new ApiError(
      json.error || `API request failed with status ${response.status}`,
      response.status,
      json
    );
  }

  return json;
}

export class ApiError extends Error {
  status: number;
  data: any;

  constructor(message: string, status: number, data?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export const apiClient = {
  get<T = any>(path: string, options?: RequestOptions): Promise<ApiResponse<T>> {
    return request<T>('GET', path, undefined, options);
  },

  post<T = any>(path: string, body?: unknown, options?: RequestOptions): Promise<ApiResponse<T>> {
    return request<T>('POST', path, body, options);
  },

  put<T = any>(path: string, body?: unknown, options?: RequestOptions): Promise<ApiResponse<T>> {
    return request<T>('PUT', path, body, options);
  },

  patch<T = any>(path: string, body?: unknown, options?: RequestOptions): Promise<ApiResponse<T>> {
    return request<T>('PATCH', path, body, options);
  },

  delete<T = any>(path: string, options?: RequestOptions): Promise<ApiResponse<T>> {
    return request<T>('DELETE', path, undefined, options);
  },
};
