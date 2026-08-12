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

/**
 * Prior season used as the durability/role signal for draft value
 * (E117). Bumped when the pipeline's canonical season advances.
 */
const DRAFT_VALUE_REFERENCE_SEASON = 2025;

/** Games assumed for a player with no prior-season row (rookies). */
const DEFAULT_EXPECTED_GAMES = 55;

/** Hard cap — an NHL regular season is 82 games. */
const MAX_SEASON_GAMES = 82;

/**
 * Roster-shape caps used when a league has not configured its own
 * `settings.rosterSlots` (E118). Mirrors DEFAULT_ROSTER_SLOTS in
 * packages/shared, collapsed to the positions a drafted player can
 * actually occupy. UTIL/BN/IR are intentionally excluded from the
 * per-position ceiling: they are flex seats, and counting them as
 * position caps would let a roster fill with one position anyway.
 * The ceiling below is "starting slots + flex headroom", chosen so
 * the guard shapes an absent manager's roster without ever making
 * the draft unable to proceed.
 */
const DEFAULT_POSITION_CAPS: Readonly<Record<string, number>> = {
  C: 4,
  LW: 4,
  RW: 4,
  D: 6,
  G: 2,
};

/**
 * Positions the guard understands. Anything a player maps to outside
 * this set is uncapped (defensive: a future position code must never
 * make autopick refuse to pick).
 */
const CAPPED_POSITIONS = Object.keys(DEFAULT_POSITION_CAPS);

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
/**
 * Map a directory position code onto the guard's vocabulary
 * (E118). Returns null when the code is absent or unrecognised —
 * callers treat null as "uncapped", never as "ineligible".
 */
function normalizePosition(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  if (code.length === 0) return null;
  // Directory codes are already C/LW/RW/D/G; take the first token of
  // any multi-position string (e.g. "LW/RW") as the primary.
  const primary = code.split(/[\/,\s]+/)[0];
  return CAPPED_POSITIONS.includes(primary) ? primary : null;
}

