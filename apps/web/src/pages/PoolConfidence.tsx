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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { PoolService, ConfidencePick, ConfidenceStanding } from '@/services/PoolService';
import { NHLGame } from '@/services/ScheduleService';
import { Loader2, BarChart3, CheckCircle2, XCircle, ChevronLeft, ChevronRight, Lock, Calendar } from 'lucide-react';
import { LeagueCreationCTA } from '@/components/LeagueCreationCTA';
import LoadingScreen from '@/components/LoadingScreen';
import { logger } from '@/utils/logger';
import { getTeamColor } from '@/utils/teamColors';

interface PickWithConfidence {
  game_id: string;
  picked_team: string;
  confidence_points: number;
}

/** Parse game_time (full ISO timestamp) */
function parseGameTime(game: NHLGame): Date | null {
  try {
    if (game.game_time) {
      const dt = new Date(game.game_time);
      if (!isNaN(dt.getTime())) return dt;
    }
    if (game.game_date && game.game_date.includes('T')) {
      const dt = new Date(game.game_date);
      if (!isNaN(dt.getTime()) && dt.getHours() !== 0) return dt;
    }
    return null;
  } catch { return null; }
}

function formatTime(game: NHLGame): string {
  const dt = parseGameTime(game);
  if (!dt) return 'TBD';
  return dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}

