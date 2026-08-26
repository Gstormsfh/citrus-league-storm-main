import { useState, useMemo, useEffect, useCallback } from 'react';
import { useSearchParams, Navigate } from 'react-router-dom';
import { HockeyFooter } from '@/components/citrus2';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import Navbar from '@/components/Navbar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Search,
  ArrowLeftRight,
  TrendingUp,
  TrendingDown,
  ShieldAlert,
  CheckCircle2,
  UserPlus,
  UserMinus,
  Scale,
  Info,
  Send,
  History,
  LayoutGrid,
  List as ListIcon
} from 'lucide-react';
import { PlayerService, Player } from '@/services/PlayerService';
import { LeagueService, LeagueTeam } from '@/services/LeagueService';
import { TradeService, type TradeOfferWithPlayers } from '@/services/TradeService';
import { tradeApi } from '@/api/trades';
import PlayerStatsModal from '@/components/PlayerStatsModal';
import { TradeGridView } from '@/components/trade/TradeGridView';
import { TradeReviewSection } from '@/components/trade/TradeReviewSection';
import { HockeyPlayer } from '@/components/roster/HockeyPlayerCard';
import { isGuestMode } from '@/utils/guestHelpers';
import { LeagueCreationCTA } from '@/components/LeagueCreationCTA';
import { useToast } from '@/hooks/use-toast';
import { leagueApi } from '@/api/leagues';
import { rosterApi } from '@/api/rosters';
import LeagueNotifications from '@/components/matchup/LeagueNotifications';
import { logger } from '@/utils/logger';
import { ScoringCalculator } from '@/utils/scoringUtils';
import { isPoolLeague, getPoolRoute } from '@/utils/leagueTypeHelpers';

// Position-based cell colors (mirrors DraftBoard.tsx getPositionColor)
const getPositionColor = (position: string): string => {
  const upper = (position || '').toUpperCase();
  const normalized = upper === 'L' ? 'LW' : upper === 'R' ? 'RW' : upper;
  switch (normalized) {
    case 'C': return 'bg-fantasy-primary/20 border-fantasy-primary/40 hover:bg-fantasy-primary/30';
    case 'LW': return 'bg-fantasy-secondary/20 border-fantasy-secondary/40 hover:bg-fantasy-secondary/30';
    case 'RW': return 'bg-fantasy-tertiary/20 border-fantasy-tertiary/40 hover:bg-fantasy-tertiary/30';
    case 'D': return 'bg-blue-200/40 border-blue-300/50 hover:bg-blue-200/60';
    case 'G': return 'bg-purple-200/40 border-purple-300/50 hover:bg-purple-200/60';
    default: return 'bg-white/5 border-white/10 hover:bg-white/10';
  }
};

