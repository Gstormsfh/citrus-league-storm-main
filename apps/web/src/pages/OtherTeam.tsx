import { useParams, useNavigate } from 'react-router-dom';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, ArrowRightLeft, Star } from 'lucide-react';
import { StartersGrid, BenchGrid, IRSlot } from '@/components/roster';
import { HockeyPlayer } from '@/components/roster/HockeyPlayerCard';
import { useState, useEffect } from 'react';
import { PlayerService } from '@/services/PlayerService';
import { LeagueService, Team, LEAGUE_TEAMS_DATA } from '@/services/LeagueService';
import { DemoLeagueService } from '@/services/DemoLeagueService';
import { DraftService } from '@/services/DraftService';
import { ScheduleService } from '@/services/ScheduleService';
import { useAuth } from '@/contexts/AuthContext';
import { useProfile } from '@/hooks/useProfile';
import { useLeague } from '@/contexts/LeagueContext';
import PlayerStatsModal from '@/components/PlayerStatsModal';
import { leagueApi } from '@/api/leagues';

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AdSpace } from '@/components/AdSpace';
import LeagueNotifications from '@/components/matchup/LeagueNotifications';
import { logger } from '@/utils/logger';

// Helper for fantasy position (reused)
const getFantasyPosition = (position: string): 'C' | 'LW' | 'RW' | 'D' | 'G' | 'UTIL' => {
  const pos = position?.toUpperCase() || '';
  
  if (['C', 'CENTRE', 'CENTER'].includes(pos)) return 'C';
  if (['LW', 'LEFT WING', 'LEFTWING', 'L'].includes(pos)) return 'LW';
  if (['RW', 'RIGHT WING', 'RIGHTWING', 'R'].includes(pos)) return 'RW';
  if (['D', 'DEFENCE', 'DEFENSE'].includes(pos)) return 'D';
  if (['G', 'GOALIE'].includes(pos)) return 'G';
  
  return 'UTIL';
};

