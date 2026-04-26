import { ArrowRight, type LucideIcon } from 'lucide-react';
import { ACCENT_CLASSES, type AccentName } from './tokens';

/**
 * Card for the "Three Ways In" / onboarding paths section.
 * Larger than GameModeCard, more focus on copy.
 */
export function OnboardingCard({
  title,
  body,
  ctaLabel,
  icon: Icon,
  accent = 'orange',
  onClick,
}: {
  title: string;
  body: string;
  ctaLabel: string;
  icon: LucideIcon;
  accent?: AccentName;
  onClick?: () => void;
}) {
  const a = ACCENT_CLASSES[accent];
  return (
    <article className="bg-[#1A2A20] border border-white/10 rounded-2xl p-7 hover:border-pastel-orange/40 transition-all">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-5 ring-1 ${a.bg} ${a.ring} ${a.text}`}>
        <Icon className="w-6 h-6" strokeWidth={2} />
      </div>
      <h3 className="font-sans font-bold text-[1.5rem] leading-snug text-pastel-cream mb-3">
        {title}
      </h3>
      <p className="text-[14px] text-white/60 leading-relaxed mb-6">
        {body}
      </p>
      <button
        onClick={onClick}
        className="inline-flex items-center gap-1.5 bg-pastel-orange text-white px-5 h-10 rounded-md text-[13px] font-bold hover:bg-pastel-orange-deep transition-colors"
      >
        {ctaLabel} <ArrowRight className="w-3.5 h-3.5" strokeWidth={2.5} />
      </button>
    </article>
  );
}
