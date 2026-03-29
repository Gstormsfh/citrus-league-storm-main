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
import { getTeamInfo } from '@/types/captracker';

function getInfo(a: string) {
  return getTeamInfo(a) || { abbrev: a, name: a, fullName: a, primaryColor: '#666', secondaryColor: '#999' };
}
function parseGameTime(g: NHLGame): Date | null {
  try {
    if (g.game_time) { const d = new Date(g.game_time); if (!isNaN(d.getTime())) return d; }
    if (g.game_date?.includes('T')) { const d = new Date(g.game_date); if (!isNaN(d.getTime()) && d.getHours() !== 0) return d; }
    return null;
  } catch { return null; }
}
function fmtTime(g: NHLGame): string {
  const d = parseGameTime(g);
  return d ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'TBD';
}
function fmtDate(k: string): string {
  try { const d = new Date(k + 'T12:00:00'); return isNaN(d.getTime()) ? k : d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }); }
  catch { return k; }
}
function groupByDate(games: NHLGame[]): Map<string, NHLGame[]> {
  const m = new Map<string, NHLGame[]>();
  for (const g of games) { const k = g.game_date.split('T')[0]; m.set(k, [...(m.get(k) || []), g]); }
  return m;
}

// ── The matchup row — single horizontal row per game ─────────────────

