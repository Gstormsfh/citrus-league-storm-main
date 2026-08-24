import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PlayerService, Player } from '@/services/PlayerService';
import { WaiverService, WaiverPriority } from '@/services/WaiverService';
import { Loader2, Calendar, RefreshCw, TrendingUp, AlertCircle, Clock, Shield, Zap, ArrowRight, Users, Trophy } from 'lucide-react';
import { usePlayerNews, PlayerNewsItem } from '@/hooks/usePlayerNews';
import { calculateWeekDates, fetchGamesForTeams, calculatePlayerSchedule, getGamesPerDay, getRosterGamesPerDay, calculateScheduleMaximizers, PlayerWithSchedule } from '@/utils/scheduleMaximizer';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import PlayerStatsModal from '@/components/PlayerStatsModal';
import { HockeyPlayer } from '@/components/roster/HockeyPlayerCard';
import { getPlayerWithSeasonStats } from '@/utils/playerStatsHelper';
import { getWeeklyProjections, getLeagueAverageProjections } from '@/utils/projectionHelper';
import { leagueApi } from '@/api/leagues';
import { rosterApi } from '@/api/rosters';
import { waiverApi } from '@/api/waivers';
import { logger } from '@/utils/logger';

interface PositionDepth {
  position: string;
  count: number;
  projectedPoints: number;
  strength: 'Elite' | 'Good' | 'Average' | 'Weak';
  color: string;
  grade: string;
}

// Normalize position (L -> LW, R -> RW)
const normalizePosition = (pos: string): string => {
  if (!pos) return '';
  const upper = pos.toUpperCase();
  if (upper === 'L' || upper === 'LEFT' || upper === 'LEFTWING') return 'LW';
  if (upper === 'R' || upper === 'RIGHT' || upper === 'RIGHTWING') return 'RW';
  if (upper.includes('C') && !upper.includes('LW') && !upper.includes('RW')) return 'C';
  if (upper.includes('D')) return 'D';
  if (upper.includes('G')) return 'G';
  return '';
};

// Calculate strength and grade based on projected points (relative to league average)
const calculateStrength = (position: string, projectedPoints: number, leagueAverage: number): { strength: 'Elite' | 'Good' | 'Average' | 'Weak'; grade: string } => {
  const ratio = projectedPoints / Math.max(leagueAverage, 1);
  
  if (ratio >= 1.25) return { strength: 'Elite', grade: 'A+' };
  if (ratio >= 1.0) return { strength: 'Good', grade: 'A' };
  if (ratio >= 0.75) return { strength: 'Average', grade: 'B' };
  return { strength: 'Weak', grade: 'C' };
};

// Get position color
const getPositionColor = (position: string, strength: string): string => {
  const baseColors: Record<string, string> = {
    'C': '#F9E076',   // Bright Lemon Peel
    'LW': '#459345',  // Deep Lime Green
    'RW': '#F9A436',  // Zesty Tangerine
    'D': '#A8D85C',   // Yellow-Green
    'G': '#FF6F80'    // Contrast Grapefruit Pink
  };
  
  const color = baseColors[position] || '#94A3B8';
  
  // Adjust opacity based on strength
  if (strength === 'Weak') return '#FF6F80'; // Red for weak
  if (strength === 'Elite') return color; // Full color for elite
  if (strength === 'Good') return color; // Full color for good
  return color; // Average uses base color
};

// Get status badge color
const getStatusColor = (status: string): string => {
  const upper = status.toUpperCase();
  if (upper === 'ACT' || upper === 'HEALTHY') return '#459345'; // Green
  if (upper.includes('GTD') || upper.includes('QUESTIONABLE')) return '#F9E076'; // Yellow
  return '#FF6F80'; // Red for IR/LTIR/Out
};

// Get status label
const getStatusLabel = (status: string): string => {
  const upper = status.toUpperCase();
  if (upper === 'ACT') return 'Healthy';
  if (upper === 'IR') return 'IR';
  if (upper === 'LTIR') return 'LTIR';
  if (upper.includes('GTD')) return 'GTD';
  return status;
};

