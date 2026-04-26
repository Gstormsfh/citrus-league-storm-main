/**
 * Draft Engine v2 — events replay endpoint.
 * Spec §7.1, §7.4.
 *
 *   GET /api/draft/v2/league/:leagueId/events?since_seq=N&limit=500
 *
 * Returns events with seq > since_seq, ordered by seq ascending,
 * capped at 500 per response. Used by the v2 client when:
 *   - On reconnect, to replay events the client missed.
 *   - On detecting a broadcast gap (seq != lastSeq + 1).
 *   - As the steady-state catch-up when /sync's current_seq is ahead.
 *
 * Response (200):
 *   {
 *     events: DraftEventRow[],
 *     next_since_seq: bigint | null,
 *     league_state: 'not_started'|'pre_draft'|'active'|'paused'|'completed'|'cancelled'
 *   }
 *
 * Cache (spec §7.4): Cache-Control: public, max-age=86400, immutable
 * is set ONLY when league.draft_state IN ('completed','cancelled') —
 * those event ranges are immutable. Active drafts are explicitly
 * not cached.
 *
 * Rate limit (spec §7.4): 10 requests per 30-second sliding window
 * per (userId, leagueId). 11th request returns 429 with Retry-After.
 * In-memory token bucket; per-process is fine (Cloud Run session
 * affinity pins a misbehaving client to one instance).
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { membershipMiddleware } from '../middleware/membership';
import { createUserClient } from '../lib/supabase';
import { ok, handleError } from '../lib/responses';
import { AppError } from '../lib/errors';

const draftV2EventsRoutes = new Hono<Env>();

draftV2EventsRoutes.use('*', authMiddleware);

const QuerySchema = z.object({
  since_seq: z.coerce.number().int().nonnegative().default(0),
  limit:     z.coerce.number().int().min(1).max(500).default(500),
});

// ── In-memory rate-limiter ─────────────────────────────────────────────
// Spec §7.4: 10 req per 30s sliding window per (userId, leagueId).
// LRU-bounded so the map can't grow without limit.
//
// TODO(KI-003): per-instance state means the documented 10/30s rate
// is multiplied by Cloud Run instance count when session affinity is
// not enforced. See docs/RUNBOOKS/draft-engine-v2-known-issues.md#KI-003.
// Resolution: verify session affinity OR move to a shared store
// (Redis / Postgres-backed bucket). Phase 7 at the latest.

const RATE_WINDOW_MS = 30_000;
const RATE_MAX       = 10;
const RATE_LRU_MAX   = 5_000;

interface BucketEntry {
  /** Sorted ascending; oldest first. */
  timestamps: number[];
  /** Last-touched epoch ms — used for LRU eviction. */
  touched: number;
}

const buckets = new Map<string, BucketEntry>();

function rateLimitCheck(key: string): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const entry = buckets.get(key) ?? { timestamps: [], touched: now };
  // Drop timestamps older than the window.
  while (entry.timestamps.length > 0 && entry.timestamps[0] <= now - RATE_WINDOW_MS) {
    entry.timestamps.shift();
  }
  if (entry.timestamps.length >= RATE_MAX) {
    const retryAfterMs = entry.timestamps[0] + RATE_WINDOW_MS - now;
    entry.touched = now;
    buckets.set(key, entry);
    return { allowed: false, retryAfterMs: Math.max(0, retryAfterMs) };
  }
  entry.timestamps.push(now);
  entry.touched = now;
  buckets.set(key, entry);

  // LRU evict if bucket map is too large.
  if (buckets.size > RATE_LRU_MAX) {
    let oldestKey: string | null = null;
    let oldestTouched = Infinity;
    for (const [k, v] of buckets) {
      if (v.touched < oldestTouched) {
        oldestTouched = v.touched;
        oldestKey = k;
      }
    }
    if (oldestKey !== null) buckets.delete(oldestKey);
  }
  return { allowed: true, retryAfterMs: 0 };
}

// ── Route ──────────────────────────────────────────────────────────────

draftV2EventsRoutes.get(
  '/league/:leagueId/events',
  membershipMiddleware,
  async (c) => {
    const leagueId  = c.req.param('leagueId');
    const userId    = c.get('userId');
    const userToken = c.get('userToken');

    // Rate limit.
    const rl = rateLimitCheck(`${userId}:${leagueId}`);
    if (!rl.allowed) {
      const retryAfterSec = Math.max(1, Math.ceil(rl.retryAfterMs / 1000));
      c.header('Retry-After', String(retryAfterSec));
      return handleError(
        c,
        new AppError(
          `Rate limited: 10 requests per 30s per (user, league). Retry in ${retryAfterSec}s.`,
          429,
          'RATE_LIMITED',
        ),
        'Events replay rate limit exceeded',
      );
    }

    // Query param parsing.
    let parsed: z.infer<typeof QuerySchema>;
    try {
      parsed = QuerySchema.parse({
        since_seq: c.req.query('since_seq'),
        limit:     c.req.query('limit'),
      });
    } catch (err) {
      return handleError(
        c,
        new AppError(
          'invalid_event_payload: query validation failed',
          400,
          'VALIDATION_ERROR',
          err instanceof Error ? err.message : String(err),
        ),
        'Events query validation failed',
      );
    }

    // Read events under user-scoped client (RLS: members can SELECT).
    const supabase = createUserClient(userToken);

    try {
      // 1. League state — drives cache headers.
      const { data: league, error: leagueErr } = await supabase
        .from('leagues')
        .select('id, draft_state')
        .eq('id', leagueId)
        .single();
      if (leagueErr || !league) {
        throw new AppError('League not found', 404, 'NOT_FOUND');
      }

      // 2. Events page. Read one extra to know whether more remain.
      const fetchLimit = parsed.limit + 1;
      const { data: rows, error: eventsErr } = await supabase
        .from('draft_events')
        .select(
          'id, league_id, seq, event_type, event_version, payload, ' +
            'payload_hash, idempotency_key, actor, causation_id, ' +
            'correlation_id, created_at',
        )
        .eq('league_id', leagueId)
        .gt('seq', parsed.since_seq)
        .order('seq', { ascending: true })
        .limit(fetchLimit);

      if (eventsErr) {
        throw new AppError(
          'Failed to read draft_events',
          500,
          'INTERNAL_ERROR',
          eventsErr.message,
        );
      }

      const events = (rows ?? []) as unknown as Array<Record<string, unknown> & { seq: number }>;
      let nextSinceSeq: number | null = null;
      if (events.length === fetchLimit) {
        // We over-fetched by one to detect more pages; trim and set cursor.
        const last = events[parsed.limit - 1];
        nextSinceSeq = Number(last.seq);
        events.length = parsed.limit;
      }

      // 3. Cache headers (spec §7.4): immutable for completed/cancelled.
      const isImmutable =
        league.draft_state === 'completed' ||
        league.draft_state === 'cancelled';
      if (isImmutable) {
        c.header('Cache-Control', 'public, max-age=86400, immutable');
      } else {
        c.header('Cache-Control', 'no-store');
      }

      return ok(c, {
        events,
        next_since_seq: nextSinceSeq,
        league_state:   league.draft_state,
      });
    } catch (e) {
      return handleError(c, e, 'Failed to read draft events');
    }
  },
);

export { draftV2EventsRoutes };