export const projectionsStrategy: AutopickStrategy = async ({
  leagueId,
  teamId,
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

  // Step 2: DRAFT-VALUE ranking (E117, 2026-08-12).
  //
  // WHY NOT `total_projected_points`: that column is
  // `avg_points_per_game * games_remaining`, and `games_remaining`
  // is a REST-OF-SEASON figure — in the preseason window every
  // player carries the same tiny value (3 at time of writing), so
  // ordering by it collapses to ordering by PER-GAME rate. Per-game
  // rate structurally overrates low-volume players, and goalies
  // most of all: a backup's per-game output resembles a starter's
  // while he plays a third of the games. Field evidence (staging,
  // 2026-08-11): the top-12 autopick board contained FOUR goalies,
  // including two AHL/prospect-tier keepers — Scott Wedgewood would
  // have gone 5th overall in a real draft.
  //
  // WHAT WE RANK BY INSTEAD: expected SEASON value =
  //   avg_points_per_game * expected_games
  // where `expected_games` is last season's games played (capped at
  // a full 82-game season) — the cheapest available durability +
  // role signal, and the one that separates starters from backups.
  // Players with no prior-season row fall back to
  // DEFAULT_EXPECTED_GAMES so rookies are ranked, never zeroed.
  //
  // This reads the SAME projections table (no new schema, no
  // dependency on the projections pipeline's internals) plus one
  // additional read of prior-season games played.
  const { data: projections, error: projErr } = await supabase
    .from('player_ros_projections')
    .select('player_id, avg_points_per_game, total_projected_points');
  if (projErr) {
    structuredLogger.error(
      'autopick.projections.read_failed',
      { leagueId, message: projErr.message ?? null },
      projErr,
    );
    return { ok: false, reason: 'no_eligible_players' };
  }

  const { data: seasonRows, error: seasonErr } = await supabase
    .from('player_season_stats')
    .select('player_id, games_played, season')
    .eq('season', DRAFT_VALUE_REFERENCE_SEASON);
  if (seasonErr) {
    // Non-fatal: fall back to DEFAULT_EXPECTED_GAMES for everyone,
    // which degrades to per-game ordering — the pre-E117 behaviour.
    // Logged loudly because it silently changes board quality.
    structuredLogger.warn('autopick.draft_value.season_stats_read_failed', {
      leagueId,
      message: seasonErr.message ?? null,
    });
  }

  const gamesByPlayer = new Map<number, number>();
  for (const row of (seasonRows ?? []) as Array<{
    player_id: number;
    games_played: number | null;
  }>) {
    if (typeof row.games_played === 'number' && row.games_played > 0) {
      gamesByPlayer.set(row.player_id, row.games_played);
    }
  }

  // Step 2b: ROSTER-SHAPE GUARD (E118, 2026-08-12).
  //
  // Value ranking alone will happily hand one absent manager twelve
  // goalies — the board is position-blind, so a team that misses
  // every pick ends up with a roster it cannot ice. Real platforms
  // shape the autopick to the roster; so do we.
  //
  // Sources, in order of authority:
  //   1. `leagues.settings.rosterSlots` (per-league config, if set)
  //   2. DEFAULT_POSITION_CAPS (mirrors packages/shared defaults)
  // A position with no entry in either is UNCAPPED — the guard can
  // shape a roster but must never be the reason a draft stalls.
  let positionCaps: Record<string, number> = { ...DEFAULT_POSITION_CAPS };
  {
    const { data: leagueRow, error: leagueErr } = await supabase
      .from('leagues')
      .select('settings')
      .eq('id', leagueId)
      .maybeSingle();
    if (leagueErr) {
      structuredLogger.warn('autopick.roster_guard.league_read_failed', {
        leagueId,
        message: leagueErr.message ?? null,
      });
    } else {
      const configured = (
        leagueRow as { settings?: { rosterSlots?: Record<string, number> } } | null
      )?.settings?.rosterSlots;
      if (configured && typeof configured === 'object') {
        const merged: Record<string, number> = {};
        for (const [slot, count] of Object.entries(configured)) {
          const n = Number(count);
          if (Number.isFinite(n) && n > 0) merged[slot.toUpperCase()] = n;
        }
        // Only positions the guard understands act as caps; flex
        // seats (UTIL/BN/IR) are deliberately not position ceilings.
        const filtered: Record<string, number> = {};
        for (const slot of CAPPED_POSITIONS) {
          if (merged[slot] !== undefined) filtered[slot] = merged[slot];
        }
        if (Object.keys(filtered).length > 0) positionCaps = filtered;
      }
    }
  }

  // Count what THIS team already holds, by position.
  const teamCounts = new Map<string, number>();
  {
    const { data: teamPicks, error: teamErr } = await supabase
      .from('draft_picks_v2')
      .select('player_id')
      .eq('league_id', leagueId)
      .eq('team_id', teamId);
    if (teamErr) {
      structuredLogger.warn('autopick.roster_guard.team_picks_read_failed', {
        leagueId,
        teamId,
        message: teamErr.message ?? null,
      });
    } else {
      const ownedIds = ((teamPicks ?? []) as Array<{ player_id: number | string }>)
        .map((r) => coerceToNumericPlayerId(r.player_id))
        .filter((id): id is number => id !== null);
      if (ownedIds.length > 0) {
        const { data: ownedRows, error: ownedErr } = await supabase
          .from('player_directory')
          .select('player_id, position_code')
          .in('player_id', ownedIds);
        if (ownedErr) {
          structuredLogger.warn('autopick.roster_guard.owned_positions_read_failed', {
            leagueId,
            teamId,
            message: ownedErr.message ?? null,
          });
        } else {
          for (const row of (ownedRows ?? []) as Array<{
            position_code: string | null;
          }>) {
            const pos = normalizePosition(row.position_code);
            if (pos) teamCounts.set(pos, (teamCounts.get(pos) ?? 0) + 1);
          }
        }
      }
    }
  }

  // Positions of every candidate on the board (one read; the board is
  // ~1000 rows and this is a covered index lookup).
  const positionByPlayer = new Map<number, string>();
  {
    const { data: dirRows, error: dirErr } = await supabase
      .from('player_directory')
      .select('player_id, position_code');
    if (dirErr) {
      structuredLogger.warn('autopick.roster_guard.directory_read_failed', {
        leagueId,
        message: dirErr.message ?? null,
      });
    } else {
      for (const row of (dirRows ?? []) as Array<{
        player_id: number;
        position_code: string | null;
      }>) {
        const pos = normalizePosition(row.position_code);
        if (pos) positionByPlayer.set(row.player_id, pos);
      }
    }
  }

  const board = ((projections ?? []) as Array<{
    player_id: number;
    avg_points_per_game: number | string | null;
    total_projected_points: number | string | null;
  }>)
    .map((row) => {
      const ppg = Number(row.avg_points_per_game ?? 0);
      const expectedGames = Math.min(
        gamesByPlayer.get(row.player_id) ?? DEFAULT_EXPECTED_GAMES,
        MAX_SEASON_GAMES,
      );
      // Fall back to the legacy column when per-game data is absent
      // so a partially-populated projections table still ranks.
      const value = Number.isFinite(ppg) && ppg > 0
        ? ppg * expectedGames
        : Number(row.total_projected_points ?? 0);
      return { playerId: row.player_id, value };
    })
    .sort((a, b) => b.value - a.value);

  // First pass: best available that ALSO fits the roster shape.
  let bestIgnoringShape: number | null = null;
  for (const entry of board) {
    if (draftedSet.has(entry.playerId)) continue;
    if (bestIgnoringShape === null) bestIgnoringShape = entry.playerId;

    const pos = positionByPlayer.get(entry.playerId);
    // Unknown position (or a position outside the capped set) is
    // treated as always-eligible — the guard shapes, it never blocks.
    if (!pos || positionCaps[pos] === undefined) {
      return { ok: true, playerId: entry.playerId, source: 'draft_value' };
    }
    const held = teamCounts.get(pos) ?? 0;
    if (held < positionCaps[pos]) {
      return { ok: true, playerId: entry.playerId, source: 'draft_value' };
    }
  }

  // Second pass: every remaining player is at a capped position for
  // this team (deep-bench territory). Take the best available anyway —
  // a stuck autopick freezes the draft, which is strictly worse than
  // an unbalanced bench.
  if (bestIgnoringShape !== null) {
    structuredLogger.info('autopick.roster_guard.caps_exhausted', {
      leagueId,
      teamId,
      playerId: bestIgnoringShape,
    });
    return {
      ok: true,
      playerId: bestIgnoringShape,
      source: 'draft_value_caps_exhausted',
    };
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
