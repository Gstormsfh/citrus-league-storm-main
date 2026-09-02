// Phase 4.5 chunk 11g.6 sub-step 6c3 — auction auto-nominate
// player selection.
//
// **Chain-of-strategies architecture** mirroring chunk 11g.4 step 6c
// `autopickStrategy.ts` exactly. `selectAuctionAutoNominate` walks
// an ordered array of `AuctionAutoNominateStrategy` functions; each
// either returns a successful nomination or signals "no eligible
// player, try next strategy." First strategy to return `ok: true`
// wins.
//
// Today's chain ships with `[projectionsAuctionStrategy]` only — pick
// the highest-projected player not already drafted in this league
// (regardless of nomination status — sold, no_sale, or pending bid
// closure). When `team_draft_queues` lands (separate schema migration
// + UI work; chunk 11g.4 step 6c Decision Log 2026-05-05 tracks this),
// adding `queueAuctionStrategy` to the front is a single-line change.
// Commissioner-preset strategy is a future enhancement (no schema
// today).
//
// Differences from snake/linear `autopickStrategy.ts`:
//   - Player ID type: auction uses TEXT (`auction_nominations.player_id`)
//     whereas snake/linear uses int (`draft_picks_v2.player_id`). The
//     strategy returns `playerId: string` — engine threads through
//     to `nominate_player_v2`'s `p_player_id text` parameter.
//   - Drafted-set source: query `auction_nominations` (any status —
//     'active' / 'sold' / 'no_sale') OR final `draft_picks` rows.
//     For 6c3 simplicity, query both and union; revisit if a single
//     canonical source emerges.
//   - Opening bid: strategy returns the suggested opening bid. Today
//     this is fixed at the league's `auctionMinBid` (the floor). A
//     future strategy could bid higher (e.g., projection-weighted)
//     but that's an extension.
//
// Per ADR-002 §3.4 + §4.2.

import type { SupabaseClient } from '@supabase/supabase-js';
import { structuredLogger, getProjectionsSeason } from '@citrus/shared';
import { readAllPaged } from '../lib/pagedRead';

/** Input to every auction auto-nominate strategy. */
export interface AuctionAutoNominateInput {
  leagueId: string;
  /**
   * Team that is currently on the clock (auto-nominator). Strategies
   * receive this in case future strategies are team-aware (queue
   * lookup, budget-aware tiered bidding, etc.). The
   * `projectionsAuctionStrategy` doesn't use it today.
   */
  teamId: string;
  /**
   * League's `auctionMinBid` setting. Default opening bid for engine
   * strategies; future strategies could bid higher.
   */
  auctionMinBid: number;
  /**
   * Supabase client for read-only queries (player projections,
   * already-nominated player lookup). The engine's admin-client
   * path (`getSupabaseAdmin()`) is the canonical caller; user-
   * scoped clients also work because the projection table has a
   * "Public can view" RLS policy.
   */
  supabase: SupabaseClient;
}

/**
 * Result of a single strategy call. `ok: true` means the strategy
 * picked a player + opening bid; `ok: false` means try the next
 * strategy. Top-level `selectAuctionAutoNominate` returns
 * `{ ok: false, reason: 'no_eligible_players' }` only when EVERY
 * strategy returns `ok: false` (per ADR-002 §4.4 this triggers
 * pause-and-alert in the engine — a Path X spec-conformant response).
 */
export type AuctionAutoNominateResult =
  | {
      ok: true;
      playerId: string;
      openingBid: number;
      source: 'queue' | 'projections' | 'commissioner_preset';
    }
  | { ok: false; reason: 'no_eligible_players' };

/**
 * Pluggable auction auto-nominate strategy. Implements one selection
 * heuristic. Returns `ok: true` with a `playerId`/`openingBid`/`source`
 * triple, or `ok: false` to defer to the next strategy.
 */
export type AuctionAutoNominateStrategy = (
  input: AuctionAutoNominateInput,
) => Promise<AuctionAutoNominateResult>;

/**
 * Walk the strategy chain in order. First `ok: true` wins. If every
 * strategy returns `ok: false`, return `'no_eligible_players'` —
 * engine treats this as the ADR-002 §4.4 spec-conformant pause-and-
 * alert path.
 */
export async function selectAuctionAutoNominate(
  input: AuctionAutoNominateInput,
  strategies: ReadonlyArray<AuctionAutoNominateStrategy> = DEFAULT_AUCTION_STRATEGIES,
): Promise<AuctionAutoNominateResult> {
  for (const strategy of strategies) {
    const result = await strategy(input);
    if (result.ok) {
      return result;
    }
  }
  return { ok: false, reason: 'no_eligible_players' };
}

/**
 * Projections strategy: pick the highest-projected player who is
 * not already drafted (won via auction) AND not currently nominated
 * (active / sold / no_sale row in `auction_nominations`).
 *
 * Two-query approach (load drafted-set + scan projections). Mirrors
 * snake/linear `projectionsStrategy` shape. For ~1000-player
 * projection tables this is fast enough; chunk 11g.11 load test
 * revisits if cost becomes user-visible.
 */
