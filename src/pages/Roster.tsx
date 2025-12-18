import { useState, useMemo, useEffect, useCallback } from 'react';
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, closestCenter } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague, isDemoLeague } from '@/contexts/LeagueContext';
import { DEMO_LEAGUE_ID } from '@/services/DemoLeagueService';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { LeagueCreationCTA, InlineCTA } from '@/components/LeagueCreationCTA';
import { DemoDataService } from '@/services/DemoDataService';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Wand2, Trophy, Activity, ArrowUpRight, Users, Loader2, Calendar, Target, Shield, Skull, Zap, BarChart3, PieChart } from 'lucide-react';
import LoadingScreen from '@/components/LoadingScreen';
import { RosterDepthWidget } from '@/components/gm-office/RosterDepthWidget';
import { 
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, Cell
} from 'recharts';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import PlayerStatsModal from '@/components/PlayerStatsModal';
import { StartersGrid, BenchGrid, IRSlot } from '@/components/roster';
import { HockeyPlayer } from '@/components/roster/HockeyPlayerCard';
import { useToast } from '@/hooks/use-toast';
import HockeyPlayerCard from '@/components/roster/HockeyPlayerCard';
import { PlayerService } from '@/services/PlayerService';
import { LeagueService, Transaction, LEAGUE_TEAMS_DATA } from '@/services/LeagueService';
import { DraftService } from '@/services/DraftService';
import { CitrusPuckService } from '@/services/CitrusPuckService';
import { ScheduleService } from '@/services/ScheduleService';
import { MatchupService } from '@/services/MatchupService';
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { supabase } from '@/integrations/supabase/client';

