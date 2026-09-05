import { describe, it, expect } from 'vitest';
import { mirrorRulesIntoSettings, mirrorRulesIntoStatsList, settingsDiffer } from '../lib/scoringMirror';

const CATALOG = [
  { stat_key: 'goals', applies_to: 'skater' },
  { stat_key: 'assists', applies_to: 'skater' },
  { stat_key: 'plus_minus', applies_to: 'skater' },
  { stat_key: 'wins', applies_to: 'goalie' },
  { stat_key: 'saves', applies_to: 'goalie' },
];

describe('mirrorRulesIntoSettings', () => {
  it('writes each effective rule under its catalog group, keeping what the document already holds', () => {
    const existing = { skater: { goals: 3, assists: 2, hits: 0.5 }, goalie: { wins: 4 }, note: 'kept' };
    const next = mirrorRulesIntoSettings(existing, CATALOG, [
      { stat_key: 'goals', multiplier: 6 },
      { stat_key: 'saves', multiplier: '0.2' },
    ]);
    expect(next).toEqual({ skater: { goals: 6, assists: 2, hits: 0.5 }, goalie: { wins: 4, saves: 0.2 }, note: 'kept' });
    // Never mutates the input.
    expect(existing.skater.goals).toBe(3);
  });

  it('builds the groups from nothing when the league has no document yet', () => {
    expect(mirrorRulesIntoSettings(null, CATALOG, [{ stat_key: 'wins', multiplier: 5 }])).toEqual({ goalie: { wins: 5 } });
  });

  it('ignores a rule the catalog does not know and a multiplier that is not a number', () => {
    const next = mirrorRulesIntoSettings({ skater: { goals: 3 } }, CATALOG, [
      { stat_key: 'mystery', multiplier: 9 },
      { stat_key: 'assists', multiplier: 'lots' },
    ]);
    expect(next).toEqual({ skater: { goals: 3 } });
  });
});

describe('settingsDiffer', () => {
  it('is false for the same document with keys in a different order, true for a changed weight', () => {
    expect(settingsDiffer({ skater: { goals: 3, assists: 2 } }, { skater: { assists: 2, goals: 3 } })).toBe(false);
    expect(settingsDiffer({ skater: { goals: 3 } }, { skater: { goals: 4 } })).toBe(true);
    expect(settingsDiffer(null, { skater: {} })).toBe(true);
  });
});

describe('mirrorRulesIntoStatsList', () => {
  const keyById = new Map([
    ['g', 'goals'],
    ['a', 'assists'],
    ['hit', 'hits'],
  ]);
  it('updates points and enabled by the catalog id → key map and keeps the rest of each row', () => {
    const rows = [
      { id: 'g', name: 'Goals', points: 3, enabled: true, category: 'Offense' },
      { id: 'hit', name: 'Hits', points: 0.5, enabled: true, category: 'Peripheral' },
      { id: 'a', name: 'Assists', points: 2, enabled: true, category: 'Offense' },
    ];
    const next = mirrorRulesIntoStatsList(rows, [{ stat_key: 'goals', multiplier: 6 }, { stat_key: 'hits', multiplier: 0 }], keyById);
    expect(next).toEqual([
      { id: 'g', name: 'Goals', points: 6, enabled: true, category: 'Offense' },
      { id: 'hit', name: 'Hits', points: 0, enabled: false, category: 'Peripheral' },
      { id: 'a', name: 'Assists', points: 2, enabled: true, category: 'Offense' },
    ]);
    expect(rows[0].points).toBe(3);
  });
  it('is null when the league has no stats list, and leaves unknown ids alone', () => {
    expect(mirrorRulesIntoStatsList(undefined, [], keyById)).toBeNull();
    expect(mirrorRulesIntoStatsList([{ id: 'zzz', points: 1 }], [{ stat_key: 'goals', multiplier: 6 }], keyById)).toEqual([{ id: 'zzz', points: 1 }]);
  });
});
