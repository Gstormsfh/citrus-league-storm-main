/**
 * Standardized API response helpers for the Citrus API server.
 *
 * All responses follow a consistent envelope:
 *
 *   Success: { data: T, pagination?: {...} }
 *   Error:   { error: { code: string, message: string, details?: string }, requestId?: string }
 *
 * This is the industry standard used by Stripe, GitHub, and other world-class APIs.
 */
import type { Context } from 'hono';
import type { Env } from '../app';
import { AppError, getErrorMessage } from './errors';

// ── Response Types ───────────────────────────────────────────────────

export interface ApiSuccessResponse<T = unknown> {
  data: T;
  pagination?: PaginationMeta;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: string;
  };
  requestId?: string;
}

// ── Success Helpers ──────────────────────────────────────────────────

/** Return a success response with data */
export function ok<T>(c: Context<Env>, data: T, status: 200 | 201 = 200) {
  return c.json({ data } as ApiSuccessResponse<T>, status);
}

/** Return a success response with pagination */
export function okPaginated<T>(
  c: Context<Env>,
  data: T,
  pagination: PaginationMeta,
) {
  return c.json({ data, pagination } as ApiSuccessResponse<T>, 200);
}

/** Return a 201 Created response */
export function created<T>(c: Context<Env>, data: T) {
  return ok(c, data, 201);
}

// ── Error Helpers ────────────────────────────────────────────────────

/** Return a structured error response from an AppError */
export function fail(c: Context<Env>, error: AppError) {
  const requestId = c.get('requestId');
  const body: ApiErrorResponse = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    },
    ...(requestId ? { requestId } : {}),
  };
  return c.json(body, error.status as any);
}

/**
 * Handle any error — converts unknown errors into structured responses.
 * Use in catch blocks: `return handleError(c, err, 'Failed to fetch leagues');`
 */
export function handleError(
  c: Context<Env>,
  error: unknown,
  fallbackMessage = 'Internal server error',
) {
  if (error instanceof AppError) {
    return fail(c, error);
  }

  const message = getErrorMessage(error) || fallbackMessage;
  return fail(c, AppError.internal(message));
}
