import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { PoolService, PickemPick, PickemStanding } from '@/services/PoolService';
import { NHLGame } from '@/services/ScheduleService';
import { Loader2, CheckCircle2, XCircle, Target, ChevronLeft, ChevronRight, Lock, Calendar, Check } from 'lucide-react';
import { LeagueCreationCTA } from '@/components/LeagueCreationCTA';
import LoadingScreen from '@/components/LoadingScreen';
import { logger } from '@/utils/logger';
import { getTeamInfo, type NHLTeamInfo } from '@/types/captracker';

// ── Helpers ──────────────────────────────────────────────────────────

function parseGameTime(game: NHLGame): Date | null {
  try {
    if (game.game_time) {
      const dt = new Date(game.game_time);
      if (!isNaN(dt.getTime())) return dt;
    }
    if (game.game_date?.includes('T')) {
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
    const list = grouped.get(dateKey) || [];
    list.push(game);
    grouped.set(dateKey, list);
  }
  return grouped;
}

function getInfo(abbrev: string): NHLTeamInfo {
  return getTeamInfo(abbrev) || { abbrev, name: abbrev, fullName: abbrev, conference: 'Eastern' as const, division: '', primaryColor: '#666', secondaryColor: '#999', logoUrl: '' };
}

// ── Team Monogram ────────────────────────────────────────────────────

function TeamMonogram({ abbrev, size = 40 }: { abbrev: string; size?: number }) {
  const info = getInfo(abbrev);
  return (
    <div
      className="rounded-lg flex items-center justify-center font-varsity font-black text-white tracking-wide shadow-sm"
      style={{ width: size, height: size, background: info.primaryColor, fontSize: size * 0.32 }}
    >
      {abbrev}
    </div>
  );
}

// ── Game Card ────────────────────────────────────────────────────────

function GameCard({
  game, picked, existingPick, onPick,
}: {
  game: NHLGame;
  picked: string | undefined;
  existingPick: PickemPick | undefined;
  onPick: (gameId: string, team: string) => void;
}) {
  const gameId = String(game.id);
  const gameDateTime = parseGameTime(game);
  const isPostponed = game.status === 'postponed';
  const isFinal = game.status === 'final';
  const isLive = game.status === 'live';
  const locked = isPostponed || isLive || isFinal || (gameDateTime && new Date() >= gameDateTime);

  const awayInfo = getInfo(game.away_team);
  const homeInfo = getInfo(game.home_team);

  // Determine winner for final games
  const awayWon = isFinal && game.away_score > game.home_score;
  const homeWon = isFinal && game.home_score > game.away_score;

  // Card background based on state
  const cardBg = isFinal ? 'bg-slate-50' : isLive ? 'bg-white' : picked ? 'bg-white' : 'bg-white';
  const cardBorder = isLive
    ? 'border-red-400/40 shadow-[0_0_12px_rgba(239,68,68,0.15)]'
    : picked
      ? 'border-citrus-sage/30 shadow-md'
      : 'border-slate-200/60 hover:border-slate-300 hover:shadow-md';

  return (
    <div className={`rounded-2xl border-2 overflow-hidden transition-all duration-200 ${cardBg} ${cardBorder} ${isPostponed ? 'opacity-30' : ''}`}>
      {/* ── Status bar ── */}
      <div className={`flex items-center justify-center gap-2 py-1.5 text-[11px] font-display font-semibold uppercase tracking-wider ${
        isFinal ? 'bg-slate-700 text-white' :
        isLive ? 'bg-red-500 text-white' :
        locked ? 'bg-slate-200 text-slate-500' :
        'bg-slate-100 text-slate-500'
      }`}>
        {isFinal ? (
          <span>Final</span>
        ) : isLive ? (
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
            Live
          </span>
        ) : locked ? (
          <span className="flex items-center gap-1"><Lock className="w-3 h-3" />{isPostponed ? 'Postponed' : 'Locked'}</span>
        ) : (
          <span>{formatTime(game)}</span>
        )}
      </div>

      {/* ── Matchup body ── */}
      <div className="flex items-stretch">
        {/* Away team half */}
        <button
          className={`flex-1 flex flex-col items-center gap-1.5 py-4 px-2 transition-all duration-200 relative ${
            locked ? 'cursor-default' : 'cursor-pointer'
          } ${isFinal && !awayWon ? 'opacity-40' : ''}`}
          style={{
            borderLeft: `4px solid ${awayInfo.primaryColor}`,
            background: picked === game.away_team ? `${awayInfo.primaryColor}14` : undefined,
          }}
          onClick={() => !locked && onPick(gameId, game.away_team)}
          disabled={!!locked}
        >
          <TeamMonogram abbrev={game.away_team} size={38} />
          <span className="font-varsity font-bold text-xs uppercase tracking-wide" style={{ color: awayInfo.primaryColor }}>
            {awayInfo.name}
          </span>
          {isFinal && <span className="text-lg font-varsity font-black text-slate-700">{game.away_score}</span>}
          {/* Selection indicators */}
          {picked === game.away_team && !isFinal && (
            <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-citrus-sage flex items-center justify-center">
              <Check className="w-3 h-3 text-white" />
            </div>
          )}
          {existingPick?.is_correct === true && existingPick.picked_team === game.away_team && (
            <CheckCircle2 className="w-5 h-5 text-green-500 absolute top-2 right-2" />
          )}
          {existingPick?.is_correct === false && existingPick.picked_team === game.away_team && (
            <XCircle className="w-5 h-5 text-red-500 absolute top-2 right-2" />
          )}
          {/* Non-selected dimming overlay */}
          {picked && picked !== game.away_team && !isFinal && (
            <div className="absolute inset-0 bg-white/55 pointer-events-none" />
          )}
        </button>

        {/* Center divider */}
        <div className="flex flex-col items-center justify-center w-10 bg-slate-50/80 flex-shrink-0">
          {isFinal || isLive ? (
            <span className="text-[10px] font-display text-slate-400">vs</span>
          ) : (
            <span className="text-[10px] font-display text-slate-300">@</span>
          )}
        </div>

        {/* Home team half */}
        <button
          className={`flex-1 flex flex-col items-center gap-1.5 py-4 px-2 transition-all duration-200 relative ${
            locked ? 'cursor-default' : 'cursor-pointer'
          } ${isFinal && !homeWon ? 'opacity-40' : ''}`}
          style={{
            borderRight: `4px solid ${homeInfo.primaryColor}`,
            background: picked === game.home_team ? `${homeInfo.primaryColor}14` : undefined,
          }}
          onClick={() => !locked && onPick(gameId, game.home_team)}
          disabled={!!locked}
        >
          <TeamMonogram abbrev={game.home_team} size={38} />
          <span className="font-varsity font-bold text-xs uppercase tracking-wide" style={{ color: homeInfo.primaryColor }}>
            {homeInfo.name}
          </span>
          {isFinal && <span className="text-lg font-varsity font-black text-slate-700">{game.home_score}</span>}
          {picked === game.home_team && !isFinal && (
            <div className="absolute top-2 left-2 w-5 h-5 rounded-full bg-citrus-sage flex items-center justify-center">
              <Check className="w-3 h-3 text-white" />
            </div>
          )}
          {existingPick?.is_correct === true && existingPick.picked_team === game.home_team && (
            <CheckCircle2 className="w-5 h-5 text-green-500 absolute top-2 left-2" />
          )}
          {existingPick?.is_correct === false && existingPick.picked_team === game.home_team && (
            <XCircle className="w-5 h-5 text-red-500 absolute top-2 left-2" />
          )}
          {picked && picked !== game.home_team && !isFinal && (
            <div className="absolute inset-0 bg-white/55 pointer-events-none" />
          )}
        </button>
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────

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
      if (!activeLeagueId || !user) { setLoading(false); return; }
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
        logger.error('[PoolPickem] Error:', err);
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
        toast({ title: 'Error', description: result.error || 'Failed', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to submit picks', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <LoadingScreen character="narwhal" message="Loading Pick'em Pool..." />;

  const gamesByDate = groupGamesByDate(games);
  const totalGames = games.length;
  const pickedCount = picks.size;
  const progress = totalGames > 0 ? (pickedCount / totalGames) * 100 : 0;

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

          {/* ── Header bar ── */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-5">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentWeek(w => Math.max(1, w - 1))} disabled={currentWeek <= 1}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Badge variant="outline" className="text-sm font-varsity px-3 py-1">Week {currentWeek}</Badge>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentWeek(w => w + 1)}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>

              {/* Progress bar */}
              <div className="flex items-center gap-2">
                <div className="w-24 h-2 rounded-full bg-slate-200 overflow-hidden">
                  <div className="h-full bg-citrus-sage rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
                </div>
                <span className="text-xs font-display text-citrus-charcoal/60">{pickedCount}/{totalGames}</span>
              </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-auto">
              <TabsList>
                <TabsTrigger value="picks">Make Picks</TabsTrigger>
                <TabsTrigger value="standings">Standings</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* ── Picks tab ── */}
          {activeTab === 'picks' && (
            <>
              {games.length === 0 ? (
                <Card className="border-none shadow-lg max-w-xl mx-auto">
                  <CardContent className="py-16 text-center text-muted-foreground">
                    <Target className="w-12 h-12 mx-auto mb-4 opacity-30" />
                    <p className="font-medium text-lg">No games this week</p>
                    <p className="text-sm mt-1">Games will appear once the schedule is loaded.</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-8">
                  {Array.from(gamesByDate.entries()).map(([dateKey, dateGames]) => (
                    <div key={dateKey}>
                      {/* Date header */}
                      <div className="flex items-center gap-3 mb-3">
                        <Calendar className="w-4 h-4 text-citrus-forest/50" />
                        <span className="text-sm font-display font-bold text-citrus-forest uppercase tracking-wide">
                          {formatDateHeader(dateKey)}
                        </span>
                        <div className="flex-1 h-px bg-citrus-sage/20" />
                        <Badge variant="outline" className="text-xs font-display">
                          {dateGames.length} {dateGames.length === 1 ? 'game' : 'games'}
                        </Badge>
                      </div>

                      {/* Game cards grid */}
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                        {dateGames.map(game => (
                          <GameCard
                            key={String(game.id)}
                            game={game}
                            picked={picks.get(String(game.id))}
                            existingPick={existingPicks.find(p => p.game_id === String(game.id))}
                            onPick={handlePick}
                          />
                        ))}
                      </div>
                    </div>
                  ))}

                  {/* Sticky submit bar */}
                  <div className="sticky bottom-20 lg:bottom-4 bg-white/90 backdrop-blur-md border border-slate-200 rounded-2xl py-3 px-4 flex items-center justify-between shadow-xl">
                    <div className="flex items-center gap-3">
                      <div className="w-20 h-2 rounded-full bg-slate-200 overflow-hidden">
                        <div className="h-full bg-citrus-sage rounded-full transition-all" style={{ width: `${progress}%` }} />
                      </div>
                      <span className="text-sm font-display text-slate-500">
                        {pickedCount === 0 ? 'Tap a team to pick' : `${pickedCount} of ${totalGames} picked`}
                      </span>
                    </div>
                    <Button onClick={handleSubmitPicks} disabled={pickedCount === 0 || submitting} className="font-varsity uppercase">
                      {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      Submit Picks
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── Standings tab ── */}
          {activeTab === 'standings' && (
            <Card className="border-none shadow-lg overflow-hidden max-w-4xl mx-auto bg-white">
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
                        <TableRow className="bg-slate-50">
                          <TableHead className="w-12 text-center">#</TableHead>
                          <TableHead>Player</TableHead>
                          <TableHead className="text-center">Correct</TableHead>
                          <TableHead className="text-center hidden sm:table-cell">Total</TableHead>
                          <TableHead className="text-right">Accuracy</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {standings.map((s, i) => (
                          <TableRow key={s.user_id} className={s.user_id === user?.id ? 'bg-citrus-sage/5' : ''}>
                            <TableCell className="text-center">
                              <span className={`inline-flex w-7 h-7 rounded-full items-center justify-center text-xs font-bold ${
                                i === 0 ? 'bg-amber-400 text-white' :
                                i === 1 ? 'bg-slate-300 text-slate-700' :
                                i === 2 ? 'bg-amber-600 text-white' :
                                'text-slate-400'
                              }`}>{i + 1}</span>
                            </TableCell>
                            <TableCell className="font-medium">
                              {s.display_name}
                              {s.user_id === user?.id && <Badge variant="outline" className="ml-2 text-xs">YOU</Badge>}
                            </TableCell>
                            <TableCell className="text-center font-bold text-citrus-forest">{s.correct_picks}</TableCell>
                            <TableCell className="text-center text-slate-400 hidden sm:table-cell">{s.total_picks}</TableCell>
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
