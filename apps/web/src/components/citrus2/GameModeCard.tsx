import { ArrowRight, type LucideIcon } from 'lucide-react';
import { ACCENT_CLASSES, type AccentName } from './tokens';

/**
 * Card used in the horizontal "Popular on Citrus" carousel — one per game mode
 * (Fantasy Hockey, Pickem, Survivor, etc.). Multi-color accent system per mode.
 */
export function GameModeCard({
  label,
  sub,
  badge,
  icon: Icon,
  accent = 'orange',
  onClick,
  ctaLabel = 'Play Now',
}: {
  label: string;
  sub: string;
  badge?: string;
  icon: LucideIcon;
  accent?: AccentName;
  onClick?: () => void;
  ctaLabel?: string;
}) {
  const a = ACCENT_CLASSES[accent];
  return (
    <article className="flex-shrink-0 w-[280px] snap-start bg-[#1A2A20] border border-white/10 rounded-2xl p-6 hover:border-pastel-orange/40 hover:-translate-y-1 transition-all">
      <div className="flex items-center justify-between mb-5">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ring-1 ${a.bg} ${a.ring} ${a.text}`}>
          <Icon className="w-6 h-6" strokeWidth={2} />
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
      <p className="text-[13px] text-white/55 leading-relaxed mb-5 min-h-[60px]">
        {sub}
      </p>
      <button
        onClick={onClick}
        className="w-full inline-flex items-center justify-center gap-1.5 bg-pastel-orange text-white px-4 h-10 rounded-md text-[13px] font-bold hover:bg-pastel-orange-deep transition-colors"
      >
        {ctaLabel} <ArrowRight className="w-3.5 h-3.5" strokeWidth={2.5} />
      </button>
    </article>
  );
}
