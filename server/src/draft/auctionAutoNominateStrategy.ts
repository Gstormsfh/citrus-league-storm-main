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
import { structuredLogger } from '@citrus/shared';

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
  const { data: projections, error: projErr } = await supabase
    .from('player_ros_projections')
    .select('player_id, total_projected_points')
    .order('total_projected_points', { ascending: false, nullsFirst: false })
    .order('player_id', { ascending: true });
  if (projErr) {
    structuredLogger.error(
      'auction.autonominate.projections_read_failed',
      { leagueId, message: projErr.message ?? null },
      projErr,
    );
    return { ok: false, reason: 'no_eligible_players' };
  }

  for (const row of (projections ?? []) as Array<{
    player_id: number | string;
    total_projected_points: number | null;
  }>) {
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
