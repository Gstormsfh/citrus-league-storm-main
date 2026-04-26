import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { ACCENT_CLASSES, type AccentName } from './tokens';

/**
 * Card for the "Three Ways In" / onboarding paths section.
 * `flex flex-col h-full` aligns cards in a row.
 */
export function OnboardingCard({
  title,
  body,
  ctaLabel,
  icon: Icon,
  accent = 'orange',
  to,
}: {
  title: string;
  body: string;
  ctaLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  accent?: AccentName;
  to?: string;
}) {
  const a = ACCENT_CLASSES[accent];
  const button = (
    <button className="mt-auto inline-flex items-center gap-1.5 bg-pastel-orange text-white px-5 h-10 rounded-md text-[13px] font-bold hover:bg-pastel-orange-deep transition-colors w-fit">
      {ctaLabel} <ArrowRight className="w-3.5 h-3.5" strokeWidth={2.5} />
    </button>
  );

  return (
    <article className="bg-[#1A2A20] border border-white/10 rounded-2xl p-7 hover:border-pastel-orange/40 transition-all flex flex-col h-full">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-5 ring-1 ${a.bg} ${a.ring} ${a.text}`}>
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
  );
}