export const TeamIntelHub = () => {
  const { user } = useAuth();
  const { activeLeagueId, userLeagueState, activeLeague } = useLeague();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [loading, setLoading] = useState(true);
  const [depths, setDepths] = useState<PositionDepth[]>([]);
  const [rosterPlayers, setRosterPlayers] = useState<Player[]>([]);
  const [rosterPlayerIds, setRosterPlayerIds] = useState<string[]>([]);
  const [myTeamId, setMyTeamId] = useState<string | null>(null);
  
  // Schedule heat map data
  const [gamesPerDay, setGamesPerDay] = useState<Map<string, number>>(new Map());
  const [rosterGamesPerDay, setRosterGamesPerDay] = useState<Map<string, number>>(new Map());
  const [weekStart, setWeekStart] = useState<Date | null>(null);
  const [weekEnd, setWeekEnd] = useState<Date | null>(null);
  
  // Waiver priority
  const [waiverPriority, setWaiverPriority] = useState<WaiverPriority[]>([]);
  const [myPriority, setMyPriority] = useState<number | null>(null);
  const [lastClaimDate, setLastClaimDate] = useState<string | null>(null);
  
  // Streamer suggestions
  const [streamerSuggestions, setStreamerSuggestions] = useState<PlayerWithSchedule[]>([]);
  const [loadingStreamers, setLoadingStreamers] = useState(false);
  const [showStreamers, setShowStreamers] = useState(false);
  
  // Player modal
  const [selectedPlayer, setSelectedPlayer] = useState<HockeyPlayer | null>(null);
  const [isPlayerModalOpen, setIsPlayerModalOpen] = useState(false);
  
  // Player news (real-time)
  const { newsItems, loading: newsLoading, lastRefresh, refreshNews } = usePlayerNews(
    rosterPlayerIds,
    userLeagueState === 'active-user' && rosterPlayerIds.length > 0
  );

  // Next Man Up suggestions (waiver wire replacements for injured players)
  const [nextManUpMap, setNextManUpMap] = useState<Map<number, PlayerWithSchedule | null>>(new Map());
  
  // Actionable insights state
  const [actionableInsights, setActionableInsights] = useState<Array<{
    type: 'empty_roster_day' | 'position_need' | 'streaming_opportunity' | 'waiver_context';
    message: string;
    action?: string;
    actionUrl?: string;
  }>>([]);
  
  // League averages for comparison
  const [leagueAverages, setLeagueAverages] = useState<Map<string, number>>(new Map());

  // Track if we've already loaded data for this league to prevent duplicate calls
  const loadedLeagueRef = useRef<string | null>(null);

  // Derive draft status as a stable primitive to avoid re-renders from activeLeague object changes
  const draftCompleted = activeLeague?.draft_status === 'completed';

  // Load roster data
  useEffect(() => {
    if (!user || !activeLeagueId || userLeagueState !== 'active-user') {
      setLoading(false);
      return;
    }

    // Skip if we already loaded for this league+user combo
    const loadKey = `${activeLeagueId}:${user.id}:${draftCompleted}`;
    if (loadedLeagueRef.current === loadKey) {
      return;
    }
    loadedLeagueRef.current = loadKey;

    const loadRosterData = async () => {
      try {
        setLoading(true);

        // Get user's team via API client
        const { data: userTeam } = await leagueApi.getMyTeam(activeLeagueId) as { data?: { id: string } };

        if (!userTeam) {
          setLoading(false);
          return;
        }

        setMyTeamId(userTeam.id);

        // Check if draft is completed
        if (!draftCompleted) {
          setLoading(false);
          return;
        }

        // Get all players
        const allPlayers = await PlayerService.getAllPlayers();

        // Use roster API to get player IDs (source of truth)
        const { data: rosterPlayerIdList } = await rosterApi.getPlayerIds(activeLeagueId, userTeam.id) as { data?: (string | number)[] };

        let players: Player[] = [];

        if (rosterPlayerIdList && rosterPlayerIdList.length > 0) {
          const playerIds = rosterPlayerIdList.map((id: string | number) => String(id));
          players = allPlayers.filter(p => playerIds.includes(String(p.id)));
        }

        if (players.length === 0) {
          setLoading(false);
          return;
        }

        setRosterPlayers(players);
        setRosterPlayerIds(players.map(p => p.id));

        // Calculate week dates
        const { weekStart: start, weekEnd: end } = await calculateWeekDates(activeLeagueId, user.id);
        setWeekStart(start);
        setWeekEnd(end);

        // Get games per day (total NHL games)
        const totalGames = await getGamesPerDay(start, end);
        setGamesPerDay(totalGames);

        // Get roster games per day
        const rosterGames = await getRosterGamesPerDay(players, start, end);
        setRosterGamesPerDay(rosterGames);

        // Get real weekly projections for roster players
        const playerIds = players.map(p => Number(p.id));
        const weeklyProjections = await getWeeklyProjections(playerIds, start, end);
        
        // Get league average projections for comparison
        const leagueAvgs = await getLeagueAverageProjections(activeLeagueId, start, end);
        setLeagueAverages(leagueAvgs);

        // Calculate projected points for gap analysis using REAL projections
        const positionDepths: PositionDepth[] = ['C', 'LW', 'RW', 'D', 'G'].map(pos => {
          const posPlayers = players.filter(p => normalizePosition(p.position) === pos);
          const count = posPlayers.length;
          
          // Calculate projected points for this position using real projections
          let projectedPoints = 0;
          posPlayers.forEach(player => {
            const playerId = Number(player.id);
            const weeklyPoints = weeklyProjections.get(playerId) || 0;
            projectedPoints += weeklyPoints;
          });

          // Get league average for this position
          const leagueAvgProjected = leagueAvgs.get(pos) || 0;

          const { strength, grade } = calculateStrength(pos, projectedPoints, leagueAvgProjected);
          const color = getPositionColor(pos, strength);

          return {
            position: pos,
            count,
            projectedPoints: Math.round(projectedPoints * 10) / 10,
            strength,
            color,
            grade
          };
        });

        setDepths(positionDepths);

        // Load waiver data (non-fatal — don't let waiver errors block the page)
        try {
          const priority = await WaiverService.getWaiverPriority(activeLeagueId);
          setWaiverPriority(priority);
          const myPrio = priority.find(p => p.team_id === userTeam.id);

          // Validate priority (fix bug where priority > team count)
          if (myPrio && myPrio.priority > 0 && myPrio.priority <= priority.length) {
            setMyPriority(myPrio.priority);
          } else {
            if (myPrio) {
              logger.warn('Invalid waiver priority:', myPrio.priority, 'of', priority.length);
            }
            setMyPriority(null);
          }

          // Get last successful claim date via API
          const { data: teamWaivers } = await waiverApi.getTeamWaivers(activeLeagueId, userTeam.id);
          if (teamWaivers && Array.isArray(teamWaivers)) {
            const lastSuccessful = teamWaivers
              .filter((w: { status: string }) => w.status === 'successful')
              .sort((a: { processed_at: string }, b: { processed_at: string }) =>
                (b.processed_at || '').localeCompare(a.processed_at || ''))[0];
            if (lastSuccessful?.processed_at) {
              setLastClaimDate(lastSuccessful.processed_at);
            }
          }
        } catch (waiverError) {
          logger.warn('Failed to load waiver data (non-fatal):', waiverError);
        }

        // Note: Next Man Up suggestions will be loaded when news items are available

      } catch (error) {
        logger.error('Error loading roster data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadRosterData();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- use draftCompleted primitive instead of activeLeague object to prevent re-triggers
  }, [user?.id, activeLeagueId, userLeagueState, draftCompleted]);

  // Format day label
  const formatDayLabel = (date: Date): string => {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return dayNames[date.getDay()];
  };

  // Get heat map color for game count
  const getHeatMapColor = (count: number): string => {
    if (count >= 4) return 'hsl(142, 52%, 45%)'; // Green - good day
    if (count >= 2) return 'hsl(45, 85%, 55%)'; // Amber - moderate day
    return 'hsl(0, 72%, 58%)'; // Red - off-night
  };

  // Generate 7-day calendar (must be before useEffect that uses it)
  const calendarDays = useMemo(() => {
    if (!weekStart || !weekEnd) return [];
    const days = [];
    const current = new Date(weekStart);
    for (let i = 0; i < 7; i++) {
      const dateStr = current.toISOString().split('T')[0];
      days.push({
        date: new Date(current),
        dateStr,
        dayLabel: formatDayLabel(current),
        totalGames: gamesPerDay.get(dateStr) || 0,
        rosterGames: rosterGamesPerDay.get(dateStr) || 0
      });
      current.setDate(current.getDate() + 1);
    }
    return days;
  }, [weekStart, weekEnd, gamesPerDay, rosterGamesPerDay]);

  // Generate actionable insights when data changes
  useEffect(() => {
    if (!weekStart || !weekEnd || calendarDays.length === 0) {
      setActionableInsights([]);
      return;
    }

    const insights: Array<{
      type: 'empty_roster_day' | 'position_need' | 'streaming_opportunity' | 'waiver_context';
      message: string;
      action?: string;
      actionUrl?: string;
    }> = [];

    // Check for empty roster days
    calendarDays.forEach(day => {
      if (day.rosterGames === 0 && day.totalGames > 0) {
        insights.push({
          type: 'empty_roster_day',
          message: `No players on ${day.dayLabel} — stream a pickup`,
          action: 'Find Streamer',
          actionUrl: '/waiver-wire'
        });
      }
    });

    // Check for weak positions
    depths.forEach(depth => {
      if (depth.strength === 'Weak') {
        insights.push({
          type: 'position_need',
          message: `${depth.position} is weak (${depth.grade}) — upgrade via trade or waivers`,
          action: `Find ${depth.position}`,
          actionUrl: `/free-agents?position=${depth.position}`
        });
      }
    });

    // Check for streaming opportunities (off-nights)
    calendarDays.forEach(day => {
      if (day.totalGames <= 3 && day.totalGames > 0) {
        insights.push({
          type: 'streaming_opportunity',
          message: `${day.dayLabel}: only ${day.totalGames} games — stream a hot pickup`,
          action: 'Find Streamer',
          actionUrl: '/free-agents'
        });
      }
    });

    // Add waiver context
    if (myPriority !== null && waiverPriority.length > 0) {
      const teamsAhead = myPriority - 1;
      const teamsBehind = waiverPriority.length - myPriority;
      
      if (teamsAhead > 0) {
        insights.push({
          type: 'waiver_context',
          message: `${teamsAhead} team${teamsAhead > 1 ? 's' : ''} ahead of you in waiver priority`,
          action: 'View Waivers',
          actionUrl: '/waiver-wire'
        });
      } else if (teamsBehind === 0) {
        insights.push({
          type: 'waiver_context',
          message: 'You\'re first in waiver priority',
          action: 'View Waivers',
          actionUrl: '/waiver-wire'
        });
      }
    }

    setActionableInsights(insights);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- insights are derived from these 4 values; setActionableInsights setter is stable
  }, [calendarDays, depths, myPriority, waiverPriority.length]);


  // Load streamer suggestions
  const loadStreamerSuggestions = async () => {
    if (!activeLeagueId || !myTeamId || !weekStart || !weekEnd) return;

    setLoadingStreamers(true);
    try {
      // Get available players (returns simplified format)
      const availablePlayers = await WaiverService.getAvailablePlayers(activeLeagueId);
      
      // Get full player data for all available players
      const playerIds = availablePlayers.map(p => p.player_id.toString());
      const fullPlayers = await PlayerService.getPlayersByIds(playerIds);
      const playerMap = new Map(fullPlayers.map(p => [Number(p.id), p]));

      // Map available players to full Player objects
      const players: Player[] = availablePlayers
        .map(ap => {
          const fullPlayer = playerMap.get(ap.player_id);
          if (!fullPlayer) return null;
          return fullPlayer;
        })
        .filter((p): p is Player => p !== null);

      // Calculate schedule maximizers
      const maximizers = await calculateScheduleMaximizers(
        players,
        activeLeagueId,
        user?.id,
        50 // Limit to top 50 for performance
      );

      // Get top 3 suggestions
      const suggestions = maximizers.slice(0, 3);
      setStreamerSuggestions(suggestions);
      setShowStreamers(true);
    } catch (error) {
      logger.error('Error loading streamer suggestions:', error);
    } finally {
      setLoadingStreamers(false);
    }
  };

  // Handle player click
  const handlePlayerClick = async (playerId: number) => {
    try {
      const playerWithStats = await getPlayerWithSeasonStats(playerId.toString());
      if (playerWithStats) {
        setSelectedPlayer(playerWithStats);
        setIsPlayerModalOpen(true);
      }
    } catch (error) {
      logger.error('Error loading player stats:', error);
    }
  };

  // Handle click-to-trade for weak positions.
  //
  // 2026-08-18 launch audit: this used to append `?position=${position}`.
  // TradeAnalyzer reads only `?partner=` — it has no position filter at
  // all — so the param was silently discarded on every click. Rather
  // than ship a URL that promises filtering the destination cannot do,
  // carry the league (which IS consumed, via LeagueContext) and drop the
  // dead param. Re-add it here the day TradeAnalyzer grows the filter.
  const handleClickToTrade = (_position: string) => {
    navigate(`/trade-analyzer?league=${activeLeagueId}`);
  };

  // Load Next Man Up suggestions when news items change
  useEffect(() => {
    if (!activeLeagueId || newsItems.length === 0 || !user) return;

    const loadNextManUp = async () => {
      try {
        // Find injured players from news items
        const injuredItems = newsItems.filter(item => 
          item.roster_status !== 'ACT' && item.is_ir_eligible
        );

        if (injuredItems.length === 0) {
          setNextManUpMap(new Map());
          return;
        }

        // Get available players
        const availablePlayers = await WaiverService.getAvailablePlayers(activeLeagueId);
        const playerIds = availablePlayers.map(p => p.player_id.toString());
        const fullPlayers = await PlayerService.getPlayersByIds(playerIds);
        const playerMap = new Map(fullPlayers.map(p => [Number(p.id), p]));

        const players: Player[] = availablePlayers
          .map(ap => {
            const fullPlayer = playerMap.get(ap.player_id);
            if (!fullPlayer) return null;
            return fullPlayer;
          })
          .filter((p): p is Player => p !== null);

        // Batch: fetch schedule data ONCE for all available players, then filter per position
        const { weekStart: nmuWeekStart, weekEnd: nmuWeekEnd } = await calculateWeekDates(activeLeagueId, user.id);
        const uniqueTeams = [...new Set(players.map(p => p.team))];
        const teamGamesMap = await fetchGamesForTeams(uniqueTeams, nmuWeekStart, nmuWeekEnd);

        // For each injured player, find best replacement by position using the shared schedule data
        const nextManUp = new Map<number, PlayerWithSchedule | null>();

        for (const item of injuredItems) {
          const position = item.position;
          const samePositionPlayers = players.filter(p => normalizePosition(p.position) === normalizePosition(position));

          if (samePositionPlayers.length > 0) {
            // Calculate schedule for each candidate using the pre-fetched team games
            const maximizers: PlayerWithSchedule[] = samePositionPlayers
              .map(player => ({
                ...player,
                ...calculatePlayerSchedule(player, teamGamesMap),
              }))
              .sort((a, b) => {
                if (b.gamesThisWeek !== a.gamesThisWeek) return b.gamesThisWeek - a.gamesThisWeek;
                return (b.points || 0) - (a.points || 0);
              })
              .slice(0, 10);

            if (maximizers.length > 0) {
              nextManUp.set(item.player_id, maximizers[0]);
            }
          }
        }

        setNextManUpMap(nextManUp);
      } catch (error) {
        logger.error('Error loading Next Man Up suggestions:', error);
      }
    };

    loadNextManUp();
  }, [newsItems, activeLeagueId, user]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Team Intel</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // Show placeholder for guests or users without leagues
  if (!user || userLeagueState !== 'active-user') {
    return (
      <Card className="h-full opacity-60">
        <CardHeader>
          <CardTitle className="text-lg">Team Intel</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-sm text-muted-foreground">
            Join a league to see team intelligence
          </div>
        </CardContent>
      </Card>
    );
  }

  if (depths.length === 0 || !weekStart || !weekEnd) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="text-lg">Team Intel</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-sm text-muted-foreground">
            No roster data available
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2 text-foreground">
            <Zap className="h-4 w-4 text-citrus-orange" aria-hidden="true" />
            Team Intel
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 pt-0">
          {/* Component 1: Weekly Schedule Heat Map */}
          {calendarDays && calendarDays.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-foreground">Games This Week</h3>
              </div>
              <div className="grid grid-cols-7 gap-1">
                {calendarDays.map((day, idx) => {
                const isOffNight = day.totalGames <= 3;
                const heatColor = getHeatMapColor(day.totalGames);
                const isToday = day.dateStr === new Date().toISOString().split('T')[0];

                return (
                  <div
                    key={idx}
                    className={`
                      text-center py-1.5 px-0.5 rounded-md border transition-all
                      ${isToday ? 'ring-2 ring-citrus-orange/50 shadow-sm' : ''}
                      ${isOffNight
                        ? 'bg-red-950/20 border-red-800/40'
                        : 'bg-muted/30 border-border hover:bg-muted/50'
                      }
                    `}
                  >
                    <div className="text-[9px] font-semibold text-muted-foreground uppercase leading-none mb-1">
                      {day.dayLabel.slice(0, 3)}
                    </div>
                    <div
                      className="text-lg font-bold leading-none"
                      style={{ color: heatColor }}
                    >
                      {day.totalGames}
                    </div>
                    <div className="text-[9px] text-muted-foreground mt-0.5 leading-none">
                      {day.rosterGames} yours
                    </div>
                    {isOffNight && (
                      <div className="text-[8px] font-bold text-red-500 uppercase mt-0.5 leading-none">
                        Off
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          )}

          {/* Actionable Insights */}
          {actionableInsights.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-citrus-orange" aria-hidden="true" />
                Actionable Insights
              </h3>
              <div className="space-y-1.5">
                {actionableInsights.slice(0, 4).map((insight, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-2 p-2 rounded-lg bg-citrus-sage/5 border border-citrus-sage/20"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] leading-snug text-foreground/80">{insight.message}</p>
                    </div>
                    {insight.action && insight.actionUrl && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[10px] shrink-0"
                        onClick={() => navigate(insight.actionUrl!)}
                      >
                        {insight.action}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Component 5: Waiver Priority Tracker — only show when there are
              at least 2 ranked teams. "#1 of 1" implied a guaranteed pickup,
              which is not how waivers actually work. */}
          {myPriority !== null && waiverPriority.length >= 2 && (
            <div className="space-y-2 p-3 bg-citrus-sage/10 rounded-lg border-2 border-citrus-sage/30">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-citrus-orange" aria-hidden="true" />
                  Waiver Priority
                </h3>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-citrus-orange">
                  #{myPriority}
                </div>
                <div className="text-xs text-muted-foreground">
                  of {waiverPriority.length} teams
                </div>
                {myPriority > 1 && (
                  <div className="text-xs text-muted-foreground mt-1">
                    {myPriority - 1} team{myPriority - 1 > 1 ? 's' : ''} ahead of you
                  </div>
                )}
                {myPriority === waiverPriority.length && (
                  <div className="text-xs text-muted-foreground mt-1">
                    You're last in priority
                  </div>
                )}
                {lastClaimDate && (
                  <div className="text-xs text-muted-foreground mt-1">
                    Last claim: {new Date(lastClaimDate).toLocaleDateString()}
                  </div>
                )}
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden mt-2">
                <div
                  className="h-full bg-gradient-to-r from-citrus-sage to-citrus-orange transition-all"
                  style={{ width: `${(myPriority / waiverPriority.length) * 100}%` }}
                />
              </div>
            </div>
          )}


          {/* Component 4: Streamer Suggestion Engine */}
          <div className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={loadStreamerSuggestions}
              disabled={loadingStreamers}
            >
              {loadingStreamers ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin mr-2" aria-hidden="true" />
                  Loading...
                </>
              ) : (
                <>
                  <Users className="h-3 w-3 mr-2" aria-hidden="true" />
                  Find Streamer
                </>
              )}
            </Button>
            {showStreamers && streamerSuggestions.length > 0 && (
              <div className="space-y-2 mt-2">
                {streamerSuggestions.map((player) => (
                  <div
                    key={player.id}
                    className="p-2 rounded-lg border-2 border-citrus-sage/30 bg-citrus-sage/5"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold truncate">
                          {player.full_name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {player.position} • {player.team} • {player.gamesThisWeek} games
                        </div>
                        <div className="text-xs font-semibold text-citrus-sage">
                          {player.projectedPoints ? `${player.projectedPoints.toFixed(1)} projected pts` : 'No projection'}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {player.gameDays.join(', ')}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-xs"
                        // 2026-08-18 launch audit: this passed
                        // `?player=<id>`, which WaiverWire never read —
                        // the Add button opened a bare waiver page with
                        // nothing preselected and the user had to find
                        // the player again by hand. WaiverWire now reads
                        // `?search=`, which its existing search box
                        // consumes directly.
                        onClick={() =>
                          navigate(
                            `/waiver-wire?league=${activeLeagueId}&search=${encodeURIComponent(player.full_name)}`,
                          )
                        }
                      >
                        Add
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Component 6: Quick Actions Bar */}
          <div className="flex flex-wrap gap-2 pt-2 border-t">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 text-xs"
              onClick={() => navigate('/waiver-wire')}
            >
              <Trophy className="h-3 w-3 mr-1" aria-hidden="true" />
              Waivers
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 text-xs"
              onClick={() => navigate('/trade-analyzer')}
            >
              <ArrowRight className="h-3 w-3 mr-1" aria-hidden="true" />
              Trades
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Player Stats Modal */}
      <PlayerStatsModal
        player={selectedPlayer}
        isOpen={isPlayerModalOpen}
        onClose={() => setIsPlayerModalOpen(false)}
        leagueId={activeLeagueId || null}
      />
    </div>
  );
};
