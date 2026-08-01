import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';

// ── Mock supabase ──────────────────────────────────────────────────────
const mockGetSession = vi.fn();
const mockRefreshSession = vi.fn();
const mockSignOut = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: mockGetSession,
      refreshSession: mockRefreshSession,
      signOut: mockSignOut,
    },
  },
}));

// ── Mock fetch ─────────────────────────────────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ── Helpers ────────────────────────────────────────────────────────────

/** Build a fake JWT with the given `exp` timestamp (seconds). */
function fakeJwt(exp: number): string {
  const header = btoa(JSON.stringify({ alg: 'HS256' }));
  const payload = btoa(JSON.stringify({ exp }));
  return `${header}.${payload}.sig`;
}

/** A valid token that won't expire for a long time. */
const VALID_TOKEN = fakeJwt(Math.floor(Date.now() / 1000) + 3600);

/** A token that expires within the 30-second proactive refresh window. */
const EXPIRING_TOKEN = fakeJwt(Math.floor(Date.now() / 1000) + 10);

/** A token that is already expired. */
const EXPIRED_TOKEN = fakeJwt(Math.floor(Date.now() / 1000) - 60);

const REFRESHED_TOKEN = fakeJwt(Math.floor(Date.now() / 1000) + 7200);

function mockSession(token: string | null) {
  mockGetSession.mockResolvedValue({
    data: { session: token ? { access_token: token } : null },
  });
}

function mockFetchOk(body: unknown = { data: 'ok' }) {
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  });
}

function mockFetchError(status: number, body: unknown = { error: 'fail' }) {
  mockFetch.mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve(body),
  });
}

// ── Import after mocks ────────────────────────────────────────────────
// Dynamic import so vi.mock() runs first.
let apiClient: typeof import('../client')['apiClient'];
let ApiError: typeof import('../client')['ApiError'];

beforeEach(async () => {
  vi.resetModules();
  const mod = await import('../client');
  apiClient = mod.apiClient;
  ApiError = mod.ApiError;

  mockGetSession.mockReset();
  mockRefreshSession.mockReset();
  mockSignOut.mockReset().mockResolvedValue({});
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ──────────────────────────────────────────────────────────────

describe('ApiError', () => {
  it('sets message, status, data, and name', () => {
    const data = { detail: 'not found' };
    const err = new ApiError('Not found', 404, data);

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ApiError');
    expect(err.message).toBe('Not found');
    expect(err.status).toBe(404);
    expect(err.data).toEqual(data);
  });

  it('defaults data to undefined when omitted', () => {
    const err = new ApiError('Server error', 500);
    expect(err.data).toBeUndefined();
  });
});

describe('apiClient HTTP methods', () => {
  beforeEach(() => {
    mockSession(VALID_TOKEN);
    mockFetchOk();
  });

  it('GET calls fetch with method GET', async () => {
    await apiClient.get('/api/players');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/players');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it('POST calls fetch with method POST', async () => {
    await apiClient.post('/api/leagues', { name: 'Test' });

    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe('POST');
  });

  it('PUT calls fetch with method PUT', async () => {
    await apiClient.put('/api/leagues/1', { name: 'Updated' });

    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe('PUT');
  });

  it('PATCH calls fetch with method PATCH', async () => {
    await apiClient.patch('/api/leagues/1', { name: 'Patched' });

    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe('PATCH');
  });

  it('DELETE calls fetch with method DELETE', async () => {
    await apiClient.delete('/api/leagues/1');

    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
  });
});

describe('auth header', () => {
  it('attaches Bearer token when session exists', async () => {
    mockSession(VALID_TOKEN);
    mockFetchOk();

    await apiClient.get('/api/test');

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers['Authorization']).toBe(`Bearer ${VALID_TOKEN}`);
  });

  it('omits Authorization header when no session', async () => {
    mockSession(null);
    mockFetchOk();

    await apiClient.get('/api/test');

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers['Authorization']).toBeUndefined();
  });
});

describe('request body', () => {
  beforeEach(() => {
    mockSession(VALID_TOKEN);
    mockFetchOk();
  });

  it('POST sends JSON-stringified body', async () => {
    const body = { name: 'League', size: 10 };
    await apiClient.post('/api/leagues', body);

    const [, init] = mockFetch.mock.calls[0];
    expect(init.body).toBe(JSON.stringify(body));
  });

  it('PUT sends JSON-stringified body', async () => {
    const body = { name: 'Updated' };
    await apiClient.put('/api/leagues/1', body);

    const [, init] = mockFetch.mock.calls[0];
    expect(init.body).toBe(JSON.stringify(body));
  });

  it('PATCH sends JSON-stringified body', async () => {
    const body = { name: 'Patched' };
    await apiClient.patch('/api/leagues/1', body);

    const [, init] = mockFetch.mock.calls[0];
    expect(init.body).toBe(JSON.stringify(body));
  });

  it('GET does not send a body', async () => {
    await apiClient.get('/api/test');

    const [, init] = mockFetch.mock.calls[0];
    expect(init.body).toBeUndefined();
  });

  it('DELETE does not send a body', async () => {
    await apiClient.delete('/api/test');

    const [, init] = mockFetch.mock.calls[0];
    expect(init.body).toBeUndefined();
  });
});

