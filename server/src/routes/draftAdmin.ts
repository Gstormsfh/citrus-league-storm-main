// Phase 4.5 chunk 11g.10 sub-step 10b — engine-ops admin endpoints.
//
// **Mounted on the engine's Hono server (port 3001 on the GCE VM),
// NOT on the main API server's Hono composition.** Per architect call
// 2026-05-19: admin endpoints manipulate engine-local state
// (LobbyRegistry, in-memory snapshot pipeline) and so must run in the
// engine process. There is no cross-process delegation; on-call hits
// the engine's HTTP port directly.
//
// This file exports a factory that takes the LobbyRegistry (and the
// admin Supabase client for the is_engine_admin profile lookup) as
// dependencies. The engine's index.ts constructs the registry and
// then calls this factory + mounts the result on the engine's `app`.
//
// Endpoints:
//   POST /api/admin/engine/lobby/:lobbyId/snapshot
//     — force a snapshot persistence for the named lobby
//   POST /api/admin/engine/lobby/:lobbyId/evict
//     — close WS connections + remove the lobby from the registry
//   GET  /api/admin/engine/registry
//     — diagnostic view of LobbyRegistry contents
//   GET  /api/admin/engine/whoami
//     — auth-chain verification (returns 200 if is_engine_admin)
//
// Auth: existing authMiddleware (server/src/middleware/auth.ts) does
// JWT validation via Supabase auth API. Requires SUPABASE_URL +
// SUPABASE_ANON_KEY in the engine's env (added to the GCE startup
// script alongside Commit 1's other env wiring). Then a per-route
// middleware queries `profiles.is_engine_admin` via the admin client.
//
// Audit log: each successful action emits a structured log event
// (`admin.endpoint.snapshot_forced`, `admin.endpoint.lobby_evicted`,
// `admin.endpoint.registry_read`) with the calling userId, lobbyId
// if applicable, and outcome. This is the durable audit trail for
// operational interventions.

import { Hono } from 'hono';
import type { SupabaseClient } from '@supabase/supabase-js';
import { structuredLogger } from '@citrus/shared';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { AppError } from '../lib/errors';
import { ok, fail } from '../lib/responses';
import type { LobbyRegistry } from '../draft/LobbyRegistry';

export interface DraftAdminRoutesOptions {
  /**
   * The engine's LobbyRegistry instance. The factory captures this in
   * closure and routes the snapshot / evict / registry endpoints
   * through it.
   */
  registry: LobbyRegistry;
  /**
   * Admin Supabase client (service-role-keyed). Used for the
   * is_engine_admin profile lookup. Same client the engine uses for
   * its RPC calls.
   */
  supabaseAdmin: SupabaseClient;
}

