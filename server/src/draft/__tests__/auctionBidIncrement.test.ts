// Phase 4.5 chunk 11g.6 sub-step 6c2: pure-function tests for the
// engine-side mirror of `compute_min_next_bid()`. These tests must
// agree behavior-wise with the SQL migration's example comments.

import { describe, it, expect } from 'vitest';
import {
  computeMinimumNextBid,
  validateBidIncrementTiers,
  DEFAULT_BID_INCREMENT_TIERS,
  type BidIncrementTier,
} from '../auctionBidIncrement';

// The §4.5 spec example, kept here so the test file is self-
// contained and the SQL migration's inline comments + this test
// file form a redundant authority on tier semantics.
const SPEC_EXAMPLE_TIERS: ReadonlyArray<BidIncrementTier> = [
  { below: 10, increment: 1 },
  { below: 50, increment: 5 },
  { below: 999, increment: 10 },
];

describe('computeMinimumNextBid (chunk 11g.6 sub-step 6c2)', () => {
  it('default tier (flat $1) — every leading bid produces +$1 minimum', () => {
    expect(computeMinimumNextBid(0, DEFAULT_BID_INCREMENT_TIERS)).toBe(1);
    expect(computeMinimumNextBid(1, DEFAULT_BID_INCREMENT_TIERS)).toBe(2);
    expect(computeMinimumNextBid(50, DEFAULT_BID_INCREMENT_TIERS)).toBe(51);
    expect(computeMinimumNextBid(199, DEFAULT_BID_INCREMENT_TIERS)).toBe(200);
  });

  it('§4.5 example: leading $5 in below-10 tier → +$1 → $6', () => {
    expect(computeMinimumNextBid(5, SPEC_EXAMPLE_TIERS)).toBe(6);
  });

  it('§4.5 example: leading $9 in below-10 tier → +$1 → $10 (strict-less-than: $9 < 10)', () => {
    expect(computeMinimumNextBid(9, SPEC_EXAMPLE_TIERS)).toBe(10);
  });

  it('§4.5 example: leading $10 drops to below-50 tier → +$5 → $15 (boundary: $10 NOT < 10)', () => {
    expect(computeMinimumNextBid(10, SPEC_EXAMPLE_TIERS)).toBe(15);
  });

  it('§4.5 example: leading $50 drops to below-999 tier → +$10 → $60', () => {
    expect(computeMinimumNextBid(50, SPEC_EXAMPLE_TIERS)).toBe(60);
  });

  it('§4.5 example: leading $1000 falls through all tiers → Path A fallback (last tier +$10) → $1010', () => {
    expect(computeMinimumNextBid(1000, SPEC_EXAMPLE_TIERS)).toBe(1010);
  });

  it('non-integer increments work (NUMERIC handles fractional)', () => {
    const tiers: BidIncrementTier[] = [
      { below: 10, increment: 0.5 },
      { below: 100, increment: 2.5 },
    ];
    expect(computeMinimumNextBid(5, tiers)).toBe(5.5);
    expect(computeMinimumNextBid(50, tiers)).toBe(52.5);
  });

  it('throws on empty tier table (configuration error)', () => {
    expect(() => computeMinimumNextBid(5, [])).toThrow(/empty tier table/);
  });
});

describe('validateBidIncrementTiers (chunk 11g.6 sub-step 6c2)', () => {
  it('accepts the default tier table', () => {
    expect(() => validateBidIncrementTiers(DEFAULT_BID_INCREMENT_TIERS)).not.toThrow();
  });

  it('accepts the §4.5 spec example', () => {
    expect(() => validateBidIncrementTiers(SPEC_EXAMPLE_TIERS)).not.toThrow();
  });

  it('rejects non-array input', () => {
    expect(() => validateBidIncrementTiers(null)).toThrow(/non-empty array/);
    expect(() => validateBidIncrementTiers({})).toThrow(/non-empty array/);
    expect(() => validateBidIncrementTiers('flat')).toThrow(/non-empty array/);
  });

  it('rejects empty array', () => {
    expect(() => validateBidIncrementTiers([])).toThrow(/non-empty array/);
  });

  it('rejects negative or zero `below` values', () => {
    expect(() =>
      validateBidIncrementTiers([{ below: 0, increment: 1 }]),
    ).toThrow(/below must be positive/);
    expect(() =>
      validateBidIncrementTiers([{ below: -10, increment: 1 }]),
    ).toThrow(/below must be positive/);
  });

  it('rejects negative or zero `increment` values', () => {
    expect(() =>
      validateBidIncrementTiers([{ below: 10, increment: 0 }]),
    ).toThrow(/increment must be positive/);
    expect(() =>
      validateBidIncrementTiers([{ below: 10, increment: -1 }]),
    ).toThrow(/increment must be positive/);
  });

  it('rejects non-monotonic `below` values', () => {
    expect(() =>
      validateBidIncrementTiers([
        { below: 50, increment: 5 },
        { below: 10, increment: 1 },
      ]),
    ).toThrow(/strictly increasing/);
    expect(() =>
      validateBidIncrementTiers([
        { below: 10, increment: 1 },
        { below: 10, increment: 2 },
      ]),
    ).toThrow(/strictly increasing/);
  });

  it('rejects missing or non-numeric fields', () => {
    expect(() =>
      validateBidIncrementTiers([{ below: '10', increment: 1 }]),
    ).toThrow(/below must be positive/);
    expect(() =>
      validateBidIncrementTiers([{ below: 10, increment: '1' }]),
    ).toThrow(/increment must be positive/);
    expect(() => validateBidIncrementTiers([{ below: 10 }])).toThrow(
      /increment must be positive/,
    );
  });
});
