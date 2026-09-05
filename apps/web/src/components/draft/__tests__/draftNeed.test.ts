/**
 * Stormy's need line (2026-09-05). See draftNeed.ts.
 */
import { describe, it, expect } from 'vitest';
import { draftNeedLine } from '../draftNeed';

const caps = { C: 2, LW: 2, RW: 2, D: 4, G: 2 };
const pool = ['d1', 'c1', 'd2', 'lw1', 'd3', 'g1', 'rw1', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9'];
const positionOf = (id: string) => (id.startsWith('lw') ? 'LW' : id.startsWith('rw') ? 'RW' : id[0].toUpperCase());

describe('draftNeedLine', () => {
  it('names the position with the most open slots and counts its top eight inside the picks ahead', () => {
    // Drafted 2 C, 1 D, 1 G: D needs 3, the most. 11 picks before my turn:
    // of the top-8 D (d1..d8, at pool indexes 0,2,4,7,8,9,10,11), those under 11 are d1,d2,d3,d4,d5,d6,d7 = 7.
    const line = draftNeedLine({ caps, myPositions: ['C', 'C', 'D', 'G'], orderedIds: pool, positionOf, picksAway: 11 });
    expect(line).toEqual({ position: 'D', need: 3, topEightGone: 7, text: 'Need 3 D · 7 of the top-8 D go before your next pick' });
  });

  it('reads "none" when your turn is next', () => {
    const line = draftNeedLine({ caps, myPositions: ['C', 'C', 'LW', 'LW', 'RW', 'RW', 'G', 'G', 'D'], orderedIds: pool, positionOf, picksAway: 0 });
    expect(line?.text).toBe('Need 3 D · none of the top-8 D go before your next pick');
  });

  it('with no picks-away in hand the line is the need alone', () => {
    const line = draftNeedLine({ caps, myPositions: [], orderedIds: pool, positionOf, picksAway: null });
    expect(line?.text).toBe('Need 4 D');
  });

  it('null once every slot is filled, and null with no roster shape', () => {
    expect(draftNeedLine({ caps, myPositions: ['C', 'C', 'LW', 'LW', 'RW', 'RW', 'D', 'D', 'D', 'D', 'G', 'G'], orderedIds: pool, positionOf, picksAway: 3 })).toBeNull();
    expect(draftNeedLine({ caps: null, myPositions: [], orderedIds: pool, positionOf, picksAway: 3 })).toBeNull();
  });

  it('a position with no players left in the pool has no top-eight to count', () => {
    const line = draftNeedLine({ caps: { G: 2 }, myPositions: [], orderedIds: ['d1', 'c1'], positionOf, picksAway: 5 });
    expect(line?.text).toBe('Need 2 G');
  });
});
