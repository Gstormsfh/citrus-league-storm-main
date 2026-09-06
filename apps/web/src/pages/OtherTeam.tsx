import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { HockeyFooter } from '@/components/citrus2';
import Navbar from '@/components/Navbar';
import { PressBoxLeagueChrome } from '@/components/pressbox/LeagueChrome';
import { PressBoxRosterList, PressBoxTeamCard, PB_TYPE } from '@/components/pressbox';
import { buildRosterRows } from '@/components/pressbox/rosterRows';
import { buildSlotConfig } from '@/components/roster/slotConfig';
import { repairSlotAssignments } from '@/components/roster/repairSlotAssignments';
import type { PositionType } from '@/utils/rosterUtils';
import { resolveIrSlotCount } from '@/components/roster/irSlots';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowRightLeft, Star } from 'lucide-react';
import { StartersGrid, BenchGrid, IRSlot } from '@/components/roster';
import { HockeyPlayer } from '@/components/roster/HockeyPlayerCard';
import { useState, useEffect } from 'react';
import { PlayerService } from '@/services/PlayerService';
import { LeagueService, Team, LEAGUE_TEAMS_DATA } from '@/services/LeagueService';
import { DemoLeagueService } from '@/services/DemoLeagueService';
import { MatchupService } from '@/services/MatchupService';
import { ScheduleService } from '@/services/ScheduleService';
import { useAuth } from '@/contexts/AuthContext';
import { useProfile } from '@/hooks/useProfile';
import { useLeague } from '@/contexts/LeagueContext';
import PlayerStatsModal from '@/components/PlayerStatsModal';
import { leagueApi } from '@/api/leagues';

