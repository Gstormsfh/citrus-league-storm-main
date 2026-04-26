import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

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

const STAT_BADGES = ['31 Features', '1.2M Sims', '2.4% MAPE', 'Live Everything'];

function ProjectionBar({ floor, median, ceiling }: { floor: number; median: number; ceiling: number }) {
  const floorPct = (floor / MAX_PROJECTION) * 100;
  const medianPct = (median / MAX_PROJECTION) * 100;
  const ceilingPct = (ceiling / MAX_PROJECTION) * 100;

  return (
    <div className="relative w-full h-2 bg-pastel-cream-warm rounded-full overflow-hidden">
      <div
        className="absolute top-0 h-full rounded-full bg-gradient-to-r from-pastel-peach-deep/60 via-pastel-orange-soft to-pastel-orange"
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
      className={`flex items-center gap-3 px-5 py-3 transition-colors hover:bg-white/40 ${
        index % 2 === 1 ? 'bg-pastel-sage-soft/15' : ''
      }`}
    >
      <div className="w-9 h-9 rounded-full bg-pastel-peach/70 ring-1 ring-pastel-orange/30 flex items-center justify-center font-jbmono text-[10px] font-semibold text-pastel-orange-deep flex-shrink-0">
        {player.initials}
      </div>

      <div className="min-w-0 flex-1">
        <div className="font-calistoga text-[15px] leading-tight text-pastel-forest truncate">{player.name}</div>
        <div className="flex items-center gap-1.5 mt-1">
          <span className="px-1.5 py-0 rounded bg-pastel-sage-soft text-[9px] font-jbmono uppercase tracking-wider text-pastel-forest-soft leading-[14px]">
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

export default function PreviewRedesign() {
  return (
    <div
      className="min-h-screen relative overflow-x-hidden"
      style={{
        background:
          'linear-gradient(135deg, #FFF8F0 0%, #FFEDDB 50%, #FFE0CC 100%)',
        color: '#1B3022',
      }}
    >
      {/* Soft atmospheric glow accents */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 -right-32 w-[480px] h-[480px] rounded-full opacity-40 blur-3xl"
        style={{ background: 'radial-gradient(circle, #FFB591 0%, transparent 70%)' }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-1/3 -left-32 w-[400px] h-[400px] rounded-full opacity-30 blur-3xl"
        style={{ background: 'radial-gradient(circle, #C8DCC4 0%, transparent 70%)' }}
      />

      {/* Floating Liquid Glass Navbar */}
      <header className="sticky top-4 z-50 w-full px-4 md:px-6">
        <div className="max-w-[1240px] mx-auto bg-white/55 backdrop-blur-xl border border-white/70 shadow-[0_8px_32px_-8px_rgba(255,107,26,0.12)] rounded-full px-5 md:px-6 h-14 flex items-center justify-between">
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
            className="text-[13px] font-medium px-4 h-9 inline-flex items-center text-pastel-orange border border-pastel-orange/40 hover:bg-pastel-orange hover:text-white rounded-full transition-colors"
          >
            Sign in
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative max-w-[1240px] mx-auto px-6 pt-12 lg:pt-20 pb-24 lg:pb-32">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center">
          {/* LEFT — copy + CTAs */}
          <div className="lg:col-span-6 relative z-10">
            {/* Eyebrow */}
            <div className="flex items-center gap-2 mb-7">
              <span aria-hidden="true" className="block w-1.5 h-1.5 bg-pastel-orange rounded-full" />
              <span className="font-jbmono text-[11px] tracking-[0.22em] text-pastel-forest-soft uppercase">
                Fantasy Hockey · 2025-26
              </span>
            </div>

            {/* Headline */}
            <h1 className="font-calistoga text-[2.75rem] sm:text-5xl md:text-6xl lg:text-[5rem] xl:text-[5.5rem] leading-[1.02] tracking-[-0.01em] text-pastel-forest mb-7">
              Fantasy hockey, freshly squeezed.
            </h1>

            {/* Sub */}
            <p className="font-sans text-[17px] md:text-[18px] leading-relaxed text-pastel-forest-soft max-w-lg mb-9">
              A 31-feature xG model. Live shift-level data. Saturday finishes when the entire league is playing.
            </p>

            {/* CTAs */}
            <div className="flex flex-wrap items-center gap-x-7 gap-y-4 mb-10">
              <Link
                to="/create-league"
                className="group inline-flex items-center gap-2 bg-pastel-orange text-white text-[15px] font-semibold pl-6 pr-5 h-12 rounded-full shadow-[0_8px_24px_-8px_rgba(255,107,26,0.6)] hover:shadow-[0_12px_28px_-6px_rgba(255,107,26,0.7)] hover:-translate-y-0.5 transition-all duration-200"
              >
                <span>Start a Test League</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" strokeWidth={2.5} />
              </Link>
              <a
                href="#projections"
                className="text-[15px] font-semibold text-pastel-orange hover:text-pastel-forest transition-colors group"
              >
                See the projections{' '}
                <span className="inline-block group-hover:translate-x-0.5 transition-transform">→</span>
              </a>
            </div>

            {/* Stat badges */}
            <div className="flex items-center gap-2 flex-wrap">
              <span aria-hidden="true" className="block w-1.5 h-1.5 bg-pastel-orange rounded-full" />
              {STAT_BADGES.map((stat, i) => (
                <span key={stat} className="font-jbmono text-[11px] tracking-[0.18em] text-pastel-forest-soft uppercase">
                  {stat}
                  {i < STAT_BADGES.length - 1 && <span className="mx-2 text-pastel-forest-soft/40">·</span>}
                </span>
              ))}
            </div>
          </div>

          {/* RIGHT — fruit + projection card */}
          <div className="lg:col-span-6 relative">
            <div className="relative">
              {/* 3D Fruit Hero — animated float */}
              <img
                src="/mockups/citrus-fruits-hero.jpg"
                alt=""
                aria-hidden="true"
                className="block w-full max-w-[460px] lg:max-w-[520px] mx-auto animate-float-slow drop-shadow-[0_30px_40px_rgba(255,107,26,0.15)]"
                loading="eager"
              />

              {/* Liquid Glass Projection Card — overlapping the fruit */}
              <div
                id="projections"
                className="lg:absolute lg:right-0 lg:top-1/2 lg:-translate-y-1/2 lg:w-[420px] mt-6 lg:mt-0 z-20"
              >
                <div className="bg-white/65 backdrop-blur-xl border border-white/80 rounded-[20px] shadow-[0_20px_60px_-12px_rgba(255,107,26,0.18)] overflow-hidden">
                  {/* Header */}
                  <div className="flex items-center justify-between px-5 py-4 border-b border-pastel-sage-soft/40">
                    <div className="font-medium text-[14px] text-pastel-forest">Tonight's Top Projections</div>
                    <div className="flex items-center gap-2">
                      <span className="relative flex w-2 h-2">
                        <span className="absolute inline-flex w-full h-full bg-pastel-sage rounded-full opacity-60 animate-ping" />
                        <span className="relative inline-flex w-2 h-2 bg-pastel-sage rounded-full" />
                      </span>
                      <span className="font-jbmono text-[10px] tracking-[0.18em] text-pastel-sage uppercase">Live</span>
                    </div>
                  </div>

                  {/* Player rows */}
                  <div>
                    {PLAYERS.map((player, i) => (
                      <PlayerRow key={`${player.team}-${player.name}`} player={player} index={i} />
                    ))}
                  </div>

                  {/* Footer */}
                  <div className="px-5 py-3 border-t border-pastel-sage-soft/40 bg-white/30">
                    <div className="font-jbmono text-[10px] text-pastel-forest-dim tracking-wide">
                      31 features · Updated 14s ago · 1,247 sims
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
        <div className="h-px bg-gradient-to-r from-transparent via-pastel-sage-soft to-transparent" />
      </div>

      {/* Below-the-fold teaser — placeholder for upcoming sections */}
      <section className="max-w-[1240px] mx-auto px-6 py-20 text-center">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/50 backdrop-blur-md border border-white/60">
          <span aria-hidden="true" className="block w-1.5 h-1.5 bg-pastel-sage rounded-full animate-pulse" />
          <span className="font-jbmono text-[11px] tracking-[0.2em] text-pastel-forest-soft uppercase">
            Pastel-Vibrant Hero · v1
          </span>
        </div>
        <p className="font-sans text-[15px] text-pastel-forest-dim mt-6 max-w-md mx-auto">
          Features grid, Stormy AI showcase, final CTA, and footer come next — once you've signed off on the hero direction.
        </p>
      </section>
    </div>
  );
}
