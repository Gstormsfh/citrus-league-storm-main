import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';

// F15 (2026-07-31): tests for the discrimination between credential
// failure (401) and provider-unreachable (503). Amendment 1 (architect
// ruling): allowlist credential failures; default to transient (503).

// ── Mock the supabase-js createClient factory ─────────────────────────
//
// The middleware calls `createClient(SUPABASE_URL, SUPABASE_ANON_KEY, ...)`
// then `.auth.getUser(token)`. We stub the entire module so we can
// script `getUser`'s response per-test.
const mockGetUser = vi.fn();

vi.mock('@supabase/supabase-js', async () => {
  const actual = await vi.importActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js');
  return {
    ...actual,
    createClient: () => ({
      auth: {
        getUser: (...args: unknown[]) => mockGetUser(...args),
      },
    }),
  };
});

// Env vars must be present before importing the middleware/app.
beforeAll(() => {
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key';
});

// Dynamic import so vi.mock() runs first.
let authMiddleware: typeof import('../middleware/auth')['authMiddleware'];

beforeEach(async () => {
  vi.resetModules();
  const mod = await import('../middleware/auth');
  authMiddleware = mod.authMiddleware;
  mockGetUser.mockReset();
});

// ── Test helper: build a minimal Hono-shaped context that the
//    middleware can operate on. We only need Authorization header
//    parsing + c.json() + c.set() + c.req.path.
function makeCtx(authHeader?: string) {
  const responses: Array<{ body: unknown; status: number }> = [];
  const setCalls: Array<[string, unknown]> = [];
  const ctx = {
    req: {
      header: (name: string) => (name === 'Authorization' ? authHeader : undefined),
      path: '/api/test',
    },
    json: (body: unknown, status: number) => {
      responses.push({ body, status });
      return { body, status };
    },
    set: (key: string, value: unknown) => {
      setCalls.push([key, value]);
    },
  };
  return { ctx, responses, setCalls };
}

async function nextSpy() {
  // no-op — track whether it was called via wrapper
}

describe('authMiddleware — F15 discrimination', () => {
  it('returns 401 AUTHENTICATION_REQUIRED when getUser resolves with AuthApiError 401', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError('Invalid token', 401, 'invalid_token'),
    });

    const { ctx, responses } = makeCtx('Bearer some.jwt.token');
    let nextCalled = false;
    await authMiddleware(ctx as never, async () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(responses).toHaveLength(1);
    expect(responses[0].status).toBe(401);
    expect((responses[0].body as { error: { code: string } }).error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('returns 401 AUTHENTICATION_REQUIRED when getUser resolves with AuthApiError 400 (bad_jwt)', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError('Bad JWT', 400, 'bad_jwt'),
    });

    const { ctx, responses } = makeCtx('Bearer some.jwt.token');
    await authMiddleware(ctx as never, nextSpy);

    expect(responses[0].status).toBe(401);
  });

  it('returns 401 AUTHENTICATION_REQUIRED when error carries a credential-failure code (refresh_token_not_found)', async () => {
    const err: Error & { code?: string } = new Error('Refresh token not found');
    err.code = 'refresh_token_not_found';
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: err,
    });

    const { ctx, responses } = makeCtx('Bearer some.jwt.token');
    await authMiddleware(ctx as never, nextSpy);

    expect(responses[0].status).toBe(401);
  });

  it('returns 503 AUTH_PROVIDER_UNREACHABLE when getUser resolves with AuthRetryableFetchError (F15 fix — the exact scenario that caused the bug)', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: new AuthRetryableFetchError('Failed to fetch', 0),
    });

    const { ctx, responses } = makeCtx('Bearer some.jwt.token');
    await authMiddleware(ctx as never, nextSpy);

    expect(responses[0].status).toBe(503);
    expect((responses[0].body as { error: { code: string } }).error.code).toBe('AUTH_PROVIDER_UNREACHABLE');
  });

  it('returns 503 when getUser THROWS with a network-shaped error (defensive try/catch path)', async () => {
    mockGetUser.mockImplementation(() => {
      const err = new TypeError('fetch failed');
      (err as { cause?: { code?: string } }).cause = { code: 'ENOTFOUND' };
      throw err;
    });

    const { ctx, responses } = makeCtx('Bearer some.jwt.token');
    await authMiddleware(ctx as never, nextSpy);

    expect(responses[0].status).toBe(503);
    expect((responses[0].body as { error: { code: string } }).error.code).toBe('AUTH_PROVIDER_UNREACHABLE');
  });

  it('returns 503 when getUser resolves with an unrecognised error shape (amendment 1 regression guard — the default must be transient)', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { name: 'SomeNewErrorTypeSupabaseAddedLater', message: 'weird' },
    });

    const { ctx, responses } = makeCtx('Bearer some.jwt.token');
    await authMiddleware(ctx as never, nextSpy);

    expect(responses[0].status).toBe(503);
    expect((responses[0].body as { error: { code: string } }).error.code).toBe('AUTH_PROVIDER_UNREACHABLE');
  });

  it('returns 503 when getUser resolves with a generic Error (amendment 1 regression guard)', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: new Error('Some unexpected error'),
    });

    const { ctx, responses } = makeCtx('Bearer some.jwt.token');
    await authMiddleware(ctx as never, nextSpy);

    expect(responses[0].status).toBe(503);
  });

  it('calls next() and sets userId/userToken when getUser resolves with a valid user', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-abc-123', email: 'test@example.com' } },
      error: null,
    });

    const { ctx, responses, setCalls } = makeCtx('Bearer some.jwt.token');
    let nextCalled = false;
    await authMiddleware(ctx as never, async () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(responses).toHaveLength(0);
    expect(setCalls).toContainEqual(['userId', 'user-abc-123']);
    expect(setCalls).toContainEqual(['userToken', 'some.jwt.token']);
  });

  it('returns 401 when Authorization header is missing (unchanged behavior)', async () => {
    const { ctx, responses } = makeCtx(undefined);
    await authMiddleware(ctx as never, nextSpy);
    expect(responses[0].status).toBe(401);
    expect((responses[0].body as { error: { code: string } }).error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('returns 401 when Authorization header is not Bearer (unchanged behavior)', async () => {
    const { ctx, responses } = makeCtx('Basic dXNlcjpwYXNz');
    await authMiddleware(ctx as never, nextSpy);
    expect(responses[0].status).toBe(401);
  });
});
