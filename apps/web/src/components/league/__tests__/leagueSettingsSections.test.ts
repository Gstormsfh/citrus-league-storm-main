import { describe, it, expect, vi } from 'vitest';
import {
  buildLeagueSettingsSections,
  processTimeLabel,
  optionLabel,
  type LeagueSettingsInput,
  type SettingField,
} from '../leagueSettingsSections';

/**
 * The league settings as data (2026-09-04). These pin what the Press Box
 * settings screen is handed: which sections a league earns, which rows
 * appear only once another row is set, what is locked after the draft,
 * and that every help line is a rule rather than a guess.
 */

const noop = () => undefined;

const base = (over: Partial<LeagueSettingsInput> = {}): LeagueSettingsInput => ({
  draftCompleted: false,
  teamCount: 12,
  isCategoryLeague: false,
  waiver: {
    waiver_process_time: '02:00:00',
    waiver_period_hours: 48,
    waiver_game_lock: true,
    waiver_type: 'rolling',
    allow_trades_during_games: true,
    weeklyAddLimit: 0,
    seasonAddLimit: 50,
    faabBudget: 100,
  },
  setWaiver: noop,
  draft: { draft_rounds: 21, pickTimeLimit: 90 },
  setDraft: noop,
  trade: { trade_review_type: 'none', trade_review_period_hours: 48, trade_veto_threshold: 0.5 },
  setTrade: noop,
  keeper: { keeperEnabled: false, keeperCount: 0, keeperPenalty: 'none', dynastyMode: false },
  setKeeper: noop,
  categories: [],
  setCategories: noop,
  rosterSlots: {},
  setRosterSlots: noop,
  playoff: { playoffTeams: 6, playoffWeeks: 3 },
  setPlayoff: noop,
  processWaivers: { onPress: noop, busy: false },
  syncRosters: { onPress: noop, busy: false },
  rosters: [
    { name: 'Puck Heads', count: 18 },
    { name: 'Ice Holes', count: null },
  ],
  rostersLoading: false,
  scoring: {
    catalog: [],
    skaters: [
      { stat_key: 'goals', display_name: 'Goals', applies_to: 'skater', default_multiplier: 3, is_core: true, sort_order: 0, multiplier: 3 },
      { stat_key: 'pim', display_name: 'Penalty minutes', applies_to: 'skater', default_multiplier: 0, is_core: true, sort_order: 1, multiplier: 0 },
      { stat_key: 'gwg', display_name: 'Game-winning goals', applies_to: 'skater', default_multiplier: 1, is_core: false, sort_order: 2, multiplier: 1 },
    ],
    goalies: [],
    edits: {},
    setEdit: noop,
    reset: noop,
    valueOf: (s) => String(s.multiplier),
    changed: [],
    invalid: false,
    loading: false,
    saving: false,
    save: async () => true,
  },
  ...over,
});

const keys = (fields: SettingField[]) => fields.map((f) => f.key);
const section = (input: LeagueSettingsInput, key: string) => {
  const s = buildLeagueSettingsSections(input).find((x) => x.key === key);
  if (!s) throw new Error(`no section ${key}`);
  return s;
};
const fields = (input: LeagueSettingsInput, key: string) => section(input, key).groups.flatMap((g) => g.fields);

