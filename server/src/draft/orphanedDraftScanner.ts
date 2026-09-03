// Orphaned-draft scanner — the in-server replacement for the pgmq
// `safety_net` autopick path (chunk 11g.9, 2026-08-24).
//
// ── WHAT THIS REPLACES ──────────────────────────────────────────────
//
// Until this module landed, a blown pick deadline had a THIRD recovery
// path living outside the engine entirely:
//
//   draft_deadline_sweep (pg_cron, every 30s)
//     -> pgmq.send('draft_deadlines', {..., source: 'safety_net'})
//     -> draft-autopick-keepalive (pg_cron, every 2 min)
//       -> supabase/functions/draft-autopick (Deno Edge Function)
//         -> submit_pick_v2(actor.kind='autopick')
//
// That path was a SECOND, independent autopick implementation racing
// the engine's own. Migration 20260511010000 (chunk 11g.8) declared it
// vestigial per ADR-001 and said 11g.9 would delete it — but 11g.8 did
// NOT actually strip the `pgmq.send` from `draft_deadline_sweep`, so
// the path stayed live in production: 105 archived messages and a
// non-empty queue as of the 2026-08-24 audit.
//
// Deleting it outright would have been a real availability regression,
// because it was covering a genuine hole. This module closes that hole
// using the engine's OWN machinery, so autopick has exactly one
// implementation again.
//
// ── THE HOLE, PRECISELY ─────────────────────────────────────────────
//
// The engine already recovers blown deadlines in two places:
//
//   1. `LobbyRegistry.performBootScan` — at engine startup, getOrCreate
//      a lobby for every `draft_status='in_progress'` league. Covers
//      restart/redeploy. Runs ONCE.
//   2. `LobbyRegistry.scanClockLiveness` (F20 Piece 3) — periodic;
//      for each IN-REGISTRY lobby whose pick_deadline is stale, propose
//      `attemptClockRecovery`. Covers a stalled timer on a loaded lobby.
//
// Neither covers the residual case: a league that is still
// `in_progress` but has NO lobby in the registry, mid-run. Lobbies are
// created lazily on WS connect or on NOTIFY; `startIdleEvictionTimer`
// can evict a lobby whose clients have all disconnected. A draft whose
// managers all closed their tabs can therefore lose its lobby, and
// nothing re-creates it until a client reconnects or the engine
// restarts. Its clock stops. `scanClockLiveness` cannot see it —
// it only walks `this.lobbies`.
//
// That is exactly the window `source: 'safety_net'` was filling.
//
// ── WHAT THIS DOES ──────────────────────────────────────────────────
//
// Periodically: run performBootScan's query (in_progress leagues),
// diff it against the registry, and `getOrCreate` any league that has
// no lobby. That is the whole mechanism. Re-creating the lobby runs
// `init()`, which replays the event log, reads `leagues.pick_deadline`,
// and re-arms the timer — after which the ordinary engine autopick and
// `scanClockLiveness` take over.
//
// DESIGN NOTE — why this duplicates no logic. This module never picks a
// player, never calls `submit_pick_v2`, and never touches an
// idempotency key. It only ensures a lobby EXISTS. All pick selection
// stays in `autopickStrategy.ts` behind `LobbyManager`. That is the
// entire point: the pgmq worker was dangerous because it was a second
// implementation; a scanner that only reinstates lobbies cannot drift
// from the engine because it makes no decisions the engine also makes.
//
// SAFETY. Mirrors architect ruling 2 (2026-08-02) from the
// clock-liveness scanner: a top-level try/catch inside the
// setInterval callback so a scan error can never terminate the
// interval, and a per-league try/catch so one bad league cannot
// shield the rest.
//
// IDEMPOTENCY. `getOrCreate` is idempotent via its placeholder
// pattern, so racing a WS connect or a NOTIFY for the same league is
// safe — this is the same call both of those paths make.

import type { SupabaseClient } from '@supabase/supabase-js';
import { structuredLogger } from '@citrus/shared';
import { readAllPaged } from '../lib/pagedRead';
import type { LobbyRegistry } from './LobbyRegistry';

