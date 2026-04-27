import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { ACCENT_CLASSES, type AccentName } from './tokens';
import { GlowCard } from './GlowCard';

/**
 * Card for the horizontal "Popular on Citrus" carousel — one per game mode.
 *
 * Wrapped in GlowCard for Sleeper-style ambient glow + lift on hover, color
 * matches the card's accent. `flex flex-col h-full` so cards align in a row
 * regardless of body length. Icon prop should be a hockey SVG component.
 */
export function GameModeCard({
  label,
  sub,
  badge,
  icon: Icon,
  accent = 'orange',
  to,
  ctaLabel = 'Play Now',
}: {
  label: string;
  sub: string;
  badge?: string;
  icon: React.ComponentType<{ className?: string }>;
  accent?: AccentName;
  /** Where the card's CTA navigates to */
  to?: string;
  ctaLabel?: string;
}) {
  const a = ACCENT_CLASSES[accent];
  const button = (
    <button className="mt-auto w-full inline-flex items-center justify-center gap-1.5 bg-pastel-orange text-white px-4 h-10 rounded-md text-[13px] font-bold hover:bg-pastel-orange-deep transition-all duration-200 active:scale-95 group/btn">
      {ctaLabel} <ArrowRight className="w-3.5 h-3.5 group-hover/btn:translate-x-0.5 transition-transform" strokeWidth={2.5} />
    </button>
  );

  return (
    <div className="flex-shrink-0 w-[280px] snap-start h-full">
      <GlowCard accent={accent} className="h-full">
        <article className="p-6 flex flex-col h-full">
          <div className="flex items-center justify-between mb-5">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ring-1 ${a.bg} ${a.ring} ${a.text} group-hover:scale-110 transition-transform duration-300`}>
              <Icon className="w-7 h-7" />
            </div>
            {badge && (
              <span className={`px-2.5 py-1 rounded-md font-jbmono text-[9px] tracking-wider uppercase font-bold ring-1 ${a.chip}`}>
                {badge}
              </span>
            )}
          </div>
          <h3 className="font-sans font-bold text-[1.35rem] leading-snug text-pastel-cream mb-2">
            {label}
          </h3>
          <p className="text-[13px] text-white/55 leading-relaxed mb-5 flex-grow">
            {sub}
          </p>
          {to ? <Link to={to} className="contents">{button}</Link> : button}
        </article>
      </GlowCard>
    </div>
  );
}
