import { expect, it } from 'vitest';
import { expectedMatchupProjections } from '../matchupExpectedProjections';
import { collectRemainingGames } from '../winProbability';
it('feeds expected workload to matchup outlook without changing raw caches or double-weighting', () => {
  const row = { is_goalie: true, projection_basis: 'conditional_on_start', expected_starts: 5 / 84, projected_saves: 28, projected_wins: 0.5, projected_shutouts: 0, projected_goals_against: 2, total_projected_points: 999 };
  const raw = new Map([['2026-10-01', new Map([[1, row]])]]);
  const saves = expectedMatchupProjections(raw, { goalie: { saves: 1 } });
  const days = [{ date: '2026-10-01', starters: [{ id: 1 }] }];
  expect(collectRemainingGames(days, saves.projections, '2026-10-01')[0].projected).toBeCloseTo(28 * 5 / 84);
  const penalties = expectedMatchupProjections(raw, { goalie: { goals_against: -3 } });
  expect(penalties.projections.get('2026-10-01')!.get(1)!.total_projected_points).toBeCloseTo(-6 * 5 / 84);
  expect(raw.get('2026-10-01')!.get(1)!.total_projected_points).toBe(999);
});
it('marks unavailable goalie exposure separately so callers can withhold incomplete totals', () => {
  const raw = new Map([['2026-10-01', new Map([[1, { is_goalie: true, total_projected_points: 999 }]])]]);
  const result = expectedMatchupProjections(raw, null);
  expect(result.unavailable.get('2026-10-01')!.has(1)).toBe(true);
  expect(result.projections.get('2026-10-01')!.has(1)).toBe(false);
});
