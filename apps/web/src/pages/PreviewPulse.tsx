import { Link } from 'react-router-dom';
import { ArrowRight, Bell, Activity, Zap } from 'lucide-react';

const NAV = ['Live', 'Leagues', 'Projections', 'Stormy AI'];

const LIVE_GAMES = [
  { away: 'NTH', home: 'SOU', awayScore: 3, homeScore: 2, period: '2nd', time: '14:15', tone: 'sage' },
  { away: 'EDM', home: 'CAL', awayScore: 1, homeScore: 1, period: '3rd', time: '18:30', tone: 'orange' },
  { away: 'TOR', home: 'MTL', awayScore: 4, homeScore: 4, period: '3rd', time: '02:18', tone: 'sage' },
  { away: 'BOS', home: 'NYR', awayScore: 0, homeScore: 1, period: '1st', time: '08:42', tone: 'butter' },
];

const ALERTS = [
  { time: '7:14', msg: 'McDavid scores his 2nd goal · +6 pts', tone: 'orange' },
  { time: '7:09', msg: 'Shesterkin pulled · streamer alert', tone: 'sage' },
  { time: '7:02', msg: 'Makar back from injury · added to lineup', tone: 'butter' },
];

const TONE_BG: Record<string, string> = {
  sage: 'bg-pastel-sage-soft',
  orange: 'bg-pastel-peach',
  butter: 'bg-pastel-butter',
};

