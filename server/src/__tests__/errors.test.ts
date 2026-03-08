import { describe, it, expect } from 'vitest';
import { AppError, getErrorMessage } from '../lib/errors';

describe('AppError', () => {
  it('creates error with correct properties', () => {
    const error = new AppError('Something went wrong', 400, 'BAD_REQUEST', 'Invalid field');
    expect(error.message).toBe('Something went wrong');
    expect(error.status).toBe(400);
    expect(error.code).toBe('BAD_REQUEST');
    expect(error.details).toBe('Invalid field');
    expect(error.name).toBe('AppError');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AppError);
  });

  describe('factory methods', () => {
    it('badRequest creates 400 error', () => {
      const error = AppError.badRequest('Invalid input', 'name is required');
      expect(error.status).toBe(400);
      expect(error.code).toBe('BAD_REQUEST');
      expect(error.message).toBe('Invalid input');
      expect(error.details).toBe('name is required');
    });

    it('validation creates 400 VALIDATION_ERROR', () => {
      const error = AppError.validation('Validation failed', 'email: invalid format');
      expect(error.status).toBe(400);
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.details).toBe('email: invalid format');
    });

    it('unauthorized creates 401 error with default message', () => {
      const error = AppError.unauthorized();
      expect(error.status).toBe(401);
      expect(error.code).toBe('AUTHENTICATION_REQUIRED');
      expect(error.message).toBe('Authentication required');
    });

    it('unauthorized accepts custom message', () => {
      const error = AppError.unauthorized('Token expired');
      expect(error.message).toBe('Token expired');
    });

    it('forbidden creates 403 error', () => {
      const error = AppError.forbidden('Commissioner only');
      expect(error.status).toBe(403);
      expect(error.code).toBe('FORBIDDEN');
      expect(error.message).toBe('Commissioner only');
    });

    it('notFound creates 404 error with resource name', () => {
      const error = AppError.notFound('League');
      expect(error.status).toBe(404);
      expect(error.code).toBe('NOT_FOUND');
      expect(error.message).toBe('League not found');
    });

    it('notFound uses default resource name', () => {
      const error = AppError.notFound();
      expect(error.message).toBe('Resource not found');
    });

    it('conflict creates 409 error', () => {
      const error = AppError.conflict('Player already drafted');
      expect(error.status).toBe(409);
      expect(error.code).toBe('CONFLICT');
    });

    it('internal creates 500 error', () => {
      const error = AppError.internal();
      expect(error.status).toBe(500);
      expect(error.code).toBe('INTERNAL_ERROR');
      expect(error.message).toBe('Internal server error');
    });

    it('serviceUnavailable creates 503 error', () => {
      const error = AppError.serviceUnavailable();
      expect(error.status).toBe(503);
      expect(error.code).toBe('SERVICE_UNAVAILABLE');
    });

    it('badGateway creates 502 error', () => {
      const error = AppError.badGateway('Upstream timeout');
      expect(error.status).toBe(502);
      expect(error.code).toBe('BAD_GATEWAY');
      expect(error.message).toBe('Upstream timeout');
    });
  });
});

describe('getErrorMessage', () => {
  it('extracts message from AppError', () => {
    const error = AppError.badRequest('Bad input');
    expect(getErrorMessage(error)).toBe('Bad input');
  });

  it('extracts message from native Error', () => {
    expect(getErrorMessage(new Error('native error'))).toBe('native error');
  });

  it('returns string directly', () => {
    expect(getErrorMessage('plain string error')).toBe('plain string error');
  });

  it('extracts message from object with message property', () => {
    expect(getErrorMessage({ message: 'obj error' })).toBe('obj error');
  });

  it('extracts error from object with error property', () => {
    expect(getErrorMessage({ error: 'obj error field' })).toBe('obj error field');
  });

  it('returns fallback for unknown types', () => {
    expect(getErrorMessage(42)).toBe('An unexpected error occurred');
    expect(getErrorMessage(null)).toBe('An unexpected error occurred');
    expect(getErrorMessage(undefined)).toBe('An unexpected error occurred');
  });

  it('handles Supabase-style error objects', () => {
    const supabaseError = {
      message: 'relation "nonexistent" does not exist',
      details: null,
      hint: null,
      code: '42P01',
    };
    expect(getErrorMessage(supabaseError)).toBe('relation "nonexistent" does not exist');
  });
});
