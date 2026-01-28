import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import { supabase } from '@/integrations/supabase/client';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { Calendar, TrendingUp, Filter, List, Grid, Star, Info, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import LoadingScreen from '@/components/LoadingScreen';
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
import { LeagueCreationCTA } from '@/components/LeagueCreationCTA';
import { getPlayerWithSeasonStats } from '@/utils/playerStatsHelper';
import { getTodayMST } from '@/utils/timezoneUtils';
import { CitrusBackground } from '@/components/CitrusBackground';
import { COLUMNS } from '@/utils/queryColumns';
import { AdSpace } from '@/components/AdSpace';
import LeagueNotifications from '@/components/matchup/LeagueNotifications';
import { GameLogosBar } from '@/components/matchup/GameLogosBar';

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
  const { userLeagueState, activeLeagueId, isChangingLeague } = useLeague();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState('');
  const [positionFilter, setPositionFilter] = useState('ALL');
  const [activeTab, setActiveTab] = useState('available');
  const [viewMode, setViewMode] = useState<'summary' | 'all'>('summary');
  const [players, setPlayers] = useState<Player[]>([]);
  const [watchlist, setWatchlist] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
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
  const [loadingProjections, setLoadingProjections] = useState(false);

  // Sorting state
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Player Stats Modal State
  const [selectedPlayer, setSelectedPlayer] = useState<HockeyPlayer | null>(null);
  const [isPlayerDialogOpen, setIsPlayerDialogOpen] = useState(false);

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
  }, [searchParams, activeLeagueId, isChangingLeague]);

  // Load schedule maximizers only when the tab is active
  useEffect(() => {
    if (activeTab === 'schedule' && players.length > 0 && scheduleMaximizers.length === 0 && !loadingMaximizers) {
      calculateScheduleMaximizers(players);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, players.length]);

  // Fetch weekly projections for top free agents (for Top Projected list)
  // CRITICAL: Works for BOTH active users AND demo/guest users (EXACT SAME WAY)
  useEffect(() => {
    if (players.length > 0 && weeklyProjections.size === 0 && !loadingProjections) {
      fetchWeeklyProjections();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players.length, activeLeagueId]);

  const fetchPlayers = async () => {
    try {
      setLoading(true);
      
      // DEMO MODE: For guests, show all players as free agents (no league filtering)
      if (isGuestMode(userLeagueState)) {
        try {
          const allPlayers = await PlayerService.getAllPlayers();
          // Show top players by points for demo
          const sortedPlayers = [...allPlayers]
            .sort((a, b) => (b.points || 0) - (a.points || 0))
            .slice(0, 200); // Top 200 players
          setPlayers(sortedPlayers);
          setLoading(false);
          return;
        } catch (error) {
          console.error('Error fetching demo players:', error);
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
          const { data: userTeamDataResult } = await supabase
            .from('teams')
            .select('league_id')
            .eq('owner_id', user.id)
            .maybeSingle();
          
          if (userTeamDataResult) {
            const userTeamData = userTeamDataResult as { league_id: string };
            currentLeagueId = userTeamData.league_id;
          }
        } catch (error) {
          console.error('Error fetching user team:', error);
          // Continue without league ID - will show all players
        }
      }
      
      setLeagueId(currentLeagueId || null);
      
      // Get all players from our pipeline tables (player_directory + player_season_stats)
      // PlayerService.getAllPlayers() is the ONLY source for player data
      // CRITICAL: This now filters to only include players with matching stats records (same as getPlayersByIds)
      // This ensures Free Agents shows the EXACT same players and stats as Matchup tab and Player Cards
      const allPlayers = await PlayerService.getAllPlayers();
      
      console.log(`[FreeAgents] Fetched ${allPlayers.length} players from PlayerService.getAllPlayers()`);
      
      // Debug: Log sample players to verify data
      if (allPlayers.length > 0) {
        const samplePlayers = allPlayers.slice(0, 3);
        samplePlayers.forEach(samplePlayer => {
          const calculatedPoints = samplePlayer.goals + samplePlayer.assists;
          console.log(`[FreeAgents] Sample: ${samplePlayer.full_name} (ID: ${samplePlayer.id}) - ${samplePlayer.goals}G ${samplePlayer.assists}A ${samplePlayer.points}P (GP: ${samplePlayer.games_played}, Team: ${samplePlayer.team})`);
          if (Math.abs(samplePlayer.points - calculatedPoints) > 0.5) {
            console.warn(`[FreeAgents] WARNING: Points mismatch for ${samplePlayer.full_name}: points=${samplePlayer.points}, goals+assists=${calculatedPoints}`);
          }
        });
      }
      
      if (!allPlayers || allPlayers.length === 0) {
        throw new Error('No players found');
      }
      
      // LeagueService determines free agents - uses real database if leagueId provided
      // Dropped players (with deleted_at) will be included as free agents
      const freeAgents = await LeagueService.getFreeAgents(allPlayers, currentLeagueId, user.id);
      setPlayers(freeAgents);
      
      // Don't calculate schedule maximizers here - will be lazy loaded when tab is active
    } catch (error) {
      console.error('Error fetching players:', error);
      console.error('Error details:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      toast({
        title: "Error",
        description: `Failed to load players: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: "destructive"
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
      
      // Try to get matchup week from league data (for both logged-in users and guests viewing demo)
      const effectiveLeagueId = leagueId || '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'; // Demo league ID for guests
      const debugLog = (window as any).__originalConsole?.log || console.log;
      
      // EXACT SAME LOGIC AS MATCHUP TAB - Fetch matchup directly from database first
      try {
        const { data: matchups, error: matchupError } = await supabase
          .from('matchups')
          .select('week_start_date, week_end_date')
          .eq('league_id', effectiveLeagueId)
          .eq('status', 'in_progress')
          .limit(1);
        
        if (!matchupError && matchups && matchups.length > 0) {
          const matchup = matchups[0];
          weekStart = new Date(matchup.week_start_date + 'T00:00:00');
          weekStart.setHours(0, 0, 0, 0);
          weekEnd = new Date(matchup.week_end_date + 'T23:59:59');
          weekEnd.setHours(23, 59, 59, 999);
          // Use local date format to avoid timezone issues
          const formatDateLocal = (d: Date) => {
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
          };
          debugLog(`[FreeAgents Projections] Using matchup week from database: ${formatDateLocal(weekStart)} to ${formatDateLocal(weekEnd)}`);
        } else {
          debugLog('[FreeAgents Projections] No in_progress matchup found, will calculate from league');
        }
      } catch (error) {
        debugLog('[FreeAgents Projections] Error fetching matchup:', error);
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
              // Use local date format to avoid timezone issues
              const formatDateLocal = (d: Date) => {
                const year = d.getFullYear();
                const month = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                return `${year}-${month}-${day}`;
              };
              debugLog(`[FreeAgents Projections] Calculated week from league: ${formatDateLocal(weekStart)} to ${formatDateLocal(weekEnd)}`);
            }
          }
        } catch (error) {
          debugLog('[FreeAgents Projections] Could not fetch league data, will fall back to calendar week:', error);
        }
      }
      
      // FALLBACK: If still no week dates, use current calendar week (Monday-Sunday)
      if (!weekStart || !weekEnd) {
        const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, etc.
        const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        
        weekStart = new Date(today);
        weekStart.setDate(today.getDate() - daysFromMonday);
        weekStart.setHours(0, 0, 0, 0);
        
        weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        weekEnd.setHours(23, 59, 59, 999);
        
        debugLog(`[FreeAgents Projections] FALLBACK: Using calendar week`);
      }

      // Get remaining days in the week (today through Sunday)
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
      
      debugLog(`[FreeAgents Projections] Fetching projections for remaining week: ${weekDays[0]} to ${weekDays[weekDays.length - 1]} (${weekDays.length} days)`);

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
      
      // Initialize all players with 0 using NUMERIC IDs
      topPlayers.forEach(player => {
        const numericId = typeof player.id === 'string' ? parseInt(player.id, 10) : player.id;
        if (!isNaN(numericId) && numericId > 0) {
          weeklyProjectionMap.set(numericId, 0);
        }
      });

      // Debug logging (reuse debugLog from above)
      debugLog(`[FreeAgents Projections] Fetching for ${weekDays.length} days: ${weekDays[0]} to ${weekDays[weekDays.length - 1]}`);
      debugLog(`[FreeAgents Projections] Player count: ${playerIds.length}`);
      
      // Fetch projections for each day and aggregate ALL 8 STATS
      for (const date of weekDays) {
        try {
          const dailyProjections = await MatchupService.getDailyProjectionsForMatchup(playerIds, date);
          debugLog(`[FreeAgents Projections] ${date}: Got ${dailyProjections.size} projections`);
          
          // Sum up ALL STATS for each player (full transparency)
          // CRITICAL: Use playerId directly (numeric) as Map key to ensure proper accumulation
          dailyProjections.forEach((projection, playerId) => {
            // Use playerId directly as key (it's already a number from the Map)
            const currentTotal = weeklyProjectionMap.get(playerId) || 0;
            const dailyPoints = Number(projection.total_projected_points || 0);
            const newTotal = currentTotal + dailyPoints;
            weeklyProjectionMap.set(playerId, newTotal);
            
            // Debug first few to verify aggregation
            if (weeklyProjectionMap.size <= 5) {
              const player = topPlayers.find(p => {
                const pId = typeof p.id === 'string' ? parseInt(p.id, 10) : p.id;
                return pId === playerId;
              });
              if (player) {
                debugLog(`  [${date}] Player ${player.full_name} (ID: ${playerId}): ${currentTotal.toFixed(1)} + ${dailyPoints.toFixed(1)} = ${newTotal.toFixed(1)}`);
              }
            }
          });
        } catch (error) {
          debugLog(`[FreeAgents Projections] Error for ${date}:`, error);
        }
      }

      setWeeklyProjections(weeklyProjectionMap);
      
      // Debug: Log final aggregated projections (reuse debugLog from above)
      const topProjectionPlayers = Array.from(weeklyProjectionMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([numericId, total]) => {
          const player = topPlayers.find(p => {
            const pId = typeof p.id === 'string' ? parseInt(p.id, 10) : p.id;
            return pId === numericId;
          });
          return { name: player?.full_name, id: numericId, total: total.toFixed(1) };
        });
      debugLog('[FreeAgents Projections] Top 10 aggregated weekly projections:', topProjectionPlayers);
      
      const goalieProjections = topPlayers
        .filter(p => p.position === 'G')
        .slice(0, 5)
        .map(p => {
          const numericId = typeof p.id === 'string' ? parseInt(p.id, 10) : p.id;
          return {
            name: p.full_name,
            id: numericId,
            weeklyProj: (weeklyProjectionMap.get(numericId) || 0).toFixed(1)
          };
        });
      debugLog('[FreeAgents Projections] Top 5 goalie projections:', goalieProjections);
    } catch (error) {
      console.error('Error fetching weekly projections:', error);
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
      
      // Default to calendar week, then try to use matchup week if league data is available
      let weekStart: Date | null = null;
      let weekEnd: Date | null = null;
      
      // Try to get matchup week from league data (for both logged-in users and guests viewing demo)
      const effectiveLeagueId = leagueId || '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'; // Demo league ID for guests
      const log = (window as any).__originalConsole?.log || console.log;
      
      // EXACT SAME LOGIC AS MATCHUP TAB - Fetch matchup directly from database
      try {
        const { data: matchups, error: matchupError } = await supabase
          .from('matchups')
          .select('week_start_date, week_end_date')
          .eq('league_id', effectiveLeagueId)
          .eq('status', 'in_progress')
          .limit(1);
        
        if (!matchupError && matchups && matchups.length > 0) {
          const matchup = matchups[0];
          weekStart = new Date(matchup.week_start_date + 'T00:00:00');
          weekStart.setHours(0, 0, 0, 0);
          weekEnd = new Date(matchup.week_end_date + 'T23:59:59');
          weekEnd.setHours(23, 59, 59, 999);
          // Use local date format to avoid timezone issues
          const formatLocalDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          log(`[FreeAgents Schedule] Using matchup week from database: ${formatLocalDate(weekStart)} to ${formatLocalDate(weekEnd)}`);
        } else {
          log('[FreeAgents Schedule] No in_progress matchup found, will calculate from league');
        }
      } catch (error) {
        log('[FreeAgents Schedule] Error fetching matchup:', error);
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
              // Use local date format to avoid timezone issues
              const formatLocalDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
              log(`[FreeAgents Schedule] Calculated week from league: ${formatLocalDate(weekStart)} to ${formatLocalDate(weekEnd)}`);
            }
          }
        } catch (error) {
          log('[FreeAgents Schedule] Error fetching league:', error);
        }
      }
      
      // FALLBACK: If still no week dates, use current calendar week (Monday-Sunday)
      if (!weekStart || !weekEnd) {
        const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, etc.
        const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        
        weekStart = new Date(today);
        weekStart.setDate(today.getDate() - daysFromMonday);
        weekStart.setHours(0, 0, 0, 0);
        
        weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        weekEnd.setHours(23, 59, 59, 999);
        
        log(`[FreeAgents Schedule] FALLBACK: Using calendar week ${weekStart.toLocaleDateString()} to ${weekEnd.toLocaleDateString()}`);
      }
      
      // Batch fetch games for all teams in parallel
      const teamGamesPromises = uniqueTeams.map(team => 
        ScheduleService.getGamesForTeamInWeek(team, weekStart, weekEnd)
          .then(({ games, error }) => {
            if (error) {
              console.warn(`Error fetching games for ${team}:`, error);
              return { team, games: [] };
            }
            return { team, games: games || [] };
          })
          .catch((error) => {
            console.warn(`Exception fetching games for ${team}:`, error);
            return { team, games: [] };
          })
      );
      
      const teamGamesResults = await Promise.all(teamGamesPromises);
      const teamGamesMap = new Map<string, NHLGame[]>();
      teamGamesResults.forEach(({ team, games }) => {
        teamGamesMap.set(team, games);
      });
      
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
      
      // Use log from above (already declared)
      log(`[FreeAgents Schedule] ==========================================`);
      log(`[FreeAgents Schedule] Week range: ${weekStartStr} to ${weekEndStr}`);
      log(`[FreeAgents Schedule] Today (MST): ${todayMSTStr}`);
      log(`[FreeAgents Schedule] Day of week: ${today.getDay()} (0=Sun, 1=Mon, 6=Sat)`);
      log(`[FreeAgents Schedule] Fetched games for ${uniqueTeams.length} teams. Total games before filtering: ${Array.from(teamGamesMap.values()).reduce((sum, games) => sum + games.length, 0)}`);
      
      // Log sample team's games for debugging
      if (teamGamesMap.size > 0) {
        const sampleTeam = Array.from(teamGamesMap.keys())[0];
        const sampleGames = teamGamesMap.get(sampleTeam) || [];
        log(`[FreeAgents Schedule] Sample team ${sampleTeam} games:`, sampleGames.map(g => ({
          date: g.game_date?.split('T')[0],
          home: g.home_team,
          away: g.away_team,
          status: g.status
        })));
      }
      
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
        
        // Log first few players for debugging
        if (maximizers.length < 3) {
          log(`[FreeAgents Schedule] ${player.name} (${player.team}): ${gamesRemaining} games remaining, ${games.length} total in week`);
          games.forEach(g => {
            const gameDateStr = g.game_date.split('T')[0];
            const gameStatusLower = (g.status || '').toLowerCase();
            const isTodayOrFuture = gameDateStr >= todayMSTStr;
            const isNotFinal = gameStatusLower !== 'final' && gameStatusLower !== 'off';
            const isRemaining = isTodayOrFuture && isNotFinal;
            log(`    ${gameDateStr} vs ${g.home_team}/${g.away_team} - ${g.status} - ${isRemaining ? 'REMAINING' : 'past/final'}`);
          });
        }
        
        const count = gamesRemaining; // Use REMAINING games, not total
        
        // Log first few players for debugging
        if (maximizers.length < 3) {
          log(`[FreeAgents Schedule] Player ${player.name} (${player.team}): ${count} games in week, ${allGames.length} total fetched`);
        }
        
        // Include all players (no minimum game requirement)
        // Get day abbreviations for each game
        const gameDays = games.map(game => {
          const gameDate = new Date(game.game_date);
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
      
      log(`[FreeAgents Schedule] Calculated maximizers for ${maximizers.length} players`);
      
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
      console.error('Error calculating schedule maximizers:', error);
      setScheduleMaximizers([]);
    } finally {
      setLoadingMaximizers(false);
    }
  };

  const handleAddPlayer = async (player: Player) => {
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

    // Check draft status FIRST - must complete draft before adding free agents
    try {
      const { data: leagueData } = await supabase
        .from('leagues')
        .select('draft_status')
        .eq('id', leagueId)
        .single();
      
      if (leagueData && leagueData.draft_status !== 'completed') {
        toast({
          title: "Draft Required",
          description: "You must complete the draft before adding free agents.",
          variant: "destructive"
        });
        return;
      }
    } catch (error) {
      console.error("[FreeAgents] Error checking draft status:", error);
      toast({
        title: "Error",
        description: "Could not verify draft status.",
        variant: "destructive"
      });
      return;
    }

    try {
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

      // Get current roster size
      const { data: teamDataResult } = await supabase
        .from('teams')
        .select('id')
        .eq('league_id', leagueId)
        .eq('owner_id', user.id)
        .single();

      if (!teamDataResult) {
        toast({
          title: "Error",
          description: "Team not found.",
          variant: "destructive"
        });
        return;
      }
      const teamData = teamDataResult as { id: string };

      // Get lineup data (use maybeSingle to handle case where no lineup exists yet)
      const { data: lineupDataResult, error: lineupError } = await supabase
        .from('team_lineups')
        .select('starters, bench, ir')
        .eq('team_id', teamData.id)
        .eq('league_id', leagueId)
        .maybeSingle();

      // Check for query errors (not just "no rows found")
      if (lineupError && lineupError.code !== 'PGRST116') {
        // PGRST116 = no rows found (expected when no lineup exists yet)
        // Any other error is a real database error
        console.error('Error fetching lineup data:', lineupError);
        toast({
          title: "Error",
          description: "Could not load lineup information.",
          variant: "destructive"
        });
        return;
      }
      const lineupData = lineupDataResult as any;

      // Calculate current roster size
      // If lineup exists, use it; otherwise count roster_assignments (source of truth)
      let currentRosterSize = 0;
      if (lineupData) {
        // Lineup exists - use lineup data
        currentRosterSize = 
          (lineupData.starters?.length || 0) +
          (lineupData.bench?.length || 0) +
          (lineupData.ir?.length || 0);
      } else {
        // No lineup exists yet - count roster_assignments instead
        const { count: rosterCount, error: rosterError } = await supabase
          .from('roster_assignments')
          .select(COLUMNS.COUNT, { count: 'exact', head: true })
          .eq('team_id' as any, teamData.id as any)
          .eq('league_id' as any, leagueId as any);
        
        if (rosterError) {
          console.error('Error counting roster_assignments:', rosterError);
          toast({
            title: "Error",
            description: "Could not load roster for size check.",
            variant: "destructive"
          });
          return;
        } else {
          currentRosterSize = rosterCount || 0;
        }
      }

      const maxRosterSize = league.roster_size + 3; // roster_size + 3 IR slots

      // If roster is full, navigate to roster page with add player intent
      if (currentRosterSize >= maxRosterSize) {
        navigate(`/roster?addPlayer=${player.id}&playerName=${encodeURIComponent(player.full_name)}`);
        toast({
          title: "Roster Full",
          description: `Navigate to your roster to drop a player and add ${player.full_name}.`,
        });
        return;
      }

      // Roster has space, proceed with adding
      // Use WaiverService.addPlayer which checks game locks and handles waivers properly
      const playerIdNum = typeof player.id === 'string' ? parseInt(player.id, 10) : player.id;
      const result = await WaiverService.addPlayer(
        leagueId,
        teamData.id,
        playerIdNum,
        null // No drop player specified
      );

      if (result.success) {
        if (result.isFreeAgent) {
          toast({
            title: "Player Added",
            description: `${player.full_name} has been added to your roster immediately.`,
          });
        } else {
          toast({
            title: "Waiver Claim Submitted",
            description: `${player.full_name} is game-locked. Waiver claim submitted and will process at 3:00 AM EST.`,
          });
        }
        // Refresh the free agents list to remove the added player
        await fetchPlayers();
      } else {
        // Handle error case - isFreeAgent may be undefined on error
        const isWaiverClaim = result.isFreeAgent === false;
        toast({
          title: isWaiverClaim ? "Claim Failed" : "Add Failed",
          description: result.error || "Failed to add player. Please try again.",
          variant: "destructive"
        });
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Failed to add player. Please try again.";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive"
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
        (positionFilter === 'W' ? (normalizedPlayerPos === 'LW' || normalizedPlayerPos === 'RW') : normalizedPlayerPos === positionFilter);
      
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
  const topTrending = [...filteredPlayers]
    .map(p => ({
      ...p,
      adds: Math.floor((p.points || 0) * 15 + (p.full_name.length * 10)) // Mock adds count
    }))
    .sort((a, b) => b.adds - a.adds)
    .slice(0, 5);

  const topProjected = [...filteredPlayers]
    .map(p => {
      // Use numeric ID to match Map key type
      const numericId = typeof p.id === 'string' ? parseInt(p.id, 10) : p.id;
      const realProjection = weeklyProjections.get(numericId);
      // Use real projection if > 0, otherwise fallback to mock
      const weeklyProjection = (realProjection && realProjection > 0) ? realProjection : ((p.points || 0) / 20);
      return {
        ...p,
        weeklyProjection
      };
    })
    .sort((a, b) => b.weeklyProjection - a.weeklyProjection)
    .slice(0, 5);

  const positions = ['ALL', 'C', 'LW', 'RW', 'W', 'D', 'G'];

  return (
    <div className="min-h-screen bg-[#D4E8B8] relative overflow-hidden">
      <CitrusBackground density="light" />
      <Navbar />
      <main className="w-full pt-28 pb-16 m-0 p-0">
        <div className="w-full m-0 p-0">
          {/* Sidebar, Content, and Notifications Grid - Sidebar at bottom on mobile, left on desktop; Notifications on right on desktop */}
          <div className="flex flex-col lg:grid lg:grid-cols-[240px_1fr_300px] lg:gap-8 lg:px-8 lg:mx-0 lg:w-screen lg:relative lg:left-1/2 lg:-translate-x-1/2">
            {/* Main Content - Appears first on mobile */}
            <div className="min-w-0 px-2 lg:px-6 order-1 lg:order-2">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-bold">Free Agents</h1>
            <p className="text-muted-foreground">Available players to improve your roster</p>
          </div>
          <div className="flex gap-2 w-full md:w-auto">
            <Input 
              placeholder="Search players..." 
              className="max-w-xs"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Demo Mode Banner */}
        {isGuestMode(userLeagueState) && (
          <div className="mb-6">
            <LeagueCreationCTA 
              title="You're viewing demo data"
              description="Sign up to add players to your roster and start managing your team."
              variant="compact"
            />
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3 max-w-2xl mb-6">
            <TabsTrigger value="available">Available</TabsTrigger>
            <TabsTrigger value="schedule" className="gap-2"><Calendar className="h-4 w-4" /> Schedule</TabsTrigger>
            <TabsTrigger value="watch">Watch List</TabsTrigger>
          </TabsList>
          
          <TabsContent value="available" className="space-y-6">
            {/* Quick Position Filters */}
            <div className="flex flex-wrap gap-2">
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

            {(() => {
              const displayLoading = useMinimumLoadingTime(loading, 800);
              if (displayLoading) {
                return (
                  <LoadingScreen
                    character="pineapple"
                    message="Loading Free Agents..."
                  />
                );
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
                                <span className="text-xs text-muted-foreground">{formatPositionForDisplay(player.position)} • {player.team}</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <div className="text-right">
                                  <div className="font-bold text-green-600">{player.adds.toLocaleString()}</div>
                                  <div className="text-[10px] text-muted-foreground">Adds</div>
                                </div>
                                <Button size="default" variant="default" className="h-10 w-10 text-primary font-bold text-xl bg-primary/10 hover:bg-primary/20 border border-primary/30" onClick={() => handleAddPlayer(player)}>
                                  +
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Desktop Table View */}
                        <div className="hidden md:block">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Player</TableHead>
                                <TableHead className="text-right">Pos</TableHead>
                                <TableHead className="text-right">Adds</TableHead>
                                <TableHead className="w-[50px]"></TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {topTrending.map(player => (
                              <TableRow key={player.id}>
                                <TableCell className="font-medium">
                                  <div className="flex flex-col">
                                    <span 
                                      className="hover:underline hover:text-primary cursor-pointer"
                                      onClick={() => handlePlayerClick(player)}
                                    >
                                      {player.full_name}
                                    </span>
                                    <span className="text-xs text-muted-foreground">{player.team}</span>
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
                                      className={`h-8 w-8 ${watchlist.has(player.id) ? 'text-yellow-500' : 'text-muted-foreground'}`}
                                      onClick={() => toggleWatchlist(player)}
                                    >
                                      <Star className={`h-4 w-4 ${watchlist.has(player.id) ? 'fill-current' : ''}`} />
                                    </Button>
                                    <Button size="default" variant="default" className="h-10 w-10 text-primary font-bold text-xl bg-primary/10 hover:bg-primary/20 border border-primary/30" onClick={() => handleAddPlayer(player)}>
                                      +
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

                    {/* Top Projected Table */}
                    <Card>
                      <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-lg font-bold flex items-center gap-2">
                          <Calendar className="h-5 w-5 text-blue-500" />
                          Top Projected (Remaining Week)
                        </CardTitle>
                        <Button variant="ghost" size="sm" onClick={() => setViewMode('all')}>See All</Button>
                      </CardHeader>
                      <CardContent className="p-0">
                        {/* Mobile List View */}
                        <div className="md:hidden">
                          {topProjected.map(player => (
                            <div key={player.id} className="p-3 border-b flex items-center justify-between">
                              <div className="flex flex-col">
                                <span className="font-medium">{player.full_name}</span>
                                <span className="text-xs text-muted-foreground">{formatPositionForDisplay(player.position)} • {player.team}</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <div className="text-right">
                                  <div className="font-bold text-blue-600">
                                    {((player as any).weeklyProjection || 0).toFixed(1)}
                                  </div>
                                  <div className="text-[10px] text-muted-foreground">Proj</div>
                                </div>
                                <Button size="default" variant="default" className="h-10 w-10 text-primary font-bold text-xl bg-primary/10 hover:bg-primary/20 border border-primary/30" onClick={() => handleAddPlayer(player)}>
                                  +
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Desktop Table View */}
                        <div className="hidden md:block">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Player</TableHead>
                                <TableHead className="text-right">Pos</TableHead>
                                <TableHead className="text-right">Proj</TableHead>
                                <TableHead className="w-[50px]"></TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {topProjected.map(player => (
                              <TableRow key={player.id}>
                                <TableCell className="font-medium">
                                  <div className="flex flex-col">
                                    <span 
                                      className="hover:underline hover:text-primary cursor-pointer"
                                      onClick={() => handlePlayerClick(player)}
                                    >
                                      {player.full_name}
                                    </span>
                                    <span className="text-xs text-muted-foreground">{player.team}</span>
                                  </div>
                                </TableCell>
                                <TableCell className="text-right">{formatPositionForDisplay(player.position)}</TableCell>
                                <TableCell className="text-right font-bold text-blue-600">
                                  {((player as any).weeklyProjection || 0).toFixed(1)}
                                </TableCell>
                                <TableCell>
                                  <div className="flex gap-1">
                                    <Button 
                                      size="icon" 
                                      variant="ghost" 
                                      className={`h-8 w-8 ${watchlist.has(player.id) ? 'text-yellow-500' : 'text-muted-foreground'}`}
                                      onClick={() => toggleWatchlist(player)}
                                    >
                                      <Star className={`h-4 w-4 ${watchlist.has(player.id) ? 'fill-current' : ''}`} />
                                    </Button>
                                    <Button size="default" variant="default" className="h-10 w-10 text-primary font-bold text-xl bg-primary/10 hover:bg-primary/20 border border-primary/30" onClick={() => handleAddPlayer(player)}>
                                      +
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
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead 
                                className="cursor-pointer hover:bg-muted/50 select-none"
                                onClick={() => handleSort('name')}
                              >
                                <div className="flex items-center justify-start">
                                  Player
                                  {getSortIcon('name')}
                                </div>
                              </TableHead>
                              <TableHead 
                                className="text-right cursor-pointer hover:bg-muted/50 select-none"
                                onClick={() => handleSort('position')}
                              >
                                <div className="flex items-center justify-end">
                                  Pos
                                  {getSortIcon('position')}
                                </div>
                              </TableHead>
                              <TableHead 
                                className="text-right cursor-pointer hover:bg-muted/50 select-none"
                                onClick={() => handleSort('team')}
                              >
                                <div className="flex items-center justify-end">
                                  Team
                                  {getSortIcon('team')}
                                </div>
                              </TableHead>
                              <TableHead 
                                className="text-right cursor-pointer hover:bg-muted/50 select-none"
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
                                    className="text-right cursor-pointer hover:bg-muted/50 select-none"
                                    onClick={() => handleSort('goals')}
                                  >
                                    <div className="flex items-center justify-end">
                                      G
                                      {getSortIcon('goals')}
                                    </div>
                                  </TableHead>
                                  <TableHead 
                                    className="text-right cursor-pointer hover:bg-muted/50 select-none"
                                    onClick={() => handleSort('assists')}
                                  >
                                    <div className="flex items-center justify-end">
                                      A
                                      {getSortIcon('assists')}
                                    </div>
                                  </TableHead>
                                  <TableHead 
                                    className="text-right cursor-pointer hover:bg-muted/50 select-none"
                                    onClick={() => handleSort('points')}
                                  >
                                    <div className="flex items-center justify-end">
                                      P
                                      {getSortIcon('points')}
                                    </div>
                                  </TableHead>
                                  <TableHead 
                                    className="text-right cursor-pointer hover:bg-muted/50 select-none"
                                    onClick={() => handleSort('shots')}
                                  >
                                    <div className="flex items-center justify-end">
                                      SOG
                                      {getSortIcon('shots')}
                                    </div>
                                  </TableHead>
                                  <TableHead 
                                    className="text-right cursor-pointer hover:bg-muted/50 select-none"
                                    onClick={() => handleSort('hits')}
                                  >
                                    <div className="flex items-center justify-end">
                                      HIT
                                      {getSortIcon('hits')}
                                    </div>
                                  </TableHead>
                                  <TableHead 
                                    className="text-right cursor-pointer hover:bg-muted/50 select-none"
                                    onClick={() => handleSort('blocks')}
                                  >
                                    <div className="flex items-center justify-end">
                                      BLK
                                      {getSortIcon('blocks')}
                                    </div>
                                  </TableHead>
                                  <TableHead 
                                    className="text-right cursor-pointer hover:bg-muted/50 select-none"
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
                                    className="text-right cursor-pointer hover:bg-muted/50 select-none"
                                    onClick={() => handleSort('wins')}
                                  >
                                    <div className="flex items-center justify-end">
                                      W
                                      {getSortIcon('wins')}
                                    </div>
                                  </TableHead>
                                  <TableHead 
                                    className="text-right cursor-pointer hover:bg-muted/50 select-none"
                                    onClick={() => handleSort('gaa')}
                                  >
                                    <div className="flex items-center justify-end">
                                      GAA
                                      {getSortIcon('gaa')}
                                    </div>
                                  </TableHead>
                                  <TableHead 
                                    className="text-right cursor-pointer hover:bg-muted/50 select-none"
                                    onClick={() => handleSort('savePct')}
                                  >
                                    <div className="flex items-center justify-end">
                                      SV%
                                      {getSortIcon('savePct')}
                                    </div>
                                  </TableHead>
                                </>
                              )}
                              <TableHead className="w-[120px]"></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {filteredPlayers.map((player) => {
                              const isGoalie = player.position === 'G';
                              return (
                                <TableRow key={player.id} className="hover:bg-muted/50">
                                  <TableCell className="font-medium">
                                    <div className="flex flex-col">
                                      <span 
                                        className="hover:underline hover:text-primary cursor-pointer"
                                        onClick={() => handlePlayerClick(player)}
                                      >
                                        {player.full_name}
                                      </span>
                                      <span className="text-xs text-muted-foreground">{player.status || 'Active'}</span>
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-right">{formatPositionForDisplay(player.position)}</TableCell>
                                  <TableCell className="text-right">{player.team}</TableCell>
                                  <TableCell className="text-right">{player.games_played || 0}</TableCell>
                                  {/* Skater Stats - only render for skaters */}
                                  {!isGoalie && (
                                    <>
                                      <TableCell className="text-right">{player.goals || 0}</TableCell>
                                      <TableCell className="text-right">{player.assists || 0}</TableCell>
                                      <TableCell className="text-right font-bold">{player.points || 0}</TableCell>
                                      <TableCell className="text-right">{player.shots || 0}</TableCell>
                                      <TableCell className="text-right">{player.hits || 0}</TableCell>
                                      <TableCell className="text-right">{player.blocks || 0}</TableCell>
                                      <TableCell className="text-right">{typeof player.xGoals === 'number' ? player.xGoals.toFixed(1) : '-'}</TableCell>
                                      {/* Corsi/Fenwick intentionally removed */}
                                    </>
                                  )}
                                  {/* Goalie Stats - only render for goalies */}
                                  {isGoalie && (
                                    <>
                                      <TableCell className="text-right">{player.wins || 0}</TableCell>
                                      <TableCell className="text-right">{typeof player.goals_against_average === 'number' ? player.goals_against_average.toFixed(2) : '-'}</TableCell>
                                      <TableCell className="text-right">{typeof player.save_percentage === 'number' ? (player.save_percentage * 100).toFixed(1) : '-'}%</TableCell>
                                    </>
                                  )}
                                  <TableCell>
                                    <div className="flex gap-1 justify-end">
                                      <Button 
                                        size="icon" 
                                        variant="ghost" 
                                        className={`h-8 w-8 ${watchlist.has(player.id) ? 'text-yellow-500' : 'text-muted-foreground'}`}
                                        onClick={() => toggleWatchlist(player)}
                                      >
                                        <Star className={`h-4 w-4 ${watchlist.has(player.id) ? 'fill-current' : ''}`} />
                                      </Button>
                                      <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground" onClick={() => handlePlayerClick(player)}>
                                        <Info className="h-4 w-4" />
                                      </Button>
                                      <Button size="default" variant="default" className="h-10 w-10 text-primary font-bold text-xl bg-primary/10 hover:bg-primary/20 border border-primary/30" onClick={() => handleAddPlayer(player)}>
                                        +
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
                  </div>
                )}
              </>
            );
            })()}
          </TabsContent>
          <TabsContent value="schedule" className="space-y-4">
             <div className="bg-blue-500/10 border border-blue-500/20 p-4 rounded-lg mb-4 flex items-start gap-3">
                <Calendar className="h-5 w-5 text-blue-500 mt-1 shrink-0" />
                <div>
                  <h3 className="font-semibold text-blue-700 dark:text-blue-400">Schedule Maximizers</h3>
                  <p className="text-sm text-muted-foreground">Players with the most games this week, sorted by games played and points.</p>
                </div>
             </div>

             {loading || loadingMaximizers ? (
               <div className="p-12 text-center">
                 <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                 <p className="text-muted-foreground mt-4">
                   {loading ? 'Loading players...' : 'Calculating schedule maximizers...'}
                 </p>
               </div>
             ) : scheduleMaximizers.length === 0 ? (
               <div className="text-center py-12 text-muted-foreground">
                 <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
                 <p>No schedule data available.</p>
               </div>
             ) : (
               <div className="border rounded-lg overflow-hidden">
                 <div className="overflow-x-auto">
                   <Table>
                     <TableHeader>
                       <TableRow>
                         <TableHead 
                           className="cursor-pointer hover:bg-muted/50 select-none"
                           onClick={() => handleSort('name')}
                         >
                           <div className="flex items-center justify-start">
                             Player
                             {getSortIcon('name')}
                           </div>
                         </TableHead>
                         <TableHead 
                           className="text-right cursor-pointer hover:bg-muted/50 select-none"
                           onClick={() => handleSort('position')}
                         >
                           <div className="flex items-center justify-end">
                             Pos
                             {getSortIcon('position')}
                           </div>
                         </TableHead>
                         <TableHead 
                           className="text-right cursor-pointer hover:bg-muted/50 select-none"
                           onClick={() => handleSort('team')}
                         >
                           <div className="flex items-center justify-end">
                             Team
                             {getSortIcon('team')}
                           </div>
                         </TableHead>
                        <TableHead className="text-right">Games This Week</TableHead>
                         <TableHead 
                           className="text-right cursor-pointer hover:bg-muted/50 select-none"
                           onClick={() => handleSort('gp')}
                         >
                           <div className="flex items-center justify-end">
                             GP
                             {getSortIcon('gp')}
                           </div>
                         </TableHead>
                         {/* Skater Stats - only show if there are skaters */}
                         {scheduleMaximizers.some(p => p.position !== 'G') && (
                           <>
                             <TableHead 
                               className="text-right cursor-pointer hover:bg-muted/50 select-none"
                               onClick={() => handleSort('goals')}
                             >
                               <div className="flex items-center justify-end">
                                 G
                                 {getSortIcon('goals')}
                               </div>
                             </TableHead>
                             <TableHead 
                               className="text-right cursor-pointer hover:bg-muted/50 select-none"
                               onClick={() => handleSort('assists')}
                             >
                               <div className="flex items-center justify-end">
                                 A
                                 {getSortIcon('assists')}
                               </div>
                             </TableHead>
                             <TableHead 
                               className="text-right cursor-pointer hover:bg-muted/50 select-none"
                               onClick={() => handleSort('points')}
                             >
                               <div className="flex items-center justify-end">
                                 P
                                 {getSortIcon('points')}
                               </div>
                             </TableHead>
                             <TableHead 
                               className="text-right cursor-pointer hover:bg-muted/50 select-none"
                               onClick={() => handleSort('shots')}
                             >
                               <div className="flex items-center justify-end">
                                 SOG
                                 {getSortIcon('shots')}
                               </div>
                             </TableHead>
                             <TableHead 
                               className="text-right cursor-pointer hover:bg-muted/50 select-none"
                               onClick={() => handleSort('hits')}
                             >
                               <div className="flex items-center justify-end">
                                 HIT
                                 {getSortIcon('hits')}
                               </div>
                             </TableHead>
                             <TableHead 
                               className="text-right cursor-pointer hover:bg-muted/50 select-none"
                               onClick={() => handleSort('blocks')}
                             >
                               <div className="flex items-center justify-end">
                                 BLK
                                 {getSortIcon('blocks')}
                               </div>
                             </TableHead>
                             <TableHead className="text-right">Pts/Gm</TableHead>
                           </>
                         )}
                         {/* Goalie Stats - only show if there are goalies */}
                         {scheduleMaximizers.some(p => p.position === 'G') && (
                           <>
                             <TableHead 
                               className="text-right cursor-pointer hover:bg-muted/50 select-none"
                               onClick={() => handleSort('wins')}
                             >
                               <div className="flex items-center justify-end">
                                 W
                                 {getSortIcon('wins')}
                               </div>
                             </TableHead>
                             <TableHead 
                               className="text-right cursor-pointer hover:bg-muted/50 select-none"
                               onClick={() => handleSort('gaa')}
                             >
                               <div className="flex items-center justify-end">
                                 GAA
                                 {getSortIcon('gaa')}
                               </div>
                             </TableHead>
                             <TableHead 
                               className="text-right cursor-pointer hover:bg-muted/50 select-none"
                               onClick={() => handleSort('savePct')}
                             >
                               <div className="flex items-center justify-end">
                                 SV%
                                 {getSortIcon('savePct')}
                               </div>
                             </TableHead>
                             <TableHead className="text-right">Pts/Gm</TableHead>
                           </>
                         )}
                         <TableHead className="w-[120px]"></TableHead>
                       </TableRow>
                     </TableHeader>
                     <TableBody>
                       {sortScheduleMaximizers(scheduleMaximizers).map((player) => {
                         const isGoalie = player.position === 'G';
                         return (
                           <TableRow key={player.id} className="hover:bg-muted/50">
                             <TableCell className="font-medium">
                               <div className="flex flex-col">
                                 <span 
                                   className="hover:underline hover:text-primary cursor-pointer"
                                   onClick={() => handlePlayerClick(player)}
                                 >
                                   {player.full_name}
                                 </span>
                               </div>
                             </TableCell>
                             <TableCell className="text-right">{formatPositionForDisplay(player.position)}</TableCell>
                             <TableCell className="text-right">{player.team}</TableCell>
                            <TableCell className="text-right align-middle py-2">
                              {player.games && player.games.length > 0 && player.team ? (
                                <div className="flex justify-end items-center">
                                  <div className="inline-flex gap-1.5 items-center flex-nowrap overflow-x-auto">
                                    {(() => {
                                      // Use MST timezone - EXACT SAME as GameLogosBar and Matchup tab
                                      const todayMST = getTodayMST();
                                      
                                      return player.games
                                        .filter(game => game && game.game_date)
                                        .sort((a, b) => new Date(a.game_date).getTime() - new Date(b.game_date).getTime())
                                        .map((game, idx) => {
                                          const gameDateStr = game.game_date.split('T')[0];
                                          
                                          // EXACT SAME LOGIC AS GameLogosBar
                                          const isToday = gameDateStr === todayMST;
                                          const gameStatusLower = (game.status || '').toLowerCase();
                                          const isLive = (gameStatusLower === 'live' || gameStatusLower === 'intermission' || gameStatusLower === 'crit') && isToday;
                                          
                                          // Check if game is in the past (SAME as GameLogosBar)
                                          const isPastDate = gameDateStr < todayMST;
                                          const effectiveStatus = (isPastDate && game.status === 'scheduled') ? 'final' : game.status;
                                          const isPast = !isLive && (effectiveStatus === 'final' || isPastDate);
                                          const isUpcoming = !isPast && !isLive;
                                          
                                          const playerTeamUpper = (player.team || '').toUpperCase();
                                          const homeTeamUpper = (game.home_team || '').toUpperCase();
                                          const isHome = homeTeamUpper === playerTeamUpper;
                                          const opponent = isHome ? (game.away_team || '') : (game.home_team || '');
                                          if (!opponent) return null;
                                          
                                          const logoUrl = `https://assets.nhle.com/logos/nhl/svg/${opponent.toUpperCase()}_light.svg`;
                                          const opponentPrefix = isHome ? 'vs' : '@';
                                          
                                          // Build tooltip - SAME as GameLogosBar
                                          let tooltipText = `${opponentPrefix} ${opponent} - ${gameDateStr}`;
                                          if (isLive) tooltipText += ' (LIVE)';
                                          else if (isPast) tooltipText += ' (Final)';
                                          else if (isToday) tooltipText += ' (Today)';
                                          
                                          return (
                                            <div 
                                              key={idx}
                                              className={`relative flex-shrink-0 w-7 h-7 rounded flex items-center justify-center border ${
                                                isPast ? 'opacity-40 grayscale border-gray-300' : 
                                                isLive ? 'border-2 border-orange-500 animate-pulse shadow-[0_0_8px_rgba(249,115,22,0.6)]' : 
                                                isToday ? 'border-2 border-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' :
                                                'opacity-100 border-orange-300'
                                              }`}
                                              title={tooltipText}
                                            >
                                              <img 
                                                src={logoUrl} 
                                                alt={opponent}
                                                className="w-5 h-5 object-contain"
                                                onError={(e) => {
                                                  (e.target as HTMLImageElement).style.display = 'none';
                                                }}
                                              />
                                              {/* Live badge */}
                                              {isLive && (
                                                <div className="absolute -top-1 -right-1 w-3 h-3 bg-orange-500 rounded-full animate-ping" />
                                              )}
                                            </div>
                                          );
                                        });
                                    })()}
                                  </div>
                                </div>
                              ) : (
                                <div className="flex gap-1 justify-end flex-wrap">
                                  {player.gameDays.map(day => (
                                    <span key={day} className="px-1.5 py-0.5 bg-muted rounded text-xs font-medium whitespace-nowrap">
                                      {day}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </TableCell>
                             <TableCell className="text-right">{player.games_played || 0}</TableCell>
                             {/* Skater Stats - only render for skaters */}
                             {!isGoalie && (
                               <>
                                 <TableCell className="text-right">{player.goals || 0}</TableCell>
                                 <TableCell className="text-right">{player.assists || 0}</TableCell>
                                 <TableCell className="text-right font-bold">{player.points || 0}</TableCell>
                                 <TableCell className="text-right">{player.shots || 0}</TableCell>
                                 <TableCell className="text-right">{player.hits || 0}</TableCell>
                                 <TableCell className="text-right">{player.blocks || 0}</TableCell>
                                 <TableCell className="text-right font-medium">
                                   {((player.points || 0) / Math.max(1, player.games_played || 1)).toFixed(2)}
                                 </TableCell>
                               </>
                             )}
                             {/* Goalie Stats - only render for goalies */}
                             {isGoalie && (
                               <>
                                 <TableCell className="text-right">{player.wins || 0}</TableCell>
                                 <TableCell className="text-right">{typeof player.goals_against_average === 'number' ? player.goals_against_average.toFixed(2) : '-'}</TableCell>
                                 <TableCell className="text-right">{typeof player.save_percentage === 'number' ? (player.save_percentage * 100).toFixed(1) : '-'}%</TableCell>
                                 <TableCell className="text-right font-medium">
                                   {((player.points || 0) / Math.max(1, player.games_played || 1)).toFixed(2)}
                                 </TableCell>
                               </>
                             )}
                             <TableCell>
                               <div className="flex gap-1 justify-end">
                                 <Button 
                                   size="icon" 
                                   variant="ghost" 
                                   className={`h-8 w-8 ${watchlist.has(player.id) ? 'text-yellow-500' : 'text-muted-foreground'}`}
                                   onClick={() => toggleWatchlist(player)}
                                 >
                                   <Star className={`h-4 w-4 ${watchlist.has(player.id) ? 'fill-current' : ''}`} />
                                 </Button>
                                 <Button size="default" variant="default" className="h-10 w-10 text-primary font-bold text-xl bg-primary/10 hover:bg-primary/20 border border-primary/30" onClick={() => handleAddPlayer(player)}>
                                   +
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
          
          <TabsContent value="watch">
            {players.filter(p => watchlist.has(p.id)).length === 0 ? (
               <div className="p-12 text-center border-2 border-dashed rounded-lg">
                 <Star className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                 <h3 className="text-lg font-medium">Your watch list is empty</h3>
                 <p className="text-muted-foreground mt-2">Star players to keep track of their performance.</p>
                 <Button variant="link" onClick={() => setActiveTab('available')} className="mt-4">
                   Browse Available Players
                 </Button>
               </div>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead 
                          className="cursor-pointer hover:bg-muted/50 select-none"
                          onClick={() => handleSort('name')}
                        >
                          <div className="flex items-center justify-start">
                            Player
                            {getSortIcon('name')}
                          </div>
                        </TableHead>
                        <TableHead 
                          className="text-right cursor-pointer hover:bg-muted/50 select-none"
                          onClick={() => handleSort('position')}
                        >
                          <div className="flex items-center justify-end">
                            Pos
                            {getSortIcon('position')}
                          </div>
                        </TableHead>
                        <TableHead 
                          className="text-right cursor-pointer hover:bg-muted/50 select-none"
                          onClick={() => handleSort('team')}
                        >
                          <div className="flex items-center justify-end">
                            Team
                            {getSortIcon('team')}
                          </div>
                        </TableHead>
                        <TableHead 
                          className="text-right cursor-pointer hover:bg-muted/50 select-none"
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
                              className="text-right cursor-pointer hover:bg-muted/50 select-none"
                              onClick={() => handleSort('goals')}
                            >
                              <div className="flex items-center justify-end">
                                G
                                {getSortIcon('goals')}
                              </div>
                            </TableHead>
                            <TableHead 
                              className="text-right cursor-pointer hover:bg-muted/50 select-none"
                              onClick={() => handleSort('assists')}
                            >
                              <div className="flex items-center justify-end">
                                A
                                {getSortIcon('assists')}
                              </div>
                            </TableHead>
                            <TableHead 
                              className="text-right cursor-pointer hover:bg-muted/50 select-none"
                              onClick={() => handleSort('points')}
                            >
                              <div className="flex items-center justify-end">
                                P
                                {getSortIcon('points')}
                              </div>
                            </TableHead>
                            <TableHead 
                              className="text-right cursor-pointer hover:bg-muted/50 select-none"
                              onClick={() => handleSort('shots')}
                            >
                              <div className="flex items-center justify-end">
                                SOG
                                {getSortIcon('shots')}
                              </div>
                            </TableHead>
                            <TableHead 
                              className="text-right cursor-pointer hover:bg-muted/50 select-none"
                              onClick={() => handleSort('hits')}
                            >
                              <div className="flex items-center justify-end">
                                HIT
                                {getSortIcon('hits')}
                              </div>
                            </TableHead>
                            <TableHead 
                              className="text-right cursor-pointer hover:bg-muted/50 select-none"
                              onClick={() => handleSort('blocks')}
                            >
                              <div className="flex items-center justify-end">
                                BLK
                                {getSortIcon('blocks')}
                              </div>
                            </TableHead>
                            <TableHead 
                              className="text-right cursor-pointer hover:bg-muted/50 select-none"
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
                              className="text-right cursor-pointer hover:bg-muted/50 select-none"
                              onClick={() => handleSort('wins')}
                            >
                              <div className="flex items-center justify-end">
                                W
                                {getSortIcon('wins')}
                              </div>
                            </TableHead>
                            <TableHead 
                              className="text-right cursor-pointer hover:bg-muted/50 select-none"
                              onClick={() => handleSort('gaa')}
                            >
                              <div className="flex items-center justify-end">
                                GAA
                                {getSortIcon('gaa')}
                              </div>
                            </TableHead>
                            <TableHead 
                              className="text-right cursor-pointer hover:bg-muted/50 select-none"
                              onClick={() => handleSort('savePct')}
                            >
                              <div className="flex items-center justify-end">
                                SV%
                                {getSortIcon('savePct')}
                              </div>
                            </TableHead>
                          </>
                        )}
                        <TableHead className="w-[120px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortPlayers(players.filter(p => watchlist.has(p.id))).map((player) => {
                        const isGoalie = player.position === 'G';
                        return (
                          <TableRow key={player.id} className="hover:bg-muted/50">
                            <TableCell className="font-medium">
                              <div className="flex flex-col">
                                <span 
                                  className="hover:underline hover:text-primary cursor-pointer"
                                  onClick={() => handlePlayerClick(player)}
                                >
                                  {player.full_name}
                                </span>
                                <Badge variant="outline" className="border-yellow-500/30 text-yellow-600 bg-yellow-500/5 w-fit mt-1">
                                  Watched
                                </Badge>
                              </div>
                            </TableCell>
                            <TableCell className="text-right">{formatPositionForDisplay(player.position)}</TableCell>
                            <TableCell className="text-right">{player.team}</TableCell>
                            <TableCell className="text-right">{player.games_played || 0}</TableCell>
                            {/* Skater Stats - only render for skaters */}
                            {!isGoalie && (
                              <>
                                <TableCell className="text-right">{player.goals || 0}</TableCell>
                                <TableCell className="text-right">{player.assists || 0}</TableCell>
                                <TableCell className="text-right font-bold">{player.points || 0}</TableCell>
                                <TableCell className="text-right">{player.shots || 0}</TableCell>
                                <TableCell className="text-right">{player.hits || 0}</TableCell>
                                <TableCell className="text-right">{player.blocks || 0}</TableCell>
                                <TableCell className="text-right">{typeof player.xGoals === 'number' ? player.xGoals.toFixed(1) : '-'}</TableCell>
                                {/* Corsi/Fenwick intentionally removed */}
                              </>
                            )}
                            {/* Goalie Stats - only render for goalies */}
                            {isGoalie && (
                              <>
                                <TableCell className="text-right">{player.wins || 0}</TableCell>
                                <TableCell className="text-right">{typeof player.goals_against_average === 'number' ? player.goals_against_average.toFixed(2) : '-'}</TableCell>
                                <TableCell className="text-right">{typeof player.save_percentage === 'number' ? (player.save_percentage * 100).toFixed(1) : '-'}%</TableCell>
                              </>
                            )}
                            <TableCell>
                              <div className="flex gap-1 justify-end">
                                <Button 
                                  size="icon" 
                                  variant="ghost" 
                                  className="h-8 w-8 text-yellow-500"
                                  onClick={() => toggleWatchlist(player)}
                                >
                                  <Star className="h-4 w-4 fill-current" />
                                </Button>
                                <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground" onClick={() => handlePlayerClick(player)}>
                                  <Info className="h-4 w-4" />
                                </Button>
                                <Button size="default" variant="default" className="h-10 w-10 text-primary font-bold text-xl bg-primary/10 hover:bg-primary/20 border border-primary/30" onClick={() => handleAddPlayer(player)}>
                                  +
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
            </div>

            {/* Left Sidebar - At bottom on mobile, left on desktop */}
            <aside className="w-full lg:w-auto order-2 lg:order-1">
              <div className="lg:sticky lg:top-32 space-y-4 lg:space-y-6">
                <AdSpace size="300x250" label="Free Agents Sponsor" />
                <AdSpace size="300x250" label="Fantasy Partner" />
              </div>
            </aside>

            {/* Right Sidebar - Notifications (hidden on mobile) */}
            {userLeagueState === 'active-user' && activeLeagueId && (
              <aside className="hidden lg:block order-3">
                <div className="lg:sticky lg:top-32 h-[calc(100vh-12rem)] bg-card border rounded-lg shadow-sm overflow-hidden">
                  <LeagueNotifications leagueId={activeLeagueId} />
                </div>
              </aside>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default FreeAgents;
