/**
 * Public NHL Stanley Cup Playoff Bracket viewer.
 * No auth required — drives top-of-funnel awareness and signups.
 * Subscribes to live updates via Supabase realtime broadcasts.
 *
 * Migrated to citrus2 dark forest design system. Live API logic unchanged.
 */

import { useEffect, useState } from 'react';
import Navbar from '@/components/Navbar';
import { Link } from 'react-router-dom';
import { Trophy, Clock, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NHL_TEAMS } from '@/types/captracker';
import {
  DarkLayout,
  HockeyFooter,
  TeamColorBar,
  LivePulse,
  CtaBanner,
  MascotPeek,
  StormyLoading,
} from '@/components/citrus2';

interface Seed {
  team_id: number;
  team_abbrev: string | null;
  conference: string;
  division: string;
  seed: number;
  wins?: number;
  losses?: number;
  ot_losses?: number;
  points?: number;
}

interface Series {
  series_id: string;
  round: number;
  conference: string | null;
  bracket_slot: number;
  high_seed_team_id: number | null;
  low_seed_team_id: number | null;
  high_seed_wins: number;
  low_seed_wins: number;
  winner_team_id: number | null;
  games_played: number;
  series_status: 'pending' | 'active' | 'final';
}

const ROUND_NAMES: Record<number, string> = {
  1: 'First Round',
  2: 'Second Round',
  3: 'Conference Finals',
  4: 'Stanley Cup Final',
};