function MatchupRow({ game, picked, existingPick, onPick, records }: {
  game: NHLGame; picked?: string; existingPick?: PickemPick;
  onPick: (id: string, team: string) => void;
  records: Record<string, { w: number; l: number; otl: number }>;
}) {
  const gid = String(game.id);
  const dt = parseGameTime(game);
  const isFinal = game.status === 'final';
  const isLive = game.status === 'live';
  const locked = game.status === 'postponed' || isLive || isFinal || (dt && new Date() >= dt);
  const away = getInfo(game.away_team);
  const home = getInfo(game.home_team);
  const awayWon = isFinal && game.away_score > game.home_score;
  const homeWon = isFinal && game.home_score > game.away_score;
  const pickedAway = picked === game.away_team;
  const pickedHome = picked === game.home_team;

  return (
    <div className={`flex items-center rounded-xl transition-all duration-150 ${
      locked && !isLive ? 'opacity-60' : ''
    } ${picked ? 'bg-white shadow-sm' : 'bg-white/70 hover:bg-white hover:shadow-sm'}`}>

      {/* Away team button */}
      <button
        className={`flex items-center gap-3 flex-1 py-3 pl-4 pr-3 rounded-l-xl transition-all ${
          locked ? 'cursor-default' : 'cursor-pointer'
        } ${pickedAway ? '' : picked ? 'opacity-40' : ''}`}
        style={pickedAway ? { background: `${away.primaryColor}12` } : {}}
        onClick={() => !locked && onPick(gid, game.away_team)}
        disabled={!!locked}
      >
        {/* Team color bar */}
        <div className="w-1 h-10 rounded-full shrink-0" style={{ background: away.primaryColor }} />
        {/* Team badge */}
        <div className="w-9 h-9 rounded-lg flex items-center justify-center font-varsity font-black text-white text-[11px] shrink-0 shadow-sm"
          style={{ background: away.primaryColor }}>
          {game.away_team}
        </div>
        {/* Team info */}
        <div className="min-w-0 text-left">
          <div className={`font-display font-bold text-sm truncate ${awayWon ? 'text-slate-900' : isFinal ? 'text-slate-400' : 'text-slate-700'}`}>
            {away.name}
          </div>
          <div className="flex items-center gap-1.5 text-[11px] font-display text-slate-400">
            {records[game.away_team] ? (
              <span className="font-semibold">{records[game.away_team].w}-{records[game.away_team].l}{records[game.away_team].otl ? `-${records[game.away_team].otl}` : ''}</span>
            ) : (
              <span className="truncate">{away.fullName}</span>
            )}
            {records[game.away_team] && records[game.home_team] && !isFinal && (() => {
              const aw = records[game.away_team].w; const al = records[game.away_team].l;
              const hw = records[game.home_team].w; const hl = records[game.home_team].l;
              const awp = aw / Math.max(aw + al, 1); const hwp = hw / Math.max(hw + hl, 1);
              const pct = Math.round((awp / Math.max(awp + hwp, 0.01)) * 100);
              return <span className={`text-[10px] px-1 py-0 rounded font-bold ${pct >= 50 ? 'text-emerald-600 bg-emerald-50' : 'text-slate-400'}`}>{pct}%</span>;
            })()}
          </div>
        </div>
        {/* Score for final */}
        {isFinal && (
          <span className={`ml-auto font-varsity text-xl shrink-0 ${awayWon ? 'text-slate-900' : 'text-slate-300'}`}>
            {game.away_score}
          </span>
        )}
        {/* Pick indicators */}
        {pickedAway && !isFinal && (
          <div className="ml-auto w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ background: away.primaryColor }}>
            <Check className="w-3.5 h-3.5 text-white" />
          </div>
        )}
        {existingPick?.picked_team === game.away_team && existingPick.is_correct === true && (
          <CheckCircle2 className="ml-auto w-5 h-5 text-emerald-500 shrink-0" />
        )}
        {existingPick?.picked_team === game.away_team && existingPick.is_correct === false && (
          <XCircle className="ml-auto w-5 h-5 text-red-500 shrink-0" />
        )}
      </button>

      {/* Center — time / score / status */}
      <div className={`flex flex-col items-center justify-center w-20 sm:w-24 py-2 shrink-0 border-x ${
        isLive ? 'bg-red-50 border-red-100' : 'bg-slate-50/50 border-slate-100'
      }`}>
        {isFinal ? (
          <>
            <span className="text-[9px] font-display font-bold text-slate-400 uppercase">Final</span>
            <span className="font-varsity text-sm text-slate-500">{game.away_score} - {game.home_score}</span>
          </>
        ) : isLive ? (
          <>
            <span className="flex items-center gap-1 text-[9px] font-display font-bold text-red-500 uppercase">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> Live
            </span>
            <span className="font-varsity text-sm text-red-600">{game.away_score} - {game.home_score}</span>
          </>
        ) : locked ? (
          <Lock className="w-4 h-4 text-slate-300" />
        ) : (
          <>
            <span className="text-xs font-display font-semibold text-slate-600">{fmtTime(game)}</span>
            <span className="text-[9px] font-display text-slate-300 uppercase">vs</span>
          </>
        )}
      </div>

      {/* Home team button */}
      <button
        className={`flex items-center gap-3 flex-1 py-3 pr-4 pl-3 rounded-r-xl transition-all flex-row-reverse ${
          locked ? 'cursor-default' : 'cursor-pointer'
        } ${pickedHome ? '' : picked ? 'opacity-40' : ''}`}
        style={pickedHome ? { background: `${home.primaryColor}12` } : {}}
        onClick={() => !locked && onPick(gid, game.home_team)}
        disabled={!!locked}
      >
        <div className="w-1 h-10 rounded-full shrink-0" style={{ background: home.primaryColor }} />
        <div className="w-9 h-9 rounded-lg flex items-center justify-center font-varsity font-black text-white text-[11px] shrink-0 shadow-sm"
          style={{ background: home.primaryColor }}>
          {game.home_team}
        </div>
        <div className="min-w-0 text-right">
          <div className={`font-display font-bold text-sm truncate ${homeWon ? 'text-slate-900' : isFinal ? 'text-slate-400' : 'text-slate-700'}`}>
            {home.name}
          </div>
          <div className="flex items-center gap-1.5 justify-end text-[11px] font-display text-slate-400">
            {records[game.home_team] && records[game.away_team] && !isFinal && (() => {
              const aw = records[game.away_team].w; const al = records[game.away_team].l;
              const hw = records[game.home_team].w; const hl = records[game.home_team].l;
              const awp = aw / Math.max(aw + al, 1); const hwp = hw / Math.max(hw + hl, 1);
              const pct = Math.round((hwp / Math.max(awp + hwp, 0.01)) * 100);
              return <span className={`text-[10px] px-1 py-0 rounded font-bold ${pct >= 50 ? 'text-emerald-600 bg-emerald-50' : 'text-slate-400'}`}>{pct}%</span>;
            })()}
            {records[game.home_team] ? (
              <span className="font-semibold">{records[game.home_team].w}-{records[game.home_team].l}{records[game.home_team].otl ? `-${records[game.home_team].otl}` : ''}</span>
            ) : (
              <span className="truncate">{home.fullName}</span>
            )}
          </div>
        </div>
        {isFinal && (
          <span className={`mr-auto font-varsity text-xl shrink-0 ${homeWon ? 'text-slate-900' : 'text-slate-300'}`}>
            {game.home_score}
          </span>
        )}
        {pickedHome && !isFinal && (
          <div className="mr-auto w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ background: home.primaryColor }}>
            <Check className="w-3.5 h-3.5 text-white" />
          </div>
        )}
        {existingPick?.picked_team === game.home_team && existingPick.is_correct === true && (
          <CheckCircle2 className="mr-auto w-5 h-5 text-emerald-500 shrink-0" />
        )}
        {existingPick?.picked_team === game.home_team && existingPick.is_correct === false && (
          <XCircle className="mr-auto w-5 h-5 text-red-500 shrink-0" />
        )}
      </button>
    </div>
  );
}

