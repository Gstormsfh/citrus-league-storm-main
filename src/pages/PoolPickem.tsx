import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { PoolService, PickemPick, PickemStanding } from '@/services/PoolService';
import { ScheduleService, NHLGame } from '@/services/ScheduleService';
import { Loader2, CheckCircle, XCircle, Target } from 'lucide-react';
import { LeagueCreationCTA } from '@/components/LeagueCreationCTA';
import LoadingScreen from '@/components/LoadingScreen';

const PoolPickem = () => {
  const { user } = useAuth();
  const { userLeagueState, activeLeagueId } = useLeague();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [currentWeek, setCurrentWeek] = useState(1);
  const [games, setGames] = useState<NHLGame[]>([]);
  const [picks, setPicks] = useState<Map<string, string>>(new Map());
  const [existingPicks, setExistingPicks] = useState<PickemPick[]>([]);
  const [standings, setStandings] = useState<PickemStanding[]>([]);
  const [activeTab, setActiveTab] = useState('picks');

  useEffect(() => {
    const loadData = async () => {
      if (!activeLeagueId || !user) {
        setLoading(false);
        return;
      }

      try {
        // Load games for current week
        const todayGames = await ScheduleService.getTodaysGames();
        setGames(todayGames || []);

        // Load existing picks
        const userPicks = await PoolService.getPickemPicks(
          activeLeagueId, user.id, currentWeek
        );
        setExistingPicks(userPicks);

        // Populate picks map from existing
        const pickMap = new Map<string, string>();
        userPicks.forEach(p => pickMap.set(p.game_id, p.picked_team));
        setPicks(pickMap);

        // Load standings
        const standingsData = await PoolService.getPickemStandings(activeLeagueId);
        setStandings(standingsData);
      } catch (err) {
        console.error('[PoolPickem] Error loading data:', err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [activeLeagueId, user, currentWeek]);

  const handlePick = (gameId: string, team: string) => {
    const newPicks = new Map(picks);
    if (newPicks.get(gameId) === team) {
      newPicks.delete(gameId); // Toggle off
    } else {
      newPicks.set(gameId, team);
    }
    setPicks(newPicks);
  };

  const handleSubmitPicks = async () => {
    if (!activeLeagueId || !user) return;
    setSubmitting(true);

    try {
      const picksArray = Array.from(picks.entries()).map(([game_id, picked_team]) => ({
        game_id,
        picked_team,
      }));

      const result = await PoolService.submitPickemPicks(
        activeLeagueId, user.id, currentWeek, picksArray
      );

      if (result.success) {
        toast({ title: 'Picks Submitted', description: `${picksArray.length} picks saved successfully.` });
      } else {
        toast({ title: 'Error', description: result.error || 'Failed to submit picks', variant: 'destructive' });
      }
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to submit picks', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <LoadingScreen character="narwhal" message="Loading Pick'em Pool..." />;
  }

  return (
    <div className="min-h-screen bg-[#D4E8B8] relative">
      <div className="hidden lg:block"><Navbar /></div>

      <div className="lg:hidden sticky top-0 z-40 bg-[#D4E8B8]/98 backdrop-blur-xl border-b border-citrus-sage/20 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-center h-12 px-4">
          <h1 className="text-lg font-varsity font-bold text-citrus-forest">Pick'em Pool</h1>
        </div>
      </div>

      <main className="w-full lg:pt-20 lg:pb-8 pb-[calc(5rem+env(safe-area-inset-bottom))]">
        <div className="max-w-4xl mx-auto px-4">
          {userLeagueState === 'logged-in-no-league' && (
            <div className="mb-8">
              <LeagueCreationCTA
                title="Join a Pick'em Pool"
                description="Create or join a Pick'em pool to start predicting NHL game winners."
              />
            </div>
          )}

          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold flex items-center gap-2">
                <Target className="w-6 h-6 text-primary" />
                Pick'em Pool
              </h2>
              <p className="text-muted-foreground text-sm">Pick the winners of NHL games each week</p>
            </div>
            <Badge variant="outline" className="text-sm">Week {currentWeek}</Badge>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-6">
              <TabsTrigger value="picks">Make Picks</TabsTrigger>
              <TabsTrigger value="standings">Standings</TabsTrigger>
            </TabsList>

            <TabsContent value="picks">
              <Card className="card-citrus border-none shadow-lg">
                <CardHeader>
                  <CardTitle className="text-lg">Week {currentWeek} Games</CardTitle>
                </CardHeader>
                <CardContent>
                  {games.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <Target className="w-12 h-12 mx-auto mb-4 opacity-30" />
                      <p className="font-medium">No games available for this week</p>
                      <p className="text-sm mt-1">Games will appear once the NHL schedule is loaded.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {games.map(game => {
                        const gameId = String(game.id);
                        const picked = picks.get(gameId);
                        const existingPick = existingPicks.find(p => p.game_id === gameId);

                        return (
                          <div key={gameId} className="flex items-center justify-between p-4 rounded-xl bg-muted/20 border border-transparent hover:border-primary/10 transition-colors">
                            <Button
                              variant={picked === game.away_team ? 'default' : 'outline'}
                              size="sm"
                              className="min-w-[100px]"
                              onClick={() => handlePick(gameId, game.away_team)}
                            >
                              {game.away_team}
                              {existingPick?.is_correct === true && existingPick.picked_team === game.away_team && (
                                <CheckCircle className="w-4 h-4 ml-1 text-green-500" />
                              )}
                              {existingPick?.is_correct === false && existingPick.picked_team === game.away_team && (
                                <XCircle className="w-4 h-4 ml-1 text-red-500" />
                              )}
                            </Button>

                            <span className="text-xs text-muted-foreground font-medium">@</span>

                            <Button
                              variant={picked === game.home_team ? 'default' : 'outline'}
                              size="sm"
                              className="min-w-[100px]"
                              onClick={() => handlePick(gameId, game.home_team)}
                            >
                              {game.home_team}
                              {existingPick?.is_correct === true && existingPick.picked_team === game.home_team && (
                                <CheckCircle className="w-4 h-4 ml-1 text-green-500" />
                              )}
                              {existingPick?.is_correct === false && existingPick.picked_team === game.home_team && (
                                <XCircle className="w-4 h-4 ml-1 text-red-500" />
                              )}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {games.length > 0 && (
                    <div className="mt-6 flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        {picks.size} of {games.length} games picked
                      </span>
                      <Button
                        onClick={handleSubmitPicks}
                        disabled={picks.size === 0 || submitting}
                      >
                        {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        Submit Picks
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="standings">
              <Card className="card-citrus border-none shadow-lg">
                <CardHeader>
                  <CardTitle className="text-lg">Pool Standings</CardTitle>
                </CardHeader>
                <CardContent>
                  {standings.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <p>No standings data yet. Make your picks!</p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">Rank</TableHead>
                          <TableHead>Player</TableHead>
                          <TableHead className="text-center">Correct</TableHead>
                          <TableHead className="text-center">Total</TableHead>
                          <TableHead className="text-right">Accuracy</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {standings.map((s, i) => (
                          <TableRow key={s.user_id} className={s.user_id === user?.id ? 'bg-primary/5' : ''}>
                            <TableCell>
                              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${i < 3 ? 'bg-primary text-white' : 'bg-muted text-muted-foreground'}`}>
                                {i + 1}
                              </span>
                            </TableCell>
                            <TableCell className="font-medium">
                              {s.display_name}
                              {s.user_id === user?.id && <Badge variant="outline" className="ml-2 text-[10px]">YOU</Badge>}
                            </TableCell>
                            <TableCell className="text-center font-bold text-primary">{s.correct_picks}</TableCell>
                            <TableCell className="text-center text-muted-foreground">{s.total_picks}</TableCell>
                            <TableCell className="text-right font-medium">{s.accuracy.toFixed(1)}%</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </main>

      <div className="hidden lg:block"><Footer /></div>
    </div>
  );
};

export default PoolPickem;
