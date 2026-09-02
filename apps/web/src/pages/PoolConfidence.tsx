import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import Navbar from '@/components/Navbar';
import LeagueNotifications from '@/components/matchup/LeagueNotifications';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { PoolService, ConfidencePick, ConfidenceStanding } from '@/services/PoolService';
import { NHLGame } from '@/services/ScheduleService';
import { Loader2, CheckCircle2, XCircle, ChevronLeft, ChevronRight, Lock, Calendar, Check } from 'lucide-react';
import { LeagueCreationCTA } from '@/components/LeagueCreationCTA';
import { logger } from '@/utils/logger';
import { getTeamInfo, type NHLTeamInfo } from '@/types/captracker';
import { InvitePlayersButton } from '@/components/InvitePlayersButton';
import { PoolLeagueHub } from '@/components/PoolLeagueHub';
import {
  DarkLayout,
  HockeyFooter,
  StormyLoading,
  GlowCard,
  LivePulse,
  XGModelIcon,
} from '@/components/citrus2';
import { onTeamColor } from '@/utils/teamColorContrast';

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
    <div className="rounded-lg flex items-center justify-center font-bold text-white tracking-wide shadow-sm"
      style={{ width: size, height: size, background: info.primaryColor, fontSize: size * 0.32, color: onTeamColor(info.primaryColor) }}>
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
  // 2026-08-18 launch audit: getPoolRoute() has always appended a
  // `?tab=` param (Navbar, MobileBottomNav, GMOffice all pass one), but
  // none of the pool pages ever read it — the tab was pure local state.
  // Every "Standings" / "Pick History" link therefore landed on the
  // default Picks tab. Worst case: Standings.tsx redirects pool users to
  // getPoolRoute(..., 'standings'), so pool standings were unreachable
  // from /standings entirely. Read and validate the param.
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(() => {
    const requested = searchParams.get('tab');
    const allowed = ['picks', 'standings', 'league'];
    return requested && allowed.includes(requested) ? requested : 'picks';
  });

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

        // Fetch team records + H2H
        try {
          const { records: tr } = await PoolService.getTeamRecordsAndH2H(currentWeek);
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
    if (!arr.length) { toast({ title: 'No Picks Yet', description: 'Make at least one pick before submitting.', variant: 'destructive' }); return; }
    if (new Set(arr.map(p => p.confidence_points)).size !== arr.length) {
      toast({ title: 'Confidence Duplicate', description: 'Each pick needs a unique confidence value.', variant: 'destructive' }); return;
    }
    setSubmitting(true);
    try {
      const r = await PoolService.submitConfidencePicks(activeLeagueId, user.id, currentWeek, arr);
      if (r.success) toast({ title: 'Picks Submitted', description: `${arr.length} picks saved.` });
      else toast({ title: "Picks Didn't Submit", description: r.error || "Couldn't submit your picks. Try again in a moment.", variant: 'destructive' });
    } catch { toast({ title: "Picks Didn't Submit", description: "Couldn't reach the pool server. Try again in a moment.", variant: 'destructive' }); }
    finally { setSubmitting(false); }
  };

  const usedPts = new Set(Array.from(picks.values()).map(p => p.confidence_points));
  const maxPts = Math.max(games.length, 1);

  if (loading) return (
    <DarkLayout>
      <Navbar />
      <StormyLoading message="Loading Confidence Pool..." />
    </DarkLayout>
  );

  const gamesByDate = groupGamesByDate(games);
  const weekEarned = existingPicks.reduce((s, p) => s + (p.is_correct ? (p.confidence_points || 0) : 0), 0);
  const weekPossible = existingPicks.reduce((s, p) => s + (p.confidence_points || 0), 0);

  return (
    <DarkLayout>
      <Navbar />

      <main className="w-full pt-20 lg:pt-24 lg:pb-8 pb-[calc(5rem+env(safe-area-inset-bottom))]">
        <div className="flex lg:gap-0">
        <div className="flex-1 min-w-0 px-3 sm:px-4 lg:px-8 xl:px-12">
          {userLeagueState === 'logged-in-no-league' && (
            <div className="mb-8 max-w-3xl mx-auto">
              <LeagueCreationCTA title="Join a Confidence Pool" description="Rank your picks by confidence. The higher the confidence on a correct pick, the more it pays." />
            </div>
          )}

          {/* Hero banner — mascot acting in domain */}
          <div className="relative mb-6 mt-4 w-full aspect-[21/9] sm:aspect-[24/9] rounded-2xl overflow-hidden ring-1 ring-white/10 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.5)]">
            <img
              src="/mascots/scene-confidence.webp"
              alt="Stormy ranking team picks in a confidence tier list"
              className="w-full h-full object-cover"
              loading="eager"
            />
            <div
              aria-hidden="true"
              className="absolute inset-0 pointer-events-none"
              style={{ background: 'linear-gradient(to top, rgba(15,31,21,0.85) 0%, transparent 45%)' }}
            />
            <div className="absolute bottom-4 left-5 sm:bottom-6 sm:left-8 z-10 max-w-[80%]">
              <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft mb-1.5 font-bold flex items-center gap-2">
                <XGModelIcon className="w-3 h-3" /> Confidence Pool
              </div>
              <h1 className="font-sans font-black text-[1.5rem] sm:text-[2rem] md:text-[2.5rem] tracking-[-0.025em] text-pastel-cream leading-tight drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">
                Rank your picks. <span className="text-pastel-orange">Stack your edge.</span>
              </h1>
            </div>
          </div>

          {/* Header — STICKY below navbar */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-5 sticky top-[92px] z-section-header bg-[#0F1F15]/95 backdrop-blur-md py-2 -mx-3 sm:-mx-4 lg:-mx-8 xl:-mx-12 px-3 sm:px-4 lg:px-8 xl:px-12 border-b border-white/5">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center bg-[#1A2A20] rounded-md ring-1 ring-white/10 overflow-hidden">
                <Button variant="ghost" size="icon" aria-label="Previous week" className="h-8 w-8 rounded-none text-pastel-cream hover:text-pastel-orange hover:bg-white/5" onClick={() => setCurrentWeek(w => Math.max(1, w - 1))} disabled={currentWeek <= 1}>
                  <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                </Button>
                <div className="px-3 text-center border-x border-white/10">
                  <div className="text-[9px] font-jbmono text-white/55 uppercase tracking-widest leading-none">Week</div>
                  <div className="text-base font-bold text-pastel-cream leading-none tabular-nums">{currentWeek}</div>
                </div>
                <Button variant="ghost" size="icon" aria-label="Next week" className="h-8 w-8 rounded-none text-pastel-cream hover:text-pastel-orange hover:bg-white/5" onClick={() => setCurrentWeek(w => w + 1)}>
                  <ChevronRight className="w-4 h-4" aria-hidden="true" />
                </Button>
              </div>
              <Badge className="text-[10px] bg-white/5 ring-1 ring-white/10 text-pastel-cream font-jbmono uppercase tracking-wider tabular-nums">{picks.size}/{games.length} picked</Badge>
              {weekPossible > 0 && (
                <Badge className="text-[10px] bg-pastel-orange/15 ring-1 ring-pastel-orange/40 text-pastel-orange-soft font-jbmono uppercase tracking-wider tabular-nums">{weekEarned}/{weekPossible} pts</Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              {activeLeague?.join_code && (
                <InvitePlayersButton joinCode={activeLeague.join_code} leagueName={activeLeague.name} />
              )}
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-auto">
                <TabsList className="bg-[#1A2A20] h-9 ring-1 ring-white/10">
                  <TabsTrigger value="picks" className="text-xs sm:text-sm px-2 sm:px-3 data-[state=active]:bg-pastel-orange data-[state=active]:text-[#581E00] text-white/70">Rank Picks</TabsTrigger>
                  <TabsTrigger value="standings" className="text-xs sm:text-sm px-2 sm:px-3 data-[state=active]:bg-pastel-orange data-[state=active]:text-[#581E00] text-white/70">Standings</TabsTrigger>
                  <TabsTrigger value="league" className="text-xs sm:text-sm px-2 sm:px-3 data-[state=active]:bg-pastel-orange data-[state=active]:text-[#581E00] text-white/70">League</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>

          {/* ── Picks tab ── */}
          {activeTab === 'picks' && (
            <>
              {games.length === 0 ? (
                <GlowCard accent="orange" className="max-w-xl mx-auto">
                  <div className="py-16 text-center">
                    <XGModelIcon className="w-12 h-12 mx-auto mb-4 text-pastel-orange-soft/60" />
                    <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold mb-2">
                      ✦ Between slates
                    </div>
                    <p className="font-bold text-lg text-pastel-cream">The board is dark tonight.</p>
                    <p className="text-[13px] text-white/55 mt-1 max-w-sm mx-auto">This week's slate hasn't dropped yet. Swing back Wednesday when the confidence rankings open.</p>
                  </div>
                </GlowCard>
              ) : (
                <div className="space-y-8">
                  {Array.from(gamesByDate.entries()).map(([dateKey, dateGames]) => (
                    <div key={dateKey}>
                      <div className="flex items-center gap-3 mb-3 px-1">
                        <Calendar className="w-3.5 h-3.5 text-pastel-orange-soft" aria-hidden="true" />
                        <span className="text-xs font-jbmono font-bold text-pastel-orange-soft uppercase tracking-[0.22em]">{formatDateHeader(dateKey)}</span>
                        <div className="flex-1 h-px bg-white/10" />
                        <span className="text-[10px] font-jbmono text-white/55 tabular-nums">{dateGames.length} games</span>
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
                            <div key={gameId} className={`rounded-2xl ring-1 overflow-hidden transition-all duration-200 bg-[#1A2A20] ${
                              isLive ? 'ring-pastel-orange/50 shadow-[0_8px_24px_-12px_rgba(255,107,26,0.4)]'
                              : pick ? 'ring-pastel-orange/30 shadow-[0_8px_24px_-12px_rgba(255,107,26,0.25)]' : 'ring-white/10 hover:ring-white/20'
                            }`}>
                              {/* Status bar with confidence */}
                              <div className={`flex items-center justify-between px-3 py-1.5 text-[10px] font-jbmono font-bold uppercase tracking-wider ${
                                isFinal ? 'bg-black/40 text-white/55' : isLive ? 'bg-pastel-orange/20 text-pastel-orange-soft' : locked ? 'bg-white/5 text-white/55' : 'bg-black/20 text-white/55'
                              }`}>
                                <span>
                                  {isFinal ? 'Final' : isLive ? (
                                    <span className="flex items-center gap-1.5"><LivePulse size="xs" />Live</span>
                                  ) : locked ? (
                                    <span className="flex items-center gap-1"><Lock className="w-3 h-3" aria-hidden="true" />Locked</span>
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
                                      <SelectTrigger className={`h-6 w-16 text-[10px] border-0 font-bold rounded-full px-2 tabular-nums ${
                                        isFinal || isLive ? 'bg-white/20 text-white' : 'bg-pastel-orange/20 text-pastel-orange-soft ring-1 ring-pastel-orange/40'
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
                                  style={{ borderLeft: `4px solid ${awayInfo.primaryColor}`, background: pick?.picked_team === game.away_team ? `${awayInfo.primaryColor}25` : undefined }}
                                  onClick={() => !locked && handleTeamPick(gameId, game.away_team)} disabled={!!locked}
                                >
                                  <TeamMonogram abbrev={game.away_team} size={34} />
                                  <span className="font-bold text-xs uppercase" style={{ color: awayInfo.primaryColor }}>{awayInfo.name}</span>
                                  {records[game.away_team] && (
                                    <span className={`text-[10px] font-jbmono tabular-nums ${records[game.away_team].w > records[game.away_team].l ? 'text-pastel-sage-soft' : 'text-white/55'}`}>
                                      {records[game.away_team].w}-{records[game.away_team].l}-{records[game.away_team].otl}
                                    </span>
                                  )}
                                  {isFinal && <span className="text-lg font-bold text-pastel-cream tabular-nums">{game.away_score}</span>}
                                  {pick?.picked_team === game.away_team && !isFinal && (
                                    <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-pastel-orange flex items-center justify-center"><Check className="w-2.5 h-2.5 text-white" aria-hidden="true" /></div>
                                  )}
                                  {ep?.is_correct === true && ep.picked_team === game.away_team && <CheckCircle2 className="w-4 h-4 text-pastel-sage absolute top-1.5 right-1.5" aria-hidden="true" />}
                                  {ep?.is_correct === false && ep.picked_team === game.away_team && <XCircle className="w-4 h-4 text-red-400 absolute top-1.5 right-1.5" aria-hidden="true" />}
                                  {pick && pick.picked_team !== game.away_team && !isFinal && <div className="absolute inset-0 bg-black/40 pointer-events-none" />}
                                </button>

                                <div className="flex items-center justify-center w-8 bg-black/20 text-[10px] text-white/55 font-bold shrink-0">@</div>

                                <button
                                  className={`flex-1 flex flex-col items-center gap-1.5 py-3.5 px-2 transition-all relative ${locked ? 'cursor-default' : 'cursor-pointer'} ${isFinal && !homeWon ? 'opacity-40' : ''}`}
                                  style={{ borderRight: `4px solid ${homeInfo.primaryColor}`, background: pick?.picked_team === game.home_team ? `${homeInfo.primaryColor}25` : undefined }}
                                  onClick={() => !locked && handleTeamPick(gameId, game.home_team)} disabled={!!locked}
                                >
                                  <TeamMonogram abbrev={game.home_team} size={34} />
                                  <span className="font-bold text-xs uppercase" style={{ color: homeInfo.primaryColor }}>{homeInfo.name}</span>
                                  {records[game.home_team] && (
                                    <span className={`text-[10px] font-jbmono tabular-nums ${records[game.home_team].w > records[game.home_team].l ? 'text-pastel-sage-soft' : 'text-white/55'}`}>
                                      {records[game.home_team].w}-{records[game.home_team].l}-{records[game.home_team].otl}
                                    </span>
                                  )}
                                  {isFinal && <span className="text-lg font-bold text-pastel-cream tabular-nums">{game.home_score}</span>}
                                  {pick?.picked_team === game.home_team && !isFinal && (
                                    <div className="absolute top-1.5 left-1.5 w-4 h-4 rounded-full bg-pastel-orange flex items-center justify-center"><Check className="w-2.5 h-2.5 text-white" aria-hidden="true" /></div>
                                  )}
                                  {ep?.is_correct === true && ep.picked_team === game.home_team && <CheckCircle2 className="w-4 h-4 text-pastel-sage absolute top-1.5 left-1.5" aria-hidden="true" />}
                                  {ep?.is_correct === false && ep.picked_team === game.home_team && <XCircle className="w-4 h-4 text-red-400 absolute top-1.5 left-1.5" aria-hidden="true" />}
                                  {pick && pick.picked_team !== game.home_team && !isFinal && <div className="absolute inset-0 bg-black/40 pointer-events-none" />}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  {/* Submit */}
                  <div className="sticky bottom-20 lg:bottom-4 bg-[#1A2A20]/95 backdrop-blur-md ring-1 ring-pastel-orange/30 rounded-2xl py-3 px-4 flex items-center justify-between shadow-[0_24px_60px_-20px_rgba(255,107,26,0.4)]">
                    <span className="text-[13px] text-pastel-cream">
                      {picks.size === 0 ? <span className="text-white/55">Pick a team, then assign confidence</span> : <><span className="font-bold tabular-nums">{picks.size}</span> of <span className="tabular-nums">{games.length}</span> picked</>}
                    </span>
                    <Button onClick={handleSubmitPicks} disabled={picks.size === 0 || submitting} className="font-bold uppercase tracking-wider bg-pastel-orange hover:bg-pastel-orange-soft text-white border-0 active:scale-95 transition-all">
                      {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />}
                      Submit Picks
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── Standings ── */}
          {activeTab === 'standings' && (
            <GlowCard accent="orange" className="max-w-4xl mx-auto">
              <div>
                {standings.length === 0 ? (
                  <div className="text-center py-16">
                    <XGModelIcon className="w-12 h-12 mx-auto mb-4 text-pastel-orange-soft/60" />
                    <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold mb-2">
                      ✦ Awaiting the first whistle
                    </div>
                    <p className="font-bold text-pastel-cream text-base">Standings light up after week 1 wraps.</p>
                    <p className="text-[13px] text-white/55 mt-1 max-w-sm mx-auto">Rank every game by confidence. High stakes on the ones you're sure about.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-black/20 border-white/10 hover:bg-black/20">
                          <TableHead className="w-12 text-center text-pastel-orange-soft font-jbmono uppercase text-[10px] tracking-wider">#</TableHead>
                          <TableHead className="text-pastel-orange-soft font-jbmono uppercase text-[10px] tracking-wider">Player</TableHead>
                          <TableHead className="text-center text-pastel-orange-soft font-jbmono uppercase text-[10px] tracking-wider">Pts</TableHead>
                          <TableHead className="text-center hidden sm:table-cell text-pastel-orange-soft font-jbmono uppercase text-[10px] tracking-wider">Possible</TableHead>
                          <TableHead className="text-right text-pastel-orange-soft font-jbmono uppercase text-[10px] tracking-wider">Efficiency</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {standings.map((s, i) => (
                          <TableRow key={s.user_id} className={`border-white/5 hover:bg-white/5 transition-colors ${s.user_id === user?.id ? 'bg-pastel-orange/10' : ''}`}>
                            <TableCell className="text-center">
                              <span className={`inline-flex w-7 h-7 rounded-full items-center justify-center text-xs font-bold ${
                                i === 0 ? 'bg-pastel-orange text-[#581E00]' :
                                i === 1 ? 'bg-white/20 text-pastel-cream' :
                                i === 2 ? 'bg-pastel-orange/40 text-white' :
                                'text-white/55'
                              }`}>{i + 1}</span>
                            </TableCell>
                            <TableCell className="font-bold text-pastel-cream">
                              {s.display_name}
                              {s.user_id === user?.id && <Badge variant="outline" className="ml-2 text-[9px] font-jbmono uppercase tracking-wider border-pastel-orange text-pastel-orange-soft">YOU</Badge>}
                            </TableCell>
                            <TableCell className="text-center font-bold text-pastel-cream tabular-nums">{s.total_points}</TableCell>
                            <TableCell className="text-center text-white/55 hidden sm:table-cell tabular-nums">{s.possible_points}</TableCell>
                            <TableCell className="text-right font-bold text-pastel-orange-soft tabular-nums">
                              {s.possible_points > 0 ? ((s.total_points / s.possible_points) * 100).toFixed(1) : '0.0'}%
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </GlowCard>
          )}

          {/* ── League tab ── */}
          {activeTab === 'league' && activeLeague && (
            <PoolLeagueHub leagueId={activeLeagueId!} league={activeLeague as any} />
          )}
        </div>

        {/* Chat sidebar — pinned to right edge */}
        {activeLeagueId && (
          <div className="hidden lg:block w-72 xl:w-80 shrink-0 border-l border-white/5 bg-black/20">
            <div className="sticky top-24 h-[calc(100vh-6rem)] flex flex-col">
              <LeagueNotifications leagueId={activeLeagueId} />
            </div>
          </div>
        )}
        </div>
      </main>
      <HockeyFooter variant="app" />
    </DarkLayout>
  );
};

export default PoolConfidence;
