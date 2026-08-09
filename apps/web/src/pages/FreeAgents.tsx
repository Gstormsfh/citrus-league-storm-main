import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams, useNavigate, Navigate } from 'react-router-dom';
import {
  HockeyFooter,
  SlateIcon,
  CrossedSticksIcon,
  PuckIcon,
  ScoreboardIcon,
  XGModelIcon,
  ShiftIcon,
  MaskIcon,
  RangeIcon,
  MascotPortrait,
  StormyLoading,
} from '@/components/citrus2';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import { leagueApi } from '@/api/leagues';
import { matchupApi } from '@/api/matchups';
import { rosterApi } from '@/api/rosters';
import Navbar from '@/components/Navbar';
import MobileMenuButton from '@/components/MobileMenuButton';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { Calendar, TrendingUp, Filter, List, Grid, Star, Info, ArrowUpDown, ArrowUp, ArrowDown, AlertTriangle, Loader2 } from 'lucide-react';
import { useMinimumLoadingTime } from '@/hooks/useMinimumLoadingTime';
import { PlayerService, Player } from '@/services/PlayerService';
import { LeagueService, League } from '@/services/LeagueService';
import { ScheduleService, NHLGame } from '@/services/ScheduleService';
import { WaiverService } from '@/services/WaiverService';
import { MatchupService } from '@/services/MatchupService';
import { getDraftCompletionDate, getFirstWeekStartDate, getCurrentWeekNumber, getWeekStartDate, getWeekEndDate } from '@/utils/weekCalculator';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import PlayerStatsModal from '@/components/PlayerStatsModal';
import { HockeyPlayer } from '@/components/roster/HockeyPlayerCard';
import { isGuestMode, shouldBlockGuestOperation } from '@/utils/guestHelpers';
import { DEMO_LEAGUE_ID_FOR_GUESTS } from '@/services/DemoLeagueService';
import { LeagueCreationCTA } from '@/components/LeagueCreationCTA';
import { getPlayerWithSeasonStats } from '@/utils/playerStatsHelper';
import { getTodayMST, formatWaiverProcessTime } from '@/utils/timezoneUtils';
import { COLUMNS } from '@/utils/queryColumns';
import LeagueNotifications from '@/components/matchup/LeagueNotifications';
import { GameLogosBar } from '@/components/matchup/GameLogosBar';
import { logger } from '@/utils/logger';
import { ScoringCalculator } from '@/utils/scoringUtils';
import { isPoolLeague, getPoolRoute } from '@/utils/leagueTypeHelpers';
import { DropPlayerForAddDialog } from '@/components/freeagents/DropPlayerForAddDialog';
import { ArrowLeftRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

// Returns extra Tailwind classes for the +Add button based on waiver state.
const addBtnColorCls = (p: Player) => p.is_on_waivers
  ? 'bg-amber-500 hover:bg-amber-600 text-white border-amber-600'
  : 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-700';

// Helper function to format position for display (L -> LW, R -> RW)
const formatPositionForDisplay = (position: string): string => {
  const pos = position?.toUpperCase() || '';
  if (pos === 'L' || pos === 'LEFT' || pos === 'LEFTWING') return 'LW';
  if (pos === 'R' || pos === 'RIGHT' || pos === 'RIGHTWING') return 'RW';
  if (pos.includes('LW')) return 'LW';
  if (pos.includes('RW')) return 'RW';
  if (pos.includes('C') && !pos.includes('LW') && !pos.includes('RW')) return 'C';
  if (pos.includes('D')) return 'D';
  if (pos.includes('G')) return 'G';
  return position; // Return original if no match
};

const FreeAgents = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const { userLeagueState, activeLeagueId, activeLeagueFormat, isChangingLeague } = useLeague();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState('');
  const [positionFilter, setPositionFilter] = useState('ALL');
  const [activeTab, setActiveTab] = useState('available');
  const [viewMode, setViewMode] = useState<'summary' | 'all'>('summary');
  const [players, setPlayers] = useState<Player[]>([]);
  const [watchlist, setWatchlist] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [rosterLookupFailed, setRosterLookupFailed] = useState(false);
  const [leagueId, setLeagueId] = useState<string | null>(null);
  
  // Tab reset mechanism - reset to default tab when league changes
  const previousLeagueIdRef = useRef(activeLeagueId);
  useEffect(() => {
    if (previousLeagueIdRef.current !== activeLeagueId && previousLeagueIdRef.current !== null) {
      setActiveTab("available"); // Reset to default tab
    }
    previousLeagueIdRef.current = activeLeagueId;
  }, [activeLeagueId]);
  const [scheduleMaximizers, setScheduleMaximizers] = useState<Array<Player & { gamesThisWeek: number; gameDays: string[]; games?: NHLGame[] }>>([]);
  const [loadingMaximizers, setLoadingMaximizers] = useState(false);

  // Weekly projections state (playerId -> total weekly projection)
  // Use numeric IDs to match RPC return type
  const [weeklyProjections, setWeeklyProjections] = useState<Map<number, number>>(new Map());
  const [weeklyGameCounts, setWeeklyGameCounts] = useState<Map<number, number>>(new Map());
  const [loadingProjections, setLoadingProjections] = useState(false);

  // Sorting state
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Platform-wide trending data (real add counts from database)
  const [trendingData, setTrendingData] = useState<Map<number, { addCount: number; netAdds: number }>>(new Map());
  const [loadingTrending, setLoadingTrending] = useState(false);

  // Player Stats Modal State
  const [selectedPlayer, setSelectedPlayer] = useState<HockeyPlayer | null>(null);
  const [isPlayerDialogOpen, setIsPlayerDialogOpen] = useState(false);

  // Add-player loading state to prevent double-clicks
  const [addingPlayerId, setAddingPlayerId] = useState<number | null>(null);

  // Atomic swap dialog state — opened when the roster is full, a position limit
  // is hit, or the user explicitly chooses "Add with drop".
  const [swapDialogOpen, setSwapDialogOpen] = useState(false);
  const [swapAddPlayer, setSwapAddPlayer] = useState<Player | null>(null);
  const [swapTeamId, setSwapTeamId] = useState<string | null>(null);

  // Waiver process time from league settings (for toast messages)
  const [waiverProcessTime, setWaiverProcessTime] = useState<string | null>(null);

  // Infinite scroll pagination
  const PAGE_SIZE = 50;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current) observerRef.current.disconnect();
    if (!node) return;
    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount(prev => prev + PAGE_SIZE);
        }
      },
      { rootMargin: '200px' }
    );
    observerRef.current.observe(node);
  }, []);

  const displayLoading = useMinimumLoadingTime(loading, 800);

  useEffect(() => {
    // Skip if league is changing
    if (isChangingLeague) {
      return;
    }
    
    const tab = searchParams.get('tab');
    if (tab) {
      setActiveTab(tab);
    }
    fetchPlayers();
    setWatchlist(new Set(LeagueService.getWatchlist()));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchPlayers/setWatchlist are stable; triggers: URL params, league change, state resolution
  }, [searchParams, activeLeagueId, isChangingLeague, userLeagueState]);

  // Load schedule maximizers when players are loaded (needed for Top Projected combined view)
  useEffect(() => {
    if (players.length > 0 && scheduleMaximizers.length === 0 && !loadingMaximizers) {
      calculateScheduleMaximizers(players);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time fetch when players first load; scheduleMaximizers.length/loadingMaximizers are guards, not triggers
  }, [players.length]);

  // Fetch weekly projections for top free agents (for Top Projected list)
  // CRITICAL: Works for BOTH active users AND demo/guest users (EXACT SAME WAY)
  useEffect(() => {
    if (players.length > 0 && weeklyProjections.size === 0 && !loadingProjections) {
      fetchWeeklyProjections();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time fetch; weeklyProjections.size/loadingProjections are guards, not triggers
  }, [players.length, activeLeagueId]);

  // Reset visible count when search/position filter changes
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [searchQuery, positionFilter, activeTab]);

  // Fetch platform-wide trending data (real add counts)
  useEffect(() => {
    if (players.length > 0 && trendingData.size === 0 && !loadingTrending) {
      fetchTrendingData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time fetch; trendingData.size/loadingTrending are guards, not triggers
  }, [players.length]);

  const fetchTrendingData = async () => {
    try {
      setLoadingTrending(true);
      const trendingMap = await PlayerService.getTrendingPlayers(7, 50);
      setTrendingData(trendingMap);
    } catch (error) {
      // Non-critical error - trending data is optional
    } finally {
      setLoadingTrending(false);
    }
  };

  const fetchPlayers = async () => {
    try {
      setLoading(true);
      setRosterLookupFailed(false);

      // DEMO MODE: For guests, show all players as free agents (no league filtering)
      if (isGuestMode(userLeagueState)) {
        try {
          const allPlayers = await PlayerService.getAllPlayers();
          
          // Show ALL players — skaters sorted by points, goalies sorted by wins
          const skaters = allPlayers.filter(p => p.position !== 'G');
          const goalies = allPlayers.filter(p => p.position === 'G');

          const sortedSkaters = [...skaters]
            .sort((a, b) => (b.points || 0) - (a.points || 0));

          const sortedGoalies = [...goalies]
            .sort((a, b) => (b.wins || 0) - (a.wins || 0));

          const sortedPlayers = [...sortedSkaters, ...sortedGoalies];
          setPlayers(sortedPlayers);
          setLoading(false);
          return;
        } catch (error) {
          logger.error('Error fetching demo players:', error);
          toast({
            title: "Error",
            description: "Failed to load players. Please try again later.",
            variant: "destructive"
          });
          setLoading(false);
          return;
        }
      }
      
      // Get user's league ID - prioritize activeLeagueId from LeagueContext
      let currentLeagueId: string | undefined = activeLeagueId || undefined;
      
      // Fallback: if no activeLeagueId is set, query for user's first team
      if (!currentLeagueId && user) {
        try {
          const response = await leagueApi.getUserLeagues();
          const leagues = response.data as Array<{ id: string }>;
          if (leagues && leagues.length > 0) {
            currentLeagueId = leagues[0].id;
          }
        } catch (error) {
          logger.error('Error fetching user leagues:', error);
          // Continue without league ID - will show all players
        }
      }
      
      setLeagueId(currentLeagueId || null);

      // Fetch waiver settings for this league (for dynamic toast messages)
      if (currentLeagueId && user) {
        WaiverService.getLeagueWaiverSettings(currentLeagueId, user.id)
          .then(settings => { if (settings) setWaiverProcessTime(settings.waiver_process_time); })
          .catch(() => { /* non-critical */ });
      }

      // Get all players from our pipeline tables (player_directory + player_season_stats)
      // PlayerService.getAllPlayers() is the ONLY source for player data
      // CRITICAL: This now filters to only include players with matching stats records (same as getPlayersByIds)
      // This ensures Free Agents shows the EXACT same players and stats as Matchup tab and Player Cards
      const allPlayers = await PlayerService.getAllPlayers();

      if (!allPlayers || allPlayers.length === 0) {
        throw new Error('No players found');
      }
      
      // LeagueService determines free agents - uses real database if leagueId provided
      // Dropped players (with deleted_at) will be included as free agents
      const freeAgentResult = await LeagueService.getFreeAgents(allPlayers, currentLeagueId, user.id);

      // Enrich free agents with waiver status (rows where cleared_at IS NULL and within waiver window)
      if (currentLeagueId) {
        try {
          const { data: waiverRows } = await (supabase as unknown as {
            from: (t: string) => {
              select: (c: string) => {
                eq: (k: string, v: string) => {
                  is: (k: string, v: null) => Promise<{ data: Array<{ player_id: number; dropped_at: string }> | null }>
                }
              }
            }
          })
            .from('player_waiver_status')
            .select('player_id, dropped_at')
            .eq('league_id', currentLeagueId)
            .is('cleared_at', null);
          const waiverWindowMs = 48 * 60 * 60 * 1000;
          const now = Date.now();
          const waiverMap = new Map<string, string>();
          for (const r of (waiverRows || [])) {
            const droppedMs = new Date(r.dropped_at).getTime();
            if (now - droppedMs < waiverWindowMs) {
              waiverMap.set(String(r.player_id), new Date(droppedMs + waiverWindowMs).toISOString());
            }
          }
          if (waiverMap.size > 0) {
            freeAgentResult.players = freeAgentResult.players.map(p => {
              const clearsAt = waiverMap.get(String(p.id));
              return clearsAt ? { ...p, is_on_waivers: true, waiver_clears_at: clearsAt } : p;
            });
          }
        } catch (err) {
          logger.warn('Failed to load waiver status for free agents', err);
        }
      }

      setPlayers(freeAgentResult.players);
      setRosterLookupFailed(freeAgentResult.rosterLookupFailed);
      if (freeAgentResult.rosterLookupFailed) {
        logger.warn(`Roster lookup failed for league ${currentLeagueId} — showing all players as free agents`);
      }
      
      // Don't calculate schedule maximizers here - will be lazy loaded when tab is active
    } catch (error) {
      logger.error('Error fetching players:', error);
      toast({
        title: "Unable to Load Players",
        description: 'Please try refreshing the page.',
        variant: "default"
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchWeeklyProjections = async () => {
    try {
      setLoadingProjections(true);
      
      // Get top 50 free agents to fetch projections for
      // Include mix of top skaters and top goalies
      const topSkaters = [...players]
        .filter(p => p.position !== 'G')
        .sort((a, b) => (b.points || 0) - (a.points || 0))
        .slice(0, 40);
      
      const topGoalies = [...players]
        .filter(p => p.position === 'G')
        .sort((a, b) => {
          // Sort goalies by wins first, then by points
          const aWins = a.wins || 0;
          const bWins = b.wins || 0;
          if (bWins !== aWins) return bWins - aWins;
          return (b.points || 0) - (a.points || 0);
        })
        .slice(0, 10);
      
      const topPlayers = [...topSkaters, ...topGoalies];
      
      if (topPlayers.length === 0) {
        return;
      }

      // Calculate matchup week dates (EXACT SAME LOGIC AS Schedule Maximizer)
      // Use MST timezone - EXACT SAME as Matchup tab and Schedule Maximizer
      const todayMSTStr = getTodayMST(); // Returns 'YYYY-MM-DD' in MST
      const today = new Date(todayMSTStr + 'T00:00:00');
      today.setHours(0, 0, 0, 0);
      
      let weekStart: Date | null = null;
      let weekEnd: Date | null = null;
      
      const effectiveLeagueId = leagueId || DEMO_LEAGUE_ID_FOR_GUESTS; // Demo league ID for guests
      const isDemo = !leagueId || effectiveLeagueId === DEMO_LEAGUE_ID_FOR_GUESTS;
      // CRITICAL FIX: For DEMO mode, ALWAYS use current calendar week (Sunday-Saturday)
      // The demo league's DB dates are stale and don't represent the actual current week.
      if (isDemo) {
        const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, etc.
        const daysFromSunday = dayOfWeek; // Sunday is 0, Monday is 1, etc.

        weekStart = new Date(today);
        weekStart.setDate(today.getDate() - daysFromSunday);
        weekStart.setHours(0, 0, 0, 0);

        weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        weekEnd.setHours(23, 59, 59, 999);
      } else {
        // For logged-in users with real leagues, try to get matchup week from API
        try {
          const matchupResponse = await matchupApi.getLeagueMatchups(effectiveLeagueId);
          const allMatchups = matchupResponse.data as Array<{ week_start_date: string; week_end_date: string; status: string }>;
          const inProgressMatchup = allMatchups?.find(m => m.status === 'in_progress');

          if (inProgressMatchup) {
            weekStart = new Date(inProgressMatchup.week_start_date + 'T00:00:00');
            weekStart.setHours(0, 0, 0, 0);
            weekEnd = new Date(inProgressMatchup.week_end_date + 'T23:59:59');
            weekEnd.setHours(23, 59, 59, 999);
          }
        } catch (error) {
          // Error fetching matchup - will fall through to calculated week
        }
        
        // If no matchup found, calculate from league draft completion date
        if (!weekStart || !weekEnd) {
          try {
            const { league: leagueData, error: leagueError } = await LeagueService.getLeague(effectiveLeagueId, user?.id);
            if (!leagueError && leagueData && leagueData.draft_status === 'completed') {
              const draftCompletionDate = getDraftCompletionDate(leagueData);
              if (draftCompletionDate) {
                const firstWeekStart = getFirstWeekStartDate(draftCompletionDate);
                const currentWeek = getCurrentWeekNumber(firstWeekStart);
                weekStart = getWeekStartDate(currentWeek, firstWeekStart);
                weekEnd = getWeekEndDate(currentWeek, firstWeekStart);
              }
            }
          } catch (error) {
            // Error fetching league - will fall through to calendar week fallback
          }
        }
        
        // FALLBACK: If still no week dates, use current calendar week (Sunday-Saturday)
        if (!weekStart || !weekEnd) {
          const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, etc.
          const daysFromSunday = dayOfWeek; // Sunday is 0, Monday is 1, etc.
          
          weekStart = new Date(today);
          weekStart.setDate(today.getDate() - daysFromSunday);
          weekStart.setHours(0, 0, 0, 0);
          
          weekEnd = new Date(weekStart);
          weekEnd.setDate(weekStart.getDate() + 6);
          weekEnd.setHours(23, 59, 59, 999);
        }
      }

      // Get remaining days in the week (today through Saturday)
      // CRITICAL: Use local date format to avoid UTC timezone shift issues with toISOString()
      const formatDateLocal = (d: Date) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };
      
      const weekDays: string[] = [];
      const startDate = today > weekStart ? today : weekStart; // Start from today or week start, whichever is later
      const currentDate = new Date(startDate);
      while (currentDate <= weekEnd) {
        weekDays.push(formatDateLocal(currentDate));
        currentDate.setDate(currentDate.getDate() + 1);
      }

      // Convert player IDs to numbers
      const playerIds = topPlayers.map(p => {
        const id = typeof p.id === 'string' ? parseInt(p.id, 10) : p.id;
        return isNaN(id) ? 0 : id;
      }).filter(id => id > 0);

      if (playerIds.length === 0) {
        return;
      }

      // Fetch projections for each day of the week and sum them up
      // Use numeric IDs to match RPC return type (Map<number, any>)
      const weeklyProjectionMap = new Map<number, number>();
      const gameCountMap = new Map<number, number>();

      // Initialize all players with 0 using NUMERIC IDs
      topPlayers.forEach(player => {
        const numericId = typeof player.id === 'string' ? parseInt(player.id, 10) : player.id;
        if (!isNaN(numericId) && numericId > 0) {
          weeklyProjectionMap.set(numericId, 0);
          gameCountMap.set(numericId, 0);
        }
      });

      // Fetch projections for each day and aggregate ALL 8 STATS
      for (const date of weekDays) {
        try {
          const dailyProjections = await MatchupService.getDailyProjectionsForMatchup(playerIds, date);

          // Sum up ALL STATS for each player (full transparency)
          // CRITICAL: Use playerId directly (numeric) as Map key to ensure proper accumulation
          dailyProjections.forEach((projection, playerId) => {
            // Use playerId directly as key (it's already a number from the Map)
            const currentTotal = weeklyProjectionMap.get(playerId) || 0;
            const dailyPoints = Number(projection.total_projected_points || 0);
            const newTotal = currentTotal + dailyPoints;
            weeklyProjectionMap.set(playerId, newTotal);

            // Count games: if projection system returned data for this player on this day, they have a game
            gameCountMap.set(playerId, (gameCountMap.get(playerId) || 0) + 1);
          });
        } catch (error) {
          // Error fetching projections for this date - continue with other dates
        }
      }

      setWeeklyProjections(weeklyProjectionMap);
      setWeeklyGameCounts(gameCountMap);
    } catch (error) {
      logger.error('Error fetching weekly projections:', error);
      // On error, set empty map (will fall back to mock projection)
    } finally {
      setLoadingProjections(false);
    }
  };

  const calculateScheduleMaximizers = async (freeAgents: Player[]) => {
    try {
      setLoadingMaximizers(true);
      const maximizers: Array<Player & { gamesThisWeek: number; gameDays: string[]; games?: NHLGame[] }> = [];
      
      // Show all free agents (no artificial limit)
      const topPlayers = [...freeAgents]
        .sort((a, b) => (b.points || 0) - (a.points || 0));
      
      // Get unique teams to batch queries
      const uniqueTeams = [...new Set(topPlayers.map(p => p.team))];
      
      // Calculate matchup week dates (same logic as Matchup tab)
      // Use MST timezone - EXACT SAME as Matchup tab and GameLogosBar
      const todayMSTStr = getTodayMST(); // Returns 'YYYY-MM-DD' in MST
      const today = new Date(todayMSTStr + 'T00:00:00');
      today.setHours(0, 0, 0, 0);
      
      let weekStart: Date | null = null;
      let weekEnd: Date | null = null;
      
      const effectiveLeagueId = leagueId || DEMO_LEAGUE_ID_FOR_GUESTS; // Demo league ID for guests
      const isDemo = !leagueId || effectiveLeagueId === DEMO_LEAGUE_ID_FOR_GUESTS;
      // CRITICAL FIX: For DEMO mode, ALWAYS use current calendar week (Sunday-Saturday)
      // The demo league's DB dates are stale and don't represent the actual current week.
      // This matches what the Matchup tab does - it recalculates dates, not trusts DB dates.
      if (isDemo) {
        const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, etc.
        const daysFromSunday = dayOfWeek; // Sunday is 0, Monday is 1, etc.

        weekStart = new Date(today);
        weekStart.setDate(today.getDate() - daysFromSunday);
        weekStart.setHours(0, 0, 0, 0);

        weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        weekEnd.setHours(23, 59, 59, 999);
      } else {
        // For logged-in users with real leagues, try to get matchup week from API
        try {
          const matchupResponse = await matchupApi.getLeagueMatchups(effectiveLeagueId);
          const allMatchups = matchupResponse.data as Array<{ week_start_date: string; week_end_date: string; status: string }>;
          const inProgressMatchup = allMatchups?.find(m => m.status === 'in_progress');

          if (inProgressMatchup) {
            weekStart = new Date(inProgressMatchup.week_start_date + 'T00:00:00');
            weekStart.setHours(0, 0, 0, 0);
            weekEnd = new Date(inProgressMatchup.week_end_date + 'T23:59:59');
            weekEnd.setHours(23, 59, 59, 999);
          }
        } catch (error) {
          // Error fetching matchup - will fall through to calculated week
        }
        
        // If no matchup found, calculate from league draft completion date
        if (!weekStart || !weekEnd) {
          try {
            const { league: leagueData, error: leagueError } = await LeagueService.getLeague(effectiveLeagueId, user?.id);
            if (!leagueError && leagueData && leagueData.draft_status === 'completed') {
              const draftCompletionDate = getDraftCompletionDate(leagueData);
              if (draftCompletionDate) {
                const firstWeekStart = getFirstWeekStartDate(draftCompletionDate);
                const currentWeek = getCurrentWeekNumber(firstWeekStart);
                weekStart = getWeekStartDate(currentWeek, firstWeekStart);
                weekEnd = getWeekEndDate(currentWeek, firstWeekStart);
              }
            }
          } catch (error) {
            // Error fetching league - will fall through to calendar week fallback
          }
        }
        
        // FALLBACK: If still no week dates, use current calendar week (Sunday-Saturday)
        if (!weekStart || !weekEnd) {
          const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, etc.
          const daysFromSunday = dayOfWeek; // Sunday is 0, Monday is 1, etc.
          
          weekStart = new Date(today);
          weekStart.setDate(today.getDate() - daysFromSunday);
          weekStart.setHours(0, 0, 0, 0);
          
          weekEnd = new Date(weekStart);
          weekEnd.setDate(weekStart.getDate() + 6);
          weekEnd.setHours(23, 59, 59, 999);
        }
      }

      // Single batch API call for all teams (instead of N individual calls)
      const { gamesByTeam } = await ScheduleService.getGamesForTeams(uniqueTeams, weekStart, weekEnd);
      const teamGamesMap = gamesByTeam;
      
      // Calculate games for each player using cached data
      // Filter games to only include those within the matchup week (not next week)
      // CRITICAL: Use local date format to avoid timezone shift issues with toISOString()
      const formatDateLocal = (d: Date) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };
      const weekStartStr = formatDateLocal(weekStart);
      const weekEndStr = formatDateLocal(weekEnd);

      for (const player of topPlayers) {
        const allGames = teamGamesMap.get(player.team) || [];
        
        // Filter games to only include those within the matchup week (same as Matchup tab)
        const games = allGames.filter(game => {
          if (!game.game_date) return false;
          const gameDateStr = game.game_date.split('T')[0];
          return gameDateStr >= weekStartStr && gameDateStr <= weekEndStr;
        });
        
        // Calculate games REMAINING (not started yet) - EXACT SAME LOGIC AS MATCHUP TAB
        // gameDate >= today && (status === 'scheduled' || status === 'live' OR game is today)
        // Use MST timezone string directly
        const gamesRemaining = games.filter(g => {
          if (!g.game_date) return false;
          const gameDateStr = g.game_date.split('T')[0];
          // Game is remaining if: date is today or future AND (not final)
          const isTodayOrFuture = gameDateStr >= todayMSTStr;
          const gameStatusLower = (g.status || '').toLowerCase();
          const isNotFinal = gameStatusLower !== 'final' && gameStatusLower !== 'off';
          return isTodayOrFuture && isNotFinal;
        }).length;

        const count = gamesRemaining; // Use REMAINING games, not total

        // Include all players (no minimum game requirement)
        // Get day abbreviations for each game
        const gameDays = games.map(game => {
          // CRITICAL: Append 'T00:00:00' to force local-time parsing.
          // new Date("YYYY-MM-DD") parses as UTC midnight, which in MST gives the wrong day.
          const gameDate = new Date(game.game_date.split('T')[0] + 'T00:00:00');
          const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          return dayNames[gameDate.getDay()];
        });
        
        maximizers.push({
          ...player,
          gamesThisWeek: count,
          gameDays: [...new Set(gameDays)], // Remove duplicates
          games: games // Include full game data for rendering logos (filtered to week only)
        });
      }

      // Sort by games count (descending), then by points (descending)
      maximizers.sort((a, b) => {
        // First sort by games count (most games first)
        if (b.gamesThisWeek !== a.gamesThisWeek) {
          return b.gamesThisWeek - a.gamesThisWeek;
        }
        // If games are equal, sort by points (highest points first)
        return (b.points || 0) - (a.points || 0);
      });
      
      setScheduleMaximizers(maximizers); // Show ALL players (scrollable list)
    } catch (error) {
      logger.error('Error calculating schedule maximizers:', error);
      setScheduleMaximizers([]);
    } finally {
      setLoadingMaximizers(false);
    }
  };

  const handleAddPlayer = async (player: Player) => {
    // Prevent double-clicks
    const playerIdNum = typeof player.id === 'string' ? parseInt(player.id, 10) : player.id;
    if (addingPlayerId !== null) return;

    // Block guest operations
    if (shouldBlockGuestOperation(userLeagueState, (msg) => {
      toast({
        title: "Sign Up Required",
        description: msg,
        variant: "default"
      });
      navigate('/auth?redirect=/free-agents');
    })) {
      return;
    }

    if (!user || !leagueId) {
      toast({
        title: "Error",
        description: "You must be logged in and have a team to add players.",
        variant: "destructive"
      });
      return;
    }

    // Set loading state immediately
    setAddingPlayerId(playerIdNum);

    try {
      // Check draft status FIRST - must complete draft before adding free agents
      const leagueResponse = await leagueApi.getLeague(leagueId);
      const leagueData = leagueResponse.data as { draft_status?: string } | undefined;

      if (leagueData && leagueData.draft_status !== 'completed') {
        toast({
          title: "Draft Required",
          description: "You must complete the draft before adding free agents.",
          variant: "destructive"
        });
        return;
      }

      // Check roster size before attempting to add
      const { league, error: leagueError } = await LeagueService.getLeague(leagueId, user.id);
      if (leagueError || !league) {
        toast({
          title: "Error",
          description: "Could not load league information.",
          variant: "destructive"
        });
        return;
      }

      // Get current roster size via roster_assignments (the source of truth)
      const myTeamResponse = await leagueApi.getMyTeam(leagueId);
      const teamDataResult = myTeamResponse.data as { id: string } | undefined;

      if (!teamDataResult) {
        toast({
          title: "Error",
          description: "Team not found.",
          variant: "destructive"
        });
        return;
      }
      const teamData = teamDataResult;

      // Count roster_assignments — this is the authoritative count the RPC uses
      const { count: currentRosterSize, error: rosterError } = await PlayerService.getRosterAssignmentCount(teamData.id, leagueId);

      if (rosterError) {
        logger.error('Error counting roster_assignments:', rosterError);
        toast({
          title: "Error",
          description: "Could not load roster for size check.",
          variant: "destructive"
        });
        return;
      }

      // Use roster_size from league (matches what the RPC uses: COALESCE(l.roster_size, 22))
      // The RPC checks: roster_count >= roster_size when no drop player specified
      const maxRosterSize = league.roster_size || 22;

      // If roster is full, open atomic swap dialog so the add+drop happen
      // together inside a single process_roster_move RPC call.
      if ((currentRosterSize || 0) >= maxRosterSize) {
        setSwapAddPlayer(player);
        setSwapTeamId(teamData.id);
        setSwapDialogOpen(true);
        toast({
          title: "Roster Full",
          description: `Select a player to drop in exchange for ${player.full_name}. The swap is atomic.`,
        });
        return;
      }

      // Roster has space, proceed with adding
      const result = await WaiverService.addPlayer(
        leagueId,
        teamData.id,
        playerIdNum,
        null, // No drop player specified
        user.id
      );

      if (result.success) {
        // Record the transaction for platform-wide trending analytics (fire-and-forget)
        PlayerService.recordPlayerTransaction({
          playerId: playerIdNum,
          leagueId,
          teamId: teamData.id,
          transactionType: 'add',
          source: result.isFreeAgent ? 'free_agent' : 'waiver',
          playerName: player.full_name,
          playerTeam: player.team,
          playerPosition: player.position,
        });

        if (result.isFreeAgent) {
          toast({
            title: "Player Added",
            description: `${player.full_name} has been added to your roster.`,
          });
        } else {
          toast({
            title: "Waiver Claim Submitted",
            description: `${player.full_name} is on waivers. Your claim will process at ${formatWaiverProcessTime(waiverProcessTime)}.`,
          });
        }
        // Refresh the free agents list to remove the added player
        await fetchPlayers();
        // Refresh trending data to show updated counts
        await fetchTrendingData();
        // Notify Roster page (and any other listeners) to refresh without a hard reload
        window.dispatchEvent(new CustomEvent('citrus:roster-changed'));
      } else {
        // Check if the error is about a roster/position limit — open atomic swap dialog
        const errorStr = (result.error || '').toLowerCase();
        const isLimitError =
          errorStr.includes('full') ||
          errorStr.includes('max') ||
          errorStr.includes('limit') ||
          errorStr.includes('goalie') ||
          errorStr.includes('position');
        if (isLimitError) {
          setSwapAddPlayer(player);
          setSwapTeamId(teamData.id);
          setSwapDialogOpen(true);
          toast({
            title: "Drop a Player",
            description: `Select a player to drop to add ${player.full_name}.`,
          });
        } else {
          toast({
            title: "Add Failed",
            description: result.error || "Failed to add player. Please try again.",
            variant: "destructive"
          });
        }
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Failed to add player. Please try again.";
      const lower = errorMessage.toLowerCase();
      const isLimitError =
        lower.includes('full') || lower.includes('max') || lower.includes('limit') ||
        lower.includes('goalie') || lower.includes('position');
      // Fallback: if we don't have a team id cached (rare), redirect to roster.
      if (isLimitError) {
        navigate(`/roster?addPlayer=${player.id}&playerName=${encodeURIComponent(player.full_name)}`);
        toast({
          title: "Roster Full",
          description: `You must drop a player before adding ${player.full_name}.`,
        });
      } else {
        toast({
          title: "Error",
          description: errorMessage,
          variant: "destructive"
        });
      }
    } finally {
      setAddingPlayerId(null);
    }
  };

  /**
   * Proactive "Add with drop" — opens the atomic swap dialog directly so
   * users can pick a drop before the roster is full (Yahoo/ESPN/Sleeper UX).
   */
  const handleAddWithDrop = async (player: Player) => {
    if (shouldBlockGuestOperation(userLeagueState, (msg) => {
      toast({ title: "Sign Up Required", description: msg, variant: "default" });
      navigate('/auth?redirect=/free-agents');
    })) {
      return;
    }
    if (!user || !leagueId) {
      toast({
        title: "Error",
        description: "You must be logged in and have a team to swap players.",
        variant: "destructive",
      });
      return;
    }
    try {
      const myTeamResponse = await leagueApi.getMyTeam(leagueId);
      const teamDataResult = myTeamResponse.data as { id: string } | undefined;
      if (!teamDataResult) {
        toast({ title: "Error", description: "Team not found.", variant: "destructive" });
        return;
      }
      setSwapAddPlayer(player);
      setSwapTeamId(teamDataResult.id);
      setSwapDialogOpen(true);
    } catch (err) {
      logger.error('handleAddWithDrop failed', err);
      toast({
        title: "Error",
        description: "Could not open swap dialog. Please try again.",
        variant: "destructive",
      });
    }
  };

  const toggleWatchlist = (player: Player) => {
    const newWatchlist = new Set(watchlist);
    if (newWatchlist.has(player.id)) {
      newWatchlist.delete(player.id);
      LeagueService.removeFromWatchlist(player.id);
      toast({ title: "Removed from Watch List", description: `${player.full_name} removed.` });
    } else {
      newWatchlist.add(player.id);
      LeagueService.addToWatchlist(player.id);
      toast({ title: "Added to Watch List", description: `${player.full_name} added.` });
    }
    setWatchlist(newWatchlist);
  };

  // Filter players based on search and position
  const getFilteredPlayers = (sourcePlayers: Player[]) => {
    return sourcePlayers.filter(player => {
      const matchesSearch = player.full_name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            player.team.toLowerCase().includes(searchQuery.toLowerCase());
      
      // Normalize player position for comparison
      const normalizedPlayerPos = formatPositionForDisplay(player.position);
      
      const matchesPosition = positionFilter === 'ALL' ||
        (positionFilter === 'W' ? (normalizedPlayerPos === 'LW' || normalizedPlayerPos === 'RW') :
         positionFilter === 'F' ? (normalizedPlayerPos === 'C' || normalizedPlayerPos === 'LW' || normalizedPlayerPos === 'RW') :
         normalizedPlayerPos === positionFilter);

      return matchesSearch && matchesPosition;
    });
  };

  // Sort players based on sortColumn and sortDirection
  const sortPlayers = (playersToSort: Player[]) => {
    if (!sortColumn) return playersToSort;

    const sorted = [...playersToSort].sort((a, b) => {
      let aValue: string | number;
      let bValue: string | number;

      switch (sortColumn) {
        case 'name':
          aValue = a.full_name.toLowerCase();
          bValue = b.full_name.toLowerCase();
          break;
        case 'position':
          aValue = formatPositionForDisplay(a.position);
          bValue = formatPositionForDisplay(b.position);
          break;
        case 'team':
          aValue = a.team.toLowerCase();
          bValue = b.team.toLowerCase();
          break;
        case 'gp':
          aValue = a.games_played || 0;
          bValue = b.games_played || 0;
          break;
        case 'goals':
          aValue = a.goals || 0;
          bValue = b.goals || 0;
          break;
        case 'assists':
          aValue = a.assists || 0;
          bValue = b.assists || 0;
          break;
        case 'points':
          aValue = a.points || 0;
          bValue = b.points || 0;
          break;
        case 'shots':
          aValue = a.shots || 0;
          bValue = b.shots || 0;
          break;
        case 'hits':
          aValue = a.hits || 0;
          bValue = b.hits || 0;
          break;
        case 'blocks':
          aValue = a.blocks || 0;
          bValue = b.blocks || 0;
          break;
        case 'xGoals':
          aValue = a.xGoals || 0;
          bValue = b.xGoals || 0;
          break;
        // corsi/fenwick intentionally removed
        case 'wins':
          aValue = a.wins || 0;
          bValue = b.wins || 0;
          break;
        case 'gaa':
          aValue = a.goals_against_average || 0;
          bValue = b.goals_against_average || 0;
          break;
        case 'savePct':
          aValue = a.save_percentage || 0;
          bValue = b.save_percentage || 0;
          break;
        default:
          return 0;
      }

      // Handle string comparison
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortDirection === 'asc' 
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
      }

      // Handle number comparison
      return sortDirection === 'asc' 
        ? (aValue as number) - (bValue as number)
        : (bValue as number) - (aValue as number);
    });

    return sorted;
  };

  // Sort schedule maximizers (includes gamesThisWeek field)
  const sortScheduleMaximizers = (maximizers: Array<Player & { gamesThisWeek: number; gameDays: string[]; games?: NHLGame[] }>) => {
    // Default sort: most games remaining (descending)
    if (!sortColumn) {
      return [...maximizers].sort((a, b) => (b.gamesThisWeek || 0) - (a.gamesThisWeek || 0));
    }

    const sorted = [...maximizers].sort((a, b) => {
      let aValue: string | number;
      let bValue: string | number;

      // Handle gamesThisWeek for schedule maximizers
      if (sortColumn === 'gamesThisWeek') {
        aValue = a.gamesThisWeek || 0;
        bValue = b.gamesThisWeek || 0;
      } else {
        // Use the same logic as sortPlayers for other columns
        switch (sortColumn) {
          case 'name':
            aValue = a.full_name.toLowerCase();
            bValue = b.full_name.toLowerCase();
            break;
          case 'position':
            aValue = formatPositionForDisplay(a.position);
            bValue = formatPositionForDisplay(b.position);
            break;
          case 'team':
            aValue = a.team.toLowerCase();
            bValue = b.team.toLowerCase();
            break;
          case 'gp':
            aValue = a.games_played || 0;
            bValue = b.games_played || 0;
            break;
          case 'goals':
            aValue = a.goals || 0;
            bValue = b.goals || 0;
            break;
          case 'assists':
            aValue = a.assists || 0;
            bValue = b.assists || 0;
            break;
          case 'points':
            aValue = a.points || 0;
            bValue = b.points || 0;
            break;
          case 'shots':
            aValue = a.shots || 0;
            bValue = b.shots || 0;
            break;
          case 'hits':
            aValue = a.hits || 0;
            bValue = b.hits || 0;
            break;
          case 'blocks':
            aValue = a.blocks || 0;
            bValue = b.blocks || 0;
            break;
          case 'xGoals':
            aValue = a.xGoals || 0;
            bValue = b.xGoals || 0;
            break;
          // corsi/fenwick intentionally removed
          case 'wins':
            aValue = a.wins || 0;
            bValue = b.wins || 0;
            break;
          case 'gaa':
            aValue = a.goals_against_average || 0;
            bValue = b.goals_against_average || 0;
            break;
          case 'savePct':
            aValue = a.save_percentage || 0;
            bValue = b.save_percentage || 0;
            break;
          default:
            return 0;
        }
      }

      // Handle string comparison
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortDirection === 'asc' 
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
      }

      // Handle number comparison
      return sortDirection === 'asc' 
        ? (aValue as number) - (bValue as number)
        : (bValue as number) - (aValue as number);
    });

    return sorted;
  };

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      // Toggle direction if clicking the same column
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // Set new column and default to descending for numbers, ascending for strings
      setSortColumn(column);
      const isStringColumn = ['name', 'position', 'team'].includes(column);
      setSortDirection(isStringColumn ? 'asc' : 'desc');
    }
  };

  const getSortIcon = (column: string) => {
    if (sortColumn !== column) {
      return <ArrowUpDown className="h-3 w-3 ml-1 opacity-50" />;
    }
    return sortDirection === 'asc' 
      ? <ArrowUp className="h-3 w-3 ml-1" />
      : <ArrowDown className="h-3 w-3 ml-1" />;
  };

  const filteredPlayers = sortPlayers(getFilteredPlayers(players));
  const visiblePlayers = useMemo(
    () => filteredPlayers.slice(0, visibleCount),
    [filteredPlayers, visibleCount]
  );
  const hasMorePlayers = visibleCount < filteredPlayers.length;

  const handlePlayerClick = async (player: Player) => {
    // Fetch fresh season stats using unified helper (same as Matchup tab)
    const playerWithStats = await getPlayerWithSeasonStats(player.id);
    if (playerWithStats) {
      setSelectedPlayer(playerWithStats);
      setIsPlayerDialogOpen(true);
    } else {
      toast({
        title: "Error",
        description: "Could not load player stats. Please try again.",
        variant: "destructive"
      });
    }
  };

  // Derived lists for Summary View
  // Use real trending data when available, fallback to estimated adds based on points
  const topTrending = [...filteredPlayers]
    .map(p => {
      const playerId = typeof p.id === 'string' ? parseInt(p.id, 10) : p.id;
      const realData = trendingData.get(playerId);
      return {
        ...p,
        adds: realData?.addCount ?? 0,
        netAdds: realData?.netAdds ?? 0,
        hasRealData: !!realData
      };
    })
    .sort((a, b) => b.adds - a.adds)
    .slice(0, 10);

  // Combined Top Projected with Schedule Icons - merges projections + schedule data
  // Game count comes from the SAME projection system (how many days had projections = how many games)
  const topProjected = [...filteredPlayers]
    .map(p => {
      // Use numeric ID to match Map key type
      const numericId = typeof p.id === 'string' ? parseInt(p.id, 10) : p.id;
      const realProjection = weeklyProjections.get(numericId);
      const projectionGameCount = weeklyGameCounts.get(numericId) || 0;

      // Find matching schedule data for this player (for gameDays/games display)
      const scheduleData = scheduleMaximizers.find(sm => sm.id === p.id);
      // Use projection-derived game count when available, fall back to schedule data
      const gamesThisWeek = projectionGameCount > 0 ? projectionGameCount : (scheduleData?.gamesThisWeek || 0);

      // 0 games remaining = 0 projected points — tied to our internal projection model
      // Fallback uses season PPG * games this week (not the broken points/20 formula)
      const seasonPPG = p.games_played > 0 ? (p.points || 0) / p.games_played : 0;
      const isGoalie = p.position === 'G';
      // Use centralized ScoringCalculator for fantasy PPG
      const scorer = new ScoringCalculator();
      const estimatedFantasyPPG = isGoalie
        ? ((p.wins || 0) > 0 && p.games_played > 0 ? scorer.calculatePointsPerGame({
            wins: p.wins || 0, saves: p.saves || 0, shutouts: p.shutouts || 0, goals_against: p.goals_against || 0
          }, true, p.games_played) : 3.0)
        : (p.games_played > 0
          ? scorer.calculatePointsPerGame({
              goals: p.goals || 0, assists: p.assists || 0, ppp: p.ppp || 0, shp: p.shp || 0,
              sog: p.shots || 0, blocks: p.blocks || 0, hits: p.hits || 0, pim: p.pim || 0
            }, false, p.games_played)
          : 0);
      const weeklyProjection = gamesThisWeek === 0
        ? 0
        : ((realProjection && realProjection > 0) ? realProjection : (estimatedFantasyPPG * gamesThisWeek));

      return {
        ...p,
        weeklyProjection,
        gamesThisWeek,
        gameDays: scheduleData?.gameDays || [],
        games: scheduleData?.games || []
      };
    })
    .filter(p => {
      // If projection data is loaded, only show players who actually have games
      if (weeklyGameCounts.size > 0) {
        return p.gamesThisWeek > 0;
      }
      return true; // Before projections load, show all
    })
    .sort((a, b) => b.weeklyProjection - a.weeklyProjection)
    .slice(0, 10); // Show top 10 instead of 5

  const leaguePosType = activeLeagueFormat?.positionType === 'forward' ? 'forward' : 'individual';
  const positions = leaguePosType === 'forward'
    ? ['ALL', 'F', 'D', 'G']
    : ['ALL', 'C', 'LW', 'RW', 'W', 'D', 'G'];

  // Redirect pool leagues to their pool page
  const _leagueType = activeLeagueFormat?.leagueType;
  if (isPoolLeague(_leagueType) && activeLeagueId) {
    return <Navigate to={getPoolRoute(_leagueType!, activeLeagueId)} replace />;
  }

  return (
    <div className="min-h-screen bg-[#0F1F15] text-pastel-cream relative">
      <div className="hidden lg:block"><Navbar /></div>
      <div className="lg:hidden sticky top-0 z-40 bg-[#0F1F15]/95 backdrop-blur-xl border-b border-white/10 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-between h-12 px-4">
          <div className="w-10" />
          <h1 className="text-lg font-bold text-pastel-cream">Free Agents</h1>
          <MobileMenuButton />
        </div>
      </div>
      <main className="w-full lg:pt-24 lg:pb-8 pb-[calc(5rem+env(safe-area-inset-bottom))]">
        <div className="w-full m-0 p-0">
          {/* Sidebar, Content, and Notifications Grid - Sidebar at bottom on mobile, left on desktop; Notifications on right on desktop */}
          <div className="flex flex-col lg:grid lg:grid-cols-[200px_1fr_260px] xl:grid-cols-[220px_1fr_280px] lg:gap-4 xl:gap-6 lg:px-4 xl:px-6 lg:mx-0 lg:w-screen lg:relative lg:left-1/2 lg:-translate-x-1/2">
            {/* Main Content - Appears first on mobile */}
            <div className="min-w-0 px-2 lg:px-6 order-1 lg:order-2">

              <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <div>
            <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold mb-1.5 flex items-center gap-2">
              <SlateIcon className="w-3.5 h-3.5" strokeWidth={2} />
              ✦ Scouting Room
            </div>
            <h1 className="font-calistoga text-3xl sm:text-4xl text-pastel-cream leading-none">Scout the pool.</h1>
            <p className="text-sm text-white/55 mt-2">Available players to improve your roster — sort, filter, and pick up.</p>
          </div>
          <div className="flex gap-2 w-full md:w-auto">
            <Input
              placeholder="Search players…"
              className="max-w-xs bg-white/5 border-white/10 text-pastel-cream placeholder:text-white/40 focus-visible:ring-pastel-orange/40"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Demo Mode Banner / No League CTA */}
        {userLeagueState === 'logged-in-no-league' && (
          <div className="mb-6">
            <LeagueCreationCTA
              title="Your Free Agent Pool Awaits"
              description="Create your league to start adding players to your roster and building your team."
            />
          </div>
        )}
        {userLeagueState === 'guest' && (
          <div className="mb-6">
            <LeagueCreationCTA
              title="You're viewing demo data"
              description="Sign up to add players to your roster and start managing your team."
              variant="compact"
            />
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3 max-w-2xl mb-6 bg-[#1A2A20] ring-1 ring-white/10 p-1 rounded-xl">
            <TabsTrigger
              value="available"
              className="text-white/55 hover:text-pastel-cream font-bold data-[state=active]:bg-pastel-orange data-[state=active]:text-[#581E00] data-[state=active]:shadow-[0_4px_12px_-4px_rgba(255,168,87,0.4)]"
            >
              Available
            </TabsTrigger>
            <TabsTrigger
              value="schedule"
              className="gap-2 text-white/55 hover:text-pastel-cream font-bold data-[state=active]:bg-pastel-orange data-[state=active]:text-[#581E00] data-[state=active]:shadow-[0_4px_12px_-4px_rgba(255,168,87,0.4)]"
            >
              <Calendar className="h-4 w-4" /> Schedule
            </TabsTrigger>
            <TabsTrigger
              value="watch"
              className="text-white/55 hover:text-pastel-cream font-bold data-[state=active]:bg-pastel-orange data-[state=active]:text-[#581E00] data-[state=active]:shadow-[0_4px_12px_-4px_rgba(255,168,87,0.4)]"
            >
              Watch List
            </TabsTrigger>
          </TabsList>

          <TabsContent value="available" className="space-y-6">
            {/* Quick Position Filters */}
            <div className="flex flex-wrap gap-2">
              {positions.map((pos) => {
                const isActive = positionFilter === pos;
                return (
                  <Badge
                    key={pos}
                    className={`cursor-pointer px-4 py-1 text-[10px] font-jbmono uppercase tracking-[0.18em] font-bold border-0 transition-all ${
                      isActive
                        ? 'bg-pastel-orange text-[#581E00] shadow-[0_4px_12px_-4px_rgba(255,168,87,0.4)]'
                        : 'bg-white/5 ring-1 ring-white/10 text-white/70 hover:bg-white/[0.08] hover:ring-pastel-orange/30'
                    }`}
                    onClick={() => setPositionFilter(pos)}
                  >
                    {pos === 'W' ? 'Wingers' : (pos === 'ALL' ? 'All Positions' : pos)}
                  </Badge>
                );
              })}
            </div>

            {/* Warning banner when roster lookup failed */}
            {rosterLookupFailed && (
              <div className="flex items-center gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200">
                <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-400" />
                <span>Unable to load roster data for this league. Showing all players — some may already be rostered.</span>
              </div>
            )}

            {(() => {
              if (displayLoading) {
                return <StormyLoading message="Loading free agents…" />;
              }
              return (
                <>
                {viewMode === 'summary' && !searchQuery ? (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Top Trending Table */}
                    <Card>
                      <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-lg font-bold flex items-center gap-2">
                          <TrendingUp className="h-5 w-5 text-green-500" />
                          Top Trending
                          {trendingData.size > 0 && (
                            <Badge className="text-[11px] ml-2 bg-pastel-sage/20 ring-1 ring-pastel-sage/40 text-pastel-sage-soft border-0">
                              Live
                            </Badge>
                          )}
                        </CardTitle>
                        <Button variant="ghost" size="sm" onClick={() => setViewMode('all')}>See All</Button>
                      </CardHeader>
                      <CardContent className="p-0">
                        {/* Mobile List View */}
                        <div className="md:hidden">
                          {topTrending.map(player => (
                            <div key={player.id} className="p-3 border-b flex items-center justify-between">
                              <div className="flex flex-col">
                                <span className="font-medium">{player.full_name}</span>
                                <span className="text-xs text-white/55">{formatPositionForDisplay(player.position)} • {player.team}</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <div className="text-right">
                                  <div className="font-bold text-green-600">{player.adds.toLocaleString()}</div>
                                  <div className="text-[11px] text-white/55">Adds</div>
                                </div>
                                <Button size="default" variant="default" className={`h-10 w-10 font-bold text-xl border shadow-sm disabled:opacity-50 ${addBtnColorCls(player)}`} title={player.is_on_waivers ? 'Submit waiver claim' : 'Add to roster'} disabled={addingPlayerId !== null} onClick={() => handleAddPlayer(player)}>
                                  {addingPlayerId === (typeof player.id === 'string' ? parseInt(player.id, 10) : player.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : (player.is_on_waivers ? 'W' : '+')}
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Desktop Table View */}
                        <div className="hidden md:block">
                          <Table className="[&_th]:px-2 [&_th]:py-2 [&_th]:text-xs [&_td]:px-2 [&_td]:py-1.5 [&_td]:tabular-nums">
                            <TableHeader>
                              <TableRow>
                                <TableHead>Player</TableHead>
                                <TableHead className="text-right whitespace-nowrap">Pos</TableHead>
                                <TableHead className="text-right whitespace-nowrap">Adds</TableHead>
                                <TableHead className="w-[70px]"></TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {topTrending.map(player => (
                              <TableRow key={player.id}>
                                <TableCell className="font-medium">
                                  <div className="flex flex-col">
                                    <span 
                                      className="hover:underline hover:text-pastel-orange cursor-pointer"
                                      onClick={() => handlePlayerClick(player)}
                                    >
                                      {player.full_name}
                                    </span>
                                    <span className="text-xs text-white/55">{player.team}</span>
                                  </div>
                                </TableCell>
                                <TableCell className="text-right">{formatPositionForDisplay(player.position)}</TableCell>
                                <TableCell className="text-right font-bold text-green-600">
                                  {player.adds.toLocaleString()}
                                </TableCell>
                                <TableCell>
                                  <div className="flex gap-1">
                                    <Button 
                                      size="icon" 
                                      variant="ghost" 
                                      className={`h-8 w-8 ${watchlist.has(player.id) ? 'text-yellow-500' : 'text-white/55'}`}
                                      onClick={() => toggleWatchlist(player)}
                                    >
                                      <Star className={`h-4 w-4 ${watchlist.has(player.id) ? 'fill-current' : ''}`} />
                                    </Button>
                                    <Button size="default" variant="default" className={`h-10 w-10 font-bold text-xl border shadow-sm disabled:opacity-50 ${addBtnColorCls(player)}`} title={player.is_on_waivers ? 'Submit waiver claim' : 'Add to roster'} disabled={addingPlayerId !== null} onClick={() => handleAddPlayer(player)}>
                                      {addingPlayerId === (typeof player.id === 'string' ? parseInt(player.id, 10) : player.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : (player.is_on_waivers ? 'W' : '+')}
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Top Projected + Schedule Combined Table */}
                    <Card>
                      <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-lg font-bold flex items-center gap-2">
                          <Calendar className="h-5 w-5 text-blue-500" />
                          Top Projected (Remaining Week)
                          {weeklyProjections.size === 0 && (
                            <Badge variant="outline" className="text-[11px] ml-2 bg-white/5 ring-1 ring-pastel-sage/30 text-pastel-cream border-0">
                              Loading...
                            </Badge>
                          )}
                          {weeklyProjections.size > 0 && (
                            <Badge className="text-[11px] ml-2 bg-pastel-sage/20 ring-1 ring-pastel-sage/40 text-pastel-sage-soft border-0">
                              Live Data
                            </Badge>
                          )}
                        </CardTitle>
                        <Button variant="ghost" size="sm" onClick={() => setActiveTab('schedule')}>See All</Button>
                      </CardHeader>
                      <CardContent className="p-0">
                        {/* Mobile List View - Compact with Schedule Icons */}
                        <div className="md:hidden">
                          {topProjected.map(player => (
                            <div key={player.id} className="p-2 border-b flex items-center gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-sm truncate">{player.full_name}</span>
                                  <span className="text-[11px] text-white/55 shrink-0">{formatPositionForDisplay(player.position)}</span>
                                </div>
                                {/* Schedule Icons Row */}
                                {player.games && player.games.length > 0 && (
                                  <div className="flex gap-1 mt-1">
                                    {player.games
                                      .filter((game: NHLGame) => game && game.game_date)
                                      .sort((a: NHLGame, b: NHLGame) => new Date(a.game_date.split('T')[0] + 'T00:00:00').getTime() - new Date(b.game_date.split('T')[0] + 'T00:00:00').getTime())
                                      .slice(0, 4)
                                      .map((game: NHLGame, idx: number) => {
                                        const isHome = game.home_team === player.team;
                                        const opponentAbbrev = isHome ? game.away_team : game.home_team;
                                        return (
                                          <div key={idx} className="flex items-center gap-0.5 bg-white/5 ring-1 ring-white/10 rounded px-1 py-0.5">
                                            <span className="text-[10px] text-white/55">{isHome ? 'vs' : '@'}</span>
                                            <img 
                                              src={`https://assets.nhle.com/logos/nhl/svg/${opponentAbbrev}_light.svg`}
                                              alt={opponentAbbrev}
                                              className="w-4 h-4"
                                              onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                            />
                                          </div>
                                        );
                                      })}
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <div className="text-right">
                                  <div className="font-bold text-blue-600 text-sm">
                                    {(player.weeklyProjection || 0).toFixed(1)}
                                  </div>
                                  <div className="text-[10px] text-white/55">{player.gamesThisWeek || 0}G</div>
                                </div>
                                <Button size="sm" variant="default" className={`h-8 w-8 font-bold border shadow-sm p-0 disabled:opacity-50 ${addBtnColorCls(player)}`} title={player.is_on_waivers ? 'Submit waiver claim' : 'Add to roster'} disabled={addingPlayerId !== null} onClick={() => handleAddPlayer(player)}>
                                  {addingPlayerId === (typeof player.id === 'string' ? parseInt(player.id, 10) : player.id) ? <Loader2 className="h-3 w-3 animate-spin" /> : (player.is_on_waivers ? 'W' : '+')}
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Desktop Table View */}
                        <div className="hidden md:block">
                          <Table className="[&_th]:px-2 [&_th]:py-2 [&_th]:text-xs [&_td]:px-2 [&_td]:py-1.5 [&_td]:tabular-nums">
                            <TableHeader>
                              <TableRow>
                                <TableHead>Player</TableHead>
                                <TableHead className="text-right whitespace-nowrap">Pos</TableHead>
                                <TableHead className="text-center whitespace-nowrap">Schedule</TableHead>
                                <TableHead className="text-right whitespace-nowrap">Proj</TableHead>
                                <TableHead className="w-[70px]"></TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {topProjected.map(player => (
                              <TableRow key={player.id}>
                                <TableCell className="font-medium">
                                  <div className="flex flex-col">
                                    <span 
                                      className="hover:underline hover:text-pastel-orange cursor-pointer"
                                      onClick={() => handlePlayerClick(player)}
                                    >
                                      {player.full_name}
                                    </span>
                                    <span className="text-xs text-white/55">{player.team}</span>
                                  </div>
                                </TableCell>
                                <TableCell className="text-right">{formatPositionForDisplay(player.position)}</TableCell>
                                <TableCell className="text-center">
                                  {player.games && player.games.length > 0 ? (
                                    <div className="flex justify-center gap-1">
                                      {player.games
                                        .filter((game: NHLGame) => game && game.game_date)
                                        .sort((a: NHLGame, b: NHLGame) => new Date(a.game_date.split('T')[0] + 'T00:00:00').getTime() - new Date(b.game_date.split('T')[0] + 'T00:00:00').getTime())
                                        .map((game: NHLGame, idx: number) => {
                                          const isHome = game.home_team === player.team;
                                          const opponentAbbrev = isHome ? game.away_team : game.home_team;
                                          return (
                                            <div key={idx} className="flex items-center gap-0.5 bg-white/5 ring-1 ring-white/10 rounded px-1.5 py-0.5">
                                              <span className="text-[10px] text-white/55">{isHome ? 'vs' : '@'}</span>
                                              <img 
                                                src={`https://assets.nhle.com/logos/nhl/svg/${opponentAbbrev}_light.svg`}
                                                alt={opponentAbbrev}
                                                className="w-5 h-5"
                                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                              />
                                            </div>
                                          );
                                        })}
                                    </div>
                                  ) : (
                                    <span className="text-xs text-white/55">-</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="flex flex-col items-end">
                                    <span className="font-bold text-blue-600">{(player.weeklyProjection || 0).toFixed(1)}</span>
                                    <span className="text-[11px] text-white/55">{player.gamesThisWeek || 0} games</span>
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <div className="flex gap-1">
                                    <Button 
                                      size="icon" 
                                      variant="ghost" 
                                      className={`h-8 w-8 ${watchlist.has(player.id) ? 'text-yellow-500' : 'text-white/55'}`}
                                      onClick={() => toggleWatchlist(player)}
                                    >
                                      <Star className={`h-4 w-4 ${watchlist.has(player.id) ? 'fill-current' : ''}`} />
                                    </Button>
                                    <Button size="sm" variant="default" className={`h-8 w-8 font-bold border shadow-sm p-0 disabled:opacity-50 ${addBtnColorCls(player)}`} title={player.is_on_waivers ? 'Submit waiver claim' : 'Add to roster'} disabled={addingPlayerId !== null} onClick={() => handleAddPlayer(player)}>
                                      {addingPlayerId === (typeof player.id === 'string' ? parseInt(player.id, 10) : player.id) ? <Loader2 className="h-3 w-3 animate-spin" /> : (player.is_on_waivers ? 'W' : '+')}
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <h3 className="font-semibold text-lg">All Available Players</h3>
                      {viewMode === 'all' && !searchQuery && (
                        <Button variant="outline" size="sm" onClick={() => setViewMode('summary')}>Back to Summary</Button>
                      )}
                    </div>
                    
                    <div className="border rounded-lg overflow-hidden">
                      <div className="overflow-x-auto">
                        <Table className="min-w-[600px] [&_th]:px-2 [&_th]:py-2 [&_th]:text-xs [&_td]:px-2 [&_td]:py-1.5 [&_td]:tabular-nums">
                          <TableHeader>
                            <TableRow>
                              <TableHead
                                className="cursor-pointer hover:bg-white/5 select-none text-white/55 hover:text-pastel-cream min-w-[100px] md:min-w-[160px]"
                                onClick={() => handleSort('name')}
                              >
                                <div className="flex items-center justify-start">
                                  Player
                                  {getSortIcon('name')}
                                </div>
                              </TableHead>
                              <TableHead
                                className="text-right cursor-pointer hover:bg-white/5 select-none text-white/55 hover:text-pastel-cream whitespace-nowrap"
                                onClick={() => handleSort('position')}
                              >
                                <div className="flex items-center justify-end">
                                  Pos
                                  {getSortIcon('position')}
                                </div>
                              </TableHead>
                              <TableHead
                                className="text-right cursor-pointer hover:bg-white/5 select-none text-white/55 hover:text-pastel-cream whitespace-nowrap"
                                onClick={() => handleSort('team')}
                              >
                                <div className="flex items-center justify-end">
                                  Team
                                  {getSortIcon('team')}
                                </div>
                              </TableHead>
                              <TableHead
                                className="text-right cursor-pointer hover:bg-white/5 select-none text-white/55 hover:text-pastel-cream whitespace-nowrap"
                                onClick={() => handleSort('gp')}
                              >
                                <div className="flex items-center justify-end">
                                  GP
                                  {getSortIcon('gp')}
                                </div>
                              </TableHead>
                              {/* Skater Stats - only show if there are skaters */}
                              {filteredPlayers.some(p => p.position !== 'G') && (
                                <>
                                  <TableHead
                                    className="text-right cursor-pointer hover:bg-white/5 select-none text-white/55 hover:text-pastel-cream whitespace-nowrap"
                                    onClick={() => handleSort('goals')}
                                  >
                                    <div className="flex items-center justify-end">
                                      G
                                      {getSortIcon('goals')}
                                    </div>
                                  </TableHead>
                                  <TableHead
                                    className="text-right cursor-pointer hover:bg-white/5 select-none text-white/55 hover:text-pastel-cream whitespace-nowrap"
                                    onClick={() => handleSort('assists')}
                                  >
                                    <div className="flex items-center justify-end">
                                      A
                                      {getSortIcon('assists')}
                                    </div>
                                  </TableHead>
                                  <TableHead
                                    className="text-right cursor-pointer hover:bg-white/5 select-none text-white/55 hover:text-pastel-cream whitespace-nowrap"
                                    onClick={() => handleSort('points')}
                                  >
                                    <div className="flex items-center justify-end">
                                      P
                                      {getSortIcon('points')}
                                    </div>
                                  </TableHead>
                                  <TableHead
                                    className="text-right cursor-pointer hover:bg-white/5 select-none text-white/55 hover:text-pastel-cream whitespace-nowrap"
                                    onClick={() => handleSort('shots')}
                                  >
                                    <div className="flex items-center justify-end">
                                      SOG
                                      {getSortIcon('shots')}
                                    </div>
                                  </TableHead>
                                  <TableHead
                                    className="text-right cursor-pointer hover:bg-white/5 select-none text-white/55 hover:text-pastel-cream whitespace-nowrap"
                                    onClick={() => handleSort('hits')}
                                  >
                                    <div className="flex items-center justify-end">
                                      HIT
                                      {getSortIcon('hits')}
                                    </div>
                                  </TableHead>
                                  <TableHead
                                    className="text-right cursor-pointer hover:bg-white/5 select-none text-white/55 hover:text-pastel-cream whitespace-nowrap"
                                    onClick={() => handleSort('blocks')}
                                  >
                                    <div className="flex items-center justify-end">
                                      BLK
                                      {getSortIcon('blocks')}
                                    </div>
                                  </TableHead>
                                  <TableHead
                                    className="text-right cursor-pointer hover:bg-white/5 select-none text-white/55 hover:text-pastel-cream whitespace-nowrap"
                                    onClick={() => handleSort('xGoals')}
                                  >
                                    <div className="flex items-center justify-end">
                                      xG
                                      {getSortIcon('xGoals')}
                                    </div>
                                  </TableHead>
                                  {/* Corsi/Fenwick intentionally removed */}
                                </>
                              )}
                              {/* Goalie Stats - only show if there are goalies */}
                              {filteredPlayers.some(p => p.position === 'G') && (
                                <>
                                  <TableHead
                                    className="text-right cursor-pointer hover:bg-white/5 select-none text-white/55 hover:text-pastel-cream whitespace-nowrap"
                                    onClick={() => handleSort('wins')}
                                  >
                                    <div className="flex items-center justify-end">
                                      W
                                      {getSortIcon('wins')}
                                    </div>
                                  </TableHead>
                                  <TableHead
                                    className="text-right cursor-pointer hover:bg-white/5 select-none text-white/55 hover:text-pastel-cream whitespace-nowrap"
                                    onClick={() => handleSort('gaa')}
                                  >
                                    <div className="flex items-center justify-end">
                                      GAA
                                      {getSortIcon('gaa')}
                                    </div>
                                  </TableHead>
                                  <TableHead
                                    className="text-right cursor-pointer hover:bg-white/5 select-none text-white/55 hover:text-pastel-cream whitespace-nowrap"
                                    onClick={() => handleSort('savePct')}
                                  >
                                    <div className="flex items-center justify-end">
                                      SV%
                                      {getSortIcon('savePct')}
                                    </div>
                                  </TableHead>
                                </>
                              )}
                              <TableHead className="w-[100px]"></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {visiblePlayers.map((player) => {
                              const isGoalie = player.position === 'G';
                              return (
                                <TableRow key={player.id} className="hover:bg-white/5">
                                  <TableCell className="font-medium whitespace-nowrap">
                                    <div className="flex flex-col">
                                      <span
                                        className="hover:underline hover:text-pastel-orange cursor-pointer text-sm"
                                        onClick={() => handlePlayerClick(player)}
                                      >
                                        {player.full_name}
                                      </span>
                                      <span className="text-[11px] text-white/55">{player.status || 'Active'}</span>
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-right text-sm whitespace-nowrap">{formatPositionForDisplay(player.position)}</TableCell>
                                  <TableCell className="text-right text-sm whitespace-nowrap">{player.team}</TableCell>
                                  <TableCell className="text-right text-sm whitespace-nowrap">{player.games_played || 0}</TableCell>
                                  {/* Skater Stats - only render for skaters */}
                                  {!isGoalie && (
                                    <>
                                      <TableCell className="text-right text-sm whitespace-nowrap">{player.goals || 0}</TableCell>
                                      <TableCell className="text-right text-sm whitespace-nowrap">{player.assists || 0}</TableCell>
                                      <TableCell className="text-right text-sm font-bold whitespace-nowrap">{player.points || 0}</TableCell>
                                      <TableCell className="text-right text-sm whitespace-nowrap">{player.shots || 0}</TableCell>
                                      <TableCell className="text-right text-sm whitespace-nowrap">{player.hits || 0}</TableCell>
                                      <TableCell className="text-right text-sm whitespace-nowrap">{player.blocks || 0}</TableCell>
                                      <TableCell className="text-right text-sm whitespace-nowrap">{typeof player.xGoals === 'number' ? player.xGoals.toFixed(1) : '-'}</TableCell>
                                      {/* Corsi/Fenwick intentionally removed */}
                                    </>
                                  )}
                                  {/* Goalie Stats - only render for goalies */}
                                  {isGoalie && (
                                    <>
                                      <TableCell className="text-right text-sm whitespace-nowrap">{player.wins || 0}</TableCell>
                                      <TableCell className="text-right text-sm whitespace-nowrap">{typeof player.goals_against_average === 'number' ? player.goals_against_average.toFixed(2) : '-'}</TableCell>
                                      <TableCell className="text-right text-sm whitespace-nowrap">{typeof player.save_percentage === 'number' ? (player.save_percentage * 100).toFixed(1) : '-'}%</TableCell>
                                    </>
                                  )}
                                  <TableCell>
                                    <div className="flex gap-1 justify-end">
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className={`h-7 w-7 ${watchlist.has(player.id) ? 'text-yellow-500' : 'text-white/55'}`}
                                        onClick={() => toggleWatchlist(player)}
                                      >
                                        <Star className={`h-3.5 w-3.5 ${watchlist.has(player.id) ? 'fill-current' : ''}`} />
                                      </Button>
                                      <Button size="icon" variant="ghost" className="h-9 w-9 text-white/55 touch-manipulation" onClick={() => handlePlayerClick(player)}>
                                        <Info className="h-3.5 w-3.5" />
                                      </Button>
                                      <Button size="sm" variant="default" className={`h-9 w-9 font-bold text-base border shadow-sm p-0 disabled:opacity-50 touch-manipulation ${addBtnColorCls(player)}`} title={player.is_on_waivers ? 'Submit waiver claim' : 'Add to roster'} disabled={addingPlayerId !== null} onClick={() => handleAddPlayer(player)}>
                                        {addingPlayerId === (typeof player.id === 'string' ? parseInt(player.id, 10) : player.id) ? <Loader2 className="h-3 w-3 animate-spin" /> : (player.is_on_waivers ? 'W' : '+')}
                                      </Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                      {/* Infinite scroll sentinel + count */}
                      <div className="text-center py-2 text-xs text-white/55">
                        {filteredPlayers.length === 0 && players.length > 0
                          ? 'No players match those filters — try widening a position or team.'
                          : `Showing ${visiblePlayers.length} of ${filteredPlayers.length} players`}
                      </div>
                      {hasMorePlayers && (
                        <div ref={loadMoreRef} className="flex justify-center py-4">
                          <div className="inline-block animate-spin rounded-full h-5 w-5 border-b-2 border-pastel-orange"></div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            );
            })()}
          </TabsContent>
          <TabsContent value="schedule" className="space-y-4">
             <div className="bg-gradient-to-r from-blue-500/10 to-green-500/10 border border-blue-500/20 p-4 rounded-lg mb-4 flex items-start gap-3">
                <Calendar className="h-5 w-5 text-blue-500 mt-1 shrink-0" />
                <div>
                  <h3 className="font-semibold text-blue-700 dark:text-blue-400">Top Projected Free Agents (Rest of Week)</h3>
                  <p className="text-sm text-white/55">Sorted by projected fantasy points for remaining games this matchup week.</p>
                </div>
             </div>

             {/* Position Filter for Schedule Tab */}
             <div className="flex flex-wrap gap-2 mb-4">
               {positions.map((pos) => (
                 <Badge
                   key={pos}
                   variant={positionFilter === pos ? "default" : "outline"}
                   className="cursor-pointer hover:bg-primary/90 px-4 py-1 text-sm transition-all"
                   onClick={() => setPositionFilter(pos)}
                 >
                   {pos === 'W' ? 'Wingers' : (pos === 'ALL' ? 'All Positions' : pos)}
                 </Badge>
               ))}
             </div>

             {loading || loadingMaximizers || loadingProjections ? (
               <div className="p-12 text-center">
                 <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-pastel-orange"></div>
                 <p className="text-white/55 mt-4">
                   {loading ? 'Loading players...' : loadingProjections ? 'Calculating projections...' : 'Calculating schedule...'}
                 </p>
               </div>
             ) : scheduleMaximizers.length === 0 ? (
               <div className="text-center py-12 text-white/55">
                 <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
                 <p>No schedule data available.</p>
               </div>
             ) : (
               <div className="border rounded-lg overflow-hidden">
                 <div className="overflow-x-auto">
                   <Table className="min-w-[500px] [&_th]:px-2 [&_th]:py-2 [&_th]:text-xs [&_td]:px-2 [&_td]:py-1.5 [&_td]:tabular-nums">
                     <TableHeader>
                       <TableRow className="bg-white/5">
                         <TableHead
                           className="cursor-pointer hover:bg-white/5 select-none text-white/55 hover:text-pastel-cream min-w-[90px] md:min-w-[140px]"
                           onClick={() => handleSort('name')}
                         >
                           <div className="flex items-center justify-start">
                             Player
                             {getSortIcon('name')}
                           </div>
                         </TableHead>
                         <TableHead
                           className="text-center cursor-pointer hover:bg-white/5 select-none text-white/55 hover:text-pastel-cream whitespace-nowrap"
                           onClick={() => handleSort('position')}
                         >
                           <div className="flex items-center justify-center">
                             Pos
                             {getSortIcon('position')}
                           </div>
                         </TableHead>
                         <TableHead className="text-center whitespace-nowrap">
                           <div className="flex items-center justify-center">
                             Schedule
                           </div>
                         </TableHead>
                        <TableHead
                          className="text-right cursor-pointer hover:bg-white/5 select-none text-white/55 hover:text-pastel-cream whitespace-nowrap"
                          onClick={() => handleSort('points')}
                        >
                          <div className="flex items-center justify-end text-xs">
                            Stats
                            {getSortIcon('points')}
                          </div>
                        </TableHead>
                        <TableHead
                          className="text-center cursor-pointer hover:bg-white/5 select-none text-white/55 hover:text-pastel-cream bg-blue-500/10 whitespace-nowrap"
                          onClick={() => handleSort('weeklyProjection')}
                        >
                          <div className="flex items-center justify-center gap-1 font-bold text-blue-700">
                            <TrendingUp className="h-3.5 w-3.5" />
                            Rest of Week
                            {getSortIcon('weeklyProjection')}
                          </div>
                        </TableHead>
                        <TableHead className="w-[80px]"></TableHead>
                       </TableRow>
                     </TableHeader>
                    <TableBody>
                      {(() => {
                        // Filter by position first
                        const positionFiltered = scheduleMaximizers.filter(player => {
                          const normalizedPos = formatPositionForDisplay(player.position);
                          return positionFilter === 'ALL' ||
                            (positionFilter === 'W' ? (normalizedPos === 'LW' || normalizedPos === 'RW') :
                             positionFilter === 'F' ? (normalizedPos === 'C' || normalizedPos === 'LW' || normalizedPos === 'RW') :
                             normalizedPos === positionFilter);
                        });
                        
                        // Sort by weekly projection (highest first) by default
                        const sorted = [...positionFiltered].map(player => {
                          const numericId = typeof player.id === 'string' ? parseInt(player.id, 10) : player.id;
                          const realProjection = weeklyProjections.get(numericId);
                          // Fallback uses actual fantasy PPG * games (not broken points/20)
                          const gw = player.gamesThisWeek || 0;
                          const isG = player.position === 'G';
                          const faScorer = new ScoringCalculator();
                          const estPPG = isG
                            ? ((player.wins || 0) > 0 && player.games_played > 0 ? faScorer.calculatePointsPerGame({
                                wins: player.wins || 0, saves: player.saves || 0, shutouts: player.shutouts || 0, goals_against: player.goals_against || 0
                              }, true, player.games_played) : 3.0)
                            : (player.games_played > 0
                              ? faScorer.calculatePointsPerGame({
                                  goals: player.goals || 0, assists: player.assists || 0, ppp: player.ppp || 0, shp: player.shp || 0,
                                  sog: player.shots || 0, blocks: player.blocks || 0, hits: player.hits || 0, pim: player.pim || 0
                                }, false, player.games_played)
                              : 0);
                          const weeklyProjection = gw === 0
                            ? 0
                            : ((realProjection && realProjection > 0) ? realProjection : (estPPG * gw));
                          return { ...player, weeklyProjection };
                        }).sort((a, b) => {
                          if (sortColumn === 'weeklyProjection' || !sortColumn) {
                            return b.weeklyProjection - a.weeklyProjection;
                          }
                          // Handle other sort columns
                          if (sortColumn === 'name') {
                            return sortDirection === 'asc' 
                              ? a.full_name.localeCompare(b.full_name)
                              : b.full_name.localeCompare(a.full_name);
                          }
                          if (sortColumn === 'position') {
                            return sortDirection === 'asc' 
                              ? a.position.localeCompare(b.position)
                              : b.position.localeCompare(a.position);
                          }
                          return b.weeklyProjection - a.weeklyProjection;
                        });
                        
                        const visibleSorted = sorted.slice(0, visibleCount);
                        const hasMoreSchedule = visibleCount < sorted.length;
                        return (
                          <>
                          {visibleSorted.map((player, index) => {
                           const isGoalie = player.position === 'G';
                           const isTopPick = index < 3; // Highlight top 3
                           return (
                             <TableRow key={player.id} className={`hover:bg-white/5 ${isTopPick ? 'bg-green-500/5' : ''}`}>
                               <TableCell className="font-medium">
                                 <div className="flex items-center gap-2">
                                   {isTopPick && (
                                     <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                                       index === 0 ? 'bg-yellow-500 text-white' :
                                       index === 1 ? 'bg-white/45 text-[#0F1F15]' :
                                       'bg-amber-700 text-white'
                                     }`}>
                                       {index + 1}
                                     </span>
                                   )}
                                   <div className="flex flex-col">
                                     <span
                                       className="hover:underline hover:text-pastel-orange cursor-pointer font-semibold"
                                       onClick={() => handlePlayerClick(player)}
                                     >
                                       {player.full_name}
                                     </span>
                                     <span className="text-xs text-white/55">{player.team} • {isGoalie ? `W: ${player.wins || 0}` : `P: ${player.points || 0}`}</span>
                                   </div>
                                 </div>
                               </TableCell>
                               <TableCell className="text-center">
                                 <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                   isGoalie ? 'bg-purple-500/20 text-purple-700' : 'bg-blue-500/20 text-blue-700'
                                 }`}>
                                   {formatPositionForDisplay(player.position)}
                                 </span>
                               </TableCell>
                               <TableCell className="text-center">
                                 {player.games && player.games.length > 0 && player.team ? (
                                   <div className="flex justify-center items-center">
                                     <div className="inline-flex gap-1 items-center flex-nowrap">
                                       {(() => {
                                         const todayMST = getTodayMST();
                                         return player.games
                                           .filter(game => game && game.game_date)
                                           .sort((a, b) => new Date(a.game_date.split('T')[0] + 'T00:00:00').getTime() - new Date(b.game_date.split('T')[0] + 'T00:00:00').getTime())
                                           .map((game, idx) => {
                                             const gameDateStr = game.game_date.split('T')[0];
                                             const isPastDate = gameDateStr < todayMST;
                                             const isToday = gameDateStr === todayMST;
                                             const playerTeamUpper = (player.team || '').toUpperCase();
                                             const homeTeamUpper = (game.home_team || '').toUpperCase();
                                             const isHome = homeTeamUpper === playerTeamUpper;
                                             const opponent = isHome ? (game.away_team || '') : (game.home_team || '');
                                             if (!opponent) return null;
                                             
                                             return (
                                               <div 
                                                 key={idx}
                                                 className={`relative flex-shrink-0 w-6 h-6 rounded flex items-center justify-center border ${
                                                   isPastDate ? 'opacity-30 grayscale border-gray-300' : 
                                                   isToday ? 'border-2 border-green-500' :
                                                   'border-orange-300'
                                                 }`}
                                                 title={`${isHome ? 'vs' : '@'} ${opponent} - ${gameDateStr}`}
                                               >
                                                 <img 
                                                   src={`https://assets.nhle.com/logos/nhl/svg/${opponent.toUpperCase()}_light.svg`}
                                                   alt={opponent}
                                                   className="w-4 h-4 object-contain"
                                                   onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                                 />
                                               </div>
                                             );
                                           });
                                       })()}
                                     </div>
                                   </div>
                                 ) : (
                                   <span className="text-xs text-white/55">-</span>
                                 )}
                               </TableCell>
                              <TableCell className="text-right">
                                {isGoalie ? (
                                  <div className="flex flex-col text-xs">
                                    <span><b>{player.wins || 0}</b>W</span>
                                    <span>{typeof player.save_percentage === 'number' ? (player.save_percentage * 100).toFixed(1) : '-'}%</span>
                                  </div>
                                ) : (
                                  <div className="text-xs">
                                    <span>{player.goals || 0}G-{player.assists || 0}A-<b>{player.points || 0}P</b></span>
                                  </div>
                                )}
                              </TableCell>
                              <TableCell className="text-center bg-blue-500/5">
                                <div className="flex flex-col items-center">
                                  <span className={`text-lg font-bold ${
                                    isTopPick ? 'text-green-600' : 'text-blue-600'
                                  }`}>
                                    {player.weeklyProjection.toFixed(1)}
                                  </span>
                                  <span className="text-[11px] text-white/55">
                                    {player.gamesThisWeek || 0} game{(player.gamesThisWeek || 0) !== 1 ? 's' : ''} left
                                  </span>
                                </div>
                              </TableCell>
                               <TableCell>
                                 <div className="flex gap-1 justify-end">
                                   <Button
                                     size="icon"
                                     variant="ghost"
                                     className={`h-7 w-7 ${watchlist.has(player.id) ? 'text-yellow-500' : 'text-white/55'}`}
                                     onClick={() => toggleWatchlist(player)}
                                   >
                                     <Star className={`h-3.5 w-3.5 ${watchlist.has(player.id) ? 'fill-current' : ''}`} />
                                   </Button>
                                   <Button size="sm" variant="default" className={`h-9 px-3 text-xs font-bold border shadow-sm disabled:opacity-50 touch-manipulation ${addBtnColorCls(player)}`} title={player.is_on_waivers ? 'Submit waiver claim' : 'Add to roster'} disabled={addingPlayerId !== null} onClick={() => handleAddPlayer(player)}>
                                     {addingPlayerId === (typeof player.id === 'string' ? parseInt(player.id, 10) : player.id) ? <Loader2 className="h-3 w-3 animate-spin" /> : '+ Add'}
                                   </Button>
                                   <Button
                                     size="sm"
                                     variant="outline"
                                     title="Add with drop (swap)"
                                     aria-label="Add with drop"
                                     className="h-7 w-7 p-0 border-emerald-700 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                                     disabled={addingPlayerId !== null}
                                     onClick={() => handleAddWithDrop(player)}
                                   >
                                     <ArrowLeftRight className="h-3.5 w-3.5" />
                                   </Button>
                                 </div>
                               </TableCell>
                             </TableRow>
                           );
                         })}
                         </>
                        );
                       })()}
                     </TableBody>
                   </Table>
                 </div>
                 {/* Schedule tab: count + infinite scroll sentinel */}
                 {(() => {
                   const totalSchedule = scheduleMaximizers.filter(player => {
                     const normalizedPos = formatPositionForDisplay(player.position);
                     return positionFilter === 'ALL' ||
                       (positionFilter === 'W' ? (normalizedPos === 'LW' || normalizedPos === 'RW') :
                        positionFilter === 'F' ? (normalizedPos === 'C' || normalizedPos === 'LW' || normalizedPos === 'RW') :
                        normalizedPos === positionFilter);
                   }).length;
                   return (
                     <>
                       <div className="text-center py-3 text-sm text-white/55">
                         Showing {Math.min(visibleCount, totalSchedule)} of {totalSchedule} players
                       </div>
                       {visibleCount < totalSchedule && (
                         <div ref={loadMoreRef} className="flex justify-center py-4">
                           <div className="inline-block animate-spin rounded-full h-5 w-5 border-b-2 border-pastel-orange"></div>
                         </div>
                       )}
                     </>
                   );
                 })()}
               </div>
             )}
          </TabsContent>
          
          <TabsContent value="watch">
            {players.filter(p => watchlist.has(p.id)).length === 0 ? (
               <div className="p-12 text-center border-2 border-dashed rounded-lg">
                 <Star className="h-12 w-12 mx-auto text-white/55 mb-4" />
                 <h3 className="text-lg font-medium">Your watch list is empty</h3>
                 <p className="text-white/55 mt-2">Star players to keep track of their performance.</p>
                 <Button variant="link" onClick={() => setActiveTab('available')} className="mt-4">
                   Browse Available Players
                 </Button>
               </div>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <Table className="min-w-[600px] [&_th]:px-2 [&_th]:py-2 [&_th]:text-xs [&_td]:px-2 [&_td]:py-1.5 [&_td]:tabular-nums">
                    <TableHeader>
                      <TableRow>
                        <TableHead
                          className="cursor-pointer hover:bg-white/5 select-none text-white/55 hover:text-pastel-cream min-w-[100px] md:min-w-[160px]"
                          onClick={() => handleSort('name')}
                        >
                          <div className="flex items-center justify-start">
                            Player
                            {getSortIcon('name')}
                          </div>
                        </TableHead>
                        <TableHead
                          className="text-right cursor-pointer hover:bg-white/5 select-none text-white/55 hover:text-pastel-cream whitespace-nowrap"
                          onClick={() => handleSort('position')}
                        >
                          <div className="flex items-center justify-end">
                            Pos
                            {getSortIcon('position')}
                          </div>
                        </TableHead>
                        <TableHead
                          className="text-right cursor-pointer hover:bg-white/5 select-none text-white/55 hover:text-pastel-cream whitespace-nowrap"
                          onClick={() => handleSort('team')}
                        >
                          <div className="flex items-center justify-end">
                            Team
                            {getSortIcon('team')}
                          </div>
                        </TableHead>
                        <TableHead
                          className="text-right cursor-pointer hover:bg-white/5 select-none text-white/55 hover:text-pastel-cream whitespace-nowrap"
                          onClick={() => handleSort('gp')}
                        >
                          <div className="flex items-center justify-end">
                            GP
                            {getSortIcon('gp')}
                          </div>
                        </TableHead>
                        {/* Skater Stats - only show if there are skaters */}
                        {players.filter(p => watchlist.has(p.id)).some(p => p.position !== 'G') && (
                          <>
                            <TableHead
                              className="text-right cursor-pointer hover:bg-white/5 select-none text-white/55 hover:text-pastel-cream whitespace-nowrap"
                              onClick={() => handleSort('goals')}
                            >
                              <div className="flex items-center justify-end">
                                G
                                {getSortIcon('goals')}
                              </div>
                            </TableHead>
                            <TableHead
                              className="text-right cursor-pointer hover:bg-white/5 select-none text-white/55 hover:text-pastel-cream whitespace-nowrap"
                              onClick={() => handleSort('assists')}
                            >
                              <div className="flex items-center justify-end">
                                A
                                {getSortIcon('assists')}
                              </div>
                            </TableHead>
                            <TableHead
                              className="text-right cursor-pointer hover:bg-white/5 select-none text-white/55 hover:text-pastel-cream whitespace-nowrap"
                              onClick={() => handleSort('points')}
                            >
                              <div className="flex items-center justify-end">
                                P
                                {getSortIcon('points')}
                              </div>
                            </TableHead>
                            <TableHead
                              className="text-right cursor-pointer hover:bg-white/5 select-none text-white/55 hover:text-pastel-cream whitespace-nowrap"
                              onClick={() => handleSort('shots')}
                            >
                              <div className="flex items-center justify-end">
                                SOG
                                {getSortIcon('shots')}
                              </div>
                            </TableHead>
                            <TableHead
                              className="text-right cursor-pointer hover:bg-white/5 select-none text-white/55 hover:text-pastel-cream whitespace-nowrap"
                              onClick={() => handleSort('hits')}
                            >
                              <div className="flex items-center justify-end">
                                HIT
                                {getSortIcon('hits')}
                              </div>
                            </TableHead>
                            <TableHead
                              className="text-right cursor-pointer hover:bg-white/5 select-none text-white/55 hover:text-pastel-cream whitespace-nowrap"
                              onClick={() => handleSort('blocks')}
                            >
                              <div className="flex items-center justify-end">
                                BLK
                                {getSortIcon('blocks')}
                              </div>
                            </TableHead>
                            <TableHead
                              className="text-right cursor-pointer hover:bg-white/5 select-none text-white/55 hover:text-pastel-cream whitespace-nowrap"
                              onClick={() => handleSort('xGoals')}
                            >
                              <div className="flex items-center justify-end">
                                xG
                                {getSortIcon('xGoals')}
                              </div>
                            </TableHead>
                            {/* Corsi/Fenwick intentionally removed */}
                          </>
                        )}
                        {/* Goalie Stats - only show if there are goalies */}
                        {players.filter(p => watchlist.has(p.id)).some(p => p.position === 'G') && (
                          <>
                            <TableHead
                              className="text-right cursor-pointer hover:bg-white/5 select-none text-white/55 hover:text-pastel-cream whitespace-nowrap"
                              onClick={() => handleSort('wins')}
                            >
                              <div className="flex items-center justify-end">
                                W
                                {getSortIcon('wins')}
                              </div>
                            </TableHead>
                            <TableHead
                              className="text-right cursor-pointer hover:bg-white/5 select-none text-white/55 hover:text-pastel-cream whitespace-nowrap"
                              onClick={() => handleSort('gaa')}
                            >
                              <div className="flex items-center justify-end">
                                GAA
                                {getSortIcon('gaa')}
                              </div>
                            </TableHead>
                            <TableHead
                              className="text-right cursor-pointer hover:bg-white/5 select-none text-white/55 hover:text-pastel-cream whitespace-nowrap"
                              onClick={() => handleSort('savePct')}
                            >
                              <div className="flex items-center justify-end">
                                SV%
                                {getSortIcon('savePct')}
                              </div>
                            </TableHead>
                          </>
                        )}
                        <TableHead className="w-[100px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortPlayers(players.filter(p => watchlist.has(p.id))).map((player) => {
                        const isGoalie = player.position === 'G';
                        return (
                          <TableRow key={player.id} className="hover:bg-white/5">
                            <TableCell className="font-medium whitespace-nowrap">
                              <div className="flex flex-col">
                                <span
                                  className="hover:underline hover:text-pastel-orange cursor-pointer text-sm"
                                  onClick={() => handlePlayerClick(player)}
                                >
                                  {player.full_name}
                                </span>
                                <Badge variant="outline" className="border-yellow-500/30 text-yellow-600 bg-yellow-500/5 w-fit text-[11px] px-1.5 py-0">
                                  Watched
                                </Badge>
                              </div>
                            </TableCell>
                            <TableCell className="text-right text-sm whitespace-nowrap">{formatPositionForDisplay(player.position)}</TableCell>
                            <TableCell className="text-right text-sm whitespace-nowrap">{player.team}</TableCell>
                            <TableCell className="text-right text-sm whitespace-nowrap">{player.games_played || 0}</TableCell>
                            {/* Skater Stats - only render for skaters */}
                            {!isGoalie && (
                              <>
                                <TableCell className="text-right text-sm whitespace-nowrap">{player.goals || 0}</TableCell>
                                <TableCell className="text-right text-sm whitespace-nowrap">{player.assists || 0}</TableCell>
                                <TableCell className="text-right text-sm font-bold whitespace-nowrap">{player.points || 0}</TableCell>
                                <TableCell className="text-right text-sm whitespace-nowrap">{player.shots || 0}</TableCell>
                                <TableCell className="text-right text-sm whitespace-nowrap">{player.hits || 0}</TableCell>
                                <TableCell className="text-right text-sm whitespace-nowrap">{player.blocks || 0}</TableCell>
                                <TableCell className="text-right text-sm whitespace-nowrap">{typeof player.xGoals === 'number' ? player.xGoals.toFixed(1) : '-'}</TableCell>
                                {/* Corsi/Fenwick intentionally removed */}
                              </>
                            )}
                            {/* Goalie Stats - only render for goalies */}
                            {isGoalie && (
                              <>
                                <TableCell className="text-right text-sm whitespace-nowrap">{player.wins || 0}</TableCell>
                                <TableCell className="text-right text-sm whitespace-nowrap">{typeof player.goals_against_average === 'number' ? player.goals_against_average.toFixed(2) : '-'}</TableCell>
                                <TableCell className="text-right text-sm whitespace-nowrap">{typeof player.save_percentage === 'number' ? (player.save_percentage * 100).toFixed(1) : '-'}%</TableCell>
                              </>
                            )}
                            <TableCell>
                              <div className="flex gap-1 justify-end">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 text-yellow-500"
                                  onClick={() => toggleWatchlist(player)}
                                >
                                  <Star className="h-3.5 w-3.5 fill-current" />
                                </Button>
                                <Button size="icon" variant="ghost" className="h-9 w-9 text-white/55 touch-manipulation" onClick={() => handlePlayerClick(player)}>
                                  <Info className="h-3.5 w-3.5" />
                                </Button>
                                <Button size="sm" variant="default" className={`h-9 w-9 font-bold text-base border shadow-sm p-0 disabled:opacity-50 touch-manipulation ${addBtnColorCls(player)}`} title={player.is_on_waivers ? 'Submit waiver claim' : 'Add to roster'} disabled={addingPlayerId !== null} onClick={() => handleAddPlayer(player)}>
                                  {addingPlayerId === (typeof player.id === 'string' ? parseInt(player.id, 10) : player.id) ? <Loader2 className="h-3 w-3 animate-spin" /> : (player.is_on_waivers ? 'W' : '+')}
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Player Stats Modal */}
        <PlayerStatsModal
          player={selectedPlayer}
          isOpen={isPlayerDialogOpen}
          onClose={() => setIsPlayerDialogOpen(false)}
        />

        {/* Atomic add+drop swap dialog */}
        {user && leagueId && swapTeamId && (
          <DropPlayerForAddDialog
            open={swapDialogOpen}
            onOpenChange={(v) => {
              setSwapDialogOpen(v);
              if (!v) {
                setSwapAddPlayer(null);
              }
            }}
            addPlayer={swapAddPlayer}
            leagueId={leagueId}
            teamId={swapTeamId}
            userId={user.id}
            onSuccess={() => {
              fetchPlayers();
              fetchTrendingData();
            }}
          />
        )}
            </div>

            {/* Left Sidebar - At bottom on mobile, left on desktop */}
            <aside className="w-full lg:w-auto order-2 lg:order-1">
              <div className="lg:sticky lg:top-24 space-y-4 lg:space-y-4">
                <div className="bg-[#1A2A20] ring-1 ring-pastel-orange/30 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)] overflow-hidden">
                  <MascotPortrait id="stormy" />
                  <div className="p-5">
                    <div className="font-jbmono text-[9px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold mb-1">
                      ✦ Stormy says
                    </div>
                    <div className="font-calistoga text-xl text-pastel-cream mb-3">Pickup priority</div>
                    <ul className="text-[11px] text-white/70 space-y-1.5 leading-relaxed">
                      <li className="flex gap-2"><span className="text-pastel-orange">▸</span> Trending pickups go fast — claim early</li>
                      <li className="flex gap-2"><span className="text-pastel-orange">▸</span> Weekly schedule beats raw points-per-game</li>
                      <li className="flex gap-2"><span className="text-pastel-orange">▸</span> Star a player to track him on the watchlist</li>
                    </ul>
                  </div>
                </div>
                <div className="bg-[#1A2A20] ring-1 ring-white/10 rounded-2xl p-4 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                  <div className="flex items-center gap-2 mb-2">
                    <RangeIcon className="w-4 h-4 text-pastel-orange" strokeWidth={2} />
                    <div className="font-jbmono text-[9px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold">Sort tips</div>
                  </div>
                  <p className="text-[11px] text-white/70 leading-relaxed">
                    Click any column header to sort. Tap a player row for full stats and projection breakdown.
                  </p>
                </div>
              </div>
            </aside>

            {/* Right Sidebar - Notifications (hidden on mobile) */}
            {userLeagueState === 'active-user' && activeLeagueId && (
              <aside className="hidden lg:block order-3">
                <div className="lg:sticky lg:top-24 h-[calc(100vh-7rem)] bg-[#1A2A20] ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)] overflow-hidden">
                  <LeagueNotifications leagueId={activeLeagueId} />
                </div>
              </aside>
            )}
          </div>
        </div>
      </main>
      <HockeyFooter />
    </div>
  );
};

export default FreeAgents;
