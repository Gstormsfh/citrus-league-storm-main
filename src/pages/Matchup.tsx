import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { LeagueCreationCTA } from '@/components/LeagueCreationCTA';
import { DemoDataService } from '@/services/DemoDataService';
import { TeamCard } from "@/components/matchup/TeamCard";
import { MatchupComparison } from "@/components/matchup/MatchupComparison";
import { MatchupScheduleSelector } from "@/components/matchup/MatchupScheduleSelector";
import { ScoreCard } from "@/components/matchup/ScoreCard";
import { WeeklySchedule } from "@/components/matchup/WeeklySchedule";
import { DailyRosters } from "@/components/matchup/DailyRosters";
import { getTodayMST, getTodayMSTDate } from '@/utils/timezoneUtils';
import { LiveUpdates } from "@/components/matchup/LiveUpdates";
import LeagueNotifications from "@/components/matchup/LeagueNotifications";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MatchupPlayer, StatBreakdown } from "@/components/matchup/types";
import { HockeyPlayer } from '@/components/roster/HockeyPlayerCard';
import PlayerStatsModal from '@/components/PlayerStatsModal';
import { LeagueService, League, Team } from '@/services/LeagueService';
import { MatchupService, Matchup as MatchupType } from '@/services/MatchupService';
import { PlayerService, Player } from '@/services/PlayerService';
import { ScheduleService } from '@/services/ScheduleService';
import { supabase } from '@/integrations/supabase/client';
import { getDraftCompletionDate, getFirstWeekStartDate, getCurrentWeekNumber, getAvailableWeeks, getWeekLabel, getWeekDateLabel, getWeekStartDate, getWeekEndDate } from '@/utils/weekCalculator';
import LoadingScreen from '@/components/LoadingScreen';
import { DEMO_LEAGUE_ID_FOR_GUESTS } from '@/services/DemoLeagueService';
import { useMinimumLoadingTime } from '@/hooks/useMinimumLoadingTime';
import { MatchupScoreJobService } from '@/services/MatchupScoreJobService';
import { DataCacheService, TTL } from '@/services/DataCacheService';

// Debug flag - set to true only when debugging performance issues
const DEBUG_MATCHUP = false;
const log = DEBUG_MATCHUP ? console.log.bind(console, '[Matchup]') : () => {};

