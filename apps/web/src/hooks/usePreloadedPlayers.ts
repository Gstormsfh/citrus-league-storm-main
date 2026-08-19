// DR-3 chunk (2026-07-29) — non-blocking player pre-fetch.
//
// Entry 87 Fix B (PLAYER-RES-1, 2026-08-10) — rewired to query
// player_directory DIRECTLY via the Supabase client, replacing the
// former PlayerService.getAllPlayers() (which routed through the
// /api/players HTTP endpoint). Run 3 (2026-08-10) surfaced an
// autopick that landed while the API route was still resolving —
// the room rendered '#<id>' fallbacks for a live pick because the
// map was empty at the moment the event fired. Cutting out the
// intermediary (HTTP round-trip + server-side cache warmup + range
// pagination) means the directory hydrates from a single Supabase
// select against the current-season slice, guaranteed to return
// every player_directory row that the engine's autopick pool draws
// from (server-side PlayerService.getAllPlayers uses the same table
// + same season filter — same source of truth).
//
// Contract (unchanged from DR-3):
//   - `playersById`: id → Player map; empty until fetch resolves,
//     then populated in-place (never null; consumers can call `.get()`
//     immediately without an existence check).
//   - Key: `String(player_id)` — numeric NHL id stringified. This
//     matches every consumer's lookup site (v1Adapters.resolvePlayerDisplay
//     :100 does `playersById.get(String(playerId))`; DraftRoomV2:611
//     does `parseInt(player.id, 10)`).
//   - `isLoading`: true until the first resolution attempt completes
//     (either success or error). Signals only for surfaces that want
//     to render their own spinner (the pool).
//   - `error`: last error from the fetch attempt, or null. Non-fatal:
//     the room continues to render with `#<id>` fallbacks.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CURRENT_SEASON } from '@citrus/shared';
import { logger } from '@/utils/logger';
import type { Player } from '@/services/PlayerService';

export interface UsePreloadedPlayersResult {
  playersById: ReadonlyMap<string, Player>;
  isLoading: boolean;
  error: Error | null;
  /**
   * Re-run the directory fetch. Added 2026-08-18: without it a single
   * transient failure was permanent for the life of the mount.
   */
  reload: () => void;
}

/**
 * Normalize a raw position code from player_directory into the
 * short display form the v1 components expect. Mirrors
 * PlayerService.normalizePosition (client-side copy).
 */
function normalizePosition(p: string | null): string {
  const u = (p ?? '').toUpperCase().trim();
  if (u === 'L' || u === 'LEFT' || u === 'LEFTWING') return 'LW';
  if (u === 'R' || u === 'RIGHT' || u === 'RIGHTWING') return 'RW';
  if (u === 'CENTRE' || u === 'CENTER') return 'C';
  if (u === 'DEFENCE' || u === 'DEFENSE') return 'D';
  if (u === 'GOALIE' || u === 'GOALTENDER') return 'G';
  return u;
}

/**
 * Entry 87 Fix B — construct a Player-shape entry from a
 * player_directory row. Stat fields default to 0/null per the
 * existing Player type contract. Consumers of playersById in the
 * draft room only read `id`, `full_name`, `position`, `team` — the
 * stat fields are consumed by PlayerPool's stat columns which are
 * fed a separate stats query in v1's flow; for the draft-room
 * fallback rendering + on-clock display, defaults are sufficient.
 * PlayerService's full-fat build (name + stats + talent + gsax) is
 * still available for surfaces that render deep player detail.
 */
/**
 * PLAYER-POOL (2026-08-12) — the season-stats row we merge onto a player.
 *
 * We take the `nhl_*` columns, not the unprefixed ones. Both exist in
 * `player_season_stats`; the unprefixed set is incomplete for goalies
 * (Hellebuyck reads `wins = 0` / `nhl_wins = 23` on staging today), and a
 * goalie ranked on zero wins sorts below every backup in the league.
 */
