// Phase 4.5 chunk 11g.10 sub-step 10b — draftAdmin route tests.
//
// Tests run against the route factory directly (NOT against the
// engine's full process boot) — the factory takes a LobbyRegistry +
// supabaseAdmin, so we mount it on a fresh Hono instance with mocks.
// This matches how the engine wires it up but avoids the cost of
// booting the full draft-engine process in tests.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// Mock authMiddleware to skip JWT validation; set userId so the
// is_engine_admin gate can run.
vi.mock('../middleware/auth', () => ({
  authMiddleware: async (
    c: { set: (k: string, v: string) => void },
    next: () => Promise<void>,
  ) => {
    c.set('userId', 'test-user-id');
    c.set('userToken', 'test-token');
    await next();
  },
}));

interface MockRegistry {
  evictResult: { connectionsClosed: number } | null;
  forceSnapshotResult: { scheduled: boolean } | null;
  diagnostic: unknown;
  getDiagnosticInfo: () => {
    lobbyId: string;
    leagueId: string;
    format: 'snake' | 'linear' | 'auction';
    connectionCount: number;
    lastAppliedSeq: number;
  };
}

type ForceSnapshotResult = { persisted: boolean; reason?: string } | null;

function buildMockRegistry(): {
  registry: unknown;
  capture: {
    evictCalls: string[];
    forceSnapshotCalls: string[];
    getCalls: string[];
  };
  setEvictResult: (v: { connectionsClosed: number } | null) => void;
  setForceSnapshotResult: (v: ForceSnapshotResult) => void;
} {
  let evictResult: { connectionsClosed: number } | null = {
    connectionsClosed: 3,
  };
  let forceSnapshotResult: ForceSnapshotResult = { persisted: true };
  const capture = {
    evictCalls: [] as string[],
    forceSnapshotCalls: [] as string[],
    getCalls: [] as string[],
  };
  const registry = {
    evict(lobbyId: string) {
      capture.evictCalls.push(lobbyId);
      return evictResult;
    },
    async forceSnapshot(lobbyId: string) {
      capture.forceSnapshotCalls.push(lobbyId);
      return forceSnapshotResult;
    },
    get(lobbyId: string) {
      capture.getCalls.push(lobbyId);
      if (forceSnapshotResult === null) return undefined;
      return {
        getDiagnosticInfo: () => ({
          lobbyId,
          leagueId: 'league-' + lobbyId,
          format: 'snake' as const,
          connectionCount: 12,
          lastAppliedSeq: 42,
        }),
      };
    },
    getDiagnosticSummary() {
      return {
        registries: [
          {
            lobbyId: 'lobby-A',
            leagueId: 'league-A',
            format: 'snake' as const,
            connectionCount: 12,
            lastAppliedSeq: 42,
          },
          {
            lobbyId: 'lobby-B',
            leagueId: 'league-B',
            format: 'auction' as const,
            connectionCount: 8,
            lastAppliedSeq: 17,
          },
        ],
        totalLobbies: 2,
        totalConnections: 20,
      };
    },
  };
  return {
    registry,
    capture,
    setEvictResult(v) {
      evictResult = v;
    },
    setForceSnapshotResult(v) {
      forceSnapshotResult = v;
    },
  };
}

interface MockSupabaseAdminState {
  isEngineAdmin: boolean | null;
  error: { message: string } | null;
  draftSnapshotsRow:
    | { last_applied_seq: number; engine_version: number; created_at: string }
    | null;
}

