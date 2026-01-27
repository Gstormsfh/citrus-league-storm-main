import { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useLeague } from "@/contexts/LeagueContext";
import { LeagueService } from "@/services/LeagueService";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Trophy, Users, Settings, CheckCircle, AlertCircle, UserPlus, Loader2, Copy } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";

const CreateLeague = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, profile } = useAuth();
  const { refreshLeagues } = useLeague();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [defaultTab, setDefaultTab] = useState<"create" | "join">("create");

  // Create League Form State
  const [leagueName, setLeagueName] = useState("");
  const [teamsCount, setTeamsCount] = useState("12");
  const [draftRounds, setDraftRounds] = useState("21");
  const [scoringType, setScoringType] = useState("h2h-points");
  const [draftType, setDraftType] = useState("snake");

  // Join League Form State
  const [joinCode, setJoinCode] = useState("");
  const [teamNameForJoin, setTeamNameForJoin] = useState("");

  // Read query params for tab and pre-filled join code
  useEffect(() => {
    const tab = searchParams.get('tab');
    const code = searchParams.get('code');
    
    if (tab === 'join') {
      setDefaultTab('join');
    }
    
    if (code) {
      setJoinCode(code);
    }
  }, [searchParams]);

  // Only tracked stats (removed unsupported: fights, hat tricks, broken sticks, etc.)
  const [leagueStats, setLeagueStats] = useState([
    // Skater Stats (actually tracked in database)
    { id: "g", name: "Goals", points: 3, default: true, category: "Offense", enabled: true },
    { id: "a", name: "Assists", points: 2, default: true, category: "Offense", enabled: true },
    { id: "ppp", name: "Power Play Points", points: 1, default: true, category: "Offense", enabled: true },
    { id: "shg", name: "Shorthanded Points", points: 2, default: true, category: "Offense", enabled: true },
    { id: "sog", name: "Shots on Goal", points: 0.4, default: true, category: "Offense", enabled: true },
    { id: "blk", name: "Blocks", points: 0.5, default: true, category: "Defense", enabled: true },
    { id: "hit", name: "Hits", points: 0.2, default: true, category: "Defense", enabled: true },
    { id: "pim", name: "Penalty Minutes", points: 0.5, default: false, category: "Defense", enabled: false },
    
    // Goalie Stats (actually tracked in database)
    { id: "w", name: "Wins", points: 4, default: true, category: "Goalie", enabled: true },
    { id: "so", name: "Shutouts", points: 3, default: true, category: "Goalie", enabled: true },
    { id: "sv", name: "Saves", points: 0.2, default: true, category: "Goalie", enabled: true },
    { id: "ga", name: "Goals Against", points: -1, default: true, category: "Goalie", enabled: true },
  ]);

  const handleStatToggle = (id: string) => {
    setLeagueStats(prev => prev.map(stat => 
      stat.id === id ? { ...stat, enabled: !stat.enabled } : stat
    ));
  };

  const handleStatPointsChange = (id: string, value: string) => {
    const numValue = parseFloat(value);
    setLeagueStats(prev => prev.map(stat => 
      stat.id === id ? { ...stat, points: isNaN(numValue) ? 0 : numValue } : stat
    ));
  };

  const handleCreateLeague = async () => {
    if (!user) {
      setError("You must be logged in to create a league");
      navigate("/auth");
      return;
    }

    if (!profile || profile.username.startsWith('user_')) {
      setError("Please complete your profile setup first");
      navigate("/profile-setup");
      return;
    }

    if (!leagueName.trim()) {
      setError("League name is required");
      return;
    }

    // Prevent duplicate submissions
    if (loading) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const enabledStats = leagueStats.filter(s => s.enabled);
      const settings = {
        teamsCount: parseInt(teamsCount),
        scoringType: "h2h-points", // Only implemented format
        draftType: "snake", // Only implemented format
        stats: enabledStats,
      };

      // Transform leagueStats array to scoring_settings JSONB format
      const scoringSettings = {
        skater: {
          goals: leagueStats.find(s => s.id === 'g')?.points || 3,
          assists: leagueStats.find(s => s.id === 'a')?.points || 2,
          power_play_points: leagueStats.find(s => s.id === 'ppp')?.points || 1,
          short_handed_points: leagueStats.find(s => s.id === 'shg')?.points || 2,
          shots_on_goal: leagueStats.find(s => s.id === 'sog')?.points || 0.4,
          blocks: leagueStats.find(s => s.id === 'blk')?.points || 0.5,
          hits: leagueStats.find(s => s.id === 'hit')?.points || 0.2,
          penalty_minutes: leagueStats.find(s => s.id === 'pim')?.points || 0.5
        },
        goalie: {
          wins: leagueStats.find(s => s.id === 'w')?.points || 4,
          shutouts: leagueStats.find(s => s.id === 'so')?.points || 3,
          saves: leagueStats.find(s => s.id === 'sv')?.points || 0.2,
          goals_against: leagueStats.find(s => s.id === 'ga')?.points || -1
        }
      };

      const { league, team, error: createError } = await LeagueService.createLeague(
        leagueName.trim(),
        user.id,
        parseInt(draftRounds), // Roster size per team (matches draft rounds)
        parseInt(draftRounds), // Draft rounds from user selection
        settings,
        scoringSettings // Pass transformed scoring settings
      );

      if (createError) throw createError;
      if (!league) throw new Error("Failed to create league");

      // Refresh leagues list to include the newly created league
      await refreshLeagues();

      // Show success message
      toast({
        title: "League Created!",
        description: `${league.name} has been created successfully.`,
      });

      // Navigate to league dashboard (include query param for LeagueContext)
      navigate(`/league/${league.id}?league=${league.id}`);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Failed to create league";
      setError(errorMessage);
      setLoading(false);
      
      // Also show toast for errors
      toast({
        title: "Error Creating League",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  const handleJoinLeague = async () => {
    if (!user) {
      setError("You must be logged in to join a league");
      navigate("/auth");
      return;
    }

    if (!profile || profile.username.startsWith('user_')) {
      setError("Please complete your profile setup first");
      navigate("/profile-setup");
      return;
    }

    if (!joinCode.trim()) {
      setError("Join code is required");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { league, team, error: joinError } = await LeagueService.joinLeagueByCode(
        joinCode.trim(),
        user.id,
        teamNameForJoin.trim() || undefined
      );

      if (joinError) throw joinError;
      if (!league || !team) throw new Error("Failed to join league");

      // Refresh leagues list to include the newly joined league
      await refreshLeagues();

      // Show success message
      toast({
        title: "Joined League!",
        description: `Welcome to ${league.name}! Your team "${team.team_name}" has been created.`,
      });

      // Navigate to league dashboard (include query param for LeagueContext)
      navigate(`/league/${league.id}?league=${league.id}`);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Failed to join league";
      setError(errorMessage);
      setLoading(false);
      
      // Also show toast for errors
      toast({
        title: "Error Joining League",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  const statsByCategory = {
    Offense: leagueStats.filter(s => s.category === "Offense"),
    Defense: leagueStats.filter(s => s.category === "Defense"),
    Goalie: leagueStats.filter(s => s.category === "Goalie"),
  };

  return (
    <div className="min-h-screen bg-[#D4E8B8] relative overflow-hidden">
      {/* Decorative Background */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-[hsl(var(--vibrant-yellow))] rounded-full opacity-10 blur-3xl -z-10"></div>
      <div className="absolute bottom-0 left-0 w-96 h-96 bg-[hsl(var(--vibrant-green))] rounded-full opacity-10 blur-3xl -z-10"></div>

      <Navbar />

      <main className="pt-32 pb-20 px-4">
        <div className="container mx-auto max-w-4xl">
          
          <div className="mb-8 text-center">
            <h1 className="text-4xl md:text-5xl font-bold mb-4 citrus-gradient-text">
              Create or Join a League
            </h1>
            <p className="text-lg text-muted-foreground">
              Start your own league or join your friends.
            </p>
          </div>

          <Card className="card-citrus border-none shadow-xl overflow-hidden">
            <CardContent className="p-8">
              <Tabs defaultValue={defaultTab} value={defaultTab} onValueChange={(v) => setDefaultTab(v as "create" | "join")} className="w-full">
                <TabsList className="grid w-full grid-cols-2 mb-8">
                  <TabsTrigger value="create" className="flex items-center gap-2">
                    <Trophy className="w-4 h-4" />
                    Create League
                  </TabsTrigger>
                  <TabsTrigger value="join" className="flex items-center gap-2">
                    <UserPlus className="w-4 h-4" />
                    Join League
                  </TabsTrigger>
                </TabsList>

                {/* CREATE LEAGUE TAB */}
                <TabsContent value="create" className="space-y-8 animate-fade-in">
                {/* ERROR MESSAGE */}
                {error && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                {/* BASIC SETTINGS */}
                <div className="space-y-6">
                  <div className="space-y-3">
                    <Label htmlFor="league-name" className="text-base">League Name</Label>
                    <Input 
                      id="league-name" 
                      placeholder="e.g. The Frozen Pond" 
                      className="h-12 text-lg"
                      value={leagueName}
                      onChange={(e) => setLeagueName(e.target.value)}
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="space-y-3">
                      <Label htmlFor="teams-count" className="text-base">Number of Teams</Label>
                      <Select value={teamsCount} onValueChange={setTeamsCount}>
                        <SelectTrigger id="teams-count" className="h-12">
                          <SelectValue placeholder="Select teams" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="8">8 Teams</SelectItem>
                          <SelectItem value="10">10 Teams</SelectItem>
                          <SelectItem value="12">12 Teams</SelectItem>
                          <SelectItem value="14">14 Teams</SelectItem>
                          <SelectItem value="16">16 Teams</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-3">
                      <Label htmlFor="draft-rounds" className="text-base">Draft Rounds</Label>
                      <Select value={draftRounds} onValueChange={setDraftRounds}>
                        <SelectTrigger id="draft-rounds" className="h-12">
                          <SelectValue placeholder="Select rounds" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="16">16 Rounds</SelectItem>
                          <SelectItem value="18">18 Rounds</SelectItem>
                          <SelectItem value="21">21 Rounds</SelectItem>
                          <SelectItem value="24">24 Rounds</SelectItem>
                          <SelectItem value="30">30 Rounds</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-3">
                      <Label htmlFor="scoring-type" className="text-base">Scoring Format</Label>
                      <Select value={scoringType} onValueChange={setScoringType} disabled>
                        <SelectTrigger id="scoring-type" className="h-12">
                          <SelectValue placeholder="Select format" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="h2h-points">
                            <div className="flex items-center gap-2">
                              Head-to-Head Points
                            </div>
                          </SelectItem>
                          <SelectItem value="h2h-categories" disabled>
                            <div className="flex items-center gap-2">
                              Head-to-Head Categories
                              <Badge variant="secondary" className="ml-auto">Coming Soon</Badge>
                            </div>
                          </SelectItem>
                          <SelectItem value="roto" disabled>
                            <div className="flex items-center gap-2">
                              Rotisserie
                              <Badge variant="secondary" className="ml-auto">Coming Soon</Badge>
                            </div>
                          </SelectItem>
                          <SelectItem value="season-points" disabled>
                            <div className="flex items-center gap-2">
                              Total Season Points
                              <Badge variant="secondary" className="ml-auto">Coming Soon</Badge>
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Head-to-Head Points is currently available. Other formats coming soon!
                      </p>
                    </div>
                  </div>
                </div>

                {/* Draft Settings */}
                <div className="pt-2">
                  <div className="space-y-4">
                    <Label className="text-base font-semibold">Draft Type</Label>
                    <RadioGroup value={draftType} onValueChange={setDraftType} className="grid grid-cols-1 gap-3">
                      <div>
                        <RadioGroupItem value="snake" id="snake" className="peer sr-only" />
                        <Label
                          htmlFor="snake"
                          className="flex items-center justify-between rounded-xl border-2 border-muted bg-transparent p-3 hover:bg-muted/20 hover:border-primary/50 peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 cursor-pointer transition-all"
                        >
                          <div className="flex items-center gap-3">
                            <Settings className="h-5 w-5 text-muted-foreground peer-data-[state=checked]:text-primary" />
                            <span className="font-semibold">Snake Draft</span>
                          </div>
                        </Label>
                      </div>
                      <div className="relative">
                        <RadioGroupItem value="auction" id="auction" className="peer sr-only" disabled />
                        <Label
                          htmlFor="auction"
                          className="flex items-center justify-between rounded-xl border-2 border-muted bg-transparent p-3 opacity-60 cursor-not-allowed transition-all"
                        >
                          <div className="flex items-center gap-3">
                            <Users className="h-5 w-5 text-muted-foreground" />
                            <span className="font-semibold">Auction Draft</span>
                            <Badge variant="secondary" className="ml-auto">Coming Soon</Badge>
                          </div>
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>

                </div>

                <div className="border-t pt-6">
                  <div className="flex items-center justify-between mb-6">
                     <div>
                       <h3 className="text-xl font-bold">Scoring Settings</h3>
                       <p className="text-muted-foreground text-sm">Toggle stats and adjust point values</p>
                     </div>
                     <Badge variant="secondary" className="bg-primary/10 text-primary">
                       {leagueStats.filter(s => s.enabled).length} Active Stats
                     </Badge>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {Object.entries(statsByCategory).map(([category, stats]) => (
                      <div key={category} className="space-y-3">
                        <h4 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                          {category} Stats
                        </h4>
                        <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
                          {stats.map((stat) => (
                            <div 
                              key={stat.id} 
                              className={`flex items-center justify-between p-3 border-b last:border-0 transition-colors ${stat.enabled ? 'bg-primary/5' : 'opacity-60'}`}
                            >
                              <div className="flex items-center gap-3">
                                <Switch 
                                  checked={stat.enabled} 
                                  onCheckedChange={() => handleStatToggle(stat.id)} 
                                />
                                <span className={`font-medium ${stat.enabled ? 'text-foreground' : 'text-muted-foreground'}`}>
                                  {stat.name}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">Pts:</span>
                                <Input 
                                  type="number" 
                                  className="h-8 w-16 text-right font-mono" 
                                  value={stat.points}
                                  onChange={(e) => handleStatPointsChange(stat.id, e.target.value)}
                                  disabled={!stat.enabled}
                                  step="0.1"
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-4 flex justify-end items-center">
                  <Button 
                    size="lg" 
                    className="rounded-full px-8 min-w-[200px]"
                    onClick={handleCreateLeague}
                    disabled={loading || !leagueName}
                  >
                    {loading ? (
                      <div className="flex items-center">
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></div>
                        Creating...
                      </div>
                    ) : (
                      <>Create League <CheckCircle className="ml-2 w-4 h-4" /></>
                    )}
                  </Button>
                </div>
              </TabsContent>

              {/* JOIN LEAGUE TAB */}
              <TabsContent value="join" className="space-y-6">
                {/* ERROR MESSAGE */}
                {error && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                <div className="text-center pb-4">
                  <UserPlus className="w-12 h-12 mx-auto mb-4 text-primary" />
                  <h2 className="text-2xl font-bold mb-2">Join a League</h2>
                  <p className="text-muted-foreground">
                    Enter the join code provided by your league commissioner
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="join-code" className="text-base font-semibold">Join Code</Label>
                    <div className="flex items-center gap-2">
                      <Input 
                        id="join-code" 
                        placeholder="Paste join code here..." 
                        value={joinCode}
                        onChange={(e) => setJoinCode(e.target.value)}
                        disabled={loading}
                        className="font-mono text-base h-12 text-lg"
                      />
                      {joinCode && (
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => {
                            navigator.clipboard.writeText(joinCode);
                            toast({
                              title: 'Copied!',
                              description: 'Join code copied to clipboard',
                            });
                          }}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Ask your commissioner for the league join code, or paste it from an invite link
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="team-name-join" className="text-base">
                      Team Name <span className="text-muted-foreground font-normal">(optional)</span>
                    </Label>
                    <Input 
                      id="team-name-join" 
                      placeholder="e.g. Ice Warriors" 
                      value={teamNameForJoin}
                      onChange={(e) => setTeamNameForJoin(e.target.value)}
                      disabled={loading}
                    />
                    <p className="text-xs text-muted-foreground">
                      Leave blank to use your default team name
                    </p>
                  </div>
                </div>

                <div className="bg-muted/30 rounded-lg p-4 space-y-2">
                  <div className="flex items-start gap-2">
                    <CheckCircle className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium">Before joining:</p>
                      <ul className="text-sm text-muted-foreground space-y-1 mt-1">
                        <li>• Make sure you trust the league commissioner</li>
                        <li>• Check if the draft has already happened</li>
                        <li>• You can only own one team per league</li>
                      </ul>
                    </div>
                  </div>
                </div>

                <div className="pt-4 flex justify-end items-center gap-4">
                  <Button 
                    variant="outline"
                    onClick={() => navigate('/dashboard')}
                    disabled={loading}
                  >
                    Cancel
                  </Button>
                  <Button 
                    size="lg" 
                    className="rounded-full px-8 min-w-[200px]"
                    onClick={handleJoinLeague} 
                    disabled={loading || !joinCode.trim()}
                  >
                    {loading ? (
                      <div className="flex items-center">
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></div>
                        Joining...
                      </div>
                    ) : (
                      <>Join League <UserPlus className="ml-2 w-4 h-4" /></>
                    )}
                  </Button>
                </div>
              </TabsContent>
            </Tabs>

            </CardContent>
          </Card>

        </div>
      </main>
      <Footer />
    </div>
  );
};

export default CreateLeague;
