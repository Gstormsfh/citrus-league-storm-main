import { describe, it, expect } from 'vitest';
import { auctionRules, minimumNextBid, DEFAULT_TIERS } from '../auctionRules';

describe('auctionRules', () => {
  it('reads the commissioner’s minimum bid, budget and tier table', () => {
    const r = auctionRules({
      auctionMinBid: 2,
      auctionBudget: 260,
      auctionMinBidIncrementTiers: [
        { below: 20, increment: 1 },
        { below: 50, increment: 2 },
        { below: 1000, increment: 5 },
      ],
    });
    expect(r.minBid).toBe(2);
    expect(r.budget).toBe(260);
    expect(r.tiers).toHaveLength(3);
  });

  it('falls to the engine’s defaults ($1, flat $1, $200) for a league without them', () => {
    expect(auctionRules(null)).toEqual({ minBid: 1, tiers: DEFAULT_TIERS, budget: 200 });
    expect(auctionRules({ draftType: 'auction' })).toEqual({ minBid: 1, tiers: DEFAULT_TIERS, budget: 200 });
  });

  it('refuses a malformed tier table rather than computing nonsense from it', () => {
    expect(auctionRules({ auctionMinBidIncrementTiers: [{ below: 50, increment: 1 }, { below: 20, increment: 2 }] }).tiers).toBe(DEFAULT_TIERS);
    expect(auctionRules({ auctionMinBidIncrementTiers: [{ below: 50 }] }).tiers).toBe(DEFAULT_TIERS);
    expect(auctionRules({ auctionMinBidIncrementTiers: [] }).tiers).toBe(DEFAULT_TIERS);
  });
});

describe('minimumNextBid', () => {
  const tiers = [
    { below: 20, increment: 1 },
    { below: 50, increment: 2 },
    { below: 1000, increment: 5 },
  ];
  it('adds the increment of the tier the LEADING bid sits in, as the engine does', () => {
    expect(minimumNextBid(5, tiers)).toBe(6);
    expect(minimumNextBid(19, tiers)).toBe(20);
    expect(minimumNextBid(20, tiers)).toBe(22);
    expect(minimumNextBid(49, tiers)).toBe(51);
    expect(minimumNextBid(50, tiers)).toBe(55);
  });
  it('uses the last tier past every ceiling', () => {
    expect(minimumNextBid(5000, tiers)).toBe(5005);
    expect(minimumNextBid(37, DEFAULT_TIERS)).toBe(38);
  });
});
