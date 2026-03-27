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
import { Loader2, CheckCircle2, XCircle, Target, ChevronLeft, ChevronRight, Lock, Calendar, Check, Trophy } from 'lucide-react';
import { LeagueCreationCTA } from '@/components/LeagueCreationCTA';
import LoadingScreen from '@/components/LoadingScreen';
import { logger } from '@/utils/logger';
import { getTeamInfo } from '@/types/captracker';

// ── Helpers ──────────────────────────────────────────────────────────

function getInfo(abbrev: string) {
  return getTeamInfo(abbrev) || { abbrev, name: abbrev, fullName: abbrev, primaryColor: '#666', secondaryColor: '#999' };
}

function parseGameTime(game: NHLGame): Date | null {
  try {
    if (game.game_time) { const d = new Date(game.game_time); if (!isNaN(d.getTime())) return d; }
    if (game.game_date?.includes('T')) { const d = new Date(game.game_date); if (!isNaN(d.getTime()) && d.getHours() !== 0) return d; }
    return null;
  } catch { return null; }
}

function formatTime(game: NHLGame): string {
  const d = parseGameTime(game);
  return d ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'TBD';
}

function formatDateHeader(dateKey: string): string {
  try {
    const d = new Date(dateKey + 'T12:00:00');
    return isNaN(d.getTime()) ? dateKey : d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  } catch { return dateKey; }
}

function groupGamesByDate(games: NHLGame[]): Map<string, NHLGame[]> {
  const m = new Map<string, NHLGame[]>();
  for (const g of games) { const k = g.game_date.split('T')[0]; m.set(k, [...(m.get(k) || []), g]); }
  return m;
}

// ── Team Side Component ─────────────────────────────────────────────

function TeamSide({
  abbrev, isSelected, isWinner, isLoser, isFinal, score, disabled, onClick, side, pickResult,
}: {
  abbrev: string; isSelected: boolean; isWinner: boolean; isLoser: boolean;
  isFinal: boolean; score?: number; disabled: boolean;
  onClick: () => void; side: 'away' | 'home'; pickResult?: boolean | null;
}) {
  const info = getInfo(abbrev);

  return (
    <button
      className={`flex-1 flex flex-col items-center gap-1 py-4 px-3 transition-all duration-200 relative group ${
        disabled ? 'cursor-default' : 'cursor-pointer'
      } ${isLoser ? 'opacity-35' : ''}`}
      style={{
        background: isSelected && !isFinal
          ? `linear-gradient(180deg, ${info.primaryColor}18 0%, ${info.primaryColor}08 100%)`
          : undefined,
        borderLeft: side === 'away' ? `4px solid ${isSelected || isWinner ? info.primaryColor : info.primaryColor + '40'}` : undefined,
        borderRight: side === 'home' ? `4px solid ${isSelected || isWinner ? info.primaryColor : info.primaryColor + '40'}` : undefined,
      }}
      onClick={!disabled ? onClick : undefined}
      disabled={disabled}
    >
      {/* Team badge — larger, square with rounded corners */}
      <div
        className="w-11 h-11 rounded-xl flex items-center justify-center font-varsity font-black text-white text-sm tracking-wide shadow-md transition-transform group-hover:scale-105"
        style={{ background: info.primaryColor }}
      >
        {abbrev}
      </div>

      {/* Team name */}
      <span className={`font-display font-bold text-xs uppercase tracking-wide ${isWinner ? 'text-slate-900' : 'text-slate-600'}`}>
        {info.name}
      </span>

      {/* Score for final games */}
      {isFinal && score !== undefined && (
        <span className={`font-varsity text-2xl leading-none ${isWinner ? 'text-slate-900' : 'text-slate-400'}`}>
          {score}
        </span>
      )}

      {/* Selection check */}
      {isSelected && !isFinal && (
        <div className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center shadow-sm"
          style={{ background: info.primaryColor }}>
          <Check className="w-3 h-3 text-white" />
        </div>
      )}

      {/* Pick result */}
      {pickResult === true && <CheckCircle2 className="w-5 h-5 text-emerald-500 absolute top-2 right-2" />}
      {pickResult === false && <XCircle className="w-5 h-5 text-red-500 absolute top-2 right-2" />}

      {/* Dim overlay for non-selected side when a pick is made */}
      {!isSelected && !isFinal && isSelected !== undefined && (
        <div className="absolute inset-0 bg-white/50 pointer-events-none transition-opacity" />
      )}
    </button>
  );
}

