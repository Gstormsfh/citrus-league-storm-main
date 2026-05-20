// Phase 4.5 chunk 11g.10 sub-step 10b — engine-ops admin endpoints.
//
// Distinct from server/src/routes/admin.ts (which is the user-facing
// admin dashboard — user/league management, recalculate scores, audit
// log). This file owns the engine-process-specific operational levers
// referenced by:
//
//   - docs/RUNBOOKS/draft-engine-v2-operations.md §2.3 (per-lobby
//     eviction for wedged state) + §6.5 (force-snapshot).
//   - docs/RUNBOOKS/draft-engine-v2-rollback-playbook.md (scenario
//     verification + diagnostic).
//
// Auth model (per PROJECT_PLAN.md Decision Log 2026-05-19): JWT +
// `is_engine_admin` profile flag (separable from `is_admin`). Garrett
// gets `is_engine_admin` for free via the
// 20260520010000_add_profiles_is_engine_admin.sql backfill.
//
// **Important architectural note.** These endpoints are mounted in the
// MAIN API server (server/src/app.ts), NOT the persistent engine
// process. Why: the main API already has the auth middleware pipeline
// (JWT validation, is_admin / is_engine_admin lookups via the user-
// scoped Supabase client). The engine process has no HTTP framework
// for protected admin routes today; adding one would duplicate the
// auth layer.
//
// The endpoints invoke engine state via cross-process mechanisms:
//   - `force-snapshot`: writes a row to `engine_admin_commands` (a
//     future surface — see TODO below) OR sends an HTTP request to
//     the engine's admin port. For 10b, we ship the engine-side
//     primitive (callable via the engine's own internal HTTP route);
//     the main-API-side delegate is deferred to a follow-up.
//   - For now, all three endpoints return 501 Not Implemented with a
//     descriptive body pointing the operator at the manual SQL/SSH
//     equivalent.
//
// 10b's role: establish the surface, the auth model, and the contract.
// 10c/10d will wire the cross-process delegate as their perf-harness
// and monitoring needs surface.

import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { supabaseAdmin } from '../lib/supabase';
import { AppError } from '../lib/errors';
import { ok, fail } from '../lib/responses';

const draftAdminRoutes = new Hono<Env>();

draftAdminRoutes.use('*', authMiddleware);

/**
 * Engine-admin auth middleware — checks `is_engine_admin` on profile.
 * Mirrors the `is_admin` pattern from server/src/routes/admin.ts but
 * uses the separable flag. A user can be engine-admin without being
 * is_admin (rare today since the migration backfills from is_admin,
 * but the namespace separation is the point).
 */
draftAdminRoutes.use('*', async (c, next) => {
  const userId = c.get('userId');

  if (!supabaseAdmin) {
    return fail(c, AppError.serviceUnavailable('Admin client not configured'));
  }

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
 * POST /api/admin/engine/lobby/:lobbyId/snapshot
 *
 * Force a synchronous snapshot persistence for the named lobby.
 * Useful for: capturing state before manual investigation; pre-restart
 * snapshot for clean bootstrap; clean-slate measurement in 10c perf
 * harness.
 *
 * Status: scaffolded. Engine-side primitive lands in this commit; the
 * cross-process delegate (main API → engine HTTP/RPC) is a follow-up.
 * Returns 501 until the delegate is wired.
 */
draftAdminRoutes.post('/engine/lobby/:lobbyId/snapshot', async (c) => {
  const lobbyId = c.req.param('lobbyId');
  return c.json(
    {
      error: {
        code: 'NOT_IMPLEMENTED',
        message:
          'Force-snapshot endpoint scaffolded but cross-process delegate not yet wired. ' +
          'Manual equivalent: SSH to the engine VM and trigger via process signal or ' +
          'restart (engine writes a snapshot at clean shutdown). See operations runbook ' +
          '§6.5. Wiring tracked for 10c/10d follow-up.',
        lobbyId,
      },
    },
    501,
  );
});

/**
 * POST /api/admin/engine/lobby/:lobbyId/evict
 *
 * Remove the lobby from the engine's LobbyRegistry. The next WS
 * reconnect from any client of this lobby will trigger fresh bootstrap
 * from durable state. Safe — no data loss (draft_events is the source
 * of truth).
 *
 * Status: scaffolded. Same posture as force-snapshot.
 */
draftAdminRoutes.post('/engine/lobby/:lobbyId/evict', async (c) => {
  const lobbyId = c.req.param('lobbyId');
  return c.json(
    {
      error: {
        code: 'NOT_IMPLEMENTED',
        message:
          'Per-lobby eviction endpoint scaffolded but cross-process delegate not yet wired. ' +
          'Manual equivalent: restart the engine via `sudo systemctl restart citrus-draft-engine` ' +
          '(heavier than per-lobby eviction; restarts all lobbies, but safe). ' +
          'See operations runbook §2.3. Wiring tracked for 10c/10d follow-up.',
        lobbyId,
      },
    },
    501,
  );
});

/**
 * GET /api/admin/engine/registry
 *
 * Returns the current LobbyRegistry contents — diagnostic view of
 * what's loaded in engine memory. Read-only.
 *
 * Status: scaffolded. Same posture.
 */
draftAdminRoutes.get('/engine/registry', async (c) => {
  return c.json(
    {
      error: {
        code: 'NOT_IMPLEMENTED',
        message:
          'Engine registry diagnostic endpoint scaffolded but cross-process read not yet wired. ' +
          'Manual equivalent: read engine logs (`registry.lobby_added` / `registry.lobby_removed`) ' +
          'or query `draft_events` for `in_progress` leagues. Wiring tracked for 10c/10d follow-up.',
      },
    },
    501,
  );
});

/**
 * Pseudo-utility endpoint: status check that auth + middleware are
 * wired correctly. Returns 200 with `{ engineAdmin: true, userId }`
 * if the request passes the middleware. Useful for verifying the
 * middleware chain without invoking a NOT_IMPLEMENTED endpoint.
 */
draftAdminRoutes.get('/engine/whoami', async (c) => {
  return ok(c, {
    engineAdmin: true,
    userId: c.get('userId'),
    timestamp: new Date().toISOString(),
  });
});

export { draftAdminRoutes };
