import { Link } from 'react-router-dom';
import { ArrowRight, Zap, Trophy, Sparkles, Activity, Flame } from 'lucide-react';

const NAV = ['Scores', 'Fantasy', 'Picks', 'Stormy AI'];

const GAME_MODES = [
  {
    label: 'Fantasy Hockey',
    headline: 'Snake · Auction · Salary',
    body: 'Run any league format with the deepest projections in fantasy hockey.',
    badge: 'Any format',
    accent: 'orange',
    icon: Trophy,
    seasonal: 'Live now',
  },
  {
    label: 'Hockey Pickem',
    headline: 'Pick the night, every night',
    body: 'Daily NHL pickem: straight up or against the spread, your call.',
    badge: 'Every night',
    accent: 'sage',
    icon: Flame,
    seasonal: 'Daily',
  },
  {
    label: 'Survivor Pool',
    headline: "One pick, can't lose",
    body: 'Choose one team a week. Win or you\'re out. Last manager standing wins it all.',
    badge: 'One pick a week',
    accent: 'butter',
    icon: Activity,
    seasonal: 'Weekly',
  },
  {
    label: 'Bracket Mania',
    headline: 'Stanley Cup brackets',
    body: 'Pick the entire playoff bracket. Confidence points multiply your edge.',
    badge: 'Confidence points',
    accent: 'sage',
    icon: Sparkles,
    seasonal: 'Apr–Jun',
  },
  {
    label: 'Mock Draft',
    headline: '12-team mock in 30 seconds',
    body: 'Spin up a mock against our model bots. No signup, instant draft room.',
    badge: 'Free',
    accent: 'orange',
    icon: Zap,
    seasonal: 'Anytime',
  },
];

const LIVE_GAMES = [
  { away: 'EDM', home: 'COL', awayScore: 4, homeScore: 3, period: '3rd', time: '12:43' },
  { away: 'TOR', home: 'MTL', awayScore: 2, homeScore: 1, period: '2nd', time: '08:21' },
];

const ACCENT_BG: Record<string, string> = {
  orange: 'bg-pastel-orange/15 ring-pastel-orange/40 text-pastel-orange-soft',
  sage: 'bg-pastel-sage/20 ring-pastel-sage/40 text-pastel-sage-soft',
  butter: 'bg-[#F4E5B8]/15 ring-[#F4E5B8]/40 text-[#F4E5B8]',
};

// SVG hockey rink lines — decorative background pattern
function RinkPattern() {
  return (
    <svg
      aria-hidden="true"
      className="absolute inset-0 w-full h-full opacity-[0.04] pointer-events-none"
      viewBox="0 0 1200 800"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <pattern id="rink" x="0" y="0" width="200" height="200" patternUnits="userSpaceOnUse">
          <circle cx="100" cy="100" r="38" fill="none" stroke="#FFF8F0" strokeWidth="1.5" />
          <circle cx="100" cy="100" r="3" fill="#FFF8F0" />
        </pattern>
      </defs>
      <rect width="1200" height="800" fill="url(#rink)" />
      <line x1="600" y1="0" x2="600" y2="800" stroke="#FFF8F0" strokeWidth="2" />
      <circle cx="600" cy="400" r="100" fill="none" stroke="#FFF8F0" strokeWidth="2" />
      <circle cx="600" cy="400" r="6" fill="#FFF8F0" />
    </svg>
  );
}

