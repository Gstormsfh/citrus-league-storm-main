/**
 * Draft Kit pricing model.
 *
 * ── WHERE THE NUMBERS COME FROM ──────────────────────────────────────
 * Everything in this file is a BUSINESS DECISION, not a measurement. The
 * amounts below are the shell's defaults and are the founder's to set: change
 * `priceUsd` and `cadence` here and every surface follows, because nothing
 * else in the section hardcodes a price.
 *
 * They are NOT derived from Citrus data and they are NOT competitor prices.
 * Yahoo and ESPN gate their subscription pricing behind app-store regions and
 * JFresh's Patreon amounts were not readable when this was researched
 * (2026-09-02), so no competitor figure is quoted anywhere in this section.
 * The competitive frame that IS used is structural and was readable: Yahoo
 * splits a free tier from Plus from Ultra, and puts the written draft-kit
 * material (rankings, tiered cheat sheets, sleepers) in the top tier while
 * the tools sit in the middle one. This model follows that shape.
 *
 * ── THE SHAPE ────────────────────────────────────────────────────────
 * Three tiers, and the split is about what kind of thing you get, not how
 * much of it:
 *
 *   free  — the board exists and you can see who is on it. Ranks and tiers,
 *           no percentiles, no projections. Enough to know the kit is real.
 *   kit   — the analytics. Every player card, every cohort percentile, the
 *           full ranked board, roster-change tracking. A season pass.
 *   suite — the kit plus the written layer: the founder's own take and the
 *           guest writers, plus everything premium that ships later.
 *
 * `id` matches the `tier` CHECK constraint on public.draft_kit_entitlements.
 * Adding a tier means a migration, not just an edit here.
 */

import type { DraftKitTier } from './types';

/**
 * FOUNDER-SET. Whole US dollars. Change these two blocks and the whole
 * section re-prices; nothing downstream carries a number of its own.
 */
const KIT_PRICE_USD = 19;
const SUITE_PRICE_USD = 39;

export interface TierSpec {
  id: DraftKitTier;
  name: string;
  /** Null on the free tier, which has no price to display. */
  priceUsd: number | null;
  /** What the price buys, in time. */
  cadence: string;
  tagline: string;
  includes: string[];
  /** Rendered as the visually dominant option. */
  featured?: boolean;
}

export const DRAFT_KIT_TIERS: TierSpec[] = [
  {
    id: 'free',
    name: 'Free',
    priceUsd: null,
    cadence: 'Always free',
    tagline: 'See the board. See who is on it.',
    includes: [
      'Top five at every position',
      'Rank and tier for those players',
      'Everything already free on Citrus',
    ],
  },
  {
    id: 'kit',
    name: 'Draft Kit',
    priceUsd: KIT_PRICE_USD,
    cadence: 'One season',
    tagline: 'Every card, every percentile, the whole board.',
    featured: true,
    includes: [
      'Player cards for every skater and goalie',
      'Percentiles ranked inside position, never pooled',
      'Full ranked board with tier breaks',
      'Projected fantasy points and points per game',
      'Roster-change tracking across the offseason',
    ],
  },
  {
    id: 'suite',
    name: 'Full Suite',
    priceUsd: SUITE_PRICE_USD,
    cadence: 'One season',
    tagline: 'The kit plus the writing.',
    includes: [
      'Everything in Draft Kit',
      'Written analysis from the Citrus desk',
      'Guest writing from hockey writers we source',
      'Premium sections as they ship',
    ],
  },
];

export function tierSpec(id: DraftKitTier): TierSpec {
  return DRAFT_KIT_TIERS.find((t) => t.id === id) ?? DRAFT_KIT_TIERS[0];
}

/** Display string for a tier's price. No em dashes: house voice rule. */
export function priceLabel(t: TierSpec): string {
  return t.priceUsd == null ? 'Free' : `$${t.priceUsd}`;
}
