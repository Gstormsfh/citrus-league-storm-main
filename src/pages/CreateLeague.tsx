import { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
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
  const [isPublic, setIsPublic] = useState(false);

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

  // Consolidated Stats State (Standard + Fun)
  const [leagueStats, setLeagueStats] = useState([
    // Standard Scoring
    { id: "g", name: "Goals", points: 3, default: true, category: "Offense", enabled: true },
    { id: "a", name: "Assists", points: 2, default: true, category: "Offense", enabled: true },
    { id: "ppp", name: "Power Play Points", points: 1, default: true, category: "Offense", enabled: true },
    { id: "sog", name: "Shots on Goal", points: 0.4, default: true, category: "Offense", enabled: true },
    { id: "blk", name: "Blocks", points: 0.5, default: true, category: "Defense", enabled: true },
    { id: "hit", name: "Hits", points: 0.2, default: true, category: "Defense", enabled: true },
    { id: "w", name: "Wins", points: 4, default: true, category: "Goalie", enabled: true },
    { id: "so", name: "Shutouts", points: 3, default: true, category: "Goalie", enabled: true },
    { id: "sv", name: "Saves", points: 0.2, default: true, category: "Goalie", enabled: true },
    { id: "ga", name: "Goals Against", points: -1, default: true, category: "Goalie", enabled: true },
    
    // Fun / Extra Stats
    { id: "pim", name: "Penalty Minutes", points: 0.5, default: false, category: "Fun", enabled: false },
    { id: "fights", name: "Fights (Majors)", points: 5, default: false, category: "Fun", enabled: false },
    { id: "hat", name: "Hat Tricks", points: 10, default: false, category: "Fun", enabled: false },
    { id: "ghg", name: "Gordie Howe Hat Trick", points: 15, default: false, category: "Fun", enabled: false },
    { id: "shg", name: "Shorthanded Goals", points: 2, default: false, category: "Offense", enabled: false },
    { id: "gwg", name: "Game Winning Goals", points: 1, default: false, category: "Offense", enabled: false },
    { id: "otg", name: "OT Goals", points: 2, default: false, category: "Offense", enabled: false },
    { id: "def_g", name: "Defender Goals", points: 1, default: false, category: "Defense", enabled: false },
    { id: "goalie_g", name: "Goalie Goals", points: 50, default: false, category: "Goalie", enabled: false },
    { id: "bs", name: "Broken Sticks", points: 1, default: false, category: "Fun", enabled: false },
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

    setLoading(true);
    setError(null);

    try {
      const enabledStats = leagueStats.filter(s => s.enabled);
      const settings = {
        teamsCount: parseInt(teamsCount),
        scoringType,
        draftType,
        isPublic,
        stats: enabledStats,
      };

      const { league, team, error: createError } = await LeagueService.createLeague(
        leagueName.trim(),
        user.id,
        21, // Roster size per team
        parseInt(draftRounds), // Draft rounds from user selection
        settings
      );

      if (createError) throw createError;
      if (!league) throw new Error("Failed to create league");

      // Show success message
      toast({
        title: "League Created!",
        description: `${league.name} has been created successfully.`,
      });

      // Navigate to league dashboard
      navigate(`/league/${league.id}`);
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

      // Show success message
      toast({
        title: "Joined League!",
        description: `Welcome to ${league.name}! Your team "${team.team_name}" has been created.`,
      });

      // Navigate to league dashboard
      navigate(`/league/${league.id}`);
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
    Fun: leagueStats.filter(s => s.category === "Fun"),
  };

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
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
                      <Select value={scoringType} onValueChange={setScoringType}>
                        <SelectTrigger id="scoring-type" className="h-12">
                          <SelectValue placeholder="Select format" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="h2h-points">Head-to-Head Points</SelectItem>
                          <SelectItem value="h2h-categories">Head-to-Head Categories</SelectItem>
                          <SelectItem value="roto">Rotisserie</SelectItem>
                          <SelectItem value="season-points">Total Season Points</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                {/* Draft & Privacy Settings */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 pt-2">
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
                      <div>
                        <RadioGroupItem value="auction" id="auction" className="peer sr-only" />
                        <Label
                          htmlFor="auction"
                          className="flex items-center justify-between rounded-xl border-2 border-muted bg-transparent p-3 hover:bg-muted/20 hover:border-primary/50 peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 cursor-pointer transition-all"
                        >
                          <div className="flex items-center gap-3">
                            <Users className="h-5 w-5 text-muted-foreground peer-data-[state=checked]:text-primary" />
                            <span className="font-semibold">Auction Draft</span>
                          </div>
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>

                  <div className="space-y-4">
                    <Label className="text-base font-semibold">Privacy</Label>
                    <div className="bg-muted/30 p-4 rounded-xl flex items-center justify-between h-[100px] border border-border/50">
                      <div className="space-y-0.5">
                        <Label className="text-base">Public League</Label>
                        <p className="text-sm text-muted-foreground">
                          Anyone can join this league
                        </p>
                      </div>
                      <Switch checked={isPublic} onCheckedChange={setIsPublic} />
                    </div>
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
                          {category === 'Fun' && <span className="text-lg">🎉</span>}
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
