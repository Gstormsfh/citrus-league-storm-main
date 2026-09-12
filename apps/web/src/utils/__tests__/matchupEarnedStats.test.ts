import { projectionSettings, ScoringCalculator } from '@citrus/shared';
import { describe, expect, it } from 'vitest';
import { aggregateEarnedStats, elapsedStatDates, finiteEarnedTotal, scopedEarnedPoints, scoreEarnedWeek } from '../matchupEarnedStats';

describe('Matchup earned NHL stats', () => {
  it('scores identical actuals differently for two configured leagues, omitting disabled categories', () => {
    const rows = [{ player_id: 1, goals: 2, assists: 3, hits: 10 }];
    expect(aggregateEarnedStats(rows, { skater: { goals: 6, assists: 2 } }).get(1)?.daily_total_points).toBe(18);
    expect(aggregateEarnedStats(rows, { skater: { hits: 1 } }).get(1)?.daily_total_points).toBe(10);
  });
  it('observes an in-place scoring change without mutating raw counts', () => {
    const settings = { skater: { goals: 2 } };
    const rows = [{ player_id: 1, goals: 3 }];
    expect(aggregateEarnedStats(rows, settings).get(1)?.daily_total_points).toBe(6);
    settings.skater.goals = 5;
    expect(aggregateEarnedStats(rows, settings).get(1)?.daily_total_points).toBe(15);
    expect(rows[0].goals).toBe(3);
  });
  it('keeps zero and negative goalie earned scores without multiplying forecast probability', () => {
    const rows = [{ player_id: 1, is_goalie: true, saves: 10, goals_against: 5, expected_starts: .1 }];
    expect(aggregateEarnedStats(rows, { goalie: { saves: .1, goals_against: -2 } }).get(1)?.daily_total_points).toBe(-9);
    expect(aggregateEarnedStats(rows, { goalie: { saves: 0, goals_against: 0 } }).get(1)?.daily_total_points).toBe(0);
  });
  it('does not manufacture FPTS before league settings are loaded', () => {
    const actual = aggregateEarnedStats([{ player_id: 1, goals: 2 }], null).get(1);
    expect(actual?.goals).toBe(2);
    expect(actual?.daily_total_points).toBeUndefined();
  });
  it('aggregates multiple games and numeric wire values once per player', () => {
    const stats = aggregateEarnedStats([{ player_id: 1, goals: '2', plus_minus: '-1' },
      { player_id: 1, goals: 1, plus_minus: -2 }], { skater: { goals: 2, plus_minus: 1 } }).get(1);
    expect(stats?.goals).toBe(3);
    expect(stats?.daily_total_points).toBe(3);
  });
  it('accepts downward corrections to zero and negative totals, and rejects missing totals', () => {
    expect(finiteEarnedTotal([5, -5])).toBe(0);
    expect(finiteEarnedTotal([-4, 1])).toBe(-3);
    expect(finiteEarnedTotal([])).toBeNull();
    expect(finiteEarnedTotal([NaN])).toBeNull();
  });
  it('requests only elapsed dates including today, never forecast days', () => {
    const dates = Array.from({ length: 7 }, (_, i) => `2026-10-${String(i + 5).padStart(2, '0')}`);
    expect(elapsedStatDates(dates, '2026-10-07')).toEqual(dates.slice(0, 3));
    expect(elapsedStatDates(dates, '2026-10-01')).toEqual([]);
    expect(elapsedStatDates(dates, '2026-10-12')).toEqual(dates);
  });
  it('scores optional catalogue categories with their official field aliases and minute units', () => {
    const rows = [{ player_id: 1, faceoff_wins: 5, faceoff_losses: 2, ppg: 1, toi_seconds: 1200 },
      { player_id: 2, is_goalie: true, even_saves: 10, losses: 1, toi_seconds: 1800 }];
    const results = aggregateEarnedStats(rows, { skater: { faceoff_wins: 1, faceoff_losses: -1,
      power_play_goals: 3, toi_minutes: .1 }, goalie: { even_saves: .2, losses: -2, goalie_toi_minutes: .1 } });
    expect(results.get(1)?.daily_total_points).toBe(8);
    expect(results.get(2)?.daily_total_points).toBe(3);
  });
  it('reports unknown when an enabled category lacks official data or is unsupported', () => {
    expect(aggregateEarnedStats([{ player_id: 1, goals: 2 }],
      { skater: { goals: 1, faceoff_wins: 1 } }).get(1)?.daily_total_points).toBeUndefined();
    expect(aggregateEarnedStats([{ player_id: 1, made_up_stat: 2 }],
      { skater: { made_up_stat: 1 } }).get(1)?.daily_total_points).toBeUndefined();
  });

  it('retains high legitimate weekly counts instead of arbitrarily zeroing a large fantasy score', () => {
    const scorer = new ScoringCalculator(projectionSettings({ skater: { goals: 6, assists: 4, shots_on_goal: 1 },
      goalie: { wins: 5, saves: .6 } }));
    expect(scoreEarnedWeek({ goals: 11, assists: 16, sog: 41 }, scorer, false)).toBe(171);
    expect(scoreEarnedWeek({ wins: 8, saves: 301 }, scorer, true)).toBeCloseTo(220.6);
  });
  it('refuses partial weekly scoring when an enabled official category is absent', () => {
    const scorer = new ScoringCalculator(projectionSettings({ goalie: { saves: 1, goals_against: -2 } }));
    expect(scoreEarnedWeek({ saves: 20 }, scorer, true)).toBeNaN();
  });
  it('keeps daily and weekly earned scopes separate, including dropped-player zero corrections', () => {
    const player = { total_points: 0, daily_total_points: -3, points: 999 };
    expect(scopedEarnedPoints(player, false)).toBe(0);
    expect(scopedEarnedPoints(player, true, 0)).toBe(0);
    expect(scopedEarnedPoints(player, true)).toBe(-3);
    expect(scopedEarnedPoints({ total_points: 20 }, true)).toBeNull();
    expect(scopedEarnedPoints({}, false)).toBeNull();
  });

});