// Helper function to transform position to fantasy slot
const getFantasyPosition = (position: string): 'C' | 'LW' | 'RW' | 'D' | 'G' | 'UTIL' => {
  const pos = position?.toUpperCase() || '';
  
  if (['C', 'CENTRE', 'CENTER'].includes(pos)) return 'C';
  if (['LW', 'LEFT WING', 'LEFTWING', 'L'].includes(pos)) return 'LW';
  if (['RW', 'RIGHT WING', 'RIGHTWING', 'R'].includes(pos)) return 'RW';
  // Defensemen: All defensemen are just 'D' (no LD/RD distinction)
  if (['D', 'DEFENCE', 'DEFENSE'].includes(pos)) return 'D';
  // Also check if position contains 'D' but isn't already matched (e.g., 'D/F' should be D, but not 'FD')
  if (pos.includes('D') && !pos.includes('DEFENSIVE') && pos !== 'FD' && !pos.includes('LD') && !pos.includes('RD')) return 'D';
  if (['G', 'GOALIE', 'GOALTENDER'].includes(pos)) return 'G';
  
  return 'UTIL';
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
    'Anaheim Ducks': 'ANA', 'Arizona Coyotes': 'ARI', 'Boston Bruins': 'BOS', 'Buffalo Sabres': 'BUF',
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
        const target = stats[realPos as keyof typeof stats] as any;
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

  const calculateRadarData = (stats: any, position: string) => {
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

    if (players.length === 0) return { score: 0, label: 'Critical Need', color: 'text-red-500', bg: 'bg-red-500/10' };
    
    const avgProj = players.reduce((sum, p) => sum + (p.projectedPoints || 0), 0) / players.length;
    
    // Adjusted thresholds for 5-6 point scale
    if (avgProj >= 5.0) return { score: avgProj, label: 'Elite', color: 'text-green-500', bg: 'bg-green-500/10' };
    if (avgProj >= 4.0) return { score: avgProj, label: 'Strong', color: 'text-blue-500', bg: 'bg-blue-500/10' };
    if (avgProj >= 3.0) return { score: avgProj, label: 'Average', color: 'text-yellow-500', bg: 'bg-yellow-500/10' };
    return { score: avgProj, label: 'Weak', color: 'text-orange-500', bg: 'bg-orange-500/10' };
  };

  // Position slot configuration
const POSITION_SLOTS = {
  'C': { maxPlayers: 2, label: 'Center' },
  'LW': { maxPlayers: 2, label: 'Left Wing' },
  'RW': { maxPlayers: 2, label: 'Right Wing' },
  'D': { maxPlayers: 4, label: 'Defense' },
  'G': { maxPlayers: 2, label: 'Goalie' },
  'UTIL': { maxPlayers: 1, label: 'Utility' },
} as const;

type PositionSlot = keyof typeof POSITION_SLOTS;

interface RosterState {
  starters: HockeyPlayer[];
  bench: HockeyPlayer[];
  ir: HockeyPlayer[];
  slotAssignments: Record<string, string>; // Changed key to string to support UUIDs
}

const Roster = () => {
  const { user, profile } = useAuth();
  const { userLeagueState, loading: leagueLoading, activeLeagueId, demoLeagueId } = useLeague();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedPlayer, setSelectedPlayer] = useState<HockeyPlayer | null>(null);
  const [isPlayerDialogOpen, setIsPlayerDialogOpen] = useState(false);
  const [pendingAddPlayer, setPendingAddPlayer] = useState<{ id: string; name: string } | null>(null);
  const [isDropDialogOpen, setIsDropDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("roster");
  const [activeId, setActiveId] = useState<string | number | null>(null);
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [statView, setStatView] = useState<'currentWeek' | 'seasonToDate' | 'lastSeason' | 'restOfSeason'>('seasonToDate');
  const [analyticsLoaded, setAnalyticsLoaded] = useState(false);
  const [userTeamId, setUserTeamId] = useState<string | number | null>(null);
  const [userTeam, setUserTeam] = useState<{ id: string; league_id: string; team_name: string } | null>(null);
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
  
  // Initial empty roster state
  const [roster, setRoster] = useState<RosterState>({
    starters: [],
    bench: [],
    ir: [],
    slotAssignments: {}
  });

  // Calculate positional stats
  const posStats = useMemo(() => calculateTeamCategoryStats(roster.starters), [roster.starters]);

  // Calculate slots helper
  // Optional parameter: assignedSlots - Set of slot IDs already taken (to avoid conflicts)
  const calculateInitialSlotAssignments = (starters: HockeyPlayer[], assignedSlots?: Set<string>) => {
    const assignments: Record<string, string> = {};
    const playersByPos: Record<string, HockeyPlayer[]> = {
      'C': [], 'LW': [], 'RW': [], 'D': [], 'G': [], 'UTIL': []
    };
    
    starters.forEach(p => {
      const pos = getFantasyPosition(p.position);
      if (pos !== 'UTIL') playersByPos[pos].push(p);
    });
    
    // Helper to check if a slot is available
    const isSlotAvailable = (slotId: string) => !assignedSlots || !assignedSlots.has(slotId);
    
    // Assign C, LW, RW to first 2 slots
    ['C', 'LW', 'RW'].forEach(pos => {
      let slotIndex = 1;
      for (const p of playersByPos[pos]) {
        if (slotIndex > 2) break;
        const slotId = `slot-${pos}-${slotIndex}`;
        if (isSlotAvailable(slotId)) {
          assignments[p.id] = slotId;
          slotIndex++;
        }
      }
    });

    // Assign D to first 4 slots
    let dSlotIndex = 1;
    for (const p of playersByPos['D']) {
      if (dSlotIndex > 4) break;
      const slotId = `slot-D-${dSlotIndex}`;
      if (isSlotAvailable(slotId)) {
        assignments[p.id] = slotId;
        dSlotIndex++;
      }
    }

    // Assign G to first 2 slots
    let gSlotIndex = 1;
    for (const p of playersByPos['G']) {
      if (gSlotIndex > 2) break;
      const slotId = `slot-G-${gSlotIndex}`;
      if (isSlotAvailable(slotId)) {
        assignments[p.id] = slotId;
        gSlotIndex++;
      }
    }
    
    // Assign remaining non-goalie starters to UTIL if not already assigned and UTIL slot is available
    const assignedIds = new Set(Object.keys(assignments).map(id => String(id)));
    const unassigned = starters.filter(p => !assignedIds.has(String(p.id)));
    const utilPlayer = unassigned.find(p => getFantasyPosition(p.position) !== 'G');
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
        // Use the same logic as OtherTeam.tsx - treat user's demo team as Team 3
        // ═══════════════════════════════════════════════════════════════════
        if (userLeagueState === 'guest' || userLeagueState === 'logged-in-no-league') {
          // Use same approach as OtherTeam.tsx for demo teams
          const demoTeamIdNum = 3; // Team 3 is the user's demo team (Citrus Crushers)
          
          // Get demo team data from LEAGUE_TEAMS_DATA
          const demoTeam = LEAGUE_TEAMS_DATA.find(t => t.id === demoTeamIdNum);
          if (!demoTeam) {
            console.error(`Demo team ${demoTeamIdNum} not found in LEAGUE_TEAMS_DATA`);
            setLoading(false);
            return;
          }
          
          // Create demo team object
          const demoTeamData = {
            id: String(demoTeamIdNum),
            league_id: 'demo-league-id',
            team_name: demoTeam.name
          };
          
          teamId = demoTeamData.id;
          setUserTeamId(demoTeamData.id);
          setUserTeam(demoTeamData);
          
          // Initialize demo league (same as OtherTeam.tsx)
          await LeagueService.initializeLeague(allPlayers);
          
          // Get demo team roster from cachedLeagueState (same as OtherTeam.tsx)
          const demoRoster = await LeagueService.getTeamRoster(demoTeamIdNum, allPlayers);
          
          if (demoRoster.length === 0) {
            console.error(`Demo team ${demoTeamIdNum} has no players in roster`);
            setRoster({ starters: [], bench: [], ir: [], slotAssignments: {} });
            setLoading(false);
            return;
          }
          
          // Transform demo players to HockeyPlayer format (same as OtherTeam.tsx)
          dbPlayers = demoRoster;
        } else if (userLeagueState === 'active-user' && user) {
          // Logged-in users with leagues: Get their actual team from Supabase
          // If activeLeagueId is set, prefer that league's team, otherwise get any team
          let teamQuery = supabase
            .from('teams')
            .select('id, league_id, team_name')
            .eq('owner_id', user.id);
          
          // If we have an active league, prefer that team
          if (activeLeagueId) {
            teamQuery = teamQuery.eq('league_id', activeLeagueId);
          }
          
          const { data: teamData, error: teamError } = await teamQuery.maybeSingle();

          if (teamError || !teamData) {
            // User doesn't have a team yet - show empty roster
            setRoster({ starters: [], bench: [], ir: [], slotAssignments: {} });
            setUserTeamId(null);
            setUserTeam(null);
            setLoading(false);
            return;
          }

          userTeamData = teamData;

          // Check if draft is completed before loading roster
          const { league: leagueData, error: leagueError } = await LeagueService.getLeague(userTeamData.league_id);
          if (leagueError || !leagueData || leagueData.draft_status !== 'completed') {
            // Draft not completed - show empty roster
            setRoster({ starters: [], bench: [], ir: [], slotAssignments: {} });
            setUserTeamId(userTeamData.id);
            setUserTeam(userTeamData);
            setLoading(false);
            return;
          }

          teamId = userTeamData.id;
          setUserTeamId(teamId);
          setUserTeam(userTeamData);
          // Draft is completed - get roster from draft picks
          // Get ALL draft picks for this team (including post-draft adds with round 999)
          // Don't filter by session to include players added via free agency
          const { data: allDraftPicks, error: picksError } = await supabase
            .from('draft_picks')
            .select('*')
            .eq('league_id', userTeamData.league_id)
            .eq('team_id', userTeamData.id)
            .is('deleted_at', null)
            .order('pick_number', { ascending: true });
          
          if (picksError) {
            console.error('Error fetching draft picks directly:', picksError);
            // Fallback: try using DraftService.getDraftPicks as before
            console.log('Falling back to DraftService.getDraftPicks...');
            const { picks: draftPicks, error: fallbackError } = await DraftService.getDraftPicks(userTeamData.league_id);
            
            if (fallbackError || !draftPicks) {
              console.error('Fallback draft picks loading also failed:', fallbackError);
              // Last resort: empty roster
              dbPlayers = [];
            } else {
              const teamPicks = draftPicks.filter(p => p.team_id === userTeamData.id);
              const playerIds = teamPicks.map(p => p.player_id);
              dbPlayers = allPlayers.filter(p => playerIds.includes(p.id));
            }
          } else {
            // Map draft picks to players
            const playerIds = (allDraftPicks || []).map(p => p.player_id);
            dbPlayers = allPlayers.filter(p => playerIds.includes(p.id));
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
        console.log('[Roster] Transforming', dbPlayers.length, 'players to HockeyPlayer format');

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
            shutouts: (p as any).shutouts || 0
          },
          team: p.team,
          teamAbbreviation: p.team, // DB has 'EDM' etc
          status: p.status === 'injured' ? 'IR' : (p.status === 'active' ? null : 'WVR'),
          image: p.headshot_url || undefined,
          nextGame: undefined, // Will be populated below with real schedule data
          projectedPoints: (p.points || 0) / 20 // Rough projection
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

        // Sort players consistently by ID for deterministic auto-assignment
        transformedPlayers.sort((a, b) => {
          const idA = typeof a.id === 'string' ? parseInt(a.id) : a.id;
          const idB = typeof b.id === 'string' ? parseInt(b.id) : b.id;
          return idA - idB;
        });

        // Check for saved lineup - but for demo teams, always auto-organize (same as OtherTeam.tsx)
        let savedLineup = null;
        if (userLeagueState === 'guest' || userLeagueState === 'logged-in-no-league') {
          // Demo teams: Always auto-organize (don't check for saved lineups)
          savedLineup = null;
        } else if (teamId && userTeam?.league_id && !isDemoLeague(userTeam.league_id)) {
          // Real user team - use actual league_id
          savedLineup = await LeagueService.getLineup(teamId, userTeam.league_id);
        }
        
        if (savedLineup) {
          // Restore saved lineup
          console.log('[Roster] Restoring saved lineup');
          const playerMap = new Map(transformedPlayers.map(p => [String(p.id), p]));
          const savedPlayerIds = new Set([
            ...savedLineup.starters,
            ...savedLineup.bench,
            ...savedLineup.ir
          ]);
          
          // Helper to deduplicate IDs
          const uniqueIds = (ids: string[]) => Array.from(new Set(ids));

          const starters = uniqueIds(savedLineup.starters)
            .map(id => {
              const player = playerMap.get(id);
              if (!player) return null;
              return { ...player, starter: true };
            })
            .filter((p): p is HockeyPlayer => !!p);
          
          const bench = uniqueIds(savedLineup.bench)
            .map(id => playerMap.get(id))
            .filter((p): p is HockeyPlayer => !!p);
          
          const ir = uniqueIds(savedLineup.ir)
            .map(id => playerMap.get(id))
            .filter((p): p is HockeyPlayer => !!p);
          
          // Add any new players (not in saved lineup) to bench
          transformedPlayers.forEach(player => {
            if (!savedPlayerIds.has(String(player.id))) {
              bench.push(player);
            }
          });
          
          // CRITICAL: Ensure all 13 starter slots are filled with position-aware logic
          // Count current positions in starters
          const positionCounts = {
            C: starters.filter(p => getFantasyPosition(p.position) === 'C').length,
            LW: starters.filter(p => getFantasyPosition(p.position) === 'LW').length,
            RW: starters.filter(p => getFantasyPosition(p.position) === 'RW').length,
            D: starters.filter(p => getFantasyPosition(p.position) === 'D').length,
            G: starters.filter(p => getFantasyPosition(p.position) === 'G').length,
            UTIL: starters.filter(p => getFantasyPosition(p.position) === 'UTIL').length
          };
          
          const slotsNeeded = { 'C': 2, 'LW': 2, 'RW': 2, 'D': 4, 'G': 2, 'UTIL': 1 };
          const totalSlotsNeeded = 13;
          
          if (starters.length < totalSlotsNeeded) {
            console.warn(`[Roster] Saved lineup only has ${starters.length} starters, need ${totalSlotsNeeded}. Filling with position-aware logic...`);
            console.log('[Roster] Current position counts:', positionCounts);
            
            // Get available bench players sorted by points
            const availableBench = [...bench].sort((a, b) => (b.points || 0) - (a.points || 0));
            
            // Priority order: Fill critical positions first (G, D), then others
            const priorityOrder: Array<'G' | 'D' | 'C' | 'LW' | 'RW' | 'UTIL'> = ['G', 'D', 'C', 'LW', 'RW', 'UTIL'];
            
            // First pass: Fill missing positions with position-specific players
            for (const pos of priorityOrder) {
              const needed = slotsNeeded[pos];
              const current = positionCounts[pos];
              const missing = needed - current;
              
              if (missing > 0) {
                // Find best available players of this position from bench
                const positionPlayers = availableBench.filter(p => getFantasyPosition(p.position) === pos);
                const bestOfPosition = positionPlayers
                  .sort((a, b) => (b.points || 0) - (a.points || 0))
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
                
                if (bestOfPosition.length > 0) {
                  console.log(`[Roster] Filled ${bestOfPosition.length} ${pos} position(s)`);
                }
              }
            }
            
            // Second pass: Fill any remaining slots with best available players (if still under 13)
            while (starters.length < totalSlotsNeeded && availableBench.length > 0) {
              const bestPlayer = availableBench.shift();
              if (bestPlayer) {
                starters.push({ ...bestPlayer, starter: true });
                // Remove from bench
                const benchIndex = bench.findIndex(p => p.id === bestPlayer.id);
                if (benchIndex >= 0) {
                  bench.splice(benchIndex, 1);
                }
              }
            }
            
            console.log(`[Roster] Filled saved lineup to ${starters.length} starters. Final position counts:`, {
              C: starters.filter(p => getFantasyPosition(p.position) === 'C').length,
              LW: starters.filter(p => getFantasyPosition(p.position) === 'LW').length,
              RW: starters.filter(p => getFantasyPosition(p.position) === 'RW').length,
              D: starters.filter(p => getFantasyPosition(p.position) === 'D').length,
              G: starters.filter(p => getFantasyPosition(p.position) === 'G').length,
              UTIL: starters.filter(p => getFantasyPosition(p.position) === 'UTIL').length
            });
          }
          
          // Ensure all slot assignments are valid (player still exists)
          const validSlotAssignments: Record<string, string> = {};
          Object.entries(savedLineup.slotAssignments || {}).forEach(([playerId, slotId]) => {
            if (playerMap.has(playerId)) {
              validSlotAssignments[playerId] = slotId;
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
          
          // Ensure UTIL slot is assigned if we have 13 starters but no UTIL assignment
          const hasUtilSlot = Object.values(validSlotAssignments).includes('slot-UTIL');
          if (starters.length >= 13 && !hasUtilSlot) {
            // Count how many players are in each position slot
            const positionSlots = ['slot-C-1', 'slot-C-2', 'slot-LW-1', 'slot-LW-2', 'slot-RW-1', 'slot-RW-2', 
                                   'slot-D-1', 'slot-D-2', 'slot-D-3', 'slot-D-4', 'slot-G-1', 'slot-G-2'];
            const positionSlotCount = positionSlots.filter(slot => Object.values(validSlotAssignments).includes(slot)).length;
            
            // If we have 12 position slots filled, we need UTIL
            // If we have 13 starters but only 12 position slots, one should be UTIL
            if (positionSlotCount >= 12) {
              // Find a starter that's not in a position-specific slot and not a goalie
              const starterInUtilSlot = starters.find(s => {
                const slot = validSlotAssignments[String(s.id)];
                const pos = getFantasyPosition(s.position);
                return !slot || (!positionSlots.includes(slot) && pos !== 'G');
              });
              
              if (starterInUtilSlot) {
                validSlotAssignments[String(starterInUtilSlot.id)] = 'slot-UTIL';
              } else {
                // Fallback: find any non-goalie starter without a slot
                const unassignedStarter = starters.find(s => {
                  const slot = validSlotAssignments[String(s.id)];
                  const pos = getFantasyPosition(s.position);
                  return !slot && pos !== 'G';
                });
                if (unassignedStarter) {
                  validSlotAssignments[String(unassignedStarter.id)] = 'slot-UTIL';
                }
              }
            }
          }
          
          // Normalize all slot assignment keys to strings for consistency
          const normalizedSlotAssignments: Record<string, string> = {};
          Object.entries(validSlotAssignments).forEach(([playerId, slotId]) => {
            normalizedSlotAssignments[String(playerId)] = slotId;
          });
          
          console.log('[Roster] Setting roster from saved lineup:', { 
            starters: starters.length, 
            bench: bench.length, 
            ir: ir.length,
            slotAssignments: Object.keys(normalizedSlotAssignments).length,
            hasUtilSlot: Object.values(normalizedSlotAssignments).includes('slot-UTIL'),
            utilSlotPlayer: Object.entries(normalizedSlotAssignments).find(([_, slot]) => slot === 'slot-UTIL')?.[0]
          });
          setRoster({ starters, bench, ir, slotAssignments: normalizedSlotAssignments });
        } else {
          // No saved lineup - use EXACT SAME LOGIC AS OtherTeam.tsx
          const starters: HockeyPlayer[] = [];
          const bench: HockeyPlayer[] = [];
          const ir: HockeyPlayer[] = [];
          const assignments: Record<string, string> = {};
          
          const slotsNeeded = { 'C': 2, 'LW': 2, 'RW': 2, 'D': 4, 'G': 2, 'UTIL': 1 };
          const slotsFilled = { 'C': 0, 'LW': 0, 'RW': 0, 'D': 0, 'G': 0, 'UTIL': 0 };
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
            
            const pos = getFantasyPosition(p.position);
            let assigned = false;
            
            if (pos !== 'UTIL' && slotsFilled[pos] < slotsNeeded[pos]) {
              slotsFilled[pos]++;
              assigned = true;
              assignments[p.id] = `slot-${pos}-${slotsFilled[pos]}`;
            } else if (pos !== 'G' && slotsFilled['UTIL'] < slotsNeeded['UTIL']) {
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
          
          // Save initial lineup (only for logged-in users with actual teams, not demo league)
          if (userTeamId && user && userTeam?.league_id && !isDemoLeague(userTeam.league_id)) {
            await LeagueService.saveLineup(userTeamId, userTeam.league_id, {
              starters: starters.map(p => p.id),
              bench: bench.map(p => p.id),
              ir: ir.map(p => p.id),
              slotAssignments: assignments
            });
          }
        }
        
        // CRITICAL SAFETY CHECK: For demo state, ensure roster was set
        if ((userLeagueState === 'guest' || userLeagueState === 'logged-in-no-league') && transformedPlayers.length > 0) {
          // Verify roster has players - if not, something went wrong
          console.log('[Roster] Demo state verification - transformedPlayers:', transformedPlayers.length);
        }
      } catch (e: any) {
        // For demo state, try to set roster even if there was an error
        if ((userLeagueState === 'guest' || userLeagueState === 'logged-in-no-league')) {
          console.error('[Roster] Error in loadRoster for demo state, attempting fallback:', e);
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
              status: p.status === 'injured' ? 'IR' : (p.status === 'active' ? null : 'WVR'),
              image: p.headshot_url || undefined,
              nextGame: undefined,
              projectedPoints: (p.points || 0) / 20
            }));
            
            // Auto-organize using same improved logic
            const starters: HockeyPlayer[] = [];
            const bench: HockeyPlayer[] = [];
            const ir: HockeyPlayer[] = [];
            const slotsNeeded = { 'C': 2, 'LW': 2, 'RW': 2, 'D': 4, 'G': 2, 'UTIL': 1 };
            const slotsFilled = { 'C': 0, 'LW': 0, 'RW': 0, 'D': 0, 'G': 0, 'UTIL': 0 };
            const totalSlotsNeeded = 13;
            
            // Sort by points
            const sorted = [...transformed].sort((a, b) => (b.points || 0) - (a.points || 0));
            
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
              const pos = getFantasyPosition(p.position);
              
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
              const remainingBench = [...bench].sort((a, b) => (b.points || 0) - (a.points || 0));
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
            console.log('[Roster] Emergency fallback: Setting roster with', starters.length, 'starters,', bench.length, 'bench');
            setRoster({ starters, bench, ir: [], slotAssignments });
            
            // Set demo team data
            setUserTeamId(`${DEMO_LEAGUE_ID}-team-3`);
            setUserTeam({ id: `${DEMO_LEAGUE_ID}-team-3`, league_id: DEMO_LEAGUE_ID, team_name: 'Citrus Crushers' });
          } catch (fallbackError) {
            console.error('[Roster] Even emergency fallback failed:', fallbackError);
          }
        }
        // Filter out demo league errors - they're expected and harmless
        const errorMessage = e?.message || '';
        const isDemoLeagueError = errorMessage.toLowerCase().includes('demo') || 
                                  errorMessage.toLowerCase().includes('league') && 
                                  (errorMessage.toLowerCase().includes('id') || errorMessage.toLowerCase().includes('uuid'));
        
        if (!isDemoLeagueError) {
          console.error("Failed to load roster", e);
          console.error("Error details:", {
            message: e?.message,
            stack: e?.stack,
            name: e?.name
          });
          toast({ 
            title: "Error", 
            description: `Could not load roster. ${errorMessage || 'Unknown error'}`,
            variant: "destructive" 
          });
        } else {
          // Silently ignore demo league errors
          console.debug("Demo league error (expected and harmless):", errorMessage);
        }
      } finally {
        // Always set loading to false at the end
        setLoading(false);
      }
  }, [user, profile, toast, userLeagueState, leagueLoading, activeLeagueId]);

  // Initial load on mount and when userLeagueState changes
  useEffect(() => {
    // For guests, load immediately. For logged-in users, wait for league context
    if (userLeagueState === 'guest' || !leagueLoading) {
    loadRoster();
    }
  }, [loadRoster, userLeagueState, leagueLoading]);

  // Expose refreshRoster function for manual refresh (e.g., after add/drop)
  const refreshRoster = useCallback(() => {
    loadRoster(true); // Keep current roster visible during refresh
  }, [loadRoster]);

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
        const { league: leagueData, error: leagueError } = await LeagueService.getLeague(userTeam.league_id);
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
        const { picks: draftPicks } = await DraftService.getDraftPicks(userTeam.league_id);
        
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
        console.error('Error calculating team stats:', error);
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
  }, [userTeam, user, roster.starters, roster.bench, roster.ir, transactions]);

  // Load CitrusPuck Analytics
  useEffect(() => {
    // Only load if roster is loaded and not already loaded
    if (loading || analyticsLoaded || roster.starters.length === 0) return;

    const loadAnalytics = async () => {
        try {
            // Load 2024 and 2025 data
            const [data2024, data2025] = await Promise.all([
                CitrusPuckService.getAllAnalytics(2024),
                CitrusPuckService.getAllAnalytics(2025)
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

                    let d2024 = findByName(data2024);
                    let d2025 = findByName(data2025);
                    
                    // If name match fails, try ID if numeric
                    if (!d2024 && !d2025) {
                        const pId = typeof p.id === 'string' ? parseInt(p.id) : p.id;
                        if (!isNaN(pId)) {
                            d2024 = data2024.get(pId);
                            d2025 = data2025.get(pId);
                        }
                    }

                    if (!d2025 && !d2024) return p;

                    const projections = {
                        currentWeek: d2025 ? CitrusPuckService.projectCurrentWeek(d2025) : undefined,
                        restOfSeason: (d2025) ? CitrusPuckService.projectRestOfSeason(d2024 || null, d2025) : undefined
                    };

                    return {
                        ...p,
                        citrusPuckData: {
                            currentSeason: d2025,
                            lastSeason: d2024,
                            projections
                        }
                    };
                } catch (err) {
                    console.error(`Error enriching player ${p.name}:`, err);
                    return p;
                }
            };

            setRoster(prev => ({
                ...prev,
                starters: prev.starters.map(enrichPlayer),
                bench: prev.bench.map(enrichPlayer),
                ir: prev.ir.map(enrichPlayer)
            }));
            
            setAnalyticsLoaded(true);
            toast({ title: "CitrusPuck Loaded", description: "Advanced stats and projections ready." });
        } catch (e) {
            console.error("Failed to load analytics", e);
        }
    };
    
    loadAnalytics();
  }, [loading, analyticsLoaded, roster.starters.length, toast]); // Removed 'roster' full dependency to avoid loops

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
      
      // 2. Helper to sort players: Games Today > Projected Points > Name
      const sortBestPlayers = (players: HockeyPlayer[]) => {
        return [...players].sort((a, b) => {
          if (a.nextGame?.isToday !== b.nextGame?.isToday) {
            return a.nextGame?.isToday ? -1 : 1;
          }
          return (b.projectedPoints || 0) - (a.projectedPoints || 0);
        });
      };

      // 3. Group by fantasy position
      const grouped: Record<string, HockeyPlayer[]> = {
        'C': [], 'LW': [], 'RW': [], 'D': [], 'G': []
      };

      allActivePlayers.forEach(p => {
        const pos = getFantasyPosition(p.position);
        if (pos !== 'UTIL' && grouped[pos]) {
          grouped[pos].push(p);
        }
      });

      // 4. Sort each group
      Object.keys(grouped).forEach(key => {
        grouped[key] = sortBestPlayers(grouped[key]);
      });

      // 5. Assign Slots
      const newAssignments: Record<string, string> = {};
      const newStarters: HockeyPlayer[] = [];
      const newBench: HockeyPlayer[] = [];
      const assignedIds = new Set<string | number>();

      // Helper to assign players to a list of slot IDs
      const assignToSlots = (players: HockeyPlayer[], slotPrefix: string, count: number) => {
        for (let i = 0; i < count; i++) {
          if (players.length > i) {
            const p = players[i];
            const slotId = `${slotPrefix}-${i + 1}`;
            newAssignments[p.id] = slotId;
            newStarters.push({ ...p, starter: true });
            assignedIds.add(p.id);
          }
        }
      };

      // Assign Primary Slots
      assignToSlots(grouped['C'], 'slot-C', 2);
      assignToSlots(grouped['LW'], 'slot-LW', 2);
      assignToSlots(grouped['RW'], 'slot-RW', 2);
      assignToSlots(grouped['D'], 'slot-D', 4);
      assignToSlots(grouped['G'], 'slot-G', 2);

      // 6. Handle UTIL Slot (Best remaining non-goalie)
      const remainingPlayers = allActivePlayers.filter(p => !assignedIds.has(p.id));
      const utilCandidates = remainingPlayers.filter(p => getFantasyPosition(p.position) !== 'G');
      const bestUtil = sortBestPlayers(utilCandidates)[0];

      if (bestUtil) {
        newAssignments[bestUtil.id] = 'slot-UTIL';
        newStarters.push({ ...bestUtil, starter: true });
        assignedIds.add(bestUtil.id);
      }

      // 7. Remaining go to Bench
      const remainingAfterUtil = allActivePlayers.filter(p => !assignedIds.has(p.id));
      remainingAfterUtil.forEach(p => {
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
          starters: newStarters.map(p => p.id),
          bench: newBench.map(p => p.id),
          ir: prev.ir.map(p => p.id),
          slotAssignments: newAssignments
        }).catch(err => console.error('Failed to save lineup:', err));
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

  const handlePlayerClick = (player: HockeyPlayer) => {
    setSelectedPlayer(player);
    setIsPlayerDialogOpen(true);
  };

  // Position validation
  const isPositionValid = (player: HockeyPlayer, targetSlot: string): boolean => {
    const playerFantasyPos = getFantasyPosition(player.position);
    
    if (targetSlot === 'bench-grid') return true;
    
    if (targetSlot.startsWith('ir-slot-')) {
      // Only allow players with 'IR' or 'SUSP' status to move to IR slot (must already be injured)
      if (player.status !== 'IR' && player.status !== 'SUSP') {
        return false;
      }
      return true;
    }
    
    let slotPosition: PositionSlot | null = null;
    
    if (targetSlot === 'slot-UTIL') {
      slotPosition = 'UTIL';
    } else if (targetSlot.startsWith('slot-')) {
       const parts = targetSlot.split('-');
       if (parts.length >= 2) {
         slotPosition = parts[1] as PositionSlot;
       }
    }
    
    if (!slotPosition) return false;
    
    if (slotPosition === 'UTIL') {
      return playerFantasyPos !== 'G';
    }
    
    if (playerFantasyPos === 'G') {
      return slotPosition === 'G';
    }
    
    if (slotPosition === 'G') {
      return false;
    }
    
    return playerFantasyPos === slotPosition;
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string | number);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    // Read-only guard: Block drag-and-drop for demo league
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

    const allPlayers = [...roster.starters, ...roster.bench, ...roster.ir];
    const player = allPlayers.find(p => p.id === playerId);
    
    if (!player) return;

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
          if (userTeamId && user && userTeam?.league_id && !isDemoLeague(userTeam.league_id)) {
            LeagueService.saveLineup(userTeamId, userTeam.league_id, {
              starters: prev.starters.map(p => p.id),
              bench: newBench.map(p => p.id),
              ir: prev.ir.map(p => p.id),
              slotAssignments: prev.slotAssignments
            }).catch(err => console.error('Failed to save lineup:', err));
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
          toast({ title: "Invalid Move", description: "Only injured players (IR/SUSP status) can be placed in IR slots.", variant: "destructive" });
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
            const occupant = allPlayers.find(x => String(x.id) === String(occupantId))!;
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
        
        // Save lineup to Supabase (only for logged-in users, not demo league)
        if (userTeamId && user && userTeam?.league_id && !isDemoLeague(userTeam.league_id)) {
          const lineupToSave = {
            starters: newStarters.map(p => p.id),
            bench: newBench.map(p => p.id),
            ir: newIR.map(p => p.id),
            slotAssignments: newAssignments
          };
          console.log('[Roster] Saving lineup:', {
            teamId: userTeamId,
            leagueId: userTeam.league_id,
            starters: lineupToSave.starters.length,
            bench: lineupToSave.bench.length,
            ir: lineupToSave.ir.length,
            starterIds: lineupToSave.starters
          });
          LeagueService.saveLineup(userTeamId, userTeam.league_id, lineupToSave)
            .then(() => {
              console.log('[Roster] Lineup saved successfully');
            })
            .catch(err => {
              console.error('[Roster] Failed to save lineup:', err);
            });
        }
        
        return updatedRoster;
    });
    
    toast({ title: "Lineup Updated", description: "Player moved successfully." });
  };

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      <Navbar />
      
      <main className="pt-24 pb-16">
        <div className="container max-w-7xl mx-auto px-4 w-full">
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Left Sidebar - Roster Depth Widget */}
            <aside className="lg:w-64 lg:flex-shrink-0 order-2 lg:order-1">
              <div className="lg:sticky lg:top-24">
                <RosterDepthWidget />
              </div>
            </aside>

            {/* Main Content */}
            <div className="flex-1 min-w-0 order-1 lg:order-2">
              {/* Fantasy Team Header */}
              <div className="bg-card rounded-lg shadow-md border p-4 mb-6">
                <div className="flex flex-col md:flex-row justify-between items-center gap-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-2xl font-bold">
                  {userLeagueState === 'guest' ? 'CC' : (userTeam?.team_name?.substring(0, 2).toUpperCase() || profile?.username?.substring(0, 2).toUpperCase() || 'TM')}
                </div>
                <div>
                  <h1 className="text-2xl font-bold">
                    {userLeagueState === 'guest' ? 'Citrus Crushers' : (userTeam?.team_name || 'My Team')}
                  </h1>
                  <div className="text-muted-foreground text-sm">
                    Manager: {userLeagueState === 'guest' ? 'Demo Team' : (profile?.username || 'You')}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-center px-4 py-2">
                  <div className="text-sm text-muted-foreground">Record</div>
                  <div className="font-bold">{teamStats.record}</div>
                </div>
                <div className="text-center px-4 py-2">
                  <div className="text-sm text-muted-foreground">Rank</div>
                  <div className="font-bold">{teamStats.rank}</div>
                </div>
                <div className="text-center px-4 py-2">
                  <div className="text-sm text-muted-foreground">Total Pts</div>
                  <div className="font-bold">{teamStats.totalPoints}</div>
                </div>
              </div>

              <div>
                {userLeagueState === 'active-user' && (
                  <Button onClick={handleAutoLineup} variant="outline" className="flex gap-2">
                    <Wand2 className="w-4 h-4" />
                    Auto Lineup
                  </Button>
                )}
                </div>
              </div>
            </div>

            {/* Main Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
              <div className="bg-card rounded-lg shadow-md border">
                <TabsList className="w-full p-0 bg-transparent border-b rounded-none gap-0">
                <TabsTrigger 
                  value="roster" 
                  className="flex-1 py-4 rounded-none data-[state=active]:bg-card data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary"
                >
                  Roster
                </TabsTrigger>
                <TabsTrigger 
                  value="stats" 
                  className="flex-1 py-4 rounded-none data-[state=active]:bg-card data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary"
                >
                  Team Stats
                </TabsTrigger>
                <TabsTrigger 
                  value="trends" 
                  className="flex-1 py-4 rounded-none data-[state=active]:bg-card data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary"
                >
                  Trends & Analytics
                </TabsTrigger>
                <TabsTrigger 
                  value="transactions" 
                  className="flex-1 py-4 rounded-none data-[state=active]:bg-card data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary"
                >
                  Transactions
                </TabsTrigger>
                </TabsList>

                <TabsContent value="roster" className="m-0 p-6">
                {/* Read-only banner for demo league */}
                {userTeam && isDemoLeague(userTeam.league_id) && (
                  <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                    <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-400">
                      <Shield className="w-4 h-4" />
                      <span className="text-sm font-medium">Demo League - Read Only</span>
                    </div>
                    <p className="text-xs text-yellow-600/80 dark:text-yellow-400/80 mt-1">
                      Sign up to create your own league and make changes!
                    </p>
                  </div>
                )}
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold">Lineup</h2>
                    <ToggleGroup type="single" value={statView} onValueChange={(v) => v && setStatView(v as any)} className="bg-muted/50 p-1 rounded-lg">
                        <ToggleGroupItem value="seasonToDate" size="sm" className="text-xs">Season</ToggleGroupItem>
                        <ToggleGroupItem value="currentWeek" size="sm" className="text-xs">This Week</ToggleGroupItem>
                        <ToggleGroupItem value="restOfSeason" size="sm" className="text-xs">Rest of Season</ToggleGroupItem>
                        <ToggleGroupItem value="lastSeason" size="sm" className="text-xs">Last Year</ToggleGroupItem>
                    </ToggleGroup>
                </div>

                {loading ? (
                  <LoadingScreen
                    character="narwhal"
                    message="Loading Your Roster..."
                  />
                ) : userLeagueState === 'logged-in-no-league' ? (
                  <div className="py-8">
                    <LeagueCreationCTA 
                      title="Your Roster Awaits"
                      description="Create your league to start building your roster, making trades, and competing with friends."
                    />
                  </div>
                ) : !userTeamId && userLeagueState === 'active-user' ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <Trophy className="w-16 h-16 text-muted-foreground mb-4 opacity-50" />
                    <h3 className="text-xl font-semibold mb-2">No Team Yet</h3>
                    <p className="text-muted-foreground mb-4">Join or create a league to start building your roster.</p>
                    <Button asChild>
                      <a href="/create-league">Create or Join a League</a>
                    </Button>
                  </div>
                ) : roster.starters.length === 0 && roster.bench.length === 0 && userLeagueState !== 'guest' ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <Users className="w-16 h-16 text-muted-foreground mb-4 opacity-50" />
                    <h3 className="text-xl font-semibold mb-2">Empty Roster</h3>
                    <p className="text-muted-foreground mb-4">Your roster is empty. Complete your draft to add players.</p>
                  </div>
                ) : (
                  // Disable drag-and-drop for demo league
                  userTeam && isDemoLeague(userTeam.league_id) ? (
                    <div className="space-y-8">
                      <StartersGrid 
                        players={roster.starters}
                        slotAssignments={roster.slotAssignments}
                        onPlayerClick={handlePlayerClick}
                      />
                      
                      <BenchGrid 
                        players={roster.bench}
                        onPlayerClick={handlePlayerClick}
                      />
                      
                      <IRSlot 
                        players={roster.ir}
                        slotAssignments={roster.slotAssignments}
                        onPlayerClick={handlePlayerClick}
                      />
                    </div>
                  ) : (
                  <DndContext
                    collisionDetection={closestCenter}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                  >
                    <div className="space-y-8">
                      <StartersGrid 
                        players={roster.starters}
                        slotAssignments={roster.slotAssignments}
                        onPlayerClick={handlePlayerClick}
                      />
                      
                      <BenchGrid 
                        players={roster.bench}
                        onPlayerClick={handlePlayerClick}
                      />
                      
                      <IRSlot 
                        players={roster.ir}
                        slotAssignments={roster.slotAssignments}
                        onPlayerClick={handlePlayerClick}
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
                  )
                )}
                </TabsContent>

                <TabsContent value="stats" className="m-0 p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                  <Card>
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-muted-foreground">Season Points</span>
                        <Trophy className="h-4 w-4 text-yellow-500" />
                      </div>
                      <div className="text-2xl font-bold">{teamStats.totalPoints}</div>
                      <p className="text-xs text-muted-foreground mt-1">Rank: {teamStats.rank}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-muted-foreground">Avg. Weekly</span>
                        <Activity className="h-4 w-4 text-blue-500" />
                      </div>
                      <div className="text-2xl font-bold">{teamStats.avgPoints}</div>
                      <p className="text-xs text-muted-foreground mt-1">pts / week</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-muted-foreground">Highest Score</span>
                        <ArrowUpRight className="h-4 w-4 text-green-500" />
                      </div>
                      <div className="text-2xl font-bold">{teamStats.highScore}</div>
                      <p className="text-xs text-muted-foreground mt-1">Week 2</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-muted-foreground">Moves Made</span>
                        <Users className="h-4 w-4 text-purple-500" />
                      </div>
                      <div className="text-2xl font-bold">{teamStats.waiverMoves}</div>
                      <p className="text-xs text-muted-foreground mt-1">Waiver/Trades</p>
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
                             <Target className="h-5 w-5 text-primary" />
                             <div>
                               <h3 className="font-bold text-lg">Category Balance</h3>
                               <p className="text-sm text-muted-foreground">Positional Breakdown</p>
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
                          <div className="absolute top-0 right-0 text-xs text-muted-foreground text-right hidden sm:block">
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
                            <Zap className="h-5 w-5 text-yellow-500" />
                            <h3 className="font-bold text-lg">Power Rankings</h3>
                         </div>
                         <div className="space-y-3">
                            <div className="flex justify-between items-center p-2 bg-muted/40 rounded">
                               <span className="text-sm font-medium">Offense</span>
                               <Badge className="bg-green-500 hover:bg-green-600">A-</Badge>
                            </div>
                            <div className="flex justify-between items-center p-2 bg-muted/40 rounded">
                               <span className="text-sm font-medium">Defense</span>
                               <Badge className="bg-yellow-500 hover:bg-yellow-600">B</Badge>
                            </div>
                            <div className="flex justify-between items-center p-2 bg-muted/40 rounded">
                               <span className="text-sm font-medium">Goalie</span>
                               <Badge className="bg-blue-500 hover:bg-blue-600">A</Badge>
                            </div>
                             <div className="flex justify-between items-center p-2 bg-muted/40 rounded">
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
                         <BarChart3 className="h-5 w-5 text-gray-500" />
                         <h3 className="font-bold text-lg">Projected Season Totals</h3>
                      </div>
                      
                      <div className="space-y-6">
                        {['C', 'LW', 'RW', 'D'].map(pos => (
                          <div key={pos}>
                            <h4 className="text-sm font-semibold text-muted-foreground mb-3">{pos === 'C' ? 'Centers' : (pos === 'D' ? 'Defensemen' : `${pos} Wingers`)}</h4>
                            <div className="grid grid-cols-2 md:grid-cols-7 gap-4">
                               {Object.entries(posStats[pos as 'C'|'LW'|'RW'|'D']).map(([key, value]) => (
                                  <div key={key} className="flex flex-col p-3 bg-muted/30 rounded-lg border text-center">
                                     <span className="text-muted-foreground uppercase text-[10px] font-bold tracking-wider">{key}</span>
                                     <span className="text-xl font-bold mt-1 text-foreground">{value}</span>
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
                <div className="space-y-4">
                  <h3 className="text-lg font-bold mb-4">Transaction History</h3>
                  {transactions.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground border rounded-lg border-dashed">
                      No transactions found.
                    </div>
                  ) : (
                    <div className="rounded-md border">
                       <div className="hidden md:grid grid-cols-12 gap-4 p-4 border-b bg-muted/50 font-medium text-sm">
                          <div className="col-span-2">Date</div>
                          <div className="col-span-2">Type</div>
                          <div className="col-span-4">Player</div>
                          <div className="col-span-2">Team</div>
                          <div className="col-span-2 text-right">Status</div>
                       </div>
                       {transactions.map((tx) => (
                         <div key={tx.id} className="flex flex-col md:grid md:grid-cols-12 gap-2 md:gap-4 p-4 border-b last:border-0 text-sm md:items-center hover:bg-muted/20 transition-colors relative">
                            {/* Mobile Top Row: Date & Status */}
                            <div className="flex md:hidden justify-between items-start mb-1">
                                <div className="text-muted-foreground text-xs">{tx.date}</div>
                                <div className="text-right">
                                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                                    tx.status === 'processed' ? 'bg-green-100 text-green-700' : 
                                    (tx.status === 'pending' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700')
                                  }`}>
                                    {tx.status}
                                  </span>
                                </div>
                            </div>

                            {/* Desktop: Date */}
                            <div className="hidden md:block col-span-2 text-muted-foreground">{tx.date}</div>
                            
                            {/* Type Badge */}
                            <div className="col-span-2 capitalize font-medium flex items-center">
                              <Badge variant={tx.type === 'claim' ? 'default' : (tx.type === 'drop' ? 'destructive' : 'secondary')} className="text-xs">
                                {tx.type}
                              </Badge>
                            </div>

                            {/* Player & Team (Mobile: Combined) */}
                            <div className="col-span-4 font-medium text-base md:text-sm flex items-center gap-2">
                                {tx.playerName}
                                <span className="md:hidden text-muted-foreground font-normal text-xs">• {tx.playerTeam}</span>
                            </div>

                            {/* Desktop: Team */}
                            <div className="hidden md:block col-span-2">{tx.playerTeam}</div>
                            
                            {/* Desktop: Status */}
                            <div className="hidden md:block col-span-2 text-right">
                              <span className={`text-xs px-2 py-1 rounded-full ${
                                tx.status === 'processed' ? 'bg-green-100 text-green-700' : 
                                (tx.status === 'pending' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700')
                              }`}>
                                {tx.status}
                              </span>
                            </div>
                         </div>
                       ))}
                    </div>
                  )}
                </div>
                </TabsContent>
              </div>
            </Tabs>
            </div>
            
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
              // We'll extract loadRoster to be callable
              const allPlayers = await PlayerService.getAllPlayers();
              const { picks: draftPicks } = await DraftService.getDraftPicks(userTeam.league_id);
              const teamPicks = draftPicks.filter(p => p.team_id === userTeam.id);
              const playerIds = teamPicks.map(p => p.player_id);
              const dbPlayers = allPlayers.filter(p => playerIds.includes(p.id));
              
              // Get lineup from database
              const { data: lineupData } = await supabase
                .from('team_lineups')
                .select('starters, bench, ir, slot_assignments')
                .eq('team_id', userTeam.id)
                .single();

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
                status: p.status === 'injured' ? 'IR' : (p.status === 'active' ? null : 'WVR'),
                image: p.headshot_url || undefined,
                nextGame: undefined,
                projectedPoints: (p.points || 0) / 20
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
                {[...roster.starters, ...roster.bench, ...roster.ir].map((player) => (
                  <Card key={player.id} className="p-4 hover:border-primary cursor-pointer transition-colors" onClick={async () => {
                    if (!user || !userTeam?.league_id || !pendingAddPlayer) return;
                    
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
                          title: "Error",
                          description: dropError?.message || "Failed to drop player.",
                          variant: "destructive"
                        });
                        return;
                      }

                      // Add the new player
                      const { success: addSuccess, error: addError } = await LeagueService.addPlayer(
                        userTeam.league_id,
                        user.id,
                        pendingAddPlayer.id,
                        'Roster Page - After Drop'
                      );

                      if (addSuccess) {
                        toast({
                          title: "Success",
                          description: `Dropped ${player.name} and added ${pendingAddPlayer.name} to your roster.`,
                        });
                        // Clear query params and close dialog
                        setSearchParams({});
                        setIsDropDialogOpen(false);
                        setPendingAddPlayer(null);
                        // Refresh roster without full page reload (keeps current roster visible)
                        refreshRoster();
                      } else {
                        toast({
                          title: "Error",
                          description: addError?.message || "Failed to add player.",
                          variant: "destructive"
                        });
                      }
                    } catch (error: any) {
                      toast({
                        title: "Error",
                        description: error?.message || "An error occurred.",
                        variant: "destructive"
                      });
                    }
                  }}>
                    <CardContent className="p-0">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-semibold">{player.name}</div>
                          <div className="text-sm text-muted-foreground">
                            {formatPositionForDisplay(player.position)} • {player.team}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
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
          </div>
      </main>
      
      <Footer />
    </div>
  );
};

export default Roster;
