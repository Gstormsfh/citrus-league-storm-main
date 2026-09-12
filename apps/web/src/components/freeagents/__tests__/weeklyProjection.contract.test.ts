import { describe, expect, it } from 'vitest';
import { summarizeWeeklyProjection } from '../weeklyProjection';
import finalsz from '../../../../../../packages/shared/src/leagueProjection/__tests__/fixtures/finalsz-scoring.json';

const league = {
  goalie: { wins: 4, saves: 0.2, goals_against: -1, shutouts: 3 },
  skater: { goals: 6, assists: 2, shots_on_goal: 0.5 },
};
const goalieDay = (day: number, probability: number, overrides: Record<string, unknown> = {}) => ({
  projection_date: `2026-10-${String(day).padStart(2, '0')}`,
  is_goalie: true,
  projection_basis: 'conditional_on_start',
  projected_gp: 1, // Stored conditional exposure is NOT the starting probability.
  expected_starts: probability,
  start_probability: probability,
  projected_wins: 0.5,
  projected_saves: 30,
  projected_goals_against: 3,
  projected_shutouts: 0.05,
  total_projected_points: 999, // A baked default total must never win over categories.
  ...overrides,
});

describe('free-agent weekly goalie contract', () => {
  it('allocates a three-game week across a starter/backup pair instead of giving each three starts', () => {
    const starter = summarizeWeeklyProjection([1, 3, 5].map(d => goalieDay(d, 0.8)), league, true);
    const backup = summarizeWeeklyProjection([1, 3, 5].map(d => goalieDay(d, 0.2)), league, true);
    expect(starter).not.toBeNull();
    expect(backup).not.toBeNull();
    expect(starter!.teamGames).toBe(3);
    expect(backup!.teamGames).toBe(3);
    expect(starter!.expectedStarts).toBeCloseTo(2.4);
    expect(backup!.expectedStarts).toBeCloseTo(0.6);
    expect(starter!.expectedStarts! + backup!.expectedStarts!).toBeCloseTo(3);
    // One conditional start = .5*4 +30*.2 -3 +.05*3 =5.15.
    expect(starter!.points).toBeCloseTo(12.36);
    expect(backup!.points).toBeCloseTo(3.09);
  });

  it('does not impose a one-start cap on tandem or backup goalies', () => {
    const result = summarizeWeeklyProjection([1, 3, 5].map(d => goalieDay(d, 0.5)), league, true);
    expect(result!.expectedStarts).toBeCloseTo(1.5);
    expect(result!.points).toBeCloseTo(7.725);
  });

  it('uses confirmed 1/0 starts without assigning the sitting goalie fallback fantasy points', () => {
    const active = summarizeWeeklyProjection([goalieDay(1, 1)], league, true);
    const sitting = summarizeWeeklyProjection([goalieDay(1, 0)], league, true);
    expect(active!.points).toBeCloseTo(5.15);
    expect(sitting).toEqual({ points: 0, expectedStarts: 0, teamGames: 1 });
  });

  it('does not probability-weight already unconditional component volumes twice', () => {
    const result = summarizeWeeklyProjection([goalieDay(1, 0.25, {
      projection_basis: 'unconditional', projected_gp: 0.25,
      projected_wins: 0.125, projected_saves: 7.5,
      projected_goals_against: 0.75, projected_shutouts: 0.0125,
    })], league, true);
    expect(result!.expectedStarts).toBeCloseTo(0.25);
    expect(result!.points).toBeCloseTo(1.2875);
  });

  it('can use explicit unconditional projected_gp for legacy probability-volume rows', () => {
    const result = summarizeWeeklyProjection([goalieDay(1, 0.25, {
      projection_basis: 'unconditional', expected_starts: undefined,
      start_probability: undefined, projected_gp: 0.25,
      projected_wins: 0.125, projected_saves: 7.5,
      projected_goals_against: 0.75, projected_shutouts: 0.0125,
    })], league, true);
    expect(result!.expectedStarts).toBeCloseTo(0.25);
    expect(result!.points).toBeCloseTo(1.2875);
  });

  it('supports start_probability metadata without mistaking conditional projected_gp1 for certainty', () => {
    const result = summarizeWeeklyProjection([goalieDay(1, 0.3, { expected_starts: undefined })], league, true);
    expect(result!.expectedStarts).toBeCloseTo(0.3);
    expect(result!.points).toBeCloseTo(1.545);
  });

  it.each([
    { projection_basis: undefined },
    { projection_basis: 'unspecified' },
    { expected_starts: undefined, start_probability: undefined },
    { expected_starts: -0.1, start_probability: -0.1 },
    { expected_starts: 1.1, start_probability: 1.1 },
    { expected_starts: Number.NaN, start_probability: Number.NaN },
  ])('keeps missing or invalid probability contracts unavailable: %j', invalid => {
    expect(summarizeWeeklyProjection([goalieDay(1, 0.5, invalid)], league, true)).toBeNull();
  });

  it('does not call a partial week complete when one goalie game lacks allocation evidence', () => {
    expect(summarizeWeeklyProjection([
      goalieDay(1, 0.5),
      goalieDay(3, 0.5, { expected_starts: undefined, start_probability: undefined }),
    ], league, true)).toBeNull();
  });

  it('never substitutes a baked default total when component projections are unavailable', () => {
    expect(summarizeWeeklyProjection([{
      projection_date: '2026-10-01', is_goalie: true,
      projection_basis: 'conditional_on_start', expected_starts: 0.5,
      total_projected_points: 999,
    }], league, true)).toBeNull();
  });

  it('uses current league categories so a saves league and wins league can rank the same tandem differently', () => {
    const starter = [1, 3, 5].map(d => goalieDay(d, 0.5, {
      projected_wins: 0.8, projected_saves: 22,
    }));
    const backup = [1, 3, 5].map(d => goalieDay(d, 0.5, {
      projected_wins: 0.2, projected_saves: 40,
    }));
    const winsLeague = { goalie: { wins: 5 } };
    const savesLeague = { goalie: { saves: 1 } };
    expect(summarizeWeeklyProjection(starter, winsLeague, true)!.points).toBeCloseTo(6);
    expect(summarizeWeeklyProjection(backup, winsLeague, true)!.points).toBeCloseTo(1.5);
    expect(summarizeWeeklyProjection(starter, savesLeague, true)!.points).toBeCloseTo(33);
    expect(summarizeWeeklyProjection(backup, savesLeague, true)!.points).toBeCloseTo(60);
  });

  it('retains zero and negative legitimate custom scores', () => {
    expect(summarizeWeeklyProjection([goalieDay(1, 0.5)], { goalie: {} }, true)!.points).toBe(0);
    expect(summarizeWeeklyProjection([goalieDay(1, 0.5)], { goalie: { goals_against: -2 } }, true)!.points).toBe(-3);
  });

  it('identifies goalie categories from the caller even if an older payload omits is_goalie', () => {
    expect(summarizeWeeklyProjection([goalieDay(1, 0.5, { is_goalie: undefined })], league, true)!.points)
      .toBeCloseTo(2.575);
  });

  it('leaves skater per-game projections on their existing basis', () => {
    const rows = [1, 3, 5].map(d => ({
      projection_date: `2026-10-0${d}`, projected_goals: 0.5,
      projected_assists: 0.5, projected_sog: 2, total_projected_points: 999,
    }));
    expect(summarizeWeeklyProjection(rows, league, false)).toEqual({
      points: 15, expectedStarts: null, teamGames: 3,
    });
  });

  it('distinguishes no projection data from an explicit zero projection', () => {
    expect(summarizeWeeklyProjection([], league, true)).toBeNull();
  });

  it.each([2, 0.5])('scores signed weekly plus/minus at weight %s and withholds missing enabled categories', weight => {
    const row = { projected_goals: 0.5, projected_assists: 0.5, projected_plus_minus: -0.25 };
    const scoring = { skater: { goals: 6, plus_minus: weight } };
    expect(summarizeWeeklyProjection([row, row], scoring, false)?.points).toBe(6 - 0.5 * weight);
    expect(summarizeWeeklyProjection([{ ...row, projected_plus_minus: 0 }], scoring, false)?.points).toBe(3);
    expect(summarizeWeeklyProjection([{ ...row, projected_plus_minus: undefined }], scoring, false)).toBeNull();
    expect(summarizeWeeklyProjection([{ ...row, projected_plus_minus: undefined }], { skater: { goals: 6 } }, false)?.points).toBe(3);
  });

  it('preserves the saved Finalsz plus/minus category while Test night9th leaves it disabled', () => {
    const row = { projected_goals: 1, projected_assists: 1, projected_sog: 2,
      projected_blocks: 1, projected_hits: 1, projected_pim: 0,
      projected_ppp: 0, projected_shp: 0, projected_plus_minus: -2 };
    const testNight = { skater: { goals: 6, assists: 4, shots_on_goal: 0.9, blocks: 1 },
      goalie: { wins: 5, saves: 0.6, shutouts: 5, goals_against: -3 } };
    expect(summarizeWeeklyProjection([row], finalsz, false)?.points).toBeCloseTo(5.5);
    expect(summarizeWeeklyProjection([{ ...row, projected_plus_minus: 0 }], finalsz, false)?.points).toBeCloseTo(6.5);
    expect(summarizeWeeklyProjection([{ ...row, projected_plus_minus: null }], finalsz, false)).toBeNull();
    expect(summarizeWeeklyProjection([{ ...row, projected_plus_minus: null }], testNight, false)?.points).toBeCloseTo(12.8);
  });
});
