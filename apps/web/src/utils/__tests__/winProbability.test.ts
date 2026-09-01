// Win chance lock (2026-09-01, Sleeper parity audit M1).
//
// The matchup header used to print my / (my + opp) — a share of the points
// scored so far, not a probability — so a 10.5–3.2 lead on Monday morning
// read "77%". This file pins the replacement: expected finals from banked
// points + remaining projections, Φ(margin / σ), clamped so nothing reads
// "certain" while games remain, and honest 100/0 once nothing is left.

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_GAME_SD,
  MIN_GAME_SD,
  WIN_PROB_CEIL,
  WIN_PROB_FLOOR,
  collectRemainingGames,
  computeWinProbability,
  enumerateWeekDates,
  gameFractionRemaining,
  normalCdf,
  projectTeam,
  winProbabilityFromTotals,
  type RemainingGame,
  type StarterDay,
} from '../winProbability';

const games = (n: number, projected: number, extra: Partial<RemainingGame> = {}): RemainingGame[] =>
  Array.from({ length: n }, () => ({ projected, ...extra }));

describe('normalCdf', () => {
  it('is the standard normal CDF', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
    expect(normalCdf(3)).toBeCloseTo(0.99865, 4);
  });

  it('is symmetric and handles the extremes', () => {
    for (const z of [0.3, 1.1, 2.7]) {
      expect(normalCdf(z) + normalCdf(-z)).toBeCloseTo(1, 6);
    }
    expect(normalCdf(Infinity)).toBe(1);
    expect(normalCdf(-Infinity)).toBe(0);
    expect(normalCdf(Number.NaN)).toBe(0.5);
  });
});

describe('projectTeam', () => {
  it('adds banked points to the remaining projections', () => {
    const p = projectTeam(40, games(3, 2.5));
    expect(p.expectedFinal).toBeCloseTo(47.5);
    expect(p.gamesLeft).toBe(3);
  });

  it('falls back to DEFAULT_GAME_SD when the model gives no std dev', () => {
    const p = projectTeam(0, games(4, 1));
    expect(p.variance).toBeCloseTo(4 * DEFAULT_GAME_SD * DEFAULT_GAME_SD);
  });

  it('uses the model std dev when present, floored at MIN_GAME_SD', () => {
    const p = projectTeam(0, [
      { projected: 3, stdDev: 5 },
      { projected: 3, stdDev: 0.9 }, // the pipeline's 0.3×points fallback
    ]);
    expect(p.variance).toBeCloseTo(5 * 5 + MIN_GAME_SD * MIN_GAME_SD);
  });

  it('scales a live game by the fraction still unplayed', () => {
    const p = projectTeam(10, [{ projected: 4, stdDev: 4, fractionRemaining: 0.25 }]);
    expect(p.expectedFinal).toBeCloseTo(11);
    expect(p.variance).toBeCloseTo(0.25 * 16);
    expect(p.gamesLeft).toBe(1);
  });

  it('ignores games with nothing left', () => {
    const p = projectTeam(10, [{ projected: 4, fractionRemaining: 0 }]);
    expect(p.expectedFinal).toBe(10);
    expect(p.variance).toBe(0);
    expect(p.gamesLeft).toBe(0);
  });
});