export default function PreviewArena() {
  return (
    <div className="min-h-screen bg-[#0F1F15] text-pastel-cream relative overflow-x-hidden">
      {/* Subtle rink pattern bg */}
      <div className="absolute inset-0 pointer-events-none">
        <RinkPattern />
      </div>

      {/* Atmospheric orange glow accent */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 -right-40 w-[600px] h-[600px] rounded-full opacity-25 blur-3xl"
        style={{ background: 'radial-gradient(circle, #FF6B1A 0%, transparent 70%)' }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-[40%] -left-40 w-[500px] h-[500px] rounded-full opacity-15 blur-3xl"
        style={{ background: 'radial-gradient(circle, #84A57D 0%, transparent 70%)' }}
      />

      {/* Nav */}
      <header className="sticky top-0 z-40 backdrop-blur-md bg-[#0F1F15]/85 border-b border-white/5">
        <div className="max-w-[1280px] mx-auto px-6 h-16 flex items-center justify-between gap-6 relative">
          <Link to="/preview-arena" className="flex items-center gap-1.5">
            <span className="font-calistoga text-[24px] leading-none text-pastel-cream">Citrus</span>
            <span aria-hidden="true" className="block w-1.5 h-1.5 bg-pastel-orange rounded-full animate-pulse" />
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
          <div className="flex items-center gap-3">
            <Link
              to="/auth"
              className="hidden sm:inline-flex text-[13px] font-medium text-white/60 hover:text-pastel-cream transition-colors"
            >
              Log in
            </Link>
            <Link
              to="/create-league"
              className="text-[13px] font-bold px-4 h-10 inline-flex items-center bg-pastel-orange text-[#581E00] hover:bg-pastel-orange-soft rounded-md transition-colors"
            >
              Get the App
            </Link>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="relative max-w-[1280px] mx-auto px-6 pt-16 lg:pt-24 pb-20">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-12 items-center">
          {/* LEFT — copy */}
          <div className="lg:col-span-6 relative z-10">
            <div className="inline-flex items-center gap-2 mb-7 px-3 py-1.5 rounded-md bg-pastel-orange/15 ring-1 ring-pastel-orange/30">
              <span className="relative flex w-1.5 h-1.5">
                <span className="absolute inline-flex w-full h-full bg-pastel-orange rounded-full opacity-75 animate-ping" />
                <span className="relative inline-flex w-1.5 h-1.5 bg-pastel-orange rounded-full" />
              </span>
              <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-orange-soft leading-none font-bold">
                Drafts open · Season starts Oct 8
              </span>
            </div>
            <h1 className="font-sans font-black text-[3rem] sm:text-[3.75rem] lg:text-[5rem] leading-[0.98] tracking-[-0.03em] text-pastel-cream mb-6">
              Fantasy Hockey<br />
              <span className="text-pastel-orange">2026</span>
            </h1>
            <p className="text-[17px] md:text-[18px] leading-relaxed text-white/65 max-w-md mb-9">
              Play fantasy hockey on a model that scored every shot itself. Draft, manage, and dominate
              your league with a 31-feature xG model trained on every shift.
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-4 mb-10">
              <Link
                to="/create-league"
                className="group inline-flex items-center gap-2 bg-pastel-orange text-[#581E00] text-[15px] font-bold px-7 rounded-md hover:bg-pastel-orange-soft hover:-translate-y-0.5 transition-all duration-200 shadow-[0_8px_24px_-8px_rgba(255,107,26,0.5)]"
                style={{ height: '52px' }}
              >
                <span>Play Now</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" strokeWidth={2.5} />
              </Link>
              <Link
                to="/draft"
                className="inline-flex items-center text-[14px] font-bold text-pastel-cream hover:text-pastel-orange-soft transition-colors px-5 h-13 rounded-md ring-1 ring-white/15 hover:ring-white/30"
                style={{ height: '52px' }}
              >
                Try a mock draft →
              </Link>
            </div>
            {/* No social proof until there is proof. The invented
                "47,000+ MANAGERS drafting on Citrus this season", with a row of
                invented member avatars, was removed 2026-08-26 — these are
                public, crawlable, unauthenticated routes, and a fabricated user
                count is the single worst thing to have on one. */}
          </div>

          {/* RIGHT — League dashboard preview (no projections, no fake phone) */}
          <div className="lg:col-span-6 relative">
            <div className="relative">
              {/* Live game tile */}
              <div className="bg-[#1A2A20] border border-white/10 rounded-2xl p-5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.5)] mb-4 relative">
                <div className="flex items-center justify-between mb-4">
                  <span className="flex items-center gap-1.5">
                    <span className="relative flex w-1.5 h-1.5">
                      <span className="absolute inline-flex w-full h-full bg-pastel-orange rounded-full opacity-75 animate-ping" />
                      <span className="relative inline-flex w-1.5 h-1.5 bg-pastel-orange rounded-full" />
                    </span>
                    <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-orange-soft font-bold">
                      Live · 3rd Period
                    </span>
                  </span>
                  <span className="font-jbmono text-[10px] text-white/55 tabular-nums">12:43</span>
                </div>
                <div className="flex items-baseline justify-between">
                  {LIVE_GAMES.slice(0, 1).map((g) => (
                    <>
                      <div>
                        <div className="font-sans font-black text-[1.75rem] text-pastel-cream leading-none">{g.away}</div>
                        <div className="font-jbmono text-[10px] text-white/50 mt-1 tracking-wider uppercase">Away</div>
                      </div>
                      <div className="font-sans font-black text-[2.5rem] text-pastel-cream tabular-nums leading-none">
                        {g.awayScore}<span className="text-white/55 mx-1">·</span>{g.homeScore}
                      </div>
                      <div className="text-right">
                        <div className="font-sans font-black text-[1.75rem] text-pastel-cream leading-none">{g.home}</div>
                        <div className="font-jbmono text-[10px] text-white/50 mt-1 tracking-wider uppercase">Home</div>
                      </div>
                    </>
                  ))}
                </div>
                <div className="mt-4 h-1 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-pastel-orange rounded-full" style={{ width: '78%' }} />
                </div>
              </div>

              {/* League standings tile */}
              <div className="bg-[#1A2A20] border border-white/10 rounded-2xl shadow-[0_24px_60px_-20px_rgba(0,0,0,0.5)] overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                  <div>
                    <div className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-white/55 font-bold">
                      Sunday Beer League
                    </div>
                    <div className="font-sans font-bold text-[15px] text-pastel-cream mt-0.5">Week 12 Standings</div>
                  </div>
                  <span className="font-jbmono text-[10px] text-pastel-sage tabular-nums">
                    12 managers
                  </span>
                </div>
                <div className="divide-y divide-white/5">
                  {[
                    { rank: 1, team: 'Puckmasters', record: '14-4', pts: 1284 },
                    { rank: 2, team: 'Ice Wizards', record: '13-5', pts: 1198 },
                    { rank: 3, team: 'Hat Trick Heroes', record: '12-6', pts: 1156 },
                    { rank: 4, team: 'Sage Slappers', record: '11-7', pts: 1089 },
                  ].map((t) => (
                    <div key={t.team} className="flex items-center gap-4 px-5 py-3 hover:bg-white/5 transition-colors">
                      <span className={`font-sans font-black text-[14px] w-5 ${t.rank <= 3 ? 'text-pastel-orange' : 'text-white/55'}`}>{t.rank}</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-sans font-semibold text-[14px] text-pastel-cream truncate">{t.team}</div>
                        <div className="font-jbmono text-[10px] text-white/55 mt-0.5">{t.record}</div>
                      </div>
                      <span className="font-jbmono text-[14px] font-bold text-pastel-cream tabular-nums">
                        {t.pts.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="px-5 py-3 border-t border-white/10 bg-white/[0.02]">
                  <div className="flex items-center justify-between font-jbmono text-[10px] text-white/55 tracking-wide">
                    <span>League chat · 14 new messages</span>
                    <span className="text-pastel-sage">Open league →</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* "Popular on Citrus" — game mode carousel like Sleeper */}
      <section className="relative max-w-[1280px] mx-auto px-6 pb-20">
        <div className="flex items-baseline justify-between mb-8 gap-4 flex-wrap">
          <div>
            <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft mb-2 font-bold">
              Popular on Citrus
            </div>
            <h2 className="font-sans font-black text-[2.25rem] md:text-[2.75rem] tracking-[-0.025em] text-pastel-cream leading-tight">
              Every way to play hockey.
            </h2>
          </div>
          <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-white/55">
            Scroll for more →
          </span>
        </div>

        <div className="flex gap-4 overflow-x-auto pb-4 -mx-6 px-6 snap-x snap-mandatory">
          {GAME_MODES.map((g) => {
            const Icon = g.icon;
            return (
              <article
                key={g.label}
                className="flex-shrink-0 w-[300px] snap-start bg-[#1A2A20] border border-white/10 rounded-2xl p-6 hover:border-pastel-orange/40 hover:-translate-y-1 transition-all"
              >
                <div className="flex items-center justify-between mb-5">
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center ring-1 ${ACCENT_BG[g.accent]}`}>
                    <Icon className="w-5 h-5" strokeWidth={2} />
                  </div>
                  <span className={`px-2.5 py-1 rounded-md font-jbmono text-[9px] tracking-wider uppercase font-bold ring-1 ${ACCENT_BG[g.accent]}`}>
                    {g.badge}
                  </span>
                </div>
                <div className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-white/55 mb-2">
                  {g.label}
                </div>
                <h3 className="font-sans font-bold text-[1.25rem] leading-snug text-pastel-cream mb-3">
                  {g.headline}
                </h3>
                <p className="text-[13px] text-white/60 leading-relaxed mb-5 min-h-[60px]">
                  {g.body}
                </p>
                <div className="flex items-center justify-between">
                  <span className="font-jbmono text-[10px] tracking-wider uppercase text-white/55">
                    {g.seasonal}
                  </span>
                  <button className="inline-flex items-center gap-1.5 bg-pastel-orange text-[#581E00] px-4 h-9 rounded-md text-[12px] font-bold hover:bg-pastel-orange-soft transition-colors">
                    Play <ArrowRight className="w-3 h-3" strokeWidth={2.5} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* Final CTA banner */}
      <section className="relative max-w-[1280px] mx-auto px-6 pb-20">
        <div className="bg-gradient-to-br from-[#1A2A20] to-[#0F1F15] border border-white/10 rounded-[28px] p-10 md:p-14 text-center relative overflow-hidden">
          <div
            aria-hidden="true"
            className="absolute -top-20 -right-20 w-[400px] h-[400px] rounded-full opacity-30 blur-3xl"
            style={{ background: 'radial-gradient(circle, #FF6B1A 0%, transparent 70%)' }}
          />
          <div className="relative">
            <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft mb-3 font-bold flex items-center justify-center gap-2">
              <span className="relative flex w-1.5 h-1.5">
                <span className="absolute inline-flex w-full h-full bg-pastel-orange rounded-full opacity-75 animate-ping" />
                <span className="relative inline-flex w-1.5 h-1.5 bg-pastel-orange rounded-full" />
              </span>
              {/* was: "7 Games Tonight · Puck drops at 7pm ET" — a static string
                  under a live pulse. Removed 2026-08-26. */}
              Built for the 2026-27 season
            </div>
            <h2 className="font-sans font-black text-[2.5rem] md:text-[3.5rem] leading-[1] tracking-[-0.03em] mb-5 text-pastel-cream">
              Your league is <span className="text-pastel-orange">waiting</span>.
            </h2>
            <p className="text-[16px] text-white/60 max-w-md mx-auto mb-8">
              Free to play. Built by hockey fans, for hockey fans.
            </p>
            <Link
              to="/create-league"
              className="inline-flex items-center gap-2 bg-pastel-orange text-[#581E00] text-[15px] font-bold px-7 rounded-md hover:bg-white hover:text-[#0F1F15] transition-colors shadow-[0_8px_24px_-8px_rgba(255,107,26,0.5)]"
              style={{ height: '52px' }}
            >
              <span>Create your league</span>
              <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 bg-black/30 relative">
        <div className="max-w-[1280px] mx-auto px-6 py-12 grid grid-cols-2 md:grid-cols-4 gap-8 text-[13px]">
          <div>
            <div className="font-calistoga text-[20px] text-pastel-cream mb-3">Citrus</div>
            <p className="text-white/55 text-[12px] leading-relaxed">
              Fantasy hockey, freshly squeezed. Made in California.
            </p>
          </div>
          {[
            { title: 'Play', links: ['Fantasy Hockey', 'Pickem', 'Survivor', 'Mock Draft'] },
            { title: 'Tools', links: ['Projections', 'Live Scores', 'Stormy AI', 'Trade Analyzer'] },
            { title: 'Citrus', links: ['About', 'Privacy', 'Terms'] },
          ].map((col) => (
            <div key={col.title}>
              <div className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-white/55 mb-3 font-bold">
                {col.title}
              </div>
              <ul className="space-y-2">
                {col.links.map((l) => (
                  <li key={l}>
                    <a href="#" className="text-white/70 hover:text-pastel-orange-soft transition-colors">
                      {l}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-t border-white/5 py-5 text-center font-jbmono text-[10px] tracking-[0.22em] uppercase text-white/55">
          © 2026 Citrus Fantasy Sports
        </div>
      </footer>
    </div>
  );
}