const TradeAnalyzer = () => {
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { userLeagueState, activeLeagueId, activeLeagueFormat } = useLeague();
  const { toast } = useToast();
  
  const [selectedTeamId, setSelectedTeamId] = useState<string | number>("");
  const [myTeamRoster, setMyTeamRoster] = useState<Player[]>([]);
  const [opponentTeams, setOpponentTeams] = useState<LeagueTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [draftNotCompleted, setDraftNotCompleted] = useState(false);
  
  // State for Player Stats Modal
  const [selectedPlayerForStats, setSelectedPlayerForStats] = useState<HockeyPlayer | null>(null);
  const [isPlayerDialogOpen, setIsPlayerDialogOpen] = useState(false);
  
  // Trade offer state
  const [myTeamId, setMyTeamId] = useState<string | null>(null);
  const [tradeOffers, setTradeOffers] = useState<TradeOfferWithPlayers[]>([]);
  // 2026-08-18 launch audit: loadTradeOffers' rejection was discarded
  // with `.catch(() => {})`, so a failed fetch left tradeOffers empty and
  // the panel rendered "No Trade Offers — trade offers you send or
  // receive will appear here." A user with a real pending offer was told
  // they had none, and had no way to know otherwise.
  const [tradeOffersError, setTradeOffersError] = useState(false);
  const [activeTab, setActiveTab] = useState('propose');
  const [tradeMessage, setTradeMessage] = useState('');

  // Propose-tab view mode: list (default) or grid
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

  const loadTradeOffers = useCallback(async (teamId: string) => {
    if (!activeLeagueId) return;

    try {
      // Load BOTH the user's trades AND any league-wide trades under review
      // (so non-involved members can vote).
      const [teamOffers, reviewResult] = await Promise.all([
        TradeService.getTeamTradeOffers(activeLeagueId, teamId),
        tradeApi.getLeagueTrades(activeLeagueId, 'under_review'),
      ]);

      const reviewOffers = (reviewResult?.data || []) as TradeOfferWithPlayers[];

      // Merge and de-dupe by id — team offers win on conflicts since they
      // carry richer player/team data when the user is involved.
      const seen = new Set<string>();
      const merged: TradeOfferWithPlayers[] = [];
      for (const o of [...teamOffers, ...reviewOffers]) {
        if (!seen.has(o.id)) {
          seen.add(o.id);
          merged.push(o);
        }
      }
      setTradeOffers(merged);
    } catch (error) {
      logger.error("Failed to load trade offers", error);
      setTradeOffers([]);
    }
  }, [activeLeagueId]);

  useEffect(() => {
    // Guard: Don't run if user is still loading or league context is not ready
    if (user === undefined || activeLeagueId === undefined) {
      return;
    }

    let isMounted = true;
    
    const fetchData = async () => {
      setLoading(true);
      
      try {
        // STEP 1: Check draft status FIRST - if not completed, show message and STOP
        if (activeLeagueId) {
          const { data: leagueData } = await leagueApi.getLeague(activeLeagueId) as { data?: { draft_status: string } };

          if (leagueData && leagueData.draft_status !== 'completed') {
            if (isMounted) {
              setDraftNotCompleted(true);
              setLoading(false);
            }
            return; // STOP - don't do anything else
          }
        }
        
        // STEP 2: Only if draft is completed, load the rest
        const allPlayers = await PlayerService.getAllPlayers();
        if (!isMounted) return;

        if (user && activeLeagueId) {
          // Real league: load from database
          const { data: myTeamData } = await leagueApi.getMyTeam(activeLeagueId) as { data?: { id: string; team_name: string } };

          if (myTeamData && isMounted) {
            setMyTeamId(myTeamData.id);
            loadTradeOffers(myTeamData.id)
              .then(() => {
                if (isMounted) setTradeOffersError(false);
              })
              .catch(() => {
                if (isMounted) setTradeOffersError(true);
              });
          }
          if (!isMounted) return;

          // Load all teams in the league
          const { data: leagueTeams } = await leagueApi.getTeams(activeLeagueId) as { data?: { id: string; team_name: string; owner_id: string }[] };

          if (!leagueTeams || !isMounted) return;

          // Load roster assignments for all teams in this league
          const { data: rosterAssignments } = await rosterApi.getLeagueRosters(activeLeagueId) as { data?: { team_id: string; player_id: string }[] };

          if (!isMounted) return;

          // Build a map of team_id -> player IDs
          const teamRosters = new Map<string, string[]>();
          (rosterAssignments || []).forEach((ra: { team_id: string; player_id: string }) => {
            const existing = teamRosters.get(ra.team_id) || [];
            existing.push(ra.player_id);
            teamRosters.set(ra.team_id, existing);
          });

          // Build player lookup by ID
          const playerMap = new Map<string, Player>();
          allPlayers.forEach(p => playerMap.set(String(p.id), p));

          // Set my team roster
          // SWEEP FIX (2026-08-16): roster_assignments.player_id arrives as a
          // NUMBER over JSON while playerMap keys are String(p.id) — the raw
          // .get(id) missed every lookup, so real-league trade rosters always
          // rendered "No players found". Coerce to string on every lookup.
          const myPlayerIds = myTeamData ? (teamRosters.get(myTeamData.id) || []) : [];
          const myRoster = myPlayerIds.map(id => playerMap.get(String(id))).filter((p): p is Player => !!p);
          setMyTeamRoster(myRoster);

          // Build opponent teams
          const opponents: LeagueTeam[] = leagueTeams
            .filter(t => t.id !== myTeamData?.id)
            .map((t, idx) => {
              const playerIds = teamRosters.get(t.id) || [];
              const roster = playerIds.map(id => playerMap.get(String(id))).filter((p): p is Player => !!p);
              return {
                id: t.id as unknown as number,
                name: t.team_name || `Team ${idx + 1}`,
                owner: t.owner_id || 'Unknown',
                logo: t.team_name?.substring(0, 2).toUpperCase() || '??',
                record: { wins: 0, losses: 0 },
                points: 0,
                streak: '',
                roster
              };
            });
          setOpponentTeams(opponents);
        } else {
          // Demo/guest mode: use static demo data
          const teams = await LeagueService.getAllTeamsWithRosters(allPlayers);
          if (!isMounted) return;
          const myTeam = await LeagueService.getMyTeam(allPlayers);
          if (!isMounted) return;
          setMyTeamRoster(myTeam);
          setOpponentTeams(teams.filter(t => t.id !== 3));
        }
      } catch (error) {
        logger.error("[TradeAnalyzer] Error:", error);
        if (isMounted) {
          toast({
            title: "Trade Data Won't Load",
            description: "Couldn't load the trade data — refresh and we'll pick it back up.",
            variant: "destructive"
          });
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };
    
    fetchData();
    
    return () => {
      isMounted = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchData is inline with isMounted guard; service calls are stable module imports
  }, [user?.id, activeLeagueId, loadTradeOffers, toast]);

  const handleProposeTrade = async () => {
    if (!myTeamId || !activeLeagueId || !selectedTeamId || 
        mySelectedPlayers.length === 0 || theirSelectedPlayers.length === 0) {
      toast({
        title: "Invalid Trade",
        description: "Please select players from both teams",
        variant: "destructive"
      });
      return;
    }

    const result = await TradeService.createTradeOffer(
      activeLeagueId,
      myTeamId,
      String(selectedTeamId),
      mySelectedPlayers.map(Number),
      theirSelectedPlayers.map(Number),
      tradeMessage || undefined
    );

    if (result.success) {
      toast({
        title: "Trade Proposed",
        description: "Your trade offer has been sent",
      });
      setMySelectedPlayers([]);
      setTheirSelectedPlayers([]);
      setTradeMessage('');
      if (myTeamId) {
        await loadTradeOffers(myTeamId);
      }
      setActiveTab('offers');
    } else {
      toast({
        title: "Trade Failed",
        description: result.error,
        variant: "destructive"
      });
    }
  };

  const handleAcceptTrade = async (tradeId: string) => {
    const result = await TradeService.acceptTradeOffer(tradeId, user?.id);
    
    if (result.success) {
      toast({
        title: "Trade Accepted",
        description: "The trade has been completed",
      });
      // 2026-08-24: an accepted trade changes BOTH rosters — broadcast so the
      // Roster page (and everything else) refetches fresh, no hard reload.
      try {
        const { notifyRosterChanged } = await import('@/utils/rosterRefresh');
        notifyRosterChanged(undefined, activeLeagueId ?? undefined);
      } catch { /* best-effort */ }
      if (myTeamId) {
        await loadTradeOffers(myTeamId);
      }
    } else {
      toast({
        title: "Trade Failed",
        description: result.error,
        variant: "destructive"
      });
    }
  };

  const handleRejectTrade = async (tradeId: string) => {
    const result = await TradeService.rejectTradeOffer(tradeId, user?.id);
    
    if (result.success) {
      toast({
        title: "Trade Rejected",
        description: "The trade offer has been declined",
      });
      if (myTeamId) {
        await loadTradeOffers(myTeamId);
      }
    } else {
      toast({
        title: "Action Failed",
        description: result.error,
        variant: "destructive"
      });
    }
  };

  const handleCancelTrade = async (tradeId: string) => {
    const result = await TradeService.cancelTradeOffer(tradeId, user?.id);
    
    if (result.success) {
      toast({
        title: "Trade Cancelled",
        description: "Your trade offer has been cancelled",
      });
      if (myTeamId) {
        await loadTradeOffers(myTeamId);
      }
    } else {
      toast({
        title: "Action Failed",
        description: result.error,
        variant: "destructive"
      });
    }
  };

  useEffect(() => {
    const partnerId = searchParams.get('partner');
    if (partnerId) {
      setSelectedTeamId(Number(partnerId));
    }
  }, [searchParams]);

  const [mySelectedPlayers, setMySelectedPlayers] = useState<string[]>([]); // Use String ID for consistency
  const [theirSelectedPlayers, setTheirSelectedPlayers] = useState<string[]>([]);
  const [searchMyTeam, setSearchMyTeam] = useState("");
  const [searchTheirTeam, setSearchTheirTeam] = useState("");

  const selectedPartnerTeam = useMemo(() =>
    opponentTeams.find(t => String(t.id) === String(selectedTeamId)),
    [selectedTeamId, opponentTeams]
  );

  // Redirect pool leagues to their pool page
  const _poolType = activeLeagueFormat?.leagueType;
  if (isPoolLeague(_poolType) && activeLeagueId) {
    return <Navigate to={getPoolRoute(_poolType!, activeLeagueId)} replace />;
  }

  const toggleMyPlayer = (id: string) => {
    setMySelectedPlayers(prev => 
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  };

  const toggleTheirPlayer = (id: string) => {
    setTheirSelectedPlayers(prev => 
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  };

  // Helper to convert Player to HockeyPlayer for the modal
  const toHockeyPlayer = (p: Player): HockeyPlayer => ({
    id: p.id,
    name: p.full_name,
    position: p.position,
    number: parseInt(p.jersey_number || '0'),
    starter: false,
    stats: {
      goals: p.goals || 0,
      assists: p.assists || 0,
      points: p.points || 0,
      plusMinus: p.plus_minus || 0,
      shots: p.shots || 0,
      hits: p.hits || 0,
      blockedShots: p.blocks || 0,
      wins: p.wins || 0,
      losses: p.losses || 0,
      otl: p.ot_losses || 0,
      gaa: p.goals_against_average || 0,
      savePct: p.save_percentage || 0,
      // STAT-GRID FIX (2026-08-22, found live on prod during launch QA):
      // these three were never wired here, so the player modal showed a
      // goalie with 31 W / 2.02 GAA next to GP 0 / SV 0 / SO 0.
      gamesPlayed: (p.position === 'G' ? (p.goalie_gp ?? p.games_played) : p.games_played) || 0,
      saves: p.saves || 0,
      shutouts: p.shutouts || 0,
      // STAT-GRID FIX 2 (2026-08-23 final audit): skater special-teams +
      // penalty stats were also never wired — McDavid's card showed PPP 0.
      powerPlayPoints: p.ppp || 0,
      shortHandedPoints: p.shp || 0,
      pim: p.pim || 0,
      xGoals: p.xGoals || 0
    },
    team: p.team,
    teamAbbreviation: p.team,
    status: p.status === 'injured' ? 'IR' : null,
    image: p.headshot_url || undefined,
    projectedPoints: p.games_played > 0
      ? new ScoringCalculator().calculatePointsPerGame({
          goals: p.goals || 0,
          assists: p.assists || 0,
          shots: p.shots || 0,
          blocks: p.blocks || 0,
          hits: p.hits || 0,
          pim: p.pim || 0,
          ppp: p.ppp || 0,
          shp: p.shp || 0
        }, false, p.games_played)
      : 0
  });

  const handlePlayerClick = (e: React.MouseEvent, player: Player) => {
    e.stopPropagation(); // Prevent row selection
    setSelectedPlayerForStats(toHockeyPlayer(player));
    setIsPlayerDialogOpen(true);
  };

  const getPlayerById = (id: string, roster: Player[]) => roster.find(p => p.id === id);

  const myAssets = mySelectedPlayers
    .map(id => getPlayerById(id, myTeamRoster))
    .filter((p): p is Player => !!p);

  const theirAssets = selectedPartnerTeam 
    ? theirSelectedPlayers
        .map(id => getPlayerById(id, selectedPartnerTeam.roster))
        .filter((p): p is Player => !!p)
    : [];

  // Recalculate value metric (simple points approximation for now)
  const calculateValue = (p: Player) => (p.points || 0);

  const myTotalValue = myAssets.reduce((sum, p) => sum + calculateValue(p), 0);
  const theirTotalValue = theirAssets.reduce((sum, p) => sum + calculateValue(p), 0);
  const valueDiff = theirTotalValue - myTotalValue;
  const isFair = Math.abs(valueDiff) < 20; // Adjusted threshold
  
  const filteredMyTeam = myTeamRoster.filter(p =>
    p.full_name.toLowerCase().includes(searchMyTeam.toLowerCase())
  );

  const filteredTheirTeam = selectedPartnerTeam?.roster.filter(p =>
    p.full_name.toLowerCase().includes(searchTheirTeam.toLowerCase())
  ) || [];

  const getTradeOpinion = () => {
    if (myAssets.length === 0 && theirAssets.length === 0) return "Select players to analyze trade.";
    
    // Positional Analysis
    const myPositions = myAssets.reduce((acc, p) => ({ ...acc, [p.position]: (acc[p.position] || 0) + 1 }), {} as Record<string, number>);
    const theirPositions = theirAssets.reduce((acc, p) => ({ ...acc, [p.position]: (acc[p.position] || 0) + 1 }), {} as Record<string, number>);
    
    const gainingForwards = (theirPositions['C'] || 0) + (theirPositions['LW'] || 0) + (theirPositions['RW'] || 0);
    const losingForwards = (myPositions['C'] || 0) + (myPositions['LW'] || 0) + (myPositions['RW'] || 0);
    const gainingDefense = (theirPositions['D'] || 0);
    const losingDefense = (myPositions['D'] || 0);

    // Stat Impact
    const myGoals = myAssets.reduce((sum, p) => sum + (p.goals || 0), 0);
    const theirGoals = theirAssets.reduce((sum, p) => sum + (p.goals || 0), 0);
    const goalsDiff = theirGoals - myGoals;

    let narrative = "This trade offers an interesting shift in your team's composition. ";

    if (gainingDefense > losingDefense && losingForwards > gainingForwards) {
        narrative += "You are bolstering your defensive core at the expense of some offensive firepower. This could stabilize your weekly floor but might lower your scoring ceiling. ";
    } else if (gainingForwards > losingForwards && losingDefense > gainingDefense) {
        narrative += "You are adding significant offensive depth, but be careful not to leave your defense too thin. Ensure you have waiver wire options to fill the gap. ";
    } else if (gainingForwards === losingForwards && gainingDefense === losingDefense) {
        narrative += "This is a direct positional swap. You're betting on better performance from the incoming players. ";
    }

    if (goalsDiff > 5) {
        narrative += "You're gaining significant goal-scoring upside here. ";
    } else if (goalsDiff < -5) {
        narrative += "Note that you are trading away a primary goal scorer. ";
    }

    if (isFair) {
        narrative += "Overall, the value exchange is quite balanced, making this a fair proposal for both sides.";
    } else if (valueDiff > 30) {
        narrative += "From a pure value perspective, you are coming out ahead, acquiring more proven assets.";
    } else if (valueDiff < -30) {
        narrative += "You are giving up more established value. Make sure you believe in the upside of the players you are receiving.";
    } else {
        narrative += "The value is relatively close, so this comes down to team needs and personal preference.";
    }

    return narrative;
  };

  return (
    <div className="min-h-screen bg-[#0F1F15] flex flex-col">
      <div className="hidden lg:block"><Navbar /></div>
      <div className="lg:hidden sticky top-0 z-40 bg-[#0F1F15]/95 backdrop-blur-xl border-b border-white/10 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-center h-12 px-4">
          <h1 className="text-lg font-bold text-pastel-cream">Trade Center</h1>
        </div>
      </div>
      <main className="w-full lg:pt-24 lg:pb-8 pb-[calc(5rem+env(safe-area-inset-bottom))]">
        <div className="w-full m-0 p-0">
          <div className="flex flex-col lg:grid lg:grid-cols-[200px_1fr_260px] xl:grid-cols-[220px_1fr_280px] lg:gap-4 xl:gap-6 lg:px-4 xl:px-6 lg:mx-0 lg:w-screen lg:relative lg:left-1/2 lg:-translate-x-1/2">
            <div className="min-w-0 px-2 lg:px-6 order-1 lg:order-2">
              {/* Loading State */}
              {loading && (
                <div className="flex items-center justify-center py-20">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-pastel-orange mx-auto mb-4"></div>
                    <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold mb-2">✦ Working</div>
                    <p className="text-white/55">Loading trade analyzer…</p>
                  </div>
                </div>
              )}

              {/* Draft Not Completed Message */}
              {!loading && draftNotCompleted && (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <Card className="max-w-2xl w-full bg-[#1A2A20] border-0 ring-1 ring-pastel-orange/40 rounded-2xl shadow-[0_24px_60px_-16px_rgba(255,168,87,0.3)] relative overflow-hidden">
                    <div aria-hidden="true" className="absolute top-0 right-0 w-64 h-64 bg-pastel-orange/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />
                    <CardHeader className="relative z-10">
                      <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold mb-2 flex items-center justify-center gap-2">
                        <ShieldAlert className="w-3.5 h-3.5" />
                        ✦ Locked
                      </div>
                      <CardTitle className="font-calistoga text-2xl text-pastel-cream flex items-center justify-center gap-3">
                        Draft Not Completed
                      </CardTitle>
                      <CardDescription className="text-base text-white/70 mt-3">
                        The league draft must be completed before you can use the Trade Analyzer.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4 relative z-10">
                      <p className="text-white/55 text-sm">
                        Once the draft is finished and rosters are populated, you'll be able to:
                      </p>
                      <ul className="list-disc list-inside space-y-2 text-left max-w-md mx-auto text-white/70 text-sm marker:text-pastel-orange">
                        <li>Analyze trades with other teams</li>
                        <li>Get a verdict on value, depth and stat impact</li>
                        <li>View trade offers and proposals</li>
                      </ul>
                      {activeLeagueId && (
                        <div className="pt-4">
                          <Button asChild className="bg-pastel-orange text-[#581E00] hover:bg-pastel-orange-soft font-bold shadow-[0_8px_24px_-8px_rgba(255,168,87,0.5)]">
                            <a href={`/draft-room?league=${activeLeagueId}`}>
                              Go to Draft Room
                            </a>
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* Main Trade Analyzer Content */}
              {!loading && !draftNotCompleted && (
                <>
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 gap-4">
          <div>
            <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold mb-1.5 flex items-center gap-2">
              <ArrowLeftRight className="w-3.5 h-3.5" />
              ✦ Trade Center
            </div>
            <h1 className="font-calistoga text-3xl sm:text-4xl text-pastel-cream leading-none">
              Architect the perfect deal.
            </h1>
            <p className="text-sm text-white/55 mt-2">
              {/* Was "AI-powered analysis". getTradeOpinion() is hand-written
                  logic over real roster numbers — good logic, but not a model,
                  and a capability claim is exactly the kind of thing a reviewer
                  weighs differently from a number. */}
              Compare value, position depth and stat impact across both sides.
            </p>
          </div>
        </div>

        {/* Demo Mode Banner */}
        {isGuestMode(userLeagueState) && (
          <div className="mb-6">
            <LeagueCreationCTA
              title="You're viewing demo trade analyzer"
              description="Sign up to analyze trades against your actual roster."
              variant="compact"
            />
          </div>
        )}

        {/* Tabs: Propose / Trade Offers */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-4">
          <TabsList className="w-full md:w-auto bg-[#1A2A20] ring-1 ring-white/10 p-1 rounded-xl">
            <TabsTrigger
              value="propose"
              className="flex items-center gap-2 text-white/55 hover:text-pastel-cream font-bold data-[state=active]:bg-pastel-orange data-[state=active]:text-[#581E00] data-[state=active]:shadow-[0_4px_12px_-4px_rgba(255,168,87,0.4)]"
            >
              <ArrowLeftRight className="h-4 w-4" /> Propose Trade
            </TabsTrigger>
            <TabsTrigger
              value="offers"
              className="flex items-center gap-2 relative text-white/55 hover:text-pastel-cream font-bold data-[state=active]:bg-pastel-orange data-[state=active]:text-[#581E00] data-[state=active]:shadow-[0_4px_12px_-4px_rgba(255,168,87,0.4)]"
            >
              <History className="h-4 w-4" /> Trade Offers
              {tradeOffers.filter(o => o.status === 'pending').length > 0 && (
                <Badge className="ml-1 h-5 min-w-[20px] px-1 text-[11px] bg-red-400/20 ring-1 ring-red-400/40 text-red-300 font-jbmono">
                  {tradeOffers.filter(o => o.status === 'pending').length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="propose" className="mt-4">
          <div className="flex flex-col md:flex-row md:items-center gap-3 mb-6">
            <div className="w-full md:w-72">
              <Select value={String(selectedTeamId)} onValueChange={(val) => {
                setSelectedTeamId(val);
                setTheirSelectedPlayers([]);
              }}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select Trading Partner" />
                </SelectTrigger>
                <SelectContent>
                  {opponentTeams.map(team => (
                    <SelectItem key={team.id} value={String(team.id)}>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="w-8 justify-center">{team.logo}</Badge>
                        <span>{team.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 md:ml-auto">
              <span className="text-[10px] font-jbmono uppercase tracking-[0.22em] font-bold text-white/55">View</span>
              <ToggleGroup
                type="single"
                value={viewMode}
                onValueChange={(val) => val && setViewMode(val as 'list' | 'grid')}
                className="bg-[#1A2A20] ring-1 ring-white/10 rounded-lg p-0.5"
              >
                <ToggleGroupItem
                  value="list"
                  aria-label="List view"
                  className="h-8 px-3 text-white/55 hover:text-pastel-cream data-[state=on]:bg-pastel-orange data-[state=on]:text-[#0F1F15] data-[state=on]:shadow-[0_4px_12px_-4px_rgba(255,168,87,0.4)]"
                >
                  <ListIcon className="h-4 w-4 mr-1" /> List
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="grid"
                  aria-label="Grid view"
                  className="h-8 px-3 text-white/55 hover:text-pastel-cream data-[state=on]:bg-pastel-orange data-[state=on]:text-[#0F1F15] data-[state=on]:shadow-[0_4px_12px_-4px_rgba(255,168,87,0.4)]"
                >
                  <LayoutGrid className="h-4 w-4 mr-1" /> Grid
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>

        {/* 2026-08-24 click-sweep fix: the fixed h-[calc(100vh-240px)] applied at
            ALL widths, but the 12-col layout only exists at lg+. Below lg the
            three stacked cards overflowed the fixed-height grid and painted
            straight through the translucent footer. Height is now lg-scoped so
            mobile/tablet flows naturally. */}
        {viewMode === 'list' ? (
        <div className="grid lg:grid-cols-12 gap-6 lg:h-[calc(100vh-240px)] lg:min-h-[600px]">
          {/*
            * MOBILE ORDER: my roster, their roster, then the proposal.
            *
            * The DOM order is the three desktop columns — mine, proposal,
            * theirs — which is right when they sit side by side. Stacked on a
            * phone it put the partner's roster about a thousand pixels BELOW
            * the proposal box you are supposed to fill from it, so building a
            * trade meant scrolling past the empty thing you were filling to
            * reach the players you were filling it with.
            */}
          {/* Left Column: My Team */}
          <Card className="order-1 lg:order-none lg:col-span-3 flex flex-col h-full bg-[#1A2A20] border-0 ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2 font-calistoga text-pastel-cream">
                <Badge className="bg-pastel-orange/20 ring-1 ring-pastel-orange/40 text-pastel-orange-soft text-[10px] font-jbmono uppercase tracking-[0.18em] font-bold border-0">You</Badge>
                My Team
              </CardTitle>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-white/55" />
                <Input
                  placeholder="Search players…"
                  className="pl-8 bg-white/5 border-white/10 text-pastel-cream placeholder:text-white/55 focus-visible:ring-pastel-orange/40"
                  value={searchMyTeam}
                  onChange={(e) => setSearchMyTeam(e.target.value)}
                />
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden p-0">
              <ScrollArea className="h-full px-4 pb-4">
                <div className="space-y-2">
                  {filteredMyTeam.map(player => {
                    const isSelected = mySelectedPlayers.includes(player.id);
                    return (
                      <div
                        key={player.id}
                        onClick={() => toggleMyPlayer(player.id)}
                        className={`flex items-center justify-between p-3 rounded-xl ring-1 cursor-pointer transition-colors group ${
                          isSelected
                            ? 'bg-red-400/15 ring-red-400/40'
                            : 'bg-white/5 ring-white/10 hover:bg-white/[0.08]'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <Avatar className="h-9 w-9 cursor-pointer hover:ring-2 hover:ring-pastel-orange shrink-0" onClick={(e) => handlePlayerClick(e, player)}>
                            <AvatarImage src={player.headshot_url} />
                            <AvatarFallback className="bg-pastel-orange/20 text-pastel-orange-soft text-xs font-bold">{player.full_name.substring(0,2)}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <div
                              className="font-bold text-sm text-pastel-cream hover:text-pastel-orange cursor-pointer truncate"
                              onClick={(e) => handlePlayerClick(e, player)}
                            >
                              {player.full_name}
                            </div>
                            <div className="text-xs text-white/55 tabular-nums">{player.position} · {player.points} pts</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                           <Button size="icon" variant="ghost" className="h-9 w-9 text-white/55 hover:text-pastel-cream hover:bg-white/5 touch-manipulation" onClick={(e) => handlePlayerClick(e, player)}>
                             <Info className="h-4 w-4" />
                           </Button>
                           {isSelected ? (
                             <CheckCircle2 className="h-5 w-5 text-red-300" />
                           ) : (
                             <UserPlus className="h-5 w-5 text-white/55 opacity-0 group-hover:opacity-100 transition-opacity" />
                           )}
                        </div>
                      </div>
                    );
                  })}
                  {filteredMyTeam.length === 0 && (
                    <div className="text-center p-4 text-white/55 text-sm">
                      {loading ? "Loading roster…" : "No players found"}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Middle Column: Trade Deck */}
          <div className="order-3 lg:order-none lg:col-span-6 flex flex-col gap-6 h-full overflow-y-auto">
            {/* Trade Area */}
            <Card className="flex-1 bg-[#1A2A20] border-0 ring-1 ring-pastel-orange/20 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)] flex flex-col overflow-hidden">
              <CardHeader className="border-b border-white/10 bg-white/[0.03] pb-4">
                <div className="flex justify-between items-center gap-3 flex-wrap">
                  <CardTitle className="flex items-center gap-2 font-calistoga text-pastel-cream">
                    <Scale className="h-5 w-5 text-pastel-orange" /> Trade Proposal
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    {selectedPartnerTeam && (
                      <Badge className={`text-[10px] font-jbmono uppercase tracking-[0.18em] font-bold border-0 ${isFair ? 'bg-pastel-sage/20 ring-1 ring-pastel-sage/40 text-pastel-sage-soft' : 'bg-amber-400/20 ring-1 ring-amber-400/40 text-amber-300'}`}>
                        {Math.abs(valueDiff) < 10 ? "Balanced Deal" : "Trade Impact"}
                      </Badge>
                    )}
                    {/* Desktop only. In the three-column layout this sits
                        beside the proposal and reads as a header action. Stacked
                        on a phone it becomes a second identical "Submit Trade
                        Offer" about 450px above the real one, both disabled,
                        with the empty drop zones you have not filled in between
                        them. One button, at the end of the flow. */}
                    <Button
                      size="sm"
                      className="hidden lg:inline-flex bg-pastel-orange text-[#581E00] hover:bg-pastel-orange-soft font-bold shadow-[0_4px_12px_-4px_rgba(255,168,87,0.4)] disabled:opacity-50"
                      disabled={myAssets.length === 0 || theirAssets.length === 0 || !selectedPartnerTeam}
                      onClick={handleProposeTrade}
                    >
                      <Send className="h-4 w-4 mr-2" /> Submit Trade Offer
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="flex-1 p-6 grid md:grid-cols-2 gap-8 relative">
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 hidden md:flex h-10 w-10 bg-[#0F1F15] ring-1 ring-pastel-orange/40 rounded-full items-center justify-center shadow-[0_4px_12px_-4px_rgba(255,168,87,0.3)]">
                  <ArrowLeftRight className="h-4 w-4 text-pastel-orange" />
                </div>

                {/* Receiving */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-pastel-sage-soft flex items-center gap-2 text-sm">
                      <TrendingUp className="h-4 w-4" /> You Receive
                    </h3>
                    <span className="text-[10px] font-jbmono uppercase tracking-[0.22em] text-white/55 tabular-nums">Val · {theirTotalValue}</span>
                  </div>
                  <div className="min-h-[120px] space-y-2">
                    {theirAssets.length === 0 ? (
                      <div className="h-full border-2 border-dashed border-white/15 rounded-xl flex items-center justify-center text-white/55 text-sm p-8 text-center">
                        Select players from {selectedPartnerTeam ? selectedPartnerTeam.name : 'opponent'}
                      </div>
                    ) : (
                      theirAssets.map(p => (
                        <div key={p.id} className="flex items-center justify-between p-2.5 rounded-xl bg-pastel-sage/10 ring-1 ring-pastel-sage/30">
                          <div className="flex items-center gap-2 min-w-0">
                             <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-jbmono uppercase tracking-[0.18em] bg-transparent border-pastel-sage/40 text-pastel-sage-soft shrink-0">{p.position}</Badge>
                             <span className="text-sm font-bold text-pastel-cream cursor-pointer hover:text-pastel-orange truncate" onClick={(e) => handlePlayerClick(e, p)}>{p.full_name}</span>
                          </div>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-white/55 hover:text-red-300 hover:bg-red-400/10 touch-manipulation shrink-0" onClick={() => toggleTheirPlayer(p.id)}>
                            <UserMinus className="h-4 w-4" />
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Giving */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-red-300 flex items-center gap-2 text-sm">
                      <TrendingDown className="h-4 w-4" /> You Send
                    </h3>
                    <span className="text-[10px] font-jbmono uppercase tracking-[0.22em] text-white/55 tabular-nums">Val · {myTotalValue}</span>
                  </div>
                  <div className="min-h-[120px] space-y-2">
                    {myAssets.length === 0 ? (
                      <div className="h-full border-2 border-dashed border-white/15 rounded-xl flex items-center justify-center text-white/55 text-sm p-8 text-center">
                        Select players to trade away
                      </div>
                    ) : (
                      myAssets.map(p => (
                        <div key={p.id} className="flex items-center justify-between p-2.5 rounded-xl bg-red-400/10 ring-1 ring-red-400/30">
                          <div className="flex items-center gap-2 min-w-0">
                             <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-jbmono uppercase tracking-[0.18em] bg-transparent border-red-400/40 text-red-300 shrink-0">{p.position}</Badge>
                             <span className="text-sm font-bold text-pastel-cream cursor-pointer hover:text-pastel-orange truncate" onClick={(e) => handlePlayerClick(e, p)}>{p.full_name}</span>
                          </div>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-white/55 hover:text-red-300 hover:bg-red-400/10 touch-manipulation shrink-0" onClick={() => toggleMyPlayer(p.id)}>
                            <UserMinus className="h-4 w-4" />
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Analysis Section */}
            <Card className="bg-[#0F1F15] text-pastel-cream border-0 ring-1 ring-pastel-orange/30 rounded-2xl shadow-[0_16px_40px_-12px_rgba(255,168,87,0.15)] relative overflow-hidden">
              <div aria-hidden="true" className="absolute top-0 right-0 w-64 h-64 bg-pastel-orange/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />
              <CardHeader className="pb-2 relative z-10">
                <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold mb-1">
                  ✦ Stormy's Take
                </div>
                <CardTitle className="text-lg flex items-center gap-2 font-calistoga text-pastel-cream">
                  <ShieldAlert className="h-5 w-5 text-pastel-orange" /> Trade Analysis
                </CardTitle>
              </CardHeader>
              <CardContent className="relative z-10">
                <div className="space-y-4">
                  <p className="text-white/70 text-sm leading-relaxed">
                    {getTradeOpinion()}
                  </p>

                  {(myAssets.length > 0 || theirAssets.length > 0) && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                      {(() => {
                        const goalsDiff = theirAssets.reduce((s,p)=>s+(p.goals||0),0) - myAssets.reduce((s,p)=>s+(p.goals||0),0);
                        return (
                          <div className="text-center p-3 bg-white/5 ring-1 ring-white/10 rounded-xl">
                             <div className="text-[10px] font-jbmono uppercase tracking-[0.22em] text-white/55">Goals Diff</div>
                             <div className={`font-calistoga text-2xl tabular-nums mt-1 ${goalsDiff > 0 ? 'text-pastel-sage-soft' : goalsDiff < 0 ? 'text-red-300' : 'text-pastel-cream'}`}>
                               {goalsDiff > 0 ? '+' : ''}{goalsDiff}
                             </div>
                          </div>
                        );
                      })()}
                      <div className="text-center p-3 bg-white/5 ring-1 ring-white/10 rounded-xl">
                        <div className="text-[10px] font-jbmono uppercase tracking-[0.22em] text-white/55">Total Pts</div>
                        <div className="font-calistoga text-2xl text-pastel-cream tabular-nums mt-1">
                            {theirTotalValue - myTotalValue}
                        </div>
                      </div>
                      <div className="text-center p-3 bg-white/5 ring-1 ring-white/10 rounded-xl">
                        <div className="text-[10px] font-jbmono uppercase tracking-[0.22em] text-white/55">Structure</div>
                        <div className="font-calistoga text-2xl text-pastel-orange mt-1">
                             {myAssets.length === theirAssets.length ? "Swap" : myAssets.length > theirAssets.length ? "Consolidate" : "Depth"}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Was "Add a message to your trade offer (optional)", which
                      clipped mid-word at 393px. */}
                  <Input
                    placeholder="Add a message (optional)"
                    className="bg-white/5 border-white/10 text-pastel-cream placeholder:text-white/55 focus-visible:ring-pastel-orange/40"
                    value={tradeMessage}
                    onChange={(e) => setTradeMessage(e.target.value)}
                  />
                  <Button
                    className="w-full bg-pastel-orange text-[#581E00] hover:bg-pastel-orange-soft font-bold shadow-[0_8px_24px_-8px_rgba(255,168,87,0.5)] mt-2 disabled:opacity-50"
                    disabled={myAssets.length === 0 || theirAssets.length === 0 || !selectedPartnerTeam}
                    onClick={handleProposeTrade}
                  >
                    <Send className="h-4 w-4 mr-2" /> Submit Trade Offer
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right Column: Their Team */}
          <Card className={`order-2 lg:order-none lg:col-span-3 flex flex-col h-full bg-[#1A2A20] border-0 ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)] transition-opacity ${!selectedPartnerTeam ? 'opacity-60 pointer-events-none' : ''}`}>
            <CardHeader className="pb-3">
               <CardTitle className="text-lg flex items-center gap-2 font-calistoga text-pastel-cream">
                {selectedPartnerTeam ? (
                   <>
                     <Badge className="bg-pastel-sage/20 ring-1 ring-pastel-sage/40 text-pastel-sage-soft text-[10px] font-jbmono uppercase tracking-[0.18em] font-bold border-0 shrink-0">{selectedPartnerTeam.logo}</Badge>
                     <span className="truncate">{selectedPartnerTeam.name}</span>
                   </>
                ) : (
                  <span className="text-white/55">Partner Team</span>
                )}
              </CardTitle>
               <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-white/55" />
                <Input
                  placeholder="Search their players…"
                  className="pl-8 bg-white/5 border-white/10 text-pastel-cream placeholder:text-white/55 focus-visible:ring-pastel-orange/40 disabled:opacity-50"
                  value={searchTheirTeam}
                  onChange={(e) => setSearchTheirTeam(e.target.value)}
                  disabled={!selectedPartnerTeam}
                />
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden p-0">
               {selectedPartnerTeam ? (
                  <ScrollArea className="h-full px-4 pb-4">
                    <div className="space-y-2">
                      {filteredTheirTeam.map(player => {
                        const isSelected = theirSelectedPlayers.includes(player.id);
                        return (
                          <div
                            key={player.id}
                            onClick={() => toggleTheirPlayer(player.id)}
                            className={`flex items-center justify-between p-3 rounded-xl ring-1 cursor-pointer transition-colors group ${
                              isSelected
                                ? 'bg-pastel-sage/15 ring-pastel-sage/40'
                                : 'bg-white/5 ring-white/10 hover:bg-white/[0.08]'
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <Avatar className="h-9 w-9 cursor-pointer hover:ring-2 hover:ring-pastel-orange shrink-0" onClick={(e) => handlePlayerClick(e, player)}>
                                <AvatarImage src={player.headshot_url} />
                                <AvatarFallback className="bg-pastel-sage/20 text-pastel-sage-soft text-xs font-bold">{player.full_name.substring(0,2)}</AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <div
                                  className="font-bold text-sm text-pastel-cream hover:text-pastel-orange cursor-pointer truncate"
                                  onClick={(e) => handlePlayerClick(e, player)}
                                >
                                  {player.full_name}
                                </div>
                                <div className="text-xs text-white/55 tabular-nums">{player.position} · {player.points} pts</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                               <Button size="icon" variant="ghost" className="h-9 w-9 text-white/55 hover:text-pastel-cream hover:bg-white/5 touch-manipulation" onClick={(e) => handlePlayerClick(e, player)}>
                                 <Info className="h-4 w-4" />
                               </Button>
                               {isSelected ? (
                                 <CheckCircle2 className="h-4 w-4 text-pastel-sage-soft" />
                               ) : (
                                 <UserPlus className="h-4 w-4 text-white/55 opacity-0 group-hover:opacity-100 transition-opacity" />
                               )}
                            </div>
                          </div>
                        );
                      })}
                      {filteredTheirTeam.length === 0 && (
                        <div className="text-center p-4 text-white/55 text-sm">No players found</div>
                      )}
                    </div>
                  </ScrollArea>
               ) : (
                 <div className="flex flex-col items-center justify-center h-full text-white/55 p-6 text-center">
                   <ArrowLeftRight className="h-12 w-12 mb-4 text-pastel-orange/30" />
                   <p className="text-sm">Select a trading partner to view their roster</p>
                 </div>
               )}
            </CardContent>
          </Card>
        </div>
        ) : (
        <TradeGridView
          myTeamRoster={myTeamRoster}
          opponentTeams={opponentTeams}
          selectedPartnerTeam={selectedPartnerTeam}
          mySelectedPlayers={mySelectedPlayers}
          theirSelectedPlayers={theirSelectedPlayers}
          onToggleMyPlayer={toggleMyPlayer}
          onToggleTheirPlayer={toggleTheirPlayer}
          onSelectPartner={(teamId) => {
            setSelectedTeamId(teamId);
            setTheirSelectedPlayers([]);
          }}
          onPlayerClick={(player) => {
            setSelectedPlayerForStats(toHockeyPlayer(player));
            setIsPlayerDialogOpen(true);
          }}
          getPositionColor={getPositionColor}
          myTotalValue={myTotalValue}
          theirTotalValue={theirTotalValue}
          isFair={isFair}
          valueDiff={valueDiff}
          tradeMessage={tradeMessage}
          onTradeMessageChange={setTradeMessage}
          onSubmit={handleProposeTrade}
          myAssets={myAssets}
          theirAssets={theirAssets}
        />
        )}

        {/* Player Stats Modal */}
        <PlayerStatsModal
          player={selectedPlayerForStats}
          isOpen={isPlayerDialogOpen}
          onClose={() => setIsPlayerDialogOpen(false)}
        />
          </TabsContent>

          {/* Trade Offers Tab */}
          <TabsContent value="offers" className="mt-4">
            <div className="space-y-6">
              {/* Trades under league-vote review (user not involved) — shows for any league member */}
              <TradeReviewSection
                tradeOffers={tradeOffers}
                myTeamId={myTeamId}
                onVoted={() => (myTeamId ? loadTradeOffers(myTeamId) : Promise.resolve())}
              />

              {tradeOffers.length === 0 && tradeOffersError ? (
                <Card
                  className="p-8 text-center bg-[#1A2A20] border-0 ring-1 ring-destructive/30 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]"
                  data-testid="trade-offers-error"
                >
                  <History className="h-12 w-12 mx-auto mb-4 text-destructive/40" />
                  <h3 className="font-calistoga text-xl text-destructive mb-1">
                    Couldn&apos;t load your trade offers
                  </h3>
                  <p className="text-sm text-white/55 mb-4">
                    This is a connection problem — you may still have offers waiting.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="trade-offers-retry"
                    onClick={() => {
                      if (!myTeamId) return;
                      loadTradeOffers(myTeamId)
                        .then(() => setTradeOffersError(false))
                        .catch(() => setTradeOffersError(true));
                    }}
                  >
                    Retry
                  </Button>
                </Card>
              ) : tradeOffers.length === 0 ? (
                <Card className="p-8 text-center bg-[#1A2A20] border-0 ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                  <History className="h-12 w-12 mx-auto mb-4 text-pastel-orange/30" />
                  <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold mb-2">✦ Empty</div>
                  <h3 className="font-calistoga text-xl text-pastel-cream mb-1">No Trade Offers</h3>
                  <p className="text-sm text-white/55">
                    Trade offers you send or receive will appear here.
                  </p>
                </Card>
              ) : (
                <>
                  {/* Pending offers received */}
                  {tradeOffers.filter(o => o.status === 'pending' && o.to_team_id === myTeamId).length > 0 && (
                    <div>
                      <h3 className="font-calistoga text-xl text-pastel-cream mb-3 flex items-center gap-2">
                        <TrendingUp className="h-5 w-5 text-pastel-sage-soft" /> Offers Received
                      </h3>
                      <div className="space-y-3">
                        {tradeOffers
                          .filter(o => o.status === 'pending' && o.to_team_id === myTeamId)
                          .map(offer => (
                            <Card key={offer.id} className="bg-[#1A2A20] border-0 ring-1 ring-pastel-sage/30 rounded-2xl shadow-[0_16px_40px_-12px_rgba(166,211,160,0.15)]">
                              <CardHeader className="pb-2">
                                <div className="flex items-center justify-between gap-2">
                                  <CardTitle className="text-base font-calistoga text-pastel-cream truncate">From: {offer.from_team_name}</CardTitle>
                                  <Badge className="bg-amber-400/20 ring-1 ring-amber-400/40 text-amber-300 border-0 text-[10px] font-jbmono uppercase tracking-[0.18em] font-bold shrink-0">Pending</Badge>
                                </div>
                                {offer.message && (
                                  <p className="text-sm text-white/55 italic mt-1.5">"{offer.message}"</p>
                                )}
                              </CardHeader>
                              <CardContent className="pb-3">
                                <div className="grid grid-cols-2 gap-4 mb-3">
                                  <div>
                                    <p className="text-[10px] font-jbmono uppercase tracking-[0.22em] font-bold text-pastel-sage-soft mb-2">You Receive</p>
                                    {offer.offered_players.map(p => (
                                      <div key={p.player_id} className="text-sm flex items-center gap-1.5 text-pastel-cream mb-1">
                                        <Badge variant="outline" className="h-4 px-1.5 text-[10px] font-jbmono uppercase tracking-[0.18em] bg-transparent border-pastel-sage/40 text-pastel-sage-soft">{p.position_code}</Badge>
                                        <span className="truncate">{p.full_name}</span>
                                      </div>
                                    ))}
                                  </div>
                                  <div>
                                    <p className="text-[10px] font-jbmono uppercase tracking-[0.22em] font-bold text-red-300 mb-2">You Send</p>
                                    {offer.requested_players.map(p => (
                                      <div key={p.player_id} className="text-sm flex items-center gap-1.5 text-pastel-cream mb-1">
                                        <Badge variant="outline" className="h-4 px-1.5 text-[10px] font-jbmono uppercase tracking-[0.18em] bg-transparent border-red-400/40 text-red-300">{p.position_code}</Badge>
                                        <span className="truncate">{p.full_name}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                                <Separator className="my-2 bg-white/10" />
                                <div className="flex gap-2 pt-1">
                                  <Button size="sm" className="bg-pastel-sage text-[#0F1F15] hover:bg-pastel-sage-soft font-bold" onClick={() => handleAcceptTrade(offer.id)}>
                                    <CheckCircle2 className="h-4 w-4 mr-1" /> Accept
                                  </Button>
                                  <Button size="sm" className="bg-red-400/20 ring-1 ring-red-400/40 text-red-300 hover:bg-red-400/30 font-bold" onClick={() => handleRejectTrade(offer.id)}>
                                    Reject
                                  </Button>
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Pending offers sent */}
                  {tradeOffers.filter(o => o.status === 'pending' && o.from_team_id === myTeamId).length > 0 && (
                    <div>
                      <h3 className="font-calistoga text-xl text-pastel-cream mb-3 flex items-center gap-2">
                        <Send className="h-5 w-5 text-pastel-orange" /> Offers Sent
                      </h3>
                      <div className="space-y-3">
                        {tradeOffers
                          .filter(o => o.status === 'pending' && o.from_team_id === myTeamId)
                          .map(offer => (
                            <Card key={offer.id} className="bg-[#1A2A20] border-0 ring-1 ring-pastel-orange/30 rounded-2xl shadow-[0_16px_40px_-12px_rgba(255,168,87,0.15)]">
                              <CardHeader className="pb-2">
                                <div className="flex items-center justify-between gap-2">
                                  <CardTitle className="text-base font-calistoga text-pastel-cream truncate">To: {offer.to_team_name}</CardTitle>
                                  <Badge className="bg-amber-400/20 ring-1 ring-amber-400/40 text-amber-300 border-0 text-[10px] font-jbmono uppercase tracking-[0.18em] font-bold shrink-0">Pending</Badge>
                                </div>
                                {offer.message && (
                                  <p className="text-sm text-white/55 italic mt-1.5">"{offer.message}"</p>
                                )}
                              </CardHeader>
                              <CardContent className="pb-3">
                                <div className="grid grid-cols-2 gap-4 mb-3">
                                  <div>
                                    <p className="text-[10px] font-jbmono uppercase tracking-[0.22em] font-bold text-red-300 mb-2">You Send</p>
                                    {offer.offered_players.map(p => (
                                      <div key={p.player_id} className="text-sm flex items-center gap-1.5 text-pastel-cream mb-1">
                                        <Badge variant="outline" className="h-4 px-1.5 text-[10px] font-jbmono uppercase tracking-[0.18em] bg-transparent border-red-400/40 text-red-300">{p.position_code}</Badge>
                                        <span className="truncate">{p.full_name}</span>
                                      </div>
                                    ))}
                                  </div>
                                  <div>
                                    <p className="text-[10px] font-jbmono uppercase tracking-[0.22em] font-bold text-pastel-sage-soft mb-2">You Receive</p>
                                    {offer.requested_players.map(p => (
                                      <div key={p.player_id} className="text-sm flex items-center gap-1.5 text-pastel-cream mb-1">
                                        <Badge variant="outline" className="h-4 px-1.5 text-[10px] font-jbmono uppercase tracking-[0.18em] bg-transparent border-pastel-sage/40 text-pastel-sage-soft">{p.position_code}</Badge>
                                        <span className="truncate">{p.full_name}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                                <Button size="sm" variant="outline" className="bg-transparent border border-pastel-cream/30 text-pastel-cream hover:bg-white/5 hover:border-pastel-cream/50" onClick={() => handleCancelTrade(offer.id)}>
                                  Cancel Offer
                                </Button>
                              </CardContent>
                            </Card>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Completed/rejected trades */}
                  {tradeOffers.filter(o => o.status !== 'pending').length > 0 && (
                    <div>
                      <h3 className="font-calistoga text-xl text-white/55 mb-3 flex items-center gap-2">
                        <History className="h-5 w-5" /> Trade History
                      </h3>
                      <div className="space-y-3">
                        {tradeOffers
                          .filter(o => o.status !== 'pending')
                          .map(offer => (
                            <Card key={offer.id} className="bg-[#1A2A20] border-0 ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)] opacity-70">
                              <CardHeader className="pb-2">
                                <div className="flex items-center justify-between gap-2">
                                  <CardTitle className="text-base font-bold text-pastel-cream truncate">
                                    {offer.from_team_id === myTeamId ? `To: ${offer.to_team_name}` : `From: ${offer.from_team_name}`}
                                  </CardTitle>
                                  <Badge className={`text-[10px] font-jbmono uppercase tracking-[0.18em] font-bold border-0 shrink-0 ${offer.status === 'accepted' ? 'bg-pastel-sage/20 ring-1 ring-pastel-sage/40 text-pastel-sage-soft' : 'bg-white/5 ring-1 ring-white/15 text-white/55'}`}>
                                    {offer.status.charAt(0).toUpperCase() + offer.status.slice(1)}
                                  </Badge>
                                </div>
                              </CardHeader>
                              <CardContent className="pb-3">
                                <div className="grid grid-cols-2 gap-4 text-sm text-white/55">
                                  <div>
                                    <p className="text-[10px] font-jbmono uppercase tracking-[0.22em] font-bold text-white/55 mb-1">Offered</p>
                                    {offer.offered_players.map(p => (
                                      <div key={p.player_id}>{p.full_name}</div>
                                    ))}
                                  </div>
                                  <div>
                                    <p className="text-[10px] font-jbmono uppercase tracking-[0.22em] font-bold text-white/55 mb-1">Requested</p>
                                    {offer.requested_players.map(p => (
                                      <div key={p.player_id}>{p.full_name}</div>
                                    ))}
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </TabsContent>
        </Tabs>
                </>
              )}
              </div>

            {/* Left Sidebar - At bottom on mobile, left on desktop */}
            <aside className="w-full lg:w-auto order-2 lg:order-1">
              <div className="lg:sticky lg:top-24 space-y-4 lg:space-y-4">
                {/* Sleeper-style trade tips tile — replaces legacy AdSpace */}
                <div className="bg-[#1A2A20] ring-1 ring-pastel-orange/30 rounded-2xl p-4 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                  <div className="font-jbmono text-[9px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold mb-3">
                    ✦ Trade tips
                  </div>
                  <ul className="space-y-2 text-[11px] text-white/70 leading-relaxed">
                    <li className="flex gap-2"><span className="text-pastel-orange">▸</span> Trade for upside, not name value</li>
                    <li className="flex gap-2"><span className="text-pastel-orange">▸</span> Sell injury-flagged stars before news drops</li>
                    <li className="flex gap-2"><span className="text-pastel-orange">▸</span> 2-for-1 deals concentrate elite scoring</li>
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

export default TradeAnalyzer;
