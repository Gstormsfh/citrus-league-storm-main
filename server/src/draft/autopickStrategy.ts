// Phase 4.5 chunk 11g.4 step 6c — autopick player selection.
//
// **Chain-of-strategies architecture.** `selectAutopickPlayer` walks
// an ordered array of `AutopickStrategy` functions. Each strategy
// either returns a successful pick or signals "no eligible player,
// try next strategy." The first strategy to return `ok: true` wins.
//
// Today's chain ships with `[projectionsStrategy]` only — pick the
// highest-projected available player. When `team_draft_queues` lands
// (separate schema migration + UI work; tracked in
// `PHASE_4_5_PROJECT_PLAN.md` Decision Log 2026-05-05), adding
// `queueStrategy` to the front of the array is a single line of
// code rather than a refactor of the autopick entry point.
//
// The chain pattern matches industry-standard autopick design:
// Yahoo / ESPN / Sleeper all have a queue-first-then-projections
// fallback, and several add positional / roster-aware strategies
// further down the chain. Citrus's chain is forward-compatible with
// any of those without an entry-point refactor.

import type { SupabaseClient } from '@supabase/supabase-js';
import { structuredLogger, coerceToNumericPlayerId } from '@citrus/shared';

/** Input to every autopick strategy. */
export interface AutopickInput {
  leagueId: string;
  teamId: string;
  /**
   * Supabase client for read-only queries (player projections,
   * already-drafted player lookup). The engine's admin-client
   * path (`getSupabaseAdmin()`) is the canonical caller; user-
   * scoped clients also work because the projection table has
   * a "Public can view" RLS policy.
   */
  supabase: SupabaseClient;
}

/**
 * Result of a single strategy call. `ok: true` means the strategy
 * picked a player; `ok: false` means the strategy has no eligible
 * pick to suggest, and the chain should try the next strategy. The
 * top-level `selectAutopickPlayer` returns `{ ok: false, reason:
 * 'no_eligible_players' }` only when EVERY strategy in the chain
 * has returned `ok: false`.
 */
export type AutopickResult =
  | { ok: true; playerId: number; source: string }
  | { ok: false; reason: 'no_eligible_players' };

/**
 * Pluggable autopick strategy. Implements one selection heuristic
 * (queue, projections, positional, etc.). Returns `ok: true` with
 * a `playerId` and a human-readable `source` string used for logs
 * and audit, or `ok: false` to defer to the next strategy.
 */
export type AutopickStrategy = (input: AutopickInput) => Promise<AutopickResult>;

/**
 * Walk the strategy chain in order. First `ok: true` wins. If every
 * strategy returns `ok: false`, return `no_eligible_players` —
 * caller (`LobbyManager.handleAutopickTimeout`) treats this as a
 * stuck-draft condition and surfaces an error log for ops alerting
 * (chunk 11g.7).
 *
 * Strategies receive the same `input`; they're independent and
 * stateless. Adding strategies is a single-line array push at the
 * call site (or accept a custom array via the second parameter for
 * tests / commissioner overrides).
 */
export async function selectAutopickPlayer(
  input: AutopickInput,
  strategies: ReadonlyArray<AutopickStrategy> = DEFAULT_STRATEGIES,
): Promise<AutopickResult> {
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
 * not already drafted in this league. Reads `player_ros_projections`
 * sorted by `total_projected_points DESC` and walks until it finds
 * a player whose `player_id` is not in `draft_picks_v2` for the
 * league.
 *
 * Two-query approach (rather than a SQL JOIN) because Supabase JS
 * doesn't expose subqueries cleanly; for ~1000-player projection
 * tables this is acceptable. Chunk 11g.11 load test revisits if
 * the cost becomes user-visible.
 */
export const projectionsStrategy: AutopickStrategy = async ({
  leagueId,
  supabase,
}) => {
  // Step 1: load already-drafted player_ids for this league.
  const { data: draftedRows, error: draftedErr } = await supabase
    .from('draft_picks_v2')
    .select('player_id')
    .eq('league_id', leagueId);
  if (draftedErr) {
    structuredLogger.error(
      'autopick.projections.draft_picks_read_failed',
      { leagueId, message: draftedErr.message ?? null },
      draftedErr,
    );
    return { ok: false, reason: 'no_eligible_players' };
  }
  // KI-042 / task #61 (2026-08-08 T5): draft_picks.player_id is
  // mixed-domain (numeric NHL-id strings for real leagues, uuid
  // strings for demo leagues). Real-league autopick pathway
  // requires numeric-domain player_ids; demo-domain rows are
  // silently dropped from the drafted-set (never hits real-league
  // projections join). Uses shared coerceToNumericPlayerId
  // (packages/shared/src/utils/playerIdDomain.ts) — returns null
  // for uuid/invalid, real number for numeric.
  const draftedSet = new Set<number>();
  for (const r of (draftedRows ?? []) as Array<{ player_id: number | string }>) {
    const coerced = coerceToNumericPlayerId(r.player_id);
    if (coerced !== null) draftedSet.add(coerced);
  }

  // Step 2: load projections sorted desc; walk until we find an
  // undrafted player.
  const { data: projections, error: projErr } = await supabase
    .from('player_ros_projections')
    .select('player_id, total_projected_points')
    .order('total_projected_points', { ascending: false, nullsFirst: false });
  if (projErr) {
    structuredLogger.error(
      'autopick.projections.read_failed',
      { leagueId, message: projErr.message ?? null },
      projErr,
    );
    return { ok: false, reason: 'no_eligible_players' };
  }

  for (const row of (projections ?? []) as Array<{
    player_id: number;
    total_projected_points: number | null;
  }>) {
    if (!draftedSet.has(row.player_id)) {
      return { ok: true, playerId: row.player_id, source: 'projections' };
    }
  }

  // Every projected player is already drafted (or no projections
  // exist). Defer to the next strategy in the chain — today there
  // are no further strategies, so the chain returns
  // `no_eligible_players` to the caller.
  return { ok: false, reason: 'no_eligible_players' };
};

/**
 * Default chain shipped with chunk 11g.4 step 6c. Today: just
 * `projectionsStrategy`. Future enhancements (per
 * `PHASE_4_5_PROJECT_PLAN.md` Decision Log 2026-05-05):
 *   - `queueStrategy` (head of chain) — when `team_draft_queues`
 *     schema + UI ship, the user-defined per-team queue takes
 *     priority over projections.
 *   - `positionalStrategy` (tail) — roster-aware fallback that
 *     considers position needs after projections exhaust.
 */
export const DEFAULT_STRATEGIES: ReadonlyArray<AutopickStrategy> = [
  projectionsStrategy,
];