describe('buildLeagueSettingsSections', () => {
  it('offers the same eight sections as the desktop dialog, categories swapped in for a category league', () => {
    expect(buildLeagueSettingsSections(base()).map((s) => s.key)).toEqual([
      'waivers', 'scoring', 'draft', 'trades', 'keeper', 'rosterslots', 'playoffs', 'rosters',
    ]);
    expect(buildLeagueSettingsSections(base({ isCategoryLeague: true })).map((s) => s.key)).toContain('categories');
    expect(buildLeagueSettingsSections(base({ isCategoryLeague: true })).map((s) => s.key)).not.toContain('scoring');
  });

  it('waivers: the FAAB budget row appears only under FAAB, and the callout names the run time', () => {
    expect(keys(fields(base(), 'waivers'))).not.toContain('faabBudget');
    const faab = base({ waiver: { ...base().waiver, waiver_type: 'faab' } });
    expect(keys(fields(faab, 'waivers'))).toContain('faabBudget');
    expect(section(base(), 'waivers').callout).toContain('12 managers');
    expect(section(base(), 'waivers').callout).toContain('2:00 AM MT');
  });

  it('waivers: rows show the current value in words', () => {
    const f = fields(base(), 'waivers');
    const week = f.find((x) => x.key === 'weeklyAddLimit');
    const season = f.find((x) => x.key === 'seasonAddLimit');
    if (week?.kind !== 'select' || season?.kind !== 'select') throw new Error('kind');
    expect(optionLabel(week.options, week.value)).toBe('Unlimited');
    expect(optionLabel(season.options, season.value)).toBe('50 per season');
    // A value outside the list (set elsewhere) is shown as itself, not blanked.
    expect(optionLabel(season.options, '60')).toBe('60');
  });

  it('draft and roster slots lock once the draft is complete', () => {
    const done = base({ draftCompleted: true });
    expect(section(done, 'draft').saveable).toBe(false);
    expect(fields(done, 'draft').every((f) => f.kind === 'number' && f.disabled)).toBe(true);
    expect(section(done, 'rosterslots').saveable).toBe(false);
    expect(section(done, 'rosterslots').callout).toMatch(/locked/);
    expect(section(base(), 'draft').saveable).toBe(true);
  });

  it('trades: the window and the veto threshold appear only for a league vote, with the votes counted', () => {
    expect(keys(fields(base(), 'trades'))).toEqual(['trade_review_type']);
    const vote = base({ trade: { trade_review_type: 'league_vote', trade_review_period_hours: 24, trade_veto_threshold: 0.25 } });
    const f = fields(vote, 'trades');
    expect(keys(f)).toEqual(['trade_review_type', 'trade_review_period_hours', 'trade_veto_threshold']);
    expect(f[2].help).toBe('3 of 12 votes to veto');
  });

  it('keepers: count and cost appear only for a keeper league that is not dynasty', () => {
    expect(keys(fields(base(), 'keeper'))).toEqual(['keeperEnabled', 'dynastyMode']);
    const keeper = base({ keeper: { keeperEnabled: true, keeperCount: 3, keeperPenalty: 'round-cost', dynastyMode: false } });
    expect(keys(fields(keeper, 'keeper'))).toEqual(['keeperEnabled', 'keeperCount', 'keeperPenalty', 'dynastyMode']);
    const dynasty = base({ keeper: { keeperEnabled: true, keeperCount: 3, keeperPenalty: 'none', dynastyMode: true } });
    expect(keys(fields(dynasty, 'keeper'))).toEqual(['keeperEnabled', 'dynastyMode']);
  });

  it('playoffs: no weeks row and no bracket without playoffs; the bracket reads as rounds', () => {
    const none = base({ playoff: { playoffTeams: 0, playoffWeeks: 3 } });
    expect(keys(fields(none, 'playoffs'))).toEqual(['playoffTeams']);
    expect(section(none, 'playoffs').groups.map((g) => g.key)).toEqual(['bracket']);
    const six = section(base(), 'playoffs');
    expect(six.groups.map((g) => g.key)).toEqual(['bracket', 'preview']);
    const rounds = six.groups[1].fields;
    expect(rounds).toHaveLength(3);
    expect(rounds[0]).toMatchObject({ kind: 'info', label: 'Wild card', value: 'RD 1' });
  });

  it('scoring: one number row per catalog stat, Off and New called out, saving through the hook', async () => {
    const save = vi.fn(async () => true);
    const input = base({ scoring: { ...base().scoring, save, changed: [{ stat_key: 'goals', multiplier: 4 }] } });
    const s = section(input, 'scoring');
    expect(s.saveable).toBe(true);
    expect(s.saveDisabled).toBe(false);
    const f = s.groups[0].fields;
    expect(f.map((x) => [x.label, x.help])).toEqual([
      ['Goals', null],
      ['Penalty minutes', 'Off'],
      ['Game-winning goals', 'New this season'],
    ]);
    expect(f[0]).toMatchObject({ kind: 'number', value: 3, step: 0.1 });
    s.onSave?.();
    expect(save).toHaveBeenCalledTimes(1);
    expect(section(base(), 'scoring').saveDisabled).toBe(true);
  });

  it('rosters: a fact per team, nothing to save, and no count invented', () => {
    const s = section(base(), 'rosters');
    expect(s.saveable).toBe(false);
    expect(s.groups[0].fields.map((f) => (f.kind === 'info' ? f.value : ''))).toEqual(['18 players', '–']);
  });

  it('categories: a toggle per stat, goalies apart, writing back to the list', () => {
    const setCategories = vi.fn();
    const input = base({ isCategoryLeague: true, categories: ['goals'], setCategories });
    const s = section(input, 'categories');
    expect(s.groups.map((g) => g.label)).toEqual(['SKATERS', 'GOALIES']);
    const goals = s.groups[0].fields.find((f) => f.key === 'cat-goals');
    if (goals?.kind !== 'toggle') throw new Error('kind');
    expect(goals.checked).toBe(true);
    goals.onChange(false);
    expect(setCategories).toHaveBeenCalledTimes(1);
    expect(setCategories.mock.calls[0][0](['goals', 'assists'])).toEqual(['assists']);
  });

  it('processTimeLabel', () => {
    expect(processTimeLabel('00:00:00')).toBe('12:00 AM');
    expect(processTimeLabel('02:00:00')).toBe('2:00 AM');
    expect(processTimeLabel('12:00:00')).toBe('12:00 PM');
  });
});
