/**
 * Draft Engine v2 — era-check endpoint (E104 FENCE-2, 2026-08-11).
 *
 * GET /api/draft/v2/league/:leagueId/era
 *
 * Purpose. Answer "has this league had any v2-era ignition?" for the
 * client-side V1 fence (apps/web/src/pages/DraftRoom.tsx). Pre-E104
 * the fence probed `supabase.from('draft_events')` from the browser
 * via RLS; morning field verification (Entry 104) found the probe
 * silently returned 0 rows on session-restore race — the supabase-js
 * client's session wasn't attached when the probe fired on first
 * mount, so RLS refused. The fence then fell through to v1 for
 * every v2-era league in that window.
 *
 * Fix: probe the API server instead — service-role EXISTS on
 * draft_events, auth-only (no membership requirement — the fence
 * question is orthogonal to whether the caller can join the league).
 * Immune to client session-restore timing because the JWT is already
 * validated by authMiddleware before this handler runs.
 *
 * Request:
 *   GET (no body)
 *   Auth: standard authMiddleware (Bearer JWT). No membership check
 *         — a user visiting /draft-room?league=X for a league they
 *         don't belong to should still see the fence redirect them
 *         to /draft-v2/X if the league is v2-era; downstream
 *         membership gating happens on the v2 page itself.
 *
 * Response (success):
 *   200 { v2Era: boolean }
 *
 * Response (failure):
 *   400 { error: { code: 'BAD_REQUEST', message: ... } }  malformed UUID
 *   401 { error: { code: 'AUTHENTICATION_REQUIRED', ... } }  handled upstream
 *   500 { error: { code: 'SERVICE_UNAVAILABLE', ... } }  DB query failed
 *
 * Doctrine (INS-class docket): league-scoped truth checks belong
 * behind the API. Client-side supabase RLS reads during first mount
 * are session-restore race-prone. This endpoint plus its consumer
 * (useV1Fence) are the pattern for future fences.
 */
import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { getSupabaseAdmin } from '../lib/supabase';
import { structuredLogger } from '@citrus/shared';

const draftV2EraRoutes = new Hono<Env>();

draftV2EraRoutes.use('*', authMiddleware);

draftV2EraRoutes.get('/league/:leagueId/era', async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId') as string | undefined;

  // UUID shape guard — mirrors the discovery/snapshot routes'
  // pattern in drafts.ts:197.
  if (!leagueId || !/^[0-9a-f-]{36}$/i.test(leagueId)) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid leagueId' } },
      400,
    );
  }

  try {
    // Service-role EXISTS on draft_events. Bypasses RLS — the fence
    // needs an authoritative boolean, not an RLS-filtered view.
    // .limit(1) makes this a bounded existence probe (planner uses
    // an index-only scan on the primary key).
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('draft_events')
      .select('id')
      .eq('league_id', leagueId)
      .limit(1);

    if (error) {
      structuredLogger.error(
        'draftV2Era.probe_failed',
        { leagueId, userId },
        error,
      );
      return c.json(
        { error: { code: 'SERVICE_UNAVAILABLE', message: 'Era probe failed' } },
        500,
      );
    }

    const v2Era = Array.isArray(data) && data.length > 0;

    structuredLogger.debug('draftV2Era.probe_success', {
      leagueId,
      userId,
      v2Era,
    });

    return c.json({ v2Era });
  } catch (err) {
    structuredLogger.error(
      'draftV2Era.probe_threw',
      { leagueId, userId },
      err,
    );
    return c.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Era probe threw' } },
      500,
    );
  }
});

export { draftV2EraRoutes };