function buildMockSupabaseAdmin(state: MockSupabaseAdminState): unknown {
  // Builder pattern matching @supabase/supabase-js. Two tables matter:
  // `profiles` (for is_engine_admin gate) and `draft_snapshots` (for
  // snapshot endpoint response shape).
  return {
    from(table: string) {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => {
                if (state.error) return { data: null, error: state.error };
                return {
                  data: { is_engine_admin: state.isEngineAdmin },
                  error: null,
                };
              },
            }),
          }),
        };
      }
      if (table === 'draft_snapshots') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({
                    data: state.draftSnapshotsRow,
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table in mock: ${table}`);
    },
  };
}

const { createDraftAdminRoutes } = await import('../routes/draftAdmin');

function buildApp(
  registry: unknown,
  supabaseAdmin: unknown,
): { app: Hono; sentReq: (path: string, init?: RequestInit) => Promise<Response> } {
  const app = new Hono();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const routes = createDraftAdminRoutes({ registry: registry as any, supabaseAdmin: supabaseAdmin as any });
  app.route('/api/admin', routes);
  return {
    app,
    sentReq: async (path: string, init?: RequestInit) =>
      app.request(path, {
        headers: { Authorization: 'Bearer test-token' },
        ...init,
      }),
  };
}

describe('draftAdmin routes — is_engine_admin gating', () => {
  it('returns 403 when caller is not is_engine_admin', async () => {
    const reg = buildMockRegistry();
    const sb = buildMockSupabaseAdmin({
      isEngineAdmin: false,
      error: null,
      draftSnapshotsRow: null,
    });
    const { sentReq } = buildApp(reg.registry, sb);
    const res = await sentReq('/api/admin/engine/whoami');
    expect(res.status).toBe(403);
  });

  it('returns 403 if profile lookup errors', async () => {
    const reg = buildMockRegistry();
    const sb = buildMockSupabaseAdmin({
      isEngineAdmin: null,
      error: { message: 'pg unavailable' },
      draftSnapshotsRow: null,
    });
    const { sentReq } = buildApp(reg.registry, sb);
    const res = await sentReq('/api/admin/engine/whoami');
    expect(res.status).toBe(403);
  });

  it('returns 200 from /engine/whoami when caller is is_engine_admin', async () => {
    const reg = buildMockRegistry();
    const sb = buildMockSupabaseAdmin({
      isEngineAdmin: true,
      error: null,
      draftSnapshotsRow: null,
    });
    const { sentReq } = buildApp(reg.registry, sb);
    const res = await sentReq('/api/admin/engine/whoami');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { engineAdmin: boolean; userId: string } };
    expect(body.data.engineAdmin).toBe(true);
    expect(body.data.userId).toBe('test-user-id');
  });
});

describe('draftAdmin routes — functional endpoints', () => {
  let state: MockSupabaseAdminState;
  beforeEach(() => {
    state = {
      isEngineAdmin: true,
      error: null,
      draftSnapshotsRow: {
        last_applied_seq: 99,
        engine_version: 1,
        created_at: '2026-05-19T20:00:00Z',
      },
    };
  });

  it('GET /engine/registry returns diagnostic shape', async () => {
    const reg = buildMockRegistry();
    const sb = buildMockSupabaseAdmin(state);
    const { sentReq } = buildApp(reg.registry, sb);
    const res = await sentReq('/api/admin/engine/registry');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        registries: Array<{ lobbyId: string; format: string; connectionCount: number; lastAppliedSeq: number }>;
        totalLobbies: number;
        totalConnections: number;
        capturedAt: string;
      };
    };
    expect(body.data.totalLobbies).toBe(2);
    expect(body.data.totalConnections).toBe(20);
    expect(body.data.registries).toHaveLength(2);
    expect(body.data.registries[0].lobbyId).toBe('lobby-A');
    expect(body.data.capturedAt).toMatch(/^2026-/);
  });

  it('POST /engine/lobby/:id/snapshot success returns 200 with persisted: true', async () => {
    const reg = buildMockRegistry(); // default forceSnapshotResult = { persisted: true }
    const sb = buildMockSupabaseAdmin(state);
    const { sentReq } = buildApp(reg.registry, sb);
    const res = await sentReq('/api/admin/engine/lobby/lobby-X/snapshot', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { lobbyId: string; persisted: boolean; reason?: string; seq: number | null; engineVersion: number | null; persistedAt: string | null };
    };
    expect(body.data.lobbyId).toBe('lobby-X');
    expect(body.data.persisted).toBe(true);
    expect(body.data.reason).toBeUndefined();
    expect(body.data.seq).toBe(99);
    expect(body.data.engineVersion).toBe(1);
    // Confirm `scheduled` field is gone (Q3 follow-up removed it).
    expect((body.data as Record<string, unknown>).scheduled).toBeUndefined();
    expect(reg.capture.forceSnapshotCalls).toEqual(['lobby-X']);
  });

  it('POST /engine/lobby/:id/snapshot against not_started draft returns 200 with persisted: false + state_not_in_progress reason', async () => {
    const reg = buildMockRegistry();
    reg.setForceSnapshotResult({ persisted: false, reason: 'state_not_in_progress' });
    const sb = buildMockSupabaseAdmin({
      isEngineAdmin: true,
      error: null,
      // Latest existing snapshot row (older than this call). Q3
      // contract: response shows what's durable now even when call
      // didn't write anything.
      draftSnapshotsRow: {
        last_applied_seq: 87,
        engine_version: 1,
        created_at: '2026-05-19T19:45:30Z',
      },
    });
    const { sentReq } = buildApp(reg.registry, sb);
    const res = await sentReq('/api/admin/engine/lobby/not-started-lobby/snapshot', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { lobbyId: string; persisted: boolean; reason?: string; seq: number | null; engineVersion: number | null; persistedAt: string | null };
    };
    expect(body.data.persisted).toBe(false);
    expect(body.data.reason).toBe('state_not_in_progress');
    expect(body.data.seq).toBe(87);
    expect(body.data.persistedAt).toBe('2026-05-19T19:45:30Z');
  });

  it('POST /engine/lobby/:id/snapshot against paused draft returns 200 with persisted: false + state_not_in_progress reason', async () => {
    // Paused state is treated identically to not_started by the
    // LobbyManager (both early-return with state_not_in_progress).
    const reg = buildMockRegistry();
    reg.setForceSnapshotResult({ persisted: false, reason: 'state_not_in_progress' });
    const sb = buildMockSupabaseAdmin(state);
    const { sentReq } = buildApp(reg.registry, sb);
    const res = await sentReq('/api/admin/engine/lobby/paused-lobby/snapshot', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { persisted: boolean; reason?: string };
    };
    expect(body.data.persisted).toBe(false);
    expect(body.data.reason).toBe('state_not_in_progress');
  });

  it('POST /engine/lobby/:id/snapshot returns 404 when lobby not in registry', async () => {
    const reg = buildMockRegistry();
    reg.setForceSnapshotResult(null);
    const sb = buildMockSupabaseAdmin(state);
    const { sentReq } = buildApp(reg.registry, sb);
    const res = await sentReq('/api/admin/engine/lobby/missing-lobby/snapshot', {
      method: 'POST',
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; lobbyId: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.lobbyId).toBe('missing-lobby');
  });

  it('POST /engine/lobby/:id/evict success returns 200 with connectionsClosed', async () => {
    const reg = buildMockRegistry();
    const sb = buildMockSupabaseAdmin(state);
    const { sentReq } = buildApp(reg.registry, sb);
    const res = await sentReq('/api/admin/engine/lobby/lobby-Y/evict', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { lobbyId: string; connectionsClosed: number; evictedAt: string };
    };
    expect(body.data.lobbyId).toBe('lobby-Y');
    expect(body.data.connectionsClosed).toBe(3);
    expect(body.data.evictedAt).toMatch(/^2026-/);
    expect(reg.capture.evictCalls).toEqual(['lobby-Y']);
  });

  it('POST /engine/lobby/:id/evict returns 404 when lobby not in registry', async () => {
    const reg = buildMockRegistry();
    reg.setEvictResult(null);
    const sb = buildMockSupabaseAdmin(state);
    const { sentReq } = buildApp(reg.registry, sb);
    const res = await sentReq('/api/admin/engine/lobby/missing-lobby/evict', {
      method: 'POST',
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('snapshot endpoint handles draft_snapshots empty (no rows yet)', async () => {
    const reg = buildMockRegistry();
    state.draftSnapshotsRow = null;
    const sb = buildMockSupabaseAdmin(state);
    const { sentReq } = buildApp(reg.registry, sb);
    const res = await sentReq('/api/admin/engine/lobby/lobby-Z/snapshot', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { seq: number | null; engineVersion: number | null; persistedAt: string | null };
    };
    expect(body.data.seq).toBeNull();
    expect(body.data.engineVersion).toBeNull();
    expect(body.data.persistedAt).toBeNull();
  });
});

describe('draftAdmin routes — audit log emission', () => {
  // We rely on the structuredLogger import being a singleton; spy on
  // its `.info` method and confirm the right event fires on each
  // successful action.

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('emits admin.endpoint.snapshot_forced with persisted: true on successful write', async () => {
    const reg = buildMockRegistry();
    const sb = buildMockSupabaseAdmin({
      isEngineAdmin: true,
      error: null,
      draftSnapshotsRow: {
        last_applied_seq: 50,
        engine_version: 1,
        created_at: '2026-05-19T20:00:00Z',
      },
    });
    const { structuredLogger } = await import('@citrus/shared');
    const spy = vi.spyOn(structuredLogger, 'info');
    const { sentReq } = buildApp(reg.registry, sb);
    await sentReq('/api/admin/engine/lobby/audit-lobby/snapshot', { method: 'POST' });
    const matching = spy.mock.calls.find(
      (call) => call[0] === 'admin.endpoint.snapshot_forced',
    );
    expect(matching).toBeDefined();
    expect(matching?.[1]).toMatchObject({
      userId: 'test-user-id',
      lobbyId: 'audit-lobby',
      outcome: 'success',
      persisted: true,
    });
  });

  it('emits admin.endpoint.snapshot_forced with persisted: false + reason on skipped write', async () => {
    // Q3 follow-up: audit trail must capture skipped writes too, so
    // post-incident review can see WHEN the operator hit the endpoint
    // and WHY no write happened. persisted + reason both in payload.
    const reg = buildMockRegistry();
    reg.setForceSnapshotResult({ persisted: false, reason: 'state_not_in_progress' });
    const sb = buildMockSupabaseAdmin({
      isEngineAdmin: true,
      error: null,
      draftSnapshotsRow: null,
    });
    const { structuredLogger } = await import('@citrus/shared');
    const spy = vi.spyOn(structuredLogger, 'info');
    const { sentReq } = buildApp(reg.registry, sb);
    await sentReq('/api/admin/engine/lobby/audit-skip-lobby/snapshot', { method: 'POST' });
    const matching = spy.mock.calls.find(
      (call) => call[0] === 'admin.endpoint.snapshot_forced',
    );
    expect(matching).toBeDefined();
    expect(matching?.[1]).toMatchObject({
      userId: 'test-user-id',
      lobbyId: 'audit-skip-lobby',
      outcome: 'success',
      persisted: false,
      reason: 'state_not_in_progress',
    });
  });

  it('emits admin.endpoint.lobby_evicted on successful evict', async () => {
    const reg = buildMockRegistry();
    const sb = buildMockSupabaseAdmin({
      isEngineAdmin: true,
      error: null,
      draftSnapshotsRow: null,
    });
    const { structuredLogger } = await import('@citrus/shared');
    const spy = vi.spyOn(structuredLogger, 'info');
    const { sentReq } = buildApp(reg.registry, sb);
    await sentReq('/api/admin/engine/lobby/audit-lobby/evict', { method: 'POST' });
    const matching = spy.mock.calls.find(
      (call) => call[0] === 'admin.endpoint.lobby_evicted',
    );
    expect(matching).toBeDefined();
    expect(matching?.[1]).toMatchObject({
      userId: 'test-user-id',
      lobbyId: 'audit-lobby',
      outcome: 'success',
      connectionsClosed: 3,
    });
  });

  it('emits admin.endpoint.registry_read on registry diagnostic', async () => {
    const reg = buildMockRegistry();
    const sb = buildMockSupabaseAdmin({
      isEngineAdmin: true,
      error: null,
      draftSnapshotsRow: null,
    });
    const { structuredLogger } = await import('@citrus/shared');
    const spy = vi.spyOn(structuredLogger, 'info');
    const { sentReq } = buildApp(reg.registry, sb);
    await sentReq('/api/admin/engine/registry');
    const matching = spy.mock.calls.find(
      (call) => call[0] === 'admin.endpoint.registry_read',
    );
    expect(matching).toBeDefined();
    expect(matching?.[1]).toMatchObject({
      userId: 'test-user-id',
      totalLobbies: 2,
      totalConnections: 20,
    });
  });
});
