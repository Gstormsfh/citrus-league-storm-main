/**
 * Unit tests for the cohort/percentile math behind PlayerAdvancedCard.
 *
 * The module's whole value is that its numbers are honest, so every claim
 * its header makes is pinned here: the cohort split, the minimum-sample
 * threshold, the tie rule, the direction flip, and every degenerate input
 * (empty cohort, single member, null, NaN).
 */
import { describe, it, expect } from 'vitest';
import {
  DISTRIBUTION_MIN_GP,
  buildMetricScale,
  emptyScale,
  percentileOnScale,
  placeOnScale,
  playerCohort,
  qualifiedCohort,
  scaleFrom,
  type MetricScale,
} from '../playerPercentiles';

interface Row {
  position: string;
  is_goalie: boolean;
  gp: number;
  v?: number | null;
}

const row = (position: string, gp: number, v?: number | null, is_goalie = false): Row => ({
  position,
  is_goalie,
  gp,
  v,
});

/** Ascending scale of 1..10 — one value per decile, so percentiles are exact. */
const ONE_TO_TEN: MetricScale = { values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], direction: 'higher' };

describe('playerCohort', () => {
  it('routes goalies to G by the explicit flag, whatever the position string says', () => {
    expect(playerCohort({ position: 'G', is_goalie: true })).toBe('G');
    // A blank/garbled position_code on a directory row must not un-goalie him.
    expect(playerCohort({ position: '', is_goalie: true })).toBe('G');
    expect(playerCohort({ position: 'C', is_goalie: true })).toBe('G');
  });

  it('routes goalies to G on the position string when the flag is missing', () => {
    expect(playerCohort({ position: 'G', is_goalie: false })).toBe('G');
    expect(playerCohort({ position: 'Goalie', is_goalie: false })).toBe('G');
  });

  it('routes every spelling of defence to D', () => {
    for (const p of ['D', 'd', 'Defence', 'Defense', 'defenceman', 'DEFENSEMAN']) {
      expect(playerCohort({ position: p, is_goalie: false })).toBe('D');
    }
  });

  it('pools all forwards — C, wings and unknown skaters — into F', () => {
    for (const p of ['C', 'LW', 'RW', 'L', 'R', 'F', 'W', 'Centre', '', 'ZZ']) {
      expect(playerCohort({ position: p, is_goalie: false })).toBe('F');
    }
  });
});

describe('qualifiedCohort', () => {
  const players: Row[] = [
    row('C', 40),
    row('LW', 9), // one game short — excluded from the distribution
    row('D', 40),
    row('D', 10), // exactly at the threshold — included
    row('G', 40, null, true),
  ];

  it('keeps only the asked-for cohort', () => {
    expect(qualifiedCohort(players, 'F')).toHaveLength(1);
    expect(qualifiedCohort(players, 'D')).toHaveLength(2);
    expect(qualifiedCohort(players, 'G')).toHaveLength(1);
  });

  it('pins the distribution threshold at 10 GP, inclusive', () => {
    // The threshold is a decision, not an accident: see the module header.
    // 20 (PercentileBullet's LOW SAMPLE flag) would empty the cohort every
    // October; 10 keeps a scale alive without letting a call-up define it.
    expect(DISTRIBUTION_MIN_GP).toBe(10);
    expect(qualifiedCohort([row('C', 10)], 'F')).toHaveLength(1);
    expect(qualifiedCohort([row('C', 9)], 'F')).toHaveLength(0);
  });

  it('drops rows with a non-numeric games-played', () => {
    expect(qualifiedCohort([row('C', NaN), row('C', Infinity)], 'F')).toHaveLength(0);
  });

  it('survives a null hole in the array', () => {
    const holey = [row('C', 40), null as unknown as Row, row('C', 40)];
    expect(qualifiedCohort(holey, 'F')).toHaveLength(2);
  });
});

