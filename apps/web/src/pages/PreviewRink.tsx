import { Link } from 'react-router-dom';
import { ArrowRight, Activity, Zap, Trophy } from 'lucide-react';

const NAV = ['Scores', 'Fantasy', 'Picks', 'AI'];

// "47K+ Managers" sat here until 2026-08-26. The three that remain describe
// the model, which is a thing we built and can point at; a user count is a
// claim about the world, and ours was invented.
const STATS = [
  { value: '31', label: 'Model features' },
  { value: '19K', label: 'Sims per slate' },
  { value: '2.4%', label: 'Mean error' },
];

const LIVE_GAMES = [
  { away: 'EDM', home: 'COL', awayScore: 4, homeScore: 3, period: '3rd', time: '12:43', status: 'LIVE' },
  { away: 'TOR', home: 'MTL', awayScore: 2, homeScore: 1, period: '2nd', time: '08:21', status: 'LIVE' },
  { away: 'BOS', home: 'NYR', awayScore: 1, homeScore: 1, period: '1st', time: '14:02', status: 'LIVE' },
  { away: 'VAN', home: 'CGY', awayScore: 5, homeScore: 2, status: 'FINAL' },
];

// Massive geometric hockey goal frame as hero centerpiece
function HockeyGoalSVG() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 800 500"
      className="w-full h-auto"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id="netGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FF6B1A" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#FF6B1A" stopOpacity="0" />
        </linearGradient>
        <pattern id="netMesh" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 0 10 L 20 10 M 10 0 L 10 20" stroke="#C8DCC4" strokeOpacity="0.18" strokeWidth="1" />
        </pattern>
      </defs>
      {/* Net mesh interior */}
      <path d="M 180 480 Q 400 380 620 480 L 620 160 Q 400 140 180 160 Z" fill="url(#netMesh)" />
      <path d="M 180 480 Q 400 380 620 480 L 620 160 Q 400 140 180 160 Z" fill="url(#netGrad)" />
      {/* Goal frame */}
      <path
        d="M 180 480 L 180 160 Q 400 140 620 160 L 620 480"
        fill="none"
        stroke="#FFF8F0"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <path
        d="M 180 160 L 100 480 M 620 160 L 700 480"
        fill="none"
        stroke="#FFF8F0"
        strokeWidth="4"
        strokeLinecap="round"
      />
      {/* Crossbar accent line */}
      <path
        d="M 180 160 Q 400 140 620 160"
        fill="none"
        stroke="#FF6B1A"
        strokeWidth="6"
        strokeLinecap="round"
      />
      {/* Goal line */}
      <line x1="80" y1="480" x2="720" y2="480" stroke="#FFF8F0" strokeWidth="3" strokeOpacity="0.6" />
      {/* Faceoff dots flanking */}
      <circle cx="60" cy="460" r="8" fill="#FF6B1A" />
      <circle cx="740" cy="460" r="8" fill="#FF6B1A" />
    </svg>
  );
}

// Faceoff dot pattern background
function FaceoffPattern() {
  return (
    <svg
      aria-hidden="true"
      className="absolute inset-0 w-full h-full opacity-[0.05] pointer-events-none"
      viewBox="0 0 1200 800"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <pattern id="faceoffPattern" x="0" y="0" width="280" height="280" patternUnits="userSpaceOnUse">
          <circle cx="140" cy="140" r="48" fill="none" stroke="#FFF8F0" strokeWidth="2" />
          <circle cx="140" cy="140" r="6" fill="#FFF8F0" />
          <line x1="100" y1="115" x2="180" y2="115" stroke="#FFF8F0" strokeWidth="1.5" />
          <line x1="100" y1="165" x2="180" y2="165" stroke="#FFF8F0" strokeWidth="1.5" />
        </pattern>
      </defs>
      <rect width="1200" height="800" fill="url(#faceoffPattern)" />
    </svg>
  );
}

