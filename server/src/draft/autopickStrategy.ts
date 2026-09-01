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
import { structuredLogger, coerceToNumericPlayerId, getProjectionsSeason } from '@citrus/shared';

/**
 * Prior season used as the durability/role signal for draft value
 * (E117). Bumped when the pipeline's canonical season advances.
 */
const DRAFT_VALUE_REFERENCE_SEASON = 2025;

// (ROOKIE-VALUE FIX 2026-08-23: the old DEFAULT_EXPECTED_GAMES=55 rookie
// assumption is gone — no-prior-season players now rank by the conservative
// legacy projection column instead of per-game × an assumed 55 games.)

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

/**
 * True STARTING slot counts per position (no flex headroom) — the
 * replacement-level denominator for the VORP ranking below. Mirrors
 * packages/shared DEFAULT_ROSTER_SLOTS starters. A league that
 * configures `settings.rosterSlots` overrides these with its own.
 */
const DEFAULT_STARTING_SLOTS: Readonly<Record<string, number>> = {
  C: 2,
  LW: 2,
  RW: 2,
  D: 4,
  G: 2,
};

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
  // Players with no prior-season row rank by the conservative legacy
  // column (ROOKIE-VALUE FIX 2026-08-23) so rookies are ranked, never
  // zeroed — and never inflated to 55-game starters.
  //
  // This reads the SAME projections table (no new schema, no
  // dependency on the projections pipeline's internals) plus one
  // additional read of prior-season games played.
  // AUTOPICK-TRUNCATION-2 (2026-08-13) — this read is now paged too.
  //
  // The 2026-08-12 pass paged `player_season_stats` (immediately below)
  // and left THIS query, one statement above it, unbounded. Same defect
  // class, same file, missed by a single query.
  //
  // Latent rather than active on staging today: the table holds 926
  // rows against PostgREST's 1,000-row `db-max-rows`. But this is the
  // AUTOPICK BOARD. The obvious "let's freshen staging's projections
  // before the draft" move copies prod's table, which is 1,361 rows —
  // that would silently drop 361 players, and with no ORDER BY on the
  // original query, *which* 361 was arbitrary and could differ between
  // calls. A live draft is the worst possible place to discover that.
  //
  // Paging + a deterministic order makes the board complete and stable
  // regardless of how the table grows.
  const projections: Array<Record<string, unknown>> = [];
  {
    const PAGE = 1000;
    let offset = 0;
    for (;;) {
      const { data, error: projErr } = await supabase
        .from('player_ros_projections')
        .select('player_id, avg_points_per_game, total_projected_points')
        // FUTURE-PROOF (2026-08-24 season-sweep): the table holds one
        // season today, but the moment a second season's projections are
        // ingested an unfiltered read would mix seasons on the board —
        // the same per-season-index trap as the caps-inflation bug.
        .eq('season', getProjectionsSeason())
        .order('player_id', { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (projErr) {
        structuredLogger.error(
          'autopick.projections.read_failed',
          { leagueId, message: projErr.message ?? null },
          projErr,
        );
        return { ok: false, reason: 'no_eligible_players' };
      }
      const rows = data ?? [];
      projections.push(...rows);
      if (rows.length < PAGE) break;
      offset += PAGE;
    }
  }

  // AUTOPICK-TRUNCATION (2026-08-12) — this read is now paged.
  //
  // It was a single unbounded select. `player_season_stats` holds 1,066
  // rows for the reference season and PostgREST's default `db-max-rows`
  // is 1,000, so ~66 players were silently dropped and fell back to
  // DEFAULT_EXPECTED_GAMES — mis-ranking them. Worse, the query had no
  // ORDER BY, so *which* 66 disappeared was arbitrary and could differ
  // between calls.
  //
  // Same defect class as the client player pool fixed this morning, in a
  // different file: nothing errors, the data is just quietly incomplete.
  const seasonRows: Array<Record<string, unknown>> = [];
  let seasonErr: { message?: string | null } | null = null;
  {
    const PAGE = 1000;
    let offset = 0;
    for (;;) {
      const { data, error } = await supabase
        .from('player_season_stats')
        .select('player_id, games_played, season')
        .eq('season', DRAFT_VALUE_REFERENCE_SEASON)
        .order('player_id', { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (error) {
        seasonErr = error;
        break;
      }
      const rows = (data ?? []) as Array<Record<string, unknown>>;
      for (const r of rows) seasonRows.push(r);
      if (rows.length < PAGE) break;
      offset += PAGE;
    }
  }
  if (seasonErr) {
    // Non-fatal: with no durability signal everyone ranks by the
    // conservative legacy column (ROOKIE-VALUE FIX 2026-08-23).
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
  // VORP (2026-09-01): replacement level needs the league's true shape —
  // how many teams draft, and how many STARTING slots each position has.
  // Starting slots deliberately differ from positionCaps: caps carry flex
  // headroom so the guard never stalls a draft; replacement level wants
  // the real starter count (teams × starters = the last starter drafted).
  let teamsCount = 12;
  let startingSlots: Record<string, number> = { ...DEFAULT_STARTING_SLOTS };
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
      const leagueSettings = (
        leagueRow as {
          settings?: { rosterSlots?: Record<string, number>; teamsCount?: number };
        } | null
      )?.settings;
      const configuredTeams = Number(leagueSettings?.teamsCount);
      if (Number.isFinite(configuredTeams) && configuredTeams >= 2) {
        teamsCount = configuredTeams;
      }
      const configured = leagueSettings?.rosterSlots;
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
        // The same configured slots are the starting-slot truth for
        // replacement level (they ARE the league's starter counts).
        if (Object.keys(filtered).length > 0) {
          startingSlots = { ...DEFAULT_STARTING_SLOTS, ...filtered };
        }
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
          // Newest season's position wins the dedupe below.
          .order('season', { ascending: false })
          .in('player_id', ownedIds);
        if (ownedErr) {
          structuredLogger.warn('autopick.roster_guard.owned_positions_read_failed', {
            leagueId,
            teamId,
            message: ownedErr.message ?? null,
          });
        } else {
          // CAPS-INFLATION FIX (2026-08-23, found live on prod during launch
          // QA): `player_directory` is a per-SEASON index — most players have
          // one row per season (prod today: 1,902 rows / 1,085 players). This
          // read returned every season row per owned player, so each pick
          // counted ~2× toward its position cap. Mid-draft, every position
          // looked cap-full, the first pass found nobody eligible, and picks
          // fell through to the caps_exhausted fallback — the guard was
          // effectively disabled and an ownerless seat drafted ELEVEN goalies
          // (Claude Linear League, 2026-08-23). Dedupe to one row per player
          // before counting.
          const seenOwned = new Set<number>();
          for (const row of (ownedRows ?? []) as Array<{
            player_id: number;
            position_code: string | null;
          }>) {
            const pid = coerceToNumericPlayerId(row.player_id);
            if (pid === null || seenOwned.has(pid)) continue;
            seenOwned.add(pid);
            const pos = normalizePosition(row.position_code);
            if (pos) teamCounts.set(pos, (teamCounts.get(pos) ?? 0) + 1);
          }
        }
      }
    }
  }

  // AUTOPICK-TRUNCATION (2026-08-12) — this read is now paged.
  //
  // The original comment said "the board is ~1000 rows and this is a
  // covered index lookup" — but the query never filtered to the board.
  // It selected ALL of `player_directory`, which is 2,035 rows on
  // staging (it is an all-time index, not a roster). Against PostgREST's
  // 1,000-row default that returned an arbitrary, unordered half.
  //
  // The consequence was specific and silent: `positionByPlayer` is the
  // only input to the roster-shape guard below, and a player missing
  // from the map hits `positionCaps[pos] === undefined` and is treated
  // as UNCAPPED. So roughly half the board bypassed the caps entirely —
  // including G <= 2, the one the guard exists for. The guard looked
  // present in code and was half-blind at runtime.
  const positionByPlayer = new Map<number, string>();
  {
    const PAGE = 1000;
    let offset = 0;
    for (;;) {
      const { data: dirRows, error: dirErr } = await supabase
        .from('player_directory')
        .select('player_id, position_code')
        .order('player_id', { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (dirErr) {
        structuredLogger.warn('autopick.roster_guard.directory_read_failed', {
          leagueId,
          message: dirErr.message ?? null,
        });
        break;
      }
      const rows = (dirRows ?? []) as Array<{
        player_id: number;
        position_code: string | null;
      }>;
      for (const row of rows) {
        const pos = normalizePosition(row.position_code);
        if (pos) positionByPlayer.set(row.player_id, pos);
      }
      if (rows.length < PAGE) break;
      offset += PAGE;
    }
  }

  const board = ((projections ?? []) as Array<{
    player_id: number;
    avg_points_per_game: number | string | null;
    total_projected_points: number | string | null;
  }>)
    .map((row) => {
      const ppg = Number(row.avg_points_per_game ?? 0);
      const priorGames = gamesByPlayer.get(row.player_id);
      // ROOKIE-VALUE FIX (2026-08-23, found live on prod during launch QA):
      // a player with NO prior-season row used to be credited
      // DEFAULT_EXPECTED_GAMES (55) on whatever small-sample per-game rate
      // he carried, so unproven prospects — goalies especially — ranked
      // like 55-game starters. Once the roster-shape guard's caps were
      // exhausted, the fallback board drained straight into them (nine
      // consecutive prospect-goalie picks on prod, 2026-08-23). Industry
      // autopick boards rank no-history players conservatively; do the
      // same: no prior season → the legacy conservative rest-of-season
      // value, never per-game × 55.
      const expectedGames = priorGames !== undefined
        ? Math.min(priorGames, MAX_SEASON_GAMES)
        : null;
      const value = expectedGames !== null && Number.isFinite(ppg) && ppg > 0
        ? ppg * expectedGames
        : Number(row.total_projected_points ?? 0);
      return { playerId: row.player_id, value };
    });

  // ── POSITIONAL VALUE ADJUSTMENT — VORP (2026-09-01) ────────────────
  //
  // Field evidence, first live engine draft (league "Launch Dry Run"):
  // the autopick board drained THE ENTIRE GOALIE POOL in the opening
  // rounds. Not a mechanics bug — the value model's honest output.
  // Under the scoring of the day (W 4 / SO 3 / SV 0.2) a workhorse starter
  // projects 450–530 season points, right beside the elite centers,
  // so "best available by season value" IS a goalie run until every
  // team hits its G cap. E117 fixed per-game-rate inflation; this
  // fixes the deeper flaw: raw season value ignores REPLACEMENT.
  //
  // What real drafters (and every serious platform's ranker) price is
  // value OVER the best player you could get for free at that position
  // once starters are gone: teams × starting slots deep. Two starting
  // goalie slots × 8 teams = the 16th goalie is the waterline; elite
  // G minus that waterline is a modest edge, while McDavid minus the
  // 16th center is enormous. Rank by that edge and the board orders
  // like a draft instead of a leaderboard.
  //
  // Mechanics:
  //   replacement[pos] = value of the (teams × startingSlots[pos])-th
  //     best at pos (clamped to the pool's tail when shallower).
  //   adjusted = value − replacement[pos].
  //   Unknown-position players use a GLOBAL waterline (the last
  //   starter drafted overall) so they stay rankable — the guard
  //   never blocks, and neither does the ranker.
  //   Ties break by raw value, then player_id, for determinism.
  {
    const byPos = new Map<string, number[]>();
    for (const entry of board) {
      const pos = positionByPlayer.get(entry.playerId);
      const key = pos && startingSlots[pos] !== undefined ? pos : null;
      if (key) {
        const arr = byPos.get(key) ?? [];
        arr.push(entry.value);
        byPos.set(key, arr);
      }
    }
    const replacementFor = (pos: string): number => {
      const values = (byPos.get(pos) ?? []).slice().sort((a, b) => b - a);
      if (values.length === 0) return 0;
      const idx = Math.min(teamsCount * (startingSlots[pos] ?? 0), values.length - 1);
      return values[idx];
    };
    const replacementByPos = new Map<string, number>();
    for (const pos of Object.keys(startingSlots)) {
      replacementByPos.set(pos, replacementFor(pos));
    }
    const allValues = board.map((e) => e.value).sort((a, b) => b - a);
    const totalStarters = Object.values(startingSlots).reduce((a, b) => a + b, 0);
    const globalWaterline = allValues.length === 0
      ? 0
      : allValues[Math.min(teamsCount * totalStarters, allValues.length - 1)];
    for (const entry of board as Array<{ playerId: number; value: number; adjusted?: number }>) {
      const pos = positionByPlayer.get(entry.playerId);
      const repl = pos !== undefined && replacementByPos.has(pos)
        ? (replacementByPos.get(pos) as number)
        : globalWaterline;
      entry.adjusted = entry.value - repl;
    }
  }
  (board as Array<{ playerId: number; value: number; adjusted?: number }>).sort(
    (a, b) =>
      (b.adjusted ?? b.value) - (a.adjusted ?? a.value) ||
      b.value - a.value ||
      a.playerId - b.playerId,
  );

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
/**
 * QUEUE (2026-08-12) — the manager's own ranking, consulted first.
 *
 * Until today the draft queue was a lie of omission. `DraftQueue.tsx`
 * wrote `localStorage['draft-queue-<leagueId>']` and **nothing on the
 * server ever read it**. `draft_queues` existed, with correct RLS, and
 * held zero rows. So the one moment a queue is FOR — the manager is
 * away, their clock expires, autopick fires — was the one moment it did
 * nothing. They got best-available instead of their guy.
 *
 * This is why the strategy chain exists, and the note above called it:
 * "adding `queueStrategy` to the front of the array is a single line of
 * code rather than a refactor." That held.
 *
 * ── Design decisions worth stating, because each could have gone the
 *    other way ──
 *
 * 1. NO POSITION CAPS HERE. `projectionsStrategy` shapes an ABSENT
 *    manager's roster with a G<=2-style guard, because a value ranking
 *    left alone will hand someone twelve goalies. A queue is the
 *    opposite situation: it is an explicit, ordered instruction the
 *    manager typed in themselves. Overriding it with a cap would mean
 *    silently not drafting the player they ranked #1. Yahoo, ESPN and
 *    Sleeper all honour the queue as stated; so do we.
 *
 * 2. IT NEVER THROWS. Every failure path returns `ok: false`, which
 *    hands control to `projectionsStrategy`. A malformed queue, an RLS
 *    surprise, a dropped connection to Postgres — none of them may be
 *    the reason a draft stalls. Degrading to best-available is a worse
 *    pick; throwing is a dead clock, and a dead clock is how twelve
 *    people end up standing around.
 *
 * 3. THE DRAFTED CHECK IS NOT OPTIONAL. A queue built before the draft
 *    is stale within minutes — the top of it is exactly what everyone
 *    else is also taking. Walking past already-drafted entries is the
 *    common case, not an edge case.
 *
 * 4. It reads `draft_picks_v2` (the trigger-maintained projection), the
 *    same source `projectionsStrategy` uses for its drafted set, so the
 *    two strategies can never disagree about who is still available.
 */
export const queueStrategy: AutopickStrategy = async ({
  leagueId,
  teamId,
  supabase,
}) => {
  const defer = (): AutopickResult => ({
    ok: false,
    reason: 'no_eligible_players',
  });

  try {
    const { data: queueRows, error: queueErr } = await supabase
      .from('draft_queues')
      .select('player_id, position')
      .eq('team_id', teamId)
      .order('position', { ascending: true });

    if (queueErr) {
      // Logged at warn, not error: falling through to projections is a
      // correct, complete outcome — the draft still advances on time.
      structuredLogger.warn('autopick.queue.read_failed', {
        leagueId,
        teamId,
        message: queueErr.message ?? null,
      });
      return defer();
    }

    const queued = (queueRows ?? []) as Array<{
      player_id: number;
      position: number;
    }>;
    if (queued.length === 0) {
      // Overwhelmingly the common case. Deliberately not logged — on a
      // 12-team board most managers never build a queue, and a log line
      // per autopick per empty queue is noise that would bury the real
      // events on draft night.
      return defer();
    }

    const { data: draftedRows, error: draftedErr } = await supabase
      .from('draft_picks_v2')
      .select('player_id')
      .eq('league_id', leagueId);

    if (draftedErr) {
      // Fail CLOSED for the queue specifically. Without a reliable
      // drafted set we could hand back a player already on someone
      // else's roster; submit_pick_v2 would reject it as `player_taken`
      // and the autopick would fail outright. Deferring to projections,
      // which does its own drafted lookup, is strictly safer.
      structuredLogger.warn('autopick.queue.drafted_lookup_failed', {
        leagueId,
        teamId,
        message: draftedErr.message ?? null,
      });
      return defer();
    }

    const drafted = new Set<number>();
    for (const row of (draftedRows ?? []) as Array<{ player_id: number }>) {
      const id = coerceToNumericPlayerId(row.player_id);
      if (id !== null) drafted.add(id);
    }

    for (const entry of queued) {
      const playerId = coerceToNumericPlayerId(entry.player_id);
      if (playerId === null) continue;
      if (drafted.has(playerId)) continue;

      structuredLogger.info('autopick.queue.hit', {
        leagueId,
        teamId,
        playerId,
        queuePosition: entry.position,
        queueLength: queued.length,
      });
      return { ok: true, playerId, source: 'queue' };
    }

    // The manager had a queue and every player in it is gone. Worth a
    // log line — it is the signal that their prep was consumed, and on
    // draft night it explains to them afterwards why they got a
    // projections pick despite having queued.
    structuredLogger.info('autopick.queue.exhausted', {
      leagueId,
      teamId,
      queueLength: queued.length,
    });
    return defer();
  } catch (err) {
    structuredLogger.warn('autopick.queue.unexpected_error', {
      leagueId,
      teamId,
      message: err instanceof Error ? err.message : String(err),
    });
    return defer();
  }
};

/**
 * The live chain. `queueStrategy` first — a manager's stated ranking
 * outranks any model we have. `projectionsStrategy` catches everyone
 * who did not queue, which on a real board is most of them.
 *
 * Still open for a future tail (see the chain-of-strategies note at the
 * top of this file):
 *   - `positionalStrategy` — roster-aware fallback once projections
 *     exhaust. Not needed today: projectionsStrategy already carries a
 *     roster-shape guard (E118).
 */
export const DEFAULT_STRATEGIES: ReadonlyArray<AutopickStrategy> = [
  queueStrategy,
  projectionsStrategy,
];
