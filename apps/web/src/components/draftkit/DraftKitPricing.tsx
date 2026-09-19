import type { DraftKitTier } from './types';
import { DraftKitDownloads } from './DraftKitDownloads';
import { Capacitor } from '@capacitor/core';

export interface DraftKitPricingProps {
  currentTier: DraftKitTier;
  heading?: string;
}

/** Web-only access panel. Server readiness and entitlement govern availability. */
export function DraftKitPricing({ heading = 'Draft Kit access' }: DraftKitPricingProps) {
  if (import.meta.env.VITE_NATIVE === '1' || Capacitor.isNativePlatform())
    return <p>Draft Kit downloads are unavailable in this view.</p>;
  return (
    <section data-testid="draft-kit-pricing" aria-label="Draft Kit access">
      <h2 className="text-xl font-bold text-pastel-cream">{heading}</h2>
      <p className="mt-3 text-white/65">Personalize your downloadable guide with your league's scoring. Purchased access also brings Draft Desk into your Citrus draft room.</p>
      <DraftKitDownloads />
    </section>
  );
}