export default function PreviewPulse() {
  return (
    <div
      className="min-h-screen text-pastel-forest"
      style={{
        background:
          'linear-gradient(180deg, #E8EED9 0%, #FFF8F0 50%, #F2EEDA 100%)',
      }}
    >
      {/* Nav */}
      <header className="sticky top-0 z-page-header backdrop-blur-md bg-white/55 border-b border-white/60">
        <div className="max-w-[1240px] mx-auto px-6 h-16 flex items-center justify-between gap-6">
          <Link to="/preview-pulse" className="flex items-center gap-1.5">
            <span className="font-calistoga text-[24px] leading-none text-pastel-forest">Citrus</span>
            <span aria-hidden="true" className="block w-1.5 h-1.5 bg-pastel-orange rounded-full animate-pulse" />
          </Link>
          <nav className="hidden md:flex items-center gap-7">
            {NAV.map((label) => (
              <a
                key={label}
                href="#"
                className="text-[14px] font-medium text-pastel-forest-soft hover:text-pastel-forest transition-colors"
              >
                {label}
              </a>
            ))}
          </nav>
          <Link
            to="/create-league"
            className="text-[13px] font-semibold px-4 h-10 inline-flex items-center bg-pastel-orange text-[#581E00] hover:bg-pastel-orange-soft rounded-full transition-colors shadow-[0_4px_0_0_rgba(192,74,14,0.25)]"
          >
            Get the App
          </Link>
        </div>
      </header>

      {/* HERO */}
      <section className="max-w-[1240px] mx-auto px-6 pt-16 lg:pt-24 pb-20">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          {/* LEFT — copy */}
          <div className="lg:col-span-6">
            <div className="inline-flex items-center gap-2 mb-7 px-3.5 py-1.5 rounded-full bg-pastel-orange/10 ring-1 ring-pastel-orange/30">
              <span className="relative flex w-2 h-2">
                <span className="absolute inline-flex w-full h-full bg-pastel-orange rounded-full opacity-75 animate-ping" />
                <span className="relative inline-flex w-2 h-2 bg-pastel-orange rounded-full" />
              </span>
              <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-orange-deep leading-none font-semibold">
                7 games live now
              </span>
            </div>
            <h1 className="font-sans font-bold text-[3rem] sm:text-[3.75rem] lg:text-[4.75rem] leading-[1.02] tracking-[-0.025em] text-pastel-forest mb-6">
              Watch your<br />
              week, <em className="font-calistoga not-italic font-normal text-pastel-orange-deep">live</em>.
            </h1>
            <p className="text-[17px] md:text-[18px] leading-relaxed text-pastel-forest-soft max-w-md mb-8">
              Real-time projections that update as the goals go in. Shift-level scoring, line
              changes, scratch alerts. Everything you need, the second it matters.
            </p>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-4 mb-10">
              <Link
                to="/create-league"
                className="group inline-flex items-center gap-2 bg-pastel-forest text-pastel-cream text-[15px] font-semibold pl-7 pr-6 rounded-full hover:bg-pastel-orange-soft hover:-translate-y-0.5 transition-all duration-200 shadow-[0_8px_24px_-8px_rgba(27,48,34,0.4)]"
                style={{ height: '52px' }}
              >
                <span>Watch tonight</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" strokeWidth={2.5} />
              </Link>
              <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-forest-dim">
                Updates every 4 seconds
              </span>
            </div>

            {/* Inline live alert ticker */}
            <div className="bg-white/70 backdrop-blur-md ring-1 ring-pastel-sage/30 rounded-2xl p-4">
              <div className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-forest-soft mb-3 flex items-center gap-2">
                <Bell className="w-3 h-3" strokeWidth={2.25} />
                Smart alerts · last 12 minutes
              </div>
              <div className="space-y-2">
                {ALERTS.map((a) => (
                  <div key={a.msg} className="flex items-center gap-3 text-[13px]">
                    <span className="font-jbmono text-[11px] text-pastel-forest-dim tabular-nums w-10">
                      {a.time}
                    </span>
                    <span
                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        a.tone === 'orange'
                          ? 'bg-pastel-orange'
                          : a.tone === 'sage'
                          ? 'bg-pastel-sage'
                          : 'bg-[#D9C988]'
                      }`}
                    />
                    <span className="text-pastel-forest leading-snug">{a.msg}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* RIGHT — phone hero */}
          <div className="lg:col-span-6 relative">
            <div
              aria-hidden="true"
              className="absolute inset-0 -m-8 rounded-full opacity-40 blur-3xl"
              style={{ background: 'radial-gradient(circle, #FFB591 0%, transparent 60%)' }}
            />
            <img
              src="/mockups/pulse-phone-hero.jpg"
              alt=""
              aria-hidden="true"
              className="relative w-full max-w-[520px] mx-auto rounded-[32px] animate-float-slow drop-shadow-[0_30px_50px_rgba(27,48,34,0.2)]"
              loading="eager"
            />
          </div>
        </div>
      </section>

      {/* LIVE SCOREBOARD GRID */}
      <section className="max-w-[1240px] mx-auto px-6 pb-20">
        <div className="flex items-baseline justify-between mb-6 gap-4 flex-wrap">
          <div>
            <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-deep mb-1 flex items-center gap-2">
              <span className="relative flex w-1.5 h-1.5">
                <span className="absolute inline-flex w-full h-full bg-pastel-orange rounded-full opacity-75 animate-ping" />
                <span className="relative inline-flex w-1.5 h-1.5 bg-pastel-orange rounded-full" />
              </span>
              Live · Right now
            </div>
            <h2 className="font-sans font-bold text-[2.25rem] md:text-[2.5rem] tracking-[-0.02em] text-pastel-forest leading-tight">
              Tonight's slate, second by second.
            </h2>
          </div>
          <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-forest-soft">
            Updated 4s ago · 31 features
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {LIVE_GAMES.map((g, i) => (
            <article
              key={`${g.away}-${g.home}`}
              className={`${TONE_BG[g.tone]} rounded-[20px] p-5 ring-1 ring-pastel-forest/[0.08] hover:-translate-y-0.5 transition-all`}
            >
              <div className="flex items-center justify-between mb-4">
                <span className="flex items-center gap-1.5">
                  <span className="relative flex w-1.5 h-1.5">
                    <span className="absolute inline-flex w-full h-full bg-pastel-orange rounded-full opacity-75 animate-ping" />
                    <span className="relative inline-flex w-1.5 h-1.5 bg-pastel-orange rounded-full" />
                  </span>
                  <span className="font-jbmono text-[9px] tracking-[0.22em] uppercase text-pastel-orange-deep font-semibold">
                    Live
                  </span>
                </span>
                <span className="font-jbmono text-[10px] tracking-wider text-pastel-forest-dim tabular-nums">
                  {g.period} · {g.time}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="font-calistoga text-[1.5rem] text-pastel-forest leading-none">{g.away}</div>
                  <div className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-forest-soft mt-1">
                    Away
                  </div>
                </div>
                <div className="font-sans font-bold text-[2.25rem] text-pastel-forest tabular-nums leading-none">
                  {g.awayScore}<span className="text-pastel-forest-dim">·</span>{g.homeScore}
                </div>
                <div className="text-right">
                  <div className="font-calistoga text-[1.5rem] text-pastel-forest leading-none">{g.home}</div>
                  <div className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-forest-soft mt-1">
                    Home
                  </div>
                </div>
              </div>
              {/* Period progress bar */}
              <div className="mt-5 h-1 bg-white/60 rounded-full overflow-hidden">
                <div
                  className="h-full bg-pastel-orange rounded-full"
                  style={{ width: `${30 + i * 18}%` }}
                />
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* THREE FEATURE BLOCKS */}
      <section className="max-w-[1240px] mx-auto px-6 pb-20 grid grid-cols-1 md:grid-cols-3 gap-5">
        {[
          {
            icon: Activity,
            label: 'Shift-level scoring',
            body: 'Every shot, hit, block, and faceoff updates your score in under 4 seconds. Watch points roll in as the play unfolds.',
          },
          {
            icon: Bell,
            label: 'Smart alerts',
            body: 'Get pinged when your starter scores, when a goalie gets pulled, or when an injured stash is worth a waiver claim.',
          },
          {
            icon: Zap,
            label: 'Live re-projection',
            body: "Lineup changes, scratches, line shuffles. Our model re-runs your matchup in real time. No refresh required.",
          },
        ].map((f) => {
          const Icon = f.icon;
          return (
            <div
              key={f.label}
              className="bg-white/70 backdrop-blur-md ring-1 ring-pastel-sage/30 rounded-[24px] p-7"
            >
              <div className="w-11 h-11 rounded-2xl bg-pastel-sage-soft flex items-center justify-center text-pastel-forest mb-5">
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

      {/* Final CTA */}
      <section className="max-w-[1240px] mx-auto px-6 pb-20">
        <div className="bg-pastel-forest text-pastel-cream rounded-[28px] p-10 md:p-14 text-center relative overflow-hidden">
          <div
            aria-hidden="true"
            className="absolute -top-20 -left-20 w-[300px] h-[300px] rounded-full opacity-40 blur-3xl"
            style={{ background: 'radial-gradient(circle, #FF6B1A 0%, transparent 70%)' }}
          />
          <div className="relative">
            <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-cream/70 mb-3 flex items-center justify-center gap-2">
              <span className="relative flex w-1.5 h-1.5">
                <span className="absolute inline-flex w-full h-full bg-pastel-orange rounded-full opacity-75 animate-ping" />
                <span className="relative inline-flex w-1.5 h-1.5 bg-pastel-orange rounded-full" />
              </span>
              7 Games · Puck drops at 7pm ET
            </div>
            <h2 className="font-sans font-bold text-[2.5rem] md:text-[3.25rem] leading-[1.05] tracking-[-0.025em] mb-5">
              Don't watch a recap.<br />
              Watch it{' '}
              <em className="font-calistoga not-italic font-normal text-pastel-orange-soft">happen</em>.
            </h2>
            <Link
              to="/create-league"
              className="inline-flex items-center gap-2 bg-pastel-orange text-[#581E00] text-[15px] font-semibold pl-7 pr-6 rounded-full hover:bg-white hover:text-pastel-forest transition-colors shadow-[0_8px_24px_-8px_rgba(255,107,26,0.5)]"
              style={{ height: '52px' }}
            >
              <span>Get the App</span>
              <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-pastel-sage/30 py-8 text-center">
        <div className="font-calistoga text-[18px] text-pastel-forest mb-1">Citrus</div>
        <div className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-forest-dim">
          © 2026 · Made in California with sage and sunshine
        </div>
      </footer>
    </div>
  );
}