// ── Main ────────────────────────────────────────────────────────────

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
  const [records, setRecords] = useState<Record<string, { w: number; l: number; otl: number }>>({});
  const [activeTab, setActiveTab] = useState('picks');

  useEffect(() => {
    const loadData = async () => {
      if (!activeLeagueId || !user) { setLoading(false); return; }
      try {
        const [wg, up, sd] = await Promise.all([
          PoolService.getWeekGames(currentWeek),
          PoolService.getPickemPicks(activeLeagueId, user.id, currentWeek),
          PoolService.getPickemStandings(activeLeagueId),
        ]);
        setGames(wg || []); setExistingPicks(up); setStandings(sd);
        const pm = new Map<string, string>();
        up.forEach(p => pm.set(p.game_id, p.picked_team));
        setPicks(pm);

        // Build team records from all final games across the season
        // Use the season's worth of games we can get from the schedule
        try {
          const { ScheduleService } = await import('@/services/ScheduleService');
          const seasonStart = new Date('2025-10-01');
          const today = new Date();
          const { games: allGames } = await ScheduleService.getGamesForDateRange(seasonStart, today);
          const recs: Record<string, { w: number; l: number; otl: number }> = {};
          for (const g of allGames) {
            if (g.status !== 'final') continue;
            if (!recs[g.home_team]) recs[g.home_team] = { w: 0, l: 0, otl: 0 };
            if (!recs[g.away_team]) recs[g.away_team] = { w: 0, l: 0, otl: 0 };
            if (g.home_score > g.away_score) { recs[g.home_team].w++; recs[g.away_team].l++; }
            else { recs[g.away_team].w++; recs[g.home_team].l++; }
          }
          setRecords(recs);
        } catch { /* records are supplementary, not critical */ }
      } catch (err) { logger.error('[PoolPickem]', err); }
      finally { setLoading(false); }
    };
    loadData();
  }, [activeLeagueId, user, currentWeek]);

  const handlePick = (gid: string, team: string) => {
    const m = new Map(picks);
    m.get(gid) === team ? m.delete(gid) : m.set(gid, team);
    setPicks(m);
  };

  const handleSubmit = async () => {
    if (!activeLeagueId || !user) return;
    setSubmitting(true);
    try {
      const arr = Array.from(picks.entries()).map(([game_id, picked_team]) => ({ game_id, picked_team }));
      const r = await PoolService.submitPickemPicks(activeLeagueId, user.id, currentWeek, arr);
      r.success ? toast({ title: 'Picks Saved!', description: `${arr.length} picks submitted.` })
        : toast({ title: 'Error', description: r.error || 'Failed', variant: 'destructive' });
    } catch { toast({ title: 'Error', description: 'Failed to submit', variant: 'destructive' }); }
    finally { setSubmitting(false); }
  };

  if (loading) return <LoadingScreen character="narwhal" message="Loading Pick'em Pool..." />;

  const byDate = groupByDate(games);
  const ls = (activeLeague?.settings as Record<string, unknown>) || {};
  const ppw = (ls.picksPerWeek as number) || 0;
  const required = ppw > 0 ? Math.min(ppw, games.length) : games.length;
  const pct = required > 0 ? Math.min((picks.size / required) * 100, 100) : 0;

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#D4E8B8] via-[#D0E4B4] to-[#C8DEB0]">
      <div className="hidden lg:block"><Navbar /></div>
      <div className="lg:hidden sticky top-0 z-40 bg-[#D4E8B8]/98 backdrop-blur-xl border-b border-citrus-sage/20 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-center h-12 px-4">
          <h1 className="text-lg font-varsity font-bold text-citrus-forest">Pick'em Pool</h1>
        </div>
      </div>

      <main className="w-full pt-16 lg:pt-24 lg:pb-8 pb-[calc(5rem+env(safe-area-inset-bottom))]">
        <div className="max-w-4xl mx-auto px-3 sm:px-4 lg:px-6">
          {userLeagueState === 'logged-in-no-league' && (
            <div className="mb-8">
              <LeagueCreationCTA title="Join a Pick'em Pool" description="Predict NHL game winners each week." />
            </div>
          )}

          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="flex items-center bg-white/80 rounded-xl border border-citrus-sage/20 overflow-hidden">
                <Button variant="ghost" size="icon" className="h-10 w-10 rounded-none" onClick={() => setCurrentWeek(w => Math.max(1, w - 1))} disabled={currentWeek <= 1}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <div className="px-3 text-center border-x border-citrus-sage/10">
                  <div className="text-[9px] font-display text-citrus-charcoal/40 uppercase tracking-widest leading-none">Week</div>
                  <div className="text-lg font-varsity font-black text-citrus-forest leading-none">{currentWeek}</div>
                </div>
                <Button variant="ghost" size="icon" className="h-10 w-10 rounded-none" onClick={() => setCurrentWeek(w => w + 1)}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>

              {/* Progress pill */}
              <div className="hidden sm:flex items-center gap-2 bg-white/60 rounded-full px-3 py-1.5 border border-citrus-sage/15">
                <div className="w-16 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                  <div className="h-full bg-citrus-sage rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-xs font-display font-semibold text-citrus-forest/70">{picks.size}/{required}</span>
              </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="bg-white/80">
                <TabsTrigger value="picks">Picks</TabsTrigger>
                <TabsTrigger value="standings">Standings</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* ── Picks ── */}
          {activeTab === 'picks' && (
            <>
              {games.length === 0 ? (
                <Card className="border-none shadow-lg bg-white">
                  <CardContent className="py-16 text-center text-slate-400">
                    <Target className="w-12 h-12 mx-auto mb-4 opacity-30" />
                    <p className="font-medium text-lg">No games this week</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-6">
                  {Array.from(byDate.entries()).map(([dateKey, dateGames]) => (
                    <div key={dateKey}>
                      {/* Date header */}
                      <div className="flex items-center gap-2 mb-2 px-1">
                        <Calendar className="w-3.5 h-3.5 text-citrus-forest/40" />
                        <span className="text-xs font-display font-bold text-citrus-forest/60 uppercase tracking-wider">
                          {fmtDate(dateKey)}
                        </span>
                        <div className="flex-1 h-px bg-citrus-sage/15" />
                        <span className="text-[10px] font-display text-citrus-charcoal/30">{dateGames.length} games</span>
                      </div>

                      {/* Game rows */}
                      <div className="space-y-1.5">
                        {dateGames.map(game => (
                          <MatchupRow
                            key={String(game.id)}
                            game={game}
                            picked={picks.get(String(game.id))}
                            existingPick={existingPicks.find(p => p.game_id === String(game.id))}
                            onPick={handlePick}
                            records={records}
                          />
                        ))}
                      </div>
                    </div>
                  ))}

                  {/* Submit bar */}
                  <div className="sticky bottom-20 lg:bottom-4 bg-white/95 backdrop-blur-md border border-slate-200/60 rounded-2xl py-3 px-4 flex items-center justify-between shadow-xl">
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full bg-citrus-sage rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-sm text-slate-500 font-display">
                        {picks.size === 0 ? 'Tap a team' : `${picks.size}/${required} picked`}
                      </span>
                    </div>
                    <Button onClick={handleSubmit} disabled={picks.size === 0 || submitting} size="lg" className="font-varsity uppercase">
                      {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      Submit
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── Standings ── */}
          {activeTab === 'standings' && (
            <Card className="border-none shadow-lg overflow-hidden bg-white">
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