interface SeasonStatsRow {
  player_id: number;
  games_played: number | null;
  nhl_goals: number | null;
  nhl_assists: number | null;
  nhl_points: number | null;
  nhl_shots_on_goal: number | null;
  nhl_hits: number | null;
  nhl_blocks: number | null;
  nhl_pim: number | null;
  nhl_ppp: number | null;
  nhl_shp: number | null;
  nhl_plus_minus: number | null;
  nhl_wins: number | null;
  nhl_losses: number | null;
  nhl_ot_losses: number | null;
  nhl_saves: number | null;
  nhl_goals_against: number | null;
  nhl_shutouts: number | null;
  nhl_save_pct: number | null;
  nhl_gaa: number | null;
  /**
   * xG (2026-08-13) — expected goals for the season.
   *
   * Reported from the field as "xG isn't there (all 0.0) but I think
   * that's an issue with the database". It is not a database issue.
   * `player_season_stats.x_goals` on staging is 1,066 rows, ZERO of
   * them null, 928 of them positive, max 36.47, mean 7.34 among
   * scorers — a healthy season of real data sitting in the very row
   * this query already fetches. The column was simply never added to
   * the select list, and `directoryRowToPlayer` hard-codes
   * `xGoals: 0`, so every player rendered 0.0 and nothing ever
   * errored. `PlayerService` has read this same column all along
   * (PlayerService.ts:150) — the two loaders disagreed.
   */
  x_goals: number | null;
}

const n = (v: number | null | undefined): number => (typeof v === 'number' ? v : 0);

/** Mutates `p` in place with the player's real season production. */
function applySeasonStats(p: Player, s: SeasonStatsRow): void {
  p.games_played = n(s.games_played);
  p.goals = n(s.nhl_goals);
  p.assists = n(s.nhl_assists);
  p.points = n(s.nhl_points);
  p.shots = n(s.nhl_shots_on_goal);
  p.hits = n(s.nhl_hits);
  p.blocks = n(s.nhl_blocks);
  p.pim = n(s.nhl_pim);
  p.ppp = n(s.nhl_ppp);
  p.shp = n(s.nhl_shp);
  p.plus_minus = n(s.nhl_plus_minus);
  // xG (2026-08-13) — see SeasonStatsRow.x_goals. Skaters only in
  // practice; goalie rows carry 0 here and their xG-flavoured stat is
  // goals-saved-above-expected, which lives in raw_player_stats and is
  // still hard-coded to 0 below. Flagged, not fixed in this pass.
  p.xGoals = n(s.x_goals);
  if (p.wins !== null || p.saves !== null) {
    // Goalie — PlayerPool's fpts path reads these four.
    p.wins = n(s.nhl_wins);
    p.losses = n(s.nhl_losses);
    p.ot_losses = n(s.nhl_ot_losses);
    p.saves = n(s.nhl_saves);
    p.shutouts = n(s.nhl_shutouts);
    p.goals_against = n(s.nhl_goals_against);
    p.save_percentage = typeof s.nhl_save_pct === 'number' ? s.nhl_save_pct : null;
    p.goals_against_average = typeof s.nhl_gaa === 'number' ? s.nhl_gaa : null;
  }
}

function directoryRowToPlayer(row: DirectoryRow): Player {
  const isGoalie = row.is_goalie === true || row.position_code === 'G';
  const eligiblePositions = (() => {
    if (row.eligible_positions) {
      return row.eligible_positions
        .split(',')
        .map((p) => normalizePosition(p.trim()))
        .filter(Boolean);
    }
    const primary = normalizePosition(row.position_code);
    return primary ? [primary] : [];
  })();

  return {
    id: String(row.player_id),
    full_name: row.full_name,
    position: normalizePosition(row.position_code) || '',
    eligible_positions: eligiblePositions,
    team: row.team_abbrev ?? '',
    jersey_number: row.jersey_number ?? null,
    status: null,
    headshot_url: row.headshot_url ?? null,
    last_updated: null,
    games_played: 0,
    goals: 0,
    assists: 0,
    points: 0,
    plus_minus: 0,
    shots: 0,
    hits: 0,
    blocks: 0,
    xGoals: 0,
    wins: isGoalie ? 0 : null,
    losses: isGoalie ? 0 : null,
    ot_losses: isGoalie ? 0 : null,
    saves: isGoalie ? 0 : null,
    goals_against_average: isGoalie ? null : null,
    save_percentage: isGoalie ? null : null,
    highDangerSavePct: 0,
    goalsSavedAboveExpected: 0,
  };
}

