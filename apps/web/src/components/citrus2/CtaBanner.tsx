import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { LivePulse } from './LivePulse';

/**
 * Big closing CTA panel — dark gradient background with orange glow accent.
 * Reusable across pages for the "drop the puck and join" moment.
 */
export function CtaBanner({
  eyebrow,
  eyebrowPulse = false,
  title,
  sub,
  ctaLabel,
  ctaHref,
}: {
  eyebrow?: string;
  eyebrowPulse?: boolean;
  title: React.ReactNode;
  sub?: string;
  ctaLabel: string;
  ctaHref: string;
}) {
  return (
    <section className="relative max-w-[1280px] mx-auto px-6 pb-24">
      <div className="bg-gradient-to-br from-[#1A2A20] to-[#0F1F15] border border-white/10 rounded-[28px] p-10 md:p-14 text-center relative overflow-hidden">
        <div
          aria-hidden="true"
          className="absolute -top-20 -right-20 w-[400px] h-[400px] rounded-full opacity-30 blur-3xl"
          style={{ background: 'radial-gradient(circle, #FF6B1A 0%, transparent 70%)' }}
        />
        <div className="relative">
          {eyebrow && (
            <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft mb-3 font-bold flex items-center justify-center gap-2">
              {eyebrowPulse && <LivePulse size="xs" />}
              {eyebrow}
            </div>
          )}
          <h2 className="font-sans font-black text-[2.5rem] md:text-[3.75rem] leading-[1] tracking-[-0.03em] mb-5 text-pastel-cream">
            {title}
          </h2>
          {sub && (
            <p className="text-[16px] text-white/60 max-w-md mx-auto mb-8">
              {sub}
            </p>
          )}
          <Link
            to={ctaHref}
            className="inline-flex items-center gap-2 bg-pastel-orange text-white text-[15px] font-bold px-8 rounded-md hover:bg-white hover:text-[#0F1F15] transition-colors shadow-[0_8px_32px_-8px_rgba(255,107,26,0.5)]"
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
