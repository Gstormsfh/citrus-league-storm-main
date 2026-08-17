import { useState, useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { LivePulse } from './LivePulse';

export interface HeroSlide {
  id: string;
  eyebrow: string;
  /** Headline rendered as: lead + accent (orange) + optional tail */
  headline: { lead: string; accent: string; tail?: string };
  sub: string;
  primary: { label: string; to: string };
  secondary: { label: string; to: string };
  /** Right-side visual — typically one of the citrus2 tile components */
  visual: ReactNode;
}

/**
 * Auto-cycling Sleeper-style hero carousel. Pass an array of slides; each one
 * gets ~7s of screen time. Pauses on hover, indicators are clickable.
 *
 * Each slide controls its own visual (a citrus2 tile or a custom composition).
 */
export function RotatingHero({
  slides,
  intervalMs = 7000,
}: {
  slides: HeroSlide[];
  intervalMs?: number;
}) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setActive((i) => (i + 1) % slides.length), intervalMs);
    return () => clearInterval(id);
  }, [paused, slides.length, intervalMs]);

  const slide = slides[active];

  return (
    <section
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="relative max-w-[1280px] mx-auto px-4 sm:px-6 pt-8 sm:pt-12 lg:pt-16 pb-12"
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 sm:gap-12 lg:gap-16 items-center min-h-[400px] sm:min-h-[480px]">
        {/* LEFT — copy. key forces re-mount so animate-fade-in re-fires per slide */}
        <div key={`copy-${active}`} className="relative z-10 animate-fade-in">
          <div className="inline-flex items-center gap-2 mb-5 sm:mb-7 px-3 py-1.5 rounded-md bg-pastel-orange/15 ring-1 ring-pastel-orange/30">
            <LivePulse size="xs" />
            <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-orange-soft leading-none font-bold">
              {slide.eyebrow}
            </span>
          </div>
          <h1 className="font-sans font-black text-[2.25rem] sm:text-[3rem] md:text-[3.5rem] lg:text-[5rem] leading-[1.0] sm:leading-[0.98] tracking-[-0.035em] text-pastel-cream mb-4 sm:mb-6">
            {slide.headline.lead}
            <br />
            <span className="text-pastel-orange">{slide.headline.accent}</span>
            {slide.headline.tail}
          </h1>
          <p className="text-[15px] sm:text-[16px] md:text-[18px] leading-relaxed text-white/65 max-w-md mb-6 sm:mb-8">
            {slide.sub}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
            <Link
              to={slide.primary.to}
              className="group inline-flex items-center gap-2 bg-pastel-orange text-[#581E00] text-[14px] sm:text-[15px] font-bold px-6 sm:px-7 rounded-md hover:bg-pastel-orange-soft hover:-translate-y-0.5 transition-all duration-200 shadow-[0_8px_24px_-8px_rgba(255,107,26,0.5)] hover:shadow-[0_16px_40px_-8px_rgba(255,107,26,0.6)] active:scale-95"
              style={{ height: '48px' }}
            >
              <span>{slide.primary.label}</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" strokeWidth={2.5} />
            </Link>
            <Link
              to={slide.secondary.to}
              className="inline-flex items-center text-[13px] sm:text-[14px] font-bold text-pastel-cream hover:text-pastel-orange-soft transition-colors px-4 sm:px-5 rounded-md ring-1 ring-white/15 hover:ring-white/30"
              style={{ height: '48px' }}
            >
              {slide.secondary.label}
            </Link>
          </div>
        </div>

        {/* RIGHT — visual */}
        <div key={`visual-${active}`} className="relative animate-fade-in">
          {slide.visual}
        </div>
      </div>

      {/* Indicator dots */}
      {/* gap-3 (12px) pairs with before:-inset-x-1.5 (6px a side) so the hit
          areas meet exactly and never overlap. */}
      <div className="flex items-center justify-center gap-3 mt-10">
        {slides.map((s, i) => (
          <button
            key={s.id}
            onClick={() => setActive(i)}
            // The visible bar stays 6px tall. The ::before extends the TOUCH
            // TARGET to 44px without affecting layout — these dots are the only
            // way to reach slides 2-5, and at 48x6 / 32x6 they were effectively
            // unhittable on a phone.
            className={`relative h-1.5 rounded-full transition-all before:absolute before:content-[''] before:-inset-x-1.5 before:top-1/2 before:h-11 before:-translate-y-1/2 ${
              active === i
                ? 'bg-pastel-orange w-12'
                : 'bg-white/15 w-8 hover:bg-white/30'
            }`}
            aria-label={`Slide ${i + 1}: ${s.id}`}
            aria-current={active === i}
          />
        ))}
      </div>

      {/* Slide label */}
      <div className="text-center mt-3 font-jbmono text-[10px] tracking-[0.32em] uppercase text-white/35">
        {String(active + 1).padStart(2, '0')} / {String(slides.length).padStart(2, '0')} · {slide.id}
      </div>
    </section>
  );
}
