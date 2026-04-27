import { ACCENT_CLASSES, type AccentName } from './tokens';
import { GlowCard } from './GlowCard';

/**
 * Compact feature card for the "What You Get" / Features grid.
 *
 * Wrapped in GlowCard for ambient color glow on hover (matches accent).
 * `accent` tints the icon container per-card so a 6-up grid uses orange,
 * sage, butter, peach diversity instead of monotone.
 * Optional `decoration` slot for inline visualization (range bar, mini chart,
 * mascot avatar) — when an icon alone is too generic.
 */
export function FeatureCard({
  label,
  desc,
  icon: Icon,
  accent = 'orange',
  decoration,
}: {
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  accent?: AccentName;
  /** Optional visualization slot below the body */
  decoration?: React.ReactNode;
}) {
  const a = ACCENT_CLASSES[accent];
  return (
    <GlowCard accent={accent} className="h-full">
      <div className="p-6 flex flex-col h-full">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ring-1 ${a.bg} ${a.ring} ${a.text} group-hover:scale-110 transition-transform duration-300`}>
          <Icon className="w-7 h-7" />
        </div>
        <h3 className="font-sans font-bold text-[1.15rem] text-pastel-cream mb-2">
          {label}
        </h3>
        <p className="text-[13px] text-white/60 leading-relaxed mb-4 flex-grow">
          {desc}
        </p>
        {decoration && <div className="mt-auto">{decoration}</div>}
      </div>
    </GlowCard>
  );
}
