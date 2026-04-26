import { type LucideIcon } from 'lucide-react';

/**
 * Compact feature card for the "What You Get" feature grid. Smaller than
 * OnboardingCard — no CTA, just icon + title + body.
 */
export function FeatureCard({
  label,
  desc,
  icon: Icon,
}: {
  label: string;
  desc: string;
  icon: LucideIcon;
}) {
  return (
    <div className="bg-[#1A2A20] border border-white/10 rounded-2xl p-6 hover:border-pastel-orange/40 hover:-translate-y-0.5 transition-all">
      <div className="w-11 h-11 rounded-xl bg-pastel-orange/15 ring-1 ring-pastel-orange/30 flex items-center justify-center text-pastel-orange-soft mb-4">
        <Icon className="w-5 h-5" strokeWidth={2} />
      </div>
      <h3 className="font-sans font-bold text-[1.15rem] text-pastel-cream mb-2">
        {label}
      </h3>
      <p className="text-[13px] text-white/60 leading-relaxed">
        {desc}
      </p>
    </div>
  );
}
