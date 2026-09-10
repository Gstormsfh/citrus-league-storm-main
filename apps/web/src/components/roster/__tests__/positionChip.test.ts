import { describe, expect, it } from 'vitest';
import { positionChipKey, positionChipClasses, posColor } from '../positionChip';
import { playerPositions, multiPositionLabel } from '../positions';

// THE LEAGUE DECIDES WHICH LETTERS EXIST (2026-09-10). The F entry had
// shipped in the colour map months earlier and was unreachable: every
// caller passed a raw position and nothing passed the league's format, so
// an F/D/G league showed its forwards as C, LW and RW.

describe('positionChipKey — individual leagues are unchanged', () => {
  it('keeps the five positions and the slot names', () => {
    expect(positionChipKey('C')).toBe('C');
    expect(positionChipKey('Left Wing')).toBe('LW');
    expect(positionChipKey('goalie')).toBe('G');
    expect(positionChipKey('utility')).toBe('UTIL');
    expect(positionChipKey('UTIL')).toBe('UTIL');
    expect(positionChipKey('')).toBe('');
    expect(positionChipKey(null)).toBe('');
  });

  it('renders an unknown slot as something reportable rather than blank', () => {
    expect(positionChipKey('WINGBACK')).toBe('WI');
  });
});

describe('positionChipKey — an F/D/G league folds its forwards', () => {
  it('reads F for every forward, whatever the wire spelling', () => {
    for (const raw of ['C', 'centre', 'LW', 'Left Wing', 'RW', 'R', 'F', 'forward']) {
      expect(positionChipKey(raw, 'forward'), raw).toBe('F');
    }
  });

  it('leaves defence, goalies and UTIL alone', () => {
    expect(positionChipKey('D', 'forward')).toBe('D');
    expect(positionChipKey('Defence', 'forward')).toBe('D');
    expect(positionChipKey('G', 'forward')).toBe('G');
    expect(positionChipKey('UTIL', 'forward')).toBe('UTIL');
  });

  it('folds BEFORE the exact-key lookup, or C short-circuits on its own map entry', () => {
    expect(Object.prototype.hasOwnProperty.call(posColor, 'C')).toBe(true);
    expect(positionChipKey('C', 'forward')).not.toBe('C');
  });
});

describe('the chip a forward wears', () => {
  it('F carries the brand orange, and never renders in the same league as RW', () => {
    expect(posColor.F).toBe('bg-pastel-orange text-white');
    expect(posColor.F).toBe(posColor.RW);
    expect(positionChipClasses('F')).toContain('bg-pastel-orange');
    expect(positionChipClasses('F')).toContain('ring-pastel-orange/30');
  });

  it('every key the folder can produce has a colour, so no fold lands on the fallback', () => {
    for (const key of ['C', 'LW', 'RW', 'D', 'G', 'UTIL', 'F']) {
      expect(posColor[key], key).toBeTruthy();
    }
  });
});

describe('a player’s own positions follow the same rule', () => {
  const dual = { position: 'C', eligible_positions: ['C', 'LW'] };

  it('prints C/LW where the league distinguishes them', () => {
    expect(playerPositions(dual)).toEqual(['C', 'LW']);
    expect(multiPositionLabel(dual)).toBe('C/LW');
  });

  it('collapses to one F in an F/D/G league, so the row stops claiming a distinction the league does not make', () => {
    expect(playerPositions(dual, 'forward')).toEqual(['F']);
    expect(multiPositionLabel(dual, 'forward')).toBe('');
  });

  it('still separates a forward from a defenceman in an F/D/G league', () => {
    expect(playerPositions({ position: 'LW', eligible_positions: ['LW', 'D'] }, 'forward')).toEqual(['F', 'D']);
  });
});
