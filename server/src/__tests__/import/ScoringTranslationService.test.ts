import { describe, it, expect } from 'vitest';
import { ScoringTranslationService, mapScoringFormat } from '../../services/import/ScoringTranslationService';
import type { ImportedSettings, ImportedScoringItem } from '../../import/types';

const item = (citrusKey: string, points: number | null, extra: Partial<ImportedScoringItem> = {}): ImportedScoringItem => ({
  sourceStatId: extra.sourceStatId ?? citrusKey, citrusKey, group: extra.group ?? 'skater', points, reverse: extra.reverse ?? false, enabled: extra.enabled ?? true,
});

const base = (over: Partial<ImportedSettings>): ImportedSettings => ({
  leagueName: 'Test', scoringType: 'h2h_points', scoringItems: [], rosterSlots: [{ slot: 'C', count: 2 }],
  regularSeasonWeeks: 22, playoffTeamCount: 4, playoffWeeks: 2, keeperCount: 3, keeperOrderType: 'TRADITIONAL',
  draftType: 'SNAKE', usesFaab: null, isPublic: true, ...over,
});

describe('mapScoringFormat', () => {
  it('maps every imported type onto a Citrus ScoringFormat or null', () => {
    expect(mapScoringFormat('h2h_points')).toBe('h2h-points');
    expect(mapScoringFormat('h2h_categories')).toBe('h2h-categories');
    expect(mapScoringFormat('roto')).toBe('roto');
    expect(mapScoringFormat('points')).toBe('total-points');
    expect(mapScoringFormat('unknown')).toBeNull();
  });
});

describe('ScoringTranslationService', () => {
  const svc = new ScoringTranslationService();

  it('points league: weights land in skater/goalie buckets', () => {
    const t = svc.translate(base({ scoringItems: [
      // Deliberately not the Citrus defaults: the translation must carry the
      // source's weights, whatever they are (industryStandardScoringGuard).
      item('goals', 7), item('assists', 3), item('shots_on_goal', 0.4),
      item('wins', 4, { group: 'goalie' }), item('saves', 0.25, { group: 'goalie' }),
    ] }));
    expect(t.scoringFormat).toBe('h2h-points');
    expect(t.scoringSettings.skater).toEqual({ goals: 7, assists: 3, shots_on_goal: 0.4 });
    expect(t.scoringSettings.goalie).toEqual({ wins: 4, saves: 0.25 });
    expect(t.unmapped).toEqual([]);
    expect(t.categories).toEqual([]);
  });

  it('category league: categories listed in source order, no weights', () => {
    const t = svc.translate(base({ scoringType: 'h2h_categories', scoringItems: [
      item('goals', null), item('assists', null), item('goals_against_average', null, { group: 'goalie', reverse: true }), item('save_percentage', null, { group: 'goalie' }),
    ] }));
    expect(t.scoringFormat).toBe('h2h-categories');
    expect(t.categories).toEqual(['goals', 'assists', 'goals_against_average', 'save_percentage']);
    expect(t.scoringSettings.skater).toEqual({});
    expect(t.unmapped).toEqual([]);
  });

  it('never drops an unknown stat silently', () => {
    const t = svc.translate(base({ scoringItems: [item('goals', 7), item('unknown_espn_99', 2, { sourceStatId: '99', group: 'unknown' })] }));
    expect(t.scoringSettings.skater).toEqual({ goals: 7 });
    expect(t.unmapped).toEqual([{ sourceStatId: '99', citrusKey: 'unknown_espn_99', points: 2, reason: 'Not in the translation table' }]);
  });

  it('a ratio cannot be a point weight', () => {
    const t = svc.translate(base({ scoringItems: [item('goals_against_average', -1, { group: 'goalie' })] }));
    expect(t.scoringSettings.goalie).toEqual({});
    expect(t.unmapped[0].reason).toBe('Not a Citrus point-scoring stat');
  });

  it('disabled items are ignored', () => {
    const t = svc.translate(base({ scoringItems: [item('goals', 7, { enabled: false })] }));
    expect(t.scoringSettings.skater).toEqual({});
    expect(t.unmapped).toEqual([]);
  });

  it('carries roster, keeper and playoff settings through untouched', () => {
    const t = svc.translate(base({}));
    expect(t.rosterSlots).toEqual([{ slot: 'C', count: 2 }]);
    expect(t.keeper).toEqual({ count: 3, orderType: 'TRADITIONAL' });
    expect(t.playoffs).toEqual({ teamCount: 4, weeks: 2, regularSeasonWeeks: 22 });
    expect(t.draftType).toBe('SNAKE');
  });
});
