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
  seasonGames: NHLGame[]; // all season games for head-to-head calc
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

  // Calculate win probabilities from records
  const ar = records[game.away_team];
  const hr = records[game.home_team];
  let awayPct = 50, homePct = 50;
  if (ar && hr) {
    const awp = ar.w / Math.max(ar.w + ar.l, 1);
    const hwp = hr.w / Math.max(hr.w + hr.l, 1);
    awayPct = Math.round((awp / Math.max(awp + hwp, 0.01)) * 100);
    homePct = 100 - awayPct;
  }

  // Season series between these two teams
  const h2h = seasonGames.filter(g =>
    g.status === 'final' &&
    ((g.home_team === game.home_team && g.away_team === game.away_team) ||
     (g.home_team === game.away_team && g.away_team === game.home_team))
  );
  const awayH2HWins = h2h.filter(g =>
    (g.home_team === game.away_team && g.home_score > g.away_score) ||
    (g.away_team === game.away_team && g.away_score > g.home_score)
  ).length;
  const homeH2HWins = h2h.filter(g =>
    (g.home_team === game.home_team && g.home_score > g.away_score) ||
    (g.away_team === game.home_team && g.away_score > g.home_score)
  ).length;

  return (
    <div className={`rounded-xl overflow-hidden transition-all duration-150 ${
      locked && !isLive ? 'opacity-60' : ''
    } ${picked ? 'bg-white shadow-md' : 'bg-white/70 hover:bg-white hover:shadow-md'}`}>

      {/* Top bar — venue, h2h, time */}
      <div className={`flex items-center justify-between px-4 py-1.5 text-[11px] font-display ${
        isFinal ? 'bg-slate-100 text-slate-400' :
        isLive ? 'bg-red-50 text-red-500' :
        'bg-slate-50 text-slate-400'
      }`}>
        <span className="truncate">
          {game.venue || `${home.fullName}`}
          {h2h.length > 0 && !isFinal && (
            <span className="ml-2 font-semibold text-slate-500">
              Season Series: {awayH2HWins}-{homeH2HWins}
            </span>
          )}
        </span>
        <span className="font-semibold shrink-0 ml-2">
          {isFinal ? 'Final' : isLive ? (
            <span className="flex items-center gap-1 text-red-500">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> Live
            </span>
          ) : locked ? (
            <span className="flex items-center gap-1"><Lock className="w-3 h-3" /> Locked</span>
          ) : fmtTime(game)}
        </span>
      </div>

      {/* Matchup row */}
      <div className="flex items-stretch">
        {/* Away team */}
        <button
          className={`flex items-center gap-2.5 flex-1 py-3 pl-3 pr-2 transition-all ${
            locked ? 'cursor-default' : 'cursor-pointer'
          } ${pickedAway ? '' : picked ? 'opacity-35' : ''}`}
          style={{
            borderLeft: `4px solid ${away.primaryColor}`,
            background: pickedAway ? `${away.primaryColor}12` : undefined,
          }}
          onClick={() => !locked && onPick(gid, game.away_team)}
          disabled={!!locked}
        >
          <div className="w-10 h-10 rounded-lg flex items-center justify-center font-varsity font-black text-white text-xs shrink-0 shadow-sm"
            style={{ background: away.primaryColor }}>
            {game.away_team}
          </div>
          <div className="min-w-0 text-left flex-1">
            <div className={`font-display font-bold text-sm truncate ${awayWon ? 'text-slate-900' : isFinal ? 'text-slate-400' : 'text-slate-700'}`}>
              {away.name}
            </div>
            <div className="text-[11px] font-display text-slate-400">
              {ar ? <span className="font-semibold">{ar.w}-{ar.l}{ar.otl ? `-${ar.otl}` : ''}</span> : away.fullName}
            </div>
          </div>
          {/* Win probability — LARGE */}
          {!isFinal && !isLive && ar && hr && (
            <div className={`text-right shrink-0 mr-1 ${awayPct >= 50 ? 'text-emerald-600' : 'text-slate-400'}`}>
              <div className="text-lg font-varsity font-black leading-none">{awayPct}%</div>
              <div className="text-[9px] font-display uppercase tracking-wider">{awayPct >= 50 ? 'Fav' : ''}</div>
            </div>
          )}
          {isFinal && (
            <span className={`font-varsity text-2xl shrink-0 ml-auto ${awayWon ? 'text-slate-900' : 'text-slate-300'}`}>
              {game.away_score}
            </span>
          )}
          {isLive && (
            <span className="font-varsity text-xl shrink-0 ml-auto text-red-600">{game.away_score}</span>
          )}
          {pickedAway && !isFinal && !isLive && (
            <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ background: away.primaryColor }}>
              <Check className="w-3.5 h-3.5 text-white" />
            </div>
          )}
          {existingPick?.picked_team === game.away_team && existingPick.is_correct === true && (
            <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
          )}
          {existingPick?.picked_team === game.away_team && existingPick.is_correct === false && (
            <XCircle className="w-5 h-5 text-red-500 shrink-0" />
          )}
        </button>

        {/* Center divider */}
        <div className="flex items-center justify-center w-8 bg-slate-50/80 shrink-0 border-x border-slate-100">
          <span className="text-[9px] font-display text-slate-300 font-bold">@</span>
        </div>

        {/* Home team */}
        <button
          className={`flex items-center gap-2.5 flex-1 py-3 pr-3 pl-2 transition-all flex-row-reverse ${
            locked ? 'cursor-default' : 'cursor-pointer'
          } ${pickedHome ? '' : picked ? 'opacity-35' : ''}`}
          style={{
            borderRight: `4px solid ${home.primaryColor}`,
            background: pickedHome ? `${home.primaryColor}12` : undefined,
          }}
          onClick={() => !locked && onPick(gid, game.home_team)}
          disabled={!!locked}
        >
          <div className="w-10 h-10 rounded-lg flex items-center justify-center font-varsity font-black text-white text-xs shrink-0 shadow-sm"
            style={{ background: home.primaryColor }}>
            {game.home_team}
          </div>
          <div className="min-w-0 text-right flex-1">
            <div className={`font-display font-bold text-sm truncate ${homeWon ? 'text-slate-900' : isFinal ? 'text-slate-400' : 'text-slate-700'}`}>
              {home.name}
            </div>
            <div className="text-[11px] font-display text-slate-400">
              {hr ? <span className="font-semibold">{hr.w}-{hr.l}{hr.otl ? `-${hr.otl}` : ''}</span> : home.fullName}
            </div>
          </div>
          {!isFinal && !isLive && ar && hr && (
            <div className={`text-left shrink-0 ml-1 ${homePct >= 50 ? 'text-emerald-600' : 'text-slate-400'}`}>
              <div className="text-lg font-varsity font-black leading-none">{homePct}%</div>
              <div className="text-[9px] font-display uppercase tracking-wider">{homePct >= 50 ? 'Fav' : ''}</div>
            </div>
          )}
          {isFinal && (
            <span className={`font-varsity text-2xl shrink-0 mr-auto ${homeWon ? 'text-slate-900' : 'text-slate-300'}`}>
              {game.home_score}
            </span>
          )}
          {isLive && (
            <span className="font-varsity text-xl shrink-0 mr-auto text-red-600">{game.home_score}</span>
          )}
          {pickedHome && !isFinal && !isLive && (
            <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ background: home.primaryColor }}>
              <Check className="w-3.5 h-3.5 text-white" />
            </div>
          )}
          {existingPick?.picked_team === game.home_team && existingPick.is_correct === true && (
            <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
          )}
          {existingPick?.picked_team === game.home_team && existingPick.is_correct === false && (
            <XCircle className="w-5 h-5 text-red-500 shrink-0" />
          )}
        </button>
      </div>
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
  const [seasonGames, setSeasonGames] = useState<NHLGame[]>([]);
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

        // Build team records + cache season games for head-to-head
        try {
          const { ScheduleService } = await import('@/services/ScheduleService');
          const seasonStart = new Date('2025-10-01');
          const today = new Date();
          const { games: allGames } = await ScheduleService.getGamesForDateRange(seasonStart, today);
          setSeasonGames(allGames);
          const recs: Record<string, { w: number; l: number; otl: number }> = {};
          for (const g of allGames) {
            if (g.status !== 'final') continue;
            if (!recs[g.home_team]) recs[g.home_team] = { w: 0, l: 0, otl: 0 };
            if (!recs[g.away_team]) recs[g.away_team] = { w: 0, l: 0, otl: 0 };
            if (g.home_score > g.away_score) { recs[g.home_team].w++; recs[g.away_team].l++; }
            else { recs[g.away_team].w++; recs[g.home_team].l++; }
          }
          setRecords(recs);
        } catch { /* records are supplementary */ }
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
                            seasonGames={seasonGames}
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