describe('winProbabilityFromTotals', () => {
  it('is 50% when the expected finals are level and games remain', () => {
    const r = winProbabilityFromTotals({ myExpectedFinal: 90, oppExpectedFinal: 90, myGamesLeft: 10, oppGamesLeft: 10 });
    expect(r.probability).toBeCloseTo(0.5);
    expect(r.settled).toBe(false);
    expect(r.sigma).toBeCloseTo(Math.sqrt(20) * DEFAULT_GAME_SD);
  });

  it('is monotonic in the margin', () => {
    let last = 0;
    for (const mine of [80, 85, 90, 95, 100, 110, 130]) {
      const r = winProbabilityFromTotals({ myExpectedFinal: mine, oppExpectedFinal: 90, myGamesLeft: 20, oppGamesLeft: 20 });
      expect(r.probability).toBeGreaterThanOrEqual(last);
      last = r.probability;
    }
  });

  it('is symmetric: my chance and the opponent chance sum to 1', () => {
    const a = winProbabilityFromTotals({ myExpectedFinal: 104, oppExpectedFinal: 91, myGamesLeft: 12, oppGamesLeft: 15 });
    const b = winProbabilityFromTotals({ myExpectedFinal: 91, oppExpectedFinal: 104, myGamesLeft: 15, oppGamesLeft: 12 });
    expect(a.probability + b.probability).toBeCloseTo(1, 6);
  });

  it('never reads certain while games remain', () => {
    const up = winProbabilityFromTotals({ myExpectedFinal: 500, oppExpectedFinal: 10, myGamesLeft: 1, oppGamesLeft: 0 });
    const down = winProbabilityFromTotals({ myExpectedFinal: 10, oppExpectedFinal: 500, myGamesLeft: 0, oppGamesLeft: 1 });
    expect(up.probability).toBe(WIN_PROB_CEIL);
    expect(down.probability).toBe(WIN_PROB_FLOOR);
    expect(up.settled).toBe(false);
  });

  it('reports the decided result once nothing is left to play', () => {
    expect(winProbabilityFromTotals({ myExpectedFinal: 100, oppExpectedFinal: 80, myGamesLeft: 0, oppGamesLeft: 0 }))
      .toMatchObject({ probability: 1, settled: true, sigma: 0 });
    expect(winProbabilityFromTotals({ myExpectedFinal: 60, oppExpectedFinal: 90, myGamesLeft: 0, oppGamesLeft: 0 }))
      .toMatchObject({ probability: 0, settled: true });
    expect(winProbabilityFromTotals({ myExpectedFinal: 75, oppExpectedFinal: 75, myGamesLeft: 0, oppGamesLeft: 0 }))
      .toMatchObject({ probability: 0.5, settled: true });
  });

  it('honours an explicit variance over the games-left fallback', () => {
    const tight = winProbabilityFromTotals({ myExpectedFinal: 100, oppExpectedFinal: 90, myGamesLeft: 5, oppGamesLeft: 5, variance: 4 });
    const loose = winProbabilityFromTotals({ myExpectedFinal: 100, oppExpectedFinal: 90, myGamesLeft: 5, oppGamesLeft: 5 });
    expect(tight.sigma).toBe(2);
    expect(tight.probability).toBeGreaterThan(loose.probability);
  });
});

describe('computeWinProbability — the Monday-morning case', () => {
  it('a tiny early lead is a coin flip, not 77%', () => {
    // Sunday's games are in: 10.5–3.2. Six days and ~45 starter-games a side
    // remain, projecting ~2 points each. The old share-of-points formula
    // printed round(10.5 / 13.7) = 77%.
    const r = computeWinProbability(
      { points: 10.5, remaining: games(45, 2.0) },
      { points: 3.2, remaining: games(45, 2.0) },
    );
    expect(r.myExpectedFinal).toBeCloseTo(100.5);
    expect(r.oppExpectedFinal).toBeCloseTo(93.2);
    expect(r.probability).toBeGreaterThan(0.5);
    expect(r.probability).toBeLessThan(0.6);
    expect(r.probability).toBeLessThanOrEqual(WIN_PROB_CEIL);
    expect(r.settled).toBe(false);
    expect(r.myGamesLeft).toBe(45);
  });

  it('a lopsided lead on the last live game is confident but not certain', () => {
    const r = computeWinProbability(
      { points: 120, remaining: [{ projected: 3, fractionRemaining: 0.1 }] },
      { points: 90, remaining: [{ projected: 3, fractionRemaining: 0.1 }] },
    );
    expect(r.probability).toBe(WIN_PROB_CEIL);
    expect(r.settled).toBe(false);
  });

  it('a finished week is decided', () => {
    const r = computeWinProbability({ points: 88.4, remaining: [] }, { points: 101.2, remaining: [] });
    expect(r.probability).toBe(0);
    expect(r.settled).toBe(true);
    expect(r.myExpectedFinal).toBeCloseTo(88.4);
  });

  it('a week that has not started is projection against projection', () => {
    const r = computeWinProbability(
      { points: 0, remaining: games(48, 2.2) },
      { points: 0, remaining: games(50, 2.0) },
    );
    expect(r.myExpectedFinal).toBeCloseTo(105.6);
    expect(r.oppExpectedFinal).toBeCloseTo(100);
    expect(r.probability).toBeGreaterThan(0.5);
    expect(r.probability).toBeLessThan(0.65);
  });
});

describe('gameFractionRemaining', () => {
  it('reads the schedule row', () => {
    expect(gameFractionRemaining({ status: 'scheduled' })).toBe(1);
    expect(gameFractionRemaining({ status: 'final', period: '3rd' })).toBe(0);
    expect(gameFractionRemaining({ status: 'postponed' })).toBe(0);
  });

  it('uses the period clock when it has one', () => {
    expect(gameFractionRemaining({ status: 'live', period: '2nd', period_time: '10:00' })).toBeCloseTo(0.5);
    expect(gameFractionRemaining({ status: 'live', period: '1st', period_time: '20:00' })).toBeCloseTo(1);
    expect(gameFractionRemaining({ status: 'live', period: '3rd', period_time: '00:30' })).toBeCloseTo(0.5 / 60);
  });

  it('handles intermissions, unknown clocks and overtime', () => {
    expect(gameFractionRemaining({ status: 'intermission', period: '1st', period_time: 'INT' })).toBeCloseTo(2 / 3);
    expect(gameFractionRemaining({ status: 'live', period: '3rd', period_time: null })).toBeCloseTo(0.5 / 3);
    expect(gameFractionRemaining({ status: 'live', period: 'OT', period_time: '03:12' })).toBe(0.05);
    expect(gameFractionRemaining({ status: 'live', period: 'SO' })).toBe(0.05);
  });

  it('treats a stale "scheduled" row with a score on it as started', () => {
    expect(gameFractionRemaining({ status: 'scheduled', home_score: 2, away_score: 1 })).toBe(0.5);
  });
});

