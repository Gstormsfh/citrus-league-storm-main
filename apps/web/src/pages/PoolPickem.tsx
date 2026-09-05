import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import Navbar from '@/components/Navbar';
import { PressBoxLeagueChrome } from '@/components/pressbox/LeagueChrome';
import { PressBoxPageLoading } from '@/components/pressbox/PageLoading';
import { PressBoxTabs } from '@/components/pressbox/Tabs';
import { PressBoxTeamMark } from '@/components/pressbox/TeamMark';
import { PB_TYPE } from '@/components/pressbox/rowScale';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { PoolService, PickemPick, PickemStanding } from '@/services/PoolService';
import { NHLGame } from '@/services/ScheduleService';
import { Loader2, CheckCircle2, XCircle, ChevronLeft, ChevronRight, Lock, Calendar, Check } from 'lucide-react';
import { LeagueCreationCTA } from '@/components/LeagueCreationCTA';
import { logger } from '@/utils/logger';
import { getTeamInfo } from '@/types/captracker';
import LeagueNotifications from '@/components/matchup/LeagueNotifications';
import { InvitePlayersButton } from '@/components/InvitePlayersButton';
import { PoolLeagueHub } from '@/components/PoolLeagueHub';
import {
  DarkLayout,
  HockeyFooter,
  StormyLoading,
  GlowCard,
  LivePulse,
  PickemIcon,
} from '@/components/citrus2';
import { onTeamColor } from '@/utils/teamColorContrast';

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

