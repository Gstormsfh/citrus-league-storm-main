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

import { scoreGameLog, seasonProjectionSummary } from '../projectionScoring';
import type { GameLogEntry } from '../gameLogRows';

describe('played game league scoring', () => {
  const entry: GameLogEntry = { date: '2026-01-01', dayLabel: 'Thu', dateLabel: 'Jan 1', opponent: '@ PIT', projectedPoints: 0, projection: null, isToday: false, computedConfidence: 0, isPast: true, isGoalie: false, actualPoints: 999, actualStats: { goals: 2, assists: 1, sog: 4 } };
  it('rescales the same cached raw game on a league switch and leaves its source unchanged', () => {
    expect(scoreGameLog([entry], { skater: { goals: 1 } })[0].actualPoints).toBe(2);
    expect(scoreGameLog([entry], { skater: { goals: 10, assists: 2 } })[0].actualPoints).toBe(22);
    expect(entry.actualPoints).toBe(999);
  });
  it('preserves DNP as missing rather than inventing a zero from cached default points', () => {
    expect(scoreGameLog([{ ...entry, actualStats: undefined }], null)[0].actualPoints).toBeUndefined();
  });
  it('retains negative goalie totals under league settings', () => {
    const goalie = { ...entry, isGoalie: true, actualStats: { saves: 10, goals_against: 5 } };
    expect(scoreGameLog([goalie], { goalie: { saves: 0.1, goals_against: -2 } })[0].actualPoints).toBe(-9);
  });
});


describe('season headline exposure and missing-data behavior', () => {
  it('retains GP-aware totals without multiplying by the team schedule again', () => {
    const row = { games_remaining: 40, projected_goals: 10, total_projected_points: 999 };
    expect(seasonProjectionSummary(row, { skater: { goals: 2 } }, false)).toMatchObject({ points: 20, gp: 40 });
  });
  it('does not synthesize a forecast when ROS is absent or malformed', () => {
    expect(seasonProjectionSummary(null, null, true)).toBeNull();
    expect(seasonProjectionSummary({ projected_saves_ros: 100 }, null, true)).toBeNull();
    expect(seasonProjectionSummary({ games_remaining: 84 }, null, false)).toBeNull();
  });
  it('retains a supported zero-start forecast as zero', () => {
    expect(seasonProjectionSummary({ games_remaining: 0, projected_saves_ros: 0, projected_wins_ros: 0, projected_ga_ros: 0, projected_shutouts_ros: 0 }, null, true)).toMatchObject({ points: 0, gp: 0 });
  });
});

describe('daily projection league scoring', () => {
  const entry: GameLogEntry = { date: '2026-10-10', dayLabel: 'Sat', dateLabel: 'Oct 10', opponent: '@ PIT', projectedPoints: 999, projection: { projected_goals: 0.5, projected_assists: 1, likely_low: 3, likely_high: 10, projection_std_dev: 2 }, isToday: false, computedConfidence: 0, isPast: false, isGoalie: false };
  it('rescores future raw categories without mutating the cached source or presenting default-score intervals', () => {
    const scored = scoreGameLog([entry], { skater: { goals: 10, assists: 2 } })[0];
    expect(scored.projectedPoints).toBe(7);
    expect(scored.projection?.likely_low).toBeNull();
    expect(entry.projectedPoints).toBe(999);
    expect(entry.projection?.likely_low).toBe(3);
  });
  it('keeps valid zero and negative daily points visible but missing projections absent', async () => {
    const { upcomingRows } = await import('../gameLogRows');
    const negative = { ...entry, isGoalie: true, projection: { projection_basis: 'unconditional', expected_starts: 0.5, projected_wins: 0, projected_shutouts: 0, projected_saves: 10, projected_goals_against: 5 } };
    expect(upcomingRows(scoreGameLog([negative], { goalie: { saves: 0.1, goals_against: -2 } }), true)[0].points).toBe(-9);
    expect(upcomingRows(scoreGameLog([entry], { skater: { goals: 0 } }), false)[0].points).toBe(0);
    expect(upcomingRows(scoreGameLog([{ ...entry, projection: null }], null), false)[0].points).toBeNull();
  });
  it('shows workload-adjusted goalie categories and starts without changing cached per-start inputs', async () => {
    const { upcomingRows } = await import('../gameLogRows');
    const raw = { ...entry, isGoalie: true, projection: { projection_basis: 'conditional_on_start', expected_starts: 0.2, projected_wins: 0.5, projected_shutouts: 0, projected_saves: 25, projected_goals_against: 3 } };
    const scored = scoreGameLog([raw], { goalie: { saves: 1, goals_against: -2 } });
    expect(scored[0].projectedPoints).toBeCloseTo(3.8);
    expect(upcomingRows(scored, true)[0].cells).toEqual(['0.20', '0.10', '5', '0.6', '–']);
    expect(raw.projection.projected_saves).toBe(25);
    expect(scoreGameLog(scored, { goalie: { saves: 1, goals_against: -2 } })[0].projectedPoints).toBeCloseTo(3.8);
  });
  it('does not display conditional goalie counts when start exposure is unknown', async () => {
    const { upcomingRows } = await import('../gameLogRows');
    const scored = scoreGameLog([{ ...entry, isGoalie: true, projection: { projected_wins: 0.5, projected_shutouts: 0, projected_saves: 25, projected_goals_against: 3 } }], null);
    expect(upcomingRows(scored, true)[0].cells).toEqual(['–', '–', '–', '–', '–']);
    expect(upcomingRows(scored, true)[0].points).toBeNull();
  });
});

import finalsz from '../../../../../../packages/shared/src/leagueProjection/__tests__/fixtures/finalsz-scoring.json';

describe('Finalsz modal and log completeness', () => {
  const row = { projected_goals: 1.2, projected_assists: 2, projected_ppp: .5,
    projected_sog: 4, projected_blocks: 1.5, projected_hits: 3, projected_pim: .5,
    projected_shp: .1, projected_plus_minus: -2, games_remaining: 10 };
  const entry: GameLogEntry = { date: '2026-10-10', dayLabel: 'Sat', dateLabel: 'Oct 10',
    opponent: '@ PIT', projectedPoints: 999, projection: row, isToday: false,
    computedConfidence: 0, isPast: false, isGoalie: false };
  it('includes signed plus/minus in the same league-scored season and daily totals', () => {
    expect(seasonProjectionSummary(row, finalsz, false)?.points).toBeCloseTo(10.5);
    expect(projectedSummary([row], finalsz, false).stats.plus_minus).toBe(-2);
    expect(scoreGameLog([entry], finalsz)[0].projectedPoints).toBeCloseTo(10.5);
    expect(entry.projectedPoints).toBe(999);
  });
  it('keeps absent required components unavailable in headlines and upcoming rows', async () => {
    const { projected_plus_minus, ...missing } = row;
    const { upcomingRows } = await import('../gameLogRows');
    expect(seasonProjectionSummary(missing, finalsz, false)).toBeNull();
    expect(projectedSummary([row, missing], finalsz, false).points).toBeNull();
    const log = scoreGameLog([{...entry, projection: missing}], finalsz);
    expect(log[0].projectedPoints).toBeNull();
    expect(upcomingRows(log, false)[0].points).toBeNull();
    expect(seasonProjectionSummary({...row, projected_plus_minus: 0}, finalsz, false)?.points).toBeCloseTo(11.5);
  });
});
