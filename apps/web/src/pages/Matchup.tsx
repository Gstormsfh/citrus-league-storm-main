import { userMessage } from '@/lib/userMessage';
import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useParams, useNavigate, Navigate, Link } from "react-router-dom";
import { HockeyFooter } from '@/components/citrus2';
import { useAuth } from '@/contexts/AuthContext';
import { useProfile } from '@/hooks/useProfile';
import { useLeague } from '@/contexts/LeagueContext';
import { cn } from '@/lib/utils';
import Navbar from '@/components/Navbar';
import { PB_TYPE, PressBoxChips, PressBoxScoreBlock, PressBoxTabs, type PressBoxScoreDay } from '@/components/pressbox';
import { PressBoxMatchupCategories } from '@/components/pressbox/MatchupCategories';
import { PressBoxLeagueChrome } from '@/components/pressbox/LeagueChrome';
import { PressBoxPageLoading } from '@/components/pressbox/PageLoading';
import { useIsMobile } from '@/hooks/useIsMobile';
import { LeagueCreationCTA } from '@/components/LeagueCreationCTA';
import { MatchupComparison } from "@/components/matchup/MatchupComparison";
import { MatchupScheduleSelector } from "@/components/matchup/MatchupScheduleSelector";
import { ScoreCard } from "@/components/matchup/ScoreCard";
import { WeeklySchedule } from "@/components/matchup/WeeklySchedule";
import { getTodayMST, getTodayMSTDate } from '@/utils/timezoneUtils';
import { getCurrentSeason } from '@/utils/seasonConstants';
import LeagueNotifications from "@/components/matchup/LeagueNotifications";
import { MatchupSidebar } from "@/components/matchup/MatchupSidebar";
import { ScoreboardStrip } from "@/components/matchup/ScoreboardStrip";
import { anyGameLive, type TeamAvatarMap } from "@/components/matchup/scoreboard";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MatchupPlayer, StatBreakdown } from "@/components/matchup/types";
import { organizeMatchupData } from "@/components/matchup/matchupUtils";
import { HockeyPlayer } from '@/components/roster/HockeyPlayerCard';
import PlayerStatsModal from '@/components/PlayerStatsModal';
import { LeagueService, League, Team } from '@/services/LeagueService';
import { MatchupService, Matchup as MatchupType } from '@/services/MatchupService';
import { PlayerService, Player } from '@/services/PlayerService';
import { ScheduleService } from '@/services/ScheduleService';
import { getDraftCompletionDate, getFirstWeekStartDate, getCurrentWeekNumber, getAvailableWeeks, getWeekLabel, getWeekDateLabel, getWeekStartDate, getWeekEndDate, clampToSeasonStart } from '@/utils/weekCalculator';
import { DEMO_LEAGUE_ID_FOR_GUESTS } from '@/services/DemoLeagueService';
import { DemoMatchupCacheService, type DemoMatchupPayload } from '@/services/DemoMatchupCacheService';
import { PB_LOADING_MIN_MS, useMinimumLoadingTime } from '@/hooks/useMinimumLoadingTime';
import { MatchupScoreJobService } from '@/services/MatchupScoreJobService';
import { DataCacheService, TTL } from '@/services/DataCacheService';
import { calculateEligibleGamesRemaining } from '@/utils/rosterUtils';
import { collectRemainingGames, computeWinProbability, enumerateWeekDates } from '@/utils/winProbability';
import { ScoringCalculator, DEFAULT_SCORING } from '@/utils/scoringUtils';
import { logger } from '@/utils/logger';
import { useLoadCeiling } from '@/hooks/useLoadCeiling';
import { readUntilPresent } from '@/utils/readUntilPresent';
import { isPoolLeague, getPoolRoute } from '@/utils/leagueTypeHelpers';
import { usePlayoffChampion } from '@/hooks/usePlayoffChampion';
import { useSeasonStatus } from '@/hooks/useSeasonStatus';
import { Card, CardContent } from '@/components/ui/card';
import { Trophy } from 'lucide-react';
import { matchupApi } from '@/api/matchups';
import { leagueApi } from '@/api/leagues';
import { playerApi } from '@/api/players';
import { publicApi } from '@/api/public';
import { syncLeagueFromUrl } from './matchupUrlSync';
import { defaultMatchupDay } from './matchupDefaultDay';

/** How long the FIRST matchup load may run before the page admits failure.
 *  Above the 15s in-flight timeout below, so a load that is merely slow still
 *  wins; this only catches the case where nothing resolves at all. */
const MATCHUP_LOAD_CEILING_MS = 25000;

// ============================================================
// Local type definitions for data used throughout this file
// ============================================================

/** Stats for a single player on a single day (from get_daily_game_stats RPC or computed) */
interface DailyPlayerStats {
  goals: number;
  assists: number;
  points: number;
  shots_on_goal: number;
  blocks: number;
  ppp: number;
  shp: number;
  hits: number;
  pim: number;
  wins: number;
  saves: number;
  shutouts: number;
  goals_against: number;
  daily_total_points?: number;
  daily_stats_breakdown?: Record<string, { count: number; points: number }> | null;
  // Additional fields from get_daily_game_stats RPC
  sog?: number;
  plus_minus?: number;
  toi_seconds?: number;
  faceoff_wins?: number;
  faceoff_losses?: number;
  faceoff_taken?: number;
  takeaways?: number;
  giveaways?: number;
  ppg?: number;
  ppa?: number;
  shg?: number;
  sha?: number;
  shots_missed?: number;
  shots_blocked?: number;
  shot_attempts?: number;
  gwg?: number;
  otg?: number;
  shifts?: number;
  losses?: number;
  ot_losses?: number;
  shots_faced?: number;
  save_pct?: number;
  is_goalie?: boolean;
  xGoals?: number;
  // RPC row raw fields
  player_id?: number;
  game_id?: number;
  game_date?: string;
}

/** A single row from the fantasy_daily_rosters table */
interface FrozenRosterEntry {
  player_id: string | number;
  team_id: string;
  roster_date: string;
  slot_type?: string;
  slot_id?: string;
}

/** Projection data from getDailyProjectionsForMatchup */
interface DailyProjection {
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
  is_goalie?: boolean;
  // Goalie projections
  projected_wins?: number;
  projected_saves?: number;
  projected_shutouts?: number;
  projected_goals_against?: number;
  projected_gaa?: number;
  projected_save_pct?: number;
  projected_gp?: number;
  starter_confirmed?: boolean;
  // Monte Carlo uncertainty (Citrus 3.1)
  likely_low?: number;
  likely_high?: number;
  confidence_label?: string;
  dynamic_confidence?: number;
  projection_mean?: number;
  projection_std_dev?: number;
  /** Puck drop (TIMESTAMPTZ) from get_daily_projections — the win-chance
   *  fallback for a starter whose schedule row is missing. */
  game_start_time?: string | null;
}

/** A matchup row from a Supabase query with joined team names */
interface MatchupWithTeamNames extends MatchupType {
  team1_name?: string;
  team2_name?: string;
  team1?: { team_name: string } | null;
  team2?: { team_name: string } | null;
}

/** Daily score entry from calculate_daily_matchup_scores RPC */
interface DailyScoreRow {
  roster_date: string;
  daily_score: string | number;
}

/** Profile type with optional timezone */
interface UserProfile {
  timezone?: string;
  [key: string]: unknown;
}

// Debug flag - set to true only when debugging performance issues
const DEBUG_MATCHUP = false;
const log = DEBUG_MATCHUP ? logger.log.bind(logger, '[Matchup]') : () => {};