const Matchup = () => {
  const { user, profile, loading: authLoading } = useAuth();
  const { userLeagueState, loading: leagueContextLoading } = useLeague();
  const { leagueId: urlLeagueId, weekId: urlWeekId } = useParams<{ leagueId?: string; weekId?: string }>();
  const navigate = useNavigate();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dailyStatsMap, setDailyStatsMap] = useState<Map<number, any>>(new Map()); // For selected date (or today)
  const [dailyStatsByDate, setDailyStatsByDate] = useState<Map<string, Map<number, any>>>(new Map()); // For all 7 days
  const [projectionsByDate, setProjectionsByDate] = useState<Map<string, Map<number, any>>>(new Map()); // Cache projections per date
  // Cached daily scores for past days (frozen, won't change when roster changes)
  const [cachedDailyScores, setCachedDailyScores] = useState<Map<string, { 
    myScore: number; 
    oppScore: number; 
    isLocked: boolean 
  }>>(new Map());
  // Removed frozenDayLineup state - now using single source from getMatchupRosters()
  // Start loading as true to prevent initial flash of content
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSwitchingDate, setIsSwitchingDate] = useState(false);
  const loadingRef = useRef(false); // Prevent concurrent loads
  const previousRosterRef = useRef<{ myTeam: MatchupPlayer[]; oppTeam: MatchupPlayer[] } | null>(null);
  const projectionsLoadingRef = useRef(false); // Prevent concurrent projection fetches
  const hasProcessedNoLeague = useRef(false); // Track if we've processed "no league" state
  const hasInitializedRef = useRef(false); // Track if we've completed initial load
  const statsLoadingRef = useRef(false); // Prevent concurrent stats fetches that cause score flashing
  const lastScoreRef = useRef<{ myScore: string; oppScore: string } | null>(null); // Stable score display
  
  // Stable refs for player IDs to break dependency on team arrays (prevents death loop)
  const myTeamPlayerIdsRef = useRef<number[]>([]);
  const opponentTeamPlayerIdsRef = useRef<number[]>([]);
  // State to track when player IDs change (for dependency arrays, since refs don't trigger re-renders)
  const [playerIdsVersion, setPlayerIdsVersion] = useState(0);
  
  // Cache tracking to prevent unnecessary reloads
  const prevLeagueIdRef = useRef<string | undefined>(undefined);
  const prevWeekIdRef = useRef<string | undefined>(undefined);
  const prevSelectedMatchupIdRef = useRef<string | null>(null);
  // Note: prevSelectedDateRef removed - date changes handled by separate useEffect using frozenRostersByDate
  const loadedMatchupDataRef = useRef<{ leagueId: string; weekId: string; matchupId: string | null; timestamp: number } | null>(null);
  const CACHE_TTL = 30000; // 30 seconds cache
  
  // CRITICAL: Unified loading state manager - handles all loading state logic in one place
  // This prevents conflicting state updates from multiple useEffects
  useEffect(() => {
    // Wait for LeagueContext to finish loading before making decisions
    if (leagueContextLoading) {
      return;
    }
    
    // Handle "no league" state once (prevent re-processing)
    if (userLeagueState === 'logged-in-no-league' && !hasProcessedNoLeague.current) {
      hasProcessedNoLeague.current = true;
      log(' User has no league - stopping all loading');
      setLoading(false);
      hasInitializedRef.current = true; // Mark initialization complete
      loadingRef.current = false; // Release any locks
      return;
    }
    
    // Reset the flag if user state changes back to active-user
    if (userLeagueState === 'active-user' && hasProcessedNoLeague.current) {
      hasProcessedNoLeague.current = false;
    }
  }, [leagueContextLoading, userLeagueState]);

  const [selectedPlayer, setSelectedPlayer] = useState<HockeyPlayer | null>(null);
  const [isPlayerDialogOpen, setIsPlayerDialogOpen] = useState(false);

  // Real data state
  const [league, setLeague] = useState<League | null>(null);
  const [userTeam, setUserTeam] = useState<Team | null>(null);
  const [opponentTeam, setOpponentTeam] = useState<Team | null>(null);
  const [selectedWeek, setSelectedWeek] = useState<number>(1);
  const [availableWeeks, setAvailableWeeks] = useState<number[]>([]);
  // Track viewing team names from matchup data (for viewing other matchups)
  const [viewingTeamName, setViewingTeamName] = useState<string>('');
  const [viewingOpponentTeamName, setViewingOpponentTeamName] = useState<string>('');
  // Track user's actual matchup ID (for "(Your Matchup)" label)
  const [userMatchupId, setUserMatchupId] = useState<string | null>(null);
  const [firstWeekStart, setFirstWeekStart] = useState<Date | null>(null);
  const [myTeam, setMyTeam] = useState<MatchupPlayer[]>([]);
  const [opponentTeamPlayers, setOpponentTeamPlayers] = useState<MatchupPlayer[]>([]);
  const [myTeamSlotAssignments, setMyTeamSlotAssignments] = useState<Record<string, string>>({});
  const [opponentTeamSlotAssignments, setOpponentTeamSlotAssignments] = useState<Record<string, string>>({});
  
  // Pre-loaded frozen rosters for ALL days of the week (loaded once on initial load)
  // This enables instant date switching without API calls
  const [frozenRostersByDate, setFrozenRostersByDate] = useState<Map<string, {
    myRoster: MatchupPlayer[];
    oppRoster: MatchupPlayer[];
    mySlots: Record<string, string>;
    oppSlots: Record<string, string>;
  }>>(new Map());
  // Base roster for current day (used when switching back from past dates)
  const [baseCurrentRoster, setBaseCurrentRoster] = useState<{
    myRoster: MatchupPlayer[];
    oppRoster: MatchupPlayer[];
    mySlots: Record<string, string>;
    oppSlots: Record<string, string>;
  } | null>(null);
  const [myTeamRecord, setMyTeamRecord] = useState<{ wins: number; losses: number }>({ wins: 0, losses: 0 });
  const [opponentTeamRecord, setOpponentTeamRecord] = useState<{ wins: number; losses: number }>({ wins: 0, losses: 0 });
  const [currentMatchup, setCurrentMatchup] = useState<MatchupType | null>(null);

  // Trigger background job to calculate and cache matchup scores
  // Also backfills any missing daily roster records
  // After job completes, refresh matchup to get updated scores
  useEffect(() => {
    if (!currentMatchup) {
      return;
    }

    const runBackfillAndCalculate = async () => {
      log(' Starting data integrity check for matchup:', currentMatchup.id);
      
      // Step 1: Backfill missing daily roster records for both teams
      // This ensures fantasy_daily_rosters has complete data
      if (currentMatchup.team1_id) {
        try {
          log(' Running backfill for team1:', currentMatchup.team1_id);
          const result = await LeagueService.backfillMissingDailyRosters(
            currentMatchup.team1_id,
            currentMatchup.league_id,
            currentMatchup.id
          );
          log(' Backfill result for team1:', result);
          if (result.backfilledCount > 0) {
            log(' Backfilled', result.backfilledCount, 'records for team1');
          } else if (result.error) {
            console.error('[Matchup] Backfill error for team1:', result.error);
          } else {
            log(' No records to backfill for team1 (all exist)');
          }
        } catch (err) {
          console.error('[Matchup] Team1 backfill exception:', err);
        }
      }
      
      if (currentMatchup.team2_id) {
        try {
          log(' Running backfill for team2:', currentMatchup.team2_id);
          const result = await LeagueService.backfillMissingDailyRosters(
            currentMatchup.team2_id,
            currentMatchup.league_id,
            currentMatchup.id
          );
          log(' Backfill result for team2:', result);
          if (result.backfilledCount > 0) {
            log(' Backfilled', result.backfilledCount, 'records for team2');
          } else if (result.error) {
            console.error('[Matchup] Backfill error for team2:', result.error);
          } else {
            log(' No records to backfill for team2 (all exist)');
          }
        } catch (err) {
          console.error('[Matchup] Team2 backfill exception:', err);
        }
      }
      
      // Step 2: Calculate and store matchup scores
      if (currentMatchup.status === 'in_progress' || currentMatchup.status === 'scheduled') {
        log(' Triggering background score calculation job for league:', currentMatchup.league_id);
        try {
          const result = await MatchupScoreJobService.runJob(currentMatchup.league_id);
          log(' Background job completed:', result);
          
          // Step 3: Refresh matchup data to get updated scores from DB
          if (result.updatedCount > 0) {
            log(' Refreshing matchup data after score update...');
            const { data: refreshedMatchup } = await supabase
              .from('matchups')
              .select('team1_score, team2_score')
              .eq('id' as any, currentMatchup.id as any)
              .single();
            
            if (refreshedMatchup) {
              const scores = refreshedMatchup as any;
              // Update currentMatchup with new scores (this triggers re-render)
              setCurrentMatchup(prev => prev ? {
                ...prev,
                team1_score: scores.team1_score,
                team2_score: scores.team2_score
              } : null);
              log(' Matchup scores refreshed:', scores);
            }
          }
        } catch (err) {
          console.error('[Matchup] Background job failed (non-blocking):', err);
        }
      }
    };
    
    // Fire-and-forget
    runBackfillAndCalculate();
  }, [currentMatchup?.id]);

  // Fetch and cache daily scores for past days (Yahoo/Sleeper frozen scoring)
  // OPTIMIZED: Uses DataCacheService to prevent redundant fetches + single batched query
  // FIXED: Now works for ANY matchup (user's or other teams) by using matchup's team1/team2 directly
  useEffect(() => {
    const fetchCachedScores = async () => {
      // CRITICAL FIX: Don't require userTeam - use the matchup's teams directly
      // This allows viewing other matchups (from dropdown) to work correctly
      if (!currentMatchup || dailyStatsByDate.size === 0) {
        return;
      }
      
      // Get both teams from the matchup (not from userTeam)
      const team1Id = currentMatchup.team1_id;
      const team2Id = currentMatchup.team2_id;
      
      if (!team1Id) {
        log('WARN: No team1_id in matchup, skipping cached scores');
        return;
      }
      
      const cacheKey = DataCacheService.getCacheKey.frozenScores(currentMatchup.id);
      
      // Check cache first - avoid unnecessary database calls
      const cachedData = DataCacheService.get<Map<string, { myScore: number; oppScore: number; isLocked: boolean }>>(cacheKey);
      if (cachedData) {
        setCachedDailyScores(cachedData);
        return;
      }
      
      // Use string comparison to avoid timezone issues
      const todayStr = getTodayMST();
      
      // Parse weekStart carefully to avoid timezone issues
      const [startYear, startMonth, startDay] = currentMatchup.week_start_date.split('-').map(Number);
      
      // Build list of past dates we need
      const pastDates: string[] = [];
      for (let i = 0; i < 7; i++) {
        const dayDate = new Date(startYear, startMonth - 1, startDay + i);
        const dateStr = `${dayDate.getFullYear()}-${String(dayDate.getMonth() + 1).padStart(2, '0')}-${String(dayDate.getDate()).padStart(2, '0')}`;
        if (dateStr < todayStr) {
          pastDates.push(dateStr);
        }
      }
      
      if (pastDates.length === 0) {
        setCachedDailyScores(new Map());
        return;
      }
      
      // Build team ID list for query (always include both teams from the matchup)
      const teamIds = team2Id ? [team1Id, team2Id] : [team1Id];
      
      // SINGLE BATCHED QUERY: Fetch ALL past days' rosters for BOTH teams at once
      const { data: allRosters, error } = await supabase
        .from('fantasy_daily_rosters')
        .select('player_id, roster_date, team_id')
        .eq('matchup_id' as any, currentMatchup.id as any)
        .in('team_id' as any, teamIds as any)
        .in('roster_date' as any, pastDates as any)
        .eq('slot_type' as any, 'active' as any);
      
      if (error) {
        console.error('[Matchup] Error fetching cached rosters:', error);
        return;
      }
      
      // Group rosters by date and team
      const rostersByDateTeam = new Map<string, Map<string, number[]>>();
      (allRosters as any)?.forEach((r: any) => {
        if (!rostersByDateTeam.has(r.roster_date)) {
          rostersByDateTeam.set(r.roster_date, new Map());
        }
        const dateMap = rostersByDateTeam.get(r.roster_date)!;
        if (!dateMap.has(r.team_id)) {
          dateMap.set(r.team_id, []);
        }
        dateMap.get(r.team_id)!.push(parseInt(r.player_id));
      });
      
      // Calculate scores for each past date
      // CRITICAL: Determine which team is "my team" vs "opponent" based on viewingTeamId
      const scores = new Map<string, { myScore: number; oppScore: number; isLocked: boolean }>();
      
      // Determine if viewing team is team1 or team2
      const isViewingTeam1 = viewingTeamId === team1Id;
      
      for (const dateStr of pastDates) {
        const dayStats = dailyStatsByDate.get(dateStr);
        const dateRosters = rostersByDateTeam.get(dateStr);
        
        let team1Score = 0;
        let team2Score = 0;
        
        if (dayStats && dateRosters) {
          // Calculate team1's score
          const team1PlayerIds = dateRosters.get(team1Id) || [];
          team1PlayerIds.forEach(playerId => {
            const stats = dayStats.get(playerId);
            team1Score += stats?.daily_total_points ?? 0;
          });
          
          // Calculate team2's score
          if (team2Id) {
            const team2PlayerIds = dateRosters.get(team2Id) || [];
            team2PlayerIds.forEach(playerId => {
              const stats = dayStats.get(playerId);
              team2Score += stats?.daily_total_points ?? 0;
            });
          }
        }
        
        // Assign to myScore/oppScore based on viewing perspective
        const myScore = isViewingTeam1 ? team1Score : team2Score;
        const oppScore = isViewingTeam1 ? team2Score : team1Score;
        
        scores.set(dateStr, { myScore, oppScore, isLocked: true });
      }
      
      // Cache the frozen scores (long TTL - past scores don't change)
      DataCacheService.set(cacheKey, scores, TTL.VERY_LONG);
      setCachedDailyScores(scores);
      log(` Cached ${scores.size} frozen scores for matchup ${currentMatchup.id} (team1: ${team1Id}, team2: ${team2Id})`);
    };
    
    fetchCachedScores();
  }, [currentMatchup?.id, dailyStatsByDate, currentMatchup?.team1_id, currentMatchup?.team2_id]);

  const [myDailyPoints, setMyDailyPoints] = useState<number[]>([]);
  const [opponentDailyPoints, setOpponentDailyPoints] = useState<number[]>([]);
  const [selectedMatchupId, setSelectedMatchupId] = useState<string | null>(null);
  const [allWeekMatchups, setAllWeekMatchups] = useState<Array<MatchupType & { team1_name?: string; team2_name?: string }>>([]);
  // League scoring settings for dynamic goalie/skater scoring (ALL 8 categories)
  const [scoringSettings, setScoringSettings] = useState<{
    goalie: { wins: number; saves: number; shutouts: number; goals_against: number };
    skater: { 
      goals: number; 
      assists: number; 
      power_play_points: number;      // PPP
      short_handed_points: number;    // SHP
      shots_on_goal: number; 
      blocks: number;
      hits: number;                   // Hits
      penalty_minutes: number;        // PIM
    };
  } | null>(null);

  // Demo data - shown to guests and logged-in users without leagues
  // Load from actual demo rosters instead of static data
  const [demoMyTeam, setDemoMyTeam] = useState<MatchupPlayer[]>([]);
  const [demoOpponentTeam, setDemoOpponentTeam] = useState<MatchupPlayer[]>([]);
  const [demoMyTeamSlotAssignments, setDemoMyTeamSlotAssignments] = useState<Record<string, string>>({});
  const [demoOpponentTeamSlotAssignments, setDemoOpponentTeamSlotAssignments] = useState<Record<string, string>>({});
  
  // Load REAL league data for guests (using your actual league as read-only demo)
  useEffect(() => {
    // For guests, allow URL leagueId if it matches demo league (enables week navigation)
    // Don't run if there's a different leagueId in URL (user accessing specific league)
    if (urlLeagueId && urlLeagueId !== DEMO_LEAGUE_ID_FOR_GUESTS) {
      return;
    }
    
    // Don't run if LeagueContext is still loading
    if (leagueContextLoading) {
      return;
    }
    
    // Only run for guests or users with no league
    if (userLeagueState === 'active-user') {
      setDemoMyTeam([]);
      setDemoOpponentTeam([]);
      setDemoMyTeamSlotAssignments({});
      setDemoOpponentTeamSlotAssignments({});
      // Don't touch loading state for active users
      return;
    }
    
    // For guests, use the REAL league data (read-only)
    // This uses the exact same code path as logged-in users, just with a hardcoded league ID
    const loadGuestMatchup = async () => {
      if (loadingRef.current) {
        log(' Guest load already in progress, skipping');
        return;
      }
      
      loadingRef.current = true;
      
      try {
        setLoading(true);
        setError(null);
        
        log(' ========== Loading REAL league data for guest ==========');
        log(' Using demo league ID:', DEMO_LEAGUE_ID_FOR_GUESTS);
        
        // Get the league data directly (using maybeSingle to avoid single() coercion error)
        const { data: demoLeagueData, error: leagueError } = await supabase
          .from('leagues')
          .select('*')
          .eq('id' as any, DEMO_LEAGUE_ID_FOR_GUESTS as any)
          .maybeSingle();
        
        if (leagueError) {
          throw new Error(`Failed to load demo league: ${leagueError.message || 'Unknown error'}`);
        }
        
        if (!demoLeagueData) {
          throw new Error('Demo league not found');
        }
        
        const demoLeague = demoLeagueData as any;
        log(' Demo league loaded:', demoLeague.id, 'draft_status:', demoLeague.draft_status);
        setLeague(demoLeague as League);
        
        // Check if draft is completed
        if (demoLeague.draft_status !== 'completed') {
          throw new Error('Demo league draft not completed');
        }
        
        // Get first week start date from league (uses updated_at when draft_status is 'completed')
        // Use same logic as logged-in users
        const { getDraftCompletionDate, getFirstWeekStartDate, getCurrentWeekNumber, getAvailableWeeks, getWeekStartDate, getWeekEndDate } = await import('@/utils/weekCalculator');
        const draftCompletionDate = getDraftCompletionDate(demoLeague as any);
        if (!draftCompletionDate) {
          throw new Error('Demo league has no draft completion date (updated_at is missing)');
        }
        
        // Calculate first week start (same as logged-in users)
        const firstWeek = getFirstWeekStartDate(draftCompletionDate);
        setFirstWeekStart(firstWeek);
        
        // Get available weeks (same as logged-in users)
        const currentYear = new Date().getFullYear();
        const weeks = getAvailableWeeks(firstWeek, currentYear);
        log(` Calculated ${weeks.length} available weeks:`, weeks);
        setAvailableWeeks(weeks);
        
        // Determine which week to show (from URL or current week) - same logic as logged-in users
        let weekToShow: number;
        if (urlWeekId) {
          weekToShow = parseInt(urlWeekId);
          if (isNaN(weekToShow) || !weeks.includes(weekToShow)) {
            // Invalid week in URL, use current week
            const currentWeek = getCurrentWeekNumber(firstWeek);
            weekToShow = weeks.includes(currentWeek) ? currentWeek : weeks[0] || 1;
          }
        } else {
          // No week in URL, use current week
          const currentWeek = getCurrentWeekNumber(firstWeek);
          weekToShow = weeks.includes(currentWeek) ? currentWeek : weeks[0] || 1;
        }
        
        setSelectedWeek(weekToShow);
        
        log(' Week calculation details:', {
          urlWeekId,
          weekToShow,
          weekToShowType: typeof weekToShow,
          firstWeekStart: firstWeek.toISOString(),
          availableWeeks: weeks
        });
        
        // Get all matchups for this week (same as logged-in users)
        const { data: weekMatchupsData, error: matchupsError } = await supabase
          .from('matchups')
          .select('*')
          .eq('league_id' as any, DEMO_LEAGUE_ID_FOR_GUESTS as any)
          .eq('week_number' as any, weekToShow as any)
          .order('created_at', { ascending: true });
        
        if (matchupsError) throw matchupsError;
        
        const weekMatchups = weekMatchupsData as any[];
        if (!weekMatchups || weekMatchups.length === 0) {
          throw new Error(`No matchups found for week ${weekToShow}`);
        }
        
        // Use the first matchup (guests see the first matchup in the league)
        const guestMatchup = weekMatchups[0] as any;
        
        // CRITICAL: Use the matchup's week_number to calculate dates (not weekToShow)
        // This ensures dates match exactly how the matchup was created in the database
        const matchupWeekNumber = guestMatchup.week_number;
        
        log(' Guest matchup selected:', {
          id: guestMatchup.id,
          team1_id: guestMatchup.team1_id,
          team2_id: guestMatchup.team2_id,
          week_number: matchupWeekNumber,
          weekToShow,
          dbWeekStart: guestMatchup.week_start_date,
          dbWeekEnd: guestMatchup.week_end_date
        });
        
        // Always use calculated dates based on the matchup's week_number and firstWeekStart
        // This matches EXACTLY how matchups are created in generateMatchupsForLeague
        const matchupWeekStart = getWeekStartDate(matchupWeekNumber, firstWeek);
        const matchupWeekEnd = getWeekEndDate(matchupWeekNumber, firstWeek);
        
        log(' Setting matchup week dates (same logic as database):', {
          matchupWeekNumber,
          firstWeekStart: firstWeek.toISOString().split('T')[0],
          calculatedWeekStart: matchupWeekStart.toISOString().split('T')[0],
          calculatedWeekEnd: matchupWeekEnd.toISOString().split('T')[0],
          dbWeekStart: guestMatchup.week_start_date,
          dbWeekEnd: guestMatchup.week_end_date,
          datesMatch: (
            matchupWeekStart.toISOString().split('T')[0] === guestMatchup.week_start_date &&
            matchupWeekEnd.toISOString().split('T')[0] === guestMatchup.week_end_date
          )
        });
        
        // Create matchup object with proper calculated dates (same format as logged-in users)
        // Always use calculated dates to ensure they're correct, even if DB dates are wrong
        const matchupWithDates: MatchupType = {
          ...(guestMatchup as any),
          week_start_date: matchupWeekStart.toISOString().split('T')[0],
          week_end_date: matchupWeekEnd.toISOString().split('T')[0]
        };
        
        setCurrentMatchup(matchupWithDates);
        setSelectedMatchupId(guestMatchup.id);
        
        // Get league scoring settings
        const scoringSettingsData = demoLeague.scoring_settings as any;
        if (scoringSettingsData) {
          setScoringSettings(scoringSettingsData);
        } else {
          // Default scoring settings
          setScoringSettings({
            goalie: { wins: 4, saves: 0.2, shutouts: 3, goals_against: -1 },
            skater: {
              goals: 3,
              assists: 2,
              power_play_points: 1,
              short_handed_points: 2,
              shots_on_goal: 0.4,
              blocks: 0.5,
              hits: 0.2,
              penalty_minutes: 0.5
            }
          });
        }
        
        // Get teams
        const team1 = await supabase.from('teams').select('*').eq('id' as any, guestMatchup.team1_id as any).maybeSingle();
        const team2 = guestMatchup.team2_id ? await supabase.from('teams').select('*').eq('id' as any, guestMatchup.team2_id as any).maybeSingle() : { data: null, error: null };
        
        if (team1.error) throw team1.error;
        if (team2.error) throw team2.error;
        
        setUserTeam(team1.data as unknown as Team);
        setOpponentTeam(team2.data as unknown as Team | null);
        
        // Get matchup rosters using the same service as logged-in users
        const { PlayerService } = await import('@/services/PlayerService');
        const allPlayers = await PlayerService.getAllPlayers();
        
        const { team1Roster, team2Roster, team1SlotAssignments, team2SlotAssignments, error: rosterError } = 
          await MatchupService.getMatchupRosters(guestMatchup as MatchupType, allPlayers, 'America/Denver');
        
        if (rosterError) throw rosterError;
        
        // Set demo state (but using real data)
        setDemoMyTeam(team1Roster);
        setDemoOpponentTeam(team2Roster || []);
        setDemoMyTeamSlotAssignments(team1SlotAssignments);
        setDemoOpponentTeamSlotAssignments(team2SlotAssignments || {});
        
        // Also set regular state for compatibility
        setMyTeam(team1Roster);
        setOpponentTeamPlayers(team2Roster || []);
        setMyTeamSlotAssignments(team1SlotAssignments);
        setOpponentTeamSlotAssignments(team2SlotAssignments || {});
        
        // Calculate daily points using the same RPC as logged-in users
        log(' Calculating daily points for guest matchup...');
        const weekStartStr = matchupWithDates.week_start_date;
        const weekEndStr = matchupWithDates.week_end_date;
        
        // Calculate daily scores for team1 (same logic as logged-in users)
        let team1DailyPoints: number[] = [];
        try {
          const { data: team1DailyScores, error: team1Error } = await supabase.rpc(
            'calculate_daily_matchup_scores',
            {
              p_matchup_id: guestMatchup.id,
              p_team_id: (team1.data as any).id,
              p_week_start: weekStartStr,
              p_week_end: weekEndStr
            }
          );
          
          if (!team1Error && team1DailyScores) {
            // Sort by date and extract scores (same logic as logged-in users)
            const sorted = (team1DailyScores as any[]).sort((a, b) => 
              new Date(a.roster_date).getTime() - new Date(b.roster_date).getTime()
            );
            team1DailyPoints = sorted.map(d => parseFloat(d.daily_score) || 0);
            log(' Team1 daily points calculated:', team1DailyPoints);
          } else {
            log('WARN: Error calculating team1 daily scores:', team1Error);
            team1DailyPoints = Array(7).fill(0);
          }
        } catch (error) {
          console.error('[Matchup] Exception calculating team1 daily scores:', error);
          team1DailyPoints = Array(7).fill(0);
        }
        
        // Calculate daily scores for team2 (if exists)
        let team2DailyPoints: number[] = [];
        if (team2.data) {
          try {
            const { data: team2DailyScores, error: team2Error } = await supabase.rpc(
              'calculate_daily_matchup_scores',
              {
                p_matchup_id: guestMatchup.id,
                p_team_id: (team2.data as any).id,
                p_week_start: weekStartStr,
                p_week_end: weekEndStr
              }
            );
            
            if (!team2Error && team2DailyScores) {
              // Sort by date and extract scores (same logic as logged-in users)
              const sorted = (team2DailyScores as any[]).sort((a, b) => 
                new Date(a.roster_date).getTime() - new Date(b.roster_date).getTime()
              );
              team2DailyPoints = sorted.map(d => parseFloat(d.daily_score) || 0);
              log(' Team2 daily points calculated:', team2DailyPoints);
            } else {
              log('WARN: Error calculating team2 daily scores:', team2Error);
              team2DailyPoints = Array(7).fill(0);
            }
          } catch (error) {
            console.error('[Matchup] Exception calculating team2 daily scores:', error);
            team2DailyPoints = Array(7).fill(0);
          }
        } else {
          team2DailyPoints = Array(7).fill(0);
        }
        
        // Set daily points state (same as logged-in users)
        setMyDailyPoints(team1DailyPoints);
        setOpponentDailyPoints(team2DailyPoints);
        log(' Daily points set:', {
          myTeam: team1DailyPoints,
          opponentTeam: team2DailyPoints
        });
        
        // Get all week matchups for dropdown (same week as selected)
        const { data: allMatchups } = await supabase
          .from('matchups')
          .select('*, teams!matchups_team1_id_fkey(team_name), teams!matchups_team2_id_fkey(team_name)')
          .eq('league_id' as any, DEMO_LEAGUE_ID_FOR_GUESTS as any)
          .eq('week_number' as any, weekToShow as any)
          .order('created_at', { ascending: true });
        
        if (allMatchups) {
          setAllWeekMatchups(allMatchups as any);
        }
        
        log(' ✅ Guest matchup loaded successfully');
        setLoading(false);
        hasInitializedRef.current = true;
        loadingRef.current = false;
      } catch (error) {
        console.error('[Matchup] ❌ ERROR loading guest matchup:', error);
        // CRITICAL: During initial load, NEVER set error or mark as initialized
        // This keeps the loading screen showing and prevents error flash
        // Only show errors after we've successfully initialized at least once
        if (hasInitializedRef.current) {
          // We've initialized before, so it's safe to show the error
          setError(error instanceof Error ? error.message : 'Failed to load demo matchup');
          setLoading(false);
          hasInitializedRef.current = true;
        } else {
          // During initial load:
          // 1. DON'T set error (prevents flash)
          // 2. Keep loading state true (keeps loading screen visible)
          // 3. DON'T mark as initialized (keeps shouldShowLoading returning true)
          setLoading(true);
          setError(null); // Explicitly clear any error that might have been set
          // Don't set hasInitializedRef.current = true here
          // This prevents the error from showing until we've successfully loaded once
        }
        loadingRef.current = false;
      }
    };

    loadGuestMatchup();
  }, [userLeagueState, urlLeagueId, urlWeekId, leagueContextLoading]);

  const toHockeyPlayer = (p: MatchupPlayer, seasonStats?: any): HockeyPlayer => {
    // Use season-long stats if provided, otherwise fall back to matchup stats (shouldn't happen)
    const stats = seasonStats || p.stats;
    
    // CRITICAL: For PPP/SHP, check both powerPlayPoints/shortHandedPoints AND ppp/shp
    // This ensures we get the value even if one field is 0 and the other has the real value
    const powerPlayPoints = stats.powerPlayPoints !== undefined && stats.powerPlayPoints !== null 
      ? stats.powerPlayPoints 
      : (stats.ppp !== undefined && stats.ppp !== null ? stats.ppp : 0);
    const shortHandedPoints = stats.shortHandedPoints !== undefined && stats.shortHandedPoints !== null 
      ? stats.shortHandedPoints 
      : (stats.shp !== undefined && stats.shp !== null ? stats.shp : 0);
    
    return {
      id: p.id.toString(),
      name: p.name,
      position: p.position,
      number: 0,
      starter: p.isStarter,
      stats: {
        goals: stats.goals ?? 0,
        assists: stats.assists ?? 0,
        points: stats.points ?? (stats.goals ?? 0) + (stats.assists ?? 0),
        plusMinus: stats.plusMinus ?? stats.plus_minus ?? 0,
        shots: stats.shots ?? stats.shotsOnGoal ?? stats.sog ?? 0,
        gamesPlayed: stats.gamesPlayed ?? stats.games_played ?? 0,
        hits: stats.hits ?? 0,
        blockedShots: stats.blockedShots ?? stats.blocks ?? stats.blk ?? 0,
        wins: stats.wins ?? 0,
        losses: stats.losses ?? 0,
        otl: stats.otl ?? 0,
        gaa: stats.gaa ?? 0,
        savePct: stats.savePct ?? stats.save_pct ?? 0,
        shutouts: stats.shutouts ?? 0,
        xGoals: stats.xGoals ?? stats.x_goals ?? 0,
        powerPlayPoints: powerPlayPoints,
        shortHandedPoints: shortHandedPoints,
        pim: stats.pim ?? 0,
        toi: stats.toi ?? (stats.icetime_seconds && (stats.gamesPlayed ?? stats.games_played) ? formatTOIPerGame(stats.icetime_seconds, stats.gamesPlayed ?? stats.games_played ?? 1) : (stats.icetime_seconds ? formatTOI(stats.icetime_seconds) : '0:00'))
      },
      team: p.team,
      teamAbbreviation: p.team,
      status: null, // Game status not applicable here - use roster_status for IR/SUSP/GTD
      image: undefined,
      projectedPoints: 0
    };
  };

  // Helper to format TOI from seconds
  const formatTOI = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Helper to calculate and format TOI per game
  const formatTOIPerGame = (totalSeconds: number, gamesPlayed: number): string => {
    if (!gamesPlayed || gamesPlayed === 0) return '0:00';
    const secondsPerGame = totalSeconds / gamesPlayed;
    return formatTOI(secondsPerGame);
  };

  // Fetch daily stats when a date is selected, or default to today if in matchup week
  // Fetch all matchups for the current week (for matchup viewer dropdown)
  useEffect(() => {
    const fetchAllWeekMatchups = async () => {
      if (!league?.id || userLeagueState !== 'active-user' || !selectedWeek) {
        setAllWeekMatchups([]);
        return;
      }

      try {
        const { data: matchups, error } = await supabase
          .from('matchups')
          .select(`
            *,
            team1:teams!team1_id(team_name),
            team2:teams!team2_id(team_name)
          `)
          .eq('league_id' as any, league.id as any)
          .eq('week_number' as any, selectedWeek as any)
          .order('created_at', { ascending: true });

        if (error) {
          log('WARN: Error fetching all week matchups:', error);
          return;
        }

        if (matchups) {
          const matchupsWithNames = (matchups as any[]).map((m: any) => ({
            ...m,
            team1_name: m.team1?.team_name || 'Unknown',
            team2_name: m.team2?.team_name || (m.team2_id ? 'Unknown' : 'Bye Week'),
          }));
          setAllWeekMatchups(matchupsWithNames);
          
          // If no matchup is selected and user's matchup exists, select it
          if (!selectedMatchupId && currentMatchup) {
            setSelectedMatchupId(currentMatchup.id);
          }
        }
      } catch (error) {
        console.error('[Matchup] Exception fetching all week matchups:', error);
      }
    };

    fetchAllWeekMatchups();
  }, [league?.id, selectedWeek, userLeagueState, currentMatchup?.id]);

  // Update player ID refs when teams change (stable references to break death loop)
  // This effect only updates refs and a version counter - it doesn't trigger other effects directly
  useEffect(() => {
    const myIds = myTeam.map(p => p.id);
    const oppIds = opponentTeamPlayers.map(p => p.id);
    // Only update if IDs actually changed (avoid unnecessary updates)
    const myIdsStr = myIds.sort().join(',');
    const oppIdsStr = oppIds.sort().join(',');
    const currentMyIdsStr = myTeamPlayerIdsRef.current.sort().join(',');
    const currentOppIdsStr = opponentTeamPlayerIdsRef.current.sort().join(',');
    
    if (myIdsStr !== currentMyIdsStr || oppIdsStr !== currentOppIdsStr) {
      myTeamPlayerIdsRef.current = myIds;
      opponentTeamPlayerIdsRef.current = oppIds;
      // Increment version to trigger dependent effects
      setPlayerIdsVersion(prev => prev + 1);
    }
  }, [myTeam, opponentTeamPlayers]);

  // Fetch stats for all 7 days of the matchup week (for WeeklySchedule day boxes)
  // CRITICAL: Also runs for guests/demo to use REAL NHL data
  // Extract to useCallback so it can be reused for live game refreshes
  const fetchAllDailyStats = React.useCallback(async () => {
      // Prevent concurrent fetches that cause score flashing
      if (statsLoadingRef.current) {
        return;
      }
      
      if (!currentMatchup) {
        setDailyStatsByDate(new Map());
        return;
      }
      
      statsLoadingRef.current = true;
      
      // For guests/demo, we still need player IDs from demo teams
      // For active users, we use the real matchup
      const allPlayerIds = userLeagueState === 'active-user' 
        ? [...myTeamPlayerIdsRef.current, ...opponentTeamPlayerIdsRef.current]
        : [
            ...(demoMyTeam.map(p => typeof p.id === 'string' ? parseInt(p.id) : p.id)),
            ...(demoOpponentTeam.map(p => typeof p.id === 'string' ? parseInt(p.id) : p.id))
          ];
      
      if (allPlayerIds.length === 0) {
        setDailyStatsByDate(new Map());
        return;
      }

      try {
        // Use the allPlayerIds already calculated above (works for both active users and guests)
        // For active users, refs are populated. For guests, we use demo teams directly.

        // Generate all 7 dates in the week
        const weekStart = new Date(currentMatchup.week_start_date);
        const dates: string[] = [];
        for (let i = 0; i < 7; i++) {
          const date = new Date(weekStart);
          date.setDate(weekStart.getDate() + i);
          dates.push(date.toISOString().split('T')[0]);
        }

        // Fetch stats for all 7 days in parallel
        const statsByDate = new Map<string, Map<number, any>>();
        
        await Promise.all(dates.map(async (date) => {
          const { data, error } = await supabase.rpc('get_daily_game_stats', {
            p_player_ids: allPlayerIds,
            p_game_date: date
          });

          if (error) {
            log(`WARN: Error fetching stats for ${date}:`, error);
            return;
          }

          // Create map of player_id -> daily stats for this date
          // CRITICAL: Aggregate across multiple games per day (goalies can't play multiple games per day, but skaters can)
          const dayStatsMap = new Map<number, any>();
          ((data || []) as any[]).forEach((row: any) => {
            // Determine if player is on my team (works for both active users and guests)
            // For active users, use refs. For guests, use demo teams.
            const myTeamIds = userLeagueState === 'active-user'
              ? myTeamPlayerIdsRef.current
              : (demoMyTeam.map(p => typeof p.id === 'string' ? parseInt(p.id) : p.id));
            const isMyTeam = myTeamIds.includes(row.player_id);
            // For goalie detection, we can use the row data or check position from a lookup
            // Since we don't have direct access to player objects, use row.is_goalie as primary indicator
            const isGoalie = row.is_goalie || false;
            
            // Get or initialize player's daily stats (aggregate across multiple games)
            const existing = dayStatsMap.get(row.player_id) || {
              goals: 0,
              assists: 0,
              points: 0,
              shots_on_goal: 0,
              blocks: 0,
              ppp: 0,
              shp: 0,
              hits: 0,
              pim: 0,
              wins: 0,
              saves: 0,
              shutouts: 0,
              goals_against: 0,
            };
            
            // Aggregate stats across multiple games (if player has multiple games on same day)
            const aggregated = {
              goals: existing.goals + (row.goals || 0),
              assists: existing.assists + (row.assists || 0),
              points: existing.points + (row.points || 0),
              shots_on_goal: existing.shots_on_goal + (row.shots_on_goal || 0),
              blocks: existing.blocks + (row.blocks || 0),
              ppp: existing.ppp + (row.ppp || 0),
              shp: existing.shp + (row.shp || 0),
              hits: existing.hits + (row.hits || 0),
              pim: existing.pim + (row.pim || 0),
              wins: existing.wins + (row.wins || 0),
              saves: existing.saves + (row.saves || 0),
              shutouts: existing.shutouts + (row.shutouts || 0),
              goals_against: existing.goals_against + (row.goals_against || 0),
            };
            
            // Calculate daily total points using league scoring settings
            const goalieScoring = scoringSettings?.goalie || {
              wins: 4,
              saves: 0.2,
              shutouts: 3,
              goals_against: -1
            };
            const skaterScoring = scoringSettings?.skater || {
              goals: 3,
              assists: 2,
              power_play_points: 1,
              short_handed_points: 2,
              shots_on_goal: 0.4,
              blocks: 0.5,
              hits: 0.2,
              penalty_minutes: 0.5
            };
            
            let dailyTotalPoints = 0;
            if (isGoalie) {
              // Goalie Formula: Use league settings (defaults: W=4, SV=0.2, SO=3, GA=-1)
              dailyTotalPoints = 
                aggregated.wins * goalieScoring.wins + 
                aggregated.saves * goalieScoring.saves + 
                aggregated.shutouts * goalieScoring.shutouts + 
                aggregated.goals_against * goalieScoring.goals_against;  // Already negative, so add
              
              // Debug logging for goalies with stats
              if (aggregated.wins > 0 || aggregated.saves > 0 || aggregated.shutouts > 0 || aggregated.goals_against > 0) {
                log('fetchAllDailyStats Goalie daily points (aggregated):', {
                  date,
                  player_id: row.player_id,
                  wins: aggregated.wins,
                  saves: aggregated.saves,
                  shutouts: aggregated.shutouts,
                  goals_against: aggregated.goals_against,
                  weights: goalieScoring,
                  calculated_points: dailyTotalPoints,
                  games_count: ((data || []) as any[]).filter((r: any) => r.player_id === row.player_id).length
                });
              }
            } else {
              // Skater Formula: Use ALL 8 league settings
              dailyTotalPoints = 
                aggregated.goals * skaterScoring.goals + 
                aggregated.assists * skaterScoring.assists + 
                (aggregated.ppp || 0) * skaterScoring.power_play_points +
                (aggregated.shp || 0) * skaterScoring.short_handed_points +
                aggregated.shots_on_goal * skaterScoring.shots_on_goal + 
                aggregated.blocks * skaterScoring.blocks +
                (aggregated.hits || 0) * skaterScoring.hits +
                (aggregated.pim || 0) * skaterScoring.penalty_minutes;
            }
            
            dayStatsMap.set(row.player_id, {
              ...aggregated,
              daily_total_points: dailyTotalPoints,
            });
          });

          statsByDate.set(date, dayStatsMap);
        }));

        setDailyStatsByDate(statsByDate);
      } catch (error) {
        console.error('[Matchup] Error fetching all daily stats:', error);
        setDailyStatsByDate(new Map());
      } finally {
        statsLoadingRef.current = false;
      }
  }, [currentMatchup, userLeagueState, scoringSettings, playerIdsVersion, demoMyTeam, demoOpponentTeam]);

  // Initial fetch on mount and when dependencies change
  useEffect(() => {
    fetchAllDailyStats();
  }, [fetchAllDailyStats]);

  // Auto-select default date when matchup and daily stats are loaded
  // Default to today if in matchup week, otherwise most recent date with games, otherwise first day of week
  useEffect(() => {
    if (!currentMatchup || dailyStatsByDate.size === 0 || selectedDate !== null) {
      return; // Don't override if user has already selected a date
    }

    const todayStr = getTodayMST();
    const weekStart = new Date(currentMatchup.week_start_date);
    const weekEnd = new Date(currentMatchup.week_end_date);
    const today = new Date(todayStr);
    
    // Check if today is in the matchup week
    if (today >= weekStart && today <= weekEnd) {
      setSelectedDate(todayStr);
      return;
    }

    // Find the most recent date with games within the matchup week
    let mostRecentDate: string | null = null;
    let mostRecentDateObj: Date | null = null;
    
    for (const [dateStr, dayStats] of dailyStatsByDate.entries()) {
      const date = new Date(dateStr);
      // Only consider dates within the matchup week
      if (date >= weekStart && date <= weekEnd) {
        // Check if this date has any stats (not empty map)
        if (dayStats && dayStats.size > 0) {
          if (!mostRecentDateObj || date > mostRecentDateObj) {
            mostRecentDate = dateStr;
            mostRecentDateObj = date;
          }
        }
      }
    }

    if (mostRecentDate) {
      setSelectedDate(mostRecentDate);
      return;
    }

    // Fallback: use first day of matchup week
    setSelectedDate(weekStart.toISOString().split('T')[0]);
  }, [currentMatchup, dailyStatsByDate, selectedDate]);

  // Removed duplicate frozen lineup fetch - data now loaded directly in getMatchupRosters()
  // This eliminates score flashing and ensures single source of truth

  // Debug backfill function - only exposed in development
  // Removed useEffect - exposed only when DEBUG_MATCHUP is true
  if (DEBUG_MATCHUP && typeof window !== 'undefined') {
    (window as any).backfillLeague = async (leagueId?: string) => {
      const targetLeagueId = leagueId || currentMatchup?.league_id;
      if (!targetLeagueId) return;
      return await LeagueService.backfillAllMatchupsForLeague(targetLeagueId);
    };
  }

  // Fetch projections for a specific date - memoized to prevent recreation
  const fetchProjectionsForDate = useCallback(async (date: string) => {
    // Check cache first - if we have projections (even if empty), don't re-fetch
    if (projectionsByDate.has(date)) {
      return;
    }

    // Prevent concurrent fetches
    if (projectionsLoadingRef.current) {
      return;
    }

    if (!currentMatchup || userLeagueState !== 'active-user') {
      return;
    }

    // Get player IDs from refs (stable references)
    const allPlayerIds = [
      ...myTeamPlayerIdsRef.current,
      ...opponentTeamPlayerIdsRef.current
    ];

    if (allPlayerIds.length === 0) {
      return;
    }

    projectionsLoadingRef.current = true;

    try {
      const projectionMap = await MatchupService.getDailyProjectionsForMatchup(allPlayerIds, date);
      
      setProjectionsByDate(prev => {
        const newMap = new Map(prev);
        newMap.set(date, projectionMap);
        return newMap;
      });
    } catch (error) {
      // Don't cache errors - allow retry
    } finally {
      projectionsLoadingRef.current = false;
    }
  }, [projectionsByDate, currentMatchup, userLeagueState]);

  // Fetch detailed stats for selected date (or today) - for PlayerCard display
  useEffect(() => {
    const fetchDailyStats = async () => {
      // Prevent concurrent fetches
      if (loadingRef.current) {
        return;
      }

      if (!currentMatchup) {
        setDailyStatsMap(new Map());
        return;
      }

      // Determine which date to fetch stats for
      let dateToFetch = selectedDate;
      
      // If no date selected, default to today if today is in the matchup week
      if (!dateToFetch) {
        const todayStr = getTodayMST();
        const weekStart = currentMatchup.week_start_date;
        const weekEnd = currentMatchup.week_end_date;
        
        if (todayStr >= weekStart && todayStr <= weekEnd) {
          dateToFetch = todayStr;
        } else {
          // Today is not in the matchup week, don't fetch daily stats
          setDailyStatsMap(new Map());
          return;
        }
      }

      loadingRef.current = true;

      try {
        // Get all player IDs (works for both active users and guests)
        // For active users, use refs. For guests, use demo teams.
        const allPlayerIds = userLeagueState === 'active-user'
          ? [...myTeamPlayerIdsRef.current, ...opponentTeamPlayerIdsRef.current]
          : [
              ...(demoMyTeam.map(p => typeof p.id === 'string' ? parseInt(p.id) : p.id)),
              ...(demoOpponentTeam.map(p => typeof p.id === 'string' ? parseInt(p.id) : p.id))
            ];

        if (allPlayerIds.length === 0) {
          log('WARN: No player IDs available for daily stats fetch');
          setDailyStatsMap(new Map());
          return;
        }
        
        log(' Fetching daily stats for date:', dateToFetch, 'playerIds:', allPlayerIds.length);

        // Fetch comprehensive daily game stats using new RPC
        
        const { data, error } = await supabase.rpc('get_daily_game_stats', {
          p_player_ids: allPlayerIds,
          p_game_date: dateToFetch
        });

        if (error) {
          console.error('[Matchup] Error calling get_daily_game_stats:', error);
          throw error;
        }
        
        const statsDataArr = (data || []) as any[];
        log(' get_daily_game_stats returned:', statsDataArr.length, 'rows');

        // Create map of player_id -> comprehensive daily stats
        const statsMap = new Map<number, any>();
        statsDataArr.forEach((row: any) => {
          // HARD CHECK: Use row.is_goalie for goalie detection (stable, no dependency on team arrays)
          // This ensures accurate math for "Blowout" games where goalies earn negative points
          const isGoalie = row.is_goalie || false;
          
          // Calculate daily total points using league scoring settings
          // Use scoringSettings from league.scoring_settings (dynamic, per-league)
          const goalieScoring = scoringSettings?.goalie || {
            wins: 4,
            saves: 0.2,
            shutouts: 3,
            goals_against: -1
          };
          const skaterScoring = scoringSettings?.skater || {
            goals: 3,
            assists: 2,
            power_play_points: 1,
            short_handed_points: 2,
            shots_on_goal: 0.4,
            blocks: 0.5,
            hits: 0.2,
            penalty_minutes: 0.5
          };
          
          let dailyTotalPoints = 0;
          if (isGoalie) {
            // Goalie Formula: Use league settings (defaults: W=4, SV=0.2, SO=3, GA=-1)
            dailyTotalPoints = 
              (row.wins || 0) * goalieScoring.wins + 
              (row.saves || 0) * goalieScoring.saves + 
              (row.shutouts || 0) * goalieScoring.shutouts + 
              (row.goals_against || 0) * goalieScoring.goals_against;  // Already negative, so add
            
            // Debug logging for goalies
            if (row.wins > 0 || row.saves > 0 || row.shutouts > 0 || row.goals_against > 0) {
              log(' Goalie daily points calculation:', {
                player_id: row.player_id,
                wins: row.wins,
                saves: row.saves,
                shutouts: row.shutouts,
                goals_against: row.goals_against,
                weights: goalieScoring,
                calculated_points: dailyTotalPoints
              });
            }
          } else {
            // Skater Formula: Use ALL 8 league settings
            dailyTotalPoints = 
              (row.goals || 0) * skaterScoring.goals + 
              (row.assists || 0) * skaterScoring.assists + 
              (row.ppp || 0) * skaterScoring.power_play_points +
              (row.shp || 0) * skaterScoring.short_handed_points +
              (row.shots_on_goal || 0) * skaterScoring.shots_on_goal + 
              (row.blocks || 0) * skaterScoring.blocks +
              (row.hits || 0) * skaterScoring.hits +
              (row.pim || 0) * skaterScoring.penalty_minutes;
          }
          
          // Store ALL available stats for comprehensive display
          statsMap.set(row.player_id, {
            // Core stats
            goals: row.goals || 0,
            assists: row.assists || 0,
            points: row.points || 0,
            sog: row.shots_on_goal || 0,
            pim: row.pim || 0,
            plus_minus: row.plus_minus || 0,
            toi_seconds: row.toi_seconds || 0,
            
            // Physical stats
            hits: row.hits || 0,
            blocks: row.blocks || 0,
            
            // Faceoffs
            faceoff_wins: row.faceoff_wins || 0,
            faceoff_losses: row.faceoff_losses || 0,
            faceoff_taken: row.faceoff_taken || 0,
            
            // Possession
            takeaways: row.takeaways || 0,
            giveaways: row.giveaways || 0,
            
            // Power Play breakdown
            ppp: row.ppp || 0,
            ppg: row.ppg || 0,
            ppa: row.ppa || 0,
            
            // Shorthanded breakdown
            shp: row.shp || 0,
            shg: row.shg || 0,
            sha: row.sha || 0,
            
            // Shot metrics (Corsi components)
            shots_missed: row.shots_missed || 0,
            shots_blocked: row.shots_blocked || 0,
            shot_attempts: row.shot_attempts || 0,
            
            // Game context
            gwg: row.gwg || 0,
            otg: row.otg || 0,
            shifts: row.shifts || 0,
            
            // Goalie stats
            wins: row.wins || 0,
            losses: row.losses || 0,
            ot_losses: row.ot_losses || 0,
            saves: row.saves || 0,
            shots_faced: row.shots_faced || 0,
            goals_against: row.goals_against || 0,
            shutouts: row.shutouts || 0,
            save_pct: row.save_pct || 0,
            
            // Calculated values
            daily_total_points: dailyTotalPoints,
            is_goalie: isGoalie,
            
            // Build scoring breakdown for tooltip (same format as stats_breakdown)
            // Use league scoring settings for accurate point calculations
            daily_stats_breakdown: isGoalie ? {
              ...(row.wins > 0 ? { wins: { count: row.wins, points: row.wins * goalieScoring.wins } } : {}),
              ...(row.saves > 0 ? { saves: { count: row.saves, points: row.saves * goalieScoring.saves } } : {}),
              ...(row.shutouts > 0 ? { shutouts: { count: row.shutouts, points: row.shutouts * goalieScoring.shutouts } } : {}),
              ...(row.goals_against > 0 ? { goals_against: { count: row.goals_against, points: row.goals_against * goalieScoring.goals_against } } : {}),
            } : {
              ...(row.goals > 0 ? { goals: { count: row.goals, points: row.goals * skaterScoring.goals } } : {}),
              ...(row.assists > 0 ? { assists: { count: row.assists, points: row.assists * skaterScoring.assists } } : {}),
              ...(row.ppp > 0 ? { ppp: { count: row.ppp, points: row.ppp * skaterScoring.power_play_points } } : {}),
              ...(row.shp > 0 ? { shp: { count: row.shp, points: row.shp * skaterScoring.short_handed_points } } : {}),
              ...(row.shots_on_goal > 0 ? { shots_on_goal: { count: row.shots_on_goal, points: row.shots_on_goal * skaterScoring.shots_on_goal } } : {}),
              ...(row.blocks > 0 ? { blocks: { count: row.blocks, points: row.blocks * skaterScoring.blocks } } : {}),
              ...(row.hits > 0 ? { hits: { count: row.hits, points: row.hits * skaterScoring.hits } } : {}),
              ...(row.pim > 0 ? { pim: { count: row.pim, points: row.pim * skaterScoring.penalty_minutes } } : {}),
            },
          });
        });

        setDailyStatsMap(statsMap);
      } catch (error) {
        console.error('[Matchup] Error fetching daily stats:', error);
        setDailyStatsMap(new Map());
      } finally {
        loadingRef.current = false;
      }
    };

    // Fetch both stats and projections in parallel
    const fetchData = async () => {
      // Determine which date to fetch projections for
      let dateToFetchProjections = selectedDate;
      
      // If no date selected, default to today if today is in the matchup week
      if (!dateToFetchProjections && currentMatchup) {
        const todayStr = getTodayMST();
        const weekStart = currentMatchup.week_start_date;
        const weekEnd = currentMatchup.week_end_date;
        
        if (todayStr >= weekStart && todayStr <= weekEnd) {
          dateToFetchProjections = todayStr;
        }
      }

      await Promise.all([
        fetchDailyStats(),
        dateToFetchProjections ? fetchProjectionsForDate(dateToFetchProjections) : Promise.resolve()
      ]);
    };

    fetchData();
  }, [selectedDate, currentMatchup, userLeagueState, scoringSettings, playerIdsVersion, demoMyTeam, demoOpponentTeam]); // Use playerIdsVersion instead of team arrays to prevent Death Loop, but include demo teams for guests

  const handlePlayerClick = useCallback(async (player: MatchupPlayer) => {
    try {
      // Fetch season-long stats for this player
      const seasonPlayers = await PlayerService.getPlayersByIds([player.id.toString()]);
      const seasonPlayer = seasonPlayers.find(p => Number(p.id) === player.id);
      
      if (seasonPlayer) {
        const seasonStats = {
          goals: seasonPlayer.goals ?? 0,
          assists: seasonPlayer.assists ?? 0,
          points: seasonPlayer.points ?? 0,
          plusMinus: seasonPlayer.plus_minus ?? 0,
          shots: seasonPlayer.shots ?? 0,
          gamesPlayed: seasonPlayer.games_played ?? 0,
          hits: seasonPlayer.hits ?? 0,
          blockedShots: seasonPlayer.blocks ?? 0,
          xGoals: seasonPlayer.xGoals ?? 0,
          powerPlayPoints: seasonPlayer.ppp !== undefined && seasonPlayer.ppp !== null ? seasonPlayer.ppp : undefined,
          shortHandedPoints: seasonPlayer.shp !== undefined && seasonPlayer.shp !== null ? seasonPlayer.shp : undefined,
          ppp: seasonPlayer.ppp ?? 0,
          shp: seasonPlayer.shp ?? 0,
          pim: seasonPlayer.pim ?? 0,
          icetime_seconds: seasonPlayer.icetime_seconds ?? 0,
          wins: seasonPlayer.wins ?? 0,
          saves: seasonPlayer.saves ?? 0,
          shots_faced: seasonPlayer.shots_faced ?? 0,
          goals_against: seasonPlayer.goals_against ?? 0,
          shutouts: seasonPlayer.shutouts ?? 0,
          save_pct: seasonPlayer.save_percentage ?? 0,
          gaa: seasonPlayer.goals_against_average ?? 0
        };
        setSelectedPlayer(toHockeyPlayer(player, seasonStats));
      } else {
        // Fallback: try to fetch directly from player_season_stats
        const DEFAULT_SEASON = 2025;
        const { data: seasonStatsData, error } = await supabase
          .from('player_season_stats')
          .select('*')
          .eq('player_id', player.id as any)
          .eq('season', DEFAULT_SEASON as any)
          .single();
        
        if (!error && seasonStatsData) {
          const statsData = seasonStatsData as any;
          const calculatedGoals = Number(statsData.nhl_goals ?? 0);
          const calculatedAssists = Number(statsData.nhl_assists ?? 0);
          const calculatedPoints = calculatedGoals + calculatedAssists;
          
          const mappedStats = {
            goals: calculatedGoals,
            assists: calculatedAssists,
            points: calculatedPoints,
            plusMinus: Number(statsData.nhl_plus_minus ?? 0),
            shots: Number(statsData.nhl_shots_on_goal ?? 0),
            gamesPlayed: statsData.games_played ?? 0,
            hits: Number(statsData.nhl_hits ?? 0),
            blockedShots: Number(statsData.nhl_blocks ?? 0),
            xGoals: statsData.x_goals ?? 0,
            powerPlayPoints: Number(statsData.nhl_ppp ?? 0),
            shortHandedPoints: Number(statsData.nhl_shp ?? 0),
            pim: Number(statsData.nhl_pim ?? 0),
            icetime_seconds: Number(statsData.nhl_toi_seconds ?? 0),
            wins: Number(statsData.nhl_wins ?? 0),
            saves: Number(statsData.nhl_saves ?? 0),
            shots_faced: Number(statsData.nhl_shots_faced ?? 0),
            goals_against: Number(statsData.nhl_goals_against ?? 0),
            shutouts: Number(statsData.nhl_shutouts ?? 0),
            save_pct: statsData.nhl_save_pct ?? 0,
            gaa: statsData.nhl_gaa ?? (statsData.nhl_goals_against && statsData.goalie_gp 
              ? statsData.nhl_goals_against / statsData.goalie_gp 
              : 0)
          };
          setSelectedPlayer(toHockeyPlayer(player, mappedStats));
        } else {
          setSelectedPlayer(toHockeyPlayer(player));
        }
      }
    } catch (error) {
      setSelectedPlayer(toHockeyPlayer(player));
    }
    
    setIsPlayerDialogOpen(true);
  }, []); // State setters are stable - no dependencies needed

  const [updates] = useState<string[]>([
    "Connor McDavid scored a goal! +5 points.",
    "David Pastrnak with an assist! +3 points.",
    "Igor Shesterkin made a save! +0.2 points.",
    "Adam Fox with a power play assist! +4 points."
  ]);

  // Use real data if active user, otherwise demo data
  // CRITICAL: Ensure myTeam is always the user's team (left side)
  // and opponentTeamPlayers is always the opponent (right side)
  // CRITICAL FIX: Only use daily stats when a date is EXPLICITLY selected
  // When viewing weekly totals (no date selected), use weekly matchupStats from RPC (aggregated across all games)
  const displayMyTeam = useMemo(() => {
    // During date switching, use previous roster to prevent blank slots
    if (isSwitchingDate && previousRosterRef.current?.myTeam && previousRosterRef.current.myTeam.length > 0) {
      return previousRosterRef.current.myTeam;
    }
    
    const baseTeam = userLeagueState === 'active-user' ? myTeam : demoMyTeam;
    
    // CRITICAL: Only enrich with daily stats if a date is explicitly selected
    // If no date selected, use weekly stats from RPC (which aggregates all games in the week)
    if (!selectedDate) {
      // Debug: Check if base team has games
      const samplePlayer = baseTeam[0];
      if (samplePlayer) {
        log('displayMyTeam No selectedDate - returning baseTeam. Sample player games:', {
          playerId: samplePlayer.id,
          playerName: samplePlayer.name,
          hasGames: !!samplePlayer.games,
          gamesLength: samplePlayer.games?.length || 0,
          games: samplePlayer.games
        });
      }
      return baseTeam; // Use weekly stats from RPC (includes projections from initial load)
    }
    
    // Get projections for selected date (may be undefined if not fetched yet)
    const dateProjections = projectionsByDate.get(selectedDate);
    const hasFetchedProjections = dateProjections !== undefined;
    
    // Date is selected = show that day's stats and projections
    return baseTeam.map(player => {
      const dailyStats = dailyStatsMap.get(player.id);
      const projection = dateProjections?.get(player.id);
      const isGoalie = player.isGoalie || player.position === 'G' || player.position === 'Goalie';
      
      // CRITICAL: Capture games array from original player before any transformations
      // Always preserve games - use player.games if it exists and is an array
      const originalGames = (player.games && Array.isArray(player.games)) ? player.games : (player.games || undefined);
      
      // Debug: Log games capture for first few players
      if (player.id === baseTeam[0]?.id || player.id === baseTeam[1]?.id) {
        log('displayMyTeam Player games capture:', {
          playerId: player.id,
          playerName: player.name,
          playerGames: player.games,
          playerGamesLength: player.games?.length || 0,
          playerGamesIsArray: Array.isArray(player.games),
          originalGames: originalGames,
          hasOriginalGames: !!originalGames,
          originalGamesLength: originalGames?.length || 0,
          isArray: Array.isArray(originalGames),
          playerTeam: player.team,
          playerTeamAbbreviation: (player as any).teamAbbreviation,
          sampleGame: originalGames?.[0] || player.games?.[0] || null
        });
      }
      
      // Merge projections for selected date
      // CRITICAL: If no projection found for selected date OR fetch hasn't completed, preserve original projections from player
      const mergedProjection = (hasFetchedProjections && projection) ? {
        ...(isGoalie && projection.is_goalie ? {
          goalieProjection: {
            total_projected_points: Number(projection.total_projected_points || 0),
            projected_wins: Number(projection.projected_wins || 0),
            projected_saves: Number(projection.projected_saves || 0),
            projected_shutouts: Number(projection.projected_shutouts || 0),
            projected_goals_against: Number(projection.projected_goals_against || 0),
            projected_gaa: Number(projection.projected_gaa || 0),
            projected_save_pct: Number(projection.projected_save_pct || 0),
            projected_gp: Number(projection.projected_gp || 0),
            starter_confirmed: Boolean(projection.starter_confirmed),
            confidence_score: Number(projection.confidence_score || 0),
            calculation_method: projection.calculation_method || 'probability_based_volume'
          }
        } : {}),
        ...(!isGoalie && !projection.is_goalie ? {
          daily_projection: {
            total_projected_points: Number(projection.total_projected_points || 0),
            projected_goals: Number(projection.projected_goals || 0),
            projected_assists: Number(projection.projected_assists || 0),
            projected_sog: Number(projection.projected_sog || 0),
            projected_blocks: Number(projection.projected_blocks || 0),
            projected_ppp: Number(projection.projected_ppp || 0),
            projected_shp: Number(projection.projected_shp || 0),
            projected_hits: Number(projection.projected_hits || 0),
            projected_pim: Number(projection.projected_pim || 0),
            projected_xg: Number(projection.projected_xg || 0),
            base_ppg: Number(projection.base_ppg || 0),
            shrinkage_weight: Number(projection.shrinkage_weight || 0),
            finishing_multiplier: Number(projection.finishing_multiplier || 1),
            opponent_adjustment: Number(projection.opponent_adjustment || 1),
            b2b_penalty: Number(projection.b2b_penalty || 1),
            home_away_adjustment: Number(projection.home_away_adjustment || 1),
            confidence_score: Number(projection.confidence_score || 0),
            calculation_method: projection.calculation_method || 'hybrid_bayesian',
            is_goalie: false
          }
        } : {})
      } : {
        // No projection found for selected date - preserve original projections from player
        ...(player.goalieProjection ? { goalieProjection: player.goalieProjection } : {}),
        ...(player.daily_projection ? { daily_projection: player.daily_projection } : {})
      };
      
      // CRITICAL: For past dates, always set daily_total_points (even if 0) so hasDailyStats works
      // For future/today dates, only set if dailyStats exists
      // For live games, always set daily_total_points to 0 (if no stats yet) so we show actual points instead of projections
      const todayStr = getTodayMST();
      const viewingDateStr = selectedDate || todayStr; // The date being viewed (selected or today)
      const isPastDate = selectedDate ? selectedDate < todayStr : false;
      
      // Check if player has a live/started/final game on THE DATE BEING VIEWED
      // CRITICAL: Use viewingDateStr not todayStr - the user might be viewing a different date
      // Also check if game has started based on scores/period, not just status
      // This handles cases where status field is stale but game has actually started
      const hasStartedOrFinalGameOnViewedDate = originalGames && originalGames.some(g => {
        if (!g || typeof g !== 'object') return false;
        const gameDate = g.game_date?.split('T')[0];
        if (gameDate !== viewingDateStr) return false;
        
        const gameStatus = (g.status || '').toLowerCase();
        // Check if game is live/intermission by status
        const isLiveByStatus = gameStatus === 'live' || gameStatus === 'crit' || gameStatus === 'intermission';
        // Check if game is final by status
        const isFinalByStatus = gameStatus === 'final';
        // Check if game has started by looking at scores or period info (handles stale status)
        const hasScores = (g.home_score || 0) + (g.away_score || 0) > 0;
        const hasPeriod = g.period !== null && g.period !== undefined && g.period !== '';
        
        return isLiveByStatus || isFinalByStatus || hasScores || hasPeriod;
      });
      
      // Helper function to get daily_stats_breakdown with proper empty object check
      const getDailyStatsBreakdown = () => {
        // Check if dailyStats.daily_stats_breakdown exists AND has keys
        if (dailyStats?.daily_stats_breakdown && Object.keys(dailyStats.daily_stats_breakdown).length > 0) {
          return dailyStats.daily_stats_breakdown;
        }
        // Fallback to player's existing breakdown if it exists and has keys
        if (player.daily_stats_breakdown && Object.keys(player.daily_stats_breakdown).length > 0) {
          return player.daily_stats_breakdown;
        }
        return null;
      };
      
      // If no daily stats from RPC, check if we should still set daily_total_points
      if (!dailyStats) {
        // For past dates, set daily_total_points to 0 (player didn't play or no data)
        // This ensures hasDailyStats is true so we can show "0.0 pts" instead of projections
        if (isPastDate) {
          return {
            ...player,
            ...mergedProjection,
            daily_total_points: 0,
            daily_stats_breakdown: getDailyStatsBreakdown(),
            // CRITICAL: Always preserve games - use originalGames if captured, otherwise preserve from spread
            games: originalGames !== undefined ? originalGames : player.games
          };
        }
        // For live/started/final games on the viewed date, set daily_total_points to 0 so we show actual points (even if 0) instead of projections
        if (hasStartedOrFinalGameOnViewedDate) {
          return {
            ...player,
            ...mergedProjection,
            daily_total_points: 0,
            daily_stats_breakdown: getDailyStatsBreakdown(),
            // CRITICAL: Always preserve games - use originalGames if captured, otherwise preserve from spread
            games: originalGames !== undefined ? originalGames : player.games
          };
        }
        // For future/today dates without stats, just return player with projections
        return {
          ...player,
          ...mergedProjection,
          // CRITICAL: Always preserve games - use originalGames if captured, otherwise preserve from spread
          games: originalGames !== undefined ? originalGames : player.games
        };
      }
      
      return {
        ...player,
        ...mergedProjection,
        matchupStats: isGoalie ? {
          // Goalie daily stats (for selected date only)
          wins: dailyStats.wins || 0,
          saves: dailyStats.saves || 0,
          shutouts: dailyStats.shutouts || 0,
          goals_against: dailyStats.goals_against || 0,
        } : {
          // Skater daily stats (for selected date only) - ALL 8 STATS
          goals: dailyStats.goals || 0,
          assists: dailyStats.assists || 0,
          sog: dailyStats.sog || 0,
          blocks: dailyStats.blocks || 0,
          ppp: dailyStats.ppp || 0,
          shp: dailyStats.shp || 0,
          hits: dailyStats.hits || 0,
          pim: dailyStats.pim || 0,
          xGoals: dailyStats.xGoals || 0,
        },
        // Update stats for display in statline (only when date is selected)
        stats: isGoalie ? {
          ...player.stats,
          // Goalie daily stats (for selected date only)
          wins: dailyStats.wins || 0,
          saves: dailyStats.saves || 0,
          shutouts: dailyStats.shutouts || 0,
          goals_against: dailyStats.goals_against || 0,
        } : {
          ...player.stats,
          // Skater daily stats (for selected date only) - ALL 8 STATS
          goals: dailyStats.goals || 0,
          assists: dailyStats.assists || 0,
          sog: dailyStats.sog || 0,
          blk: dailyStats.blocks || 0,
          ppp: dailyStats.ppp || 0,
          shp: dailyStats.shp || 0,
          hits: dailyStats.hits || 0,
          pim: dailyStats.pim || 0,
          xGoals: dailyStats.xGoals || 0,
        },
        // Add goalie matchup stats for goalies (only when date is selected)
        // CRITICAL: In weekly view, use player.goalieMatchupStats from RPC (weekly aggregated)
        goalieMatchupStats: isGoalie ? {
          wins: dailyStats.wins || 0,
          saves: dailyStats.saves || 0,
          shutouts: dailyStats.shutouts || 0,
          goalsAgainst: dailyStats.goals_against || 0,
        } : player.goalieMatchupStats,
        // Add daily total points for the projection bar replacement
        daily_total_points: dailyStats.daily_total_points || 0,
        // Add daily stats breakdown for tooltip hover - check for empty objects
        daily_stats_breakdown: getDailyStatsBreakdown(),
        // CRITICAL: Always preserve games - use originalGames if captured, otherwise preserve from spread
        // The spread ...player will include games if it exists, so we only need to explicitly set if we captured it
        games: originalGames !== undefined ? originalGames : player.games,
        // Keep weekly total_points unchanged - it's the matchup week total
      };
    }).map(transformedPlayer => {
      // Debug: Log final games for first few players
      if (transformedPlayer.id === baseTeam[0]?.id || transformedPlayer.id === baseTeam[1]?.id) {
        log('displayMyTeam Final transformed player games:', {
          playerId: transformedPlayer.id,
          playerName: transformedPlayer.name,
          hasGames: !!transformedPlayer.games,
          gamesLength: transformedPlayer.games?.length || 0,
          gamesIsArray: Array.isArray(transformedPlayer.games),
          games: transformedPlayer.games,
          sampleGame: transformedPlayer.games?.[0] || null,
          hasTeam: !!transformedPlayer.team,
          team: transformedPlayer.team,
          teamAbbreviation: (transformedPlayer as any).teamAbbreviation,
          hasDailyStatsBreakdown: !!transformedPlayer.daily_stats_breakdown,
          dailyStatsBreakdown: transformedPlayer.daily_stats_breakdown,
          dailyStatsBreakdownKeys: transformedPlayer.daily_stats_breakdown ? Object.keys(transformedPlayer.daily_stats_breakdown).length : 0,
          dailyStatsBreakdownType: typeof transformedPlayer.daily_stats_breakdown
        });
      }
      return transformedPlayer;
    });
  }, [userLeagueState, playerIdsVersion, demoMyTeam.length, dailyStatsMap, selectedDate, projectionsByDate, isSwitchingDate, myTeam]);

  const displayOpponentTeam = useMemo(() => {
    // During date switching, use previous roster to prevent blank slots
    if (isSwitchingDate && previousRosterRef.current?.oppTeam && previousRosterRef.current.oppTeam.length > 0) {
      return previousRosterRef.current.oppTeam;
    }
    
    const baseTeam = userLeagueState === 'active-user' ? opponentTeamPlayers : demoOpponentTeam;
    
    // CRITICAL: Only enrich with daily stats if a date is explicitly selected
    // If no date selected, use weekly stats from RPC (which aggregates all games in the week)
    if (!selectedDate) {
      return baseTeam; // Use weekly stats from RPC (includes projections from initial load)
    }
    
    // Get projections for selected date (may be undefined if not fetched yet)
    const dateProjections = projectionsByDate.get(selectedDate);
    const hasFetchedProjections = dateProjections !== undefined;
    
    // Date is selected = show that day's stats and projections
    return baseTeam.map(player => {
      const dailyStats = dailyStatsMap.get(player.id);
      const projection = dateProjections?.get(player.id);
      const isGoalie = player.isGoalie || player.position === 'G' || player.position === 'Goalie';
      
      // CRITICAL: Capture games array from original player before any transformations
      // Always preserve games - use player.games if it exists and is an array
      const originalGames = (player.games && Array.isArray(player.games)) ? player.games : (player.games || undefined);
      
      // Merge projections for selected date
      // CRITICAL: If no projection found for selected date OR fetch hasn't completed, preserve original projections from player
      const mergedProjection = (hasFetchedProjections && projection) ? {
        ...(isGoalie && projection.is_goalie ? {
          goalieProjection: {
            total_projected_points: Number(projection.total_projected_points || 0),
            projected_wins: Number(projection.projected_wins || 0),
            projected_saves: Number(projection.projected_saves || 0),
            projected_shutouts: Number(projection.projected_shutouts || 0),
            projected_goals_against: Number(projection.projected_goals_against || 0),
            projected_gaa: Number(projection.projected_gaa || 0),
            projected_save_pct: Number(projection.projected_save_pct || 0),
            projected_gp: Number(projection.projected_gp || 0),
            starter_confirmed: Boolean(projection.starter_confirmed),
            confidence_score: Number(projection.confidence_score || 0),
            calculation_method: projection.calculation_method || 'probability_based_volume'
          }
        } : {}),
        ...(!isGoalie && !projection.is_goalie ? {
          daily_projection: {
            total_projected_points: Number(projection.total_projected_points || 0),
            projected_goals: Number(projection.projected_goals || 0),
            projected_assists: Number(projection.projected_assists || 0),
            projected_sog: Number(projection.projected_sog || 0),
            projected_blocks: Number(projection.projected_blocks || 0),
            projected_ppp: Number(projection.projected_ppp || 0),
            projected_shp: Number(projection.projected_shp || 0),
            projected_hits: Number(projection.projected_hits || 0),
            projected_pim: Number(projection.projected_pim || 0),
            projected_xg: Number(projection.projected_xg || 0),
            base_ppg: Number(projection.base_ppg || 0),
            shrinkage_weight: Number(projection.shrinkage_weight || 0),
            finishing_multiplier: Number(projection.finishing_multiplier || 1),
            opponent_adjustment: Number(projection.opponent_adjustment || 1),
            b2b_penalty: Number(projection.b2b_penalty || 1),
            home_away_adjustment: Number(projection.home_away_adjustment || 1),
            confidence_score: Number(projection.confidence_score || 0),
            calculation_method: projection.calculation_method || 'hybrid_bayesian',
            is_goalie: false
          }
        } : {})
      } : {
        // No projection found for selected date - preserve original projections from player
        ...(player.goalieProjection ? { goalieProjection: player.goalieProjection } : {}),
        ...(player.daily_projection ? { daily_projection: player.daily_projection } : {})
      };
      
      // CRITICAL: For past dates, always set daily_total_points (even if 0) so hasDailyStats works
      // For future/today dates, only set if dailyStats exists
      // For live games, always set daily_total_points to 0 (if no stats yet) so we show actual points instead of projections
      const todayStr = getTodayMST();
      const viewingDateStr = selectedDate || todayStr; // The date being viewed (selected or today)
      const isPastDate = selectedDate ? selectedDate < todayStr : false;
      
      // Check if player has a live/started/final game on THE DATE BEING VIEWED
      // CRITICAL: Use viewingDateStr not todayStr - the user might be viewing a different date
      // Also check if game has started based on scores/period, not just status
      // This handles cases where status field is stale but game has actually started
      const hasStartedOrFinalGameOnViewedDate = originalGames && originalGames.some(g => {
        if (!g || typeof g !== 'object') return false;
        const gameDate = g.game_date?.split('T')[0];
        if (gameDate !== viewingDateStr) return false;
        
        const gameStatus = (g.status || '').toLowerCase();
        // Check if game is live/intermission by status
        const isLiveByStatus = gameStatus === 'live' || gameStatus === 'crit' || gameStatus === 'intermission';
        // Check if game is final by status
        const isFinalByStatus = gameStatus === 'final';
        // Check if game has started by looking at scores or period info (handles stale status)
        const hasScores = (g.home_score || 0) + (g.away_score || 0) > 0;
        const hasPeriod = g.period !== null && g.period !== undefined && g.period !== '';
        
        return isLiveByStatus || isFinalByStatus || hasScores || hasPeriod;
      });
      
      // Helper function to get daily_stats_breakdown with proper empty object check
      const getDailyStatsBreakdown = () => {
        // Check if dailyStats.daily_stats_breakdown exists AND has keys
        if (dailyStats?.daily_stats_breakdown && Object.keys(dailyStats.daily_stats_breakdown).length > 0) {
          return dailyStats.daily_stats_breakdown;
        }
        // Fallback to player's existing breakdown if it exists and has keys
        if (player.daily_stats_breakdown && Object.keys(player.daily_stats_breakdown).length > 0) {
          return player.daily_stats_breakdown;
        }
        return null;
      };
      
      // If no daily stats from RPC, check if we should still set daily_total_points
      if (!dailyStats) {
        // For past dates, set daily_total_points to 0 (player didn't play or no data)
        // This ensures hasDailyStats is true so we can show "0.0 pts" instead of projections
        if (isPastDate) {
          return {
            ...player,
            ...mergedProjection,
            daily_total_points: 0,
            daily_stats_breakdown: getDailyStatsBreakdown(),
            // CRITICAL: Always preserve games - use originalGames if captured, otherwise preserve from spread
            games: originalGames !== undefined ? originalGames : player.games
          };
        }
        // For live/started/final games on the viewed date, set daily_total_points to 0 so we show actual points (even if 0) instead of projections
        if (hasStartedOrFinalGameOnViewedDate) {
          return {
            ...player,
            ...mergedProjection,
            daily_total_points: 0,
            daily_stats_breakdown: getDailyStatsBreakdown(),
            // CRITICAL: Always preserve games - use originalGames if captured, otherwise preserve from spread
            games: originalGames !== undefined ? originalGames : player.games
          };
        }
        // For future/today dates without stats, just return player with projections
        return {
          ...player,
          ...mergedProjection,
          // CRITICAL: Always preserve games - use originalGames if captured, otherwise preserve from spread
          games: originalGames !== undefined ? originalGames : player.games
        };
      }
      
      return {
        ...player,
        ...mergedProjection,
        matchupStats: isGoalie ? {
          // Goalie daily stats (for selected date only)
          wins: dailyStats.wins || 0,
          saves: dailyStats.saves || 0,
          shutouts: dailyStats.shutouts || 0,
          goals_against: dailyStats.goals_against || 0,
        } : {
          // Skater daily stats (for selected date only) - ALL 8 STATS
          goals: dailyStats.goals || 0,
          assists: dailyStats.assists || 0,
          sog: dailyStats.sog || 0,
          blocks: dailyStats.blocks || 0,
          ppp: dailyStats.ppp || 0,
          shp: dailyStats.shp || 0,
          hits: dailyStats.hits || 0,
          pim: dailyStats.pim || 0,
          xGoals: dailyStats.xGoals || 0,
        },
        // Update stats for display in statline (only when date is selected)
        stats: isGoalie ? {
          ...player.stats,
          // Goalie daily stats (for selected date only)
          wins: dailyStats.wins || 0,
          saves: dailyStats.saves || 0,
          shutouts: dailyStats.shutouts || 0,
          goals_against: dailyStats.goals_against || 0,
        } : {
          ...player.stats,
          // Skater daily stats (for selected date only) - ALL 8 STATS
          goals: dailyStats.goals || 0,
          assists: dailyStats.assists || 0,
          sog: dailyStats.sog || 0,
          blk: dailyStats.blocks || 0,
          ppp: dailyStats.ppp || 0,
          shp: dailyStats.shp || 0,
          hits: dailyStats.hits || 0,
          pim: dailyStats.pim || 0,
          xGoals: dailyStats.xGoals || 0,
        },
        // Add goalie matchup stats for goalies (only when date is selected)
        // CRITICAL: In weekly view, use player.goalieMatchupStats from RPC (weekly aggregated)
        goalieMatchupStats: isGoalie ? {
          wins: dailyStats.wins || 0,
          saves: dailyStats.saves || 0,
          shutouts: dailyStats.shutouts || 0,
          goalsAgainst: dailyStats.goals_against || 0,
        } : player.goalieMatchupStats,
        // Add daily total points for the projection bar replacement
        daily_total_points: dailyStats.daily_total_points || 0,
        // Add daily stats breakdown for tooltip hover - check for empty objects
        daily_stats_breakdown: getDailyStatsBreakdown(),
        // CRITICAL: Always preserve games - use originalGames if captured, otherwise preserve from spread
        games: originalGames !== undefined ? originalGames : player.games,
        // Keep weekly total_points unchanged - it's the matchup week total
      };
    });
  }, [userLeagueState, playerIdsVersion, demoOpponentTeam.length, dailyStatsMap, selectedDate, projectionsByDate, isSwitchingDate, opponentTeamPlayers]);
  const displayMyTeamSlotAssignments = useMemo(() =>
    userLeagueState === 'active-user' ? myTeamSlotAssignments : demoMyTeamSlotAssignments,
    [userLeagueState, myTeamSlotAssignments, demoMyTeamSlotAssignments]
  );
  const displayOpponentTeamSlotAssignments = useMemo(() =>
    userLeagueState === 'active-user' ? opponentTeamSlotAssignments : demoOpponentTeamSlotAssignments,
    [userLeagueState, opponentTeamSlotAssignments, demoOpponentTeamSlotAssignments]
  );

  // Define starters BEFORE using them in team points calculations
  const myStarters = useMemo(() => displayMyTeam.filter(p => p.isStarter), [displayMyTeam]);
  const myBench = useMemo(() => displayMyTeam.filter(p => !p.isStarter), [displayMyTeam]);
  const opponentStarters = useMemo(() => displayOpponentTeam.filter(p => p.isStarter), [displayOpponentTeam]);
  const opponentBench = useMemo(() => displayOpponentTeam.filter(p => !p.isStarter), [displayOpponentTeam]);

  // YAHOO/SLEEPER DISPLAY: Use frozen lineup for past days, current for today/future
  // This ensures when clicking on past day, we show WHO was actually playing
  // CRITICAL: Use frozen lineup directly (not merged) to show exact roster state for that day
  const displayStarters = useMemo(() => {
    // Data is already correct from getMatchupRosters() - no switching needed
    // For past dates: myStarters contains frozen roster
    // For today/future: myStarters contains current roster
    return myStarters;
  }, [myStarters]);

  const displayOpponentStarters = useMemo(() => {
    // Data is already correct from getMatchupRosters() - no switching needed
    // For past dates: opponentStarters contains frozen roster
    // For today/future: opponentStarters contains current roster
    return opponentStarters;
  }, [opponentStarters]);

  // =============================================================================
  // YAHOO/SLEEPER FROZEN SCORING: Cached past + Live future
  // =============================================================================
  // Past days: Use cached frozen scores (won't change when roster changes)
  // Today/Future: Calculate from current roster (reflects roster changes)
  // This ensures past day scores are "locked in" and don't change retroactively
  // ANTI-FLASH: Only update when stats are fully loaded (prevents 0.0 flashing)
  // =============================================================================
  const myTeamPoints = useMemo(() => {
    // If stats are currently loading, return last stable score to prevent flashing
    if (statsLoadingRef.current && lastScoreRef.current) {
      return lastScoreRef.current.myScore;
    }
    
    if (!currentMatchup || dailyStatsByDate.size === 0) {
      // Fallback: sum starter week totals if no daily breakdown available
      const fallback = myStarters.reduce((sum, player) => sum + (player.total_points ?? 0), 0);
      const score = fallback.toFixed(1);
      if (!lastScoreRef.current) {
        lastScoreRef.current = { myScore: score, oppScore: '0.0' };
      } else {
        lastScoreRef.current.myScore = score;
      }
      return score;
    }

    // Use string comparison to avoid timezone issues
    const todayStr = getTodayMST();
    
    // Parse weekStart carefully to avoid timezone issues
    const [startYear, startMonth, startDay] = currentMatchup.week_start_date.split('-').map(Number);
    let total = 0;
    
    for (let i = 0; i < 7; i++) {
      // Create date string directly without Date object timezone issues
      const dayDate = new Date(startYear, startMonth - 1, startDay + i);
      const dateStr = `${dayDate.getFullYear()}-${String(dayDate.getMonth() + 1).padStart(2, '0')}-${String(dayDate.getDate()).padStart(2, '0')}`;
      const isPast = dateStr < todayStr;
      
      // Check if we have a cached score for this date
      const cachedScore = cachedDailyScores.get(dateStr);
      
      if (isPast && cachedScore?.isLocked) {
        // Past day: Use frozen cached score (won't change when roster changes)
        total += cachedScore.myScore;
      } else {
        // Today or future: Calculate from current roster (reflects roster changes)
        const dayStats = dailyStatsByDate.get(dateStr);
        if (dayStats) {
          const dayTotal = myStarters.reduce((sum, player) => {
            const playerId = typeof player.id === 'string' ? parseInt(player.id, 10) : player.id;
            const playerStats = dayStats.get(playerId);
            return sum + (playerStats?.daily_total_points ?? 0);
          }, 0);
          total += dayTotal;
        }
      }
    }
    
    const score = total.toFixed(1);
    // Cache the stable score
    if (!lastScoreRef.current) {
      lastScoreRef.current = { myScore: score, oppScore: '0.0' };
    } else {
      lastScoreRef.current.myScore = score;
    }
    return score;
  }, [currentMatchup, dailyStatsByDate, myStarters, cachedDailyScores]);

  const opponentTeamPoints = useMemo(() => {
    // If stats are currently loading, return last stable score to prevent flashing
    if (statsLoadingRef.current && lastScoreRef.current) {
      return lastScoreRef.current.oppScore;
    }
    
    if (!currentMatchup || dailyStatsByDate.size === 0) {
      const fallback = opponentStarters.reduce((sum, player) => sum + (player.total_points ?? 0), 0);
      const score = fallback.toFixed(1);
      if (lastScoreRef.current) {
        lastScoreRef.current.oppScore = score;
      }
      return score;
    }

    // Use string comparison to avoid timezone issues
    const todayStr = getTodayMST();
    
    // Parse weekStart carefully to avoid timezone issues
    const [startYear, startMonth, startDay] = currentMatchup.week_start_date.split('-').map(Number);
    let total = 0;
    
    for (let i = 0; i < 7; i++) {
      // Create date string directly without Date object timezone issues
      const dayDate = new Date(startYear, startMonth - 1, startDay + i);
      const dateStr = `${dayDate.getFullYear()}-${String(dayDate.getMonth() + 1).padStart(2, '0')}-${String(dayDate.getDate()).padStart(2, '0')}`;
      const isPast = dateStr < todayStr;
      
      // Check if we have a cached score for this date
      const cachedScore = cachedDailyScores.get(dateStr);
      
      if (isPast && cachedScore?.isLocked) {
        // Past day: Use frozen cached score (won't change when roster changes)
        total += cachedScore.oppScore;
      } else {
        // Today or future: Calculate from current roster (reflects roster changes)
        const dayStats = dailyStatsByDate.get(dateStr);
        if (dayStats) {
          const dayTotal = opponentStarters.reduce((sum, player) => {
            const playerId = typeof player.id === 'string' ? parseInt(player.id, 10) : player.id;
            const playerStats = dayStats.get(playerId);
            return sum + (playerStats?.daily_total_points ?? 0);
          }, 0);
          total += dayTotal;
        }
      }
    }
    
    const score = total.toFixed(1);
    // Cache the stable score
    if (lastScoreRef.current) {
      lastScoreRef.current.oppScore = score;
    }
    return score;
  }, [currentMatchup, dailyStatsByDate, opponentStarters, cachedDailyScores]);

  const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  
  // Calculate daily points - only if matchup has started and has scores
  const hasMatchupData = currentMatchup && 
    (currentMatchup.status === 'in_progress' || currentMatchup.status === 'completed') &&
    (parseFloat(String(currentMatchup.team1_score)) > 0 || parseFloat(String(currentMatchup.team2_score)) > 0);
  


  // Load real matchup data for logged-in users with leagues
  useEffect(() => {
    // CRITICAL: Early exit guards to prevent infinite loops
    
    // Wait for LeagueContext to finish loading before making decisions
    // Note: leagueContextLoading is NOT in dependency array to prevent re-runs
    if (leagueContextLoading) {
      return;
    }
    
    if (!user?.id) {
      log(' No user ID, skipping');
      setLoading(false);
      hasInitializedRef.current = true; // Mark initialization complete
      return;
    }
    
    // If userLeagueState says no league, don't try to load matchup data
    // But also don't freeze - just show the appropriate UI
    if (userLeagueState === 'logged-in-no-league') {
      log(' User has no league, showing league creation CTA - EXITING EARLY');
      setLoading(false);
      hasInitializedRef.current = true; // Mark initialization complete
      loadingRef.current = false; // Release lock
      return;
    }
    
    if (userLeagueState === 'guest') {
      log(' Guest user, skipping matchup load');
      setLoading(false);
      hasInitializedRef.current = true; // Mark initialization complete
      return;
    }
    
    // Only proceed if we're an active user
    if (userLeagueState !== 'active-user') {
      log(' Not active user state:', userLeagueState, '- skipping load');
      setLoading(false);
      hasInitializedRef.current = true; // Mark initialization complete
      return;
    }
    
    // Guard: Don't run if we don't have a league ID and haven't determined one yet
    if (!urlLeagueId && loadingRef.current) {
      log(' No league ID and load in progress, skipping');
      return;
    }
    
    // Check if values actually changed to prevent unnecessary reloads
    // NOTE: selectedDate is NOT checked here - date changes are handled by separate useEffect
    const leagueIdChanged = prevLeagueIdRef.current !== urlLeagueId;
    const weekIdChanged = prevWeekIdRef.current !== urlWeekId;
    const selectedMatchupIdChanged = prevSelectedMatchupIdRef.current !== selectedMatchupId;
    
    // If selectedMatchupId changed, ALWAYS bypass cache and reload
    if (selectedMatchupIdChanged) {
      log(' Selected matchup changed, bypassing cache:', {
        previous: prevSelectedMatchupIdRef.current,
        current: selectedMatchupId
      });
    }
    
    // If values haven't changed AND selectedMatchupId hasn't changed, check cache
    if (!leagueIdChanged && !weekIdChanged && !selectedMatchupIdChanged && urlLeagueId && urlWeekId) {
      if (loadedMatchupDataRef.current && 
          loadedMatchupDataRef.current.leagueId === urlLeagueId &&
          loadedMatchupDataRef.current.weekId === urlWeekId &&
          loadedMatchupDataRef.current.matchupId === selectedMatchupId) {
        const age = Date.now() - loadedMatchupDataRef.current.timestamp;
        if (age < CACHE_TTL && !loadingRef.current) {
          log(' Using cached data, skipping reload');
          setLoading(false);
          return;
        }
      }
    }
    
    // Update refs to track current values
    prevLeagueIdRef.current = urlLeagueId;
    prevWeekIdRef.current = urlWeekId;
    prevSelectedMatchupIdRef.current = selectedMatchupId;
    // Note: prevSelectedDateRef removed - date changes handled by separate useEffect
    
    log(' useEffect triggered - starting load', {
      hasUser: !!user,
      userId: user?.id,
      userLeagueState,
      urlLeagueId,
      urlWeekId,
      selectedMatchupId,
      leagueIdChanged,
      weekIdChanged,
      selectedMatchupIdChanged,
      loadingRefCurrent: loadingRef.current
    });

    // Helper to convert Player to MatchupPlayer format
    const transformToMatchupPlayer = (player: Player, isStarter: boolean): MatchupPlayer => {
      const p = player as any;
      return {
        id: p.id as number,
        name: p.full_name || p.name || '',
        position: p.position,
        team: p.team || '',
        teamAbbreviation: p.team_abbreviation || p.team || '',
        points: p.fantasy_points || 0,
        total_points: p.fantasy_points || 0,
        headshot_url: p.headshot_url,
        isStarter: isStarter,
        isOnIR: p.status === 'IR' || p.status === 'SUSP',
        stats: {
          goals: 0,
          assists: 0,
          sog: 0,
          blk: 0,
          xGoals: 0
        },
        matchupStats: {
          goals: 0,
          assists: 0,
          sog: 0,
          blk: 0,
          xGoals: 0
        },
        games: [],
        gamesRemaining: 0,
        isGoalie: p.position === 'G',
        status: (p.status || null) as any
      } as MatchupPlayer;
    };

    const loadMatchupData = async () => {
      // CRITICAL: Prevent concurrent loads AND infinite loops
      if (loadingRef.current) {
        log(' Load already in progress, skipping duplicate call...');
        return;
      }
      
      // Capture current matchup ID to detect if matchup is actually changing
      const previousMatchupId = currentMatchup?.id;
      
      // Additional guard: If we've already tried loading and failed, don't retry immediately
      // This prevents infinite retry loops
      if (error && !loading) {
        log(' Previous load failed, not retrying automatically');
        return;
      }
      
      // Guard: Prevent running if we've already processed "no league" state
      if (hasProcessedNoLeague.current && (userLeagueState as string) === 'logged-in-no-league') {
        log(' Already processed no-league state, skipping');
        return;
      }
      
      // Set loading state immediately to prevent duplicate calls
      loadingRef.current = true;
      
      // Set up timeout to ensure loading completes within 15 seconds (more aggressive)
      let timeoutId: NodeJS.Timeout | null = null;
      timeoutId = setTimeout(() => {
        console.error('[MATCHUP] Load timeout after 15s - FORCING STOP');
        setError('Loading took too long. Please refresh the page or try again later.');
        setLoading(false);
        loadingRef.current = false; // Force release lock
      }, 15000);
      
      try {
        setLoading(true);
        setError(null);

        // Determine which league to use (from URL or first available)
        let targetLeagueId = urlLeagueId;
        
        if (!targetLeagueId) {
          log(' No leagueId in URL, fetching user leagues...');
          // Get user's leagues if no leagueId in URL
          const { leagues: userLeagues, error: leaguesError } = await LeagueService.getUserLeagues(user.id);
          if (leaguesError) {
            console.error('[MATCHUP] Error fetching user leagues:', leaguesError);
            throw leaguesError;
          }

          if (userLeagues.length === 0) {
            console.error('[MATCHUP] User has no leagues');
            setError('You are not in any leagues');
            setLoading(false);
            loadingRef.current = false;
            return;
          }

          // Use first league and redirect to URL with leagueId
          const currentLeague = userLeagues[0];
          targetLeagueId = currentLeague.id;
          log(' Redirecting to league:', targetLeagueId);
          
          // Redirect to URL with leagueId (and weekId if available) - use window.location to avoid loops
          const weekParam = urlWeekId ? `/${urlWeekId}` : '';
          window.location.href = `/matchup/${targetLeagueId}${weekParam}`;
          return;
        }

        log(' LeagueId from URL:', targetLeagueId);
        // Get league data
        const { leagues: userLeagues, error: leagueError } = await LeagueService.getUserLeagues(user.id);
        if (leagueError) {
          console.error('[MATCHUP] Error fetching leagues for validation:', leagueError);
          throw leagueError;
        }
        
        const currentLeague = userLeagues.find((l: League) => l.id === targetLeagueId);
        if (!currentLeague) {
          console.error('[MATCHUP] League not found in user leagues:', targetLeagueId);
          setError('League not found');
          setLoading(false);
          loadingRef.current = false;
          return;
        }

        log(' Found league:', currentLeague.id, 'draft_status:', currentLeague.draft_status);
        setLeague(currentLeague);

        // Check if draft is completed
        if (currentLeague.draft_status !== 'completed') {
          log(' Draft not completed, cannot view matchups');
          setError('Draft must be completed before viewing matchups');
          setLoading(false);
          loadingRef.current = false;
          return;
        }

        // Update all matchup scores for this league to ensure they're current
        // This uses the EXACT same calculation as the matchup tab (sum of 7 daily scores)
        // Ensures all matchups (user teams AND AI teams) use identical calculation
        try {
          const { error: updateScoresError } = await MatchupService.updateMatchupScores(currentLeague.id);
          if (updateScoresError) {
            log('WARN: Error updating matchup scores:', updateScoresError);
            // Don't block matchup load if score update fails
          }
        } catch (error) {
          log('WARN: Exception updating matchup scores:', error);
          // Don't block matchup load if score update fails
        }

        log(' Getting user team for league:', currentLeague.id);
        // Get user's team
        const { team: userTeamData } = await LeagueService.getUserTeam(currentLeague.id, user.id);
        if (!userTeamData) {
          console.error('[MATCHUP] User team not found');
          setError('You do not have a team in this league');
          setLoading(false);
          loadingRef.current = false;
          return;
        }
        log(' Found user team:', userTeamData.id);
        setUserTeam(userTeamData);

        // Extract and store league scoring settings
        const goalieScoring = currentLeague.scoring_settings?.goalie || {
          wins: 4,
          saves: 0.2,
          shutouts: 3,
          goals_against: -1
        };
        const skaterScoring = currentLeague.scoring_settings?.skater || {
          goals: 3,
          assists: 2,
          power_play_points: 1,
          short_handed_points: 2,
          shots_on_goal: 0.4,
          blocks: 0.5,
          hits: 0.2,
          penalty_minutes: 0.5
        };
        setScoringSettings({
          goalie: {
            wins: goalieScoring.wins ?? 4,
            saves: goalieScoring.saves ?? 0.2,
            shutouts: goalieScoring.shutouts ?? 3,
            goals_against: goalieScoring.goals_against ?? -1
          },
          skater: {
            goals: skaterScoring.goals ?? 3,
            assists: skaterScoring.assists ?? 2,
            power_play_points: skaterScoring.power_play_points ?? 1,
            short_handed_points: skaterScoring.short_handed_points ?? 2,
            shots_on_goal: skaterScoring.shots_on_goal ?? 0.4,
            blocks: skaterScoring.blocks ?? 0.5,
            hits: skaterScoring.hits ?? 0.2,
            penalty_minutes: skaterScoring.penalty_minutes ?? 0.5
          }
        });
        log(' Loaded scoring settings (all 8 categories):', {
          goalie: goalieScoring,
          skater: skaterScoring
        });

        // Calculate first week start date
        const draftCompletionDate = getDraftCompletionDate(currentLeague);
        if (!draftCompletionDate) {
          setError('Could not determine draft completion date');
          setLoading(false);
          return;
        }

        const firstWeek = getFirstWeekStartDate(draftCompletionDate);
        setFirstWeekStart(firstWeek);

        // Get available weeks
        const currentYear = new Date().getFullYear();
        const weeks = getAvailableWeeks(firstWeek, currentYear);
        log(` Calculated ${weeks.length} available weeks:`, weeks);
        setAvailableWeeks(weeks);

        // Determine which week to show (from URL or current week)
        let weekToShow: number;
        if (urlWeekId) {
          weekToShow = parseInt(urlWeekId);
          if (isNaN(weekToShow) || !weeks.includes(weekToShow)) {
            // Invalid week in URL, use current week
            const currentWeek = getCurrentWeekNumber(firstWeek);
            weekToShow = weeks.includes(currentWeek) ? currentWeek : weeks[0] || 1;
            window.location.href = `/matchup/${targetLeagueId}/${weekToShow}`;
            return; // Exit early to prevent further execution
          }
        } else {
          // No week in URL, use current week
          const currentWeek = getCurrentWeekNumber(firstWeek);
          weekToShow = weeks.includes(currentWeek) ? currentWeek : weeks[0] || 1;
          window.location.href = `/matchup/${targetLeagueId}/${weekToShow}`;
          return; // Exit early to prevent further execution
        }

        setSelectedWeek(weekToShow);
        
        // Debug: Log week calculation details
        log(' Week calculation details:', {
          urlWeekId,
          weekToShow,
          weekToShowType: typeof weekToShow,
          firstWeekStart: firstWeek.toISOString(),
          week2StartDate: getWeekStartDate(2, firstWeek).toISOString(),
          week2EndDate: getWeekEndDate(2, firstWeek).toISOString(),
          week2DateLabel: getWeekDateLabel(2, firstWeek),
          availableWeeks: weeks,
          weeksIncludeWeek2: weeks.includes(2)
        });

        // Quick check: Does a matchup exist for this week? If yes, skip generation entirely
        log(' Checking for existing matchup:', {
          leagueId: currentLeague.id,
          userId: user.id,
          weekNumber: weekToShow,
          weekNumberType: typeof weekToShow
        });
        
        const { matchup: existingMatchup } = await MatchupService.getUserMatchup(
          currentLeague.id,
          user.id,
          weekToShow
        );
        
        // Set user's matchup ID for "(Your Matchup)" label
        if (existingMatchup) {
          setUserMatchupId(existingMatchup.id);
        }
        
        log(' Existing matchup check result:', {
          found: !!existingMatchup,
          matchup: existingMatchup ? {
            id: existingMatchup.id,
            week_number: existingMatchup.week_number,
            week_number_type: typeof existingMatchup.week_number,
            team1_id: existingMatchup.team1_id,
            team2_id: existingMatchup.team2_id
          } : null
        });
        
        if (!existingMatchup) {
          // No matchup found for this week - generate all missing weeks
          log(' No matchup found for week', weekToShow, '- generating matchups...');
          const { teams: leagueTeams } = await LeagueService.getLeagueTeams(currentLeague.id);
          
          // Check if ANY matchups exist for this league
          const { data: anyMatchups } = await supabase
            .from('matchups')
            .select('week_number')
            .eq('league_id' as any, currentLeague.id as any)
            .limit(1);
          
          const hasAnyMatchups = anyMatchups && anyMatchups.length > 0;
          
          // If no matchups exist at all, force regenerate ALL weeks
          // Otherwise, generate only missing weeks (which will include this one)
          const forceRegenerate = !hasAnyMatchups;
          
          log(' Generating matchups with forceRegenerate:', forceRegenerate, 'for week:', weekToShow);
          log(' Generation parameters:', {
            leagueId: currentLeague.id,
            teamCount: leagueTeams.length,
            teams: leagueTeams.map(t => ({ id: t.id, name: t.team_name || t.id })),
            firstWeekStart: firstWeek.toISOString(),
            forceRegenerate,
            requestedWeek: weekToShow,
            requestedWeekType: typeof weekToShow
          });
          
          const { error: genError } = await MatchupService.generateMatchupsForLeague(
            currentLeague.id, 
            leagueTeams, 
            firstWeek,
            forceRegenerate
          );
          
          if (genError) {
            console.error('[Matchup] Error generating matchups:', genError);
            setError(`Failed to generate matchups: ${genError.message || 'Unknown error'}`);
            setLoading(false);
            return;
          }
          
          log(' Matchup generation completed successfully');
          
          // Wait longer to ensure database commits complete
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Debug: Check what matchups actually exist in the database BEFORE verification
          const { data: allMatchups, error: checkError } = await supabase
            .from('matchups')
            .select('week_number, team1_id, team2_id, league_id')
            .eq('league_id' as any, currentLeague.id as any)
            .eq('week_number' as any, weekToShow as any);
          
          log(' Debug - All matchups for week', weekToShow, ':', allMatchups);
          
          // Also check ALL weeks in database to see what's actually stored
          const { data: allWeeksMatchups } = await supabase
            .from('matchups')
            .select('week_number')
            .eq('league_id' as any, currentLeague.id as any);
          
          const uniqueWeeks = new Set((allWeeksMatchups as any[])?.map((m: any) => m.week_number) || []);
          log(' Debug - All week numbers in database:', Array.from(uniqueWeeks).sort((a, b) => a - b));
          log(' Debug - Requested week', weekToShow, 'exists in database?', uniqueWeeks.has(weekToShow));
          
          // Also check user's team
          const { data: userTeamData } = await supabase
            .from('teams')
            .select('id, team_name, owner_id')
            .eq('league_id' as any, currentLeague.id as any)
            .eq('owner_id' as any, user.id as any)
            .maybeSingle();
          
          log(' Debug - User team:', userTeamData);
          
          if (allMatchups && allMatchups.length > 0) {
            const matchupsData = allMatchups as any[];
            log(' Debug - Matchups exist but user team not found. User team ID:', (userTeamData as any)?.id);
            log(' Debug - Matchups in week:', matchupsData.map((m: any) => ({
              team1: m.team1_id,
              team2: m.team2_id
            })));
            
            // Check if user's team is in any of these matchups
            const userTeamInMatchups = matchupsData.some((m: any) => 
              m.team1_id === (userTeamData as any)?.id || m.team2_id === (userTeamData as any)?.id
            );
            log(' Debug - User team in matchups?', userTeamInMatchups);
          }
          
          // Verify the matchup was created
          const { matchup: verifyMatchup } = await MatchupService.getUserMatchup(
            currentLeague.id,
            user.id,
            weekToShow
          );
          
          if (!verifyMatchup) {
            console.error('[Matchup] Matchup still not found after generation for week', weekToShow);
            
            // If matchups exist but user's team isn't in them, this is a serious issue - FORCE REGENERATE
            if (allMatchups && allMatchups.length > 0 && userTeamData) {
              const matchupsArr = allMatchups as any[];
              const teamData = userTeamData as any;
              const userTeamInMatchups = matchupsArr.some((m: any) => 
                m.team1_id === teamData.id || m.team2_id === teamData.id
              );
              
              if (!userTeamInMatchups) {
                console.error('[Matchup] CRITICAL: Week', weekToShow, 'has matchups but user team', teamData.id, 'is not in any of them!');
                console.error('[Matchup] FORCING FULL REGENERATION of all matchups...');
                
                // Force delete ALL matchups and regenerate
                await MatchupService.deleteAllMatchupsForLeague(currentLeague.id);
                
                // Get all teams again to ensure we have the complete list
                const { teams: allLeagueTeams } = await LeagueService.getLeagueTeams(currentLeague.id);
                
                // Verify user's team is in the list
                const userTeamInList = allLeagueTeams.some(t => t.id === teamData.id);
                if (!userTeamInList) {
                  console.error('[Matchup] CRITICAL: User team is not in the league teams list!');
                  setError(`Your team (${teamData.id}) is not found in the league teams. This is a data integrity issue.`);
                  setLoading(false);
                  return;
                }
                
                log(' Regenerating ALL matchups with complete team list...');
                const { error: regenError } = await MatchupService.generateMatchupsForLeague(
                  currentLeague.id,
                  allLeagueTeams,
                  firstWeek,
                  true // Force regenerate
                );
                
                if (regenError) {
                  console.error('[Matchup] Error during forced regeneration:', regenError);
                  setError(`Failed to regenerate matchups: ${regenError.message || 'Unknown error'}`);
                  setLoading(false);
                  return;
                }
                
                // Wait for database commits
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // Verify again
                const { matchup: finalMatchup } = await MatchupService.getUserMatchup(
                  currentLeague.id,
                  user.id,
                  weekToShow
                );
                
                if (!finalMatchup) {
                  console.error('[Matchup] Still no matchup after forced regeneration!');
                  setError(`Failed to generate matchup for week ${weekToShow} after forced regeneration. Please refresh and try again.`);
                  setLoading(false);
                  return;
                }
                
                log(' Successfully regenerated and verified matchup exists');
                // Matchup now exists, continue with normal flow below
              } else {
                setError(`No matchup found for week ${weekToShow}. The matchup generation may have failed. Please try refreshing the page.`);
                setLoading(false);
                return;
              }
            } else {
              setError(`No matchup found for week ${weekToShow}. The matchup generation may have failed. Please try refreshing the page.`);
              setLoading(false);
              return;
            }
            
            // If we got here after forced regeneration, the matchup should exist now
            // Re-fetch it to continue with normal flow
            const { matchup: regeneratedMatchup } = await MatchupService.getUserMatchup(
              currentLeague.id,
              user.id,
              weekToShow
            );
            
            if (!regeneratedMatchup) {
              console.error('[Matchup] Matchup still not found after forced regeneration!');
              setError(`Failed to generate matchup for week ${weekToShow} after forced regeneration. Please refresh and try again.`);
              setLoading(false);
              return;
            }
            
            log(' Verified matchup exists after forced regeneration');
          }
          
          log(' Verified matchup exists for week', weekToShow);
        } else {
          log(' Matchup already exists for week', weekToShow, '- skipping generation');
        }

        // Load matchup data using unified method
        // If a specific matchup is selected (from dropdown), load that matchup directly
        // Otherwise, use the user's matchup
        const userTimezone = (profile as any)?.timezone || 'America/Denver';
        let matchupDataPromise: Promise<{ data: any; error: any }>;

        if (selectedMatchupId) {
          // Always try to load the selected matchup, even if not in allWeekMatchups
          // This handles cases where the dropdown was changed but allWeekMatchups hasn't updated yet
          log(' Loading selected matchup from dropdown:', selectedMatchupId);
          matchupDataPromise = MatchupService.getMatchupDataById(
            selectedMatchupId,
            user.id,
            userTimezone
          );
        } else {
          log(' STEP 10: Calling getMatchupData for user matchup', {
            leagueId: targetLeagueId,
            userId: user.id,
            weekNumber: weekToShow,
            timezone: userTimezone,
            hasExistingMatchup: !!existingMatchup
          });
          
          // NOTE: Always load CURRENT roster here - frozen rosters are pre-loaded
          // in parallel and applied via the date-change useEffect
          matchupDataPromise = MatchupService.getMatchupData(
            targetLeagueId,
            user.id,
            weekToShow,
            userTimezone,
            existingMatchup
            // No targetDate - always load current roster, frozen rosters handled separately
          );
        }
        
        const timeoutPromise = new Promise<{ data: null; error: Error }>((resolve) => {
          setTimeout(() => {
            resolve({ data: null, error: new Error('getMatchupData timed out after 20 seconds') });
          }, 20000);
        });
        
        let { data: matchupData, error: matchupError } = await Promise.race([
          matchupDataPromise,
          timeoutPromise
        ]);

        if (matchupError) {
          console.error('[MATCHUP] Error getting matchup data:', matchupError);
          
          // Enhanced error handling for dropdown selections
          if (selectedMatchupId) {
            console.error('[MATCHUP] Failed to load selected matchup from dropdown:', {
              matchupId: selectedMatchupId,
              error: matchupError,
              errorMessage: matchupError?.message || String(matchupError),
              errorDetails: matchupError
            });
            
            // Don't immediately clear selectedMatchupId - try to get more info first
            const errorMessage = matchupError?.message || String(matchupError) || 'Unknown error';
            
            // Check if it's a specific error we can handle
            if (errorMessage.includes('not found') || errorMessage.includes('Matchup not found')) {
              setError(`Matchup not found. The matchup may have been deleted or doesn't exist.`);
            } else if (errorMessage.includes('Viewing team not found')) {
              setError(`Team data not found for this matchup. The matchup may be incomplete.`);
            } else if (errorMessage.includes('League not found')) {
              setError(`League not found. You may not have access to this league.`);
            } else {
              setError(`Failed to load matchup: ${errorMessage}. Please try refreshing the page.`);
            }
            
            setLoading(false);
            loadingRef.current = false;
            return;
          } else {
            // Original error handling for user's matchup
            if (matchupError?.message?.includes('No matchup found') || matchupError?.message?.includes('timed out')) {
              log(' No matchup found or timeout for week', weekToShow);
              setError(`Failed to load matchup for week ${weekToShow}. ${matchupError.message?.includes('timed out') ? 'Request timed out.' : 'Matchup may need to be generated.'} Please try refreshing the page.`);
              setLoading(false);
              loadingRef.current = false;
              return;
            }
            throw matchupError;
          }
        }
        
        if (!matchupData) {
          console.error('[MATCHUP] No matchup data returned', {
            selectedMatchupId,
            weekToShow,
            targetLeagueId,
            error: matchupError
          });
          
          if (selectedMatchupId) {
            // Don't clear selectedMatchupId - show specific error
            setError(`No matchup data available for the selected matchup. This may be because the matchup data is incomplete or the matchup hasn't been fully generated yet.`);
            setLoading(false);
            loadingRef.current = false;
            return;
          } else {
            setError(`No matchup found for week ${weekToShow}`);
            setLoading(false);
            loadingRef.current = false;
            return;
          }
        }
        
        log(' STEP 11: Matchup data loaded successfully');
        
        // Update cache with loaded data (include selectedMatchupId in cache key)
        if (targetLeagueId && weekToShow) {
          loadedMatchupDataRef.current = {
            leagueId: targetLeagueId,
            weekId: String(weekToShow),
            matchupId: selectedMatchupId,
            timestamp: Date.now()
          };
        }

        // Check if this is a playoff week and redirect
        if (matchupData.isPlayoffWeek) {
          window.location.href = `/league/${targetLeagueId}/playoffs`;
          return;
        }

        // Set state from unified data
        setCurrentMatchup(matchupData.matchup);
        setMyTeam(matchupData.userTeam.roster);
        setOpponentTeamPlayers(matchupData.opponentTeam?.roster || []);
        setMyTeamSlotAssignments(matchupData.userTeam.slotAssignments);
        setOpponentTeamSlotAssignments(matchupData.opponentTeam?.slotAssignments || {});
        setMyTeamRecord(matchupData.userTeam.record);
        setOpponentTeamRecord(matchupData.opponentTeam?.record || { wins: 0, losses: 0 });
        setMyDailyPoints(matchupData.userTeam.dailyPoints);
        setOpponentDailyPoints(matchupData.opponentTeam?.dailyPoints || []);
        
        // Frozen roster loading now handled in MatchupService.getMatchupRosters()
        // No duplicate logic needed here
        
        // CRITICAL: Set viewing team names from matchup data (not userTeam state)
        // This ensures correct names are shown when viewing other matchups
        setViewingTeamName(matchupData.userTeam.name);
        setViewingOpponentTeamName(matchupData.opponentTeam?.name || 'Bye Week');

        // Only reset selectedDate when matchup actually changes (not just reloading)
        // Check if we're loading a different matchup than currently displayed
        const isMatchupChange = !previousMatchupId || previousMatchupId !== matchupData.matchup.id;
        if (isMatchupChange) {
          log(' Matchup changed, resetting selectedDate');
          setSelectedDate(null);
          setDailyStatsMap(new Map());
        }
        
        // Set selected matchup ID if not already set
        if (!selectedMatchupId && matchupData.matchup) {
          setSelectedMatchupId(matchupData.matchup.id);
        }
        
        // Track user's actual matchup ID for "(Your Matchup)" label
        // Only set this if user is in this matchup (check if viewing team is user's team)
        if (userTeam && (matchupData.userTeam.id === userTeam.id || matchupData.opponentTeam?.id === userTeam.id)) {
          setUserMatchupId(matchupData.matchup.id);
        }

        // Get opponent team object for display
        if (matchupData.opponentTeam) {
          const { teams } = await LeagueService.getLeagueTeams(targetLeagueId);
          const oppTeam = teams.find(t => t.id === matchupData.opponentTeam!.id);
          setOpponentTeam(oppTeam || null);
        } else {
          setOpponentTeam(null);
        }

        // ============================================================
        // PRE-LOAD ALL ROSTERS FOR THE WEEK (Yahoo/Sleeper style)
        // This enables instant date switching without API calls
        // Each day can have its own unique roster (date-specific saves)
        // ============================================================
        
        // Store base current roster (fallback if no saved roster for a date)
        setBaseCurrentRoster({
          myRoster: matchupData.userTeam.roster,
          oppRoster: matchupData.opponentTeam?.roster || [],
          mySlots: matchupData.userTeam.slotAssignments,
          oppSlots: matchupData.opponentTeam?.slotAssignments || {}
        });
        
        // Generate all week dates (Mon-Sun)
        const weekStart = new Date(matchupData.matchup.week_start_date + 'T00:00:00');
        const weekDates: string[] = [];
        for (let i = 0; i < 7; i++) {
          const date = new Date(weekStart);
          date.setDate(weekStart.getDate() + i);
          weekDates.push(date.toISOString().split('T')[0]);
        }
        
        // ============================================================
        // PRE-LOAD ROSTERS FOR ALL DATES (PAST AND FUTURE)
        // Yahoo/Sleeper style: each day can have its own unique roster
        // Future dates may have been explicitly set by the user
        // ============================================================
        const todayStr = getTodayMST();
        // Load ALL dates, not just past - future dates may have custom rosters
        const datesToLoad = weekDates; // Changed from pastDates to ALL dates
        
        if (datesToLoad.length > 0) {
          log(' Pre-loading rosters for ALL week dates:', datesToLoad);
          
          // Create lookup maps from enriched roster players
          const enrichedMyPlayerMap = new Map<string, MatchupPlayer>();
          const enrichedOppPlayerMap = new Map<string, MatchupPlayer>();
          
          matchupData.userTeam.roster.forEach(p => {
            enrichedMyPlayerMap.set(String(p.id), p);
          });
          (matchupData.opponentTeam?.roster || []).forEach(p => {
            enrichedOppPlayerMap.set(String(p.id), p);
          });
          
          log(' Initial enriched player lookup maps:', {
            myPlayers: enrichedMyPlayerMap.size,
            oppPlayers: enrichedOppPlayerMap.size
          });
          
          // ============================================================
          // HANDLE DROPPED/TRADED PLAYERS (Yahoo/Sleeper behavior)
          // Fetch any players in saved rosters who are no longer on the team
          // Query ALL dates (past and future) since future dates may have custom rosters
          // ============================================================
          const { data: allFrozenEntries } = await supabase
            .from('fantasy_daily_rosters')
            .select('player_id, team_id')
            .eq('matchup_id' as any, matchupData.matchup.id)
            .in('roster_date' as any, datesToLoad as any);
          
          if (allFrozenEntries && allFrozenEntries.length > 0) {
            // Get all current player IDs
            const currentMyIds = new Set(matchupData.userTeam.roster.map(p => String(p.id)));
            const currentOppIds = new Set((matchupData.opponentTeam?.roster || []).map(p => String(p.id)));
            const allCurrentIds = new Set([...currentMyIds, ...currentOppIds]);
            
            // Find player IDs that are in frozen rosters but NOT in current rosters
            const missingIds = [...new Set(
              (allFrozenEntries as any)
                .map((e: any) => String(e.player_id))
                .filter((id: string) => !allCurrentIds.has(id))
            )];
            
            if (missingIds.length > 0) {
              log(' Found dropped/traded players in frozen rosters:', missingIds);
              
              // Fetch missing players
              const missingPlayers = await PlayerService.getPlayersByIds(missingIds as string[]);
              log(' Fetched', missingPlayers.length, 'dropped/traded players');
              
              // Transform to MatchupPlayer and add to appropriate lookup map
              missingPlayers.forEach(player => {
                // Determine which team this player was on based on frozen roster entries
                const playerEntries = (allFrozenEntries as any).filter((e: any) => String(e.player_id) === String(player.id));
                const wasOnMyTeam = playerEntries.some((e: any) => String(e.team_id) === matchupData.userTeam.id);
                const wasOnOppTeam = playerEntries.some((e: any) => String(e.team_id) === matchupData.opponentTeam?.id);
                
                // Create basic MatchupPlayer from Player data
                const p = player as any;
                const matchupPlayer: MatchupPlayer = {
                  id: p.id as number,
                  name: p.full_name || p.name || '',
                  position: p.position,
                  team: p.team || '',
                  teamAbbreviation: p.team_abbreviation || p.team || '',
                  points: p.fantasy_points || 0,
                  total_points: p.fantasy_points || 0,
                  headshot_url: p.headshot_url,
                  isStarter: false,
                  isOnIR: p.status === 'IR' || p.status === 'SUSP',
                  stats: { goals: 0, assists: 0, sog: 0, blk: 0, xGoals: 0 },
                  matchupStats: { goals: 0, assists: 0, sog: 0, blk: 0, xGoals: 0 },
                  games: [],
                  gamesRemaining: 0,
                  isGoalie: p.position === 'G',
                  status: (p.status || null) as any,
                  wasDropped: true
                } as MatchupPlayer;
                
                if (wasOnMyTeam) {
                  enrichedMyPlayerMap.set(String(player.id), matchupPlayer);
                }
                if (wasOnOppTeam) {
                  enrichedOppPlayerMap.set(String(player.id), matchupPlayer);
                }
              });
              
              log(' Updated enriched player lookup maps after adding dropped players:', {
                myPlayers: enrichedMyPlayerMap.size,
                oppPlayers: enrichedOppPlayerMap.size
              });
            }
          }
          
          // Load frozen lineups (just player IDs and slot assignments)
          const frozenMap = new Map<string, {
            myRoster: MatchupPlayer[];
            oppRoster: MatchupPlayer[];
            mySlots: Record<string, string>;
            oppSlots: Record<string, string>;
          }>();
          
          // Load all saved lineups in parallel (past AND future dates)
          const frozenLoadPromises = datesToLoad.map(async (date) => {
            try {
              // Query fantasy_daily_rosters directly for lineup info
              const { data: myDailyRoster } = await supabase
                .from('fantasy_daily_rosters')
                .select('player_id, slot_type, slot_id')
                .eq('team_id' as any, matchupData.userTeam.id as any)
                .eq('matchup_id' as any, matchupData.matchup.id as any)
                .eq('roster_date' as any, date as any);
              
              const { data: oppDailyRoster } = matchupData.opponentTeam ? await supabase
                .from('fantasy_daily_rosters')
                .select('player_id, slot_type, slot_id')
                .eq('team_id' as any, matchupData.opponentTeam.id as any)
                .eq('matchup_id' as any, matchupData.matchup.id as any)
                .eq('roster_date' as any, date as any) : { data: null };
              
              if (!myDailyRoster || myDailyRoster.length === 0) {
                log(` No frozen roster found for ${date}`);
                return null;
              }
              
              // Build frozen roster using enriched players
              const myRoster: MatchupPlayer[] = [];
              const mySlots: Record<string, string> = {};
              
              myDailyRoster.forEach((entry: any) => {
                const playerId = String(entry.player_id);
                const enrichedPlayer = enrichedMyPlayerMap.get(playerId);
                
                if (enrichedPlayer) {
                  // Use enriched player with updated isStarter flag
                  const isStarter = entry.slot_type === 'active';
                  myRoster.push({
                    ...enrichedPlayer,
                    isStarter
                  } as MatchupPlayer);
                  if (entry.slot_id) {
                    mySlots[playerId] = entry.slot_id;
                  }
                } else {
                  log(`WARN: Player ${playerId} not found in enriched map for date ${date}`);
                }
              });
              
              // Build opponent frozen roster
              const oppRoster: MatchupPlayer[] = [];
              const oppSlots: Record<string, string> = {};
              
              if (oppDailyRoster) {
                oppDailyRoster.forEach((entry: any) => {
                  const playerId = String(entry.player_id);
                  const enrichedPlayer = enrichedOppPlayerMap.get(playerId);
                  
                  if (enrichedPlayer) {
                    const isStarter = entry.slot_type === 'active';
                    oppRoster.push({
                      ...enrichedPlayer,
                      isStarter
                    } as MatchupPlayer);
                    if (entry.slot_id) {
                      oppSlots[playerId] = entry.slot_id;
                    }
                  }
                });
              }
              
              return {
                date,
                data: { myRoster, oppRoster, mySlots, oppSlots }
              };
            } catch (error) {
              console.error(`[MATCHUP] Error loading frozen roster for ${date}:`, error);
              return null;
            }
          });
          
          const results = await Promise.all(frozenLoadPromises);
          
          results.forEach(result => {
            if (result) {
              frozenMap.set(result.date, result.data);
            }
          });
          
          setFrozenRostersByDate(frozenMap);
          log(` Pre-loaded ${frozenMap.size} saved rosters for week (Yahoo/Sleeper style)`);
        } else {
          log(' No week dates to load rosters for');
          setFrozenRostersByDate(new Map());
        }

      } catch (err: any) {
        console.error('[MATCHUP] CRITICAL ERROR loading matchup data:', err);
        console.error('[MATCHUP] Error details:', {
          message: err.message,
          stack: err.stack,
          name: err.name
        });
        
        // Always set error so user sees something - don't hide errors
        const errorMessage = err.message || 'Failed to load matchup data';
        setError(errorMessage);
        
        // Log if it's a timeout for debugging
        if (errorMessage.includes('timeout')) {
          console.error('[MATCHUP] TIMEOUT ERROR - Query took too long');
        }
      } finally {
        // CRITICAL: Always clear timeout and reset state, even if error occurred
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        log(' Finally block - clearing loading state');
        setLoading(false); // Always complete loading
        hasInitializedRef.current = true; // Mark that initial load is complete
        loadingRef.current = false; // Release lock - CRITICAL to prevent freeze
      }
    };

    loadMatchupData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // CRITICAL: selectedDate is NOT in this dependency array
    // Date changes are handled by a separate useEffect that uses frozenRostersByDate
    // This prevents full reload on every date click
  }, [user?.id, userLeagueState, urlLeagueId, urlWeekId, selectedMatchupId]);

  // ============================================================
  // DATE CHANGE HANDLER - Uses pre-loaded rosters for ALL dates
  // Yahoo/Sleeper style: each day can have its own unique roster
  // NO API calls - instant roster switching from local state
  // Smooth transitions: preserve previous roster during switch
  // ============================================================
  useEffect(() => {
    // If no date selected, nothing to do
    if (!selectedDate) {
      return;
    }
    
    // Store current roster as previous before switching
    if (myTeam.length > 0 || opponentTeamPlayers.length > 0) {
      previousRosterRef.current = {
        myTeam: [...myTeam],
        oppTeam: [...opponentTeamPlayers]
      };
    }
    
    // Set switching state to show smooth transition
    setIsSwitchingDate(true);
    
    // Use requestAnimationFrame to ensure smooth transition
    requestAnimationFrame(() => {
      // First, check if we have a saved roster for this date (past OR future)
      const savedRoster = frozenRostersByDate.get(selectedDate);
      
      if (savedRoster && savedRoster.myRoster.length > 0) {
        // Use the saved roster for this specific date
        log('DATE-HANDLER Using saved roster for date:', selectedDate, {
          myRosterSize: savedRoster.myRoster.length,
          oppRosterSize: savedRoster.oppRoster.length
        });
        setMyTeam(savedRoster.myRoster);
        setOpponentTeamPlayers(savedRoster.oppRoster);
        setMyTeamSlotAssignments(savedRoster.mySlots);
        setOpponentTeamSlotAssignments(savedRoster.oppSlots);
      } else if (baseCurrentRoster && baseCurrentRoster.myRoster.length > 0) {
        // No saved roster for this date - use base current roster as fallback
        log('DATE-HANDLER No saved roster for date:', selectedDate, '- using base roster');
        setMyTeam(baseCurrentRoster.myRoster);
        setOpponentTeamPlayers(baseCurrentRoster.oppRoster);
        setMyTeamSlotAssignments(baseCurrentRoster.mySlots);
        setOpponentTeamSlotAssignments(baseCurrentRoster.oppSlots);
      } else {
        log('WARN: DATE-HANDLER No roster data available for date:', selectedDate);
      }
      
      // Clear switching state after a brief delay to allow render
      setTimeout(() => {
        setIsSwitchingDate(false);
      }, 50);
    });
  }, [selectedDate, frozenRostersByDate, baseCurrentRoster, myTeam, opponentTeamPlayers]);

  // Refresh matchup when page becomes visible (e.g., navigating back from roster page)
  useEffect(() => {
    if (!user?.id || !league?.id || !userTeam?.id || !urlLeagueId || !urlWeekId) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !loadingRef.current) {
        // Page became visible - clear cache and reload by triggering URL change
        log(' Page visible, refreshing matchup data...');
        MatchupService.clearRosterCache(userTeam.id, league.id);
        // Use window.location to avoid React Router navigation loops
        window.location.href = `/matchup/${urlLeagueId}/${urlWeekId}`;
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, league?.id, userTeam?.id, urlLeagueId, urlWeekId]);

  // =============================================================================
  // CONSOLIDATED REFRESH EFFECT - Handles both score updates and live game stats
  // - Fast refresh (45s) when games are live
  // - Slow refresh (5min) for score updates when no live games
  // =============================================================================
  const liveRefreshSetupRef = useRef(false);
  
  useEffect(() => {
    if (!league?.id || userLeagueState !== 'active-user') return;
    if (!currentMatchup) return;
    
    // Check if today is within this matchup's week
    const todayStr = getTodayMST();
    const isWithinMatchupWeek = todayStr >= currentMatchup.week_start_date && todayStr <= currentMatchup.week_end_date;
    
    if (!isWithinMatchupWeek) {
      log(' Today is not within matchup week, skipping live refresh');
      liveRefreshSetupRef.current = false;
      return;
    }
    
    // Prevent setting up multiple intervals - only set up once per matchup
    if (liveRefreshSetupRef.current) {
      log(' Live refresh already set up, skipping duplicate setup');
      return;
    }
    liveRefreshSetupRef.current = true;
    
    log(' Today is within matchup week, starting consolidated refresh...');
    
    // Function to update matchup scores in database
    const updateMatchupScores = async () => {
      if (currentMatchup.status !== 'in_progress') return;
      try {
        await MatchupService.updateMatchupScores(league.id);
      } catch (error) {
        // Non-blocking - don't stop refresh cycle
      }
    };
    
    // Function to refresh game statuses from DB and update player.games arrays
    // Uses functional state updates to avoid stale closure issues
    const refreshGameStatuses = async () => {
      try {
        // Get teams from current state using functional pattern
        // This avoids stale closure issues with myStarters/opponentStarters
        let allTeamsArray: string[] = [];
        setMyTeam(prev => {
          prev.forEach(p => {
            const team = ((p as any).teamAbbreviation || p.team || '').toUpperCase();
            if (team && !allTeamsArray.includes(team)) allTeamsArray.push(team);
          });
          return prev; // Don't modify state, just read it
        });
        setOpponentTeamPlayers(prev => {
          prev.forEach(p => {
            const team = ((p as any).teamAbbreviation || p.team || '').toUpperCase();
            if (team && !allTeamsArray.includes(team)) allTeamsArray.push(team);
          });
          return prev; // Don't modify state, just read it
        });
        
        // Small delay to ensure state reads complete
        await new Promise(resolve => setTimeout(resolve, 10));
        
        if (allTeamsArray.length === 0) {
          log(' No teams to refresh');
          return;
        }
        
        log(` Refreshing game statuses for ${allTeamsArray.length} teams: ${allTeamsArray.join(', ')}`);
        log(` Looking for games on: ${todayStr}`);
        
        // Use MST-aware date to avoid timezone issues
        // CRITICAL: new Date() + toISOString() can give wrong date if it's late evening in MST
        const todayDate = getTodayMSTDate();
        const { gamesByTeam } = await ScheduleService.getGamesForTeams(allTeamsArray, todayDate, todayDate);
        
        if (!gamesByTeam || gamesByTeam.size === 0) {
          log('WARN: No games found for today from ScheduleService');
          return;
        }
        
        // Log what we got - be verbose for debugging
        let liveCount = 0;
        let totalGames = 0;
        gamesByTeam.forEach((games, team) => {
          games.forEach(g => {
            totalGames++;
            const gameDate = g.game_date?.split('T')[0] || g.game_date;
            const matchesToday = gameDate === todayStr;
            log(` Game: ${g.away_team} @ ${g.home_team} | date: ${gameDate} | status: ${g.status} | matchesToday: ${matchesToday}`);
            const statusLower = (g.status || '').toLowerCase();
            if (statusLower === 'live' || statusLower === 'intermission' || statusLower === 'crit') {
              liveCount++;
              log(` 🔴 LIVE: ${g.away_team} @ ${g.home_team} (${g.period || 'no period'} ${g.period_time || ''})`);
            }
          });
        });
        log(` Found ${totalGames} total games, ${liveCount} live/intermission from DB`);
        
        // Create a map of team -> latest game for today
        // Handle both 'YYYY-MM-DD' and 'YYYY-MM-DDTHH:MM:SS' formats
        const gameStatusByTeam = new Map<string, any>();
        gamesByTeam.forEach((games, team) => {
          const todayGame = games.find(g => {
            const gameDate = g.game_date?.split('T')[0] || g.game_date;
            return gameDate === todayStr;
          });
          if (todayGame) {
            gameStatusByTeam.set(team.toUpperCase(), todayGame);
            log(` Team ${team} has game today: ${todayGame.status}`);
          }
        });
        
        // Update myTeam players' games array with fresh status
        setMyTeam(prev => prev.map(player => {
          const teamAbbr = ((player as any).teamAbbreviation || player.team || '').toUpperCase();
          if (!teamAbbr) return player;
          
          const freshGame = gameStatusByTeam.get(teamAbbr);
          if (!freshGame) return player;
          
          // If player has no games array, create one
          if (!player.games || !Array.isArray(player.games)) {
            return { ...player, games: [freshGame] };
          }
          
          // Update the games array with fresh status
          const updatedGames = player.games.map(g => {
            if (g.game_date?.split('T')[0] === todayStr) {
              return { ...g, status: freshGame.status, home_score: freshGame.home_score, away_score: freshGame.away_score, period: freshGame.period, period_time: freshGame.period_time };
            }
            return g;
          });
          
          return { ...player, games: updatedGames };
        }));
        
        // Same for opponent team
        setOpponentTeamPlayers(prev => prev.map(player => {
          const teamAbbr = ((player as any).teamAbbreviation || player.team || '').toUpperCase();
          if (!teamAbbr) return player;
          
          const freshGame = gameStatusByTeam.get(teamAbbr);
          if (!freshGame) return player;
          
          if (!player.games || !Array.isArray(player.games)) {
            return { ...player, games: [freshGame] };
          }
          
          const updatedGames = player.games.map(g => {
            if (g.game_date?.split('T')[0] === todayStr) {
              return { ...g, status: freshGame.status, home_score: freshGame.home_score, away_score: freshGame.away_score, period: freshGame.period, period_time: freshGame.period_time };
            }
            return g;
          });
          
          return { ...player, games: updatedGames };
        }));
        
        log(' ✅ Game statuses refreshed successfully');
      } catch (err) {
        console.error('[Matchup] ❌ Error refreshing game statuses:', err);
      }
    };
    
    // Refresh stats, game statuses, AND matchup scores immediately
    Promise.all([
      fetchAllDailyStats(),
      refreshGameStatuses(),
      updateMatchupScores()
    ]).catch(() => { /* non-blocking */ });
    
    // Refresh every 45 seconds during live games (slightly longer than backend 30s updates)
    // Also updates matchup scores periodically (was separate 5-min interval, now consolidated)
    const intervalId = setInterval(() => {
      Promise.all([
        fetchAllDailyStats(),
        refreshGameStatuses(),
        updateMatchupScores()
      ]).catch(() => { /* non-blocking */ });
    }, 45000); // 45 seconds
    
    return () => {
      clearInterval(intervalId);
      liveRefreshSetupRef.current = false;
      log(' Stopped live stats refresh (no live games or matchup ended)');
    };
    // CRITICAL: Do NOT include myStarters/opponentStarters in deps - it creates infinite loop
    // The refreshGameStatuses function uses functional state updates to get current state
  }, [league?.id, currentMatchup?.id, currentMatchup?.week_start_date, currentMatchup?.week_end_date, currentMatchup?.status, userLeagueState, fetchAllDailyStats]);


  // Handle week selection - updates URL which triggers data reload
  // Works for both logged-in users and guests
  const handleWeekChange = useCallback((weekNumber: number) => {
    // Determine league ID based on user state
    const leagueId = (userLeagueState === 'guest' || userLeagueState === 'logged-in-no-league')
      ? DEMO_LEAGUE_ID_FOR_GUESTS
      : league?.id;
    
    if (!leagueId) return;
    
    // Use window.location to avoid React Router navigation loops
    window.location.href = `/matchup/${leagueId}/${weekNumber}`;
  }, [userLeagueState, league?.id]);
  
  // Refresh matchup data (useful after making lineup changes on roster page)
  const refreshMatchup = useCallback(() => {
    if (!league?.id || !userTeam?.id || !urlLeagueId || !urlWeekId) return;
    // Clear all caches to force fresh data
    MatchupService.clearRosterCache();
    // Use window.location to avoid React Router navigation loops
    window.location.href = `/matchup/${urlLeagueId}/${urlWeekId}`;
  }, [league?.id, userTeam?.id, urlLeagueId, urlWeekId]);

  // Debug: Log render state (using ref counter to prevent spam)
  // MUST be declared before early return to maintain hook order
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;
  if (renderCountRef.current <= 3) { // Only log first 3 renders
    log(' Component rendering', {
      renderCount: renderCountRef.current,
      loading,
      error,
      userLeagueState,
      hasMyTeam: myTeam.length > 0,
      hasOpponentTeam: opponentTeamPlayers.length > 0
    });
  }

  // =============================================================================
  // SIMPLIFIED LOADING STATE - One-way gate prevents flash/cycling
  // =============================================================================
  // Simple rule: Show loading until we have everything needed to render
  // Once we transition to "ready", we NEVER go back to loading (prevents flash)
  const actualLoading = useMemo(() => {
    // Already completed initial load? Never show loading again
    if (hasInitializedRef.current) {
      return false;
    }
    
    // Still determining user state? Show loading
    if (authLoading || leagueContextLoading || userLeagueState === undefined || userLeagueState === null) {
      return true;
    }
    
    // Component still loading data? Show loading
    if (loading) {
      return true;
    }
    
    // For "no league" state, only hide loading once we've processed it
    // This ensures a smooth transition instead of instant render
    if (userLeagueState === 'logged-in-no-league') {
      // Mark as initialized so we don't show loading again
      if (!hasInitializedRef.current) {
        hasInitializedRef.current = true;
      }
      return false;
    }
    
    // For active users and guests, ensure we have data before hiding loading
    // This prevents showing empty UI while data is being fetched
    const hasData = userLeagueState === 'guest' 
      ? (demoMyTeam.length > 0 || demoOpponentTeam.length > 0)
      : (myTeam.length > 0 || opponentTeamPlayers.length > 0);
    
    if (!hasData && !error) {
      // Still waiting for data - keep showing loading
      return true;
    }
    
    // All conditions met - ready to show content
    // Mark as initialized so we don't show loading again
    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true;
    }
    return false;
  }, [authLoading, leagueContextLoading, loading, userLeagueState, myTeam.length, opponentTeamPlayers.length, demoMyTeam.length, demoOpponentTeam.length, error]);

  // Apply minimum display time (1000ms) to prevent jarring flash effect
  // This ensures a single, smooth loading screen without cycling
  const shouldShowLoading = useMinimumLoadingTime(actualLoading, 1000);
  
  // Early return for loading - must be after all hooks are declared
  if (shouldShowLoading) {
    return (
      <LoadingScreen
        character="kiwi"
        message="Loading matchup..."
      />
    );
  }

  return (
    <div className="min-h-screen bg-background relative overflow-hidden w-full">
      {/* Decorative elements to match Home page */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-[hsl(var(--vibrant-yellow))] rounded-full opacity-10 blur-3xl -z-10"></div>
      <div className="absolute bottom-0 left-0 w-96 h-96 bg-[hsl(var(--vibrant-green))] rounded-full opacity-10 blur-3xl -z-10"></div>

      <Navbar />
      <main className="w-full pt-28 pb-16 m-0 p-0">
        <div className="w-full m-0 p-0">
          {/* Sidebar, Content, and Notifications Grid - Sidebar at bottom on mobile, left on desktop; Notifications on right on desktop */}
          <div className="flex flex-col lg:grid lg:grid-cols-[240px_1fr_300px] gap-6 lg:gap-8">
            {/* Main Content - Scrollable - Full Width - Appears first on mobile */}
            <div className="min-w-0 max-h-[calc(100vh-12rem)] overflow-y-auto px-2 lg:px-4 order-1 lg:order-2">
              {/* Header Section - Clean and Professional with Citrus Colors */}
              <div className="mb-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
                  {/* Week Selector - Show for both active users AND guests (the correct toggle!) */}
                  {(userLeagueState === 'active-user' || userLeagueState === 'guest' || userLeagueState === 'logged-in-no-league') && 
                   availableWeeks.length > 0 && 
                   firstWeekStart && (
                    <MatchupScheduleSelector
                      currentWeek={selectedWeek}
                      scheduleLength={availableWeeks.length}
                      availableWeeks={availableWeeks}
                      onWeekChange={handleWeekChange}
                      firstWeekStart={firstWeekStart}
                    />
                  )}
                  {/* Matchup Viewer Dropdown - Show all matchups for current week */}
                  {userLeagueState === 'active-user' && allWeekMatchups.length > 0 && (
                    <div className="flex items-center gap-2">
                      <label className="text-sm font-medium text-muted-foreground">View Matchup:</label>
                      <Select
                        value={selectedMatchupId || currentMatchup?.id || ''}
                        onValueChange={async (value) => {
                          log(' Dropdown changed to:', value);
                          // CRITICAL: Clear cache when dropdown changes to force fresh load
                          loadedMatchupDataRef.current = null;
                          setSelectedMatchupId(value);
                          // Reset selected date when switching matchups
                          setSelectedDate(null);
                          // Force reload by clearing current matchup state
                          setCurrentMatchup(null);
                          setMyTeam([]);
                          setOpponentTeamPlayers([]);
                          setLoading(true);
                          // The useEffect will pick up the selectedMatchupId change and reload
                        }}
                      >
                        <SelectTrigger className="w-[280px]">
                          <SelectValue placeholder="Select a matchup" />
                        </SelectTrigger>
                        <SelectContent>
                          {allWeekMatchups.map((matchup) => {
                            const team1Name = matchup.team1_name || 'Unknown';
                            const team2Name = matchup.team2_name || 'Bye Week';
                            const team1Score = parseFloat(String(matchup.team1_score)) || 0;
                            const team2Score = matchup.team2_id ? (parseFloat(String(matchup.team2_score)) || 0) : 0;
                            const isBye = !matchup.team2_id;
                            // CRITICAL: Compare against user's actual matchup ID, not currentMatchup
                            // This ensures "(Your Matchup)" only shows for the user's actual matchup
                            const isUserMatchup = matchup.id === userMatchupId;
                            
                            // Debug logging: Compare dropdown scores vs matchup tab scores
                            if (isUserMatchup && currentMatchup) {
                              const tabTeam1Score = parseFloat(myTeamPoints) || 0;
                              const tabTeam2Score = parseFloat(opponentTeamPoints) || 0;
                              const scoresMatch = Math.abs(tabTeam1Score - team1Score) < 0.1 && 
                                                  Math.abs(tabTeam2Score - team2Score) < 0.1;
                              
                              if (!scoresMatch) {
                                log('WARN: Dropdown score vs Tab score mismatch:', {
                                  matchup_id: matchup.id,
                                  dropdown_team1: team1Score,
                                  dropdown_team2: team2Score,
                                  tab_team1: tabTeam1Score,
                                  tab_team2: tabTeam2Score,
                                  match: scoresMatch,
                                  note: 'Dropdown reads from database, tab calculates on frontend. They should match after score update.'
                                });
                              } else {
                                log(' Dropdown score vs Tab score match:', {
                                  matchup_id: matchup.id,
                                  team1: team1Score,
                                  team2: team2Score
                                });
                              }
                            }
                            
                            return (
                              <SelectItem key={matchup.id} value={matchup.id}>
                                <span className={isUserMatchup ? 'font-semibold' : ''}>
                                  {team1Name} vs {team2Name}
                                  {isUserMatchup && ' (Your Matchup)'}
                                </span>
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              </div>
          
          {/* Error State - Only show if fully initialized and NOT loading (prevents flash during demo load) */}
          {!loading && hasInitializedRef.current && !shouldShowLoading && error && (
            <div className="text-center py-20">
              <p className="text-destructive text-lg mb-4">{error}</p>
              <Button onClick={() => window.location.reload()}>Retry</Button>
            </div>
          )}
          
          {/* No League State - Show immediately when detected, don't wait for loading */}
          {/* CRITICAL: Show this even if loading is true, to prevent frozen UI */}
          {userLeagueState === 'logged-in-no-league' && (
            <div className="py-12" style={{ pointerEvents: 'auto' }}>
              <LeagueCreationCTA 
                title="Your Matchup Awaits"
                description="Create your league to start competing in weekly matchups, track your team's performance, and climb the standings."
              />
            </div>
          )}

          {/* Main Content - Show if no error and data is available */}
          {/* CRITICAL: Show matchup UI if currentMatchup exists, even if teams are still loading */}
          {/* This prevents "No matchup data" from showing when data is being loaded */}
          {!loading && !error && currentMatchup && (
            (userLeagueState === 'guest' && (demoMyTeam.length > 0 || demoOpponentTeam.length > 0)) ||
            (userLeagueState === 'active-user' && (myTeam.length > 0 || opponentTeamPlayers.length > 0)) ||
            (userLeagueState === 'logged-in-no-league' && (demoMyTeam.length > 0 || demoOpponentTeam.length > 0))
          ) && (
            <>
          
          <ScoreCard
            myTeamName={userLeagueState === 'active-user' ? (viewingTeamName || userTeam?.team_name || 'My Team') : 'Citrus Crushers'}
            myTeamRecord={userLeagueState === 'active-user' ? myTeamRecord : { wins: 7, losses: 3 }}
            opponentTeamName={userLeagueState === 'active-user' ? (viewingOpponentTeamName || opponentTeam?.team_name || 'Bye Week') : 'Thunder Titans'}
            opponentTeamRecord={userLeagueState === 'active-user' ? opponentTeamRecord : { wins: 9, losses: 1 }}
            myTeamPoints={myTeamPoints}
            opponentTeamPoints={opponentTeamPoints}
          />
          
          {/* Weekly Schedule - Show for both active users AND guests (the weekly date selector they love!) */}
          {currentMatchup && (
            <div className="mb-6">
              <WeeklySchedule
                weekStart={currentMatchup.week_start_date}
                weekEnd={currentMatchup.week_end_date}
                myStarters={myStarters}
                opponentStarters={opponentStarters}
                onDayClick={setSelectedDate}
                selectedDate={selectedDate}
                dailyStatsByDate={dailyStatsByDate}
                team1Name={userLeagueState === 'active-user' ? (viewingTeamName || undefined) : 'Citrus Crushers'}
                team2Name={userLeagueState === 'active-user' ? (viewingOpponentTeamName || undefined) : 'Thunder Titans'}
                cachedDailyScores={cachedDailyScores}
              />
            </div>
          )}

          {/* Main Lineup View */}
          <div className="mt-6 matchup-wrapper" style={{ boxSizing: 'border-box', padding: 0, margin: 0 }}>
            {userLeagueState === 'logged-in-no-league' ? (
              <div className="grid gap-6 lg:gap-8 matchup-grid" style={{ gridTemplateColumns: '1fr 1fr', width: '100%', display: 'grid', boxSizing: 'border-box', margin: 0, padding: 0 }}>
                <LeagueCreationCTA 
                  title="Your Team Here"
                  description="Create your league to start building your roster and competing in matchups."
                  variant="compact"
                />
                <LeagueCreationCTA 
                  title="Opponent Team"
                  description="Create your league to see your matchups and compete against other teams."
                  variant="compact"
                />
              </div>
            ) : (
              <>
                {/* Always show full lineup, with daily stats when a day is selected */}
                <MatchupComparison
                  userStarters={displayStarters}
                  opponentStarters={displayOpponentStarters}
                  userBench={myBench}
                  opponentBench={opponentBench}
                  userSlotAssignments={displayMyTeamSlotAssignments}
                  opponentSlotAssignments={displayOpponentTeamSlotAssignments}
                  onPlayerClick={handlePlayerClick}
                  selectedDate={selectedDate}
                />
              </>
            )}
          </div>
          
          <LiveUpdates updates={updates} />
            </>
          )}
          
          {/* Fallback: If nothing else rendered, show a message */}
          {/* CRITICAL: Only show "No matchup data" if currentMatchup is null AND teams are empty */}
          {/* If currentMatchup exists but teams are empty, it means data is still loading - don't show error */}
          {!loading && !error && 
           !currentMatchup &&
           !(userLeagueState === 'guest' && (demoMyTeam.length > 0 || demoOpponentTeam.length > 0)) &&
           !(userLeagueState === 'active-user' && (myTeam.length > 0 || opponentTeamPlayers.length > 0)) &&
           !(userLeagueState === 'logged-in-no-league' && (demoMyTeam.length > 0 || demoOpponentTeam.length > 0)) &&
           userLeagueState !== 'logged-in-no-league' && (
            <div className="text-center py-20">
              <p className="text-muted-foreground mb-4">No matchup data available.</p>
              <p className="text-sm text-muted-foreground mb-4">This may be because:</p>
              <ul className="text-sm text-muted-foreground mb-4 text-left max-w-md mx-auto">
                <li>• The matchup hasn't been generated yet</li>
                <li>• You don't have a team in this league</li>
                <li>• The draft hasn't been completed</li>
              </ul>
              <div className="space-x-2">
                <Button 
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    window.location.href = '/';
                  }}
                  variant="outline"
                >
                  Go Home
                </Button>
                <Button 
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (urlLeagueId) {
                      window.location.href = `/league/${urlLeagueId}`;
                    } else {
                      window.location.reload();
                    }
                  }}
                >
                  {urlLeagueId ? 'View League' : 'Refresh'}
                </Button>
              </div>
            </div>
          )}
            </div>

            {/* Sidebar - At bottom on mobile, left on desktop - World-Class Ad Space */}
            <aside className="w-full lg:w-auto order-2 lg:order-1">
              <div className="lg:sticky lg:top-32 space-y-4 lg:space-y-6">
                {/* Matchup Options Section */}
                <div className="bg-card border rounded-lg p-4 shadow-sm">
                  <h3 className="text-sm font-semibold mb-3 text-foreground">Matchup Options</h3>
                  <div className="space-y-2">
                    <button className="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors">
                      View Full Stats
                    </button>
                    <button className="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors">
                      Compare Teams
                    </button>
                    <button className="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors">
                      Export Matchup
                    </button>
                  </div>
                </div>

                {/* Ad Placeholder 1 - Mobile Optimized */}
                <div className="bg-muted/30 border border-dashed border-muted-foreground/20 rounded-lg p-6 flex flex-col items-center justify-center min-h-[180px] lg:min-h-[200px]">
                  <div className="text-muted-foreground text-xs text-center space-y-2">
                    <div className="w-12 h-12 mx-auto bg-muted rounded flex items-center justify-center mb-2">
                      <span className="text-2xl">📢</span>
                    </div>
                    <p className="font-medium">Ad Space</p>
                    <p className="text-xs opacity-70">300x250</p>
                  </div>
                </div>

                {/* Quick Stats Placeholder */}
                <div className="bg-card border rounded-lg p-4 shadow-sm">
                  <h3 className="text-sm font-semibold mb-3 text-foreground">Quick Stats</h3>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Projected</span>
                      <span className="font-semibold">142.5</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Best Player</span>
                      <span className="font-semibold">Connor McDavid</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Matchup %</span>
                      <span className="font-semibold text-primary">52%</span>
                    </div>
                  </div>
                </div>

                {/* Ad Placeholder 2 - Mobile Optimized */}
                <div className="bg-muted/30 border border-dashed border-muted-foreground/20 rounded-lg p-6 flex flex-col items-center justify-center min-h-[180px] lg:min-h-[200px]">
                  <div className="text-muted-foreground text-xs text-center space-y-2">
                    <div className="w-12 h-12 mx-auto bg-muted rounded flex items-center justify-center mb-2">
                      <span className="text-2xl">📢</span>
                    </div>
                    <p className="font-medium">Ad Space</p>
                    <p className="text-xs opacity-70">300x250</p>
                  </div>
                </div>
              </div>
            </aside>

            {/* Notifications Panel - Right side on desktop, hidden on mobile */}
            {userLeagueState === 'active-user' && league?.id && (
              <aside className="hidden lg:block order-3">
                <div className="lg:sticky lg:top-32 h-[calc(100vh-12rem)] bg-card border rounded-lg shadow-sm overflow-hidden">
                  <LeagueNotifications leagueId={league.id} />
                </div>
              </aside>
            )}
          </div>
        </div>
        
        <PlayerStatsModal
          player={selectedPlayer}
          isOpen={isPlayerDialogOpen}
          onClose={() => setIsPlayerDialogOpen(false)}
        />
      </main>
      <Footer />
    </div>
  );
};

export default Matchup;