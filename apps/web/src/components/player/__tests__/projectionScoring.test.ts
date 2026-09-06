import { describe, it, expect } from 'vitest';
import { projectedSummary } from '../projectionScoring';

describe('league-specific projected points', () => {
  it('changes points when a goal is worth 10 instead of 1, with identical raw stats', () => {
    const rows = [{ projected_goals: 20, projected_assists: 30, projected_sog: 100 }];
    const one = projectedSummary(rows, { skater: { goals: 1, assists: 1, shots_on_goal: 0.1 } }, false);
    const ten = projectedSummary(rows, { skater: { goals: 10, assists: 1, shots_on_goal: 0.1 } }, false);
    expect(one.points).toBe(60);
    expect(ten.points).toBe(240);
    expect(one.stats).toEqual(ten.stats);
    expect(Object.values(ten.breakdown).reduce((n, b) => n + b.points, 0)).toBe(240);
  });
  it('only scores the three enabled categories, or all eight when configured', () => {
    const row = { projected_goals: 1, projected_assists: 1, projected_sog: 1, projected_blocks: 1, projected_hits: 1, projected_pim: 1, projected_ppp: 1, projected_shp: 1 };
    const skater = { goals: 1, assists: 1, shots_on_goal: 1 };
    expect(projectedSummary([row], { skater }, false).points).toBe(3);
    expect(projectedSummary([row], { skater: { ...skater, blocks: 1, hits: 1, penalty_minutes: 1, power_play_points: 1, short_handed_points: 1 } }, false).points).toBe(8);
  });
  it('uses start-aware goalie raw totals, including negative goals-against scoring', () => {
    const result = projectedSummary([{ projected_wins_ros: 10, projected_saves_ros: 500, projected_ga_ros: 40, projected_shutouts_ros: 2, total_projected_points: 9999 }], { goalie: { wins: 2, saves: 0.1, goals_against: -1, shutouts: 3 } }, true);
    expect(result.points).toBe(36);
  });
});
