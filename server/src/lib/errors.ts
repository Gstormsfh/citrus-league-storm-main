/**
 * Standardized error handling for the Citrus API server.
 *
 * Industry-standard approach:
 * - Typed AppError class with HTTP status codes and error codes
 * - Consistent error response envelope across all routes
 * - Operational vs. programmer errors distinction
 * - Safe error messages in production (no stack traces leaked)
 */

/** Standard error codes for client consumption */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTHENTICATION_REQUIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'BAD_REQUEST'
  | 'INTERNAL_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'BAD_GATEWAY';

/**
 * Application-level error with structured metadata.
 * Throw this in route handlers and services for predictable error responses.
 */
export class AppError extends Error {
  /** HTTP status code */
  readonly status: number;
  /** Machine-readable error code for client-side handling */
  readonly code: ErrorCode;
  /** Additional context (validation details, etc.) — safe for client */
  readonly details?: string;

  constructor(message: string, status: number, code: ErrorCode, details?: string) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  // ── Factory methods ────────────────────────────────────────────────

  static badRequest(message: string, details?: string): AppError {
    return new AppError(message, 400, 'BAD_REQUEST', details);
  }

  static validation(message: string, details?: string): AppError {
    return new AppError(message, 400, 'VALIDATION_ERROR', details);
  }

  static unauthorized(message = 'Authentication required'): AppError {
    return new AppError(message, 401, 'AUTHENTICATION_REQUIRED');
  }

  static forbidden(message = 'Access denied'): AppError {
    return new AppError(message, 403, 'FORBIDDEN');
  }

  static notFound(resource = 'Resource'): AppError {
    return new AppError(`${resource} not found`, 404, 'NOT_FOUND');
  }

  static conflict(message: string): AppError {
    return new AppError(message, 409, 'CONFLICT');
  }

  static internal(message = 'Internal server error'): AppError {
    return new AppError(message, 500, 'INTERNAL_ERROR');
  }

  static serviceUnavailable(message = 'Service temporarily unavailable'): AppError {
    return new AppError(message, 503, 'SERVICE_UNAVAILABLE');
  }

  static badGateway(message = 'Upstream service error'): AppError {
    return new AppError(message, 502, 'BAD_GATEWAY');
  }
}

/**
 * Extracts a safe, user-facing message from unknown error shapes.
 * Handles Supabase errors, AppErrors, native Errors, and plain strings.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof AppError) return error.message;
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null) {
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === 'string') return obj.message;
    if (typeof obj.error === 'string') return obj.error;
  }
  return 'An unexpected error occurred';
}
