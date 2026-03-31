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
import LeagueNotifications from '@/components/matchup/LeagueNotifications';
import { InvitePlayersButton } from '@/components/InvitePlayersButton';
import { PoolLeagueHub } from '@/components/PoolLeagueHub';

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

function MatchupRow({ game, picked, existingPick, onPick, records, seasonGames }: {
  game: NHLGame; picked?: string; existingPick?: PickemPick;
  onPick: (id: string, team: string) => void;
  records: Record<string, { w: number; l: number; otl: number }>;
  seasonGames: NHLGame[];
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

  const ar = records[game.away_team];
  const hr = records[game.home_team];
  let awayPct = 50, homePct = 50;
  if (ar && hr) {
    const awp = ar.w / Math.max(ar.w + ar.l, 1);
    const hwp = hr.w / Math.max(hr.w + hr.l, 1);
    awayPct = Math.round((awp / Math.max(awp + hwp, 0.01)) * 100);
    homePct = 100 - awayPct;
  }

  // Season series
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

  // Win streaks from recent games
  const getStreak = (team: string): string => {
    const teamGames = seasonGames
      .filter(g => g.status === 'final' && (g.home_team === team || g.away_team === team))
      .sort((a, b) => b.game_date.localeCompare(a.game_date));
    if (teamGames.length === 0) return '-';
    let streak = 0;
    const firstWin = (teamGames[0].home_team === team && teamGames[0].home_score > teamGames[0].away_score) ||
                     (teamGames[0].away_team === team && teamGames[0].away_score > teamGames[0].home_score);
    const prefix = firstWin ? 'W' : 'L';
    for (const g of teamGames) {
      const won = (g.home_team === team && g.home_score > g.away_score) || (g.away_team === team && g.away_score > g.home_score);
      if ((firstWin && won) || (!firstWin && !won)) streak++;
      else break;
    }
    return `${prefix}${streak}`;
  };

  const awayStreak = getStreak(game.away_team);
  const homeStreak = getStreak(game.home_team);

  return (
    <div className={`grid grid-cols-[1fr_auto_1fr] rounded-xl overflow-hidden transition-all duration-150 ${
      locked && !isLive ? 'opacity-60' : ''
    } ${picked ? 'shadow-md' : 'hover:shadow-md'} bg-white`}>

      {/* ═══ COLUMN 1: AWAY TEAM ═══ */}
      <button
        className={`flex items-center gap-3 py-3 px-4 transition-all ${
          locked ? 'cursor-default' : 'cursor-pointer'
        } ${pickedAway ? '' : picked ? 'opacity-30' : ''}`}
        style={{
          borderLeft: `4px solid ${away.primaryColor}`,
          background: pickedAway ? `${away.primaryColor}15` : undefined,
        }}
        onMouseEnter={(e) => { if (!locked && !pickedAway) e.currentTarget.style.background = `${away.primaryColor}0a`; }}
        onMouseLeave={(e) => { if (!locked && !pickedAway) e.currentTarget.style.background = ''; }}
        onClick={() => !locked && onPick(gid, game.away_team)}
        disabled={!!locked}
      >
        {/* Monogram */}
        <div className="w-10 h-10 rounded-full flex items-center justify-center font-varsity font-black text-white text-[10px] shrink-0 shadow"
          style={{ background: away.primaryColor }}>
          {game.away_team}
        </div>
        {/* Name + record — RIGHT aligned toward center */}
        <div className="flex-1 text-right min-w-0">
          <div className={`font-display font-bold text-sm truncate ${awayWon ? 'text-slate-900' : isFinal ? 'text-slate-400' : 'text-slate-700'}`}>
            {away.name}
          </div>
          <div className="text-[11px] font-display text-slate-400 flex items-center gap-1.5 justify-end">
            {ar && (
              <span className={`font-semibold ${ar.w > ar.l ? 'text-emerald-600' : ar.w < ar.l ? 'text-red-500' : 'text-slate-500'}`}>
                {ar.w}-{ar.l}-{ar.otl}
              </span>
            )}
            {awayStreak !== '-' && (
              <span className={`text-[10px] font-bold ${awayStreak.startsWith('W') ? 'text-emerald-500' : 'text-red-400'}`}>
                {awayStreak}
              </span>
            )}
          </div>
        </div>
        {/* Odds */}
        {!isFinal && !isLive && ar && hr && (
          <div className={`font-varsity font-black text-xl leading-none shrink-0 ${awayPct >= 50 ? 'text-emerald-600' : 'text-slate-400'}`}>
            {awayPct}%
          </div>
        )}
        {/* Score for final/live */}
        {isFinal && (
          <span className={`font-varsity text-2xl shrink-0 ${awayWon ? 'text-slate-900 font-black' : 'text-slate-300'}`}>{game.away_score}</span>
        )}
        {isLive && <span className="font-varsity text-xl shrink-0 text-red-600 font-black">{game.away_score}</span>}
        {/* Pick indicator */}
        {pickedAway && !isFinal && !isLive && (
          <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ background: away.primaryColor }}>
            <Check className="w-3 h-3 text-white" />
          </div>
        )}
        {existingPick?.picked_team === game.away_team && existingPick.is_correct === true && <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />}
        {existingPick?.picked_team === game.away_team && existingPick.is_correct === false && <XCircle className="w-5 h-5 text-red-500 shrink-0" />}
      </button>

      {/* ═══ COLUMN 2: CENTER STATS ═══ */}
      <div className="flex flex-col items-center justify-center w-36 sm:w-44 bg-slate-50/70 border-x border-slate-100 py-2 px-2">
        {/* Row 1: Time or Score */}
        <div className="text-center">
          {isFinal ? (
            <span className="text-[10px] font-display font-bold text-slate-400 uppercase">Final</span>
          ) : isLive ? (
            <span className="flex items-center gap-1 text-[10px] font-display font-bold text-red-500">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> Live
            </span>
          ) : locked ? (
            <span className="flex items-center gap-0.5 text-[10px] text-slate-400"><Lock className="w-2.5 h-2.5" /> Locked</span>
          ) : (
            <span className="text-xs font-display font-bold text-citrus-forest">{fmtTime(game)}</span>
          )}
        </div>

        {/* Row 2: H2H */}
        <div className="text-[9px] font-display text-slate-400 mt-0.5">
          {h2h.length > 0 ? (
            <span>
              H2H:{' '}
              <span className="font-bold" style={{ color: awayH2HWins > homeH2HWins ? away.primaryColor : '#94a3b8' }}>{awayH2HWins}</span>
              {'-'}
              <span className="font-bold" style={{ color: homeH2HWins > awayH2HWins ? home.primaryColor : '#94a3b8' }}>{homeH2HWins}</span>
            </span>
          ) : (
            <span className="text-amber-500">★ 1st meeting</span>
          )}
        </div>

        {/* Row 3: Venue */}
        {game.venue && (
          <div className="text-[8px] font-display text-slate-300 mt-0.5 truncate max-w-full">
            {game.venue}
          </div>
        )}

        {/* Row 4: Home ice */}
        {!isFinal && (
          <div className="text-[9px] font-display text-slate-400 mt-0.5">
            @ {home.fullName}
          </div>
        )}
      </div>

      {/* ═══ COLUMN 3: HOME TEAM ═══ */}
      <button
        className={`flex items-center gap-3 py-3 px-4 transition-all flex-row-reverse ${
          locked ? 'cursor-default' : 'cursor-pointer'
        } ${pickedHome ? '' : picked ? 'opacity-30' : ''}`}
        style={{
          borderRight: `4px solid ${home.primaryColor}`,
          background: pickedHome ? `${home.primaryColor}15` : undefined,
        }}
        onMouseEnter={(e) => { if (!locked && !pickedHome) e.currentTarget.style.background = `${home.primaryColor}0a`; }}
        onMouseLeave={(e) => { if (!locked && !pickedHome) e.currentTarget.style.background = ''; }}
        onClick={() => !locked && onPick(gid, game.home_team)}
        disabled={!!locked}
      >
        {/* Monogram */}
        <div className="w-10 h-10 rounded-full flex items-center justify-center font-varsity font-black text-white text-[10px] shrink-0 shadow"
          style={{ background: home.primaryColor }}>
          {game.home_team}
        </div>
        {/* Name + record — LEFT aligned toward center */}
        <div className="flex-1 text-left min-w-0">
          <div className={`font-display font-bold text-sm truncate ${homeWon ? 'text-slate-900' : isFinal ? 'text-slate-400' : 'text-slate-700'}`}>
            {home.name}
          </div>
          <div className="text-[11px] font-display text-slate-400 flex items-center gap-1.5">
            {homeStreak !== '-' && (
              <span className={`text-[10px] font-bold ${homeStreak.startsWith('W') ? 'text-emerald-500' : 'text-red-400'}`}>
                {homeStreak}
              </span>
            )}
            {hr && (
              <span className={`font-semibold ${hr.w > hr.l ? 'text-emerald-600' : hr.w < hr.l ? 'text-red-500' : 'text-slate-500'}`}>
                {hr.w}-{hr.l}-{hr.otl}
              </span>
            )}
          </div>
        </div>
        {/* Odds */}
        {!isFinal && !isLive && ar && hr && (
          <div className={`font-varsity font-black text-xl leading-none shrink-0 ${homePct >= 50 ? 'text-emerald-600' : 'text-slate-400'}`}>
            {homePct}%
          </div>
        )}
        {isFinal && (
          <span className={`font-varsity text-2xl shrink-0 ${homeWon ? 'text-slate-900 font-black' : 'text-slate-300'}`}>{game.home_score}</span>
        )}
        {isLive && <span className="font-varsity text-xl shrink-0 text-red-600 font-black">{game.home_score}</span>}
        {pickedHome && !isFinal && !isLive && (
          <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ background: home.primaryColor }}>
            <Check className="w-3 h-3 text-white" />
          </div>
        )}
        {existingPick?.picked_team === game.home_team && existingPick.is_correct === true && <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />}
        {existingPick?.picked_team === game.home_team && existingPick.is_correct === false && <XCircle className="w-5 h-5 text-red-500 shrink-0" />}
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
            const isOT = g.period === 'OT' || g.period === 'SO';
            if (g.home_score > g.away_score) {
              recs[g.home_team].w++;
              if (isOT) recs[g.away_team].otl++; else recs[g.away_team].l++;
            } else {
              recs[g.away_team].w++;
              if (isOT) recs[g.home_team].otl++; else recs[g.home_team].l++;
            }
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
        <div className="flex lg:gap-0">
        {/* Main picks column — centered with padding */}
        <div className="flex-1 min-w-0 px-3 sm:px-4 lg:px-8 xl:px-12">
          {userLeagueState === 'logged-in-no-league' && (
            <div className="mb-8">
              <LeagueCreationCTA title="Join a Pick'em Pool" description="Predict NHL game winners each week." />
            </div>
          )}

          {/* Header — STICKY below navbar */}
          <div className="sticky top-[92px] z-30 bg-[#D4E8B8]/95 backdrop-blur-sm py-3 mb-4 -mx-3 sm:-mx-4 lg:-mx-8 xl:-mx-12 px-3 sm:px-4 lg:px-8 xl:px-12 border-b border-citrus-sage/15">
          <div className="flex items-center justify-between">
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

            <div className="flex items-center gap-2">
              {activeLeague?.join_code && (
                <InvitePlayersButton joinCode={activeLeague.join_code} leagueName={activeLeague.name} />
              )}
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="bg-white/80">
                  <TabsTrigger value="picks">Picks</TabsTrigger>
                  <TabsTrigger value="standings">Standings</TabsTrigger>
                  <TabsTrigger value="league">League</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>
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

                      {/* Game rows — 2 columns on xl to reduce empty space */}
                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-1.5">
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

export default PoolPickem;
