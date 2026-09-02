import { Link } from 'react-router-dom';
import { ArrowRight, TrendingUp, Zap, Activity, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

const MAX_PROJECTION = 18;

const PLAYERS = [
  { initials: 'CM', name: 'Connor McDavid', team: 'EDM', position: 'C', floor: 6.7, median: 9.4, ceiling: 12.1, std: 2.1 },
  { initials: 'AM', name: 'Auston Matthews', team: 'TOR', position: 'C', floor: 6.3, median: 8.7, ceiling: 11.1, std: 1.9 },
  { initials: 'NM', name: 'Nathan MacKinnon', team: 'COL', position: 'C', floor: 6.0, median: 8.6, ceiling: 11.2, std: 2.0 },
  { initials: 'LD', name: 'Leon Draisaitl', team: 'EDM', position: 'C', floor: 5.9, median: 8.1, ceiling: 10.3, std: 1.7 },
  { initials: 'CM', name: 'Cale Makar', team: 'COL', position: 'D', floor: 5.2, median: 7.2, ceiling: 9.2, std: 1.6 },
  { initials: 'IS', name: 'Igor Shesterkin', team: 'NYR', position: 'G', floor: 8.4, median: 12.4, ceiling: 16.4, std: 3.1 },
];

const NAV_LINKS = ['Scores', 'Rankings', 'Insights', 'Strategy'];

type GameStatus = 'LIVE' | 'FINAL' | 'SCHEDULED';
type TickerGame = {
  status: GameStatus;
  away: string;
  home: string;
  awayScore?: number;
  homeScore?: number;
  period?: string;
  time?: string;
};

const TICKER_GAMES: TickerGame[] = [
  { status: 'LIVE', away: 'EDM', home: 'COL', awayScore: 4, homeScore: 3, period: '3rd', time: '12:43' },
  { status: 'LIVE', away: 'TOR', home: 'MTL', awayScore: 2, homeScore: 1, period: '2nd', time: '08:21' },
  { status: 'LIVE', away: 'BOS', home: 'NYR', awayScore: 1, homeScore: 1, period: '1st', time: '14:02' },
  { status: 'FINAL', away: 'VAN', home: 'CGY', awayScore: 5, homeScore: 2 },
  { status: 'FINAL', away: 'WPG', home: 'MIN', awayScore: 3, homeScore: 4 },
  { status: 'SCHEDULED', away: 'CHI', home: 'DET', time: '7:00 PM' },
  { status: 'SCHEDULED', away: 'PIT', home: 'PHI', time: '7:30 PM' },
  { status: 'SCHEDULED', away: 'LAK', home: 'SJS', time: '10:00 PM' },
  { status: 'SCHEDULED', away: 'TBL', home: 'FLA', time: '7:00 PM' },
  { status: 'SCHEDULED', away: 'DAL', home: 'NSH', time: '8:00 PM' },
];

function useCountUp(target: number, duration = 1600) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let start: number | null = null;
    let raf = 0;
    const step = (ts: number) => {
      if (start === null) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(target * eased);
      if (progress < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

function GameTickerCard({ game }: { game: TickerGame }) {
  const isLive = game.status === 'LIVE';
  const isFinal = game.status === 'FINAL';
  return (
    <div className="inline-flex items-center gap-3 px-5 h-9 border-r border-white/10 flex-shrink-0">
      {isLive && (
        <span className="flex items-center gap-1.5">
          <span className="relative flex w-1.5 h-1.5">
            <span className="absolute inline-flex w-full h-full bg-pastel-orange rounded-full animate-live-pulse" />
            <span className="relative inline-flex w-1.5 h-1.5 bg-pastel-orange rounded-full" />
          </span>
          <span className="font-caps text-[10px] tracking-[0.18em] text-pastel-orange-soft leading-none">LIVE</span>
        </span>
      )}
      {isFinal && (
        <span className="font-caps text-[10px] tracking-[0.18em] text-white/50 leading-none">FINAL</span>
      )}
      <span className="font-jbmono text-[11px] text-white/90 leading-none tabular-nums">
        <span className="text-white/60">{game.away}</span>
        {game.awayScore !== undefined && <span className="ml-1.5 font-semibold">{game.awayScore}</span>}
        <span className="mx-1.5 text-white/55">@</span>
        <span className="text-white/60">{game.home}</span>
        {game.homeScore !== undefined && <span className="ml-1.5 font-semibold">{game.homeScore}</span>}
      </span>
      {isLive && (
        <span className="font-jbmono text-[10px] text-white/55 leading-none tabular-nums">
          {game.period} · {game.time}
        </span>
      )}
      {!isLive && !isFinal && (
        <span className="font-jbmono text-[10px] text-white/55 leading-none">{game.time}</span>
      )}
    </div>
  );
}

function ProjectionBar({ floor, median, ceiling }: { floor: number; median: number; ceiling: number }) {
  const floorPct = (floor / MAX_PROJECTION) * 100;
  const medianPct = (median / MAX_PROJECTION) * 100;
  const ceilingPct = (ceiling / MAX_PROJECTION) * 100;
  return (
    <div className="relative w-full h-2 bg-pastel-sage-soft/40 rounded-full overflow-hidden">
      <div
        className="absolute top-0 h-full rounded-full bg-gradient-to-r from-pastel-orange-soft/70 via-pastel-orange to-pastel-orange-deep/80"
        style={{ left: `${floorPct}%`, width: `${ceilingPct - floorPct}%` }}
      />
      <div
        className="absolute -top-0.5 -bottom-0.5 w-[2px] bg-white rounded-full shadow-sm"
        style={{ left: `calc(${medianPct}% - 1px)` }}
      />
    </div>
  );
}

function PlayerRow({ player, index }: { player: (typeof PLAYERS)[number]; index: number }) {
  return (
    <div
      className={`flex items-center gap-3 px-5 py-3 transition-colors hover:bg-pastel-sage-soft/20 ${
        index % 2 === 1 ? 'bg-pastel-sage-soft/10' : ''
      }`}
    >
      <div className="w-9 h-9 rounded-full bg-pastel-sage-soft ring-1 ring-pastel-sage/40 flex items-center justify-center font-jbmono text-[10px] font-semibold text-pastel-forest flex-shrink-0">
        {player.initials}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-calistoga text-[15px] leading-tight text-pastel-forest truncate">{player.name}</div>
        <div className="flex items-center gap-1.5 mt-1">
          <span className="px-1.5 py-0 rounded bg-pastel-sage-soft text-[9px] font-jbmono uppercase tracking-wider text-pastel-forest leading-[14px]">
            {player.team}
          </span>
          <span className="px-1.5 py-0 rounded bg-pastel-cream-warm text-[9px] font-jbmono uppercase text-pastel-forest-soft leading-[14px]">
            {player.position}
          </span>
        </div>
      </div>
      <div className="hidden sm:block w-20 lg:w-24 flex-shrink-0">
        <ProjectionBar floor={player.floor} median={player.median} ceiling={player.ceiling} />
      </div>
      <div className="text-right tabular-nums w-12 flex-shrink-0">
        <div className="font-jbmono text-base font-semibold text-pastel-forest leading-none">
          {player.median.toFixed(1)}
        </div>
        <div className="font-jbmono text-[9px] text-pastel-forest-dim mt-0.5">±{player.std.toFixed(1)}</div>
      </div>
    </div>
  );
}

function StatBlock({
  value,
  label,
  icon: Icon,
}: {
  value: string;
  label: string;
  icon: LucideIcon;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/60 backdrop-blur-sm ring-1 ring-pastel-sage/30 text-pastel-orange-deep">
        <Icon className="w-4 h-4" strokeWidth={2.25} />
      </div>
      <div>
        <div className="font-caps text-[22px] tracking-wide text-pastel-forest leading-none tabular-nums">
          {value}
        </div>
        <div className="font-jbmono text-[9px] text-pastel-forest-dim tracking-[0.18em] uppercase mt-1 leading-none">
          {label}
        </div>
      </div>
    </div>
  );
}

export default function PreviewRedesign() {
  const sims = useCountUp(1247);
  const features = useCountUp(31);
  const mape = useCountUp(2.4);

  return (
    <div
      className="min-h-screen relative overflow-x-hidden"
      style={{
        background:
          'linear-gradient(135deg, #F2F4EB 0%, #E8EED9 35%, #FFF8F0 70%, #FFEDDB 100%)',
        color: '#1B3022',
      }}
    >
      {/* Hockey rink line motif — subtle SVG bg */}
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 w-full h-[640px] opacity-[0.07]"
        viewBox="0 0 1200 640"
        preserveAspectRatio="xMidYMid slice"
      >
        <line x1="600" y1="0" x2="600" y2="640" stroke="#1B3022" strokeWidth="1.5" />
        <circle cx="600" cy="320" r="80" fill="none" stroke="#1B3022" strokeWidth="1.5" />
        <circle cx="600" cy="320" r="6" fill="#1B3022" />
        <circle cx="220" cy="180" r="42" fill="none" stroke="#1B3022" strokeWidth="1.5" />
        <circle cx="220" cy="460" r="42" fill="none" stroke="#1B3022" strokeWidth="1.5" />
        <circle cx="980" cy="180" r="42" fill="none" stroke="#1B3022" strokeWidth="1.5" />
        <circle cx="980" cy="460" r="42" fill="none" stroke="#1B3022" strokeWidth="1.5" />
        <line x1="320" y1="0" x2="320" y2="640" stroke="#1B3022" strokeWidth="1" strokeDasharray="3 5" />
        <line x1="880" y1="0" x2="880" y2="640" stroke="#1B3022" strokeWidth="1" strokeDasharray="3 5" />
      </svg>

      {/* Atmospheric glow accents */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 -right-32 w-[480px] h-[480px] rounded-full opacity-50 blur-3xl"
        style={{ background: 'radial-gradient(circle, #C8DCC4 0%, transparent 70%)' }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-1/3 -left-32 w-[400px] h-[400px] rounded-full opacity-40 blur-3xl"
        style={{ background: 'radial-gradient(circle, #FFB591 0%, transparent 70%)' }}
      />

      {/* Live game ticker — broadcast bar */}
      <div className="relative z-50 bg-pastel-forest border-b border-pastel-forest-soft/30 overflow-hidden">
        <div className="flex items-center">
          <div className="flex-shrink-0 flex items-center gap-1.5 px-4 h-9 bg-pastel-orange/95 text-white">
            <Activity className="w-3 h-3" strokeWidth={2.5} />
            <span className="font-caps text-[10px] tracking-[0.22em] leading-none">SCORES</span>
          </div>
          <div className="flex-1 overflow-hidden">
            <div className="flex animate-marquee whitespace-nowrap" style={{ width: 'max-content' }}>
              {TICKER_GAMES.map((g, i) => (
                <GameTickerCard key={`a-${i}`} game={g} />
              ))}
              {TICKER_GAMES.map((g, i) => (
                <GameTickerCard key={`b-${i}`} game={g} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Floating Liquid Glass navbar */}
      <header className="sticky top-3 z-page-header w-full px-4 md:px-6 mt-3">
        <div className="max-w-[1240px] mx-auto bg-white/65 backdrop-blur-xl border border-white/70 shadow-[0_8px_32px_-8px_rgba(132,165,125,0.22)] rounded-full px-5 md:px-6 h-14 flex items-center justify-between">
          <Link to="/preview-redesign" className="flex items-center gap-1.5">
            <span className="font-calistoga text-[22px] leading-none text-pastel-forest">Citrus</span>
            <span aria-hidden="true" className="block w-2 h-2 bg-pastel-orange rounded-full" />
          </Link>
          <nav className="hidden md:flex items-center gap-7 text-[14px] font-medium">
            {NAV_LINKS.map((label) => (
              <a
                key={label}
                href="#"
                className="text-pastel-forest-soft hover:text-pastel-forest transition-colors"
              >
                {label}
              </a>
            ))}
          </nav>
          <Link
            to="/auth"
            className="text-[13px] font-medium px-4 h-9 inline-flex items-center text-pastel-forest border border-pastel-sage hover:bg-pastel-forest hover:text-white rounded-full transition-colors"
          >
            Sign in
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative max-w-[1240px] mx-auto px-6 pt-12 lg:pt-16 pb-24 lg:pb-28">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center">
          {/* LEFT — copy + CTAs */}
          <div className="lg:col-span-6 relative z-10">
            {/* Eyebrow */}
            <div className="inline-flex items-center gap-2 mb-7 px-3 py-1.5 rounded-full bg-white/60 backdrop-blur-md border border-pastel-sage/30">
              <span className="relative flex w-1.5 h-1.5">
                <span className="absolute inline-flex w-full h-full bg-pastel-sage rounded-full opacity-60 animate-ping" />
                <span className="relative inline-flex w-1.5 h-1.5 bg-pastel-sage rounded-full" />
              </span>
              <span className="font-caps text-[11px] tracking-[0.22em] text-pastel-forest-soft uppercase leading-none">
                NHL Fantasy · 2025-26 Season
              </span>
            </div>

            {/* Mixed typography headline — Calistoga warmth + Bebas athletic */}
            <h1 className="mb-7">
              <span className="block font-calistoga text-[2.5rem] sm:text-5xl md:text-[3.75rem] lg:text-[4.5rem] leading-[1.05] tracking-[-0.01em] text-pastel-forest">
                Fantasy hockey,
              </span>
              <span className="block font-caps text-[3.25rem] sm:text-[4.25rem] md:text-[5.5rem] lg:text-[7rem] leading-[0.92] tracking-[0.005em] text-pastel-orange mt-1">
                FRESHLY SQUEEZED.
              </span>
            </h1>

            {/* Sub */}
            <p className="font-sans text-[17px] md:text-[18px] leading-relaxed text-pastel-forest-soft max-w-lg mb-9">
              A 31-feature xG model. Live shift-level data. Saturday finishes when the entire league is playing.
            </p>

            {/* CTAs */}
            <div className="flex flex-wrap items-center gap-x-7 gap-y-4 mb-12">
              <Link
                to="/create-league"
                className="group inline-flex items-center gap-2 bg-pastel-orange text-[#581E00] text-[15px] font-semibold pl-6 pr-5 h-12 rounded-full shadow-[0_8px_24px_-8px_rgba(255,107,26,0.6)] hover:shadow-[0_12px_28px_-6px_rgba(255,107,26,0.7)] hover:-translate-y-0.5 transition-all duration-200"
              >
                <span>Start a Test League</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" strokeWidth={2.5} />
              </Link>
              <a
                href="#projections"
                className="text-[15px] font-semibold text-pastel-forest hover:text-pastel-orange transition-colors group"
              >
                See tonight's projections{' '}
                <span className="inline-block group-hover:translate-x-0.5 transition-transform">→</span>
              </a>
            </div>

            {/* Animated stat blocks — broadcast scoreboard energy */}
            <div className="flex items-center gap-6 sm:gap-8 flex-wrap">
              <StatBlock
                value={`${(sims / 1000).toFixed(2)}K`}
                label="Sims tonight"
                icon={Zap}
              />
              <StatBlock
                value={Math.round(features).toString()}
                label="Model features"
                icon={TrendingUp}
              />
              <StatBlock
                value={`${mape.toFixed(1)}%`}
                label="Mean error"
                icon={Activity}
              />
            </div>
          </div>

          {/* RIGHT — puck + fruit hero + projection card */}
          <div className="lg:col-span-6 relative">
            <div className="relative">
              {/* Sage glow halo behind the hero asset */}
              <div
                aria-hidden="true"
                className="absolute inset-0 -m-8 rounded-full opacity-60 blur-2xl"
                style={{ background: 'radial-gradient(circle, #C8DCC4 0%, transparent 60%)' }}
              />

              {/* 3D Puck + Fruit Hero — animated float */}
              <img
                src="/mockups/sage-puck-hero.jpg"
                alt=""
                aria-hidden="true"
                className="relative block w-full max-w-[460px] lg:max-w-[520px] mx-auto rounded-[28px] animate-float-slow drop-shadow-[0_30px_40px_rgba(27,48,34,0.18)]"
                loading="eager"
              />

              {/* Liquid Glass Projection Card — overlapping the hero */}
              <div
                id="projections"
                className="lg:absolute lg:right-0 lg:top-1/2 lg:-translate-y-1/2 lg:w-[420px] mt-6 lg:mt-0 z-20"
              >
                <div className="bg-white/70 backdrop-blur-xl border border-white/80 rounded-[20px] shadow-[0_20px_60px_-12px_rgba(132,165,125,0.28)] overflow-hidden">
                  {/* Header */}
                  <div className="flex items-center justify-between px-5 py-4 border-b border-pastel-sage-soft/50 bg-gradient-to-b from-white/40 to-transparent">
                    <div>
                      <div className="font-caps text-[10px] tracking-[0.22em] text-pastel-forest-dim uppercase leading-none">
                        Tonight's Slate
                      </div>
                      <div className="font-medium text-[14px] text-pastel-forest mt-1">Top Projections</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="relative flex w-2 h-2">
                        <span className="absolute inline-flex w-full h-full bg-pastel-sage rounded-full opacity-60 animate-ping" />
                        <span className="relative inline-flex w-2 h-2 bg-pastel-sage rounded-full" />
                      </span>
                      <span className="font-caps text-[10px] tracking-[0.22em] text-pastel-forest-soft uppercase leading-none">
                        Live
                      </span>
                    </div>
                  </div>

                  {/* Player rows */}
                  <div>
                    {PLAYERS.map((player, i) => (
                      <PlayerRow key={`${player.team}-${player.name}`} player={player} index={i} />
                    ))}
                  </div>

                  {/* Footer */}
                  <div className="px-5 py-3 border-t border-pastel-sage-soft/50 bg-white/40">
                    <div className="font-jbmono text-[10px] text-pastel-forest-dim tracking-wide flex items-center justify-between">
                      <span>31 features · 1,247 sims</span>
                      <span className="text-pastel-sage">Updated 14s ago</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Soft separator */}
      <div className="max-w-[1240px] mx-auto px-6">
        <div className="h-px bg-gradient-to-r from-transparent via-pastel-sage to-transparent" />
      </div>

      {/* Below-the-fold teaser — placeholder for upcoming sections */}
      <section className="max-w-[1240px] mx-auto px-6 py-20 text-center">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/60 backdrop-blur-md border border-pastel-sage/30">
          <span aria-hidden="true" className="block w-1.5 h-1.5 bg-pastel-orange rounded-full animate-pulse" />
          <span className="font-caps text-[11px] tracking-[0.22em] text-pastel-forest-soft uppercase">
            Pastel Sage Sports · v2
          </span>
        </div>
        <p className="font-sans text-[15px] text-pastel-forest-dim mt-6 max-w-md mx-auto">
          Features grid, Stormy AI showcase, final CTA, and footer come next, once you've signed off on the hero direction.
        </p>
      </section>
    </div>
  );
}
