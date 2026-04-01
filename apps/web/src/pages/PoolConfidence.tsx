import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { PoolService, ConfidencePick, ConfidenceStanding } from '@/services/PoolService';
import { NHLGame } from '@/services/ScheduleService';
import { Loader2, BarChart3, ArrowUpDown, CheckCircle, XCircle, ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import { LeagueCreationCTA } from '@/components/LeagueCreationCTA';
import LoadingScreen from '@/components/LoadingScreen';
import { logger } from '@/utils/logger';

interface PickWithConfidence {
  game_id: string;
  picked_team: string;
  confidence_points: number;
}

const PoolConfidence = () => {
  const { user } = useAuth();
  const { userLeagueState, activeLeagueId } = useLeague();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [currentWeek, setCurrentWeek] = useState(() => PoolService.getCurrentWeek());
  const [games, setGames] = useState<NHLGame[]>([]);
  const [picks, setPicks] = useState<Map<string, PickWithConfidence>>(new Map());
  const [existingPicks, setExistingPicks] = useState<ConfidencePick[]>([]);
  const [standings, setStandings] = useState<ConfidenceStanding[]>([]);
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

        const userPicks = await PoolService.getConfidencePicks(
          activeLeagueId, user.id, currentWeek
        );
        setExistingPicks(userPicks);

        const pickMap = new Map<string, PickWithConfidence>();
        userPicks.forEach(p => pickMap.set(p.game_id, {
          game_id: p.game_id,
          picked_team: p.picked_team,
          confidence_points: p.confidence_points,
        }));
        setPicks(pickMap);

        const standingsData = await PoolService.getConfidenceStandings(activeLeagueId);
        setStandings(standingsData);
      } catch (err) {
        logger.error('[PoolConfidence] Error:', err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [activeLeagueId, user, currentWeek]);

  const handleTeamPick = (gameId: string, team: string) => {
    const newPicks = new Map(picks);
    const existing = newPicks.get(gameId);
    if (existing) {
      newPicks.set(gameId, { ...existing, picked_team: team });
    } else {
      const usedPoints = new Set(Array.from(newPicks.values()).map(p => p.confidence_points));
      let nextPoint = games.length;
      while (usedPoints.has(nextPoint) && nextPoint > 0) nextPoint--;
      newPicks.set(gameId, { game_id: gameId, picked_team: team, confidence_points: nextPoint });
    }
    setPicks(newPicks);
  };

  const handleConfidenceChange = (gameId: string, points: number) => {
    const newPicks = new Map(picks);
    const existing = newPicks.get(gameId);
    if (existing) {
      newPicks.set(gameId, { ...existing, confidence_points: points });
    }
    setPicks(newPicks);
  };

  const handleSubmitPicks = async () => {
    if (!activeLeagueId || !user) return;

    const picksArray = Array.from(picks.values());
    const pickableGames = games.filter(g => {
      const locked = g.status === 'live' || g.status === 'final' || (g.game_time && new Date(`${g.game_date}T${g.game_time}`) <= new Date());
      return !locked;
    });

    if (picksArray.length === 0) {
      toast({ title: 'Error', description: 'Make at least one pick before submitting.', variant: 'destructive' });
      return;
    }

    const unlockedPicks = picksArray.filter(p => {
      const game = games.find(g => String(g.id) === p.game_id);
      if (!game) return true;
      const locked = game.status === 'live' || game.status === 'final' || (game.game_time && new Date(`${game.game_date}T${game.game_time}`) <= new Date());
      return !locked;
    });

    if (pickableGames.length > 0 && unlockedPicks.length < pickableGames.length) {
      toast({
        title: 'Incomplete Picks',
        description: `You must pick all ${pickableGames.length} available games. You've picked ${unlockedPicks.length}.`,
        variant: 'destructive'
      });
      return;
    }

    const points = picksArray.map(p => p.confidence_points);
    const uniquePoints = new Set(points);
    if (uniquePoints.size !== points.length) {
      toast({ title: 'Error', description: 'Each pick must have a unique confidence value (1 to N).', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    try {
      const result = await PoolService.submitConfidencePicks(
        activeLeagueId, user.id, currentWeek, picksArray
      );

      if (result.success) {
        toast({ title: 'Picks Submitted', description: `${picksArray.length} confidence picks saved.` });
      } else {
        toast({ title: 'Error', description: result.error || 'Failed to submit picks', variant: 'destructive' });
      }
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to submit picks', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  const usedConfidencePoints = new Set(Array.from(picks.values()).map(p => p.confidence_points));
  const maxPoints = Math.max(games.length, 1);

  if (loading) {
    return <LoadingScreen character="narwhal" message="Loading Confidence Pool..." />;
  }

  return (
    <div className="min-h-screen bg-[#D4E8B8] relative">
      <div className="hidden lg:block"><Navbar /></div>

      <div className="lg:hidden sticky top-0 z-40 bg-[#D4E8B8]/98 backdrop-blur-xl border-b border-citrus-sage/20 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-center h-12 px-4">
          <h1 className="text-lg font-varsity font-bold text-citrus-forest">Confidence Pool</h1>
        </div>
      </div>

      <main className="w-full lg:pt-20 lg:pb-8 pb-[calc(5rem+env(safe-area-inset-bottom))]">
        <div className="max-w-4xl mx-auto px-2 sm:px-4">
          {userLeagueState === 'logged-in-no-league' && (
            <div className="mb-6">
              <LeagueCreationCTA
                title="Join a Confidence Pool"
                description="Create or join a Confidence pool. Rank your picks by how confident you are!"
              />
            </div>
          )}

          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4 sm:mb-6">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 sm:w-6 sm:h-6 text-primary shrink-0" />
              <div>
                <h2 className="text-lg sm:text-2xl font-bold leading-tight">Confidence Pool</h2>
                <p className="text-muted-foreground text-xs sm:text-sm hidden sm:block">Rank by confidence — higher = more points</p>
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
              <TabsTrigger value="picks" className="flex-1 sm:flex-none text-xs sm:text-sm">Rank Picks</TabsTrigger>
              <TabsTrigger value="standings" className="flex-1 sm:flex-none text-xs sm:text-sm">Standings</TabsTrigger>
            </TabsList>

            <TabsContent value="picks">
              <Card className="card-citrus border-none shadow-lg">
                <CardHeader className="px-3 sm:px-6 py-3 sm:py-4">
                  <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                    Week {currentWeek} Games
                    <ArrowUpDown className="w-4 h-4 text-muted-foreground" />
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-2 sm:px-6 pb-4">
                  {games.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-30" />
                      <p className="font-medium">No games available for this week</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {games.map(game => {
                        const gameId = String(game.id);
                        const pick = picks.get(gameId);
                        const existingPick = existingPicks.find(p => p.game_id === gameId);
                        const locked = game.status === 'live' || game.status === 'final' || (game.game_time && new Date(`${game.game_date}T${game.game_time}`) <= new Date());

                        return (
                          <div
                            key={gameId}
                            className={`p-2 sm:p-3 rounded-xl bg-muted/20 border border-transparent hover:border-primary/10 transition-colors ${locked ? 'opacity-60' : ''}`}
                          >
                            {/* Mobile: stack team buttons + confidence; Desktop: single row */}
                            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                              {/* Team pick row */}
                              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1 sm:gap-2 flex-1">
                                <Button
                                  variant={pick?.picked_team === game.away_team ? 'default' : 'outline'}
                                  size="sm"
                                  className="w-full h-8 sm:h-9 text-xs sm:text-sm font-bold"
                                  onClick={() => handleTeamPick(gameId, game.away_team)}
                                  disabled={!!locked}
                                >
                                  {game.away_team}
                                </Button>
                                <div className="text-center px-0.5 min-w-[36px]">
                                  <span className="text-[10px] sm:text-xs text-muted-foreground">@</span>
                                  {locked && (
                                    <div className="text-[10px] text-muted-foreground flex items-center justify-center gap-0.5">
                                      <Lock className="w-2.5 h-2.5" />{game.status === 'final' ? 'F' : 'L'}
                                    </div>
                                  )}
                                </div>
                                <Button
                                  variant={pick?.picked_team === game.home_team ? 'default' : 'outline'}
                                  size="sm"
                                  className="w-full h-8 sm:h-9 text-xs sm:text-sm font-bold"
                                  onClick={() => handleTeamPick(gameId, game.home_team)}
                                  disabled={!!locked}
                                >
                                  {game.home_team}
                                </Button>
                              </div>

                              {/* Confidence + result */}
                              <div className="flex items-center gap-2 justify-end sm:justify-start">
                                <Select
                                  value={pick?.confidence_points?.toString() || ''}
                                  onValueChange={(val) => handleConfidenceChange(gameId, parseInt(val))}
                                  disabled={!pick?.picked_team || !!locked}
                                >
                                  <SelectTrigger className="h-8 w-20 sm:w-24 text-xs">
                                    <SelectValue placeholder="Pts" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {Array.from({ length: maxPoints }, (_, i) => maxPoints - i).map(pts => (
                                      <SelectItem
                                        key={pts}
                                        value={pts.toString()}
                                        disabled={usedConfidencePoints.has(pts) && pick?.confidence_points !== pts}
                                      >
                                        {pts} pts
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>

                                {existingPick?.is_correct !== null && existingPick?.is_correct !== undefined && (
                                  <div className="w-5">
                                    {existingPick.is_correct ? (
                                      <CheckCircle className="w-4 h-4 text-green-500" />
                                    ) : (
                                      <XCircle className="w-4 h-4 text-red-500" />
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {games.length > 0 && (
                    <div className="mt-4 sm:mt-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pt-3 border-t">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 text-xs sm:text-sm">
                        <span className="text-muted-foreground">
                          {picks.size}/{games.length} picked
                        </span>
                        {existingPicks.some(p => p.is_correct !== null) && (
                          <span className="font-bold text-primary">
                            {existingPicks.reduce((sum, p) => sum + (p.is_correct ? (p.confidence_points || 0) : 0), 0)} pts
                            <span className="text-muted-foreground font-normal ml-1">
                              / {existingPicks.reduce((sum, p) => sum + (p.confidence_points || 0), 0)} possible
                            </span>
                          </span>
                        )}
                      </div>
                      <Button
                        onClick={handleSubmitPicks}
                        disabled={picks.size === 0 || submitting}
                        size="sm"
                        className="text-xs sm:text-sm self-end sm:self-auto"
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
                  <CardTitle className="text-base sm:text-lg">Confidence Pool Standings</CardTitle>
                </CardHeader>
                <CardContent className="px-0 sm:px-6">
                  {standings.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground px-4">
                      <p>No standings data yet.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs sm:text-sm">
                        <thead>
                          <tr className="border-b text-muted-foreground">
                            <th className="text-left py-2 px-2 w-8">#</th>
                            <th className="text-left py-2 px-2">Player</th>
                            <th className="text-center py-2 px-2">Pts</th>
                            <th className="text-center py-2 px-2 hidden sm:table-cell">Possible</th>
                            <th className="text-center py-2 px-2 hidden sm:table-cell">Wks</th>
                            <th className="text-right py-2 px-2">Eff</th>
                          </tr>
                        </thead>
                        <tbody>
                          {standings.map((s, i) => (
                            <tr key={s.user_id} className={`border-b last:border-0 ${s.user_id === user?.id ? 'bg-primary/5' : ''}`}>
                              <td className="py-2 px-2">
                                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${i < 3 ? 'bg-primary text-white' : 'bg-muted text-muted-foreground'}`}>
                                  {i + 1}
                                </span>
                              </td>
                              <td className="py-2 px-2 font-medium truncate max-w-[100px] sm:max-w-none">
                                {s.display_name}
                                {s.user_id === user?.id && <Badge variant="outline" className="ml-1 text-[8px] px-1 hidden sm:inline-flex">YOU</Badge>}
                              </td>
                              <td className="py-2 px-2 text-center font-bold text-primary">{s.total_points}</td>
                              <td className="py-2 px-2 text-center text-muted-foreground hidden sm:table-cell">{s.possible_points}</td>
                              <td className="py-2 px-2 text-center hidden sm:table-cell">{s.weeks_played}</td>
                              <td className="py-2 px-2 text-right font-medium">
                                {s.possible_points > 0 ? ((s.total_points / s.possible_points) * 100).toFixed(0) : '0'}%
                              </td>
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

export default PoolConfidence;
