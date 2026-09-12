import { describe, expect, it } from 'vitest';
import { expectedDailyProjection, projectionFor } from '..';
import { ScoringCalculator } from '../../utils/scoring';
import type { DashboardIndexEntry } from '../../types/playerDashboard';
const raw = { is_goalie: true, projection_basis: 'conditional_on_start', expected_starts: 5 / 84,
  projected_gp: 1, projected_wins: 0.6, projected_saves: 28, projected_shutouts: 0.1, projected_goals_against: 2,
  projected_gaa: 2, projected_save_pct: 0.933, total_projected_points: 999, starter_confirmed: true, projection_std_dev: 10 };
describe('expected daily projection', () => {
  it('preserves canonical skater expected games without weighting counts twice', () => {
    const result = expectedDailyProjection({ projection_basis: 'unconditional', projected_gp: .5, projected_goals: .25 }, { skater: { goals: 6 } }, false)!;
    expect(result.projected_gp).toBe(.5);
    expect(result.total_projected_points).toBe(1.5);
  });
  it('weights a backup once and scores this league rather than a stored default', () => {
    const result = expectedDailyProjection(raw, { goalie: { saves: 1 } }, true)!;
    expect(result.total_projected_points).toBeCloseTo(28 * 5 / 84);
    expect(result.projected_gp).toBe(5 / 84);
    expect(result.projected_gaa).toBe(2);
    expect(result.projected_save_pct).toBe(0.933);
    expect(result.starter_confirmed).toBe(false);
    expect(result.projection_std_dev).toBeUndefined();
    expect(raw.total_projected_points).toBe(999);
    expect(expectedDailyProjection(result, { goalie: { saves: 1 } }, true)!.total_projected_points).toBe(result.total_projected_points);
  });
  it('supports zero and negative custom scoring', () => {
    expect(expectedDailyProjection({ ...raw, expected_starts: 0 }, { goalie: { saves: 1 } }, true)!.total_projected_points).toBe(0);
    expect(expectedDailyProjection(raw, { goalie: { goals_against: -3 } }, true)!.total_projected_points).toBeCloseTo(-6 * 5 / 84);
  });
  it('returns unavailable for missing probability/counts rather than substituting stored points', () => {
    expect(expectedDailyProjection({ ...raw, expected_starts: null }, null, true)).toBeNull();
    expect(expectedDailyProjection({ ...raw, projection_basis: 'unknown' }, null, true)).toBeNull();
    expect(expectedDailyProjection({ ...raw, projected_saves: null }, null, true)).toBeNull();
  });
  it('preserves supported zero ROS availability without inventing it from missing GP', () => {
    const goalie = { is_goalie: true, proj_gp: 0, proj_wins: 0, proj_saves: 0, proj_shutouts: 0, proj_goals_against: 0 } as DashboardIndexEntry;
    expect(projectionFor(goalie, new ScoringCalculator())).toEqual({ total: 0, perGp: 0, gamesRemaining: 0 });
    expect(projectionFor({ ...goalie, proj_gp: null }, new ScoringCalculator())).toBeNull();
    expect(projectionFor({ ...goalie, proj_saves: null }, new ScoringCalculator())).toBeNull();
  });
});
