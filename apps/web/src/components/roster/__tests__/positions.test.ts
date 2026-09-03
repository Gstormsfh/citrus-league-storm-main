// A PLAYER'S OWN POSITIONS (2026-09-03, WORLD_CLASS_READINESS gap A)
//
// One reading for every roster surface: the listed position always counts,
// first; eligible_positions adds; the label is empty unless there is more
// than one, so a single-position row prints exactly what it printed before.
import { describe, it, expect } from 'vitest';
import { multiPositionLabel, playerPositions, playerPositionsLabel } from '../positions';

describe('playerPositions', () => {
  it('a single-position player is his position', () => {
    expect(playerPositions({ position: 'C' })).toEqual(['C']);
    expect(playerPositions({ position: 'C', eligible_positions: ['C'] })).toEqual(['C']);
  });

  it('a dual-eligible player lists both, primary first', () => {
    expect(playerPositions({ position: 'C', eligible_positions: ['C', 'LW'] })).toEqual(['C', 'LW']);
    expect(playerPositions({ position: 'LW', eligible_positions: ['C', 'LW'] })).toEqual(['LW', 'C']);
  });

  it('the listed position counts even when eligible_positions leaves it out (the server applies the same union)', () => {
    expect(playerPositions({ position: 'C', eligible_positions: ['RW'] })).toEqual(['C', 'RW']);
  });

  it('reads the long-form names the legacy rows still carry', () => {
    expect(playerPositions({ position: 'Left Wing', eligible_positions: ['LW', 'C'] })).toEqual(['LW', 'C']);
    expect(playerPositions({ position: 'Goalie' })).toEqual(['G']);
  });

  it('UTIL is a slot, not a position, and never appears', () => {
    expect(playerPositions({ position: 'C', eligible_positions: ['C', 'UTIL'] })).toEqual(['C']);
  });
});

describe('the labels', () => {
  it('playerPositionsLabel prints "C/LW" for two positions and "C" for one', () => {
    expect(playerPositionsLabel({ position: 'C', eligible_positions: ['C', 'LW'] })).toBe('C/LW');
    expect(playerPositionsLabel({ position: 'D' })).toBe('D');
  });

  it('multiPositionLabel is empty for a single-position player, so rows print nothing new', () => {
    expect(multiPositionLabel({ position: 'C', eligible_positions: ['C', 'LW'] })).toBe('C/LW');
    expect(multiPositionLabel({ position: 'D' })).toBe('');
    expect(multiPositionLabel({ position: 'D', eligible_positions: ['D'] })).toBe('');
  });
});