const Matchup = () => {
  const { user, loading: authLoading } = useAuth();
  const { data: profile } = useProfile();
  const { userLeagueState, loading: leagueContextLoading, activeLeagueId, activeLeagueFormat, isChangingLeague, setActiveLeagueId } = useLeague();

  // OFFSEASON (2026-09-02). The win-chance bar, the "N left" chip and the word
  // "Final" are all claims about a week being played. With no games on the
  // schedule they are claims about nothing: on 2026-09-02 this page showed
  // "Win chance 50%", "0 left" twice, and "Final" over "0.0 - 0.0" for a
  // matchup 27 days from its first puck drop. See seasonPhase.ts for the
  // audit. `unknown` is deliberately NOT dormant, so a failed schedule read
  // leaves this page exactly as it renders today.
  const { status: seasonStatus } = useSeasonStatus();
  const { leagueId: urlLeagueId, weekId: urlWeekId } = useParams<{ leagueId?: string; weekId?: string }>();
  const navigate = useNavigate();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  /** PRESS BOX (2026-09-04): the phone's league menu and its LINEUPS / BENCH tab. */
  const [phoneSection, setPhoneSection] = useState<'lineups' | 'bench' | 'categories'>('lineups');
  const isMobile = useIsMobile();
  // In-place reload trigger for the main loader (2026-09-01): bumped by the
  // visibility-change refresh instead of a full window.location reload.
  const [matchupReloadNonce, setMatchupReloadNonce] = useState(0);
  const [dailyStatsMap, setDailyStatsMap] = useState<Map<number, DailyPlayerStats>>(new Map()); // For selected date (or today)
  const [dailyStatsByDate, setDailyStatsByDate] = useState<Map<string, Map<number, DailyPlayerStats>>>(new Map()); // For all 7 days
  const [projectionsByDate, setProjectionsByDate] = useState<Map<string, Map<number, DailyProjection>>>(new Map()); // Cache projections per date
  // Cached daily scores for past days (frozen, won't change when roster changes)
  const [cachedDailyScores, setCachedDailyScores] = useState<Map<string, { 
    myScore: number; 
    oppScore: number; 
    isLocked: boolean 
  }>>(new Map());
  // Real-time calculated daily totals from MatchupComparison (SINGLE SOURCE OF TRUTH)
  const [calculatedDailyTotals, setCalculatedDailyTotals] = useState<Map<string, {
    myTotal: number;
    oppTotal: number;
  }>>(new Map());
  // Start loading as true to prevent initial flash of content
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSwitchingDate, setIsSwitchingDate] = useState(false);
  const loadingRef = useRef(false); // Prevent concurrent loads
  const previousRosterRef = useRef<{ myTeam: MatchupPlayer[]; oppTeam: MatchupPlayer[] } | null>(null);
  // WEEK PROJECTIONS (2026-09-01): per-DATE in-flight guard. The old single
  // boolean meant that when the week's seven dates are requested together
  // (see the fetch effect below), the first to start silently dropped the
  // other six — which is how the day strip rendered projected scores for at
  // most one day. A Set lets distinct dates load in parallel while still
  // deduplicating repeat requests for the same date.
  const projectionsLoadingRef = useRef<Set<string>>(new Set());
  const hasProcessedNoLeague = useRef(false); // Track if we've processed "no league" state
  const hasInitializedRef = useRef(false); // Track if we've completed initial load
  const statsLoadingRef = useRef(false); // Prevent concurrent stats fetches that cause score flashing
  const lastScoreRef = useRef<{ myScore: string; oppScore: string } | null>(null); // Stable score display
  const lastFrozenRostersKeyRef = useRef<string>(''); // Track frozen rosters key to prevent unnecessary re-calculations
  
  // Stable refs for player IDs to break dependency on team arrays (prevents death loop)
  const myTeamPlayerIdsRef = useRef<number[]>([]);
  const opponentTeamPlayerIdsRef = useRef<number[]>([]);
  // Ref for starter IDs (includes dropped players from frozen rosters) - updated separately
  const myStarterIdsRef = useRef<number[]>([]);
  const oppStarterIdsRef = useRef<number[]>([]);
  // State to track when player IDs change (for dependency arrays, since refs don't trigger re-renders)
  const [playerIdsVersion, setPlayerIdsVersion] = useState(0);
  
  // Cache tracking to prevent unnecessary reloads
  const prevLeagueIdRef = useRef<string | undefined>(undefined);
  const prevActiveLeagueIdRef = useRef<string | null>(null);
  const prevWeekIdRef = useRef<string | undefined>(undefined);
  const prevSelectedMatchupIdRef = useRef<string | null>(null);
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
  // Id of the team rendered on the LEFT. Needed because MatchupService's
  // `userTeam` field is really "the viewing team": when the user isn't in the
  // matchup they picked from the dropdown, it falls back to team1 — a
  // stranger's team. Anything that says "this is YOURS" has to check this.
  const [viewingTeamId, setViewingTeamId] = useState<string | null>(null);
  // Track user's actual matchup ID (for "(Your Matchup)" label)
  const [userMatchupId, setUserMatchupId] = useState<string | null>(null);
  // Every team in the league, for the owner avatars on the header discs and
  // the scoreboard chips (2026-09-01, audit M8). The league/teams response
  // joins profiles.avatar_url by owner_id; nothing else on this page serves
  // a picture (/my-team and the matchup rows carry ids and names only).
  // LeagueService caches this read, so it costs the loader nothing extra —
  // the opponent lookup below already requests the same list.
  const [leagueTeams, setLeagueTeams] = useState<Team[]>([]);
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

      // Skip backfill for demo league - guests can't write, and data should already exist from migration
      const isDemoLeague = currentMatchup.league_id === DEMO_LEAGUE_ID_FOR_GUESTS;

      // Step 0: Ensure both teams have team_lineups + fantasy_daily_rosters via server
      // This handles AI teams (owner_id = NULL) that can't be saved via frontend RLS
      if (!isDemoLeague) {
        try {
          log(' Ensuring rosters exist for matchup:', currentMatchup.id);
          await matchupApi.ensureRosters(currentMatchup.id);
        } catch (err) {
          logger.error('[Matchup] ensure-rosters failed:', err);
        }
      }

      // Step 1: Backfill missing daily roster records for both teams.
      //
      // team1 and team2 are independent writes against different team ids —
      // they were awaited one after the other, so this cost two round trips
      // where it needs one. On the ~350ms median this page sees, that is a
      // third of a second on a path that runs before the score refresh below.
      const backfillTeam = async (teamId: string | null | undefined, label: string) => {
        if (isDemoLeague || !teamId) return;
        try {
          log(` Running backfill for ${label}:`, teamId);
          const result = await LeagueService.backfillMissingDailyRosters(
            teamId,
            currentMatchup.league_id,
            currentMatchup.id
          );
          if (result.backfilledCount > 0) {
            log(' Backfilled', result.backfilledCount, `records for ${label}`);
          } else if (result.error) {
            logger.error(`[Matchup] Backfill error for ${label}:`, result.error);
          } else {
            log(` No records to backfill for ${label} (all exist)`);
          }
        } catch (err) {
          logger.error(`[Matchup] ${label} backfill exception:`, err);
        }
      };

      await Promise.all([
        backfillTeam(currentMatchup.team1_id, 'team1'),
        backfillTeam(currentMatchup.team2_id, 'team2'),
      ]);

      // Step 2: Calculate and store matchup scores
      // SKIP for demo league - guests have no auth token, and score jobs are server-side
      if (!isDemoLeague && (currentMatchup.status === 'in_progress' || currentMatchup.status === 'scheduled')) {
        log(' Triggering background score calculation job for league:', currentMatchup.league_id);
        try {
          const result = await MatchupScoreJobService.runJob(currentMatchup.league_id);
          log(' Background job completed:', result);
          
          // Step 3: Refresh matchup data to get updated scores from DB
          if (result.updatedCount > 0) {
            log(' Refreshing matchup data after score update...');
            const matchupResp = await matchupApi.getMatchupScores(currentMatchup.id);
            const refreshedMatchup = matchupResp.data;

            if (refreshedMatchup) {
              const scores = refreshedMatchup as { team1_score: number; team2_score: number };
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
          logger.error('[Matchup] Background job failed (non-blocking):', err);
        }
      }
    };
    
    // Fire-and-forget
    runBackfillAndCalculate();
  // Intentionally depends only on currentMatchup?.id to run once per matchup.
  // The effect reads currentMatchup properties (league_id, team1_id, etc.) but should NOT re-run when
  // scores or other matchup fields update (which would cause infinite loops since this effect updates scores).
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
        if (dateStr <= todayStr) {
          pastDates.push(dateStr);
        }
      }
      
      if (pastDates.length === 0) {
        setCachedDailyScores(new Map());
        return;
      }
      
      // SINGLE BATCHED API CALL: Fetch ALL past days' rosters for BOTH teams at once
      let allRosters: FrozenRosterEntry[] = [];
      try {
        const response = await matchupApi.getFrozenRosterBatch(currentMatchup.id, pastDates);
        // Filter to active slots only (matching previous query behavior)
        allRosters = ((response.data || []) as any[])
          .filter((r: any) => r.slot_type === 'active') as FrozenRosterEntry[];
      } catch (err) {
        logger.error('[Matchup] Error fetching cached rosters:', err);
        return;
      }
      
      // Group rosters by date and team
      const rostersByDateTeam = new Map<string, Map<string, number[]>>();
      ((allRosters ?? []) as FrozenRosterEntry[]).forEach((r: FrozenRosterEntry) => {
        if (!rostersByDateTeam.has(r.roster_date)) {
          rostersByDateTeam.set(r.roster_date, new Map());
        }
        const dateMap = rostersByDateTeam.get(r.roster_date)!;
        if (!dateMap.has(r.team_id)) {
          dateMap.set(r.team_id, []);
        }
        dateMap.get(r.team_id)!.push(typeof r.player_id === 'number' ? r.player_id : parseInt(r.player_id));
      });
      
      // Calculate scores for each past date
      // CRITICAL: Determine which team is "my team" vs "opponent" based on currentMatchup
      const scores = new Map<string, { myScore: number; oppScore: number; isLocked: boolean }>();
      
      // Use actual viewing team (handles both user and guest viewing)
      // For guest: currentMatchup contains viewing_team_id that UI sets
      // For user: userTeam.id should match one of the matchup teams
      // Renamed from `viewingTeamId` (2026-08-25): that name now belongs to
      // component state, and a same-named local in a 5,500-line file is how
      // the next edit here silently reads the wrong one.
      const scoringViewingTeamId = (currentMatchup as unknown as Record<string, unknown>).viewing_team_id as string | undefined || userTeam?.id || team1Id;

      // Determine if viewing team is team1 or team2
      const isViewingTeam1 = scoringViewingTeamId === team1Id;
      
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
      
      // Merge with existing cachedDailyScores to preserve RPC-provided values.
      // If this recalculation yields 0 for a team but RPC already set a non-zero score,
      // keep the RPC value (prevents AI team scores from being clobbered).
      setCachedDailyScores(prev => {
        const merged = new Map(prev);
        scores.forEach((newVal, dateStr) => {
          const existing = prev.get(dateStr);
          const finalMyScore = (newVal.myScore === 0 && existing && existing.myScore > 0)
            ? existing.myScore : newVal.myScore;
          const finalOppScore = (newVal.oppScore === 0 && existing && existing.oppScore > 0)
            ? existing.oppScore : newVal.oppScore;
          merged.set(dateStr, { myScore: finalMyScore, oppScore: finalOppScore, isLocked: newVal.isLocked });
        });
        // Cache merged result
        DataCacheService.set(cacheKey, merged, TTL.VERY_LONG);
        return merged;
      });
      log(` Cached ${scores.size} frozen scores for matchup ${currentMatchup.id} (team1: ${team1Id}, team2: ${team2Id})`);
    };
    
    fetchCachedScores();
  // Intentionally narrows currentMatchup to ?.id, ?.team1_id, ?.team2_id and userTeam to ?.id.
  // Using the full objects would cause re-runs whenever any field changes (e.g., score updates),
  // triggering redundant frozen-score recalculations.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMatchup?.id, dailyStatsByDate, currentMatchup?.team1_id, currentMatchup?.team2_id, userTeam?.id]);

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
    
    // Only run for guests or users with no league.
    //
    // These four setters used to run unconditionally on the active-user path,
    // handing React a FRESH `[]` and `{}` every time this effect fired. Those
    // identities are in the dependency array of `fetchAllDailyStats`, so each
    // pointless reset produced a new callback, which re-fired its effect (7
    // getDailyGameStats requests, one per weekday) AND re-armed the live-refresh
    // effect, whose body immediately fires 9 more. Clearing state that is
    // already clear was costing double-digit requests per load.
    if (userLeagueState === 'active-user') {
      setDemoMyTeam((prev) => (prev.length === 0 ? prev : []));
      setDemoOpponentTeam((prev) => (prev.length === 0 ? prev : []));
      setDemoMyTeamSlotAssignments((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      setDemoOpponentTeamSlotAssignments((prev) => (Object.keys(prev).length === 0 ? prev : {}));
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

        // ===================================================================
        // FAST PATH: Try Edge Function cache first (1 request instead of ~16)
        // Falls back to direct queries if the edge function is unavailable.
        // ===================================================================
        let cachedPayload: DemoMatchupPayload | null = null;
        try {
          const requestedWeek = urlWeekId ? parseInt(urlWeekId) : undefined;
          cachedPayload = await DemoMatchupCacheService.getPayload(
            requestedWeek && !isNaN(requestedWeek) ? requestedWeek : undefined
          );
          log(' Edge function cache HIT, skipping ~16 direct queries');
        } catch (cacheError) {
          log(' Edge function cache unavailable, falling back to direct queries:', cacheError);
        }

        // If we got a cached payload, hydrate state from it
        if (cachedPayload) {
          const demoLeague = cachedPayload.league as any;
          setLeague(demoLeague as League);

          const { getDraftCompletionDate: gDCD, getFirstWeekStartDate: gFWSD, getAvailableWeeks: gAW, getWeekStartDate: gWSD, getWeekEndDate: gWED, clampToSeasonStart: gCTS } = await import('@/utils/weekCalculator');
          const draftDate = gDCD(demoLeague as any);
          // WEEK-MATH FIX (2026-08-22): clamp to season start like generation does
          const firstWeek = gCTS(draftDate ? gFWSD(draftDate) : getTodayMSTDate());
          setFirstWeekStart(firstWeek);

          const weeks = cachedPayload.availableWeeks.length > 0 ? cachedPayload.availableWeeks : gAW(firstWeek);
          setAvailableWeeks(weeks);
          setSelectedWeek(cachedPayload.week);

          const guestMatchup = cachedPayload.matchup;
          const matchupWeekStart = gWSD(guestMatchup.week_number, firstWeek);
          const matchupWeekEnd = gWED(guestMatchup.week_number, firstWeek);
          const matchupWithDates: MatchupType = {
            ...guestMatchup,
            week_start_date: matchupWeekStart.toISOString().split('T')[0],
            week_end_date: matchupWeekEnd.toISOString().split('T')[0],
          };
          setCurrentMatchup(matchupWithDates);
          setSelectedMatchupId(guestMatchup.id);

          const scoringSettingsData = demoLeague.scoring_settings as any;
          setScoringSettings(scoringSettingsData || DEFAULT_SCORING);

          setUserTeam(cachedPayload.team1 as unknown as Team);
          setOpponentTeam(cachedPayload.team2 as unknown as Team | null);

          // Build MatchupPlayer rosters from cached lineup + player data
          const { PlayerService: PS } = await import('@/services/PlayerService');
          const allPlayers = await PS.getAllPlayers();
          const { team1Roster, team2Roster, team1SlotAssignments, team2SlotAssignments, error: rosterError } =
            await MatchupService.getMatchupRosters(matchupWithDates, allPlayers, 'America/Denver', undefined);
          if (rosterError) throw rosterError;

          setDemoMyTeam(team1Roster);
          setDemoOpponentTeam(team2Roster || []);
          setDemoMyTeamSlotAssignments(team1SlotAssignments);
          setDemoOpponentTeamSlotAssignments(team2SlotAssignments || {});
          setMyTeam(team1Roster);
          setOpponentTeamPlayers(team2Roster || []);
          setMyTeamSlotAssignments(team1SlotAssignments);
          setOpponentTeamSlotAssignments(team2SlotAssignments || {});

          // Daily scores from cached payload (already pre-computed by edge fn)
          // Append 'T00:00:00' to force local-time parsing (avoid UTC midnight shift)
          const sortScores = (arr: any[]) =>
            [...arr].sort((a, b) => new Date(a.roster_date + 'T00:00:00').getTime() - new Date(b.roster_date + 'T00:00:00').getTime()).map(d => parseFloat(d.daily_score) || 0);
          const team1DailyPoints = cachedPayload.team1DailyScores.length > 0 ? sortScores(cachedPayload.team1DailyScores) : Array(7).fill(0);
          const team2DailyPoints = cachedPayload.team2DailyScores.length > 0 ? sortScores(cachedPayload.team2DailyScores) : Array(7).fill(0);

          setMyDailyPoints(team1DailyPoints);
          setOpponentDailyPoints(team2DailyPoints);

          // Build daily score maps (same logic as direct path below)
          const cachedScores = new Map<string, { myScore: number; oppScore: number; isLocked: boolean }>();
          const calculatedTotals = new Map<string, { myTotal: number; oppTotal: number }>();
          const [startYear, startMonth, startDay] = matchupWithDates.week_start_date.split('-').map(Number);
          const todayStr = getTodayMST();
          const totalDailyPoints = team1DailyPoints.reduce((s, p) => s + p, 0) + team2DailyPoints.reduce((s, p) => s + p, 0);

          for (let i = 0; i < 7 && i < team1DailyPoints.length; i++) {
            const dayDate = new Date(startYear, startMonth - 1, startDay + i);
            const dateStr = `${dayDate.getFullYear()}-${String(dayDate.getMonth() + 1).padStart(2, '0')}-${String(dayDate.getDate()).padStart(2, '0')}`;
            cachedScores.set(dateStr, { myScore: team1DailyPoints[i] || 0, oppScore: team2DailyPoints[i] || 0, isLocked: dateStr < todayStr });
            calculatedTotals.set(dateStr, totalDailyPoints < 0.1
              ? { myTotal: 0, oppTotal: 0 }
              : { myTotal: team1DailyPoints[i] || 0, oppTotal: team2DailyPoints[i] || 0 });
          }
          setCachedDailyScores(cachedScores);
          setCalculatedDailyTotals(calculatedTotals);

          if (cachedPayload.allWeekMatchups.length > 0) {
            setAllWeekMatchups(cachedPayload.allWeekMatchups as any);
          }

          log(' Guest matchup loaded from edge cache (cachedAt:', cachedPayload.cachedAt, ')');
          setLoading(false);
          hasInitializedRef.current = true;
          loadingRef.current = false;
          return; // Done — skip direct query path
        }

        // ===================================================================
        // SLOW PATH: Direct Supabase queries (~16 round-trips)
        // Only reached when the edge function is unavailable.
        // ===================================================================

        // Get the league data directly (using maybeSingle to avoid single() coercion error)
        const demoLeagueResp = await publicApi.getLeague(DEMO_LEAGUE_ID_FOR_GUESTS);
        const demoLeagueData = demoLeagueResp.data;

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
        const { getDraftCompletionDate, getFirstWeekStartDate, getCurrentWeekNumber, getAvailableWeeks, getWeekStartDate, getWeekEndDate, clampToSeasonStart } = await import('@/utils/weekCalculator');
        const draftCompletionDate = getDraftCompletionDate(demoLeague as any);
        if (!draftCompletionDate) {
          throw new Error('Demo league has no draft completion date (updated_at is missing)');
        }

        // Calculate first week start (same as logged-in users)
        // WEEK-MATH FIX (2026-08-22): clamp to season start like generation does
        const firstWeek = clampToSeasonStart(getFirstWeekStartDate(draftCompletionDate));
        setFirstWeekStart(firstWeek);

        // Get available weeks (same as logged-in users)
        const weeks = getAvailableWeeks(firstWeek);
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

        // Get all matchups for this week via API
        const weekMatchupsResp = await publicApi.getLeagueMatchups(DEMO_LEAGUE_ID_FOR_GUESTS, weekToShow);
        let weekMatchups = (weekMatchupsResp.data || []) as any[];

        // If no matchups found for calculated week, try to find ANY matchup
        if (!weekMatchups || weekMatchups.length === 0) {
          log(' No matchups found for week', weekToShow, '- trying to find any matchup in demo league');

          // Get ANY matchup from the demo league (fallback)
          const anyMatchupsResp = await publicApi.getLeagueMatchups(DEMO_LEAGUE_ID_FOR_GUESTS);
          const anyMatchupsData = (anyMatchupsResp.data || []) as any[];

          if (anyMatchupsData.length > 0) {
            // Use the first available matchup and update weekToShow
            weekMatchups = [anyMatchupsData[0]];
            weekToShow = anyMatchupsData[0].week_number;
            setSelectedWeek(weekToShow);
            log(' Using fallback matchup from week', weekToShow);
          } else {
            throw new Error(`The demo league has no matchups yet. Refresh to try again.`);
          }
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
          setScoringSettings(DEFAULT_SCORING);
        }

        // Get teams via API (parallel)
        const [team1Resp, team2Resp] = await Promise.all([
          publicApi.getTeams(guestMatchup.league_id),
          Promise.resolve(null), // Teams come in one call
        ]);

        const allTeams = (team1Resp.data || []) as Team[];
        const team1Data = allTeams.find((t: Team) => t.id === guestMatchup.team1_id) || null;
        const team2Data = guestMatchup.team2_id ? allTeams.find((t: Team) => t.id === guestMatchup.team2_id) || null : null;

        setUserTeam(team1Data);
        setOpponentTeam(team2Data);

        // Get matchup rosters using the same service as logged-in users
        const { PlayerService } = await import('@/services/PlayerService');
        const allPlayers = await PlayerService.getAllPlayers();

        const { team1Roster, team2Roster, team1SlotAssignments, team2SlotAssignments, error: rosterError } =
          await MatchupService.getMatchupRosters(matchupWithDates, allPlayers, 'America/Denver', undefined);

        if (rosterError) throw rosterError;

        // Debug: Verify isStarter flags and slot assignments before setting state
        const team1StartersCount = team1Roster.filter(p => p.isStarter).length;
        const team2StartersCount = (team2Roster || []).filter(p => p.isStarter).length;
        const team1SlotKeys = Object.keys(team1SlotAssignments);
        const team1RosterIds = team1Roster.map(p => String(p.id));
        const slotMatches = team1SlotKeys.filter(key => team1RosterIds.includes(key));

        log(' Setting demo teams with isStarter flags:', {
          team1Total: team1Roster.length,
          team1Starters: team1StartersCount,
          team1Bench: team1Roster.length - team1StartersCount,
          team2Total: (team2Roster || []).length,
          team2Starters: team2StartersCount,
          team2Bench: (team2Roster || []).length - team2StartersCount,
          slotAssignmentsCount: team1SlotKeys.length,
          slotMatchesCount: slotMatches.length,
          sampleSlotKeys: team1SlotKeys.slice(0, 5),
          sampleRosterIds: team1RosterIds.slice(0, 5),
          sampleTeam1Starters: team1Roster.filter(p => p.isStarter).slice(0, 3).map(p => ({
            name: p.name,
            id: p.id,
            idString: String(p.id),
            isStarter: p.isStarter,
            hasSlot: team1SlotKeys.includes(String(p.id))
          })),
          sampleTeam1Bench: team1Roster.filter(p => !p.isStarter).slice(0, 3).map(p => ({
            name: p.name,
            id: p.id,
            isStarter: p.isStarter
          }))
        });

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

        // Calculate daily scores via API (single call for both teams)
        let team1DailyPoints: number[] = [];
        let team2DailyPoints: number[] = [];
        try {
          const response = await publicApi.getDailyScores(guestMatchup.id);
          const dailyScoresData = response.data;
          if (dailyScoresData && Array.isArray(dailyScoresData)) {
            const parseDailyScores = (teamId: string) => {
              const teamEntries = (dailyScoresData as Array<{ team_id: string; roster_date: string; daily_score: string | number }>)
                .filter((d) => d.team_id === teamId)
                .sort((a, b) => new Date(a.roster_date + 'T00:00:00').getTime() - new Date(b.roster_date + 'T00:00:00').getTime());
              return teamEntries.length > 0 ? teamEntries.map(d => parseFloat(String(d.daily_score)) || 0) : Array(7).fill(0);
            };
            team1DailyPoints = team1Data ? parseDailyScores(team1Data.id) : Array(7).fill(0);
            team2DailyPoints = team2Data ? parseDailyScores(team2Data.id) : Array(7).fill(0);
          } else {
            team1DailyPoints = Array(7).fill(0);
            team2DailyPoints = Array(7).fill(0);
          }
        } catch (error) {
          logger.error('[Matchup] Exception calculating daily scores:', error);
          team1DailyPoints = Array(7).fill(0);
          team2DailyPoints = Array(7).fill(0);
        }

        // Set daily points state (same as logged-in users)
        setMyDailyPoints(team1DailyPoints);
        setOpponentDailyPoints(team2DailyPoints);
        log(' Daily points set:', {
          myTeam: team1DailyPoints,
          opponentTeam: team2DailyPoints
        });
        
        // Populate cachedDailyScores from the daily points arrays for WeeklySchedule
        const cachedScores = new Map<string, { myScore: number; oppScore: number; isLocked: boolean }>();
        const [startYear, startMonth, startDay] = matchupWithDates.week_start_date.split('-').map(Number);
        const todayStr = getTodayMST();
        
        for (let i = 0; i < 7 && i < team1DailyPoints.length; i++) {
          const dayDate = new Date(startYear, startMonth - 1, startDay + i);
          const dateStr = `${dayDate.getFullYear()}-${String(dayDate.getMonth() + 1).padStart(2, '0')}-${String(dayDate.getDate()).padStart(2, '0')}`;
          const isPast = dateStr < todayStr;
          
          cachedScores.set(dateStr, {
            myScore: team1DailyPoints[i] || 0,
            oppScore: team2DailyPoints[i] || 0,
            isLocked: isPast
          });
        }
        
        setCachedDailyScores(cachedScores);
        log(' Cached daily scores populated for demo league:', Array.from(cachedScores.entries()));
        
        // Populate calculatedDailyTotals from daily points arrays for WeeklySchedule
        // This ensures the daily breakdown shows points
        const calculatedTotals = new Map<string, { myTotal: number; oppTotal: number }>();
        const totalDailyPoints = team1DailyPoints.reduce((sum, pts) => sum + pts, 0) + team2DailyPoints.reduce((sum, pts) => sum + pts, 0);
        
        for (let i = 0; i < 7 && i < team1DailyPoints.length; i++) {
          const dayDate = new Date(startYear, startMonth - 1, startDay + i);
          const dateStr = `${dayDate.getFullYear()}-${String(dayDate.getMonth() + 1).padStart(2, '0')}-${String(dayDate.getDate()).padStart(2, '0')}`;
          
          const myPoints = team1DailyPoints[i] || 0;
          const oppPoints = team2DailyPoints[i] || 0;
          
          // If all daily points are zero (RPC returned zeros), initialize to 0
          // The real per-day calculation (initialCalcDoneRef effect) will fill in
          // correct values once dailyStatsByDate loads. Never distribute weekly
          // totals evenly — that produces identical fake scores on every day
          // including days with no NHL games.
          if (totalDailyPoints < 0.1) {
            calculatedTotals.set(dateStr, {
              myTotal: 0,
              oppTotal: 0
            });
          } else {
            // Use actual daily points from RPC
            calculatedTotals.set(dateStr, {
              myTotal: myPoints,
              oppTotal: oppPoints
            });
          }
        }
        setCalculatedDailyTotals(calculatedTotals);
        log(' Calculated daily totals populated for demo league:', Array.from(calculatedTotals.entries()));
        
        // Reuse already-fetched week matchups for the dropdown (avoids duplicate query)
        if (weekMatchups && weekMatchups.length > 0) {
          setAllWeekMatchups(weekMatchups as any);
        }
        
        log(' ✅ Guest matchup loaded successfully');
        setLoading(false);
        hasInitializedRef.current = true;
        loadingRef.current = false;
      } catch (error) {
        logger.error('[Matchup] ❌ ERROR loading guest matchup:', error);
        // CRITICAL: During initial load, NEVER set error or mark as initialized
        // This keeps the loading screen showing and prevents error flash
        // Only show errors after we've successfully initialized at least once
        if (hasInitializedRef.current) {
          // We've initialized before, so it's safe to show the error
          setError(userMessage(error, 'Failed to load demo matchup'));
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
  }, [userLeagueState, urlLeagueId, urlWeekId, leagueContextLoading, activeLeagueId]);

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
      // Mugshot: the row's own `image` (typed on MatchupPlayer since audit
      // M4 — every producer sets it); otherwise build the NHL CDN "latest"
      // mug from the player id. PlayerStatsModal has an onError fallback
      // chain (team logo → initials) if the URL 404s.
      image: p.image
        || (p.id ? `https://assets.nhle.com/mugs/nhl/latest/${p.id}.png` : undefined),
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
  // Load every matchup of the viewed week — the scoreboard strip, the desktop
  // rail and the "View Matchup" select all read allWeekMatchups. One request,
  // joined team names copied up beside the ids. Returns the rows it stored
  // (null when the request failed) so the live-refresh loop can call it too:
  // the loop recomputes the league's scores every 120s but used to leave this
  // list at its load-time values, which would make the ticker a lie.
  const loadWeekMatchups = useCallback(async () => {
    if (!league?.id || userLeagueState !== 'active-user' || !selectedWeek) return null;
    const matchupsResp = await matchupApi.getLeagueMatchups(league.id, selectedWeek);
    const matchups = matchupsResp.data as any[] | null;
    if (!matchups) return null;
    const matchupsWithNames = matchups.map((m: any) => ({
      ...m,
      team1_name: m.team1?.team_name || 'Unknown',
      team2_name: m.team2?.team_name || (m.team2_id ? 'Unknown' : 'Bye Week'),
    }));
    setAllWeekMatchups(matchupsWithNames);
    return matchupsWithNames;
  }, [league?.id, selectedWeek, userLeagueState]);

  // Fetch all matchups for the current week (for the scoreboard + matchup viewer)
  useEffect(() => {
    const fetchAllWeekMatchups = async () => {
      if (!league?.id || userLeagueState !== 'active-user' || !selectedWeek) {
        setAllWeekMatchups([]);
        return;
      }

      try {
        const matchups = await loadWeekMatchups();

        if (!matchups) {
          log('WARN: Error fetching all week matchups');
          return;
        }

        // If no matchup is selected and user's matchup exists, select it
        if (!selectedMatchupId && currentMatchup) {
          setSelectedMatchupId(currentMatchup.id);
        }
      } catch (error) {
        logger.error('[Matchup] Exception fetching all week matchups:', error);
      }
    };

    fetchAllWeekMatchups();
  // Intentionally narrows league to ?.id and currentMatchup to ?.id.
  // Using full objects would cause unnecessary re-fetches when scores or other fields update.
  // selectedMatchupId is read inside to conditionally setSelectedMatchupId but should not trigger re-fetch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league?.id, selectedWeek, userLeagueState, currentMatchup?.id, loadWeekMatchups]);

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
  /*
   * A dependency array compares IDENTITY, not value.
   *
   * `scoringSettings` is replaced with a fresh object literal on every load
   * (Matchup.tsx sets it in four places), so `fetchAllDailyStats` got a new
   * identity each time even when the league's scoring had not changed by a
   * single point. That re-fired its own effect — 7 getDailyGameStats requests,
   * one per weekday — and re-armed the live-refresh effect, which immediately
   * fires 9 more. Serialising the value gives a dependency that changes when
   * the scoring changes and not when the object does. The object is a handful
   * of numeric weights; stringifying it is cheaper than one wasted request.
   */
  const scoringSignature = React.useMemo(
    () => JSON.stringify(scoringSettings ?? null),
    [scoringSettings],
  );

  const fetchAllDailyStats = React.useCallback(async () => {
      // Prevent concurrent fetches that cause score flashing
      if (statsLoadingRef.current) return;
      
      if (!currentMatchup) {
        setDailyStatsByDate(new Map());
        return;
      }
      
      statsLoadingRef.current = true;
      
      // For guests/demo, we still need player IDs from demo teams
      // For active users, we use the real matchup
      // Include BOTH current roster IDs AND starter IDs (frozen rosters include dropped players)
      const currentRosterIds = userLeagueState === 'active-user' 
        ? [...myTeamPlayerIdsRef.current, ...opponentTeamPlayerIdsRef.current]
        : [
            ...(demoMyTeam.map(p => typeof p.id === 'string' ? parseInt(p.id) : p.id)),
            ...(demoOpponentTeam.map(p => typeof p.id === 'string' ? parseInt(p.id) : p.id))
          ];
      
      // Also include starter IDs (includes dropped players from frozen rosters)
      const starterIds = [...myStarterIdsRef.current, ...oppStarterIdsRef.current];
      
      // Combine and dedupe
      const allPlayerIds = [...new Set([...currentRosterIds, ...starterIds])];
      
      if (allPlayerIds.length === 0) {
        setDailyStatsByDate(new Map());
        statsLoadingRef.current = false;
        return;
      }

      try {
        // Use the allPlayerIds already calculated above (works for both active users and guests)
        // For active users, refs are populated. For guests, we use demo teams directly.

        // Generate all 7 dates in the week
        // CRITICAL: Append 'T00:00:00' to force local-time parsing.
        // new Date("YYYY-MM-DD") parses as UTC midnight, which in MST becomes the previous day.
        const weekStartLocal = new Date(currentMatchup.week_start_date + 'T00:00:00');
        const dates: string[] = [];
        for (let i = 0; i < 7; i++) {
          const date = new Date(weekStartLocal);
          date.setDate(weekStartLocal.getDate() + i);
          const y = date.getFullYear();
          const m = String(date.getMonth() + 1).padStart(2, '0');
          const d = String(date.getDate()).padStart(2, '0');
          dates.push(`${y}-${m}-${d}`);
        }

        // Fetch stats for all 7 days in parallel
        const statsByDate = new Map<string, Map<number, any>>();
        const todayStr = getTodayMST();
        
        await Promise.all(dates.map(async (date) => {
          let data: any[] | null = null;
          try {
            const response = await matchupApi.getDailyGameStats(allPlayerIds, date);
            data = response.data as any[] | null;
          } catch (err) {
            log(`WARN: Error fetching stats for ${date}:`, err);
            return;
          }

          // Create map of player_id -> daily stats for this date
          const dayStatsMap = new Map<number, any>();
          const isPastDate = date < todayStr;
          
          // CRITICAL: Only initialize with 0 stats for PAST dates
          // For future dates, don't initialize - let projections show instead of 0.0
          if (isPastDate) {
            // Initialize ALL players with 0 stats for past dates (ensures complete data)
            // This ensures players who didn't play still have entries with 0 points
            allPlayerIds.forEach(playerId => {
              dayStatsMap.set(playerId, {
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
                daily_total_points: 0
              });
            });
          }
          
          // CRITICAL: Aggregate across multiple games per day (goalies can't play multiple games per day, but skaters can)
          // Now update with actual RPC data for players who played
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
            const goalieScoring = scoringSettings?.goalie || DEFAULT_SCORING.goalie;
            const skaterScoring = scoringSettings?.skater || DEFAULT_SCORING.skater;
            
            let dailyTotalPoints = 0;
            if (isGoalie) {
              // Goalie Formula: Use league settings (defaults: DEFAULT_SCORING.goalie from @citrus/shared)
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
            
            // Build scoring breakdown for tooltip (same format as stats_breakdown)
            const daily_stats_breakdown = isGoalie ? {
              ...(aggregated.wins > 0 ? { wins: { count: aggregated.wins, points: aggregated.wins * goalieScoring.wins } } : {}),
              ...(aggregated.saves > 0 ? { saves: { count: aggregated.saves, points: aggregated.saves * goalieScoring.saves } } : {}),
              ...(aggregated.shutouts > 0 ? { shutouts: { count: aggregated.shutouts, points: aggregated.shutouts * goalieScoring.shutouts } } : {}),
              ...(aggregated.goals_against > 0 ? { goals_against: { count: aggregated.goals_against, points: aggregated.goals_against * goalieScoring.goals_against } } : {}),
            } : {
              ...(aggregated.goals > 0 ? { goals: { count: aggregated.goals, points: aggregated.goals * skaterScoring.goals } } : {}),
              ...(aggregated.assists > 0 ? { assists: { count: aggregated.assists, points: aggregated.assists * skaterScoring.assists } } : {}),
              ...(aggregated.ppp > 0 ? { ppp: { count: aggregated.ppp, points: aggregated.ppp * skaterScoring.power_play_points } } : {}),
              ...(aggregated.shp > 0 ? { shp: { count: aggregated.shp, points: aggregated.shp * skaterScoring.short_handed_points } } : {}),
              ...(aggregated.shots_on_goal > 0 ? { shots_on_goal: { count: aggregated.shots_on_goal, points: aggregated.shots_on_goal * skaterScoring.shots_on_goal } } : {}),
              ...(aggregated.blocks > 0 ? { blocks: { count: aggregated.blocks, points: aggregated.blocks * skaterScoring.blocks } } : {}),
              ...(aggregated.hits > 0 ? { hits: { count: aggregated.hits, points: aggregated.hits * skaterScoring.hits } } : {}),
              ...(aggregated.pim > 0 ? { pim: { count: aggregated.pim, points: aggregated.pim * skaterScoring.penalty_minutes } } : {}),
            };
            
            dayStatsMap.set(row.player_id, {
              ...aggregated,
              // CRITICAL: For future dates, don't set daily_total_points (leave undefined)
              // This ensures projections show instead of 0.0 for future dates
              // For past dates, always set it (even if 0) so we show actual points
              daily_total_points: isPastDate ? dailyTotalPoints : (dailyTotalPoints > 0 ? dailyTotalPoints : undefined),
              daily_stats_breakdown,
            });
            
          });

          statsByDate.set(date, dayStatsMap);
        }));

        setDailyStatsByDate(statsByDate);
        // Calculation will be triggered by useEffect when dailyStatsByDate updates
      } catch (error) {
        logger.error('[Matchup] Error fetching all daily stats:', error);
        setDailyStatsByDate(new Map());
      } finally {
        statsLoadingRef.current = false;
      }
  // Player IDs are read from refs (myTeamPlayerIdsRef, opponentTeamPlayerIdsRef,
  // myStarterIdsRef, oppStarterIdsRef) which are stable references. demoMyTeam/demoOpponentTeam are
  // state arrays used for guest mode. playerIdsVersion was removed per ESLint (unnecessary dep).
  //
  // currentMatchup is narrowed to the two fields this callback actually reads —
  // it is otherwise replaced wholesale on every score refresh
  // (setCurrentMatchup(prev => ({...prev})) after the score job), and each of
  // those replacements used to cost a 7-request burst here plus a 9-request
  // burst from the live-refresh effect that depends on this callback.
  // scoringSignature is the value of scoringSettings rather than its identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMatchup?.id, currentMatchup?.week_start_date, userLeagueState, scoringSignature, demoMyTeam, demoOpponentTeam]);

  // Initial fetch on mount and when dependencies change
  useEffect(() => {
    fetchAllDailyStats();
  }, [fetchAllDailyStats]);

  // Auto-select the default date once the daily stats are in hand. Only a
  // PAST week still needs them (which day was last played); every other week
  // was already decided by the effect further down, before the first paint.
  // See pages/matchupDefaultDay.ts.
  useEffect(() => {
    if (!currentMatchup || dailyStatsByDate.size === 0 || selectedDate !== null) {
      return; // Don't override if user has already selected a date
    }

    const datesWithStats: string[] = [];
    for (const [dateStr, dayStats] of dailyStatsByDate.entries()) {
      if (dayStats && dayStats.size > 0) datesWithStats.push(dateStr);
    }

    const day = defaultMatchupDay({
      today: getTodayMST(),
      weekStart: currentMatchup.week_start_date,
      weekEnd: currentMatchup.week_end_date,
      datesWithStats,
    });

    if (day) setSelectedDate(day);
  }, [currentMatchup, dailyStatsByDate, selectedDate]);

  // Fetch projections for a specific date - memoized to prevent recreation
  // CRITICAL: Works for BOTH active users AND demo/guest users
  const fetchProjectionsForDate = useCallback(async (date: string) => {
    // Check cache first - if we have projections (even if empty), don't re-fetch
    if (projectionsByDate.has(date)) {
      return;
    }

    // Prevent concurrent fetches FOR THE SAME DATE — different dates are
    // allowed to load in parallel (the week strip needs all seven).
    if (projectionsLoadingRef.current.has(date)) {
      return;
    }

    if (!currentMatchup) {
      return;
    }

    // Get player IDs - from refs for active users, from demo teams for guests
    const allPlayerIds = userLeagueState === 'active-user'
      ? [
          ...myTeamPlayerIdsRef.current,
          ...opponentTeamPlayerIdsRef.current
        ]
      : [
          ...demoMyTeam.map(p => typeof p.id === 'string' ? parseInt(p.id) : p.id),
          ...demoOpponentTeam.map(p => typeof p.id === 'string' ? parseInt(p.id) : p.id)
        ];

    if (allPlayerIds.length === 0) {
      return;
    }

    projectionsLoadingRef.current.add(date);

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
      projectionsLoadingRef.current.delete(date);
    }
  }, [projectionsByDate, currentMatchup, userLeagueState, demoMyTeam, demoOpponentTeam]);

  // Fetch detailed stats for selected date (or today) - for PlayerCard display
  // Sync dailyStatsMap from dailyStatsByDate when viewing today (so live stats show in daily breakdown)
  useEffect(() => {
    const todayStr = getTodayMST();
    const viewingToday = !selectedDate || selectedDate === todayStr;
    
    if (viewingToday && currentMatchup) {
      const weekStart = currentMatchup.week_start_date;
      const weekEnd = currentMatchup.week_end_date;
      
      // Only sync if today is in the matchup week
      if (todayStr >= weekStart && todayStr <= weekEnd) {
        const todayStats = dailyStatsByDate.get(todayStr);
        if (todayStats) {
          setDailyStatsMap(todayStats);
          log('[Matchup] Synced dailyStatsMap from dailyStatsByDate for today (live stats update)');
        }
      }
    }
  }, [dailyStatsByDate, selectedDate, currentMatchup]);

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
        
        const response = await matchupApi.getDailyGameStats(allPlayerIds, dateToFetch);
        const data = response.data as any[] | null;

        if (!data) {
          logger.error('[Matchup] No data returned from getDailyGameStats');
          throw new Error('Daily stats came back empty');
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
          const goalieScoring = scoringSettings?.goalie || DEFAULT_SCORING.goalie;
          const skaterScoring = scoringSettings?.skater || DEFAULT_SCORING.skater;
          
          let dailyTotalPoints = 0;
          if (isGoalie) {
            // Goalie Formula: Use league settings (defaults: DEFAULT_SCORING.goalie from @citrus/shared)
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
        logger.error('[Matchup] Error fetching daily stats:', error);
        setDailyStatsMap(new Map());
      } finally {
        loadingRef.current = false;
      }
    };

    // Fetch stats and projections in parallel.
    //
    // WEEK PROJECTIONS (2026-09-01, iPhone sim: "daily score projections do
    // not show in any matchup tabs"): the day strip computes a projected
    // score for EVERY day of the matchup week (see the weekly-schedule calc,
    // which reads projectionsByDate.get(dateStr) per day) — but this effect
    // only ever fetched the SELECTED day. Six of seven chips could never
    // have data, and on a future week the default selected day is the week
    // opener, which can be a no-games day — so the whole strip read blank.
    // Fetch all seven days of the viewed week up front: each call is ~6ms
    // server-side (get_daily_projections is date-bounded), they run in
    // parallel, and fetchProjectionsForDate dedupes via cache + per-date
    // in-flight guard, so revisits and date clicks stay free.
    const fetchData = async () => {
      const weekDates: string[] = [];
      if (currentMatchup?.week_start_date && currentMatchup?.week_end_date) {
        // Date-only strings; walk at noon UTC so DST/timezone can't skip a day.
        const cursor = new Date(`${currentMatchup.week_start_date}T12:00:00Z`);
        const last = new Date(`${currentMatchup.week_end_date}T12:00:00Z`);
        while (cursor <= last && weekDates.length < 10) {
          weekDates.push(cursor.toISOString().split('T')[0]);
          cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
      } else if (selectedDate) {
        weekDates.push(selectedDate);
      }

      await Promise.all([
        fetchDailyStats(),
        ...weekDates.map(d => fetchProjectionsForDate(d)),
      ]);
    };

    fetchData();
  // fetchProjectionsForDate is intentionally excluded because it depends on projectionsByDate (cache check),
  // and including it would create circular triggers: this effect fetches projections -> updates projectionsByDate
  // -> fetchProjectionsForDate changes -> effect re-runs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, currentMatchup, userLeagueState, scoringSettings, playerIdsVersion, demoMyTeam, demoOpponentTeam]);

  // THE DAY THE PAGE OPENS ON, DECIDED BEFORE THE FIRST PAINT (2026-09-03).
  //
  // This used to fire only when today fell inside the matchup week, and every
  // other week was left to the stats-driven effect above - which waits on a
  // seven-request fetch that does not even START until the loader has
  // finished and the spinner has come down. The page therefore painted in
  // WEEK scope and then re-assembled itself into DAY scope: the compact
  // WeeklySchedule grew its "Full week" button and shoved the whole lineup
  // down ~36px, and all 26 player rows swapped their week total for that
  // day's number. On 2026-09-03 no matchup week in production contains
  // today, so that was every load.
  //
  // `defaultMatchupDay` answers from the matchup alone wherever the stats
  // cannot change the answer - which is every week except one already
  // played - so the first frame is the settled one.
  useEffect(() => {
    if (!currentMatchup || selectedDate !== null) return; // Only run if no date selected yet

    const day = defaultMatchupDay({
      today: getTodayMST(),
      weekStart: currentMatchup.week_start_date,
      weekEnd: currentMatchup.week_end_date,
      datesWithStats: null,
    });

    if (day) setSelectedDate(day);
  }, [currentMatchup, selectedDate]);

  // Helper function to enrich a player with daily stats for a specific date
  // Replicates displayMyTeam's enrichment logic (lines 1803-2194) for use in calculations
  const enrichPlayerForDate = useCallback((player: MatchupPlayer, dateStr: string, statsMap: Map<number, any> | undefined, projectionsMap?: Map<string | number, any>): MatchupPlayer => {
    const playerId = typeof player.id === 'string' ? parseInt(player.id, 10) : player.id;
    const dailyStats = statsMap?.get(playerId);
    const projection = projectionsMap?.get(player.id);
    const isGoalie = player.isGoalie || player.position === 'G' || player.position === 'Goalie';
    const originalGames = (player.games && Array.isArray(player.games)) ? player.games : (player.games || undefined);
    
    // Get projections for date (simplified - just preserve if exists)
    const mergedProjection = projection ? {
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
          confidence_score: Number(projection.dynamic_confidence || projection.confidence_score || 0),
          calculation_method: projection.calculation_method || 'hybrid_bayesian',
          is_goalie: false,
          likely_low: projection.likely_low != null ? Number(projection.likely_low) : undefined,
          likely_high: projection.likely_high != null ? Number(projection.likely_high) : undefined,
          confidence_label: projection.confidence_label || undefined,
          dynamic_confidence: projection.dynamic_confidence != null ? Number(projection.dynamic_confidence) : undefined,
          projection_mean: projection.projection_mean != null ? Number(projection.projection_mean) : undefined,
          projection_std_dev: projection.projection_std_dev != null ? Number(projection.projection_std_dev) : undefined,
        }
      } : {})
    } : {
      ...(player.goalieProjection ? { goalieProjection: player.goalieProjection } : {}),
      ...(player.daily_projection ? { daily_projection: player.daily_projection } : {})
    };
    
    const todayStr = getTodayMST();
    const isPastDate = dateStr < todayStr;
    
    // Check if player has a live/started/final game on the date
    const hasStartedOrFinalGameOnViewedDate = originalGames && originalGames.some(g => {
      if (!g || typeof g !== 'object') return false;
      const gameDate = g.game_date?.split('T')[0];
      if (gameDate !== dateStr) return false;
      const gameStatus = (g.status || '').toLowerCase();
      const isLiveByStatus = gameStatus === 'live' || gameStatus === 'crit' || gameStatus === 'intermission';
      const isFinalByStatus = gameStatus === 'final';
      const hasScores = (g.home_score || 0) + (g.away_score || 0) > 0;
      const hasPeriod = g.period !== null && g.period !== undefined && g.period !== '';
      return isLiveByStatus || isFinalByStatus || hasScores || hasPeriod;
    });
    
    const getDailyStatsBreakdown = () => {
      if (dailyStats?.daily_stats_breakdown && Object.keys(dailyStats.daily_stats_breakdown).length > 0) {
        return dailyStats.daily_stats_breakdown;
      }
      if (player.daily_stats_breakdown && Object.keys(player.daily_stats_breakdown).length > 0) {
        return player.daily_stats_breakdown;
      }
      return null;
    };
    
    // If no daily stats, handle based on date type (same as displayMyTeam)
    if (!dailyStats) {
      if (isPastDate) {
        return {
          ...player,
          ...mergedProjection,
          daily_total_points: 0,
          daily_stats_breakdown: getDailyStatsBreakdown(),
          games: originalGames !== undefined ? originalGames : player.games,
          wasDropped: player.wasDropped
        };
      }
      if (hasStartedOrFinalGameOnViewedDate) {
        return {
          ...player,
          ...mergedProjection,
          daily_total_points: 0,
          daily_stats_breakdown: getDailyStatsBreakdown(),
          games: originalGames !== undefined ? originalGames : player.games,
          wasDropped: player.wasDropped
        };
      }
      return {
        ...player,
        ...mergedProjection,
        games: originalGames !== undefined ? originalGames : player.games,
        wasDropped: player.wasDropped
      };
    }
    
    // Has daily stats - enrich fully (same as displayMyTeam line 1961-2194)
    return {
      ...player,
      ...mergedProjection,
      matchupStats: isGoalie ? {
        wins: dailyStats.wins || 0,
        saves: dailyStats.saves || 0,
        shutouts: dailyStats.shutouts || 0,
        goals_against: dailyStats.goals_against || 0,
      } : {
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
      goalieMatchupStats: isGoalie ? {
        wins: dailyStats.wins || 0,
        saves: dailyStats.saves || 0,
        shutouts: dailyStats.shutouts || 0,
        goalsAgainst: dailyStats.goals_against || 0,
      } : player.goalieMatchupStats,
      // EXACT same logic as displayMyTeam (line 1995-1997)
      daily_total_points: dailyStats.daily_total_points !== undefined && dailyStats.daily_total_points !== null
        ? dailyStats.daily_total_points
        : (isPastDate ? 0 : undefined),
      daily_stats_breakdown: getDailyStatsBreakdown(),
      games: originalGames !== undefined ? originalGames : player.games,
      wasDropped: player.wasDropped
    };
  }, []);

  // Initial calculation uses EXACT same logic as MatchupComparison
  // This ensures world-class, Sleeper-esque accuracy with no discrepancies
  // Both initial load and date clicks use identical calculation logic

  // Callback to update calculated totals from MatchupComparison (works for selected date or any date)
  // GUARD: Don't overwrite non-zero RPC-provided scores with 0.
  // This prevents the initial-calc useEffect from clobbering server-calculated daily scores
  // when frozen roster enrichment fails (e.g., AI teams where opponent roster is empty).
  const handleTotalsCalculated = useCallback((userTotal: number, opponentTotal: number, date?: string) => {
    const targetDate = date || selectedDate;
    if (!targetDate) return;

    setCalculatedDailyTotals(prev => {
      const next = new Map(prev);
      const existing = prev.get(targetDate);

      // Preserve existing non-zero values when new calculation yields 0.
      // The RPC daily-scores endpoint is the source of truth; if it already
      // provided a non-zero score for a team, a later frontend recalculation
      // that produces 0 (due to empty frozen roster) should not replace it.
      const finalMyTotal = (userTotal === 0 && existing && existing.myTotal > 0)
        ? existing.myTotal : userTotal;
      const finalOppTotal = (opponentTotal === 0 && existing && existing.oppTotal > 0)
        ? existing.oppTotal : opponentTotal;

      next.set(targetDate, { myTotal: finalMyTotal, oppTotal: finalOppTotal });
      return next;
    });
  }, [selectedDate]);

  // Initial calculation for all dates using EXACT same logic as MatchupComparison
  // This populates the weekly schedule immediately on page load
  const initialCalcDoneRef = useRef(false);
  useEffect(() => {
    // CRITICAL: Allow re-calculation when frozen rosters are loaded
    // This ensures dropped players (like Nino and Jimmy) are included once frozen rosters load
    if (!currentMatchup) return;
    if (!myTeam.length && !demoMyTeam.length) return; // Wait for team data
    if (dailyStatsByDate.size === 0) return; // Wait for stats to load
    
    // CRITICAL: Wait for displayMyTeam to be computed at least once
    // This ensures we have the correct base team (displayMyTeam uses myTeam when selectedDate is null)
    // We need to ensure myTeam has all the correct players before calculating
    const baseTeam = userLeagueState === 'active-user' ? myTeam : demoMyTeam;
    if (baseTeam.length === 0) return;
    
    // CRITICAL: Check if we've already calculated with the current frozen rosters
    // This prevents infinite loops while still allowing re-calculation when frozen rosters load
    const frozenRostersKey = Array.from(frozenRostersByDate.keys()).sort().join(',');
    
    // If frozen rosters haven't changed and we've already calculated, skip
    // But allow first calculation and re-calculation when frozen rosters are loaded
    // NOTE: We always recalc to ensure accuracy when frozen rosters are loaded
    // The performance impact is minimal since this only runs when dependencies change
    lastFrozenRostersKeyRef.current = frozenRostersKey;
    
    // NOTE: We don't wait for frozenRostersByDate to be populated here because:
    // 1. Frozen rosters are only for PAST dates (not today/future)
    // 2. The initial calc checks for frozen rosters for each date individually
    // 3. If frozen rosters aren't loaded yet, we'll use myTeam (which is correct for today/future dates)
    // 4. When frozen rosters ARE loaded, this effect will re-run (because frozenRostersByDate is in deps)
    //    and the calc will use the frozen rosters for past dates
    
    const [startYear, startMonth, startDay] = currentMatchup.week_start_date.split('-').map(Number);
    
    // Calculate for all 7 dates using EXACT same logic as MatchupComparison
    for (let i = 0; i < 7; i++) {
      const dayDate = new Date(startYear, startMonth - 1, startDay + i);
      const dateStr = `${dayDate.getFullYear()}-${String(dayDate.getMonth() + 1).padStart(2, '0')}-${String(dayDate.getDate()).padStart(2, '0')}`;
      
      // Get starters for this date using same logic as myStarters/opponentStarters
      // CRITICAL: Check frozen rosters FIRST (same as myStarters line 2750)
      // Frozen rosters include dropped players that aren't in myTeam
      const frozenRoster = frozenRostersByDate.get(dateStr);
      const dayStatsMap = dailyStatsByDate.get(dateStr);
      
      let dayMyStarters: MatchupPlayer[];
      let dayOppStarters: MatchupPlayer[];
      let dayMySlots: Record<string, string>;
      let dayOppSlots: Record<string, string>;
      
      if (frozenRoster && frozenRoster.myRoster.length > 0) {
        // Use frozen roster (past dates) - same logic as myStarters useMemo
        dayMyStarters = frozenRoster.myRoster.filter(p => p.isStarter).map(player => {
          const playerId = typeof player.id === 'string' ? parseInt(player.id, 10) : player.id;
          const stats = dayStatsMap?.get(playerId);
          return {
            ...player,
            daily_total_points: stats?.daily_total_points ?? 0,
            daily_stats_breakdown: stats?.daily_stats_breakdown as StatBreakdown | undefined
          };
        });
        dayOppStarters = frozenRoster.oppRoster.filter(p => p.isStarter).map(player => {
          const playerId = typeof player.id === 'string' ? parseInt(player.id, 10) : player.id;
          const stats = dayStatsMap?.get(playerId);
          return {
            ...player,
            daily_total_points: stats?.daily_total_points ?? 0,
            daily_stats_breakdown: stats?.daily_stats_breakdown as StatBreakdown | undefined
          };
        });
        dayMySlots = frozenRoster.mySlots;
        dayOppSlots = frozenRoster.oppSlots;
      } else {
        // For non-frozen dates, use the STABLE base roster (not myTeam which changes on date click).
        // CRITICAL: baseCurrentRoster is set once during initial load and never changes when
        // the user clicks different dates. Using myTeam here would cause the initial calc to
        // re-run with the wrong players when a past date is selected (myTeam gets set to
        // the frozen roster for that date, corrupting today/future calculations).
        const baseMyTeam = userLeagueState === 'active-user'
          ? (baseCurrentRoster?.myRoster || myTeam)
          : demoMyTeam;
        const baseOppTeam = userLeagueState === 'active-user'
          ? (baseCurrentRoster?.oppRoster || opponentTeamPlayers)
          : demoOpponentTeam;
        
        // Wait for base teams to be populated
        if (baseMyTeam.length === 0 || baseOppTeam.length === 0) {
          continue; // Skip this date if teams aren't ready
        }
        
        // Get projections and stats for this date (same as displayMyTeam does)
        const dateProjections = projectionsByDate.get(dateStr);
        const hasFetchedProjections = dateProjections !== undefined;
        const statsMapForDate = dayStatsMap; // Already have this from dailyStatsByDate.get(dateStr)
        
        // Replicate displayMyTeam enrichment logic for this specific date
        const enrichedMyTeam = baseMyTeam.map(player => {
          const playerId = typeof player.id === 'string' ? parseInt(player.id, 10) : player.id;
          const dailyStats = statsMapForDate?.get(playerId);
          const projection = dateProjections?.get(player.id);
          const isGoalie = player.isGoalie || player.position === 'G' || player.position === 'Goalie';
          const originalGames = (player.games && Array.isArray(player.games)) ? player.games : (player.games || undefined);
          
          // Merge projections (same as displayMyTeam)
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
                confidence_score: Number(projection.dynamic_confidence || projection.confidence_score || 0),
                calculation_method: projection.calculation_method || 'hybrid_bayesian',
                is_goalie: false,
                likely_low: projection.likely_low != null ? Number(projection.likely_low) : undefined,
                likely_high: projection.likely_high != null ? Number(projection.likely_high) : undefined,
                confidence_label: projection.confidence_label || undefined,
                dynamic_confidence: projection.dynamic_confidence != null ? Number(projection.dynamic_confidence) : undefined,
                projection_mean: projection.projection_mean != null ? Number(projection.projection_mean) : undefined,
                projection_std_dev: projection.projection_std_dev != null ? Number(projection.projection_std_dev) : undefined,
              }
            } : {})
          } : {
            ...(player.goalieProjection ? { goalieProjection: player.goalieProjection } : {}),
            ...(player.daily_projection ? { daily_projection: player.daily_projection } : {})
          };
          
          const todayStr = getTodayMST();
          const isPastDate = dateStr < todayStr;
          
          const hasStartedOrFinalGameOnViewedDate = originalGames && originalGames.some(g => {
            if (!g || typeof g !== 'object') return false;
            const gameDate = g.game_date?.split('T')[0];
            if (gameDate !== dateStr) return false;
            const gameStatus = (g.status || '').toLowerCase();
            const isLiveByStatus = gameStatus === 'live' || gameStatus === 'crit' || gameStatus === 'intermission';
            const isFinalByStatus = gameStatus === 'final';
            const hasScores = (g.home_score || 0) + (g.away_score || 0) > 0;
            const hasPeriod = g.period !== null && g.period !== undefined && g.period !== '';
            return isLiveByStatus || isFinalByStatus || hasScores || hasPeriod;
          });
          
          const getDailyStatsBreakdown = () => {
            if (dailyStats?.daily_stats_breakdown && Object.keys(dailyStats.daily_stats_breakdown).length > 0) {
              return dailyStats.daily_stats_breakdown;
            }
            if (player.daily_stats_breakdown && Object.keys(player.daily_stats_breakdown).length > 0) {
              return player.daily_stats_breakdown;
            }
            return null;
          };
          
          if (!dailyStats) {
            if (isPastDate) {
              return {
                ...player,
                ...mergedProjection,
                daily_total_points: 0,
                daily_stats_breakdown: getDailyStatsBreakdown(),
                games: originalGames !== undefined ? originalGames : player.games,
                wasDropped: player.wasDropped
              };
            }
            if (hasStartedOrFinalGameOnViewedDate) {
              return {
                ...player,
                ...mergedProjection,
                daily_total_points: 0,
                daily_stats_breakdown: getDailyStatsBreakdown(),
                games: originalGames !== undefined ? originalGames : player.games,
                wasDropped: player.wasDropped
              };
            }
            return {
              ...player,
              ...mergedProjection,
              games: originalGames !== undefined ? originalGames : player.games,
              wasDropped: player.wasDropped
            };
          }
          
          return {
            ...player,
            ...mergedProjection,
            matchupStats: isGoalie ? {
              wins: dailyStats.wins || 0,
              saves: dailyStats.saves || 0,
              shutouts: dailyStats.shutouts || 0,
              goals_against: dailyStats.goals_against || 0,
            } : {
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
            goalieMatchupStats: isGoalie ? {
              wins: dailyStats.wins || 0,
              saves: dailyStats.saves || 0,
              shutouts: dailyStats.shutouts || 0,
              goalsAgainst: dailyStats.goals_against || 0,
            } : player.goalieMatchupStats,
            daily_total_points: dailyStats.daily_total_points !== undefined && dailyStats.daily_total_points !== null
              ? dailyStats.daily_total_points
              : (isPastDate ? 0 : undefined),
            daily_stats_breakdown: getDailyStatsBreakdown(),
            games: originalGames !== undefined ? originalGames : player.games,
            wasDropped: player.wasDropped
          };
        });
        
        // Same for opponent team
        const enrichedOppTeam = baseOppTeam.map(player => {
          const playerId = typeof player.id === 'string' ? parseInt(player.id, 10) : player.id;
          const dailyStats = statsMapForDate?.get(playerId);
          const projection = dateProjections?.get(player.id);
          const isGoalie = player.isGoalie || player.position === 'G' || player.position === 'Goalie';
          const originalGames = (player.games && Array.isArray(player.games)) ? player.games : (player.games || undefined);
          
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
                confidence_score: Number(projection.dynamic_confidence || projection.confidence_score || 0),
                calculation_method: projection.calculation_method || 'hybrid_bayesian',
                is_goalie: false,
                likely_low: projection.likely_low != null ? Number(projection.likely_low) : undefined,
                likely_high: projection.likely_high != null ? Number(projection.likely_high) : undefined,
                confidence_label: projection.confidence_label || undefined,
                dynamic_confidence: projection.dynamic_confidence != null ? Number(projection.dynamic_confidence) : undefined,
                projection_mean: projection.projection_mean != null ? Number(projection.projection_mean) : undefined,
                projection_std_dev: projection.projection_std_dev != null ? Number(projection.projection_std_dev) : undefined,
              }
            } : {})
          } : {
            ...(player.goalieProjection ? { goalieProjection: player.goalieProjection } : {}),
            ...(player.daily_projection ? { daily_projection: player.daily_projection } : {})
          };
          
          const todayStr = getTodayMST();
          const isPastDate = dateStr < todayStr;
          
          const hasStartedOrFinalGameOnViewedDate = originalGames && originalGames.some(g => {
            if (!g || typeof g !== 'object') return false;
            const gameDate = g.game_date?.split('T')[0];
            if (gameDate !== dateStr) return false;
            const gameStatus = (g.status || '').toLowerCase();
            const isLiveByStatus = gameStatus === 'live' || gameStatus === 'crit' || gameStatus === 'intermission';
            const isFinalByStatus = gameStatus === 'final';
            const hasScores = (g.home_score || 0) + (g.away_score || 0) > 0;
            const hasPeriod = g.period !== null && g.period !== undefined && g.period !== '';
            return isLiveByStatus || isFinalByStatus || hasScores || hasPeriod;
          });
          
          const getDailyStatsBreakdown = () => {
            if (dailyStats?.daily_stats_breakdown && Object.keys(dailyStats.daily_stats_breakdown).length > 0) {
              return dailyStats.daily_stats_breakdown;
            }
            if (player.daily_stats_breakdown && Object.keys(player.daily_stats_breakdown).length > 0) {
              return player.daily_stats_breakdown;
            }
            return null;
          };
          
          if (!dailyStats) {
            if (isPastDate) {
              return {
                ...player,
                ...mergedProjection,
                daily_total_points: 0,
                daily_stats_breakdown: getDailyStatsBreakdown(),
                games: originalGames !== undefined ? originalGames : player.games,
                wasDropped: player.wasDropped
              };
            }
            if (hasStartedOrFinalGameOnViewedDate) {
              return {
                ...player,
                ...mergedProjection,
                daily_total_points: 0,
                daily_stats_breakdown: getDailyStatsBreakdown(),
                games: originalGames !== undefined ? originalGames : player.games,
                wasDropped: player.wasDropped
              };
            }
            return {
              ...player,
              ...mergedProjection,
              games: originalGames !== undefined ? originalGames : player.games,
              wasDropped: player.wasDropped
            };
          }
          
          return {
            ...player,
            ...mergedProjection,
            matchupStats: isGoalie ? {
              wins: dailyStats.wins || 0,
              saves: dailyStats.saves || 0,
              shutouts: dailyStats.shutouts || 0,
              goals_against: dailyStats.goals_against || 0,
            } : {
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
            goalieMatchupStats: isGoalie ? {
              wins: dailyStats.wins || 0,
              saves: dailyStats.saves || 0,
              shutouts: dailyStats.shutouts || 0,
              goalsAgainst: dailyStats.goals_against || 0,
            } : player.goalieMatchupStats,
            daily_total_points: dailyStats.daily_total_points !== undefined && dailyStats.daily_total_points !== null
              ? dailyStats.daily_total_points
              : (isPastDate ? 0 : undefined),
            daily_stats_breakdown: getDailyStatsBreakdown(),
            games: originalGames !== undefined ? originalGames : player.games,
            wasDropped: player.wasDropped
          };
        });
        
        dayMyStarters = enrichedMyTeam.filter(p => p.isStarter);
        dayOppStarters = enrichedOppTeam.filter(p => p.isStarter);
        
        dayMySlots = userLeagueState === 'active-user'
          ? (baseCurrentRoster?.mySlots || myTeamSlotAssignments)
          : demoMyTeamSlotAssignments;
        dayOppSlots = userLeagueState === 'active-user'
          ? (baseCurrentRoster?.oppSlots || opponentTeamSlotAssignments)
          : demoOpponentTeamSlotAssignments;
      }
      
      // Use organizeMatchupData (same as MatchupComparison line 33-38)
      const organizedData = organizeMatchupData(dayMyStarters, dayOppStarters, dayMySlots, dayOppSlots);
      
      // Flatten players (same as MatchupComparison lines 40-53)
      const allUserPlayers: (MatchupPlayer | null)[] = [];
      const allOpponentPlayers: (MatchupPlayer | null)[] = [];
      
      organizedData.forEach(group => {
        allUserPlayers.push(...group.userPlayers);
        allOpponentPlayers.push(...group.opponentPlayers);
      });
      
      // Calculate totals using EXACT same logic as MatchupComparison (lines 58-102)
      const isShowingDailyView = true; // Always true for daily calculations
      
      const userTotal = allUserPlayers.reduce((sum, player) => {
        if (!player) return sum;
        if (isShowingDailyView) {
          // For dropped players, use the same fallback chain as MatchupComparison
          if (player.wasDropped) {
            // Try dayStatsMap first
            if (dayStatsMap) {
              const playerId = typeof player.id === 'string' ? parseInt(player.id, 10) : player.id;
              const stats = dayStatsMap.get(playerId);
              if (stats?.daily_total_points !== undefined) {
                return sum + stats.daily_total_points;
              }
            }
            // Fallback to player properties (total_points = their daily contribution since dropped mid-game)
            return sum + (player.daily_total_points ?? player.total_points ?? player.points ?? 0);
          }
          // Non-dropped: use daily_total_points
          return sum + (player.daily_total_points ?? 0);
        }
        // Weekly view: use weekly points
        return sum + (player.points || 0);
      }, 0);
      
      const opponentTotal = allOpponentPlayers.reduce((sum, player) => {
        if (!player) return sum;
        if (isShowingDailyView) {
          // For dropped players, use the same fallback chain as MatchupComparison
          if (player.wasDropped) {
            // Try dayStatsMap first
            if (dayStatsMap) {
              const playerId = typeof player.id === 'string' ? parseInt(player.id, 10) : player.id;
              const stats = dayStatsMap.get(playerId);
              if (stats?.daily_total_points !== undefined) {
                return sum + stats.daily_total_points;
              }
            }
            // Fallback to player properties (total_points = their daily contribution since dropped mid-game)
            return sum + (player.daily_total_points ?? player.total_points ?? player.points ?? 0);
          }
          // Non-dropped: use daily_total_points
          return sum + (player.daily_total_points ?? 0);
        }
        // Weekly view: use weekly points
        return sum + (player.points || 0);
      }, 0);
      
      // Store calculated totals via handleTotalsCalculated (same as MatchupComparison does)
      handleTotalsCalculated(userTotal, opponentTotal, dateStr);
    }
    
    // Note: This effect can re-run when frozen rosters are loaded to ensure dropped players are included
  }, [
    currentMatchup,
    baseCurrentRoster,
    myTeam,
    demoMyTeam,
    opponentTeamPlayers,
    demoOpponentTeam,
    dailyStatsByDate,
    frozenRostersByDate,
    projectionsByDate,
    myTeamSlotAssignments,
    demoMyTeamSlotAssignments,
    opponentTeamSlotAssignments,
    demoOpponentTeamSlotAssignments,
    userLeagueState,
    handleTotalsCalculated,
  ]);

  const handlePlayerClick = useCallback(async (player: MatchupPlayer) => {
    // INSTANT OPEN (2026-09-01 efficiency pass): the card opens NOW from
    // the matchup row's own data; season-long stats swap in when the
    // fetch below lands. Tapping used to wait out the round trip first.
    setSelectedPlayer(toHockeyPlayer(player));
    setIsPlayerDialogOpen(true);
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
        // Guard: only enrich if this card is still the one on screen.
        setSelectedPlayer(prev =>
          prev && String(prev.id) === String(player.id) ? toHockeyPlayer(player, seasonStats) : prev,
        );
      } else {
        // Fallback: try to fetch directly via API
        const statsRes = await playerApi.getPlayerStats(String(player.id), getCurrentSeason());
        const seasonStatsData = statsRes?.data;

        if (seasonStatsData) {
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
          setSelectedPlayer(prev =>
            prev && String(prev.id) === String(player.id) ? toHockeyPlayer(player, mappedStats) : prev,
          );
        }
        // No season data: the instant card already shows the row's stats.
      }
    } catch (error) {
      // Refresh failed: the instant card stays — same data the row showed.
      void error;
    }
  // toHockeyPlayer is a plain function redefined each render (not wrapped in useCallback);
  // including it would cause unnecessary re-creation. Its logic is pure and has no stale closure risk.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    // CRITICAL: Use same data source as MatchupComparison receives (line 3954)
    // When selectedDate is set, use dailyStatsByDate.get(selectedDate), otherwise use dailyStatsMap
    const statsMapForDate = selectedDate ? dailyStatsByDate.get(selectedDate) : dailyStatsMap;
    
    return baseTeam.map(player => {
      // CRITICAL: Convert player.id to number to match Map<number, any> keys
      // Match MatchupComparison's conversion logic (line 61)
      const playerId = typeof player.id === 'string' ? parseInt(player.id, 10) : player.id;
      const dailyStats = statsMapForDate?.get(playerId);
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
            confidence_score: Number(projection.dynamic_confidence || projection.confidence_score || 0),
            calculation_method: projection.calculation_method || 'hybrid_bayesian',
            is_goalie: false,
            likely_low: projection.likely_low != null ? Number(projection.likely_low) : undefined,
            likely_high: projection.likely_high != null ? Number(projection.likely_high) : undefined,
            confidence_label: projection.confidence_label || undefined,
            dynamic_confidence: projection.dynamic_confidence != null ? Number(projection.dynamic_confidence) : undefined,
            projection_mean: projection.projection_mean != null ? Number(projection.projection_mean) : undefined,
            projection_std_dev: projection.projection_std_dev != null ? Number(projection.projection_std_dev) : undefined,
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
            games: originalGames !== undefined ? originalGames : player.games,
            // CRITICAL: Preserve wasDropped flag for dropped players
            wasDropped: player.wasDropped
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
            games: originalGames !== undefined ? originalGames : player.games,
            // CRITICAL: Preserve wasDropped flag for dropped players
            wasDropped: player.wasDropped
          };
        }
        // For future/today dates without stats, just return player with projections
        return {
          ...player,
          ...mergedProjection,
          // CRITICAL: Always preserve games - use originalGames if captured, otherwise preserve from spread
          games: originalGames !== undefined ? originalGames : player.games,
          // CRITICAL: Preserve wasDropped flag for dropped players
          wasDropped: player.wasDropped
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
        // PRESERVE season stats from service - don't overwrite!
        // player.stats contains season totals and should not be modified here
        // Add goalie matchup stats for goalies (only when date is selected)
        // CRITICAL: In weekly view, use player.goalieMatchupStats from RPC (weekly aggregated)
        goalieMatchupStats: isGoalie ? {
          wins: dailyStats.wins || 0,
          saves: dailyStats.saves || 0,
          shutouts: dailyStats.shutouts || 0,
          goalsAgainst: dailyStats.goals_against || 0,
        } : player.goalieMatchupStats,
        // Add daily total points for the projection bar replacement
        // CRITICAL: For future dates, only set if daily_total_points actually exists (not undefined/null)
        // This ensures projections are shown instead of 0.0 for future dates
        daily_total_points: dailyStats.daily_total_points !== undefined && dailyStats.daily_total_points !== null
          ? dailyStats.daily_total_points
          : (isPastDate ? 0 : undefined),
        // Add daily stats breakdown for tooltip hover - check for empty objects
        daily_stats_breakdown: getDailyStatsBreakdown(),
        // CRITICAL: Always preserve games - use originalGames if captured, otherwise preserve from spread
        // The spread ...player will include games if it exists, so we only need to explicitly set if we captured it
        games: originalGames !== undefined ? originalGames : player.games,
        // Keep weekly total_points unchanged - it's the matchup week total
        // CRITICAL: Preserve wasDropped flag for dropped players
        wasDropped: player.wasDropped
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
  // demoMyTeam.length is used instead of demoMyTeam to avoid re-computing when demo team objects
  // change but roster composition hasn't. playerIdsVersion proxies actual player ID changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userLeagueState, playerIdsVersion, demoMyTeam.length, dailyStatsMap, dailyStatsByDate, selectedDate, projectionsByDate, isSwitchingDate, myTeam]);

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
    // CRITICAL: Use same data source as MatchupComparison receives (line 3954)
    // When selectedDate is set, use dailyStatsByDate.get(selectedDate), otherwise use dailyStatsMap
    const statsMapForDate = selectedDate ? dailyStatsByDate.get(selectedDate) : dailyStatsMap;
    
    return baseTeam.map(player => {
      // CRITICAL: Convert player.id to number to match Map<number, any> keys
      // Match MatchupComparison's conversion logic (line 61)
      const playerId = typeof player.id === 'string' ? parseInt(player.id, 10) : player.id;
      const dailyStats = statsMapForDate?.get(playerId);
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
            confidence_score: Number(projection.dynamic_confidence || projection.confidence_score || 0),
            calculation_method: projection.calculation_method || 'hybrid_bayesian',
            is_goalie: false,
            likely_low: projection.likely_low != null ? Number(projection.likely_low) : undefined,
            likely_high: projection.likely_high != null ? Number(projection.likely_high) : undefined,
            confidence_label: projection.confidence_label || undefined,
            dynamic_confidence: projection.dynamic_confidence != null ? Number(projection.dynamic_confidence) : undefined,
            projection_mean: projection.projection_mean != null ? Number(projection.projection_mean) : undefined,
            projection_std_dev: projection.projection_std_dev != null ? Number(projection.projection_std_dev) : undefined,
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
            games: originalGames !== undefined ? originalGames : player.games,
            // CRITICAL: Preserve wasDropped flag for dropped players
            wasDropped: player.wasDropped
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
            games: originalGames !== undefined ? originalGames : player.games,
            // CRITICAL: Preserve wasDropped flag for dropped players
            wasDropped: player.wasDropped
          };
        }
        // For future/today dates without stats, just return player with projections
        return {
          ...player,
          ...mergedProjection,
          // CRITICAL: Always preserve games - use originalGames if captured, otherwise preserve from spread
          games: originalGames !== undefined ? originalGames : player.games,
          // CRITICAL: Preserve wasDropped flag for dropped players
          wasDropped: player.wasDropped
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
        // PRESERVE season stats from service - don't overwrite!
        // player.stats contains season totals and should not be modified here
        // Add goalie matchup stats for goalies (only when date is selected)
        // CRITICAL: In weekly view, use player.goalieMatchupStats from RPC (weekly aggregated)
        goalieMatchupStats: isGoalie ? {
          wins: dailyStats.wins || 0,
          saves: dailyStats.saves || 0,
          shutouts: dailyStats.shutouts || 0,
          goalsAgainst: dailyStats.goals_against || 0,
        } : player.goalieMatchupStats,
        // Add daily total points for the projection bar replacement
        // CRITICAL: For future dates, only set if daily_total_points actually exists (not undefined/null)
        // This ensures projections are shown instead of 0.0 for future dates
        daily_total_points: dailyStats.daily_total_points !== undefined && dailyStats.daily_total_points !== null
          ? dailyStats.daily_total_points
          : (isPastDate ? 0 : undefined),
        // Add daily stats breakdown for tooltip hover - check for empty objects
        daily_stats_breakdown: getDailyStatsBreakdown(),
        // CRITICAL: Always preserve games - use originalGames if captured, otherwise preserve from spread
        games: originalGames !== undefined ? originalGames : player.games,
        // Keep weekly total_points unchanged - it's the matchup week total
        // CRITICAL: Preserve wasDropped flag for dropped players
        wasDropped: player.wasDropped
      };
    });
  // demoOpponentTeam.length is used instead of demoOpponentTeam to avoid re-computing when demo team
  // objects change but roster composition hasn't. playerIdsVersion proxies actual player ID changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userLeagueState, playerIdsVersion, demoOpponentTeam.length, dailyStatsMap, dailyStatsByDate, selectedDate, projectionsByDate, isSwitchingDate, opponentTeamPlayers]);
  const displayMyTeamSlotAssignments = useMemo(() => {
    // For past dates with frozen rosters, use frozen slot assignments directly
    // This eliminates the race condition where useMemo updates starters immediately
    // but the useEffect that updates state slot assignments fires later
    if (selectedDate && frozenRostersByDate.has(selectedDate)) {
      const frozenSlots = frozenRostersByDate.get(selectedDate)!.mySlots;
      if (frozenSlots && Object.keys(frozenSlots).length > 0) {
        return frozenSlots;
      }
    }
    return userLeagueState === 'active-user' ? myTeamSlotAssignments : demoMyTeamSlotAssignments;
  }, [selectedDate, frozenRostersByDate, userLeagueState, myTeamSlotAssignments, demoMyTeamSlotAssignments]);

  const displayOpponentTeamSlotAssignments = useMemo(() => {
    // For past dates with frozen rosters, use frozen slot assignments directly
    // This eliminates the race condition where useMemo updates starters immediately
    // but the useEffect that updates state slot assignments fires later
    if (selectedDate && frozenRostersByDate.has(selectedDate)) {
      const frozenSlots = frozenRostersByDate.get(selectedDate)!.oppSlots;
      if (frozenSlots && Object.keys(frozenSlots).length > 0) {
        return frozenSlots;
      }
    }
    return userLeagueState === 'active-user' ? opponentTeamSlotAssignments : demoOpponentTeamSlotAssignments;
  }, [selectedDate, frozenRostersByDate, userLeagueState, opponentTeamSlotAssignments, demoOpponentTeamSlotAssignments]);

  // Weekly starters for sidebar (always shows full week stats, regardless of selected date)
  // CRITICAL: Use baseCurrentRoster (stable, full week) instead of myTeam/opponentTeamPlayers
  // (which change when dates are selected)
  const weeklyMyStarters = useMemo(() => {
    if (!baseCurrentRoster) return [];
    
    return baseCurrentRoster.myRoster
      .filter(p => p.isStarter)
      .map(p => ({
        ...p,
        // Use total_points (full week cumulative) for Top Performers
        points: p.total_points || p.points || 0
      }));
  }, [baseCurrentRoster]);

  const weeklyOpponentStarters = useMemo(() => {
    if (!baseCurrentRoster) return [];
    
    return baseCurrentRoster.oppRoster
      .filter(p => p.isStarter)
      .map(p => ({
        ...p,
        // Use total_points (full week cumulative) for Top Performers
        points: p.total_points || p.points || 0
      }));
  }, [baseCurrentRoster]);

  // Define starters BEFORE using them in team points calculations
  // CRITICAL FIX: If we have a frozen roster for the selected date, use it directly
  // This ensures dropped players appear correctly in the Matchup tab
  const myStarters = useMemo(() => {
    // If date is selected and we have a non-empty frozen roster, use that directly (includes dropped players)
    if (selectedDate && frozenRostersByDate.has(selectedDate)) {
      const frozenRoster = frozenRostersByDate.get(selectedDate)!;
      // Only use frozen data if it actually has players (empty = no DB data, skip to fallback)
      if (frozenRoster.myRoster.length > 0) {
        const directStarters = frozenRoster.myRoster.filter(p => p.isStarter);

        // Enrich with stats from dailyStatsByDate
        const dayStatsMap = dailyStatsByDate.get(selectedDate);
        const enriched = directStarters.map(player => {
          const playerId = typeof player.id === 'string' ? parseInt(player.id, 10) : player.id;
          const stats = dayStatsMap?.get(playerId);
          return {
            ...player,
            daily_total_points: stats?.daily_total_points ?? 0,
            daily_stats_breakdown: stats?.daily_stats_breakdown
          };
        });

        return enriched;
      }
    }

    // Otherwise use enriched displayMyTeam
    return displayMyTeam.filter(p => p.isStarter);
  }, [selectedDate, frozenRostersByDate, dailyStatsByDate, displayMyTeam]);
  
  const myBench = useMemo(() => {
    if (selectedDate && frozenRostersByDate.has(selectedDate)) {
      const frozenRoster = frozenRostersByDate.get(selectedDate)!;
      if (frozenRoster.myRoster.length > 0) {
        const directBench = frozenRoster.myRoster.filter(p => !p.isStarter);

        const dayStatsMap = dailyStatsByDate.get(selectedDate);
        return directBench.map(player => {
          const playerId = typeof player.id === 'string' ? parseInt(player.id, 10) : player.id;
          const stats = dayStatsMap?.get(playerId);
          return {
            ...player,
            daily_total_points: stats?.daily_total_points ?? 0,
            daily_stats_breakdown: stats?.daily_stats_breakdown
          };
        });
      }
    }
    return displayMyTeam.filter(p => !p.isStarter);
  }, [selectedDate, frozenRostersByDate, dailyStatsByDate, displayMyTeam]);
  
  const opponentStarters = useMemo(() => {
    if (selectedDate && frozenRostersByDate.has(selectedDate)) {
      const frozenRoster = frozenRostersByDate.get(selectedDate)!;
      if (frozenRoster.oppRoster.length > 0) {
        const directStarters = frozenRoster.oppRoster.filter(p => p.isStarter);

        const dayStatsMap = dailyStatsByDate.get(selectedDate);
        return directStarters.map(player => {
          const playerId = typeof player.id === 'string' ? parseInt(player.id, 10) : player.id;
          const stats = dayStatsMap?.get(playerId);
          return {
            ...player,
            daily_total_points: stats?.daily_total_points ?? 0,
            daily_stats_breakdown: stats?.daily_stats_breakdown
          };
        });
      }
    }
    return displayOpponentTeam.filter(p => p.isStarter);
  }, [selectedDate, frozenRostersByDate, dailyStatsByDate, displayOpponentTeam]);
  
  const opponentBench = useMemo(() => {
    if (selectedDate && frozenRostersByDate.has(selectedDate)) {
      const frozenRoster = frozenRostersByDate.get(selectedDate)!;
      if (frozenRoster.oppRoster.length > 0) {
        const directBench = frozenRoster.oppRoster.filter(p => !p.isStarter);

        const dayStatsMap = dailyStatsByDate.get(selectedDate);
        return directBench.map(player => {
          const playerId = typeof player.id === 'string' ? parseInt(player.id, 10) : player.id;
          const stats = dayStatsMap?.get(playerId);
          return {
            ...player,
            daily_total_points: stats?.daily_total_points ?? 0,
            daily_stats_breakdown: stats?.daily_stats_breakdown
          };
        });
      }
    }
    return displayOpponentTeam.filter(p => !p.isStarter);
  }, [selectedDate, frozenRostersByDate, dailyStatsByDate, displayOpponentTeam]);
  
  // Update starter ID refs (includes dropped players from frozen rosters)
  // This is done via ref so it doesn't cause dependency loops in fetchAllDailyStats
  useEffect(() => {
    const myIds = myStarters.map(p => typeof p.id === 'string' ? parseInt(p.id, 10) : p.id);
    const oppIds = opponentStarters.map(p => typeof p.id === 'string' ? parseInt(p.id, 10) : p.id);
    myStarterIdsRef.current = myIds;
    oppStarterIdsRef.current = oppIds;
  }, [myStarters, opponentStarters]);

  // Calculate total projections for each team
  const myTotalProjection = useMemo(() => {
    return myStarters.reduce((sum, player) => {
      const projection = player.daily_projection?.total_projected_points || 
                        player.goalieProjection?.total_projected_points || 0;
      return sum + projection;
    }, 0);
  }, [myStarters]);

  const opponentTotalProjection = useMemo(() => {
    return opponentStarters.reduce((sum, player) => {
      const projection = player.daily_projection?.total_projected_points || 
                        player.goalieProjection?.total_projected_points || 0;
      return sum + projection;
    }, 0);
  }, [opponentStarters]);

  // Calculate total games remaining for each team (position-aware, respects roster slots)
  const myTeamGamesRemaining = useMemo(() => {
    return calculateEligibleGamesRemaining(myStarters as MatchupPlayer[]);
  }, [myStarters]);

  const opponentTeamGamesRemaining = useMemo(() => {
    return calculateEligibleGamesRemaining(opponentStarters as MatchupPlayer[]);
  }, [opponentStarters]);

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
  // YAHOO/SLEEPER FROZEN SCORING: Team points calculation
  // This ensures past day scores are "locked in" and don't change retroactively
  // ANTI-FLASH: Only update when stats are fully loaded (prevents 0.0 flashing)
  // =============================================================================
  const myTeamPoints = useMemo(() => {
    if (!currentMatchup) {
      return '0.0';
    }

    // PRIORITY 1: Use calculatedDailyTotals (same as weekly selector) - works for ALL users
    if (calculatedDailyTotals && calculatedDailyTotals.size > 0) {
      let total = 0;
      calculatedDailyTotals.forEach((totals) => {
        total += totals.myTotal;
      });
      if (total > 0.01) {
        const score = total.toFixed(1);
        if (!lastScoreRef.current) {
          lastScoreRef.current = { myScore: score, oppScore: '0.0' };
        } else {
          lastScoreRef.current.myScore = score;
        }
        return score;
      }
    }

    // For active users: If stats are currently loading, return last stable score to prevent flashing
    if (statsLoadingRef.current && lastScoreRef.current) {
      return lastScoreRef.current.myScore;
    }

    // PRIORITY 2: Use RPC daily points (server-calculated, most reliable)
    if (myDailyPoints && myDailyPoints.length > 0) {
      const total = myDailyPoints.reduce((sum, pts) => sum + pts, 0);
      if (total > 0.01) {
        const score = total.toFixed(1);
        if (!lastScoreRef.current) {
          lastScoreRef.current = { myScore: score, oppScore: '0.0' };
        } else {
          lastScoreRef.current.myScore = score;
        }
        return score;
      }
    }

    // PRIORITY 3: If daily stats map is empty, use fallback
    if (dailyStatsByDate.size === 0) {
      const fallback = myStarters.reduce((sum, player) => {
        const pts = player.total_points || player.points || 0;
        return sum + pts;
      }, 0);
      const score = fallback.toFixed(1);
      if (!lastScoreRef.current) {
        lastScoreRef.current = { myScore: score, oppScore: '0.0' };
      } else {
        lastScoreRef.current.myScore = score;
      }
      return score;
    }

    // PRIORITY 4: Sum calculatedDailyTotals even if zero (final fallback)
    let total = 0;
    calculatedDailyTotals.forEach((totals) => {
      total += totals.myTotal;
    });

    const score = total.toFixed(1);
    if (!lastScoreRef.current) {
      lastScoreRef.current = { myScore: score, oppScore: '0.0' };
    } else {
      lastScoreRef.current.myScore = score;
    }
    return score;
  }, [currentMatchup, calculatedDailyTotals, dailyStatsByDate, myDailyPoints, myStarters]);

  /**
   * Is the LEFT column genuinely the viewer's own team?
   *
   * Drives the "YOU" badge in the ScoreCard and the lineup's sticky team
   * header. This is deliberately NOT "the left side, always":
   * MatchupService.getMatchupDataById falls back to team1 as the "userTeam"
   * when the viewer isn't a participant, so picking another matchup from the
   * "View Matchup" dropdown puts two strangers' teams on screen. Labelling
   * one of them "YOU" would be worse than labelling neither.
   *
   * Demo/guest views return true on purpose: the demo casts the visitor as
   * the left-hand team (Citrus Crushers), and a first-time visitor is
   * exactly who the badge is for.
   */
  const isOwnTeamOnLeft = useMemo(() => {
    if (userLeagueState !== 'active-user') return true;
    if (!userTeam?.id || !viewingTeamId) return false;
    return viewingTeamId === userTeam.id;
  }, [userLeagueState, userTeam?.id, viewingTeamId]);

  // Owner avatars for the discs (audit M8). Guests see the demo league,
  // whose teams have no owners — the discs keep their initials.
  useEffect(() => {
    if (!league?.id || userLeagueState !== 'active-user') {
      setLeagueTeams([]);
      return;
    }
    let cancelled = false;
    LeagueService.getLeagueTeams(league.id)
      .then(({ teams }) => {
        if (!cancelled) setLeagueTeams(teams);
      })
      .catch((err) => log('WARN: league teams for avatars unavailable:', err));
    return () => {
      cancelled = true;
    };
  }, [league?.id, userLeagueState]);

  const teamAvatars = useMemo<TeamAvatarMap>(() => {
    const map = new Map<string, string | null>();
    for (const t of leagueTeams) map.set(t.id, t.avatar_url ?? null);
    return map;
  }, [leagueTeams]);

  // Left side is the VIEWING team (see viewingTeamId), which is the user's
  // own team only on their own matchup; the opponent object comes from the
  // same league list and may already carry its picture.
  const myTeamAvatarUrl = teamAvatars.get(viewingTeamId ?? userTeam?.id ?? '') ?? null;
  const opponentTeamAvatarUrl = opponentTeam?.avatar_url ?? teamAvatars.get(opponentTeam?.id ?? '') ?? null;

  const opponentTeamPoints = useMemo(() => {
    if (!currentMatchup) {
      return '0.0';
    }

    // PRIORITY 1: Use calculatedDailyTotals (same as weekly selector) - works for ALL users
    if (calculatedDailyTotals && calculatedDailyTotals.size > 0) {
      let total = 0;
      calculatedDailyTotals.forEach((totals) => {
        total += totals.oppTotal;
      });
      // Only use if non-zero (avoid overriding good RPC data with 0s from empty frozen rosters)
      if (total > 0.01) {
        const score = total.toFixed(1);
        if (lastScoreRef.current) {
          lastScoreRef.current.oppScore = score;
        } else {
          lastScoreRef.current = { myScore: '0.0', oppScore: score };
        }
        return score;
      }
    }

    // For active users: If stats are currently loading, return last stable score to prevent flashing
    if (statsLoadingRef.current && lastScoreRef.current) {
      return lastScoreRef.current.oppScore;
    }

    // PRIORITY 2: Use RPC daily points (server-calculated, most reliable for opponent scores)
    // This is critical for AI opponents where frontend enrichment may fail
    if (opponentDailyPoints && opponentDailyPoints.length > 0) {
      const total = opponentDailyPoints.reduce((sum, pts) => sum + pts, 0);
      if (total > 0.01) {
        const score = total.toFixed(1);
        if (lastScoreRef.current) {
          lastScoreRef.current.oppScore = score;
        } else {
          lastScoreRef.current = { myScore: '0.0', oppScore: score };
        }
        return score;
      }
    }

    // PRIORITY 3: If daily stats map is empty, use fallback
    if (dailyStatsByDate.size === 0) {
      const fallback = opponentStarters.reduce((sum, player) => {
        const pts = player.total_points || player.points || 0;
        return sum + pts;
      }, 0);
      const score = fallback.toFixed(1);
      if (lastScoreRef.current) {
        lastScoreRef.current.oppScore = score;
      }
      return score;
    }

    // PRIORITY 4: Sum calculatedDailyTotals even if zero (final fallback)
    let total = 0;
    calculatedDailyTotals.forEach((totals) => {
      total += totals.oppTotal;
    });

    const score = total.toFixed(1);
    if (lastScoreRef.current) {
      lastScoreRef.current.oppScore = score;
    }
    return score;
  }, [currentMatchup, calculatedDailyTotals, dailyStatsByDate, opponentDailyPoints, opponentStarters]);

  // ===========================================================================
  // WIN CHANCE + PROJECTED FINALS (2026-09-01, Sleeper parity audit M1/M2)
  //
  // Expected final for each side = points banked so far + every remaining
  // starter-game's projection for the rest of the week; win chance =
  // Φ(margin / σ). See utils/winProbability.ts for the model.
  //
  // myTotalProjection / opponentTotalProjection above are TODAY's slice only
  // (the starters on the selected date) — fine for the day strip, wrong as a
  // final. projectionsByDate already holds all seven days (the fetch effect
  // walks the whole week), so the rest of the week is summed here without a
  // request. Starters per day follow the same precedence as the day strip:
  // the saved per-date lineup when one exists, else the current lineup —
  // and never the frozen roster of a PAST day the user is browsing, which is
  // why this reads baseCurrentRoster rather than myStarters.
  // ===========================================================================
  const matchupOutlook = useMemo(() => {
    if (!currentMatchup) return null;
    const todayStr = getTodayMST();
    const weekDates = enumerateWeekDates(currentMatchup.week_start_date, currentMatchup.week_end_date);
    if (weekDates.length === 0) return null;

    const baseMyRoster = userLeagueState === 'active-user'
      ? (baseCurrentRoster?.myRoster || myTeam)
      : demoMyTeam;
    const baseOppRoster = userLeagueState === 'active-user'
      ? (baseCurrentRoster?.oppRoster || opponentTeamPlayers)
      : demoOpponentTeam;

    // The live-refresh interval writes fresh game statuses (live / final,
    // period, clock) into myTeam / opponentTeamPlayers only; the base and
    // saved rosters keep their load-time copies. Read schedule status from
    // the freshest object for each player so a game that just went final
    // stops counting as "still to play" without waiting for a full reload.
    const freshGamesById = new Map<number, MatchupPlayer['games']>();
    for (const p of [...myTeam, ...opponentTeamPlayers]) {
      if (p.games && p.games.length > 0) freshGamesById.set(Number(p.id), p.games);
    }

    const startersOn = (date: string, side: 'my' | 'opp') => {
      const frozen = frozenRostersByDate.get(date);
      const saved = side === 'my' ? frozen?.myRoster : frozen?.oppRoster;
      const roster = saved && saved.length > 0 ? saved : (side === 'my' ? baseMyRoster : baseOppRoster);
      return roster
        .filter(p => p.isStarter)
        .map(p => ({ id: p.id, games: freshGamesById.get(Number(p.id)) ?? p.games }));
    };

    const remainingDates = weekDates.filter(d => d >= todayStr);
    const myDays = remainingDates.map(date => ({ date, starters: startersOn(date, 'my') }));
    const oppDays = remainingDates.map(date => ({ date, starters: startersOn(date, 'opp') }));

    // A side with no lineup at all (rosters not loaded yet, a bye week, an
    // opponent whose roster the viewer cannot read) has no schedule to sum,
    // which would read as "they can't score again" — a lie, not a 98%.
    // While games remain, say nothing until both lineups are in hand.
    const weekStillOpen = remainingDates.length > 0;
    const haveBothLineups = myDays.some(d => d.starters.length > 0) && oppDays.some(d => d.starters.length > 0);
    if (weekStillOpen && !haveBothLineups) return null;
    // Likewise until every remaining day's projections have landed (they are
    // requested together on load and resolve within a beat of each other):
    // a half-loaded week would print finals missing whole days.
    const projectionsReady = remainingDates.every(d => projectionsByDate.has(d));
    if (weekStillOpen && !projectionsReady) return null;

    const myRemaining = collectRemainingGames(myDays, projectionsByDate, todayStr);
    const oppRemaining = collectRemainingGames(oppDays, projectionsByDate, todayStr);

    return computeWinProbability(
      { points: parseFloat(myTeamPoints) || 0, remaining: myRemaining },
      { points: parseFloat(opponentTeamPoints) || 0, remaining: oppRemaining },
    );
  }, [
    currentMatchup,
    userLeagueState,
    baseCurrentRoster,
    myTeam,
    opponentTeamPlayers,
    demoMyTeam,
    demoOpponentTeam,
    frozenRostersByDate,
    projectionsByDate,
    myTeamPoints,
    opponentTeamPoints,
  ]);

  // Stored simulation rows speak for team1; the bar speaks for the LEFT team.
  const simulationPerspective: 'team1' | 'team2' =
    currentMatchup && viewingTeamId && viewingTeamId === currentMatchup.team2_id ? 'team2' : 'team1';

  // Projected finals are only interesting while something is left to play;
  // once the week is decided they would just repeat the score.
  const projectedFinals = matchupOutlook && !matchupOutlook.settled
    ? { my: matchupOutlook.myExpectedFinal, opp: matchupOutlook.oppExpectedFinal }
    : null;

  // ARE THE FINALS COMING, OR ARE THEY NOT COMING? (2026-09-03)
  //
  // `projectedFinals` is null for four different reasons and the ScoreCard
  // could not tell them apart, so it simply omitted the "proj 112.4" line -
  // and grew by one 10px line per side the moment the week's projections
  // landed, a few hundred ms AFTER the spinner came down, shoving the day
  // strip and the whole lineup down with it.
  //
  // This is the one reason that is temporary: the remaining days' projections
  // are still in flight. The card holds the line's height open for exactly
  // that case, and for no other - a settled week, a week with nothing left to
  // play, and a matchup whose finals never resolve all keep the tight card
  // they have today rather than carrying a permanent blank line.
  const expectedFinalsPending = useMemo(() => {
    if (!currentMatchup || matchupOutlook) return false;
    const remaining = enumerateWeekDates(
      currentMatchup.week_start_date,
      currentMatchup.week_end_date,
    ).filter(d => d >= getTodayMST());
    if (remaining.length === 0) return false;
    return !remaining.every(d => projectionsByDate.has(d));
  }, [currentMatchup, matchupOutlook, projectionsByDate]);

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
    
    // The URL path is the source of truth for which league's matchup we're viewing.
    // See apps/web/src/pages/matchupUrlSync.ts for the full rationale (Beta→Charlie
    // hijack regression fix from commits 8dc7b06 / c5f6798).
    const syncDecision = syncLeagueFromUrl({ urlLeagueId, activeLeagueId });
    if (syncDecision.action === 'sync-context') {
      log(' [SYNC] URL leagueId differs from activeLeagueId, updating context to match URL:', {
        activeLeagueId,
        urlLeagueId,
      });
      setActiveLeagueId(syncDecision.payload.leagueId);
      return;
    }
    if (syncDecision.action === 'navigate') {
      log(' [EARLY REDIRECT] activeLeagueId set but URL has no leagueId, navigating:', {
        activeLeagueId,
        currentPath: window.location.pathname
      });
      const weekParam = urlWeekId ? `/${urlWeekId}` : '';
      navigate(`/matchup/${syncDecision.payload.leagueId}${weekParam}`, { replace: true });
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
    const activeLeagueIdChanged = prevActiveLeagueIdRef.current !== activeLeagueId;
    
    // CRITICAL: If activeLeagueId changed, ALWAYS bypass cache and reload
    // This ensures league switching works even if URL hasn't updated yet
    if (activeLeagueIdChanged) {
      log(' activeLeagueId changed, bypassing cache:', {
        previous: prevActiveLeagueIdRef.current,
        current: activeLeagueId
      });
    }
    
    // If selectedMatchupId changed, ALWAYS bypass cache and reload
    if (selectedMatchupIdChanged) {
      log(' Selected matchup changed, bypassing cache:', {
        previous: prevSelectedMatchupIdRef.current,
        current: selectedMatchupId
      });
    }
    
    // If values haven't changed AND activeLeagueId hasn't changed AND selectedMatchupId hasn't changed, check cache
    if (!leagueIdChanged && !weekIdChanged && !selectedMatchupIdChanged && !activeLeagueIdChanged && urlLeagueId && urlWeekId) {
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
    prevActiveLeagueIdRef.current = activeLeagueId;
    
    log(' useEffect triggered - starting load', {
      hasUser: !!user,
      userId: user?.id,
      userLeagueState,
      urlLeagueId,
      urlWeekId,
      activeLeagueId,
      selectedMatchupId,
      leagueIdChanged,
      weekIdChanged,
      selectedMatchupIdChanged,
      activeLeagueIdChanged,
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
        image: p.headshot_url || undefined,
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
        goalieMatchupStats: p.position === 'G' ? {
          wins: 0,
          saves: 0,
          shutouts: 0,
          goalsAgainst: 0
        } : undefined,
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
        logger.error('[MATCHUP] Load timeout after 15s - FORCING STOP');
        setError('Loading took too long. Please refresh the page or try again later.');
        setLoading(false);
        loadingRef.current = false; // Force release lock
      }, 15000);
      
      try {
        setLoading(true);
        setError(null);

        // Determine which league to use - URL path is the source of truth.
        // activeLeagueId from LeagueContext may be stale (e.g. first-league default)
        // and using it here would hijack users from /matchup/<beta> into Charlie.
        // Only fall back to activeLeagueId when the URL has no leagueId at all.
        let targetLeagueId: string | null = null;
        let cachedUserLeagues: League[] | null = null;
        let cachedLeagueTeams: Team[] | null = null;

        // Step 1: URL leagueId wins
        if (urlLeagueId) {
          targetLeagueId = urlLeagueId;
          log(' Using leagueId from URL path (source of truth):', targetLeagueId);
        } else if (activeLeagueId) {
          // Step 2: No URL leagueId — fall back to context and sync URL
          targetLeagueId = activeLeagueId;
          log(' No URL leagueId, falling back to activeLeagueId:', targetLeagueId);
          const weekParam = urlWeekId ? `/${urlWeekId}` : '';
          navigate(`/matchup/${targetLeagueId}${weekParam}`, { replace: true });
          return;
        }

        // Step 3: Still no targetLeagueId — use first league as absolute fallback
        if (!targetLeagueId) {
          log(' No leagueId available, fetching user leagues to use first league...');
          
          // Fetch user's leagues if not already cached
          if (!cachedUserLeagues) {
            const { leagues: userLeagues, error: leaguesError } = await LeagueService.getUserLeagues(user.id);
            cachedUserLeagues = userLeagues || [];
            
            if (leaguesError) {
              logger.error('[MATCHUP] Error fetching user leagues:', leaguesError);
              throw leaguesError;
            }
          }
          
          if (cachedUserLeagues.length === 0) {
            logger.error('[MATCHUP] User has no leagues');
            setError('You are not in any leagues');
            setLoading(false);
            loadingRef.current = false;
            return;
          }

          // Use first league as fallback ONLY if activeLeagueId is not set
          const currentLeague = cachedUserLeagues[0];
          targetLeagueId = currentLeague.id;
          log(' Using first league as fallback (no activeLeagueId):', targetLeagueId);
          
          // Redirect to URL with leagueId (and weekId if available)
          const weekParam = urlWeekId ? `/${urlWeekId}` : '';
          navigate(`/matchup/${targetLeagueId}${weekParam}`, { replace: true });
          return;
        }

        log(' LeagueId from URL:', targetLeagueId);

        // The user's team in this league is keyed on (leagueId, userId) — both
        // already known here — but it was awaited further down, AFTER the
        // leagues list and the draft-status gate, so it cost its own serial
        // round trip in the middle of the loader. Start it now and read it at
        // the same place as before. `LeagueService.getUserTeam` resolves to
        // { team: null, error } rather than rejecting, so holding the promise
        // across the awaits below cannot produce an unhandled rejection.
        // (PERF 2026-09-04)
        const userTeamPromise = LeagueService.getUserTeam(targetLeagueId, user.id);

        // Get league data (reuse cached if available)
        let userLeagues: League[] = [];
        let leagueError: any = null;
        
        if (cachedUserLeagues) {
          // Reuse leagues fetched during validation
          userLeagues = cachedUserLeagues;
          log(' Reusing cached user leagues from validation');
        } else {
          // Fetch leagues if not already cached
          const result = await LeagueService.getUserLeagues(user.id);
          userLeagues = result.leagues || [];
          leagueError = result.error;
        }
        
        if (leagueError) {
          logger.error('[MATCHUP] Error fetching leagues for validation:', leagueError);
          throw leagueError;
        }
        
        const currentLeague = userLeagues.find((l: League) => l.id === targetLeagueId);
        if (!currentLeague) {
          logger.error('[MATCHUP] League not found in user leagues:', targetLeagueId);
          // URL is the source of truth — do NOT auto-redirect to activeLeagueId here
          // (that would re-introduce the cross-league hijack bug). Show error instead.
          setError('League not found. Please select a valid league.');
          setLoading(false);
          loadingRef.current = false;
          return;
        }

        log(' Found league:', currentLeague.id, 'draft_status:', currentLeague.draft_status);
        setLeague(currentLeague);

        // Check if draft is completed
        if (currentLeague.draft_status !== 'completed') {
          log(' Draft not completed, cannot view matchups');
          setError('draft_not_completed');
          setLoading(false);
          loadingRef.current = false;
          return;
        }

        // Recompute league matchup scores in the BACKGROUND (2026-09-01
        // efficiency pass). This was awaited before anything rendered — a
        // full network round trip plus, in season, a per-started-week score
        // loop, spent before the user saw a single pixel. Yahoo/ESPN render
        // the stored score immediately and let recomputes land quietly;
        // stored scores here are at most one page-view stale for AI teams
        // (user-team scores are also refreshed by the daily-stats path).
        // Fire it, don't wait for it.
        void MatchupService.updateMatchupScores(currentLeague.id).then(({ error: updateScoresError }) => {
          if (updateScoresError) {
            log('WARN: Background matchup score update failed:', updateScoresError);
          }
        }).catch((error) => {
          log('WARN: Background matchup score update threw:', error);
        });

        log(' Getting user team for league:', currentLeague.id);
        // Get user's team — request started above, alongside the leagues read.
        const { team: userTeamData } = await userTeamPromise;
        if (!userTeamData) {
          logger.error('[MATCHUP] User team not found');
          setError('You do not have a team in this league');
          setLoading(false);
          loadingRef.current = false;
          return;
        }
        log(' Found user team:', userTeamData.id);
        setUserTeam(userTeamData);

        // Extract and store league scoring settings (falls back to shared defaults)
        const goalieScoring = currentLeague.scoring_settings?.goalie || DEFAULT_SCORING.goalie;
        const skaterScoring = currentLeague.scoring_settings?.skater || DEFAULT_SCORING.skater;
        setScoringSettings({
          goalie: {
            wins: goalieScoring.wins ?? DEFAULT_SCORING.goalie.wins,
            saves: goalieScoring.saves ?? DEFAULT_SCORING.goalie.saves,
            shutouts: goalieScoring.shutouts ?? DEFAULT_SCORING.goalie.shutouts,
            goals_against: goalieScoring.goals_against ?? DEFAULT_SCORING.goalie.goals_against
          },
          skater: {
            goals: skaterScoring.goals ?? DEFAULT_SCORING.skater.goals,
            assists: skaterScoring.assists ?? DEFAULT_SCORING.skater.assists,
            power_play_points: skaterScoring.power_play_points ?? DEFAULT_SCORING.skater.power_play_points,
            short_handed_points: skaterScoring.short_handed_points ?? DEFAULT_SCORING.skater.short_handed_points,
            shots_on_goal: skaterScoring.shots_on_goal ?? DEFAULT_SCORING.skater.shots_on_goal,
            blocks: skaterScoring.blocks ?? DEFAULT_SCORING.skater.blocks,
            hits: skaterScoring.hits ?? DEFAULT_SCORING.skater.hits,
            penalty_minutes: skaterScoring.penalty_minutes ?? DEFAULT_SCORING.skater.penalty_minutes
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

        // WEEK-MATH FIX (2026-08-22, found live on prod during launch QA):
        // clamp the anchor to the season start, exactly like matchup
        // GENERATION does (MatchupService.generateMatchupsForLeague). An
        // offseason draft otherwise yields an Aug anchor here, which (a)
        // renders calendar week dates ("Aug 23-29") that contradict the
        // schedule's real week 1 (Sep 28), and (b) collapses
        // getAvailableWeeks to a single week ("WEEK 1/1" for a 27-week
        // season) because an Aug anchor's season-end lands in the past.
        const firstWeek = clampToSeasonStart(getFirstWeekStartDate(draftCompletionDate));
        setFirstWeekStart(firstWeek);

        // Get available weeks
        const weeks = getAvailableWeeks(firstWeek);
        log(` Calculated ${weeks.length} available weeks:`, weeks);
        setAvailableWeeks(weeks);

        // Determine which week to show (from URL or current week)
        let weekToShow: number;
        // Helper: pick best week when current isn't in list — prefer the LAST
        // played week over week 1 so completed seasons land on the final week
        // instead of jumping back to opening week.
        const pickFallbackWeek = (current: number): number => {
          if (weeks.includes(current)) return current;
          const lastWeek = weeks[weeks.length - 1];
          if (lastWeek && current > lastWeek) return lastWeek;
          return weeks[0] || 1;
        };

        // WEEK REDIRECT (2026-09-01 efficiency pass): these were
        // window.location.href — a FULL app reload (re-download, re-parse,
        // re-boot the SPA) on the most common entry into this page: tapping
        // the Matchup tab with no week in the URL. On the native shell that
        // doubled every first visit's cost. Client-side navigate keeps the
        // booted app; the loader re-runs off the new URL alone.
        if (urlWeekId) {
          weekToShow = parseInt(urlWeekId);
          if (isNaN(weekToShow) || !weeks.includes(weekToShow)) {
            const currentWeek = getCurrentWeekNumber(firstWeek);
            weekToShow = pickFallbackWeek(currentWeek);
            navigate(`/matchup/${targetLeagueId}/${weekToShow}`, { replace: true });
            return; // finally releases the lock; the URL change re-runs the loader
          }
        } else {
          const currentWeek = getCurrentWeekNumber(firstWeek);
          weekToShow = pickFallbackWeek(currentWeek);
          navigate(`/matchup/${targetLeagueId}/${weekToShow}`, { replace: true });
          return; // finally releases the lock; the URL change re-runs the loader
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
          if (!cachedLeagueTeams) {
            const { teams } = await LeagueService.getLeagueTeams(currentLeague.id);
            cachedLeagueTeams = teams;
          }
          const leagueTeams = cachedLeagueTeams;

          // Check if ANY matchups exist for this league (via API)
          const anyMatchupsRes = await matchupApi.getLeagueMatchups(currentLeague.id);
          const anyMatchups = (anyMatchupsRes?.data || []) as any[];
          const hasAnyMatchups = anyMatchups.length > 0;

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
            const isDuplicateKey = genError.message?.includes('duplicate key');
            if (isDuplicateKey && hasAnyMatchups) {
              // Matchups already exist — duplicate key is expected.
              // Force regenerate to ensure all current teams are included.
              log(' Duplicate key during generation, force regenerating with current teams...');

              const { error: regenError } = await MatchupService.generateMatchupsForLeague(
                currentLeague.id,
                leagueTeams,
                firstWeek,
                true // Force regenerate - deletes and recreates all matchups
              );

              if (regenError) {
                logger.error('[Matchup] Error during forced regeneration:', regenError);
                setError(`Failed to regenerate matchups: ${regenError.message || 'Unknown error'}`);
                setLoading(false);
                return;
              }
            } else {
              logger.error('[Matchup] Error generating matchups:', genError);
              setError(`Failed to generate matchups: ${genError.message || 'Unknown error'}`);
              setLoading(false);
              return;
            }
          }
          
          log(' Matchup generation completed successfully');
          
          // Read back what generation produced. Retries rather than sleeps —
          // see utils/readUntilPresent.
          const weekMatchupsRes = await readUntilPresent(
            async () => {
              matchupApi.invalidate(`matchups:league:${currentLeague.id}`);
              return matchupApi.getLeagueMatchups(currentLeague.id, weekToShow);
            },
            (res) => ((res?.data as unknown[]) || []).length > 0,
          );
          const allMatchups = (weekMatchupsRes?.data || []) as any[];
          log(' Debug - All matchups for week', weekToShow, ':', allMatchups);

          // Also check ALL weeks via API
          const allWeeksRes = await matchupApi.getLeagueMatchups(currentLeague.id);
          const allWeeksMatchups = allWeeksRes?.data || [];
          const uniqueWeeks = new Set((allWeeksMatchups as any[])?.map((m: any) => m.week_number) || []);
          log(' Debug - All week numbers in database:', Array.from(uniqueWeeks).sort((a, b) => a - b));
          log(' Debug - Requested week', weekToShow, 'exists in database?', uniqueWeeks.has(weekToShow));

          // Also check user's team via API
          const teamsRes = await leagueApi.getTeams(currentLeague.id);
          const allTeamsData = (teamsRes?.data || []) as any[];
          const userTeamData = allTeamsData.find((t: any) => t.owner_id === user.id) || null;
          
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
            logger.error('[Matchup] Matchup still not found after generation for week', weekToShow);
            
            // If matchups exist but user's team isn't in them, this is a serious issue - FORCE REGENERATE
            if (allMatchups && allMatchups.length > 0 && userTeamData) {
              const matchupsArr = allMatchups as any[];
              const teamData = userTeamData as any;
              const userTeamInMatchups = matchupsArr.some((m: any) => 
                m.team1_id === teamData.id || m.team2_id === teamData.id
              );
              
              if (!userTeamInMatchups) {
                logger.error('[Matchup] CRITICAL: Week', weekToShow, 'has matchups but user team', teamData.id, 'is not in any of them!');
                logger.error('[Matchup] FORCING FULL REGENERATION of all matchups...');
                
                // Force delete ALL matchups and regenerate
                await MatchupService.deleteAllMatchupsForLeague(currentLeague.id);
                
                // Get all teams again to ensure we have the complete list
                if (!cachedLeagueTeams) {
                  const { teams } = await LeagueService.getLeagueTeams(currentLeague.id);
                  cachedLeagueTeams = teams;
                }
                const allLeagueTeams = cachedLeagueTeams;
                
                // Verify user's team is in the list
                const userTeamInList = allLeagueTeams.some(t => t.id === teamData.id);
                if (!userTeamInList) {
                  logger.error('[Matchup] CRITICAL: User team is not in the league teams list!');
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
                  logger.error('[Matchup] Error during forced regeneration:', regenError);
                  setError(`Failed to regenerate matchups: ${regenError.message || 'Unknown error'}`);
                  setLoading(false);
                  return;
                }
                
                // Verify again — retrying rather than sleeping.
                const { matchup: finalMatchup } = await readUntilPresent(
                  () => MatchupService.getUserMatchup(currentLeague.id, user.id, weekToShow),
                  (res) => Boolean(res?.matchup),
                );
                
                if (!finalMatchup) {
                  logger.error('[Matchup] Still no matchup after forced regeneration!');
                  setError(`Failed to generate matchup for week ${weekToShow} after forced regeneration. Please refresh and try again.`);
                  setLoading(false);
                  return;
                }
                
                log(' Successfully regenerated and verified matchup exists');
                // Matchup now exists, continue with normal flow below
              } else {
                // COPY FIX (2026-08-22): generation usually SUCCEEDED by this point
                // (the historical miss was a stale client cache, fixed in
                // MatchupService.generateMatchupsForLeague). Don't tell the user
                // generation "failed" — a refresh resolves it.
                setError(`Your week ${weekToShow} matchup isn't loading yet. Refresh the page to try again.`);
                setLoading(false);
                return;
              }
            } else {
              setError(`Your week ${weekToShow} matchup isn't loading yet. Refresh the page to try again.`);
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
              logger.error('[Matchup] Matchup still not found after forced regeneration!');
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

        // CRITICAL: Ensure both teams have team_lineups + fantasy_daily_rosters BEFORE loading roster data
        // This handles AI teams (owner_id = NULL) whose lineups can't be saved via frontend RLS.
        // Must run before getMatchupData/getMatchupDataById which reads from these tables.
        const matchupIdForEnsure = selectedMatchupId || existingMatchup?.id;
        if (matchupIdForEnsure && currentLeague?.id !== DEMO_LEAGUE_ID_FOR_GUESTS) {
          try {
            await matchupApi.ensureRosters(matchupIdForEnsure);
          } catch (err) {
            // Non-fatal — roster data may already exist
            logger.error('[Matchup] ensure-rosters pre-load failed:', err);
          }
        }

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
        
        // 12s, deliberately INSIDE the page's 15s overall budget (2026-09-01):
        // this inner race used to fire at 20s, so the outer timer always won
        // and the user got the generic "Loading took too long" instead of the
        // specific "matchup data" failure. The specific error must be the one
        // that surfaces.
        const timeoutPromise = new Promise<{ data: null; error: Error }>((resolve) => {
          setTimeout(() => {
            resolve({ data: null, error: new Error('getMatchupData timed out after 12 seconds') });
          }, 12000);
        });
        
        const { data: matchupData, error: matchupError } = await Promise.race([
          matchupDataPromise,
          timeoutPromise
        ]);

        if (matchupError) {
          logger.error('[MATCHUP] Error getting matchup data:', matchupError);
          
          // Enhanced error handling for dropdown selections
          if (selectedMatchupId) {
            logger.error('[MATCHUP] Failed to load selected matchup from dropdown:', {
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
            if (matchupError?.message?.includes('has no matchup yet') || matchupError?.message?.includes('No matchup found') || matchupError?.message?.includes('timed out')) {
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
          logger.error('[MATCHUP] No matchup data returned', {
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
            setError(`Week ${weekToShow} has no matchup yet. Retry, or pick another week.`);
            setLoading(false);
            loadingRef.current = false;
            return;
          }
        }
        
        log(' STEP 11: Matchup data loaded successfully');
        
        // Record the matchup that was ACTUALLY loaded, not the one that was
        // selected when the load started.
        //
        // On a first visit `selectedMatchupId` is null while this effect runs,
        // so the cache entry was stamped `matchupId: null`. A few lines below,
        // the effect then sets selectedMatchupId to the matchup it just
        // loaded — which re-runs the effect, finds `null !== <id>`, and both
        // fails the cache-key comparison AND trips the explicit
        // "selectedMatchupId changed → bypass cache" branch. The whole
        // ~20-request load ran a second time on every cold visit to this page.
        if (targetLeagueId && weekToShow) {
          loadedMatchupDataRef.current = {
            leagueId: targetLeagueId,
            weekId: String(weekToShow),
            matchupId: matchupData.matchup?.id ?? selectedMatchupId,
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

        // Populate cachedDailyScores from RPC results (server-calculated, most reliable)
        // This ensures scores display correctly even if frontend enrichment fails
        // (e.g., AI team where opponent roster loading may not work)
        const myDailyPts = matchupData.userTeam.dailyPoints || [];
        const oppDailyPts = matchupData.opponentTeam?.dailyPoints || [];
        if (myDailyPts.length > 0 || oppDailyPts.length > 0) {
          const rpcCachedScores = new Map<string, { myScore: number; oppScore: number; isLocked: boolean }>();
          const [sYear, sMonth, sDay] = matchupData.matchup.week_start_date.split('-').map(Number);
          const rpcTodayStr = getTodayMST();

          for (let i = 0; i < 7; i++) {
            const dayDate = new Date(sYear, sMonth - 1, sDay + i);
            const dateStr = `${dayDate.getFullYear()}-${String(dayDate.getMonth() + 1).padStart(2, '0')}-${String(dayDate.getDate()).padStart(2, '0')}`;
            const isPast = dateStr < rpcTodayStr;

            rpcCachedScores.set(dateStr, {
              myScore: myDailyPts[i] || 0,
              oppScore: oppDailyPts[i] || 0,
              isLocked: isPast
            });
          }
          setCachedDailyScores(rpcCachedScores);

          // Also populate calculatedDailyTotals from RPC so scores show immediately
          const rpcCalculatedTotals = new Map<string, { myTotal: number; oppTotal: number }>();
          for (let i = 0; i < 7; i++) {
            const dayDate = new Date(sYear, sMonth - 1, sDay + i);
            const dateStr = `${dayDate.getFullYear()}-${String(dayDate.getMonth() + 1).padStart(2, '0')}-${String(dayDate.getDate()).padStart(2, '0')}`;
            rpcCalculatedTotals.set(dateStr, {
              myTotal: myDailyPts[i] || 0,
              oppTotal: oppDailyPts[i] || 0
            });
          }
          setCalculatedDailyTotals(rpcCalculatedTotals);
          log(' Populated scores from RPC daily-scores (server-calculated)');
        }
        
        // CRITICAL: Set viewing team names from matchup data (not userTeam state)
        // This ensures correct names are shown when viewing other matchups
        setViewingTeamName(matchupData.userTeam.name);
        setViewingOpponentTeamName(matchupData.opponentTeam?.name || 'Bye Week');
        // Left-hand team's id — drives the "YOU" identity badge. See the
        // state declaration for why this can't be assumed to be the user.
        setViewingTeamId(matchupData.userTeam.id ?? null);

        // Only reset selectedDate when matchup actually changes (not just reloading)
        // Check if we're loading a different matchup than currently displayed
        const isMatchupChange = !previousMatchupId || previousMatchupId !== matchupData.matchup.id;
        if (isMatchupChange) {
          log(' Matchup changed, resetting selectedDate');
          setSelectedDate(null);
          setDailyStatsMap(new Map());
        }
        
        // Set selected matchup ID if not already set.
        //
        // Sync prevSelectedMatchupIdRef in the same breath. That ref is how the
        // effect distinguishes "the user picked a different matchup" (reload,
        // bypass cache) from "we just told ourselves which matchup we loaded"
        // (nothing to do — the data is already in hand). Without the sync the
        // second case looked exactly like the first.
        if (!selectedMatchupId && matchupData.matchup) {
          prevSelectedMatchupIdRef.current = matchupData.matchup.id;
          setSelectedMatchupId(matchupData.matchup.id);
        }
        
        // Track user's actual matchup ID for "(Your Matchup)" label
        // Only set this if user is in this matchup (check if viewing team is user's team)
        if (userTeam && (matchupData.userTeam.id === userTeam.id || matchupData.opponentTeam?.id === userTeam.id)) {
          setUserMatchupId(matchupData.matchup.id);
        }

        // Get opponent team object for display
        if (matchupData.opponentTeam) {
          if (!cachedLeagueTeams) {
            const { teams } = await LeagueService.getLeagueTeams(targetLeagueId);
            cachedLeagueTeams = teams;
          }
          const oppTeam = cachedLeagueTeams.find(t => t.id === matchupData.opponentTeam!.id);
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
        
        // Generate all week dates (Sun-Sat)
        const weekStart = new Date(matchupData.matchup.week_start_date + 'T00:00:00');
        const weekDates: string[] = [];
        for (let i = 0; i < 7; i++) {
          const date = new Date(weekStart);
          date.setDate(weekStart.getDate() + i);
          // Use local timezone formatting to avoid UTC shift from toISOString()
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          weekDates.push(`${year}-${month}-${day}`);
        }
        
        // ============================================================
        // PRE-LOAD ROSTERS FOR ALL DATES (PAST AND FUTURE)
        // CRITICAL: Only load frozen rosters for PAST dates
        // For TODAY/FUTURE, use the current lineup from matchupData.userTeam.roster
        // This prevents stale frozen roster data from showing dropped players
        // ============================================================
        const todayStr = getTodayMST();
        const datesToLoad = weekDates; // Load ALL dates — past, today, AND future

        if (datesToLoad.length > 0) {
          log(' Pre-loading rosters for all week dates:', datesToLoad);

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
          // Query ONLY past dates (not today/future)
          // ============================================================
          const frozenBatchResponse = await matchupApi.getFrozenRosterBatch(matchupData.matchup.id, datesToLoad);
          const allFrozenEntries = frozenBatchResponse.data as any[] | null;

          if (allFrozenEntries && allFrozenEntries.length > 0) {
            // Diagnostic: show unique team_ids in frozen entries vs expected team IDs
            const frozenTeamIds = [...new Set((allFrozenEntries as any[]).map((e: any) => String(e.team_id)))];
            const myTeamId = matchupData.userTeam.id;
            const oppTeamId = matchupData.opponentTeam?.id;
            log(' [frozen-roster-diag] frozenEntries:', allFrozenEntries.length,
              'frozenTeamIds:', frozenTeamIds,
              'myTeamId:', myTeamId,
              'oppTeamId:', oppTeamId);

            // Get all current player IDs from enrichment maps
            const allCurrentIds = new Set([
              ...Array.from(enrichedMyPlayerMap.keys()),
              ...Array.from(enrichedOppPlayerMap.keys())
            ]);

            // Find player IDs that are in frozen rosters but NOT in enrichment maps
            // CRITICAL: This catches both dropped players AND cases where opponent roster
            // was empty (e.g., AI team where frontend failed to load roster)
            const missingIds = [...new Set(
              (allFrozenEntries as any)
                .map((e: any) => String(e.player_id))
                .filter((id: string) => !allCurrentIds.has(id))
            )];

            log(' [frozen-roster-diag] allCurrentIds:', allCurrentIds.size,
              'missingIds:', missingIds.length);

            if (missingIds.length > 0) {
              log(' Found players in frozen rosters missing from enrichment maps:', missingIds.length);

              // Fetch missing players from player directory
              const missingPlayers = await PlayerService.getPlayersByIds(missingIds as string[]);
              log(' Fetched', missingPlayers.length, 'missing players for enrichment');

              // Transform to MatchupPlayer and add to appropriate lookup map
              missingPlayers.forEach(player => {
                // Determine which team this player was on based on frozen roster entries
                const playerEntries = (allFrozenEntries as any).filter((e: any) => String(e.player_id) === String(player.id));
                const wasOnMyTeam = playerEntries.some((e: any) => String(e.team_id) === myTeamId);
                const wasOnOppTeam = playerEntries.some((e: any) => String(e.team_id) === oppTeamId);

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
                  image: p.headshot_url || undefined,
                  isStarter: false,
                  isOnIR: p.status === 'IR' || p.status === 'SUSP',
                  stats: { goals: 0, assists: 0, sog: 0, blk: 0, xGoals: 0 },
                  matchupStats: { goals: 0, assists: 0, sog: 0, blk: 0, xGoals: 0 },
                  games: [],
                  gamesRemaining: 0,
                  isGoalie: p.position === 'G',
                  status: (p.status || null) as any,
                  wasDropped: !wasOnMyTeam && !wasOnOppTeam ? false : undefined
                } as MatchupPlayer;

                if (wasOnMyTeam) {
                  enrichedMyPlayerMap.set(String(player.id), matchupPlayer);
                }
                if (wasOnOppTeam) {
                  enrichedOppPlayerMap.set(String(player.id), matchupPlayer);
                }
              });

              log(' Updated enriched player lookup maps after adding missing players:', {
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
          
          // Build frozen lineups from batch data (no extra API calls needed)
          // allFrozenEntries already has player_id, team_id, roster_date, slot_type, slot_id
          const results = datesToLoad.map((date) => {
            const myTeamId = matchupData.userTeam.id;
            const oppTeamId = matchupData.opponentTeam?.id;

            // Filter batch entries for this date and team
            const myDailyRoster = allFrozenEntries
              ? (allFrozenEntries as any[]).filter((e: any) => e.roster_date === date && String(e.team_id) === myTeamId)
              : [];
            const oppDailyRoster = allFrozenEntries && oppTeamId
              ? (allFrozenEntries as any[]).filter((e: any) => e.roster_date === date && String(e.team_id) === oppTeamId)
              : [];

            // Build my frozen roster (or fallback to current roster)
            const myRoster: MatchupPlayer[] = [];
            const mySlots: Record<string, string> = {};

            if (myDailyRoster.length > 0) {
              myDailyRoster.forEach((entry: any) => {
                const playerId = String(entry.player_id);
                const enrichedPlayer = enrichedMyPlayerMap.get(playerId);

                if (enrichedPlayer) {
                  const isStarter = entry.slot_type === 'active';
                  myRoster.push({
                    ...enrichedPlayer,
                    isStarter
                  } as MatchupPlayer);
                  if (entry.slot_id) {
                    mySlots[playerId] = entry.slot_id;
                  }
                } else if (entry.player_name) {
                  // Server-provided player details fallback
                  const isStarter = entry.slot_type === 'active';
                  const isGoalie = entry.player_position === 'G';
                  myRoster.push({
                    id: Number(entry.player_id),
                    name: entry.player_name,
                    position: entry.player_position || '',
                    team: entry.player_team || '',
                    teamAbbreviation: entry.player_team_abbreviation || entry.player_team || '',
                    points: 0,
                    total_points: 0,
                    image: entry.player_headshot_url || undefined,
                    isStarter,
                    isOnIR: entry.player_status === 'IR' || entry.player_status === 'SUSP',
                    stats: { goals: 0, assists: 0, sog: 0, blk: 0, xGoals: 0 },
                    matchupStats: { goals: 0, assists: 0, sog: 0, blk: 0, xGoals: 0 },
                    games: [],
                    gamesRemaining: 0,
                    isGoalie,
                    status: (entry.player_status || null) as any,
                  } as MatchupPlayer);
                  if (entry.slot_id) {
                    mySlots[playerId] = entry.slot_id;
                  }
                }
              });
            } else {
              // No frozen roster entries for my team on this date.
              // Leave myRoster empty — do NOT fallback to base roster.
              // This ensures myStarters/Date Change Handler know no per-day data exists
              // and can fall through to the correct behavior (base roster via displayMyTeam).
              log(` No frozen roster entries for my team on ${date}, skipping (no fallback)`);
            }

            // Build opponent frozen roster
            const oppRoster: MatchupPlayer[] = [];
            const oppSlots: Record<string, string> = {};

            if (oppDailyRoster.length > 0) {
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
                } else if (entry.player_name) {
                  // Server-provided player details (joined from player_directory).
                  // This fallback is critical for AI teams whose roster_assignments
                  // are blocked by RLS, causing enrichedOppPlayerMap to be empty.
                  const isStarter = entry.slot_type === 'active';
                  const isGoalie = entry.player_position === 'G';
                  oppRoster.push({
                    id: Number(entry.player_id),
                    name: entry.player_name,
                    position: entry.player_position || '',
                    team: entry.player_team || '',
                    teamAbbreviation: entry.player_team_abbreviation || entry.player_team || '',
                    points: 0,
                    total_points: 0,
                    image: entry.player_headshot_url || undefined,
                    isStarter,
                    isOnIR: entry.player_status === 'IR' || entry.player_status === 'SUSP',
                    stats: { goals: 0, assists: 0, sog: 0, blk: 0, xGoals: 0 },
                    matchupStats: { goals: 0, assists: 0, sog: 0, blk: 0, xGoals: 0 },
                    games: [],
                    gamesRemaining: 0,
                    isGoalie,
                    status: (entry.player_status || null) as any,
                  } as MatchupPlayer);
                  if (entry.slot_id) {
                    oppSlots[playerId] = entry.slot_id;
                  }
                }
              });
            } else {
              // No frozen roster entries for opponent on this date.
              // Leave oppRoster empty — do NOT fallback to base roster.
              log(` No frozen roster entries for opponent on ${date}, skipping (no fallback)`);
            }

            return {
              date,
              data: { myRoster, oppRoster, mySlots, oppSlots }
            };
          });

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
        logger.error('[MATCHUP] CRITICAL ERROR loading matchup data:', err);
        logger.error('[MATCHUP] Error details:', {
          message: err.message,
          stack: err.stack,
          name: err.name
        });
        
        // Always set error so user sees something - don't hide errors
        const errorMessage = err.message || 'Failed to load matchup data';
        setError(errorMessage);
        
        // Log if it's a timeout for debugging
        if (errorMessage.includes('timeout')) {
          logger.error('[MATCHUP] TIMEOUT ERROR - Query took too long');
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

  // CRITICAL: selectedDate is intentionally excluded - date changes are handled by a separate useEffect.
  // loadMatchupData is defined inline (not useCallback) due to size/complexity. league/userTeam/currentMatchup
  // are narrowed to ?.id to prevent re-runs on score updates. Other deps (navigate, profile, etc.) are stable
  // or would cause unnecessary full reloads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, userLeagueState, urlLeagueId, urlWeekId, selectedMatchupId, activeLeagueId, matchupReloadNonce]);

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
        
        // Debug: Log roster details for Saturday, Friday, and Today
        
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

  // ============================================================
  // FALLBACK: Direct daily roster fetch when frozen data is empty
  // If frozenRostersByDate has no players for the selected date,
  // fetch per-team frozen rosters directly (same DB query as Roster tab).
  // This catches cases where the batch API returned empty data.
  // ============================================================
  useEffect(() => {
    if (!selectedDate || !currentMatchup || userLeagueState !== 'active-user') return;
    if (!userTeam?.id) return;

    const frozenEntry = frozenRostersByDate.get(selectedDate);
    // If frozen data already has players for this date, skip the direct fetch
    if (frozenEntry && frozenEntry.myRoster.length > 0) return;

    const myTeamId = userTeam.id;
    const oppTeamId = opponentTeam?.id || null;
    const matchupId = currentMatchup.id;

    let cancelled = false;

    const fetchDirect = async () => {
      try {
        // Fetch my team's daily roster entries
        const [myResponse, oppResponse] = await Promise.all([
          matchupApi.getFrozenRoster(matchupId, myTeamId, selectedDate),
          oppTeamId
            ? matchupApi.getFrozenRoster(matchupId, oppTeamId, selectedDate)
            : Promise.resolve({ data: [] })
        ]);

        if (cancelled) return;

        const myEntries = (myResponse?.data || []) as any[];
        const oppEntries = (oppResponse?.data || []) as any[];

        if (myEntries.length === 0 && oppEntries.length === 0) {
          log('[FALLBACK] No daily roster entries found for', selectedDate);
          return; // Truly no data — base roster fallback is correct
        }

        log('[FALLBACK] Direct fetch found entries for', selectedDate, {
          myEntries: myEntries.length,
          oppEntries: oppEntries.length
        });

        // Build roster from entries — use baseCurrentRoster players as enrichment source
        const buildRoster = (entries: any[], basePlayers: MatchupPlayer[]) => {
          const playerMap = new Map(basePlayers.map(p => [String(p.id), p]));
          const roster: MatchupPlayer[] = [];
          const slots: Record<string, string> = {};

          entries.forEach((entry: any) => {
            const playerId = String(entry.player_id);
            const isStarter = entry.slot_type === 'active';
            const basePlayer = playerMap.get(playerId);

            if (basePlayer) {
              roster.push({ ...basePlayer, isStarter } as MatchupPlayer);
            } else if (entry.player_name) {
              // Dropped/traded player — build from server-provided details
              roster.push({
                id: Number(entry.player_id),
                name: entry.player_name,
                position: entry.player_position || '',
                team: entry.player_team || '',
                teamAbbreviation: entry.player_team_abbreviation || entry.player_team || '',
                points: 0, total_points: 0,
                image: entry.player_headshot_url || undefined,
                isStarter,
                isOnIR: false,
                stats: { goals: 0, assists: 0, sog: 0, blk: 0, xGoals: 0 },
                matchupStats: { goals: 0, assists: 0, sog: 0, blk: 0, xGoals: 0 },
                games: [], gamesRemaining: 0,
                isGoalie: entry.player_position === 'G',
                status: null,
              } as MatchupPlayer);
            }
            if (entry.slot_id) slots[playerId] = entry.slot_id;
          });

          return { roster, slots };
        };

        const myBase = baseCurrentRoster?.myRoster || [];
        const oppBase = baseCurrentRoster?.oppRoster || [];
        const { roster: myRoster, slots: mySlots } = buildRoster(myEntries, myBase);
        const { roster: oppRoster, slots: oppSlots } = buildRoster(oppEntries, oppBase);

        if (myRoster.length === 0) return; // No usable data

        // Update frozenRostersByDate with the fetched data
        setFrozenRostersByDate(prev => {
          const next = new Map(prev);
          next.set(selectedDate, { myRoster, oppRoster, mySlots, oppSlots });
          return next;
        });

        // Also update myTeam/opponentTeamPlayers to reflect the fetched roster
        setMyTeam(myRoster);
        setMyTeamSlotAssignments(mySlots);
        if (oppRoster.length > 0) {
          setOpponentTeamPlayers(oppRoster);
          setOpponentTeamSlotAssignments(oppSlots);
        }
      } catch (err) {
        logger.warn('[Matchup] Fallback daily roster fetch failed for', selectedDate, err);
      }
    };

    fetchDirect();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, frozenRostersByDate, currentMatchup?.id, userTeam?.id, opponentTeam?.id]);

  // Refresh matchup when page becomes visible (e.g., navigating back from roster page)
  useEffect(() => {
    if (!user?.id || !league?.id || !userTeam?.id || !urlLeagueId || !urlWeekId) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !loadingRef.current) {
        // Page became visible — refresh IN PLACE (2026-09-01 efficiency
        // pass; was window.location.href, a full app reload every time the
        // user returned to the tab). Same week, same matchup: clear the
        // roster cache and re-run the loader via the nonce. No navigation.
        log(' Page visible, refreshing matchup data...');
        MatchupService.clearRosterCache(userTeam.id, league.id);
        setMatchupReloadNonce(n => n + 1);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
     
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
        // The recompute wrote every matchup's score; re-read the week so the
        // scoreboard strip ticks with the page (one small request, only
        // while the week is in progress, only on this cadence).
        await loadWeekMatchups();
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
        const allTeamsArray: string[] = [];
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
        logger.error('[Matchup] ❌ Error refreshing game statuses:', err);
      }
    };
    
    // Refresh stats, game statuses, AND matchup scores immediately
    // Note: dailyStatsMap will be synced from dailyStatsByDate via useEffect above
    Promise.all([
      fetchAllDailyStats(),
      refreshGameStatuses(),
      updateMatchupScores()
    ]).catch(() => { /* non-blocking */ });
    
    // EGRESS OPTIMIZATION: Refresh every 120 seconds during live games
    // Backend scraper runs every 90s, so 120s polling still catches all updates
    // This reduces egress by ~60% compared to 45s polling
    const intervalId = setInterval(() => {
      Promise.all([
        fetchAllDailyStats(),
        refreshGameStatuses(),
        updateMatchupScores()
      ]).catch(() => { /* non-blocking */ });
    }, 120000); // 120 seconds (was 45s - enterprise egress optimization)
    
    return () => {
      clearInterval(intervalId);
      liveRefreshSetupRef.current = false;
      log(' Stopped live stats refresh (no live games or matchup ended)');
    };
  // Intentionally excludes myTeam/opponentTeamPlayers to prevent infinite loop (refresh updates state
  // -> state change triggers effect -> refresh again). currentMatchup is narrowed to specific fields
  // to prevent re-subscription when unrelated fields (e.g., scores) change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league?.id, currentMatchup?.id, currentMatchup?.week_start_date, currentMatchup?.week_end_date, currentMatchup?.status, userLeagueState, fetchAllDailyStats]);

  // Handle week selection — client-side navigation (2026-09-01 efficiency
  // pass). This was window.location.href: every tap of a week arrow
  // re-downloaded, re-parsed and re-booted the ENTIRE app before the new
  // week even started loading — the single biggest reason week browsing
  // felt nothing like Yahoo/Sleeper. The "React Router navigation loops"
  // the reload was avoiding were stale week-scoped state leaking into the
  // next week's load; resetting that state here removes the hazard the
  // honest way. urlWeekId is in the loader effect's deps, so the URL
  // change re-runs exactly one load.
  const handleWeekChange = useCallback((weekNumber: number) => {
    // Determine league ID based on user state
    const leagueId = (userLeagueState === 'guest' || userLeagueState === 'logged-in-no-league')
      ? DEMO_LEAGUE_ID_FOR_GUESTS
      : league?.id;

    if (!leagueId) return;

    // Week-scoped state must not survive into the next week's load:
    // a stale selectedMatchupId would load LAST week's matchup, and a
    // stale selectedDate would pin the day tabs outside the new week.
    setSelectedMatchupId(null);
    setSelectedDate(null);
    setCurrentMatchup(null);
    setDailyStatsByDate(new Map());
    setDailyStatsMap(new Map());
    setProjectionsByDate(new Map());

    navigate(`/matchup/${leagueId}/${weekNumber}`);
  }, [userLeagueState, league?.id, navigate]);

  // Switch the viewed matchup in place (2026-09-01, Sleeper parity audit M7).
  // One handler for both the scoreboard strip and the "View Matchup" select:
  // clear the roster cache marker and the matchup-scoped state, flag loading,
  // and let the loader effect — which has selectedMatchupId in its deps —
  // fetch the new one. No navigation, no reload; the strip stays on screen
  // with the tapped chip already raised while the lineup below swaps.
  const handleMatchupSwitch = useCallback((matchupId: string) => {
    log(' Matchup switched to:', matchupId);
    loadedMatchupDataRef.current = null;
    setSelectedMatchupId(matchupId);
    setSelectedDate(null);
    setCurrentMatchup(null);
    setCalculatedDailyTotals(new Map());
    setMyTeam([]);
    setOpponentTeamPlayers([]);
    setLoading(true);
  }, []);

  // The strip's LIVE dot. The live-refresh interval writes fresh game
  // statuses into these two rosters every 120s, and between them they cover
  // most of the league's NHL teams on a game night — no extra request. It is
  // a strip-level signal by design: nothing served says which OTHER lineups
  // have a skater on the ice, so no chip guesses (see scoreboard.ts).
  const scoreboardLive = useMemo(
    () => anyGameLive([...myTeam, ...opponentTeamPlayers], getTodayMST()),
    [myTeam, opponentTeamPlayers],
  );

  // ─────────────────────────────────────────────────────────────────────
  // PRESS BOX (2026-09-04): the phone's score block, from the same figures
  // the ScoreCard, the day strip and the sticky bar have always shown.
  // ─────────────────────────────────────────────────────────────────────
  const phoneScore = useMemo(() => {
    if (!currentMatchup) return null;
    const active = userLeagueState === 'active-user';
    const todayStr = getTodayMST();
    const weekDates = enumerateWeekDates(currentMatchup.week_start_date, currentMatchup.week_end_date);
    const inWeek = weekDates.includes(todayStr);
    const focus = selectedDate ?? (inWeek ? todayStr : null);
    const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const dow = (d: string) => DOW[new Date(`${d}T00:00:00`).getDay()];
    const shortDate = (d: string) =>
      new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
    /* `THU · DAY 4/7` while the week is on; its dates when it is not yet
       (or no longer) — a day number for a week that has not started is a
       claim about a day that has not happened. */
    const dayLabel = focus
      ? `${dow(focus)} · DAY ${weekDates.indexOf(focus) + 1}/${weekDates.length}`
      : weekDates.length
        ? `${shortDate(weekDates[0])} – ${shortDate(weekDates[weekDates.length - 1])}`
        : null;
    const days: PressBoxScoreDay[] = weekDates.map((d) => {
      const totals = calculatedDailyTotals?.get(d);
      const ahead = d > todayStr;
      return {
        key: d,
        label: dow(d),
        yours: totals?.myTotal ?? null,
        theirs: totals?.oppTotal ?? null,
        projected: ahead,
        isToday: focus === d,
      };
    });
    const winPct = matchupOutlook ? matchupOutlook.probability * 100 : null;
    const rec = (r: { wins: number; losses: number }) => `${r.wins}–${r.losses}`;
    return {
      you: {
        name: active ? (viewingTeamName || userTeam?.team_name || 'My Team') : 'Citrus Crushers',
        record: active ? rec(myTeamRecord) : '7–3',
        score: parseFloat(myTeamPoints || '0'),
        projection: (matchupOutlook && !matchupOutlook.settled ? matchupOutlook.myExpectedFinal : null) ?? myTotalProjection ?? null,
        gamesLeft: myTeamGamesRemaining ?? null,
        winPct,
      },
      them: {
        name: active ? (viewingOpponentTeamName || opponentTeam?.team_name || 'Bye Week') : 'Thunder Titans',
        record: active ? rec(opponentTeamRecord) : '9–1',
        score: parseFloat(opponentTeamPoints || '0'),
        projection: (matchupOutlook && !matchupOutlook.settled ? matchupOutlook.oppExpectedFinal : null) ?? opponentTotalProjection ?? null,
        gamesLeft: opponentTeamGamesRemaining ?? null,
        winPct: winPct != null ? 100 - winPct : null,
      },
      dayLabel,
      days,
      tonight: inWeek
        ? (userLeagueState === 'active-user' ? myTeam : demoMyTeam).filter(
            (p) => p.isStarter && (p.games ?? []).some((g) => (g.game_date ?? '').slice(0, 10) === todayStr),
          ).length
        : null,
      today: inWeek ? todayStr : null,
    };
  }, [
    currentMatchup, userLeagueState, selectedDate, calculatedDailyTotals, matchupOutlook,
    viewingTeamName, userTeam?.team_name, myTeamRecord, myTeamPoints, myTotalProjection,
    myTeamGamesRemaining, viewingOpponentTeamName, opponentTeam?.team_name, opponentTeamRecord,
    opponentTeamPoints, opponentTotalProjection, opponentTeamGamesRemaining, myTeam, demoMyTeam,
  ]);

  /** `‹ WK 1 ›` in the header: the neighbours of the viewed week, when they exist. */
  const weekIndex = availableWeeks.indexOf(selectedWeek);
  const prevWeek = weekIndex > 0 ? availableWeeks[weekIndex - 1] : null;
  const nextWeek = weekIndex >= 0 && weekIndex < availableWeeks.length - 1 ? availableWeeks[weekIndex + 1] : null;

  /** The league's other matchups as chips — the phone's scoreboard strip. */
  const matchupChips = useMemo(() => {
    /* `Bench Bosses` → `BB`, `Sin Bin Saints` → `SBS`, `Team 1` → `T1`: the
       initials of each word, three at most — the way a scoreboard ticker
       names a club. Three letters of one word (`BEN · SIN`) read as nothing. */
    const abbr = (name: string | null | undefined) =>
      (name || '?')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 3)
        .map((w) => w[0])
        .join('')
        .toUpperCase();
    return allWeekMatchups.map((m) => ({
      key: m.id,
      label: `${abbr(m.team1_name)} · ${m.team2_id ? abbr(m.team2_name) : 'BYE'}`,
    }));
  }, [allWeekMatchups]);

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

  /**
   * LOADING CEILING (2026-08-27)
   *
   * A failed FIRST load left this page on "Loading the matchup…" forever.
   * Verified in a browser: still spinning at 24 seconds, with no error, no
   * retry and no way out — on the page managers open most during a week.
   *
   * Both exits were closed, each by a reasonable-looking decision:
   *
   *   1. The initial-load catch deliberately does `setError(null)` and keeps
   *      `loading` true, to stop a transient error flashing during a race. So
   *      `actualLoading`'s `if (!hasData && !error) return true` never becomes
   *      false — no data ever arrives, and the error that would release it has
   *      just been cleared.
   *   2. The error UI below is gated on `hasInitializedRef.current`, and that
   *      same catch path deliberately does NOT set it. So even an error that
   *      survived could not render.
   *
   * The 15s timeout further down does not cover this: it lives in a different
   * load path from the one that fails first.
   *
   * Suppressing a TRANSIENT error during a race is right. Suppressing a
   * TERMINAL one is how you ship an infinite spinner. This bounds it: if the
   * first load has still not succeeded by the ceiling, say so and let the
   * existing retry UI become reachable. A load that succeeds later still wins,
   * because every success path sets `hasInitializedRef` and `actualLoading`
   * returns false on it before anything else is considered.
   *
   * The timer itself lives in useLoadCeiling so it can be TESTED — this file
   * is 5,600 lines with no page-level test, so inline it would have been a
   * load-state fix with no coverage, which is how the original bug survived.
   * See hooks/__tests__/useLoadCeiling.test.ts.
   */
  useLoadCeiling(
    hasInitializedRef,
    () => {
      logger.error('[Matchup] initial load exceeded the ceiling — surfacing an error instead of spinning');
      hasInitializedRef.current = true;
      setLoading(false);
      setError('We couldn\u2019t load this matchup. Check your connection and try again.');
    },
    MATCHUP_LOAD_CEILING_MS,
  );

  // Apply minimum display time (1000ms) to prevent jarring flash effect
  // This ensures a single, smooth loading screen without cycling
  const shouldShowLoading = useMinimumLoadingTime(actualLoading, PB_LOADING_MIN_MS);
  
  // Playoff champion / in-progress banner data (fantasy leagues only)
  const playoffChampion = usePlayoffChampion(
    league?.id || activeLeagueId || null,
    activeLeagueFormat?.leagueType || null,
  );

  // Redirect pool leagues to their pool page
  const _leagueType = activeLeagueFormat?.leagueType;
  if (isPoolLeague(_leagueType) && activeLeagueId) {
    return <Navigate to={getPoolRoute(_leagueType!, activeLeagueId)} replace />;
  }

  // Early return for loading - must be after all hooks are declared
  if (shouldShowLoading) {
    // PR3: the league chrome over the match's skeleton below lg; Stormy from lg.
    return (
      <PressBoxPageLoading
        kind="matchup"
        message="Loading the matchup…"
        chrome={{ leagueId: league?.id ?? activeLeagueId ?? '', leagueName: league?.name ?? '' }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-pastel-surface relative w-full">
      {/* Desktop Navbar - Hidden on mobile */}
      <div className="hidden lg:block">
        <Navbar />
      </div>
      
      {/*
        * PRESS BOX (2026-09-04): the Match screen, artboard 1a.
        *
        * Below `lg` the sticky score bar of 2026-09-01 gives way to the
        * shared LeagueHeader — identity, `‹ WK n ›`, and the Match / Team /
        * Players / League strip — over the score block, which carries what
        * that bar and the ScoreCard showed: both names and records, the two
        * scores at 40px, projection · games left · win chance, the bar with
        * its 50% tick, and the seven days. The week selector, the scoreboard
        * strip, the ScoreCard, the day strip and the Top Performers card are
        * the desktop's from `lg` and are not rendered below it.
        */}
      <PressBoxLeagueChrome
        weekLabel={currentMatchup ? `WK ${selectedWeek}` : null}
        onWeekPrev={prevWeek !== null ? () => handleWeekChange(prevWeek) : null}
        onWeekNext={nextWeek !== null ? () => handleWeekChange(nextWeek) : null}
        leagueId={league?.id ?? activeLeagueId ?? ''}
        leagueName={league?.name ?? ''}
      />

      {/* MOBILE: Full-screen scrollable content / DESKTOP: Grid layout */}
      <main className={cn(
        "w-full",
        // Mobile: Full height scrollable, no padding for navbar
        "lg:pt-24 lg:pb-8",
        // Mobile: Account for bottom nav
        "pb-app-chrome"
      )}>
        <div className="w-full m-0 p-0">
          {/* Desktop: 3-column grid / Mobile: Single column, content only */}
          <div className={cn(
            "flex flex-col lg:grid lg:gap-4 xl:gap-6 lg:px-4 xl:px-6 lg:mx-0 lg:w-screen lg:relative lg:left-1/2 lg:-translate-x-1/2",
            userLeagueState === 'active-user' && league?.id
              ? "lg:grid-cols-[200px_1fr_280px] xl:grid-cols-[220px_1fr_340px]"
              : "lg:grid-cols-[200px_1fr] xl:grid-cols-[220px_1fr]"
          )}>
            {/* Main Content - MOBILE: Full width, full height / DESKTOP: Scrollable panel */}
            <div className="min-w-0 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto px-0 lg:px-4 order-1 lg:order-2">
              {/* Playoff status banner — only for fantasy leagues with a generated bracket */}
              {(league?.id || activeLeagueId) && playoffChampion.status === 'completed' && (
                <Card className="mb-4 border-amber-700/60 bg-gradient-to-br from-amber-950/40 via-yellow-950/40 to-orange-950/40">
                  <CardContent className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4">
                    <div className="flex items-center gap-3">
                      <Trophy className="w-6 h-6 text-amber-400 shrink-0" aria-hidden="true" />
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wider text-amber-400">
                          Season Complete
                        </div>
                        <div className="text-base font-bold text-pastel-cream">
                          Champion: {playoffChampion.championTeamName}
                        </div>
                      </div>
                    </div>
                    <Button asChild size="sm" variant="default">
                      {/* T11a link fix (2026-08-09): route is
                          /league/:leagueId/playoffs (App.tsx:192), not
                          /playoffs/:leagueId. Was silently 404'ing. */}
                      <Link to={`/league/${league?.id || activeLeagueId}/playoffs`}>View Bracket</Link>
                    </Button>
                  </CardContent>
                </Card>
              )}
              {(league?.id || activeLeagueId) && playoffChampion.status === 'in_progress' && (
                <div className="mb-4 flex items-center justify-between px-3 py-2 rounded-md border border-white/10 bg-white/5 text-sm">
                  <span className="text-white/55">Playoffs in Progress</span>
                  {/* T11a link fix (2026-08-09): same as above —
                      /league/:leagueId/playoffs, not /playoffs/:leagueId. */}
                  <Link
                    to={`/league/${league?.id || activeLeagueId}/playoffs`}
                    className="font-medium text-primary hover:underline"
                  >
                    View Bracket
                  </Link>
                </div>
              )}
              {/* Header Section - Clean and Professional with Citrus Colors.
                  PRESS BOX (2026-09-04): desktop only — the phone steps weeks
                  from the header. */}
              <div className="hidden lg:block mb-6">
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
                  {/* Matchup Viewer Dropdown - Show all matchups for current week.
                      Desktop only since the scoreboard strip (M7): on a phone the
                      strip below is the scoreboard — every matchup is a tappable
                      button one flick away, with the viewer's chip ringed — and
                      this control was a third row of chrome above the first
                      score. On desktop it stays as the compact keyboard path
                      next to the week selector; the rail in the aside is the
                      visual one. Both call handleMatchupSwitch. */}
                  {userLeagueState === 'active-user' && allWeekMatchups.length > 0 && (
                    <div className="hidden lg:flex lg:flex-row lg:items-center gap-2">
                      <label className="text-xs sm:text-sm font-medium text-white/55">View Matchup:</label>
                      <Select
                        value={selectedMatchupId || currentMatchup?.id || ''}
                        onValueChange={handleMatchupSwitch}
                      >
                        <SelectTrigger className="w-full sm:w-[280px]">
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

              {/* MOBILE: League scoreboard strip (2026-09-01, audit M7). Sits above
                  the ScoreCard and OUTSIDE the currentMatchup gate below, so a tap
                  that swaps the viewed matchup leaves the ticker on screen with the
                  tapped chip raised while the lineup reloads. Live scores only — the
                  league endpoint serves no projections for other matchups. The
                  desktop rail lives in the left aside. */}
              {/* PRESS BOX (2026-09-04): the strip is now a chip row under
                  the score block — one chip per matchup, the viewed one
                  cream — calling the same handleMatchupSwitch. Live scores
                  for the others live on League HQ's cards. */}
              {userLeagueState === 'active-user' && allWeekMatchups.length > 1 && (
                <PressBoxChips
                  /* pb-2.5 -mb-2 (PR18): the chips' 44px hit areas (pb-hit-y)
                     are clipped by this scroller, so its padding box is
                     grown and the margin pulls the layout back. */
                  className={`${PB_TYPE} lg:hidden px-3 pt-2 pb-2.5 -mb-2 overflow-x-auto scrollbar-hide`}
                  label="League matchups"
                  outlined
                  compact
                  chips={matchupChips}
                  activeKey={selectedMatchupId || currentMatchup?.id || ''}
                  onSelect={(id) => {
                    if (id !== (selectedMatchupId || currentMatchup?.id)) handleMatchupSwitch(id);
                  }}
                />
              )}

          {/* Error State - Show friendly message for demo/guest, retry for logged-in users */}
          {!loading && hasInitializedRef.current && !shouldShowLoading && error && (
            <div className="text-center py-12 max-w-lg mx-auto">
              {userLeagueState === 'guest' || userLeagueState === 'logged-in-no-league' ? (
                <div>
                  <p className="text-white/55 text-base mb-6">
                    {error}
                  </p>
                  <LeagueCreationCTA
                    title="Start Your Fantasy League"
                    description="Create your league, draft players, and compete in weekly matchups."
                  />
                </div>
              ) : error === 'draft_not_completed' ? (
                <div className="max-w-md mx-auto text-center">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-pastel-sage/20 flex items-center justify-center">
                    <span className="text-2xl">🏒</span>
                  </div>
                  <h3 className="text-lg font-bold text-pastel-cream mb-2">Draft Your Team First</h3>
                  <p className="text-sm text-white/55 mb-4">
                    Weekly matchups open as soon as your league finishes its draft.
                  </p>
                  <Button onClick={() => navigate(`/draft-v2/${activeLeagueId}`)}>
                    Go to Draft Room
                  </Button>
                </div>
              ) : (
                <div className="max-w-md mx-auto text-center">
                  <p className="text-white/55 text-base mb-4">{error}</p>
                  <Button variant="outline" onClick={() => window.location.reload()}>Retry</Button>
                </div>
              )}
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
          
          {phoneScore && (
            <div className="lg:hidden">
              <PressBoxScoreBlock
                you={phoneScore.you}
                them={phoneScore.them}
                dayLabel={phoneScore.dayLabel}
                days={phoneScore.days}
                /* A day tile toggles that day; the day already showing goes
                   back to the full week — the old FULL WEEK button. */
                onDayPress={(d) => d.key && setSelectedDate(selectedDate === d.key ? null : d.key)}
              />
            </div>
          )}
          <div className="hidden lg:block">
          <ScoreCard
            seasonDormant={seasonStatus.isDormant}
            myTeamName={userLeagueState === 'active-user' ? (viewingTeamName || userTeam?.team_name || 'My Team') : 'Citrus Crushers'}
            myTeamRecord={userLeagueState === 'active-user' ? myTeamRecord : { wins: 7, losses: 3 }}
            opponentTeamName={userLeagueState === 'active-user' ? (viewingOpponentTeamName || opponentTeam?.team_name || 'Bye Week') : 'Thunder Titans'}
            opponentTeamRecord={userLeagueState === 'active-user' ? opponentTeamRecord : { wins: 9, losses: 1 }}
            myTeamPoints={myTeamPoints}
            opponentTeamPoints={opponentTeamPoints}
            myTeamAvatarUrl={myTeamAvatarUrl}
            opponentTeamAvatarUrl={opponentTeamAvatarUrl}
            myTeamGamesRemaining={myTeamGamesRemaining}
            opponentTeamGamesRemaining={opponentTeamGamesRemaining}
            myTeamProjection={myTotalProjection}
            opponentTeamProjection={opponentTotalProjection}
            myTeamExpectedFinal={projectedFinals?.my}
            opponentTeamExpectedFinal={projectedFinals?.opp}
            expectedFinalsPending={expectedFinalsPending}
            winProbability={matchupOutlook ? matchupOutlook.probability * 100 : undefined}
            // A stored Monte Carlo row (matchup_simulations) overrides the
            // formula when one exists and is fresh. Guests view a demo
            // matchup through the public API, which has no simulation route.
            matchupId={userLeagueState === 'active-user' ? currentMatchup.id : undefined}
            simulationPerspective={simulationPerspective}
            isOwnTeam={isOwnTeamOnLeft}
          />
          </div>
          
          {/* Weekly Schedule - Show for both active users AND guests (the weekly date selector they love!)
              `compact`: on a phone the "Week Overview" header row is dropped
              (audit M8) — the day cards are self-explanatory and the row was
              the third band of chrome above the first player.
              PRESS BOX (2026-09-04): desktop only; the score block's day
              strip is the phone's. */}
          {currentMatchup && (
            <div className="hidden lg:block mb-6">
              <WeeklySchedule
                weekStart={currentMatchup.week_start_date}
                weekEnd={currentMatchup.week_end_date}
                onDayClick={setSelectedDate}
                selectedDate={selectedDate}
                team1Name={userLeagueState === 'active-user' ? (viewingTeamName || undefined) : 'Citrus Crushers'}
                team2Name={userLeagueState === 'active-user' ? (viewingOpponentTeamName || undefined) : 'Thunder Titans'}
                calculatedDailyTotals={calculatedDailyTotals}
                compact
              />
            </div>
          )}

          {/* Main Lineup View */}
          <div className="mt-6 matchup-wrapper" style={{ boxSizing: 'border-box', padding: 0, margin: 0 }}>
            {userLeagueState === 'logged-in-no-league' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8 matchup-grid" style={{ width: '100%', boxSizing: 'border-box', margin: 0, padding: 0 }}>
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
                {/* Pass pre-calculated totals to prevent flicker from async data loading
                    MatchupComparison displays pre-calc values immediately (no flicker)
                    And recalculates in background to update if needed */}
                {/* PRESS BOX (2026-09-04): LINEUPS / BENCH / TONIGHT · n. Orange
                    underline here where the header strip uses sage: sage is
                    where you are in the league, orange what you are looking at
                    inside a screen. TONIGHT is the day view of today, one tap. */}
                {isMobile && phoneScore && (
                  <PressBoxTabs
                    className="mb-1"
                    label="Matchup view"
                    activeKey={
                      phoneSection === 'bench'
                        ? 'bench'
                        : phoneSection === 'categories'
                          ? 'categories'
                          : phoneScore.today && selectedDate === phoneScore.today
                            ? 'tonight'
                            : 'lineups'
                    }
                    onSelect={(k) => {
                      if (k === 'bench') {
                        setPhoneSection('bench');
                      } else if (k === 'categories') {
                        setPhoneSection('categories');
                      } else if (k === 'tonight') {
                        setPhoneSection('lineups');
                        setSelectedDate(phoneScore.today);
                      } else {
                        setPhoneSection('lineups');
                        if (phoneScore.today && selectedDate === phoneScore.today) setSelectedDate(null);
                      }
                    }}
                    tabs={[
                      { key: 'lineups', label: 'Lineups' },
                      { key: 'categories', label: 'Categories' },
                      { key: 'bench', label: 'Bench' },
                      ...(phoneScore.tonight !== null
                        ? [{ key: 'tonight', label: `Tonight · ${phoneScore.tonight}` }]
                        : []),
                    ]}
                  />
                )}
                {/* CATEGORIES (2026-09-05, artboard 1a): the week's totals by
                    counting stat, both sides, from the starters' matchupStats. */}
                {isMobile && phoneSection === 'categories' ? (
                  <PressBoxMatchupCategories
                    yours={displayStarters as MatchupPlayer[]}
                    theirs={displayOpponentStarters as MatchupPlayer[]}
                    yourName={phoneScore?.you.name ?? 'You'}
                    theirName={phoneScore?.them.name ?? 'Them'}
                  />
                ) : (
                <MatchupComparison
                  variant={isMobile ? 'pressbox' : 'default'}
                  section={phoneSection === 'categories' ? 'lineups' : phoneSection}
                  userStarters={displayStarters as MatchupPlayer[]}
                  opponentStarters={displayOpponentStarters as MatchupPlayer[]}
                  userBench={myBench as MatchupPlayer[]}
                  opponentBench={opponentBench as MatchupPlayer[]}
                  userSlotAssignments={displayMyTeamSlotAssignments}
                  opponentSlotAssignments={displayOpponentTeamSlotAssignments}
                  onPlayerClick={handlePlayerClick}
                  selectedDate={selectedDate}
                  dailyStatsMap={(selectedDate ? dailyStatsByDate.get(selectedDate) : dailyStatsMap) as any}
                  onTotalsCalculated={handleTotalsCalculated}
                  calculatedDailyTotals={calculatedDailyTotals}
                  weeklyUserTotal={(() => {
                    // For weekly view, use sum of calculatedDailyTotals (same as weekly selector)
                    // This ensures we match what the weekly selector shows
                    if (!selectedDate && calculatedDailyTotals && calculatedDailyTotals.size >= 7) {
                      let total = 0;
                      calculatedDailyTotals.forEach((totals) => {
                        total += totals.myTotal;
                      });
                      return total;
                    }
                    // Fallback to myTeamPoints
                    return parseFloat(myTeamPoints || '0');
                  })()}
                  weeklyOpponentTotal={(() => {
                    // For weekly view, use sum of calculatedDailyTotals (same as weekly selector)
                    // This ensures we match what the weekly selector shows
                    if (!selectedDate && calculatedDailyTotals && calculatedDailyTotals.size >= 7) {
                      let total = 0;
                      calculatedDailyTotals.forEach((totals) => {
                        total += totals.oppTotal;
                      });
                      return total;
                    }
                    // Fallback to opponentTeamPoints
                    return parseFloat(opponentTeamPoints || '0');
                  })()}
                  scoringSettings={scoringSettings}
                  userTeamName={userLeagueState === 'active-user' ? (viewingTeamName || userTeam?.team_name || 'My Team') : 'Citrus Crushers'}
                  opponentTeamName={userLeagueState === 'active-user' ? (viewingOpponentTeamName || opponentTeam?.team_name || 'Bye Week') : 'Thunder Titans'}
                  isOwnTeam={isOwnTeamOnLeft}
                />
                )}
              </>
            )}
          </div>
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
              <p className="text-white/55 mb-4">No matchup data available.</p>
              <p className="text-sm text-white/55 mb-4">This may be because:</p>
              <ul className="text-sm text-white/55 mb-4 text-left max-w-md mx-auto">
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

            {/* Dynamic Matchup Sidebar - Compact on mobile, full sidebar on desktop */}
            {/* Mobile: Rendered BELOW lineup (users see their players first, then Top Performers) */}
            {/* PRESS BOX (2026-09-04): not drawn below lg — the artboard's
                Match screen carries no card under the rows, and the rows
                themselves print every figure this card ranked. */}
            <div className="hidden order-3">
              <MatchupSidebar
                myStarters={weeklyMyStarters}
                opponentStarters={weeklyOpponentStarters}
                myTeamScore={parseFloat(myTeamPoints) || 0}
                opponentTeamScore={parseFloat(opponentTeamPoints) || 0}
                myTeamName={userLeagueState === 'active-user' ? (userTeam?.team_name || 'My Team') : 'Citrus Crushers'}
                opponentTeamName={userLeagueState === 'active-user' ? (opponentTeam?.team_name || 'Opponent') : 'Thunder Titans'}
                myTeamProjection={myTotalProjection}
                opponentTeamProjection={opponentTotalProjection}
                onPlayerClick={(player) => {
                  setSelectedPlayer(player as any);
                  setIsPlayerDialogOpen(true);
                }}
              />
            </div>
            {/* Desktop: Sticky sidebar */}
            <aside className="hidden lg:block w-full lg:w-auto order-2 lg:order-1">
              <div className="lg:sticky lg:top-24 space-y-4">
                {/* DESKTOP: the league scoreboard as a rail beside the sidebar
                    (audit M7) — same chips as the phone strip, stacked. */}
                {userLeagueState === 'active-user' && allWeekMatchups.length > 0 && (
                  <ScoreboardStrip
                    layout="rail"
                    matchups={allWeekMatchups}
                    ownMatchupId={userMatchupId}
                    ownTeamId={userTeam?.id}
                    viewedMatchupId={selectedMatchupId || currentMatchup?.id}
                    onSelect={handleMatchupSwitch}
                    week={selectedWeek}
                    live={scoreboardLive}
                    teamAvatars={teamAvatars}
                  />
                )}
                <MatchupSidebar
                  myStarters={weeklyMyStarters}
                  opponentStarters={weeklyOpponentStarters}
                  myTeamScore={parseFloat(myTeamPoints) || 0}
                  opponentTeamScore={parseFloat(opponentTeamPoints) || 0}
                  myTeamName={userLeagueState === 'active-user' ? (userTeam?.team_name || 'My Team') : 'Citrus Crushers'}
                  opponentTeamName={userLeagueState === 'active-user' ? (opponentTeam?.team_name || 'Opponent') : 'Thunder Titans'}
                  myTeamProjection={myTotalProjection}
                  opponentTeamProjection={opponentTotalProjection}
                  onPlayerClick={(player) => {
                    setSelectedPlayer(player as any);
                    setIsPlayerDialogOpen(true);
                  }}
                />
              </div>
            </aside>

            {/* Notifications Panel - Right side on desktop, hidden on mobile */}
            {userLeagueState === 'active-user' && league?.id && (
              <aside className="hidden lg:block order-3">
                <div className="lg:sticky lg:top-24 h-[calc(100vh-7rem)] bg-pastel-surface-tile ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)] overflow-hidden">
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
      {/* Footer - Hidden on mobile */}
      <div className="hidden lg:block">
        <HockeyFooter variant="app" />
      </div>
    </div>
  );
};

export default Matchup;