export default function NHLPlayoffBracket() {
  const [season] = useState<number>(2025);
  const [seeds, setSeeds] = useState<Seed[]>([]);
  const [series, setSeries] = useState<Series[]>([]);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<{ oldest_refresh: string | null } | null>(null);
  const [h2hMap, setH2hMap] = useState<Record<number, { high_wins: number; low_wins: number; games: number }>>({});

  useEffect(() => {
    const load = async () => {
      try {
        const [bracketRes, metaRes, h2hRes] = await Promise.all([
          fetch(`/api/nhl-playoffs/bracket?season=${season}`),
          fetch('/api/nhl-playoffs/meta'),
          fetch(`/api/nhl-playoffs/h2h?season=${season}`).catch(() => null),
        ]);
        const bracket = await bracketRes.json();
        const metaData = await metaRes.json();
        const h2hData = h2hRes ? await h2hRes.json().catch(() => null) : null;
        setSeeds(bracket.data?.seeds || bracket.seeds || []);
        setSeries(bracket.data?.series || bracket.series || []);
        setMeta(metaData.data || metaData);
        if (h2hData?.data?.h2h) setH2hMap(h2hData.data.h2h);
        else if (h2hData?.h2h) setH2hMap(h2hData.h2h);
      } finally {
        setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 60000); // refresh every 60s
    return () => clearInterval(interval);
  }, [season]);

  const teamById = new Map(seeds.map((s) => [s.team_id, s]));
  const seriesByRound: Record<number, Series[]> = { 1: [], 2: [], 3: [], 4: [] };
  series.forEach((s) => seriesByRound[s.round]?.push(s));

  const lastRefresh = meta?.oldest_refresh ? new Date(meta.oldest_refresh) : null;
  const refreshAgo = lastRefresh
    ? `${Math.max(1, Math.round((Date.now() - lastRefresh.getTime()) / 1000))}s`
    : '60s';

  if (loading) {
    return (
      <DarkLayout>
        <Navbar />
        <StormyLoading message="Loading the playoff bracket..." />
      </DarkLayout>
    );
  }

  return (
    <DarkLayout>


      <Navbar />
      <main className="relative max-w-[1280px] mx-auto px-6 pt-24 pb-16">
        {/* Hero — Pineapple lifting the Cup scene banner */}
        <div className="relative mb-8 w-full aspect-[21/9] sm:aspect-[24/9] rounded-2xl overflow-hidden ring-1 ring-white/10 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.5)]">
          <img
            src="/mascots/scene-cup.webp"
            alt="Pineapple lifting the Stanley Cup with arena spotlight"
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
              <LivePulse size="xs" /> Stanley Cup Playoffs
            </div>
            <h1 className="font-sans font-black text-[1.5rem] sm:text-[2rem] md:text-[2.5rem] tracking-[-0.025em] text-pastel-cream leading-tight drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">
              Lift the <span className="text-pastel-orange">Cup</span>.
            </h1>
          </div>
        </div>

        {/* Hero text — refresh status under the banner */}
        <div className="text-center mb-10">
          <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft mb-3 font-bold flex items-center justify-center gap-2">
            <LivePulse size="xs" />
            Live · Updated {refreshAgo} ago
          </div>
          <div className="flex items-center justify-center gap-3 mb-3">
            <Trophy className="w-9 h-9 text-pastel-orange" strokeWidth={2} />
            <h1 className="font-sans font-black text-[2.5rem] md:text-[3.5rem] tracking-[-0.03em] text-pastel-cream leading-none">
              Stanley Cup Playoffs
            </h1>
          </div>
          <p className="font-jbmono text-[11px] tracking-[0.22em] uppercase text-white/45">
            {season}–{(season + 1).toString().slice(2)} · Best of 7 · 4 Rounds
          </p>
        </div>

        {/* Inline pool CTA — with Pineapple peeking (he presides over the playoffs) */}
        <div className="group relative mb-10 bg-pastel-surface-tile border border-pastel-orange/30 rounded-2xl p-5 flex items-center justify-between gap-4 flex-wrap overflow-hidden hover:border-pastel-orange/60 transition-colors duration-300">
          <MascotPeek id="pineapple" position="top-right" size="sm" />
          <div className="relative z-10">
            <div className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-orange-soft mb-1 font-bold">
              Build your pool
            </div>
            <h2 className="font-sans font-bold text-[18px] text-pastel-cream">
              Pick your bracket. Win bragging rights.
            </h2>
            <p className="text-[13px] text-white/55 mt-1">
              Free playoff pools. Confidence-weighted scoring. Built into Citrus.
            </p>
          </div>
          <div className="relative z-10 flex items-center gap-2">
            <Link
              to="/create-league?type=playoff"
              className="inline-flex items-center gap-2 bg-pastel-orange text-white text-[14px] font-bold px-5 h-11 rounded-md hover:bg-pastel-orange-deep hover:-translate-y-0.5 active:scale-95 transition-all duration-200 shadow-[0_4px_16px_-4px_rgba(255,107,26,0.4)]"
            >
              Create Pool <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
            </Link>
            <Link
              to="/create-league?tab=join"
              className="inline-flex items-center text-[13px] font-bold text-pastel-cream hover:text-pastel-orange-soft transition-colors px-4 h-11 rounded-md ring-1 ring-white/15 hover:ring-white/30"
            >
              Join Pool
            </Link>
          </div>
        </div>

        {/* Bracket — round-by-round */}
        <div className="space-y-8">
          {[1, 2, 3, 4].map((round) => {
            const roundSeries = seriesByRound[round] || [];
            if (roundSeries.length === 0) return null;
            return (
              <section key={round}>
                <h3 className="font-jbmono text-[11px] tracking-[0.32em] uppercase text-pastel-orange-soft mb-3 px-1 font-bold">
                  ✦ {ROUND_NAMES[round]}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                  {roundSeries.map((s) => {
                    const high = s.high_seed_team_id ? teamById.get(s.high_seed_team_id) : null;
                    const low = s.low_seed_team_id ? teamById.get(s.low_seed_team_id) : null;
                    const highInfo = high ? NHL_TEAMS.find((t) => t.abbrev === high.team_abbrev) : null;
                    const lowInfo = low ? NHL_TEAMS.find((t) => t.abbrev === low.team_abbrev) : null;
                    const isFinal = s.series_status === 'final';
                    const isActive = s.series_status === 'active';
                    const h2h = h2hMap[s.bracket_slot];

                    return (
                      <article
                        key={s.series_id}
                        className={cn(
                          'bg-pastel-surface-tile border rounded-2xl p-4 transition-all duration-300 hover:-translate-y-0.5',
                          isActive
                            ? 'hover:shadow-[0_16px_40px_-12px_rgba(255,107,26,0.4)]'
                            : isFinal
                            ? 'hover:shadow-[0_16px_40px_-12px_rgba(132,165,125,0.3)]'
                            : 'hover:shadow-[0_16px_40px_-12px_rgba(255,255,255,0.1)]',
                          isActive
                            ? 'border-pastel-orange/40'
                            : isFinal
                            ? 'border-pastel-sage/30'
                            : 'border-white/10',
                        )}
                      >
                        {/* Header */}
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-1.5">
                            <span className="font-jbmono text-[9px] uppercase text-white/45 tracking-wider font-bold">
                              Series {String.fromCharCode(64 + s.bracket_slot)}
                            </span>
                            {s.conference && (
                              <span
                                className={cn(
                                  'font-jbmono text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded',
                                  s.conference === 'Eastern'
                                    ? 'bg-pastel-sage/15 text-pastel-sage-soft'
                                    : 'bg-pastel-orange/15 text-pastel-orange-soft',
                                )}
                              >
                                {s.conference === 'Eastern' ? 'EAST' : 'WEST'}
                              </span>
                            )}
                          </div>
                          {isActive && (
                            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-pastel-orange/15 ring-1 ring-pastel-orange/30">
                              <LivePulse size="xs" />
                              <span className="font-jbmono text-[9px] uppercase tracking-wider text-pastel-orange-soft font-bold leading-none">
                                Live
                              </span>
                            </span>
                          )}
                          {isFinal && (
                            <span className="font-jbmono text-[9px] uppercase tracking-wider text-pastel-sage-soft font-bold px-1.5 py-0.5 rounded bg-pastel-sage/15">
                              Final
                            </span>
                          )}
                        </div>

                        {/* Teams */}
                        <BracketTeamRow team={high} info={highInfo} wins={s.high_seed_wins} isWinner={isFinal && high?.team_id === s.winner_team_id} />
                        <div className="h-1" />
                        <BracketTeamRow team={low} info={lowInfo} wins={s.low_seed_wins} isWinner={isFinal && low?.team_id === s.winner_team_id} />

                        {/* Season H2H */}
                        {h2h && h2h.games > 0 && high && low && (
                          <div className="mt-3 pt-2 border-t border-white/10 flex items-center justify-center gap-2 font-jbmono text-[10px] text-white/45">
                            <span className="uppercase tracking-wider font-bold">Season H2H</span>
                            <span className="font-bold" style={highInfo ? { color: highInfo.primaryColor } : undefined}>
                              {high.team_abbrev} {h2h.high_wins}
                            </span>
                            <span className="text-white/30">—</span>
                            <span className="font-bold" style={lowInfo ? { color: lowInfo.primaryColor } : undefined}>
                              {h2h.low_wins} {low.team_abbrev}
                            </span>
                          </div>
                        )}

                        {/* Game count */}
                        {s.games_played > 0 && (
                          <div className="font-jbmono text-[10px] text-white/45 mt-2 text-center flex items-center justify-center gap-1">
                            <Clock className="w-3 h-3" />
                            {s.games_played} of 7 games played
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        {series.length === 0 && (
          <div className="text-center py-16">
            <Trophy className="w-12 h-12 text-white/20 mx-auto mb-3" />
            <p className="font-jbmono text-[12px] uppercase tracking-wider text-white/45">
              Bracket not yet finalized. Check back when seeds are set.
            </p>
          </div>
        )}
      </main>

      <CtaBanner
        eyebrow="🏒 Playoffs · Live now"
        eyebrowPulse
        title={
          <>
            Lift the <span className="text-pastel-orange">Cup</span>.
          </>
        }
        sub="Free during launch · Confidence-weighted scoring · Bragging rights for life"
        ctaLabel="Build Your Bracket"
        ctaHref="/create-league?type=playoff"
      />

      <HockeyFooter />
    </DarkLayout>
  );
}

// Bracket team row — uses real NHL team color for the side accent + monogram
function BracketTeamRow({
  team,
  info,
  wins,
  isWinner,
}: {
  team: Seed | null;
  info: typeof NHL_TEAMS[0] | null | undefined;
  wins: number;
  isWinner: boolean;
}) {
  if (!team) {
    return (
      <div className="flex items-center gap-2 py-2 px-2 rounded">
        <span className="text-white/30 italic text-xs font-jbmono">TBD</span>
      </div>
    );
  }
  return (
    <div
      className={cn(
        'relative flex items-center gap-2 py-2 px-2 rounded overflow-hidden ring-1',
        isWinner ? 'bg-white/[0.05] ring-white/15' : 'ring-transparent',
      )}
    >
      {info && <TeamColorBar abbrev={info.abbrev} className="!h-full !w-1" />}
      <div
        className="w-8 h-8 rounded flex items-center justify-center text-[9px] font-jbmono font-black text-white flex-shrink-0"
        style={{ background: info?.primaryColor || '#6b7280' }}
      >
        {team.team_abbrev}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="font-jbmono text-[10px] text-white/45 tabular-nums">#{team.seed}</span>
          <span className={cn('text-xs font-sans font-bold truncate', isWinner ? 'text-pastel-cream' : 'text-white/70')}>
            {info?.name || team.team_abbrev}
          </span>
        </div>
        {team.wins != null && (
          <div className="font-jbmono text-[9px] text-white/45 truncate tabular-nums">
            {team.wins}-{team.losses}-{team.ot_losses} · {team.points}pts
          </div>
        )}
      </div>
      <span
        className={cn(
          'font-sans font-black text-lg flex-shrink-0 tabular-nums',
          wins >= 4 ? 'text-pastel-orange' : 'text-white/55',
        )}
      >
        {wins}
      </span>
    </div>
  );
}