export const projectionsAuctionStrategy: AuctionAutoNominateStrategy = async ({
  leagueId,
  auctionMinBid,
  supabase,
}) => {
  // Step 1: load player_ids that are already nominated (any status —
  // sold means drafted, active means in-progress, no_sale means
  // skipped but the engine still considers them "consumed" for the
  // current draft to avoid re-nominating).
  //
  // Note: auction_nominations.player_id is TEXT (auction's NHL ID
  // format); we keep them as strings throughout the strategy since
  // `nominate_player_v2.p_player_id` is also TEXT.
  const { data: nomRows, error: nomErr } = await supabase
    .from('auction_nominations')
    .select('player_id')
    .eq('league_id', leagueId);
  if (nomErr) {
    structuredLogger.error(
      'auction.autonominate.nominations_read_failed',
      { leagueId, message: nomErr.message ?? null },
      nomErr,
    );
    return { ok: false, reason: 'no_eligible_players' };
  }
  const consumedSet = new Set<string>(
    (nomRows ?? []).map((r: { player_id: string }) => String(r.player_id)),
  );

  // Step 2: load projections sorted desc; tiebreaker `player_id ASC`
  // for determinism (snake/linear `projectionsStrategy` doesn't
  // explicitly tiebreak, but auction wants determinism for
  // reproducible bootstrap behavior).
  //
  // PAGED (2026-09-02 scale audit). This read was a single unbounded
  // `.select()`. PostgREST clamps every response at `db-max-rows`
  // (1,000 on this project) and returns HTTP 200 with a short body and
  // no error — the exact defect `autopickStrategy.ts` documents at
  // length under AUTOPICK-TRUNCATION and AUTOPICK-TRUNCATION-2, twice,
  // on this same table. `player_ros_projections` already exceeds the
  // clamp (1,055 rows for the projections season), and the note in the
  // sibling file spells out why this matters on a DRAFT BOARD
  // specifically: refresh projections from prod (1,361 rows) and the
  // board silently loses the overflow.
  //
  // Ordering here is by projected points DESC, so today's dropped rows
  // are the least valuable players and the nomination this returns is
  // unlikely to change. That is luck, not design — it holds only while
  // fewer than 1,000 players have been consumed, and it stops holding
  // the moment the sort key or the strategy chain changes. Paging costs
  // one extra round trip on a table that is 55 rows over the clamp and
  // removes the trap.
  //
  // The cheaper alternative — `.limit(consumedSet.size + 1)`, valid
  // because the first un-consumed row in this order is always the
  // answer — is deliberately NOT taken: it couples the read to the
  // strategy's current single-pass shape, and a second strategy in the
  // chain would silently reintroduce truncation. Deferred with the
  // per-lobby memoisation of this board (see
  // docs/PERFORMANCE_AND_SCALE_2026-09-02.md).
  const { data: projections, error: projErr } = await readAllPaged<{
    player_id: number | string;
    total_projected_points: number | null;
  }>(supabase, {
    table: 'player_ros_projections',
    columns: 'player_id, total_projected_points',
    // Season-sweep 2026-08-24: see autopickStrategy — never mix seasons.
    filters: [['season', getProjectionsSeason()]],
    // `player_id` is unique per row for a season and is the ONLY safe
    // page key: paging on `total_projected_points` would overlap and
    // skip across windows wherever two players share a projection.
    // Points ordering is re-applied in memory below.
    orderBy: ['player_id'],
  });
  if (projErr) {
    structuredLogger.error(
      'auction.autonominate.projections_read_failed',
      { leagueId, message: projErr.message ?? null },
      projErr,
    );
    return { ok: false, reason: 'no_eligible_players' };
  }

  // Re-apply the board's sort in memory. The read above pages on
  // `player_id` (the only unique key), so the DESC-by-points ordering
  // that used to come from PostgREST has to be restored here. This
  // reproduces `order('total_projected_points', {ascending:false,
  // nullsFirst:false}).order('player_id', {ascending:true})` exactly:
  // points descending, NULLs last, `player_id` ascending as the
  // deterministic tiebreaker the strategy relies on for reproducible
  // bootstrap behaviour.
  const board = [...(projections ?? [])].sort((a, b) => {
    const av = a.total_projected_points;
    const bv = b.total_projected_points;
    const aNull = av === null || av === undefined;
    const bNull = bv === null || bv === undefined;
    if (aNull !== bNull) return aNull ? 1 : -1; // nulls last
    if (!aNull && !bNull && av !== bv) return (bv as number) - (av as number);
    return Number(a.player_id) - Number(b.player_id);
  });

  for (const row of board) {
    const pidStr = String(row.player_id);
    if (!consumedSet.has(pidStr)) {
      return {
        ok: true,
        playerId: pidStr,
        openingBid: auctionMinBid,
        source: 'projections',
      };
    }
  }

  // Every projected player is already nominated/won. Defer to the
  // next strategy in the chain — today there are no further
  // strategies, so the chain returns 'no_eligible_players'.
  return { ok: false, reason: 'no_eligible_players' };
};

/**
 * Default chain shipped with chunk 11g.6 sub-step 6c3. Today: just
 * `projectionsAuctionStrategy`. Future enhancements:
 *   - `queueAuctionStrategy` (head of chain) — when
 *     `team_draft_queues` ships.
 *   - `commissionerPresetAuctionStrategy` (tail) — per-team
 *     fallback player set during draft setup. ADR-002 §4.2 step 3.
 *     No schema today.
 */
export const DEFAULT_AUCTION_STRATEGIES: ReadonlyArray<AuctionAutoNominateStrategy> = [
  projectionsAuctionStrategy,
];