export default function PreviewRink() {
  return (
    <div className="min-h-screen bg-[#0A1A10] text-pastel-cream relative overflow-x-hidden">
      <FaceoffPattern />

      {/* Atmospheric color glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-[10%] left-1/2 -translate-x-1/2 w-[800px] h-[600px] rounded-full opacity-25 blur-3xl"
        style={{ background: 'radial-gradient(ellipse, #FF6B1A 0%, transparent 60%)' }}
      />

      {/* Top safety-yellow rink stripe */}
      <div className="relative z-10 h-1 bg-gradient-to-r from-transparent via-[#F4C430] to-transparent opacity-60" />

      {/* Nav */}
      <header className="relative z-40 backdrop-blur-md bg-[#0A1A10]/70 border-b border-white/5">
        <div className="max-w-[1280px] mx-auto px-6 h-16 flex items-center justify-between gap-6">
          <Link to="/preview-rink" className="flex items-center gap-2">
            <span className="font-calistoga text-[24px] leading-none text-pastel-cream">Citrus</span>
            <span className="font-jbmono text-[9px] tracking-[0.32em] uppercase text-pastel-orange-soft border border-pastel-orange/40 px-1.5 py-0.5 rounded">
              Hockey
            </span>
          </Link>
          <nav className="hidden md:flex items-center gap-8">
            {NAV.map((label) => (
              <a
                key={label}
                href="#"
                className="font-jbmono text-[11px] tracking-[0.22em] uppercase text-white/55 hover:text-pastel-cream transition-colors font-medium"
              >
                {label}
              </a>
            ))}
          </nav>
          <Link
            to="/create-league"
            className="text-[13px] font-bold px-4 h-10 inline-flex items-center bg-pastel-orange text-[#581E00] hover:bg-pastel-orange-soft rounded-md transition-colors"
          >
            Drop the Puck
          </Link>
        </div>
      </header>

      {/* HERO — centered massive */}
      <section className="relative max-w-[1280px] mx-auto px-6 pt-20 lg:pt-28 pb-12 text-center">
        <div className="inline-flex items-center gap-2 mb-8 px-3.5 py-1.5 rounded-md bg-pastel-orange/15 ring-1 ring-pastel-orange/30">
          <span className="relative flex w-1.5 h-1.5">
            <span className="absolute inline-flex w-full h-full bg-pastel-orange rounded-full opacity-75 animate-ping" />
            <span className="relative inline-flex w-1.5 h-1.5 bg-pastel-orange rounded-full" />
          </span>
          <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-orange-soft leading-none font-bold">
            Built for hockey · Trained on hockey · Played on hockey
          </span>
        </div>
        <h1 className="font-sans font-black text-[3.25rem] sm:text-[4.5rem] lg:text-[6.5rem] leading-[0.92] tracking-[-0.04em] text-pastel-cream mb-6 max-w-5xl mx-auto">
          Hockey deserves<br />
          a <span className="text-pastel-orange">better</span> fantasy.
        </h1>
        <p className="text-[17px] md:text-[19px] leading-relaxed text-white/65 max-w-xl mx-auto mb-10">
          Every other fantasy platform was built for football and bolted on hockey. We built
          Citrus for hockey first: 31-feature xG, shift-level scoring, real-time projections.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-4 mb-16">
          <Link
            to="/create-league"
            className="group inline-flex items-center gap-2 bg-pastel-orange text-[#581E00] text-[15px] font-bold px-8 rounded-md hover:bg-pastel-orange-soft hover:-translate-y-0.5 transition-all duration-200 shadow-[0_8px_32px_-8px_rgba(255,107,26,0.5)]"
            style={{ height: '54px' }}
          >
            <span>Drop the Puck</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" strokeWidth={2.5} />
          </Link>
          <Link
            to="/draft"
            className="inline-flex items-center text-[14px] font-bold text-pastel-cream hover:text-pastel-orange-soft transition-colors px-6 rounded-md ring-1 ring-white/15 hover:ring-white/30"
            style={{ height: '54px' }}
          >
            Try a mock draft →
          </Link>
        </div>

        {/* Massive hockey goal SVG */}
        <div className="relative max-w-3xl mx-auto">
          <HockeyGoalSVG />
        </div>
      </section>

      {/* Stat block bar */}
      <section className="relative max-w-[1280px] mx-auto px-6 py-12 mb-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {STATS.map((s) => (
            <div key={s.label} className="text-center px-4 py-6 border border-white/10 rounded-xl bg-white/[0.02]">
              <div className="font-sans font-black text-[2.25rem] md:text-[2.75rem] leading-none text-pastel-orange tabular-nums">
                {s.value}
              </div>
              <div className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-white/55 mt-2 font-medium">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* LIVE SCOREBOARD GRID */}
      <section className="relative max-w-[1280px] mx-auto px-6 pb-20">
        <div className="flex items-baseline justify-between mb-6 gap-4 flex-wrap">
          <div>
            <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft mb-2 flex items-center gap-2 font-bold">
              <span className="relative flex w-1.5 h-1.5">
                <span className="absolute inline-flex w-full h-full bg-pastel-orange rounded-full opacity-75 animate-ping" />
                <span className="relative inline-flex w-1.5 h-1.5 bg-pastel-orange rounded-full" />
              </span>
              Tonight · Live now
            </div>
            <h2 className="font-sans font-black text-[2.25rem] md:text-[2.75rem] tracking-[-0.025em] text-pastel-cream leading-tight">
              The slate.
            </h2>
          </div>
          <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-white/55">
            Updated 4s ago
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {LIVE_GAMES.map((g, i) => (
            <article
              key={`${g.away}-${g.home}`}
              className="bg-[#142420] border border-white/10 rounded-2xl p-5 hover:border-pastel-orange/40 transition-all"
            >
              <div className="flex items-center justify-between mb-4">
                <span className="flex items-center gap-1.5">
                  {g.status === 'LIVE' ? (
                    <>
                      <span className="relative flex w-1.5 h-1.5">
                        <span className="absolute inline-flex w-full h-full bg-pastel-orange rounded-full opacity-75 animate-ping" />
                        <span className="relative inline-flex w-1.5 h-1.5 bg-pastel-orange rounded-full" />
                      </span>
                      <span className="font-jbmono text-[9px] tracking-[0.22em] uppercase text-pastel-orange-soft font-bold">
                        Live
                      </span>
                    </>
                  ) : (
                    <span className="font-jbmono text-[9px] tracking-[0.22em] uppercase text-white/55 font-bold">
                      Final
                    </span>
                  )}
                </span>
                {g.status === 'LIVE' && (
                  <span className="font-jbmono text-[10px] tracking-wider text-white/55 tabular-nums">
                    {g.period} · {g.time}
                  </span>
                )}
              </div>
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="font-sans font-black text-[1.5rem] text-pastel-cream leading-none">{g.away}</div>
                  <div className="font-jbmono text-[9px] text-white/55 mt-1 tracking-wider uppercase">Away</div>
                </div>
                <div className="font-sans font-black text-[2rem] text-pastel-cream tabular-nums leading-none">
                  {g.awayScore}<span className="text-white/55 mx-0.5">·</span>{g.homeScore}
                </div>
                <div className="text-right">
                  <div className="font-sans font-black text-[1.5rem] text-pastel-cream leading-none">{g.home}</div>
                  <div className="font-jbmono text-[9px] text-white/55 mt-1 tracking-wider uppercase">Home</div>
                </div>
              </div>
              {g.status === 'LIVE' && (
                <div className="mt-4 h-1 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-pastel-orange rounded-full" style={{ width: `${30 + i * 18}%` }} />
                </div>
              )}
            </article>
          ))}
        </div>
      </section>

      {/* Three feature blocks */}
      <section className="relative max-w-[1280px] mx-auto px-6 pb-20 grid grid-cols-1 md:grid-cols-3 gap-5">
        {[
          {
            icon: Activity,
            label: 'Shift-level xG',
            body: 'Our model rebuilds expected goals after every shift change. Your projections update in real time as the lines roll.',
          },
          {
            icon: Zap,
            label: 'Saturday slate',
            body: 'Fantasy weeks run Sun–Sat so the trophies are decided when the entire league is playing. Drama where it should be.',
          },
          {
            icon: Trophy,
            label: 'Hockey-first scoring',
            body: 'Skater goals worth 3, blocks 0.5, hits 0.2, goalie wins 4. The defaults that hockey heads actually use.',
          },
        ].map((f) => {
          const Icon = f.icon;
          return (
            <div
              key={f.label}
              className="bg-[#142420] border border-white/10 rounded-2xl p-7"
            >
              <div className="w-11 h-11 rounded-xl bg-pastel-orange/15 ring-1 ring-pastel-orange/30 flex items-center justify-center text-pastel-orange-soft mb-5">
                <Icon className="w-5 h-5" strokeWidth={2} />
              </div>
              <h3 className="font-sans font-bold text-[1.25rem] leading-snug text-pastel-cream mb-3">
                {f.label}
              </h3>
              <p className="text-[14px] text-white/55 leading-relaxed">{f.body}</p>
            </div>
          );
        })}
      </section>

      {/* Final CTA */}
      <section className="relative max-w-[1280px] mx-auto px-6 pb-20">
        <div className="bg-gradient-to-b from-pastel-orange/15 to-transparent border border-pastel-orange/30 rounded-[28px] p-10 md:p-14 text-center relative overflow-hidden">
          <div className="font-calistoga text-[2.5rem] md:text-[3.5rem] text-pastel-cream leading-tight mb-3">
            Game on.
          </div>
          <p className="text-[16px] text-white/65 max-w-md mx-auto mb-8">
            Free league. 30-second draft setup. Every shot in the corpus scored by our own xG model.
          </p>
          <Link
            to="/create-league"
            className="inline-flex items-center gap-2 bg-pastel-orange text-[#581E00] text-[15px] font-bold px-8 rounded-md hover:bg-pastel-cream hover:text-[#0A1A10] transition-colors shadow-[0_8px_32px_-8px_rgba(255,107,26,0.5)]"
            style={{ height: '54px' }}
          >
            <span>Drop the Puck</span>
            <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
          </Link>
        </div>
      </section>

      {/* Bottom safety-yellow stripe */}
      <div className="relative h-1 bg-gradient-to-r from-transparent via-[#F4C430] to-transparent opacity-60" />

      {/* Footer */}
      <footer className="relative bg-black/40 py-8 text-center border-t border-white/5">
        <div className="font-calistoga text-[18px] text-pastel-cream mb-1">Citrus</div>
        <div className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-white/55">
          © 2026 · Built for hockey
        </div>
      </footer>
    </div>
  );
}
