import { ACCENT_CLASSES, type AccentName } from './tokens';

/**
 * Compact feature card for the "What You Get" / Features grid.
 *
 * `flex flex-col h-full` aligns cards in a row.
 * Optional `accent` tints the icon container per-card so 6-up grid isn't monotone.
 * Optional `decoration` slot accepts inline visualization (range bar, mini chart,
 * mascot avatar) for cards where a flat icon alone is too generic.
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
  /** Optional visualization slot below the body — mini range bar, chart, mascot, etc. */
  decoration?: React.ReactNode;
}) {
  const a = ACCENT_CLASSES[accent];
  return (
    <div className="bg-[#1A2A20] border border-white/10 rounded-2xl p-6 hover:border-pastel-orange/40 hover:-translate-y-0.5 transition-all flex flex-col h-full">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ring-1 ${a.bg} ${a.ring} ${a.text}`}>
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
  );
}
