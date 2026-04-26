/**
 * Draft Engine v2 — sync endpoint (Phase 1).
 *
 * GET /api/draft/v2/league/:leagueId/sync
 *
 * Returns a snapshot used for two purposes by the v2 client (spec §7):
 *   1. Multi-sample clock-sync handshake (spec §7.5): the client fires
 *      five of these on mount, computes RTT for each, and picks the
 *      sample with minimum RTT to derive its server-time offset.
 *   2. Steady-state poll every 5s (spec §7.6): the safety net that
 *      catches dropped realtime broadcasts.
 *
 * Response shape — spec §7.2:
 *   {
 *     server_time:         ISO 8601,
 *     pick_deadline:       ISO 8601 | null,
 *     current_seq:         bigint as number,
 *     current_pick_number: int,
 *     draft_state:         enum,
 *     payload_hash:        sha256 hex string | null
 *   }
 *
 * Phase 1 scope: this endpoint is read-only and works against an empty
 * draft_events table. `current_seq` falls back to `leagues.draft_event_counter`
 * (always 0 in Phase 1 since no RPCs have run yet); `current_pick_number`
 * is derived from the count of pick events (always 0 in Phase 1, so we
 * return 1 = "first pick is up next" by convention).
 *
 * Phase 2 lands the pick RPC; Phase 5 lands the v2 client that consumes
 * this endpoint. Phase 1 just proves the surface returns 200 and the
 * shape contract holds.
 */
import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { membershipMiddleware } from '../middleware/membership';
import { createUserClient } from '../lib/supabase';
import { ok, handleError } from '../lib/responses';
import { AppError } from '../lib/errors';

const draftV2Routes = new Hono<Env>();

draftV2Routes.use('*', authMiddleware);

draftV2Routes.get(
  '/league/:leagueId/sync',
  membershipMiddleware,
  async (c) => {
    const leagueId = c.req.param('leagueId');
    const supabase = createUserClient(c.get('userToken'));

    try {
      // 1. League row — pulls the v2 columns added in the Phase 1 migration.
      //    RLS allows members to SELECT (set via the comprehensive league
      //    RLS migrations); membership is already verified by middleware.
      const { data: league, error: leagueErr } = await supabase
        .from('leagues')
        .select(
          'id, pick_deadline, draft_state, draft_event_counter',
        )
        .eq('id', leagueId)
        .single();

      if (leagueErr || !league) {
        throw new AppError('League not found', 404, 'NOT_FOUND');
      }

      // 2. Latest event for payload_hash. In Phase 1 draft_events is empty,
      //    so this returns null and the response carries payload_hash:null.
      //    In later phases this is the freshness check the steady-state
      //    poll uses to decide whether to replay.
      const { data: latestEvent, error: latestErr } = await supabase
        .from('draft_events')
        .select('seq, payload_hash')
        .eq('league_id', leagueId)
        .order('seq', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestErr) {
        throw new AppError(
          'Failed to read latest draft event',
          500,
          'INTERNAL_ERROR',
          latestErr.message,
        );
      }

      // 3. current_pick_number is derived from pick events (spec §7.7
      //    invariant CI1: client never computes pick number from wall time).
      //    In Phase 1 this is always 0 → 1 ("first pick is up").
      const { count: pickCountRaw, error: countErr } = await supabase
        .from('draft_events')
        .select('id', { count: 'exact', head: true })
        .eq('league_id', leagueId)
        .eq('event_type', 'pick');

      if (countErr) {
        throw new AppError(
          'Failed to count pick events',
          500,
          'INTERNAL_ERROR',
          countErr.message,
        );
      }

      const pickCount = pickCountRaw ?? 0;

      // current_seq = latest seq we've observed for this league. Fall back
      // to the counter when no events exist (Phase 1 default).
      const currentSeq =
        latestEvent?.seq ?? league.draft_event_counter ?? 0;

      // Cache header: per spec §7.2, this snapshot is cacheable for ~100ms.
      // CDN-edge caching at sub-second is fine; clients re-poll every 5s
      // anyway. Setting max-age=0 + must-revalidate so intermediate proxies
      // can use ETag/If-None-Match without serving stale active drafts.
      c.header('Cache-Control', 'private, max-age=0, must-revalidate');

      return ok(c, {
        server_time: new Date().toISOString(),
        pick_deadline: league.pick_deadline ?? null,
        current_seq: Number(currentSeq),
        current_pick_number: pickCount + 1,
        draft_state: league.draft_state ?? 'not_started',
        payload_hash: latestEvent?.payload_hash ?? null,
      });
    } catch (e) {
      return handleError(c, e, 'Failed to fetch draft v2 sync snapshot');
    }
  },
);

export { draftV2Routes };
