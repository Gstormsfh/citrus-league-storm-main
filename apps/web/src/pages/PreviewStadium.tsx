import { Link } from 'react-router-dom';
import { ArrowRight, Zap, Trophy, Sparkles, Activity } from 'lucide-react';

const NAV = [
  { label: 'Leagues', href: '#leagues' },
  { label: 'Projections', href: '#projections' },
  { label: 'Live Scores', href: '#live' },
  { label: 'Stormy AI', href: '#stormy' },
];

const PRODUCT_CARDS = [
  {
    label: 'Fantasy Hockey',
    headline: 'Snake, auction, salary cap.',
    body: 'Run any league format. Commish tools, custom scoring, draft rooms with live chat. The format your league wants, the polish your league deserves.',
    stat: 'Snake, auction or salary cap',
    icon: Trophy,
    bg: 'bg-pastel-sage-soft',
  },
  {
    label: 'Live Projections',
    headline: '31-feature xG, updated every shift.',
    body: 'Floor / median / ceiling for every skater. Range-bar UI tells you who to start. Re-projects after every shift change, line shuffle, scratch.',
    stat: '1.2M sims tonight',
    icon: Activity,
    bg: 'bg-pastel-cream-warm',
  },
  {
    label: 'Saturday Slate',
    headline: 'Your week, finished by Saturday night.',
    body: 'Sunday-to-Saturday weeks mean every league goes the distance. The big slate is when the trophies are decided.',
    stat: 'Weeks end Saturday night',
    icon: Zap,
    bg: 'bg-pastel-butter',
  },
  {
    label: 'Stormy AI',
    headline: "Ask anything. She's read tonight.",
    body: 'Trained on 19,000 sims of tonight\'s slate. "Who do I start at LW?" "Is McDavid worth a streamer drop?" Stormy answers in plain English.',
    stat: 'Available 24/7',
    icon: Sparkles,
    bg: 'bg-pastel-peach',
  },
];

const DRAFT_TYPES = [
  { name: 'Snake', desc: 'Reverses each round. The classic.' },
  { name: 'Auction', desc: 'Bid for who you want. The strategist.' },
  { name: 'Linear', desc: 'Returns to the top each round. The simple.' },
];