describe('Content-Type and x-client-info headers', () => {
  it('always sends Content-Type and x-client-info', async () => {
    mockSession(null);
    mockFetchOk();

    await apiClient.get('/api/test');

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.headers['x-client-info']).toBe('citrus-web');
  });

  it('includes custom headers alongside default headers', async () => {
    mockSession(VALID_TOKEN);
    mockFetchOk();

    await apiClient.get('/api/test', {
      headers: { 'X-Custom': 'value' },
    });

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.headers['x-client-info']).toBe('citrus-web');
    expect(init.headers['X-Custom']).toBe('value');
  });
});

describe('error handling', () => {
  it('throws ApiError with status and message from response error string', async () => {
    mockSession(VALID_TOKEN);
    mockFetchError(403, { error: 'Forbidden' });

    await expect(apiClient.get('/api/test')).rejects.toThrow('Forbidden');

    try {
      await apiClient.get('/api/test');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as InstanceType<typeof ApiError>).status).toBe(403);
    }
  });

  it('throws ApiError with error.message when error is an object', async () => {
    mockSession(VALID_TOKEN);
    mockFetchError(400, { error: { message: 'Validation failed' } });

    await expect(apiClient.get('/api/test')).rejects.toThrow('Validation failed');
  });

  it('throws ApiError with json.message as fallback', async () => {
    mockSession(VALID_TOKEN);
    mockFetchError(500, { message: 'Internal error' });

    await expect(apiClient.get('/api/test')).rejects.toThrow('Internal error');
  });

  it('throws ApiError with generic fallback message when no error field', async () => {
    mockSession(VALID_TOKEN);
    mockFetchError(502, {});

    await expect(apiClient.get('/api/test')).rejects.toThrow(
      'API request failed with status 502'
    );
  });

  it('includes response data in ApiError', async () => {
    mockSession(VALID_TOKEN);
    const responseBody = { error: 'Bad request', details: { field: 'name' } };
    mockFetchError(400, responseBody);

    try {
      await apiClient.post('/api/test', {});
    } catch (e) {
      expect((e as InstanceType<typeof ApiError>).data).toEqual(responseBody);
    }
  });
});

