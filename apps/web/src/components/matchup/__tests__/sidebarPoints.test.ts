import { describe, expect, it } from 'vitest';
import { sidebarFantasyPoints } from '../sidebarPoints';
import type { MatchupPlayer } from '../types';
const player = (fields: Partial<MatchupPlayer>) => ({ id: '1', position: 'G', ...fields }) as MatchupPlayer;
describe('matchup sidebar actual fantasy points', () => {
  it('retains earned zero and negative totals instead of falling through to NHL points', () => {
    expect(sidebarFantasyPoints(player({ total_points: 0, points: 99 }), null, true)).toBe(0);
    expect(sidebarFantasyPoints(player({ total_points: -2, points: 99 }), null, true)).toBe(-2);
  });
  it('reweights raw goalie actuals with custom settings when total points are absent', () => {
    const p = player({ matchupStats: { saves: 10, goals_against: 3 } });
    expect(sidebarFantasyPoints(p, { goalie: { saves: 1, goals_against: -2 } }, true)).toBe(4);
    expect(sidebarFantasyPoints(p, { goalie: { saves: 2, goals_against: -2 } }, true)).toBe(14);
  });
  it('does not present NHL points or unloaded settings as fantasy points', () => {
    expect(sidebarFantasyPoints(player({ points: 99 }), null, true)).toBeNull();
    expect(sidebarFantasyPoints(player({ total_points: 10 }), null, false)).toBeNull();
  });
});
