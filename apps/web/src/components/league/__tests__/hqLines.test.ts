/**
 * The Standings tile's line (2026-09-05). See hqLines.ts.
 */
import { describe, it, expect } from 'vitest';
import { gamesBack, standingsLine } from '../hqLines';

const rows = [
  { team_id: 'a', wins: 5, losses: 0, pointsFor: 612.4 },
  { team_id: 'b', wins: 4, losses: 1, pointsFor: 588.9 },
  { team_id: 'c', wins: 4, losses: 1, pointsFor: 561.2 },
  { team_id: 'd', wins: 2, losses: 3, pointsFor: 498.2 },
];

describe('standingsLine', () => {
  it('place, games back and points for, the way the tile reads it', () => {
    expect(standingsLine(rows, 'b')).toBe("You're 2nd · 1 GB · 588.9 PF");
    expect(standingsLine(rows, 'd')).toBe("You're 4th · 3 GB · 498.2 PF");
  });
  it('the leader has no games back', () => {
    expect(standingsLine(rows, 'a')).toBe("You're 1st · 612.4 PF");
  });
  it('half games print as halves', () => {
    expect(gamesBack({ team_id: 'a', wins: 5, losses: 0, pointsFor: 0 }, { team_id: 'x', wins: 4, losses: 0, pointsFor: 0 })).toBe(0.5);
    expect(standingsLine([rows[0], { team_id: 'x', wins: 4, losses: 0, pointsFor: 10 }], 'x')).toBe("You're 2nd · 0.5 GB · 10.0 PF");
  });
  it('null when the team is not in the table, or the table is empty', () => {
    expect(standingsLine(rows, 'zz')).toBeNull();
    expect(standingsLine([], 'a')).toBeNull();
  });
});
