import { describe, expect, it } from 'vitest';
import { purchaseDate } from '../purchaseDates';

describe('draft-kit purchase calendar', () => {
  it('shows the final Edmonton access day rather than the following UTC day', () => {
    expect(purchaseDate('2027-07-01T05:59:59Z')).toBe('June 30, 2027');
  });
  it('keeps date-only editorial deadlines on their supplied calendar date', () => {
    expect(purchaseDate('2026-10-01')).toBe('October 1, 2026');
  });
  it('does not invent a missing or invalid deadline', () => {
    expect(purchaseDate(null)).toBe('not yet confirmed');
    expect(purchaseDate('invalid')).toBe('not yet confirmed');
  });
});