/**
 * How often to look for orphaned in-progress drafts.
 *
 * Default 60s. The old pgmq path had a worst-case detection latency of
 * 30s (sweep) + up to 120s (keepalive) = up to ~150s, so a 60s scan is
 * strictly faster to recover than what it replaces while staying far
 * cheaper than the 30s sweep cadence. `0` disables the scanner.
 */
const DEFAULT_SCAN_MS = 60_000;

/**
 * Grace period before an in-progress league with no lobby is treated
 * as orphaned.
 *
 * This exists to avoid racing league ignition: `draftV2Start` flips
 * `draft_status` to `in_progress` and the NOTIFY that creates the
 * lobby lands moments later. Without a grace window the scanner would
 * see that gap as an orphan and `getOrCreate` a lobby a heartbeat
 * before the NOTIFY path does. That is harmless (getOrCreate is
 * idempotent) but it produces noisy duplicate-looking logs during
 * every single draft start, which trains operators to ignore this
 * scanner's output — the exact failure mode F20 was about.
 */
const DEFAULT_GRACE_MS = 90_000;

export interface OrphanedDraftScannerOptions {
  registry: LobbyRegistry;
  supabaseAdmin: SupabaseClient;
  /** Scan cadence in ms. `0` disables. Defaults to ORPHAN_SCAN_MS env or 60s. */
  scanMs?: number;
  /** Ignition grace in ms. Defaults to ORPHAN_SCAN_GRACE_MS env or 90s. */
  graceMs?: number;
}

export interface OrphanScanResult {
  /** in_progress leagues seen by the query. */
  scanned: number;
  /** Leagues past the grace window with no lobby in the registry. */
  orphaned: number;
  /** Lobbies successfully re-created this pass. */
  adopted: number;
  /** Leagues whose getOrCreate threw. */
  failed: number;
}

function readEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Periodic scanner that reinstates lobbies for in-progress drafts the
 * registry has lost track of. Construct once at engine startup, call
 * `start()`, and call `stop()` from the graceful-shutdown path BEFORE
 * lobbies are torn down (so a late scan cannot re-adopt a lobby that
 * is already closing — same ordering requirement as
 * `stopClockLivenessScanner`).
 */
export class OrphanedDraftScanner {
  private readonly registry: LobbyRegistry;
  private readonly supabaseAdmin: SupabaseClient;
  private readonly scanMs: number;
  private readonly graceMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  /**
   * Leagues seen orphaned but still inside the grace window, with the
   * timestamp of first sighting. An entry graduates to a real adoption
   * only once `graceMs` has elapsed since we FIRST saw it missing —
   * this is what makes the grace window a property of the league's
   * observed absence rather than of `pick_deadline`, which may be null
   * on a freshly-ignited draft.
   */
  private readonly firstSeenMissing = new Map<string, number>();

  constructor(opts: OrphanedDraftScannerOptions) {
    this.registry = opts.registry;
    this.supabaseAdmin = opts.supabaseAdmin;
    this.scanMs = opts.scanMs ?? readEnvInt('ORPHAN_SCAN_MS', DEFAULT_SCAN_MS);
    this.graceMs =
      opts.graceMs ?? readEnvInt('ORPHAN_SCAN_GRACE_MS', DEFAULT_GRACE_MS);
  }

