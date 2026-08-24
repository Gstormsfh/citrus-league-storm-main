import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import Navbar from '@/components/Navbar';
import MobileMenuButton from '@/components/MobileMenuButton';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Search, Clock, AlertCircle, CheckCircle2, XCircle, User, Trophy } from 'lucide-react';
import { isGuestMode } from '@/utils/guestHelpers';
import { LeagueCreationCTA } from '@/components/LeagueCreationCTA';
import { WaiverService, type WaiverClaim, type WaiverPriority } from '@/services/WaiverService';
import { PlayerService, type Player } from '@/services/PlayerService';
import { LeagueService } from '@/services/LeagueService';
import { leagueApi } from '@/api/leagues';
import { rosterApi } from '@/api/rosters';
import { waiverApi } from '@/api/waivers';
import { useToast } from '@/hooks/use-toast';
import LeagueNotifications from '@/components/matchup/LeagueNotifications';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import {
  HockeyFooter,
  ShiftIcon,
  PuckIcon,
  CrossedSticksIcon,
  MaskIcon,
  RangeIcon,
} from '@/components/citrus2';
import { MASCOTS } from '@/constants/mascots';
import { cn } from '@/lib/utils';
import { logger } from '@/utils/logger';
import { isPoolLeague, getPoolRoute } from '@/utils/leagueTypeHelpers';
import { formatWaiverProcessTime, formatMoment, computeNextWaiverProcessMoment } from '@/utils/timezoneUtils';
import { ScheduleService } from '@/services/ScheduleService';
import { supabase } from '@/integrations/supabase/client';
import { Zap, Lock } from 'lucide-react';

