// Phase 4.5 chunk 11g.10 sub-step 10b — draftAdmin routes auth tests.
//
// Verifies the is_engine_admin middleware gating. Endpoint bodies are
// scaffolded to 501 Not Implemented per the 10b posture; tests
// confirm the auth chain and the documented response shape.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// Mock auth middleware to set userId without going through real Supabase JWT.
vi.mock('../middleware/auth', () => ({
  authMiddleware: async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('userId', 'test-user-id');
    c.set('userToken', 'test-token');
    await next();
  },
}));

// Mock supabaseAdmin with a builder pattern matching the real client.
const mockSupabaseAdminState = {
  isEngineAdmin: false as boolean | null,
  error: null as { message: string } | null,
};

vi.mock('../lib/supabase', () => ({
  supabaseAdmin: {
    from: (_t: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => {
            if (mockSupabaseAdminState.error) {
              return { data: null, error: mockSupabaseAdminState.error };
            }
            return {
              data: { is_engine_admin: mockSupabaseAdminState.isEngineAdmin },
              error: null,
            };
          },
        }),
      }),
    }),
  },
  createUserClient: () => ({}),
}));

// Import AFTER mocks are set up.
const { draftAdminRoutes } = await import('../routes/draftAdmin');

function buildApp() {
  const app = new Hono();
  app.route('/api/admin', draftAdminRoutes);
  return app;
}

describe('draftAdmin routes — is_engine_admin gating', () => {
  beforeEach(() => {
    mockSupabaseAdminState.isEngineAdmin = false;
    mockSupabaseAdminState.error = null;
  });

  it('returns 403 when caller is not is_engine_admin', async () => {
    mockSupabaseAdminState.isEngineAdmin = false;
    const app = buildApp();
    const res = await app.request('/api/admin/engine/whoami', {
      headers: { Authorization: 'Bearer test-token' },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('returns 200 from /engine/whoami when caller is is_engine_admin', async () => {
    mockSupabaseAdminState.isEngineAdmin = true;
    const app = buildApp();
    const res = await app.request('/api/admin/engine/whoami', {
      headers: { Authorization: 'Bearer test-token' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { engineAdmin: boolean; userId: string } };
    expect(body.data.engineAdmin).toBe(true);
    expect(body.data.userId).toBe('test-user-id');
  });

  it('returns 501 from /engine/lobby/:id/snapshot (scaffold posture)', async () => {
    mockSupabaseAdminState.isEngineAdmin = true;
    const app = buildApp();
    const res = await app.request('/api/admin/engine/lobby/abc123/snapshot', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token' },
    });
    expect(res.status).toBe(501);
    const body = (await res.json()) as { error: { code: string; lobbyId: string } };
    expect(body.error.code).toBe('NOT_IMPLEMENTED');
    expect(body.error.lobbyId).toBe('abc123');
  });

  it('returns 501 from /engine/lobby/:id/evict (scaffold posture)', async () => {
    mockSupabaseAdminState.isEngineAdmin = true;
    const app = buildApp();
    const res = await app.request('/api/admin/engine/lobby/abc123/evict', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token' },
    });
    expect(res.status).toBe(501);
  });

  it('returns 501 from /engine/registry (scaffold posture)', async () => {
    mockSupabaseAdminState.isEngineAdmin = true;
    const app = buildApp();
    const res = await app.request('/api/admin/engine/registry', {
      headers: { Authorization: 'Bearer test-token' },
    });
    expect(res.status).toBe(501);
  });

  it('returns 403 if profile lookup errors (treats as unauthorized)', async () => {
    mockSupabaseAdminState.error = { message: 'connection refused' };
    const app = buildApp();
    const res = await app.request('/api/admin/engine/whoami', {
      headers: { Authorization: 'Bearer test-token' },
    });
    expect(res.status).toBe(403);
  });

  it('returns 403 when is_engine_admin is null (not set on profile)', async () => {
    mockSupabaseAdminState.isEngineAdmin = null;
    const app = buildApp();
    const res = await app.request('/api/admin/engine/whoami', {
      headers: { Authorization: 'Bearer test-token' },
    });
    expect(res.status).toBe(403);
  });
});