function formatDateHeader(dateKey: string): string {
  try {
    const dt = new Date(dateKey + 'T12:00:00');
    if (isNaN(dt.getTime())) return dateKey;
    return dt.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  } catch { return dateKey; }
}

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
      if (!activeLeagueId || !user) { setLoading(false); return; }
      try {
        const weekGames = await PoolService.getWeekGames(currentWeek);
        setGames(weekGames || []);
        const userPicks = await PoolService.getConfidencePicks(activeLeagueId, user.id, currentWeek);
        setExistingPicks(userPicks);
        const pickMap = new Map<string, PickWithConfidence>();
        userPicks.forEach(p => pickMap.set(p.game_id, { game_id: p.game_id, picked_team: p.picked_team, confidence_points: p.confidence_points }));
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
    if (picksArray.length === 0) {
      toast({ title: 'Error', description: 'Make at least one pick.', variant: 'destructive' });
      return;
    }
    const points = picksArray.map(p => p.confidence_points);
    if (new Set(points).size !== points.length) {
      toast({ title: 'Error', description: 'Each pick needs a unique confidence value.', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      const result = await PoolService.submitConfidencePicks(activeLeagueId, user.id, currentWeek, picksArray);
      if (result.success) {
        toast({ title: 'Picks Submitted', description: `${picksArray.length} confidence picks saved.` });
      } else {
        toast({ title: 'Error', description: result.error || 'Failed to submit', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to submit picks', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  const usedConfidencePoints = new Set(Array.from(picks.values()).map(p => p.confidence_points));
  const maxPoints = Math.max(games.length, 1);

  if (loading) return <LoadingScreen character="narwhal" message="Loading Confidence Pool..." />;

  const gamesByDate = groupGamesByDate(games);
  const weekPoints = existingPicks.reduce((sum, p) => sum + (p.is_correct ? (p.confidence_points || 0) : 0), 0);
  const weekPossible = existingPicks.reduce((sum, p) => sum + (p.confidence_points || 0), 0);

  return (
    <div className="min-h-screen bg-[#D4E8B8] relative">
      <div className="hidden lg:block"><Navbar /></div>
      <div className="lg:hidden sticky top-0 z-40 bg-[#D4E8B8]/98 backdrop-blur-xl border-b border-citrus-sage/20 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-center h-12 px-4">
          <h1 className="text-lg font-varsity font-bold text-citrus-forest">Confidence Pool</h1>
        </div>
      </div>

      <main className="w-full pt-16 lg:pt-24 lg:pb-8 pb-[calc(5rem+env(safe-area-inset-bottom))]">
        <div className="w-full px-3 sm:px-4 lg:px-6 xl:px-8">
          {userLeagueState === 'logged-in-no-league' && (
            <div className="mb-8 max-w-3xl mx-auto">
              <LeagueCreationCTA title="Join a Confidence Pool" description="Rank your picks by confidence — earn more points for high-confidence correct picks!" />
            </div>
          )}

          {/* Header */}
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
              {existingPicks.some(p => p.is_correct !== null) && (
                <Badge className="text-xs bg-citrus-forest border-0 text-white ml-1">{weekPoints}/{weekPossible} pts</Badge>
              )}
            </div>
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-auto">
              <TabsList>
                <TabsTrigger value="picks">Rank Picks</TabsTrigger>
                <TabsTrigger value="standings">Standings</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {activeTab === 'picks' && (
            <>
              {games.length === 0 ? (
                <Card className="border-none shadow-lg max-w-xl mx-auto">
                  <CardContent className="py-16 text-center text-muted-foreground">
                    <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-30" />
                    <p className="font-medium text-lg">No games this week</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-6">
                  {Array.from(gamesByDate.entries()).map(([dateKey, dateGames]) => (
                    <div key={dateKey}>
                      <div className="flex items-center gap-3 mb-3">
                        <Calendar className="w-4 h-4 text-citrus-sage" />
                        <span className="text-sm font-display font-bold text-citrus-forest uppercase tracking-wide">{formatDateHeader(dateKey)}</span>
                        <div className="flex-1 h-px bg-citrus-sage/20" />
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                        {dateGames.map(game => {
                          const gameId = String(game.id);
                          const pick = picks.get(gameId);
                          const existingPick = existingPicks.find(p => p.game_id === gameId);
                          const gameDateTime = parseGameTime(game);
                          const locked = game.status === 'live' || game.status === 'final' || (gameDateTime && new Date() >= gameDateTime);
                          const isFinal = game.status === 'final';
                          const isLive = game.status === 'live';
                          const awayColor = getTeamColor(game.away_team);
                          const homeColor = getTeamColor(game.home_team);

                          return (
                            <div
                              key={gameId}
                              className={`rounded-xl border overflow-hidden transition-all ${locked ? 'opacity-70' : 'hover:shadow-md'} ${pick ? 'ring-2 ring-citrus-sage/40' : ''}`}
                              style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.8), rgba(232,238,217,0.5))' }}
                            >
                              {/* Status bar */}
                              <div className="flex items-center justify-between px-3 py-1 text-[10px] font-display uppercase tracking-widest"
                                style={{ background: isFinal ? '#1B3022' : isLive ? '#dc2626' : 'rgba(120,149,97,0.15)', color: isFinal || isLive ? '#fff' : '#789561' }}
                              >
                                <span>
                                  {isFinal ? `Final · ${game.away_score}–${game.home_score}` :
                                   isLive ? `Live · ${game.away_score}–${game.home_score}` :
                                   locked ? '🔒 Locked' : formatTime(game)}
                                </span>
                                {/* Confidence selector inline */}
                                {pick && (
                                  <span className="font-bold text-xs" style={{ color: isFinal || isLive ? '#FFB81C' : '#1B3022' }}>
                                    {pick.confidence_points} pts
                                  </span>
                                )}
                              </div>

                              {/* Teams + confidence */}
                              <div className="flex items-stretch">
                                {/* Away */}
                                <button
                                  className="flex-1 py-3 px-2 text-center font-varsity text-sm uppercase tracking-wide transition-all border-r border-citrus-sage/10 disabled:cursor-not-allowed"
                                  style={pick?.picked_team === game.away_team ? { background: awayColor, color: '#fff' } : {}}
                                  onClick={() => handleTeamPick(gameId, game.away_team)}
                                  disabled={!!locked}
                                >
                                  <div className="flex items-center justify-center gap-1.5">
                                    {(!pick || pick.picked_team !== game.away_team) && <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: awayColor }} />}
                                    <span className="font-bold">{game.away_team}</span>
                                    {existingPick?.is_correct === true && existingPick.picked_team === game.away_team && <CheckCircle2 className="w-4 h-4 text-green-400" />}
                                    {existingPick?.is_correct === false && existingPick.picked_team === game.away_team && <XCircle className="w-4 h-4 text-red-400" />}
                                  </div>
                                </button>

                                {/* Confidence selector */}
                                <div className="flex items-center justify-center w-20 shrink-0 bg-citrus-cream/30">
                                  <Select
                                    value={pick?.confidence_points?.toString() || ''}
                                    onValueChange={(val) => handleConfidenceChange(gameId, parseInt(val))}
                                    disabled={!pick?.picked_team || !!locked}
                                  >
                                    <SelectTrigger className="h-8 w-16 text-xs border-0 bg-transparent font-varsity font-bold text-center">
                                      <SelectValue placeholder="—" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {Array.from({ length: maxPoints }, (_, i) => maxPoints - i).map(pts => (
                                        <SelectItem key={pts} value={pts.toString()} disabled={usedConfidencePoints.has(pts) && pick?.confidence_points !== pts}>
                                          {pts} pts
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>

                                {/* Home */}
                                <button
                                  className="flex-1 py-3 px-2 text-center font-varsity text-sm uppercase tracking-wide transition-all border-l border-citrus-sage/10 disabled:cursor-not-allowed"
                                  style={pick?.picked_team === game.home_team ? { background: homeColor, color: '#fff' } : {}}
                                  onClick={() => handleTeamPick(gameId, game.home_team)}
                                  disabled={!!locked}
                                >
                                  <div className="flex items-center justify-center gap-1.5">
                                    <span className="font-bold">{game.home_team}</span>
                                    {(!pick || pick.picked_team !== game.home_team) && <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: homeColor }} />}
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

                  {/* Submit bar */}
                  <div className="sticky bottom-20 lg:bottom-4 bg-[#D4E8B8]/95 backdrop-blur-sm border border-citrus-sage/20 rounded-xl py-3 px-4 flex items-center justify-between shadow-lg">
                    <span className="text-sm font-display text-citrus-charcoal/60">
                      {picks.size === 0 ? 'Pick a team, then assign confidence points' : `${picks.size} of ${games.length} games picked`}
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
                    <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-30" />
                    <p className="font-medium">No standings yet</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/30">
                          <TableHead className="w-12 text-center">#</TableHead>
                          <TableHead>Player</TableHead>
                          <TableHead className="text-center">Pts</TableHead>
                          <TableHead className="text-center hidden sm:table-cell">Possible</TableHead>
                          <TableHead className="text-center hidden sm:table-cell">Weeks</TableHead>
                          <TableHead className="text-right">Efficiency</TableHead>
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
                            <TableCell className="text-center font-bold text-primary">{s.total_points}</TableCell>
                            <TableCell className="text-center text-muted-foreground hidden sm:table-cell">{s.possible_points}</TableCell>
                            <TableCell className="text-center hidden sm:table-cell">{s.weeks_played}</TableCell>
                            <TableCell className="text-right font-semibold">
                              {s.possible_points > 0 ? ((s.total_points / s.possible_points) * 100).toFixed(1) : '0.0'}%
                            </TableCell>
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

export default PoolConfidence;