  /** Idempotent — a second call is a no-op. */
  start(): void {
    if (this.timer !== null) return;
    if (this.scanMs <= 0) {
      structuredLogger.info('registry.orphan_scanner_disabled', {
        scanMs: this.scanMs,
      });
      return;
    }
    this.timer = setInterval(() => {
      // Top-level catch: unkillable, per architect ruling 2. A scan
      // that throws must not stop the interval — a watchdog that dies
      // silently is worse than no watchdog, because it reads as
      // coverage.
      void this.scan().catch((err: unknown) => {
        structuredLogger.error('registry.orphan_scan_threw', {
          err: err instanceof Error ? err.message : String(err),
        });
      });
    }, this.scanMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    structuredLogger.info('registry.orphan_scanner_started', {
      scanMs: this.scanMs,
      graceMs: this.graceMs,
    });
  }

  /** Idempotent. Call before tearing lobbies down on shutdown. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      this.firstSeenMissing.clear();
      structuredLogger.info('registry.orphan_scanner_stopped', {});
    }
  }

  /**
   * Single scan pass. Public for tests + admin diagnostics, matching
   * `scanClockLiveness`'s shape.
   */
  async scan(): Promise<OrphanScanResult> {
    const result: OrphanScanResult = {
      scanned: 0,
      orphaned: 0,
      adopted: 0,
      failed: 0,
    };

    // PAGED (2026-09-03), for the same reason performBootScan is:
    // PostgREST clamps an unbounded select at `db-max-rows` (1,000
    // here) and returns HTTP 200 with a short body. This scanner is
    // the LAST line of defence for a draft whose lobby was evicted -
    // if its league falls outside the clamp window it is never
    // adopted, its clock stays stopped, and `result.scanned` reads
    // 1000 forever while the real number climbs. A watchdog that
    // silently stops covering the tail of its own population is
    // exactly the F20 failure mode this module was written against.
    // `orderBy: ['id']` is the primary key - the paging contract
    // requires a sort that is unique per row.
    //
    // Filter unchanged: query only `draft_status='in_progress'` -
    // `paused` is NOT a member of the draft_status enum (pause lives
    // on leagues.draft_state), and a .in() list containing a
    // non-member literal is rejected whole with 22P02, silently
    // returning zero rows.
    const { data: rows, error } = await readAllPaged<{ id: string }>(
      this.supabaseAdmin,
      {
        table: 'leagues',
        columns: 'id',
        filters: [['draft_status', 'in_progress']],
        orderBy: ['id'],
      },
    );

    if (error) {
      structuredLogger.error('registry.orphan_scan_query_failed', {}, error);
      return result;
    }

    result.scanned = rows.length;
    const now = Date.now();
    const liveLeagueIds = new Set<string>();

    for (const row of rows) {
      const leagueId = row.id;
      liveLeagueIds.add(leagueId);

      try {
        // Lobby id is the league id in the v2 engine — same identity
        // `performBootScan` and the NOTIFY dispatch both use.
        if (this.registry.get(leagueId) !== undefined) {
          // Present: clear any pending grace entry. scanClockLiveness
          // owns this lobby's staleness from here.
          this.firstSeenMissing.delete(leagueId);
          continue;
        }

        const firstSeen = this.firstSeenMissing.get(leagueId);
        if (firstSeen === undefined) {
          this.firstSeenMissing.set(leagueId, now);
          continue;
        }
        if (now - firstSeen < this.graceMs) {
          // Still inside the ignition grace window — a NOTIFY or a WS
          // connect is very likely about to create this lobby.
          continue;
        }

        result.orphaned += 1;
        structuredLogger.warn('registry.orphan_detected', {
          leagueId,
          missingForMs: now - firstSeen,
          graceMs: this.graceMs,
        });

        await this.registry.getOrCreate(leagueId, leagueId);
        this.firstSeenMissing.delete(leagueId);
        result.adopted += 1;

        // Alertable: reaching here means a live draft's clock was
        // stopped and only this scanner restarted it. That is the
        // failure the pgmq safety_net used to absorb invisibly. It
        // should be loud now, because each occurrence is a real
        // eviction-vs-liveness bug worth chasing upstream rather
        // than a routine event.
        structuredLogger.error('registry.orphan_adopted', {
          leagueId,
          missingForMs: now - firstSeen,
          alertable: true,
        });
      } catch (err: unknown) {
        // Per-league catch: one broken league cannot shield the rest.
        result.failed += 1;
        structuredLogger.error('registry.orphan_adopt_failed', {
          leagueId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Hygiene: drop grace entries for leagues that are no longer
    // in_progress (draft completed, or league deleted) so the map
    // cannot leak across a long-lived engine process. Same one-liner
    // discipline as the clock-liveness strike-map prune.
    for (const leagueId of Array.from(this.firstSeenMissing.keys())) {
      if (!liveLeagueIds.has(leagueId)) this.firstSeenMissing.delete(leagueId);
    }

    if (result.orphaned > 0 || result.failed > 0) {
      structuredLogger.info('registry.orphan_scan_completed', { ...result });
    } else {
      structuredLogger.debug('registry.orphan_scan_completed', { ...result });
    }
    return result;
  }
}
