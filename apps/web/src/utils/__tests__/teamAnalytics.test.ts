// PROJECTED vs ACTUAL (2026-08-27)
//
// What these pin is the one thing that makes this file worth having: that a
// number here is measured against what the model TYPICALLY returns, not
// against the model's face value.
//
// The naive version — actual / projected — was measured against production and
// reports every rostered team as ~30% under, because the model's error grows
// with the size of the projection and rostered players sit at the top of that
// range. A page that calls all twelve managers in a league failures is
// measuring the projection system, not the teams.
import { describe, it, expect } from 'vitest';
import {
  CATEGORY_CALIBRATION,
  RADAR_ORDER,
  categoryPerformance,
  rankByExpectation,
  rosterTracking,
} from '../teamAnalytics';

describe('categoryPerformance — measured against calibrated expectation', () => {
  it('a roster hitting the model\'s TYPICAL return reads 100%, not 87%', () => {
    // Goals calibration is 0.874: the model projects 0.198/gm and reality
    // delivers 0.173. A roster projected 100 goals that scores 87.4 has done
    // exactly what such a roster does — that is 100%, not a failure.
    const pts = categoryPerformance({ goals: { projected: 100, actual: 87.4 } });
    const goals = pts.find((p) => p.key === 'goals')!;
    expect(goals.actual).toBe(100);
  });

  it('face-value parity is genuine OUTperformance', () => {
    // Actually scoring the projected 100 beats the typical 87.4 by 14%.
    const pts = categoryPerformance({ goals: { projected: 100, actual: 100 } });
    expect(pts.find((p) => p.key === 'goals')!.actual).toBe(114);
  });

  it('handles the category the model gets BACKWARDS', () => {
    // Hits calibrate at 1.553 — the model under-projects them by a third. A
    // roster projected 100 hits that records 155 is dead average, and saying
    // "155% of expectation" there would be a lie in the flattering direction.
    const pts = categoryPerformance({ hits: { projected: 100, actual: 155.3 } });
    expect(pts.find((p) => p.key === 'hits')!.actual).toBe(100);
  });

  it('renders every axis in a stable order so the shape is comparable', () => {
    const pts = categoryPerformance({});
    expect(pts.map((p) => p.key)).toEqual(RADAR_ORDER);
  });

  it('carries the expectation line as a second series', () => {
    const pts = categoryPerformance({ goals: { projected: 10, actual: 5 } });
    expect(pts.every((p) => p.expected === 100)).toBe(true);
  });

  it('a category with no projection reads 0 rather than dividing by zero', () => {
    const pts = categoryPerformance({ goals: { projected: 0, actual: 0 } });
    const g = pts.find((p) => p.key === 'goals')!;
    expect(Number.isFinite(g.actual)).toBe(true);
    expect(g.actual).toBe(0);
  });

  it('clamps the RENDERED value but keeps the truth in raw', () => {
    // One 400% category would flatten every other axis toward the middle and
    // the shape would stop being readable. The tooltip still gets the truth.
    const pts = categoryPerformance({ goals: { projected: 10, actual: 500 } });
    const g = pts.find((p) => p.key === 'goals')!;
    expect(g.actual).toBe(200);
    expect(g.raw).toEqual({ projected: 10, actual: 500 });
  });

  it('never renders a negative axis', () => {
    const pts = categoryPerformance({ goals: { projected: 10, actual: -5 } });
    expect(pts.find((p) => p.key === 'goals')!.actual).toBe(0);
  });
});

describe('rankByExpectation — relative, because relative survives the bias', () => {
  const mk = (id: string, name: string, projectedPoints: number, actualPoints: number, games = 10) =>
    ({ id, name, position: 'C', projectedPoints, actualPoints, games });

  it('ranks the player beating his own projection first', () => {
    const out = rankByExpectation([
      mk('1', 'Under', 100, 60),
      mk('2', 'Over', 50, 60),
    ]);
    expect(out.map((p) => p.name)).toEqual(['Over', 'Under']);
  });

  it('a uniform inflation of every projection does NOT reorder the ranking', () => {
    // This is the whole reason the page leads with a ranking. The model's
    // error grows with the projection; if that could flip the order, nothing
    // on this page would be trustworthy.
    //
    // The first implementation sorted on actual − expected and FAILED this:
    // A ranked above C before a 1.3x inflation and below it after. A ratio is
    // scaled by the same constant for every player, so the order holds.
    const players = [mk('1', 'A', 40, 44), mk('2', 'B', 80, 70), mk('3', 'C', 20, 25)];
    const before = rankByExpectation(players).map((p) => p.name);
    const inflated = players.map((p) => ({ ...p, projectedPoints: p.projectedPoints * 1.3 }));
    const after = rankByExpectation(inflated).map((p) => p.name);
    expect(after).toEqual(before);
  });

  it('still reports delta, because that is the number a human reads', () => {
    const [top] = rankByExpectation([mk('1', 'Star', 100, 120)]);
    expect(top.delta).toBeCloseTo(120 - 93, 5);
    expect(top.ratio).toBeCloseTo(120 / 93, 5);
  });

  it('a near-zero projection cannot own the top of the list', () => {
    // Projected 0.4, scored 1.2 — a 300% overachiever by ratio, noise in fact.
    const out = rankByExpectation([mk('1', 'Noise', 0.4, 1.2), mk('2', 'Real', 50, 60)]);
    expect(out.map((p) => p.name)).toEqual(['Real']);
  });

  it('drops a sample too small to mean anything', () => {
    // A hat trick in the only game played is not evidence.
    const out = rankByExpectation([mk('1', 'OneGame', 5, 30, 1), mk('2', 'Real', 50, 55, 10)]);
    expect(out.map((p) => p.name)).toEqual(['Real']);
  });

  it('respects a caller-supplied minimum', () => {
    const out = rankByExpectation([mk('1', 'TwoGames', 10, 12, 2)], 2);
    expect(out).toHaveLength(1);
  });

  it('ignores a player with no projection rather than crediting him infinitely', () => {
    const out = rankByExpectation([mk('1', 'NoProj', 0, 40)]);
    expect(out).toHaveLength(0);
  });

  it('orders by ratio even when delta would disagree', () => {
    // Big projection, big absolute delta, mediocre ratio vs a small
    // projection smashed by a wide margin. Ratio is the honest comparison.
    const out = rankByExpectation([mk('1', 'BigDelta', 100, 115), mk('2', 'BigRatio', 10, 20)]);
    expect(out[0].name).toBe('BigRatio');
  });
});

describe('rosterTracking — the headline number', () => {
  it('reports 100 for a roster returning exactly the typical ratio', () => {
    const pts = categoryPerformance({
      goals: { projected: 100, actual: 100 * CATEGORY_CALIBRATION.goals },
      hits: { projected: 100, actual: 100 * CATEGORY_CALIBRATION.hits },
    });
    expect(rosterTracking(pts).pct).toBe(100);
  });

  it('counts only the categories it actually measured, and says how many', () => {
    const pts = categoryPerformance({ goals: { projected: 100, actual: 87.4 } });
    expect(rosterTracking(pts).measured).toBe(1);
  });

  it('returns null rather than 0 when there is nothing to measure', () => {
    // Preseason, or a brand-new team. "0%" would read as catastrophe.
    expect(rosterTracking(categoryPerformance({}))).toEqual({ pct: null, measured: 0 });
  });
});
