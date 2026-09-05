/**
 * THE AUCTION'S MONEY RULES, READ FROM THE LEAGUE (2026-09-05).
 *
 * Garrett: "all create a league settings are CRUCIAL that they are passed
 * through in EVERY SINGLE WAY." The room used to hardcode a $1 minimum bid
 * and a $1 increment; the engine reads `auctionMinBid` and the tier table
 * `auctionMinBidIncrementTiers` from leagues.settings and rejects a bid
 * below them. One place derives the client's copy of the same rules, and
 * `minimumNextBid` mirrors server/src/draft/auctionBidIncrement.ts exactly
 * so the quick-bid button never offers a bid the engine will refuse.
 */
export interface BidIncrementTier {
  below: number;
  increment: number;
}

export interface AuctionRules {
  /** Floor for an opening bid; also the per-slot reserve the engine holds back. */
  minBid: number;
  tiers: ReadonlyArray<BidIncrementTier>;
  budget: number;
}

export const DEFAULT_TIERS: ReadonlyArray<BidIncrementTier> = [{ below: Number.MAX_SAFE_INTEGER, increment: 1 }];

function isTier(t: unknown): t is BidIncrementTier {
  if (!t || typeof t !== 'object') return false;
  const o = t as Record<string, unknown>;
  return typeof o.below === 'number' && o.below > 0 && typeof o.increment === 'number' && o.increment > 0;
}

/** Read the rules off `leagues.settings`; anything malformed falls to the engine's defaults. */
export function auctionRules(settings: unknown): AuctionRules {
  const s = (settings && typeof settings === 'object' ? settings : {}) as Record<string, unknown>;
  const minBid = typeof s.auctionMinBid === 'number' && s.auctionMinBid >= 0 ? s.auctionMinBid : 1;
  const budget = typeof s.auctionBudget === 'number' && s.auctionBudget > 0 ? s.auctionBudget : 200;
  const raw = s.auctionMinBidIncrementTiers;
  let tiers: ReadonlyArray<BidIncrementTier> = DEFAULT_TIERS;
  if (Array.isArray(raw) && raw.length > 0 && raw.every(isTier)) {
    const increasing = raw.every((t, i) => i === 0 || t.below > raw[i - 1].below);
    if (increasing) tiers = raw;
  }
  return { minBid, tiers, budget };
}

/** The least the next bid can be: the leading bid plus the increment of its tier. */
export function minimumNextBid(leadingBid: number, tiers: ReadonlyArray<BidIncrementTier>): number {
  for (const tier of tiers) {
    if (leadingBid < tier.below) return leadingBid + tier.increment;
  }
  return leadingBid + tiers[tiers.length - 1].increment;
}
