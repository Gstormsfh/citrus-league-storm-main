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

export const LineupService = {
  /**
   * Save lineup configuration via API server (with localStorage fallback)
   * Server handles: validation against roster_assignments, roster protection, daily snapshots.
   * @param leagueId - Required for league isolation
   * @param targetDate - Optional: If set, only save to this specific date (Yahoo-style per-day rosters)
   */
  async saveLineup(teamId: string | number, leagueId: string, lineup: {
    starters: (string | number)[],
    bench: (string | number)[],
    ir: (string | number)[],
    slotAssignments: Record<string, string>
  }, targetDate?: string, options?: { allowPlayerRemoval?: boolean }) {
    logger.debug('[LineupService.saveLineup] Called with teamId:', teamId, 'leagueId:', leagueId, 'lineup:', {
      starters: lineup.starters?.length || 0,
      bench: lineup.bench?.length || 0,
      ir: lineup.ir?.length || 0,
    });
    console.warn('[ROSTER-DEBUG] LineupService.saveLineup', { targetDate, teamId, starters: lineup.starters?.length, bench: lineup.bench?.length });

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
      // Fallback to localStorage if API fails (offline mode, errors, etc.)
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
      const result = await rosterApi.backfillDailyRosters(leagueId, String(teamId), matchupId);
      return { backfilledCount: result?.backfilledCount || 0, error: result?.error || null };
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
      return {
        totalBackfilled: result?.totalBackfilled || 0,
        matchupsProcessed: result?.matchupsProcessed || 0,
        errors: result?.errors || [],
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
      return result?.canUpdate ?? true;
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
      console.warn('[ROSTER-DEBUG] LineupService.loadDailyRoster requesting', { teamId, matchupId, rosterDate });
      const response = await rosterApi.getDailyRoster(
        teamId,
        matchupId,
        rosterDate
      );
      // API returns { data: [...] } wrapper — unwrap it
      const dailyRosters = (response as any)?.data ?? response;
      console.warn('[ROSTER-DEBUG] LineupService.loadDailyRoster result', { rosterDate, rowCount: dailyRosters ? (Array.isArray(dailyRosters) ? dailyRosters.length : 'not-array') : 'null' });

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

        missingPlayers.forEach((player: Player) => {
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

      if (!result) {
        return { lineup: null, error: null };
      }

      return {
        lineup: {
          starters: result.starters || [],
          bench: result.bench || [],
          ir: result.ir || [],
          slotAssignments: result.slot_assignments || {},
        },
        error: null,
      };
    } catch (error) {
      logger.error(`Error initializing lineup for team ${teamId}:`, error);
      return { lineup: null, error };
    }
  },
};
