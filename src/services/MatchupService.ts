import { supabase } from '@/integrations/supabase/client';
import { League, Team, LeagueService } from './LeagueService';
import { DraftService } from './DraftService';
import { PlayerService, Player } from './PlayerService';
import { MatchupPlayer } from '@/components/matchup/types';
import { getFirstWeekStartDate, getWeekStartDate, getWeekEndDate, getAvailableWeeks, getScheduleLength } from '@/utils/weekCalculator';
import { HockeyPlayer } from '@/components/roster/HockeyPlayerCard';
import { ScheduleService, NHLGame, GameInfo } from './ScheduleService';

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
      const { data: userTeam, error: teamError } = await supabase
        .from('teams')
        .select('id')
        .eq('league_id', leagueId)
        .eq('owner_id', userId)
        .maybeSingle();

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
      const { data: matchups, error } = await query;
      
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
   * Get unified matchup data with all necessary information for the matchup page
   * This is the primary API contract for matchup data
   */
  async getMatchupData(
    leagueId: string,
    userId: string,
    weekNumber: number,
    timezone: string = 'America/Denver'
  ): Promise<{ data: MatchupDataResponse | null; error: any }> {
    try {
      console.log('[MatchupService.getMatchupData] Received parameters:', {
        leagueId,
        userId,
        weekNumber,
        timezone
      });
      
      // Get league to determine first week start
      const { data: league, error: leagueError } = await supabase
        .from('leagues')
        .select('*')
        .eq('id', leagueId)
        .maybeSingle();

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
      const { data: userTeam, error: teamError } = await supabase
        .from('teams')
        .select('*')
        .eq('league_id', leagueId)
        .eq('owner_id', userId)
        .maybeSingle();

      if (teamError) throw teamError;
      if (!userTeam) {
        return { data: null, error: new Error('User team not found') };
      }

      // Get matchup for this week
      console.log('[MatchupService.getMatchupData] Calling getUserMatchup with weekNumber:', weekNumber);
      const { matchup, error: matchupError } = await this.getUserMatchup(leagueId, userId, weekNumber);
      if (matchupError) throw matchupError;

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
          this.getRosterPlayerIds(matchup.team1_id, matchup.league_id),
          matchup.team2_id 
            ? this.getRosterPlayerIds(matchup.team2_id, matchup.league_id)
            : Promise.resolve([])
        ]);
        
        // Combine and deduplicate player IDs
        const allRosterPlayerIds = [...new Set([...team1PlayerIds, ...team2PlayerIds])];
        
        if (allRosterPlayerIds.length === 0) {
          console.warn('[MatchupService] No roster player IDs found, falling back to loading all players');
          rosterPlayers = await PlayerService.getAllPlayers();
        } else {
          // Load only roster players (much faster than loading all players)
          rosterPlayers = await PlayerService.getPlayersByIds(allRosterPlayerIds);
          
          // If optimized loading returned fewer players than expected, fallback
          if (rosterPlayers.length < allRosterPlayerIds.length * 0.8) {
            console.warn('[MatchupService] Optimized loading returned fewer players than expected, falling back to loading all players');
            rosterPlayers = await PlayerService.getAllPlayers();
          }
        }
      } catch (error) {
        console.error('[MatchupService] Error in optimized roster loading, falling back to loading all players:', error);
        rosterPlayers = await PlayerService.getAllPlayers();
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
      const shouldCalculatePoints = (matchupStatus === 'in_progress' || matchupStatus === 'completed') && hasScores;

      let userDailyPoints: number[] = [];
      let opponentDailyPoints: number[] = [];

      if (shouldCalculatePoints) {
        const userTotalPoints = isTeam1 ? team1Score : team2Score;
        const oppTotalPoints = isTeam1 ? team2Score : team1Score;
        
        // Simple distribution: divide by 7 days
        userDailyPoints = Array(7).fill(userTotalPoints / 7);
        opponentDailyPoints = Array(7).fill(oppTotalPoints / 7);
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
        gamesPlayed: p.games_played || 0,
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
        shutouts: (p as any).shutouts || 0
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
   * Transform HockeyPlayer to MatchupPlayer format with pre-fetched schedule data (optimized)
   */
  transformToMatchupPlayerWithGames(
    player: HockeyPlayer,
    isStarter: boolean,
    weekStart: Date,
    weekEnd: Date,
    timezone: string = 'America/Denver',
    games: NHLGame[]
  ): MatchupPlayer {
    const teamAbbrev = player.teamAbbreviation || player.team || '';
    
    try {
      
      // Calculate games remaining (scheduled or live games from today onwards)
      // Test mode controlled via VITE_TEST_MODE environment variable (defaults to false)
      const TEST_MODE = import.meta.env.VITE_TEST_MODE === 'true';
      const TEST_DATE = import.meta.env.VITE_TEST_DATE || '2025-12-08';
      const getTodayString = () => TEST_MODE ? TEST_DATE : new Date().toISOString().split('T')[0];
      const getTodayDate = () => {
        if (TEST_MODE) {
          const date = new Date(TEST_DATE + 'T00:00:00');
          date.setHours(0, 0, 0, 0);
          return date;
        }
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return today;
      };
      
      const today = getTodayDate();
      const gamesRemaining = games.filter(g => {
        const gameDate = new Date(g.game_date);
        gameDate.setHours(0, 0, 0, 0);
        return gameDate >= today && (g.status === 'scheduled' || g.status === 'live');
      }).length;

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
      
      return {
        id: typeof player.id === 'string' ? parseInt(player.id) || 0 : player.id || 0,
        name: player.name,
        position: player.position,
        team: teamAbbrev,
        points: 0, // Matchup points start at 0 (will be calculated from week's games when available)
        gamesRemaining,
        status: gameStatus, // Will be null for scheduled games, 'In Game' or 'Final' for active/completed
        isStarter,
        stats: {
          goals: player.stats.goals || 0,
          assists: player.stats.assists || 0,
          sog: player.stats.shots || 0,
          blk: player.stats.blockedShots || 0,
          gamesPlayed: player.stats.gamesPlayed || 0,
          xGoals: player.stats.xGoals || 0
        },
        isToday: hasGameToday, // Only true if game_date === todayStr (December 8, 2025)
        gameInfo // Only set if there's a game (today's game or next game in week)
      };
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
      
      return this.transformToMatchupPlayerWithGames(player, isStarter, weekStart, weekEnd, timezone, games || []);
    } catch (error) {
      console.error(`Error transforming player ${player.name} to matchup player:`, error);
      return this.transformToMatchupPlayerWithGames(player, isStarter, weekStart, weekEnd, timezone, []);
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
      
      const [team1Roster, team2Roster, team1LineupResult, team2LineupResult] = await Promise.all([
        this.getTeamRoster(matchup.team1_id, matchup.league_id, allPlayers),
        matchup.team2_id
          ? this.getTeamRoster(matchup.team2_id, matchup.league_id, allPlayers)
          : Promise.resolve([]),
        LeagueService.getLineup(matchup.team1_id, matchup.league_id),
        matchup.team2_id
          ? LeagueService.getLineup(matchup.team2_id, matchup.league_id)
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

      // Fetch all games for all teams in one batch query
      const { gamesByTeam } = await ScheduleService.getGamesForTeams(allTeams, weekStart, weekEnd);

      // Transform players with pre-fetched schedule data
      const team1MatchupPlayers = await Promise.all(
        team1Roster.map(p =>
          this.transformToMatchupPlayerWithGames(
            p,
            team1Starters.has(String(p.id)),
            weekStart,
            weekEnd,
            timezone,
            gamesByTeam.get(p.teamAbbreviation || p.team || '') || []
          )
        )
      );

      const team2MatchupPlayers = await Promise.all(
        team2Roster.map(p =>
          this.transformToMatchupPlayerWithGames(
            p,
            team2Starters.has(String(p.id)),
            weekStart,
            weekEnd,
            timezone,
            gamesByTeam.get(p.teamAbbreviation || p.team || '') || []
          )
        )
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
  }
};
