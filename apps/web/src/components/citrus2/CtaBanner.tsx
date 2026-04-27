import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { LivePulse } from './LivePulse';
import { MascotPeek } from './MascotPeek';
import type { MascotId } from '@/constants/mascots';

/**
 * Big closing CTA panel — dark gradient with orange glow + optional mascot peek.
 *
 * The mascot prop adds a Citrus Squad character peeking from a corner of the
 * banner — anchors the CTA to the brand and adds personality (per Sleeper).
 * Defaults to Stormy bottom-right since this is usually the "join now" moment.
 */
export function CtaBanner({
  eyebrow,
  eyebrowPulse = false,
  title,
  sub,
  ctaLabel,
  ctaHref,
  mascot = 'stormy',
  mascotPosition = 'bottom-right',
}: {
  eyebrow?: string;
  eyebrowPulse?: boolean;
  title: React.ReactNode;
  sub?: string;
  ctaLabel: string;
  ctaHref: string;
  /** Mascot to peek from a corner. Pass `null` to disable. */
  mascot?: MascotId | null;
  mascotPosition?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
}) {
  return (
    <section className="relative max-w-[1280px] mx-auto px-6 pb-24">
      <div className="group bg-gradient-to-br from-[#1A2A20] to-[#0F1F15] border border-white/10 rounded-[28px] p-10 md:p-14 text-center relative overflow-hidden hover:border-pastel-orange/40 transition-colors duration-500">
        {/* Atmospheric orange glow — intensifies on hover */}
        <div
          aria-hidden="true"
          className="absolute -top-20 -right-20 w-[400px] h-[400px] rounded-full opacity-30 group-hover:opacity-50 blur-3xl transition-opacity duration-700"
          style={{ background: 'radial-gradient(circle, #FF6B1A 0%, transparent 70%)' }}
        />
        {/* Counter-glow on the opposite side for depth */}
        <div
          aria-hidden="true"
          className="absolute -bottom-32 -left-20 w-[400px] h-[400px] rounded-full opacity-15 group-hover:opacity-25 blur-3xl transition-opacity duration-700"
          style={{ background: 'radial-gradient(circle, #84A57D 0%, transparent 70%)' }}
        />

        {/* Mascot peek */}
        {mascot && <MascotPeek id={mascot} position={mascotPosition} size="lg" />}

        <div className="relative z-10">
          {eyebrow && (
            <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft mb-3 font-bold flex items-center justify-center gap-2">
              {eyebrowPulse && <LivePulse size="xs" />}
              {eyebrow}
            </div>
          )}
          <h2 className="font-sans font-black text-[2.25rem] md:text-[3.75rem] leading-[1] tracking-[-0.03em] mb-5 text-pastel-cream">
            {title}
          </h2>
          {sub && (
            <p className="text-[16px] text-white/60 max-w-md mx-auto mb-8">
              {sub}
            </p>
          )}
          <Link
            to={ctaHref}
            className="inline-flex items-center gap-2 bg-pastel-orange text-white text-[15px] font-bold px-8 rounded-md hover:bg-white hover:text-[#0F1F15] transition-all duration-200 shadow-[0_8px_32px_-8px_rgba(255,107,26,0.5)] hover:shadow-[0_16px_48px_-8px_rgba(255,107,26,0.6)] hover:-translate-y-0.5 active:scale-95"
            style={{ height: '54px' }}
          >
            <span>{ctaLabel}</span>
            <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
          </Link>
        </div>
      </div>
    </section>
  );
}
