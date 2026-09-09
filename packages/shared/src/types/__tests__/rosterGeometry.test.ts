import { describe, it, expect } from 'vitest';
import { DEFAULT_ROSTER_SLOTS, draftableRosterSize, NON_DRAFTABLE_SLOTS } from '../league';

/**
 * ROSTER GEOMETRY (2026-09-09). The default layout has 19 draftable spots and
 * 2 IR. roster_size and the default rounds count are the 19, never the 21:
 * counting IR drafted two players more than the lineup could hold.
 */
describe('draftableRosterSize', () => {
  const defaults = Object.fromEntries(DEFAULT_ROSTER_SLOTS.map((s) => [s.slot, s.count]));

  it('excludes IR from the default layout: 19, not 21', () => {
    expect(Object.values(defaults).reduce((a, b) => a + b, 0)).toBe(21);
    expect(draftableRosterSize(defaults)).toBe(19);
  });

  it('is case-insensitive on the IR key and tolerant of junk', () => {
    expect(draftableRosterSize({ C: 2, ir: 3, BN: 1 })).toBe(3);
    expect(draftableRosterSize({ C: 2, IR: undefined, BN: null, D: 'x' as unknown as number })).toBe(2);
    expect(draftableRosterSize(null)).toBe(0);
    expect(draftableRosterSize(undefined)).toBe(0);
  });

  it('IR is the only non-draftable slot', () => {
    expect([...NON_DRAFTABLE_SLOTS]).toEqual(['IR']);
  });
});
