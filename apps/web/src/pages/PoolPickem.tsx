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
import { NHLGame } from '@/services/ScheduleService';
import { Loader2, CheckCircle2, XCircle, Target, ChevronLeft, ChevronRight, Lock, Calendar } from 'lucide-react';
import { LeagueCreationCTA } from '@/components/LeagueCreationCTA';
import LoadingScreen from '@/components/LoadingScreen';
import { logger } from '@/utils/logger';

/** Safely parse a game date + optional time into a Date object.
 *  game_date can be a full ISO timestamp like "2026-03-27T19:00:00+00:00"
 *  or just a date "2026-03-27". game_time may be null. */
function parseGameDateTime(gameDate: string, gameTime: string | null): Date | null {
  try {
    // If game_time is provided explicitly, use it
    if (gameTime) {
      const dt = new Date(`${gameDate.split('T')[0]}T${gameTime}`);
      return isNaN(dt.getTime()) ? null : dt;
    }
    // Try parsing the full game_date (might contain time in ISO format)
    const dt = new Date(gameDate);
    if (!isNaN(dt.getTime()) && gameDate.includes('T')) {
      return dt;
    }
    // Date-only string — no time info available
    return null;
  } catch {
    return null;
  }
}

/** Format a game date for display: "Tue, Mar 25" */
function formatGameDate(gameDate: string): string {
  try {
    const dt = new Date(gameDate.split('T')[0] + 'T12:00:00');
    if (isNaN(dt.getTime())) return '';
    return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

/** Format a game time for display: "7:00 PM" */
function formatGameTime(gameDate: string, gameTime: string | null): string {
  const dt = parseGameDateTime(gameDate, gameTime);
  if (!dt) return 'TBD';
  // Check if the time is midnight (00:00) — likely means no real time data
  if (dt.getHours() === 0 && dt.getMinutes() === 0 && !gameTime) return 'TBD';
  return dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** Group games by date */
function groupGamesByDate(games: NHLGame[]): Map<string, NHLGame[]> {
  const grouped = new Map<string, NHLGame[]>();
  for (const game of games) {
    const dateKey = game.game_date.split('T')[0];
    const existing = grouped.get(dateKey) || [];
    existing.push(game);
    grouped.set(dateKey, existing);
  }
  return grouped;
}

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

  const gamesByDate = groupGamesByDate(games);
  const pickedCount = picks.size;
  const totalGames = games.length;

  return (
    <div className="min-h-screen bg-[#D4E8B8] relative">
      <div className="hidden lg:block"><Navbar /></div>

      <div className="lg:hidden sticky top-0 z-40 bg-[#D4E8B8]/98 backdrop-blur-xl border-b border-citrus-sage/20 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-center h-12 px-4">
          <h1 className="text-lg font-varsity font-bold text-citrus-forest">Pick'em Pool</h1>
        </div>
      </div>

      <main className="w-full pt-16 lg:pt-24 lg:pb-8 pb-[calc(5rem+env(safe-area-inset-bottom))]">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 lg:px-6">
          {userLeagueState === 'logged-in-no-league' && (
            <div className="mb-8">
              <LeagueCreationCTA
                title="Join a Pick'em Pool"
                description="Create or join a Pick'em pool to start predicting NHL game winners."
              />
            </div>
          )}

          {/* Week navigator + pick counter */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentWeek(w => Math.max(1, w - 1))} disabled={currentWeek <= 1}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Badge variant="outline" className="text-sm font-varsity px-3 py-1">Week {currentWeek}</Badge>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentWeek(w => w + 1)}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
            <Badge variant="secondary" className="text-sm">
              {pickedCount}/{totalGames} picked
            </Badge>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="w-full grid grid-cols-2 mb-4">
              <TabsTrigger value="picks">Make Picks</TabsTrigger>
              <TabsTrigger value="standings">Standings</TabsTrigger>
            </TabsList>

            <TabsContent value="picks">
              {games.length === 0 ? (
                <Card className="border-none shadow-lg">
                  <CardContent className="py-16 text-center text-muted-foreground">
                    <Target className="w-12 h-12 mx-auto mb-4 opacity-30" />
                    <p className="font-medium text-lg">No games this week</p>
                    <p className="text-sm mt-1">Games will appear once the NHL schedule is loaded.</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-6">
                  {Array.from(gamesByDate.entries()).map(([dateKey, dateGames]) => (
                    <div key={dateKey}>
                      {/* Date header */}
                      <div className="flex items-center gap-2 mb-3 px-1">
                        <Calendar className="w-3.5 h-3.5 text-citrus-sage" />
                        <span className="text-xs font-display font-bold text-citrus-forest/70 uppercase tracking-wider">
                          {formatGameDate(dateKey)}
                        </span>
                        <div className="flex-1 h-px bg-citrus-sage/20" />
                        <span className="text-xs text-citrus-charcoal/40">{dateGames.length} games</span>
                      </div>

                      {/* Games grid: 2 columns on desktop, 1 on mobile */}
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                        {dateGames.map(game => {
                          const gameId = String(game.id);
                          const picked = picks.get(gameId);
                          const existingPick = existingPicks.find(p => p.game_id === gameId);
                          const isPostponed = game.status === 'postponed';
                          const gameDateTime = parseGameDateTime(game.game_date, game.game_time);
                          const locked = isPostponed || game.status === 'live' || game.status === 'final' || (gameDateTime && new Date() >= gameDateTime);
                          const isFinal = game.status === 'final';
                          const isLive = game.status === 'live';

                          return (
                            <div
                              key={gameId}
                              className={`flex items-center gap-1.5 sm:gap-3 p-2.5 sm:p-3 rounded-xl border-2 transition-all ${
                                locked
                                  ? 'bg-citrus-cream/50 border-citrus-sage/10 opacity-70'
                                  : picked
                                    ? 'bg-citrus-sage/10 border-citrus-sage/30 shadow-sm'
                                    : 'bg-white/60 border-transparent hover:border-citrus-sage/20 hover:shadow-sm'
                              } ${isPostponed ? 'line-through opacity-40' : ''}`}
                            >
                              {/* Away team */}
                              <Button
                                variant={picked === game.away_team ? 'default' : 'outline'}
                                size="sm"
                                className={`flex-1 h-10 font-varsity text-sm uppercase tracking-wide ${
                                  picked === game.away_team ? 'bg-citrus-forest text-white border-citrus-forest' : ''
                                }`}
                                onClick={() => handlePick(gameId, game.away_team)}
                                disabled={!!locked}
                              >
                                {game.away_team}
                                {existingPick?.is_correct === true && existingPick.picked_team === game.away_team && (
                                  <CheckCircle2 className="w-4 h-4 ml-1.5 text-green-400" />
                                )}
                                {existingPick?.is_correct === false && existingPick.picked_team === game.away_team && (
                                  <XCircle className="w-4 h-4 ml-1.5 text-red-400" />
                                )}
                              </Button>

                              {/* Center: time/status/score */}
                              <div className="flex flex-col items-center w-20 sm:w-24 flex-shrink-0">
                                {isFinal ? (
                                  <>
                                    <span className="text-[10px] font-display text-citrus-charcoal/50 uppercase">Final</span>
                                    <span className="text-sm font-varsity font-bold text-citrus-forest">{game.away_score}–{game.home_score}</span>
                                  </>
                                ) : isLive ? (
                                  <>
                                    <span className="text-[10px] font-display text-red-500 uppercase font-bold animate-pulse">Live</span>
                                    <span className="text-sm font-varsity font-bold text-citrus-forest">{game.away_score}–{game.home_score}</span>
                                  </>
                                ) : locked ? (
                                  <span className="flex items-center gap-1 text-xs text-citrus-charcoal/40">
                                    <Lock className="w-3 h-3" />
                                    {isPostponed ? 'PPD' : 'Locked'}
                                  </span>
                                ) : (
                                  <>
                                    <span className="text-[10px] font-display text-citrus-charcoal/50">@</span>
                                    <span className="text-xs font-display font-semibold text-citrus-forest">
                                      {formatGameTime(game.game_date, game.game_time)}
                                    </span>
                                  </>
                                )}
                              </div>

                              {/* Home team */}
                              <Button
                                variant={picked === game.home_team ? 'default' : 'outline'}
                                size="sm"
                                className={`flex-1 h-10 font-varsity text-sm uppercase tracking-wide ${
                                  picked === game.home_team ? 'bg-citrus-forest text-white border-citrus-forest' : ''
                                }`}
                                onClick={() => handlePick(gameId, game.home_team)}
                                disabled={!!locked}
                              >
                                {game.home_team}
                                {existingPick?.is_correct === true && existingPick.picked_team === game.home_team && (
                                  <CheckCircle2 className="w-4 h-4 ml-1.5 text-green-400" />
                                )}
                                {existingPick?.is_correct === false && existingPick.picked_team === game.home_team && (
                                  <XCircle className="w-4 h-4 ml-1.5 text-red-400" />
                                )}
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  {/* Submit bar */}
                  <div className="sticky bottom-20 lg:bottom-4 bg-[#D4E8B8]/95 backdrop-blur-sm border-t border-citrus-sage/20 py-3 px-1 -mx-1 flex items-center justify-between">
                    <span className="text-sm font-display text-citrus-charcoal/60">
                      {pickedCount === 0 ? 'Tap a team to make your pick' : `${pickedCount} of ${totalGames} games picked`}
                    </span>
                    <Button
                      onClick={handleSubmitPicks}
                      disabled={pickedCount === 0 || submitting}
                      className="font-varsity uppercase"
                    >
                      {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      Submit Picks
                    </Button>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="standings">
              <Card className="border-none shadow-lg overflow-hidden">
                <CardContent className="p-0">
                  {standings.length === 0 ? (
                    <div className="text-center py-16 text-muted-foreground">
                      <Target className="w-12 h-12 mx-auto mb-4 opacity-30" />
                      <p className="font-medium">No standings yet</p>
                      <p className="text-sm mt-1">Make your picks to get on the board!</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/30">
                            <TableHead className="w-12 text-center">#</TableHead>
                            <TableHead>Player</TableHead>
                            <TableHead className="text-center">Correct</TableHead>
                            <TableHead className="text-center hidden sm:table-cell">Total</TableHead>
                            <TableHead className="text-right">Accuracy</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {standings.map((s, i) => (
                            <TableRow key={s.user_id} className={s.user_id === user?.id ? 'bg-primary/5' : ''}>
                              <TableCell className="text-center">
                                <span className={`inline-flex w-6 h-6 rounded-full items-center justify-center text-xs font-bold ${
                                  i === 0 ? 'bg-amber-400 text-white' :
                                  i === 1 ? 'bg-gray-300 text-gray-700' :
                                  i === 2 ? 'bg-amber-600 text-white' :
                                  'text-muted-foreground'
                                }`}>
                                  {i + 1}
                                </span>
                              </TableCell>
                              <TableCell className="font-medium">
                                {s.display_name}
                                {s.user_id === user?.id && <Badge variant="outline" className="ml-2 text-xs">YOU</Badge>}
                              </TableCell>
                              <TableCell className="text-center font-bold text-primary">{s.correct_picks}</TableCell>
                              <TableCell className="text-center text-muted-foreground hidden sm:table-cell">{s.total_picks}</TableCell>
                              <TableCell className="text-right font-semibold">{s.accuracy.toFixed(1)}%</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
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
