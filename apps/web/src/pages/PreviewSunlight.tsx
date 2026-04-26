import { Link } from 'react-router-dom';
import { ArrowRight, MoonStar, Trophy, Sparkles } from 'lucide-react';

const CARDS = [
  {
    label: 'The Game',
    headline: "Edmonton hosts Colorado",
    body: "A two-goal toss-up with 9.6 expected total. McDavid and MacKinnon both project north of 8.5. Watch the second period.",
    accent: '7:00 PM MT · Rogers Place',
    icon: Trophy,
  },
  {
    label: 'The Pick',
    headline: "Connor McDavid (C, EDM)",
    body: "Floor 6.7 · Median 9.4 · Ceiling 12.1. Highest single-skater projection on tonight's slate. Confidence: high.",
    accent: '9.4 projected · ±2.1 standard deviation',
    icon: MoonStar,
  },
  {
    label: 'The AI',
    headline: "Ask Stormy anything",
    body: "Trained on 19,000 simulations of tonight's slate. Try: \"Who do I start at LW between Marchand and Pastrnak?\"",
    accent: 'Available 24/7 · Trained on tonight',
    icon: Sparkles,
  },
];

export default function PreviewSunlight() {
  return (
    <div
      className="min-h-screen text-pastel-forest"
      style={{
        background:
          'linear-gradient(180deg, #E8EED9 0%, #F2EEDA 35%, #FFF8F0 70%, #FFF2E0 100%)',
      }}
    >
      {/* Quiet nav */}
      <header className="sticky top-0 z-30 backdrop-blur-md bg-white/40 border-b border-white/50">
        <div className="max-w-[1100px] mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/preview-sunlight" className="flex items-center gap-1.5">
            <span className="font-calistoga text-[22px] leading-none text-pastel-forest">Citrus</span>
          </Link>
          <Link
            to="/auth"
            className="text-[13px] font-medium text-pastel-forest-soft hover:text-pastel-forest transition-colors"
          >
            Sign in
          </Link>
        </div>
      </header>

      {/* Hero question */}
      <section className="max-w-[920px] mx-auto px-6 pt-20 md:pt-28 pb-12 text-center">
        <div className="inline-flex items-center gap-2 mb-10 px-3.5 py-1.5 rounded-full bg-white/60 ring-1 ring-pastel-sage/30">
          <span className="relative flex w-1.5 h-1.5">
            <span className="absolute inline-flex w-full h-full bg-pastel-sage rounded-full opacity-60 animate-ping" />
            <span className="relative inline-flex w-1.5 h-1.5 bg-pastel-sage rounded-full" />
          </span>
          <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-forest-soft leading-none">
            For the considered fantasy manager
          </span>
        </div>

        <h1 className="font-sans font-medium text-[2.75rem] sm:text-[4rem] md:text-[5rem] leading-[1.05] text-pastel-forest mb-7 tracking-[-0.025em]">
          What's your{' '}
          <em className="font-calistoga not-italic text-pastel-orange-deep font-normal">edge</em>
          <br />
          tonight?
        </h1>

        <p className="max-w-[480px] mx-auto text-[17px] md:text-[18px] text-pastel-forest-soft leading-relaxed mb-12">
          Citrus reads the slate, runs the sims, and tells you the one move that matters.
          <br className="hidden sm:block" />
          Less screen. More confidence.
        </p>
      </section>

      {/* Hero image — single large orange */}
      <section className="max-w-[820px] mx-auto px-6 pb-16 relative">
        <div className="aspect-[4/3] overflow-hidden rounded-[32px] ring-1 ring-pastel-sage/30 shadow-[0_30px_60px_-20px_rgba(132,165,125,0.35)]">
          <img
            src="/mockups/sunlight-orange.jpg"
            alt=""
            aria-hidden="true"
            className="w-full h-full object-cover animate-float-slow"
            loading="eager"
          />
        </div>
      </section>

      {/* CTAs */}
      <section className="max-w-[920px] mx-auto px-6 pb-24 text-center">
        <Link
          to="/create-league"
          className="group inline-flex items-center gap-2 bg-pastel-forest text-pastel-cream text-[15px] font-medium pl-7 pr-6 h-14 rounded-full hover:bg-pastel-orange-deep hover:-translate-y-0.5 transition-all duration-200 shadow-[0_12px_28px_-12px_rgba(27,48,34,0.4)]"
        >
          <span>Get tonight's edge</span>
          <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" strokeWidth={2.5} />
        </Link>
        <div className="mt-5 font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-forest-dim">
          No credit card · Read-only preview
        </div>
      </section>

      {/* 3-card stack */}
      <section className="max-w-[760px] mx-auto px-6 pb-20">
        <div className="text-center mb-10">
          <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-forest-soft mb-3">
            Tonight's three things
          </div>
          <h2 className="font-calistoga text-[2.25rem] text-pastel-forest leading-tight">
            That's everything.
          </h2>
        </div>

        <div className="space-y-5">
          {CARDS.map((c) => {
            const Icon = c.icon;
            return (
              <article
                key={c.label}
                className="group relative bg-white/70 backdrop-blur-md ring-1 ring-pastel-sage/30 rounded-[28px] p-7 md:p-8 hover:ring-pastel-sage hover:shadow-[0_20px_40px_-16px_rgba(132,165,125,0.35)] hover:-translate-y-0.5 transition-all"
              >
                <div className="flex items-start gap-5">
                  <div className="flex-shrink-0 w-11 h-11 rounded-2xl bg-pastel-sage-soft flex items-center justify-center text-pastel-forest">
                    <Icon className="w-5 h-5" strokeWidth={1.75} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-forest-soft mb-2">
                      {c.label}
                    </div>
                    <h3 className="font-calistoga text-[1.6rem] md:text-[1.85rem] leading-tight text-pastel-forest mb-3">
                      {c.headline}
                    </h3>
                    <p className="text-[15px] md:text-[16px] text-pastel-forest-soft leading-relaxed mb-4">
                      {c.body}
                    </p>
                    <div className="font-jbmono text-[11px] text-pastel-forest-dim tabular-nums">
                      {c.accent}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* Footer */}
      <footer className="text-center py-12 border-t border-pastel-sage/30">
        <div className="font-calistoga text-[20px] text-pastel-forest mb-2">Citrus</div>
        <p className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-forest-dim">
          Quiet sport · Made calmly
        </p>
      </footer>
    </div>
  );
}
