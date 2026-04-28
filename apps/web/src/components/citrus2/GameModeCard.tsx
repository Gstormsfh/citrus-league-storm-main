import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { ACCENT_CLASSES, type AccentName } from './tokens';
import { GlowCard } from './GlowCard';

/**
 * Card for the horizontal "Popular on Citrus" carousel — one per game mode.
 *
 * Sleeper-style: when `scene` is provided, render that mascot action scene
 * as a full-bleed hero zone at the TOP of the card (covers ~55% of card
 * height), with the badge overlaying the image and the title/description
 * sitting in the bottom panel. When `scene` is not provided, falls back
 * to the legacy icon-in-rounded-square header.
 */
export function GameModeCard({
  label,
  sub,
  badge,
  icon: Icon,
  accent = 'orange',
  to,
  ctaLabel = 'Play Now',
  scene,
}: {
  label: string;
  sub: string;
  badge?: string;
  icon: React.ComponentType<{ className?: string }>;
  accent?: AccentName;
  to?: string;
  ctaLabel?: string;
  /** Optional path to a hero scene image (under /public). Sleeper-style card. */
  scene?: string;
}) {
  const a = ACCENT_CLASSES[accent];
  const button = (
    <button className="mt-auto w-full inline-flex items-center justify-center gap-1.5 bg-pastel-orange text-white px-4 h-10 rounded-md text-[13px] font-bold hover:bg-pastel-orange-deep transition-all duration-200 active:scale-95 group/btn">
      {ctaLabel} <ArrowRight className="w-3.5 h-3.5 group-hover/btn:translate-x-0.5 transition-transform" strokeWidth={2.5} />
    </button>
  );

  return (
    <div className="flex-shrink-0 w-[240px] sm:w-[260px] snap-start h-full">
      <GlowCard accent={accent} className="h-full">
        <article className="flex flex-col h-full overflow-hidden">
          {scene ? (
            // Sleeper-style hero zone — scene fills the top
            <div className="relative w-full aspect-[4/3] overflow-hidden">
              <img
                src={scene}
                alt=""
                className="w-full h-full object-cover scale-105 group-hover:scale-110 transition-transform duration-500"
                loading="lazy"
              />
              {/* Subtle dark gradient at bottom for graceful transition into the text panel */}
              <div
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 h-20 pointer-events-none"
                style={{ background: 'linear-gradient(to bottom, transparent 0%, #1A2A20 100%)' }}
              />
              {badge && (
                <span className={`absolute top-3 left-3 px-2.5 py-1 rounded-md font-jbmono text-[9px] tracking-wider uppercase font-bold ring-1 ${a.chip} backdrop-blur-md bg-[#0F1F15]/70`}>
                  {badge}
                </span>
              )}
            </div>
          ) : (
            <div className="px-4 pt-4">
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
            </div>
          )}

          <div className="px-4 pb-4 pt-2 flex flex-col flex-1">
            <h3 className="font-sans font-bold text-[1.1rem] leading-snug text-pastel-cream mb-1.5">
              {label}
            </h3>
            <p className="text-[12px] text-white/55 leading-snug mb-4 flex-grow">
              {sub}
            </p>
            {to ? <Link to={to} className="contents">{button}</Link> : button}
          </div>
        </article>
      </GlowCard>
    </div>
  );
}
