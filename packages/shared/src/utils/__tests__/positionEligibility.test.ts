// POSITION ELIGIBILITY (2026-09-03): the reader both sides of the wire share.
//
// `player_directory.eligible_positions` is comma-separated TEXT. The server
// used to type it string[] and call .map on it; the first non-null cell threw
// and the lineup save's position check failed open for the rest of the
// lineup. What this pins:
//
//   * the text form parses, with the primary position always first;
//   * an array parses the same way (fixtures; a future text[] column);
//   * the listed primary is included even when the cell omits it (13 staging
//     rows, 9 production rows do exactly that);
//   * boxscore L/R fold to LW/RW; blanks, case and duplicates are handled;
//   * nothing usable is [] so callers can fail open on it.
import { describe, it, expect } from 'vitest';
import { formatEligiblePositions, parseEligiblePositions } from '../positionEligibility';

describe('parseEligiblePositions', () => {
  it('THE regression: the comma-separated text cell parses instead of throwing', () => {
    expect(parseEligiblePositions('C,LW', 'C')).toEqual(['C', 'LW']);
    expect(parseEligiblePositions('C', 'C')).toEqual(['C']);
  });

  it('accepts an array as well (test fixtures, a future text[] column)', () => {
    expect(parseEligiblePositions(['C', 'LW'], 'C')).toEqual(['C', 'LW']);
    expect(parseEligiblePositions(['G'], 'G')).toEqual(['G']);
  });

  it('always includes the listed primary, first, even when the cell leaves it out', () => {
    // sync_rosters ranks by games played and can drop the API position.
    expect(parseEligiblePositions('RW', 'C')).toEqual(['C', 'RW']);
    expect(parseEligiblePositions('LW,RW', 'C')).toEqual(['C', 'LW', 'RW']);
  });

  it('falls back to the primary alone when the cell is empty', () => {
    expect(parseEligiblePositions(null, 'D')).toEqual(['D']);
    expect(parseEligiblePositions(undefined, 'D')).toEqual(['D']);
    expect(parseEligiblePositions('', 'D')).toEqual(['D']);
    expect(parseEligiblePositions([], 'D')).toEqual(['D']);
  });

  it('normalises case, whitespace, duplicates and the boxscore L/R codes', () => {
    expect(parseEligiblePositions(' c , lw ,C', 'c')).toEqual(['C', 'LW']);
    expect(parseEligiblePositions('L,R', 'LW')).toEqual(['LW', 'RW']);
    expect(parseEligiblePositions(['l'], 'r')).toEqual(['RW', 'LW']);
  });

  it('is empty when nothing usable is known, so callers can fail open', () => {
    expect(parseEligiblePositions(null, null)).toEqual([]);
    expect(parseEligiblePositions(' , ', '')).toEqual([]);
    expect(parseEligiblePositions(undefined, undefined)).toEqual([]);
  });
});

describe('formatEligiblePositions', () => {
  it('joins with a slash the way the cards already print it', () => {
    expect(formatEligiblePositions(['C', 'LW'])).toBe('C/LW');
    expect(formatEligiblePositions(['D'])).toBe('D');
    expect(formatEligiblePositions([])).toBe('');
  });
});