import { ErrorBoundary } from "@/components/ErrorBoundary";
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
  const { userLeagueState, activeLeagueId: contextLeagueId, activeLeague, activeLeagueFormat } = useLeague();
  // DEEP-LINK FIX (2026-08-23, found live on prod during launch QA): this
  // page looked teams up ONLY through the global active-league context, so
  // any /team/<id>?league=<id> link — from League Activity, a share, or a
  // user whose context sits on a different league — rendered "Team Not
  // Found" for a team that exists. Honor the explicit ?league= param first;
  // the context stays the fallback for the in-app Standings click path.
  const [searchParams] = useSearchParams();
  const activeLeagueId = searchParams.get('league') || contextLeagueId;
  const [loading, setLoading] = useState(true);
  const [viewRosterSlots, setViewRosterSlots] = useState<Record<string, number> | undefined>();
  const [viewPositionType, setViewPositionType] = useState<PositionType>('individual');
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

          if (teamsError || (demoTeamsData as unknown[]).length === 0) {
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
        const loadedSettings = leagueData?.settings as { rosterSlots?: Record<string, number>; positionType?: string } | undefined;
        const loadedSlots = loadedSettings?.rosterSlots;
        const loadedPosition: PositionType = loadedSettings?.positionType === 'forward' ? 'forward' : 'individual';
        setViewRosterSlots(loadedSlots);
        setViewPositionType(loadedPosition);
        if (leagueError || !leagueData || leagueData.draft_status !== 'completed') {
          setRoster({ starters: [], bench: [], ir: [], slotAssignments: {} });
          setLoading(false);
          return;
        }

        // Get all players from staging files
        const allPlayers = await PlayerService.getAllPlayers();

        // CURRENT roster — roster_assignments via the admin-backed API,
        // with a draft_picks fallback inside MatchupService.getTeamRoster.
        // (Found in the 2026-08-23 final audit: this page previously
        // mapped draft_picks directly, which renders the DRAFT-DAY
        // roster — stale after any trade/waiver/FA move, and empty for
        // leagues whose rosters weren't built by an engine draft.)
        const transformedPlayers: HockeyPlayer[] =
          await MatchupService.getTeamRoster(teamId, activeLeagueId, allPlayers);

        if (transformedPlayers.length === 0) {
          logger.error(`OtherTeam: Team ${teamId} - no players on current roster.`);
          setRoster({ starters: [], bench: [], ir: [], slotAssignments: {} });
          setLoading(false);
          return;
        }

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
          // NOTE (2026-08-23 final audit): this used to be the first arm of an
          // if/else-if chain — "fall through to auto-assignment" fell through
          // to NOTHING, so a team with an invalid saved lineup rendered a
          // completely empty page. The auto-assign arm below now actually runs
          // for this case (the else-if became a standalone if/else).
        }
        if (savedLineup && isValidLineup) {
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
          
          const repaired = repairSlotAssignments(starters, validSlotAssignments, loadedPosition, loadedSlots);
          const placed = starters.filter(player => repaired[String(player.id)]);
          bench.push(...starters.filter(player => !repaired[String(player.id)]));
          for (const player of ir) {
            const slot = validSlotAssignments[String(player.id)];
            if (slot?.startsWith('ir-slot-')) repaired[String(player.id)] = slot;
          }
          setRoster({ starters: placed, bench, ir, slotAssignments: repaired });
        } else {
          // Read-only fallback: project this league's legal slots without
          // writing another manager's lineup merely because it was viewed.
          const irCount = resolveIrSlotCount(loadedSlots);
          const ir: HockeyPlayer[] = [];
          const candidates: HockeyPlayer[] = [];
          for (const player of transformedPlayers) {
            if ((player.status === 'IR' || player.status === 'SUSP') && ir.length < irCount) ir.push(player);
            else candidates.push(player);
          }
          const assignments = repairSlotAssignments(candidates, {}, loadedPosition, loadedSlots);
          const starters = candidates.filter(player => assignments[String(player.id)]).map(player => ({ ...player, starter: true }));
          const bench = candidates.filter(player => !assignments[String(player.id)]);
          ir.forEach((player, index) => { assignments[String(player.id)] = `ir-slot-${index + 1}`; });
          setRoster({ starters, bench, ir, slotAssignments: assignments });
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
      <div className="min-h-screen bg-[#0F1F15] flex items-center justify-center px-4">
        <div className="text-center bg-[#1A2A20] ring-1 ring-white/10 rounded-2xl px-8 py-10 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.5)]">
          <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold mb-3">
            ✦ Team Not Found
          </div>
          <h1 className="font-calistoga text-2xl text-pastel-cream mb-5">We couldn&rsquo;t find that team.</h1>
          <Button
            onClick={() => navigate('/standings')}
            className="bg-pastel-orange text-[#581E00] hover:bg-pastel-orange-soft font-bold"
          >
            Back to Standings
          </Button>
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
    <div className="min-h-screen bg-[#0F1F15]">
      <div className="hidden lg:block"><Navbar /></div>
      {/* PRESS BOX (2026-09-04): the league chrome — header, sub-tabs and
          the league menu — replaces the 09-01 title bar and its hamburger,
          which opened the old menu sheet. One menu in the app. */}
      <PressBoxLeagueChrome />
      {/* PRESS BOX (2026-09-04): below lg another manager's team is the
          same list your own team is — the artboard's team card over
          STARTERS / BENCH / IR rows, read-only, a name tap opening the
          card — with PROPOSE TRADE as the card's one orange action. The
          desktop main is unchanged from lg. */}
      <div className={`${PB_TYPE} lg:hidden bg-pressbox-surface text-pressbox-text px-3 pt-3 pb-app-chrome`} data-testid="other-team-phone">
        {loading ? (
          <div className="flex flex-col gap-1.5">
            <div className="h-[92px] rounded-[12px] bg-pressbox-tile border border-white/[0.08] animate-pulse" />
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-[56px] rounded-[10px] bg-pressbox-tile border border-white/[0.08] animate-pulse" />
            ))}
          </div>
        ) : (
          (() => {
            // The league's slot shape, from its settings as the roster page
            // reads them; the defaults when a league has none.
            const leagueSlots = viewRosterSlots;
            const rows = buildRosterRows({
              starters: roster.starters,
              bench: roster.bench,
              ir: roster.ir,
              irSlotCount: resolveIrSlotCount(leagueSlots),
              slotConfig: buildSlotConfig(viewPositionType, leagueSlots),
              slotAssignments: roster.slotAssignments,
              // Read-only: every chip wears the lock rather than the swap
              // glyph, because nothing on this page moves a player.
              lockedPlayerIds: new Set([...roster.starters, ...roster.bench, ...roster.ir].map((x) => String(x.id))),
            });
            const findPlayer = (id: string | number | undefined) =>
              [...roster.starters, ...roster.bench, ...roster.ir].find((x) => String(x.id) === String(id ?? ''));
            return (
              <PressBoxRosterList
                teamCard={
                  <PressBoxTeamCard
                    teamName={team.team_name}
                    rank={ownerName ? `@${ownerName}`.toUpperCase() : null}
                    actions={
                      userLeagueState === 'active-user'
                        ? [{ glyph: '⇄', label: 'Propose trade', to: `/trade-analyzer?partner=${team.id}`, primary: true }]
                        : isDemoTeam
                          ? [{ glyph: '+', label: 'Create your league', to: '/auth', primary: true }]
                          : []
                    }
                  />
                }
                starters={rows.starters}
                bench={rows.bench}
                ir={rows.ir}
                irRequired={rows.irRequired}
                startersFilled={rows.startersFilled}
                startersRequired={rows.startersRequired}
                benchPlayingCount={rows.benchPlayingCount}
                onSlotPress={(slotId) => {
                  const held = rows.starters.find((r) => r.slotId === slotId)?.player ?? rows.bench.find((r) => r.slotId === slotId)?.player;
                  const p = findPlayer(held?.id);
                  if (p) handlePlayerClick(p);
                }}
                onNamePress={(row) => {
                  const p = findPlayer(row.player?.id);
                  if (p) handlePlayerClick(p);
                }}
              />
            );
          })()
        )}
      </div>
      <main className="hidden lg:block w-full lg:pt-24 lg:pb-8">
        <div className="w-full m-0 p-0">
          <div className="flex flex-col lg:grid lg:grid-cols-[200px_1fr_260px] xl:grid-cols-[220px_1fr_280px] lg:gap-4 xl:gap-6 lg:px-4 xl:px-6 lg:mx-0 lg:w-screen lg:relative lg:left-1/2 lg:-translate-x-1/2">
            <div className="min-w-0 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto px-2 lg:px-6 order-1 lg:order-2">
              <Button
          variant="ghost"
          className="mb-6 text-white/55 hover:text-pastel-cream hover:bg-white/5 -ml-2"
          onClick={() => navigate('/standings')}
        >
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Standings
        </Button>

        <div className="bg-[#1A2A20] ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)] p-6 sm:p-8 mb-8 relative overflow-hidden">
          <div aria-hidden="true" className="absolute top-0 right-0 w-72 h-72 bg-pastel-orange/[0.08] rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none"></div>
          <div aria-hidden="true" className="absolute bottom-0 left-0 w-48 h-48 bg-pastel-sage/[0.06] rounded-full blur-3xl -ml-16 -mb-16 pointer-events-none"></div>

          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 relative z-10">
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-pastel-orange/30 to-pastel-orange/10 flex items-center justify-center font-calistoga text-3xl text-pastel-orange ring-1 ring-pastel-orange/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]">
                {team.team_name.substring(0, 2).toUpperCase()}
              </div>
              <div>
                <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold mb-1.5">
                  ✦ Roster · Read-only View
                </div>
                <h1 className="font-calistoga text-3xl sm:text-4xl text-pastel-cream leading-none">{team.team_name}</h1>
                <div className="flex items-center gap-2 text-white/55 mt-2">
                  <Star className="w-4 h-4 fill-pastel-sage/40 text-pastel-sage/60" />
                  <span className="text-sm">Manager: <span className="font-bold text-pastel-cream">{ownerName}</span></span>
                </div>
              </div>
            </div>

            {/* Only show trade button for active users, not demo teams */}
            {userLeagueState === 'active-user' && (
              <Button
                size="lg"
                className="w-full md:w-auto bg-pastel-orange text-[#581E00] hover:bg-pastel-orange-soft font-bold shadow-[0_8px_24px_-8px_rgba(255,168,87,0.5)] hover:shadow-[0_12px_32px_-8px_rgba(255,168,87,0.6)] transition-all"
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
                className="w-full md:w-auto bg-transparent border border-pastel-cream/30 text-pastel-cream hover:bg-white/5 hover:border-pastel-cream/50 font-bold"
                onClick={() => navigate('/auth')}
              >
                Sign Up to Create Your League
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-8 animate-fade-in">
          {loading ? (
            <div className="text-center py-12">
              <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold mb-2">
                ✦ Loading
              </div>
              <p className="text-white/55">Pulling roster from the bench…</p>
            </div>
          ) : (
            <>
              <StartersGrid
                rosterSlots={viewRosterSlots}
                positionType={viewPositionType}
                players={roster.starters}
                slotAssignments={roster.slotAssignments}
                className="bg-[#1A2A20] ring-1 ring-white/10 p-6 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]"
                onPlayerClick={handlePlayerClick}
              />
              <BenchGrid
                players={roster.bench}
                className="bg-[#1A2A20] ring-1 ring-white/10 p-6 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]"
                onPlayerClick={handlePlayerClick}
              />
              {roster.ir.length > 0 && (
                <IRSlot 
                  irSlotCount={resolveIrSlotCount(viewRosterSlots)}
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
                {/* Sleeper-style scouting tips tile — replaces legacy AdSpace */}
                <div className="bg-[#1A2A20] ring-1 ring-pastel-sage/30 rounded-2xl p-4 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                  <div className="font-jbmono text-[9px] tracking-[0.32em] uppercase text-pastel-sage-soft font-bold mb-3">
                    ✦ Scouting tips
                  </div>
                  <ul className="space-y-2 text-[11px] text-white/70 leading-relaxed">
                    <li className="flex gap-2"><span className="text-pastel-sage-soft">▸</span> Compare positions before proposing trades</li>
                    <li className="flex gap-2"><span className="text-pastel-sage-soft">▸</span> Check goalie depth before targeting forwards</li>
                    <li className="flex gap-2"><span className="text-pastel-sage-soft">▸</span> Schedule strength matters as much as raw talent</li>
                  </ul>
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
      <HockeyFooter variant="app" />
    </div>
    </ErrorBoundary>
  );
};

export default OtherTeam;

