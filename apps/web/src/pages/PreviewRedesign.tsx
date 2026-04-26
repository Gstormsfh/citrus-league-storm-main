import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import PremiumFeatures from '@/components/premium/PremiumFeatures';
import PremiumStormy from '@/components/premium/PremiumStormy';
import PremiumCTA from '@/components/premium/PremiumCTA';
import PremiumFooter from '@/components/premium/PremiumFooter';

const MAX_PROJECTION = 18;

const PLAYERS = [
  { name: 'Connor McDavid', team: 'EDM', position: 'C', floor: 6.7, median: 9.4, ceiling: 12.1, std: 2.1, color: '#FF4C00' },
  { name: 'Auston Matthews', team: 'TOR', position: 'C', floor: 6.3, median: 8.7, ceiling: 11.1, std: 1.9, color: '#00205B' },
  { name: 'Nathan MacKinnon', team: 'COL', position: 'C', floor: 6.0, median: 8.6, ceiling: 11.2, std: 2.0, color: '#6F263D' },
  { name: 'Leon Draisaitl', team: 'EDM', position: 'C', floor: 5.9, median: 8.1, ceiling: 10.3, std: 1.7, color: '#FF4C00' },
  { name: 'Cale Makar', team: 'COL', position: 'D', floor: 5.2, median: 7.2, ceiling: 9.2, std: 1.6, color: '#6F263D' },
  { name: 'Igor Shesterkin', team: 'NYR', position: 'G', floor: 8.4, median: 12.4, ceiling: 16.4, std: 3.1, color: '#0038A8' },
];

const TICKER_GAMES = [
  { home: 'EDM', away: 'BOS', score: '3–2', period: '2nd 14:22', live: true },
  { home: 'TOR', away: 'MTL', score: '1–1', period: '1st 8:45', live: true },
  { home: 'NYR', away: 'NJD', score: '0–0', period: '7:00 ET', live: false },
  { home: 'COL', away: 'VGK', score: '4–3', period: 'OT', live: true },
  { home: 'CAR', away: 'TBL', score: '2–1', period: 'F', live: false },
  { home: 'PIT', away: 'PHI', score: '3–3', period: '3rd 5:12', live: true },
];

