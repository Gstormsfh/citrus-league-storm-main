import { describe, it, expect } from 'vitest';
import type { ImportedSettings } from '@/api/imports';
import { planFromImportedSettings, CATEGORY_ID_BY_KEY } from '../importedSettings';
import { progressLine, isSettled } from '../importProgress';
import type { ImportJob } from '@/api/imports';

const base = (over: Partial<ImportedSettings> = {}): ImportedSettings => ({
  platform: 'espn', season: 2024, scoringFormat: 'h2h-points',
  scoringSettings: { skater: { goals: 7, assists: 3 }, goalie: { wins: 4 } }, categories: [],
  rosterSlots: [{ slot: 'C', count: 2 }, { slot: 'LW', count: 2 }, { slot: 'D', count: 4 }, { slot: 'G', count: 2 }, { slot: 'BN', count: 4 }, { slot: 'IR', count: 2 }],
  unmapped: [], keeper: { count: 3, orderType: 'TRADITIONAL' }, playoffs: { teamCount: 4, weeks: 2, regularSeasonWeeks: 20 }, draftType: 'SNAKE', usesFaab: false, ...over,
});

describe('planFromImportedSettings', () => {
  it('a points league applies its weights and roster as they are', () => {
    const plan = planFromImportedSettings(base());
    expect(plan.scoring).toEqual({ skater: { goals: 7, assists: 3 }, goalie: { wins: 4 } });
    expect(plan.categories).toBeNull();
    expect(plan.roster).toEqual({ slots: { C: 2, LW: 2, D: 4, G: 2, BN: 4, IR: 2 }, unsupported: [] });
    expect(plan.keeper).toEqual({ count: 3, enabled: true });
    expect(plan.notes).toEqual([]);
  });

  it('a category league maps keys to Citrus category ids and names what Citrus cannot score', () => {
    const plan = planFromImportedSettings(base({ scoringFormat: 'h2h-categories', scoringSettings: { skater: {}, goalie: {} }, categories: ['goals', 'assists', 'power_play_points', 'shots_on_goal', 'hits', 'blocks', 'wins', 'goals_against_average', 'save_percentage', 'faceoff_wins'] }));
    expect(plan.scoring).toBeNull();
    expect(plan.categories).toEqual({ ids: ['goals', 'assists', 'ppp', 'sog', 'hits', 'blocks', 'wins', 'gaa', 'save_pct'], unsupported: ['faceoff_wins'] });
    expect(Object.keys(CATEGORY_ID_BY_KEY)).toContain('goals_against_average');
  });

  it('fewer than two supported categories earns a note', () => {
    const plan = planFromImportedSettings(base({ scoringFormat: 'roto', categories: ['goals', 'faceoff_losses'] }));
    expect(plan.categories?.ids).toEqual(['goals']);
    expect(plan.notes.some((n) => /at least two categories/.test(n))).toBe(true);
  });

  it('forward and wing slots fold into utility; unknown slots are listed', () => {
    const plan = planFromImportedSettings(base({ rosterSlots: [{ slot: 'C', count: 1 }, { slot: 'F', count: 2 }, { slot: 'W', count: 1 }, { slot: 'NA', count: 3 }] }));
    expect(plan.roster.slots).toEqual({ C: 1, UTIL: 3 });
    expect(plan.roster.unsupported).toEqual([{ slot: 'NA', count: 3 }]);
    expect(plan.notes.some((n) => /utility slots/.test(n))).toBe(true);
  });

  it('unmapped stats become notes and no keepers means keepers off', () => {
    const plan = planFromImportedSettings(base({ keeper: { count: null, orderType: null }, unmapped: [{ sourceStatId: '99', citrusKey: 'unknown_espn_99', points: 2, reason: 'Not in the translation table' }, { sourceStatId: '10', citrusKey: 'goals_against_average', points: -1, reason: 'Not a Citrus point-scoring stat' }] }));
    expect(plan.keeper).toEqual({ count: 0, enabled: false });
    expect(plan.notes).toEqual(['Stat 99: not in the translation table.', 'goals against average: not a citrus point-scoring stat.']);
  });
});

describe('progressLine / isSettled', () => {
  const job = (over: Partial<ImportJob>): ImportJob => ({
    id: 'j', league_id: 'l', platform: 'espn', external_league_id: '1', status: 'queued', seasons_discovered: [], seasons_imported: [], seasons_needing_credentials: [],
    progress: {}, error: null, started_at: null, finished_at: null, ...over,
  });
  it('says where the job is', () => {
    expect(progressLine(job({ status: 'discovering' }))).toBe('Finding every season');
    expect(progressLine(job({ status: 'importing', seasons_discovered: [2019, 2020, 2021], seasons_imported: [2019] }))).toBe('Importing season 2 of 3');
    expect(progressLine(job({ status: 'done', seasons_discovered: [2019, 2020], seasons_imported: [2019, 2020] }))).toBe('2 seasons imported');
    expect(progressLine(job({ status: 'done', seasons_discovered: [2019], seasons_imported: [2019] }))).toBe('1 season imported');
    expect(progressLine(job({ status: 'partial', seasons_discovered: [2017, 2018, 2019], seasons_imported: [2019], seasons_needing_credentials: [2017, 2018] }))).toBe('1 of 3 seasons imported. 2 behind a login.');
    expect(progressLine(job({ status: 'partial', seasons_discovered: [2018, 2019], seasons_imported: [2018], error: { code: 'THROTTLED' } }))).toMatch(/slow down/);
    expect(progressLine(job({ status: 'needs_credentials' }))).toBe('Sign in to bring these seasons over');
    expect(progressLine(job({ status: 'failed' }))).toBe('The import stopped');
  });
  it('knows which states are final', () => {
    expect(['done', 'partial', 'failed', 'needs_credentials'].every((s) => isSettled(s as ImportJob['status']))).toBe(true);
    expect(['queued', 'discovering', 'importing', 'matching', 'computing'].some((s) => isSettled(s as ImportJob['status']))).toBe(false);
  });
});
