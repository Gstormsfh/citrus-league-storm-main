/**
 * LineupService — 3-tier architecture (Frontend → API Server → Database)
 *
 * All database operations go through the API server.
 * Acceptable client-side exceptions: localStorage fallback for offline mode.
 *
 * Contains all lineup-related methods:
 * - saveLineup()
 * - getLineup()
 * - initializeTeamLineup()
 * - canUpdateRosterForDate()
 * - loadDailyRoster()
 * - backfillMissingDailyRosters()
 * - backfillAllMatchupsForLeague()
 */

import { Player, PlayerService } from "@/services/PlayerService";
import { rosterApi } from "@/api/rosters";
import { MatchupService } from "./MatchupService";
import { RosterCacheService } from "./RosterCacheService";
import { DEMO_LEAGUE_ID_FOR_GUESTS } from "./DemoLeagueService";
import { logger } from "@/utils/logger";

/**
 * The HTTP status a thrown ApiError carries (api/client.ts), or 0 for a
 * request that never got an answer: fetch's TypeError, a TimeoutError or
 * AbortError, or the client's own status-0 ApiError once its retries are
 * spent. Read structurally rather than with instanceof: an ApiError is not
 * the only shape that lands here, and importing api/client would pull the
 * Supabase client into every module that imports this one.
 */
function httpStatusOf(error: unknown): number {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' && Number.isFinite(status) ? status : 0;
}

/** The server answered and said no: any 4xx. */
function isServerRefusal(error: unknown): boolean {
  const status = httpStatusOf(error);
  return status >= 400 && status < 500;
}

