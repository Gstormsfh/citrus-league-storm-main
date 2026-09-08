import { describe, it, expect } from 'vitest';
import { repairSlotAssignments } from '../repairSlotAssignments';
import { buildStarterSlotCounts } from '../slotConfig';

const player = (id: string | number, position = 'LW') => ({ id, position });
describe('commissioner roster settings and legacy assignments', () => {
  it('canonicalizes old UTIL and fills the second slot without counting bench metadata', () => {
    const config = { C: 0, LW: 0, RW: 0, D: 0, G: 0, UTIL: 2 };
    expect(repairSlotAssignments([player(1), player(2)], {
      1: 'slot-UTIL', 2: 'slot-UTIL-2', 3: 'slot-UTIL-1',
    }, 'individual', config)).toEqual({ 1: 'slot-UTIL-1', 2: 'slot-UTIL-2' });
  });
  it('preserves explicit placements and resolves duplicate aliases', () => {
    expect(repairSlotAssignments([player(1), player(2)], {
      1: 'slot-UTIL', 2: 'slot-UTIL-1',
    }, 'individual', { UTIL: 2 })).toEqual({ 1: 'slot-UTIL-2', 2: 'slot-UTIL-1' });
  });
  it('honors zero UTIL and custom forward slots', () => {
    const config = { F: 1, D: 0, G: 0, UTIL: 0, BN: 8, IR: 3 };
    expect(buildStarterSlotCounts('forward', config)).toEqual({ F: 1, UTIL: 0 });
    expect(repairSlotAssignments([player(1, 'C'), player(2, 'RW')], {}, 'forward', config)).toEqual({ 1: 'slot-F-1' });
  });
  it('does not put goalies in utility or reuse a reserved position', () => {
    expect(repairSlotAssignments([player(1, 'G')], {}, 'individual', { G: 0, UTIL: 2 })).toEqual({});
    expect(repairSlotAssignments([player(1, 'C')], {}, 'individual', { C: 2 }, new Set(['slot-C-1']))).toEqual({ 1: 'slot-C-2' });
  });
});