interface DirectoryRow {
  player_id: number;
  full_name: string;
  position_code: string | null;
  team_abbrev: string | null;
  jersey_number: string | null;
  headshot_url: string | null;
  is_goalie: boolean;
  eligible_positions: string | null;
}

/**
 * Pre-fetch the full player index once per mount. Idempotent per
 * mount — subsequent renders return the same map ref (React can bail
 * on `===` comparison in downstream `useMemo` selectors).
 *
 * The empty map returned pre-resolution is safe to consume: adapters
 * call `.get(id)` which returns undefined for every id, triggering
 * the `#<id>` fallback per contract. The room renders immediately.
 */
export function usePreloadedPlayers(): UsePreloadedPlayersResult {
  const [playersById, setPlayersById] = useState<ReadonlyMap<string, Player>>(
    () => new Map(),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const cancelledRef = useRef(false);
  // 2026-08-18 launch audit: the effect had an empty dep array and no
  // retry path, so a single directory-fetch failure was permanent for
  // the life of the mount — the draft room showed an empty pool with
  // "Try adjusting your filters" and the user simply could not draft.
  const [reloadNonce, setReloadNonce] = useState(0);
  const reload = useCallback(() => setReloadNonce((n) => n + 1), []);

  useEffect(() => {
    cancelledRef.current = false;
    (async () => {
      try {
        // Lazy import matches the DraftRoomV2 apiClient pattern
        // (:92) and prevents the supabase client's top-of-module env
        // check from firing during test collection (unrelated
        // DraftRoomV2 tests don't need env vars set to import the
        // page; the actual supabase.from call is behind vi.mock in
        // usePreloadedPlayers's own test rig).
        //
        // Entry 92 PLAYER-RES-1b (2026-08-10) — the Supabase Data-API
        // caps ranged responses at 1000 rows by default (server-side
        // clamp). Pre-patch, a single `.range(0, 4999)` call returned
        // an arbitrary ~1000-row physical-order subset of the 2035-row
        // player_directory. Run 4 field evidence: Regenda (early
        // physical row) was in the window; MacKinnon + McDavid weren't,
        // so autopicked stars rendered `#id / ? / -` fallbacks in
        // History despite being present in the table with clean RLS.
        //
        // Fix: page through the directory in ≤1000-row windows via
        // `.range(offset, offset+PAGE_SIZE-1)`, looping until a short
        // page signals end-of-data. `.order('player_id', asc)` gives
        // deterministic ordering so pages don't overlap or gap. Both
        // fixes together also normalize the Players tab's default
        // ordering (which previously led with fringe players — the
        // physical-row order of the first ~1000 rows).
        const { supabase } = await import('@/integrations/supabase/client');
        const PAGE_SIZE = 1000;
        const map = new Map<string, Player>();
        let offset = 0;
        while (true) {
          const { data, error: qErr } = await supabase
            .from('player_directory')
            .select(
              'player_id, full_name, position_code, team_abbrev, jersey_number, headshot_url, is_goalie, eligible_positions',
            )
            .eq('season', CURRENT_SEASON)
            .order('player_id', { ascending: true })
            .range(offset, offset + PAGE_SIZE - 1);
          if (cancelledRef.current) return;
          if (qErr) {
            throw new Error(qErr.message || 'player_directory query failed');
          }
          const rows = (data ?? []) as DirectoryRow[];
          for (const row of rows) {
            const p = directoryRowToPlayer(row);
            map.set(p.id, p);
          }
          // Short page → server has no more rows to return. Loop exits
          // deterministically for any directory size ≥ 0 (including
          // an empty table, which returns rows.length === 0 on the
          // first iteration).
          if (rows.length < PAGE_SIZE) break;
          offset += PAGE_SIZE;
        }

        // ── PLAYER-POOL (2026-08-12) — merge real season production ──
        //
        // Until now this hook returned every player with goals/assists/
        // shots/wins hard-coded to 0. PlayerPool's default sort is
        // `projRank`, computed from those stats via ScoringCalculator — so
        // every player scored identically, the sort collapsed to a no-op,
        // and `Array.prototype.sort`'s stability left the list in the order
        // it arrived: `player_id` ascending.
        //
        // NHL player ids increase over time, so that ordering put the
        // OLDEST players first. The board opened on Jaromir Jagr (54),
        // Matt Cullen (49), Zdeno Chara (49), Joe Thornton (47) — the first
        // fifteen entries were all retired. Meanwhile the engine's autopick
        // ranks properly, so a bot seat drafted McDavid while the human was
        // shown a 1979-born centre. Field-confirmed 2026-08-12.
        //
        // Merging the stats fixes the ranking at its source: no change to
        // PlayerPool, ScoringCalculator, or any sort code — they were all
        // correct and starved of input.
        //
        // NON-FATAL BY DESIGN. This is wrapped separately from the
        // directory load above because the two have very different blast
        // radii: the directory map resolves NAMES for already-drafted
        // players, so losing it turns a finished roster into `#8466139 /
        // ? / -`. Losing stats only costs ranking. A stats failure must
        // never take the directory down with it.
        //
        // TYPES NOTE: `player_season_stats` is absent from the generated
        // Supabase types (src/integrations/supabase/types.ts). The table is
        // real — 1,066 rows on staging — the type file is simply stale;
        // `player_directory` is in there and this one never got regenerated.
        // A narrowly-shaped accessor for this one query is the same escape
        // hatch PoolPlayoffRoster.tsx already uses. Regenerating the types is
        // the proper fix and does not belong in a pre-freeze change.
        const statsClient = supabase as unknown as {
          from: (table: string) => {
            select: (cols: string) => {
              eq: (
                col: string,
                val: number,
              ) => {
                order: (
                  col: string,
                  opts: { ascending: boolean },
                ) => {
                  range: (
                    from: number,
                    to: number,
                  ) => Promise<{
                    data: unknown[] | null;
                    error: { message?: string } | null;
                  }>;
                };
              };
            };
          };
        };
        try {
          let statsOffset = 0;
          while (true) {
            const { data: statsData, error: statsErr } = await statsClient
              .from('player_season_stats')
              .select(
                'player_id, games_played, nhl_goals, nhl_assists, nhl_points, nhl_shots_on_goal, nhl_hits, nhl_blocks, nhl_pim, nhl_ppp, nhl_shp, nhl_plus_minus, nhl_wins, nhl_losses, nhl_ot_losses, nhl_saves, nhl_goals_against, nhl_shutouts, nhl_save_pct, nhl_gaa, x_goals',
              )
              .eq('season', CURRENT_SEASON)
              .order('player_id', { ascending: true })
              .range(statsOffset, statsOffset + PAGE_SIZE - 1);
            if (cancelledRef.current) return;
            if (statsErr) {
              throw new Error(statsErr.message || 'player_season_stats query failed');
            }
            const statRows = (statsData ?? []) as SeasonStatsRow[];
            for (const s of statRows) {
              const player = map.get(String(s.player_id));
              if (player) applySeasonStats(player, s);
            }
            // Same ≤1000-row paging discipline as the directory above —
            // this table is 1,066 rows on staging and would otherwise be
            // silently truncated by the Data-API's default clamp.
            if (statRows.length < PAGE_SIZE) break;
            statsOffset += PAGE_SIZE;
          }
        } catch (statsErr) {
          logger.error(
            '[usePreloadedPlayers] season-stats merge failed — pool will render unranked:',
            statsErr instanceof Error ? statsErr : new Error(String(statsErr)),
          );
        }

        setPlayersById(map);
        setError(null);
      } catch (err) {
        if (cancelledRef.current) return;
        const asError = err instanceof Error ? err : new Error(String(err));
        logger.error('[usePreloadedPlayers] player_directory fetch failed:', asError);
        setError(asError);
      } finally {
        if (!cancelledRef.current) setIsLoading(false);
      }
    })();
    return () => {
      cancelledRef.current = true;
    };
  }, [reloadNonce]);

  return useMemo(
    () => ({ playersById, isLoading, error, reload }),
    [playersById, isLoading, error, reload],
  );
}