describe('proactive token refresh (jwtExpiry behavior)', () => {
  it('refreshes token proactively when token expires within 30s', async () => {
    mockSession(EXPIRING_TOKEN);
    mockRefreshSession.mockResolvedValue({
      data: { session: { access_token: REFRESHED_TOKEN } },
      error: null,
    });
    mockFetchOk();

    await apiClient.get('/api/test');

    expect(mockRefreshSession).toHaveBeenCalledOnce();
    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers['Authorization']).toBe(`Bearer ${REFRESHED_TOKEN}`);
  });

  it('refreshes token proactively when token is already expired', async () => {
    mockSession(EXPIRED_TOKEN);
    mockRefreshSession.mockResolvedValue({
      data: { session: { access_token: REFRESHED_TOKEN } },
      error: null,
    });
    mockFetchOk();

    await apiClient.get('/api/test');

    expect(mockRefreshSession).toHaveBeenCalledOnce();
    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers['Authorization']).toBe(`Bearer ${REFRESHED_TOKEN}`);
  });

  it('omits auth header when proactive refresh fails', async () => {
    mockSession(EXPIRING_TOKEN);
    mockRefreshSession.mockResolvedValue({
      data: { session: null },
      error: new Error('Refresh failed'),
    });
    mockFetchOk();

    await apiClient.get('/api/test');

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers['Authorization']).toBeUndefined();
  });

  it('does not refresh when token has plenty of time left', async () => {
    mockSession(VALID_TOKEN);
    mockFetchOk();

    await apiClient.get('/api/test');

    expect(mockRefreshSession).not.toHaveBeenCalled();
  });

  // F19 (2026-07-31): amendment 1 — signOut ONLY on positively-identified
  // credential failure. Generic Error (like the pre-fix synthetic
  // "Token revoked" here) is treated as transient and does NOT signOut,
  // so this test now uses a real AuthApiError with a credential-death
  // status to exercise the discrimination path.
  it('signs out when proactive refresh fails with AuthApiError 401 (invalid_grant)', async () => {
    mockSession(EXPIRING_TOKEN);
    mockRefreshSession.mockResolvedValue({
      data: { session: null },
      error: new AuthApiError('Invalid refresh token', 401, 'invalid_grant'),
    });
    mockFetchOk();

    await apiClient.get('/api/test');

    expect(mockSignOut).toHaveBeenCalled();
  });

  it('does not sign out on network error during refresh (reject path)', async () => {
    mockSession(EXPIRING_TOKEN);
    mockRefreshSession.mockRejectedValue(new Error('Network error'));
    mockFetchOk();

    await apiClient.get('/api/test');

    expect(mockSignOut).not.toHaveBeenCalled();
  });

  // ── F19 discrimination — cover the resolve-with-error path
  //    (this is where the pre-fix bug lived) ─────────────────────────

  it('does NOT sign out when refresh resolves with AuthRetryableFetchError (F19 fix — the exact scenario that caused the bug)', async () => {
    mockSession(EXPIRING_TOKEN);
    mockRefreshSession.mockResolvedValue({
      data: { session: null },
      error: new AuthRetryableFetchError('Failed to fetch', 0),
    });
    mockFetchOk();

    await apiClient.get('/api/test');

    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('does NOT sign out when refresh resolves with a generic Error (amendment 1 regression guard)', async () => {
    mockSession(EXPIRING_TOKEN);
    mockRefreshSession.mockResolvedValue({
      data: { session: null },
      error: new Error('Token revoked'),
    });
    mockFetchOk();

    await apiClient.get('/api/test');

    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('does NOT sign out when refresh resolves with an unrecognised error shape (amendment 1 regression guard)', async () => {
    mockSession(EXPIRING_TOKEN);
    mockRefreshSession.mockResolvedValue({
      data: { session: null },
      error: { name: 'AuthUnknownError', message: 'weird', originalError: null },
    });
    mockFetchOk();

    await apiClient.get('/api/test');

    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('does NOT sign out when refresh resolves with no error AND no session (defensive)', async () => {
    mockSession(EXPIRING_TOKEN);
    mockRefreshSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });
    mockFetchOk();

    await apiClient.get('/api/test');

    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('signs out when refresh resolves with an error carrying a credential-failure code (e.g. refresh_token_not_found)', async () => {
    mockSession(EXPIRING_TOKEN);
    // Some GoTrue paths return the code without the AuthApiError class
    // (e.g. custom errors). Match by code alone.
    const err: Error & { code?: string } = new Error('Refresh token not found');
    err.code = 'refresh_token_not_found';
    mockRefreshSession.mockResolvedValue({
      data: { session: null },
      error: err,
    });
    mockFetchOk();

    await apiClient.get('/api/test');

    expect(mockSignOut).toHaveBeenCalled();
  });

  it('signs out when refresh resolves with AuthApiError 400 (bad_jwt)', async () => {
    mockSession(EXPIRING_TOKEN);
    mockRefreshSession.mockResolvedValue({
      data: { session: null },
      error: new AuthApiError('Bad JWT', 400, 'bad_jwt'),
    });
    mockFetchOk();

    await apiClient.get('/api/test');

    expect(mockSignOut).toHaveBeenCalled();
  });
});

describe('token refresh on 401', () => {
  it('retries once with refreshed token on 401', async () => {
    mockSession(VALID_TOKEN);
    mockRefreshSession.mockResolvedValue({
      data: { session: { access_token: REFRESHED_TOKEN } },
      error: null,
    });

    // First call returns 401, retry returns 200
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: 'Unauthorized' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: 'success' }),
      });

    const result = await apiClient.get('/api/test');

    expect(mockRefreshSession).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ data: 'success' });

    // Second call should use the refreshed token
    const [, retryInit] = mockFetch.mock.calls[1];
    expect(retryInit.headers['Authorization']).toBe(`Bearer ${REFRESHED_TOKEN}`);
  });

  it('throws ApiError when 401 retry also fails', async () => {
    mockSession(VALID_TOKEN);
    mockRefreshSession.mockResolvedValue({
      data: { session: { access_token: REFRESHED_TOKEN } },
      error: null,
    });

    // Both calls return non-ok
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: 'Unauthorized' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: 'Still unauthorized' }),
      });

    await expect(apiClient.get('/api/test')).rejects.toThrow('Still unauthorized');
  });

  it('does not retry when there is no token', async () => {
    mockSession(null);
    mockFetchError(401, { error: 'No token' });

    await expect(apiClient.get('/api/test')).rejects.toThrow('No token');
    expect(mockRefreshSession).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('does not retry when refresh returns the same token', async () => {
    mockSession(VALID_TOKEN);
    mockRefreshSession.mockResolvedValue({
      data: { session: { access_token: VALID_TOKEN } },
      error: null,
    });

    mockFetchError(401, { error: 'Unauthorized' });

    await expect(apiClient.get('/api/test')).rejects.toThrow('Unauthorized');
    // Should not retry because newToken === token
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('does not retry when refresh fails', async () => {
    mockSession(VALID_TOKEN);
    mockRefreshSession.mockResolvedValue({
      data: { session: null },
      error: new Error('Refresh failed'),
    });

    mockFetchError(401, { error: 'Unauthorized' });

    await expect(apiClient.get('/api/test')).rejects.toThrow('Unauthorized');
    expect(mockFetch).toHaveBeenCalledOnce();
  });
});

describe('returns parsed JSON on success', () => {
  it('returns the full response body', async () => {
    mockSession(VALID_TOKEN);
    const responseBody = {
      data: [{ id: 1, name: 'Player' }],
      pagination: { page: 1, limit: 25, total: 100 },
    };
    mockFetchOk(responseBody);

    const result = await apiClient.get('/api/players');
    expect(result).toEqual(responseBody);
  });
});
