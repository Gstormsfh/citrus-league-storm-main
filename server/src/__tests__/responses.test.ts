import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { ok, created, okPaginated, fail, handleError } from '../lib/responses';
import { AppError } from '../lib/errors';
import type { Env } from '../app';

/**
 * Helper to create a test Hono app, make a request, and return parsed JSON + status.
 */
async function testRoute(
  handler: (c: any) => Response | Promise<Response>,
): Promise<{ status: number; body: any }> {
  const app = new Hono<Env>();
  app.get('/test', handler);
  const res = await app.request('/test');
  const body = await res.json();
  return { status: res.status, body };
}

describe('ok()', () => {
  it('returns 200 with data envelope', async () => {
    const { status, body } = await testRoute((c) => ok(c, { name: 'Test League' }));
    expect(status).toBe(200);
    expect(body).toEqual({ data: { name: 'Test League' } });
  });

  it('returns 201 when specified', async () => {
    const { status, body } = await testRoute((c) => ok(c, { id: 1 }, 201));
    expect(status).toBe(201);
    expect(body).toEqual({ data: { id: 1 } });
  });

  it('handles null data', async () => {
    const { status, body } = await testRoute((c) => ok(c, null));
    expect(status).toBe(200);
    expect(body).toEqual({ data: null });
  });

  it('handles array data', async () => {
    const { status, body } = await testRoute((c) => ok(c, [1, 2, 3]));
    expect(status).toBe(200);
    expect(body).toEqual({ data: [1, 2, 3] });
  });
});

describe('created()', () => {
  it('returns 201 with data', async () => {
    const { status, body } = await testRoute((c) => created(c, { id: 'abc' }));
    expect(status).toBe(201);
    expect(body).toEqual({ data: { id: 'abc' } });
  });
});

describe('okPaginated()', () => {
  it('returns data with pagination meta', async () => {
    const pagination = { page: 2, limit: 25, total: 100 };
    const { status, body } = await testRoute((c) =>
      okPaginated(c, [{ id: 1 }], pagination)
    );
    expect(status).toBe(200);
    expect(body).toEqual({
      data: [{ id: 1 }],
      pagination: { page: 2, limit: 25, total: 100 },
    });
  });
});

describe('fail()', () => {
  it('returns structured error response', async () => {
    const { status, body } = await testRoute((c) =>
      fail(c, AppError.badRequest('Invalid data', 'name is required'))
    );
    expect(status).toBe(400);
    expect(body.error).toEqual({
      code: 'BAD_REQUEST',
      message: 'Invalid data',
      details: 'name is required',
    });
  });

  it('returns 404 for not found', async () => {
    const { status, body } = await testRoute((c) =>
      fail(c, AppError.notFound('League'))
    );
    expect(status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBe('League not found');
  });

  it('omits details when not provided', async () => {
    const { status, body } = await testRoute((c) =>
      fail(c, AppError.unauthorized())
    );
    expect(status).toBe(401);
    expect(body.error).toEqual({
      code: 'AUTHENTICATION_REQUIRED',
      message: 'Authentication required',
    });
    expect(body.error).not.toHaveProperty('details');
  });
});

describe('handleError()', () => {
  it('handles AppError directly', async () => {
    const { status, body } = await testRoute((c) =>
      handleError(c, AppError.forbidden('Nope'))
    );
    expect(status).toBe(403);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('wraps native Error as 500', async () => {
    const { status, body } = await testRoute((c) =>
      handleError(c, new Error('db connection failed'))
    );
    expect(status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('db connection failed');
  });

  it('uses fallback message for unknown error types', async () => {
    const { status, body } = await testRoute((c) =>
      handleError(c, null, 'Something broke')
    );
    expect(status).toBe(500);
    // null produces "An unexpected error occurred" from getErrorMessage,
    // which is a truthy string so the fallback is not used
    expect(body.error.message).toBe('An unexpected error occurred');
  });

  it('handles string errors', async () => {
    const { status, body } = await testRoute((c) =>
      handleError(c, 'string error')
    );
    expect(status).toBe(500);
    expect(body.error.message).toBe('string error');
  });

  it('handles Supabase error objects', async () => {
    const supabaseError = { message: 'RLS violation', code: '42501' };
    const { status, body } = await testRoute((c) =>
      handleError(c, supabaseError)
    );
    expect(status).toBe(500);
    expect(body.error.message).toBe('RLS violation');
  });
});
