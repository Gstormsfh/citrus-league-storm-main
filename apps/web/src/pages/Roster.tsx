import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, closestCenter } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { useSearchParams, useLocation, Navigate } from 'react-router-dom';
import { HockeyFooter, StormyLoading } from '@/components/citrus2';
import { useAuth } from '@/contexts/AuthContext';
import { useProfile } from '@/hooks/useProfile';
import { useLeague, isDemoLeague } from '@/contexts/LeagueContext';
import { DEMO_LEAGUE_ID_FOR_GUESTS } from '@/services/DemoLeagueService';
import Navbar from '@/components/Navbar';
import { LeagueCreationCTA, InlineCTA } from '@/components/LeagueCreationCTA';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Wand2, Trophy, Activity, ArrowUpRight, Users, Calendar, Target, Shield, Skull, Zap, BarChart3, PieChart, Lock, Clock, AlertCircle } from 'lucide-react';
import { useMinimumLoadingTime } from '@/hooks/useMinimumLoadingTime';
import { TeamIntelHub } from '@/components/gm-office/TeamIntelHub';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, Cell } from 'recharts';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import PlayerStatsModal from '@/components/PlayerStatsModal';
import { StartersGrid, BenchGrid, IRSlot } from '@/components/roster';
import MobileRosterList from '@/components/roster/MobileRosterList';
import MobileMenuButton from '@/components/MobileMenuButton';
import { HockeyPlayer } from '@/components/roster/HockeyPlayerCard';
import { useToast } from '@/hooks/use-toast';
import HockeyPlayerCard from '@/components/roster/HockeyPlayerCard';
import { PlayerService, Player } from '@/services/PlayerService';
import { LeagueService, Transaction, LEAGUE_TEAMS_DATA } from '@/services/LeagueService';
import type { LeagueSettings } from '@/types/leagueTypes';
import { DraftService } from '@/services/DraftService';
import { CitrusPuckService } from '@/services/CitrusPuckService';
import { ScheduleService } from '@/services/ScheduleService';
import { MatchupService } from '@/services/MatchupService';
import { GameLockService } from '@/services/GameLockService';
import { WaiverService } from '@/services/WaiverService';
import { getPlayerWithSeasonStats } from '@/utils/playerStatsHelper';
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { leagueApi } from '@/api/leagues';
import { playerApi } from '@/api/players';
import { publicApi } from '@/api/public';
import { rosterApi } from '@/api/rosters';
import { matchupApi } from '@/api/matchups';
import LeagueNotifications from '@/components/matchup/LeagueNotifications';
import { MatchupScheduleSelector } from "@/components/matchup/MatchupScheduleSelector";
import { WeeklySchedule } from "@/components/matchup/WeeklySchedule";
import { getTodayMST, getTodayMSTDate, formatWaiverProcessTime, formatMoment, computeNextWaiverProcessMoment } from '@/utils/timezoneUtils';
import { getCurrentSeason } from '@/utils/seasonConstants';
import { getDraftCompletionDate, getFirstWeekStartDate, getCurrentWeekNumber, getAvailableWeeks, getWeekStartDate, getWeekEndDate, clampToSeasonStart } from '@/utils/weekCalculator';
import { Matchup as MatchupType } from '@/services/MatchupService';
import { logger } from '@/utils/logger';
import { clearRosterCaches, notifyRosterChanged } from '@/utils/rosterRefresh';
import { isPoolLeague, getPoolRoute } from '@/utils/leagueTypeHelpers';
import { resolveFantasyPosition, type PositionType, getRosterSlots, DEFAULT_ROSTER_SLOTS, DEFAULT_FDG_ROSTER_SLOTS, getSlotPositions } from '@/utils/rosterUtils';

/* 2026-08-19 visual audit — surface correction.
   These panels used bg-white/55..80 ("frosted glass") on the #0F1F15
   dark page. Composited, that lands around rgb(159,165,161) — a MID-GREY
   dead zone where nothing reads: cream text measured 2.37:1 and the dark
   labels 1.58:1 against it. There is no text colour that fixes a
   mid-grey surface; the surface itself is the bug. Swapped to the dark
   tile family the rest of the app uses (ui/card.tsx is
   bg-pastel-surface-tile + ring-white/10), so cream text lands at 13:1. */


// Helper function to transform position to fantasy slot
// When posType is 'forward', C/LW/RW → 'F'
const getFantasyPosition = (position: string, posType: PositionType = 'individual'): string => {
  const result = resolveFantasyPosition(position, posType);
  return result === 'OTHER' ? 'UTIL' : result;
};

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

// Helper function to get team abbreviation
const getTeamAbbreviation = (team: string): string => {
  const abbreviations: Record<string, string> = {
    'Anaheim Ducks': 'ANA', 'Boston Bruins': 'BOS', 'Buffalo Sabres': 'BUF',
    'Calgary Flames': 'CGY', 'Carolina Hurricanes': 'CAR', 'Chicago Blackhawks': 'CHI', 'Colorado Avalanche': 'COL',
    'Columbus Blue Jackets': 'CBJ', 'Dallas Stars': 'DAL', 'Detroit Red Wings': 'DET', 'Edmonton Oilers': 'EDM',
    'Florida Panthers': 'FLA', 'Los Angeles Kings': 'LAK', 'Minnesota Wild': 'MIN', 'Montreal Canadiens': 'MTL',
    'Nashville Predators': 'NSH', 'New Jersey Devils': 'NJD', 'New York Islanders': 'NYI', 'New York Rangers': 'NYR',
    'Ottawa Senators': 'OTT', 'Philadelphia Flyers': 'PHI', 'Pittsburgh Penguins': 'PIT', 'San Jose Sharks': 'SJS',
    'Seattle Kraken': 'SEA', 'St. Louis Blues': 'STL', 'Tampa Bay Lightning': 'TBL', 'Toronto Maple Leafs': 'TOR',
    'Utah Hockey Club': 'UTA', 'Vancouver Canucks': 'VAN', 'Vegas Golden Knights': 'VGK', 'Washington Capitals': 'WSH',
    'Winnipeg Jets': 'WPG'
  };
  // If team is already an abbreviation (3 letters), return it. Otherwise lookup or truncate.
  if (team.length === 3) return team;
  return abbreviations[team] || team.split(' ').slice(-1)[0].substring(0, 3).toUpperCase();
};

  // Team stats will be calculated from real data

  // Analytics Helpers
  const calculateTeamCategoryStats = (starters: HockeyPlayer[]) => {
    // Breakdown by fantasy position
    const stats = {
      C: { goals: 0, assists: 0, shots: 0, hits: 0, blocks: 0, ppp: 0, shp: 0 },
      LW: { goals: 0, assists: 0, shots: 0, hits: 0, blocks: 0, ppp: 0, shp: 0 },
      RW: { goals: 0, assists: 0, shots: 0, hits: 0, blocks: 0, ppp: 0, shp: 0 },
      D: { goals: 0, assists: 0, shots: 0, hits: 0, blocks: 0, ppp: 0, shp: 0 },
      G: { wins: 0, losses: 0, saves: 0, gaa: 0, sv: 0, count: 0 } // Different stats for goalies
    };
    
    starters.forEach(p => {
      const pos = getFantasyPosition(p.position);
      if (pos === 'UTIL') return; // Skip UTIL for position breakdown or attribute to primary pos?
      // Assuming primary pos is what we want. If player is in UTIL slot, they still have a primary pos.
      // But getFantasyPosition returns 'UTIL' if it doesn't match C/LW/RW/D/G? No, it handles strings.
      // Wait, getFantasyPosition logic:
      // if (position === 'Centre' || position === 'C') return 'C';
      // ...
      // return 'UTIL'; 
      // If a player is a Center but in UTIL slot, we might want to count them as Center stats?
      // The current logic uses `p.position` which is the string from DB.
      
      // Let's refine getting the "Real" position for stats aggregation
      let realPos = 'UTIL';
      const posUpper = p.position?.toUpperCase() || '';
      
      if (['C', 'CENTRE', 'CENTER'].includes(posUpper)) realPos = 'C';
      else if (['LW', 'LEFT WING', 'L', 'LEFTWING'].includes(posUpper)) realPos = 'LW';
      else if (['RW', 'RIGHT WING', 'R', 'RIGHTWING'].includes(posUpper)) realPos = 'RW';
      else if (['D', 'DEFENCE', 'DEFENSE'].includes(posUpper)) realPos = 'D';
      else if (['G', 'GOALIE'].includes(posUpper)) realPos = 'G';
      
      if (realPos === 'G') {
        stats.G.wins += p.stats?.wins || 0;
        stats.G.losses += p.stats?.losses || 0;
        stats.G.count++;
      } else if (stats[realPos as keyof typeof stats]) {
        const target = stats[realPos as keyof typeof stats] as { goals: number; assists: number; shots: number; hits: number; blocks: number; ppp: number; shp: number };
        if (p.stats) {
            target.goals += p.stats.goals || 0;
            target.assists += p.stats.assists || 0;
            target.shots += p.stats.shots || 0;
            target.hits += p.stats.hits || 0;
            target.blocks += p.stats.blockedShots || 0;
            target.ppp += p.stats.powerPlayPoints || 0;
            target.shp += p.stats.shortHandedPoints || 0;
        }
      }
    });

    return stats;
  };

// Helper to safely calculate chart value
const safeValue = (val: number) => {
    if (typeof val !== 'number' || isNaN(val) || !isFinite(val)) return 0;
    return Math.max(0, Math.min(100, val));
};

// ... inside Roster component ...

  const calculateRadarData = (stats: { goals: number; assists: number; shots: number; hits: number; blocks: number; ppp: number; shp?: number } | null, position: string) => {
    // Baselines customized by position group (Per Player Season Avg * Num Slots)
    // Approx baselines for a "Good" starter
    const singlePlayerBaseline = {
      C: { G: 25, A: 45, S: 200, H: 80, B: 40, PPP: 15 },
      LW: { G: 25, A: 35, S: 200, H: 100, B: 40, PPP: 12 },
      RW: { G: 25, A: 35, S: 200, H: 100, B: 40, PPP: 12 },
      D: { G: 10, A: 35, S: 150, H: 120, B: 130, PPP: 10 },
    };

    const base = singlePlayerBaseline[position as keyof typeof singlePlayerBaseline] || singlePlayerBaseline.C;
    
    // Safety check for stats object
    const s = stats || { goals: 0, assists: 0, shots: 0, hits: 0, blocks: 0, ppp: 0 };
    
    // Dynamic baseline based on roughly 2 players worth of stats for that position
    const factor = 2.5; 

    return [
      { subject: 'Goals', A: safeValue((s.goals / (base.G * factor)) * 100), fullMark: 100 },
      { subject: 'Assists', A: safeValue((s.assists / (base.A * factor)) * 100), fullMark: 100 },
      { subject: 'Shots', A: safeValue((s.shots / (base.S * factor)) * 100), fullMark: 100 },
      { subject: 'Hits', A: safeValue((s.hits / (base.H * factor)) * 100), fullMark: 100 },
      { subject: 'Blocks', A: safeValue((s.blocks / (base.B * factor)) * 100), fullMark: 100 },
      { subject: 'PPP', A: safeValue((s.ppp / (base.PPP * factor)) * 100), fullMark: 100 },
    ];
  };

  const getPositionStrength = (starters: HockeyPlayer[], pos: string) => {
    const players = starters.filter(p => getFantasyPosition(p.position) === pos);
    
    // Scale: 
    // Elite: > 1.2 PPG (approx 100 pt pace)
    // Strong: > 0.9 PPG (approx 74 pt pace)
    // Average: > 0.7 PPG (approx 57 pt pace)
    // Weak: < 0.7 PPG
    // Projected Points in data is roughly (season points / 20) -> which is basically PPG * 4
    // So if p.projectedPoints is 4.0 => 1.0 PPG approx.

    if (players.length === 0) return { score: 0, label: 'Empty', color: 'text-amber-500', bg: 'bg-amber-500/10' };
    
    const avgProj = players.reduce((sum, p) => sum + (p.projectedPoints || 0), 0) / players.length;
    
    // Adjusted thresholds for 5-6 point scale
    if (avgProj >= 5.0) return { score: avgProj, label: 'Elite', color: 'text-green-500', bg: 'bg-green-500/10' };
    if (avgProj >= 4.0) return { score: avgProj, label: 'Strong', color: 'text-blue-500', bg: 'bg-blue-500/10' };
    if (avgProj >= 3.0) return { score: avgProj, label: 'Average', color: 'text-yellow-500', bg: 'bg-yellow-500/10' };
    return { score: avgProj, label: 'Weak', color: 'text-orange-500', bg: 'bg-orange-500/10' };
  };

interface RosterState {
  starters: HockeyPlayer[];
  bench: HockeyPlayer[];
  ir: HockeyPlayer[];
  slotAssignments: Record<string, string>; // Changed key to string to support UUIDs
}

