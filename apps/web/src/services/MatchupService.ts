// NOTE: Direct Supabase usage removed — all DB queries now go through matchupApi (3-tier architecture)
import { League, Team, LeagueService } from './LeagueService';

import { PlayerService, Player } from './PlayerService';
import { DEMO_LEAGUE_ID_FOR_GUESTS } from './DemoLeagueService';
import { MatchupPlayer, StatBreakdown } from '@/components/matchup/types';
import { clampToSeasonStart, getFirstWeekStartDate, getWeekStartDate, getWeekEndDate, getAvailableWeeks, getScheduleLength } from '@/utils/weekCalculator';
import { HockeyPlayer } from '@/components/roster/HockeyPlayerCard';
import { ScheduleService, NHLGame, GameInfo } from './ScheduleService';
import { withTimeout } from '@/utils/promiseUtils';
import { getTodayMST, getTodayMSTDate, formatDateToString, isDateInRange } from '@/utils/timezoneUtils';

import { ScoringCalculator, DEFAULT_SCORING, type ScoringSettings } from '@/utils/scoringUtils';
import { DEFAULT_TEST_DATE } from '@/utils/seasonConstants';
import { logger } from '@/utils/logger';
import { matchupApi } from '@/api/matchups';

// Shared stat shape for a player's weekly totals.
//
// Declared as a `type`, not an `interface`, deliberately: an interface gets no
// implicit index signature, so it will not assign to Record<string, number> and
// every call passing one into the scoring helpers failed to compile.
//
// This is also the single definition of the shape. It used to be re-declared
// inline in four places and three of them had drifted -- the producer
// (fetchMatchupStatsForPlayers) returns ppp / shp / hits / pim / plus_minus, and
// two consumers still described the older four-category shape. The values were
// always present at runtime; the types had simply stopped describing them.
type MatchupWeekStats = {
  goals?: number;
  assists?: number;
  sog?: number;
  blocks?: number;
  ppp?: number;
  shp?: number;
  hits?: number;
  pim?: number;
  plus_minus?: number;
  xGoals?: number;
  wins?: number;
  saves?: number;
  shutouts?: number;
  goals_against?: number;
}

// Shape for daily projection rows returned from RPC
interface DailyProjectionRow {
  player_id: number;
  projection_date?: string;
  is_goalie?: boolean;
  total_projected_points?: number;
  projected_goals?: number;
  projected_assists?: number;
  projected_sog?: number;
  projected_blocks?: number;
  projected_ppp?: number;
  projected_shp?: number;
  projected_hits?: number;
  projected_pim?: number;
  projected_xg?: number;
  base_ppg?: number;
  shrinkage_weight?: number;
  finishing_multiplier?: number;
  opponent_adjustment?: number;
  b2b_penalty?: number;
  home_away_adjustment?: number;
  confidence_score?: number;
  calculation_method?: string;
  projected_wins?: number;
  projected_saves?: number;
  projected_shutouts?: number;
  projected_goals_against?: number;
  projected_gaa?: number;
  projected_save_pct?: number;
  projected_gp?: number;
  starter_confirmed?: boolean;
  // Monte Carlo uncertainty (Citrus 3.1)
  projection_mean?: number;
  projection_std_dev?: number;
  projection_ci_lower?: number;
  projection_ci_upper?: number;
  projection_ci_50_lower?: number;
  projection_ci_50_upper?: number;
  projection_median?: number;
  dynamic_confidence?: number;
  likely_low?: number;
  likely_high?: number;
  confidence_label?: string;
}

// Shape for matchup line rows from fantasy_matchup_lines
interface MatchupLineRow {
  player_id: number;
  total_points: number;
  games_played: number;
  games_remaining_total: number;
  games_remaining_active: number;
  has_live_game: boolean;
  live_game_locked: boolean;
  stats_breakdown?: Record<string, unknown>;
}

// Shape for raw stats breakdown JSONB from database
interface RawStatsBreakdown {
  [key: string]: number;
}

// Roster cache for performance optimization
interface RosterCacheEntry {
  roster: HockeyPlayer[];
  timestamp: number;
}

const ROSTER_CACHE_TTL = 2 * 60 * 1000; // 2 minutes in milliseconds
const rosterCache = new Map<string, RosterCacheEntry>();

// Helper to generate cache key
const getRosterCacheKey = (teamId: string, leagueId: string): string => {
  return `${leagueId}:${teamId}`;
};

// Note: withTimeout is now imported from @/utils/promiseUtils

export interface Matchup {
  id: string;
  league_id: string;
  week_number: number;
  team1_id: string;
  team2_id: string | null;
  team1_score: number;
  team2_score: number;
  status: 'scheduled' | 'in_progress' | 'completed';
  week_start_date: string;
  week_end_date: string;
  created_at: string;
  updated_at: string;
}

export interface MatchupDataResponse {
  matchupId: string;
  matchup: Matchup; // Full matchup object
  currentWeek: number;
  scheduleLength: number; // Total regular season weeks
  isPlayoffWeek: boolean;
  userTeam: {
    id: string;
    name: string;
    roster: MatchupPlayer[];
    slotAssignments: Record<string, string>;
    record: { wins: number; losses: number };
    dailyPoints: number[];
  };
  opponentTeam: {
    id: string;
    name: string;
    roster: MatchupPlayer[];
    slotAssignments: Record<string, string>;
    record: { wins: number; losses: number };
    dailyPoints: number[];
  } | null; // null for bye weeks
  navigation: {
    previousWeek: number | null;
    nextWeek: number | null;
    previousMatchupId: string | null;
    nextMatchupId: string | null;
  };
}

