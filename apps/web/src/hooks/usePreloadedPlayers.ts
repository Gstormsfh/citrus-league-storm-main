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

import { useEffect, useMemo, useRef, useState } from 'react';
import { CURRENT_SEASON } from '@citrus/shared';
import { logger } from '@/utils/logger';
import type { Player } from '@/services/PlayerService';

export interface UsePreloadedPlayersResult {
  playersById: ReadonlyMap<string, Player>;
  isLoading: boolean;
  error: Error | null;
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
  }, []);

  return useMemo(
    () => ({ playersById, isLoading, error }),
    [playersById, isLoading, error],
  );
}