const OtherTeam = () => {
  const { teamId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const { userLeagueState, activeLeagueId } = useLeague();
  const [loading, setLoading] = useState(true);
  const [roster, setRoster] = useState<{
    starters: HockeyPlayer[];
    bench: HockeyPlayer[];
    ir: HockeyPlayer[];
    slotAssignments: Record<string, string>;
  }>({ starters: [], bench: [], ir: [], slotAssignments: {} });

  // Player Stats Modal State
  const [selectedPlayer, setSelectedPlayer] = useState<HockeyPlayer | null>(null);
  const [isPlayerDialogOpen, setIsPlayerDialogOpen] = useState(false);
  const [team, setTeam] = useState<Team | null>(null);
  const [ownerName, setOwnerName] = useState<string>('User');

  const handlePlayerClick = (player: HockeyPlayer) => {
    setSelectedPlayer(player);
    setIsPlayerDialogOpen(true);
  };

  useEffect(() => {
    const loadRoster = async () => {
      if (!teamId) {
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        // ═══════════════════════════════════════════════════════════════════
        // DEMO STATE: Check if this is a demo team (IDs 1-10)
        // ═══════════════════════════════════════════════════════════════════
        const teamIdNum = parseInt(teamId || '0');
        const isDemoTeam = (userLeagueState === 'guest' || userLeagueState === 'logged-in-no-league') 
          && teamIdNum >= 1 && teamIdNum <= 10;
        
        if (isDemoTeam) {
          // Load demo league data via service
          const { data: demoLeagueData, error: leagueError } = await DemoLeagueService.getDemoLeague();

          if (leagueError || !demoLeagueData) {
            logger.error('[OtherTeam] Error loading demo league:', leagueError);
            setLoading(false);
            return;
          }

          // Get all teams from the demo league
          const { data: demoTeamsData, error: teamsError } = await DemoLeagueService.getDemoTeams();

          if (teamsError || demoTeamsData.length === 0) {
            logger.error('[OtherTeam] Error loading demo teams:', teamsError);
            setLoading(false);
            return;
          }
          
          // Find the specific team by index (teamIdNum is 1-10, array is 0-indexed)
          const demoTeamFromDb = (demoTeamsData as Team[])[teamIdNum - 1];
          if (!demoTeamFromDb) {
            logger.error(`[OtherTeam] Demo team ${teamIdNum} not found in database`);
            setLoading(false);
            return;
          }
          
          // Get owner name from LEAGUE_TEAMS_DATA
          const demoTeamMetadata = LEAGUE_TEAMS_DATA.find(t => t.id === teamIdNum);
          
          setTeam(demoTeamFromDb);
          setOwnerName(demoTeamMetadata?.owner || 'Demo Owner');

          // Get draft picks for this team
          const { data: draftPicksData, error: picksError } = await DemoLeagueService.getDemoDraftPicks(demoTeamFromDb.id);
          
          if (picksError) {
            logger.error('[OtherTeam] Error loading draft picks:', picksError);
            setLoading(false);
            return;
          }
          
          const playerIds = (draftPicksData || []).map((p: { player_id: string }) => p.player_id);

          if (playerIds.length === 0) {
            logger.error(`[OtherTeam] Demo team ${teamIdNum} has no players in roster`);
            setRoster({ starters: [], bench: [], ir: [], slotAssignments: {} });
            setLoading(false);
            return;
          }
          
          // Get all players
          const allPlayers = await PlayerService.getAllPlayers();
          
          // Filter to get only the players on this team's roster
          const demoRoster = allPlayers.filter(p => playerIds.includes(p.id));
          
          // Transform demo players to HockeyPlayer format
          const transformedPlayers: HockeyPlayer[] = demoRoster.map((p) => ({
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
            projectedPoints: 0 // Will be set by daily projections system
          }));
          
          // Load schedule data for demo players (batch)
          const userTimezone = 'America/Denver';
          const uniqueTeams = Array.from(new Set(
            transformedPlayers.map(p => p.teamAbbreviation || p.team || '').filter(t => t)
          ));
          const [hasGamesTodayMap, nextGamesMap] = await Promise.all([
            ScheduleService.hasGamesTodayBatch(uniqueTeams),
            ScheduleService.getNextGamesForTeams(uniqueTeams)
          ]);
          for (const player of transformedPlayers) {
            const team = player.teamAbbreviation || player.team || '';
            const nextGame = nextGamesMap.get(team) || null;
            const hasGameToday = hasGamesTodayMap.get(team) || false;
            const gameInfo = ScheduleService.getGameInfo(nextGame, team, userTimezone);

            if (gameInfo) {
              player.nextGame = {
                opponent: gameInfo.opponent,
                isToday: hasGameToday
              };
            }
          }
          
          // Get saved lineup for demo team (if exists)
          const savedLineup = await LeagueService.getLineup(teamIdNum, 'demo-league-id');
          
          if (savedLineup && savedLineup.starters.length >= 10 && savedLineup.bench.length > 0) {
            // Use saved lineup
            const playerMap = new Map(transformedPlayers.map(p => [String(p.id), p]));
            const uniqueIds = (ids: string[]) => Array.from(new Set(ids));
            
            const starters = uniqueIds(savedLineup.starters)
              .map(id => {
                const player = playerMap.get(id);
                return player ? { ...player, starter: true } : null;
              })
              .filter((p): p is HockeyPlayer => !!p);
            
            const bench = uniqueIds(savedLineup.bench)
              .map(id => playerMap.get(id))
              .filter((p): p is HockeyPlayer => !!p);
            
            const ir = uniqueIds(savedLineup.ir)
              .map(id => playerMap.get(id))
              .filter((p): p is HockeyPlayer => !!p);
            
            // Add any new players to bench
            transformedPlayers.forEach(player => {
              if (!savedLineup.starters.includes(String(player.id)) 
                  && !savedLineup.bench.includes(String(player.id))
                  && !savedLineup.ir.includes(String(player.id))) {
                bench.push(player);
              }
            });
            
            setRoster({ 
              starters, 
              bench, 
              ir, 
              slotAssignments: savedLineup.slotAssignments || {} 
            });
          } else {
            // Auto-assign lineup for demo team
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
          }
          
          setLoading(false);
          return; // Exit early for demo teams
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // ACTIVE USER STATE: Load real team from database
        // ═══════════════════════════════════════════════════════════════════
        // Get team via API client (fetches all teams with owner profiles)
        if (!activeLeagueId) {
          logger.error(`[OtherTeam] No active league ID available`);
          setLoading(false);
          return;
        }

        const { data: allTeams } = await leagueApi.getTeams(activeLeagueId, true);

        if (!allTeams || !Array.isArray(allTeams)) {
          logger.error(`[OtherTeam] Failed to fetch teams for league ${activeLeagueId}`);
          setLoading(false);
          return;
        }

        const teamData = allTeams.find((t: any) => t.id === teamId);

        if (!teamData) {
          logger.error(`Team ${teamId} not found in league ${activeLeagueId}`);
          setLoading(false);
          return;
        }

        setTeam(teamData);

        // Set owner name from the team data returned by the API (includes owner profile)
        if (teamData.owner_name && teamData.owner_name !== 'Unknown') {
          setOwnerName(teamData.owner_name);
        } else if (!teamData.owner_id) {
          setOwnerName('AI Team');
        }

        // Check if draft is completed
        const { league: leagueData, error: leagueError } = await LeagueService.getLeague(activeLeagueId, user.id);
        if (leagueError || !leagueData || leagueData.draft_status !== 'completed') {
          setRoster({ starters: [], bench: [], ir: [], slotAssignments: {} });
          setLoading(false);
          return;
        }

        // Get all players from staging files
        const allPlayers = await PlayerService.getAllPlayers();
        
        // Get draft picks for this team
        const { picks: draftPicks } = await DraftService.getDraftPicks(activeLeagueId, user.id);
        const teamPicks = draftPicks.filter(p => p.team_id === teamId);
        
        if (teamPicks.length === 0) {
          setRoster({ starters: [], bench: [], ir: [], slotAssignments: {} });
          setLoading(false);
          return;
        }

        // Map draft picks to players
        const playerIds = teamPicks.map(p => p.player_id);
        const teamPlayers = allPlayers.filter(p => playerIds.includes(p.id));

        // CRITICAL: If no players loaded, something is wrong - log and return
        if (teamPlayers.length === 0) {
          logger.error(`OtherTeam: Team ${teamId} - ❌ NO PLAYERS LOADED! This team has no players assigned.`);
          setRoster({ starters: [], bench: [], ir: [], slotAssignments: {} });
          setLoading(false);
          return;
        }

        // Transform players from staging files to HockeyPlayer format
        // All data (names, stats, positions, teams) comes from staging files via PlayerService
        const transformedPlayers: HockeyPlayer[] = teamPlayers.map((p) => ({
          id: p.id,
          name: p.full_name, // From staging file
          position: p.position, // From staging file
          number: parseInt(p.jersey_number || '0'), // Jersey numbers not in staging, default to 0
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
          nextGame: undefined, // Will be populated below with real schedule data
          projectedPoints: 0 // Will be set by daily projections system
        }));

        // Load real NHL schedule data for players (batch instead of per-team)
        const userTimezone = profile?.timezone || 'America/Denver';
        const uniqueTeams = Array.from(new Set(
          transformedPlayers.map(p => p.teamAbbreviation || p.team || '').filter(t => t)
        ));
        const [hasGamesTodayMap, nextGamesMap] = await Promise.all([
          ScheduleService.hasGamesTodayBatch(uniqueTeams),
          ScheduleService.getNextGamesForTeams(uniqueTeams)
        ]);
        for (const player of transformedPlayers) {
          const team = player.teamAbbreviation || player.team || '';
          const nextGame = nextGamesMap.get(team) || null;
          const hasGameToday = hasGamesTodayMap.get(team) || false;
          const gameInfo = ScheduleService.getGameInfo(nextGame, team, userTimezone);

          if (gameInfo) {
            player.nextGame = {
              opponent: gameInfo.opponent,
              isToday: hasGameToday
            };
          } else {
            player.nextGame = { opponent: 'No upcoming game', isToday: false };
          }
        }

        // Sort players consistently by ID for deterministic auto-assignment
        transformedPlayers.sort((a, b) => {
          const idA = typeof a.id === 'string' ? parseInt(a.id) : a.id;
          const idB = typeof b.id === 'string' ? parseInt(b.id) : b.id;
          return idA - idB;
        });

        // Check for saved lineup first (for this team - handles UUID, with league_id for isolation)
        const savedLineup = await LeagueService.getLineup(teamId, activeLeagueId);
        
        // Validate lineup: must have at least 10 starters AND bench players to be considered valid
        // CRITICAL: If all players are on bench with no starters, lineup is invalid
        const starterCount = savedLineup?.starters && Array.isArray(savedLineup.starters) 
          ? savedLineup.starters.length 
          : 0;
        const benchCount = savedLineup?.bench && Array.isArray(savedLineup.bench) 
          ? savedLineup.bench.length 
          : 0;
        
        const isValidLineup = starterCount >= 10 && benchCount > 0;

        // If lineup exists but is invalid (especially if starters is empty), force re-assignment
        if (savedLineup && !isValidLineup) {
          logger.error(`OtherTeam: Team ${teamId} - ❌ INVALID LINEUP DETECTED! (${starterCount} starters, ${benchCount} bench). All players on bench! Auto-fixing NOW...`);
          // Fall through to auto-assignment below - don't use the invalid lineup
          // The auto-assignment will create a proper lineup and save it (same logic as team 2)
        } else if (isValidLineup) {
          // Restore saved lineup for this team
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
          
          // Ensure all slot assignments are valid (player still exists)
          const validSlotAssignments: Record<string, string> = {};
          Object.entries(savedLineup.slotAssignments).forEach(([playerId, slotId]) => {
            if (playerMap.has(playerId)) {
              validSlotAssignments[playerId] = slotId;
            }
          });
          
          setRoster({ starters, bench, ir, slotAssignments: validSlotAssignments });
        } else {
          // No saved lineup - auto-assign slots
          const starters: HockeyPlayer[] = [];
          const bench: HockeyPlayer[] = [];
          const ir: HockeyPlayer[] = [];
          const assignments: Record<string, string> = {};
          
          const slotsNeeded = { 'C': 2, 'LW': 2, 'RW': 2, 'D': 4, 'G': 2, 'UTIL': 1 };
          const slotsFilled = { 'C': 0, 'LW': 0, 'RW': 0, 'D': 0, 'G': 0, 'UTIL': 0 };
          
          let irSlotIndex = 1;

          // Only use actual IR/SUSP status for IR placement (deterministic)
          // Don't use nextGame.isToday for initial auto-assignment
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
              assignments[p.id] = `slot-UTIL`;
            }

            if (assigned) {
              starters.push({ ...p, starter: true });
            } else {
              bench.push(p);
            }
          });

          const initialRoster = { starters, bench, ir, slotAssignments: assignments };
          setRoster(initialRoster);

          // Save initial lineup for this team (handles UUID)
          // This ensures the lineup is persisted even if initialization missed it
          if (starters.length >= 10 && bench.length > 0) {
            try {
              await LeagueService.saveLineup(teamId, activeLeagueId, {
                starters: starters.map(p => String(p.id)),
                bench: bench.map(p => String(p.id)),
                ir: ir.map(p => String(p.id)),
                slotAssignments: assignments
              });
            } catch (err) {
              logger.error(`OtherTeam: Team ${teamId} - ❌ FAILED to save lineup:`, err);
            }
          } else {
            logger.error(`OtherTeam: Team ${teamId} - ❌ CRITICAL: Generated lineup is still invalid (${starters.length} starters, ${bench.length} bench). This should not happen!`);
          }
        }
      } catch (e) {
        logger.error(e);
      } finally {
        setLoading(false);
      }
    };

    if (teamId) {
      loadRoster();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- loadRoster is defined inline; adding userLeagueState/activeLeagueId would re-fetch on every context change. teamId is the only meaningful trigger.
  }, [teamId]);

  if (!team) {
    return (
      <div className="min-h-screen bg-[#D4E8B8] flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Team Not Found</h1>
          <Button onClick={() => navigate('/standings')}>Back to Standings</Button>
        </div>
      </div>
    );
  }

  // Check if this is a demo team for conditional rendering
  const teamIdNum = parseInt(teamId || '0');
  const isDemoTeam = (userLeagueState === 'guest' || userLeagueState === 'logged-in-no-league') 
    && teamIdNum >= 1 && teamIdNum <= 10;

  return (
    <ErrorBoundary>
    <div className="min-h-screen bg-[#D4E8B8]">
      <div className="hidden lg:block"><Navbar /></div>
      <div className="lg:hidden sticky top-0 z-40 bg-[#D4E8B8]/98 backdrop-blur-xl border-b border-citrus-sage/20 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-center h-12 px-4">
          <h1 className="text-lg font-varsity font-bold text-citrus-forest">Team View</h1>
        </div>
      </div>
      <main className="w-full lg:pt-24 lg:pb-8 pb-[calc(5rem+env(safe-area-inset-bottom))]">
        <div className="w-full m-0 p-0">
          <div className="flex flex-col lg:grid lg:grid-cols-[200px_1fr_260px] xl:grid-cols-[220px_1fr_280px] lg:gap-4 xl:gap-6 lg:px-4 xl:px-6 lg:mx-0 lg:w-screen lg:relative lg:left-1/2 lg:-translate-x-1/2">
            <div className="min-w-0 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto px-2 lg:px-6 order-1 lg:order-2">
              <Button 
          variant="ghost" 
          className="mb-6 hover:bg-muted/50" 
          onClick={() => navigate('/standings')}
        >
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Standings
        </Button>

        <div className="bg-card rounded-xl shadow-lg border p-6 mb-8 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none"></div>
          
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 relative z-10">
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center text-2xl font-bold text-primary border-2 border-primary/20 shadow-inner">
                {team.team_name.substring(0, 2).toUpperCase()}
              </div>
              <div>
                <h1 className="text-3xl font-bold tracking-tight">{team.team_name}</h1>
                <div className="flex items-center gap-2 text-muted-foreground mt-1">
                  <Star className="w-4 h-4 fill-muted-foreground/30" />
                  <span>Manager: <span className="font-medium text-foreground">{ownerName}</span></span>
                </div>
              </div>
            </div>

            {/* Only show trade button for active users, not demo teams */}
            {userLeagueState === 'active-user' && (
              <Button 
                size="lg" 
                className="w-full md:w-auto shadow-md hover:shadow-lg transition-all"
                onClick={() => navigate(`/trade-analyzer?partner=${team.id}`)}
              >
                <ArrowRightLeft className="w-4 h-4 mr-2" />
                Propose Trade
              </Button>
            )}
            {isDemoTeam && (
              <Button 
                size="lg" 
                variant="outline"
                className="w-full md:w-auto"
                onClick={() => navigate('/auth')}
              >
                Sign Up to Create Your League
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-8 animate-fade-in">
          {loading ? (
            <div className="text-center py-12 text-muted-foreground">Loading roster...</div>
          ) : (
            <>
              <StartersGrid 
                players={roster.starters} 
                slotAssignments={roster.slotAssignments}
                className="bg-card/50 p-6 rounded-xl border shadow-sm"
                onPlayerClick={handlePlayerClick}
              />
              <BenchGrid 
                players={roster.bench}
                className="bg-card/50 p-6 rounded-xl border shadow-sm"
                onPlayerClick={handlePlayerClick}
              />
              {roster.ir.length > 0 && (
                <IRSlot 
                  players={roster.ir}
                  slotAssignments={roster.slotAssignments}
                  onPlayerClick={handlePlayerClick}
                />
              )}
            </>
          )}
        </div>

        {/* Player Stats Modal */}
        <PlayerStatsModal
          player={selectedPlayer}
          isOpen={isPlayerDialogOpen}
          onClose={() => setIsPlayerDialogOpen(false)}
        />
            </div>

            {/* Left Sidebar - At bottom on mobile, left on desktop */}
            <aside className="w-full lg:w-auto order-2 lg:order-1">
              <div className="lg:sticky lg:top-24 space-y-4 lg:space-y-4">
                <AdSpace size="300x250" label="Team Sponsor" />
                <AdSpace size="300x250" label="Fantasy Partner" />
              </div>
            </aside>

            {/* Right Sidebar - Notifications (hidden on mobile) */}
            {userLeagueState === 'active-user' && activeLeagueId && (
              <aside className="hidden lg:block order-3">
                <div className="lg:sticky lg:top-24 h-[calc(100vh-7rem)] bg-card border rounded-lg shadow-sm overflow-hidden">
                  <LeagueNotifications leagueId={activeLeagueId} />
                </div>
              </aside>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
    </ErrorBoundary>
  );
};

export default OtherTeam;