function PremiumNavbar() {
  return (
    <header className="sticky top-0 z-50 w-full bg-premium-bg/95 backdrop-blur border-b border-premium-border">
      <div className="max-w-[1400px] mx-auto px-6 h-14 flex items-center justify-between">
        <Link to="/preview-redesign" className="flex items-center gap-1.5">
          <span className="font-caps text-xl tracking-wide text-premium-text">CITRUS</span>
          <span className="block w-1.5 h-1.5 bg-premium-orange" />
        </Link>

        <nav className="hidden md:flex items-center gap-8">
          {['Playoffs', 'Pools', 'Armchair GM', 'Insights'].map((label) => (
            <a
              key={label}
              href="#"
              className="font-caps text-[12px] tracking-[0.18em] uppercase text-premium-text-muted hover:text-premium-text transition-colors"
            >
              {label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <span className="hidden sm:inline-block px-2 py-0.5 bg-premium-surface-higher text-[10px] font-caps tracking-widest text-premium-text-muted">
            BETA
          </span>
          <Link
            to="/auth"
            className="font-caps text-[12px] tracking-widest uppercase text-premium-orange border border-premium-orange/40 px-4 h-8 inline-flex items-center hover:bg-premium-orange hover:text-premium-orange-deep transition-colors"
          >
            Sign In
          </Link>
        </div>
      </div>
    </header>
  );
}

function PremiumLiveTicker() {
  return (
    <div className="w-full bg-premium-bg-deep border-b border-premium-border overflow-hidden">
      <div className="max-w-[1400px] mx-auto px-6 h-9 flex items-center gap-6">
        <div className="flex items-center gap-2 flex-shrink-0 pr-4 border-r border-premium-border h-full">
          <span className="relative flex w-1.5 h-1.5">
            <span className="absolute inline-flex w-full h-full bg-premium-orange opacity-75 animate-ping" />
            <span className="relative inline-flex w-1.5 h-1.5 bg-premium-orange" />
          </span>
          <span className="font-caps text-[11px] tracking-widest text-premium-orange">LIVE</span>
        </div>

        <div className="flex items-center gap-8 overflow-hidden flex-1">
          {[...TICKER_GAMES, ...TICKER_GAMES].map((game, i) => (
            <div key={i} className="flex items-center gap-2 flex-shrink-0">
              <span className="font-caps text-[11px] tracking-wider text-premium-text-muted">{game.away}</span>
              <span className="font-premium-body text-[11px] tabular-nums font-semibold text-premium-text">
                {game.score}
              </span>
              <span className="font-caps text-[11px] tracking-wider text-premium-text-muted">{game.home}</span>
              <span className="font-premium-body text-[10px] text-premium-text-dim ml-1">{game.period}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ProjectionBar({ floor, median, ceiling }: { floor: number; median: number; ceiling: number }) {
  const floorPct = (floor / MAX_PROJECTION) * 100;
  const medianPct = (median / MAX_PROJECTION) * 100;
  const ceilingPct = (ceiling / MAX_PROJECTION) * 100;

  return (
    <div className="relative w-full h-1.5 bg-premium-surface-higher">
      <div
        className="absolute top-0 h-full bg-gradient-to-r from-premium-orange/30 via-premium-orange/70 to-premium-orange"
        style={{ left: `${floorPct}%`, width: `${ceilingPct - floorPct}%` }}
      />
      <div
        className="absolute -top-0.5 -bottom-0.5 w-[2px] bg-white"
        style={{ left: `calc(${medianPct}% - 1px)` }}
      />
    </div>
  );
}

function PlayerRow({ player }: { player: (typeof PLAYERS)[number] }) {
  const initials = player.name
    .split(' ')
    .map((n) => n[0])
    .join('');

  return (
    <div className="flex items-center gap-4 px-5 py-3.5 hover:bg-premium-surface-high transition-colors">
      <div
        className="w-9 h-9 flex items-center justify-center font-caps text-[11px] tracking-wider text-white flex-shrink-0"
        style={{ backgroundColor: player.color }}
      >
        {initials}
      </div>

      <div className="min-w-0 w-36">
        <div className="font-premium-body text-sm font-semibold text-premium-text truncate">{player.name}</div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="font-caps text-[10px] tracking-wider text-premium-text-dim">{player.team}</span>
          <span className="px-1 bg-premium-surface-higher font-caps text-[10px] tracking-wider text-premium-text-muted leading-none h-3.5 inline-flex items-center">
            {player.position}
          </span>
        </div>
      </div>

      <div className="flex-1 max-w-[220px] hidden sm:block">
        <ProjectionBar floor={player.floor} median={player.median} ceiling={player.ceiling} />
      </div>

      <div className="text-right tabular-nums w-16 flex-shrink-0">
        <div className="font-premium-body text-sm font-semibold text-premium-text">{player.median.toFixed(1)}</div>
        <div className="font-premium-body text-[10px] text-premium-text-dim">±{player.std.toFixed(1)}</div>
      </div>
    </div>
  );
}

export default function PreviewRedesign() {
  return (
    <div className="bg-premium-bg text-premium-text min-h-screen" style={{ colorScheme: 'dark' }}>
      <PremiumNavbar />
      <PremiumLiveTicker />

      <section className="max-w-[1400px] mx-auto px-6 py-16 lg:py-24">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          <div className="lg:col-span-5">
            <div className="flex items-center gap-2 mb-8">
              <span className="block w-1.5 h-1.5 bg-premium-orange flex-shrink-0" />
              <span className="font-caps text-[11px] tracking-[0.2em] text-premium-text-muted uppercase">
                Fantasy Hockey · 2025-26 Season
              </span>
            </div>

            <h1 className="font-editorial text-5xl md:text-6xl lg:text-7xl xl:text-[5rem] leading-[1.02] tracking-[-0.02em] text-premium-text mb-6">
              The Smartest Way to Play Fantasy Hockey.
            </h1>

            <p className="font-premium-body text-lg leading-relaxed text-premium-text-muted max-w-md mb-8">
              A 31-feature xG model. Live shift-level data. Saturday finishes — when the entire league is playing.
            </p>

            <div className="flex flex-wrap gap-3 mb-6">
              <Link
                to="/create-league"
                className="group inline-flex items-center gap-2 bg-premium-orange text-premium-orange-deep font-caps text-[13px] tracking-[0.15em] px-6 h-12 hover:bg-premium-orange-soft transition-colors"
              >
                <span>START A TEST LEAGUE</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" strokeWidth={2.5} />
              </Link>
              <a
                href="#projections"
                className="inline-flex items-center bg-transparent text-premium-text font-caps text-[13px] tracking-[0.15em] px-6 h-12 border border-premium-border-strong hover:border-premium-text transition-colors"
              >
                SEE THE PROJECTIONS
              </a>
            </div>

            <p className="font-premium-body text-[11px] text-premium-text-dim">
              No credit card · 8 minutes to first lineup · Built by hockey fanatics
            </p>
          </div>

          <div className="lg:col-span-7" id="projections">
            <div className="bg-premium-surface border border-premium-border">
              <div className="flex items-center justify-between px-5 py-4 border-b border-premium-border">
                <div className="font-caps text-[11px] tracking-[0.2em] text-premium-text-muted uppercase">
                  Tonight's Top Projected Scorers
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="relative flex w-1.5 h-1.5">
                    <span className="absolute inline-flex w-full h-full bg-premium-orange opacity-75 animate-ping" />
                    <span className="relative inline-flex w-1.5 h-1.5 bg-premium-orange" />
                  </span>
                  <span className="font-caps text-[10px] tracking-widest text-premium-orange">LIVE</span>
                </div>
              </div>

              <div className="divide-y divide-premium-border">
                {PLAYERS.map((player) => (
                  <PlayerRow key={player.name} player={player} />
                ))}
              </div>

              <div className="px-5 py-3 border-t border-premium-border flex items-center justify-between gap-4">
                <div className="font-premium-body text-[11px] text-premium-text-dim tracking-wide">
                  31 features · Updated 14s ago · 1,247 simulations
                </div>
                <button className="font-caps text-[10px] tracking-widest text-premium-orange hover:text-premium-orange-soft transition-colors flex-shrink-0">
                  See all →
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-premium-bg-deep border-y border-premium-border">
        <div className="max-w-[1400px] mx-auto px-6 py-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {[
              { value: '31', label: 'XG Model Features' },
              { value: '1.2M', label: 'Plays Processed Nightly' },
              { value: '2.4%', label: 'MAPE vs Actual' },
              { value: 'SAT', label: '12-Game Saturday Finishes' },
            ].map((m) => (
              <div key={m.label}>
                <div className="font-caps text-4xl md:text-5xl tracking-wider text-premium-text mb-1 leading-none">
                  {m.value}
                </div>
                <div className="font-caps text-[11px] tracking-[0.15em] text-premium-text-dim uppercase">
                  {m.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <PremiumFeatures />
      <PremiumStormy />
      <PremiumCTA />
      <PremiumFooter />
    </div>
  );
}
