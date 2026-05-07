// Phase 4.5 chunk 11g.6 sub-step 6c2: auction tiered bid increments.
//
// Pure helper module exposing the engine-side mirror of the SQL
// `compute_min_next_bid()` function added in
// `supabase/migrations/20260507020000_auction_tiered_bid_increments.sql`.
//
// The two implementations MUST agree on every input — the RPC is
// the durable enforcement layer (defense-in-depth), and the engine
// is the cheap fail-fast layer that avoids round-trips to the RPC
// for obviously-bad bids. Behavioral divergence between the two
// would surface as confusing user UX (engine accepts, RPC rejects
// or vice versa).
//
// Per ADR-002 §4.3 + §4.5: each tier is `{below: number, increment:
// number}`; the tier whose `below` (strictly) exceeds the leading
// bid determines the increment for the next bid. When no tier
// matches (leading bid >= all `below` values), the LAST tier's
// increment is used (Path A gracious fallback).

/**
 * One row of the tiered bid increment table. `below` is the
 * exclusive upper bound: a leading bid satisfies this tier if
 * `leadingBid < tier.below`. `increment` must be positive.
 */
export interface BidIncrementTier {
  below: number;
  increment: number;
}

/**
 * Default tier table per ADR-002 §4.3: flat $1 across all bid
 * values. A single tier with an effectively-unbounded `below`
 * preserves v1 behavior exactly (every bid +$1 minimum). Commissioners
 * configure custom tiers via `leagues.settings.auctionMinBidIncrementTiers`.
 */
export const DEFAULT_BID_INCREMENT_TIERS: ReadonlyArray<BidIncrementTier> = [
  { below: Number.MAX_SAFE_INTEGER, increment: 1 },
] as const;

/**
 * Validate a tier table at config-load time (e.g.,
 * `lookupLobbyConfig`) so commissioner setup errors throw before
 * the draft starts rather than at first bid. Throws with a
 * descriptive message on invalid config.
 *
 * Validation rules (per recon):
 *   - Must be a non-empty array.
 *   - Each element must have positive numeric `below` and
 *     positive numeric `increment`.
 *   - `below` values must be strictly increasing across the array
 *     (no overlapping ranges; monotonic).
 *
 * Returns the input on success (typed as a frozen array for
 * defense against accidental mutation downstream).
 */
export function validateBidIncrementTiers(
  tiers: unknown,
): ReadonlyArray<BidIncrementTier> {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    throw new Error(
      `[auctionBidIncrement] invalid tier table: expected non-empty array, got ${JSON.stringify(tiers)}`,
    );
  }
  let prevBelow = -Infinity;
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i] as Record<string, unknown>;
    const below = t?.below;
    const increment = t?.increment;
    if (typeof below !== 'number' || !Number.isFinite(below) || below <= 0) {
      throw new Error(
        `[auctionBidIncrement] invalid tier table at index ${i}: below must be positive finite number (got ${JSON.stringify(below)})`,
      );
    }
    if (
      typeof increment !== 'number' ||
      !Number.isFinite(increment) ||
      increment <= 0
    ) {
      throw new Error(
        `[auctionBidIncrement] invalid tier table at index ${i}: increment must be positive finite number (got ${JSON.stringify(increment)})`,
      );
    }
    if (below <= prevBelow) {
      throw new Error(
        `[auctionBidIncrement] invalid tier table at index ${i}: below values must be strictly increasing (prev=${prevBelow}, got ${below})`,
      );
    }
    prevBelow = below;
  }
  return tiers as ReadonlyArray<BidIncrementTier>;
}

/**
 * Compute the minimum next bid given the current leading bid and
 * a tier table. Mirrors `compute_min_next_bid()` in the migration.
 *
 * Examples (against the §4.5 spec example tier table
 * `[{below:10,inc:1}, {below:50,inc:5}, {below:999,inc:10}]`):
 *
 *   leading=$5    → tier (below:10)  → +$1  → $6
 *   leading=$9    → tier (below:10)  → +$1  → $10
 *   leading=$10   → tier (below:50)  → +$5  → $15  (strict <)
 *   leading=$50   → tier (below:999) → +$10 → $60
 *   leading=$1000 → no tier matches  → +$10 → $1010 (Path A fallback)
 *
 * @throws if `tiers` is empty (configuration error; validate at
 * config-load time via `validateBidIncrementTiers`).
 */
export function computeMinimumNextBid(
  leadingBid: number,
  tiers: ReadonlyArray<BidIncrementTier>,
): number {
  if (tiers.length === 0) {
    throw new Error(
      '[auctionBidIncrement] computeMinimumNextBid called with empty tier table',
    );
  }
  for (const tier of tiers) {
    if (leadingBid < tier.below) {
      return leadingBid + tier.increment;
    }
  }
  // Path A gracious fallback: leading bid exceeds all `below`
  // ceilings. Use the last tier's increment.
  const lastTier = tiers[tiers.length - 1];
  return leadingBid + lastTier.increment;
}