export function createDraftAdminRoutes(opts: DraftAdminRoutesOptions): Hono<Env> {
  const { registry, supabaseAdmin } = opts;
  const routes = new Hono<Env>();

  routes.use('*', authMiddleware);

  // is_engine_admin gate — mirror the is_admin pattern from
  // server/src/routes/admin.ts (chunk 11g.10 sub-step 10b Decision
  // Log 2026-05-19: separable privilege gate).
  routes.use('*', async (c, next) => {
    const userId = c.get('userId');
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('is_engine_admin')
      .eq('id', userId)
      .single();

    if (error || !profile?.is_engine_admin) {
      return fail(c, AppError.forbidden('Engine-admin access required'));
    }

    await next();
  });

  /**
   * GET /api/admin/engine/whoami
   *
   * Auth-chain verification — returns 200 with `{ engineAdmin: true,
   * userId, timestamp }` if the request passes both authMiddleware
   * AND is_engine_admin gate. Useful for "is my admin token wired
   * correctly?" without invoking a mutating endpoint.
   */
  routes.get('/engine/whoami', async (c) => {
    return ok(c, {
      engineAdmin: true,
      userId: c.get('userId'),
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * POST /api/admin/engine/lobby/:lobbyId/snapshot
   *
   * Force a snapshot persistence for the named lobby through its
   * LobbyManager's single-writer queue. Awaits queue completion
   * before returning. On registry hit, returns 200 with metadata
   * about the latest snapshot row written; if the queue completed
   * but no snapshot was written (e.g., draft paused or not_started),
   * returns 200 with `{ scheduled: true, persisted: false }`.
   *
   * 404 if lobby not in registry.
   */
  routes.post('/engine/lobby/:lobbyId/snapshot', async (c) => {
    const lobbyId = c.req.param('lobbyId');
    const userId = c.get('userId');

    const scheduleResult = await registry.forceSnapshot(lobbyId);
    if (scheduleResult === null) {
      structuredLogger.warn('admin.endpoint.snapshot_forced', {
        userId,
        lobbyId,
        outcome: 'lobby_not_in_registry',
      });
      return c.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: `Lobby ${lobbyId} is not in the engine registry`,
            lobbyId,
          },
        },
        404,
      );
    }

    // Read back the most-recently-written snapshot row to extract
    // metadata for the response body. If the schedule was skipped
    // (paused / not_started), the latest row is unchanged but still
    // gives the operator visibility into the lobby's last snapshot.
    const lobby = registry.get(lobbyId);
    const leagueId = lobby?.getDiagnosticInfo().leagueId ?? null;
    let snapshotMeta: {
      seq: number | null;
      engineVersion: number | null;
      persistedAt: string | null;
    } = { seq: null, engineVersion: null, persistedAt: null };
    if (leagueId) {
      const { data } = await supabaseAdmin
        .from('draft_snapshots')
        .select('last_applied_seq, engine_version, created_at')
        .eq('league_id', leagueId)
        .order('last_applied_seq', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) {
        snapshotMeta = {
          seq: Number(data.last_applied_seq),
          engineVersion: Number(data.engine_version),
          persistedAt: String(data.created_at),
        };
      }
    }

    structuredLogger.info('admin.endpoint.snapshot_forced', {
      userId,
      lobbyId,
      leagueId,
      outcome: 'success',
      seq: snapshotMeta.seq,
    });

    return ok(c, {
      lobbyId,
      scheduled: true,
      ...snapshotMeta,
    });
  });

  /**
   * POST /api/admin/engine/lobby/:lobbyId/evict
   *
   * Force-close every WebSocket connection on the lobby (close code
   * 4002 — "transient" per closeCodes.ts; clients reconnect and
   * re-bootstrap from durable state) and remove the lobby from the
   * registry. No data loss — `draft_events` is the source of truth;
   * the next client connect triggers fresh bootstrap.
   *
   * Returns 200 with `{ lobbyId, connectionsClosed, evictedAt }`.
   * 404 if lobby not in registry.
   */
  routes.post('/engine/lobby/:lobbyId/evict', async (c) => {
    const lobbyId = c.req.param('lobbyId');
    const userId = c.get('userId');

    const evictResult = registry.evict(lobbyId);
    if (evictResult === null) {
      structuredLogger.warn('admin.endpoint.lobby_evicted', {
        userId,
        lobbyId,
        outcome: 'lobby_not_in_registry',
      });
      return c.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: `Lobby ${lobbyId} is not in the engine registry`,
            lobbyId,
          },
        },
        404,
      );
    }

    const evictedAt = new Date().toISOString();
    structuredLogger.info('admin.endpoint.lobby_evicted', {
      userId,
      lobbyId,
      outcome: 'success',
      connectionsClosed: evictResult.connectionsClosed,
      evictedAt,
    });

    return ok(c, {
      lobbyId,
      connectionsClosed: evictResult.connectionsClosed,
      evictedAt,
    });
  });

  /**
   * GET /api/admin/engine/registry
   *
   * Returns the LobbyRegistry diagnostic view — array of
   * `{ lobbyId, leagueId, format, connectionCount, lastAppliedSeq }`
   * plus aggregates. Read-only; safe to poll.
   */
  routes.get('/engine/registry', async (c) => {
    const userId = c.get('userId');
    const summary = registry.getDiagnosticSummary();
    structuredLogger.info('admin.endpoint.registry_read', {
      userId,
      totalLobbies: summary.totalLobbies,
      totalConnections: summary.totalConnections,
    });
    return ok(c, {
      ...summary,
      capturedAt: new Date().toISOString(),
    });
  });

  return routes;
}