// ── Game Card ────────────────────────────────────────────────────────

function GameCard({
  game, picked, existingPick, onPick,
}: {
  game: NHLGame;
  picked: string | undefined; existingPick: PickemPick | undefined;
  onPick: (id: string, team: string) => void;
}) {
  const gameId = String(game.id);
  const dt = parseGameTime(game);
  const isFinal = game.status === 'final';
  const isLive = game.status === 'live';
  const isPostponed = game.status === 'postponed';
  const locked = isPostponed || isLive || isFinal || (dt && new Date() >= dt);
  const awayWon = isFinal && game.away_score > game.home_score;
  const homeWon = isFinal && game.home_score > game.away_score;
  const hasPick = !!picked;

  return (
    <div className={`rounded-2xl overflow-hidden transition-all duration-200 ${
      isLive ? 'ring-2 ring-red-400/50 shadow-lg shadow-red-500/10' :
      hasPick && !isFinal ? 'shadow-lg ring-1 ring-citrus-sage/30' :
      isFinal ? 'shadow-sm' :
      'shadow-sm hover:shadow-lg'
    } ${isPostponed ? 'opacity-30' : ''}`}>

      {/* ── Top info bar: game number, time, venue ── */}
      <div className={`px-3 py-2 flex items-center justify-between text-xs ${
        isFinal ? 'bg-slate-100 text-slate-500' :
        isLive ? 'bg-red-50 text-red-600' :
        locked ? 'bg-slate-50 text-slate-400' :
        'bg-gradient-to-r from-citrus-sage/10 to-citrus-peach/5 text-citrus-forest/70'
      }`}>
        <span className="font-display font-semibold">
          {getInfo(game.away_team).fullName.split(' ').slice(0, -1).join(' ')} @ {getInfo(game.home_team).fullName.split(' ').slice(0, -1).join(' ')}
        </span>
        <span className="font-display flex items-center gap-1.5">
          {isFinal ? (
            <span className="flex items-center gap-1 font-bold uppercase">
              <Trophy className="w-3 h-3" /> Final
            </span>
          ) : isLive ? (
            <span className="flex items-center gap-1.5 font-bold">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              Live
            </span>
          ) : locked ? (
            <span className="flex items-center gap-1"><Lock className="w-3 h-3" />Locked</span>
          ) : (
            <span className="font-semibold">{formatTime(game)}</span>
          )}
        </span>
      </div>

      {/* ── Matchup body ── */}
      <div className="flex items-stretch bg-white">
        {/* Away */}
        <TeamSide
          abbrev={game.away_team}
          isSelected={picked === game.away_team}
          isWinner={awayWon}
          isLoser={isFinal && !awayWon}
          isFinal={isFinal}
          score={isFinal ? game.away_score : undefined}
          disabled={!!locked}
          onClick={() => onPick(gameId, game.away_team)}
          side="away"
          pickResult={existingPick?.picked_team === game.away_team ? existingPick.is_correct : null}
        />

        {/* Center */}
        <div className="flex flex-col items-center justify-center w-8 bg-slate-50 shrink-0">
          <span className="text-[9px] font-display text-slate-300 uppercase font-bold">vs</span>
        </div>

        {/* Home */}
        <TeamSide
          abbrev={game.home_team}
          isSelected={picked === game.home_team}
          isWinner={homeWon}
          isLoser={isFinal && !homeWon}
          isFinal={isFinal}
          score={isFinal ? game.home_score : undefined}
          disabled={!!locked}
          onClick={() => onPick(gameId, game.home_team)}
          side="home"
          pickResult={existingPick?.picked_team === game.home_team ? existingPick.is_correct : null}
        />
      </div>

      {/* ── Bottom accent for picked games ── */}
      {hasPick && !isFinal && (
        <div className="h-1" style={{ background: getInfo(picked!).primaryColor }} />
      )}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────

const PoolPickem = () => {
  const { user } = useAuth();
  const { userLeagueState, activeLeagueId, activeLeague } = useLeague();
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
        const [weekGames, userPicks, standingsData] = await Promise.all([
          PoolService.getWeekGames(currentWeek),
          PoolService.getPickemPicks(activeLeagueId, user.id, currentWeek),
          PoolService.getPickemStandings(activeLeagueId),
        ]);
        setGames(weekGames || []);
        setExistingPicks(userPicks);
        const pickMap = new Map<string, string>();
        userPicks.forEach(p => pickMap.set(p.game_id, p.picked_team));
        setPicks(pickMap);
        setStandings(standingsData);
      } catch (err) { logger.error('[PoolPickem] Error:', err); }
      finally { setLoading(false); }
    };
    loadData();
  }, [activeLeagueId, user, currentWeek]);

  const handlePick = (gameId: string, team: string) => {
    const m = new Map(picks);
    m.get(gameId) === team ? m.delete(gameId) : m.set(gameId, team);
    setPicks(m);
  };

  const handleSubmitPicks = async () => {
    if (!activeLeagueId || !user) return;
    setSubmitting(true);
    try {
      const arr = Array.from(picks.entries()).map(([game_id, picked_team]) => ({ game_id, picked_team }));
      const r = await PoolService.submitPickemPicks(activeLeagueId, user.id, currentWeek, arr);
      r.success
        ? toast({ title: 'Picks Submitted', description: `${arr.length} picks saved.` })
        : toast({ title: 'Error', description: r.error || 'Failed', variant: 'destructive' });
    } catch { toast({ title: 'Error', description: 'Failed to submit picks', variant: 'destructive' }); }
    finally { setSubmitting(false); }
  };

  if (loading) return <LoadingScreen character="narwhal" message="Loading Pick'em Pool..." />;

  const gamesByDate = groupGamesByDate(games);
  const totalGames = games.length;
  const pickedCount = picks.size;

  // Respect league's picksPerWeek setting (0 or undefined = all games)
  const leagueSettings = activeLeague?.settings as Record<string, unknown> | undefined;
  const picksPerWeek = leagueSettings?.picksPerWeek as number | undefined;
  const requiredPicks = (picksPerWeek && picksPerWeek > 0) ? Math.min(picksPerWeek, totalGames) : totalGames;
  const progress = requiredPicks > 0 ? Math.min((pickedCount / requiredPicks) * 100, 100) : 0;

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#D4E8B8] to-[#C8DEB0] relative">
      <div className="hidden lg:block"><Navbar /></div>
      <div className="lg:hidden sticky top-0 z-40 bg-[#D4E8B8]/98 backdrop-blur-xl border-b border-citrus-sage/20 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-center h-12 px-4">
          <h1 className="text-lg font-varsity font-bold text-citrus-forest">Pick'em Pool</h1>
        </div>
      </div>

      <main className="w-full pt-16 lg:pt-24 lg:pb-8 pb-[calc(5rem+env(safe-area-inset-bottom))]">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-6">
          {userLeagueState === 'logged-in-no-league' && (
            <div className="mb-8 max-w-3xl mx-auto">
              <LeagueCreationCTA title="Join a Pick'em Pool" description="Predict NHL game winners each week." />
            </div>
          )}

          {/* ── Header ── */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6">
            <div className="flex items-center gap-3">
              <div className="flex items-center">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentWeek(w => Math.max(1, w - 1))} disabled={currentWeek <= 1}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <div className="text-center mx-1">
                  <div className="text-xs font-display text-citrus-forest/50 uppercase tracking-widest">Week</div>
                  <div className="text-xl font-varsity font-black text-citrus-forest leading-none">{currentWeek}</div>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentWeek(w => w + 1)}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>

              {/* Progress */}
              <div className="flex items-center gap-2 bg-white/60 rounded-full px-3 py-1.5 border border-citrus-sage/20">
                <div className="w-20 h-2 rounded-full bg-slate-200 overflow-hidden">
                  <div className="h-full bg-citrus-sage rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
                </div>
                <span className="text-xs font-display font-semibold text-citrus-forest">{pickedCount}/{requiredPicks}</span>
              </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-auto">
              <TabsList>
                <TabsTrigger value="picks">Make Picks</TabsTrigger>
                <TabsTrigger value="standings">Standings</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* ── Picks ── */}
          {activeTab === 'picks' && (
            <>
              {games.length === 0 ? (
                <Card className="border-none shadow-lg max-w-xl mx-auto bg-white">
                  <CardContent className="py-16 text-center text-slate-400">
                    <Target className="w-12 h-12 mx-auto mb-4 opacity-30" />
                    <p className="font-medium text-lg">No games this week</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-8">
                  {Array.from(gamesByDate.entries()).map(([dateKey, dateGames]) => {
                    return (
                      <div key={dateKey}>
                        <div className="flex items-center gap-3 mb-3">
                          <Calendar className="w-4 h-4 text-citrus-forest/40" />
                          <span className="text-sm font-display font-bold text-citrus-forest/80 uppercase tracking-wide">
                            {formatDateHeader(dateKey)}
                          </span>
                          <div className="flex-1 h-px bg-citrus-sage/20" />
                          <Badge variant="outline" className="text-xs bg-white/50">
                            {dateGames.length} {dateGames.length === 1 ? 'game' : 'games'}
                          </Badge>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
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
                    );
                  })}

                  {/* Submit bar */}
                  <div className="sticky bottom-20 lg:bottom-4 bg-white/95 backdrop-blur-md border border-slate-200/80 rounded-2xl py-3 px-5 flex items-center justify-between shadow-xl">
                    <div className="flex items-center gap-3">
                      <div className="w-24 h-2.5 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full bg-citrus-sage rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
                      </div>
                      <span className="text-sm font-display text-slate-500">
                        {pickedCount === 0 ? 'Tap a team to pick' : `${pickedCount} of ${requiredPicks} picked`}
                      </span>
                    </div>
                    <Button onClick={handleSubmitPicks} disabled={pickedCount === 0 || submitting} size="lg" className="font-varsity uppercase">
                      {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      Submit Picks
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── Standings ── */}
          {activeTab === 'standings' && (
            <Card className="border-none shadow-lg overflow-hidden max-w-4xl mx-auto bg-white">
              <CardContent className="p-0">
                {standings.length === 0 ? (
                  <div className="text-center py-16 text-slate-400">
                    <Target className="w-12 h-12 mx-auto mb-4 opacity-30" />
                    <p className="font-medium">No standings yet</p>
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
                          <TableHead className="text-right">Pct</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {standings.map((s, i) => (
                          <TableRow key={s.user_id} className={s.user_id === user?.id ? 'bg-citrus-sage/5' : ''}>
                            <TableCell className="text-center">
                              <span className={`inline-flex w-7 h-7 rounded-full items-center justify-center text-xs font-bold ${
                                i === 0 ? 'bg-amber-400 text-white' : i === 1 ? 'bg-slate-300 text-slate-700' : i === 2 ? 'bg-amber-600 text-white' : 'text-slate-400'
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