const WaiverWire = () => {
  const { user } = useAuth();
  const { userLeagueState, activeLeagueId, activeLeagueFormat } = useLeague();
  const { toast } = useToast();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [waiverClaims, setWaiverClaims] = useState<WaiverClaim[]>([]);
  const [claimPlayers, setClaimPlayers] = useState<Map<number, Player>>(new Map());
  const [waiverPriority, setWaiverPriority] = useState<WaiverPriority[]>([]);
  const [myTeamId, setMyTeamId] = useState<string | null>(null);
  const [myPriority, setMyPriority] = useState<number | null>(null);
  const [waiverSettings, setWaiverSettings] = useState<any>(null);
  const [teamCount, setTeamCount] = useState<number>(0);
  
  // Available players search.
  //
  // 2026-08-18 launch audit: callers deep-linked here expecting a player
  // to be preselected (GM Office's "Add" button on a streamer suggestion
  // sent `?player=<id>`), but this page read no search params at all, so
  // every such link opened a blank waiver page and the user had to find
  // the player again by hand. Seeded from `?search=` now.
  const [waiverSearchParams] = useSearchParams();
  const [searchTerm, setSearchTerm] = useState(
    () => waiverSearchParams.get('search') ?? '',
  );
  const [positionFilter, setPositionFilter] = useState<string>('all');
  const [availablePlayers, setAvailablePlayers] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  
  // Claim submission
  const [selectedPlayer, setSelectedPlayer] = useState<any | null>(null);
  const [dropPlayer, setDropPlayer] = useState<number | null>(null);
  const [myRoster, setMyRoster] = useState<any[]>([]);

  // Game-locked teams (players from these teams go through waivers)
  const [lockedTeams, setLockedTeams] = useState<Set<string>>(new Set());
  // 2026-08-24 polish: players actually ON waivers (recently dropped,
  // waiver window still open). player_id → clears-at ISO. The badge used
  // to be game-lock-only, so a just-dropped player showed "Free Agent".
  const [onWaiversClearsAt, setOnWaiversClearsAt] = useState<Map<string, string>>(new Map());

  // FAAB state
  const [isFAAB, setIsFAAB] = useState(false);
  const [faabBudget, setFaabBudget] = useState<number | null>(null);
  const [faabBidAmount, setFaabBidAmount] = useState(0);

  const loadWaiverData = useCallback(async () => {
    if (!user || !activeLeagueId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      // Get user's team
      const { data: team } = await leagueApi.getMyTeam(activeLeagueId) as { data?: { id: string } };

      if (team) {
        setMyTeamId(team.id);

        // Load waiver claims
        const claims = await WaiverService.getTeamWaiverClaims(activeLeagueId, team.id);
        setWaiverClaims(claims);

        // Fetch player details for claims
        if (claims.length > 0) {
          const playerIds = new Set<number>();
          claims.forEach(claim => {
            playerIds.add(claim.player_id);
            if (claim.drop_player_id) {
              playerIds.add(claim.drop_player_id);
            }
          });

          if (playerIds.size > 0) {
            const playerIdStrings = Array.from(playerIds).map(id => String(id));
            const players = await PlayerService.getPlayersByIds(playerIdStrings);
            const playerMap = new Map<number, Player>();
            players.forEach(p => {
              playerMap.set(Number(p.id), p);
            });
            setClaimPlayers(playerMap);
          } else {
            setClaimPlayers(new Map());
          }
        } else {
          setClaimPlayers(new Map());
        }

        // Load roster for drop selection.
        // 2026-08-24: source the FULL roster (roster_assignments), not team_lineups —
        // lineups only exist after a user saves one, so teams that never arranged a
        // lineup got an empty (or stale) drop list here while owning a full roster.
        try {
          const rosterResp = await rosterApi.getTeamRoster(activeLeagueId, team.id);
          const assignments = (rosterResp.data as Array<{ player_id: string | number }>) || [];
          const allPlayerIds = assignments
            .map(a => String(a.player_id))
            .filter(id => id && !isNaN(Number(id)));

          if (allPlayerIds.length > 0) {
            // Use PlayerService to get player details (handles all data correctly)
            const players = await PlayerService.getPlayersByIds(allPlayerIds);
            // Map to the expected format
            const rosterPlayers = players.map(p => ({
              player_id: Number(p.id),
              full_name: p.full_name,
              position_code: p.position,
              team_abbrev: p.team
            }));
            setMyRoster(rosterPlayers);
          } else {
            setMyRoster([]);
          }
        } catch {
          setMyRoster([]);
        }
      }

      // Load league to get team count
      const { league, error: leagueError } = await LeagueService.getLeague(activeLeagueId, user.id);
      const maxTeams = league?.settings?.teamsCount || 12;

      // Get actual team count from teams table (more reliable than waiver_priority length)
      const { data: teams } = await leagueApi.getTeams(activeLeagueId) as { data?: { id: string }[] };
      const actualTeamCount = Array.isArray(teams) ? teams.length : 0;
      setTeamCount(actualTeamCount);

      // Load waiver priority
      const priority = await WaiverService.getWaiverPriority(activeLeagueId);
      setWaiverPriority(priority);
      
      // Find user's priority
      const myPrio = priority.find(p => p.team_id === team?.id);
      
      // If no priority record exists, create one (for existing teams that predate the trigger)
      if (team && !myPrio && actualTeamCount > 0) {
        try {
          // Use API to create priority
          const { data: rpcResult } = await waiverApi.initializePriority(activeLeagueId, team.id);

          if (rpcResult && Array.isArray(rpcResult) && rpcResult.length > 0) {
            const result = rpcResult[0];

            if (result.success && result.priority) {
              // Reload priority after creating
              const updatedPriority = await WaiverService.getWaiverPriority(activeLeagueId);
              setWaiverPriority(updatedPriority);
              const newMyPrio = updatedPriority.find(p => p.team_id === team.id);
              if (newMyPrio && newMyPrio.priority > 0 && newMyPrio.priority <= actualTeamCount) {
                setMyPriority(newMyPrio.priority);
              } else {
                logger.warn('Created priority but validation failed:', newMyPrio, 'actualTeamCount:', actualTeamCount);
                setMyPriority(result.priority); // Use the priority from RPC result
              }
            } else {
              logger.error('RPC returned error:', result.error_message);
              setMyPriority(null);
            }
          } else {
            logger.error('Error calling initialize-priority: unexpected response', rpcResult);
            setMyPriority(null);
          }
        } catch (error) {
          logger.error('Error creating waiver priority:', error);
          setMyPriority(null);
        }
      } else {
        // Validate priority is within valid range
        const validPriority = myPrio && 
          myPrio.priority > 0 && 
          myPrio.priority <= actualTeamCount 
          ? myPrio.priority 
          : null;
        setMyPriority(validPriority);
      }

      // Load league waiver settings
      const settings = await WaiverService.getLeagueWaiverSettings(activeLeagueId, user.id);
      setWaiverSettings(settings);

      // Detect FAAB mode and load budget
      if (settings?.waiver_type === 'faab' && team) {
        setIsFAAB(true);
        const budget = await WaiverService.getFAABBudget(activeLeagueId, team.id);
        setFaabBudget(budget);
      }

    } catch (error) {
      logger.error('Error loading waiver data:', error);
    } finally {
      setLoading(false);
    }
  }, [user, activeLeagueId]);

  // Load data on mount
  useEffect(() => {
    if (user && activeLeagueId) {
      loadWaiverData();
    } else {
      setLoading(false);
    }
  }, [user, activeLeagueId, loadWaiverData]);

  // Redirect pool leagues to their pool page
  const _leagueType = activeLeagueFormat?.leagueType;
  if (isPoolLeague(_leagueType) && activeLeagueId) {
    return <Navigate to={getPoolRoute(_leagueType!, activeLeagueId)} replace />;
  }

  const searchPlayers = async () => {
    if (!activeLeagueId) return;

    setSearchLoading(true);
    try {
      // For 'F' filter, don't send position to API (it expects C/LW/RW); filter client-side instead
      const apiPositionFilter = positionFilter === 'all' || positionFilter === 'F'
        ? undefined
        : positionFilter || undefined;
      const players = await WaiverService.getAvailablePlayers(
        activeLeagueId,
        apiPositionFilter,
        searchTerm || undefined
      );
      // Client-side filtering for 'F' (forward = C/LW/RW)
      const filteredPlayers = positionFilter === 'F'
        ? players.filter((p: any) => ['C', 'LW', 'RW'].includes(p.position_code?.toUpperCase()))
        : players;
      setAvailablePlayers(filteredPlayers);

      // Check which teams have started/live games today (those players are game-locked)
      const uniqueTeams = [...new Set(players.map((p: any) => p.team_abbrev).filter(Boolean))];
      if (uniqueTeams.length > 0) {
        try {
          const gamesMap = await ScheduleService.getNextGamesForTeams(uniqueTeams);
          const locked = new Set<string>();
          const now = new Date();
          gamesMap.forEach((game, team) => {
            const status = (game.status || 'scheduled').toLowerCase();
            if (status === 'live' || status === 'final' || status === 'intermission') {
              locked.add(team);
            } else if (status === 'scheduled' && game.game_time) {
              const gameStart = new Date(game.game_time);
              if (gameStart < now) locked.add(team);
            }
          });
          setLockedTeams(locked);
        } catch {
          // Non-critical — just won't show lock indicators
        }
      }

      // Real on-waivers state (2026-08-24 polish): recently dropped
      // players inside the league's waiver window. Same source +
      // window math as the Free Agents page enrichment.
      try {
        const { data: waiverRows } = await supabase
          .from('player_waiver_status')
          .select('player_id, dropped_at')
          .eq('league_id', activeLeagueId)
          .is('cleared_at', null);
        const { data: periodRow } = await supabase
          .from('leagues')
          .select('waiver_period_hours')
          .eq('id', activeLeagueId)
          .single();
        const windowMs =
          (((periodRow as { waiver_period_hours?: number | null } | null)
            ?.waiver_period_hours) ?? 48) * 60 * 60 * 1000;
        const nowMs = Date.now();
        const map = new Map<string, string>();
        for (const r of (waiverRows ?? []) as Array<{ player_id: number | string; dropped_at: string }>) {
          const droppedMs = new Date(r.dropped_at).getTime();
          if (nowMs - droppedMs < windowMs) {
            map.set(String(r.player_id), new Date(droppedMs + windowMs).toISOString());
          }
        }
        setOnWaiversClearsAt(map);
      } catch {
        // Non-critical — badge falls back to game-lock signal only
      }
    } catch (error) {
      logger.error('Error searching players:', error);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleSubmitClaim = async () => {
    if (!selectedPlayer || !myTeamId || !activeLeagueId) return;

    // Check draft status FIRST - must complete draft before adding players
    try {
      const { data: leagueData } = await leagueApi.getLeague(activeLeagueId) as { data?: { draft_status: string } };

      if (leagueData && leagueData.draft_status !== 'completed') {
        toast({
          title: "Draft Required",
          description: "You must complete the draft before adding players via waivers.",
          variant: "destructive"
        });
        return;
      }
    } catch (error) {
      logger.error("[WaiverWire] Error checking draft status:", error);
      toast({
        title: "Draft Status Unclear",
        description: "Couldn't verify where the draft is at — try again in a moment.",
        variant: "destructive"
      });
      return;
    }

    // FAAB mode: submit a bid instead of a priority-based claim
    if (isFAAB) {
      const bidResult = await WaiverService.submitFAABBid(
        activeLeagueId,
        myTeamId,
        selectedPlayer.player_id,
        faabBidAmount,
        dropPlayer
      );

      if (bidResult.success) {
        toast({
          title: "FAAB Bid Submitted",
          description: `$${faabBidAmount} bid for ${selectedPlayer.full_name} submitted. Processes at waiver time.`,
        });
        setSelectedPlayer(null);
        setDropPlayer(null);
        setFaabBidAmount(0);
        loadWaiverData();
      } else {
        toast({
          title: "Bid Failed",
          description: bidResult.error,
          variant: "destructive"
        });
      }
      return;
    }

    // Standard mode: use smart addPlayer function that handles both free agent and waiver claims
    const result = await WaiverService.addPlayer(
      activeLeagueId,
      myTeamId,
      selectedPlayer.player_id,
      dropPlayer
    );

    if (result.success) {
      if (result.isFreeAgent) {
        toast({
          title: "Player Added",
          description: `${selectedPlayer.full_name} added to your roster immediately`,
        });
      } else {
        toast({
          title: "Waiver Claim Submitted",
          description: `Claim for ${selectedPlayer.full_name} submitted. Will process at ${formatWaiverProcessTime(waiverSettings?.waiver_process_time)}.`,
        });
      }
      setSelectedPlayer(null);
      setDropPlayer(null);
      loadWaiverData();
    } else {
      // Check if roster is full — redirect to roster to drop a player
      const errorStr = (result.error || '').toLowerCase();
      if (errorStr.includes('roster') && (errorStr.includes('full') || errorStr.includes('max') || errorStr.includes('limit'))) {
        navigate(`/roster?addPlayer=${selectedPlayer.player_id}&playerName=${encodeURIComponent(selectedPlayer.full_name)}`);
        toast({
          title: "Roster Full",
          description: `You must drop a player before adding ${selectedPlayer.full_name}.`,
        });
      } else {
        toast({
          title: result.isFreeAgent === false ? "Claim Failed" : "Add Failed",
          description: result.error,
          variant: "destructive"
        });
      }
    }
  };

  const handleCancelClaim = async (claimId: string) => {
    const result = await WaiverService.cancelWaiverClaim(claimId);
    
    if (result.success) {
      toast({
        title: "Claim Cancelled",
        description: "Waiver claim has been cancelled",
      });
      loadWaiverData();
    } else {
      toast({
        title: "Cancellation Failed",
        description: result.error,
        variant: "destructive"
      });
    }
  };

  return (
    <div className="min-h-screen bg-[#0F1F15] text-pastel-cream flex flex-col relative">
      <div className="hidden lg:block"><Navbar /></div>
      <div className="lg:hidden sticky top-0 z-40 bg-[#0F1F15]/95 backdrop-blur-xl border-b border-white/10 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-between h-12 px-4">
          <div className="w-10" />
          <h1 className="text-lg font-bold text-pastel-cream">Waiver Wire</h1>
          <MobileMenuButton />
        </div>
      </div>
      <main className="w-full lg:pt-24 lg:pb-8 pb-[calc(5rem+env(safe-area-inset-bottom))]">
        <div className="w-full m-0 p-0">
          {/* Sidebar, Content, and Notifications Grid - Sidebar at bottom on mobile, left on desktop; Notifications on right on desktop */}
          <div className="flex flex-col lg:grid lg:grid-cols-[200px_1fr_260px] xl:grid-cols-[220px_1fr_280px] lg:gap-4 xl:gap-6 lg:px-4 xl:px-6 lg:mx-0 lg:w-screen lg:relative lg:left-1/2 lg:-translate-x-1/2">
            {/* Main Content - Scrollable - Appears first on mobile */}
            <div className="min-w-0 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto px-2 lg:px-4 order-1 lg:order-2">

              <div className="text-left mb-8 relative">
                <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold mb-1.5 flex items-center gap-2">
                  <ShiftIcon className="w-3.5 h-3.5" strokeWidth={2} />
                  ✦ Off the Wire
                </div>
                <h1 className="font-calistoga text-3xl sm:text-4xl text-pastel-cream leading-none">
                  {isFAAB ? 'Bid on the difference-maker.' : 'Claim before puck drop.'}
                </h1>
                <p className="text-sm text-white/55 mt-2">
                  {isFAAB ? 'Place FAAB bids on free agents' : 'Manage waiver claims and priorities'}
                </p>

                {/* FAAB Budget Meter — real visualization, not just a number pill.
                    Bar fills with pastel-orange at the remaining budget; the
                    "spent" portion shows the white track. Tabular numerals for
                    the readout below. Only renders for FAAB leagues. */}
                {isFAAB && faabBudget !== null && (
                  <div className="mt-4 max-w-md bg-[#1A2A20] ring-1 ring-pastel-orange/40 rounded-2xl p-4 shadow-[0_8px_24px_-12px_rgba(255,168,87,0.4)]">
                    {/* Bespoke Kiwi pose: same OG character (sliced-kiwi
                        face, round glasses, sage #44 jersey, orange citrus
                        side, low-poly 3D, dark forest bg, warm rim) but in
                        a NEW action — at his desk doing the FAAB math
                        with a ledger and calculator. He IS the FAAB tile,
                        not next to it. */}
                    <div className="grid grid-cols-[96px_1fr] gap-3 items-center">
                      <img
                        src="/mascots/mascot-kiwi-faab.jpg"
                        alt="Kiwi running the FAAB numbers"
                        className="w-24 h-24 rounded-xl object-cover ring-1 ring-pastel-orange/30"
                        loading="lazy"
                      />
                      <div className="min-w-0">
                        <div className="flex items-baseline justify-between gap-2 mb-2">
                          <span className="text-[10px] font-jbmono uppercase tracking-[0.22em] font-bold text-pastel-orange-soft truncate">
                            FAAB Budget Remaining
                          </span>
                          <span className="font-calistoga text-2xl text-pastel-orange tabular-nums leading-none shrink-0">
                            ${faabBudget}
                            <span className="text-sm text-white/55 ml-1">/ $100</span>
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-pastel-orange to-pastel-orange-soft rounded-full transition-all duration-500"
                            style={{ width: `${Math.max(0, Math.min(100, faabBudget))}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between mt-2 font-jbmono text-[9px] tracking-[0.18em] uppercase text-white/55 font-bold">
                          <span>$0</span>
                          <span>$50</span>
                          <span>$100</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

            {/* Demo Mode Banner */}
            {isGuestMode(userLeagueState) && (
              <div className="mb-8">
                <LeagueCreationCTA 
                  title="You're viewing demo waiver wire"
                  description="Sign up to manage waiver claims and priorities for your team."
                  variant="compact"
                />
              </div>
            )}

            {/* Waiver Priority & Settings */}
            <div className="grid md:grid-cols-2 gap-6 mb-8">
              <Card className="bg-[#1A2A20] border-0 ring-1 ring-pastel-sage/30 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)] relative overflow-hidden">
                <div aria-hidden="true" className="absolute top-0 right-0 w-48 h-48 bg-pastel-sage/10 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none" />
                <CardHeader className="relative z-10">
                  <CardTitle className="font-calistoga text-lg text-pastel-cream flex items-center gap-2">
                    <Trophy className="w-5 h-5 text-pastel-sage-soft" />
                    Your Waiver Priority
                  </CardTitle>
                </CardHeader>
                <CardContent className="relative z-10">
                  {loading ? (
                    <div className="text-center py-4 text-white/55">Loading…</div>
                  ) : myPriority ? (
                    <div className="text-center">
                      <div className="font-calistoga text-6xl text-pastel-sage-soft tabular-nums leading-none mb-2">
                        #{myPriority}
                      </div>
                      <p className="text-[10px] font-jbmono uppercase tracking-[0.22em] font-bold text-white/55">
                        of {teamCount || waiverPriority.length} teams
                      </p>
                    </div>
                  ) : (
                    <div className="text-center py-4 text-white/55">
                      Priority not set
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="bg-[#1A2A20] border-0 ring-1 ring-pastel-orange/30 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)] relative overflow-hidden">
                <div aria-hidden="true" className="absolute top-0 right-0 w-48 h-48 bg-pastel-orange/10 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none" />
                <CardHeader className="relative z-10">
                  <CardTitle className="font-calistoga text-lg text-pastel-cream flex items-center gap-2">
                    <Clock className="w-5 h-5 text-pastel-orange" />
                    Waiver Settings
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 relative z-10">
                  <div className="flex items-center justify-between p-3 bg-white/5 ring-1 ring-white/10 rounded-xl">
                    <span className="text-[10px] font-jbmono uppercase tracking-[0.22em] text-white/55 font-bold">Process Time</span>
                    <span className="text-sm font-bold text-pastel-cream">
                      {formatWaiverProcessTime(waiverSettings?.waiver_process_time)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-white/5 ring-1 ring-white/10 rounded-xl">
                    <span className="text-[10px] font-jbmono uppercase tracking-[0.22em] text-white/55 font-bold">Waiver Period</span>
                    <span className="text-sm font-bold text-pastel-cream tabular-nums">
                      {waiverSettings?.waiver_period_hours || 48} hours
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-white/5 ring-1 ring-white/10 rounded-xl">
                    <span className="text-[10px] font-jbmono uppercase tracking-[0.22em] text-white/55 font-bold">Game Lock</span>
                    <Badge className={`text-[10px] font-jbmono uppercase tracking-[0.18em] font-bold border-0 ${waiverSettings?.waiver_game_lock ? 'bg-pastel-sage/20 ring-1 ring-pastel-sage/40 text-pastel-sage-soft' : 'bg-white/10 ring-1 ring-white/20 text-white/55'}`}>
                      {waiverSettings?.waiver_game_lock ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Search Available Players */}
            <Card className="mb-8 bg-[#1A2A20] border-0 ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
              <CardHeader>
                <CardTitle className="font-calistoga text-xl text-pastel-cream flex items-center gap-2">
                  <Search className="w-5 h-5 text-pastel-orange" />
                  Search Available Players
                </CardTitle>
                <CardDescription className="text-white/55">
                  Find players to add via waiver claim
                </CardDescription>
              </CardHeader>
              <CardContent>
                {/* Mascot-led position chip row — Stormy/Lemon/Kiwi/Pineapple
                    LEAD the filter, not float beside it. Each character
                    matches their position (Stormy the AGM = All, Lemon the
                    forward = F, Kiwi the D-man = D, Pineapple the goalie = G).
                    Existing Select stays for granular C/LW/RW. */}
                <div className="flex flex-wrap gap-2 mb-3">
                  {[
                    { value: 'all', label: 'All', mascot: 'stormy' as const, ring: 'ring-pastel-orange' },
                    { value: 'F', label: 'Forwards', mascot: 'lemon' as const, ring: 'ring-pastel-orange' },
                    { value: 'D', label: 'Defense', mascot: 'kiwi' as const, ring: 'ring-pastel-sage' },
                    { value: 'G', label: 'Goalies', mascot: 'pineapple' as const, ring: 'ring-amber-400' },
                  ].map((chip) => {
                    const active = positionFilter === chip.value;
                    return (
                      <button
                        key={chip.value}
                        type="button"
                        onClick={() => setPositionFilter(chip.value)}
                        className={cn(
                          'flex items-center gap-2 pl-1 pr-3 py-1 rounded-full ring-1 transition-all font-jbmono text-[10px] uppercase tracking-[0.18em] font-bold',
                          active
                            ? `bg-pastel-orange text-[#581E00] ${chip.ring} shadow-[0_4px_12px_-4px_rgba(255,168,87,0.5)]`
                            : 'bg-white/5 text-white/70 ring-white/10 hover:bg-white/10 hover:text-pastel-cream',
                        )}
                        aria-pressed={active}
                      >
                        <img
                          src={MASCOTS[chip.mascot].image}
                          alt=""
                          className="w-7 h-7 rounded-full object-cover ring-2 ring-[#0F1F15]/20"
                          loading="lazy"
                        />
                        {chip.label}
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-col md:flex-row gap-3 mb-6">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-white/55" />
                    <Input
                      placeholder="Search by player name…"
                      className="pl-10 bg-white/5 border-white/10 text-pastel-cream placeholder:text-white/55 focus-visible:ring-pastel-orange/40 h-12"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && searchPlayers()}
                    />
                  </div>
                  <Select value={positionFilter} onValueChange={setPositionFilter}>
                    <SelectTrigger className="w-full md:w-[180px] bg-white/5 border-white/10 text-pastel-cream focus:ring-pastel-orange/40 h-12">
                      <SelectValue placeholder="All Positions" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Positions</SelectItem>
                      {activeLeagueFormat?.positionType === 'forward' ? (
                        <>
                          <SelectItem value="F">Forward</SelectItem>
                          <SelectItem value="D">Defense</SelectItem>
                          <SelectItem value="G">Goalie</SelectItem>
                        </>
                      ) : (
                        <>
                          <SelectItem value="C">Center</SelectItem>
                          <SelectItem value="LW">Left Wing</SelectItem>
                          <SelectItem value="RW">Right Wing</SelectItem>
                          <SelectItem value="D">Defense</SelectItem>
                          <SelectItem value="G">Goalie</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={searchPlayers}
                    disabled={searchLoading}
                    className="bg-pastel-orange text-[#581E00] hover:bg-pastel-orange-soft font-bold shadow-[0_8px_24px_-8px_rgba(255,168,87,0.5)] disabled:opacity-50 h-12"
                  >
                    {searchLoading ? 'Searching…' : 'Search'}
                  </Button>
                </div>

                {availablePlayers.length > 0 && (
                  <div className="space-y-2">
                    {availablePlayers.map((player) => {
                      const isGameLocked = lockedTeams.has(player.team_abbrev);
                      // 2026-08-24 polish: a player is on the wire when
                      // EITHER signal says so — recently dropped (real
                      // waiver window) or team game-locked.
                      const waiverClearsAt = onWaiversClearsAt.get(String(player.player_id)) ?? null;
                      const isOnWaivers = waiverClearsAt !== null;
                      const treatAsWaiver = isGameLocked || isOnWaivers;
                      return (
                      <div key={player.player_id} className="flex items-center justify-between gap-3 p-4 bg-white/5 ring-1 ring-white/10 hover:ring-pastel-orange/40 hover:bg-white/[0.07] rounded-xl transition-all">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-pastel-cream truncate">
                              {player.full_name}
                            </span>
                            {treatAsWaiver ? (
                              <Badge
                                className="bg-amber-400/20 ring-1 ring-amber-400/40 text-amber-300 border-0 text-[10px] font-jbmono uppercase tracking-[0.18em] font-bold gap-1 h-5"
                                title={isOnWaivers ? `Waiver window clears ${formatMoment(waiverClearsAt) ?? ''}` : 'Game-locked — claims process through waivers'}
                              >
                                <Lock className="w-3 h-3" />
                                {isOnWaivers ? 'On Waivers' : 'Waiver'}
                              </Badge>
                            ) : (
                              <Badge className="bg-pastel-sage/20 ring-1 ring-pastel-sage/40 text-pastel-sage-soft border-0 text-[10px] font-jbmono uppercase tracking-[0.18em] font-bold gap-1 h-5">
                                <Zap className="w-3 h-3" />
                                Free Agent
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-white/55 mt-1 tabular-nums">
                            {player.position_code} · {player.team_abbrev} · #{player.jersey_number}
                            {isOnWaivers && (
                              <span className="text-amber-300/80"> · clears {formatMoment(waiverClearsAt)}</span>
                            )}
                          </div>
                        </div>
                        <Button
                          onClick={() => setSelectedPlayer(player)}
                          size="sm"
                          className={treatAsWaiver
                            ? "bg-amber-400/20 ring-1 ring-amber-400/40 text-amber-300 hover:bg-amber-400/30 font-bold shrink-0"
                            : "bg-pastel-orange text-[#581E00] hover:bg-pastel-orange-soft font-bold shadow-[0_4px_12px_-4px_rgba(255,168,87,0.4)] shrink-0"
                          }
                        >
                          {treatAsWaiver ? 'Claim' : 'Add'}
                        </Button>
                      </div>
                    );})}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Claim Confirmation (shown when a player is selected) */}
            {selectedPlayer && (
              <Card className="bg-[#1A2A20] border-0 ring-1 ring-pastel-orange/40 rounded-2xl shadow-[0_24px_60px_-16px_rgba(255,168,87,0.3)] animate-in slide-in-from-top-2 mb-8 relative overflow-hidden">
                <div aria-hidden="true" className="absolute top-0 right-0 w-64 h-64 bg-pastel-orange/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />
                <CardHeader className="relative z-10">
                  <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold mb-1.5">
                    ✦ Action Required
                  </div>
                  <CardTitle className="font-calistoga text-xl text-pastel-cream flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-pastel-orange" />
                    {isFAAB ? 'Place FAAB Bid' : 'Confirm Claim'}
                  </CardTitle>
                  <CardDescription className="text-white/55 mt-1">
                    {isFAAB
                      ? `Bid on ${selectedPlayer.full_name} — Budget: $${faabBudget ?? 0}`
                      : `Add ${selectedPlayer.full_name} to your roster`
                    }
                  </CardDescription>
                </CardHeader>
                <CardContent className="relative z-10">
                  <div className="flex items-center justify-between p-4 bg-white/5 ring-1 ring-white/10 rounded-xl mb-4">
                    <div>
                      <div className="font-bold text-pastel-cream">
                        {selectedPlayer.full_name}
                      </div>
                      <div className="text-xs text-white/55 mt-0.5">
                        {selectedPlayer.position_code} · {selectedPlayer.team_abbrev}
                      </div>
                    </div>
                  </div>

                  {/* FAAB Bid Amount */}
                  {isFAAB && (
                    <div className="mb-4">
                      <label className="text-[10px] font-jbmono uppercase tracking-[0.22em] font-bold text-pastel-orange-soft mb-1.5 block">Bid Amount ($)</label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={0}
                          max={faabBudget ?? 100}
                          step="0.01"
                          value={faabBidAmount}
                          onChange={(e) => {
                            const val = Math.max(0, parseFloat(e.target.value) || 0);
                            setFaabBidAmount(Math.min(val, faabBudget ?? 100));
                          }}
                          className="w-28 bg-white/5 border-white/10 text-pastel-cream placeholder:text-white/55 focus-visible:ring-pastel-orange/40"
                          placeholder="$0"
                        />
                        <span className="text-xs text-white/55 tabular-nums">of ${faabBudget ?? 0} remaining</span>
                      </div>
                    </div>
                  )}

                  {/* Drop player selector */}
                  {myRoster.length > 0 && (
                    <div className="mb-4">
                      <label className="text-[10px] font-jbmono uppercase tracking-[0.22em] font-bold text-pastel-orange-soft mb-1.5 block">Drop Player (optional)</label>
                      <Select
                        value={dropPlayer?.toString() || 'none'}
                        onValueChange={(val) => setDropPlayer(val === 'none' ? null : Number(val))}
                      >
                        <SelectTrigger className="w-full bg-white/5 border-white/10 text-pastel-cream focus:ring-pastel-orange/40">
                          <SelectValue placeholder="Select player to drop" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No drop</SelectItem>
                          {myRoster.map(p => (
                            <SelectItem key={p.player_id} value={p.player_id.toString()}>
                              {p.full_name} ({p.position_code} · {p.team_abbrev})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <Button
                      onClick={handleSubmitClaim}
                      className="flex-1 bg-pastel-orange text-[#581E00] hover:bg-pastel-orange-soft font-bold shadow-[0_8px_24px_-8px_rgba(255,168,87,0.5)]"
                    >
                      {isFAAB ? `Submit $${faabBidAmount} Bid` : 'Submit Claim'}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => { setSelectedPlayer(null); setDropPlayer(null); setFaabBidAmount(0); }}
                      className="bg-transparent border border-pastel-cream/30 text-pastel-cream hover:bg-white/5 hover:border-pastel-cream/50 font-bold"
                    >
                      Cancel
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Active Waiver Claims */}
            {(() => {
              const pendingClaims = waiverClaims.filter(c => c.status === 'pending');
              const historyClaims = waiverClaims.filter(c => c.status !== 'pending');

              const renderClaimRow = (claim: WaiverClaim, variant: 'pending' | 'history') => {
                const player = claimPlayers.get(claim.player_id);
                const dropP = claim.drop_player_id ? claimPlayers.get(claim.drop_player_id) : null;
                const clearsAtFormatted = formatMoment(claim.waiver_clears_at);
                const nextProcessFormatted = computeNextWaiverProcessMoment(
                  claim.waiver_clears_at,
                  claim.league_waiver_process_time || waiverSettings?.waiver_process_time,
                );
                const statusStyles: Record<string, string> = {
                  pending: 'bg-amber-400/20 ring-1 ring-amber-400/40 text-amber-300',
                  successful: 'bg-pastel-sage/20 ring-1 ring-pastel-sage/40 text-pastel-sage-soft',
                  failed: 'bg-red-400/20 ring-1 ring-red-400/40 text-red-300',
                  cancelled: 'bg-white/10 ring-1 ring-white/20 text-white/55',
                };

                return (
                  <div
                    key={claim.id}
                    className={`p-4 rounded-xl ring-1 ${
                      variant === 'pending'
                        ? 'bg-amber-400/10 ring-amber-400/30'
                        : 'bg-white/5 ring-white/10'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex-1 min-w-[200px]">
                        <div className="font-bold text-pastel-cream text-base">
                          {player?.full_name || `Player #${claim.player_id}`}
                        </div>
                        {player && (
                          <div className="text-xs text-white/55 mt-0.5">
                            {player.position} · {player.team}
                          </div>
                        )}
                        {dropP && (
                          <div className="text-xs text-pastel-orange-soft mt-1.5">
                            Dropping: {dropP.full_name} ({dropP.position} · {dropP.team})
                            {isFAAB && claim.is_conditional_drop && (
                              <span className="ml-1 text-[10px] text-white/55">(conditional)</span>
                            )}
                          </div>
                        )}
                        <div className="text-[11px] text-white/55 mt-1.5 tabular-nums">
                          {isFAAB
                            ? `Bid: $${claim.bid_amount ?? 0}`
                            : `Your priority: #${claim.priority}`}
                          {' · Submitted '}
                          {formatMoment(claim.created_at) || new Date(claim.created_at).toLocaleString()}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          className={`text-[10px] font-jbmono uppercase tracking-[0.18em] font-bold border-0 ${
                            statusStyles[claim.status] || 'bg-pastel-sage/20 ring-1 ring-pastel-sage/40 text-pastel-sage-soft'
                          }`}
                        >
                          {claim.status}
                        </Badge>
                        {variant === 'pending' && (
                          <Button
                            size="sm"
                            onClick={() => handleCancelClaim(claim.id)}
                            className="bg-red-400/20 ring-1 ring-red-400/40 text-red-300 hover:bg-red-400/30 font-bold"
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                    </div>

                    {variant === 'pending' && (clearsAtFormatted || nextProcessFormatted) && (
                      <div className="mt-3 grid gap-2 sm:grid-cols-2 text-xs">
                        {clearsAtFormatted && (
                          <div className="flex items-start gap-2 rounded-lg bg-white/5 ring-1 ring-amber-400/30 p-2">
                            <Clock className="w-4 h-4 text-amber-300 mt-0.5 shrink-0" />
                            <div className="min-w-0">
                              <div className="text-[10px] font-jbmono uppercase tracking-[0.22em] font-bold text-amber-300">
                                Waiver window clears
                              </div>
                              <div className="text-pastel-cream font-bold mt-0.5 tabular-nums">
                                {clearsAtFormatted}
                              </div>
                            </div>
                          </div>
                        )}
                        {nextProcessFormatted && (
                          <div className="flex items-start gap-2 rounded-lg bg-white/5 ring-1 ring-pastel-orange/30 p-2">
                            <Zap className="w-4 h-4 text-pastel-orange mt-0.5 shrink-0" />
                            <div className="min-w-0">
                              <div className="text-[10px] font-jbmono uppercase tracking-[0.22em] font-bold text-pastel-orange-soft">
                                Claim processes
                              </div>
                              <div className="text-pastel-cream font-bold mt-0.5 tabular-nums">
                                {nextProcessFormatted}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {claim.failure_reason && variant === 'history' && (
                      <div className="mt-2 text-xs text-red-300">
                        Reason: {claim.failure_reason}
                      </div>
                    )}
                  </div>
                );
              };

              return (
                <Card className="bg-[#1A2A20] border-0 ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                  <CardHeader>
                    <CardTitle className="font-calistoga text-xl text-pastel-cream flex items-center gap-2">
                      <AlertCircle className="w-5 h-5 text-pastel-orange" />
                      Active Waiver Claims
                      {pendingClaims.length > 0 && (
                        <Badge className="ml-2 bg-pastel-orange/20 ring-1 ring-pastel-orange/40 text-pastel-orange-soft border-0 text-[10px] font-jbmono uppercase tracking-[0.18em] font-bold">
                          {pendingClaims.length}
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription className="text-white/55">
                      All times shown in Mountain Time (MT)
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {loading ? (
                      <div className="text-center py-12 text-white/55">
                        Loading claims…
                      </div>
                    ) : pendingClaims.length === 0 && historyClaims.length === 0 ? (
                      <div className="text-center py-12">
                        <User className="w-16 h-16 text-pastel-orange/20 mx-auto mb-4" />
                        <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold mb-1.5">✦ Empty</div>
                        <p className="text-white/55">No active waiver claims</p>
                      </div>
                    ) : (
                      <div className="space-y-6">
                        {pendingClaims.length > 0 ? (
                          <div className="space-y-2">
                            {pendingClaims.map(c => renderClaimRow(c, 'pending'))}
                          </div>
                        ) : (
                          <div className="rounded-xl border-2 border-dashed border-white/15 py-6 text-center text-white/55 text-sm">
                            No pending claims. Submit one above.
                          </div>
                        )}

                        {historyClaims.length > 0 && (
                          <details className="group">
                            <summary className="cursor-pointer font-jbmono text-[10px] tracking-[0.32em] uppercase font-bold text-pastel-orange-soft list-none flex items-center gap-2 hover:text-pastel-orange transition-colors">
                              <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
                              Recent activity ({historyClaims.length})
                            </summary>
                            <div className="mt-3 space-y-2">
                              {historyClaims.slice(0, 10).map(c => renderClaimRow(c, 'history'))}
                            </div>
                          </details>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })()}
            </div>

            {/* Left Sidebar - At bottom on mobile, left on desktop */}
            <aside className="w-full lg:w-auto order-2 lg:order-1">
              <div className="lg:sticky lg:top-24 space-y-4 lg:space-y-4">
                {/* Sleeper-style data tile — replaces the static Kiwi
                    portrait (Kiwi is now integrated INTO the FAAB meter on
                    the main content side). This rail tile shows real wire
                    activity counts so the rail earns its space. */}
                <div className="bg-[#1A2A20] ring-1 ring-pastel-sage/30 rounded-2xl p-4 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                  <div className="flex items-center gap-2 mb-3">
                    <ShiftIcon className="w-4 h-4 text-pastel-sage-soft" strokeWidth={2} />
                    <div className="font-jbmono text-[9px] tracking-[0.32em] uppercase text-pastel-sage-soft font-bold">Wire activity</div>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-baseline justify-between">
                      <span className="text-[11px] text-white/55">Pending claims</span>
                      <span className="font-calistoga text-2xl text-pastel-cream tabular-nums leading-none">
                        {waiverClaims.filter(c => c.status === 'pending').length}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between">
                      <span className="text-[11px] text-white/55">Recent activity</span>
                      <span className="font-calistoga text-lg text-pastel-cream tabular-nums leading-none">
                        {waiverClaims.filter(c => c.status !== 'pending').length}
                      </span>
                    </div>
                    <div className="h-px bg-white/10" />
                    <div className="flex items-baseline justify-between">
                      <span className="text-[11px] text-white/55">My priority</span>
                      <span className="font-jbmono text-[11px] text-pastel-orange tabular-nums font-bold">
                        {myPriority !== null ? `#${myPriority}` : '—'}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="bg-[#1A2A20] ring-1 ring-white/10 rounded-2xl p-4 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                  <div className="flex items-center gap-2 mb-2">
                    <RangeIcon className="w-4 h-4 text-pastel-orange" strokeWidth={2} />
                    <div className="font-jbmono text-[9px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold">Pickup strategy</div>
                  </div>
                  <ul className="text-[11px] text-white/70 space-y-1.5 leading-relaxed">
                    <li className="flex gap-2"><span className="text-pastel-orange">▸</span> Stack high game-count weeks first</li>
                    <li className="flex gap-2"><span className="text-pastel-orange">▸</span> Goalie streamers beat forward streamers if behind</li>
                    <li className="flex gap-2"><span className="text-pastel-orange">▸</span> Save 30%+ FAAB for trade deadline pickups</li>
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
      <HockeyFooter />
    </div>
  );
};

export default WaiverWire;