const Roster = () => {
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const { userLeagueState, loading: leagueLoading, activeLeagueId, activeLeague, activeLeagueFormat, demoLeagueId, isChangingLeague } = useLeague();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const [selectedPlayer, setSelectedPlayer] = useState<HockeyPlayer | null>(null);
  const [isPlayerDialogOpen, setIsPlayerDialogOpen] = useState(false);
  const [pendingAddPlayer, setPendingAddPlayer] = useState<{ id: string; name: string } | null>(null);
  const [isDropDialogOpen, setIsDropDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("roster");
  const [activeId, setActiveId] = useState<string | number | null>(null);
  const [tapSelectedPlayerId, setTapSelectedPlayerId] = useState<string | number | null>(null);
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth < 1024);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  const [loading, setLoading] = useState(true);
  
  // Tab reset mechanism - reset to default tab when league changes
  const previousLeagueIdRef = useRef(activeLeagueId);
  useEffect(() => {
    if (previousLeagueIdRef.current !== activeLeagueId && previousLeagueIdRef.current !== null) {
      setActiveTab("roster"); // Reset to default tab
    }
    previousLeagueIdRef.current = activeLeagueId;
  }, [activeLeagueId]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [statView, setStatView] = useState<'seasonToDate' | 'restOfSeason'>('seasonToDate');
  const [analyticsLoaded, setAnalyticsLoaded] = useState(false);
  const [userTeamId, setUserTeamId] = useState<string | number | null>(null);
  const [userTeam, setUserTeam] = useState<{ id: string; league_id: string; team_name: string } | null>(null);
  const [bestBallEnabled, setBestBallEnabled] = useState(false);
  const [leagueRosterSlots, setLeagueRosterSlots] = useState<Record<string, number> | null>(null);
  const [leaguePositionType, setLeaguePositionType] = useState<PositionType>('individual');

  // Position slot configuration — driven by league settings + position type, falls back to defaults
  const POSITION_SLOTS = useMemo(() => {
    const s = getRosterSlots(leagueRosterSlots, leaguePositionType);
    if (leaguePositionType === 'forward') {
      return {
        'F': { maxPlayers: s.F ?? 6, label: 'Forward' },
        'D': { maxPlayers: s.D ?? 4, label: 'Defense' },
        'G': { maxPlayers: s.G ?? 2, label: 'Goalie' },
        'UTIL': { maxPlayers: s.UTIL ?? 1, label: 'Utility' },
      };
    }
    return {
      'C': { maxPlayers: s.C ?? 2, label: 'Center' },
      'LW': { maxPlayers: s.LW ?? 2, label: 'Left Wing' },
      'RW': { maxPlayers: s.RW ?? 2, label: 'Right Wing' },
      'D': { maxPlayers: s.D ?? 4, label: 'Defense' },
      'G': { maxPlayers: s.G ?? 2, label: 'Goalie' },
      'UTIL': { maxPlayers: s.UTIL ?? 1, label: 'Utility' },
    };
  }, [leaguePositionType, leagueRosterSlots]);

  const [teamStats, setTeamStats] = useState({
    record: "0-0-0",
    rank: "-",
    totalPoints: 0,
    avgPoints: 0,
    highScore: 0,
    waiverMoves: 0,
  });

  // Helper function for rank suffix
  const getRankSuffix = (rank: number): string => {
    if (rank === 1) return 'st';
    if (rank === 2) return 'nd';
    if (rank === 3) return 'rd';
    return 'th';
  };

  const [selectedPosMetric, setSelectedPosMetric] = useState<'C' | 'LW' | 'RW' | 'D'>('C');
  
  // Locked players state
  const [lockedPlayerIds, setLockedPlayerIds] = useState<Set<string>>(new Set());
  
  // Week and date selection state
  const [selectedWeek, setSelectedWeek] = useState<number>(0); // 0 = not yet calculated
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [currentMatchup, setCurrentMatchup] = useState<MatchupType | null>(null);
  const [matchupWeekDates, setMatchupWeekDates] = useState<string[]>([]);
  const [availableWeeks, setAvailableWeeks] = useState<number[]>([]);
  const [firstWeekStart, setFirstWeekStart] = useState<Date | null>(null);
  
  // Daily projections state (similar to Matchup tab)
  const [projectionsByDate, setProjectionsByDate] = useState<Map<string, Map<number, any>>>(new Map());
  // Daily actual game stats (for live/final games)
  const [dailyStatsByDateMap, setDailyStatsByDateMap] = useState<Map<string, Map<number, any>>>(new Map());
  // Game status from schedule (scheduled/live/intermission/final)
  const [gameStatusMap, setGameStatusMap] = useState<Map<number, { status: string; score?: string }>>(new Map());
  
  // Initial empty roster state
  const [roster, setRoster] = useState<RosterState>({
    starters: [],
    bench: [],
    ir: [],
    slotAssignments: {}
  });

  // Component lifecycle logging
  useEffect(() => {
    return () => {
      // Cleanup on unmount
    };
  }, []);

  const rosterDisplayLoading = useMinimumLoadingTime(loading || leagueLoading, 800);

  // Calculate positional stats
  const posStats = useMemo(() => calculateTeamCategoryStats(roster.starters), [roster.starters]);

  // Calculate slots helper — respects F/D/G position type
  // Optional parameter: assignedSlots - Set of slot IDs already taken (to avoid conflicts)
  const calculateInitialSlotAssignments = (starters: HockeyPlayer[], assignedSlots?: Set<string>) => {
    const assignments: Record<string, string> = {};
    const posType = leaguePositionType;

    // Determine position keys and slot caps based on position type
    const posKeys = posType === 'forward' ? ['F', 'D', 'G'] : ['C', 'LW', 'RW', 'D', 'G'];
    const slotCaps: Record<string, number> = posType === 'forward'
      ? { F: 6, D: 4, G: 2 }
      : { C: 2, LW: 2, RW: 2, D: 4, G: 2 };

    const playersByPos: Record<string, HockeyPlayer[]> = {};
    for (const k of posKeys) playersByPos[k] = [];

    // Use eligible_positions to bucket players by their primary resolved position
    starters.forEach(p => {
      const positions = (p.eligible_positions && p.eligible_positions.length > 0)
        ? p.eligible_positions.map(ep => getFantasyPosition(ep, posType))
        : [getFantasyPosition(p.position, posType)];
      const primary = positions[0];
      if (primary !== 'UTIL' && playersByPos[primary]) {
        playersByPos[primary].push(p);
      }
    });

    const isSlotAvailable = (slotId: string) => !assignedSlots || !assignedSlots.has(slotId);
    const assignedIds = new Set<string>();

    // First pass: assign players to their primary position slots
    for (const pos of posKeys) {
      let slotIndex = 1;
      const cap = slotCaps[pos] || 0;
      for (const p of playersByPos[pos]) {
        if (slotIndex > cap || assignedIds.has(String(p.id))) continue;
        const slotId = `slot-${pos}-${slotIndex}`;
        if (isSlotAvailable(slotId)) {
          assignments[p.id] = slotId;
          assignedIds.add(String(p.id));
          slotIndex++;
        }
      }
    }

    // Second pass: try to fill remaining empty slots with multi-position players
    for (const pos of posKeys) {
      const cap = slotCaps[pos] || 0;
      const filledCount = Object.values(assignments).filter(s => s.startsWith(`slot-${pos}-`)).length;
      if (filledCount >= cap) continue;

      const candidates = starters.filter(p => {
        if (assignedIds.has(String(p.id))) return false;
        const positions = (p.eligible_positions && p.eligible_positions.length > 0)
          ? p.eligible_positions.map(ep => getFantasyPosition(ep, posType))
          : [getFantasyPosition(p.position, posType)];
        return positions.includes(pos);
      });

      let slotIdx = filledCount + 1;
      for (const p of candidates) {
        if (slotIdx > cap) break;
        const slotId = `slot-${pos}-${slotIdx}`;
        if (isSlotAvailable(slotId)) {
          assignments[p.id] = slotId;
          assignedIds.add(String(p.id));
          slotIdx++;
        }
      }
    }

    // Assign remaining non-goalie starters to UTIL
    const unassigned = starters.filter(p => !assignedIds.has(String(p.id)));
    const utilPlayer = unassigned.find(p => getFantasyPosition(p.position, posType) !== 'G');
    if (utilPlayer && isSlotAvailable('slot-UTIL')) {
        assignments[utilPlayer.id] = 'slot-UTIL';
    }

    return assignments;
  };

  // Fetch and adapt players from staging files (SINGLE SOURCE OF TRUTH)
  // Extract loadRoster so it can be called manually for refresh
  const loadRoster = useCallback(async (keepCurrentRoster = false) => {
    // For guests, load immediately. For logged-in users, wait for league context to finish loading
    if (user && leagueLoading) {
      return; // Don't load roster until we know the user's league state
    }
    
    // For guests, userLeagueState should be 'guest' immediately, so proceed

    // Only set loading if not keeping current roster (prevents flash during refresh)
    if (!keepCurrentRoster) {
      setLoading(true);
    }
    try {
      // Only reset roster state if not keeping current (prevents flash of "No roster")
      if (!keepCurrentRoster) {
        setRoster({ starters: [], bench: [], ir: [], slotAssignments: {} });
      }
        // Get all players from our pipeline tables (player_directory + player_season_stats)
        // PlayerService.getAllPlayers() is the ONLY source for player data
        const allPlayers = await PlayerService.getAllPlayers();
        
        let dbPlayers: Player[] = [];
        let teamId: string | number | null = null;
        let userTeamData: { id: string; league_id: string; team_name: string } | null = null;

        // ═══════════════════════════════════════════════════════════════════
        // DEMO STATE: Guest or Logged-in without league
        // Use the same approach as Matchup page - load from real demo league
        // ═══════════════════════════════════════════════════════════════════
        if (userLeagueState === 'guest' || userLeagueState === 'logged-in-no-league') {
          // Get the demo league via public API (no auth required)
          const leagueResponse = await publicApi.getLeague(DEMO_LEAGUE_ID_FOR_GUESTS);

          if (!leagueResponse.data) {
            logger.error('[Roster] Error loading demo league: no data returned');
            setRoster({ starters: [], bench: [], ir: [], slotAssignments: {} });
            setLoading(false);
            return;
          }
          const demoLeague = leagueResponse.data as any;
          
          // Get the first team from the demo league via public API (no auth required)
          const teamsResponse = await publicApi.getTeams(DEMO_LEAGUE_ID_FOR_GUESTS);
          const demoTeamsData = (teamsResponse.data || []) as any[];

          if (demoTeamsData.length === 0) {
            logger.error('[Roster] Error loading demo team: no teams returned');
            setRoster({ starters: [], bench: [], ir: [], slotAssignments: {} });
            setLoading(false);
            return;
          }
          
          const demoTeams = demoTeamsData as any[];
          const demoTeamData = demoTeams[0];
          teamId = demoTeamData.id;
          setUserTeamId(demoTeamData.id);
          setUserTeam({
            id: demoTeamData.id,
            league_id: demoTeamData.league_id,
            team_name: demoTeamData.team_name
          });
          
          // Get roster player IDs via public API (no auth required)
          const playerIdsResponse = await publicApi.getPlayerIds(DEMO_LEAGUE_ID_FOR_GUESTS, demoTeamData.id);
          const playerIds = (playerIdsResponse.data || []) as string[];

          if (!playerIds) {
            logger.error('[Roster] Error loading demo roster: no player IDs returned');
            setRoster({ starters: [], bench: [], ir: [], slotAssignments: {} });
            setLoading(false);
            return;
          }
          // CRITICAL FIX: playerIds are STRINGS from DB, but p.id is a NUMBER
          const playerIdsAsNumbers = playerIds.map((id: any) => typeof id === 'string' ? parseInt(id) : id);
          const teamPlayers = allPlayers.filter(p => playerIdsAsNumbers.includes(p.id));
          
          if (teamPlayers.length === 0) {
            logger.warn('[Roster] Demo team has no players in roster — expected for new/demo users');
            setRoster({ starters: [], bench: [], ir: [], slotAssignments: {} });
            setLoading(false);
            return;
          }
          
          // Transform to HockeyPlayer format (will be done later in the function)
          dbPlayers = teamPlayers;
        } else if (userLeagueState === 'active-user' && user) {
          // Logged-in users with leagues: Get their actual team via API
          // If activeLeagueId is set, prefer that league's team
          const targetLeagueId = activeLeagueId;
          if (!targetLeagueId) {
            // No active league - show empty roster
            setRoster({ starters: [], bench: [], ir: [], slotAssignments: {} });
            setUserTeamId(null);
            setUserTeam(null);
            setLoading(false);
            return;
          }

          try {
            const myTeamResponse = await leagueApi.getMyTeam(targetLeagueId);
            const teamDataResult = myTeamResponse.data as { id: string; league_id: string; team_name: string } | null;

            if (!teamDataResult) {
              // User doesn't have a team yet - show empty roster
              setRoster({ starters: [], bench: [], ir: [], slotAssignments: {} });
              setUserTeamId(null);
              setUserTeam(null);
              setLoading(false);
              return;
            }

            userTeamData = teamDataResult;
          } catch {
            // User doesn't have a team yet - show empty roster
            setRoster({ starters: [], bench: [], ir: [], slotAssignments: {} });
            setUserTeamId(null);
            setUserTeam(null);
            setLoading(false);
            return;
          }

          // Check if draft is completed before loading roster
          const { league: leagueData, error: leagueError } = await LeagueService.getLeague(userTeamData.league_id, user.id);
          if (leagueError || !leagueData || leagueData.draft_status !== 'completed') {
            // Draft not completed - show empty roster
            setRoster({ starters: [], bench: [], ir: [], slotAssignments: {} });
            setUserTeamId(userTeamData.id);
            setUserTeam(userTeamData);
            setLoading(false);
            return;
          }

          // Detect Best Ball mode and load roster slot config
          if (leagueData.settings) {
            const settings = leagueData.settings as LeagueSettings;
            if (settings.bestBallEnabled) {
              setBestBallEnabled(true);
            }
            if (settings.rosterSlots) {
              setLeagueRosterSlots(settings.rosterSlots);
            }
          }

          // Detect F/D/G position type
          if (leagueData.settings && (leagueData.settings as LeagueSettings).positionType === 'forward') {
            setLeaguePositionType('forward');
          }

          teamId = userTeamData.id;
          setUserTeamId(teamId);
          setUserTeam(userTeamData);
          // Draft is completed - get roster player IDs via API (Source of Truth)
          try {
            const rosterResponse = await rosterApi.getPlayerIds(userTeamData.league_id, userTeamData.id);
            const playerIds = (rosterResponse.data || []) as string[];

            // CRITICAL: player_id is TEXT in DB, and p.id is STRING in allPlayers (PlayerService line 287)
            // Compare strings to strings directly — ensure both sides are strings
            dbPlayers = allPlayers.filter(p => playerIds.includes(String(p.id)));

            if (dbPlayers.length < playerIds.length) {
              // Some players in roster_assignments were not found in PlayerService.getAllPlayers()
              // Fetch missing players individually via getPlayersByIds to prevent roster gaps
              const foundIds = new Set(dbPlayers.map(p => String(p.id)));
              const missingIds = playerIds.filter(id => !foundIds.has(id));
              if (missingIds.length > 0) {
                logger.info(`[Roster] ${missingIds.length} roster player(s) missing from allPlayers cache, fetching individually: ${missingIds.join(', ')}`);
                const recovered = await PlayerService.getPlayersByIds(missingIds);
                if (recovered.length > 0) {
                  dbPlayers = [...dbPlayers, ...recovered];
                  logger.info(`[Roster] Recovered ${recovered.length} missing player(s) via getPlayersByIds`);
                }
              }
            }
          } catch (rosterError) {
            logger.error('[Roster] Error fetching roster_assignments:', rosterError);
            // Last resort: empty roster
            dbPlayers = [];
          }
        }
        
        // Load real transactions if user has a team
        if (userTeamData?.league_id) {
          const { transactions: realTransactions } = await LeagueService.fetchTransactions(userTeamData.league_id);
          setTransactions(realTransactions);
        } else {
          setTransactions([]);
        }
        
        // Transform players from pipeline tables to HockeyPlayer format
        // All data (names, stats, positions, teams) comes from PlayerService (player_directory + player_season_stats)
        const formatSecondsToMMSS = (totalSeconds: number): string => {
          const s = Math.max(0, Math.round(totalSeconds || 0));
          const m = Math.floor(s / 60);
          const r = s % 60;
          return `${m}:${r < 10 ? '0' : ''}${r}`;
        };

        const transformedPlayers: HockeyPlayer[] = dbPlayers.map((p) => ({
          id: p.id,
          name: p.full_name,
          position: p.position,
          eligible_positions: p.eligible_positions || [p.position],
          number: parseInt(p.jersey_number || '0'),
          starter: false, // Will determine below
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
            // TOI shown in the UI is average TOI per game (TOI/60) formatted as MM:SS
            toi: formatSecondsToMMSS(
              (Number((p as any).icetime_seconds || 0) / Math.max(1, Number(p.games_played || 0)))
            ),
            wins: p.wins || 0,
            losses: p.losses || 0,
            otl: p.ot_losses || 0,
            gaa: p.goals_against_average || 0,
            savePct: p.save_percentage || 0,
            shutouts: (p as any).shutouts || 0,
            goalsSavedAboveExpected: p.goalsSavedAboveExpected || 0
          },
          team: p.team,
          teamAbbreviation: p.team, // DB has 'EDM' etc
          status: p.status === 'injured' ? 'IR' : (p.status === 'active' ? null : 'WVR'),
          roster_status: p.roster_status,
          is_ir_eligible: p.is_ir_eligible,
          image: p.headshot_url || undefined,
          nextGame: undefined, // Will be populated below with real schedule data
          projectedPoints: 0 // Will be set by daily projections system (getDailyProjectionsForMatchup)
        }));

        // Load real NHL schedule data for all players (batch query for performance)
        // Get user timezone from profile (default to Mountain Time)
        const userTimezone = profile?.timezone || 'America/Denver';
        
        // Get unique team abbreviations from all players
        const uniqueTeams = Array.from(new Set(
          transformedPlayers
            .map(p => p.teamAbbreviation || p.team || '')
            .filter(team => team !== '')
        ));
        
        // Batch fetch: check which teams have games today and get next games
        const [hasGamesTodayMap, nextGamesMap] = await Promise.all([
          ScheduleService.hasGamesTodayBatch(uniqueTeams),
          ScheduleService.getNextGamesForTeams(uniqueTeams)
        ]);
        
        // Map schedule data back to players
        transformedPlayers.forEach(player => {
          const teamAbbrev = player.teamAbbreviation || player.team || '';
          if (!teamAbbrev) return;
          
          const hasGameToday = hasGamesTodayMap.get(teamAbbrev) || false;
          
          // Only show game info if player has a game today
          if (hasGameToday) {
            const nextGame = nextGamesMap.get(teamAbbrev);
            const gameInfo = ScheduleService.getGameInfo(nextGame || null, teamAbbrev, userTimezone);
            
            if (gameInfo) {
              player.nextGame = {
                opponent: gameInfo.opponent,
                isToday: true,
                gameTime: gameInfo.time
              };
            }
          }
          // If no game today, don't set nextGame (will show "No Game" in the card)
        });

        // NOTE: Projections are NOT fetched here in loadRoster
        // Instead, they are handled by the dedicated useEffects (fetchDailyProjections + enrichment)
        // This matches how Matchup.tsx handles projections - roster loading is separate from projection loading
        // This ensures projections work correctly for ALL dates (today, past, and future)

        // Sort players consistently by ID for deterministic auto-assignment
        transformedPlayers.sort((a, b) => {
          const idA = typeof a.id === 'string' ? parseInt(a.id) : a.id;
          const idB = typeof b.id === 'string' ? parseInt(b.id) : b.id;
          return idA - idB;
        });
        
        
        // DEBUG: Check if McDavid made it through transformation
        const MCDAVID_ID = 8478402;
        const mcDavidInTransformed = transformedPlayers.find(p => p.id === MCDAVID_ID);

        // Check for saved lineup - but for demo teams, always auto-organize (same as OtherTeam.tsx)
        let savedLineup = null;
        const leagueIdForLineup = userTeamData?.league_id;

        // Check fantasy_daily_rosters for per-day lineups when a date is selected.
        // This handles both past dates (frozen) and today/future (user-set daily lineups).
        // Falls back to team_lineups (default) if no daily roster exists for that date.
        const todayStr = getTodayMST();
        const isPastDate = selectedDate && selectedDate < todayStr;
        const matchupForLoading = currentMatchup; // Use from closure

        if (selectedDate && matchupForLoading && teamId && leagueIdForLineup && !isDemoLeague(leagueIdForLineup)) {
          const dailyRoster = await LeagueService.loadDailyRoster(
            String(teamId),
            matchupForLoading.id,
            selectedDate,
            transformedPlayers,
            !!isPastDate  // Only fetch missing/dropped players for past dates
          );
          
          if (dailyRoster) {
            // Transform to HockeyPlayer format with starter flag
            const starters = dailyRoster.starters.map(p => ({ ...p, starter: true }));
            const bench = [...dailyRoster.bench];
            const ir = dailyRoster.ir;

            // Recover players in roster_assignments but missing from daily snapshot
            // (e.g. newly added via trade/waiver after snapshot was created)
            const snapshotPlayerIds = new Set([
              ...starters.map(p => String(p.id)),
              ...bench.map(p => String(p.id)),
              ...ir.map(p => String(p.id)),
            ]);
            transformedPlayers.forEach(player => {
              if (!snapshotPlayerIds.has(String(player.id))) {
                bench.push(player);
                logger.info(`[Roster] Recovered missing player ${player.name} (${player.id}) from roster_assignments → bench (daily roster)`);
              }
            });

            // CRITICAL: Ensure every starter has a slot assignment.
            // StartersGrid renders by slot lookup — any starter without
            // a slotAssignments entry is INVISIBLE even though they're
            // in the starters array. This repairs missing assignments.
            const repairedSlotAssignments = { ...dailyRoster.slotAssignments };
            const assignedSlots = new Set(Object.values(repairedSlotAssignments));
            starters.forEach(player => {
              const pid = String(player.id);
              if (!repairedSlotAssignments[pid]) {
                const pos = getFantasyPosition(player.position, leaguePositionType);
                const slotCaps: Record<string, number> = leaguePositionType === 'forward'
                  ? { F: 6, D: 4, G: 2, UTIL: 1 }
                  : { C: 2, LW: 2, RW: 2, D: 4, G: 2, UTIL: 1 };
                let assigned = false;
                // Try primary position slots first
                for (let i = 1; i <= (slotCaps[pos] || 0); i++) {
                  const slotId = `slot-${pos}-${i}`;
                  if (!assignedSlots.has(slotId)) {
                    repairedSlotAssignments[pid] = slotId;
                    assignedSlots.add(slotId);
                    assigned = true;
                    break;
                  }
                }
                // Fallback to UTIL for non-goalies
                if (!assigned && pos !== 'G' && !assignedSlots.has('slot-UTIL')) {
                  repairedSlotAssignments[pid] = 'slot-UTIL';
                  assignedSlots.add('slot-UTIL');
                  assigned = true;
                }
                if (!assigned) {
                  // No slot available — move to bench instead of being invisible
                  bench.push(player);
                  const idx = starters.indexOf(player);
                  if (idx >= 0) starters.splice(idx, 1);
                }
              }
            });

            setRoster({
              starters,
              bench,
              ir,
              slotAssignments: repairedSlotAssignments
            });
            setLoading(false);
            return; // Exit early - we've loaded from daily roster
          }
        }

        // Regular lineup loading (from team_lineups or default)
        if (userLeagueState === 'guest' || userLeagueState === 'logged-in-no-league') {
          // Demo teams: Always auto-organize (don't check for saved lineups)
          savedLineup = null;
        } else if (teamId && leagueIdForLineup && !isDemoLeague(leagueIdForLineup)) {
          // Real user team - use actual league_id from local variable (not stale state)
          savedLineup = await LeagueService.getLineup(teamId, leagueIdForLineup);
          
          if (savedLineup) {
            // Trust the saved lineup - the save protection guard prevents bad data from being saved
            // No filtering needed on load, as lineup integrity is enforced at save time
          }
        }
        
        if (savedLineup && (savedLineup.starters?.length || 0) > 0) {
          // Restore saved lineup from team_lineups
          // IMPORTANT: roster_assignments is the SOURCE OF TRUTH for roster membership
          // team_lineups may contain stale player IDs from old drops - we MUST filter them out
          // transformedPlayers is already built from roster_assignments (loaded above)
          
          // Helper to deduplicate IDs
          const uniqueIds = (ids: string[]) => Array.from(new Set(ids));
          
          // Get current roster player IDs (from roster_assignments via transformedPlayers)
          const currentPlayerIds = new Set(transformedPlayers.map(p => String(p.id)));
          
          // Check for stale player IDs in saved lineup (indicates team_lineups needs cleanup)
          const allSavedIds = new Set([
            ...uniqueIds(savedLineup.starters),
            ...uniqueIds(savedLineup.bench),
            ...uniqueIds(savedLineup.ir)
          ]);
          const stalePlayerIds = Array.from(allSavedIds).filter(id => !currentPlayerIds.has(id));
          
          if (stalePlayerIds.length > 0) {
            // Stale player IDs detected - they'll be filtered out below
          }
          
          // Filter saved lineup to only include current roster players
          const filteredStarters = uniqueIds(savedLineup.starters).filter(id => currentPlayerIds.has(id));
          const filteredBench = uniqueIds(savedLineup.bench).filter(id => currentPlayerIds.has(id));
          const filteredIr = uniqueIds(savedLineup.ir).filter(id => currentPlayerIds.has(id));
          
          // Build player map from current roster
          const playerMap = new Map(transformedPlayers.map(p => [String(p.id), p]));
          
          // Map filtered IDs to player objects
          const starters = filteredStarters
            .map(id => {
              const player = playerMap.get(id);
              if (!player) {
                return null;
              }
              return { ...player, starter: true };
            })
            .filter((p): p is HockeyPlayer => !!p);
          
          const bench = filteredBench
            .map(id => {
              const player = playerMap.get(id);
              if (!player) {
                return null;
              }
              return player;
            })
            .filter((p): p is HockeyPlayer => !!p);
          
          const ir = filteredIr
            .map(id => {
              const player = playerMap.get(id);
              if (!player) {
                return null;
              }
              return player;
            })
            .filter((p): p is HockeyPlayer => !!p);
          
          // Add any new players (not in saved lineup) to bench
          const savedPlayerIds = new Set([...filteredStarters, ...filteredBench, ...filteredIr]);
          let newPlayersRecovered = false;
          transformedPlayers.forEach(player => {
            if (!savedPlayerIds.has(String(player.id))) {
              bench.push(player);
              newPlayersRecovered = true;
              logger.info(`[Roster] Recovered missing player ${player.name} (${player.id}) from roster_assignments → bench`);
            }
          });
          
          // CRITICAL: Ensure all starter slots are filled with position-aware logic
          // Slot structure depends on league position type
          const slotsNeeded: Record<string, number> = leaguePositionType === 'forward'
            ? { 'F': 6, 'D': 4, 'G': 2, 'UTIL': 1 }
            : { 'C': 2, 'LW': 2, 'RW': 2, 'D': 4, 'G': 2, 'UTIL': 1 };
          const totalSlotsNeeded = Object.values(slotsNeeded).reduce((a, b) => a + b, 0);

          // Count current positions in starters
          const positionCounts: Record<string, number> = {};
          for (const pos of Object.keys(slotsNeeded)) {
            positionCounts[pos] = starters.filter(p => getFantasyPosition(p.position, leaguePositionType) === pos).length;
          }
          
          if (starters.length < totalSlotsNeeded) {
            
            // Get available bench players sorted by points
            const availableBench = [...bench].sort((a, b) => ((b.stats?.points || 0) - (a.stats?.points || 0)));
            
            // Priority order: Fill critical positions first (G, D), then forwards
            const priorityOrder = leaguePositionType === 'forward'
              ? ['G', 'D', 'F', 'UTIL']
              : ['G', 'D', 'C', 'LW', 'RW', 'UTIL'];

            // First pass: Fill missing positions with position-specific players
            for (const pos of priorityOrder) {
              const needed = slotsNeeded[pos] || 0;
              const current = positionCounts[pos] || 0;
              const missing = needed - current;

              if (missing > 0) {
                // Find best available players eligible for this position (includes multi-pos)
                const positionPlayers = availableBench.filter(p => {
                  const eligible = (p.eligible_positions && p.eligible_positions.length > 0)
                    ? p.eligible_positions.map(ep => getFantasyPosition(ep, leaguePositionType))
                    : [getFantasyPosition(p.position, leaguePositionType)];
                  return eligible.includes(pos);
                });
                const bestOfPosition = positionPlayers
                  .sort((a, b) => ((b.stats?.points || 0) - (a.stats?.points || 0)))
                  .slice(0, missing);
                
                bestOfPosition.forEach(player => {
                  starters.push({ ...player, starter: true });
                  const benchIndex = bench.findIndex(p => p.id === player.id);
                  if (benchIndex >= 0) {
                    bench.splice(benchIndex, 1);
                  }
                  // Remove from availableBench tracking
                  const availableIndex = availableBench.findIndex(p => p.id === player.id);
                  if (availableIndex >= 0) {
                    availableBench.splice(availableIndex, 1);
                  }
                  positionCounts[pos]++;
                });
              }
            }
            
            // NOTE: No position-blind second pass. If starters < 13 because no
            // eligible players exist for certain positions (e.g., only 3 D for 4 D slots),
            // those slots stay empty. This matches Yahoo/ESPN fantasy behavior.
          }

          // Ensure all slot assignments are valid (player still exists)
          const validSlotAssignments: Record<string, string> = {};
          Object.entries(savedLineup.slotAssignments || {}).forEach(([playerId, slotId]) => {
            if (playerMap.has(playerId)) {
              validSlotAssignments[playerId] = slotId as string;
            }
          });

          // Recalculate slot assignments for any newly added starters
          // Convert IDs to strings for consistent comparison
          const newStarters = starters.filter(s => !validSlotAssignments[String(s.id)]);
          if (newStarters.length > 0) {
            // Get already assigned slots to avoid conflicts
            const assignedSlots = new Set(Object.values(validSlotAssignments));
            const newSlotAssignments = calculateInitialSlotAssignments(newStarters, assignedSlots);
            // Merge new assignments, converting IDs to strings
            Object.entries(newSlotAssignments).forEach(([playerId, slotId]) => {
              validSlotAssignments[String(playerId)] = slotId;
            });
          }

          // Safety net: if any starters still lack slots after incremental assignment,
          // try a full recalculation, then demote still-orphaned starters to bench.
          // NEVER force a player into a position-ineligible slot (e.g., RW into D4).
          // Empty starter slots are valid — just like Yahoo/ESPN fantasy.
          const orphanedStarters = starters.filter(s => !validSlotAssignments[String(s.id)]);
          if (orphanedStarters.length > 0) {
            const fullAssignments = calculateInitialSlotAssignments(starters);
            Object.entries(fullAssignments).forEach(([playerId, slotId]) => {
              validSlotAssignments[String(playerId)] = slotId;
            });

            // Move still-orphaned starters to bench — they have no eligible slot
            const stillOrphaned = starters.filter(s => !validSlotAssignments[String(s.id)]);
            for (const orphan of stillOrphaned) {
              const idx = starters.indexOf(orphan);
              if (idx >= 0) starters.splice(idx, 1);
              bench.unshift({ ...orphan, starter: false } as any);
            }
          }
          
          // Normalize all slot assignment keys to strings for consistency
          const normalizedSlotAssignments: Record<string, string> = {};
          Object.entries(validSlotAssignments).forEach(([playerId, slotId]) => {
            normalizedSlotAssignments[String(playerId)] = slotId;
          });
          
          setRoster({ starters, bench, ir, slotAssignments: normalizedSlotAssignments });

          // Persist recovered lineup if new players were added from roster_assignments
          // This prevents players from disappearing on subsequent saves
          if (newPlayersRecovered && userTeamId && user && userTeam?.league_id && !isDemoLeague(userTeam.league_id)) {
            // Integrity check: ensure every starter has a slot before saving
            const startersWithoutSlots = starters.filter(s => !normalizedSlotAssignments[String(s.id)]);
            if (startersWithoutSlots.length > 0) {
              const recalculated = calculateInitialSlotAssignments(starters);
              Object.entries(recalculated).forEach(([pid, slot]) => {
                normalizedSlotAssignments[String(pid)] = slot;
              });
              // Update UI state with repaired assignments
              setRoster({ starters, bench, ir, slotAssignments: normalizedSlotAssignments });
            }

            logger.info('[Roster] Persisting recovered lineup with newly added players');
            // CRITICAL: Pass selectedDate so date-specific views write to fantasy_daily_rosters
            // instead of corrupting the base team_lineups
            await LeagueService.saveLineup(userTeamId, userTeam.league_id, {
              starters: starters.map(p => p.id),
              bench: bench.map(p => p.id),
              ir: ir.map(p => p.id),
              slotAssignments: normalizedSlotAssignments
            }, selectedDate || getTodayMST());
          }
        } else {
          // No saved lineup - use EXACT SAME LOGIC AS OtherTeam.tsx
          const starters: HockeyPlayer[] = [];
          const bench: HockeyPlayer[] = [];
          const ir: HockeyPlayer[] = [];
          const assignments: Record<string, string> = {};
          
          const slotsNeeded: Record<string, number> = leaguePositionType === 'forward'
            ? { 'F': 6, 'D': 4, 'G': 2, 'UTIL': 1 }
            : { 'C': 2, 'LW': 2, 'RW': 2, 'D': 4, 'G': 2, 'UTIL': 1 };
          const slotsFilled: Record<string, number> = {};
          for (const k of Object.keys(slotsNeeded)) slotsFilled[k] = 0;
          let irSlotIndex = 1;

          transformedPlayers.forEach(p => {
            if (p.status === 'IR' || p.status === 'SUSP') {
              if (irSlotIndex <= 3) {
                ir.push(p);
                assignments[p.id] = `ir-slot-${irSlotIndex}`;
                irSlotIndex++;
              } else {
                bench.push(p);
              }
              return;
            }

            // Use eligible_positions for multi-position slot assignment
            const eligiblePos = (p.eligible_positions && p.eligible_positions.length > 0)
              ? p.eligible_positions.map(ep => getFantasyPosition(ep, leaguePositionType))
              : [getFantasyPosition(p.position, leaguePositionType)];
            const primaryPos = eligiblePos[0];
            let assigned = false;

            // Try primary position first
            if (primaryPos !== 'UTIL' && slotsFilled[primaryPos] < slotsNeeded[primaryPos]) {
              slotsFilled[primaryPos]++;
              assigned = true;
              assignments[p.id] = `slot-${primaryPos}-${slotsFilled[primaryPos]}`;
            } else {
              // Try secondary eligible positions
              for (const pos of eligiblePos.slice(1)) {
                if (pos !== 'UTIL' && pos !== 'G' && slotsFilled[pos] < slotsNeeded[pos]) {
                  slotsFilled[pos]++;
                  assigned = true;
                  assignments[p.id] = `slot-${pos}-${slotsFilled[pos]}`;
                  break;
                }
              }
            }
            // Fallback to UTIL if not assigned and not a goalie
            if (!assigned && primaryPos !== 'G' && slotsFilled['UTIL'] < slotsNeeded['UTIL']) {
              slotsFilled['UTIL']++;
              assigned = true;
              assignments[p.id] = 'slot-UTIL';
            }
            
            if (assigned) {
              starters.push({ ...p, starter: true });
            } else {
              bench.push(p);
            }
          });
          
          setRoster({ starters, bench, ir, slotAssignments: assignments });

          // Save initial lineup ONLY on first load (selectedDate is null).
          // Do NOT save during date switches — that overwrites team_lineups base
          // and wipes any per-day edits the user made.
          if (!selectedDate && userTeamId && user && userTeam?.league_id && !isDemoLeague(userTeam.league_id)) {
            await LeagueService.saveLineup(userTeamId, userTeam.league_id, {
              starters: starters.map(p => p.id),
              bench: bench.map(p => p.id),
              ir: ir.map(p => p.id),
              slotAssignments: assignments
            }); // No targetDate = set base lineup
          }
        }
        
        // CRITICAL SAFETY CHECK: For demo state, ensure roster was set
        if ((userLeagueState === 'guest' || userLeagueState === 'logged-in-no-league') && transformedPlayers.length > 0) {
          // Verify roster has players - if not, something went wrong
        }
      } catch (e: any) {
        // For demo state, try to set roster even if there was an error
        if ((userLeagueState === 'guest' || userLeagueState === 'logged-in-no-league')) {
          logger.error('[Roster] Error in loadRoster for demo state, attempting fallback:', e);
          try {
            // Last resort: get static players and set roster directly (inline, no service dependency)
            const allPlayers = await PlayerService.getAllPlayers();
            // Get top 21 players directly (don't rely on DemoLeagueService in catch block)
            const staticPlayers = [...allPlayers]
              .sort((a, b) => (b.points || 0) - (a.points || 0))
              .slice(0, 21);
            const transformed = staticPlayers.map((p) => ({
              id: p.id,
              name: p.full_name,
              position: p.position,
              number: parseInt(p.jersey_number || '0'),
              starter: false,
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
                // corsi/fenwick intentionally removed
                wins: p.wins || 0,
                losses: p.losses || 0,
                otl: p.ot_losses || 0,
                gaa: p.goals_against_average || 0,
                savePct: p.save_percentage || 0,
                shutouts: 0
              },
              team: p.team,
              teamAbbreviation: p.team,
              status: (p.status === 'injured' ? 'IR' : null) as 'IR' | 'SUSP' | 'GTD' | 'WVR' | null,
              image: p.headshot_url || undefined,
              nextGame: undefined,
              projectedPoints: 0 // Will be set by daily projections system
            })) as HockeyPlayer[];
            
            // Auto-organize using same improved logic
            const starters: HockeyPlayer[] = [];
            const bench: HockeyPlayer[] = [];
            const ir: HockeyPlayer[] = [];
            const slotsNeeded: Record<string, number> = leaguePositionType === 'forward'
              ? { 'F': 6, 'D': 4, 'G': 2, 'UTIL': 1 }
              : { 'C': 2, 'LW': 2, 'RW': 2, 'D': 4, 'G': 2, 'UTIL': 1 };
            const slotsFilled: Record<string, number> = {};
            for (const k of Object.keys(slotsNeeded)) slotsFilled[k] = 0;
            const totalSlotsNeeded = Object.values(slotsNeeded).reduce((a, b) => a + b, 0);

            // Sort by points
            const sorted = [...transformed].sort((a, b) => ((b.stats?.points || 0) - (a.stats?.points || 0)));

            // Place IR players first
            sorted.forEach(p => {
              if (p.status === 'IR' || p.status === 'SUSP') {
                if (ir.length < 3) {
                  ir.push(p);
                } else {
                  bench.push(p);
                }
              }
            });

            // Fill position-specific slots
            const availablePlayers = sorted.filter(p => p.status !== 'IR' && p.status !== 'SUSP');

            availablePlayers.forEach(p => {
              const pos = getFantasyPosition(p.position, leaguePositionType);
              
              if (pos !== 'UTIL' && pos !== 'G' && slotsFilled[pos] < slotsNeeded[pos]) {
                starters.push({ ...p, starter: true });
                slotsFilled[pos]++;
              } else if (pos === 'G' && slotsFilled['G'] < slotsNeeded['G']) {
                starters.push({ ...p, starter: true });
                slotsFilled['G']++;
              } else if (pos !== 'G' && slotsFilled['UTIL'] < slotsNeeded['UTIL']) {
                starters.push({ ...p, starter: true });
                slotsFilled['UTIL']++;
              } else {
                bench.push(p);
              }
            });
            
            // Ensure all 13 slots are filled
            if (starters.length < totalSlotsNeeded) {
              const remainingBench = [...bench].sort((a, b) => ((b.stats?.points || 0) - (a.stats?.points || 0)));
              while (starters.length < totalSlotsNeeded && remainingBench.length > 0) {
                const bestPlayer = remainingBench.shift();
                if (bestPlayer) {
                  starters.push({ ...bestPlayer, starter: true });
                  const benchIndex = bench.findIndex(p => p.id === bestPlayer.id);
                  if (benchIndex >= 0) {
                    bench.splice(benchIndex, 1);
                  }
                }
              }
            }
            
            const slotAssignments = calculateInitialSlotAssignments(starters);
            setRoster({ starters, bench, ir: [], slotAssignments });
            
            // Set demo team data
            setUserTeamId(`${DEMO_LEAGUE_ID_FOR_GUESTS}-team-3`);
            setUserTeam({ id: `${DEMO_LEAGUE_ID_FOR_GUESTS}-team-3`, league_id: DEMO_LEAGUE_ID_FOR_GUESTS, team_name: 'Citrus Crushers' });
          } catch (fallbackError) {
            logger.error('[Roster] Even emergency fallback failed:', fallbackError);
          }
        }
        // Filter out demo league errors - they're expected and harmless
        const errorMessage = e?.message || '';
        const isDemoLeagueError = errorMessage.toLowerCase().includes('demo') || 
                                  errorMessage.toLowerCase().includes('league') && 
                                  (errorMessage.toLowerCase().includes('id') || errorMessage.toLowerCase().includes('uuid'));
        
        if (!isDemoLeagueError) {
          logger.error("Failed to load roster", e);
          logger.error("Error details:", {
            message: e?.message,
            stack: e?.stack,
            name: e?.name
          });
          toast({
            title: "Unable to Load Roster",
            description: 'Please try refreshing the page.',
            variant: "default"
          });
        } else {
          // Silently ignore demo league errors
        }
      } finally {
        // Always set loading to false at the end
        setLoading(false);
      }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- userTeam.league_id and userTeamId derived from state set within this callback
  }, [user, profile, toast, userLeagueState, leagueLoading, activeLeagueId, selectedDate, currentMatchup]);

  // Initial load on mount and when userLeagueState changes
  useEffect(() => {
    // Skip if league is changing
    if (isChangingLeague) {
      return;
    }

    // For guests, load immediately. For logged-in users, wait for league context
    if (userLeagueState === 'guest' || !leagueLoading) {
      try {
        loadRoster();
      } catch (error) {
        logger.error('[Roster] Error in initial load:', error);
        setLoading(false);
        toast({
          title: "Roster Won't Load",
          description: "Couldn't load your roster — refresh and we'll pick it back up.",
          variant: 'destructive'
        });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- loadRoster excluded to prevent double-fire when selectedDate changes (date-change useEffect handles that)
  }, [userLeagueState, leagueLoading, isChangingLeague, toast]);

  // Listen for cross-page roster-change events (fired by FreeAgents, WaiverWire,
  // Roster drop dialog, etc.) and refresh without requiring a hard reset.
  // 2026-08-24: the handler used to refetch WITHOUT clearing the in-memory
  // roster caches, so it faithfully re-rendered the stale copy — the exact
  // "have to hard-reset the browser to see my add" bug. Clear first, always.
  useEffect(() => {
    const handler = () => {
      try {
        clearRosterCaches();
        loadRoster(true);
      } catch (e) { logger.error('[Roster] refresh-on-event failed:', e); }
    };
    window.addEventListener('citrus:roster-changed', handler);
    return () => window.removeEventListener('citrus:roster-changed', handler);
  }, [loadRoster]);

  // Calculate available weeks, find current matchup by date, and set initial week
  // Fetches all matchups to find which week_number contains today's date,
  // since matchup week_numbers may not align with calendar-based week calculations.
  useEffect(() => {
    if (!activeLeague || activeLeague.draft_status !== 'completed') return;
    if (!userTeamId || !userTeam?.league_id) return;
    if (userLeagueState === 'guest' || userLeagueState === 'logged-in-no-league') return;

    const initWeeks = async () => {
      const draftCompletionDate = getDraftCompletionDate(activeLeague);
      if (!draftCompletionDate) return;

      // WEEK-MATH FIX (2026-08-22): clamp to the season start like matchup
      // generation does — an offseason draft otherwise anchors week labels/
      // dates at an Aug/Sep calendar week that contradicts the schedule.
      const firstWeek = clampToSeasonStart(getFirstWeekStartDate(draftCompletionDate));
      setFirstWeekStart(firstWeek);

      // Fetch all matchups to determine available weeks and find current week by date
      try {
        const resp = await matchupApi.getLeagueMatchups(userTeam.league_id);
        const allMatchups = (resp.data || []) as any[];

        if (allMatchups.length === 0) {
          // Fallback to calendar-based calculation if no matchups exist
          const weeks = getAvailableWeeks(firstWeek);
          const currentWeek = getCurrentWeekNumber(firstWeek);
          setAvailableWeeks(weeks);
          setSelectedWeek(prev => prev === 0 ? Math.min(currentWeek, weeks.length) : prev);
          return;
        }

        // Build available weeks from actual matchup data
        const weekNumbers = [...new Set(allMatchups.map((m: any) => m.week_number as number))].sort((a, b) => a - b);
        setAvailableWeeks(weekNumbers);

        // Find the matchup week that contains today
        const todayStr = getTodayMST();
        const todayMatchup = allMatchups.find((m: any) =>
          m.week_start_date <= todayStr && m.week_end_date >= todayStr
        );

        if (todayMatchup) {
          setSelectedWeek(prev => prev === 0 ? todayMatchup.week_number : prev);
        } else {
          // No matchup contains today — use the latest completed or next upcoming
          const sorted = [...allMatchups].sort((a: any, b: any) => a.week_start_date.localeCompare(b.week_start_date));
          const upcoming = sorted.find((m: any) => m.week_start_date > todayStr);
          const latest = sorted[sorted.length - 1];
          const best = upcoming || latest;
          setSelectedWeek(prev => prev === 0 ? best.week_number : prev);
        }
      } catch (error) {
        logger.error('[Roster] Error fetching matchups for week init:', error);
        // Fallback to calendar-based calculation
        const weeks = getAvailableWeeks(firstWeek);
        const currentWeek = getCurrentWeekNumber(firstWeek);
        setAvailableWeeks(weeks);
        setSelectedWeek(prev => prev === 0 ? Math.min(currentWeek, weeks.length) : prev);
      }
    };

    initWeeks();
  }, [activeLeague, userTeamId, userTeam?.league_id, userLeagueState]);

  // Handle week change
  const handleWeekChange = useCallback((week: number) => {
    setSelectedWeek(week);
    setSelectedDate(null); // Reset date selection when week changes
  }, []);

  // Fetch matchup for selected week
  useEffect(() => {
    const fetchMatchupForWeek = async () => {
      if (!userTeamId || !userTeam?.league_id || selectedWeek <= 0) return;
      // Skip matchup fetch for demo/guest users — they're not league members
      if (userLeagueState === 'guest' || userLeagueState === 'logged-in-no-league') return;

      try {
        const matchupsResponse = await matchupApi.getLeagueMatchups(userTeam.league_id, selectedWeek);
        const allMatchups = (matchupsResponse.data || []) as any[];
        // Filter for the user's team client-side
        const matchups = allMatchups.filter(
          (m: any) => m.team1_id === userTeamId || m.team2_id === userTeamId
        );

        if (matchups.length === 0) {
          setCurrentMatchup(null);
          setMatchupWeekDates([]);
          return;
        }

        const matchup = matchups[0] as MatchupType;
        setCurrentMatchup(matchup);

        // Generate array of 7 dates using the SAME logic as WeeklySchedule.tsx (manual parsing to avoid timezone issues)
        const [startYear, startMonth, startDay] = matchup.week_start_date.split('-').map(Number);
        const [endYear, endMonth, endDay] = matchup.week_end_date.split('-').map(Number);
        const startDate = new Date(startYear, startMonth - 1, startDay);
        const endDate = new Date(endYear, endMonth - 1, endDay);
        const dates: string[] = [];
        const current = new Date(startDate);
        while (current <= endDate) {
          const year = current.getFullYear();
          const month = String(current.getMonth() + 1).padStart(2, '0');
          const day = String(current.getDate()).padStart(2, '0');
          dates.push(`${year}-${month}-${day}`);
          current.setDate(current.getDate() + 1);
        }
        setMatchupWeekDates(dates);

        // Default to today if it falls within this matchup week, otherwise first day
        if (dates.length > 0) {
          const todayStr = getTodayMST();
          setSelectedDate(dates.includes(todayStr) ? todayStr : dates[0]);
        }
      } catch (error) {
        logger.error('[Roster] Error in fetchMatchupForWeek:', error);
        setCurrentMatchup(null);
        setMatchupWeekDates([]);
      }
    };

    if (userTeamId && userTeam?.league_id && selectedWeek > 0) {
      fetchMatchupForWeek();
    }
  }, [userTeamId, userTeam?.league_id, selectedWeek, userLeagueState]);

  // Defensive State Management: Multiple reload triggers to ensure fresh data
  
  // 1. Visibility change (tab becomes active)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && userTeamId && (userLeagueState === 'guest' || !leagueLoading)) {
        loadRoster(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [loadRoster, userTeamId, userLeagueState, leagueLoading]);

  // 2. Window focus (user returns to browser window)
  useEffect(() => {
    const handleFocus = () => {
      if (document.visibilityState === 'visible' && userTeamId && (userLeagueState === 'guest' || !leagueLoading)) {
        loadRoster(true);
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [loadRoster, userTeamId, userLeagueState, leagueLoading]);

  // 3. Storage event (changes from other tabs - future-proof for cross-tab sync)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      // If another tab saved a lineup for this team, reload
      if (e.key === `lineup_${userTeamId}_${userTeam?.league_id}` && userTeamId) {
        loadRoster(true);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [loadRoster, userTeamId, userTeam?.league_id]);

  // Track React Router navigation key changes (more reliable than pathname)
  const lastLocationKeyRef = useRef(location.key);

  // Reload roster when navigating to this route (using location.key for better detection)
  useEffect(() => {
    // location.key changes on every navigation, even within the same path
    const isNavigationChange = lastLocationKeyRef.current !== location.key;
    const isRosterPage = location.pathname === '/roster';
    
    if (isNavigationChange && isRosterPage && (userLeagueState === 'guest' || !leagueLoading)) {
      loadRoster(true); // Keep current roster visible during refresh
    }
    
    lastLocationKeyRef.current = location.key;
  }, [location.key, location.pathname, loadRoster, userLeagueState, leagueLoading]);

  // Expose refreshRoster function for manual refresh (e.g., after add/drop)
  const refreshRoster = useCallback(() => {
    loadRoster(true); // Keep current roster visible during refresh
  }, [loadRoster]);

  // Fetch locked player IDs based on game start times for selected date
  const fetchLockedPlayerIds = useCallback(async () => {
    try {
      const allPlayers = [...roster.starters, ...roster.bench, ...roster.ir];
      if (allPlayers.length === 0) {
        setLockedPlayerIds(new Set());
        return;
      }

      // If viewing a past date, all players should be locked (read-only view)
      if (selectedDate) {
        const todayStr = getTodayMST();
        if (selectedDate < todayStr) {
          // Past date - lock all players
          const allPlayerIds = new Set(allPlayers.map(p => String(p.id)));
          setLockedPlayerIds(allPlayerIds);
          return;
        }
      }

      // If viewing today or future date, check lock status for selected date
      const targetDate = selectedDate ? new Date(selectedDate + 'T00:00:00') : undefined;
      
      // Get locked IDs for the target date (or today if no date selected) — single batch query
      const lockedIds = await GameLockService.getLockedPlayerIds(allPlayers, targetDate);
      setLockedPlayerIds(lockedIds);
    } catch (error) {
      logger.error('[Roster] Error fetching locked player IDs:', error);
      // Fail open - don't lock players on error
      setLockedPlayerIds(new Set());
    }
  }, [roster.starters, roster.bench, roster.ir, selectedDate]);

  // Fetch locked player IDs when roster or selected date changes
  useEffect(() => {
    if (roster.starters.length > 0 || roster.bench.length > 0 || roster.ir.length > 0) {
      fetchLockedPlayerIds();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchLockedPlayerIds transitively covers roster arrays
  }, [fetchLockedPlayerIds]);

  // Reload roster when selected date changes — each day has independent lineup data
  // (per-day daily roster from fantasy_daily_rosters, or base fallback from team_lineups).
  // Must reload for ALL dates (past, today, future) to prevent stale React state
  // from the previous date leaking into the new date's view.
  useEffect(() => {
    if (selectedDate && currentMatchup && userTeamId) {
      loadRoster(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- currentMatchup object would cause infinite re-renders; .id is sufficient
  }, [selectedDate, currentMatchup?.id, userTeamId, loadRoster]);

  // EGRESS OPTIMIZATION: Refresh lock status every 60 seconds (was 30s)
  // Game locks change at game start time, not during games - 60s is sufficient
  useEffect(() => {
    if (roster.starters.length === 0 && roster.bench.length === 0 && roster.ir.length === 0) {
      return;
    }

    const interval = setInterval(() => {
      fetchLockedPlayerIds();
    }, 60000); // 60 seconds (was 30s - enterprise egress optimization)

    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- guard reads roster lengths but fetchLockedPlayerIds transitively covers them
  }, [fetchLockedPlayerIds]);

  // Auto-save lineup when leaving page (backup)
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Only save if user has a real team (not demo)
      if (userTeamId && user && userTeam?.league_id && !isDemoLeague(userTeam.league_id)) {
        // Use navigator.sendBeacon or a synchronous save if possible
        // For now, we'll rely on the saves in handleDragEnd
        // This is just a safety net - the main saves happen on every drag
        const lineupToSave = {
          starters: roster.starters.map(p => p.id),
          bench: roster.bench.map(p => p.id),
          ir: roster.ir.map(p => p.id),
          slotAssignments: roster.slotAssignments
        };
        
        // Use sendBeacon for reliable save on page unload
        const data = JSON.stringify({
          teamId: userTeamId,
          leagueId: userTeam.league_id,
          lineup: lineupToSave
        });
        
        // Note: This would require a special endpoint that accepts beacons
        // For now, we rely on the saves in handleDragEnd which happen immediately
        // The beforeunload is mainly for user awareness
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [roster, userTeamId, user, userTeam]);

  // Calculate team stats from league data
  useEffect(() => {
    const calculateStats = async () => {
      if (!userTeam || !user) {
        // Reset to defaults if no team
        setTeamStats({
          record: "0-0-0",
          rank: "-",
          totalPoints: 0,
          avgPoints: 0,
          highScore: 0,
          waiverMoves: 0,
        });
        return;
      }

      try {
        // Get league to check draft status FIRST
        const { league: leagueData, error: leagueError } = await LeagueService.getLeague(userTeam.league_id, user.id);
        if (leagueError || !leagueData || leagueData.draft_status !== 'completed') {
          // Draft not completed - show default stats
          setTeamStats({
            record: "0-0-0",
            rank: "-",
            totalPoints: 0,
            avgPoints: 0,
            highScore: 0,
            waiverMoves: transactions.filter(t => t.type === 'claim' || t.type === 'drop').length,
          });
          return;
        }

        // Get all teams in the league
        const { teams: leagueTeams, error: teamsError } = await LeagueService.getLeagueTeamsWithOwners(userTeam.league_id);
        if (teamsError) throw teamsError;

        // Get draft picks for this league (only used if draft is completed)
        const { picks: draftPicks } = await DraftService.getDraftPicks(userTeam.league_id, user.id);
        
        // If no draft picks, show default values
        if (!draftPicks || draftPicks.length === 0) {
          setTeamStats({
            record: "0-0-0",
            rank: "-",
            totalPoints: 0,
            avgPoints: 0,
            highScore: 0,
            waiverMoves: transactions.filter(t => t.type === 'claim' || t.type === 'drop').length,
          });
          return;
        }

        // Get all players to calculate points
        const allPlayers = await PlayerService.getAllPlayers();

        // Calculate team standings
        const calculatedStats = await LeagueService.calculateTeamStandings(
          userTeam.league_id,
          leagueTeams,
          draftPicks,
          allPlayers
        );

        // Get user's team stats
        const userTeamStats = calculatedStats[userTeam.id] || { pointsFor: 0, pointsAgainst: 0, wins: 0, losses: 0 };

        // Calculate rank by sorting teams by pointsFor
        const sortedTeams = [...leagueTeams].sort((a, b) => {
          const aPoints = calculatedStats[a.id]?.pointsFor || 0;
          const bPoints = calculatedStats[b.id]?.pointsFor || 0;
          return bPoints - aPoints;
        });
        const rankIndex = sortedTeams.findIndex(t => t.id === userTeam.id);
        const rank = rankIndex >= 0 ? `${rankIndex + 1}${getRankSuffix(rankIndex + 1)}` : '-';

        // Use calculated pointsFor from standings (based on all drafted players)
        const totalPoints = userTeamStats.pointsFor;

        // Calculate average points per player (from all drafted players)
        const teamPicks = draftPicks.filter(p => p.team_id === userTeam.id);
        const avgPoints = teamPicks.length > 0 ? (totalPoints / teamPicks.length) : 0;

        // Calculate record
        const record = `${userTeamStats.wins}-${userTeamStats.losses}-0`;

        // Get waiver moves (from transactions)
        const waiverMoves = transactions.filter(t => t.type === 'claim' || t.type === 'drop').length;

        setTeamStats({
          record,
          rank,
          totalPoints: Math.round(userTeamStats.pointsFor),
          avgPoints: Math.round(avgPoints * 10) / 10,
          highScore: Math.round(userTeamStats.pointsFor), // Placeholder - would need weekly data
          waiverMoves,
        });
      } catch (error) {
        logger.error('Error calculating team stats:', error);
        // On error, show defaults
        setTeamStats({
          record: "0-0-0",
          rank: "-",
          totalPoints: 0,
          avgPoints: 0,
          highScore: 0,
          waiverMoves: 0,
        });
      }
    };

    calculateStats();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- transactions/user/userTeam objects would cause loops; using stable sub-values
  }, [userTeam?.id, user?.id, transactions.length]);

  // Fetch daily projections for selected date (WORLD-CLASS PATTERN - matches Matchup tab)
  // CRITICAL: Do NOT include projectionsByDate in dependencies - it causes circular triggers
  const currentFetchDateRef = useRef<string | null>(null);
  const projectionsLoadingRef = useRef<boolean>(false);
  
  // Memoized projection fetch function (matches Matchup.tsx pattern)
  const fetchProjectionsForDate = useCallback(async (date: string, playerIds: number[]) => {
    // Check cache first - if we have projections for this date, don't re-fetch
    if (projectionsByDate.has(date)) {
      return;
    }

    // Prevent concurrent fetches
    if (projectionsLoadingRef.current) {
      return;
    }

    if (playerIds.length === 0) {
      return;
    }

    projectionsLoadingRef.current = true;
    
    try {
      const projectionMap = await MatchupService.getDailyProjectionsForMatchup(playerIds, date);
      
      setProjectionsByDate(prev => {
        const newMap = new Map(prev);
        newMap.set(date, projectionMap);
        return newMap;
      });
    } catch (error) {
      logger.error(`[Roster.fetchProjections] Error fetching projections for ${date}:`, error);
      // Don't cache errors - allow retry
    } finally {
      projectionsLoadingRef.current = false;
    }
  }, [projectionsByDate]);
  
  // Main useEffect - triggers projection fetch when roster or date changes
  useEffect(() => {
    // Collect all player IDs from roster
    const allPlayerIds: number[] = [];
    
    [...roster.starters, ...roster.bench, ...roster.ir].forEach(player => {
      const playerId = typeof player.id === 'string' ? parseInt(player.id) : player.id;
      if (!isNaN(playerId) && playerId > 0) {
        allPlayerIds.push(playerId);
      }
    });

    if (allPlayerIds.length === 0) {
      return;
    }

    // Use selectedDate or default to today
    const targetDate = selectedDate || getTodayMST();
    
    // Fetch projections for this date
    fetchProjectionsForDate(targetDate, allPlayerIds);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- roster arrays as deps would cause circular triggers; lengths are sufficient
  }, [selectedDate, roster.starters.length, roster.bench.length, roster.ir.length, fetchProjectionsForDate]);

  // Fetch daily game stats for selected date (actual stats for live/final games)
  const dailyStatsLoadingRef = useRef<boolean>(false);
  useEffect(() => {
    const allPlayerIds: number[] = [];
    [...roster.starters, ...roster.bench, ...roster.ir].forEach(player => {
      const playerId = typeof player.id === 'string' ? parseInt(player.id) : player.id;
      if (!isNaN(playerId) && playerId > 0) allPlayerIds.push(playerId);
    });
    if (allPlayerIds.length === 0) return;

    const targetDate = selectedDate || getTodayMST();
    if (dailyStatsByDateMap.has(targetDate) || dailyStatsLoadingRef.current) return;

    dailyStatsLoadingRef.current = true;
    (async () => {
      try {
        const response = await matchupApi.getDailyGameStats(allPlayerIds, targetDate);
        const statsArray = response?.data || response || [];
        const statsMap = new Map<number, any>();
        if (Array.isArray(statsArray)) {
          for (const stat of statsArray) {
            if (stat.player_id) {
              statsMap.set(stat.player_id, stat);
            }
          }
        }
        setDailyStatsByDateMap(prev => {
          const newMap = new Map(prev);
          newMap.set(targetDate, statsMap);
          return newMap;
        });
      } catch (error) {
        logger.warn('[Roster] Daily game stats not available:', error);
      } finally {
        dailyStatsLoadingRef.current = false;
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, roster.starters.length, roster.bench.length, roster.ir.length]);

  // Fetch game status from schedule for players with games today
  useEffect(() => {
    const targetDate = selectedDate || getTodayMST();
    const todayStr = getTodayMST();
    // Only fetch game status for today's games (past games are always final)
    if (targetDate !== todayStr && targetDate < todayStr) {
      // Past date: all games are final
      const allPlayers = [...roster.starters, ...roster.bench, ...roster.ir];
      const statusMap = new Map<number, { status: string; score?: string }>();
      allPlayers.forEach(p => {
        const pid = typeof p.id === 'string' ? parseInt(p.id) : p.id;
        if (p.nextGame) statusMap.set(pid, { status: 'final' });
      });
      setGameStatusMap(statusMap);
      return;
    }

    // For today: use schedule data to get live game status
    const fetchGameStatus = async () => {
      try {
        const allPlayers = [...roster.starters, ...roster.bench, ...roster.ir];
        const uniqueTeams = [...new Set(allPlayers.map(p => p.teamAbbreviation || '').filter(Boolean))];
        if (uniqueTeams.length === 0) return;

        const gamesMap = await ScheduleService.getNextGamesForTeams(uniqueTeams);
        const statusMap = new Map<number, { status: string; score?: string }>();

        allPlayers.forEach(player => {
          const teamAbbrev = player.teamAbbreviation || '';
          const game = gamesMap.get(teamAbbrev);
          if (game) {
            const gameDate = game.game_date?.split('T')[0];
            if (gameDate === targetDate) {
              const status = (game.status || 'scheduled').toLowerCase();
              const homeScore = game.home_score ?? 0;
              const awayScore = game.away_score ?? 0;
              const score = (status === 'live' || status === 'intermission' || status === 'final')
                ? `${homeScore}-${awayScore}` : undefined;
              const pid = typeof player.id === 'string' ? parseInt(player.id) : player.id;
              statusMap.set(pid, { status, score });
            }
          }
        });
        setGameStatusMap(statusMap);
      } catch (error) {
        logger.warn('[Roster] Game status fetch error:', error);
      }
    };

    fetchGameStatus();
    // Refresh game status every 60 seconds for live games
    const interval = setInterval(fetchGameStatus, 60000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, roster.starters.length, roster.bench.length, roster.ir.length]);

  // =============================================================================
  // DISPLAY ROSTER - Applies projections at render time (same pattern as Matchup tab)
  // This is the SINGLE SOURCE OF TRUTH for projections in Roster tab
  // Base 'roster' state holds structure, 'displayRoster' useMemo adds projections
  // PROJECTION DATA = SOURCE OF TRUTH for "has game" detection
  // If a projection exists for a player on a date, they have a game that day
  // =============================================================================
  const displayRoster = useMemo(() => {
    const targetDate = selectedDate || getTodayMST();
    
    // Get projections for selected date ONLY (no fallback - that was causing duplicate projection display)
    const dateProjections = projectionsByDate.get(targetDate);
    const userTimezone = profile?.timezone || 'America/Denver';
    
    const dateActualStats = dailyStatsByDateMap.get(targetDate);

    const enrichPlayer = (player: HockeyPlayer): HockeyPlayer => {
      const playerId = typeof player.id === 'string' ? parseInt(player.id) : player.id;
      if (isNaN(playerId) || playerId <= 0) return player;

      // Get projection for this player on selected date
      // PROJECTION = GAME EXISTS on that date
      const projection = dateProjections?.get(playerId);
      const isGoalie = player.position === 'G' || player.position === 'Goalie';

      // Enrich with actual game stats and game status
      const actualStat = dateActualStats?.get(playerId);
      const gameInfo = gameStatusMap.get(playerId);
      
      if (!projection) {
        // No projection = no game on this date
        // Clear any existing nextGame/projection data
        return { 
          ...player, 
          nextGame: undefined,
          daily_projection: undefined,
          goalieProjection: undefined,
          projectedPoints: 0
        };
      }
      
      // Projection exists = player has game on this date
      // Build nextGame info from projection context + game status
      const gameStatus = (gameInfo?.status || player.nextGame?.gameStatus || 'scheduled') as 'scheduled' | 'live' | 'intermission' | 'final';
      const enrichedPlayer = {
        ...player,
        nextGame: {
          opponent: player.nextGame?.opponent || 'Game',
          isToday: true,
          gameTime: player.nextGame?.gameTime,
          gameStatus,
          score: gameInfo?.score,
        },
        // Actual game stats (for live/final games)
        daily_actual_points: actualStat ? Number(actualStat.total_points || actualStat.fantasy_points || 0) : undefined,
        daily_actual_stats: actualStat ? {
          goals: Number(actualStat.goals || 0),
          assists: Number(actualStat.assists || 0),
          points: Number(actualStat.points || 0),
          shots_on_goal: Number(actualStat.shots_on_goal || 0),
          blocks: Number(actualStat.blocks || 0),
          hits: Number(actualStat.hits || 0),
          ppp: Number(actualStat.ppp || 0),
          shp: Number(actualStat.shp || 0),
          pim: Number(actualStat.pim || 0),
          wins: Number(actualStat.wins || 0),
          saves: Number(actualStat.saves || 0),
          goals_against: Number(actualStat.goals_against || 0),
          shutouts: Number(actualStat.shutouts || 0),
        } : undefined,
      };

      const dailyProjectedPoints = Number(projection.total_projected_points || 0);
      
      if (isGoalie) {
        return {
          ...enrichedPlayer,
          projectedPoints: dailyProjectedPoints,
          goalieProjection: {
            total_projected_points: dailyProjectedPoints,
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
        };
      } else {
        // Skater (NOT goalie) - this includes McDavid, etc.
        return {
          ...enrichedPlayer,
          projectedPoints: dailyProjectedPoints,
          daily_projection: {
            total_projected_points: dailyProjectedPoints,
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
            // Monte Carlo uncertainty (Citrus 3.1)
            likely_low: projection.likely_low != null ? Number(projection.likely_low) : undefined,
            likely_high: projection.likely_high != null ? Number(projection.likely_high) : undefined,
            confidence_label: projection.confidence_label || undefined,
            dynamic_confidence: projection.dynamic_confidence != null ? Number(projection.dynamic_confidence) : undefined,
            projection_mean: projection.projection_mean != null ? Number(projection.projection_mean) : undefined,
            projection_std_dev: projection.projection_std_dev != null ? Number(projection.projection_std_dev) : undefined,
          }
        };
      }
    };

    return {
      starters: roster.starters.map(enrichPlayer),
      bench: roster.bench.map(enrichPlayer),
      ir: roster.ir.map(enrichPlayer),
      slotAssignments: roster.slotAssignments
    };
  }, [roster, projectionsByDate, dailyStatsByDateMap, gameStatusMap, selectedDate, profile?.timezone]);

  // Load CitrusPuck Analytics
  useEffect(() => {
    // Only load if roster is loaded and not already loaded
    if (loading || analyticsLoaded || roster.starters.length === 0) return;

    const loadAnalytics = async () => {
        try {
            // Load previous season and current season data
            const prevSeason = getCurrentSeason() - 1;
            const [dataPrev, dataCurr] = await Promise.all([
                CitrusPuckService.getAllAnalytics(prevSeason),
                CitrusPuckService.getAllAnalytics(getCurrentSeason())
            ]);

            const enrichPlayer = (p: HockeyPlayer) => {
                try {
                    // Helper to normalize names for comparison (remove accents, lowercase)
                    const normalize = (str: string) => {
                        return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
                    }

                    // Try exact match by Name first (most reliable if IDs are mixed)
                    const findByName = (map: Map<number, any>) => {
                        const targetName = normalize(p.name);
                        for (const val of map.values()) {
                            // Use loose comparison or normalization
                            if (val.name && normalize(val.name) === targetName) return val;
                        }
                        return undefined;
                    };

                    let dPrev = findByName(dataPrev);
                    let dCurr = findByName(dataCurr);

                    // If name match fails, try ID if numeric
                    if (!dPrev && !dCurr) {
                        const pId = typeof p.id === 'string' ? parseInt(p.id) : p.id;
                        if (!isNaN(pId)) {
                            dPrev = dataPrev.get(pId);
                            dCurr = dataCurr.get(pId);
                        }
                    }

                    if (!dCurr && !dPrev) return p;

                    // Rest of season projections will be loaded from player_projected_stats
                    // to match the matchup projection system exactly
                    const projections = {
                        restOfSeason: undefined // Will be populated from player_projected_stats
                    };

                    return {
                        ...p,
                        citrusPuckData: {
                            currentSeason: dCurr,
                            projections
                        }
                    };
                } catch (err) {
                    logger.error(`Error enriching player ${p.name}:`, err);
                    return p;
                }
            };

            // First enrich with season stats
            const enrichedRoster = {
                starters: roster.starters.map(enrichPlayer),
                bench: roster.bench.map(enrichPlayer),
                ir: roster.ir.map(enrichPlayer)
            };

            // Now fetch rest-of-season projections from player_projected_stats (matchup system)
            const todayStr = getTodayMST();
            
            // Get all player IDs from roster
            const allPlayerIds = [
                ...enrichedRoster.starters.map(p => {
                    const id = typeof p.id === 'string' ? parseInt(p.id) : p.id;
                    return isNaN(id) ? null : id;
                }),
                ...enrichedRoster.bench.map(p => {
                    const id = typeof p.id === 'string' ? parseInt(p.id) : p.id;
                    return isNaN(id) ? null : id;
                }),
                ...enrichedRoster.ir.map(p => {
                    const id = typeof p.id === 'string' ? parseInt(p.id) : p.id;
                    return isNaN(id) ? null : id;
                })
            ].filter((id): id is number => id !== null);

            if (allPlayerIds.length > 0) {
                // Fetch all future projections for these players (all 8 stat categories to match matchup system)
                const projResponse = await playerApi.getBatchProjections(
                  allPlayerIds.map(String),
                  { startDate: todayStr, season: getCurrentSeason() }
                );
                const projectionsData = projResponse.data as any[] | null;

                if (projectionsData) {
                    // Aggregate projections by player_id (all 8 stat categories)
                    const aggregatedProjections = new Map<number, {
                        goals: number;
                        assists: number;
                        sog: number;
                        blocks: number;
                        ppp: number;
                        shp: number;
                        hits: number;
                        pim: number;
                        total_points: number;
                    }>();

                    projectionsData.forEach((proj: any) => {
                        const playerId = Number(proj.player_id);
                        if (!aggregatedProjections.has(playerId)) {
                            aggregatedProjections.set(playerId, {
                                goals: 0,
                                assists: 0,
                                sog: 0,
                                blocks: 0,
                                ppp: 0,
                                shp: 0,
                                hits: 0,
                                pim: 0,
                                total_points: 0
                            });
                        }
                        const agg = aggregatedProjections.get(playerId)!;
                        agg.goals += Number(proj.projected_goals || 0);
                        agg.assists += Number(proj.projected_assists || 0);
                        agg.sog += Number(proj.projected_sog || 0);
                        agg.blocks += Number(proj.projected_blocks || 0);
                        agg.ppp += Number(proj.projected_ppp || 0);
                        agg.shp += Number(proj.projected_shp || 0);
                        agg.hits += Number(proj.projected_hits || 0);
                        agg.pim += Number(proj.projected_pim || 0);
                        agg.total_points += Number(proj.total_projected_points || 0);
                    });

                    // Update roster with aggregated projections
                    const enrichWithProjections = (p: HockeyPlayer) => {
                        const pId = typeof p.id === 'string' ? parseInt(p.id) : p.id;
                        if (isNaN(pId)) return p;
                        
                        const aggregated = aggregatedProjections.get(pId);
                        if (!aggregated) return p;

                        // Transform aggregated projections to match CitrusPuckPlayerData format
                        // Using all 8 stat categories from matchup projection system
                        const restOfSeasonData = {
                            I_F_goals: aggregated.goals,
                            I_F_primaryAssists: aggregated.assists * 0.6, // Estimate primary/secondary split
                            I_F_secondaryAssists: aggregated.assists * 0.4,
                            I_F_points: aggregated.goals + aggregated.assists,
                            I_F_shotsOnGoal: aggregated.sog,
                            I_F_blocks: aggregated.blocks,
                            // Include all 8 stat categories from matchup system
                            I_F_powerPlayGoals: aggregated.ppp * 0.4, // Estimate PPG/PPA split
                            I_F_powerPlayAssists: aggregated.ppp * 0.6,
                            I_F_shortHandedGoals: aggregated.shp * 0.4, // Estimate SHG/SHA split
                            I_F_shortHandedAssists: aggregated.shp * 0.6,
                            I_F_hits: aggregated.hits,
                            I_F_penaltyMinutes: aggregated.pim,
                            // Other required fields
                            I_F_plusMinus: 0, // Not projected in current system
                            games_played: 0 // Will be calculated from number of games projected
                        };

                        return {
                            ...p,
                            citrusPuckData: {
                                ...p.citrusPuckData,
                                projections: {
                                    ...p.citrusPuckData?.projections,
                                    restOfSeason: restOfSeasonData
                                }
                            }
                        };
                    };

                    // Add CitrusPuck data to roster (projections are handled by displayRoster useMemo)
                    setRoster(prevRoster => ({
                        ...prevRoster,
                        starters: prevRoster.starters.map(p => enrichWithProjections(enrichPlayer(p))) as HockeyPlayer[],
                        bench: prevRoster.bench.map(p => enrichWithProjections(enrichPlayer(p))) as HockeyPlayer[],
                        ir: prevRoster.ir.map(p => enrichWithProjections(enrichPlayer(p))) as HockeyPlayer[]
                    }));
                } else {
                    // If projections fetch fails, just use enriched roster with CitrusPuck data
                    setRoster(prevRoster => ({
                        ...prevRoster,
                        starters: prevRoster.starters.map(enrichPlayer) as HockeyPlayer[],
                        bench: prevRoster.bench.map(enrichPlayer) as HockeyPlayer[],
                        ir: prevRoster.ir.map(enrichPlayer) as HockeyPlayer[]
                    }));
                }
            } else {
                // No player IDs, just set enriched roster but preserve daily projections
                setRoster(prevRoster => ({
                    ...prevRoster,
                    starters: prevRoster.starters.map(p => {
                        const enriched = enrichPlayer(p);
                        return {
                            ...enriched,
                            projectedPoints: p.projectedPoints,
                            daily_projection: (p as any).daily_projection,
                            goalieProjection: (p as any).goalieProjection
                        };
                    }) as HockeyPlayer[],
                    bench: prevRoster.bench.map(p => {
                        const enriched = enrichPlayer(p);
                        return {
                            ...enriched,
                            projectedPoints: p.projectedPoints,
                            daily_projection: (p as any).daily_projection,
                            goalieProjection: (p as any).goalieProjection
                        };
                    }) as HockeyPlayer[],
                    ir: prevRoster.ir.map(p => {
                        const enriched = enrichPlayer(p);
                        return {
                            ...enriched,
                            projectedPoints: p.projectedPoints,
                            daily_projection: (p as any).daily_projection,
                            goalieProjection: (p as any).goalieProjection
                        };
                    }) as HockeyPlayer[]
                }));
            }
            
            setAnalyticsLoaded(true);
            toast({ title: "CitrusPuck Loaded", description: "Advanced stats and projections ready." });
        } catch (e) {
            logger.error("Failed to load analytics", e);
        }
    };
    
    loadAnalytics();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- roster arrays would cause re-renders; starters.length is sufficient trigger
  }, [loading, analyticsLoaded, roster.starters.length, toast]);

  // Update statView on players when it changes
  useEffect(() => {
    setRoster(prev => ({
        ...prev,
        starters: prev.starters.map(p => ({ ...p, statView })),
        bench: prev.bench.map(p => ({ ...p, statView })),
        ir: prev.ir.map(p => ({ ...p, statView }))
    }));
  }, [statView]);

  // Handle addPlayer query parameter (from FreeAgents when roster is full)
  useEffect(() => {
    const addPlayerId = searchParams.get('addPlayer');
    const playerName = searchParams.get('playerName');
    
    // Only open dialog if roster is loaded (not loading and has a team)
    if (addPlayerId && playerName && !loading && userTeamId) {
      setPendingAddPlayer({
        id: addPlayerId,
        name: decodeURIComponent(playerName)
      });
      setIsDropDialogOpen(true);
    }
  }, [searchParams, loading, userTeamId]);

  const handleAutoLineup = () => {
    setRoster((prev) => {
      // 1. Gather all active players (exclude IR)
      const allActivePlayers = [...prev.starters, ...prev.bench];

      // 2. Helper to sort players: Games Today > Projected Points
      const sortBestPlayers = (players: HockeyPlayer[]) => {
        return [...players].sort((a, b) => {
          if (a.nextGame?.isToday !== b.nextGame?.isToday) {
            return a.nextGame?.isToday ? -1 : 1;
          }
          return (b.projectedPoints || 0) - (a.projectedPoints || 0);
        });
      };

      // 3. Get slot caps from league settings (POSITION_SLOTS) instead of hardcoded values
      const posKeys = Object.keys(POSITION_SLOTS).filter(k => k !== 'UTIL');
      const slotCaps: Record<string, number> = {};
      for (const pos of posKeys) {
        slotCaps[pos] = POSITION_SLOTS[pos as keyof typeof POSITION_SLOTS]?.maxPlayers ?? 0;
      }
      const utilCount = POSITION_SLOTS['UTIL' as keyof typeof POSITION_SLOTS]?.maxPlayers ?? 1;

      // 4. Get all eligible positions for each player
      const getPlayerPositions = (p: HockeyPlayer): string[] => {
        if (p.eligible_positions && p.eligible_positions.length > 0) {
          return [...new Set(p.eligible_positions.map(ep => getFantasyPosition(ep, leaguePositionType)))];
        }
        return [getFantasyPosition(p.position, leaguePositionType)];
      };

      // 5. Group by fantasy position (players appear in ALL eligible groups)
      const grouped: Record<string, HockeyPlayer[]> = {};
      for (const k of posKeys) grouped[k] = [];

      allActivePlayers.forEach(p => {
        const positions = getPlayerPositions(p);
        for (const pos of positions) {
          if (pos !== 'UTIL' && grouped[pos]) {
            grouped[pos].push(p);
          }
        }
      });

      // Sort each group by projected points
      for (const key of Object.keys(grouped)) {
        grouped[key] = sortBestPlayers(grouped[key]);
      }

      // 6. Assign slots using two-pass approach
      const newAssignments: Record<string, string> = {};
      const newStarters: HockeyPlayer[] = [];
      const newBench: HockeyPlayer[] = [];
      const assignedIds = new Set<string | number>();

      const assignToSlots = (players: HockeyPlayer[], slotPrefix: string, count: number) => {
        let filled = 0;
        for (const p of players) {
          if (filled >= count || assignedIds.has(p.id)) continue;
          const slotId = `${slotPrefix}-${filled + 1}`;
          newAssignments[p.id] = slotId;
          newStarters.push({ ...p, starter: true });
          assignedIds.add(p.id);
          filled++;
        }
      };

      // First pass: assign primary position players
      for (const pos of posKeys) {
        assignToSlots(grouped[pos], `slot-${pos}`, slotCaps[pos] || 0);
      }

      // Second pass: fill empty position slots with multi-position eligible players
      for (const pos of posKeys) {
        const filled = Object.values(newAssignments).filter(s => s.startsWith(`slot-${pos}-`)).length;
        if (filled >= (slotCaps[pos] || 0)) continue;
        const candidates = sortBestPlayers(allActivePlayers.filter(p => {
          if (assignedIds.has(p.id)) return false;
          return getPlayerPositions(p).includes(pos);
        }));
        let slotIdx = filled;
        for (const p of candidates) {
          if (slotIdx >= (slotCaps[pos] || 0)) break;
          newAssignments[p.id] = `slot-${pos}-${slotIdx + 1}`;
          newStarters.push({ ...p, starter: true });
          assignedIds.add(p.id);
          slotIdx++;
        }
      }

      // 7. Handle UTIL Slots (support multiple UTIL slots from league settings)
      const utilCandidates = sortBestPlayers(
        allActivePlayers.filter(p => !assignedIds.has(p.id) && getFantasyPosition(p.position, leaguePositionType) !== 'G')
      );
      for (let i = 0; i < utilCount; i++) {
        const utilPlayer = utilCandidates[i];
        if (!utilPlayer) break;
        const slotId = utilCount === 1 ? 'slot-UTIL' : `slot-UTIL-${i + 1}`;
        newAssignments[utilPlayer.id] = slotId;
        newStarters.push({ ...utilPlayer, starter: true });
        assignedIds.add(utilPlayer.id);
      }

      // 8. Remaining go to Bench
      allActivePlayers.filter(p => !assignedIds.has(p.id)).forEach(p => {
        newBench.push({ ...p, starter: false });
      });

      const updatedRoster = {
        ...prev,
        starters: newStarters,
        bench: newBench,
        slotAssignments: newAssignments
      };

      // Save lineup to Supabase (only for logged-in users, not demo league)
      if (userTeamId && user && userTeam?.league_id && !isDemoLeague(userTeam.league_id)) {
        LeagueService.saveLineup(userTeamId, userTeam.league_id, {
          starters: newStarters.map(p => String(p.id)),
          bench: newBench.map(p => String(p.id)),
          ir: prev.ir.map(p => String(p.id)),
          slotAssignments: newAssignments
        }, selectedDate || getTodayMST()).catch(err => {
          logger.error('Failed to save auto lineup:', err);
          toast({ title: 'Save Failed', description: 'Lineup optimized locally but failed to save. Try again.', variant: 'destructive' });
        });
      }

      return updatedRoster;
    });

    toast({
      title: "Lineup Optimized",
      description: "Best players set based on today's games and projections.",
    });
  };

  // Get active player being dragged
  const activePlayer = useMemo(() => {
    if (!activeId) return null;
    return [...roster.starters, ...roster.bench, ...roster.ir].find(p => p.id === activeId) || null;
  }, [activeId, roster]);

  const handlePlayerClick = useCallback(async (player: HockeyPlayer) => {
    // Fetch fresh season stats using unified helper (same as Matchup and FreeAgents tabs)
    const playerWithStats = await getPlayerWithSeasonStats(player.id);
    if (playerWithStats) {
      setSelectedPlayer(playerWithStats);
      setIsPlayerDialogOpen(true);
    } else {
      // Fallback to using the player data we already have
      setSelectedPlayer(player);
      setIsPlayerDialogOpen(true);
      toast({
        title: "Warning",
        description: "Could not fetch updated stats. Showing cached data.",
        variant: "default"
      });
    }
  }, [toast]);

  // Validate roster state - check if any player in IR slot has returned to ACT status
  const validateRosterState = (currentRoster: RosterState): { isValid: boolean; invalidPlayers: HockeyPlayer[] } => {
    const invalidPlayers: HockeyPlayer[] = [];
    
    // Check all players in IR slots
    for (const irPlayer of currentRoster.ir) {
      // If player has roster_status === 'ACT' but is still in IR slot, roster is invalid
      if (irPlayer.roster_status === 'ACT' || !irPlayer.is_ir_eligible) {
        invalidPlayers.push(irPlayer);
      }
    }
    
    return {
      isValid: invalidPlayers.length === 0,
      invalidPlayers
    };
  };

  // Position validation — uses eligible_positions for multi-position support
  const isPositionValid = (player: HockeyPlayer, targetSlot: string): boolean => {
    if (targetSlot === 'bench-grid') return true;

    if (targetSlot.startsWith('ir-slot-')) {
      // Only allow players with is_ir_eligible = true (official NHL IR/LTIR status)
      if (!player.is_ir_eligible) {
        return false;
      }
      return true;
    }

    let slotPosition: string | null = null;

    if (targetSlot === 'slot-UTIL') {
      slotPosition = 'UTIL';
    } else if (targetSlot.startsWith('slot-')) {
       const parts = targetSlot.split('-');
       if (parts.length >= 2) {
         slotPosition = parts[1];
       }
    }

    if (!slotPosition) return false;

    // Build the set of positions this player is eligible for (respects F/D/G mode)
    const eligiblePositions = (player.eligible_positions && player.eligible_positions.length > 0)
      ? player.eligible_positions.map(p => getFantasyPosition(p, leaguePositionType))
      : [getFantasyPosition(player.position, leaguePositionType)];

    const isGoalie = eligiblePositions.includes('G');

    if (slotPosition === 'UTIL') {
      return !isGoalie;
    }

    if (isGoalie && !eligiblePositions.some(p => p !== 'G')) {
      return slotPosition === 'G';
    }

    if (slotPosition === 'G') {
      return isGoalie;
    }

    return eligiblePositions.includes(slotPosition);
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string | number);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    // Best Ball guard: lineups are auto-optimized, no manual changes
    if (bestBallEnabled) {
      toast({
        title: "Best Ball League",
        description: "Lineups are automatically optimized each day. No manual changes needed!",
        variant: "default",
      });
      return;
    }

    // Read-only guard: Block drag-and-drop for guests and demo league
    if (userLeagueState === 'guest' || userLeagueState === 'logged-in-no-league') {
      toast({
        title: "Demo League",
        description: "Sign up to create your own league and make lineup changes!",
        variant: "default",
      });
      return;
    }

    // Also block for demo league (backup check)
    if (userTeam && isDemoLeague(userTeam.league_id)) {
      toast({
        title: "Demo League - Read Only",
        description: "Sign up to create your own league and make changes!",
        variant: "default",
      });
      return;
    }

    if (!over) return;

    const playerId = active.id as string | number;
    const targetId = over.id as string; 

    // Check if viewing a past date - prevent all edits
    if (selectedDate) {
      const todayStr = getTodayMST();
      if (selectedDate < todayStr) {
        toast({
          title: "Cannot Edit Past Dates",
          description: "Cannot edit past dates. Select a future date to make changes.",
          variant: "destructive",
          duration: 5000
        });
        return;
      }
    }

    const allPlayers = [...roster.starters, ...roster.bench, ...roster.ir];
    const player = allPlayers.find(p => p.id === playerId);
    
    if (!player) return;

    // Check if player is locked (game has started)
    if (lockedPlayerIds.has(String(playerId))) {
      toast({
        title: "Player Locked",
        description: `${player.name}'s game has started. Players cannot be moved once their game begins.`,
        variant: "destructive",
      });
      return;
    }

    // Identify if dropping onto a player or an empty slot
    const droppedOnPlayer = allPlayers.find(p => p.id === targetId); 
    
    let finalTargetSlotId = targetId;

    // Check if dropping on an IR slot directly
    if (targetId.startsWith('ir-slot-')) {
      finalTargetSlotId = targetId;
    } else if (droppedOnPlayer) {
       // If dropped on a player, find their slot
       if (roster.bench.some(p => p.id === droppedOnPlayer.id)) finalTargetSlotId = 'bench-grid';
       else if (roster.ir.some(p => p.id === droppedOnPlayer.id)) {
         // Find which IR slot they're in
         finalTargetSlotId = roster.slotAssignments[droppedOnPlayer.id] || 'ir-slot-1';
       }
       else finalTargetSlotId = roster.slotAssignments[droppedOnPlayer.id] || 'slot-UTIL';
    }

    const isCurrentlyStarter = roster.starters.some(p => p.id === playerId);
    const isCurrentlyBench = roster.bench.some(p => p.id === playerId);
    const isDroppingOnBench = finalTargetSlotId === 'bench-grid';
    const isDroppingOnBenchPlayer = droppedOnPlayer && roster.bench.some(p => p.id === droppedOnPlayer.id);
    
    // Handle bench-to-bench reordering
    if (isCurrentlyBench && isDroppingOnBench && isDroppingOnBenchPlayer && droppedOnPlayer.id !== playerId) {
      setRoster(prev => {
        const benchIds = prev.bench.map(p => p.id);
        const oldIndex = benchIds.indexOf(playerId);
        const newIndex = benchIds.indexOf(droppedOnPlayer.id);
        
        if (oldIndex !== -1 && newIndex !== -1) {
          const newBench = arrayMove(prev.bench, oldIndex, newIndex);
          const updatedRoster = { ...prev, bench: newBench };
          
          // Save lineup to Supabase (only for logged-in users, not demo league)
          // Yahoo-style: If selectedDate is set, only save to that date; otherwise cascade
          if (userTeamId && user && userTeam?.league_id && !isDemoLeague(userTeam.league_id)) {
            LeagueService.saveLineup(userTeamId, userTeam.league_id, {
              starters: prev.starters.map(p => p.id),
              bench: newBench.map(p => p.id),
              ir: prev.ir.map(p => p.id),
              slotAssignments: prev.slotAssignments
            }, selectedDate || getTodayMST()).catch(err => logger.error('Failed to save lineup:', err));
          }
          
          return updatedRoster;
        }
        
        return prev;
      });
      toast({ title: "Bench Reordered", description: "Player position updated." });
      return;
    }
    
    // Handle reordering when dropping on bench-grid directly (not on a player)
    if (isCurrentlyBench && isDroppingOnBench && !isDroppingOnBenchPlayer) {
      // Already in bench, no change needed
      return;
    }
    
    // Check if we are just dropping in the same place (but not reordering)
    if (isCurrentlyStarter && roster.slotAssignments[player.id] === finalTargetSlotId) return;
    if (isCurrentlyBench && isDroppingOnBench && !isDroppingOnBenchPlayer) return;

    if (!isPositionValid(player, finalTargetSlotId)) {
        if (finalTargetSlotId.startsWith('ir-slot-')) {
          toast({ title: "Invalid Move", description: "Only players with official IR/LTIR status can be placed in IR slots.", variant: "destructive" });
        } else {
          toast({ title: "Invalid Position", description: "Player cannot play in this position.", variant: "destructive" });
        }
        return;
    }

    setRoster(prev => {
        const newStarters = [...prev.starters];
        const newBench = [...prev.bench];
        const newIR = [...prev.ir];
        const newAssignments = { ...prev.slotAssignments };

        // Remove player from old location
        const removeFromCurrent = (pId: string | number) => {
            const sIdx = newStarters.findIndex(p => p.id === pId);
            if (sIdx >= 0) { 
                newStarters.splice(sIdx, 1); 
                delete newAssignments[pId]; 
                return { loc: 'starter' }; 
            }
            const bIdx = newBench.findIndex(p => p.id === pId);
            if (bIdx >= 0) { 
                newBench.splice(bIdx, 1); 
                return { loc: 'bench' }; 
            }
            const iIdx = newIR.findIndex(p => p.id === pId);
            if (iIdx >= 0) { 
                newIR.splice(iIdx, 1);
                delete newAssignments[pId];
                return { loc: 'ir' }; 
            }
            return null;
        };

        // 1. Remove Active Player
        const sourceInfo = removeFromCurrent(player.id);
        
        // 2. Check if target slot is occupied
        let occupantId: string | number | undefined;
        if (finalTargetSlotId.startsWith('slot-') || finalTargetSlotId.startsWith('ir-slot-')) {
            const foundId = Object.keys(newAssignments).find(id => newAssignments[id] === finalTargetSlotId);
            if (foundId) {
              // Try to cast back to number if possible to match original ID type, though string is safe for keys
              // Since ID can be string or number, simple retrieval is safest
              occupantId = foundId; 
            }
        }

        // 3. If occupied, remove the occupant (Swap)
        let occupantSourceInfo = null;
        if (occupantId) {
            occupantSourceInfo = removeFromCurrent(occupantId);
        }

        // 4. Place Active Player into Target Slot
        const p = { ...player };
        if (finalTargetSlotId === 'bench-grid') {
            p.starter = false; p.status = (p.status === 'IR' || p.status === 'SUSP') ? p.status : null; newBench.push(p);
        } else if (finalTargetSlotId.startsWith('ir-slot-')) {
            p.starter = false; 
            // Don't change status - player must already be IR or SUSP to get here
            newIR.push(p);
            newAssignments[p.id] = finalTargetSlotId;
        } else {
            p.starter = true; p.status = (p.status === 'IR' || p.status === 'SUSP') ? p.status : null; newStarters.push(p);
            newAssignments[p.id] = finalTargetSlotId; 
        }

        // 5. If we swapped, put the occupant where the active player came from
        if (occupantId && occupantSourceInfo) {
            // Find the original object reference from closure or re-find in 'allPlayers' isn't quite right because we need the object.
            // But we removed it from newStarters/Bench/IR. We can find it in 'allPlayers' which is unchanged.
            const occupant = allPlayers.find(x => String(x.id) === String(occupantId));
            if (!occupant) {
              logger.error('[Roster] Swap failed: occupant not found in allPlayers', occupantId);
              return prev;
            }
            const p2 = { ...occupant };
            
            // Determine where to put the swapped player
            let swapBackTarget = 'bench-grid';
            
            // Logic: try to put them back where source came from
            if (sourceInfo?.loc === 'bench') swapBackTarget = 'bench-grid';
            else if (sourceInfo?.loc === 'ir') {
              // Find the original IR slot from previous assignments
              const originalSlot = prev.slotAssignments[player.id];
              if (originalSlot && originalSlot.startsWith('ir-slot-')) {
                swapBackTarget = originalSlot;
              } else {
                // Find first available IR slot
                const usedSlots = Object.values(newAssignments).filter(s => s.startsWith('ir-slot-'));
                if (usedSlots.length < 3) {
                  for (let i = 1; i <= 3; i++) {
                    if (!usedSlots.includes(`ir-slot-${i}`)) {
                      swapBackTarget = `ir-slot-${i}`;
                      break;
                    }
                  }
                } else {
                  swapBackTarget = 'bench-grid';
                }
              }
            }
            else if (sourceInfo?.loc === 'starter') {
               // We don't have the original slot assignment easily available since we deleted it from newAssignments
               // But we can look at 'prev.slotAssignments'
               const originalSlot = prev.slotAssignments[player.id];
               if (originalSlot) swapBackTarget = originalSlot;
            }

            if (!isPositionValid(p2, swapBackTarget)) {
                swapBackTarget = 'bench-grid';
            }

            if (swapBackTarget === 'bench-grid') {
                p2.starter = false; newBench.push(p2);
            } else if (swapBackTarget.startsWith('ir-slot-')) {
                p2.starter = false; 
                // Don't change status - player must already be IR or SUSP to get here
                newIR.push(p2);
                newAssignments[p2.id] = swapBackTarget;
            } else {
                p2.starter = true; newStarters.push(p2);
                newAssignments[p2.id] = swapBackTarget;
            }
        }

        const updatedRoster = { starters: newStarters, bench: newBench, ir: newIR, slotAssignments: newAssignments };
        
        // Validate roster state - check if any IR players have returned to ACT
        const validation = validateRosterState(updatedRoster);
        if (!validation.isValid) {
          const invalidNames = validation.invalidPlayers.map(p => p.name).join(', ');
          toast({
            title: "Invalid Roster State",
            description: `The following players are in IR slots but have returned to active status: ${invalidNames}. Please move them to active slots.`,
            variant: "destructive",
            duration: 10000 // Show for 10 seconds
          });
        }
        
        // Save lineup to Supabase (only for logged-in users, not demo league)
        if (userTeamId && user && userTeam?.league_id && !isDemoLeague(userTeam.league_id)) {
          // Validate selected date - prevent saving to past dates
          if (selectedDate) {
            const todayStr = getTodayMST();
            if (selectedDate < todayStr) {
              toast({
                title: "Cannot Edit Past Dates",
                description: "Cannot edit past dates. Select a future date to make changes.",
                variant: "destructive",
                duration: 5000
              });
              return updatedRoster; // Don't save, return updated roster for UI
            }
          }

          const lineupToSave = {
            starters: newStarters.map(p => p.id),
            bench: newBench.map(p => p.id),
            ir: newIR.map(p => p.id),
            slotAssignments: newAssignments
          };
          // Yahoo-style: Always save to a specific date (never fall through to base team_lineups)
          // State is already updated optimistically via setRoster above.
          // Do NOT call loadRoster in .then() — it captures a stale selectedDate
          // from the closure and races with date-switch reloads.
          LeagueService.saveLineup(userTeamId, userTeam.league_id, lineupToSave, selectedDate || getTodayMST())
            .catch(err => {
              logger.error('[Roster] Failed to save lineup:', err);
            });
        }
        
        return updatedRoster;
    });
    
    toast({ title: "Lineup Updated", description: "Player moved successfully." });
  };

  // Mobile detection for tap-to-swap
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // All known starter slot IDs for tap-to-swap eligibility calculation (dynamic based on position type)
  const ALL_STARTER_SLOT_IDS = useMemo(() => {
    const slots: string[] = [];
    const posKeys = leaguePositionType === 'forward'
      ? [{ pos: 'F', count: 6 }, { pos: 'D', count: 4 }, { pos: 'G', count: 2 }]
      : [{ pos: 'C', count: 2 }, { pos: 'LW', count: 2 }, { pos: 'RW', count: 2 }, { pos: 'D', count: 4 }, { pos: 'G', count: 2 }];
    for (const { pos, count } of posKeys) {
      for (let i = 1; i <= count; i++) slots.push(`slot-${pos}-${i}`);
    }
    slots.push('slot-UTIL');
    return slots;
  }, [leaguePositionType]);

  // Compute which slots the tap-selected player can move to
  const tapEligibleSlots = useMemo(() => {
    if (!tapSelectedPlayerId) return new Set<string>();
    const allPlayers = [...roster.starters, ...roster.bench, ...roster.ir];
    const player = allPlayers.find(p => p.id === tapSelectedPlayerId);
    if (!player) return new Set<string>();

    const eligible = new Set<string>();
    for (const slotId of ALL_STARTER_SLOT_IDS) {
      if (isPositionValid(player, slotId)) {
        eligible.add(slotId);
      }
    }
    // Bench is always a valid target
    eligible.add('bench-grid');
    return eligible;
  }, [tapSelectedPlayerId, roster, ALL_STARTER_SLOT_IDS, isPositionValid]);

  // Handle mobile tap-to-swap: player tapped
  const handleMobileTapPlayer = (player: HockeyPlayer) => {
    // Read-only guards
    if (userLeagueState === 'guest' || userLeagueState === 'logged-in-no-league') {
      toast({ title: "Demo League", description: "Sign up to create your own league and make lineup changes!", variant: "default" });
      return;
    }
    if (userTeam && isDemoLeague(userTeam.league_id)) {
      toast({ title: "Demo League - Read Only", description: "Sign up to create your own league and make changes!", variant: "default" });
      return;
    }
    if (lockedPlayerIds.has(String(player.id))) {
      toast({ title: "Player Locked", description: `${player.name}'s game has started. Players cannot be moved once their game begins.`, variant: "destructive" });
      return;
    }
    // Block edits on past dates
    if (selectedDate) {
      const todayStr = getTodayMST();
      if (selectedDate < todayStr) {
        toast({ title: "Cannot Edit Past Dates", description: "Rosters for past dates are frozen and cannot be changed.", variant: "destructive" });
        return;
      }
    }

    // If no player selected, select this one
    if (!tapSelectedPlayerId) {
      setTapSelectedPlayerId(player.id);
      return;
    }

    // If same player tapped, deselect
    if (tapSelectedPlayerId === player.id) {
      setTapSelectedPlayerId(null);
      return;
    }

    // Another player tapped - attempt swap between them
    const allPlayers = [...roster.starters, ...roster.bench, ...roster.ir];
    const sourcePlayer = allPlayers.find(p => p.id === tapSelectedPlayerId);
    if (!sourcePlayer) {
      setTapSelectedPlayerId(player.id);
      return;
    }

    // Find the target player's current slot
    let targetSlotId: string;
    if (roster.bench.some(p => p.id === player.id)) {
      targetSlotId = 'bench-grid';
    } else if (roster.ir.some(p => p.id === player.id)) {
      targetSlotId = roster.slotAssignments[player.id] || 'ir-slot-1';
    } else {
      targetSlotId = roster.slotAssignments[player.id] || 'slot-UTIL';
    }

    // Validate the source player can go to that slot
    if (!tapEligibleSlots.has(targetSlotId)) {
      toast({ title: "Invalid Position", description: "Player cannot be placed in that position.", variant: "destructive" });
      setTapSelectedPlayerId(player.id); // Switch selection to the tapped player
      return;
    }

    // Perform the swap by simulating a drag end event
    handleDragEnd({
      active: { id: sourcePlayer.id, data: { current: {} }, rect: { current: { initial: null, translated: null } } },
      over: { id: player.id, data: { current: {} }, rect: { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 } },
      activatorEvent: new Event('tap'),
      collisions: [],
      delta: { x: 0, y: 0 },
    } as any);

    setTapSelectedPlayerId(null);
  };

  // Handle mobile tap-to-swap: empty slot tapped
  const handleMobileTapSlot = (slotId: string) => {
    if (!tapSelectedPlayerId) return;
    const allPlayers = [...roster.starters, ...roster.bench, ...roster.ir];
    const sourcePlayer = allPlayers.find(p => p.id === tapSelectedPlayerId);
    if (!sourcePlayer) { setTapSelectedPlayerId(null); return; }

    // Simulate drag end to the slot
    handleDragEnd({
      active: { id: sourcePlayer.id, data: { current: {} }, rect: { current: { initial: null, translated: null } } },
      over: { id: slotId, data: { current: { type: 'starter-slot' } }, rect: { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 } },
      activatorEvent: new Event('tap'),
      collisions: [],
      delta: { x: 0, y: 0 },
    } as any);

    setTapSelectedPlayerId(null);
  };

  // Handle mobile tap-to-swap: bench tapped (move selected player to bench)
  const handleMobileTapBench = () => {
    if (!tapSelectedPlayerId) return;
    handleMobileTapSlot('bench-grid');
  };

  // Combined player click handler: mobile uses tap-to-swap, desktop opens stats
  const handlePlayerClickWithSwap = (player: HockeyPlayer) => {
    if (isMobile) {
      handleMobileTapPlayer(player);
    } else {
      handlePlayerClick(player);
    }
  };

  // Determine if we should show a loading overlay (but don't unmount the component)
  const showLoadingOverlay = isChangingLeague || (leagueLoading && userLeagueState === 'active-user');

  // Redirect pool leagues to their pool page
  const _leagueType = activeLeagueFormat?.leagueType;
  if (isPoolLeague(_leagueType) && activeLeagueId) {
    return <Navigate to={getPoolRoute(_leagueType!, activeLeagueId)} replace />;
  }

  return (
    <div className="min-h-screen bg-[#0F1F15] text-pastel-cream relative">
      {/* Loading overlay during league switch - non-blocking */}
      {showLoadingOverlay && (
        <div className="fixed inset-0 bg-[#0F1F15]/90 backdrop-blur-lg z-[100] flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-pastel-orange mx-auto mb-4"></div>
            <p className="text-lg font-medium text-pastel-cream">Switching leagues…</p>
          </div>
        </div>
      )}

      {/* Desktop Navbar - Hidden on mobile */}
      <div className="hidden lg:block">
        <Navbar />
      </div>
      
      {/* MOBILE: Compact sticky header with roster context + hamburger menu */}
      <div className="lg:hidden sticky top-0 z-40 bg-[#0F1F15]/95 backdrop-blur-xl border-b border-white/10 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-between h-12 px-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-calistoga font-bold text-pastel-cream truncate">
              {userLeagueState === 'guest' ? 'Citrus Crushers' : (userTeam?.team_name || 'My Roster')}
            </h1>
            {activeLeague?.name && (
              <div className="text-xs font-jbmono text-white/55 truncate -mt-0.5">
                {activeLeague.name}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0 ml-2">
            <span className="text-xs font-calistoga font-bold text-pastel-orange-soft">
              {teamStats.record}
            </span>
            <MobileMenuButton />
          </div>
        </div>
      </div>
      
      {/* MOBILE: Full-screen scrollable content / DESKTOP: Grid layout */}
      <main className="w-full lg:pt-24 lg:pb-8 pb-[calc(5rem+env(safe-area-inset-bottom))]">
        <div className="w-full m-0 p-0">
          {/* Desktop: 3-column grid / Mobile: Single column */}
          <div className={cn(
            "flex flex-col lg:grid lg:gap-4 xl:gap-6 lg:px-4 xl:px-6 lg:mx-0 lg:w-screen lg:relative lg:left-1/2 lg:-translate-x-1/2",
            userLeagueState === 'active-user' && userTeam?.league_id
              ? "lg:grid-cols-[260px_1fr_260px] xl:grid-cols-[280px_1fr_280px]"
              : "lg:grid-cols-[260px_1fr] xl:grid-cols-[280px_1fr]"
          )}>
            {/* Main Content - MOBILE: Full width / DESKTOP: Scrollable panel */}
            <div className="min-w-0 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto px-3 lg:px-0 order-1 lg:order-2">
              {/* Fantasy Team Header — Citrus 2.0 dark surface */}
              <div className="bg-[#1A2A20] ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)] p-5 mb-4 relative overflow-hidden">
                <div className="flex flex-col md:flex-row justify-between items-center gap-4 relative z-10">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-pastel-orange to-pastel-orange-soft ring-1 ring-pastel-orange/40 flex items-center justify-center text-[#0F1F15] text-2xl font-calistoga relative overflow-hidden shadow-[0_8px_24px_-8px_rgba(255,168,87,0.5)]">
                  {/* Background pattern */}
                  <div className="absolute inset-0 opacity-20">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,_rgba(255,255,255,0.4)_0%,_transparent_60%)]"></div>
                  </div>
                  <span className="relative z-10">
                    {userLeagueState === 'guest' ? 'CC' : (userTeam?.team_name?.substring(0, 2).toUpperCase() || profile?.username?.substring(0, 2).toUpperCase() || 'TM')}
                  </span>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="text-2xl font-calistoga text-pastel-cream">
                      {userLeagueState === 'guest' ? 'Citrus Crushers' : (userTeam?.team_name || 'My Team')}
                    </h1>
                  </div>
                  <div className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-orange-soft font-bold">
                    {/* SWEEP FIX (2026-08-16): prefer display_name; never show
                        the generated user_<id> signup handle. */}
                    Manager · {userLeagueState === 'guest'
                      ? 'Demo Team'
                      : (profile?.display_name
                          || (profile?.username && !/^user_[0-9a-f]{6,}$/i.test(profile.username) ? profile.username : null)
                          || 'You')}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-center px-4 py-2">
                  <div className="font-jbmono text-[9px] tracking-[0.22em] uppercase text-white/55 font-bold">Record</div>
                  <div className="font-calistoga text-pastel-cream tabular-nums">{teamStats.record}</div>
                </div>
                <div className="text-center px-4 py-2">
                  <div className="font-jbmono text-[9px] tracking-[0.22em] uppercase text-white/55 font-bold">Rank</div>
                  <div className="font-calistoga text-pastel-cream tabular-nums">{teamStats.rank}</div>
                </div>
                <div className="text-center px-4 py-2">
                  <div className="font-jbmono text-[9px] tracking-[0.22em] uppercase text-white/55 font-bold">Total Pts</div>
                  <div className="font-calistoga text-pastel-orange tabular-nums">{teamStats.totalPoints}</div>
                </div>
              </div>

              <div>
                {userLeagueState === 'active-user' && (
                  <Button
                    onClick={handleAutoLineup}
                    variant="outline"
                    className="flex gap-2 bg-pastel-orange/10 border-pastel-orange/40 text-pastel-orange-soft hover:bg-pastel-orange/20 hover:border-pastel-orange/60 font-bold"
                  >
                    <Wand2 className="w-4 h-4" aria-hidden="true" />
                    Auto Lineup
                  </Button>
                )}
                </div>
              </div>
            </div>

            {/* Main Tabs — Citrus 2.0 dark */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
              <div className="bg-[#1A2A20] ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)] overflow-hidden">
                <TabsList className="w-full p-0 bg-transparent border-b border-white/10 rounded-none gap-0 h-auto">
                <TabsTrigger
                  value="roster"
                  className="flex-1 py-4 rounded-none font-jbmono text-[11px] tracking-[0.22em] uppercase font-bold text-white/55 data-[state=active]:bg-pastel-orange/10 data-[state=active]:border-b-2 data-[state=active]:border-pastel-orange data-[state=active]:text-pastel-orange-soft hover:text-pastel-cream transition-colors"
                >
                  Roster
                </TabsTrigger>
                <TabsTrigger
                  value="stats"
                  className="flex-1 py-4 rounded-none font-jbmono text-[11px] tracking-[0.22em] uppercase font-bold text-white/55 data-[state=active]:bg-pastel-orange/10 data-[state=active]:border-b-2 data-[state=active]:border-pastel-orange data-[state=active]:text-pastel-orange-soft hover:text-pastel-cream transition-colors"
                >
                  Team Stats
                </TabsTrigger>
                <TabsTrigger
                  value="trends"
                  className="flex-1 py-4 rounded-none font-jbmono text-[11px] tracking-[0.22em] uppercase font-bold text-white/55 data-[state=active]:bg-pastel-orange/10 data-[state=active]:border-b-2 data-[state=active]:border-pastel-orange data-[state=active]:text-pastel-orange-soft hover:text-pastel-cream transition-colors"
                >
                  Trends &amp; Analytics
                </TabsTrigger>
                <TabsTrigger
                  value="transactions"
                  className="flex-1 py-4 rounded-none font-jbmono text-[11px] tracking-[0.22em] uppercase font-bold text-white/55 data-[state=active]:bg-pastel-orange/10 data-[state=active]:border-b-2 data-[state=active]:border-pastel-orange data-[state=active]:text-pastel-orange-soft hover:text-pastel-cream transition-colors"
                >
                  Transactions
                </TabsTrigger>
                </TabsList>

                <TabsContent value="roster" className="m-0 p-6">
                {/* Read-only banner for demo/guest users */}
                {(userLeagueState === 'guest' || userLeagueState === 'logged-in-no-league' || (userTeam && isDemoLeague(userTeam.league_id))) && (
                  <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                    <div className="flex items-center gap-2 text-yellow-400">
                      <Shield className="w-4 h-4" aria-hidden="true" />
                      <span className="text-sm font-medium">Demo Mode - Read Only</span>
                    </div>
                    <p className="text-xs text-yellow-400/80 mt-1">
                      Sign up to create your own league and make lineup changes!
                    </p>
                  </div>
                )}

                {/* Week and Date Selectors */}
                {userTeam?.league_id && availableWeeks.length > 0 && firstWeekStart && selectedWeek > 0 && (
                  <div className="mb-6 space-y-4">
                    {/* Week Selector */}
                    <MatchupScheduleSelector
                      currentWeek={selectedWeek}
                      scheduleLength={availableWeeks.length}
                      availableWeeks={availableWeeks}
                      onWeekChange={handleWeekChange}
                      firstWeekStart={firstWeekStart}
                    />

                    {/* Date Selector */}
                    {currentMatchup && matchupWeekDates.length > 0 && (
                      <div className="bg-[#1A2A20] ring-1 ring-white/10 rounded-2xl p-4">
                        <WeeklySchedule
                          weekStart={currentMatchup.week_start_date}
                          weekEnd={currentMatchup.week_end_date}
                          myStarters={[]}
                          opponentStarters={[]}
                          onDayClick={(date) => {
                            setSelectedDate(date);
                            // loadRoster is triggered automatically by the useEffect
                            // that depends on selectedDate (via useCallback dep chain).
                            // Do NOT call loadRoster here — it would use the stale
                            // selectedDate from the current closure, causing a race
                            // condition with the useEffect-triggered reload.
                          }}
                          selectedDate={selectedDate}
                          dailyStatsByDate={new Map()}
                          hideScores={true}
                        />
                        {selectedDate && (
                          <div className="mt-3 text-sm text-white/55">
                            <span className="font-medium">Viewing:</span> {(() => {
                              // Parse date manually to avoid timezone issues
                              const [year, month, day] = selectedDate.split('-').map(Number);
                              const date = new Date(year, month - 1, day);
                              return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                            })()}
                            {selectedDate < getTodayMST() && (
                              <Badge variant="outline" className="ml-2">
                                <Lock className="w-3 h-3 mr-1" aria-hidden="true" />
                                Read Only
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {!currentMatchup && selectedWeek && (
                      <div className="bg-white/5 rounded-lg border p-4 text-center text-sm text-white/55">
                        No matchup found for Week {selectedWeek}
                      </div>
                    )}
                  </div>
                )}
                
                {/* Locked players banner */}
                {lockedPlayerIds.size > 0 && (userLeagueState === 'active-user' && !(userTeam && isDemoLeague(userTeam.league_id))) && (
                  <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                    <div className="flex items-center gap-2 text-blue-400">
                      <Lock className="w-4 h-4" aria-hidden="true" />
                      <span className="text-sm font-medium">
                        {lockedPlayerIds.size} player{lockedPlayerIds.size !== 1 ? 's' : ''} locked
                      </span>
                    </div>
                    <p className="text-xs text-blue-400/80 mt-1">
                      Players whose games have started cannot be moved. Locked players are marked with a lock icon.
                    </p>
                  </div>
                )}
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold">Lineup</h2>
                    <ToggleGroup type="single" value={statView} onValueChange={(v) => v && setStatView(v as any)} className="bg-white/5 p-1 rounded-lg">
                        <ToggleGroupItem value="seasonToDate" size="sm" className="text-xs">Season</ToggleGroupItem>
                        <ToggleGroupItem value="restOfSeason" size="sm" className="text-xs">Rest of Season</ToggleGroupItem>
                    </ToggleGroup>
                </div>

                {(() => {
                  // Apply minimum display time to prevent flash
                  if (rosterDisplayLoading) {
                    return <StormyLoading message="Loading your roster…" />;
                  }
                  
                  if (userLeagueState === 'logged-in-no-league') {
                    return (
                      <div className="py-8">
                        <LeagueCreationCTA 
                          title="Your Roster Awaits"
                          description="Create your league to start building your roster, making trades, and competing with friends."
                        />
                      </div>
                    );
                  }
                  
                  if (!userTeamId && userLeagueState === 'active-user') {
                    return (
                      <div className="flex flex-col items-center justify-center py-20 text-center">
                        <Trophy className="w-16 h-16 text-white/55 mb-4 opacity-50" aria-hidden="true" />
                        <h3 className="text-xl font-semibold mb-2">No Team Yet</h3>
                        <p className="text-white/55 mb-4">Join or create a league to start building your roster.</p>
                        <Button asChild>
                          <a href="/create-league">Create or Join a League</a>
                        </Button>
                      </div>
                    );
                  }
                  
                  if (roster.starters.length === 0 && roster.bench.length === 0 && userLeagueState !== 'guest') {
                    // Check if draft is not completed
                    const isPreDraft = userTeam && userTeam.league_id;
                    return (
                      <div className="flex flex-col items-center justify-center py-20 text-center">
                        <Users className="w-16 h-16 text-white/55 mb-4 opacity-50" aria-hidden="true" />
                        <h3 className="text-xl font-semibold mb-2">Empty Roster</h3>
                        <p className="text-white/55 mb-4">
                          {isPreDraft 
                            ? "Your roster will be populated after the draft is completed. Head to the draft room to start drafting!"
                            : "Your roster is empty. Complete your draft to add players."}
                        </p>
                        {isPreDraft && (
                          <Button asChild className="mt-4">
                            <a href={`/draft-room?league=${userTeam.league_id}`}>Go to Draft Room</a>
                          </Button>
                        )}
                      </div>
                    );
                  }
                  
                  // Main roster content
                  return (
                  <>
                  {bestBallEnabled && (
                    <div className="mb-4 p-3 rounded-lg bg-amber-900/20 border border-amber-800/50">
                      <div className="flex items-center gap-2">
                        <span className="text-amber-400 font-bold text-sm">Best Ball Mode</span>
                      </div>
                      <p className="text-xs text-amber-300 mt-1">
                        Your lineup is automatically optimized each day to maximize points. No manual roster management needed — just draft well!
                      </p>
                    </div>
                  )}
                  {/* Mobile: clean list view with tap-to-swap */}
                  {/* Desktop: grid with drag-and-drop */}
                  {/* Demo league: read-only (no DnD, no swap) */}
                  {isMobile ? (
                    <div>
                      {/* Mobile tap-to-swap cancel bar */}
                      {tapSelectedPlayerId && (
                        <div className="flex items-center justify-between bg-pastel-orange/15 border border-pastel-orange/30 rounded-lg px-3 py-2 mb-3">
                          <span className="text-sm font-jbmono font-semibold text-pastel-cream">
                            Tap a highlighted position to move
                          </span>
                          <button
                            onClick={() => setTapSelectedPlayerId(null)}
                            className="text-xs font-bold text-pastel-orange bg-pastel-orange/10 hover:bg-pastel-orange/20 rounded-lg px-3 py-1 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                      <MobileRosterList
                        starters={displayRoster.starters}
                        bench={displayRoster.bench}
                        ir={displayRoster.ir}
                        slotAssignments={displayRoster.slotAssignments}
                        lockedPlayerIds={lockedPlayerIds}
                        tapSelectedPlayerId={tapSelectedPlayerId}
                        tapEligibleSlots={tapEligibleSlots}
                        onPlayerTap={handleMobileTapPlayer}
                        onPlayerNameTap={handlePlayerClick}
                        onSlotTap={handleMobileTapSlot}
                        onBenchTap={handleMobileTapBench}
                        positionType={leaguePositionType}
                      />
                    </div>
                  ) : userTeam && isDemoLeague(userTeam.league_id) ? (
                    <div className="space-y-6">
                      <StartersGrid
                        players={displayRoster.starters}
                        slotAssignments={displayRoster.slotAssignments}
                        onPlayerClick={handlePlayerClick}
                        lockedPlayerIds={lockedPlayerIds}
                        positionType={leaguePositionType}
                        rosterSlots={leagueRosterSlots}
                      />
                      <BenchGrid
                        players={displayRoster.bench}
                        onPlayerClick={handlePlayerClick}
                        lockedPlayerIds={lockedPlayerIds}
                      />
                      <IRSlot
                        players={displayRoster.ir}
                        slotAssignments={displayRoster.slotAssignments}
                        onPlayerClick={handlePlayerClick}
                        lockedPlayerIds={lockedPlayerIds}
                      />
                    </div>
                  ) : (
                  <DndContext
                    collisionDetection={closestCenter}
                    onDragStart={(userLeagueState === 'guest' || (userLeagueState as string) === 'logged-in-no-league') ? undefined : handleDragStart}
                    onDragEnd={(userLeagueState === 'guest' || (userLeagueState as string) === 'logged-in-no-league') ? undefined : handleDragEnd}
                  >
                    <div className="space-y-6">
                      <StartersGrid
                        players={displayRoster.starters}
                        slotAssignments={displayRoster.slotAssignments}
                        onPlayerClick={handlePlayerClickWithSwap}
                        lockedPlayerIds={lockedPlayerIds}
                        tapSelectedPlayerId={null}
                        tapEligibleSlots={new Set()}
                        positionType={leaguePositionType}
                        rosterSlots={leagueRosterSlots}
                      />

                      <BenchGrid
                        players={displayRoster.bench}
                        onPlayerClick={handlePlayerClickWithSwap}
                        lockedPlayerIds={lockedPlayerIds}
                      />

                      <IRSlot
                        players={displayRoster.ir}
                        slotAssignments={displayRoster.slotAssignments}
                        onPlayerClick={handlePlayerClickWithSwap}
                        lockedPlayerIds={lockedPlayerIds}
                      />
                    </div>

                    <DragOverlay>
                      {activePlayer ? (
                        <div className="opacity-90 rotate-3">
                          <HockeyPlayerCard
                            player={activePlayer}
                            draggable={false}
                          />
                        </div>
                      ) : null}
                    </DragOverlay>
                  </DndContext>
                  )}
                  </>
                  );
                })()}
                </TabsContent>

                <TabsContent value="stats" className="m-0 p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                  <Card>
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-white/55">Season Points</span>
                        <Trophy className="h-4 w-4 text-yellow-500" aria-hidden="true" />
                      </div>
                      <div className="text-2xl font-bold">{teamStats.totalPoints}</div>
                      <p className="text-xs text-white/55 mt-1">Rank: {teamStats.rank}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-white/55">Avg. Weekly</span>
                        <Activity className="h-4 w-4 text-blue-500" aria-hidden="true" />
                      </div>
                      <div className="text-2xl font-bold">{teamStats.avgPoints}</div>
                      <p className="text-xs text-white/55 mt-1">pts / week</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-white/55">Highest Score</span>
                        <ArrowUpRight className="h-4 w-4 text-green-500" aria-hidden="true" />
                      </div>
                      <div className="text-2xl font-bold">{teamStats.highScore}</div>
                      <p className="text-xs text-white/55 mt-1">Week 2</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-white/55">Moves Made</span>
                        <Users className="h-4 w-4 text-purple-500" aria-hidden="true" />
                      </div>
                      <div className="text-2xl font-bold">{teamStats.waiverMoves}</div>
                      <p className="text-xs text-white/55 mt-1">Waiver/Trades</p>
                    </CardContent>
                  </Card>
                </div>
                </TabsContent>

                <TabsContent value="trends" className="m-0 p-6">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Radar Charts - Category Balance */}
                  <div className="lg:col-span-2">
                    <Card className="h-full">
                      <CardContent className="p-6">
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
                           <div className="flex items-center gap-2">
                             <Target className="h-5 w-5 text-primary" aria-hidden="true" />
                             <div>
                               <h3 className="font-bold text-lg">Category Balance</h3>
                               <p className="text-sm text-white/55">Positional Breakdown</p>
                             </div>
                           </div>
                           <Tabs value={selectedPosMetric} onValueChange={(v) => setSelectedPosMetric(v as any)} className="w-full sm:w-auto">
                             <TabsList className="grid w-full grid-cols-4">
                               <TabsTrigger value="C">C</TabsTrigger>
                               <TabsTrigger value="LW">LW</TabsTrigger>
                               <TabsTrigger value="RW">RW</TabsTrigger>
                               <TabsTrigger value="D">D</TabsTrigger>
                             </TabsList>
                           </Tabs>
                        </div>
                        
                        <div className="h-[300px] w-full relative">
                          <ResponsiveContainer width="100%" height="100%">
                            <RadarChart cx="50%" cy="50%" outerRadius="80%" data={calculateRadarData(posStats[selectedPosMetric], selectedPosMetric)}>
                              <PolarGrid stroke="#e5e7eb" />
                              <PolarAngleAxis dataKey="subject" tick={{ fill: '#6b7280', fontSize: 12, fontWeight: 500 }} />
                              <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                              <Radar
                                name={selectedPosMetric}
                                dataKey="A"
                                stroke="#3b82f6"
                                strokeWidth={3}
                                fill="#3b82f6"
                                fillOpacity={0.3}
                              />
                              <Tooltip 
                                 contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                 itemStyle={{ color: '#3b82f6', fontWeight: 'bold' }}
                              />
                            </RadarChart>
                          </ResponsiveContainer>
                          <div className="absolute top-0 right-0 text-xs text-white/55 text-right hidden sm:block">
                             <div className="mb-1">Chart shows % of Elite Baseline</div>
                             <div>100% = Top Tier Production</div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Power Rankings & Key Insights */}
                  <div className="space-y-6">
                    <Card>
                      <CardContent className="p-6">
                         <div className="flex items-center gap-2 mb-4">
                            <Zap className="h-5 w-5 text-yellow-500" aria-hidden="true" />
                            <h3 className="font-bold text-lg">Power Rankings</h3>
                         </div>
                         <div className="space-y-3">
                           <div className="flex justify-between items-center p-2 bg-white/5 ring-1 ring-white/10 rounded">
                              <span className="text-sm font-medium">Offense</span>
                              <Badge className="bg-green-500 hover:bg-green-600">A-</Badge>
                           </div>
                           <div className="flex justify-between items-center p-2 bg-white/5 ring-1 ring-white/10 rounded">
                              <span className="text-sm font-medium">Defense</span>
                              <Badge className="bg-yellow-500 hover:bg-yellow-600">B</Badge>
                           </div>
                           <div className="flex justify-between items-center p-2 bg-white/5 ring-1 ring-white/10 rounded">
                              <span className="text-sm font-medium">Goalie</span>
                              <Badge className="bg-blue-500 hover:bg-blue-600">A</Badge>
                           </div>
                            <div className="flex justify-between items-center p-2 bg-white/5 ring-1 ring-white/10 rounded">
                              <span className="text-sm font-medium">Depth</span>
                              <Badge className="bg-orange-500 hover:bg-orange-600">C+</Badge>
                            </div>
                         </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>

                {/* Detailed Stat Breakdown Table */}
                <Card className="mt-6">
                   <CardContent className="p-6">
                      <div className="flex items-center gap-2 mb-4">
                         <BarChart3 className="h-5 w-5 text-white/55" aria-hidden="true" />
                         <h3 className="font-bold text-lg">Projected Season Totals</h3>
                      </div>
                      
                      <div className="space-y-6">
                        {['C', 'LW', 'RW', 'D'].map(pos => (
                          <div key={pos}>
                            <h4 className="text-sm font-semibold text-white/55 mb-3">{pos === 'C' ? 'Centers' : (pos === 'D' ? 'Defensemen' : `${pos} Wingers`)}</h4>
                            <div className="grid grid-cols-2 md:grid-cols-7 gap-4">
                               {Object.entries(posStats[pos as 'C'|'LW'|'RW'|'D']).map(([key, value]) => (
                                  <div key={key} className="flex flex-col p-3 bg-white/5 rounded-lg border text-center">
                                     <span className="text-white/55 uppercase text-xs font-bold tracking-wider">{key}</span>
                                     <span className="text-xl font-bold mt-1 text-pastel-cream">{value}</span>
                                  </div>
                               ))}
                            </div>
                          </div>
                        ))}
                      </div>
                   </CardContent>
                </Card>
                </TabsContent>

                <TabsContent value="transactions" className="m-0 p-6">
                <div className="space-y-6">
                  {(() => {
                    // Split out pending waiver claims so we can render them as
                    // rich "Active Waiver Claims" cards matching the Waiver
                    // Wire page, while processed/failed rows stay in the
                    // compact Transaction History table.
                    const pendingWaivers = transactions.filter(
                      (tx) => tx.type === 'waiver' && tx.status === 'pending'
                    );
                    const historyRows = transactions.filter(
                      (tx) => !(tx.type === 'waiver' && tx.status === 'pending')
                    );

                    return (
                      <>
                        {pendingWaivers.length > 0 && (
                          <div>
                            <div className="mb-3 flex items-center gap-2">
                              <AlertCircle className="w-4 h-4 text-orange-600" aria-hidden="true" />
                              <h3 className="text-lg font-bold">Active Waiver Claims</h3>
                              <Badge variant="secondary" className="text-xs">{pendingWaivers.length}</Badge>
                            </div>
                            <p className="text-xs text-white/55 mb-3">All times shown in Mountain Time (MT)</p>
                            <div className="space-y-3">
                              {pendingWaivers.map((tx) => {
                                const clearsAtFormatted = formatMoment(tx.waiverClearsAt);
                                const nextProcessFormatted = computeNextWaiverProcessMoment(
                                  tx.waiverClearsAt,
                                  tx.leagueWaiverProcessTime,
                                );
                                return (
                                  <div
                                    key={tx.id}
                                    className="p-4 rounded-lg border-2 bg-gradient-to-r from-amber-50 to-orange-50 border-amber-500/60"
                                  >
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                      <div className="flex-1 min-w-[200px]">
                                        <div className="font-bold text-base">{tx.playerName}</div>
                                        {(tx.playerPosition || tx.playerTeam) && (
                                          <div className="text-sm text-white/55">
                                            {tx.playerPosition || ''}{tx.playerPosition && tx.playerTeam ? ' • ' : ''}{tx.playerTeam || ''}
                                          </div>
                                        )}
                                        {tx.dropPlayerName && (
                                          <div className="text-sm text-orange-700 mt-1">
                                            Dropping: {tx.dropPlayerName}
                                            {(tx.dropPlayerPosition || tx.dropPlayerTeam) && (
                                              <> ({tx.dropPlayerPosition || ''}{tx.dropPlayerPosition && tx.dropPlayerTeam ? ' • ' : ''}{tx.dropPlayerTeam || ''})</>
                                            )}
                                            {tx.isConditionalDrop && (
                                              <span className="ml-1 text-xs opacity-70">(conditional)</span>
                                            )}
                                          </div>
                                        )}
                                        <div className="text-xs text-white/55 mt-1">
                                          {tx.bidAmount != null
                                            ? `Bid: $${tx.bidAmount}`
                                            : tx.priority != null
                                              ? `Your priority: #${tx.priority}`
                                              : ''}
                                          {(tx.bidAmount != null || tx.priority != null) && ' · '}
                                          Submitted {tx.date}
                                        </div>
                                      </div>
                                      <div>
                                        <Badge className="bg-amber-400 text-amber-900 uppercase text-xs font-bold">
                                          Pending
                                        </Badge>
                                      </div>
                                    </div>

                                    {(clearsAtFormatted || nextProcessFormatted) && (
                                      <div className="mt-3 grid gap-2 sm:grid-cols-2 text-xs">
                                        {clearsAtFormatted && (
                                          <div className="flex items-start gap-2 rounded-md bg-pastel-surface-tile border border-amber-500/40 p-2">
                                            <Clock className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" aria-hidden="true" />
                                            <div>
                                              <div className="uppercase tracking-wide text-[10px] text-amber-700 font-bold">
                                                Waiver window clears
                                              </div>
                                              <div className="font-semibold">{clearsAtFormatted}</div>
                                            </div>
                                          </div>
                                        )}
                                        {nextProcessFormatted && (
                                          <div className="flex items-start gap-2 rounded-md bg-pastel-surface-tile border border-green-600/40 p-2">
                                            <Zap className="w-4 h-4 text-green-700 mt-0.5 shrink-0" aria-hidden="true" />
                                            <div>
                                              <div className="uppercase tracking-wide text-[10px] text-green-700 font-bold">
                                                Claim processes
                                              </div>
                                              <div className="font-semibold">{nextProcessFormatted}</div>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        <div>
                          <div className="mb-3">
                            <h3 className="text-lg font-bold">Transaction History</h3>
                            <p className="text-xs text-white/55 mt-1">All times shown in Mountain Time (MT)</p>
                          </div>
                          {historyRows.length === 0 ? (
                            <div className="text-center py-10 border rounded-lg border-dashed border-white/10">
                              <ArrowUpRight className="w-8 h-8 mx-auto mb-3 text-pastel-sage/40" strokeWidth={2} aria-hidden="true" />
                              <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-sage font-bold mb-2">
                                ✦ Clean slate
                              </div>
                              <p className="text-pastel-cream font-bold text-base">No moves yet.</p>
                              <p className="text-sm text-white/55 mt-2 max-w-sm mx-auto">Every add, drop, trade, and waiver claim you make lands here — the receipts of your season.</p>
                            </div>
                          ) : (
                            <div className="rounded-md border">
                              <div className="hidden md:grid grid-cols-12 gap-4 p-4 border-b bg-white/5 font-medium text-sm">
                                <div className="col-span-3">Date</div>
                                <div className="col-span-2">Type</div>
                                <div className="col-span-3">Player</div>
                                <div className="col-span-2">Team</div>
                                <div className="col-span-2 text-right">Status</div>
                              </div>
                              {historyRows.map((tx) => (
                                <div key={tx.id} className="flex flex-col md:grid md:grid-cols-12 gap-2 md:gap-4 p-4 border-b last:border-0 text-sm md:items-center hover:bg-white/5 transition-colors relative">
                                  {/* Mobile Top Row: Date & Status */}
                                  <div className="flex md:hidden justify-between items-start mb-1">
                                    <div className="text-white/55 text-xs">{tx.date}</div>
                                    <div className="text-right">
                                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                                        tx.status === 'processed' ? 'bg-green-900/40 text-green-400' :
                                        (tx.status === 'pending' ? 'bg-yellow-900/40 text-yellow-400' : 'bg-red-900/40 text-red-400')
                                      }`}>
                                        {tx.status}
                                      </span>
                                    </div>
                                  </div>

                                  {/* Desktop: Date */}
                                  <div className="hidden md:block col-span-3 text-white/55 text-xs">{tx.date}</div>

                                  {/* Type Badge */}
                                  <div className="col-span-2 capitalize font-medium flex items-center">
                                    <Badge
                                      variant={
                                        tx.type === 'claim' ? 'default'
                                        : tx.type === 'drop' ? 'destructive'
                                        : 'secondary'
                                      }
                                      className="text-xs"
                                    >
                                      {tx.type === 'waiver' ? 'Waiver' : tx.type}
                                    </Badge>
                                  </div>

                                  {/* Player & Team (Mobile: Combined) */}
                                  <div className="col-span-3 font-medium text-base md:text-sm flex items-center gap-2">
                                    {tx.playerName}
                                    <span className="md:hidden text-white/55 font-normal text-xs">• {tx.playerTeam}</span>
                                  </div>

                                  {/* Desktop: Team */}
                                  <div className="hidden md:block col-span-2">{tx.playerTeam}</div>

                                  {/* Desktop: Status */}
                                  <div className="hidden md:block col-span-2 text-right">
                                    <span className={`text-xs px-2 py-1 rounded-full ${
                                      tx.status === 'processed' ? 'bg-green-900/40 text-green-400' :
                                      (tx.status === 'pending' ? 'bg-yellow-900/40 text-yellow-400' : 'bg-red-900/40 text-red-400')
                                    }`}>
                                      {tx.status}
                                    </span>
                                  </div>

                                  {/* Failure reason (spans full row when present) */}
                                  {tx.status === 'failed' && tx.failureReason && (
                                    <div className="col-span-12 text-xs text-red-600 mt-1 md:mt-0">
                                      Reason: {tx.failureReason}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </>
                    );
                  })()}
                </div>
                </TabsContent>
              </div>
            </Tabs>
            
            {/* Enhanced Player Stats Modal */}
        <PlayerStatsModal
          player={selectedPlayer}
          isOpen={isPlayerDialogOpen}
          onClose={() => setIsPlayerDialogOpen(false)}
          leagueId={userTeam?.league_id || null}
          isOnRoster={selectedPlayer ? [...roster.starters, ...roster.bench, ...roster.ir].some(p => p.id === selectedPlayer.id) : false}
          onPlayerDropped={async () => {
            // Refresh roster and transactions without page reload
            if (userTeam?.league_id) {
              // Reload transactions immediately
              const { transactions: newTransactions } = await LeagueService.fetchTransactions(userTeam.league_id);
              setTransactions(newTransactions);
              
              // Trigger roster reload by calling loadRoster
              // CRITICAL FIX: Use roster_assignments (source of truth), NOT draft_picks
              // draft_picks can have cross-session duplicates; roster_assignments is atomic
              const allPlayers = await PlayerService.getAllPlayers();
              const rosterIdsResponse = await rosterApi.getPlayerIds(userTeam.league_id, userTeam.id);
              const playerIds = (rosterIdsResponse.data || []) as string[];
              const dbPlayers = allPlayers.filter(p => playerIds.includes(String(p.id)));

              // Get lineup via API
              const lineupResponse = await rosterApi.getLineup(userTeam.league_id, userTeam.id);
              const lineupData = lineupResponse.data as any;

              // Transform players to HockeyPlayer format (same logic as in loadRoster)
              const transformedPlayers: HockeyPlayer[] = dbPlayers.map((p) => ({
                id: p.id,
                name: p.full_name,
                position: p.position,
                number: parseInt(p.jersey_number || '0'),
                starter: false,
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
                  toi: (() => {
                    const secs = Number((p as any).icetime_seconds || 0) / Math.max(1, Number(p.games_played || 0));
                    const mins = Math.floor(secs / 60);
                    const remainingSecs = Math.floor(secs % 60);
                    return `${mins}:${remainingSecs.toString().padStart(2, '0')}`;
                  })(),
                  wins: p.wins || 0,
                  losses: p.losses || 0,
                  otl: p.ot_losses || 0,
                  gaa: p.goals_against_average || 0,
                  savePct: p.save_percentage || 0,
                  shutouts: (p as any).shutouts || 0,
                  goalsSavedAboveExpected: p.goalsSavedAboveExpected || 0
                },
                team: p.team,
                teamAbbreviation: p.team,
                status: (p.status === 'injured' ? 'IR' : null) as 'IR' | 'SUSP' | 'GTD' | 'WVR' | null,
                image: p.headshot_url || undefined,
                nextGame: undefined,
                projectedPoints: 0 // Will be set by daily projections system
              }));

              const playerMap = new Map(transformedPlayers.map(p => [String(p.id), p]));
              
              const starters = (lineupData?.starters || [])
                .map((id: string) => playerMap.get(id))
                .filter((p): p is HockeyPlayer => !!p)
                .map(p => ({ ...p, starter: true }));
              
              const bench = (lineupData?.bench || [])
                .map((id: string) => playerMap.get(id))
                .filter((p): p is HockeyPlayer => !!p);
              
              const ir = (lineupData?.ir || [])
                .map((id: string) => playerMap.get(id))
                .filter((p): p is HockeyPlayer => !!p);

              setRoster({
                starters,
                bench,
                ir,
                slotAssignments: lineupData?.slot_assignments || {}
              });
            }
          }}
        />

        {/* Drop Player Dialog for Adding New Player */}
        <Dialog open={isDropDialogOpen} onOpenChange={setIsDropDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Roster Full - Drop a Player</DialogTitle>
              <DialogDescription>
                Your roster is full. Drop a player to add <strong>{pendingAddPlayer?.name}</strong>.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[...displayRoster.starters, ...displayRoster.bench, ...displayRoster.ir].map((player) => (
                  <Card key={player.id} className="p-4 hover:border-primary cursor-pointer transition-colors" onClick={async () => {
                    if (!user || !userTeam?.league_id || !pendingAddPlayer) return;
                    
                    // Check draft status FIRST - must complete draft before adding players
                    try {
                      const leagueResponse = await leagueApi.getLeague(userTeam.league_id);
                      const leagueData = leagueResponse.data as { draft_status?: string } | null;

                      if (leagueData && leagueData.draft_status !== 'completed') {
                        toast({
                          title: "Draft Required",
                          description: "You must complete the draft before adding free agents.",
                          variant: "destructive"
                        });
                        return;
                      }
                    } catch (error) {
                      logger.error("[Roster] Error checking draft status:", error);
                      toast({
                        title: "Draft Status Unclear",
                        description: "Couldn't verify where the draft is at — try again in a moment.",
                        variant: "destructive"
                      });
                      return;
                    }
                    
                    try {
                      // Drop the selected player
                      const { success: dropSuccess, error: dropError } = await LeagueService.dropPlayer(
                        userTeam.league_id,
                        user.id,
                        String(player.id),
                        'Roster Page - Make Room'
                      );

                      if (!dropSuccess) {
                        toast({
                          title: "Drop Didn't Take",
                          description: dropError?.message || "Couldn't drop the player — try again in a moment.",
                          variant: "destructive"
                        });
                        return;
                      }

                      // Add the new player using WaiverService (checks game locks)
                      const playerIdNum = typeof pendingAddPlayer.id === 'string' ? parseInt(pendingAddPlayer.id, 10) : pendingAddPlayer.id;
                      const result = await WaiverService.addPlayer(
                        userTeam.league_id,
                        userTeam.id,
                        playerIdNum,
                        null // No drop player (already dropped above)
                      );

                      if (result.success) {
                        if (result.isFreeAgent) {
                          toast({
                            title: "Player Swapped",
                            description: `Dropped ${player.name} and added ${pendingAddPlayer.name} to your roster.`,
                          });
                        } else {
                          toast({
                            title: "Waiver Claim Submitted",
                            description: `Dropped ${player.name}. ${pendingAddPlayer.name} is game-locked - waiver claim submitted and will process at ${formatWaiverProcessTime()}.`,
                          });
                        }
                        // Clear query params and close dialog
                        setSearchParams({});
                        setIsDropDialogOpen(false);
                        setPendingAddPlayer(null);
                        // Refresh roster without full page reload (keeps current roster visible)
                        refreshRoster();
                        // Clear caches + notify other pages (FreeAgents, etc.) to refresh
                        notifyRosterChanged(undefined, userTeam?.league_id ?? undefined);
                      } else {
                        toast({
                          title: result.isFreeAgent === false ? "Claim Failed" : "Add Failed",
                          description: result.error || "Failed to add player.",
                          variant: "destructive"
                        });
                      }
                    } catch (error: any) {
                      toast({
                        title: "Move Didn't Take",
                        description: error?.message || "Something got in the way — try that move again.",
                        variant: "destructive"
                      });
                    }
                  }}>
                    <CardContent className="p-0">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-semibold">{player.name}</div>
                          <div className="text-sm text-white/55">
                            {formatPositionForDisplay(player.position)} • {player.team}
                          </div>
                          <div className="text-xs text-white/55 mt-1">
                            {player.stats?.points || 0} pts • {player.stats?.gamesPlayed || 0} GP
                          </div>
                        </div>
                        <Button variant="destructive" size="sm">
                          Drop
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button variant="outline" onClick={() => {
                  setSearchParams({});
                  setIsDropDialogOpen(false);
                  setPendingAddPlayer(null);
                }}>
                  Cancel
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
            </div>

            {/* Left Sidebar - Hidden on mobile, left on desktop */}
            <aside className="hidden lg:block w-full lg:w-auto order-2 lg:order-1">
              <div className="lg:sticky lg:top-24 space-y-4 lg:space-y-4">
                {/* Roster Depth Widget */}
                <TeamIntelHub />

                {/* Sleeper-style data tile — replaces the legacy AdSpace
                    placeholder with real team-pulse stats. */}
                <div className="bg-[#1A2A20] ring-1 ring-pastel-orange/30 rounded-2xl p-4 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                  <div className="flex items-center gap-2 mb-3">
                    <Activity className="w-4 h-4 text-pastel-orange-soft" strokeWidth={2} aria-hidden="true" />
                    <div className="font-jbmono text-[9px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold">Team pulse</div>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-baseline justify-between">
                      <span className="text-[11px] text-white/55">Record</span>
                      <span className="font-calistoga text-2xl text-pastel-cream tabular-nums leading-none">
                        {teamStats.record}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between">
                      <span className="text-[11px] text-white/55">Rank</span>
                      <span className="font-calistoga text-lg text-pastel-cream tabular-nums leading-none">
                        {teamStats.rank}
                      </span>
                    </div>
                    <div className="h-px bg-white/10" />
                    <div className="flex items-baseline justify-between">
                      <span className="text-[11px] text-white/55">Total points</span>
                      <span className="font-jbmono text-[12px] text-pastel-orange tabular-nums font-bold">
                        {teamStats.totalPoints}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Quicklinks tile — replaces second legacy AdSpace */}
                <div className="bg-[#1A2A20] ring-1 ring-white/10 rounded-2xl p-4 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                  <div className="flex items-center gap-2 mb-2">
                    <Target className="w-4 h-4 text-pastel-orange" strokeWidth={2} aria-hidden="true" />
                    <div className="font-jbmono text-[9px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold">Lineup tips</div>
                  </div>
                  <ul className="text-[11px] text-white/70 space-y-1.5 leading-relaxed">
                    <li className="flex gap-2"><span className="text-pastel-orange">▸</span> Drag-and-drop to set your lineup</li>
                    <li className="flex gap-2"><span className="text-pastel-orange">▸</span> Auto-lineup uses xG model projections</li>
                    <li className="flex gap-2"><span className="text-pastel-orange">▸</span> Tap a player for full stats + projection</li>
                  </ul>
                </div>
              </div>
            </aside>

            {/* Right Sidebar - Notifications/Chat Panel - Hidden on mobile */}
            {userLeagueState === 'active-user' && userTeam?.league_id && (
              <aside className="hidden lg:block order-3">
                <div className="lg:sticky lg:top-24 h-[calc(100vh-7rem)] bg-[#1A2A20] ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)] overflow-hidden">
                  <LeagueNotifications leagueId={userTeam.league_id} />
                </div>
              </aside>
            )}
          </div>
        </div>
      </main>
      
      {/* Footer - Hidden on mobile */}
      <div className="hidden lg:block">
        <HockeyFooter />
      </div>
    </div>
  );
};

export default Roster;