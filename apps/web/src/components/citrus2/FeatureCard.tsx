import { ACCENT_CLASSES, type AccentName } from './tokens';
import { GlowCard } from './GlowCard';

/**
 * Compact feature card for the "What You Get" / Features grid.
 *
 * Sleeper-style: when `scene` is provided, the mascot action scene fills
 * a hero zone at the top of the card (~aspect-[4/3]). When omitted, falls
 * back to the original icon-in-rounded-square header.
 */
export function FeatureCard({
  label,
  desc,
  icon: Icon,
  accent = 'orange',
  decoration,
  scene,
}: {
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  accent?: AccentName;
  decoration?: React.ReactNode;
  /** Optional hero scene image. */
  scene?: string;
}) {
  const a = ACCENT_CLASSES[accent];
  return (
    <GlowCard accent={accent} className="h-full">
      <div className="flex flex-col h-full overflow-hidden">
        {scene ? (
          <div className="relative w-full aspect-[4/3] overflow-hidden">
            <img
              src={scene}
              alt=""
              className="w-full h-full object-cover scale-105 group-hover:scale-110 transition-transform duration-500"
              loading="lazy"
            />
            <div
              aria-hidden="true"
              className="absolute inset-x-0 bottom-0 h-20 pointer-events-none"
              style={{ background: 'linear-gradient(to bottom, transparent 0%, #1A2A20 100%)' }}
            />
          </div>
        ) : (
          <div className="px-6 pt-6">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ring-1 ${a.bg} ${a.ring} ${a.text} group-hover:scale-110 transition-transform duration-300`}>
              <Icon className="w-7 h-7" />
            </div>
          </div>
        )}

        <div className="px-6 pb-6 pt-2 flex flex-col flex-1">
          <h3 className="font-sans font-bold text-[1.15rem] text-pastel-cream mb-2">
            {label}
          </h3>
          <p className="text-[13px] text-white/60 leading-relaxed mb-4 flex-grow">
            {desc}
          </p>
          {decoration && <div className="mt-auto">{decoration}</div>}
        </div>
      </div>
    </GlowCard>
  );
}
