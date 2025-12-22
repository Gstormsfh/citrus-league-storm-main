import { supabase } from '@/integrations/supabase/client';
import { League, Team, LeagueService } from './LeagueService';
import { DraftService } from './DraftService';
import { PlayerService, Player } from './PlayerService';
import { MatchupPlayer, StatBreakdown } from '@/components/matchup/types';
import { getFirstWeekStartDate, getWeekStartDate, getWeekEndDate, getAvailableWeeks, getScheduleLength } from '@/utils/weekCalculator';
import { HockeyPlayer } from '@/components/roster/HockeyPlayerCard';
import { ScheduleService, NHLGame, GameInfo } from './ScheduleService';
import { withTimeout } from '@/utils/promiseUtils';
import { getTodayMST, getTodayMSTDate } from '@/utils/timezoneUtils';

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
  async deleteAllMatchupsForLeague(leagueId: string): Promise<{ error: any }> {
    try {
      const { error } = await supabase
        .from('matchups')
        .delete()
        .eq('league_id', leagueId);
      
      if (error) throw error;
      console.log(`[MatchupService] Deleted all matchups for league ${leagueId}`);
      return { error: null };
    } catch (error) {
      console.error('[MatchupService] Error deleting matchups:', error);
      return { error };
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
    forceRegenerate: boolean = false
  ): Promise<{ error: any }> {
    try {
      // Get available weeks
      const currentYear = new Date().getFullYear();
      const availableWeeks = getAvailableWeeks(firstWeekStart, currentYear);
      console.log(`[MatchupService] Generating matchups for ${availableWeeks.length} weeks (weeks ${availableWeeks[0]} to ${availableWeeks[availableWeeks.length - 1]})`);

      if (teams.length < 2) {
        return { error: new Error('Need at least 2 teams to generate matchups') };
      }

      const numTeams = teams.length;
      const numRounds = numTeams % 2 === 0 ? numTeams - 1 : numTeams;
      
      // Verify we have at least 2 teams
      if (numTeams < 2) {
        console.error(`[MatchupService] Cannot generate matchups: Need at least 2 teams, got ${numTeams}`);
        return { error: new Error(`Need at least 2 teams to generate matchups, got ${numTeams}`) };
      }
      
      // CRITICAL: Verify all teams have valid IDs
      const teamsWithInvalidIds = teams.filter(t => !t.id || t.id === null || t.id === undefined);
      if (teamsWithInvalidIds.length > 0) {
        console.error(`[MatchupService] CRITICAL: Found ${teamsWithInvalidIds.length} teams with invalid IDs:`, teamsWithInvalidIds);
        return { error: new Error(`Cannot generate matchups: ${teamsWithInvalidIds.length} teams have invalid IDs`) };
      }
      
      // Log all teams to verify completeness
      console.log(`[MatchupService] Teams passed to generation (${numTeams} teams):`, teams.map(t => ({
        id: t.id,
        name: t.team_name || t.id,
        owner_id: t.owner_id
      })));
      
      // Get all unique team IDs to verify no duplicates
      const teamIds = teams.map(t => t.id);
      const uniqueTeamIds = new Set(teamIds);
      if (teamIds.length !== uniqueTeamIds.size) {
        console.error(`[MatchupService] CRITICAL: Duplicate team IDs found! Total: ${teamIds.length}, Unique: ${uniqueTeamIds.size}`);
        const duplicates = teamIds.filter((id, index) => teamIds.indexOf(id) !== index);
        console.error(`[MatchupService] Duplicate IDs:`, duplicates);
        return { error: new Error(`Cannot generate matchups: Duplicate team IDs found`) };
      }
      
      // Shuffle teams once for randomness (deterministic after that)
      const shuffledTeams = [...teams].sort(() => Math.random() - 0.5);
      
      console.log(`[MatchupService] Generating schedule for ${numTeams} teams (${numRounds} rounds per cycle)`);
      console.log(`[MatchupService] Shuffled team order:`, shuffledTeams.map((t, i) => ({
        index: i,
        id: t.id,
        name: t.team_name || t.id
      })));
      
      // Check existing matchups - simple check: does each week have matchups?
      const { data: existingMatchups } = await supabase
        .from('matchups')
        .select('week_number')
        .eq('league_id', leagueId);
      
      const weeksWithMatchups = new Set(existingMatchups?.map(m => m.week_number) || []);
      
      // Determine which weeks need matchups
      let weeksNeedingMatchups: number[] = [];
      
      if (forceRegenerate || weeksWithMatchups.size === 0) {
        // Full regeneration: delete all, generate all weeks
        console.log('[MatchupService] Full regeneration requested - deleting all existing matchups...');
        await this.deleteAllMatchupsForLeague(leagueId);
        weeksNeedingMatchups = availableWeeks;
      } else {
        // Generate only missing weeks
        weeksNeedingMatchups = availableWeeks.filter(w => !weeksWithMatchups.has(w));
        
        // CRITICAL: If a week has matchups but is incomplete (not all teams have matchups),
        // we need to regenerate it. For now, if ANY week is missing, regenerate ALL weeks
        // to ensure consistency. This is safer than trying to patch individual weeks.
        if (weeksNeedingMatchups.length > 0) {
          console.log('[MatchupService] Some weeks are missing matchups. Regenerating ALL weeks to ensure consistency...');
          await this.deleteAllMatchupsForLeague(leagueId);
          weeksNeedingMatchups = availableWeeks;
        }
      }
      
      if (weeksNeedingMatchups.length === 0) {
        console.log('[MatchupService] No weeks need matchup generation - all matchups already exist');
        return { error: null };
      }
      
      console.log(`[MatchupService] Generating matchups for ${weeksNeedingMatchups.length} weeks:`, weeksNeedingMatchups);
      console.log(`[MatchupService] Teams in league:`, teams.map(t => ({ id: t.id, name: t.team_name || t.id })));
      
      let matchupsCreated = 0;
      let matchupsSkipped = 0;
      let matchupsErrors = 0;
      
      // Generate matchups for each week using simple round-robin
      for (const weekNumber of weeksNeedingMatchups) {
        const weekStart = getWeekStartDate(weekNumber, firstWeekStart);
        const weekEnd = getWeekEndDate(weekNumber, firstWeekStart);
        
        // Use the helper function to get round-robin pairings
        // For weeks beyond numRounds, it automatically repeats the cycle
        const teamPairs = this.getRoundRobinPairings(weekNumber, shuffledTeams, numRounds);
        
        // Verify all teams are included in pairs
        const teamsInPairs = new Set<string>();
        teamPairs.forEach(p => {
          if (p.team1) teamsInPairs.add(p.team1.id);
          if (p.team2) teamsInPairs.add(p.team2.id);
        });
        
        const allTeamIds = new Set(shuffledTeams.map(t => t.id));
        const missingFromPairs = Array.from(allTeamIds).filter(id => !teamsInPairs.has(id));
        
        if (missingFromPairs.length > 0) {
          console.error(`[MatchupService] Week ${weekNumber} - CRITICAL: Teams missing from pairs:`, missingFromPairs);
          console.error(`[MatchupService] Week ${weekNumber} - Teams in pairs:`, Array.from(teamsInPairs));
          console.error(`[MatchupService] Week ${weekNumber} - All team IDs:`, Array.from(allTeamIds));
          console.error(`[MatchupService] Week ${weekNumber} - This indicates a bug in the round-robin algorithm!`);
          console.error(`[MatchupService] ABORTING matchup generation to prevent incomplete data`);
          return { error: new Error(`Round-robin algorithm failed: ${missingFromPairs.length} teams missing from week ${weekNumber} pairs. Teams: ${missingFromPairs.join(', ')}`) };
        }
        
        console.log(`[MatchupService] Week ${weekNumber} - Verification passed: All ${numTeams} teams included in pairs ✓`);
        
        console.log(`[MatchupService] Week ${weekNumber} - Generated ${teamPairs.length} pairs:`, teamPairs.map(p => 
          `${p.team1.team_name || p.team1.id} (${p.team1.id}) vs ${p.team2?.team_name || p.team2?.id || 'BYE'} (${p.team2?.id || 'null'})`
        ).join(', '));
        
        // Insert matchups for this week
        for (const pair of teamPairs) {
          // Skip bye weeks (team2 is null) for even number of teams
          if (!pair.team2 && numTeams % 2 === 0) {
            console.log(`[MatchupService] Week ${weekNumber} - Skipping bye week for even teams`);
            continue;
          }
          
          // Check if matchup already exists (check both directions to avoid duplicates)
          const { data: existing1 } = await supabase
            .from('matchups')
            .select('id')
            .eq('league_id', leagueId)
            .eq('week_number', weekNumber)
            .eq('team1_id', pair.team1.id)
            .eq('team2_id', pair.team2?.id || null)
            .maybeSingle();
          
          const { data: existing2 } = pair.team2 ? await supabase
            .from('matchups')
            .select('id')
            .eq('league_id', leagueId)
            .eq('week_number', weekNumber)
            .eq('team1_id', pair.team2.id)
            .eq('team2_id', pair.team1.id)
            .maybeSingle() : { data: null };
          
          const existing = existing1 || existing2;

          if (existing) {
            console.log(`[MatchupService] Week ${weekNumber} - Matchup already exists: ${pair.team1.team_name || pair.team1.id} vs ${pair.team2?.team_name || pair.team2?.id || 'BYE'}`);
            matchupsSkipped++;
            continue;
          }

          const insertData = {
            league_id: leagueId,
            week_number: weekNumber,
            team1_id: pair.team1.id,
            team2_id: pair.team2?.id || null,
            week_start_date: weekStart.toISOString().split('T')[0],
            week_end_date: weekEnd.toISOString().split('T')[0],
            status: 'scheduled'
          };
          
          console.log(`[MatchupService] Week ${weekNumber} - Inserting matchup:`, insertData);
          
          const { data: inserted, error } = await supabase
            .from('matchups')
            .insert(insertData)
            .select()
            .single();

          if (error) {
            console.error(`[MatchupService] Week ${weekNumber} - Error creating matchup:`, error);
            console.error(`[MatchupService] Failed matchup data:`, insertData);
            matchupsErrors++;
          } else {
            console.log(`[MatchupService] Week ${weekNumber} - Successfully created matchup:`, inserted);
            matchupsCreated++;
          }
        }
      }

      console.log(`[MatchupService] Generation complete: ${matchupsCreated} created, ${matchupsSkipped} skipped, ${matchupsErrors} errors across ${weeksNeedingMatchups.length} weeks`);
      
      // Small delay to ensure all database commits are complete
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Verify matchups were created by checking the database
      if (weeksNeedingMatchups.length > 0) {
        const { data: verifyMatchups, error: verifyError } = await supabase
          .from('matchups')
          .select('week_number, team1_id, team2_id')
          .eq('league_id', leagueId)
          .in('week_number', weeksNeedingMatchups);
        
        if (verifyError) {
          console.error(`[MatchupService] Verification query error:`, verifyError);
        } else {
          console.log(`[MatchupService] Verification: Found ${verifyMatchups?.length || 0} matchups in database for generated weeks`);
          if (verifyMatchups && verifyMatchups.length > 0) {
            const weeksWithMatchups = new Set(verifyMatchups.map(m => m.week_number));
            console.log(`[MatchupService] Verification: Weeks with matchups:`, Array.from(weeksWithMatchups).sort((a, b) => a - b));
            
            // Check if all teams are represented in each week
            const allTeamIds = new Set(teams.map(t => t.id));
            let hasIncompleteWeeks = false;
            
            for (const weekNum of weeksNeedingMatchups) {
              const weekMatchups = verifyMatchups.filter(m => m.week_number === weekNum);
              const teamsInWeek = new Set<string>();
              weekMatchups.forEach(m => {
                if (m.team1_id) teamsInWeek.add(m.team1_id);
                if (m.team2_id) teamsInWeek.add(m.team2_id);
              });
              
              const missingTeams = Array.from(allTeamIds).filter(id => !teamsInWeek.has(id));
              if (missingTeams.length > 0) {
                console.error(`[MatchupService] Week ${weekNum} - CRITICAL: Missing teams:`, missingTeams);
                console.error(`[MatchupService] Week ${weekNum} - Teams in matchups:`, Array.from(teamsInWeek));
                console.error(`[MatchupService] Week ${weekNum} - All team IDs:`, Array.from(allTeamIds));
                hasIncompleteWeeks = true;
              } else {
                console.log(`[MatchupService] Week ${weekNum} - All teams have matchups ✓`);
              }
            }
            
            // If any week is incomplete, delete and regenerate ALL weeks
            if (hasIncompleteWeeks) {
              console.error(`[MatchupService] CRITICAL: Some weeks have incomplete matchups. Deleting all and regenerating...`);
              await this.deleteAllMatchupsForLeague(leagueId);
              
              // Regenerate all weeks
              await new Promise(resolve => setTimeout(resolve, 500));
              
              // Recursively call this function to regenerate
              return this.generateMatchupsForLeague(leagueId, teams, firstWeekStart, true);
            }
          } else {
            console.error(`[MatchupService] Verification FAILED: No matchups found in database after generation!`);
            return { error: new Error('Matchup generation completed but no matchups found in database') };
          }
        }
      }
      
      if (matchupsErrors > 0) {
        return { error: new Error(`Failed to create ${matchupsErrors} matchups. Check logs for details.`) };
      }
      
      return { error: null };
    } catch (error) {
      console.error('[MatchupService] Error generating matchups:', error);
      return { error };
    }
  },

  /**
   * Get matchup for a specific week
   */
  async getMatchup(
    leagueId: string,
    weekNumber: number
  ): Promise<{ matchup: Matchup | null; error: any }> {
    try {
      const { data, error } = await supabase
        .from('matchups')
        .select('*')
        .eq('league_id', leagueId)
        .eq('week_number', weekNumber)
        .maybeSingle();

      if (error) throw error;
      return { matchup: data || null, error: null };
    } catch (error) {
      return { matchup: null, error };
    }
  },

  /**
   * Get matchup where user's team is involved
   */
  async getUserMatchup(
    leagueId: string,
    userId: string,
    weekNumber: number
  ): Promise<{ matchup: Matchup | null; error: any }> {
    try {
      console.log('[MatchupService.getUserMatchup] Querying for matchup:', {
        leagueId,
        userId,
        weekNumber,
        weekNumberType: typeof weekNumber
      });
      
      // First, get user's team
      let userTeam: any = null;
      let teamError: any = null;
      try {
        const result = await withTimeout(
          supabase.from('teams').select('id').eq('league_id', leagueId).eq('owner_id', userId).maybeSingle(),
          5000,
          'getUserTeam timeout in getUserMatchup'
        );
        userTeam = result.data;
        teamError = result.error;
      } catch (timeoutError: any) {
        console.error('[MatchupService.getUserMatchup] User team query timeout:', timeoutError);
        teamError = timeoutError;
      }

      if (teamError) throw teamError;
      if (!userTeam) {
        console.warn('[MatchupService.getUserMatchup] User team not found');
        return { matchup: null, error: null };
      }

      console.log('[MatchupService.getUserMatchup] User team ID:', userTeam.id);
      console.log('[MatchupService.getUserMatchup] Querying matchups table with:', {
        league_id: leagueId,
        week_number: weekNumber,
        week_number_type: typeof weekNumber,
        team_filter: `team1_id=${userTeam.id} OR team2_id=${userTeam.id}`
      });

      // Find matchup where user's team is team1 or team2
      // Use .limit(1) instead of .maybeSingle() to handle potential duplicates gracefully
      // Ensure week_number is treated as a number in the query
      const query = supabase
        .from('matchups')
        .select('*')
        .eq('league_id', leagueId)
        .eq('week_number', weekNumber)
        .or(`team1_id.eq.${userTeam.id},team2_id.eq.${userTeam.id}`)
        .limit(1);
      
      console.log('[MatchupService.getUserMatchup] Supabase query constructed, executing...');
      let matchups: any = null;
      let error: any = null;
      try {
        const result = await withTimeout(query, 5000, 'getUserMatchup query timeout');
        matchups = result.data;
        error = result.error;
      } catch (timeoutError: any) {
        console.error('[MatchupService.getUserMatchup] Matchup query timeout:', timeoutError);
        error = timeoutError;
      }
      
      if (error) {
        console.error('[MatchupService.getUserMatchup] Database query error:', error);
        console.error('[MatchupService.getUserMatchup] Error details:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code
        });
        throw error;
      }
      
      console.log('[MatchupService.getUserMatchup] Query result:', {
        matchupsFound: matchups?.length || 0,
        matchups: matchups?.map(m => ({
          id: m.id,
          week_number: m.week_number,
          week_number_type: typeof m.week_number,
          team1_id: m.team1_id,
          team2_id: m.team2_id,
          league_id: m.league_id
        }))
      });
      
      // Additional verification: Check if week_number matches what we queried for
      if (matchups && matchups.length > 0) {
        const firstMatchup = matchups[0];
        if (firstMatchup.week_number !== weekNumber) {
          console.error('[MatchupService.getUserMatchup] WARNING: Week number mismatch!', {
            requested: weekNumber,
            received: firstMatchup.week_number,
            matchup_id: firstMatchup.id
          });
        } else {
          console.log('[MatchupService.getUserMatchup] Week number verification passed:', {
            requested: weekNumber,
            received: firstMatchup.week_number
          });
        }
      }
      
      // If multiple matchups found, log warning and use first one
      if (matchups && matchups.length > 1) {
        console.warn(`[MatchupService.getUserMatchup] Multiple matchups found for user team ${userTeam.id} in week ${weekNumber}. Using first one.`);
      }
      
      const data = matchups && matchups.length > 0 ? matchups[0] : null;

      if (data) {
        console.log('[MatchupService.getUserMatchup] Returning matchup:', {
          id: data.id,
          week_number: data.week_number,
          team1_id: data.team1_id,
          team2_id: data.team2_id,
          status: data.status
        });
      } else {
        console.warn('[MatchupService.getUserMatchup] No matchup found for week:', weekNumber);
      }
      
      return { matchup: data || null, error: null };
    } catch (error) {
      return { matchup: null, error };
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
  ): Promise<{ data: MatchupDataResponse | null; error: any }> {
    try {
      // Get the matchup
      const { data: matchup, error: matchupError } = await supabase
        .from('matchups')
        .select('*')
        .eq('id', matchupId)
        .single();

      if (matchupError) throw matchupError;
      if (!matchup) {
        return { data: null, error: new Error('Matchup not found') };
      }

      // Get league
      const { league, error: leagueError } = await LeagueService.getLeague(matchup.league_id);
      if (leagueError || !league) {
        return { data: null, error: leagueError || new Error('League not found') };
      }

      // Get first week start date
      const draftCompletionDate = league.updated_at ? new Date(league.updated_at) : new Date();
      const firstWeekStart = getFirstWeekStartDate(draftCompletionDate);
      const currentYear = new Date().getFullYear();
      const scheduleLength = getScheduleLength(firstWeekStart, currentYear);
      const isPlayoffWeek = matchup.week_number > scheduleLength;

      // Get user's team to determine which side they're on (if they're in this matchup)
      const { team: userTeam } = await LeagueService.getUserTeam(matchup.league_id, userId);
      const isUserInMatchup = userTeam && (matchup.team1_id === userTeam.id || matchup.team2_id === userTeam.id);
      
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
      const { team1Roster, team2Roster, team1SlotAssignments, team2SlotAssignments, error: rostersError } = 
        await this.getMatchupRosters(matchup, allPlayers, timezone);

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
      const viewingRecord = await this.getTeamRecord(viewingTeam.id, matchup.league_id);
      const opponentRecord = opponentTeamObj 
        ? await this.getTeamRecord(opponentTeamObj.id, matchup.league_id)
        : { wins: 0, losses: 0 };

      // Calculate daily scores
      const weekStartStr = matchup.week_start_date;
      const weekEndStr = matchup.week_end_date;
      
      let viewingDailyPoints: number[] = [];
      let opponentDailyPoints: number[] = [];

      try {
        const { data: viewingDailyScores, error: viewingError } = await supabase.rpc(
          'calculate_daily_matchup_scores',
          {
            p_matchup_id: matchup.id,
            p_team_id: viewingTeam.id,
            p_week_start: weekStartStr,
            p_week_end: weekEndStr
          }
        );

        if (!viewingError && viewingDailyScores) {
          const sorted = (viewingDailyScores as any[]).sort((a, b) =>
            new Date(a.roster_date).getTime() - new Date(b.roster_date).getTime()
          );
          viewingDailyPoints = sorted.map(d => parseFloat(d.daily_score) || 0);
        } else {
          viewingDailyPoints = Array(7).fill(0);
        }
      } catch (error) {
        viewingDailyPoints = Array(7).fill(0);
      }

      if (opponentTeamObj) {
        try {
          const { data: oppDailyScores, error: oppError } = await supabase.rpc(
            'calculate_daily_matchup_scores',
            {
              p_matchup_id: matchup.id,
              p_team_id: opponentTeamObj.id,
              p_week_start: weekStartStr,
              p_week_end: weekEndStr
            }
          );

          if (!oppError && oppDailyScores) {
            const sorted = (oppDailyScores as any[]).sort((a, b) =>
              new Date(a.roster_date).getTime() - new Date(b.roster_date).getTime()
            );
            opponentDailyPoints = sorted.map(d => parseFloat(d.daily_score) || 0);
          } else {
            opponentDailyPoints = Array(7).fill(0);
          }
        } catch (error) {
          opponentDailyPoints = Array(7).fill(0);
        }
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
    } catch (error) {
      console.error('[MatchupService.getMatchupDataById] Error:', error);
      return { data: null, error };
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
    existingMatchup?: Matchup | null
  ): Promise<{ data: MatchupDataResponse | null; error: any }> {
    try {
      console.log('[MatchupService.getMatchupData] Received parameters:', {
        leagueId,
        userId,
        weekNumber,
        timezone
      });
      
      // Get league to determine first week start
      let league: any = null;
      let leagueError: any = null;
      try {
        const result = await withTimeout(
          supabase.from('leagues').select('*').eq('id', leagueId).maybeSingle(),
          5000,
          'getLeague timeout in getMatchupData'
        );
        league = result.data;
        leagueError = result.error;
      } catch (timeoutError: any) {
        console.error('[MatchupService.getMatchupData] League query timeout:', timeoutError);
        leagueError = timeoutError;
      }

      if (leagueError) throw leagueError;
      if (!league) {
        return { data: null, error: new Error('League not found') };
      }

      // Get first week start date
      const draftCompletionDate = league.updated_at ? new Date(league.updated_at) : new Date();
      const firstWeekStart = getFirstWeekStartDate(draftCompletionDate);
      const currentYear = new Date().getFullYear();
      const scheduleLength = getScheduleLength(firstWeekStart, currentYear);
      const isPlayoffWeek = weekNumber > scheduleLength;

      // Get user's team
      let userTeam: any = null;
      let teamError: any = null;
      try {
        const result = await withTimeout(
          supabase.from('teams').select('*').eq('league_id', leagueId).eq('owner_id', userId).maybeSingle(),
          5000,
          'getUserTeam timeout in getMatchupData'
        );
        userTeam = result.data;
        teamError = result.error;
      } catch (timeoutError: any) {
        console.error('[MatchupService.getMatchupData] User team query timeout:', timeoutError);
        teamError = timeoutError;
      }

      if (teamError) throw teamError;
      if (!userTeam) {
        return { data: null, error: new Error('User team not found') };
      }

      // Use existingMatchup if provided, otherwise query
      let matchup: Matchup | null = null;
      if (existingMatchup) {
        console.log('[MatchupService.getMatchupData] Using pre-fetched matchup (avoiding redundant query)');
        matchup = existingMatchup;
      } else {
        console.log('[MatchupService.getMatchupData] Querying matchup from DB...');
        const { matchup: queriedMatchup, error: matchupError } = await this.getUserMatchup(leagueId, userId, weekNumber);
        if (matchupError) throw matchupError;
        matchup = queriedMatchup;
      }

      if (!matchup) {
        console.warn('[MatchupService.getMatchupData] No matchup found for week:', weekNumber);
        return { data: null, error: new Error(`No matchup found for week ${weekNumber}`) };
      }
      
      console.log('[MatchupService.getMatchupData] Found matchup:', {
        id: matchup.id,
        week_number: matchup.week_number,
        team1_id: matchup.team1_id,
        team2_id: matchup.team2_id
      });

      // Determine which team the user is (team1 or team2)
      const isTeam1 = matchup.team1_id === userTeam.id;
      const opponentTeamId = isTeam1 ? matchup.team2_id : matchup.team1_id;

      // Get opponent team object
      let opponentTeamObj: Team | null = null;
      if (opponentTeamId) {
        const { teams } = await LeagueService.getLeagueTeams(leagueId);
        opponentTeamObj = teams.find(t => t.id === opponentTeamId) || null;
      }

      // Optimized: Get roster player IDs first, then load only those players
      // This is much faster than loading all 1000+ players and filtering
      // Fallback to old method if optimized loading fails
      let rosterPlayers: Player[];
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
          console.warn('[MatchupService] No roster player IDs found. Roster may be empty.');
          rosterPlayers = []; // Return empty array instead of loading all players
        } else {
          // Load only roster players (much faster than loading all players)
          rosterPlayers = await withTimeout(
            PlayerService.getPlayersByIds(allRosterPlayerIds.map(String)),
            10000,
            'getPlayersByIds timeout'
          );
          
          // If optimized loading returned fewer players than expected, log warning but don't fallback
          if (rosterPlayers.length < allRosterPlayerIds.length * 0.8) {
            console.warn('[MatchupService] Optimized loading returned fewer players than expected:', {
              expected: allRosterPlayerIds.length,
              received: rosterPlayers.length
            });
            // Continue with partial roster rather than loading all players
          }
        }
      } catch (error) {
        console.error('[MatchupService] Error in optimized roster loading:', error);
        // DO NOT fallback to getAllPlayers - it causes 504 timeouts
        // Return empty array and let UI show error
        rosterPlayers = [];
      }

      // Get rosters for both teams
      const {
        team1Roster,
        team2Roster,
        team1SlotAssignments,
        team2SlotAssignments,
        error: rostersError
      } = await this.getMatchupRosters(matchup, rosterPlayers, timezone);

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
      const userRecord = await this.getTeamRecord(userTeam.id, leagueId);
      const opponentRecord = opponentTeamObj ? await this.getTeamRecord(opponentTeamObj.id, leagueId) : { wins: 0, losses: 0 };

      // Calculate daily points
      const matchupStatus = matchup.status;
      const team1Score = parseFloat(String(matchup.team1_score)) || 0;
      const team2Score = parseFloat(String(matchup.team2_score)) || 0;
      const hasScores = team1Score > 0 || team2Score > 0;
      // Calculate daily scores using fantasy_daily_rosters and NHL official stats
      let userDailyPoints: number[] = [];
      let opponentDailyPoints: number[] = [];

      // Get week dates
      const weekStart = new Date(matchup.week_start_date);
      const weekEnd = new Date(matchup.week_end_date);
      const weekStartStr = weekStart.toISOString().split('T')[0];
      const weekEndStr = weekEnd.toISOString().split('T')[0];

      // Calculate daily scores for user team
      try {
        const { data: userDailyScores, error: userError } = await supabase.rpc(
          'calculate_daily_matchup_scores',
          {
            p_matchup_id: matchup.id,
            p_team_id: userTeam.id,
            p_week_start: weekStartStr,
            p_week_end: weekEndStr
          }
        );

        if (!userError && userDailyScores) {
          // Sort by date and extract scores
          const sorted = (userDailyScores as any[]).sort((a, b) => 
            new Date(a.roster_date).getTime() - new Date(b.roster_date).getTime()
          );
          userDailyPoints = sorted.map(d => parseFloat(d.daily_score) || 0);
        } else {
          console.warn('[getMatchupData] Error calculating user daily scores:', userError);
          // Fallback: use placeholder if calculation fails
          userDailyPoints = Array(7).fill(0);
        }
      } catch (error) {
        console.error('[getMatchupData] Exception calculating user daily scores:', error);
        userDailyPoints = Array(7).fill(0);
      }

      // Calculate daily scores for opponent team (if exists)
      if (opponentTeamObj) {
        try {
          const { data: oppDailyScores, error: oppError } = await supabase.rpc(
            'calculate_daily_matchup_scores',
            {
              p_matchup_id: matchup.id,
              p_team_id: opponentTeamObj.id,
              p_week_start: weekStartStr,
              p_week_end: weekEndStr
            }
          );

          if (!oppError && oppDailyScores) {
            // Sort by date and extract scores
            const sorted = (oppDailyScores as any[]).sort((a, b) => 
              new Date(a.roster_date).getTime() - new Date(b.roster_date).getTime()
            );
            opponentDailyPoints = sorted.map(d => parseFloat(d.daily_score) || 0);
          } else {
            console.warn('[getMatchupData] Error calculating opponent daily scores:', oppError);
            opponentDailyPoints = Array(7).fill(0);
          }
        } catch (error) {
          console.error('[getMatchupData] Exception calculating opponent daily scores:', error);
          opponentDailyPoints = Array(7).fill(0);
        }
      } else {
        opponentDailyPoints = Array(7).fill(0);
      }

      // Calculate navigation metadata
      const availableWeeks = getAvailableWeeks(firstWeekStart, currentYear);
      const currentWeekIndex = availableWeeks.indexOf(weekNumber);
      const previousWeek = currentWeekIndex > 0 ? availableWeeks[currentWeekIndex - 1] : null;
      const nextWeek = currentWeekIndex < availableWeeks.length - 1 ? availableWeeks[currentWeekIndex + 1] : null;

      // Get previous/next matchup IDs
      let previousMatchupId: string | null = null;
      let nextMatchupId: string | null = null;

      if (previousWeek) {
        const { matchup: prevMatchup } = await this.getUserMatchup(leagueId, userId, previousWeek);
        previousMatchupId = prevMatchup?.id || null;
      }

      if (nextWeek) {
        const { matchup: nextMatchup } = await this.getUserMatchup(leagueId, userId, nextWeek);
        nextMatchupId = nextMatchup?.id || null;
      }

      // Build response
      const response: MatchupDataResponse = {
        matchupId: matchup.id,
        matchup, // Include full matchup object
        currentWeek: weekNumber,
        scheduleLength,
        isPlayoffWeek,
        userTeam: {
          id: userTeam.id,
          name: userTeam.team_name,
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
    } catch (error) {
      console.error('Error getting matchup data:', error);
      return { data: null, error };
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
   */
  async getRosterPlayerIds(teamId: string, leagueId: string): Promise<string[]> {
    try {
      const { data: teamDraftPicks, error: picksError } = await supabase
        .from('draft_picks')
        .select('player_id')
        .eq('league_id', leagueId)
        .eq('team_id', teamId)
        .is('deleted_at', null);
      
      if (picksError) {
        console.error('Error fetching roster player IDs:', picksError);
        return [];
      }
      
      return (teamDraftPicks || []).map(p => p.player_id);
    } catch (error) {
      console.error('Error getting roster player IDs:', error);
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

      // Optimized: Query draft picks directly for this team (not all league picks)
      // This matches the efficient pattern used in Roster.tsx
      const { data: teamDraftPicks, error: picksError } = await supabase
        .from('draft_picks')
        .select('*')
        .eq('league_id', leagueId)
        .eq('team_id', teamId)
        .is('deleted_at', null)
        .order('pick_number', { ascending: true });
      
      if (picksError) {
        console.error('Error fetching draft picks for team:', picksError);
        // Fallback to old method if direct query fails
        const { picks: draftPicks } = await DraftService.getDraftPicks(leagueId);
        const teamPicks = draftPicks.filter(p => p.team_id === teamId);
        const playerIds = teamPicks.map(p => p.player_id);
        const teamPlayers = allPlayers.filter(p => playerIds.includes(p.id));
        
        const roster = teamPlayers.map((p) => this.transformToHockeyPlayer(p));
        
        // Cache the result
        rosterCache.set(cacheKey, { roster, timestamp: now });
        return roster;
      }
      
      // Map draft picks to players
      const playerIds = (teamDraftPicks || []).map(p => p.player_id);
      const teamPlayers = allPlayers.filter(p => playerIds.includes(p.id));

      // Transform to HockeyPlayer format
      const roster = teamPlayers.map((p) => this.transformToHockeyPlayer(p));
      
      // Cache the result
      rosterCache.set(cacheKey, { roster, timestamp: now });
      
      return roster;
    } catch (error) {
      console.error('Error getting team roster:', error);
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
      stats: {
        // For goalies, use goalie_gp instead of games_played
        gamesPlayed: (p.position === 'G' || p.position === 'Goalie') && (p as any).goalie_gp 
          ? (p as any).goalie_gp 
          : (p.games_played || 0),
        goals: p.goals || 0,
        assists: p.assists || 0,
        points: p.points || 0,
        plusMinus: p.plus_minus || 0,
        shots: p.shots || 0,
        hits: p.hits || 0,
        blockedShots: p.blocks || 0,
        xGoals: p.xGoals || 0,
        pim: (p as any).pim || 0,
        powerPlayPoints: (p as any).ppp || 0,
        shortHandedPoints: (p as any).shp || 0,
        wins: p.wins || 0,
        losses: p.losses || 0,
        otl: p.ot_losses || 0,
        gaa: p.goals_against_average || 0,
        savePct: p.save_percentage || 0,
        shutouts: (p as any).shutouts || 0,
        saves: p.saves || 0,
        goalsAgainst: p.goals_against || 0,
        goalsSavedAboveExpected: p.goalsSavedAboveExpected || 0
      },
      team: p.team,
      teamAbbreviation: p.team,
      status: p.status === 'injured' ? 'IR' : (p.status === 'active' ? null : 'WVR'),
      image: p.headshot_url || undefined,
      nextGame: { opponent: 'vs OPP', isToday: false },
      projectedPoints: (p.points || 0) / 20
    };
  },


  /**
   * Fetch daily projections for players from player_projected_stats table
   */
  async getDailyProjectionsForMatchup(
    playerIds: number[],
    targetDate: string
  ): Promise<Map<number, any>> {
    try {
      if (!playerIds || playerIds.length === 0) {
        return new Map();
      }

      const { data, error } = await supabase.rpc('get_daily_projections', {
        p_player_ids: playerIds,
        p_target_date: targetDate
      });
      
      if (error) {
        console.warn('[MatchupService] Failed to fetch daily projections:', error);
        return new Map(); // Return empty map on error (graceful degradation)
      }
      
      // Create a map for O(1) lookup during player transformation
      const projectionMap = new Map<number, any>();
      if (data && Array.isArray(data)) {
        data.forEach((p: any) => {
          if (p.player_id) {
            projectionMap.set(Number(p.player_id), p);
          }
        });
      }
      
      return projectionMap;
    } catch (error) {
      console.error('[MatchupService] Error fetching daily projections:', error);
      return new Map(); // Return empty map on error
    }
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
    matchupStats?: { goals: number; assists: number; sog: number; blocks: number; xGoals: number },
    garPercentage?: number,
    dailyProjection?: any
  ): MatchupPlayer {
    const teamAbbrev = player.teamAbbreviation || player.team || '';
    
    try {
      
      // Calculate games remaining (scheduled or live games from today onwards)
      // Test mode controlled via VITE_TEST_MODE environment variable (defaults to false)
      const TEST_MODE = import.meta.env.VITE_TEST_MODE === 'true';
      const TEST_DATE = import.meta.env.VITE_TEST_DATE || '2025-12-08';
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
      const weekGames = games.filter(g => {
        if (!g || !g.game_date) return false;
        const gameDate = new Date(g.game_date);
        gameDate.setHours(0, 0, 0, 0);
        const weekStartDate = new Date(weekStart);
        weekStartDate.setHours(0, 0, 0, 0);
        const weekEndDate = new Date(weekEnd);
        weekEndDate.setHours(23, 59, 59, 999);
        return gameDate >= weekStartDate && gameDate <= weekEndDate;
      });
      
      // Calculate games remaining from week games only
      const gamesRemaining = weekGames.filter(g => {
        const gameDate = new Date(g.game_date);
        gameDate.setHours(0, 0, 0, 0);
        return gameDate >= today && (g.status === 'scheduled' || g.status === 'live');
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
        // CRITICAL: Validate that stats are for a week, not season
        // For a single week, max should be: ~7 goals, ~10 assists, ~30 SOG (very high week)
        const MAX_REASONABLE_WEEK_GOALS = 10;
        const MAX_REASONABLE_WEEK_ASSISTS = 15;
        const MAX_REASONABLE_WEEK_SOG = 40;
        
        if (matchupStats.goals > MAX_REASONABLE_WEEK_GOALS || 
            matchupStats.assists > MAX_REASONABLE_WEEK_ASSISTS || 
            matchupStats.sog > MAX_REASONABLE_WEEK_SOG) {
          console.error(`[MatchupService.transformToMatchupPlayerWithGames] ❌ RPC returned season totals for ${player.name}: G=${matchupStats.goals}, A=${matchupStats.assists}, SOG=${matchupStats.sog} - REJECTING and using 0 points`);
          fantasyPoints = 0; // Reject season totals from RPC
          blocks = 0;
        } else {
          // Fantasy scoring: Goals=3, Assists=2, SOG=0.4, Blocks=0.4
          // CRITICAL: Use blocks from matchup week stats, NOT season stats
          blocks = matchupStats.blocks || 0; // Get from matchup week stats
          fantasyPoints = (matchupStats.goals * 3) + 
                          (matchupStats.assists * 2) + 
                          (matchupStats.sog * 0.4) + 
                          (blocks * 0.4);
        }
        
        // Debug logging for first few players
        if (Math.random() < 0.1) { // Log ~10% of players to avoid spam
          console.log(`[MatchupService.transformToMatchupPlayerWithGames] Calculated points for ${player.name}:`, {
            matchupStats: matchupStats ? {
              goals: matchupStats.goals,
              assists: matchupStats.assists,
              sog: matchupStats.sog,
              blocks: matchupStats.blocks || 0
            } : null,
            blocksFromWeek: blocks,
            blocksFromSeason: player.stats.blockedShots || 0,
            calculatedPoints: fantasyPoints,
            weekStart: weekStart.toISOString().split('T')[0],
            weekEnd: weekEnd.toISOString().split('T')[0]
          });
        }
      } else {
        // Log when matchupStats is missing
        if (Math.random() < 0.1) {
          console.warn(`[MatchupService.transformToMatchupPlayerWithGames] No matchupStats for ${player.name}, using 0 points`);
        }
      }

      // Check if player is goalie
      const isGoalie = player.position === 'G' || player.position === 'Goalie';
      
      // Base player object
      const basePlayer: MatchupPlayer = {
        id: typeof player.id === 'string' ? parseInt(player.id) || 0 : player.id || 0,
        name: player.name,
        position: player.position,
        team: teamAbbrev,
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
        games: weekGames
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
        
        // Debug logging for goalie stats
        if (Math.random() < 0.1) { // Log ~10% of goalies to avoid spam
          console.log(`[MatchupService] Goalie stats for ${player.name}:`, {
            gamesPlayed: goalieStats.gamesPlayed,
            wins: goalieStats.wins,
            saves: goalieStats.saves,
            shutouts: goalieStats.shutouts,
            gaa: goalieStats.gaa,
            savePct: goalieStats.savePct,
            rawPlayerStats: {
              gamesPlayed: player.stats.gamesPlayed,
              wins: player.stats.wins,
              saves: player.stats.saves,
              shutouts: player.stats.shutouts,
              gaa: player.stats.gaa,
              savePct: player.stats.savePct
            }
          });
        }
        
        basePlayer.goalieStats = goalieStats;
        
        // Goalie matchup stats (if available from matchupStats - would need to be extended)
        // For now, leave undefined as matchupStats is skater-focused
        
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
        
        // Skater stats should be empty/zero for goalies (but keep structure for compatibility)
        basePlayer.stats = {
          goals: 0,
          assists: 0,
          sog: 0,
          blk: 0,
          gamesPlayed: 0,
          xGoals: 0
        };
      } else {
        // Skater stats
        basePlayer.stats = matchupStats ? {
          goals: matchupStats.goals || 0,
          assists: matchupStats.assists || 0,
          sog: matchupStats.sog || 0,
          blk: matchupStats.blocks || 0,
          gamesPlayed: 0,
          xGoals: matchupStats.xGoals || 0
        } : {
          goals: 0,
          assists: 0,
          sog: 0,
          blk: 0,
          gamesPlayed: 0,
          xGoals: 0
        };
        
        basePlayer.matchupStats = matchupStats ? {
          goals: matchupStats.goals,
          assists: matchupStats.assists,
          sog: matchupStats.sog,
          blocks: matchupStats.blocks || 0,
          xGoals: matchupStats.xGoals
        } : undefined;
        
        // Skater projection
        if (dailyProjection && !dailyProjection.is_goalie) {
          basePlayer.daily_projection = {
            total_projected_points: Number(dailyProjection.total_projected_points || 0),
            projected_goals: Number(dailyProjection.projected_goals || 0),
            projected_assists: Number(dailyProjection.projected_assists || 0),
            projected_sog: Number(dailyProjection.projected_sog || 0),
            projected_blocks: Number(dailyProjection.projected_blocks || 0),
            projected_xg: Number(dailyProjection.projected_xg || 0),
            base_ppg: Number(dailyProjection.base_ppg || 0),
            shrinkage_weight: Number(dailyProjection.shrinkage_weight || 0),
            finishing_multiplier: Number(dailyProjection.finishing_multiplier || 1),
            opponent_adjustment: Number(dailyProjection.opponent_adjustment || 1),
            b2b_penalty: Number(dailyProjection.b2b_penalty || 1),
            home_away_adjustment: Number(dailyProjection.home_away_adjustment || 1),
            confidence_score: Number(dailyProjection.confidence_score || 0),
            calculation_method: dailyProjection.calculation_method || 'hybrid_bayesian',
            is_goalie: false
          };
        }
      }
      
      return basePlayer;
    } catch (error) {
      console.error(`Error transforming player ${player.name} to matchup player:`, error);
      // Return basic player info if schedule lookup fails
      return {
        id: typeof player.id === 'string' ? parseInt(player.id) || 0 : player.id || 0,
        name: player.name,
        position: player.position,
        team: teamAbbrev,
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
          xGoals: player.stats.xGoals || 0
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
        console.warn(`Error fetching games for ${teamAbbrev}:`, gamesError);
      }
      
      return this.transformToMatchupPlayerWithGames(player, isStarter, weekStart, weekEnd, timezone, games || [], undefined, undefined);
    } catch (error) {
      console.error(`Error transforming player ${player.name} to matchup player:`, error);
      return this.transformToMatchupPlayerWithGames(player, isStarter, weekStart, weekEnd, timezone, [], undefined, undefined);
    }
  },

  /**
   * Get matchup rosters for both teams with real schedule data
   */
  async getMatchupRosters(
    matchup: Matchup,
    allPlayers: Player[],
    timezone: string = 'America/Denver'
  ): Promise<{ 
    team1Roster: MatchupPlayer[]; 
    team2Roster: MatchupPlayer[]; 
    team1SlotAssignments: Record<string, string>;
    team2SlotAssignments: Record<string, string>;
    error: any 
  }> {
    try {
      // Validate: Ensure team1_id !== team2_id (prevent duplicate teams)
      if (matchup.team2_id && matchup.team1_id === matchup.team2_id) {
        const error = new Error('Invalid matchup: team1 and team2 cannot be the same team');
        console.error('Matchup validation error:', error);
        return {
          team1Roster: [],
          team2Roster: [],
          team1SlotAssignments: {},
          team2SlotAssignments: {},
          error
        };
      }

      // Get week date range
      const weekStart = new Date(matchup.week_start_date);
      const weekEnd = new Date(matchup.week_end_date);

      // Parallelize: Get rosters and lineups for both teams simultaneously
      // Note: Clear cache first to ensure we get fresh lineup data
      this.clearRosterCache(matchup.team1_id, matchup.league_id);
      if (matchup.team2_id) {
        this.clearRosterCache(matchup.team2_id, matchup.league_id);
      }
      
      // Wrap each query in timeout to prevent one slow query from hanging the entire Promise.all()
      const [team1Roster, team2Roster, team1LineupResult, team2LineupResult] = await Promise.all([
        withTimeout(this.getTeamRoster(matchup.team1_id, matchup.league_id, allPlayers), 5000, 'getTeamRoster timeout for team1'),
        matchup.team2_id
          ? withTimeout(this.getTeamRoster(matchup.team2_id, matchup.league_id, allPlayers), 5000, 'getTeamRoster timeout for team2')
          : Promise.resolve([]),
        withTimeout(LeagueService.getLineup(matchup.team1_id, matchup.league_id), 5000, 'getLineup timeout for team1'),
        matchup.team2_id
          ? withTimeout(LeagueService.getLineup(matchup.team2_id, matchup.league_id), 5000, 'getLineup timeout for team2')
          : Promise.resolve(null)
      ]);

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
        
        // Sort players by points (best players first)
        const sortedRoster = [...roster].sort((a, b) => (b.points || 0) - (a.points || 0));
        
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

      // Auto-initialize missing lineups for opponent teams
      // This ensures all teams have lineups for future week matchups
      if (!team1Lineup && team1Roster.length > 0) {
        console.log(`[MatchupService] Auto-initializing default lineup for Team1 (${matchup.team1_id})`);
        const defaultLineup = organizeRosterIntoLineup(team1Roster);
        team1Lineup = defaultLineup;
        // Save the default lineup to database
        await LeagueService.saveLineup(matchup.team1_id, matchup.league_id, defaultLineup);
        console.log(`[MatchupService] Saved default lineup for Team1: ${defaultLineup.starters.length} starters`);
      }

      if (matchup.team2_id && !team2Lineup && team2Roster.length > 0) {
        console.log(`[MatchupService] Auto-initializing default lineup for Team2 (${matchup.team2_id})`);
        const defaultLineup = organizeRosterIntoLineup(team2Roster);
        team2Lineup = defaultLineup;
        // Save the default lineup to database
        await LeagueService.saveLineup(matchup.team2_id, matchup.league_id, defaultLineup);
        console.log(`[MatchupService] Saved default lineup for Team2: ${defaultLineup.starters.length} starters`);
      }

      // Debug logging to help diagnose lineup sync issues
      if (team1Lineup) {
        console.log(`[MatchupService] Team1 lineup loaded: ${team1Lineup.starters.length} starters, ${team1Lineup.bench.length} bench, ${team1Lineup.ir.length} IR`);
        console.log(`[MatchupService] Team1 starter IDs:`, team1Lineup.starters);
      } else {
        const error = new Error(`Team ${matchup.team1_id} has no saved lineup and roster is empty.`);
        console.error('[MatchupService] No lineup found for team1:', error);
        return {
          team1Roster: [],
          team2Roster: [],
          team1SlotAssignments: {},
          team2SlotAssignments: {},
          error
        };
      }

      if (matchup.team2_id && !team2Lineup) {
        const error = new Error(`Opponent team ${matchup.team2_id} has no saved lineup and roster is empty.`);
        console.error('[MatchupService] No lineup found for team2:', error);
        return {
          team1Roster: [],
          team2Roster: [],
          team1SlotAssignments: {},
          team2SlotAssignments: {},
          error
        };
      }

      // Use saved lineups (strict - no auto-assignment fallback)
      const team1Starters = new Set((team1Lineup.starters || []).map(id => String(id)));
      
      // Normalize slot assignment keys to strings for consistency
      const rawTeam1SlotAssignments = team1Lineup.slotAssignments || {};
      const team1SlotAssignments: Record<string, string> = {};
      Object.entries(rawTeam1SlotAssignments).forEach(([playerId, slotId]) => {
        team1SlotAssignments[String(playerId)] = slotId;
      });
      
      const team2Starters = matchup.team2_id && team2Lineup
        ? new Set((team2Lineup.starters || []).map(id => String(id)))
        : new Set();
      
      const rawTeam2SlotAssignments = matchup.team2_id && team2Lineup
        ? (team2Lineup.slotAssignments || {})
        : {};
      const team2SlotAssignments: Record<string, string> = {};
      Object.entries(rawTeam2SlotAssignments).forEach(([playerId, slotId]) => {
        team2SlotAssignments[String(playerId)] = slotId;
      });

      // Batch schedule queries: Get all unique teams from both rosters
      const allTeams = Array.from(new Set([
        ...team1Roster.map(p => p.teamAbbreviation || p.team || ''),
        ...team2Roster.map(p => p.teamAbbreviation || p.team || '')
      ].filter(team => team !== '')));

      // Fetch all games for all teams in one batch query (with timeout to prevent hang)
      const { gamesByTeam } = await withTimeout(
        ScheduleService.getGamesForTeams(allTeams, weekStart, weekEnd),
        10000,
        'getGamesForTeams timeout'
      );

      // Collect all player IDs from both rosters
      const allPlayerIds = [
        ...team1Roster.map(p => typeof p.id === 'string' ? parseInt(p.id) || 0 : p.id || 0),
        ...team2Roster.map(p => typeof p.id === 'string' ? parseInt(p.id) || 0 : p.id || 0)
      ].filter(id => id > 0);

      // NEW: Fetch pre-calculated matchup lines (with graceful degradation)
      let matchupLines = new Map<number, any>();
      try {
        matchupLines = await this.getMatchupLines(matchup.id);
      } catch (error) {
        console.warn('[MatchupService] Failed to fetch matchup lines, continuing with empty data:', error);
        // Continue with empty Map - page should still load
      }

      // Fetch matchup stats for the week (with graceful degradation)
      let matchupStatsMap = new Map<number, { goals: number; assists: number; sog: number; blocks: number; xGoals: number }>();
      try {
        const weekStartStr = weekStart.toISOString().split('T')[0];
        const weekEndStr = weekEnd.toISOString().split('T')[0];
        
        console.log('[MatchupService.getMatchupRosters] 📊 Fetching matchup stats for week:', {
          weekStart: weekStartStr,
          weekEnd: weekEndStr,
          playerCount: allPlayerIds.length,
          matchupId: matchup.id
        });
        
        matchupStatsMap = await this.fetchMatchupStatsForPlayers(allPlayerIds, weekStart, weekEnd);
        
        if (matchupStatsMap.size > 0) {
          const sampleEntry = Array.from(matchupStatsMap.entries())[0];
          const playersWithStats = Array.from(matchupStatsMap.entries()).slice(0, 3);
          
          // Check if sample players have season-total-like numbers
          const highValuePlayers = playersWithStats.filter(([id, stats]) => 
            stats.goals > 20 || stats.assists > 30 || stats.sog > 100
          );
          
          console.log('[MatchupService.getMatchupRosters] ✅ Matchup stats fetched successfully:');
          console.log(`  Stats Map Size: ${matchupStatsMap.size}, Expected: ${allPlayerIds.length}, Coverage: ${((matchupStatsMap.size / allPlayerIds.length) * 100).toFixed(1)}%`);
          console.log(`  Week: ${weekStartStr} to ${weekEndStr}`);
          console.log(`  Sample Players:`);
          playersWithStats.forEach(([id, stats]) => {
            const looksLikeSeason = stats.goals > 20 || stats.assists > 30 || stats.sog > 100;
            console.log(`    Player ${id}: G=${stats.goals}, A=${stats.assists}, SOG=${stats.sog}, Blocks=${stats.blocks || 0} ${looksLikeSeason ? '❌ SEASON TOTAL' : '✅ Week'}`);
          });
          
          if (highValuePlayers.length > 0) {
            console.error(`  ❌ ${highValuePlayers.length} sample players have season-total-like numbers! RPC may be broken!`);
          } else {
            console.log(`  ✅ All sample players look like week totals`);
          }
        } else {
          console.error('[MatchupService.getMatchupRosters] ❌ CRITICAL: Matchup stats map is EMPTY - no week data found!', {
            weekStart: weekStartStr,
            weekEnd: weekEndStr,
            playerCount: allPlayerIds.length,
            matchupId: matchup.id,
            samplePlayerIds: allPlayerIds.slice(0, 5)
          });
        }
      } catch (error) {
        console.error('[MatchupService] ❌ Failed to fetch matchup stats:', error);
        // Continue with empty Map - page should still load
      }
      
      // Fetch daily projections for today's games
      const todayMST = getTodayMST();
      let dailyProjectionsMap = new Map<number, any>();
      try {
        dailyProjectionsMap = await this.getDailyProjectionsForMatchup(allPlayerIds, todayMST);
        console.log(`[MatchupService] Fetched ${dailyProjectionsMap.size} daily projections for ${todayMST}`);
        console.log(`[MatchupService] Projection coverage: Team1 players: ${team1Roster.length}, Team2 players: ${team2Roster.length}, Total projections: ${dailyProjectionsMap.size}`);
        
        // Debug: Log sample projections for both teams
        const team1SampleIds = team1Roster.slice(0, 3).map(p => typeof p.id === 'string' ? parseInt(p.id) || 0 : p.id || 0);
        const team2SampleIds = team2Roster.slice(0, 3).map(p => typeof p.id === 'string' ? parseInt(p.id) || 0 : p.id || 0);
        console.log(`[MatchupService] Team1 sample projections:`, team1SampleIds.map(id => ({ id, hasProjection: dailyProjectionsMap.has(id), projection: dailyProjectionsMap.get(id) })));
        console.log(`[MatchupService] Team2 sample projections:`, team2SampleIds.map(id => ({ id, hasProjection: dailyProjectionsMap.has(id), projection: dailyProjectionsMap.get(id) })));
      } catch (error) {
        console.warn('[MatchupService] Failed to fetch daily projections, continuing without them:', error);
      }
      
      const garMap = new Map<number, number>();

      // Transform players with pre-fetched schedule data, matchup stats, GAR, and daily projections
      const team1MatchupPlayers = await Promise.all(
        team1Roster.map(p => {
          const playerId = typeof p.id === 'string' ? parseInt(p.id) || 0 : p.id || 0;
          const playerGames = gamesByTeam.get(p.teamAbbreviation || p.team || '') || [];
          const dailyProjection = dailyProjectionsMap.get(playerId);
          if (!dailyProjection && playerId > 0) {
            console.warn(`[MatchupService] Team1 player ${p.name} (ID: ${playerId}) missing daily projection`);
          }
          const transformed = this.transformToMatchupPlayerWithGames(
            p,
            team1Starters.has(String(p.id)),
            weekStart,
            weekEnd,
            timezone,
            playerGames,
            matchupStatsMap.get(playerId),
            garMap.get(playerId),
            dailyProjection
          );
          
          // Get calculated games remaining from transformed player (already filtered to week)
          const gamesRemaining = transformed.games_remaining_total || 0;
          
          // Merge matchup line data if available
          const matchupLine = matchupLines.get(playerId);
          const matchupStats = matchupStatsMap.get(playerId);
          
          // Helper function to calculate matchup week points from stats
          const calculateMatchupWeekPoints = (stats: { goals: number; assists: number; sog: number; blocks?: number } | undefined): number => {
            if (!stats) return 0;
            
            // CRITICAL: Validate that stats are for a week, not season
            // For a single week, max should be: ~7 goals, ~10 assists, ~30 SOG (very high week)
            // If stats are too high, RPC returned season totals - reject them
            const MAX_REASONABLE_WEEK_GOALS = 10;
            const MAX_REASONABLE_WEEK_ASSISTS = 15;
            const MAX_REASONABLE_WEEK_SOG = 40;
            
            if (stats.goals > MAX_REASONABLE_WEEK_GOALS || 
                stats.assists > MAX_REASONABLE_WEEK_ASSISTS || 
                stats.sog > MAX_REASONABLE_WEEK_SOG) {
              console.error(`[MatchupService] ❌ RPC returned season totals for ${p.name}: G=${stats.goals}, A=${stats.assists}, SOG=${stats.sog} - REJECTING and using 0 points`);
              return 0; // Reject season totals from RPC
            }
            
            // CRITICAL: Use blocks from matchup week stats, NOT season stats
            const blocks = stats.blocks || 0; // Get from matchup week stats
            return (stats.goals * 3) + 
                   (stats.assists * 2) + 
                   (stats.sog * 0.4) + 
                   (blocks * 0.4);
          };
          
          if (matchupLine) {
            // CRITICAL: Always prefer matchupStats (from RPC) over database value
            // The database may have season totals, but RPC has correct weekly stats
            const MAX_REASONABLE_WEEK_POINTS = 100;
            let matchupWeekPoints: number;
            
            if (matchupStats) {
              // RPC returned weekly stats - always use them (they're the source of truth)
              matchupWeekPoints = calculateMatchupWeekPoints(matchupStats);
              
              // Validate that RPC stats look reasonable for a week
              const isLikelySeasonTotal = matchupStats.goals > 20 || matchupStats.assists > 30 || matchupStats.sog > 100;
              if (isLikelySeasonTotal) {
                console.error(`[MatchupService] ❌ RPC RETURNED SEASON TOTALS for ${p.name} (${playerId}): G=${matchupStats.goals}, A=${matchupStats.assists}, SOG=${matchupStats.sog} - REJECTING and using 0`);
                matchupWeekPoints = 0; // Reject season totals from RPC
              }
              
              // Log if database value was suspicious (for debugging)
              if (matchupLine.total_points > MAX_REASONABLE_WEEK_POINTS) {
                console.warn(`[MatchupService] ⚠️ Database had season totals (${matchupLine.total_points}) for ${p.name} (${playerId}), using RPC value (${matchupWeekPoints})`);
              }
            } else {
              // No RPC stats - player didn't play this week (injured, scratched, etc.)
              // Always set to 0, regardless of database value (database may have old/incorrect data)
              matchupWeekPoints = 0;
              
              // Log if database had suspicious values (for debugging)
              if (matchupLine.total_points > MAX_REASONABLE_WEEK_POINTS) {
                console.warn(`[MatchupService] ⚠️ No matchupStats for ${p.name} (${playerId}) - player didn't play this week. Database had ${matchupLine.total_points} (likely season totals), setting to 0.`, {
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
              const statsBreakdown = matchupStats ? {
                goals: matchupStats.goals,
                assists: matchupStats.assists,
                sog: matchupStats.sog,
                blocks: matchupStats.blocks || 0,
                calculated: (matchupStats.goals * 3) + (matchupStats.assists * 2) + (matchupStats.sog * 0.4) + ((matchupStats.blocks || 0) * 0.4)
              } : null;
              
              console.log(`[MatchupService] ✅ FINAL SET: ${p.name} (${playerId})`, {
                databaseValue: matchupLine.total_points,
                finalValue: matchupWeekPoints,
                matchupStatsExists: !!matchupStats,
                matchupStats: statsBreakdown,
                // Verify: If matchupStats has high numbers, RPC is broken
                rpcMayBeBroken: statsBreakdown ? (statsBreakdown.goals > 20 || statsBreakdown.assists > 30 || statsBreakdown.sog > 100) : false
              });
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
              // Calculate breakdown from weekly stats using scoring: Goals=3, Assists=2, SOG=0.4, Blocks=0.4
              const goalsPoints = (matchupStats.goals || 0) * 3;
              const assistsPoints = (matchupStats.assists || 0) * 2;
              const sogPoints = (matchupStats.sog || 0) * 0.4;
              const blocksPoints = (matchupStats.blocks || 0) * 0.4;
              
              transformed.stats_breakdown = {
                'Goals': {
                  count: matchupStats.goals || 0,
                  points: goalsPoints,
                  logic: `${matchupStats.goals || 0} goals * 3.0 points`
                },
                'Assists': {
                  count: matchupStats.assists || 0,
                  points: assistsPoints,
                  logic: `${matchupStats.assists || 0} assists * 2.0 points`
                },
                'Shots on Goal': {
                  count: matchupStats.sog || 0,
                  points: sogPoints,
                  logic: `${matchupStats.sog || 0} shots * 0.4 points`
                },
                'Blocks': {
                  count: matchupStats.blocks || 0,
                  points: blocksPoints,
                  logic: `${matchupStats.blocks || 0} blocks * 0.4 points`
                }
              };
            } else {
              // No weekly stats - player didn't play, breakdown should be empty/undefined
              transformed.stats_breakdown = undefined;
            }
            
            // Points already set above - matchupWeekPoints
          } else {
            // No matchup line data - calculate from matchup stats (matchup week only)
            const calculatedPoints = calculateMatchupWeekPoints(matchupStats);
            transformed.total_points = calculatedPoints;
            transformed.points = calculatedPoints; // Use matchup week points, not season
            
            // Calculate stats_breakdown from weekly matchupStats
            if (matchupStats) {
              const goalsPoints = (matchupStats.goals || 0) * 3;
              const assistsPoints = (matchupStats.assists || 0) * 2;
              const sogPoints = (matchupStats.sog || 0) * 0.4;
              const blocksPoints = (matchupStats.blocks || 0) * 0.4;
              
              transformed.stats_breakdown = {
                'Goals': {
                  count: matchupStats.goals || 0,
                  points: goalsPoints,
                  logic: `${matchupStats.goals || 0} goals * 3.0 points`
                },
                'Assists': {
                  count: matchupStats.assists || 0,
                  points: assistsPoints,
                  logic: `${matchupStats.assists || 0} assists * 2.0 points`
                },
                'Shots on Goal': {
                  count: matchupStats.sog || 0,
                  points: sogPoints,
                  logic: `${matchupStats.sog || 0} shots * 0.4 points`
                },
                'Blocks': {
                  count: matchupStats.blocks || 0,
                  points: blocksPoints,
                  logic: `${matchupStats.blocks || 0} blocks * 0.4 points`
                }
              };
            } else {
              transformed.stats_breakdown = undefined;
            }
            
            // Debug: Log when no matchup line exists
            if (Math.random() < 0.1) {
              console.log(`[MatchupService] No matchupLine for ${p.name} (${playerId}), calculated: ${calculatedPoints} from matchupStats:`, matchupStats);
            }
            transformed.games_remaining_total = gamesRemaining;
            transformed.games_remaining_active = team1Starters.has(String(p.id)) ? gamesRemaining : 0;
          }
          
          // Add games array for GameLogosBar
          transformed.games = playerGames;
          
          return transformed;
        })
      );

      const team2MatchupPlayers = await Promise.all(
        team2Roster.map(p => {
          const playerId = typeof p.id === 'string' ? parseInt(p.id) || 0 : p.id || 0;
          const playerGames = gamesByTeam.get(p.teamAbbreviation || p.team || '') || [];
          const dailyProjection = dailyProjectionsMap.get(playerId);
          if (!dailyProjection && playerId > 0) {
            console.warn(`[MatchupService] Team2 player ${p.name} (ID: ${playerId}) missing daily projection`);
          }
          const transformed = this.transformToMatchupPlayerWithGames(
            p,
            team2Starters.has(String(p.id)),
            weekStart,
            weekEnd,
            timezone,
            playerGames,
            matchupStatsMap.get(playerId),
            garMap.get(playerId),
            dailyProjection
          );
          
          // Get calculated games remaining from transformed player (already filtered to week)
          const gamesRemaining = transformed.games_remaining_total || 0;
          
          // Merge matchup line data if available
          const matchupLine = matchupLines.get(playerId);
          const matchupStats = matchupStatsMap.get(playerId);
          
          // Helper function to calculate matchup week points from stats
          const calculateMatchupWeekPoints = (stats: { goals: number; assists: number; sog: number; blocks?: number } | undefined): number => {
            if (!stats) return 0;
            
            // CRITICAL: Validate that stats are for a week, not season
            // For a single week, max should be: ~7 goals, ~10 assists, ~30 SOG (very high week)
            // If stats are too high, RPC returned season totals - reject them
            const MAX_REASONABLE_WEEK_GOALS = 10;
            const MAX_REASONABLE_WEEK_ASSISTS = 15;
            const MAX_REASONABLE_WEEK_SOG = 40;
            
            if (stats.goals > MAX_REASONABLE_WEEK_GOALS || 
                stats.assists > MAX_REASONABLE_WEEK_ASSISTS || 
                stats.sog > MAX_REASONABLE_WEEK_SOG) {
              console.error(`[MatchupService] ❌ RPC returned season totals for ${p.name}: G=${stats.goals}, A=${stats.assists}, SOG=${stats.sog} - REJECTING and using 0 points`);
              return 0; // Reject season totals from RPC
            }
            
            // CRITICAL: Use blocks from matchup week stats, NOT season stats
            const blocks = stats.blocks || 0; // Get from matchup week stats
            return (stats.goals * 3) + 
                   (stats.assists * 2) + 
                   (stats.sog * 0.4) + 
                   (blocks * 0.4);
          };
          
          if (matchupLine) {
            // CRITICAL: Always prefer matchupStats (from RPC) over database value
            // The database may have season totals, but RPC has correct weekly stats
            const MAX_REASONABLE_WEEK_POINTS = 100;
            let matchupWeekPoints: number;
            
            if (matchupStats) {
              // RPC returned weekly stats - always use them (they're the source of truth)
              matchupWeekPoints = calculateMatchupWeekPoints(matchupStats);
              
              // Validate that RPC stats look reasonable for a week
              const isLikelySeasonTotal = matchupStats.goals > 20 || matchupStats.assists > 30 || matchupStats.sog > 100;
              if (isLikelySeasonTotal) {
                console.error(`[MatchupService] ❌ RPC RETURNED SEASON TOTALS for ${p.name} (${playerId}): G=${matchupStats.goals}, A=${matchupStats.assists}, SOG=${matchupStats.sog} - REJECTING and using 0`);
                matchupWeekPoints = 0; // Reject season totals from RPC
              }
              
              // Log if database value was suspicious (for debugging)
              if (matchupLine.total_points > MAX_REASONABLE_WEEK_POINTS) {
                console.warn(`[MatchupService] ⚠️ Database had season totals (${matchupLine.total_points}) for ${p.name} (${playerId}), using RPC value (${matchupWeekPoints})`);
              }
            } else {
              // No RPC stats - player didn't play this week (injured, scratched, etc.)
              // Always set to 0, regardless of database value (database may have old/incorrect data)
              matchupWeekPoints = 0;
              
              // Log if database had suspicious values (for debugging)
              if (matchupLine.total_points > MAX_REASONABLE_WEEK_POINTS) {
                console.warn(`[MatchupService] ⚠️ No matchupStats for ${p.name} (${playerId}) - player didn't play this week. Database had ${matchupLine.total_points} (likely season totals), setting to 0.`, {
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
              const statsBreakdown = matchupStats ? {
                goals: matchupStats.goals,
                assists: matchupStats.assists,
                sog: matchupStats.sog,
                blocks: matchupStats.blocks || 0,
                calculated: (matchupStats.goals * 3) + (matchupStats.assists * 2) + (matchupStats.sog * 0.4) + ((matchupStats.blocks || 0) * 0.4)
              } : null;
              
              console.log(`[MatchupService] ✅ FINAL SET: ${p.name} (${playerId})`, {
                databaseValue: matchupLine.total_points,
                finalValue: matchupWeekPoints,
                matchupStatsExists: !!matchupStats,
                matchupStats: statsBreakdown,
                // Verify: If matchupStats has high numbers, RPC is broken
                rpcMayBeBroken: statsBreakdown ? (statsBreakdown.goals > 20 || statsBreakdown.assists > 30 || statsBreakdown.sog > 100) : false
              });
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
              // Calculate breakdown from weekly stats using scoring: Goals=3, Assists=2, SOG=0.4, Blocks=0.4
              const goalsPoints = (matchupStats.goals || 0) * 3;
              const assistsPoints = (matchupStats.assists || 0) * 2;
              const sogPoints = (matchupStats.sog || 0) * 0.4;
              const blocksPoints = (matchupStats.blocks || 0) * 0.4;
              
              transformed.stats_breakdown = {
                'Goals': {
                  count: matchupStats.goals || 0,
                  points: goalsPoints,
                  logic: `${matchupStats.goals || 0} goals * 3.0 points`
                },
                'Assists': {
                  count: matchupStats.assists || 0,
                  points: assistsPoints,
                  logic: `${matchupStats.assists || 0} assists * 2.0 points`
                },
                'Shots on Goal': {
                  count: matchupStats.sog || 0,
                  points: sogPoints,
                  logic: `${matchupStats.sog || 0} shots * 0.4 points`
                },
                'Blocks': {
                  count: matchupStats.blocks || 0,
                  points: blocksPoints,
                  logic: `${matchupStats.blocks || 0} blocks * 0.4 points`
                }
              };
            } else {
              // No weekly stats - player didn't play, breakdown should be empty/undefined
              transformed.stats_breakdown = undefined;
            }
            
            // Points already set above - matchupWeekPoints
          } else {
            // No matchup line data - calculate from matchup stats (matchup week only)
            const calculatedPoints = calculateMatchupWeekPoints(matchupStats);
            transformed.total_points = calculatedPoints;
            transformed.points = calculatedPoints; // Use matchup week points, not season
            
            // Debug: Log when no matchup line exists
            if (Math.random() < 0.1) {
              console.log(`[MatchupService] No matchupLine for ${p.name} (${playerId}), calculated: ${calculatedPoints} from matchupStats:`, matchupStats);
            }
            transformed.games_remaining_total = gamesRemaining;
            transformed.games_remaining_active = team2Starters.has(String(p.id)) ? gamesRemaining : 0;
          }
          
          // Add games array for GameLogosBar
          transformed.games = playerGames;
          
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
    } catch (error) {
      console.error('Error getting matchup rosters:', error);
      return {
        team1Roster: [],
        team2Roster: [],
        team1SlotAssignments: {},
        team2SlotAssignments: {},
        error
      };
    }
  },

  /**
   * Calculate team score from roster (using season totals for now)
   */
  calculateTeamScore(roster: MatchupPlayer[]): number {
    return roster.reduce((sum, player) => sum + player.points, 0);
  },

  /**
   * Get team record (wins/losses) from completed matchups
   */
  async getTeamRecord(teamId: string, leagueId: string): Promise<{ wins: number; losses: number }> {
    try {
      const { data: matchups, error } = await supabase
        .from('matchups')
        .select('*')
        .eq('league_id', leagueId)
        .eq('status', 'completed')
        .or(`team1_id.eq.${teamId},team2_id.eq.${teamId}`);

      if (error) throw error;

      let wins = 0;
      let losses = 0;

      (matchups || []).forEach(matchup => {
        const isTeam1 = matchup.team1_id === teamId;
        const myScore = isTeam1 ? matchup.team1_score : matchup.team2_score;
        const oppScore = isTeam1 ? matchup.team2_score : matchup.team1_score;

        if (myScore > oppScore) {
          wins++;
        } else if (oppScore > myScore) {
          losses++;
        }
        // Ties are not counted (or could be counted as 0.5 wins/losses)
      });

      return { wins, losses };
    } catch (error) {
      console.error('Error getting team record:', error);
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
    error: any 
  }> {
    try {
      if (!team2Id) {
        return { matchups: [], error: null };
      }

      // Query for matchups where team1 is team1Id and team2 is team2Id, OR vice versa
      // Use two separate queries and combine results
      const { data: data1, error: error1 } = await supabase
        .from('matchups')
        .select('*')
        .eq('league_id', leagueId)
        .eq('status', 'completed')
        .eq('team1_id', team1Id)
        .eq('team2_id', team2Id);

      if (error1) throw error1;

      const { data: data2, error: error2 } = await supabase
        .from('matchups')
        .select('*')
        .eq('league_id', leagueId)
        .eq('status', 'completed')
        .eq('team1_id', team2Id)
        .eq('team2_id', team1Id);

      if (error2) throw error2;

      // Combine and deduplicate results
      const allMatchups = [...(data1 || []), ...(data2 || [])];
      const uniqueMatchups = allMatchups.filter((m, index, self) => 
        index === self.findIndex(t => t.id === m.id)
      );

      // Sort by week number descending
      const data = uniqueMatchups.sort((a, b) => b.week_number - a.week_number);
      const error = null;

      if (error) throw error;

      const matchups = (data || []).map(m => ({
        week: m.week_number,
        team1Id: m.team1_id,
        team2Id: m.team2_id,
        team1Score: parseFloat(m.team1_score) || 0,
        team2Score: parseFloat(m.team2_score) || 0,
        weekStart: new Date(m.week_start_date)
      }));

      return { matchups, error: null };
    } catch (error) {
      console.error('Error getting matchup history:', error);
      return { matchups: [], error };
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
    error: any;
  }> {
    try {
      // Get league to determine schedule length
      const { data: league, error: leagueError } = await supabase
        .from('leagues')
        .select('*')
        .eq('id', leagueId)
        .maybeSingle();

      if (leagueError) throw leagueError;
      if (!league) {
        return { rounds: [], bracketSize: 0, error: new Error('League not found') };
      }

      // Get first week start date
      const draftCompletionDate = league.updated_at ? new Date(league.updated_at) : new Date();
      const firstWeekStart = getFirstWeekStartDate(draftCompletionDate);
      const currentYear = new Date().getFullYear();
      const scheduleLength = getScheduleLength(firstWeekStart, currentYear);

      // Get all teams to determine bracket size
      const { teams } = await LeagueService.getLeagueTeams(leagueId);
      const numTeams = teams.length;

      // Determine bracket size (typically top 4, 6, or 8 teams)
      let bracketSize = 0;
      if (numTeams >= 8) bracketSize = 8;
      else if (numTeams >= 6) bracketSize = 6;
      else if (numTeams >= 4) bracketSize = 4;

      if (bracketSize === 0) {
        return { rounds: [], bracketSize: 0, error: new Error('Not enough teams for playoffs') };
      }

      // Get all playoff matchups (weeks after scheduleLength)
      const { data: playoffMatchups, error: matchupsError } = await supabase
        .from('matchups')
        .select('*')
        .eq('league_id', leagueId)
        .gt('week_number', scheduleLength)
        .order('week_number', { ascending: true })
        .order('created_at', { ascending: true });

      if (matchupsError) throw matchupsError;

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
    } catch (error) {
      console.error('Error getting playoff bracket:', error);
      return { rounds: [], bracketSize: 0, error };
    }
  },

  /**
   * Fetch pre-calculated matchup lines from fantasy_matchup_lines table
   */
  async getMatchupLines(matchupId: string): Promise<Map<number, any>> {
    try {
      const queryPromise = supabase
        .from('fantasy_matchup_lines')
        .select('*')
        .eq('matchup_id', matchupId);
      
      let data: any = null;
      let error: any = null;
      try {
        const result = await withTimeout(queryPromise, 5000, 'getMatchupLines timeout');
        data = result.data;
        error = result.error;
      } catch (timeoutError: any) {
        console.error('[MatchupService.getMatchupLines] Query timeout:', timeoutError);
        error = timeoutError;
      }
      
      if (error) throw error;
      
      // Convert array to Map keyed by player_id for O(1) lookup
      const linesMap = new Map<number, any>();
      (data || []).forEach(line => {
        linesMap.set(line.player_id, line);
      });
      
      return linesMap;
    } catch (error) {
      console.warn('[MatchupService] getMatchupLines timeout or error:', error);
      return new Map(); // Graceful degradation
    }
  },

  /**
   * Fetch matchup stats for players in the matchup week
   */
  async fetchMatchupStatsForPlayers(
    playerIds: number[],
    startDate: Date,
    endDate: Date
  ): Promise<Map<number, { goals: number; assists: number; sog: number; blocks: number; xGoals: number }>> {
    try {
      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];
      
      console.log('[MatchupService.fetchMatchupStatsForPlayers] 📞 Calling RPC with:', {
        playerCount: playerIds.length,
        startDate: startDateStr,
        endDate: endDateStr,
        dateRange: `${startDateStr} to ${endDateStr}`,
        samplePlayerIds: playerIds.slice(0, 5),
        // CRITICAL: Verify dates are correct format (YYYY-MM-DD)
        dateFormatCheck: {
          startDateValid: /^\d{4}-\d{2}-\d{2}$/.test(startDateStr),
          endDateValid: /^\d{4}-\d{2}-\d{2}$/.test(endDateStr),
          startDateObj: startDate.toISOString(),
          endDateObj: endDate.toISOString()
        }
      });
      
      const rpcPromise = supabase.rpc('get_matchup_stats', {
        p_player_ids: playerIds,
        p_start_date: startDateStr,
        p_end_date: endDateStr
      });
      
      let data: any = null;
      let error: any = null;
      try {
        const result = await withTimeout(rpcPromise, 5000, 'fetchMatchupStatsForPlayers timeout');
        data = result.data;
        error = result.error;
      } catch (timeoutError: any) {
        console.error('[MatchupService.fetchMatchupStatsForPlayers] RPC timeout:', timeoutError);
        error = timeoutError;
      }
      
      if (error) throw error;
      
      const statsMap = new Map<number, { goals: number; assists: number; sog: number; blocks: number; xGoals: number }>();
      (data || []).forEach((row: any) => {
        statsMap.set(row.player_id, {
          goals: row.goals || 0,
          assists: row.assists || 0,
          sog: row.shots_on_goal || 0,
          blocks: row.blocks || 0, // CRITICAL: Get blocks from matchup week stats, not season stats
          xGoals: parseFloat(row.x_goals || 0)
        });
      });
      
      if (statsMap.size > 0) {
        const sampleEntry = Array.from(statsMap.entries())[0];
        const sampleStats = sampleEntry[1];
        // Check if sample looks like season totals (high numbers)
        // For a week, max should be: ~7 goals, ~10 assists, ~30 SOG (very high week)
        const looksLikeSeasonTotal = sampleStats.goals > 20 || sampleStats.assists > 30 || sampleStats.sog > 100;
        
        // Calculate expected points for sample to verify
        const samplePoints = (sampleStats.goals * 3) + (sampleStats.assists * 2) + (sampleStats.sog * 0.4) + ((sampleStats.blocks || 0) * 0.4);
        
        // CRITICAL: Log explicitly to see actual values
        console.log('[MatchupService.fetchMatchupStatsForPlayers] RPC returned:');
        console.log(`  Total Rows: ${(data || []).length}, Stats Map Size: ${statsMap.size}`);
        console.log(`  Date Range: ${startDateStr} to ${endDateStr}`);
        console.log(`  Sample Player ID: ${sampleEntry[0]}`);
        console.log(`  Sample Stats:`, {
          goals: sampleStats.goals,
          assists: sampleStats.assists,
          sog: sampleStats.sog,
          blocks: sampleStats.blocks || 0,
          xGoals: sampleStats.xGoals,
          calculatedPoints: samplePoints
        });
        
        if (looksLikeSeasonTotal) {
          console.error(`  ❌ RPC IS RETURNING SEASON TOTALS! Sample has Goals: ${sampleStats.goals}, Assists: ${sampleStats.assists}, SOG: ${sampleStats.sog} - These are season numbers!`);
        } else {
          console.log(`  ✅ Sample stats look reasonable for a week`);
        }
        
        // Show additional samples
        const additionalSamples = Array.from(statsMap.entries()).slice(1, 4);
        if (additionalSamples.length > 0) {
          console.log(`  Additional Samples:`);
          additionalSamples.forEach(([id, stats]) => {
            const looksLikeSeason = stats.goals > 20 || stats.assists > 30 || stats.sog > 100;
            console.log(`    Player ${id}: G=${stats.goals}, A=${stats.assists}, SOG=${stats.sog} ${looksLikeSeason ? '❌ SEASON TOTAL' : '✅ Week'}`);
          });
        }
      } else {
        console.warn('[MatchupService.fetchMatchupStatsForPlayers] ⚠️ RPC returned NO DATA:', {
          totalRows: (data || []).length,
          playerCount: playerIds.length,
          dateRange: `${startDateStr} to ${endDateStr}`
        });
      }
      
      return statsMap;
    } catch (error) {
      console.warn('[MatchupService] fetchMatchupStatsForPlayers timeout or error:', error);
      return new Map(); // Graceful degradation
    }
  },

  /**
   * Transform raw stats_breakdown JSONB to StatBreakdown interface
   */
  transformStatsBreakdown(rawBreakdown: any): StatBreakdown | undefined {
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
  ): Promise<{ error: any; updatedCount?: number; results?: Array<{ matchup_id: string; team1_score: number; team2_score: number; updated: boolean }> }> {
    try {
      // Input validation
      if (leagueId && typeof leagueId !== 'string') {
        throw new Error('leagueId must be a string');
      }

      const { data, error } = await supabase.rpc('update_all_matchup_scores', {
        p_league_id: leagueId || null
      });
      
      if (error) {
        console.error('[MatchupService] RPC error updating matchup scores:', error);
        throw error;
      }
      
      // Filter out failed updates (where updated = false) for count
      const successfulUpdates = (data || []).filter((r: any) => r.updated === true);
      
      return { 
        error: null, 
        updatedCount: successfulUpdates.length,
        results: data || []
      };
    } catch (error) {
      console.error('[MatchupService] Error updating matchup scores:', error);
      return { 
        error,
        updatedCount: 0
      };
    }
  }
};
