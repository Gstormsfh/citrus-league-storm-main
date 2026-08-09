import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

const NAV_LINKS = ['Tonight', 'Standings', 'Almanac', 'About'];

const SPECIMENS = [
  { initials: 'CM', name: 'McDavid', team: 'EDM', pos: 'C', proj: 9.4, tone: 'orange' },
  { initials: 'AM', name: 'Matthews', team: 'TOR', pos: 'C', proj: 8.7, tone: 'sage' },
  { initials: 'NM', name: 'MacKinnon', team: 'COL', pos: 'C', proj: 8.6, tone: 'butter' },
  { initials: 'LD', name: 'Draisaitl', team: 'EDM', pos: 'C', proj: 8.1, tone: 'sage' },
  { initials: 'CM', name: 'Makar', team: 'COL', pos: 'D', proj: 7.2, tone: 'orange' },
  { initials: 'IS', name: 'Shesterkin', team: 'NYR', pos: 'G', proj: 12.4, tone: 'butter' },
];

const STAMPS = [
  '★ CITRUS HOCKEY CO.',
  'EST. 2025',
  'CALIFORNIA',
  '★ PREMIUM FANTASY HOCKEY',
  'BOTTLED WITH LOVE',
  '★ 31-FEATURE xG MODEL',
];

const TONE_BG: Record<string, string> = {
  sage: 'bg-pastel-sage-soft',
  butter: 'bg-[#F4E5B8]',
  orange: 'bg-pastel-peach',
};

const TONE_RING: Record<string, string> = {
  sage: 'ring-pastel-sage',
  butter: 'ring-[#D9C988]',
  orange: 'ring-pastel-peach-deep',
};