export const MatchupService = {
  /**
   * Delete all matchups for a league (useful for regeneration)
   */
  async deleteAllMatchupsForLeague(leagueId: string): Promise<{ error: Error | null }> {
    try {
      await matchupApi.deleteAllMatchups(leagueId);
      return { error: null };
    } catch (error: unknown) {
      logger.error('[MatchupService] Error deleting matchups:', error);
      return { error: error instanceof Error ? error : new Error(String(error)) };
    }
  },

  /**
   * Generate round-robin matchups for all available weeks in a league
   */
  /**
   * Get round-robin pairings for a specific week using the Circle Method
   * For weeks beyond numRounds, repeats the cycle
   */
  getRoundRobinPairings(
    weekNumber: number,
    teams: Team[],
    numRounds: number
  ): Array<{ team1: Team; team2: Team | null }> {
    const numTeams = teams.length;
    
    // Determine base week for cycle repetition (weeks beyond numRounds repeat the cycle)
    const baseWeek = ((weekNumber - 1) % numRounds) + 1;
    const roundIndex = baseWeek - 1;
    
    const pairs: Array<{ team1: Team; team2: Team | null }> = [];
    
    if (numTeams % 2 === 0) {
      // Even number of teams: Use circle method
      const fixedTeam = teams[0];
      const rotatingTeams = teams.slice(1);
      
      // Rotate teams
      const rotationOffset = roundIndex;
      const rotated = [
        ...rotatingTeams.slice(rotationOffset),
        ...rotatingTeams.slice(0, rotationOffset)
      ];
      
      // Pair fixed team with last team in rotated array
      pairs.push({
        team1: fixedTeam,
        team2: rotated[rotated.length - 1]
      });
      
      // Pair remaining teams (excluding the last one which is already paired with fixedTeam)
      // first with last, second with second-to-last, etc.
      const remainingTeams = rotated.slice(0, rotated.length - 1);
      const pairsToMake = Math.floor(remainingTeams.length / 2);
      for (let i = 0; i < pairsToMake; i++) {
        pairs.push({
          team1: remainingTeams[i],
          team2: remainingTeams[remainingTeams.length - 1 - i]
        });
      }
    } else {
      // Odd number of teams: Fixed team gets bye when rotationOffset is 0
      const fixedTeam = teams[0];
      const rotatingTeams = teams.slice(1);
      
      const rotationOffset = roundIndex % numTeams;
      const rotated = [
        ...rotatingTeams.slice(rotationOffset),
        ...rotatingTeams.slice(0, rotationOffset)
      ];
      
      if (rotationOffset === 0) {
        // Fixed team gets bye
        pairs.push({ team1: fixedTeam, team2: null });
        // Pair all rotating teams
        const pairsToMake = Math.floor(rotated.length / 2);
        for (let i = 0; i < pairsToMake; i++) {
          pairs.push({
            team1: rotated[i],
            team2: rotated[rotated.length - 1 - i]
          });
        }
      } else {
        // When rotationOffset !== 0, the team at position (rotationOffset - 1) in rotatingTeams gets the bye
        // This team is at index (rotationOffset - 1) in the original rotatingTeams array
        const byeTeamIndexInRotating = (rotationOffset - 1 + rotatingTeams.length) % rotatingTeams.length;
        const byeTeam = rotatingTeams[byeTeamIndexInRotating];
        
        // Give the bye team a solo pair
        pairs.push({ team1: byeTeam, team2: null });
        
        // Pair the remaining teams (fixedTeam + all rotatingTeams except the bye team)
        const teamsToPair = [fixedTeam, ...rotatingTeams.filter((_, idx) => idx !== byeTeamIndexInRotating)];
        const pairsToMake = Math.floor(teamsToPair.length / 2);
        for (let i = 0; i < pairsToMake; i++) {
          pairs.push({
            team1: teamsToPair[i],
            team2: teamsToPair[teamsToPair.length - 1 - i]
          });
        }
      }
    }
    
    return pairs;
  },

  async generateMatchupsForLeague(
    leagueId: string,
    teams: Team[],
    firstWeekStart: Date,
    forceRegenerate: boolean = false,
    regularSeasonWeeks?: number
  ): Promise<{ error: Error | null }> {
    try {
      if (teams.length < 2) {
        return { error: new Error('Need at least 2 teams to generate matchups') };
      }

      // Validate teams
      const teamsWithInvalidIds = teams.filter(t => !t.id);
      if (teamsWithInvalidIds.length > 0) {
        return { error: new Error(`Cannot generate matchups: ${teamsWithInvalidIds.length} teams have invalid IDs`) };
      }

      const teamIds = teams.map(t => t.id);
      const uniqueTeamIds = new Set(teamIds);
      if (teamIds.length !== uniqueTeamIds.size) {
        return { error: new Error('Cannot generate matchups: Duplicate team IDs found') };
      }

      // SCHEDULE-GEN (2026-08-16) — clamp the anchor to the season FIRST.
      // Every caller (draft-completion hook, Matchup-page self-heal, the
      // commissioner button) funnels through here, so this one line fixes
      // "offseason draft → zero weeks → zero matchups" everywhere. See
      // clampToSeasonStart in weekCalculator.ts for the full account.
      const effectiveFirstWeekStart = clampToSeasonStart(firstWeekStart);

      // Build fantasy weeks from available weeks. If regularSeasonWeeks is
      // provided (commissioner-configured), truncate so playoff weeks are NOT
      // populated by the regular-season round-robin scheduler.
      let allAvailableWeeks = getAvailableWeeks(effectiveFirstWeekStart);

      // SEASON-END TRIM (2026-08-16): the date-math season end is generous
      // (late April) but the real NHL slate can stop earlier — 2026-27's
      // final game is Apr 10, leaving the calculator's week 29 (Apr 12-18)
      // with ZERO NHL games. A fantasy week nobody can score in is a defect,
      // and worse, playoff generation keys off max(week). Probe the last
      // weeks against the ingested schedule and drop trailing gameless
      // weeks. FAIL-OPEN: any fetch error leaves the week list untouched
      // (getGamesForDateRange reports errors distinctly from empty weeks).
      try {
        const MAX_TRIM = 4;
        for (let i = 0; i < MAX_TRIM && allAvailableWeeks.length > 1; i++) {
          const lastWeek = allAvailableWeeks[allAvailableWeeks.length - 1];
          const { games, error: gamesErr } = await ScheduleService.getGamesForDateRange(
            getWeekStartDate(lastWeek, effectiveFirstWeekStart),
            getWeekEndDate(lastWeek, effectiveFirstWeekStart),
          );
          if (gamesErr || games.length > 0) break;
          allAvailableWeeks = allAvailableWeeks.slice(0, -1);
        }
      } catch {
        // fail-open: keep the untrimmed calendar-derived weeks
      }

      // PLAYOFF RESERVATION (2026-08-16): when the commissioner didn't set
      // regularSeasonWeeks, reserve the final calendar weeks for the
      // playoff bracket instead of round-robin-filling every week. The DB
      // playoff generators key off MAX(matchups.week_number), so stopping
      // the regular season 3 weeks short makes bracket weeks line up
      // automatically (start = MAX + 1) with real NHL games in them.
      // Previously the round-robin consumed the whole calendar and default
      // playoffs could never begin before the NHL season ended.
      // SETTINGS-DRIVEN RESERVATION (2026-08-17): reserve exactly the
      // commissioner's configured playoff length instead of a blanket 3.
      // playoffTeams 0 → no reservation (a no-playoff league gets every
      // week); playoffWeeks absent/invalid → legacy 3. Clamped 1..4 so a
      // bad setting can never consume the season. Fetched HERE (the choke
      // point) so every caller — draft-completion hook, Matchup self-heal,
      // commissioner button — honors the league's actual playoff shape.
      // FAIL-OPEN: any fetch error falls back to the proven 3-week reserve.
      let reserveWeeks = 3;
      try {
        const { league: leagueRow } = await LeagueService.getLeague(leagueId);
        const ls = (leagueRow?.settings ?? {}) as Record<string, unknown>;
        const pt = Number(ls.playoffTeams);
        const pw = Number(ls.playoffWeeks);
        if (Number.isFinite(pt) && pt <= 0) {
          reserveWeeks = 0;
        } else if (Number.isFinite(pw) && pw > 0) {
          reserveWeeks = Math.max(1, Math.min(4, Math.round(pw)));
        }
      } catch { /* fail-open: legacy 3-week reservation */ }

      const effectiveRegularWeeks = (regularSeasonWeeks && regularSeasonWeeks > 0)
        ? regularSeasonWeeks
        : (allAvailableWeeks.length > reserveWeeks + 5
            ? allAvailableWeeks.length - reserveWeeks
            : allAvailableWeeks.length);
      const availableWeeks = allAvailableWeeks.filter(w => w <= effectiveRegularWeeks);
      const formatLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

      const fantasyWeeks = availableWeeks.map(weekNumber => {
        const weekStart = getWeekStartDate(weekNumber, effectiveFirstWeekStart);
        const weekEnd = getWeekEndDate(weekNumber, effectiveFirstWeekStart);
        return {
          week_number: weekNumber,
          start_date: formatLocal(weekStart),
          end_date: formatLocal(weekEnd),
        };
      });

      // Delegate to server API for generation
      await matchupApi.generateMatchups(
        leagueId,
        teams.map(t => ({ id: t.id })),
        fantasyWeeks,
        forceRegenerate,
      );

      // FIRST-VISIT RACE FIX (2026-08-22, found live on prod during launch QA):
      // after generating, every cached matchup read for this league is stale —
      // including `matchups:user:{id}:w{n}`, which the Matchup page's
      // post-generation verify reads. Callers only invalidated the
      // `matchups:league:` prefix, so the verify saw the pre-generation empty
      // result from ~2s earlier and the page showed "matchup generation may
      // have failed" on a league whose schedule had just been written. This is
      // the choke point every generation path funnels through, so invalidate
      // both prefixes here rather than in each caller.
      matchupApi.invalidate(`matchups:league:${leagueId}`);
      matchupApi.invalidate(`matchups:user:${leagueId}`);
      matchupApi.invalidate(`matchups:playoffs:${leagueId}`);

      return { error: null };
    } catch (error: unknown) {
      logger.error('[MatchupService] Error generating matchups:', error);
      return { error: error instanceof Error ? error : new Error(String(error)) };
    }
  },

  /**
   * Get matchup for a specific week
   */
  async getMatchup(
    leagueId: string,
    weekNumber: number
  ): Promise<{ matchup: Matchup | null; error: Error | null }> {
    try {
      const response = await matchupApi.getLeagueMatchups(leagueId, weekNumber);
      const matchups = (response.data as Matchup[]) || [];
      return { matchup: matchups[0] || null, error: null };
    } catch (error: unknown) {
      return { matchup: null, error: error instanceof Error ? error : new Error(String(error)) };
    }
  },

  /**
   * Get matchup where user's team is involved
   */
  async getUserMatchup(
    leagueId: string,
    userId: string,
    weekNumber: number
  ): Promise<{ matchup: Matchup | null; error: Error | null }> {
    try {
      // Use API server which handles team lookup + matchup query in one round-trip
      const response = await matchupApi.getUserMatchup(leagueId, weekNumber);
      return { matchup: (response.data as Matchup) || null, error: null };
    } catch (error: unknown) {
      return { matchup: null, error: error instanceof Error ? error : new Error(String(error)) };
    }
  },

  /**
   * Get matchup data by matchup ID (for viewing other matchups in the league)
   * This allows viewing any matchup, not just the user's matchup
   */
  async getMatchupDataById(
    matchupId: string,
    userId: string,
    timezone: string = 'America/Denver'
  ): Promise<{ data: MatchupDataResponse | null; error: Error | null }> {
    try {
      // Get the matchup via API
      const matchupResponse = await matchupApi.getMatchup(matchupId);
      const matchupRaw = matchupResponse.data;
      if (!matchupRaw) {
        return { data: null, error: new Error('Matchup not found') };
      }
      // Extract matchup (API returns { ...matchup, lines })
      const matchup = matchupRaw as Matchup;

      // Get league via API
      const { leagueApi } = await import('@/api/leagues');
      const leagueResponse = await leagueApi.getLeague(matchup.league_id);
      // `leagueApi.getLeague` is declared `apiClient.get<League>`, so `.data`
      // is already a League. The old `as Record<string, unknown>` threw that
      // away and then paid it back one property at a time (`updated_at as
      // string`), which is how a typed endpoint ends up read as loose JSON.
      const league = leagueResponse.data;
      if (!league) {
        return { data: null, error: new Error('League not found') };
      }

      // Get first week start date
      // WEEK-MATH FIX (2026-08-22): clamp to season start like generation does
      const draftCompletionDate = league.updated_at ? new Date(league.updated_at) : new Date();
      const firstWeekStart = clampToSeasonStart(getFirstWeekStartDate(draftCompletionDate));
      const scheduleLength = getScheduleLength(firstWeekStart);
      const isPlayoffWeek = matchup.week_number > scheduleLength;

      // Get user's team to determine which side they're on (if they're in this matchup)
      // CRITICAL: Make this optional - if user isn't in matchup, that's fine, we'll use team1
      let userTeam = null;
      let isUserInMatchup = false;
      
      try {
        const { team } = await LeagueService.getUserTeam(matchup.league_id, userId);
        userTeam = team || null;
        isUserInMatchup = userTeam && (matchup.team1_id === userTeam.id || matchup.team2_id === userTeam.id);
      } catch (error: unknown) {
        // User might not be in this league/matchup - that's okay, we'll view as team1
        userTeam = null;
        isUserInMatchup = false;
      }
      
      // Determine which team is "user" team (if user is in matchup) or team1 (if viewing other matchup)
      const viewingTeamId = isUserInMatchup && userTeam 
        ? (matchup.team1_id === userTeam.id ? matchup.team1_id : matchup.team2_id)
        : matchup.team1_id;
      
      const opponentTeamId = viewingTeamId === matchup.team1_id ? matchup.team2_id : matchup.team1_id;

      // Get both teams
      const { teams } = await LeagueService.getLeagueTeams(matchup.league_id);
      const viewingTeam = teams.find(t => t.id === viewingTeamId);
      const opponentTeamObj = opponentTeamId ? teams.find(t => t.id === opponentTeamId) : null;

      if (!viewingTeam) {
        return { data: null, error: new Error('Viewing team not found') };
      }

      // Get roster player IDs for both teams
      const [viewingPlayerIds, opponentPlayerIds] = await Promise.all([
        this.getRosterPlayerIds(viewingTeam.id, matchup.league_id),
        opponentTeamObj ? this.getRosterPlayerIds(opponentTeamObj.id, matchup.league_id) : Promise.resolve([])
      ]);

      // Load all players for both teams
      const allPlayerIds = [...new Set([...viewingPlayerIds, ...opponentPlayerIds])];
      const allPlayers = allPlayerIds.length > 0 
        ? await PlayerService.getPlayersByIds(allPlayerIds.map(String))
        : [];

      // Get matchup rosters using existing function
      // getMatchupDataById always loads current rosters (no targetDate parameter)
      const { team1Roster, team2Roster, team1SlotAssignments, team2SlotAssignments, error: rostersError } =
        await this.getMatchupRosters(matchup, allPlayers, timezone, userId);

      if (rostersError) {
        return { data: null, error: rostersError };
      }

      // Determine which roster is viewing team and which is opponent
      const isViewingTeam1 = viewingTeam.id === matchup.team1_id;
      const viewingRoster = isViewingTeam1 ? team1Roster : team2Roster;
      const opponentRoster = isViewingTeam1 ? team2Roster : team1Roster;
      const viewingSlotAssignments = isViewingTeam1 ? team1SlotAssignments : team2SlotAssignments;
      const opponentSlotAssignments = isViewingTeam1 ? team2SlotAssignments : team1SlotAssignments;

      // Get records
      const viewingRecord = await this.getTeamRecord(viewingTeam.id, matchup.league_id, userId);
      const opponentRecord = opponentTeamObj 
        ? await this.getTeamRecord(opponentTeamObj.id, matchup.league_id, userId)
        : { wins: 0, losses: 0 };

      // Calculate daily scores
      const weekStartStr = matchup.week_start_date;
      const weekEndStr = matchup.week_end_date;
      
      let viewingDailyPoints: number[] = [];
      let opponentDailyPoints: number[] = [];

      try {
        const response = await matchupApi.getDailyScores(matchup.id);
        const dailyScoresData = response.data;
        if (dailyScoresData && Array.isArray(dailyScoresData)) {
          // The RPC returns entries per team — split by team_id
          const parseDailyScores = (teamId: string) => {
            const teamEntries = (dailyScoresData as Array<{ team_id: string; roster_date: string; daily_score: string | number }>)
              .filter((d) => d.team_id === teamId)
              .sort((a, b) => new Date(a.roster_date + 'T00:00:00').getTime() - new Date(b.roster_date + 'T00:00:00').getTime());
            return teamEntries.length > 0 ? teamEntries.map(d => parseFloat(String(d.daily_score)) || 0) : Array(7).fill(0);
          };
          viewingDailyPoints = parseDailyScores(viewingTeam.id);
          if (opponentTeamObj) {
            opponentDailyPoints = parseDailyScores(opponentTeamObj.id);
          }
        } else {
          viewingDailyPoints = Array(7).fill(0);
          opponentDailyPoints = Array(7).fill(0);
        }
      } catch (error: unknown) {
        viewingDailyPoints = Array(7).fill(0);
        opponentDailyPoints = Array(7).fill(0);
      }

      // Build response
      const response: MatchupDataResponse = {
        matchupId: matchup.id,
        matchup,
        currentWeek: matchup.week_number,
        scheduleLength,
        isPlayoffWeek,
        userTeam: {
          id: viewingTeam.id,
          name: viewingTeam.team_name,
          roster: viewingRoster,
          slotAssignments: viewingSlotAssignments,
          record: viewingRecord,
          dailyPoints: viewingDailyPoints
        },
        opponentTeam: opponentTeamObj ? {
          id: opponentTeamObj.id,
          name: opponentTeamObj.team_name,
          roster: opponentRoster,
          slotAssignments: opponentSlotAssignments,
          record: opponentRecord,
          dailyPoints: opponentDailyPoints
        } : null,
        navigation: {
          previousWeek: matchup.week_number > 1 ? matchup.week_number - 1 : null,
          nextWeek: matchup.week_number < scheduleLength ? matchup.week_number + 1 : null,
          previousMatchupId: null, // Could be calculated if needed
          nextMatchupId: null // Could be calculated if needed
        }
      };

      return { data: response, error: null };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('[MatchupService.getMatchupDataById] Error loading matchup:', {
        matchupId,
        userId,
        error: errorMessage,
        errorDetails: error
      });

      return {
        data: null,
        error: new Error(`Failed to load matchup: ${errorMessage}`)
      };
    }
  },

  /**
   * Get unified matchup data with all necessary information for the matchup page
   * This is the primary API contract for matchup data
   * @param existingMatchup Optional pre-fetched matchup object to avoid redundant query
   */
  async getMatchupData(
    leagueId: string,
    userId: string,
    weekNumber: number,
    timezone: string = 'America/Denver',
    existingMatchup?: Matchup | null,
    targetDate?: string // Optional: if provided and is past date, load frozen roster for that date
  ): Promise<{ data: MatchupDataResponse | null; error: Error | null }> {
    try {
      // Get league via API
      const { leagueApi } = await import('@/api/leagues');
      const leagueResponse = await leagueApi.getLeague(leagueId);
      // Same as getMatchupDataById above: getLeague is typed `<League>`, so the
      // response needs no re-description here.
      const league = leagueResponse.data;
      if (!league) {
        return { data: null, error: new Error('League not found') };
      }

      // Get first week start date
      const draftCompletionDate = league.updated_at ? new Date(league.updated_at) : new Date();
      const firstWeekStart = getFirstWeekStartDate(draftCompletionDate);
      const scheduleLength = getScheduleLength(firstWeekStart);
      const isPlayoffWeek = weekNumber > scheduleLength;

      // Get user's team via API
      const { leagueApi: leagueApiForTeam } = await import('@/api/leagues');
      const teamResponse = await leagueApiForTeam.getMyTeam(leagueId);
      const userTeam = teamResponse.data as Record<string, unknown> | null;
      if (!userTeam) {
        return { data: null, error: new Error('User team not found') };
      }

      // Cast to known shape after null check
      const userTeamData = userTeam as { id: string; team_name: string; [key: string]: unknown };

      // Use existingMatchup if provided, otherwise query
      let matchup: Matchup | null = null;
      if (existingMatchup) {
        matchup = existingMatchup;
      } else {
        const { matchup: queriedMatchup, error: matchupError } = await this.getUserMatchup(leagueId, userId, weekNumber);
        if (matchupError) throw matchupError;
        matchup = queriedMatchup;
      }

      if (!matchup) {
        logger.warn('[MatchupService.getMatchupData] No matchup found for week:', weekNumber);
        return { data: null, error: new Error(`No matchup found for week ${weekNumber}`) };
      }

      // Determine which team the user is (team1 or team2)
      const isTeam1 = matchup.team1_id === userTeamData.id;
      const opponentTeamId = isTeam1 ? matchup.team2_id : matchup.team1_id;

      // Get opponent team object
      let opponentTeamObj: Team | null = null;
      if (opponentTeamId) {
        const { teams } = await LeagueService.getLeagueTeams(leagueId);
        opponentTeamObj = teams.find(t => t.id === opponentTeamId) || null;
      }

      // CRITICAL: For frozen rosters (past dates), we need ALL players to find dropped players
      // For current rosters, we can optimize by loading only current team players
      const todayStr = getTodayMST();
      const isPastDate = targetDate && targetDate < todayStr;
      
      let rosterPlayers: Player[];
      if (isPastDate) {
        // For past dates: Load ALL players (needed to find dropped players in frozen lineups)
        rosterPlayers = await withTimeout(
          PlayerService.getAllPlayers(),
          15000,
          'getAllPlayers timeout for frozen roster'
        );
      } else {
        // For current/future dates: Optimized - Get roster player IDs first, then load only those players
        // This is much faster than loading all 1000+ players and filtering
        try {
          const [team1PlayerIds, team2PlayerIds] = await Promise.all([
            withTimeout(this.getRosterPlayerIds(matchup.team1_id, matchup.league_id), 5000, 'getRosterPlayerIds timeout for team1'),
            matchup.team2_id 
              ? withTimeout(this.getRosterPlayerIds(matchup.team2_id, matchup.league_id), 5000, 'getRosterPlayerIds timeout for team2')
              : Promise.resolve([])
          ]);
          
          // Combine and deduplicate player IDs
          const allRosterPlayerIds = [...new Set([...team1PlayerIds, ...team2PlayerIds])];
          
          if (allRosterPlayerIds.length === 0) {
            logger.warn('[MatchupService] No roster player IDs found. Roster may be empty.');
            rosterPlayers = []; // Return empty array instead of loading all players
          } else {
            // Load only roster players (much faster than loading all players)
            logger.debug('[getMatchupData] Loading players for IDs:', allRosterPlayerIds.length);
            rosterPlayers = await withTimeout(
              PlayerService.getPlayersByIds(allRosterPlayerIds.map(String)),
              10000,
              'getPlayersByIds timeout'
            );
            logger.debug('[getMatchupData] PlayerService returned:', rosterPlayers.length, 'players');

            // If optimized loading returned fewer players than expected, log warning but don't fallback
            if (rosterPlayers.length < allRosterPlayerIds.length * 0.8) {
              logger.warn('[MatchupService] Optimized loading returned fewer players than expected:', {
                expected: allRosterPlayerIds.length,
                received: rosterPlayers.length
              });
              // Continue with partial roster rather than loading all players
            }
          }
        } catch (error: unknown) {
          logger.error('[MatchupService] Error in optimized roster loading:', error);
          // DO NOT fallback to getAllPlayers - it causes 504 timeouts
          // Return empty array and let UI show error
          rosterPlayers = [];
        }
      }

      // Get rosters for both teams
      const {
        team1Roster,
        team2Roster,
        team1SlotAssignments,
        team2SlotAssignments,
        error: rostersError
      } = await this.getMatchupRosters(matchup, rosterPlayers, timezone, userId, targetDate);

      logger.debug('[getMatchupData] getMatchupRosters returned:', {
        team1Roster: team1Roster.length,
        team2Roster: team2Roster.length,
        hasError: !!rostersError
      });

      if (rostersError) {
        return { data: null, error: rostersError };
      }

      // Normalize slot assignments
      const normalizeSlotAssignments = (assignments: Record<string, string>): Record<string, string> => {
        const normalized: Record<string, string> = {};
        Object.entries(assignments).forEach(([playerId, slotId]) => {
          normalized[String(playerId)] = slotId;
        });
        return normalized;
      };

      // Assign rosters based on which team user is
      const userRoster = isTeam1 ? team1Roster : (team2Roster || []);
      const opponentRoster = isTeam1 ? (team2Roster || []) : team1Roster;
      const userSlotAssignments = normalizeSlotAssignments(isTeam1 ? team1SlotAssignments : team2SlotAssignments);
      const opponentSlotAssignments = normalizeSlotAssignments(isTeam1 ? team2SlotAssignments : team1SlotAssignments);

      // Get team records
      const userRecord = await this.getTeamRecord(userTeamData.id, leagueId, userId);
      const opponentRecord = opponentTeamObj ? await this.getTeamRecord(opponentTeamObj.id, leagueId, userId) : { wins: 0, losses: 0 };

      // Calculate daily points
      const matchupStatus = matchup.status;
      const team1Score = parseFloat(String(matchup.team1_score)) || 0;
      const team2Score = parseFloat(String(matchup.team2_score)) || 0;
      const hasScores = team1Score > 0 || team2Score > 0;
      // Calculate daily scores using fantasy_daily_rosters and NHL official stats
      let userDailyPoints: number[] = [];
      let opponentDailyPoints: number[] = [];

      // Get week dates — use string dates directly to avoid timezone issues
      // new Date("YYYY-MM-DD") parses as UTC midnight, which shifts in local time
      const weekStartStr = matchup.week_start_date;
      const weekEndStr = matchup.week_end_date;

      // Calculate daily scores via API (single call for both teams)
      try {
        const response = await matchupApi.getDailyScores(matchup.id);
        const dailyScoresData = response.data;
        if (dailyScoresData && Array.isArray(dailyScoresData)) {
          const parseDailyScores = (teamId: string) => {
            const teamEntries = (dailyScoresData as Array<{ team_id: string; roster_date: string; daily_score: string | number }>)
              .filter((d) => d.team_id === teamId)
              .sort((a, b) => new Date(a.roster_date + 'T00:00:00').getTime() - new Date(b.roster_date + 'T00:00:00').getTime());
            return teamEntries.length > 0 ? teamEntries.map(d => parseFloat(String(d.daily_score)) || 0) : Array(7).fill(0);
          };
          userDailyPoints = parseDailyScores(userTeamData.id);
          if (opponentTeamObj) {
            opponentDailyPoints = parseDailyScores(opponentTeamObj.id);
          }
        } else {
          userDailyPoints = Array(7).fill(0);
          opponentDailyPoints = Array(7).fill(0);
        }
      } catch (error: unknown) {
        logger.error('[getMatchupData] Exception calculating daily scores:', error);
        userDailyPoints = Array(7).fill(0);
        opponentDailyPoints = Array(7).fill(0);
      }

      // Calculate navigation metadata
      const availableWeeks = getAvailableWeeks(firstWeekStart);
      const currentWeekIndex = availableWeeks.indexOf(weekNumber);
      const previousWeek = currentWeekIndex > 0 ? availableWeeks[currentWeekIndex - 1] : null;
      const nextWeek = currentWeekIndex < availableWeeks.length - 1 ? availableWeeks[currentWeekIndex + 1] : null;

      // Get previous/next matchup IDs
      let previousMatchupId: string | null = null;
      let nextMatchupId: string | null = null;

      // These two only feed the previous/next arrows in the week switcher.
      // They were awaited one after the other on the critical path — two round
      // trips, ~700ms on the latency this page sees, to decide whether an arrow
      // is enabled. At minimum they run together.
      const [prevResult, nextResult] = await Promise.all([
        previousWeek ? this.getUserMatchup(leagueId, userId, previousWeek) : Promise.resolve(null),
        nextWeek ? this.getUserMatchup(leagueId, userId, nextWeek) : Promise.resolve(null),
      ]);
      previousMatchupId = prevResult?.matchup?.id || null;
      nextMatchupId = nextResult?.matchup?.id || null;

      // Build response
      const response: MatchupDataResponse = {
        matchupId: matchup.id,
        matchup, // Include full matchup object
        currentWeek: weekNumber,
        scheduleLength,
        isPlayoffWeek,
        userTeam: {
          id: userTeamData.id,
          name: userTeamData.team_name,
          roster: userRoster,
          slotAssignments: userSlotAssignments,
          record: userRecord,
          dailyPoints: userDailyPoints
        },
        opponentTeam: opponentTeamObj ? {
          id: opponentTeamObj.id,
          name: opponentTeamObj.team_name,
          roster: opponentRoster,
          slotAssignments: opponentSlotAssignments,
          record: opponentRecord,
          dailyPoints: opponentDailyPoints
        } : null,
        navigation: {
          previousWeek,
          nextWeek,
          previousMatchupId,
          nextMatchupId
        }
      };

      return { data: response, error: null };
    } catch (error: unknown) {
      logger.error('Error getting matchup data:', error);
      return { data: null, error: error instanceof Error ? error : new Error(String(error)) };
    }
  },

  /**
   * Clear roster cache (call this when rosters change)
   * @param teamId - Optional: clear cache for specific team, or all teams if not provided
   * @param leagueId - Optional: clear cache for specific league
   */
  clearRosterCache(teamId?: string, leagueId?: string): void {
    if (teamId && leagueId) {
      // Clear specific team's cache
      const key = getRosterCacheKey(teamId, leagueId);
      rosterCache.delete(key);
    } else if (leagueId) {
      // Clear all teams in a league
      const keysToDelete: string[] = [];
      rosterCache.forEach((_, key) => {
        if (key.startsWith(`${leagueId}:`)) {
          keysToDelete.push(key);
        }
      });
      keysToDelete.forEach(key => rosterCache.delete(key));
    } else {
      // Clear all caches
      rosterCache.clear();
    }
  },

  /**
   * Get roster player IDs for a team (optimized helper)
   * Routes through the API server which uses admin client — bypasses RLS.
   * Critical for AI teams (owner_id = NULL) whose roster_assignments
   * are not visible through user-scoped Supabase clients.
   */
  async getRosterPlayerIds(teamId: string, leagueId: string): Promise<string[]> {
    try {
      const { rosterApi } = await import('@/api/rosters');
      const response = await rosterApi.getPlayerIds(leagueId, teamId);
      return (response.data as string[]) || [];
    } catch (error: unknown) {
      logger.error('Error getting roster player IDs via API:', error);
      return [];
    }
  },

  async getTeamRoster(
    teamId: string,
    leagueId: string,
    allPlayers: Player[]
  ): Promise<HockeyPlayer[]> {
    try {
      // Check cache first
      const cacheKey = getRosterCacheKey(teamId, leagueId);
      const now = Date.now();
      const cached = rosterCache.get(cacheKey);
      
      if (cached && (now - cached.timestamp) < ROSTER_CACHE_TTL) {
        return cached.roster;
      }

      // Route through API server which uses admin client — bypasses RLS.
      // Critical for AI teams (owner_id = NULL) whose roster_assignments
      // are not visible through user-scoped Supabase clients.
      // For demo league guests, use the public endpoint (no auth required).
      let playerIds: string[];
      try {
        if (leagueId === DEMO_LEAGUE_ID_FOR_GUESTS) {
          const { publicApi } = await import('@/api/public');
          const response = await publicApi.getPlayerIds(leagueId, teamId);
          playerIds = (response.data as string[]) || [];
        } else {
          const { rosterApi } = await import('@/api/rosters');
          const response = await rosterApi.getPlayerIds(leagueId, teamId);
          playerIds = (response.data as string[]) || [];
        }
      } catch (apiErr: unknown) {
        logger.error('Error fetching roster player IDs via API:', apiErr);
        playerIds = [];
      }

      // FALLBACK: If roster_assignments is empty, try draft_picks via API
      // SKIP for demo league — draftApi requires auth, and demo guests have no token
      if (playerIds.length === 0 && leagueId !== DEMO_LEAGUE_ID_FOR_GUESTS) {
        logger.warn(`[MatchupService.getTeamRoster] roster_assignments empty for team ${teamId} in league ${leagueId}, falling back to draft_picks`);
        try {
          const { draftApi } = await import('@/api/draft');
          const draftResponse = await draftApi.getDraftPicks(leagueId);
          const allPicks = (draftResponse.data as Array<{ player_id: string; team_id: string; league_id: string; deleted_at?: string }>) || [];
          const teamPicks = allPicks.filter(p => p.team_id === teamId && !p.deleted_at);
          if (teamPicks.length > 0) {
            playerIds = teamPicks.map(p => p.player_id);
          }
        } catch (draftErr) {
          logger.error('Error fetching draft picks via API:', draftErr);
        }
      }

      // First, try direct numeric ID matching (for new migrations using NHL IDs)
      const numericIds: number[] = [];
      const uuidIds: string[] = [];

      playerIds.forEach((id: string | number) => {
        if (typeof id === 'string') {
          // Check if it's a numeric string (NHL ID) or UUID
          const numId = parseInt(id);
          if (!isNaN(numId) && numId > 0 && !id.includes('-')) {
            // Numeric NHL ID (no dashes)
            numericIds.push(numId);
          } else if (id.includes('-')) {
            // UUID format
            uuidIds.push(id);
          }
        } else if (typeof id === 'number' && id > 0) {
          numericIds.push(id);
        }
      });

      // Match numeric IDs directly
      const teamPlayers = allPlayers.filter(p => numericIds.includes(Number(p.id)));
      logger.debug(`[getTeamRoster] team=${teamId.slice(0,8)} playerIds=${playerIds.length} numericIds=${numericIds.length} allPlayers=${allPlayers.length} matched=${teamPlayers.length}`);

      // If we have UUIDs, look them up via player API and match by name/team
      if (uuidIds.length > 0) {
        try {
          const { playerApi } = await import('@/api/players');
          const uuidResponse = await playerApi.getPlayersByIds(uuidIds);
          const uuidPlayers = (uuidResponse.data as Array<{ id: string; full_name: string; team: string }>) || [];
          uuidPlayers.forEach((uuidPlayer) => {
            const matched = allPlayers.find(p =>
              p.full_name === uuidPlayer.full_name &&
              p.team === uuidPlayer.team
            );
            if (matched && !teamPlayers.find(tp => tp.id === matched.id)) {
              teamPlayers.push(matched);
            }
          });
        } catch (uuidErr) {
          logger.error('Error looking up UUID players via API:', uuidErr);
        }
      }

      // Transform to HockeyPlayer format
      const roster = teamPlayers.map((p) => this.transformToHockeyPlayer(p));

      // Cache the result
      rosterCache.set(cacheKey, { roster, timestamp: now });

      return roster;
    } catch (error: unknown) {
      logger.error('Error getting team roster:', error);
      return [];
    }
  },

  /**
   * Helper to transform Player to HockeyPlayer format
   */
  transformToHockeyPlayer(p: Player): HockeyPlayer {
    return {
      id: p.id,
      name: p.full_name,
      position: p.position,
      number: parseInt(p.jersey_number || '0'),
      starter: false, // Will be determined by lineup
      roster_status: p.roster_status,
      is_ir_eligible: p.is_ir_eligible,
      stats: {
        // For goalies, use goalie_gp instead of games_played
        gamesPlayed: (p.position === 'G' || p.position === 'Goalie') && p.goalie_gp
          ? p.goalie_gp
          : (p.games_played || 0),
        goals: p.goals || 0,
        assists: p.assists || 0,
        points: p.points || 0,
        plusMinus: p.plus_minus || 0,
        shots: p.shots || 0,
        hits: p.hits || 0,
        blockedShots: p.blocks || 0,
        xGoals: p.xGoals || 0,
        pim: p.pim || 0,
        powerPlayPoints: p.ppp || 0,
        shortHandedPoints: p.shp || 0,
        wins: p.wins || 0,
        losses: p.losses || 0,
        otl: p.ot_losses || 0,
        gaa: p.goals_against_average || 0,
        savePct: p.save_percentage || 0,
        shutouts: p.shutouts || 0,
        saves: p.saves || 0,
        goalsAgainst: p.goals_against || 0,
        goalsSavedAboveExpected: p.goalsSavedAboveExpected || 0
      },
      team: p.team,
      teamAbbreviation: p.team,
      status: p.status === 'injured' ? 'IR' : (p.status === 'active' ? null : 'WVR'),
      image: p.headshot_url || undefined,
      nextGame: { opponent: 'vs OPP', isToday: false },
      projectedPoints: p.games_played > 0
        ? new ScoringCalculator().calculatePointsPerGame({
            goals: p.goals || 0, assists: p.assists || 0, sog: p.shots || 0,
            blocks: p.blocks || 0, hits: p.hits || 0, pim: p.pim || 0,
            ppp: p.ppp || 0, shp: p.shp || 0
          }, false, p.games_played)
        : 0
    };
  },


  // In-flight request deduplication + result cache for daily projections
  _projectionInflight: new Map<string, Promise<Map<number, DailyProjectionRow>>>(),
  _projectionCache: new Map<string, { result: Map<number, DailyProjectionRow>; timestamp: number }>(),
  _PROJECTION_CACHE_TTL: 30_000,

  /**
   * Fetch daily projections for players from player_projected_stats table.
   * Deduplicates concurrent requests for the same date.
   */
  async getDailyProjectionsForMatchup(
    playerIds: number[],
    targetDate: string
  ): Promise<Map<number, DailyProjectionRow>> {
    if (!playerIds || playerIds.length === 0) {
      return new Map();
    }

    // Dedup key: use date + sorted player IDs for exact match
    const sortedIds = [...playerIds].sort((a, b) => a - b).join(',');
    const dedupKey = `${targetDate}:${sortedIds}`;

    // Check result cache first (avoids network call entirely)
    const cached = this._projectionCache.get(dedupKey);
    if (cached && Date.now() - cached.timestamp < this._PROJECTION_CACHE_TTL) {
      return cached.result;
    }

    // Check in-flight dedup
    const existing = this._projectionInflight.get(dedupKey);
    if (existing) {
      return existing;
    }

    const promise = (async () => {
      try {
        const response = await matchupApi.getDailyProjections(playerIds, targetDate);

        if (!response.data) {
          return new Map<number, DailyProjectionRow>();
        }

        // API returns Record<string, DailyProjectionRow> — convert to Map
        const projectionMap = new Map<number, DailyProjectionRow>();
        const projections = response.data as Record<string, DailyProjectionRow>;
        for (const [key, value] of Object.entries(projections)) {
          projectionMap.set(Number(key), value);
        }

        // Cache the result for subsequent calls
        this._projectionCache.set(dedupKey, { result: projectionMap, timestamp: Date.now() });
        return projectionMap;
      } catch (error: unknown) {
        logger.error('[MatchupService.getDailyProjections] ❌ API error:', error);
        return new Map<number, DailyProjectionRow>();
      } finally {
        this._projectionInflight.delete(dedupKey);
      }
    })();

    this._projectionInflight.set(dedupKey, promise);
    return promise;
  },

  /**
   * Transform HockeyPlayer to MatchupPlayer format with pre-fetched schedule data (optimized)
   */
  transformToMatchupPlayerWithGames(
    player: HockeyPlayer,
    isStarter: boolean,
    weekStart: Date,
    weekEnd: Date,
    timezone: string = 'America/Denver',
    games: NHLGame[],
    // SETTINGS-ENFORCEMENT (2026-08-16) — league scoring, threaded from
    // getMatchupRosters (which already extracts it at :1492). Undefined
    // → DEFAULT_SCORING, so default leagues are numerically identical.
    leagueScoring?: import('@citrus/shared').ScoringSettings,
    // MatchupWeekStats, not a hand-written subset. This parameter used to
    // redeclare the shape inline and omitted ppp, shp, hits, pim and
    // plus_minus -- five stats the body below reads and the caller does
    // supply, because fetchMatchupStatsForPlayers returns
    // Map<number, MatchupWeekStats>. The data was always there; only the
    // compiler could not see it, which cost 14 of the 62 baseline type
    // errors and made four SCORED categories look absent.
    matchupStats?: MatchupWeekStats,
    garPercentage?: number,
    dailyProjection?: DailyProjectionRow
  ): MatchupPlayer {
    // CRITICAL: Debug goalie detection and stats
    const isGoalie = player.position === 'G' || player.position === 'Goalie';
    if (isGoalie && !matchupStats) {
      logger.warn(`  ⚠️ NO MATCHUP STATS for goalie ${player.name}!`);
    }
    const teamAbbrev = player.teamAbbreviation || player.team || '';
    
    try {
      
      // Calculate games remaining (scheduled or live games from today onwards)
      // Test mode controlled via VITE_TEST_MODE environment variable (defaults to false)
      const TEST_MODE = import.meta.env.VITE_TEST_MODE === 'true';
      const TEST_DATE = import.meta.env.VITE_TEST_DATE || DEFAULT_TEST_DATE;
      const getTodayString = () => TEST_MODE ? TEST_DATE : getTodayMST(); // Use MST instead of UTC
      const getTodayDate = () => {
        if (TEST_MODE) {
          const date = new Date(TEST_DATE + 'T00:00:00');
          date.setHours(0, 0, 0, 0);
          return date;
        }
        return getTodayMSTDate(); // Use MST instead of local time
      };
      
      const today = getTodayDate();
      
      // CRITICAL: Filter games to ONLY matchup week (weekStart to weekEnd)
      // This prevents showing season totals instead of week totals
      // FIX: Use string comparison to avoid timezone issues with Date objects
      // Format weekStart/weekEnd as YYYY-MM-DD strings for comparison
      const formatDateStr = (d: Date) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };
      const weekStartStr = formatDateStr(weekStart);
      const weekEndStr = formatDateStr(weekEnd);
      
      const weekGames = games.filter(g => {
        if (!g || !g.game_date) return false;
        // Extract just the date part (YYYY-MM-DD) for comparison
        const gameDateStr = g.game_date.split('T')[0];
        // String comparison works correctly for YYYY-MM-DD format
        return gameDateStr >= weekStartStr && gameDateStr <= weekEndStr;
      });
      
      // Calculate games remaining from week games only
      // Use string comparison to avoid timezone issues with new Date() UTC parsing
      const todayCompare = getTodayString();
      const gamesRemaining = weekGames.filter(g => {
        if (!g || !g.game_date) return false;
        const gameDateStr = g.game_date.split('T')[0];
        return gameDateStr >= todayCompare && (g.status === 'scheduled' || g.status === 'live');
      }).length;
      
      // Also calculate total games in week for validation
      const totalWeekGames = weekGames.length;

      // Check if team has a game today
      const todayStr = getTodayString();
      const todayGames = games.filter(g => g.game_date === todayStr);
      const hasGameToday = todayGames.length > 0;
      
      // Determine status based on today's games
      // Only show status for games that are actually today (December 8, 2025)
      // Remove "Yet to Play" - it's redundant with the TODAY badge
      let gameStatus: 'In Game' | 'Final' | null = null;
      if (hasGameToday && todayGames.length > 0) {
        const todayGame = todayGames[0];
        if (todayGame.status === 'live') {
          gameStatus = 'In Game';
        } else if (todayGame.status === 'final') {
          gameStatus = 'Final';
        }
        // Don't set status for 'scheduled' - just show the game info
      }
      
      // ONLY show game info for games that are actually TODAY (December 8, 2025)
      // Don't show future games - only show today's games
      let gameInfo: GameInfo | undefined = undefined;
      
      // Only set gameInfo if there's a game TODAY
      if (hasGameToday && todayGames.length > 0) {
        const todayGame = todayGames[0];
        gameInfo = ScheduleService.getGameInfo(todayGame, teamAbbrev, timezone);
      }

      // Only mark as "today" if there's actually a game scheduled for today (December 8, 2025)
      // hasGameToday is already correctly set based on todayStr comparison
      
      // Calculate fantasy points from matchup stats if available, otherwise use 0
      let fantasyPoints = 0;
      let blocks = 0; // Define blocks outside the if block to avoid ReferenceError
      if (matchupStats) {
        // CRITICAL: Check if player is a goalie and use appropriate scoring
        if (isGoalie && (matchupStats.wins !== undefined || matchupStats.saves !== undefined)) {
          // Goalie scoring: league settings, else DEFAULT_SCORING.goalie from @citrus/shared
          // CRITICAL: Validate that stats are for a week, not season
          // For a single week, max should be: ~7 wins, ~300 saves (very high week)
          const MAX_REASONABLE_WEEK_WINS = 7;
          const MAX_REASONABLE_WEEK_SAVES = 300;
          const MAX_REASONABLE_WEEK_SHUTOUTS = 3;
          
          const wins = matchupStats.wins || 0;
          const saves = matchupStats.saves || 0;
          const shutouts = matchupStats.shutouts || 0;
          const goals_against = matchupStats.goals_against || 0;
          
          // CRITICAL: Reject season totals - if stats are too high, they're season totals, not weekly
          if (wins > MAX_REASONABLE_WEEK_WINS || 
              saves > MAX_REASONABLE_WEEK_SAVES ||
              shutouts > MAX_REASONABLE_WEEK_SHUTOUTS) {
            logger.error(`[MatchupService.transformToMatchupPlayerWithGames] ❌ RPC returned SEASON TOTALS for goalie ${player.name} (ID: ${player.id}): W=${wins}, SV=${saves}, SO=${shutouts} - REJECTING and using 0 points`);
            logger.error(`  Week: ${weekStart.toISOString().split('T')[0]} to ${weekEnd.toISOString().split('T')[0]}`);
            fantasyPoints = 0; // Reject season totals from RPC
          } else {
            // Goalie fantasy scoring using centralized ScoringCalculator
            const goalieScorer = new ScoringCalculator(leagueScoring);
            fantasyPoints = goalieScorer.calculatePoints({
              wins, saves, shutouts, goals_against
            }, true);

          }
        } else {
          // Skater scoring using centralized ScoringCalculator
          // CRITICAL: Validate that stats are for a week, not season
          // For a single week, max should be: ~7 goals, ~10 assists, ~30 SOG (very high week)
          const MAX_REASONABLE_WEEK_GOALS = 10;
          const MAX_REASONABLE_WEEK_ASSISTS = 15;
          const MAX_REASONABLE_WEEK_SOG = 40;

          if (matchupStats.goals > MAX_REASONABLE_WEEK_GOALS ||
              matchupStats.assists > MAX_REASONABLE_WEEK_ASSISTS ||
              matchupStats.sog > MAX_REASONABLE_WEEK_SOG) {
            logger.error(`[MatchupService.transformToMatchupPlayerWithGames] ❌ RPC returned season totals for ${player.name}: G=${matchupStats.goals}, A=${matchupStats.assists}, SOG=${matchupStats.sog} - REJECTING and using 0 points`);
            fantasyPoints = 0; // Reject season totals from RPC
            blocks = 0;
          } else {
            // CRITICAL: Use blocks from matchup week stats, NOT season stats
            blocks = matchupStats.blocks || 0; // Get from matchup week stats
            const skaterScorer = new ScoringCalculator(leagueScoring);
            fantasyPoints = skaterScorer.calculatePoints({
              goals: matchupStats.goals, assists: matchupStats.assists,
              sog: matchupStats.sog, blocks,
              ppp: matchupStats.ppp || 0, shp: matchupStats.shp || 0,
              hits: matchupStats.hits || 0, pim: matchupStats.pim || 0
            }, false);
          }
        }
        
      } else {
        // Log when matchupStats is missing
        if (Math.random() < 0.1) {
          logger.warn(`[MatchupService.transformToMatchupPlayerWithGames] No matchupStats for ${player.name}, using 0 points`);
        }
      }

      // isGoalie already checked above

      // SEASON skater line. `MatchupPlayer.stats` is REQUIRED, and this
      // literal used to omit it and patch it on afterwards in both branches
      // below -- so the object only became a MatchupPlayer somewhere after it
      // was declared as one. Same values, same order of evaluation, computed
      // once here where the type asks for them.
      const seasonStats: MatchupPlayer['stats'] = isGoalie
        ? {
            // Zeroed for goalies (their numbers live on goalieStats), but the
            // key is kept so consumers can read .stats.goals unconditionally.
            goals: 0,
            assists: 0,
            sog: 0,
            blk: 0,
            gamesPlayed: 0,
            xGoals: 0
          }
        : {
            goals: player.stats?.goals || 0,
            assists: player.stats?.assists || 0,
            sog: player.stats?.shots || 0,  // Note: HockeyPlayer uses 'shots', not 'sog'
            blk: player.stats?.blockedShots || 0,
            gamesPlayed: player.stats?.gamesPlayed || 0,
            xGoals: player.stats?.xGoals || 0,
            powerPlayPoints: player.stats?.powerPlayPoints || 0
          };

      // Base player object
      const basePlayer: MatchupPlayer = {
        id: typeof player.id === 'string' ? parseInt(player.id) || 0 : player.id || 0,
        name: player.name,
        position: player.position,
        team: teamAbbrev,
        image: player.image || undefined,
        points: fantasyPoints || 0,
        total_points: fantasyPoints || 0,
        gamesRemaining,
        games_remaining_total: gamesRemaining,
        games_remaining_active: isStarter ? gamesRemaining : 0,
        status: gameStatus,
        isStarter,
        isGoalie,
        garPercentage: garPercentage,
        isToday: hasGameToday,
        gameInfo,
        games: weekGames,
        // IR Status fields from player object (populated from player_talent_metrics via PlayerService)
        roster_status: player.roster_status,
        is_ir_eligible: player.is_ir_eligible,
        stats: seasonStats
      };
      
      // Handle goalies separately
      if (isGoalie) {
        // Goalie stats from player.stats (season-long)
        // Note: HockeyPlayer.stats uses gaa and savePct (not goalsAgainstAverage/savePercentage)
        // For goalies, gamesPlayed should use goalie_gp (which is already set correctly in transformToHockeyPlayer)
        const goalieStats = {
          gamesPlayed: player.stats.gamesPlayed || 0, // This is already goalie_gp for goalies
          wins: player.stats.wins || 0,
          saves: player.stats.saves || 0,
          shutouts: player.stats.shutouts || 0,
          goalsAgainst: player.stats.goalsAgainst || 0,
          gaa: player.stats.gaa || 0,
          savePct: player.stats.savePct || 0,
          goalsSavedAboveExpected: player.stats.goalsSavedAboveExpected || 0
        };
        
        
        basePlayer.goalieStats = goalieStats;
        
        // Goalie matchup stats from matchupStats (weekly stats)
        if (matchupStats && (matchupStats.wins !== undefined || matchupStats.saves !== undefined)) {
          basePlayer.goalieMatchupStats = {
            wins: matchupStats.wins || 0,
            saves: matchupStats.saves || 0,
            shutouts: matchupStats.shutouts || 0,
            goalsAgainst: matchupStats.goals_against || 0,
          };
        }
        
        // Goalie projection from dailyProjection
        if (dailyProjection && dailyProjection.is_goalie) {
          basePlayer.goalieProjection = {
            total_projected_points: Number(dailyProjection.total_projected_points || 0),
            projected_wins: Number(dailyProjection.projected_wins || 0),
            projected_saves: Number(dailyProjection.projected_saves || 0),
            projected_shutouts: Number(dailyProjection.projected_shutouts || 0),
            projected_goals_against: Number(dailyProjection.projected_goals_against || 0),
            projected_gaa: Number(dailyProjection.projected_gaa || 0),
            projected_save_pct: Number(dailyProjection.projected_save_pct || 0),
            projected_gp: Number(dailyProjection.projected_gp || 0),
            starter_confirmed: Boolean(dailyProjection.starter_confirmed),
            confidence_score: Number(dailyProjection.confidence_score || 0),
            calculation_method: dailyProjection.calculation_method || 'probability_based_volume'
          };
        }
        
      } else {
        // Season skater stats already set from `seasonStats` above.
        basePlayer.matchupStats = matchupStats ? (isGoalie ? {
          // Goalie matchup stats
          wins: matchupStats.wins || 0,
          saves: matchupStats.saves || 0,
          shutouts: matchupStats.shutouts || 0,
          goals_against: matchupStats.goals_against || 0,
        } : {
          // Skater matchup stats - ALL 8 categories
          goals: matchupStats.goals || 0,
          assists: matchupStats.assists || 0,
          sog: matchupStats.sog || 0,
          blocks: matchupStats.blocks || 0,
          ppp: matchupStats.ppp || 0,
          shp: matchupStats.shp || 0,
          hits: matchupStats.hits || 0,
          pim: matchupStats.pim || 0,
          xGoals: matchupStats.xGoals || 0
        }) : undefined;
        
        // Skater projection - INCLUDE ALL 8 STATS
        if (dailyProjection && !dailyProjection.is_goalie) {
          basePlayer.daily_projection = {
            total_projected_points: Number(dailyProjection.total_projected_points || 0),
            projected_goals: Number(dailyProjection.projected_goals || 0),
            projected_assists: Number(dailyProjection.projected_assists || 0),
            projected_sog: Number(dailyProjection.projected_sog || 0),
            projected_blocks: Number(dailyProjection.projected_blocks || 0),
            // ALL 8 STATS - Critical for transparency
            projected_ppp: Number(dailyProjection.projected_ppp || 0),
            projected_shp: Number(dailyProjection.projected_shp || 0),
            projected_hits: Number(dailyProjection.projected_hits || 0),
            projected_pim: Number(dailyProjection.projected_pim || 0),
            projected_xg: Number(dailyProjection.projected_xg || 0),
            base_ppg: Number(dailyProjection.base_ppg || 0),
            shrinkage_weight: Number(dailyProjection.shrinkage_weight || 0),
            finishing_multiplier: Number(dailyProjection.finishing_multiplier || 1),
            opponent_adjustment: Number(dailyProjection.opponent_adjustment || 1),
            b2b_penalty: Number(dailyProjection.b2b_penalty || 1),
            home_away_adjustment: Number(dailyProjection.home_away_adjustment || 1),
            confidence_score: Number(dailyProjection.dynamic_confidence || dailyProjection.confidence_score || 0),
            calculation_method: dailyProjection.calculation_method || 'hybrid_bayesian',
            is_goalie: false,
            // Monte Carlo uncertainty (Citrus 3.1)
            likely_low: dailyProjection.likely_low != null ? Number(dailyProjection.likely_low) : undefined,
            likely_high: dailyProjection.likely_high != null ? Number(dailyProjection.likely_high) : undefined,
            confidence_label: dailyProjection.confidence_label || undefined,
            dynamic_confidence: dailyProjection.dynamic_confidence != null ? Number(dailyProjection.dynamic_confidence) : undefined,
            projection_mean: dailyProjection.projection_mean != null ? Number(dailyProjection.projection_mean) : undefined,
            projection_std_dev: dailyProjection.projection_std_dev != null ? Number(dailyProjection.projection_std_dev) : undefined,
          };
        }
      }
      
      return basePlayer;
    } catch (error: unknown) {
      logger.error(`Error transforming player ${player.name} to matchup player:`, error);
      // Return basic player info if schedule lookup fails
      return {
        id: typeof player.id === 'string' ? parseInt(player.id) || 0 : player.id || 0,
        name: player.name,
        position: player.position,
        team: teamAbbrev,
        image: player.image || undefined,
        points: 0, // Matchup points start at 0
        gamesRemaining: 0,
        status: null,
        isStarter,
        stats: {
          goals: player.stats.goals || 0,
          assists: player.stats.assists || 0,
          sog: player.stats.shots || 0,
          blk: player.stats.blockedShots || 0,
          gamesPlayed: player.stats.gamesPlayed || 0,
          xGoals: player.stats.xGoals || 0,
          powerPlayPoints: player.stats.powerPlayPoints || 0
        },
        matchupStats: undefined,
        garPercentage: undefined,
        isToday: false,
        gameInfo: undefined
      };
    }
  },

  /**
   * Transform HockeyPlayer to MatchupPlayer format with real schedule data
   * (Legacy method - now calls transformToMatchupPlayerWithGames after fetching games)
   */
  async transformToMatchupPlayer(
    player: HockeyPlayer,
    isStarter: boolean,
    weekStart: Date,
    weekEnd: Date,
    timezone: string = 'America/Denver'
  ): Promise<MatchupPlayer> {
    const teamAbbrev = player.teamAbbreviation || player.team || '';
    
    try {
      // Get games for this player's team in the matchup week
      const { games, error: gamesError } = await ScheduleService.getGamesForTeamInWeek(teamAbbrev, weekStart, weekEnd);
      
      if (gamesError) {
        logger.warn(`Error fetching games for ${teamAbbrev}:`, gamesError);
      }
      
      return this.transformToMatchupPlayerWithGames(player, isStarter, weekStart, weekEnd, timezone, games || [], undefined, undefined);
    } catch (error: unknown) {
      logger.error(`Error transforming player ${player.name} to matchup player:`, error);
      return this.transformToMatchupPlayerWithGames(player, isStarter, weekStart, weekEnd, timezone, [], undefined, undefined);
    }
  },

  /**
   * Get matchup rosters for both teams with real schedule data
   */
  async getMatchupRosters(
    matchup: Matchup,
    allPlayers: Player[],
    timezone: string = 'America/Denver',
    userId?: string, // Optional: required for logged-in users, not needed for guests viewing demo league
    targetDate?: string // Optional: if provided and is past date, use frozen roster for that date
  ): Promise<{
    team1Roster: MatchupPlayer[];
    team2Roster: MatchupPlayer[];
    team1SlotAssignments: Record<string, string>;
    team2SlotAssignments: Record<string, string>;
    error: Error | null
  }> {
    try {
      // Validate: Ensure team1_id !== team2_id (prevent duplicate teams)
      if (matchup.team2_id && matchup.team1_id === matchup.team2_id) {
        const error = new Error('Invalid matchup: team1 and team2 cannot be the same team');
        logger.error('Matchup validation error:', error);
        return {
          team1Roster: [],
          team2Roster: [],
          team1SlotAssignments: {},
          team2SlotAssignments: {},
          error
        };
      }

      // Get league to access scoring settings via API
      let league: League | null = null;
      const isDemoLeague = matchup.league_id === DEMO_LEAGUE_ID_FOR_GUESTS;
      if (isDemoLeague && !userId) {
        // Guest viewing demo league - use public API (no auth required)
        const { publicApi } = await import('@/api/public');
        const response = await publicApi.getLeague(matchup.league_id);
        league = (response.data as League) || null;
        if (!league) throw new Error('League not found');
      } else if (userId) {
        // Logged-in user - use membership check
        const result = await LeagueService.getLeague(matchup.league_id, userId);
        league = result.league;
        if (result.error) throw result.error;
      } else {
        throw new Error('userId required for non-demo leagues');
      }
      // `League.scoring_settings` (LeagueService.ts:37) declares every stat
      // OPTIONAL -- it is a jsonb column, so a row can carry a partial object --
      // while `ScoringSettings` requires all of them. `extractScoringSettings`
      // does `league.scoring_settings || DEFAULT_SCORING`: present-but-partial
      // is passed straight through, and ScoringCalculator then multiplies by an
      // `undefined` weight, scoring the whole matchup NaN. Fill per field from
      // DEFAULT_SCORING so a partial row degrades to defaults instead.
      const rawScoring = league?.scoring_settings;
      const scoringSettings: ScoringSettings = {
        skater: { ...DEFAULT_SCORING.skater, ...(rawScoring?.skater || {}) },
        goalie: { ...DEFAULT_SCORING.goalie, ...(rawScoring?.goalie || {}) }
      };
      const scorer = new ScoringCalculator(scoringSettings);

      // Get week date range
      // CRITICAL: Append 'T00:00:00' to force local-time parsing.
      // Without it, new Date("2026-03-01") is parsed as UTC midnight,
      // which in MST (UTC-7) becomes Feb 28 5pm — shifting the query window back 1 day.
      const weekStart = new Date(matchup.week_start_date + 'T00:00:00');
      const weekEnd = new Date(matchup.week_end_date + 'T00:00:00');

      // =============================================================================
      // YAHOO/SLEEPER FROZEN ROSTER LOGIC: Use daily lineup for past dates
      // =============================================================================
      // If targetDate is provided, check fantasy_daily_rosters first (per-day lineups).
      // Fall back to team_lineups (default lineup) if no daily roster exists.
      // =============================================================================
      const todayStr = getTodayMST();
      // CRITICAL: Ensure targetDate exists before using it
      let useFrozenRoster = targetDate !== undefined && targetDate !== null;
      
      if (useFrozenRoster && targetDate) {
        // Using frozen roster for past date
      } else {
        // Clear cache for current lineup (only needed when using team_lineups)
        this.clearRosterCache(matchup.team1_id, matchup.league_id);
        if (matchup.team2_id) {
          this.clearRosterCache(matchup.team2_id, matchup.league_id);
        }
      }
      
      // Get rosters: For frozen rosters (past dates), we'll fetch player data from frozen lineup
      // For current rosters (today/future), use getTeamRoster (current team players)
      let team1Roster: HockeyPlayer[], team2Roster: HockeyPlayer[];
      
      // Get lineups: Use frozen roster for past dates, current lineup for today/future
      let team1LineupResult, team2LineupResult;
      
      if (useFrozenRoster && targetDate) {
        // For past dates, use LeagueService.loadDailyRoster (same as Roster tab)
        // This ensures IDENTICAL query logic and results
        const [team1FrozenRoster, team2FrozenRoster] = await Promise.all([
          withTimeout(
            LeagueService.loadDailyRoster(matchup.team1_id, matchup.id, targetDate, allPlayers),
            5000,
            'loadDailyRoster timeout for team1'
          ),
          matchup.team2_id
            ? withTimeout(
                LeagueService.loadDailyRoster(matchup.team2_id, matchup.id, targetDate, allPlayers),
                5000,
                'loadDailyRoster timeout for team2'
              )
            : Promise.resolve(null)
        ]);
        
        if (!team1FrozenRoster) {
          logger.warn(`[MatchupService] No frozen roster found for team1 on ${targetDate}`);
          // Fall back to current roster
          useFrozenRoster = false;
        } else {
          // Extract lineup format from frozen roster
          team1LineupResult = {
            starters: team1FrozenRoster.starters.map(p => String(p.id)),
            bench: team1FrozenRoster.bench.map(p => String(p.id)),
            ir: team1FrozenRoster.ir.map(p => String(p.id)),
            slotAssignments: team1FrozenRoster.slotAssignments
          };
          
          team2LineupResult = team2FrozenRoster ? {
            starters: team2FrozenRoster.starters.map(p => String(p.id)),
            bench: team2FrozenRoster.bench.map(p => String(p.id)),
            ir: team2FrozenRoster.ir.map(p => String(p.id)),
            slotAssignments: team2FrozenRoster.slotAssignments
          } : null;
          
          // Build roster from frozen players (already have full Player objects)
          team1Roster = [
            ...team1FrozenRoster.starters,
            ...team1FrozenRoster.bench,
            ...team1FrozenRoster.ir
          ].map(p => this.transformToHockeyPlayer(p));
          
          team2Roster = team2FrozenRoster ? [
            ...team2FrozenRoster.starters,
            ...team2FrozenRoster.bench,
            ...team2FrozenRoster.ir
          ].map(p => this.transformToHockeyPlayer(p)) : [];
          
        }
      }
      
      if (!useFrozenRoster) {
        // For today/future dates, use current lineup from team_lineups
        [team1LineupResult, team2LineupResult] = await Promise.all([
          withTimeout(LeagueService.getLineup(matchup.team1_id, matchup.league_id), 5000, 'getLineup timeout for team1'),
          matchup.team2_id
            ? withTimeout(LeagueService.getLineup(matchup.team2_id, matchup.league_id), 5000, 'getLineup timeout for team2')
            : Promise.resolve(null)
        ]);
        
        // Get rosters from current team (for today/future dates)
        [team1Roster, team2Roster] = await Promise.all([
          withTimeout(this.getTeamRoster(matchup.team1_id, matchup.league_id, allPlayers), 5000, 'getTeamRoster timeout for team1'),
          matchup.team2_id
            ? withTimeout(this.getTeamRoster(matchup.team2_id, matchup.league_id, allPlayers), 5000, 'getTeamRoster timeout for team2')
            : Promise.resolve([])
        ]);
      }

      let team1Lineup = team1LineupResult;
      let team2Lineup = team2LineupResult;
      
      // Helper function to organize roster into default lineup
      const getFantasyPosition = (position: string): 'C' | 'LW' | 'RW' | 'D' | 'G' | 'UTIL' => {
        const pos = position?.toUpperCase() || '';
        if (['C', 'CENTRE', 'CENTER'].includes(pos)) return 'C';
        if (['LW', 'LEFT WING', 'LEFTWING', 'L'].includes(pos)) return 'LW';
        if (['RW', 'RIGHT WING', 'RIGHTWING', 'R'].includes(pos)) return 'RW';
        if (['D', 'DEFENCE', 'DEFENSE'].includes(pos)) return 'D';
        if (pos.includes('D') && !pos.includes('DEFENSIVE') && pos !== 'FD' && !pos.includes('LD') && !pos.includes('RD')) return 'D';
        if (['G', 'GOALIE', 'GOALTENDER'].includes(pos)) return 'G';
        return 'UTIL';
      };

      const organizeRosterIntoLineup = (roster: HockeyPlayer[]) => {
        const slotsNeeded = { 'C': 2, 'LW': 2, 'RW': 2, 'D': 4, 'G': 2, 'UTIL': 1 };
        const slotsFilled = { 'C': 0, 'LW': 0, 'RW': 0, 'D': 0, 'G': 0, 'UTIL': 0 };
        
        const starters: string[] = [];
        const bench: string[] = [];
        const ir: string[] = [];
        const slotAssignments: Record<string, string> = {};
        let irSlotIndex = 1;
        
        // Sort players by points (best players first).
        // `HockeyPlayer` has NO top-level `points` (HockeyPlayerCard.tsx:9) --
        // season points live at `stats.points`, which transformToHockeyPlayer
        // populates (:1055). `b.points - a.points` was `0 - 0` for every pair,
        // so this sort was a no-op and the default lineup below filled its
        // starting slots in whatever order the roster arrived in.
        const sortedRoster = [...roster].sort((a, b) => (b.stats?.points || 0) - (a.stats?.points || 0));
        
        sortedRoster.forEach(p => {
          // Handle IR/SUSP players
          if (p.status === 'IR' || p.status === 'SUSP') {
            if (irSlotIndex <= 3) {
              ir.push(String(p.id));
              slotAssignments[String(p.id)] = `ir-slot-${irSlotIndex}`;
              irSlotIndex++;
            } else {
              bench.push(String(p.id));
            }
            return;
          }
          
          const pos = getFantasyPosition(p.position);
          let assigned = false;
          
          // Try to fill position-specific slot first
          if (pos !== 'UTIL' && slotsFilled[pos] < slotsNeeded[pos]) {
            slotsFilled[pos]++;
            assigned = true;
            slotAssignments[String(p.id)] = `slot-${pos}-${slotsFilled[pos]}`;
          } else if (pos !== 'G' && slotsFilled['UTIL'] < slotsNeeded['UTIL']) {
            // Fill UTIL slot if available
            slotsFilled['UTIL']++;
            assigned = true;
            slotAssignments[String(p.id)] = 'slot-UTIL';
          }
          
          if (assigned) {
            starters.push(String(p.id));
          } else {
            bench.push(String(p.id));
          }
        });
        
        return { starters, bench, ir, slotAssignments };
      };

      // Auto-initialize missing lineups for teams
      // For non-demo leagues, save to database. For demo leagues, generate in-memory only
      // (guests can't write to team_lineups)
      if (!team1Lineup && team1Roster.length > 0) {
        const defaultLineup = organizeRosterIntoLineup(team1Roster);
        team1Lineup = defaultLineup;
        if (!isDemoLeague) {
          await LeagueService.saveLineup(matchup.team1_id, matchup.league_id, defaultLineup);
        }
      }

      if (matchup.team2_id && !team2Lineup && team2Roster.length > 0) {
        const defaultLineup = organizeRosterIntoLineup(team2Roster);
        team2Lineup = defaultLineup;
        if (!isDemoLeague) {
          await LeagueService.saveLineup(matchup.team2_id, matchup.league_id, defaultLineup);
        }
      }

      // Debug logging to help diagnose lineup sync issues
      if (team1Lineup) {
        // Team1 lineup loaded successfully
      } else {
        const error = new Error('This team has no saved lineup yet. Create a league and draft players to get started!');
        logger.warn('[MatchupService] No lineup found for team1:', matchup.team1_id);
        return {
          team1Roster: [],
          team2Roster: [],
          team1SlotAssignments: {},
          team2SlotAssignments: {},
          error
        };
      }

      if (matchup.team2_id && !team2Lineup) {
        const error = new Error('The opponent team has no saved lineup yet. Lineups will appear once the draft is completed.');
        logger.warn('[MatchupService] No lineup found for team2:', matchup.team2_id);
        return {
          team1Roster: [],
          team2Roster: [],
          team1SlotAssignments: {},
          team2SlotAssignments: {},
          error
        };
      }

      // Helper function to convert lineup IDs (UUIDs or numeric) to numeric NHL IDs
      // Lineups might have UUIDs from old migrations, but players have numeric NHL IDs
      const convertLineupIdsToNumeric = async (lineupIds: (string | number)[], teamId: string): Promise<Set<number>> => {
        const numericIds = new Set<number>();
        const uuidIds: string[] = [];
        
        // Separate numeric IDs from UUIDs
        lineupIds.forEach((id: string | number) => {
          if (typeof id === 'string') {
            const numId = parseInt(id);
            if (!isNaN(numId) && numId > 0 && !id.includes('-')) {
              // Numeric NHL ID (no dashes)
              numericIds.add(numId);
            } else if (id.includes('-')) {
              // UUID format - need to look up
              uuidIds.push(id);
            }
          } else if (typeof id === 'number' && id > 0) {
            numericIds.add(id);
          }
        });
        
        // If we have UUIDs, look them up via draft API and player API
        if (uuidIds.length > 0) {
          try {
            const { draftApi } = await import('@/api/draft');
            const draftResponse = await draftApi.getDraftPicks(matchup.league_id);
            const allTeamDraftPicks = ((draftResponse.data as Array<{ player_id: string; team_id: string; pick_number: number; deleted_at?: string }>) || [])
              .filter(p => p.team_id === teamId && !p.deleted_at)
              .sort((a, b) => a.pick_number - b.pick_number);

            if (allTeamDraftPicks.length > 0) {
              const roster = teamId === matchup.team1_id ? team1Roster : team2Roster;

              uuidIds.forEach((uuid: string) => {
                const pickIndex = allTeamDraftPicks.findIndex(p => p.player_id === uuid);
                if (pickIndex >= 0 && pickIndex < roster.length) {
                  const rosterPlayer = roster[pickIndex];
                  if (rosterPlayer && rosterPlayer.id) {
                    numericIds.add(Number(rosterPlayer.id));
                  }
                }
              });
            }

            // If we still have unmatched UUIDs, try fallback to players API
            if (numericIds.size < uuidIds.length + numericIds.size) {
              const unmatchedUuids = uuidIds.filter(uuid => {
                const pickIndex = allTeamDraftPicks.findIndex(p => p.player_id === uuid);
                return pickIndex < 0;
              });

              if (unmatchedUuids.length > 0) {
                const { playerApi } = await import('@/api/players');
                const uuidResponse = await playerApi.getPlayersByIds(unmatchedUuids);
                const uuidPlayers = (uuidResponse.data as Array<{ id: string; full_name: string; team: string }>) || [];
                uuidPlayers.forEach((uuidPlayer) => {
                  const matched = allPlayers.find(p =>
                    p.full_name === uuidPlayer.full_name &&
                    p.team === uuidPlayer.team
                  );
                  if (matched) {
                    numericIds.add(Number(matched.id));
                  }
                });
              }
            }
          } catch (draftErr) {
            logger.error('[convertLineupIdsToNumeric] Error via API:', draftErr);
          }
        }

        return numericIds;
      };
      
      // Convert lineup starter IDs to numeric NHL IDs for matching
      const team1StartersNumeric = await convertLineupIdsToNumeric(team1Lineup.starters || [], matchup.team1_id);
      const team1Starters = new Set(Array.from(team1StartersNumeric).map(id => String(id)));
      
      // Debug: Log conversion results
      // Normalize slot assignment keys to numeric NHL IDs (convert UUIDs if needed)
      // Annotated: the `|| {}` fallback put a bare `{}` in the union, which
      // left Object.entries below inferring its value type as `unknown`.
      const rawTeam1SlotAssignments: Record<string, string> = team1Lineup.slotAssignments || {};
      const team1SlotAssignments: Record<string, string> = {};
      
      // Build UUID to numeric ID mapping for slot assignments
      // Reuse the lookup from convertLineupIdsToNumeric by checking which UUIDs were converted
      const uuidToNumericMap = new Map<string, number>();
      const team1LineupIds = team1Lineup.starters || [];
      const slotUuidIds = Object.keys(rawTeam1SlotAssignments).filter(id => id.includes('-'));
      const allUuidIds = [
        ...team1LineupIds.filter((id: string | number) => typeof id === 'string' && id.includes('-')),
        ...slotUuidIds
      ];
      
      if (allUuidIds.length > 0) {
        try {
          const { playerApi } = await import('@/api/players');
          const uuidResponse = await playerApi.getPlayersByIds(allUuidIds);
          const uuidPlayers = (uuidResponse.data as Array<{ id: string; full_name: string; team: string }>) || [];
          uuidPlayers.forEach((uuidPlayer) => {
            const matched = allPlayers.find(p =>
              p.full_name === uuidPlayer.full_name &&
              p.team === uuidPlayer.team
            );
            if (matched) {
              uuidToNumericMap.set(uuidPlayer.id, Number(matched.id));
            }
          });
        } catch (uuidErr) {
          logger.error('[MatchupService] Error looking up UUID players for slot assignments:', uuidErr);
        }
      }

      Object.entries(rawTeam1SlotAssignments).forEach(([playerId, slotId]) => {
        // Convert UUID to numeric ID if needed, otherwise use as-is
        const numericId = uuidToNumericMap.get(playerId) || 
          (typeof playerId === 'string' && !playerId.includes('-') ? parseInt(playerId) : Number(playerId));
        if (numericId && !isNaN(numericId) && numericId > 0) {
          team1SlotAssignments[String(numericId)] = slotId;
        }
      });
      
      const team2StartersNumeric = matchup.team2_id && team2Lineup
        ? await convertLineupIdsToNumeric(team2Lineup.starters || [], matchup.team2_id)
        : new Set<number>();
      const team2Starters = matchup.team2_id && team2Lineup
        ? new Set(Array.from(team2StartersNumeric).map(id => String(id)))
        : new Set();
      
      const rawTeam2SlotAssignments: Record<string, string> = matchup.team2_id && team2Lineup
        ? (team2Lineup.slotAssignments || {})
        : {};
      const team2SlotAssignments: Record<string, string> = {};
      
      // Same UUID to numeric mapping for team2
      const team2UuidToNumericMap = new Map<string, number>();
      if (matchup.team2_id && team2Lineup) {
        const team2LineupIds = team2Lineup.starters || [];
        const slotUuidIds2 = Object.keys(rawTeam2SlotAssignments).filter(id => id.includes('-'));
        const allUuidIds2 = [
          ...team2LineupIds.filter((id: string | number) => typeof id === 'string' && id.includes('-')),
          ...slotUuidIds2
        ];
        
        if (allUuidIds2.length > 0) {
          try {
            const { playerApi } = await import('@/api/players');
            const uuidResponse2 = await playerApi.getPlayersByIds(allUuidIds2);
            const uuidPlayers2 = (uuidResponse2.data as Array<{ id: string; full_name: string; team: string }>) || [];
            uuidPlayers2.forEach((uuidPlayer) => {
              const matched = allPlayers.find(p =>
                p.full_name === uuidPlayer.full_name &&
                p.team === uuidPlayer.team
              );
              if (matched) {
                team2UuidToNumericMap.set(uuidPlayer.id, Number(matched.id));
              }
            });
          } catch (uuidErr2) {
            logger.error('[MatchupService] Error looking up UUID players for team2 slot assignments:', uuidErr2);
          }
        }
      }
      
      Object.entries(rawTeam2SlotAssignments).forEach(([playerId, slotId]) => {
        const numericId = team2UuidToNumericMap.get(playerId) || 
          (typeof playerId === 'string' && !playerId.includes('-') ? parseInt(playerId) : Number(playerId));
        if (numericId && !isNaN(numericId) && numericId > 0) {
          team2SlotAssignments[String(numericId)] = slotId;
        }
      });

      // Batch schedule queries: Get all unique teams from both rosters
      const allTeams = Array.from(new Set([
        ...team1Roster.map(p => p.teamAbbreviation || p.team || ''),
        ...team2Roster.map(p => p.teamAbbreviation || p.team || '')
      ].filter(team => team !== '')));

      // Collect all player IDs from both rosters
      const allPlayerIds = [
        ...team1Roster.map(p => typeof p.id === 'string' ? parseInt(p.id) || 0 : p.id || 0),
        ...team2Roster.map(p => typeof p.id === 'string' ? parseInt(p.id) || 0 : p.id || 0)
      ].filter(id => id > 0);

      const weekStartStr = weekStart.toISOString().split('T')[0];
      const weekEndStr = weekEnd.toISOString().split('T')[0];
      const todayMST = getTodayMST();
      const skipAuthedReads = isDemoLeague && !userId;

      /*
       * THESE FOUR ARE INDEPENDENT. THEY USED TO RUN ONE AFTER ANOTHER.
       *
       * Schedule, matchup lines, week stats and today's projections each need
       * only `allTeams` or `allPlayerIds`, both of which are known above — none
       * of them reads another's result. Run serially they cost four round
       * trips; on the ~350ms median this page sees, that is ~1.4s of the
       * ten-second load, spent waiting rather than fetching.
       *
       * Each keeps its own catch so the graceful degradation is unchanged: a
       * failure in any one still leaves an empty Map and a page that renders.
       * Promise.all is safe here precisely because nothing can reject.
       */
      const [gamesResult, matchupLines, matchupStatsMap, dailyProjectionsMap] = await Promise.all([
        withTimeout(
          ScheduleService.getGamesForTeams(allTeams, weekStart, weekEnd),
          10000,
          'getGamesForTeams timeout'
        ),

        // Skip for demo league guests — requires auth, and the page renders
        // fine without lines.
        (async (): Promise<Map<number, MatchupLineRow>> => {
          if (skipAuthedReads) return new Map<number, MatchupLineRow>();
          try {
            return await this.getMatchupLines(matchup.id);
          } catch (error: unknown) {
            logger.warn('[MatchupService] Failed to fetch matchup lines, continuing with empty data:', error);
            return new Map<number, MatchupLineRow>();
          }
        })(),

        (async () => {
          try {
            return await this.fetchMatchupStatsForPlayers(allPlayerIds, weekStart, weekEnd, skipAuthedReads);
          } catch (error: unknown) {
            logger.error('[MatchupService] ❌ Failed to fetch matchup stats:', error);
            // Same shape the successful path returns, so the union does not
            // narrow to the subset on the error branch.
            return new Map<number, MatchupWeekStats>();
          }
        })(),

        // Today only on the initial roster load; per-date projections load on
        // demand when the user picks a date in Matchup.tsx.
        (async (): Promise<Map<number, DailyProjectionRow>> => {
          if (skipAuthedReads) return new Map<number, DailyProjectionRow>();
          try {
            return await this.getDailyProjectionsForMatchup(allPlayerIds, todayMST);
          } catch (error: unknown) {
            logger.warn('[MatchupService] Failed to fetch daily projections, continuing without them:', error);
            return new Map<number, DailyProjectionRow>();
          }
        })(),
      ]);

      const { gamesByTeam } = gamesResult;

      // Sanity check on the week stats — a season-total-shaped number here
      // means the RPC returned the wrong window.
      if (matchupStatsMap.size > 0) {
        const playersWithStats = Array.from(matchupStatsMap.entries()).slice(0, 3);
        const highValuePlayers = playersWithStats.filter(([, stats]) => {
          const highSkaterStats = stats.goals > 20 || stats.assists > 30 || stats.sog > 100;
          const highGoalieStats = (stats.wins || 0) > 7 || (stats.saves || 0) > 300;
          return highSkaterStats || highGoalieStats;
        });
        if (highValuePlayers.length > 0) {
          logger.error(`  ❌ ${highValuePlayers.length} sample players have season-total-like numbers! RPC may be broken!`);
        }
      } else {
        logger.error('[MatchupService.getMatchupRosters] ❌ CRITICAL: Matchup stats map is EMPTY - no week data found!', {
          weekStart: weekStartStr,
          weekEnd: weekEndStr,
          playerCount: allPlayerIds.length,
          matchupId: matchup.id,
          samplePlayerIds: allPlayerIds.slice(0, 5)
        });
      }

      const garMap = new Map<number, number>();

      // Transform players with pre-fetched schedule data, matchup stats, GAR, and daily projections
      const team1MatchupPlayers = await Promise.all(
        team1Roster.map(p => {
          const playerId = typeof p.id === 'string' ? parseInt(p.id) || 0 : p.id || 0;
          // CRITICAL: Use uppercase for team lookup - gamesByTeam keys are normalized to uppercase
          const playerGames = gamesByTeam.get((p.teamAbbreviation || p.team || '').toUpperCase()) || [];
          const dailyProjection = dailyProjectionsMap.get(playerId);
          if (!dailyProjection && playerId > 0) {
            logger.warn(`[MatchupService] Team1 player ${p.name} (ID: ${playerId}) missing daily projection`);
          }
          const matchupStats = matchupStatsMap.get(playerId);
          
          // Check if player is a starter (convert ID to string for Set lookup)
          const isStarter = team1Starters.has(String(p.id));
          const isGoalieBeforeTransform = p.position === 'G' || p.position === 'Goalie';

          const transformed = this.transformToMatchupPlayerWithGames(
            p,
            isStarter,
            weekStart,
            weekEnd,
            timezone,
            playerGames,
            scoringSettings,
            matchupStats,
            garMap.get(playerId),
            dailyProjection
          );

          // Recalculate projection total_projected_points with league-specific scoring
          if (transformed.daily_projection && !transformed.isGoalie) {
            const dp = transformed.daily_projection;
            transformed.daily_projection.total_projected_points = scorer.calculatePoints({
              goals: dp.projected_goals || 0,
              assists: dp.projected_assists || 0,
              sog: dp.projected_sog || 0,
              blocks: dp.projected_blocks || 0,
              ppp: dp.projected_ppp || 0,
              shp: dp.projected_shp || 0,
              hits: dp.projected_hits || 0,
              pim: dp.projected_pim || 0,
            }, false);
          }
          if (transformed.goalieProjection && transformed.isGoalie) {
            const gp = transformed.goalieProjection;
            transformed.goalieProjection.total_projected_points = scorer.calculatePoints({
              wins: gp.projected_wins || 0,
              saves: gp.projected_saves || 0,
              shutouts: gp.projected_shutouts || 0,
              goals_against: gp.projected_goals_against || 0,
            }, true);
          }

          // Get calculated games remaining from transformed player (already filtered to week)
          const gamesRemaining = transformed.games_remaining_total || 0;

          // Merge matchup line data if available
          const matchupLine = matchupLines.get(playerId);

          // Helper function to calculate matchup week points from stats using league scoring settings
          const calculateMatchupWeekPoints = (stats: MatchupWeekStats | undefined, isGoalie: boolean = false): number => {
            if (!stats) return 0;
            
            if (isGoalie && (stats.wins !== undefined || stats.saves !== undefined)) {
              // Validate that stats are for a week, not season
              const MAX_REASONABLE_WEEK_WINS = 7;
              const MAX_REASONABLE_WEEK_SAVES = 300;
              
              if ((stats.wins || 0) > MAX_REASONABLE_WEEK_WINS || 
                  (stats.saves || 0) > MAX_REASONABLE_WEEK_SAVES) {
                logger.error(`[MatchupService] ❌ RPC returned season totals for goalie ${p.name}: W=${stats.wins || 0}, SV=${stats.saves || 0} - REJECTING and using 0 points`);
                return 0; // Reject season totals from RPC
              }
              
              // Use scorer with league-specific settings
              return scorer.calculatePoints(stats, true);
            } else {
              // Validate that stats are for a week, not season
              const MAX_REASONABLE_WEEK_GOALS = 10;
              const MAX_REASONABLE_WEEK_ASSISTS = 15;
              const MAX_REASONABLE_WEEK_SOG = 40;
              
              if (stats.goals > MAX_REASONABLE_WEEK_GOALS || 
                  stats.assists > MAX_REASONABLE_WEEK_ASSISTS || 
                  stats.sog > MAX_REASONABLE_WEEK_SOG) {
                logger.error(`[MatchupService] ❌ RPC returned season totals for ${p.name}: G=${stats.goals}, A=${stats.assists}, SOG=${stats.sog} - REJECTING and using 0 points`);
                return 0; // Reject season totals from RPC
              }
              
              // Use scorer with league-specific settings
              return scorer.calculatePoints(stats, false);
            }
          };
          
          if (matchupLine) {
            // CRITICAL: Always prefer matchupStats (from RPC) over database value
            // The database may have season totals, but RPC has correct weekly stats
            const MAX_REASONABLE_WEEK_POINTS = 100;
            let matchupWeekPoints: number;
            
            if (matchupStats) {
              // RPC returned weekly stats - always use them (they're the source of truth)
              const isGoaliePlayer = p.position === 'G' || p.position === 'Goalie';
              
              matchupWeekPoints = calculateMatchupWeekPoints(matchupStats, isGoaliePlayer);
              
              // Validate that RPC stats look reasonable for a week
              const isLikelySeasonTotal = isGoaliePlayer 
                ? ((matchupStats.wins || 0) > 7 || (matchupStats.saves || 0) > 300)
                : ((matchupStats.goals || 0) > 20 || (matchupStats.assists || 0) > 30 || (matchupStats.sog || 0) > 100);
              if (isLikelySeasonTotal) {
                logger.error(`[MatchupService] ❌ RPC RETURNED SEASON TOTALS for ${p.name} (${playerId}): ${isGoaliePlayer ? `W=${matchupStats.wins || 0}, SV=${matchupStats.saves || 0}` : `G=${matchupStats.goals || 0}, A=${matchupStats.assists || 0}, SOG=${matchupStats.sog || 0}`} - REJECTING and using 0`);
                matchupWeekPoints = 0; // Reject season totals from RPC
              }
              
              // Log if database value was suspicious (for debugging)
              if (matchupLine.total_points > MAX_REASONABLE_WEEK_POINTS) {
                logger.warn(`[MatchupService] ⚠️ Database had season totals (${matchupLine.total_points}) for ${p.name} (${playerId}), using RPC value (${matchupWeekPoints})`);
              }
            } else {
              // No RPC stats - player didn't play this week (injured, scratched, etc.)
              // Always set to 0, regardless of database value (database may have old/incorrect data)
              matchupWeekPoints = 0;
              
              // CRITICAL: Log when goalies have no matchupStats
              const isGoaliePlayer = p.position === 'G' || p.position === 'Goalie';
              if (isGoaliePlayer) {
                logger.warn(`[MatchupService.getMatchupRosters] ⚠️ GOALIE ${p.name} (${playerId}) has NO matchupStats from RPC!`, {
                  playerId,
                  weekStart: weekStart.toISOString().split('T')[0],
                  weekEnd: weekEnd.toISOString().split('T')[0],
                  databaseValue: matchupLine?.total_points || 'N/A'
                });
              }
              
              // Log if database had suspicious values (for debugging)
              if (matchupLine.total_points > MAX_REASONABLE_WEEK_POINTS) {
                logger.warn(`[MatchupService] ⚠️ No matchupStats for ${p.name} (${playerId}) - player didn't play this week. Database had ${matchupLine.total_points} (likely season totals), setting to 0.`, {
                  databaseValue: matchupLine.total_points,
                  playerId,
                  weekStart: weekStart.toISOString().split('T')[0],
                  weekEnd: weekEnd.toISOString().split('T')[0]
                });
              }
            }
            
            // CRITICAL: Set total_points to the validated/recalculated matchup week points
            transformed.total_points = matchupWeekPoints;
            transformed.points = matchupWeekPoints; // CRITICAL: Override season points with matchup week points
            transformed.games_played = matchupLine.games_played;
            
            // CRITICAL: Update stats.gamesPlayed to use weekly games_played
            if (transformed.stats) {
              transformed.stats.gamesPlayed = matchupLine.games_played || 0;
            }
            
            // Debug: Log final value being set (for ALL players with season totals to verify fix)
            if (matchupLine.total_points > MAX_REASONABLE_WEEK_POINTS) {
              const isGoaliePlayer = p.position === 'G' || p.position === 'Goalie';
              const debugScorer = new ScoringCalculator();
              const statsBreakdown = matchupStats ? (isGoaliePlayer ? {
                wins: matchupStats.wins || 0,
                saves: matchupStats.saves || 0,
                shutouts: matchupStats.shutouts || 0,
                goals_against: matchupStats.goals_against || 0,
                calculated: debugScorer.calculatePoints({
                  wins: matchupStats.wins || 0, saves: matchupStats.saves || 0,
                  shutouts: matchupStats.shutouts || 0, goals_against: matchupStats.goals_against || 0
                }, true)
              } : {
                goals: matchupStats.goals || 0,
                assists: matchupStats.assists || 0,
                sog: matchupStats.sog || 0,
                blocks: matchupStats.blocks || 0,
                calculated: debugScorer.calculatePoints({
                  goals: matchupStats.goals || 0, assists: matchupStats.assists || 0,
                  ppp: matchupStats.ppp || 0, shp: matchupStats.shp || 0,
                  sog: matchupStats.sog || 0, blocks: matchupStats.blocks || 0,
                  hits: matchupStats.hits || 0, pim: matchupStats.pim || 0
                }, false)
              }) : null;

            }

            // CRITICAL: Validate games_remaining values are reasonable (max 7 games per week)
            // If database has invalid data (e.g., season total), use calculated value
            const maxGamesPerWeek = 7;
            if (matchupLine.games_remaining_total > maxGamesPerWeek) {
              // Silently use calculated value - database has season totals, which is expected
              // Use calculated value from week games
              transformed.games_remaining_total = gamesRemaining;
              transformed.games_remaining_active = team1Starters.has(String(p.id)) ? gamesRemaining : 0;
            } else {
              transformed.games_remaining_total = matchupLine.games_remaining_total;
              transformed.games_remaining_active = matchupLine.games_remaining_active;
            }
            
            transformed.has_live_game = matchupLine.has_live_game;
            transformed.live_game_locked = matchupLine.live_game_locked;
            
            // CRITICAL: Calculate stats_breakdown from weekly matchupStats, not database (which may have season totals)
            if (matchupStats) {
              const isGoaliePlayer = p.position === 'G' || p.position === 'Goalie';
              
              // Use scorer to generate stat breakdown with league-specific settings
              transformed.stats_breakdown = scorer.getStatBreakdown(matchupStats, isGoaliePlayer);
            } else {
              // No weekly stats - player didn't play, breakdown should be empty/undefined
              transformed.stats_breakdown = undefined;
            }
            
            // Points already set above - matchupWeekPoints
          } else {
            // No matchup line data - calculate from matchup stats (matchup week only)
            const isGoaliePlayer = p.position === 'G' || p.position === 'Goalie';
            const calculatedPoints = calculateMatchupWeekPoints(matchupStats, isGoaliePlayer);
            transformed.total_points = calculatedPoints;
            transformed.points = calculatedPoints; // Use matchup week points, not season
            
            // Calculate stats_breakdown from weekly matchupStats using league scoring settings
            if (matchupStats) {
              transformed.stats_breakdown = scorer.getStatBreakdown(matchupStats, isGoaliePlayer);
            } else {
              transformed.stats_breakdown = undefined;
            }
            
            transformed.games_remaining_total = gamesRemaining;
            transformed.games_remaining_active = team1Starters.has(String(p.id)) ? gamesRemaining : 0;
          }
          
          // games array for GameLogosBar is already set by transformToMatchupPlayerWithGames
          // (filtered to weekGames only — do NOT overwrite with unfiltered playerGames)

          return transformed;
        })
      );

      const team2MatchupPlayers = await Promise.all(
        team2Roster.map(p => {
          const playerId = typeof p.id === 'string' ? parseInt(p.id) || 0 : p.id || 0;
          // CRITICAL: Use uppercase for team lookup - gamesByTeam keys are normalized to uppercase
          const playerGames = gamesByTeam.get((p.teamAbbreviation || p.team || '').toUpperCase()) || [];
          const dailyProjection = dailyProjectionsMap.get(playerId);
          if (!dailyProjection && playerId > 0) {
            logger.warn(`[MatchupService] Team2 player ${p.name} (ID: ${playerId}) missing daily projection`);
          }
          const matchupStats = matchupStatsMap.get(playerId);
          
          // CRITICAL: Log goalie stats before transformation
          const isGoalieBeforeTransform = p.position === 'G' || p.position === 'Goalie';

          const transformed = this.transformToMatchupPlayerWithGames(
            p,
            team2Starters.has(String(p.id)),
            weekStart,
            weekEnd,
            timezone,
            playerGames,
            scoringSettings,
            matchupStats,
            garMap.get(playerId),
            dailyProjection
          );

          // Recalculate projection total_projected_points with league-specific scoring
          if (transformed.daily_projection && !transformed.isGoalie) {
            const dp = transformed.daily_projection;
            transformed.daily_projection.total_projected_points = scorer.calculatePoints({
              goals: dp.projected_goals || 0,
              assists: dp.projected_assists || 0,
              sog: dp.projected_sog || 0,
              blocks: dp.projected_blocks || 0,
              ppp: dp.projected_ppp || 0,
              shp: dp.projected_shp || 0,
              hits: dp.projected_hits || 0,
              pim: dp.projected_pim || 0,
            }, false);
          }
          if (transformed.goalieProjection && transformed.isGoalie) {
            const gp = transformed.goalieProjection;
            transformed.goalieProjection.total_projected_points = scorer.calculatePoints({
              wins: gp.projected_wins || 0,
              saves: gp.projected_saves || 0,
              shutouts: gp.projected_shutouts || 0,
              goals_against: gp.projected_goals_against || 0,
            }, true);
          }

          // Get calculated games remaining from transformed player (already filtered to week)
          const gamesRemaining = transformed.games_remaining_total || 0;

          // Merge matchup line data if available
          const matchupLine = matchupLines.get(playerId);

          // Helper function to calculate matchup week points from stats using league scoring settings
          const calculateMatchupWeekPoints = (stats: MatchupWeekStats | undefined, isGoalie: boolean = false): number => {
            if (!stats) return 0;
            
            if (isGoalie && (stats.wins !== undefined || stats.saves !== undefined)) {
              // Validate that stats are for a week, not season
              const MAX_REASONABLE_WEEK_WINS = 7;
              const MAX_REASONABLE_WEEK_SAVES = 300;
              
              if ((stats.wins || 0) > MAX_REASONABLE_WEEK_WINS || 
                  (stats.saves || 0) > MAX_REASONABLE_WEEK_SAVES) {
                logger.error(`[MatchupService] ❌ RPC returned season totals for goalie ${p.name}: W=${stats.wins || 0}, SV=${stats.saves || 0} - REJECTING and using 0 points`);
                return 0; // Reject season totals from RPC
              }
              
              // Use scorer with league-specific settings
              return scorer.calculatePoints(stats, true);
            } else {
              // Validate that stats are for a week, not season
              const MAX_REASONABLE_WEEK_GOALS = 10;
              const MAX_REASONABLE_WEEK_ASSISTS = 15;
              const MAX_REASONABLE_WEEK_SOG = 40;
              
              if (stats.goals > MAX_REASONABLE_WEEK_GOALS || 
                  stats.assists > MAX_REASONABLE_WEEK_ASSISTS || 
                  stats.sog > MAX_REASONABLE_WEEK_SOG) {
                logger.error(`[MatchupService] ❌ RPC returned season totals for ${p.name}: G=${stats.goals}, A=${stats.assists}, SOG=${stats.sog} - REJECTING and using 0 points`);
                return 0; // Reject season totals from RPC
              }
              
              // Use scorer with league-specific settings
              return scorer.calculatePoints(stats, false);
            }
          };
          
          if (matchupLine) {
            // CRITICAL: Always prefer matchupStats (from RPC) over database value
            // The database may have season totals, but RPC has correct weekly stats
            const MAX_REASONABLE_WEEK_POINTS = 100;
            let matchupWeekPoints: number;
            
            if (matchupStats) {
              // RPC returned weekly stats - always use them (they're the source of truth)
              const isGoaliePlayer = p.position === 'G' || p.position === 'Goalie';
              
              matchupWeekPoints = calculateMatchupWeekPoints(matchupStats, isGoaliePlayer);
              
              // Validate that RPC stats look reasonable for a week
              const isLikelySeasonTotal = isGoaliePlayer 
                ? ((matchupStats.wins || 0) > 7 || (matchupStats.saves || 0) > 300)
                : ((matchupStats.goals || 0) > 20 || (matchupStats.assists || 0) > 30 || (matchupStats.sog || 0) > 100);
              if (isLikelySeasonTotal) {
                logger.error(`[MatchupService] ❌ RPC RETURNED SEASON TOTALS for ${p.name} (${playerId}): ${isGoaliePlayer ? `W=${matchupStats.wins || 0}, SV=${matchupStats.saves || 0}` : `G=${matchupStats.goals || 0}, A=${matchupStats.assists || 0}, SOG=${matchupStats.sog || 0}`} - REJECTING and using 0`);
                matchupWeekPoints = 0; // Reject season totals from RPC
              }
              
              // Log if database value was suspicious (for debugging)
              if (matchupLine.total_points > MAX_REASONABLE_WEEK_POINTS) {
                logger.warn(`[MatchupService] ⚠️ Database had season totals (${matchupLine.total_points}) for ${p.name} (${playerId}), using RPC value (${matchupWeekPoints})`);
              }
            } else {
              // No RPC stats - player didn't play this week (injured, scratched, etc.)
              // Always set to 0, regardless of database value (database may have old/incorrect data)
              matchupWeekPoints = 0;
              
              // CRITICAL: Log when goalies have no matchupStats
              const isGoaliePlayer = p.position === 'G' || p.position === 'Goalie';
              if (isGoaliePlayer) {
                logger.warn(`[MatchupService.getMatchupRosters] ⚠️ GOALIE ${p.name} (${playerId}) has NO matchupStats from RPC!`, {
                  playerId,
                  weekStart: weekStart.toISOString().split('T')[0],
                  weekEnd: weekEnd.toISOString().split('T')[0],
                  databaseValue: matchupLine?.total_points || 'N/A'
                });
              }
              
              // Log if database had suspicious values (for debugging)
              if (matchupLine.total_points > MAX_REASONABLE_WEEK_POINTS) {
                logger.warn(`[MatchupService] ⚠️ No matchupStats for ${p.name} (${playerId}) - player didn't play this week. Database had ${matchupLine.total_points} (likely season totals), setting to 0.`, {
                  databaseValue: matchupLine.total_points,
                  playerId,
                  weekStart: weekStart.toISOString().split('T')[0],
                  weekEnd: weekEnd.toISOString().split('T')[0]
                });
              }
            }
            
            // CRITICAL: Set total_points to the validated/recalculated matchup week points
            transformed.total_points = matchupWeekPoints;
            transformed.points = matchupWeekPoints; // CRITICAL: Override season points with matchup week points
            transformed.games_played = matchupLine.games_played;
            
            // CRITICAL: Update stats.gamesPlayed to use weekly games_played
            if (transformed.stats) {
              transformed.stats.gamesPlayed = matchupLine.games_played || 0;
            }
            
            // Debug: Log final value being set (for ALL players with season totals to verify fix)
            if (matchupLine.total_points > MAX_REASONABLE_WEEK_POINTS) {
              const isGoaliePlayer = p.position === 'G' || p.position === 'Goalie';
              const debugScorer2 = new ScoringCalculator();
              const statsBreakdown = matchupStats ? (isGoaliePlayer ? {
                wins: matchupStats.wins || 0,
                saves: matchupStats.saves || 0,
                shutouts: matchupStats.shutouts || 0,
                goals_against: matchupStats.goals_against || 0,
                calculated: debugScorer2.calculatePoints({
                  wins: matchupStats.wins || 0, saves: matchupStats.saves || 0,
                  shutouts: matchupStats.shutouts || 0, goals_against: matchupStats.goals_against || 0
                }, true)
              } : {
                goals: matchupStats.goals || 0,
                assists: matchupStats.assists || 0,
                sog: matchupStats.sog || 0,
                blocks: matchupStats.blocks || 0,
                calculated: debugScorer2.calculatePoints({
                  goals: matchupStats.goals || 0, assists: matchupStats.assists || 0,
                  ppp: matchupStats.ppp || 0, shp: matchupStats.shp || 0,
                  sog: matchupStats.sog || 0, blocks: matchupStats.blocks || 0,
                  hits: matchupStats.hits || 0, pim: matchupStats.pim || 0
                }, false)
              }) : null;

            }

            // CRITICAL: Validate games_remaining values are reasonable (max 7 games per week)
            // If database has invalid data (e.g., season total), use calculated value
            const maxGamesPerWeek = 7;
            if (matchupLine.games_remaining_total > maxGamesPerWeek) {
              // Silently use calculated value - database has season totals, which is expected
              // Use calculated value from week games
              transformed.games_remaining_total = gamesRemaining;
              transformed.games_remaining_active = team2Starters.has(String(p.id)) ? gamesRemaining : 0;
            } else {
              transformed.games_remaining_total = matchupLine.games_remaining_total;
              transformed.games_remaining_active = matchupLine.games_remaining_active;
            }
            
            transformed.has_live_game = matchupLine.has_live_game;
            transformed.live_game_locked = matchupLine.live_game_locked;
            
            // CRITICAL: Calculate stats_breakdown from weekly matchupStats, not database (which may have season totals)
            if (matchupStats) {
              const isGoaliePlayer = p.position === 'G' || p.position === 'Goalie';
              
              // Use scorer to generate stat breakdown with league-specific settings
              transformed.stats_breakdown = scorer.getStatBreakdown(matchupStats, isGoaliePlayer);
            } else {
              // No weekly stats - player didn't play, breakdown should be empty/undefined
              transformed.stats_breakdown = undefined;
            }
            
            // Points already set above - matchupWeekPoints
          } else {
            // No matchup line data - calculate from matchup stats (matchup week only)
            const isGoaliePlayer = p.position === 'G' || p.position === 'Goalie';
            const calculatedPoints = calculateMatchupWeekPoints(matchupStats, isGoaliePlayer);
            transformed.total_points = calculatedPoints;
            transformed.points = calculatedPoints; // Use matchup week points, not season
            
            // Calculate stats_breakdown from weekly matchupStats using league scoring settings
            if (matchupStats) {
              transformed.stats_breakdown = scorer.getStatBreakdown(matchupStats, isGoaliePlayer);
            } else {
              transformed.stats_breakdown = undefined;
            }
            
            transformed.games_remaining_total = gamesRemaining;
            transformed.games_remaining_active = team2Starters.has(String(p.id)) ? gamesRemaining : 0;
          }
          
          // games array for GameLogosBar is already set by transformToMatchupPlayerWithGames
          // (filtered to weekGames only — do NOT overwrite with unfiltered playerGames)

          return transformed;
        })
      );

      return {
        team1Roster: team1MatchupPlayers,
        team2Roster: team2MatchupPlayers,
        team1SlotAssignments,
        team2SlotAssignments,
        error: null
      };
    } catch (error: unknown) {
      logger.error('Error getting matchup rosters:', error);
      return {
        team1Roster: [],
        team2Roster: [],
        team1SlotAssignments: {},
        team2SlotAssignments: {},
        error: error instanceof Error ? error : new Error(String(error))
      };
    }
  },

  /**
   * Convert daily lineup (from getDailyLineup RPC) to standard lineup format
   * Used when loading frozen rosters for past dates
   * 
   * @param dailyLineup Array of DailyLineupPlayer from get_daily_lineup RPC
   * @returns Standard lineup format with starters, bench, ir, and slotAssignments, or null if empty
   */
  convertDailyLineupToLineupFormat(
    dailyLineup: DailyLineupPlayer[]
  ): { starters: string[]; bench: string[]; ir: string[]; slotAssignments: Record<string, string> } | null {
    if (!dailyLineup || dailyLineup.length === 0) {
      return null;
    }
    
    const starters: string[] = [];
    const bench: string[] = [];
    const ir: string[] = [];
    const slotAssignments: Record<string, string> = {};
    
    dailyLineup.forEach(player => {
      const playerId = String(player.player_id);
      
      // Categorize player by slot_type
      if (player.slot_type === 'active') {
        starters.push(playerId);
      } else if (player.slot_type === 'bench') {
        bench.push(playerId);
      } else if (player.slot_type === 'ir') {
        ir.push(playerId);
      }
      
      // Store slot assignment if available
      if (player.slot_id) {
        slotAssignments[playerId] = player.slot_id;
      }
    });
    
    return { starters, bench, ir, slotAssignments };
  },

  /**
   * Calculate team score from roster (using season totals for now)
   */
  calculateTeamScore(roster: MatchupPlayer[]): number {
    return roster.reduce((sum, player) => sum + player.points, 0);
  },

  /**
   * Get team record (wins/losses) directly from standings calculation
   * This ensures the matchup tab records always match the standings page
   */
  async getTeamRecord(teamId: string, leagueId: string, _userId: string): Promise<{ wins: number; losses: number }> {
    try {
      const response = await matchupApi.getTeamRecord(leagueId, teamId);
      const record = response.data as { wins: number; losses: number } | null;
      return record || { wins: 0, losses: 0 };
    } catch (error: unknown) {
      logger.error('Error getting team record:', error);
      return { wins: 0, losses: 0 };
    }
  },

  /**
   * Get matchup history between two teams
   */
  async getMatchupHistory(
    leagueId: string,
    team1Id: string,
    team2Id: string | null
  ): Promise<{ 
    matchups: Array<{ 
      week: number; 
      team1Id: string; 
      team2Id: string | null; 
      team1Score: number; 
      team2Score: number; 
      weekStart: Date 
    }>; 
    error: Error | null
  }> {
    try {
      if (!team2Id) {
        return { matchups: [], error: null };
      }

      const response = await matchupApi.getMatchupHistory(leagueId, team1Id, team2Id);
      const data = (response.data as Array<Record<string, unknown>>) || [];

      const matchups = data.map(m => ({
        week: m.week_number as number,
        team1Id: m.team1_id as string,
        team2Id: m.team2_id as string | null,
        team1Score: parseFloat(String(m.team1_score)) || 0,
        team2Score: parseFloat(String(m.team2_score)) || 0,
        weekStart: new Date((m.week_start_date as string) + 'T00:00:00')
      }));

      return { matchups, error: null };
    } catch (error: unknown) {
      logger.error('Error getting matchup history:', error);
      return { matchups: [], error: error instanceof Error ? error : new Error(String(error)) };
    }
  },

  /**
   * Get playoff bracket data for a league
   */
  async getPlayoffBracket(leagueId: string): Promise<{
    rounds: Array<{
      roundNumber: number;
      roundName: string; // "Quarterfinals", "Semifinals", "Finals"
      matchups: Matchup[];
    }>;
    bracketSize: number; // 4, 6, or 8
    error: Error | null;
  }> {
    try {
      // Get playoff bracket data via API
      const response = await matchupApi.getPlayoffBracket(leagueId);
      const bracketData = response.data as { teams?: Array<Record<string, unknown>>; matchups?: Matchup[]; settings?: Record<string, unknown> } | null;

      if (!bracketData) {
        return { rounds: [], bracketSize: 0, error: new Error('Failed to fetch playoff bracket') };
      }

      const numTeams = bracketData.teams?.length || 0;

      // Determine bracket size
      let bracketSize = 0;
      if (numTeams >= 8) bracketSize = 8;
      else if (numTeams >= 6) bracketSize = 6;
      else if (numTeams >= 4) bracketSize = 4;

      if (bracketSize === 0) {
        return { rounds: [], bracketSize: 0, error: new Error('Not enough teams for playoffs') };
      }

      const playoffMatchups = bracketData.matchups || [];

      // Organize matchups by round
      // Round 1 (Quarterfinals): First playoff week
      // Round 2 (Semifinals): Second playoff week (if bracket size >= 6)
      // Round 3 (Finals): Last playoff week
      const rounds: Array<{
        roundNumber: number;
        roundName: string;
        matchups: Matchup[];
      }> = [];

      if (!playoffMatchups || playoffMatchups.length === 0) {
        return { rounds: [], bracketSize, error: null };
      }

      // Group matchups by week number
      const matchupsByWeek = new Map<number, Matchup[]>();
      playoffMatchups.forEach((matchup: Matchup) => {
        const week = matchup.week_number;
        if (!matchupsByWeek.has(week)) {
          matchupsByWeek.set(week, []);
        }
        matchupsByWeek.get(week)!.push(matchup);
      });

      const playoffWeeks = Array.from(matchupsByWeek.keys()).sort((a, b) => a - b);

      // Determine round names based on bracket size
      let roundNumber = 1;
      for (const week of playoffWeeks) {
        let roundName = '';
        if (bracketSize === 8) {
          if (roundNumber === 1) roundName = 'Quarterfinals';
          else if (roundNumber === 2) roundName = 'Semifinals';
          else if (roundNumber === 3) roundName = 'Finals';
        } else if (bracketSize === 6) {
          if (roundNumber === 1) roundName = 'Quarterfinals';
          else if (roundNumber === 2) roundName = 'Semifinals';
          else if (roundNumber === 3) roundName = 'Finals';
        } else if (bracketSize === 4) {
          if (roundNumber === 1) roundName = 'Semifinals';
          else if (roundNumber === 2) roundName = 'Finals';
        }

        if (roundName) {
          rounds.push({
            roundNumber,
            roundName,
            matchups: matchupsByWeek.get(week) || []
          });
          roundNumber++;
        }
      }

      return { rounds, bracketSize, error: null };
    } catch (error: unknown) {
      logger.error('Error getting playoff bracket:', error);
      return { rounds: [], bracketSize: 0, error: error instanceof Error ? error : new Error(String(error)) };
    }
  },

  /**
   * Fetch pre-calculated matchup lines from fantasy_matchup_lines table
   */
  async getMatchupLines(matchupId: string): Promise<Map<number, MatchupLineRow>> {
    try {
      const response = await matchupApi.getMatchupLines(matchupId);
      const data = (response.data as MatchupLineRow[]) || [];

      // Convert array to Map keyed by player_id for O(1) lookup
      const linesMap = new Map<number, MatchupLineRow>();
      data.forEach(line => {
        linesMap.set(line.player_id, line);
      });

      return linesMap;
    } catch (error: unknown) {
      logger.warn('[MatchupService] getMatchupLines error:', error);
      return new Map(); // Graceful degradation
    }
  },

  /**
   * Fetch matchup stats for players in the matchup week
   */
  async fetchMatchupStatsForPlayers(
    playerIds: number[],
    startDate: Date,
    endDate: Date,
    usePublicApi: boolean = false
  ): Promise<Map<number, MatchupWeekStats>> {
    try {
      // Use local timezone formatting to avoid UTC shift from toISOString()
      const formatLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const startDateStr = formatLocal(startDate);
      const endDateStr = formatLocal(endDate);

      // Use public API for demo league guests (no auth required)
      let response;
      if (usePublicApi) {
        const { publicApi } = await import('@/api/public');
        response = await publicApi.getMatchupStats(playerIds, startDateStr, endDateStr);
      } else {
        response = await matchupApi.getMatchupStats(playerIds, startDateStr, endDateStr);
      }
      const data = response.data ? Object.values(response.data) : [];

      const statsMap = new Map<number, MatchupWeekStats>();
      ((data || []) as Array<{ player_id: number; goals?: number; assists?: number; shots_on_goal?: number; blocks?: number; ppp?: number; shp?: number; hits?: number; pim?: number; plus_minus?: number; x_goals?: string | number; wins?: number; saves?: number; shutouts?: number; goals_against?: number }>).forEach((row) => {
        const goalieStats = {
          wins: Number(row.wins) || 0,
          saves: Number(row.saves) || 0,
          shutouts: Number(row.shutouts) || 0,
          goals_against: Number(row.goals_against) || 0,
        };
        
        // CRITICAL: Validate goalie stats are for a week, not season
        // If stats are too high, they're season totals - reject them
        const MAX_REASONABLE_WEEK_WINS = 7;
        const MAX_REASONABLE_WEEK_SAVES = 300;
        const MAX_REASONABLE_WEEK_SHUTOUTS = 3;
        
        const isGoalie = goalieStats.wins > 0 || goalieStats.saves > 0 || goalieStats.shutouts > 0;
        const looksLikeSeasonTotal = isGoalie && (
          goalieStats.wins > MAX_REASONABLE_WEEK_WINS || 
          goalieStats.saves > MAX_REASONABLE_WEEK_SAVES ||
          goalieStats.shutouts > MAX_REASONABLE_WEEK_SHUTOUTS
        );
        
        if (looksLikeSeasonTotal) {
          logger.error(`[MatchupService.fetchMatchupStatsForPlayers] ❌ REJECTING SEASON TOTALS for goalie player ${row.player_id}:`, {
            wins: goalieStats.wins,
            saves: goalieStats.saves,
            shutouts: goalieStats.shutouts,
            goals_against: goalieStats.goals_against,
            dateRange: `${startDateStr} to ${endDateStr}`,
            reason: 'Stats exceed weekly maximums (W>7, SV>300, SO>3)'
          });
          // Set goalie stats to 0 if they look like season totals
          goalieStats.wins = 0;
          goalieStats.saves = 0;
          goalieStats.shutouts = 0;
          goalieStats.goals_against = 0;
        }
        
        statsMap.set(row.player_id, {
          goals: row.goals || 0,
          assists: row.assists || 0,
          sog: row.shots_on_goal || 0,
          blocks: row.blocks || 0, // CRITICAL: Get blocks from matchup week stats, not season stats
          // NEW: Extract all 8 stat categories from RPC
          ppp: row.ppp || 0,
          shp: row.shp || 0,
          hits: row.hits || 0,
          pim: row.pim || 0,
          plus_minus: row.plus_minus || 0,
          xGoals: parseFloat(String(row.x_goals || 0)),
          // Extract goalie stats from RPC response (validated to be weekly, not season)
          wins: goalieStats.wins,
          saves: goalieStats.saves,
          shutouts: goalieStats.shutouts,
          goals_against: goalieStats.goals_against,
        });
      });
      
      if (statsMap.size > 0) {
        const sampleEntry = Array.from(statsMap.entries())[0];
        const sampleStats = sampleEntry[1];
        const isGoalieSample = (sampleStats.wins !== undefined || sampleStats.saves !== undefined) && (sampleStats.goals === 0 || sampleStats.goals === undefined);
        const looksLikeSeasonTotal = isGoalieSample
          ? ((sampleStats.wins || 0) > 7 || (sampleStats.saves || 0) > 300)
          : (sampleStats.goals > 20 || sampleStats.assists > 30 || sampleStats.sog > 100);

        // Check if all requested players are in the response
        const missingPlayers = playerIds.filter(id => !statsMap.has(id));
        if (missingPlayers.length > 0) {
          logger.warn(`  ⚠️ MISSING PLAYERS in RPC response (${missingPlayers.length}):`, missingPlayers.slice(0, 10));
        }

        if (looksLikeSeasonTotal) {
          if (isGoalieSample) {
            logger.error(`  ❌ RPC IS RETURNING SEASON TOTALS FOR GOALIE! Sample has W: ${sampleStats.wins || 0}, SV: ${sampleStats.saves || 0} - These are season numbers!`);
          } else {
            logger.error(`  ❌ RPC IS RETURNING SEASON TOTALS! Sample has Goals: ${sampleStats.goals}, Assists: ${sampleStats.assists}, SOG: ${sampleStats.sog} - These are season numbers!`);
          }
        }
      } else {
        logger.warn('[MatchupService.fetchMatchupStatsForPlayers] ⚠️ RPC returned NO DATA:', {
          totalRows: (data || []).length,
          playerCount: playerIds.length,
          dateRange: `${startDateStr} to ${endDateStr}`
        });
      }
      
      return statsMap;
    } catch (error: unknown) {
      logger.warn('[MatchupService] fetchMatchupStatsForPlayers timeout or error:', error);
      return new Map(); // Graceful degradation
    }
  },

  /**
   * Transform raw stats_breakdown JSONB to StatBreakdown interface
   */
  transformStatsBreakdown(rawBreakdown: RawStatsBreakdown | null | undefined): StatBreakdown | undefined {
    if (!rawBreakdown || typeof rawBreakdown !== 'object') {
      return undefined;
    }
    
    const breakdown: StatBreakdown = {};
    
    // Parse the backend format: { "goals": 2, "points_from_goals": 6.0, ... }
    const categoryMap: Record<string, string> = {
      'goals': 'Goals',
      'assists': 'Assists',
      'power_play_points': 'Power Play Points',
      'short_handed_points': 'Short Handed Points',
      'shots_on_goal': 'Shots on Goal',
      'blocks': 'Blocks',
      'hits': 'Hits',
      'penalty_minutes': 'Penalty Minutes',
      'wins': 'Wins',
      'shutouts': 'Shutouts',
      'saves': 'Saves',
      'goals_against': 'Goals Against'
    };
    
    // Extract stat counts and points
    const processedCategories = new Set<string>();
    
    for (const [key, value] of Object.entries(rawBreakdown)) {
      if (key.startsWith('points_from_')) {
        const statKey = key.replace('points_from_', '');
        const count = rawBreakdown[statKey] || 0;
        const points = value as number;
        
        if (count > 0 || points > 0) {
          const categoryName = categoryMap[statKey] || statKey.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          const scoringValue = count > 0 ? (points / count) : 0;
          const logic = count > 0 
            ? `${count} ${statKey.replace(/_/g, ' ')} * ${scoringValue.toFixed(1)} points`
            : `${points.toFixed(3)} points`;
          
          breakdown[categoryName] = {
            count: count,
            points: points,
            logic: logic
          };
          processedCategories.add(statKey);
        }
      } else if (!key.includes('_') && !processedCategories.has(key) && categoryMap[key]) {
        // Handle standalone stat counts without points_from_ prefix
        const count = value as number;
        if (count > 0) {
          const categoryName = categoryMap[key];
          breakdown[categoryName] = {
            count: count,
            points: 0,
            logic: `${count} ${key.replace(/_/g, ' ')}`
          };
        }
      }
    }
    
    return Object.keys(breakdown).length > 0 ? breakdown : undefined;
  },

  /**
   * Update matchup scores for all matchups in a league using unified calculation
   * Uses the EXACT same logic as the matchup tab: sum of 7 daily scores
   * This ensures all matchups (user teams AND AI teams) use identical calculation
   * 
   * @param leagueId - Optional league ID to update scores for. If not provided, updates all leagues.
   * @returns Object with error (if any) and updatedCount (number of matchups updated)
   */
  async updateMatchupScores(
    leagueId?: string
  ): Promise<{ error: Error | null; updatedCount?: number; results?: Array<{ matchup_id: string; team1_score: number; team2_score: number; updated: boolean }> }> {
    try {
      // Input validation
      if (leagueId && typeof leagueId !== 'string') {
        throw new Error('leagueId must be a string');
      }

      const response = await matchupApi.updateScores(leagueId);
      const data = response.data as Array<{ matchup_id: string; team1_score: number; team2_score: number; updated: boolean }> | undefined;
      const error = null;
      
      if (error) {
        logger.error('[MatchupService] RPC error updating matchup scores:', error);
        throw error;
      }
      
      // Filter out failed updates (where updated = false) for count
      const successfulUpdates = (data || []).filter((r: { matchup_id: string; team1_score: number; team2_score: number; updated: boolean }) => r.updated === true);
      
      return { 
        error: null, 
        updatedCount: successfulUpdates.length,
        results: data || []
      };
    } catch (error: unknown) {
      logger.error('[MatchupService] Error updating matchup scores:', error);
      return {
        error: error instanceof Error ? error : new Error(String(error)),
        updatedCount: 0
      };
    }
  },

  /**
   * Calculate Best Ball optimized score for a team's matchup.
   * Fetches all rostered players' stats for the week and selects the optimal lineup.
   * Only called for leagues with bestBallEnabled = true.
   */
  async calculateBestBallMatchupScore(
    leagueId: string,
    teamId: string,
    weekNumber: number,
    scoringSettings?: any
  ): Promise<{ optimized_points: number; starters: string[]; error?: string }> {
    try {
      const { BestBallService } = await import('./BestBallService');
      const result = await BestBallService.calculateWeeklyBestBall(
        leagueId, teamId, weekNumber, scoringSettings
      );
      return {
        optimized_points: result.optimized_points,
        starters: result.optimized_starters,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('[MatchupService] Best Ball calculation error:', msg);
      return { optimized_points: 0, starters: [], error: msg };
    }
  },

  /**
   * Get daily lineup for a team on a specific date (Yahoo/Sleeper architecture)
   * Returns complete player data ready for display - zero client-side calculation
   * Uses DataCacheService for caching (15+ minutes for past days)
   */
  async getDailyLineup(
    teamId: string,
    matchupId: string,
    date: string
  ): Promise<DailyLineupPlayer[]> {
    // Import DataCacheService dynamically to avoid circular deps
    const { DataCacheService, TTL } = await import('./DataCacheService');
    
    const cacheKey = `daily_lineup_${teamId}_${matchupId}_${date}`;
    
    // Check cache first (past lineups never change)
    const cached = DataCacheService.get<DailyLineupPlayer[]>(cacheKey);
    if (cached) {
      return cached;
    }
    
    try {
      const response = await matchupApi.getDailyLineup(matchupId, teamId, date);
      const data = response.data;

      if (!data) {
        logger.warn('[MatchupService] getDailyLineup returned no data');
        return [];
      }
      
      const lineup: DailyLineupPlayer[] = (data || []).map((row: { player_id: number; player_name: string; player_position: string; nhl_team: string; headshot_url: string | null; slot_type: 'active' | 'bench' | 'ir'; slot_id: string | null; is_locked: boolean; daily_points: string | number; goals?: number; assists?: number; shots_on_goal?: number; blocks?: number; hits?: number; pim?: number; ppp?: number; shp?: number; wins?: number; saves?: number; goals_against?: number; shutouts?: number; is_goalie?: boolean }) => ({
        player_id: row.player_id,
        player_name: row.player_name,
        position: row.player_position,
        nhl_team: row.nhl_team,
        headshot_url: row.headshot_url,
        slot_type: row.slot_type,
        slot_id: row.slot_id,
        is_locked: row.is_locked,
        daily_points: parseFloat(String(row.daily_points)) || 0,
        goals: row.goals || 0,
        assists: row.assists || 0,
        shots_on_goal: row.shots_on_goal || 0,
        blocks: row.blocks || 0,
        hits: row.hits || 0,
        pim: row.pim || 0,
        ppp: row.ppp || 0,
        shp: row.shp || 0,
        wins: row.wins || 0,
        saves: row.saves || 0,
        goals_against: row.goals_against || 0,
        shutouts: row.shutouts || 0,
        is_goalie: row.is_goalie || false
      }));
      
      if (lineup.length === 0) {
        logger.warn(`[MatchupService] WARNING: No players returned for ${date}. Check if fantasy_daily_rosters has data.`);
      }
      
      // Only cache non-empty results (don't cache empty arrays)
      if (lineup.length > 0) {
        DataCacheService.set(cacheKey, lineup, TTL.VERY_LONG);
      } else {
        logger.warn(`[MatchupService] NOT caching empty lineup for ${date} - data may be missing`);
      }
      
      return lineup;
    } catch (error: unknown) {
      logger.error('[MatchupService] getDailyLineup exception:', error);
      return [];
    }
  },

  /**
   * Auto-complete matchups and update scores for completed weeks.
   * Called before standings calculation to ensure scores are current.
   * Best-effort — failures should not block page rendering.
   */
  async autoCompleteMatchups(): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await matchupApi.autoComplete();
      return { success: !!response.data?.success };
    } catch (error: unknown) {
      logger.error('[MatchupService] autoCompleteMatchups exception:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
};

// ============================================================================
// H2H CATEGORIES & ROTO SCORING SUPPORT
// ============================================================================

/**
 * H2H Category matchup result from RPC
 */
export interface CategoryMatchupResult {
  category: string;
  team1_value: number;
  team2_value: number;
  winner: 'team1' | 'team2' | 'tie';
}

/**
 * Roto standings result from RPC
 */
export interface RotoStandingRow {
  team_id: string;
  team_name: string;
  category_name: string;
  stat_value: number;
  category_rank: number;
  roto_points: number;
}

export const CategoryScoringService = {
  /**
   * Calculate H2H category matchup results for a specific matchup.
   * Calls the calculate_h2h_category_matchup RPC which reads league settings dynamically.
   *
   * @param leagueId - League UUID
   * @param matchupId - Matchup UUID
   * @param team1Id - Team 1 UUID
   * @param team2Id - Team 2 UUID
   * @param weekStart - Week start date (YYYY-MM-DD)
   * @param weekEnd - Week end date (YYYY-MM-DD)
   * @param categories - Category IDs from league settings (commissioner-configured)
   */
  async getH2HCategoryResults(
    leagueId: string,
    matchupId: string,
    team1Id: string,
    team2Id: string,
    weekStart: string,
    weekEnd: string,
    categories: string[]
  ): Promise<{ results: CategoryMatchupResult[]; error: unknown }> {
    try {
      const response = await matchupApi.getH2HCategoryResults({
        leagueId, matchupId, team1Id, team2Id, weekStart, weekEnd, categories,
      });

      return { results: (response.data || []) as CategoryMatchupResult[], error: null };
    } catch (error: unknown) {
      logger.error('[CategoryScoringService] getH2HCategoryResults error:', error);
      return { results: [], error };
    }
  },

  /**
   * Calculate roto standings for a league across all categories.
   * Categories are read from league settings (commissioner-configured).
   *
   * @param leagueId - League UUID
   * @param categories - Category IDs from league settings
   * @param throughWeek - Optional: limit to stats through this week number
   */
  async getRotoStandings(
    leagueId: string,
    categories: string[],
    throughWeek?: number
  ): Promise<{ standings: RotoStandingRow[]; error: unknown }> {
    try {
      const response = await matchupApi.getRotoStandings(leagueId, categories, throughWeek);

      return { standings: (response.data || []) as RotoStandingRow[], error: null };
    } catch (error: unknown) {
      logger.error('[CategoryScoringService] getRotoStandings error:', error);
      return { standings: [], error };
    }
  },

  /**
   * Aggregate roto standings into per-team totals.
   * Returns teams sorted by total roto points (highest first).
   */
  aggregateRotoStandings(
    standings: RotoStandingRow[]
  ): Array<{
    team_id: string;
    team_name: string;
    total_roto_points: number;
    category_breakdown: Record<string, { value: number; rank: number; points: number }>;
  }> {
    const teamMap = new Map<string, {
      team_name: string;
      total_roto_points: number;
      category_breakdown: Record<string, { value: number; rank: number; points: number }>;
    }>();

    for (const row of standings) {
      if (!teamMap.has(row.team_id)) {
        teamMap.set(row.team_id, {
          team_name: row.team_name,
          total_roto_points: 0,
          category_breakdown: {},
        });
      }
      const entry = teamMap.get(row.team_id)!;
      entry.total_roto_points += row.roto_points;
      entry.category_breakdown[row.category_name] = {
        value: row.stat_value,
        rank: row.category_rank,
        points: row.roto_points,
      };
    }

    return Array.from(teamMap.entries())
      .map(([team_id, data]) => ({ team_id, ...data }))
      .sort((a, b) => b.total_roto_points - a.total_roto_points);
  },
  /**
   * Calculate PPG (Points-Per-Game) standings for a league.
   * Calls the calculate_ppg_standings RPC which ranks teams by average
   * fantasy points per matchup week played.
   */
  async getPPGStandings(
    leagueId: string,
    throughWeek?: number
  ): Promise<{
    standings: Array<{
      team_id: string;
      team_name: string;
      total_points: number;
      games_played: number;
      ppg: number;
      rank: number;
    }>;
    error: unknown;
  }> {
    try {
      const response = await matchupApi.getPPGStandings(leagueId, throughWeek);

      return { standings: (response.data || []) as Array<{ team_id: string; team_name: string; total_points: number; games_played: number; ppg: number; rank: number }>, error: null };
    } catch (error: unknown) {
      logger.error('[CategoryScoringService] getPPGStandings error:', error);
      return { standings: [], error };
    }
  },
};


// Type for daily lineup player returned by RPC
export interface DailyLineupPlayer {
  player_id: number;
  player_name: string;
  position: string;
  nhl_team: string;
  headshot_url: string | null;
  slot_type: 'active' | 'bench' | 'ir';
  slot_id: string | null;
  is_locked: boolean;
  daily_points: number;
  goals: number;
  assists: number;
  shots_on_goal: number;
  blocks: number;
  hits: number;
  pim: number;
  ppp: number;
  shp: number;
  wins: number;
  saves: number;
  goals_against: number;
  shutouts: number;
  is_goalie: boolean;
}
