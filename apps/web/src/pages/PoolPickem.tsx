import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { PoolService, PickemPick, PickemStanding } from '@/services/PoolService';
import { NHLGame } from '@/services/ScheduleService';
import { Loader2, CheckCircle, XCircle, Target, ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import { LeagueCreationCTA } from '@/components/LeagueCreationCTA';
import LoadingScreen from '@/components/LoadingScreen';
import { logger } from '@/utils/logger';

const PoolPickem = () => {
  const { user } = useAuth();
  const { userLeagueState, activeLeagueId } = useLeague();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [currentWeek, setCurrentWeek] = useState(() => PoolService.getCurrentWeek());
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
        const weekGames = await PoolService.getWeekGames(currentWeek);
        setGames(weekGames || []);

        const userPicks = await PoolService.getPickemPicks(
          activeLeagueId, user.id, currentWeek
        );
        setExistingPicks(userPicks);

        const pickMap = new Map<string, string>();
        userPicks.forEach(p => pickMap.set(p.game_id, p.picked_team));
        setPicks(pickMap);

        const standingsData = await PoolService.getPickemStandings(activeLeagueId);
        setStandings(standingsData);
      } catch (err) {
        logger.error('[PoolPickem] Error loading data:', err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [activeLeagueId, user, currentWeek]);

  const handlePick = (gameId: string, team: string) => {
    const newPicks = new Map(picks);
    if (newPicks.get(gameId) === team) {
      newPicks.delete(gameId);
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
        <div className="max-w-4xl mx-auto px-2 sm:px-4">
          {userLeagueState === 'logged-in-no-league' && (
            <div className="mb-6">
              <LeagueCreationCTA
                title="Join a Pick'em Pool"
                description="Create or join a Pick'em pool to start predicting NHL game winners."
              />
            </div>
          )}

          {/* Header: stacks on mobile, row on desktop */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4 sm:mb-6">
            <div className="flex items-center gap-2">
              <Target className="w-5 h-5 sm:w-6 sm:h-6 text-primary shrink-0" />
              <div>
                <h2 className="text-lg sm:text-2xl font-bold leading-tight">Pick'em Pool</h2>
                <p className="text-muted-foreground text-xs sm:text-sm hidden sm:block">Pick the winners of NHL games each week</p>
              </div>
            </div>
            <div className="flex items-center gap-1 self-end sm:self-auto">
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setCurrentWeek(w => Math.max(1, w - 1))} disabled={currentWeek <= 1}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Badge variant="outline" className="text-xs sm:text-sm whitespace-nowrap">Week {currentWeek}</Badge>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setCurrentWeek(w => w + 1)}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-4 sm:mb-6 w-full sm:w-auto">
              <TabsTrigger value="picks" className="flex-1 sm:flex-none text-xs sm:text-sm">Make Picks</TabsTrigger>
              <TabsTrigger value="standings" className="flex-1 sm:flex-none text-xs sm:text-sm">Standings</TabsTrigger>
            </TabsList>

            <TabsContent value="picks">
              <Card className="card-citrus border-none shadow-lg">
                <CardHeader className="px-3 sm:px-6 py-3 sm:py-4">
                  <CardTitle className="text-base sm:text-lg">Week {currentWeek} Games</CardTitle>
                </CardHeader>
                <CardContent className="px-2 sm:px-6 pb-4">
                  {games.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <Target className="w-12 h-12 mx-auto mb-4 opacity-30" />
                      <p className="font-medium">No games available for this week</p>
                      <p className="text-sm mt-1">Games will appear once the NHL schedule is loaded.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {games.map(game => {
                        const gameId = String(game.id);
                        const picked = picks.get(gameId);
                        const existingPick = existingPicks.find(p => p.game_id === gameId);
                        const isPostponed = game.status === 'postponed';
                        const locked = isPostponed || game.status === 'live' || game.status === 'final' || (game.game_time && new Date(`${game.game_date}T${game.game_time}`) <= new Date());

                        const ResultIcon = ({ team }: { team: string }) => {
                          if (existingPick?.is_correct === true && existingPick.picked_team === team) {
                            return <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />;
                          }
                          if (existingPick?.is_correct === false && existingPick.picked_team === team) {
                            return <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />;
                          }
                          return null;
                        };

                        return (
                          <div
                            key={gameId}
                            className={`grid grid-cols-[1fr_auto_1fr] items-center gap-1 sm:gap-3 p-2 sm:p-3 rounded-xl bg-muted/20 border border-transparent hover:border-primary/10 transition-colors ${locked ? 'opacity-60' : ''} ${isPostponed ? 'line-through' : ''}`}
                          >
                            {/* Away team */}
                            <Button
                              variant={picked === game.away_team ? 'default' : 'outline'}
                              size="sm"
                              className="w-full h-9 sm:h-10 text-xs sm:text-sm font-bold justify-center gap-1"
                              onClick={() => handlePick(gameId, game.away_team)}
                              disabled={!!locked}
                            >
                              <span className="truncate">{game.away_team}</span>
                              <ResultIcon team={game.away_team} />
                            </Button>

                            {/* Center: @ + time/status */}
                            <div className="text-center px-1 min-w-[40px] sm:min-w-[60px]">
                              <span className="text-[10px] sm:text-xs text-muted-foreground font-medium">@</span>
                              {game.game_time && (
                                <div className="text-[10px] sm:text-xs text-muted-foreground leading-tight">
                                  {locked ? (
                                    <span className="flex items-center justify-center gap-0.5">
                                      <Lock className="w-2.5 h-2.5" />
                                      {isPostponed ? 'PPD' : game.status === 'final' ? 'Final' : game.status === 'live' ? 'Live' : 'Locked'}
                                    </span>
                                  ) : (
                                    new Date(`${game.game_date}T${game.game_time}`).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                                  )}
                                </div>
                              )}
                              {game.status === 'final' && (
                                <div className="text-[10px] sm:text-xs font-bold">{game.away_score}-{game.home_score}</div>
                              )}
                            </div>

                            {/* Home team */}
                            <Button
                              variant={picked === game.home_team ? 'default' : 'outline'}
                              size="sm"
                              className="w-full h-9 sm:h-10 text-xs sm:text-sm font-bold justify-center gap-1"
                              onClick={() => handlePick(gameId, game.home_team)}
                              disabled={!!locked}
                            >
                              <span className="truncate">{game.home_team}</span>
                              <ResultIcon team={game.home_team} />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {games.length > 0 && (
                    <div className="mt-4 sm:mt-6 flex items-center justify-between pt-3 border-t">
                      <span className="text-xs sm:text-sm text-muted-foreground">
                        {picks.size}/{games.length} picked
                      </span>
                      <Button
                        onClick={handleSubmitPicks}
                        disabled={picks.size === 0 || submitting}
                        size="sm"
                        className="text-xs sm:text-sm"
                      >
                        {submitting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                        Submit Picks
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="standings">
              <Card className="card-citrus border-none shadow-lg">
                <CardHeader className="px-3 sm:px-6 py-3 sm:py-4">
                  <CardTitle className="text-base sm:text-lg">Pool Standings</CardTitle>
                </CardHeader>
                <CardContent className="px-0 sm:px-6">
                  {standings.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground px-4">
                      <p>No standings data yet. Make your picks!</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs sm:text-sm">
                        <thead>
                          <tr className="border-b text-muted-foreground">
                            <th className="text-left py-2 px-2 sm:px-3 w-8">#</th>
                            <th className="text-left py-2 px-2 sm:px-3">Player</th>
                            <th className="text-center py-2 px-2 sm:px-3 hidden sm:table-cell">Wk {currentWeek}</th>
                            <th className="text-center py-2 px-2 sm:px-3">Correct</th>
                            <th className="text-center py-2 px-2 sm:px-3 hidden sm:table-cell">Total</th>
                            <th className="text-right py-2 px-2 sm:px-3">Pct</th>
                          </tr>
                        </thead>
                        <tbody>
                          {standings.map((s, i) => (
                            <tr key={s.user_id} className={`border-b last:border-0 ${s.user_id === user?.id ? 'bg-primary/5' : ''}`}>
                              <td className="py-2 px-2 sm:px-3">
                                <span className={`w-5 h-5 sm:w-6 sm:h-6 rounded-full flex items-center justify-center text-[10px] sm:text-xs font-bold ${i < 3 ? 'bg-primary text-white' : 'bg-muted text-muted-foreground'}`}>
                                  {i + 1}
                                </span>
                              </td>
                              <td className="py-2 px-2 sm:px-3 font-medium truncate max-w-[120px] sm:max-w-none">
                                {s.display_name}
                                {s.user_id === user?.id && <Badge variant="outline" className="ml-1 text-[8px] sm:text-[10px] px-1">YOU</Badge>}
                              </td>
                              <td className="py-2 px-2 sm:px-3 text-center font-bold text-amber-600 hidden sm:table-cell">
                                {(s as any).weekly_correct?.[currentWeek] ?? '-'}
                              </td>
                              <td className="py-2 px-2 sm:px-3 text-center font-bold text-primary">{s.correct_picks}</td>
                              <td className="py-2 px-2 sm:px-3 text-center text-muted-foreground hidden sm:table-cell">{s.total_picks}</td>
                              <td className="py-2 px-2 sm:px-3 text-right font-medium">{s.accuracy.toFixed(1)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
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
