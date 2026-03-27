import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Card, CardContent } from '@/components/ui/card';
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
import { getTeamColor } from '@/utils/teamColors';

/** Parse game_time (full ISO string like "2026-03-27T23:00:00+00:00") into a Date */
function parseGameTime(game: NHLGame): Date | null {
  try {
    // game_time is a full ISO timestamp when available
    if (game.game_time) {
      const dt = new Date(game.game_time);
      if (!isNaN(dt.getTime())) return dt;
    }
    // Fall back to game_date if it has a time component
    if (game.game_date && game.game_date.includes('T')) {
      const dt = new Date(game.game_date);
      if (!isNaN(dt.getTime()) && dt.getHours() !== 0) return dt;
    }
    return null;
  } catch {
    return null;
  }
}

/** Format time for display: "7:00 PM ET" */
function formatTime(game: NHLGame): string {
  const dt = parseGameTime(game);
  if (!dt) return 'TBD';
  return dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}

/** Format date header: "Friday, Mar 28" */
function formatDateHeader(dateKey: string): string {
  try {
    const dt = new Date(dateKey + 'T12:00:00');
    if (isNaN(dt.getTime())) return dateKey;
    return dt.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  } catch {
    return dateKey;
  }
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

/** Get a subtle background gradient for a team button when selected */
function getTeamButtonStyle(team: string, isSelected: boolean) {
  if (!isSelected) return {};
  const color = getTeamColor(team);
  return {
    background: color,
    borderColor: color,
    color: '#fff',
  };
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
        const userPicks = await PoolService.getPickemPicks(activeLeagueId, user.id, currentWeek);
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
      const picksArray = Array.from(picks.entries()).map(([game_id, picked_team]) => ({ game_id, picked_team }));
      const result = await PoolService.submitPickemPicks(activeLeagueId, user.id, currentWeek, picksArray);
      if (result.success) {
        toast({ title: 'Picks Submitted', description: `${picksArray.length} picks saved.` });
      } else {
        toast({ title: 'Error', description: result.error || 'Failed to submit picks', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to submit picks', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <LoadingScreen character="narwhal" message="Loading Pick'em Pool..." />;

  const gamesByDate = groupGamesByDate(games);

  return (
    <div className="min-h-screen bg-[#D4E8B8] relative">
      <div className="hidden lg:block"><Navbar /></div>
      <div className="lg:hidden sticky top-0 z-40 bg-[#D4E8B8]/98 backdrop-blur-xl border-b border-citrus-sage/20 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-center h-12 px-4">
          <h1 className="text-lg font-varsity font-bold text-citrus-forest">Pick'em Pool</h1>
        </div>
      </div>

      <main className="w-full pt-16 lg:pt-24 lg:pb-8 pb-[calc(5rem+env(safe-area-inset-bottom))]">
        <div className="w-full px-3 sm:px-4 lg:px-6 xl:px-8">
          {userLeagueState === 'logged-in-no-league' && (
            <div className="mb-8 max-w-3xl mx-auto">
              <LeagueCreationCTA title="Join a Pick'em Pool" description="Create or join a Pick'em pool to start predicting NHL game winners." />
            </div>
          )}

          {/* Week nav + tabs */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentWeek(w => Math.max(1, w - 1))} disabled={currentWeek <= 1}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Badge variant="outline" className="text-sm font-varsity px-3 py-1">Week {currentWeek}</Badge>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentWeek(w => w + 1)}>
                <ChevronRight className="w-4 h-4" />
              </Button>
              <Badge variant="secondary" className="text-xs ml-2">{picks.size}/{games.length} picked</Badge>
            </div>
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-auto">
              <TabsList>
                <TabsTrigger value="picks">Make Picks</TabsTrigger>
                <TabsTrigger value="standings">Standings</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {activeTab === 'picks' && (
            <>
              {games.length === 0 ? (
                <Card className="border-none shadow-lg max-w-xl mx-auto">
                  <CardContent className="py-16 text-center text-muted-foreground">
                    <Target className="w-12 h-12 mx-auto mb-4 opacity-30" />
                    <p className="font-medium text-lg">No games this week</p>
                    <p className="text-sm mt-1">Games will appear once the NHL schedule is loaded.</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-8">
                  {Array.from(gamesByDate.entries()).map(([dateKey, dateGames]) => (
                    <div key={dateKey}>
                      {/* Date header */}
                      <div className="flex items-center gap-3 mb-3">
                        <Calendar className="w-4 h-4 text-citrus-sage" />
                        <span className="text-sm font-display font-bold text-citrus-forest uppercase tracking-wide">
                          {formatDateHeader(dateKey)}
                        </span>
                        <div className="flex-1 h-px bg-citrus-sage/20" />
                        <Badge variant="outline" className="text-xs">{dateGames.length} {dateGames.length === 1 ? 'game' : 'games'}</Badge>
                      </div>

                      {/* Games grid — 3 cols on xl, 2 on lg, 1 on mobile */}
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                        {dateGames.map(game => {
                          const gameId = String(game.id);
                          const picked = picks.get(gameId);
                          const existingPick = existingPicks.find(p => p.game_id === gameId);
                          const isPostponed = game.status === 'postponed';
                          const gameDateTime = parseGameTime(game);
                          const locked = isPostponed || game.status === 'live' || game.status === 'final' || (gameDateTime && new Date() >= gameDateTime);
                          const isFinal = game.status === 'final';
                          const isLive = game.status === 'live';
                          const awayColor = getTeamColor(game.away_team);
                          const homeColor = getTeamColor(game.home_team);

                          return (
                            <div
                              key={gameId}
                              className={`rounded-xl border overflow-hidden transition-all ${
                                locked ? 'opacity-70' : 'hover:shadow-md'
                              } ${picked ? 'ring-2 ring-citrus-sage/40' : ''} ${isPostponed ? 'opacity-40' : ''}`}
                              style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.8), rgba(232,238,217,0.5))' }}
                            >
                              {/* Game status bar */}
                              <div className="flex items-center justify-center py-1 text-[10px] font-display uppercase tracking-widest"
                                style={{ background: isFinal ? '#1B3022' : isLive ? '#dc2626' : 'rgba(120,149,97,0.15)', color: isFinal || isLive ? '#fff' : '#789561' }}
                              >
                                {isFinal ? `Final · ${game.away_score}–${game.home_score}` :
                                 isLive ? `Live · ${game.away_score}–${game.home_score}` :
                                 locked ? '🔒 Locked' :
                                 formatTime(game)}
                              </div>

                              {/* Teams row */}
                              <div className="flex items-stretch">
                                {/* Away team */}
                                <button
                                  className="flex-1 py-3 px-2 text-center font-varsity text-sm uppercase tracking-wide transition-all border-r border-citrus-sage/10 disabled:cursor-not-allowed"
                                  style={picked === game.away_team ? getTeamButtonStyle(game.away_team, true) : {}}
                                  onClick={() => handlePick(gameId, game.away_team)}
                                  disabled={!!locked}
                                >
                                  <div className="flex items-center justify-center gap-1.5">
                                    {!picked || picked !== game.away_team ? (
                                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: awayColor }} />
                                    ) : null}
                                    <span className="font-bold">{game.away_team}</span>
                                    {existingPick?.is_correct === true && existingPick.picked_team === game.away_team && <CheckCircle2 className="w-4 h-4 text-green-400" />}
                                    {existingPick?.is_correct === false && existingPick.picked_team === game.away_team && <XCircle className="w-4 h-4 text-red-400" />}
                                  </div>
                                </button>

                                {/* VS divider */}
                                <div className="flex items-center justify-center w-8 text-[10px] text-citrus-charcoal/30 font-bold flex-shrink-0">
                                  @
                                </div>

                                {/* Home team */}
                                <button
                                  className="flex-1 py-3 px-2 text-center font-varsity text-sm uppercase tracking-wide transition-all border-l border-citrus-sage/10 disabled:cursor-not-allowed"
                                  style={picked === game.home_team ? getTeamButtonStyle(game.home_team, true) : {}}
                                  onClick={() => handlePick(gameId, game.home_team)}
                                  disabled={!!locked}
                                >
                                  <div className="flex items-center justify-center gap-1.5">
                                    <span className="font-bold">{game.home_team}</span>
                                    {!picked || picked !== game.home_team ? (
                                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: homeColor }} />
                                    ) : null}
                                    {existingPick?.is_correct === true && existingPick.picked_team === game.home_team && <CheckCircle2 className="w-4 h-4 text-green-400" />}
                                    {existingPick?.is_correct === false && existingPick.picked_team === game.home_team && <XCircle className="w-4 h-4 text-red-400" />}
                                  </div>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  {/* Sticky submit bar */}
                  <div className="sticky bottom-20 lg:bottom-4 bg-[#D4E8B8]/95 backdrop-blur-sm border border-citrus-sage/20 rounded-xl py-3 px-4 flex items-center justify-between shadow-lg">
                    <span className="text-sm font-display text-citrus-charcoal/60">
                      {picks.size === 0 ? 'Tap a team to pick them' : `${picks.size} of ${games.length} games picked`}
                    </span>
                    <Button onClick={handleSubmitPicks} disabled={picks.size === 0 || submitting} className="font-varsity uppercase">
                      {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      Submit Picks
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === 'standings' && (
            <Card className="border-none shadow-lg overflow-hidden max-w-4xl mx-auto">
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
                                i === 0 ? 'bg-amber-400 text-white' : i === 1 ? 'bg-gray-300 text-gray-700' : i === 2 ? 'bg-amber-600 text-white' : 'text-muted-foreground'
                              }`}>{i + 1}</span>
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
          )}
        </div>
      </main>

      <div className="hidden lg:block"><Footer /></div>
    </div>
  );
};

export default PoolPickem;