export default function PreviewStadium() {
  return (
    <div
      className="min-h-screen text-pastel-forest"
      style={{
        background:
          'linear-gradient(180deg, #E8EED9 0%, #F2EEDA 30%, #FFF8F0 65%, #FFF0DC 100%)',
      }}
    >
      {/* Nav */}
      <header className="sticky top-0 z-page-header backdrop-blur-md bg-white/55 border-b border-white/60">
        <div className="max-w-[1240px] mx-auto px-6 h-16 flex items-center justify-between gap-6">
          <Link to="/preview-stadium" className="flex items-center gap-1.5">
            <span className="font-calistoga text-[24px] leading-none text-pastel-forest">Citrus</span>
            <span aria-hidden="true" className="block w-1.5 h-1.5 bg-pastel-orange rounded-full" />
          </Link>
          <nav className="hidden md:flex items-center gap-7">
            {NAV.map((n) => (
              <a
                key={n.label}
                href={n.href}
                className="text-[14px] font-medium text-pastel-forest-soft hover:text-pastel-forest transition-colors"
              >
                {n.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <Link
              to="/auth"
              className="hidden sm:inline-flex text-[13px] font-medium text-pastel-forest-soft hover:text-pastel-forest transition-colors"
            >
              Sign in
            </Link>
            <Link
              to="/create-league"
              className="text-[13px] font-semibold px-4 h-10 inline-flex items-center bg-pastel-orange text-[#581E00] hover:bg-pastel-orange-soft rounded-full transition-colors shadow-[0_4px_0_0_rgba(192,74,14,0.25)]"
            >
              Get the App
            </Link>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="relative max-w-[1240px] mx-auto px-6 pt-16 lg:pt-24 pb-20">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          {/* LEFT — copy */}
          <div className="lg:col-span-6">
            <div className="inline-flex items-center gap-2 mb-7 px-3.5 py-1.5 rounded-full bg-white/60 ring-1 ring-pastel-sage/40">
              <span className="relative flex w-1.5 h-1.5">
                <span className="absolute inline-flex w-full h-full bg-pastel-sage rounded-full opacity-60 animate-ping" />
                <span className="relative inline-flex w-1.5 h-1.5 bg-pastel-sage rounded-full" />
              </span>
              <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-forest-soft leading-none">
                Draft Open · Season starts Oct 8
              </span>
            </div>
            <h1 className="font-sans font-bold text-[3rem] sm:text-[3.75rem] lg:text-[4.75rem] leading-[1.02] tracking-[-0.025em] text-pastel-forest mb-6">
              Fantasy hockey,<br />
              the way it{' '}
              <em className="font-calistoga not-italic font-normal text-pastel-orange-deep">should be</em>.
            </h1>
            <p className="text-[17px] md:text-[18px] leading-relaxed text-pastel-forest-soft max-w-md mb-8">
              The 31-feature xG model fantasy hockey deserves. Draft, manage, talk smack with
              your league. All in one place, all in one feed.
            </p>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-4 mb-10">
              <Link
                to="/create-league"
                className="group inline-flex items-center gap-2 bg-pastel-forest text-pastel-cream text-[15px] font-semibold pl-7 pr-6 h-13 rounded-full hover:bg-pastel-orange-soft hover:-translate-y-0.5 transition-all duration-200 shadow-[0_8px_24px_-8px_rgba(27,48,34,0.4)]"
                style={{ height: '52px' }}
              >
                <span>Play Now</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" strokeWidth={2.5} />
              </Link>
              <a
                href="#leagues"
                className="text-[14px] font-semibold text-pastel-forest hover:text-pastel-orange-deep transition-colors group"
              >
                See how it works{' '}
                <span className="inline-block group-hover:translate-x-0.5 transition-transform">→</span>
              </a>
            </div>
            {/* No social proof until there is proof. The invented
                "47,000+ managers drafting on Citrus this season", with a row of
                invented member avatars, was removed 2026-08-26 — these are
                public, crawlable, unauthenticated routes, and a fabricated user
                count is the single worst thing to have on one. */}
          </div>

          {/* RIGHT — phone hero */}
          <div className="lg:col-span-6 relative">
            <div
              aria-hidden="true"
              className="absolute inset-0 -m-8 rounded-full opacity-50 blur-3xl"
              style={{ background: 'radial-gradient(circle, #C8DCC4 0%, transparent 60%)' }}
            />
            <img
              src="/mockups/stadium-phone-hero.jpg"
              alt=""
              aria-hidden="true"
              className="relative w-full max-w-[520px] mx-auto rounded-[32px] animate-float-slow drop-shadow-[0_30px_50px_rgba(27,48,34,0.18)]"
              loading="eager"
            />
          </div>
        </div>
      </section>

      {/* "POPULAR ON CITRUS" — feature carousel like Sleeper */}
      <section id="leagues" className="max-w-[1240px] mx-auto px-6 pb-20">
        <div className="flex items-baseline justify-between mb-8 gap-4 flex-wrap">
          <div>
            <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-deep mb-1">
              Popular on Citrus
            </div>
            <h2 className="font-sans font-bold text-[2.25rem] md:text-[2.5rem] tracking-[-0.02em] text-pastel-forest leading-tight">
              Everything fantasy hockey, in one place.
            </h2>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {PRODUCT_CARDS.map((c) => {
            const Icon = c.icon;
            return (
              <article
                key={c.label}
                className={`${c.bg} rounded-[24px] p-6 ring-1 ring-pastel-forest/[0.08] hover:-translate-y-1 hover:shadow-[0_16px_32px_-12px_rgba(27,48,34,0.18)] transition-all duration-200 flex flex-col`}
              >
                <div className="flex items-center justify-between mb-5">
                  <div className="w-10 h-10 rounded-xl bg-white/70 flex items-center justify-center text-pastel-forest">
                    <Icon className="w-5 h-5" strokeWidth={2} />
                  </div>
                  <span className="font-jbmono text-[9px] tracking-[0.22em] uppercase text-pastel-forest-soft">
                    {c.stat}
                  </span>
                </div>
                <div className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-forest-soft mb-2">
                  {c.label}
                </div>
                <h3 className="font-sans font-bold text-[1.25rem] leading-snug text-pastel-forest mb-3">
                  {c.headline}
                </h3>
                <p className="text-[14px] text-pastel-forest-soft leading-relaxed mb-5 flex-1">
                  {c.body}
                </p>
                <button className="inline-flex items-center justify-between gap-2 bg-white/80 hover:bg-white px-4 h-10 rounded-full text-[13px] font-semibold text-pastel-forest transition-colors group">
                  <span>Try it</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" strokeWidth={2.25} />
                </button>
              </article>
            );
          })}
        </div>
      </section>

      {/* MOCK DRAFT — "try a mock draft" mini-section like Sleeper */}
      <section className="max-w-[1240px] mx-auto px-6 pb-20">
        <div className="bg-white/65 backdrop-blur-md ring-1 ring-pastel-sage/30 rounded-[28px] p-8 md:p-10 grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
          <div>
            <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-deep mb-2">
              Free · No signup
            </div>
            <h2 className="font-sans font-bold text-[2rem] md:text-[2.25rem] leading-tight text-pastel-forest mb-4 tracking-[-0.02em]">
              Try a mock draft.
            </h2>
            <p className="text-[16px] text-pastel-forest-soft leading-relaxed mb-6">
              Spin up a 12-team mock against our model bots in 30 seconds. Pick your draft type
              and we'll handle the rest. No account required.
            </p>
            <Link
              to="/draft"
              className="inline-flex items-center gap-2 bg-pastel-forest text-pastel-cream text-[14px] font-semibold pl-6 pr-5 h-11 rounded-full hover:bg-pastel-orange-soft transition-colors"
            >
              Start a mock draft <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
            </Link>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {DRAFT_TYPES.map((d) => (
              <div
                key={d.name}
                className="bg-pastel-sage-soft/60 rounded-2xl p-4 text-center ring-1 ring-pastel-sage/30 hover:bg-pastel-sage-soft hover:-translate-y-0.5 transition-all cursor-pointer"
              >
                <div className="font-calistoga text-[1.5rem] text-pastel-forest mb-2">{d.name}</div>
                <div className="text-[12px] text-pastel-forest-soft leading-snug">{d.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA banner */}
      <section className="max-w-[1240px] mx-auto px-6 pb-20">
        <div className="bg-pastel-forest text-pastel-cream rounded-[28px] p-10 md:p-14 text-center relative overflow-hidden">
          {/* Subtle orange glow */}
          <div
            aria-hidden="true"
            className="absolute -top-20 -right-20 w-[300px] h-[300px] rounded-full opacity-40 blur-3xl"
            style={{ background: 'radial-gradient(circle, #FF6B1A 0%, transparent 70%)' }}
          />
          <div className="relative">
            <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-cream/70 mb-3">
              Tonight at 7pm ET
            </div>
            <h2 className="font-sans font-bold text-[2.5rem] md:text-[3.25rem] leading-[1.05] tracking-[-0.025em] mb-5">
              Your league is{' '}
              <em className="font-calistoga not-italic font-normal text-pastel-orange-soft">waiting</em>.
            </h2>
            <p className="text-[16px] text-pastel-cream/80 max-w-md mx-auto mb-8">
              Spin up a free league, invite your group chat, draft tonight. Tomorrow you'll be
              watching live shifts roll in.
            </p>
            <Link
              to="/create-league"
              className="inline-flex items-center gap-2 bg-pastel-orange text-[#581E00] text-[15px] font-semibold pl-7 pr-6 h-13 rounded-full hover:bg-white hover:text-pastel-forest transition-colors shadow-[0_8px_24px_-8px_rgba(255,107,26,0.5)]"
              style={{ height: '52px' }}
            >
              <span>Create your league</span>
              <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-pastel-sage/30 bg-white/40">
        <div className="max-w-[1240px] mx-auto px-6 py-12 grid grid-cols-2 md:grid-cols-4 gap-8 text-[13px]">
          <div>
            <div className="font-calistoga text-[20px] text-pastel-forest mb-3">Citrus</div>
            <p className="text-pastel-forest-dim text-[12px] leading-relaxed">
              Fantasy hockey, the way it should be. Made in California with sage and sunshine.
            </p>
          </div>
          {[
            { title: 'Play', links: ['Leagues', 'Mock Draft', 'Pickem', 'Survivor'] },
            { title: 'Tools', links: ['Projections', 'Live Scores', 'Stormy AI', 'Trade Analyzer'] },
            { title: 'Citrus', links: ['About', 'Privacy', 'Terms'] },
          ].map((col) => (
            <div key={col.title}>
              <div className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-forest-soft mb-3">
                {col.title}
              </div>
              <ul className="space-y-2">
                {col.links.map((l) => (
                  <li key={l}>
                    <a href="#" className="text-pastel-forest hover:text-pastel-orange-deep transition-colors">
                      {l}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-t border-pastel-sage/30 py-5 text-center font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-forest-dim">
          © 2026 Citrus Fantasy Sports
        </div>
      </footer>
    </div>
  );
}
