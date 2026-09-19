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
      <p className="mt-3 text-white/65">Your league. Your scoring. Your draft plan. A one-time kit for the 2026–27 season, with no subscription.</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {[
          ['A guide built for your league', 'Customize your points-per-stat settings. Download your Top 300, draft strategy, player stories, team outlooks and offseason reads in one PDF.'],
          ['Compare 2–10 players', 'Colour-coded tables, selectable stat maps and radar area charts. Compare hockey totals or each category’s fantasy-point contribution under your settings.'],
          ['A live Citrus browser companion', 'Draft Desk appears automatically in your Citrus website draft room. It follows confirmed picks, keepers and undos while you keep targets and notes.'],
          ['Five useful downloads', 'Full PDF guide, printable and clickable draft checklist, compact cheat sheet, rankings CSV, and a self-contained offline draft desk with comparison charts.'],
        ].map(([title,description])=><div key={title} className="rounded-xl border border-white/15 bg-white/5 p-4"><h3 className="font-bold text-pastel-cream">{title}</h3><p className="mt-2 text-sm leading-relaxed text-white/70">{description}</p></div>)}
      </div>
      <p className="mt-4 text-sm text-white/60">For points leagues. The live companion works with Citrus drafts in a web browser, not the iPhone or Android app. Yahoo and ESPN live-draft integration is not included. Downloads are dated editions; the offline desk does not sync picks or notes. Projections are estimates, not guarantees.</p>
      <DraftKitDownloads />
    </section>
  );
}