export default function PreviewPress() {
  return (
    <div
      className="min-h-screen text-pastel-forest"
      style={{
        background:
          "#FBF6E8 url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200' viewBox='0 0 200 200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.92' numOctaves='2'/%3E%3CfeColorMatrix values='0 0 0 0 0.106  0 0 0 0 0.188  0 0 0 0 0.133  0 0 0 0.04 0'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)'/%3E%3C/svg%3E\")",
      }}
    >
      {/* Top stamp ribbon */}
      <div className="border-y-2 border-dashed border-pastel-forest/30 bg-pastel-sage-soft/50 overflow-hidden">
        <div className="max-w-[1240px] mx-auto px-6 py-2 flex items-center justify-center gap-4 md:gap-6 font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-forest/70 flex-wrap">
          {STAMPS.map((s) => (
            <span key={s} className="whitespace-nowrap">{s}</span>
          ))}
        </div>
      </div>

      {/* Nav */}
      <header className="max-w-[1240px] mx-auto px-6 pt-6 pb-4 flex items-center justify-between gap-6 flex-wrap">
        <Link to="/preview-press" className="flex items-center gap-2">
          <span className="font-calistoga text-[28px] leading-none text-pastel-forest">Citrus</span>
          <span className="font-jbmono text-[9px] tracking-[0.32em] uppercase text-pastel-forest-soft border border-pastel-forest/30 px-1.5 py-0.5">
            Hockey Co.
          </span>
        </Link>
        <nav className="hidden md:flex items-center gap-7 font-jbmono text-[10px] tracking-[0.32em] uppercase">
          {NAV_LINKS.map((label) => (
            <a
              key={label}
              href="#"
              className="text-pastel-forest hover:text-pastel-orange-deep transition-colors"
            >
              {label}
            </a>
          ))}
        </nav>
        <Link
          to="/auth"
          className="rounded-full px-5 h-10 inline-flex items-center font-medium text-[13px] bg-pastel-orange text-[#581E00] hover:bg-pastel-orange-soft transition-colors shadow-[0_3px_0_0_rgba(192,74,14,0.3)]"
        >
          Sign in
        </Link>
      </header>

      {/* Hero */}
      <section className="max-w-[1240px] mx-auto px-6 pt-6 pb-16 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT — crate label tile */}
        <div className="lg:col-span-7">
          <div className="bg-pastel-sage-soft rounded-[24px] p-5 md:p-6 ring-2 ring-pastel-forest/15 shadow-[0_8px_0_0_rgba(27,48,34,0.08)]">
            <img
              src="/mockups/press-crate-label.jpg"
              alt=""
              aria-hidden="true"
              className="w-full rounded-[18px] block animate-float-slow"
              loading="eager"
            />
          </div>
        </div>

        {/* RIGHT — copy + CTA */}
        <div className="lg:col-span-5 flex flex-col justify-center">
          <div className="flex items-center gap-2 mb-4">
            <span className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-deep">
              ★ Tonight's Slate
            </span>
            <span className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-forest-soft">
              7 Games · 168 Skaters
            </span>
          </div>
          <h1 className="font-calistoga text-[3rem] sm:text-[3.75rem] lg:text-[4.5rem] leading-[0.98] text-pastel-forest mb-5 tracking-[-0.005em]">
            Hand-pressed<br />
            fantasy hockey.
          </h1>
          <p className="text-[17px] text-pastel-forest-soft leading-relaxed mb-8 max-w-md">
            A 31-feature xG model. Live shift-level data. Projections you can serve to your league
            chat with confidence — bottled fresh every morning.
          </p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
            <Link
              to="/create-league"
              className="group inline-flex items-center gap-2 bg-pastel-orange text-[#581E00] text-[15px] font-semibold pl-6 pr-5 h-12 rounded-full shadow-[0_4px_0_0_rgba(192,74,14,0.4)] hover:shadow-[0_6px_0_0_rgba(192,74,14,0.4)] hover:-translate-y-0.5 transition-all duration-200"
            >
              <span>Start a Test League</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" strokeWidth={2.5} />
            </Link>
            <a
              href="#specimens"
              className="font-jbmono text-[11px] tracking-[0.22em] uppercase text-pastel-forest hover:text-pastel-orange-deep transition-colors group"
            >
              See tonight's specimens{' '}
              <span className="inline-block group-hover:translate-x-0.5 transition-transform">→</span>
            </a>
          </div>

          {/* Decorative stat ribbon */}
          <div className="mt-10 inline-flex items-stretch self-start divide-x-2 divide-dashed divide-pastel-forest/25 bg-pastel-cream-warm rounded-lg ring-1 ring-pastel-forest/10 overflow-hidden">
            {[
              { v: '31', l: 'Features' },
              { v: '1.2K', l: 'Sims' },
              { v: '2.4%', l: 'Error' },
            ].map((s) => (
              <div key={s.l} className="px-5 py-3">
                <div className="font-calistoga text-[1.5rem] leading-none text-pastel-forest tabular-nums">
                  {s.v}
                </div>
                <div className="font-jbmono text-[9px] tracking-[0.22em] uppercase text-pastel-forest-dim mt-1">
                  {s.l}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Tonight's specimens — vintage label tile grid */}
      <section id="specimens" className="max-w-[1240px] mx-auto px-6 pb-20">
        <div className="flex items-baseline justify-between mb-8 pb-4 border-b-2 border-dashed border-pastel-forest/25 gap-4 flex-wrap">
          <div>
            <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-deep mb-1">
              ★ Section II
            </div>
            <h2 className="font-calistoga text-[2.5rem] text-pastel-forest leading-tight">
              Tonight's Specimens
            </h2>
          </div>
          <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-forest-soft">
            31 features · 1,247 sims · Hand picked
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {SPECIMENS.map((p) => (
            <article
              key={p.name}
              className={`relative ${TONE_BG[p.tone]} rounded-[20px] p-5 ring-2 ${TONE_RING[p.tone]}/40 shadow-[0_4px_0_0_rgba(27,48,34,0.08)] hover:-translate-y-1 hover:shadow-[0_8px_0_0_rgba(27,48,34,0.1)] transition-all`}
            >
              {/* Decorative corner stamps */}
              <div className="absolute top-3 right-3 font-jbmono text-[9px] tracking-[0.22em] uppercase text-pastel-forest/55">
                ★ #{SPECIMENS.indexOf(p) + 1}
              </div>

              <div className="flex items-center gap-4 mb-5">
                <div className="w-14 h-14 rounded-full bg-white ring-2 ring-pastel-forest/15 flex items-center justify-center font-calistoga text-[18px] text-pastel-forest flex-shrink-0">
                  {p.initials}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-calistoga text-[22px] leading-tight text-pastel-forest truncate">
                    {p.name}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="font-jbmono text-[9px] tracking-[0.22em] uppercase text-pastel-forest-soft">
                      {p.team}
                    </span>
                    <span className="font-jbmono text-[9px] text-pastel-forest/30">·</span>
                    <span className="font-jbmono text-[9px] tracking-[0.22em] uppercase text-pastel-forest-soft">
                      {p.pos}
                    </span>
                  </div>
                </div>
              </div>

              {/* Stat ribbon */}
              <div className="bg-white/70 rounded-lg px-4 py-3 ring-1 ring-pastel-forest/10 flex items-center justify-between">
                <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-forest-dim">
                  Tonight
                </span>
                <span className="font-calistoga text-[1.65rem] leading-none text-pastel-forest tabular-nums">
                  {p.proj.toFixed(1)}
                </span>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Footer ribbon */}
      <div className="border-t-2 border-dashed border-pastel-forest/30 bg-pastel-cream-warm">
        <div className="max-w-[1240px] mx-auto px-6 py-8 text-center">
          <div className="font-calistoga text-[1.5rem] text-pastel-forest mb-1">Citrus Hockey Co.</div>
          <p className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-forest-soft">
            ★ Est. 2025 · California · Made with sage and sunshine ★
          </p>
        </div>
      </div>
    </div>
  );
}