export const LineupService = {
  /**
   * Save lineup configuration via API server (with localStorage fallback)
   * Server handles: validation against roster_assignments, roster protection, daily snapshots.
   * @param leagueId - Required for league isolation
   * @param targetDate - Optional: If set, only save to this specific date (Yahoo-style per-day rosters)
   * @param options.allowPlayerRemoval - Let the save drop players the current lineup holds.
   * @param options.rejectOnRefusal - When the server REFUSES the lineup (a 4xx: a
   *   position mismatch, the IR rule, a locked player, ownership), reject with the
   *   server's own sentence instead of resolving. The roster page passes this so a
   *   refusal reaches the manager rather than a success toast (2026-09-03). Off by
   *   default because the background initialisers that write a team's FIRST lineup
   *   through this method do not catch: MatchupService.getMatchupRosters writes one
   *   for both teams of a matchup and the opponent's comes back 403, and a throw
   *   there would empty the matchup page. A refusal writes nothing to localStorage
   *   in either mode; the fallback below is for a request the server never answered.
   */
  async saveLineup(teamId: string | number, leagueId: string, lineup: {
    starters: (string | number)[],
    bench: (string | number)[],
    ir: (string | number)[],
    slotAssignments: Record<string, string>
  }, targetDate?: string, options?: { allowPlayerRemoval?: boolean; rejectOnRefusal?: boolean }) {
    logger.debug('[LineupService.saveLineup] Called with teamId:', teamId, 'leagueId:', leagueId, 'lineup:', {
      starters: lineup.starters?.length || 0,
      bench: lineup.bench?.length || 0,
      ir: lineup.ir?.length || 0,
    });

    // Read-only guard: Block all lineup saves for demo league
    if (leagueId === DEMO_LEAGUE_ID_FOR_GUESTS) {
      logger.warn('[saveLineup] Demo league is read-only. Sign up to create your own league!');
      return;
    }

    // Convert all IDs to strings for consistency
    const lineupToSave = {
      starters: lineup.starters.map(id => String(id)),
      bench: lineup.bench.map(id => String(id)),
      ir: lineup.ir.map(id => String(id)),
      slot_assignments: lineup.slotAssignments,
      target_date: targetDate,
      allow_player_removal: options?.allowPlayerRemoval ?? false,
    };

    try {
      await rosterApi.saveLineup(leagueId, String(teamId), lineupToSave);

      // Supabase save succeeded - clear any stale localStorage data to prevent conflicts
      const key = `lineup_team_${teamId}`;
      localStorage.removeItem(key);

      // Clear roster cache when lineup is saved so matchup page shows updated lineup
      MatchupService.clearRosterCache(String(teamId), leagueId);
      RosterCacheService.clearCache(String(teamId), leagueId);
    } catch (error) {
      // THE SERVER SAID NO (2026-09-03). A 4xx is a judgement on THIS lineup:
      // 400 from the server's LineupService.saveLineup (slot, position and IR
      // rules), 409 from the game-lock check, 403 for a team that is not the
      // caller's. The sentence in it is written for the manager. This block
      // used to stash the refused lineup in localStorage and resolve, exactly
      // as it does for a dead network, so the page toasted "Lineup Updated"
      // while the server kept a different lineup. A refused lineup is not a
      // saved one: nothing is written, the caches keep the lineup the server
      // still holds, and the caller that asked to know is told.
      if (isServerRefusal(error)) {
        logger.warn('[LineupService.saveLineup] The server refused the lineup:', error);
        if (options?.rejectOnRefusal) throw error;
        return;
      }

      // The API never answered (offline, a timeout, a 5xx after the client's
      // retries): keep the lineup on this device so getLineup can show it
      // while the API is unreachable.
      try {
        const key = `lineup_team_${teamId}`;
        localStorage.setItem(key, JSON.stringify({
          starters: lineupToSave.starters,
          bench: lineupToSave.bench,
          ir: lineupToSave.ir,
          slotAssignments: lineupToSave.slot_assignments,
        }));

        // Still clear cache even if using localStorage fallback
        MatchupService.clearRosterCache(String(teamId), leagueId);
        RosterCacheService.clearCache(String(teamId), leagueId);
      } catch (localError) {
        logger.error('Failed to save lineup to both API and localStorage:', localError);
      }
    }
  },

  /**
   * Backfill missing past day roster records for a matchup via API server.
   */
  async backfillMissingDailyRosters(
    teamId: string | number,
    leagueId: string,
    matchupId: string
  ): Promise<{ backfilledCount: number; error: unknown }> {
    try {
// The API layer returns the transport envelope: server routes reply with
// `ok(c, payload)` which serialises to `{ data: payload }`, and apiClient resolves
// to that object. Reading `result.thing` therefore reads the envelope, not the
// payload, and yields undefined every time -- which the `|| 0` / `?? true`
// fallbacks then quietly converted into a plausible-looking answer.
// Unwrap `.data` first. (canUpdateRosterForDate was the sharp one: `?? true`
// turned a permanently-undefined read into a permanent "yes, you may edit".)
      const result = await rosterApi.backfillDailyRosters(leagueId, String(teamId), matchupId);
      // The payload is under `.data` — the server wraps every success in
      // `{ data: ... }`. Reading result.backfilledCount directly returned
      // undefined, so this reported 0 backfilled no matter what the server did.
      // result.error is the transport-level error (a string); the service-level
      // one comes back inside the payload.
      return {
        backfilledCount: result?.data?.backfilledCount ?? 0,
        error: result?.data?.error ?? result?.error ?? null,
      };
    } catch (error) {
      logger.error('[backfillMissingDailyRosters] API error:', error);
      return { backfilledCount: 0, error };
    }
  },

  /**
   * Manual backfill for ALL teams in ALL matchups for a league via API server.
   */
  async backfillAllMatchupsForLeague(leagueId: string): Promise<{
    totalBackfilled: number;
    matchupsProcessed: number;
    errors: Array<{ matchup?: string; team?: string; error: unknown }>
  }> {
    try {
      const result = await rosterApi.backfillAllMatchups(leagueId);
      // Same envelope bug as backfillMissingDailyRosters above: all three
      // fields live under `.data`, so this used to report 0 / 0 / [] for every
      // call — including ones where the server had recorded real failures.
      return {
        totalBackfilled: result?.data?.totalBackfilled ?? 0,
        matchupsProcessed: result?.data?.matchupsProcessed ?? 0,
        errors: result?.data?.errors ?? [],
      };
    } catch (error) {
      logger.error('[backfillAllMatchupsForLeague] API error:', error);
      return { totalBackfilled: 0, matchupsProcessed: 0, errors: [{ error }] };
    }
  },

  /**
   * Check if roster can be updated for a specific date via API server.
   * Returns false if any player's game has started.
   */
  async canUpdateRosterForDate(
    teamId: string | number,
    date: Date,
    lineup: {
      starters: string[],
      bench: string[],
      ir: string[]
    }
  ): Promise<boolean> {
    try {
      const dateStr = date.toISOString().split('T')[0];
      const allPlayerIds = [...lineup.starters, ...lineup.bench, ...lineup.ir].map(id => parseInt(id));

      if (allPlayerIds.length === 0) return true;

      const result = await rosterApi.canUpdateRoster(dateStr, allPlayerIds);
      // `.data` — the server answers ok(c, { canUpdate }). Read off the
      // envelope root this was undefined on every call, so `?? true` fired
      // every time and the game-lock check never actually blocked anything:
      // a started player could still be moved out of the lineup.
      return result?.data?.canUpdate ?? true;
    } catch (error) {
      logger.error('[canUpdateRosterForDate] API error:', error);
      return true; // On error, allow update (fail open)
    }
  },

  /**
   * Load saved lineup configuration via API server (with localStorage fallback)
   * @param leagueId - Required for league isolation
   */
  async getLineup(teamId: string | number, leagueId: string): Promise<{
    starters: string[],
    bench: string[],
    ir: string[],
    slotAssignments: Record<string, string>
  } | null> {
    try {
      // Skip API call if leagueId is not a valid UUID (e.g., 'demo-league-id')
      const isValidUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(leagueId);
      if (!isValidUUID) {
        const key = `lineup_team_${teamId}`;
        const saved = localStorage.getItem(key);
        if (saved) {
          return JSON.parse(saved);
        }
        return null;
      }

      const response = await rosterApi.getLineup(leagueId, String(teamId));
      // API returns { data: { starters, bench, ... } } wrapper — unwrap it
      const data = (response as any)?.data ?? response;

      if (data) {
        // Clear any stale localStorage data
        const key = `lineup_team_${teamId}`;
        localStorage.removeItem(key);

        // Normalize slot assignment keys to strings for consistency
        const rawSlotAssignments = (data.slot_assignments || {}) as Record<string | number, string>;
        const normalizedSlotAssignments: Record<string, string> = {};
        Object.entries(rawSlotAssignments).forEach(([playerId, slotId]) => {
          normalizedSlotAssignments[String(playerId)] = slotId;
        });

        return {
          starters: (data.starters || []) as string[],
          bench: (data.bench || []) as string[],
          ir: (data.ir || []) as string[],
          slotAssignments: normalizedSlotAssignments
        };
      }

      // No data found — clear localStorage and return null
      const key = `lineup_team_${teamId}`;
      localStorage.removeItem(key);
      return null;
    } catch (error) {
      // Fallback to localStorage on API errors
      try {
        const key = `lineup_team_${teamId}`;
        const saved = localStorage.getItem(key);
        if (saved) {
          return JSON.parse(saved);
        }
      } catch (localError) {
        logger.error('[getLineup] Failed to load lineup from both API and localStorage:', localError);
      }
      return null;
    }
  },

  /**
   * Load frozen daily roster from API server.
   * SINGLE SOURCE OF TRUTH for historical lineup data.
   * Used by both Roster and Matchup tabs to ensure consistency.
   * @param fetchMissingPlayers - If true, fetch dropped/traded players not in allPlayers
   *
   * IMPORTANT: This should ONLY be called for PAST dates, not today/future
   */
  async loadDailyRoster<T extends { id: number | string }>(
    teamId: string,
    matchupId: string,
    rosterDate: string,
    allPlayers: T[],
    fetchMissingPlayers: boolean = false
  ): Promise<{
    starters: T[];
    bench: T[];
    ir: T[];
    slotAssignments: Record<string, string>;
    missingPlayerIds?: string[];
  } | null> {
    try {
      // Call API server for daily roster data
      const response = await rosterApi.getDailyRoster(
        teamId,
        matchupId,
        rosterDate
      );
      // API returns { data: [...] } wrapper — unwrap it
      const dailyRosters = (response as any)?.data ?? response;

      if (!dailyRosters || !Array.isArray(dailyRosters) || dailyRosters.length === 0) {
        return null;
      }

      // Build roster arrays — same logic as before but with API data
      const playerMap = new Map(allPlayers.map(p => [String(p.id), p]));
      const starters: T[] = [];
      const bench: T[] = [];
      const ir: T[] = [];
      const slotAssignments: Record<string, string> = {};
      const missingPlayerIds: string[] = [];

      // First pass: identify missing players
      dailyRosters.forEach((entry: { player_id: number; slot_type: string; slot_id: string | null }) => {
        const playerId = String(entry.player_id);
        if (!playerMap.has(playerId)) {
          missingPlayerIds.push(playerId);
        }
      });

      // Fetch missing players if requested (Yahoo/Sleeper behavior for dropped/traded players)
      if (fetchMissingPlayers && missingPlayerIds.length > 0) {
        const missingPlayers = await PlayerService.getPlayersByIds(missingPlayerIds);

        // PlayerService returns directory rows, which carry more than the Player
        // interface describes (full_name AND name, gaa/svPct for goalies,
        // fantasy_points, projected_points, team_abbreviation). The reads below were
        // already written defensively for both shapes; this types what they read.
        type MissingPlayerRow = Player & Partial<{
          name: string;
          gaa: number;
          svPct: number;
          fantasy_points: number;
          projected_points: number;
          team_abbreviation: string;
        }>;
        missingPlayers.forEach((player: MissingPlayerRow) => {
          const transformedPlayer = {
            id: player.id,
            name: player.full_name || player.name || 'Unknown Player',
            position: player.position || 'UTIL',
            number: parseInt(player.jersey_number || '0'),
            starter: false,
            stats: {
              gamesPlayed: player.games_played || 0,
              goals: player.goals || 0,
              assists: player.assists || 0,
              points: player.points || 0,
              plusMinus: player.plus_minus || 0,
              shots: player.shots || 0,
              hits: player.hits || 0,
              blockedShots: player.blocks || 0,
              xGoals: player.xGoals || 0,
              wins: player.wins || 0,
              saves: player.saves || 0,
              gaa: player.gaa || 0,
              svPct: player.svPct || 0,
            },
            fantasyPoints: player.fantasy_points || 0,
            projectedPoints: player.projected_points || 0,
            team: player.team || '',
            teamAbbreviation: player.team_abbreviation || player.team || '',
            headshot_url: player.headshot_url,
            status: player.status,
            wasDropped: true,
          } as unknown as T;

          playerMap.set(String(player.id), transformedPlayer);
        });
      }

      // Second pass: build roster arrays
      dailyRosters.forEach((entry: { player_id: number; slot_type: string; slot_id: string | null }) => {
        const playerId = String(entry.player_id);
        const player = playerMap.get(playerId);
        if (!player) return;

        if (entry.slot_type === 'active') {
          starters.push(player);
          if (entry.slot_id) {
            slotAssignments[playerId] = entry.slot_id;
          }
        } else if (entry.slot_type === 'bench') {
          bench.push(player);
        } else if (entry.slot_type === 'ir') {
          ir.push(player);
          if (entry.slot_id) {
            slotAssignments[playerId] = entry.slot_id;
          }
        }
      });

      return { starters, bench, ir, slotAssignments, missingPlayerIds };
    } catch (error) {
      logger.error('[LineupService.loadDailyRoster] Exception:', error);
      return null;
    }
  },

  /**
   * Initialize lineup for a team via API server.
   * Server handles: roster_assignments query, position mapping, slot assignment, and save.
   */
  async initializeTeamLineup(
    teamId: string,
    leagueId: string,
    _allPlayers: Player[],
    _userId: string
  ): Promise<{
    lineup: { starters: string[]; bench: string[]; ir: string[]; slotAssignments: Record<string, string> } | null;
    error: unknown
  }> {
    try {
      const result = await rosterApi.initializeLineup(leagueId, teamId);
      // `.data` again — the server answers ok(c, result.lineup). Reading the
      // envelope root meant starters/bench/ir/slot_assignments were all
      // undefined, so the `|| []` fallbacks fired and this returned an EMPTY
      // lineup no matter what the server computed. getLineup() a few hundred
      // lines up already unwraps `.data` (with an `as any` and a comment
      // saying so) — the same discovery was made once and never generalised.
      const lineup = result?.data;

      if (!lineup) {
        return { lineup: null, error: null };
      }

      // Unwrap the transport envelope — see the note on backfillMissingDailyRosters.
      const payload = result.data as {
        starters?: string[];
        bench?: string[];
        ir?: string[];
        slot_assignments?: Record<string, string>;
      } | undefined;

      return {
        lineup: {
          starters: lineup.starters || [],
          bench: lineup.bench || [],
          ir: lineup.ir || [],
          slotAssignments: lineup.slot_assignments || {},
        },
        error: null,
      };
    } catch (error) {
      logger.error(`Error initializing lineup for team ${teamId}:`, error);
      return { lineup: null, error };
    }
  },
};
