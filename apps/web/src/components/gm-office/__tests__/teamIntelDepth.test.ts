import { describe, expect, it } from 'vitest';
import { calculateStrength, depthPositionsFor, isForward } from '../teamIntelDepth';

describe('calculateStrength', () => {
  it('grades this team per player against the league per-player average', () => {
    expect(calculateStrength('C', 12.5, 10).strength).toBe('Elite');
    expect(calculateStrength('C', 10, 10).strength).toBe('Good');
    expect(calculateStrength('C', 8, 10).strength).toBe('Average');
    expect(calculateStrength('C', 7, 10).strength).toBe('Weak');
  });

  it('refuses to call a position weak when the league has no projections yet', () => {
    // Preseason, 2026-09-10: every position on every roster read "Weak (C)"
    // because a 0 league average was clamped to 1.
    expect(calculateStrength('C', 0, 0)).toEqual({ strength: 'Average', grade: '–' });
    expect(calculateStrength('D', 40, 0).strength).not.toBe('Weak');
    expect(calculateStrength('G', NaN, 10).strength).toBe('Average');
  });
});

describe('depthPositionsFor', () => {
  it('folds forwards into F for an F/D/G league and keeps five positions otherwise', () => {
    expect(depthPositionsFor('forward')).toEqual(['F', 'D', 'G']);
    expect(depthPositionsFor('individual')).toEqual(['C', 'LW', 'RW', 'D', 'G']);
    expect(depthPositionsFor(undefined)).toEqual(['C', 'LW', 'RW', 'D', 'G']);
  });

  it('isForward covers exactly the three forward positions', () => {
    expect(['C', 'LW', 'RW'].every(isForward)).toBe(true);
    expect(['D', 'G', 'F', ''].some(isForward)).toBe(false);
  });
});