function MatchupRow({ game, picked, existingPick, onPick, records, h2hData }: {
  game: NHLGame; picked?: string; existingPick?: PickemPick;
  onPick: (id: string, team: string) => void;
  records: Record<string, { w: number; l: number; otl: number; streak?: string }>;
  h2hData: Map<string, { awayWins: number; homeWins: number; games: number }>;
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

  // Season series from server (single batch API call, no row limit issues)
  const h2hKey = [game.away_team, game.home_team].sort().join('-');
  const h2hResult = h2hData.get(h2hKey);
  const h2hGames = h2hResult?.games || 0;
  const awayH2HWins = h2hResult?.awayWins || 0;
  const homeH2HWins = h2hResult?.homeWins || 0;

  // Streaks from server-side records (calculated from ALL games, no 1000-row limit)
  const awayStreak = ar?.streak || '-';
  const homeStreak = hr?.streak || '-';

  return (
    <div className={`grid grid-cols-[1fr_auto_1fr] rounded-xl overflow-hidden transition-all duration-200 bg-[#1A2A20] max-lg:bg-pressbox-tile ring-1 ${
      picked ? 'ring-pastel-orange/40 max-lg:ring-pressbox-orange/40 shadow-[0_8px_24px_-12px_rgba(255,107,26,0.3)]' : 'ring-white/10 hover:ring-white/20'
    } ${locked && !isLive ? 'opacity-60' : ''}`}>

      {/* ═══ COLUMN 1: AWAY TEAM ═══ */}
      <button
        className={`flex items-center gap-1.5 py-2.5 pl-2 pr-1.5 transition-all ${
          locked ? 'cursor-default' : 'cursor-pointer'
        } ${pickedAway ? '' : picked ? 'opacity-30' : ''}`}
        style={{
          borderLeft: `3px solid ${away.primaryColor}`,
          background: pickedAway ? `${away.primaryColor}25` : undefined,
        }}
        onMouseEnter={(e) => { if (!locked && !pickedAway) e.currentTarget.style.background = `${away.primaryColor}12`; }}
        onMouseLeave={(e) => { if (!locked && !pickedAway) e.currentTarget.style.background = ''; }}
        onClick={() => !locked && onPick(gid, game.away_team)}
        disabled={!!locked}
      >
        {/* The crest on the phone; the monogram from lg. */}
        <PressBoxTeamMark abbrev={game.away_team} size="md" label={away.fullName} className="lg:hidden" />
        <div className="max-lg:hidden w-8 h-8 rounded-full flex items-center justify-center font-bold text-white text-[9px] shrink-0 shadow-sm"
          style={{ background: away.primaryColor, color: onTeamColor(away.primaryColor) }}>
          {game.away_team}
        </div>
        {/* Name + record */}
        <div className="flex-1 text-right min-w-0">
          <div className={`font-bold text-xs truncate ${awayWon ? 'text-pastel-cream max-lg:text-pressbox-text' : isFinal ? 'text-white/55' : 'text-pastel-cream max-lg:text-pressbox-text'}`}>
            {away.name}
          </div>
          <div className="text-[10px] font-jbmono max-lg:font-plex text-white/55 truncate">
            {ar ? `${ar.w}-${ar.l}-${ar.otl}` : ''}
            {awayStreak && awayStreak !== '-' ? ` ${awayStreak}` : ''}
          </div>
        </div>
        {/* Odds */}
        {!isFinal && !isLive && ar && hr && (
          <div className={`font-bold text-base leading-none shrink-0 tabular-nums ${awayPct >= 50 ? 'text-pastel-sage-soft' : 'text-white/55'}`}>
            {awayPct}%
          </div>
        )}
        {isFinal && (
          <span className={`font-bold text-lg shrink-0 tabular-nums ${awayWon ? 'text-pastel-cream max-lg:text-pressbox-text' : 'text-white/55'}`}>{game.away_score}</span>
        )}
        {isLive && <span className="font-bold text-lg shrink-0 text-pastel-orange max-lg:text-pressbox-orange tabular-nums">{game.away_score}</span>}
        {pickedAway && !isFinal && !isLive && (
          <div className="w-4 h-4 rounded-full flex items-center justify-center shrink-0" style={{ background: away.primaryColor, color: onTeamColor(away.primaryColor) }}>
            <Check className="w-2.5 h-2.5 text-white" aria-hidden="true" />
          </div>
        )}
        {existingPick?.picked_team === game.away_team && existingPick.is_correct === true && <CheckCircle2 className="w-4 h-4 text-pastel-sage max-lg:text-pressbox-sage shrink-0" aria-hidden="true" />}
        {existingPick?.picked_team === game.away_team && existingPick.is_correct === false && <XCircle className="w-4 h-4 text-red-400 shrink-0" aria-hidden="true" />}
      </button>

      {/* ═══ COLUMN 2: CENTER STATS ═══ */}
      <div className="flex flex-col items-center justify-center w-16 sm:w-24 md:w-28 2xl:w-24 bg-black/20 border-x border-white/5 py-1.5 px-0.5 sm:px-1">
        {/* Row 1: Time or Score */}
        <div className="text-center">
          {isFinal ? (
            <span className="text-[10px] font-jbmono max-lg:font-plex font-bold text-white/55 uppercase tracking-wider">Final</span>
          ) : isLive ? (
            <span className="flex items-center gap-1 text-[10px] font-jbmono max-lg:font-plex font-bold text-pastel-orange max-lg:text-pressbox-orange uppercase tracking-wider">
              <LivePulse size="xs" /> Live
            </span>
          ) : locked ? (
            <span className="flex items-center gap-0.5 text-[10px] font-jbmono max-lg:font-plex text-white/55"><Lock className="w-2.5 h-2.5" aria-hidden="true" /> Locked</span>
          ) : (
            <span className="text-xs font-jbmono max-lg:font-plex font-bold text-pastel-cream max-lg:text-pressbox-text tabular-nums">{fmtTime(game)}</span>
          )}
        </div>

        {/* Row 2: H2H */}
        <div className="text-[9px] font-jbmono max-lg:font-plex text-white/55 mt-0.5">
          {h2hGames > 0 ? (
            <span>
              H2H:{' '}
              <span className="font-bold" style={{ color: awayH2HWins > homeH2HWins ? away.primaryColor : 'rgba(255,255,255,0.35)' }}>{awayH2HWins}</span>
              {'-'}
              <span className="font-bold" style={{ color: homeH2HWins > awayH2HWins ? home.primaryColor : 'rgba(255,255,255,0.35)' }}>{homeH2HWins}</span>
            </span>
          ) : (
            <span className="text-pastel-orange-soft max-lg:text-pressbox-orange-soft"><span className="max-lg:hidden">★ 1st meeting</span><span className="lg:hidden">1ST MTG</span></span>
          )}
        </div>

        {/* Row 3: Venue -- from lg; the phone's centre column is 64px wide. */}
        {game.venue && (
          <div className="max-lg:hidden text-[8px] font-jbmono max-lg:font-plex text-white/55 mt-0.5 truncate max-w-full">
            {game.venue}
          </div>
        )}

        {/* Row 4: Home ice -- from lg; the phone row already reads away at home. */}
        {!isFinal && (
          <div className="max-lg:hidden text-[9px] font-jbmono max-lg:font-plex text-white/55 mt-0.5">
            @ {home.fullName}
          </div>
        )}
      </div>

      {/* ═══ COLUMN 3: HOME TEAM ═══ */}
      <button
        className={`flex items-center gap-1.5 py-2.5 pr-2 pl-1.5 transition-all flex-row-reverse ${
          locked ? 'cursor-default' : 'cursor-pointer'
        } ${pickedHome ? '' : picked ? 'opacity-30' : ''}`}
        style={{
          borderRight: `3px solid ${home.primaryColor}`,
          background: pickedHome ? `${home.primaryColor}25` : undefined,
        }}
        onMouseEnter={(e) => { if (!locked && !pickedHome) e.currentTarget.style.background = `${home.primaryColor}12`; }}
        onMouseLeave={(e) => { if (!locked && !pickedHome) e.currentTarget.style.background = ''; }}
        onClick={() => !locked && onPick(gid, game.home_team)}
        disabled={!!locked}
      >
        <PressBoxTeamMark abbrev={game.home_team} size="md" label={home.fullName} className="lg:hidden" />
        <div className="max-lg:hidden w-8 h-8 rounded-full flex items-center justify-center font-bold text-white text-[9px] shrink-0 shadow-sm"
          style={{ background: home.primaryColor, color: onTeamColor(home.primaryColor) }}>
          {game.home_team}
        </div>
        <div className="flex-1 text-left min-w-0">
          <div className={`font-bold text-xs truncate ${homeWon ? 'text-pastel-cream max-lg:text-pressbox-text' : isFinal ? 'text-white/55' : 'text-pastel-cream max-lg:text-pressbox-text'}`}>
            {home.name}
          </div>
          <div className="text-[10px] font-jbmono max-lg:font-plex text-white/55 truncate">
            {hr ? `${hr.w}-${hr.l}-${hr.otl}` : ''}
            {homeStreak && homeStreak !== '-' ? ` ${homeStreak}` : ''}
          </div>
        </div>
        {!isFinal && !isLive && ar && hr && (
          <div className={`font-bold text-base leading-none shrink-0 tabular-nums ${homePct >= 50 ? 'text-pastel-sage-soft' : 'text-white/55'}`}>
            {homePct}%
          </div>
        )}
        {isFinal && (
          <span className={`font-bold text-lg shrink-0 tabular-nums ${homeWon ? 'text-pastel-cream max-lg:text-pressbox-text' : 'text-white/55'}`}>{game.home_score}</span>
        )}
        {isLive && <span className="font-bold text-lg shrink-0 text-pastel-orange max-lg:text-pressbox-orange tabular-nums">{game.home_score}</span>}
        {pickedHome && !isFinal && !isLive && (
          <div className="w-4 h-4 rounded-full flex items-center justify-center shrink-0" style={{ background: home.primaryColor, color: onTeamColor(home.primaryColor) }}>
            <Check className="w-2.5 h-2.5 text-white" aria-hidden="true" />
          </div>
        )}
        {existingPick?.picked_team === game.home_team && existingPick.is_correct === true && <CheckCircle2 className="w-4 h-4 text-pastel-sage max-lg:text-pressbox-sage shrink-0" aria-hidden="true" />}
        {existingPick?.picked_team === game.home_team && existingPick.is_correct === false && <XCircle className="w-4 h-4 text-red-400 shrink-0" aria-hidden="true" />}
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
  const [records, setRecords] = useState<Record<string, { w: number; l: number; otl: number; streak?: string }>>({});
  const [h2hData, setH2hData] = useState<Map<string, { awayWins: number; homeWins: number; games: number }>>(new Map());
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
        const [wg, up, sd] = await Promise.all([
          PoolService.getWeekGames(currentWeek),
          PoolService.getPickemPicks(activeLeagueId, user.id, currentWeek),
          PoolService.getPickemStandings(activeLeagueId),
        ]);
        setGames(wg || []); setExistingPicks(up); setStandings(sd);
        const pm = new Map<string, string>();
        up.forEach(p => pm.set(p.game_id, p.picked_team));
        setPicks(pm);

        // Fetch records from server API (one call, no downloading 1300+ games)
        // Fetch records + H2H in ONE call
        try {
          const { records: tr, h2h: h2hRaw } = await PoolService.getTeamRecordsAndH2H(currentWeek);
          setRecords(tr);
          const h2hMap = new Map<string, { awayWins: number; homeWins: number; games: number }>();
          for (const [key, val] of Object.entries(h2hRaw)) {
            h2hMap.set(key, val);
          }
          setH2hData(h2hMap);
        } catch { /* records + h2h are supplementary */ }
      } catch (err) { logger.error('[PoolPickem]', err); }
      finally { setLoading(false); }
    };
    loadData();
  }, [activeLeagueId, user, currentWeek]);

  const handlePick = (gid: string, team: string) => {
    const m = new Map(picks);
    if (m.get(gid) === team) { m.delete(gid); } else { m.set(gid, team); }
    setPicks(m);
  };

  const handleSubmit = async () => {
    if (!activeLeagueId || !user) return;
    setSubmitting(true);
    try {
      const arr = Array.from(picks.entries()).map(([game_id, picked_team]) => ({ game_id, picked_team }));
      const r = await PoolService.submitPickemPicks(activeLeagueId, user.id, currentWeek, arr);
      if (r.success) {
        toast({ title: 'Picks Saved!', description: `${arr.length} picks submitted.` });
      } else {
        toast({ title: "Picks Didn't Submit", description: r.error || "Couldn't submit your picks. Try again in a moment.", variant: 'destructive' });
      }
    } catch { toast({ title: "Picks Didn't Submit", description: "Couldn't reach the pool server. Try again in a moment.", variant: 'destructive' }); }
    finally { setSubmitting(false); }
  };

  if (loading) return (
    <DarkLayout>
      <div className="hidden lg:block"><Navbar /></div>
      <PressBoxPageLoading kind="list" message="Loading Pick'em Pool..." />
    </DarkLayout>
  );

  const byDate = groupByDate(games);
  const ls = (activeLeague?.settings as Record<string, unknown>) || {};
  const ppw = (ls.picksPerWeek as number) || 0;
  const required = ppw > 0 ? Math.min(ppw, games.length) : games.length;
  const pct = required > 0 ? Math.min((picks.size / required) * 100, 100) : 0;

  return (
    <DarkLayout>
      {/* PRESS BOX (2026-09-05): the league chrome on the phone -- crest,
          name, `‹ WK 48 ›` from the header's own chevrons -- and the
          desktop's Navbar from `lg`. The pool has no Match/Team/Players/
          League axis, so the sub-tab strip is off and the page's own
          Picks / Standings / League strip follows the hero. */}
      <div className="hidden lg:block"><Navbar /></div>
      <PressBoxLeagueChrome
        showSubTabs={false}
        weekLabel={`WK ${currentWeek}`}
        onWeekPrev={currentWeek > 1 ? () => setCurrentWeek((w) => Math.max(1, w - 1)) : null}
        onWeekNext={() => setCurrentWeek((w) => w + 1)}
      />

      <main className={cn(PB_TYPE, 'w-full max-lg:pt-0 pt-20 lg:pt-24 lg:pb-8 pb-app-chrome max-lg:font-barlow')}>
        <div className="flex lg:gap-0">
        {/* Main picks column — centered with padding */}
        <div className="flex-1 min-w-0 px-3 sm:px-4 lg:px-8 xl:px-12">
          {userLeagueState === 'logged-in-no-league' && (
            <div className="mb-8">
              <LeagueCreationCTA title="Join a Pick'em Pool" description="Predict NHL game winners each week." />
            </div>
          )}

          {/* Hero banner — mascot acting in domain */}
          <div className="relative mb-6 max-lg:mb-3 mt-4 max-lg:mt-3 w-full aspect-[21/9] sm:aspect-[24/9] rounded-2xl max-lg:rounded-[12px] overflow-hidden ring-1 ring-white/10 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.5)]">
            <img
              src="/mascots/scene-pickem.webp"
              alt="Lemon picking between two NHL teams"
              className="w-full h-full object-cover"
              loading="eager"
            />
            <div
              aria-hidden="true"
              className="absolute inset-0 pointer-events-none"
              style={{ background: 'linear-gradient(to top, rgba(15,31,21,0.85) 0%, transparent 45%)' }}
            />
            <div className="absolute bottom-4 left-5 sm:bottom-6 sm:left-8 z-10 max-w-[80%]">
              <div className="font-jbmono max-lg:font-plex text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft max-lg:text-pressbox-orange-soft mb-1.5 font-bold flex items-center gap-2">
                <PickemIcon className="w-3 h-3" /> Daily Pickem
              </div>
              <h1 className="font-sans max-lg:font-condensed font-black max-lg:font-bold max-lg:uppercase max-lg:tracking-[0.02em] text-[1.5rem] max-lg:text-[22px] sm:text-[2rem] md:text-[2.5rem] tracking-[-0.025em] text-pastel-cream max-lg:text-pressbox-text leading-tight drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">
                Pick the winners. <span className="text-pastel-orange max-lg:text-pressbox-orange">Stack the points.</span>
              </h1>
            </div>
          </div>

          {/* Header — STICKY below navbar */}
          {/* The phone's strip: Picks / Standings / League as the Press Box
              underline tabs. The week lives in the header above. */}
          <PressBoxTabs
            className="lg:hidden mb-3"
            label="Pool view"
            fill
            activeKey={activeTab}
            onSelect={setActiveTab}
            tabs={[
              { key: 'picks', label: `Picks · ${picks.size}/${required}` },
              { key: 'standings', label: 'Standings' },
              { key: 'league', label: 'League' },
            ]}
          />
          <div className="max-lg:hidden sticky top-[92px] z-section-header bg-[#0F1F15]/95 max-lg:bg-pressbox-surface/95 backdrop-blur-md py-2 sm:py-3 mb-4 -mx-3 sm:-mx-4 lg:-mx-8 xl:-mx-12 px-3 sm:px-4 lg:px-8 xl:px-12 border-b border-white/5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="flex items-center bg-[#1A2A20] max-lg:bg-pressbox-tile rounded-md ring-1 ring-white/10 overflow-hidden">
                <Button variant="ghost" size="icon" aria-label="Previous week" className="h-8 w-8 sm:h-10 sm:w-10 rounded-none text-pastel-cream max-lg:text-pressbox-text hover:text-pastel-orange hover:max-lg:text-pressbox-orange hover:bg-white/5" onClick={() => setCurrentWeek(w => Math.max(1, w - 1))} disabled={currentWeek <= 1}>
                  <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                </Button>
                <div className="px-2 sm:px-3 text-center border-x border-white/10">
                  <div className="text-[8px] sm:text-[9px] font-jbmono max-lg:font-plex text-white/55 uppercase tracking-widest leading-none">Week</div>
                  <div className="text-base sm:text-lg font-bold text-pastel-cream max-lg:text-pressbox-text leading-none tabular-nums">{currentWeek}</div>
                </div>
                <Button variant="ghost" size="icon" aria-label="Next week" className="h-8 w-8 sm:h-10 sm:w-10 rounded-none text-pastel-cream max-lg:text-pressbox-text hover:text-pastel-orange hover:max-lg:text-pressbox-orange hover:bg-white/5" onClick={() => setCurrentWeek(w => w + 1)}>
                  <ChevronRight className="w-4 h-4" aria-hidden="true" />
                </Button>
              </div>

              {/* Progress pill */}
              <div className="hidden sm:flex items-center gap-2 bg-[#1A2A20] max-lg:bg-pressbox-tile rounded-full px-3 py-1.5 ring-1 ring-white/10">
                <div className="w-16 h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full bg-pastel-orange max-lg:bg-pressbox-orange rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-xs font-bold text-pastel-cream max-lg:text-pressbox-text tabular-nums">{picks.size}/{required}</span>
              </div>
            </div>

            <div className="flex items-center gap-1 sm:gap-2">
              {activeLeague?.join_code && (
                <span className="hidden sm:inline-flex"><InvitePlayersButton joinCode={activeLeague.join_code} leagueName={activeLeague.name} /></span>
              )}
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="bg-[#1A2A20] max-lg:bg-pressbox-tile h-8 sm:h-9 ring-1 ring-white/10">
                  <TabsTrigger value="picks" className="text-xs sm:text-sm px-2 sm:px-3 data-[state=active]:bg-pastel-orange data-[state=active]:max-lg:bg-pressbox-orange data-[state=active]:text-[#581E00] data-[state=active]:max-lg:text-pressbox-orange-ink text-white/70">Picks</TabsTrigger>
                  <TabsTrigger value="standings" className="text-xs sm:text-sm px-2 sm:px-3 data-[state=active]:bg-pastel-orange data-[state=active]:max-lg:bg-pressbox-orange data-[state=active]:text-[#581E00] data-[state=active]:max-lg:text-pressbox-orange-ink text-white/70">Standings</TabsTrigger>
                  <TabsTrigger value="league" className="text-xs sm:text-sm px-2 sm:px-3 data-[state=active]:bg-pastel-orange data-[state=active]:max-lg:bg-pressbox-orange data-[state=active]:text-[#581E00] data-[state=active]:max-lg:text-pressbox-orange-ink text-white/70">League</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>
          </div>

          {/* ── Picks ── */}
          {activeTab === 'picks' && (
            <>
              {games.length === 0 ? (
                <GlowCard accent="orange">
                  <div className="py-16 text-center">
                    <PickemIcon className="w-12 h-12 mx-auto mb-4 text-pastel-orange-soft/60 max-lg:text-pressbox-orange-soft/60" />
                    <div className="font-jbmono max-lg:font-plex text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft max-lg:text-pressbox-orange-soft font-bold mb-2">
                      ✦ Between slates
                    </div>
                    <p className="font-bold text-lg text-pastel-cream max-lg:text-pressbox-text">The board is dark tonight.</p>
                    <p className="text-[13px] text-white/55 mt-1 max-w-sm mx-auto">This week's slate hasn't dropped yet. Swing back Wednesday for lock-in.</p>
                  </div>
                </GlowCard>
              ) : (
                <div className="space-y-6">
                  {Array.from(byDate.entries()).map(([dateKey, dateGames]) => (
                    <div key={dateKey}>
                      {/* Date header */}
                      <div className="flex items-center gap-2 mb-2 px-1">
                        <Calendar className="w-3.5 h-3.5 text-pastel-orange-soft max-lg:text-pressbox-orange-soft" aria-hidden="true" />
                        <span className="text-xs font-jbmono max-lg:font-plex font-bold text-pastel-orange-soft max-lg:text-pressbox-orange-soft uppercase tracking-[0.22em]">
                          {fmtDate(dateKey)}
                        </span>
                        <div className="flex-1 h-px bg-white/10" />
                        <span className="text-[10px] font-jbmono max-lg:font-plex text-white/55 tabular-nums">{dateGames.length} games</span>
                      </div>

                      {/* Game rows — 2 columns on xl to reduce empty space */}
                      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-1.5">
                        {dateGames.map(game => (
                          <MatchupRow
                            key={String(game.id)}
                            game={game}
                            picked={picks.get(String(game.id))}
                            existingPick={existingPicks.find(p => p.game_id === String(game.id))}
                            onPick={handlePick}
                            records={records}
                            h2hData={h2hData}
                          />
                        ))}
                      </div>
                    </div>
                  ))}

                  {/* Submit bar */}
                  <div className="sticky bottom-20 lg:bottom-4 bg-[#1A2A20]/95 max-lg:bg-pressbox-tile/95 backdrop-blur-md ring-1 ring-pastel-orange/30 max-lg:ring-pressbox-orange/30 rounded-2xl max-lg:rounded-[12px] py-3 px-4 flex items-center justify-between shadow-[0_24px_60px_-20px_rgba(255,107,26,0.4)]">
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-2 rounded-full bg-white/10 overflow-hidden">
                        <div className="h-full bg-pastel-orange max-lg:bg-pressbox-orange rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-sm text-pastel-cream max-lg:text-pressbox-text font-bold">
                        {picks.size === 0 ? 'Tap a team' : `${picks.size}/${required} picked`}
                      </span>
                    </div>
                    <Button onClick={handleSubmit} disabled={picks.size === 0 || submitting} size="lg" className="font-bold uppercase tracking-wider bg-pastel-orange max-lg:bg-pressbox-orange hover:bg-pastel-orange-soft hover:max-lg:bg-pressbox-orange-soft text-white border-0 active:scale-95 transition-all">
                      {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />}
                      Submit
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── Standings ── */}
          {activeTab === 'standings' && (
            <GlowCard accent="orange">
              <div>
                {standings.length === 0 ? (
                  <div className="text-center py-16">
                    <PickemIcon className="w-12 h-12 mx-auto mb-4 text-pastel-orange-soft/60 max-lg:text-pressbox-orange-soft/60" />
                    <div className="font-jbmono max-lg:font-plex text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft max-lg:text-pressbox-orange-soft font-bold mb-2">
                      ✦ Awaiting the first whistle
                    </div>
                    <p className="font-bold text-pastel-cream max-lg:text-pressbox-text text-base">Standings light up after week 1 wraps.</p>
                    <p className="text-[13px] text-white/55 mt-1 max-w-sm mx-auto">Get your picks in first. Every game counts.</p>
                    <button
                      type="button"
                      onClick={() => setActiveTab('picks')}
                      className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-pastel-orange max-lg:bg-pressbox-orange text-[#581E00] max-lg:text-pressbox-orange-ink text-sm font-bold hover:bg-pastel-orange-soft hover:max-lg:bg-pressbox-orange-soft transition-colors"
                    >
                      Make picks →
                    </button>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-black/20 border-white/10 hover:bg-black/20">
                          <TableHead className="w-12 text-center text-pastel-orange-soft max-lg:text-pressbox-orange-soft font-jbmono max-lg:font-plex uppercase text-[10px] tracking-wider">#</TableHead>
                          <TableHead className="text-pastel-orange-soft max-lg:text-pressbox-orange-soft font-jbmono max-lg:font-plex uppercase text-[10px] tracking-wider">Player</TableHead>
                          <TableHead className="text-center text-pastel-orange-soft max-lg:text-pressbox-orange-soft font-jbmono max-lg:font-plex uppercase text-[10px] tracking-wider">Correct</TableHead>
                          <TableHead className="text-center hidden sm:table-cell text-pastel-orange-soft max-lg:text-pressbox-orange-soft font-jbmono max-lg:font-plex uppercase text-[10px] tracking-wider">Total</TableHead>
                          <TableHead className="text-right text-pastel-orange-soft max-lg:text-pressbox-orange-soft font-jbmono max-lg:font-plex uppercase text-[10px] tracking-wider">Pct</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {standings.map((s, i) => (
                          <TableRow key={s.user_id} className={`border-white/5 hover:bg-white/5 transition-colors ${s.user_id === user?.id ? 'bg-pastel-orange/10 max-lg:bg-pressbox-orange/10' : ''}`}>
                            <TableCell className="text-center">
                              <span className={`inline-flex w-7 h-7 rounded-full items-center justify-center text-xs font-bold ${
                                i === 0 ? 'bg-pastel-orange max-lg:bg-pressbox-orange text-[#581E00] max-lg:text-pressbox-orange-ink' :
                                i === 1 ? 'bg-white/20 text-pastel-cream max-lg:text-pressbox-text' :
                                i === 2 ? 'bg-pastel-orange/40 max-lg:bg-pressbox-orange/40 text-white' :
                                'text-white/55'
                              }`}>{i + 1}</span>
                            </TableCell>
                            <TableCell className="font-bold text-pastel-cream max-lg:text-pressbox-text">
                              {s.display_name}
                              {s.user_id === user?.id && <Badge variant="outline" className="ml-2 text-[9px] font-jbmono max-lg:font-plex uppercase tracking-wider border-pastel-orange max-lg:border-pressbox-orange text-pastel-orange-soft max-lg:text-pressbox-orange-soft">YOU</Badge>}
                            </TableCell>
                            <TableCell className="text-center font-bold text-pastel-cream max-lg:text-pressbox-text tabular-nums">{s.correct_picks}</TableCell>
                            <TableCell className="text-center text-white/55 hidden sm:table-cell tabular-nums">{s.total_picks}</TableCell>
                            <TableCell className="text-right font-bold text-pastel-orange-soft max-lg:text-pressbox-orange-soft tabular-nums">{s.accuracy.toFixed(1)}%</TableCell>
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

export default PoolPickem;
