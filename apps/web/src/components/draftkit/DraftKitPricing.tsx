import type { DraftKitTier } from './types';

export interface DraftKitPricingProps {
  currentTier: DraftKitTier;
  heading?: string;
}

/** Compatibility surface for existing imports; no purchase controls. */
export function DraftKitPricing({ heading = 'Draft Kit access' }: DraftKitPricingProps) {
  return (
    <section data-testid="draft-kit-pricing" aria-label="Draft Kit access">
      <h2 className="text-xl font-bold text-pastel-cream">{heading}</h2>
      <p className="mt-3 text-white/65">Draft Kit is a planned paid product. Purchases are not available yet. You can explore the desktop preview; no payment is collected.</p>
    </section>
  );
}
