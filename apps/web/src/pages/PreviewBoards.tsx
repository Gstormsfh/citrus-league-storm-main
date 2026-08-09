import { Link } from 'react-router-dom';
import { ArrowRight, Activity, Trophy, Sparkles, Users } from 'lucide-react';

const NAV = ['Scores', 'Fantasy', 'Picks', 'AI'];

const STORMY_THREAD = [
  { from: 'you', text: "Who do I start at LW between Pastrnak and Marchand tonight?" },
  {
    from: 'stormy',
    text: "Pastrnak. He's projecting 8.4 vs Marchand's 6.9 — Boston has a softer matchup against NJD, and Pastrnak's xG is +18% over his season baseline this week.",
  },
];

// Decorative rink-board wave divider — between dark and cream sections
function BoardsDivider() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 1440 80"
      preserveAspectRatio="none"
      className="block w-full h-12 md:h-16"
    >
      <rect x="0" y="0" width="1440" height="6" fill="#F4C430" />
      <rect x="0" y="6" width="1440" height="2" fill="#FF6B1A" />
      <path
        d="M 0 8 Q 360 80 720 40 T 1440 8 L 1440 80 L 0 80 Z"
        fill="#FFF8F0"
      />
    </svg>
  );
}

export default function PreviewBoards() {
  return (
    <div className="min-h-screen bg-[#FFF8F0] text-pastel-forest relative overflow-x-hidden">
      {/* DARK FOREST TOP HALF */}
      <div className="relative bg-[#0F1F15] text-pastel-cream pb-20">
        {/* Atmospheric orange glow */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-40 -right-40 w-[600px] h-[600px] rounded-full opacity-25 blur-3xl"
          style={{ background: 'radial-gradient(circle, #FF6B1A 0%, transparent 70%)' }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-[20%] -left-40 w-[500px] h-[500px] rounded-full opacity-15 blur-3xl"
          style={{ background: 'radial-gradient(circle, #84A57D 0%, transparent 70%)' }}
        />

        {/* Nav */}
        <header className="sticky top-0 z-40 backdrop-blur-md bg-[#0F1F15]/85 border-b border-white/5">
          <div className="max-w-[1280px] mx-auto px-6 h-16 flex items-center justify-between gap-6">
            <Link to="/preview-boards" className="flex items-center gap-1.5">
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
            <Link
              to="/create-league"
              className="text-[13px] font-bold px-4 h-10 inline-flex items-center bg-pastel-orange text-[#581E00] hover:bg-pastel-orange-soft rounded-md transition-colors"
            >
              Get the App
            </Link>
          </div>
        </header>

        {/* HERO */}
        <section className="relative max-w-[1280px] mx-auto px-6 pt-20 lg:pt-28 pb-12 text-center">
          <div className="inline-flex items-center gap-2 mb-8 px-3.5 py-1.5 rounded-md bg-pastel-orange/15 ring-1 ring-pastel-orange/30">
            <span className="relative flex w-1.5 h-1.5">
              <span className="absolute inline-flex w-full h-full bg-pastel-orange rounded-full opacity-75 animate-ping" />
              <span className="relative inline-flex w-1.5 h-1.5 bg-pastel-orange rounded-full" />
            </span>
            <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-orange-soft leading-none font-bold">
              Saturday · 7 games · Puck drops 7pm ET
            </span>
          </div>
          <h1 className="font-sans font-black text-[3rem] sm:text-[4.25rem] lg:text-[5.75rem] leading-[0.95] tracking-[-0.035em] text-pastel-cream mb-6 max-w-5xl mx-auto">
            The fantasy hockey<br />
            <span className="text-pastel-orange">platform</span> for hockey heads.
          </h1>
          <p className="text-[17px] md:text-[19px] leading-relaxed text-white/65 max-w-xl mx-auto mb-10">
            31-feature xG model. Real-time shift-level scoring. League chat that actually works.
            Built by hockey fans, for hockey fans.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-4">
            <Link
              to="/create-league"
              className="group inline-flex items-center gap-2 bg-pastel-orange text-[#581E00] text-[15px] font-bold px-8 rounded-md hover:bg-pastel-orange-soft hover:-translate-y-0.5 transition-all duration-200 shadow-[0_8px_32px_-8px_rgba(255,107,26,0.5)]"
              style={{ height: '54px' }}
            >
              <span>Play Now</span>
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

          {/* Social proof */}
          <div className="mt-12 inline-flex items-center gap-3">
            <div className="flex -space-x-2">
              {['JK', 'AM', 'SD', 'TR', 'MV'].map((init, i) => (
                <div
                  key={init}
                  className="w-9 h-9 rounded-full bg-pastel-sage/30 ring-2 ring-[#0F1F15] flex items-center justify-center font-jbmono text-[10px] font-bold text-pastel-cream"
                  style={{ zIndex: 5 - i }}
                >
                  {init}
                </div>
              ))}
            </div>
            <div className="text-left">
              <div className="font-jbmono text-[11px] tracking-wider uppercase text-pastel-cream font-bold">
                47,000+ MANAGERS
              </div>
              <div className="font-jbmono text-[10px] text-white/45">
                drafting on Citrus this season
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* RINK BOARDS DIVIDER */}
      <BoardsDivider />

      {/* CREAM DASHBOARD-PREVIEW BOTTOM HALF */}
      <div className="relative pb-20">
        {/* TWO-UP: Stormy AI chat + League standings preview */}
        <section className="relative max-w-[1280px] mx-auto px-6 pt-12 pb-16">
          <div className="flex items-baseline justify-between mb-8 gap-4 flex-wrap">
            <div>
              <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-deep mb-2 font-bold">
                Live in the product
              </div>
              <h2 className="font-sans font-black text-[2.25rem] md:text-[2.75rem] tracking-[-0.025em] text-pastel-forest leading-tight">
                Your league, in real time.
              </h2>
            </div>
            <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-forest-soft">
              Stormy AI · League chat · Live standings
            </span>
          </div>
        </section>

        <section className="relative max-w-[1280px] mx-auto px-6 pb-16 grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Stormy AI chat */}
          <div className="bg-white rounded-3xl border border-pastel-sage/30 shadow-[0_24px_60px_-24px_rgba(27,48,34,0.18)] overflow-hidden">
            <div className="flex items-center gap-3 px-6 py-4 border-b border-pastel-sage/30 bg-pastel-orange/8">
              <div className="w-9 h-9 rounded-full bg-pastel-orange flex items-center justify-center text-white">
                <Sparkles className="w-4 h-4" strokeWidth={2.5} />
              </div>
              <div className="flex-1">
                <div className="font-sans font-bold text-[14px] text-pastel-forest">Stormy AI</div>
                <div className="font-jbmono text-[10px] text-pastel-forest-dim">Trained on tonight's slate</div>
              </div>
              <span className="font-jbmono text-[10px] tracking-wider uppercase text-pastel-orange-deep font-bold">
                Online
              </span>
            </div>
            <div className="p-6 space-y-4">
              {STORMY_THREAD.map((m, i) => (
                <div key={i} className={`flex gap-3 ${m.from === 'you' ? 'justify-end' : ''}`}>
                  {m.from === 'stormy' && (
                    <div className="w-7 h-7 rounded-full bg-pastel-orange flex items-center justify-center text-white flex-shrink-0">
                      <Sparkles className="w-3.5 h-3.5" strokeWidth={2.5} />
                    </div>
                  )}
                  <div
                    className={`max-w-[85%] px-4 py-3 rounded-2xl text-[14px] leading-relaxed ${
                      m.from === 'you'
                        ? 'bg-pastel-forest text-pastel-cream rounded-tr-md'
                        : 'bg-pastel-sage-soft text-pastel-forest rounded-tl-md'
                    }`}
                  >
                    {m.text}
                  </div>
                </div>
              ))}
              <div className="flex items-center gap-2 mt-2">
                <div className="flex-1 bg-pastel-sage-soft/40 rounded-full px-4 py-2.5 text-[13px] text-pastel-forest-dim">
                  Ask Stormy anything...
                </div>
                <button className="w-10 h-10 rounded-full bg-pastel-orange flex items-center justify-center text-white">
                  <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
                </button>
              </div>
            </div>
          </div>

          {/* League standings preview */}
          <div className="bg-white rounded-3xl border border-pastel-sage/30 shadow-[0_24px_60px_-24px_rgba(27,48,34,0.18)] overflow-hidden">
            <div className="flex items-center gap-3 px-6 py-4 border-b border-pastel-sage/30 bg-pastel-sage-soft/40">
              <div className="w-9 h-9 rounded-full bg-pastel-forest flex items-center justify-center text-pastel-cream">
                <Trophy className="w-4 h-4" strokeWidth={2.5} />
              </div>
              <div className="flex-1">
                <div className="font-sans font-bold text-[14px] text-pastel-forest">Sunday Beer League</div>
                <div className="font-jbmono text-[10px] text-pastel-forest-dim">Week 12 · 12 managers</div>
              </div>
              <span className="font-jbmono text-[10px] tracking-wider uppercase text-pastel-forest-soft font-bold">
                Live
              </span>
            </div>
            <div className="divide-y divide-pastel-sage/20">
              {[
                { rank: 1, team: 'Puckmasters', record: '14-4', pts: 1284 },
                { rank: 2, team: 'Ice Wizards', record: '13-5', pts: 1198 },
                { rank: 3, team: 'Hat Trick Heroes', record: '12-6', pts: 1156 },
                { rank: 4, team: 'Sage Slappers', record: '11-7', pts: 1089 },
                { rank: 5, team: 'Citrus Crushers', record: '10-8', pts: 1041 },
                { rank: 6, team: 'Power Play Pals', record: '9-9', pts: 994 },
              ].map((t) => (
                <div key={t.team} className="flex items-center gap-4 px-6 py-3 hover:bg-pastel-sage-soft/15 transition-colors">
                  <span
                    className={`font-sans font-black text-[14px] w-6 ${
                      t.rank <= 3 ? 'text-pastel-orange-deep' : 'text-pastel-forest-dim'
                    }`}
                  >
                    {t.rank}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-sans font-semibold text-[14px] text-pastel-forest truncate">
                      {t.team}
                    </div>
                    <div className="font-jbmono text-[10px] text-pastel-forest-dim mt-0.5">{t.record}</div>
                  </div>
                  <span className="font-jbmono text-[14px] font-bold text-pastel-forest tabular-nums">
                    {t.pts.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Three features */}
        <section className="relative max-w-[1280px] mx-auto px-6 pb-16 grid grid-cols-1 md:grid-cols-3 gap-5">
          {[
            {
              icon: Activity,
              label: 'Shift-level scoring',
              body: 'Watch points roll in as the play unfolds. Updates every 4 seconds during games.',
            },
            {
              icon: Sparkles,
              label: 'Stormy AI',
              body: "Ask anything in plain English. She's read tonight's matchups, your roster, and the model's projections.",
            },
            {
              icon: Users,
              label: 'League chat built in',
              body: 'Message your league, post draft-night reactions, share standings — no Discord required.',
            },
          ].map((f) => {
            const Icon = f.icon;
            return (
              <div
                key={f.label}
                className="bg-white rounded-2xl ring-1 ring-pastel-sage/30 p-7"
              >
                <div className="w-11 h-11 rounded-xl bg-pastel-sage-soft flex items-center justify-center text-pastel-forest mb-5">
                  <Icon className="w-5 h-5" strokeWidth={2} />
                </div>
                <h3 className="font-sans font-bold text-[1.25rem] leading-snug text-pastel-forest mb-3">
                  {f.label}
                </h3>
                <p className="text-[14px] text-pastel-forest-soft leading-relaxed">{f.body}</p>
              </div>
            );
          })}
        </section>

        {/* Final CTA — back on dark */}
        <section className="relative max-w-[1280px] mx-auto px-6">
          <div className="bg-[#0F1F15] text-pastel-cream rounded-[28px] p-10 md:p-14 text-center relative overflow-hidden">
            <div
              aria-hidden="true"
              className="absolute -top-20 -right-20 w-[400px] h-[400px] rounded-full opacity-30 blur-3xl"
              style={{ background: 'radial-gradient(circle, #FF6B1A 0%, transparent 70%)' }}
            />
            <div className="relative">
              <h2 className="font-sans font-black text-[2.5rem] md:text-[3.5rem] leading-[1] tracking-[-0.03em] mb-5">
                Drop the puck.
              </h2>
              <p className="text-[16px] text-white/60 max-w-md mx-auto mb-8">
                Free league. 30-second draft setup. The most accurate fantasy hockey on the planet.
              </p>
              <Link
                to="/create-league"
                className="inline-flex items-center gap-2 bg-pastel-orange text-[#581E00] text-[15px] font-bold px-8 rounded-md hover:bg-white hover:text-[#0F1F15] transition-colors shadow-[0_8px_32px_-8px_rgba(255,107,26,0.5)]"
                style={{ height: '54px' }}
              >
                <span>Create your league</span>
                <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
              </Link>
            </div>
          </div>
        </section>
      </div>

      {/* Footer */}
      <footer className="border-t border-pastel-sage/30 py-8 text-center bg-white">
        <div className="font-calistoga text-[18px] text-pastel-forest mb-1">Citrus</div>
        <div className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-forest-dim">
          © 2026 · Built for hockey, painted in citrus
        </div>
      </footer>
    </div>
  );
}
