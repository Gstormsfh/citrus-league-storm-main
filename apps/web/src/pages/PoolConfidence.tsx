import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import LeagueNotifications from '@/components/matchup/LeagueNotifications';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { PoolService, ConfidencePick, ConfidenceStanding } from '@/services/PoolService';
import { NHLGame } from '@/services/ScheduleService';
import { Loader2, BarChart3, CheckCircle2, XCircle, ChevronLeft, ChevronRight, Lock, Calendar, Target, Check } from 'lucide-react';
import { LeagueCreationCTA } from '@/components/LeagueCreationCTA';
import LoadingScreen from '@/components/LoadingScreen';
import { logger } from '@/utils/logger';
import { getTeamInfo, type NHLTeamInfo } from '@/types/captracker';
import { InvitePlayersButton } from '@/components/InvitePlayersButton';
import { PoolLeagueHub } from '@/components/PoolLeagueHub';

interface PickWithConfidence {
  game_id: string;
  picked_team: string;
  confidence_points: number;
}

function getInfo(abbrev: string): NHLTeamInfo {
  return getTeamInfo(abbrev) || { abbrev, name: abbrev, fullName: abbrev, conference: 'Eastern' as const, division: '', primaryColor: '#666', secondaryColor: '#999', logoUrl: '' };
}

function parseGameTime(game: NHLGame): Date | null {
  try {
    if (game.game_time) { const dt = new Date(game.game_time); if (!isNaN(dt.getTime())) return dt; }
    if (game.game_date?.includes('T')) { const dt = new Date(game.game_date); if (!isNaN(dt.getTime()) && dt.getHours() !== 0) return dt; }
    return null;
  } catch { return null; }
}
function formatTime(game: NHLGame): string {
  const dt = parseGameTime(game);
  return dt ? dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : 'TBD';
}
function formatDateHeader(dateKey: string): string {
  try { const dt = new Date(dateKey + 'T12:00:00'); return isNaN(dt.getTime()) ? dateKey : dt.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }); }
  catch { return dateKey; }
}
function groupGamesByDate(games: NHLGame[]): Map<string, NHLGame[]> {
  const g = new Map<string, NHLGame[]>();
  for (const game of games) { const k = game.game_date.split('T')[0]; g.set(k, [...(g.get(k) || []), game]); }
  return g;
}

function TeamMonogram({ abbrev, size = 36 }: { abbrev: string; size?: number }) {
  const info = getInfo(abbrev);
  return (
    <div className="rounded-lg flex items-center justify-center font-varsity font-black text-white tracking-wide shadow-sm"
      style={{ width: size, height: size, background: info.primaryColor, fontSize: size * 0.32 }}>
      {abbrev}
    </div>
  );
}

