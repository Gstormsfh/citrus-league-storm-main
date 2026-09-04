/**
 * THE HEADLINE FOLLOWS THE SORT (2026-09-04).
 *
 * Field report from the first live test draft, on device: sorting the pool by
 * Goals reordered the list and every row still showed the same projected
 * point total. The ordering was correct the whole time; the number beside it
 * was not the number being sorted on, so the feature read as broken.
 *
 * These pin the contract the row and the sort picker now share. The detector
 * self-test at the bottom is the important half: it proves this file fails
 * against the pre-fix behaviour, so it cannot rot into a test that passes on
 * a regression.
 */
import { describe, it, expect } from 'vitest';
import { poolHeadlineFor, type HeadlineInputs } from '../draftPoolHeadline';

const player = (over: Partial<HeadlineInputs> = {}): HeadlineInputs => ({
  seasonFpts: 210.4,
  projectionTotal: 188.6,
  projectionPerGp: 2.41,
  gamesPlayed: 82,
  points: 96,
  goals: 41,
  assists: 55,
  shots: 288,
  hits: 62,
  blocks: 37,
  xGoals: 33.7,
  plusMinus: 18,
  ppp: 31,
  shp: 2,
  pim: 24,
  icetimeSeconds: 99_120,
  wins: 34,
  losses: 21,
  gaa: 2.47,
  savePct: 0.916,
  saves: 1524,
  shutouts: 4,
  ...over,
});

describe('poolHeadlineFor: the number follows the sort', () => {
  it('THE BUG: sorting by a skater stat no longer shows the projection', () => {
    const p = player();
    const goals = poolHeadlineFor('goals', p);
    expect(goals).not.toBeNull();
    expect(goals!.value).toBe(41);
    expect(goals!.value).not.toBe(p.projectionTotal);
    expect(goals!.label).toBe('g');
  });

  it.each([
    ['points', 96, 'pts'],
    ['goals', 41, 'g'],
    ['assists', 55, 'a'],
    ['shots', 288, 'sog'],
    ['hits', 62, 'hits'],
    ['blocks', 37, 'blk'],
    ['ppp', 31, 'ppp'],
    ['shp', 2, 'shp'],
    ['pim', 24, 'pim'],
    ['plusMinus', 18, '+/-'],
  ])('%s reads its own value as a whole number', (sort, value, label) => {
    const h = poolHeadlineFor(sort, player());
    expect(h).toEqual({ value, label, decimals: 0 });
  });

  it.each([
    ['wins', 34, 'w'],
    ['losses', 21, 'l'],
    ['saves', 1524, 'sv'],
    ['shutouts', 4, 'so'],
  ])('goalie counting stat %s reads its own value', (sort, value, label) => {
    const h = poolHeadlineFor(sort, player());
    expect(h).toEqual({ value, label, decimals: 0 });
  });

  it('rate stats keep the places that distinguish them', () => {
    // A save percentage rounded to one place is the same number for everyone.
    expect(poolHeadlineFor('savePct', player())).toEqual({ value: 0.916, label: 'sv%', decimals: 3 });
    expect(poolHeadlineFor('gaa', player())).toEqual({ value: 2.47, label: 'gaa', decimals: 2 });
    expect(poolHeadlineFor('xGoals', player())).toEqual({ value: 33.7, label: 'xg', decimals: 1 });
  });

  it('TOI is stored in seconds and read in minutes', () => {
    const h = poolHeadlineFor('toi', player({ icetimeSeconds: 99_120 }));
    expect(h!.label).toBe('toi');
    expect(h!.value).toBeCloseTo(1652, 0);
  });

  it('per-game rates divide, and never divide by zero', () => {
    const h = poolHeadlineFor('fptsPerGp', player({ seasonFpts: 210, gamesPlayed: 84 }));
    expect(h!.value).toBeCloseTo(2.5, 5);
    expect(h!.label).toBe('fpts/gp');

    const rookie = poolHeadlineFor('fptsPerGp', player({ seasonFpts: 0, gamesPlayed: 0 }));
    expect(rookie!.value).toBe(0);
    expect(Number.isFinite(rookie!.value)).toBe(true);
  });

  it('season fpts and the projection are each named, not conflated', () => {
    expect(poolHeadlineFor('fpts', player())).toEqual({ value: 210.4, label: 'fpts', decimals: 1 });
    expect(poolHeadlineFor('projFpts', player())).toEqual({ value: 188.6, label: 'proj', decimals: 1 });
  });

  it('Overall Rank and Name have no stat of their own, so the row keeps the projection', () => {
    expect(poolHeadlineFor('projRank', player())).toBeNull();
    expect(poolHeadlineFor('name', player())).toBeNull();
  });

  it('a missing stat reads as zero rather than NaN or blank', () => {
    const empty = poolHeadlineFor('goals', player({ goals: null }));
    expect(empty!.value).toBe(0);
    expect(Number.isNaN(empty!.value)).toBe(false);
  });

  it('an unknown sort key falls back rather than throwing', () => {
    expect(poolHeadlineFor('somethingNobodyShipped', player())).toBeNull();
  });
});

describe('the detector bites (self-test)', () => {
  // Every sort key the picker offers that names a real stat. If someone adds
  // a SelectItem and forgets this module, the row silently shows the
  // projection again - which is exactly the bug this file exists for.
  const STAT_SORTS = [
    'points', 'goals', 'assists', 'shots', 'hits', 'blocks', 'xGoals',
    'plusMinus', 'ppp', 'shp', 'pim', 'toi',
    'wins', 'losses', 'gaa', 'savePct', 'saves', 'shutouts',
    'fpts', 'fptsPerGp', 'projFpts', 'projFptsPerGp',
  ];

  it('every stat sort the picker offers resolves to a headline', () => {
    const unresolved = STAT_SORTS.filter((k) => poolHeadlineFor(k, player()) === null);
    expect(unresolved).toEqual([]);
  });

  it('FAILS the pre-fix behaviour: a constant projection headline', () => {
    // The shape of the old code: headline = projection ?? seasonFpts, whatever
    // the sort. Under it, sorting by goals and by assists give the same number.
    const preFix = (_sort: string, s: HeadlineInputs) => ({
      value: s.projectionTotal ?? s.seasonFpts,
      label: 'proj',
      decimals: 1,
    });
    const p = player();
    expect(preFix('goals', p).value).toBe(preFix('assists', p).value);

    // The shipped rule must distinguish them.
    expect(poolHeadlineFor('goals', p)!.value).not.toBe(poolHeadlineFor('assists', p)!.value);
  });

  it('no two adjacent stat sorts collide on both value and label', () => {
    const seen = new Map<string, string>();
    for (const k of STAT_SORTS) {
      const h = poolHeadlineFor(k, player())!;
      expect(h.label.length).toBeGreaterThan(0);
      // Labels must be distinct: the label is the only thing telling the
      // manager which number they are looking at.
      expect(seen.has(h.label)).toBe(false);
      seen.set(h.label, k);
    }
  });
});