describe('scaleFrom', () => {
  it('sorts ascending and drops every non-finite value', () => {
    const members = [
      row('C', 40, 3),
      row('C', 40, null),
      row('C', 40, undefined),
      row('C', 40, NaN),
      row('C', 40, 1),
      row('C', 40, 2),
    ];
    expect(scaleFrom(members, (p) => p.v).values).toEqual([1, 2, 3]);
  });

  it('does NOT coerce a missing metric to zero', () => {
    // A player with no GAR row has no GAR — treating him as 0.00 would drag
    // every genuinely-negative player's percentile up.
    const members = [row('C', 40, null), row('C', 40, -1), row('C', 40, 1)];
    const scale = scaleFrom(members, (p) => p.v);
    expect(scale.values).toEqual([-1, 1]);
    expect(percentileOnScale(scale, -1)).toBe(50);
  });
});

describe('percentileOnScale — higher is better', () => {
  it('places the boundaries', () => {
    expect(percentileOnScale(ONE_TO_TEN, 10)).toBe(100);
    expect(percentileOnScale(ONE_TO_TEN, 1)).toBe(10);
    expect(percentileOnScale(ONE_TO_TEN, 5)).toBe(50);
  });

  it('places values outside the observed range at the ends', () => {
    expect(percentileOnScale(ONE_TO_TEN, 999)).toBe(100);
    expect(percentileOnScale(ONE_TO_TEN, -999)).toBe(0);
  });

  it('gives tied values one shared percentile — the highest position of the tie', () => {
    // Four players on 0.0 in a cohort of ten all read 40th, not 10/20/30/40.
    const scale: MetricScale = { values: [0, 0, 0, 0, 1, 2, 3, 4, 5, 6], direction: 'higher' };
    expect(percentileOnScale(scale, 0)).toBe(40);
    expect(percentileOnScale(scale, 1)).toBe(50);
  });

  it('handles a single-element cohort by placing its member at 100', () => {
    expect(percentileOnScale({ values: [4.2], direction: 'higher' }, 4.2)).toBe(100);
    expect(percentileOnScale({ values: [4.2], direction: 'higher' }, 0)).toBe(0);
  });

  it('returns null for an empty cohort', () => {
    expect(percentileOnScale(emptyScale(), 1)).toBeNull();
    expect(percentileOnScale({ values: [], direction: 'lower' }, 1)).toBeNull();
  });

  it('returns null for a missing or non-numeric value', () => {
    expect(percentileOnScale(ONE_TO_TEN, null)).toBeNull();
    expect(percentileOnScale(ONE_TO_TEN, undefined)).toBeNull();
    expect(percentileOnScale(ONE_TO_TEN, NaN)).toBeNull();
    expect(percentileOnScale(ONE_TO_TEN, Infinity)).toBeNull();
    expect(percentileOnScale(ONE_TO_TEN, '5' as unknown as number)).toBeNull();
  });

  it('is monotonic across the whole scale', () => {
    let prev = -1;
    for (let v = 0; v <= 11; v += 0.5) {
      const p = percentileOnScale(ONE_TO_TEN, v)!;
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });
});

describe('percentileOnScale — lower is better', () => {
  // GAA: 2.10 is elite, 3.60 is not. The direction flip is what stops the
  // card from telling a manager his best goalie is in the bottom decile.
  const gaa: MetricScale = { values: [2.0, 2.5, 3.0, 3.5], direction: 'lower' };

  it('ranks the smallest value best', () => {
    expect(percentileOnScale(gaa, 2.0)).toBe(100);
    expect(percentileOnScale(gaa, 3.5)).toBe(25);
  });

  it('places values outside the observed range at the ends', () => {
    expect(percentileOnScale(gaa, 0)).toBe(100);
    expect(percentileOnScale(gaa, 9)).toBe(0);
  });

  it('shares one percentile across ties, same as the higher direction', () => {
    const tied: MetricScale = { values: [2, 2, 2, 4], direction: 'lower' };
    expect(percentileOnScale(tied, 2)).toBe(100);
    expect(percentileOnScale(tied, 4)).toBe(25);
  });
});

describe('placeOnScale', () => {
  it('reports the cohort size alongside the percentile', () => {
    expect(placeOnScale(ONE_TO_TEN, 7, 40)).toEqual({
      percentile: 70,
      cohortSize: 10,
      lowSample: false,
    });
  });

  it('still PLACES a tiny-sample player, and flags him', () => {
    // The whole point: a 4-GP call-up does not define the scale but must
    // still get a position on it, marked so the UI can caveat it.
    const result = placeOnScale(ONE_TO_TEN, 10, 4);
    expect(result.percentile).toBe(100);
    expect(result.lowSample).toBe(true);
  });

  it('does not flag a player at exactly the threshold', () => {
    expect(placeOnScale(ONE_TO_TEN, 5, DISTRIBUTION_MIN_GP).lowSample).toBe(false);
    expect(placeOnScale(ONE_TO_TEN, 5, DISTRIBUTION_MIN_GP - 1).lowSample).toBe(true);
  });

  it('never flags when no games-played was supplied', () => {
    expect(placeOnScale(ONE_TO_TEN, 5).lowSample).toBe(false);
    expect(placeOnScale(ONE_TO_TEN, 5, null).lowSample).toBe(false);
    expect(placeOnScale(ONE_TO_TEN, 5, NaN).lowSample).toBe(false);
  });

  it('reports a zero cohort honestly rather than inventing a percentile', () => {
    expect(placeOnScale(emptyScale(), 5, 40)).toEqual({
      percentile: null,
      cohortSize: 0,
      lowSample: false,
    });
  });
});

describe('buildMetricScale — cohorts in practice', () => {
  /**
   * The scenario the F/D split exists for. Every defenceman here out-rates
   * every forward on `v`... within his own group. Pooled, the D cohort's
   * top man would still be measured against forward volume.
   */
  const league: Row[] = [
    row('C', 50, 3.0),
    row('LW', 50, 2.6),
    row('RW', 50, 2.2),
    row('C', 50, 1.8),
    row('D', 50, 1.2),
    row('D', 50, 0.9),
    row('D', 50, 0.6),
    row('D', 50, 0.3),
    row('G', 50, null, true),
  ];

  it('never lets a defenceman be measured against forwards', () => {
    const dScale = buildMetricScale(league, 'D', (p) => p.v);
    const fScale = buildMetricScale(league, 'F', (p) => p.v);
    expect(dScale.values).toEqual([0.3, 0.6, 0.9, 1.2]);
    expect(fScale.values).toEqual([1.8, 2.2, 2.6, 3.0]);

    // The best defenceman in the league reads 100th among defencemen…
    expect(percentileOnScale(dScale, 1.2)).toBe(100);
    // …and would have read 0th if he had been pooled with the forwards.
    const pooled = scaleFrom(
      league.filter((p) => !p.is_goalie),
      (p) => p.v,
    );
    expect(percentileOnScale(pooled, 1.2)).toBe(50);
  });

  it('never lets a goalie be measured on a skater scale', () => {
    // Goalies carry no xG/GAR at all in this payload, so their skater-metric
    // cohort is empty by construction and the card must show nothing.
    expect(buildMetricScale(league, 'G', (p) => p.v).values).toEqual([]);
  });

  it('excludes tiny samples from the distribution but keeps the rest', () => {
    const withCallup: Row[] = [...league, row('C', 2, 99)];
    const fScale = buildMetricScale(withCallup, 'F', (p) => p.v);
    // 99 does not appear — the call-up did not get to set the ceiling…
    expect(fScale.values).toEqual([1.8, 2.2, 2.6, 3.0]);
    // …but he is still placed against it, flagged.
    expect(placeOnScale(fScale, 99, 2)).toEqual({
      percentile: 100,
      cohortSize: 4,
      lowSample: true,
    });
  });

  it('honours an overridden threshold', () => {
    const scale = buildMetricScale(league, 'F', (p) => p.v, 'higher', 60);
    expect(scale.values).toEqual([]);
  });
});