describe('collectRemainingGames', () => {
  const projections = new Map<string, Map<number, { total_projected_points?: number; projection_std_dev?: number; game_start_time?: string | null }>>([
    ['2026-01-05', new Map([[1, { total_projected_points: 3.1, projection_std_dev: 4.2 }], [2, { total_projected_points: 2.0 }]])],
    ['2026-01-06', new Map([[1, { total_projected_points: 2.8 }], [3, { total_projected_points: 1.5, game_start_time: '2026-01-07T02:00:00Z' }]])],
  ]);
  const today = '2026-01-05';

  it('skips banked days and final games, keeps scheduled and live ones', () => {
    const days: StarterDay[] = [
      { date: '2026-01-04', starters: [{ id: 1, games: [{ game_date: '2026-01-04', status: 'final' }] }] },
      {
        date: '2026-01-05',
        starters: [
          { id: 1, games: [{ game_date: '2026-01-05', status: 'live', period: '2nd', period_time: '10:00' }] },
          { id: 2, games: [{ game_date: '2026-01-05', status: 'final' }] },
        ],
      },
      { date: '2026-01-06', starters: [{ id: 1, games: [{ game_date: '2026-01-06T00:00:00', status: 'scheduled' }] }] },
    ];
    const out = collectRemainingGames(days, projections, today);
    expect(out).toEqual([
      { projected: 3.1, stdDev: 4.2, fractionRemaining: 0.5 },
      { projected: 2.8, stdDev: undefined, fractionRemaining: 1 },
    ]);
  });

  it('a day with no schedule row and no projection is a day off', () => {
    const days: StarterDay[] = [{ date: '2026-01-06', starters: [{ id: 2, games: [] }] }];
    expect(collectRemainingGames(days, projections, today)).toEqual([]);
  });

  it('a scheduled game with no projection still counts, at 0 expected points', () => {
    const days: StarterDay[] = [{ date: '2026-01-06', starters: [{ id: 99, games: [{ game_date: '2026-01-06', status: 'scheduled' }] }] }];
    expect(collectRemainingGames(days, projections, today)).toEqual([
      { projected: 0, stdDev: undefined, fractionRemaining: 1 },
    ]);
  });

  it('falls back to the projection start time when the schedule row is missing', () => {
    const days: StarterDay[] = [{ date: '2026-01-06', starters: [{ id: 3, games: [] }] }];
    const beforePuckDrop = Date.parse('2026-01-06T20:00:00Z');
    const midGame = Date.parse('2026-01-07T03:15:00Z'); // 75 min in → half left
    const longAfter = Date.parse('2026-01-07T09:00:00Z');
    expect(collectRemainingGames(days, projections, today, beforePuckDrop)[0].fractionRemaining).toBe(1);
    expect(collectRemainingGames(days, projections, today, midGame)[0].fractionRemaining).toBeCloseTo(0.5);
    expect(collectRemainingGames(days, projections, today, longAfter)).toEqual([]);
  });

  it('accepts string player ids and string projection values', () => {
    const loose = new Map<string, Map<number, { total_projected_points?: string; projection_std_dev?: string }>>([
      ['2026-01-06', new Map([[7, { total_projected_points: '2.40', projection_std_dev: '3.30' }]])],
    ]);
    const days: StarterDay[] = [{ date: '2026-01-06', starters: [{ id: '7', games: [{ game_date: '2026-01-06', status: 'scheduled' }] }] }];
    expect(collectRemainingGames(days, loose, today)).toEqual([
      { projected: 2.4, stdDev: 3.3, fractionRemaining: 1 },
    ]);
  });
});

describe('enumerateWeekDates', () => {
  it('walks Sunday to Saturday inclusive', () => {
    expect(enumerateWeekDates('2026-03-08', '2026-03-14')).toEqual([
      '2026-03-08', '2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13', '2026-03-14',
    ]);
  });

  it('is empty for missing or malformed bounds', () => {
    expect(enumerateWeekDates('', '2026-03-14')).toEqual([]);
    expect(enumerateWeekDates('nope', '2026-03-14')).toEqual([]);
  });
});