const PoolConfidence = () => {
  const { user } = useAuth();
  const { userLeagueState, activeLeagueId, activeLeague } = useLeague();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [currentWeek, setCurrentWeek] = useState(() => PoolService.getCurrentWeek());
  const [games, setGames] = useState<NHLGame[]>([]);
  const [picks, setPicks] = useState<Map<string, PickWithConfidence>>(new Map());
  const [existingPicks, setExistingPicks] = useState<ConfidencePick[]>([]);
  const [standings, setStandings] = useState<ConfidenceStanding[]>([]);
  const [records, setRecords] = useState<Record<string, { w: number; l: number; otl: number; streak?: string }>>({});
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
        setStandings(await PoolService.getConfidenceStandings(activeLeagueId));

        // Fetch team records
        try {
          const tr = await PoolService.getTeamRecords();
          setRecords(tr);
        } catch { /* supplementary */ }
      } catch (err) { logger.error('[PoolConfidence] Error:', err); }
      finally { setLoading(false); }
    };
    loadData();
  }, [activeLeagueId, user, currentWeek]);

  const handleTeamPick = (gameId: string, team: string) => {
    const m = new Map(picks);
    const ex = m.get(gameId);
    if (ex) { m.set(gameId, { ...ex, picked_team: team }); }
    else {
      const used = new Set(Array.from(m.values()).map(p => p.confidence_points));
      let next = games.length; while (used.has(next) && next > 0) next--;
      m.set(gameId, { game_id: gameId, picked_team: team, confidence_points: next });
    }
    setPicks(m);
  };

  const handleConfidenceChange = (gameId: string, pts: number) => {
    const m = new Map(picks);
    const ex = m.get(gameId);
    if (ex) m.set(gameId, { ...ex, confidence_points: pts });
    setPicks(m);
  };

  const handleSubmitPicks = async () => {
    if (!activeLeagueId || !user) return;
    const arr = Array.from(picks.values());
    if (!arr.length) { toast({ title: 'Error', description: 'Make at least one pick.', variant: 'destructive' }); return; }
    if (new Set(arr.map(p => p.confidence_points)).size !== arr.length) {
      toast({ title: 'Error', description: 'Each pick needs a unique confidence value.', variant: 'destructive' }); return;
    }
    setSubmitting(true);
    try {
      const r = await PoolService.submitConfidencePicks(activeLeagueId, user.id, currentWeek, arr);
      if (r.success) toast({ title: 'Picks Submitted', description: `${arr.length} picks saved.` });
      else toast({ title: 'Error', description: r.error || 'Failed', variant: 'destructive' });
    } catch { toast({ title: 'Error', description: 'Failed', variant: 'destructive' }); }
    finally { setSubmitting(false); }
  };

  const usedPts = new Set(Array.from(picks.values()).map(p => p.confidence_points));
  const maxPts = Math.max(games.length, 1);

  if (loading) return <LoadingScreen character="narwhal" message="Loading Confidence Pool..." />;

  const gamesByDate = groupGamesByDate(games);
  const weekEarned = existingPicks.reduce((s, p) => s + (p.is_correct ? (p.confidence_points || 0) : 0), 0);
  const weekPossible = existingPicks.reduce((s, p) => s + (p.confidence_points || 0), 0);

  return (
    <div className="min-h-screen bg-[#D4E8B8] relative">
      <div className="hidden lg:block"><Navbar /></div>
      <div className="lg:hidden sticky top-0 z-40 bg-[#D4E8B8]/98 backdrop-blur-xl border-b border-citrus-sage/20 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-center h-12 px-4">
          <h1 className="text-lg font-varsity font-bold text-citrus-forest">Confidence Pool</h1>
        </div>
      </div>

      <main className="w-full pt-16 lg:pt-24 lg:pb-8 pb-[calc(5rem+env(safe-area-inset-bottom))]">
        <div className="flex lg:gap-0">
        <div className="flex-1 min-w-0 px-3 sm:px-4 lg:px-8 xl:px-12">
          {userLeagueState === 'logged-in-no-league' && (
            <div className="mb-8 max-w-3xl mx-auto">
              <LeagueCreationCTA title="Join a Confidence Pool" description="Rank your picks by confidence — earn more points for correct high-confidence picks!" />
            </div>
          )}

          {/* Header */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-5">
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentWeek(w => Math.max(1, w - 1))} disabled={currentWeek <= 1}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Badge variant="outline" className="text-sm font-varsity px-3 py-1">Week {currentWeek}</Badge>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentWeek(w => w + 1)}>
                <ChevronRight className="w-4 h-4" />
              </Button>
              <Badge variant="secondary" className="text-xs">{picks.size}/{games.length} picked</Badge>
              {weekPossible > 0 && (
                <Badge className="text-xs bg-citrus-forest border-0 text-white">{weekEarned}/{weekPossible} pts</Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              {activeLeague?.join_code && (
                <InvitePlayersButton joinCode={activeLeague.join_code} leagueName={activeLeague.name} />
              )}
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-auto">
                <TabsList>
                  <TabsTrigger value="picks">Rank Picks</TabsTrigger>
                  <TabsTrigger value="standings">Standings</TabsTrigger>
                  <TabsTrigger value="league">League</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>

          {/* ── Picks tab ── */}
          {activeTab === 'picks' && (
            <>
              {games.length === 0 ? (
                <Card className="border-none shadow-lg max-w-xl mx-auto bg-white">
                  <CardContent className="py-16 text-center text-slate-400">
                    <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-30" />
                    <p className="font-medium text-lg">No games this week</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-8">
                  {Array.from(gamesByDate.entries()).map(([dateKey, dateGames]) => (
                    <div key={dateKey}>
                      <div className="flex items-center gap-3 mb-3">
                        <Calendar className="w-4 h-4 text-citrus-forest/50" />
                        <span className="text-sm font-display font-bold text-citrus-forest uppercase tracking-wide">{formatDateHeader(dateKey)}</span>
                        <div className="flex-1 h-px bg-citrus-sage/20" />
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        {dateGames.map(game => {
                          const gameId = String(game.id);
                          const pick = picks.get(gameId);
                          const ep = existingPicks.find(p => p.game_id === gameId);
                          const dt = parseGameTime(game);
                          const locked = game.status === 'live' || game.status === 'final' || (dt && new Date() >= dt);
                          const isFinal = game.status === 'final';
                          const isLive = game.status === 'live';
                          const awayInfo = getInfo(game.away_team);
                          const homeInfo = getInfo(game.home_team);
                          const awayWon = isFinal && game.away_score > game.home_score;
                          const homeWon = isFinal && game.home_score > game.away_score;

                          return (
                            <div key={gameId} className={`rounded-2xl border-2 overflow-hidden transition-all duration-200 bg-white ${
                              isLive ? 'border-red-400/40 shadow-[0_0_12px_rgba(239,68,68,0.15)]'
                              : pick ? 'border-citrus-sage/30 shadow-md' : 'border-slate-200/60 hover:border-slate-300 hover:shadow-md'
                            }`}>
                              {/* Status bar with confidence */}
                              <div className={`flex items-center justify-between px-3 py-1.5 text-[11px] font-display font-semibold uppercase tracking-wider ${
                                isFinal ? 'bg-slate-700 text-white' : isLive ? 'bg-red-500 text-white' : locked ? 'bg-slate-200 text-slate-500' : 'bg-slate-100 text-slate-500'
                              }`}>
                                <span>
                                  {isFinal ? 'Final' : isLive ? (
                                    <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-white animate-pulse" />Live</span>
                                  ) : locked ? (
                                    <span className="flex items-center gap-1"><Lock className="w-3 h-3" />Locked</span>
                                  ) : formatTime(game)}
                                </span>
                                {/* Confidence badge */}
                                <div className="flex items-center gap-1.5">
                                  {pick && (
                                    <Select
                                      value={pick.confidence_points?.toString() || ''}
                                      onValueChange={(v) => handleConfidenceChange(gameId, parseInt(v))}
                                      disabled={!pick.picked_team || !!locked}
                                    >
                                      <SelectTrigger className={`h-6 w-16 text-[10px] border-0 font-varsity font-bold rounded-full px-2 ${
                                        isFinal || isLive ? 'bg-white/20 text-white' : 'bg-citrus-sage/20 text-citrus-forest'
                                      }`}>
                                        <SelectValue placeholder="Pts" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {Array.from({ length: maxPts }, (_, i) => maxPts - i).map(pts => (
                                          <SelectItem key={pts} value={pts.toString()} disabled={usedPts.has(pts) && pick.confidence_points !== pts}>
                                            {pts} pts
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  )}
                                </div>
                              </div>

                              {/* Teams */}
                              <div className="flex items-stretch">
                                <button
                                  className={`flex-1 flex flex-col items-center gap-1.5 py-3.5 px-2 transition-all relative ${locked ? 'cursor-default' : 'cursor-pointer'} ${isFinal && !awayWon ? 'opacity-40' : ''}`}
                                  style={{ borderLeft: `4px solid ${awayInfo.primaryColor}`, background: pick?.picked_team === game.away_team ? `${awayInfo.primaryColor}14` : undefined }}
                                  onClick={() => !locked && handleTeamPick(gameId, game.away_team)} disabled={!!locked}
                                >
                                  <TeamMonogram abbrev={game.away_team} size={34} />
                                  <span className="font-varsity font-bold text-xs uppercase" style={{ color: awayInfo.primaryColor }}>{awayInfo.name}</span>
                                  {records[game.away_team] && (
                                    <span className={`text-[10px] font-display ${records[game.away_team].w > records[game.away_team].l ? 'text-emerald-600' : 'text-slate-400'}`}>
                                      {records[game.away_team].w}-{records[game.away_team].l}-{records[game.away_team].otl}
                                    </span>
                                  )}
                                  {isFinal && <span className="text-lg font-varsity font-black text-slate-700">{game.away_score}</span>}
                                  {pick?.picked_team === game.away_team && !isFinal && (
                                    <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-citrus-sage flex items-center justify-center"><Check className="w-2.5 h-2.5 text-white" /></div>
                                  )}
                                  {ep?.is_correct === true && ep.picked_team === game.away_team && <CheckCircle2 className="w-4 h-4 text-green-500 absolute top-1.5 right-1.5" />}
                                  {ep?.is_correct === false && ep.picked_team === game.away_team && <XCircle className="w-4 h-4 text-red-500 absolute top-1.5 right-1.5" />}
                                  {pick && pick.picked_team !== game.away_team && !isFinal && <div className="absolute inset-0 bg-white/55 pointer-events-none" />}
                                </button>

                                <div className="flex items-center justify-center w-8 bg-slate-50/80 text-[10px] text-slate-300 font-bold shrink-0">@</div>

                                <button
                                  className={`flex-1 flex flex-col items-center gap-1.5 py-3.5 px-2 transition-all relative ${locked ? 'cursor-default' : 'cursor-pointer'} ${isFinal && !homeWon ? 'opacity-40' : ''}`}
                                  style={{ borderRight: `4px solid ${homeInfo.primaryColor}`, background: pick?.picked_team === game.home_team ? `${homeInfo.primaryColor}14` : undefined }}
                                  onClick={() => !locked && handleTeamPick(gameId, game.home_team)} disabled={!!locked}
                                >
                                  <TeamMonogram abbrev={game.home_team} size={34} />
                                  <span className="font-varsity font-bold text-xs uppercase" style={{ color: homeInfo.primaryColor }}>{homeInfo.name}</span>
                                  {records[game.home_team] && (
                                    <span className={`text-[10px] font-display ${records[game.home_team].w > records[game.home_team].l ? 'text-emerald-600' : 'text-slate-400'}`}>
                                      {records[game.home_team].w}-{records[game.home_team].l}-{records[game.home_team].otl}
                                    </span>
                                  )}
                                  {isFinal && <span className="text-lg font-varsity font-black text-slate-700">{game.home_score}</span>}
                                  {pick?.picked_team === game.home_team && !isFinal && (
                                    <div className="absolute top-1.5 left-1.5 w-4 h-4 rounded-full bg-citrus-sage flex items-center justify-center"><Check className="w-2.5 h-2.5 text-white" /></div>
                                  )}
                                  {ep?.is_correct === true && ep.picked_team === game.home_team && <CheckCircle2 className="w-4 h-4 text-green-500 absolute top-1.5 left-1.5" />}
                                  {ep?.is_correct === false && ep.picked_team === game.home_team && <XCircle className="w-4 h-4 text-red-500 absolute top-1.5 left-1.5" />}
                                  {pick && pick.picked_team !== game.home_team && !isFinal && <div className="absolute inset-0 bg-white/55 pointer-events-none" />}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  {/* Submit */}
                  <div className="sticky bottom-20 lg:bottom-4 bg-white/90 backdrop-blur-md border border-slate-200 rounded-2xl py-3 px-4 flex items-center justify-between shadow-xl">
                    <span className="text-sm font-display text-slate-500">
                      {picks.size === 0 ? 'Pick a team, then assign confidence' : `${picks.size} of ${games.length} picked`}
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

          {/* ── Standings ── */}
          {activeTab === 'standings' && (
            <Card className="border-none shadow-lg overflow-hidden max-w-4xl mx-auto bg-white">
              <CardContent className="p-0">
                {standings.length === 0 ? (
                  <div className="text-center py-16 text-slate-400">
                    <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-30" />
                    <p className="font-medium">No standings yet</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-slate-50">
                          <TableHead className="w-12 text-center">#</TableHead>
                          <TableHead>Player</TableHead>
                          <TableHead className="text-center">Pts</TableHead>
                          <TableHead className="text-center hidden sm:table-cell">Possible</TableHead>
                          <TableHead className="text-right">Efficiency</TableHead>
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
                            <TableCell className="text-center font-bold text-citrus-forest">{s.total_points}</TableCell>
                            <TableCell className="text-center text-slate-400 hidden sm:table-cell">{s.possible_points}</TableCell>
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

          {/* ── League tab ── */}
          {activeTab === 'league' && activeLeague && (
            <PoolLeagueHub leagueId={activeLeagueId!} league={activeLeague as any} />
          )}
        </div>

        {/* Chat sidebar — pinned to right edge */}
        {activeLeagueId && (
          <div className="hidden lg:block w-72 xl:w-80 shrink-0 border-l border-citrus-sage/15 bg-white/40">
            <div className="sticky top-24 h-[calc(100vh-6rem)] flex flex-col">
              <LeagueNotifications leagueId={activeLeagueId} />
            </div>
          </div>
        )}
        </div>
      </main>
      <div className="hidden lg:block"><Footer /></div>
    </div>
  );
};

export default PoolConfidence;
