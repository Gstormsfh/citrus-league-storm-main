import { useState, useMemo, useEffect, useCallback } from 'react';
import { useSearchParams, Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
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
import { AdSpace } from '@/components/AdSpace';
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
    default: return 'bg-muted/20 border-border hover:bg-muted/30';
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
            loadTradeOffers(myTeamData.id).catch(() => {});
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
          const myPlayerIds = myTeamData ? (teamRosters.get(myTeamData.id) || []) : [];
          const myRoster = myPlayerIds.map(id => playerMap.get(id)).filter((p): p is Player => !!p);
          setMyTeamRoster(myRoster);

          // Build opponent teams
          const opponents: LeagueTeam[] = leagueTeams
            .filter(t => t.id !== myTeamData?.id)
            .map((t, idx) => {
              const playerIds = teamRosters.get(t.id) || [];
              const roster = playerIds.map(id => playerMap.get(id)).filter((p): p is Player => !!p);
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
            title: "Error",
            description: "Failed to load trade data.",
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
      savePct: p.save_percentage || 0
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
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 flex flex-col">
      <div className="hidden lg:block"><Navbar /></div>
      <div className="lg:hidden sticky top-0 z-40 bg-[#D4E8B8]/98 backdrop-blur-xl border-b border-citrus-sage/20 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-center h-12 px-4">
          <h1 className="text-lg font-varsity font-bold text-citrus-forest">Trade Center</h1>
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
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
                    <p className="text-muted-foreground">Loading trade analyzer...</p>
                  </div>
                </div>
              )}

              {/* Draft Not Completed Message */}
              {!loading && draftNotCompleted && (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <Card className="max-w-2xl w-full border-4 border-citrus-orange shadow-[0_8px_0_rgba(223,117,54,0.4)]">
                    <CardHeader>
                      <CardTitle className="text-2xl font-varsity font-black text-citrus-forest uppercase flex items-center justify-center gap-3">
                        <ShieldAlert className="w-8 h-8 text-citrus-orange" />
                        Draft Not Completed
                      </CardTitle>
                      <CardDescription className="text-lg mt-4">
                        The league draft must be completed before you can use the Trade Analyzer.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-muted-foreground">
                        Once the draft is finished and rosters are populated, you'll be able to:
                      </p>
                      <ul className="list-disc list-inside space-y-2 text-left max-w-md mx-auto">
                        <li>Analyze trades with other teams</li>
                        <li>Get AI-powered trade recommendations</li>
                        <li>View trade offers and proposals</li>
                      </ul>
                      {activeLeagueId && (
                        <div className="pt-4">
                          <Button asChild className="bg-gradient-to-r from-citrus-orange to-citrus-peach">
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
            <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-primary/60">
              Trade Center
            </h1>
            <p className="text-muted-foreground mt-1">
              Architect the perfect deal with AI-powered analysis.
            </p>
          </div>
        </div>

        {/* Demo Mode Banner */}
        {isGuestMode(userLeagueState) && (
          <div className="mb-6">
            <LeagueCreationCTA
              title="You're viewing demo trade analyzer"
              description="Sign up to analyze trades with your actual team and get AI-powered trade recommendations."
              variant="compact"
            />
          </div>
        )}

        {/* Tabs: Propose / Trade Offers */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-4">
          <TabsList className="w-full md:w-auto bg-citrus-sage/30 border border-citrus-sage/50">
            <TabsTrigger value="propose" className="flex items-center gap-2 text-citrus-forest font-semibold data-[state=active]:bg-white data-[state=active]:text-citrus-forest data-[state=active]:shadow">
              <ArrowLeftRight className="h-4 w-4" /> Propose Trade
            </TabsTrigger>
            <TabsTrigger value="offers" className="flex items-center gap-2 relative text-citrus-forest font-semibold data-[state=active]:bg-white data-[state=active]:text-citrus-forest data-[state=active]:shadow">
              <History className="h-4 w-4" /> Trade Offers
              {tradeOffers.filter(o => o.status === 'pending').length > 0 && (
                <Badge className="ml-1 h-5 min-w-[20px] px-1 text-[11px] bg-destructive text-destructive-foreground">
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
              <span className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">View</span>
              <ToggleGroup
                type="single"
                value={viewMode}
                onValueChange={(val) => val && setViewMode(val as 'list' | 'grid')}
                className="bg-muted/40 rounded-md p-0.5"
              >
                <ToggleGroupItem value="list" aria-label="List view" className="h-8 px-3 data-[state=on]:bg-white data-[state=on]:shadow-sm">
                  <ListIcon className="h-4 w-4 mr-1" /> List
                </ToggleGroupItem>
                <ToggleGroupItem value="grid" aria-label="Grid view" className="h-8 px-3 data-[state=on]:bg-white data-[state=on]:shadow-sm">
                  <LayoutGrid className="h-4 w-4 mr-1" /> Grid
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>

        {viewMode === 'list' ? (
        <div className="grid lg:grid-cols-12 gap-6 h-[calc(100vh-240px)] min-h-[600px]">
          {/* Left Column: My Team */}
          <Card className="lg:col-span-3 flex flex-col h-full border-primary/10 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Badge className="bg-primary">You</Badge> My Team
              </CardTitle>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input 
                  placeholder="Search players..." 
                  className="pl-8" 
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
                        className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors group ${
                          isSelected
                            ? 'bg-red-500/10 border-red-500/30'
                            : 'bg-card hover:bg-accent'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <Avatar className="h-9 w-9 cursor-pointer hover:ring-2 hover:ring-primary" onClick={(e) => handlePlayerClick(e, player)}>
                            <AvatarImage src={player.headshot_url} />
                            <AvatarFallback>{player.full_name.substring(0,2)}</AvatarFallback>
                          </Avatar>
                          <div>
                            <div
                              className="font-medium text-sm hover:underline hover:text-primary cursor-pointer"
                              onClick={(e) => handlePlayerClick(e, player)}
                            >
                              {player.full_name}
                            </div>
                            <div className="text-xs text-muted-foreground">{player.position} • {player.points} pts</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                           <Button size="icon" variant="ghost" className="h-9 w-9 text-muted-foreground touch-manipulation" onClick={(e) => handlePlayerClick(e, player)}>
                             <Info className="h-4 w-4" />
                           </Button>
                           {isSelected ? (
                             <CheckCircle2 className="h-5 w-5 text-red-500" />
                           ) : (
                             <UserPlus className="h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                           )}
                        </div>
                      </div>
                    );
                  })}
                  {filteredMyTeam.length === 0 && (
                    <div className="text-center p-4 text-muted-foreground text-sm">
                      {loading ? "Loading roster..." : "No players found"}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Middle Column: Trade Deck */}
          <div className="lg:col-span-6 flex flex-col gap-6 h-full overflow-y-auto">
            {/* Trade Area */}
            <Card className="flex-1 border-primary/20 shadow-md flex flex-col">
              <CardHeader className="border-b bg-muted/20 pb-4">
                <div className="flex justify-between items-center gap-3 flex-wrap">
                  <CardTitle className="flex items-center gap-2">
                    <Scale className="h-5 w-5" /> Trade Proposal
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    {selectedPartnerTeam && (
                      <Badge variant={isFair ? "secondary" : "outline"} className="text-xs">
                        {Math.abs(valueDiff) < 10 ? "Balanced Deal" : "Trade Impact Analysis"}
                      </Badge>
                    )}
                    <Button
                      size="sm"
                      className="bg-blue-600 hover:bg-blue-500 text-white shadow-sm"
                      disabled={myAssets.length === 0 || theirAssets.length === 0 || !selectedPartnerTeam}
                      onClick={handleProposeTrade}
                    >
                      <Send className="h-4 w-4 mr-2" /> Submit Trade Offer
                    </Button>
                  </div>
                </div>
              </CardHeader>
              
              <CardContent className="flex-1 p-6 grid md:grid-cols-2 gap-8 relative">
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 hidden md:flex h-10 w-10 bg-background border rounded-full items-center justify-center shadow-sm">
                  <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
                </div>

                {/* Receiving */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-green-600 flex items-center gap-2">
                      <TrendingUp className="h-4 w-4" /> You Receive
                    </h3>
                    <span className="text-xs font-mono text-muted-foreground">Val: {theirTotalValue}</span>
                  </div>
                  <div className="min-h-[120px] space-y-2">
                    {theirAssets.length === 0 ? (
                      <div className="h-full border-2 border-dashed rounded-lg flex items-center justify-center text-muted-foreground text-sm p-8">
                        Select players from {selectedPartnerTeam ? selectedPartnerTeam.name : 'opponent'}
                      </div>
                    ) : (
                      theirAssets.map(p => (
                        <div key={p.id} className="flex items-center justify-between p-2 rounded-md bg-green-500/10 border border-green-500/20">
                          <div className="flex items-center gap-2">
                             <Badge variant="outline" className="h-5 px-1 text-[11px]">{p.position}</Badge>
                             <span className="text-sm font-medium cursor-pointer hover:underline" onClick={(e) => handlePlayerClick(e, p)}>{p.full_name}</span>
                          </div>
                          <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-destructive touch-manipulation" onClick={() => toggleTheirPlayer(p.id)}>
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
                    <h3 className="font-semibold text-red-500 flex items-center gap-2">
                      <TrendingDown className="h-4 w-4" /> You Send
                    </h3>
                    <span className="text-xs font-mono text-muted-foreground">Val: {myTotalValue}</span>
                  </div>
                  <div className="min-h-[120px] space-y-2">
                    {myAssets.length === 0 ? (
                      <div className="h-full border-2 border-dashed rounded-lg flex items-center justify-center text-muted-foreground text-sm p-8">
                        Select players to trade away
                      </div>
                    ) : (
                      myAssets.map(p => (
                        <div key={p.id} className="flex items-center justify-between p-2 rounded-md bg-red-500/10 border border-red-500/20">
                          <div className="flex items-center gap-2">
                             <Badge variant="outline" className="h-5 px-1 text-[11px]">{p.position}</Badge>
                             <span className="text-sm font-medium cursor-pointer hover:underline" onClick={(e) => handlePlayerClick(e, p)}>{p.full_name}</span>
                          </div>
                          <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-destructive touch-manipulation" onClick={() => toggleMyPlayer(p.id)}>
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
            <Card className="bg-slate-950 text-slate-50 border-none">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <ShieldAlert className="h-5 w-5 text-blue-400" /> Stormy's Analysis
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <p className="text-slate-300 text-sm leading-relaxed">
                    {getTradeOpinion()}
                  </p>
                  
                  {(myAssets.length > 0 || theirAssets.length > 0) && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                      <div className="text-center p-2 bg-white/5 rounded-lg">
                         <div className="text-xs text-slate-400 uppercase tracking-wider">Goals Diff</div>
                         <div className={`text-lg font-bold ${(theirAssets.reduce((s,p)=>s+(p.goals||0),0) - myAssets.reduce((s,p)=>s+(p.goals||0),0)) > 0 ? 'text-green-400' : 'text-slate-200'}`}>
                           {(theirAssets.reduce((s,p)=>s+(p.goals||0),0) - myAssets.reduce((s,p)=>s+(p.goals||0),0)) > 0 ? '+' : ''}
                           {theirAssets.reduce((s,p)=>s+(p.goals||0),0) - myAssets.reduce((s,p)=>s+(p.goals||0),0)}
                         </div>
                      </div>
                      <div className="text-center p-2 bg-white/5 rounded-lg">
                        <div className="text-xs text-slate-400 uppercase tracking-wider">Total Pts</div>
                        <div className="text-lg font-bold text-slate-200">
                            {theirTotalValue - myTotalValue}
                        </div>
                      </div>
                      <div className="text-center p-2 bg-white/5 rounded-lg">
                        <div className="text-xs text-slate-400 uppercase tracking-wider">Structure</div>
                        <div className="text-lg font-bold text-blue-400">
                             {myAssets.length === theirAssets.length ? "Swap" : myAssets.length > theirAssets.length ? "Consolidate" : "Depth"}
                        </div>
                      </div>
                    </div>
                  )}
                  
                  <Input
                    placeholder="Add a message to your trade offer (optional)"
                    className="bg-white/10 border-white/20 text-slate-200 placeholder:text-slate-500"
                    value={tradeMessage}
                    onChange={(e) => setTradeMessage(e.target.value)}
                  />
                  <Button
                    className="w-full bg-blue-600 hover:bg-blue-500 text-white mt-2"
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
          <Card className={`lg:col-span-3 flex flex-col h-full border-primary/10 shadow-sm transition-opacity ${!selectedPartnerTeam ? 'opacity-60 pointer-events-none' : ''}`}>
            <CardHeader className="pb-3">
               <CardTitle className="text-lg flex items-center gap-2">
                {selectedPartnerTeam ? (
                   <>
                     <Badge variant="secondary">{selectedPartnerTeam.logo}</Badge> 
                     <span className="truncate">{selectedPartnerTeam.name}</span>
                   </>
                ) : (
                  "Partner Team"
                )}
              </CardTitle>
               <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input 
                  placeholder="Search their players..." 
                  className="pl-8"
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
                            className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors group ${
                              isSelected
                                ? 'bg-green-500/10 border-green-500/30'
                                : 'bg-card hover:bg-accent'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <Avatar className="h-9 w-9 cursor-pointer hover:ring-2 hover:ring-primary" onClick={(e) => handlePlayerClick(e, player)}>
                                <AvatarImage src={player.headshot_url} />
                                <AvatarFallback>{player.full_name.substring(0,2)}</AvatarFallback>
                              </Avatar>
                              <div>
                                <div
                                  className="font-medium text-sm hover:underline hover:text-primary cursor-pointer"
                                  onClick={(e) => handlePlayerClick(e, player)}
                                >
                                  {player.full_name}
                                </div>
                                <div className="text-xs text-muted-foreground">{player.position} • {player.points} pts</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                               <Button size="icon" variant="ghost" className="h-9 w-9 text-muted-foreground touch-manipulation" onClick={(e) => handlePlayerClick(e, player)}>
                                 <Info className="h-4 w-4" />
                               </Button>
                               {isSelected ? (
                                 <CheckCircle2 className="h-4 w-4 text-green-500" />
                               ) : (
                                 <UserPlus className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                               )}
                            </div>
                          </div>
                        );
                      })}
                      {filteredTheirTeam.length === 0 && (
                        <div className="text-center p-4 text-muted-foreground text-sm">No players found</div>
                      )}
                    </div>
                  </ScrollArea>
               ) : (
                 <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-6 text-center">
                   <ArrowLeftRight className="h-12 w-12 mb-4 opacity-20" />
                   <p>Select a trading partner to view their roster</p>
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

              {tradeOffers.length === 0 ? (
                <Card className="p-8 text-center">
                  <History className="h-12 w-12 mx-auto mb-4 text-muted-foreground/30" />
                  <h3 className="text-lg font-semibold mb-1">No Trade Offers</h3>
                  <p className="text-sm text-muted-foreground">
                    Trade offers you send or receive will appear here.
                  </p>
                </Card>
              ) : (
                <>
                  {/* Pending offers received */}
                  {tradeOffers.filter(o => o.status === 'pending' && o.to_team_id === myTeamId).length > 0 && (
                    <div>
                      <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                        <TrendingUp className="h-5 w-5 text-green-500" /> Offers Received
                      </h3>
                      <div className="space-y-3">
                        {tradeOffers
                          .filter(o => o.status === 'pending' && o.to_team_id === myTeamId)
                          .map(offer => (
                            <Card key={offer.id} className="border-green-500/20">
                              <CardHeader className="pb-2">
                                <div className="flex items-center justify-between">
                                  <CardTitle className="text-base">From: {offer.from_team_name}</CardTitle>
                                  <Badge variant="secondary">Pending</Badge>
                                </div>
                                {offer.message && (
                                  <p className="text-sm text-muted-foreground italic">"{offer.message}"</p>
                                )}
                              </CardHeader>
                              <CardContent className="pb-3">
                                <div className="grid grid-cols-2 gap-4 mb-3">
                                  <div>
                                    <p className="text-xs font-semibold text-green-600 mb-1">You Receive</p>
                                    {offer.offered_players.map(p => (
                                      <div key={p.player_id} className="text-sm flex items-center gap-1">
                                        <Badge variant="outline" className="h-4 px-1 text-[11px]">{p.position_code}</Badge>
                                        {p.full_name}
                                      </div>
                                    ))}
                                  </div>
                                  <div>
                                    <p className="text-xs font-semibold text-red-500 mb-1">You Send</p>
                                    {offer.requested_players.map(p => (
                                      <div key={p.player_id} className="text-sm flex items-center gap-1">
                                        <Badge variant="outline" className="h-4 px-1 text-[11px]">{p.position_code}</Badge>
                                        {p.full_name}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                                <Separator className="my-2" />
                                <div className="flex gap-2 pt-1">
                                  <Button size="sm" className="bg-green-600 hover:bg-green-500 text-white" onClick={() => handleAcceptTrade(offer.id)}>
                                    <CheckCircle2 className="h-4 w-4 mr-1" /> Accept
                                  </Button>
                                  <Button size="sm" variant="destructive" onClick={() => handleRejectTrade(offer.id)}>
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
                      <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                        <Send className="h-5 w-5 text-blue-500" /> Offers Sent
                      </h3>
                      <div className="space-y-3">
                        {tradeOffers
                          .filter(o => o.status === 'pending' && o.from_team_id === myTeamId)
                          .map(offer => (
                            <Card key={offer.id} className="border-blue-500/20">
                              <CardHeader className="pb-2">
                                <div className="flex items-center justify-between">
                                  <CardTitle className="text-base">To: {offer.to_team_name}</CardTitle>
                                  <Badge variant="secondary">Pending</Badge>
                                </div>
                                {offer.message && (
                                  <p className="text-sm text-muted-foreground italic">"{offer.message}"</p>
                                )}
                              </CardHeader>
                              <CardContent className="pb-3">
                                <div className="grid grid-cols-2 gap-4 mb-3">
                                  <div>
                                    <p className="text-xs font-semibold text-red-500 mb-1">You Send</p>
                                    {offer.offered_players.map(p => (
                                      <div key={p.player_id} className="text-sm flex items-center gap-1">
                                        <Badge variant="outline" className="h-4 px-1 text-[11px]">{p.position_code}</Badge>
                                        {p.full_name}
                                      </div>
                                    ))}
                                  </div>
                                  <div>
                                    <p className="text-xs font-semibold text-green-600 mb-1">You Receive</p>
                                    {offer.requested_players.map(p => (
                                      <div key={p.player_id} className="text-sm flex items-center gap-1">
                                        <Badge variant="outline" className="h-4 px-1 text-[11px]">{p.position_code}</Badge>
                                        {p.full_name}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                                <Button size="sm" variant="outline" onClick={() => handleCancelTrade(offer.id)}>
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
                      <h3 className="text-lg font-semibold mb-3 text-muted-foreground flex items-center gap-2">
                        <History className="h-5 w-5" /> Trade History
                      </h3>
                      <div className="space-y-3">
                        {tradeOffers
                          .filter(o => o.status !== 'pending')
                          .map(offer => (
                            <Card key={offer.id} className="opacity-60">
                              <CardHeader className="pb-2">
                                <div className="flex items-center justify-between">
                                  <CardTitle className="text-base">
                                    {offer.from_team_id === myTeamId ? `To: ${offer.to_team_name}` : `From: ${offer.from_team_name}`}
                                  </CardTitle>
                                  <Badge variant={offer.status === 'accepted' ? 'default' : 'outline'}>
                                    {offer.status.charAt(0).toUpperCase() + offer.status.slice(1)}
                                  </Badge>
                                </div>
                              </CardHeader>
                              <CardContent className="pb-3">
                                <div className="grid grid-cols-2 gap-4 text-sm text-muted-foreground">
                                  <div>
                                    <p className="text-xs font-semibold mb-1">Offered</p>
                                    {offer.offered_players.map(p => (
                                      <div key={p.player_id}>{p.full_name}</div>
                                    ))}
                                  </div>
                                  <div>
                                    <p className="text-xs font-semibold mb-1">Requested</p>
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
                <AdSpace size="300x250" label="Trade Sponsor" />
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
  );
};

export default TradeAnalyzer;
