import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { ACCENT_CLASSES, type AccentName } from './tokens';
import { GlowCard } from './GlowCard';
import { MascotPeek } from './MascotPeek';
import type { MascotId } from '@/constants/mascots';

/**
 * Card for the "Three Ways In" / onboarding paths section.
 *
 * Wrapped in GlowCard for ambient glow on hover. Optional `mascotPeek` prop
 * adds a Citrus Squad character peeking from the top-right corner — anchors
 * the card to the brand and makes the page feel more alive (per Sleeper).
 */
export function OnboardingCard({
  title,
  body,
  ctaLabel,
  icon: Icon,
  accent = 'orange',
  to,
  mascotPeek,
}: {
  title: string;
  body: string;
  ctaLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  accent?: AccentName;
  to?: string;
  /** Optional mascot peeking from the top-right corner */
  mascotPeek?: MascotId;
}) {
  const a = ACCENT_CLASSES[accent];
  const button = (
    <button className="mt-auto inline-flex items-center gap-1.5 bg-pastel-orange text-white px-5 h-10 rounded-md text-[13px] font-bold hover:bg-pastel-orange-deep transition-all duration-200 active:scale-95 group/btn w-fit">
      {ctaLabel} <ArrowRight className="w-3.5 h-3.5 group-hover/btn:translate-x-0.5 transition-transform" strokeWidth={2.5} />
    </button>
  );

  return (
    <GlowCard accent={accent} className="h-full">
      <article className="p-7 flex flex-col h-full relative">
        {mascotPeek && <MascotPeek id={mascotPeek} position="top-right" size="md" />}
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-5 ring-1 ${a.bg} ${a.ring} ${a.text} group-hover:scale-110 transition-transform duration-300`}>
          <Icon className="w-7 h-7" />
        </div>
        <h3 className="font-sans font-bold text-[1.5rem] leading-snug text-pastel-cream mb-3">
          {title}
        </h3>
        <p className="text-[14px] text-white/60 leading-relaxed mb-6 flex-grow">
          {body}
        </p>
        {to ? <Link to={to} className="contents">{button}</Link> : button}
      </article>
    </GlowCard>
  );
}
