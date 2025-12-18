import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  Info
} from 'lucide-react';
import { PlayerService, Player } from '@/services/PlayerService';
import { LeagueService, LeagueTeam } from '@/services/LeagueService';
import PlayerStatsModal from '@/components/PlayerStatsModal';
import { HockeyPlayer } from '@/components/roster/HockeyPlayerCard';

const TradeAnalyzer = () => {
  const [searchParams] = useSearchParams();
  const [selectedTeamId, setSelectedTeamId] = useState<string | number>("");
  const [myTeamRoster, setMyTeamRoster] = useState<Player[]>([]);
  const [opponentTeams, setOpponentTeams] = useState<LeagueTeam[]>([]);
  const [loading, setLoading] = useState(true);
  
  // State for Player Stats Modal
  const [selectedPlayerForStats, setSelectedPlayerForStats] = useState<HockeyPlayer | null>(null);
  const [isPlayerDialogOpen, setIsPlayerDialogOpen] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        // Get all players from staging files (staging_2025_skaters & staging_2025_goalies)
        // PlayerService.getAllPlayers() is the ONLY source for player data
        const allPlayers = await PlayerService.getAllPlayers();
        // LeagueService distributes players to teams, but uses staging file data
        const teams = await LeagueService.getAllTeamsWithRosters(allPlayers);
        
        // For non-logged-in users, show demo team (Team 3)
        // For logged-in users, get their actual team
        const myTeam = await LeagueService.getMyTeam(allPlayers);
        setMyTeamRoster(myTeam);
        
        // Exclude my team (ID 3) from opponents
        setOpponentTeams(teams.filter(t => t.id !== 3));
      } catch (error) {
        console.error("Failed to load trade data", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

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
    projectedPoints: (p.points || 0) / 20
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
    !mySelectedPlayers.includes(p.id) && 
    p.full_name.toLowerCase().includes(searchMyTeam.toLowerCase())
  );

  const filteredTheirTeam = selectedPartnerTeam?.roster.filter(p => 
    !theirSelectedPlayers.includes(p.id) &&
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
      <Navbar />
      <main className="flex-1 pt-24 pb-16 container mx-auto px-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <div>
            <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-primary/60">
              Trade Center
            </h1>
            <p className="text-muted-foreground mt-1">
              Architect the perfect deal with AI-powered analysis.
            </p>
          </div>
          
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
        </div>

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
                  {filteredMyTeam.map(player => (
                    <div 
                      key={player.id} 
                      onClick={() => toggleMyPlayer(player.id)}
                      className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent cursor-pointer transition-colors group"
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
                         <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground" onClick={(e) => handlePlayerClick(e, player)}>
                           <Info className="h-4 w-4" />
                         </Button>
                         <UserPlus className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </div>
                  ))}
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
                <div className="flex justify-between items-center">
                  <CardTitle className="flex items-center gap-2">
                    <Scale className="h-5 w-5" /> Trade Proposal
                  </CardTitle>
                  {selectedPartnerTeam && (
                    <Badge variant={isFair ? "secondary" : "outline"} className="text-xs">
                      {Math.abs(valueDiff) < 10 ? "Balanced Deal" : "Trade Impact Analysis"}
                    </Badge>
                  )}
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
                             <Badge variant="outline" className="h-5 px-1 text-[10px]">{p.position}</Badge>
                             <span className="text-sm font-medium cursor-pointer hover:underline" onClick={(e) => handlePlayerClick(e, p)}>{p.full_name}</span>
                          </div>
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => toggleTheirPlayer(p.id)}>
                            <UserMinus className="h-3 w-3" />
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
                             <Badge variant="outline" className="h-5 px-1 text-[10px]">{p.position}</Badge>
                             <span className="text-sm font-medium cursor-pointer hover:underline" onClick={(e) => handlePlayerClick(e, p)}>{p.full_name}</span>
                          </div>
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => toggleMyPlayer(p.id)}>
                            <UserMinus className="h-3 w-3" />
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
                    <div className="grid grid-cols-3 gap-4 pt-2">
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
                  
                  <Button className="w-full bg-blue-600 hover:bg-blue-500 text-white mt-2" disabled={myAssets.length === 0 && theirAssets.length === 0}>
                    Submit Official Proposal
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
                      {filteredTheirTeam.map(player => (
                        <div 
                          key={player.id} 
                          onClick={() => toggleTheirPlayer(player.id)}
                          className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent cursor-pointer transition-colors group"
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
                             <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground" onClick={(e) => handlePlayerClick(e, player)}>
                               <Info className="h-4 w-4" />
                             </Button>
                             <UserPlus className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </div>
                      ))}
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
        
        {/* Player Stats Modal */}
        <PlayerStatsModal
          player={selectedPlayerForStats}
          isOpen={isPlayerDialogOpen}
          onClose={() => setIsPlayerDialogOpen(false)}
        />
      </main>
      <Footer />
    </div>
  );
};

export default TradeAnalyzer;
