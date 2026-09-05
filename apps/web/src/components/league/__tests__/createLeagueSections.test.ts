import { describe, it, expect, vi } from 'vitest';
import { defaultLeagueStats } from '@citrus/shared';
import {
  buildCreateLeagueSections,
  statPointOptions,
  pointsLabel,
  type CreateLeagueForm,
} from '../createLeagueSections';
import type { SettingField } from '../leagueSettingsSections';

/**
 * Create League as data (PR10o, 2026-09-04). These pin what the phone is
 * handed: which sections a league type earns, that a stat is ONE row whose
 * `Off` disables it, that the rows write through the page's own setters,
 * and that nothing is shown for a format that does not use it.
 */

const noop = () => undefined;

const form = (over: Partial<CreateLeagueForm> = {}): CreateLeagueForm => ({
  leagueTypes: ['fantasy', 'pickem', 'survivor', 'confidence-pool', 'playoff-bracket-pickem', 'playoff-confidence-pool', 'playoff-roster-pool'],
  leagueType: 'fantasy',
  setLeagueType: noop,
  leagueName: '',
  setLeagueName: noop,
  teamsCount: '12',
  setTeamsCount: noop,
  scoringFormat: 'h2h-points',
  setScoringFormat: noop,
  draftType: 'snake',
  setDraftType: noop,
  draftRounds: '21',
  setDraftRounds: noop,
  pickTimeLimit: '90',
  setPickTimeLimit: noop,
  auctionBudget: '200',
  setAuctionBudget: noop,
  auctionMinBid: '1',
  setAuctionMinBid: noop,
  auctionNominationTime: '30',
  auctionBidTime: '30',
  setAuctionNominationTime: noop,
  setAuctionBidTime: noop,
  leagueStats: defaultLeagueStats(),
  setStatEnabled: noop,
  setStatPoints: noop,
  selectedCategories: ['goals', 'assists'],
  toggleCategory: noop,
  minGoalieGames: '3',
  setMinGoalieGames: noop,
  playoffTeams: '6',
  setPlayoffTeams: noop,
  playoffOptions: [2, 4, 6, 8],
  playoffWeeks: '3',
  setPlayoffWeeks: noop,
  tradeDeadlineWeek: '0',
  setTradeDeadlineWeek: noop,
  keeperEnabled: false,
  setKeeperEnabled: noop,
  keeperCount: '3',
  setKeeperCount: noop,
  keeperPenalty: 'none',
  setKeeperPenalty: noop,
  dynastyMode: false,
  setDynastyMode: noop,
  waivers: {
    waiver_process_time: '02:00:00',
    waiver_period_hours: 48,
    waiver_game_lock: true,
    waiver_type: 'rolling',
    allow_trades_during_games: true,
    faab_budget: 100,
  },
  setWaivers: noop,
  weeklyAddLimit: '0',
  setWeeklyAddLimit: noop,
  seasonAddLimit: '0',
  setSeasonAddLimit: noop,
  positionType: 'individual',
  setPositionType: noop,
  rosterSlots: { C: 2, LW: 2, RW: 2, D: 4, G: 2, UTIL: 2, BN: 5, IR: 2 },
  setRosterSlot: noop,
  roundsVsRoster: null,
  pickemFormat: 'straight-up',
  setPickemFormat: noop,
  picksPerWeek: '10',
  setPicksPerWeek: noop,
  survivorLives: '1',
  setSurvivorLives: noop,
  confidenceMaxPoints: '10',
  pickDeadline: 'per-game',
  setPickDeadline: noop,
  tiebreaker: 'none',
  setTiebreaker: noop,
  allowRepeatTeams: false,
  setAllowRepeatTeams: noop,
  playoffLockDeadline: '2026-04-18T17:00',
  setPlayoffLockDeadline: noop,
  bracketPickMode: 'round-by-round',
  setBracketPickMode: noop,
  isFantasy: true,
  showPointValues: true,
  showCategories: false,
  showMatchupSettings: true,
  showDraftSettings: true,
  showWaiverSettings: true,
  ...over,
});

const keys = (f: CreateLeagueForm) => buildCreateLeagueSections(f).map((s) => s.key);
const field = (f: CreateLeagueForm, section: string, key: string): SettingField => {
  const s = buildCreateLeagueSections(f).find((x) => x.key === section);
  const found = s?.groups.flatMap((g) => g.fields).find((x) => x.key === key);
  if (!found) throw new Error(`${section}.${key} not built`);
  return found;
};

describe('which sections a league type earns', () => {
  it('a fantasy league gets the six', () => {
    expect(keys(form())).toEqual(['format', 'draft', 'scoring', 'season', 'waivers', 'roster']);
  });

  it('a category league swaps SCORING for CATEGORIES', () => {
    expect(keys(form({ scoringFormat: 'h2h-categories', showPointValues: false, showCategories: true }))).toEqual([
      'format', 'draft', 'categories', 'season', 'waivers', 'roster',
    ]);
  });

  it('a pick’em pool gets FORMAT and its own section, nothing about drafts or rosters', () => {
    expect(keys(form({ leagueType: 'pickem', isFantasy: false, showPointValues: false, showMatchupSettings: false, showDraftSettings: false, showWaiverSettings: false }))).toEqual(['format', 'pool']);
  });

  it('a playoff pool carries the lock deadline; a season league does not', () => {
    const pool = form({ leagueType: 'playoff-bracket-pickem', isFantasy: false, showPointValues: false, showMatchupSettings: false, showDraftSettings: false, showWaiverSettings: false });
    expect(field(pool, 'format', 'lock')).toMatchObject({ kind: 'text', inputType: 'datetime-local' });
    expect(field(pool, 'format', 'bracketMode').kind).toBe('select');
    expect(() => field(form(), 'format', 'lock')).toThrow();
  });
});

describe('a stat is one row', () => {
  it('shows Off when the stat is disabled and the points when it is on', () => {
    const stats = defaultLeagueStats().map((s) => (s.id === 'hit' ? { ...s, enabled: false } : s.id === 'g' ? { ...s, enabled: true, points: 3 } : s));
    const f = form({ leagueStats: stats });
    expect(field(f, 'scoring', 'stat:hit')).toMatchObject({ kind: 'select', value: 'off' });
    expect(field(f, 'scoring', 'stat:g')).toMatchObject({ kind: 'select', value: '3' });
  });

  it('Off disables; a value enables and sets the points', () => {
    const setStatEnabled = vi.fn();
    const setStatPoints = vi.fn();
    const f = form({ setStatEnabled, setStatPoints });
    const g = field(f, 'scoring', 'stat:g');
    if (g.kind !== 'select') throw new Error('select');
    g.onChange('off');
    expect(setStatEnabled.mock.calls).toEqual([['g', false]]);
    expect(setStatPoints.mock.calls).toEqual([]);
    g.onChange('2');
    expect(setStatEnabled.mock.calls[1]).toEqual(['g', true]);
    expect(setStatPoints.mock.calls).toEqual([['g', 2]]);
  });

  it('the menu leads with Off, includes 0, and keeps a custom value', () => {
    const labels = statPointOptions({ id: 'g', name: 'Goals', points: 7, default: true, category: 'Offense', enabled: true }).map((o) => o.label);
    expect(labels[0]).toBe('Off');
    expect(labels).toContain('0');
    expect(labels).toContain('+7');
    expect(pointsLabel(-1)).toBe('-1');
  });
});

describe('the rows write through the page', () => {
  it('the roster slot stepper writes one slot', () => {
    const setRosterSlot = vi.fn();
    const bn = field(form({ setRosterSlot }), 'roster', 'slot:BN');
    if (bn.kind !== 'number') throw new Error('number');
    expect(bn.value).toBe(5);
    bn.onChange(7);
    expect(setRosterSlot.mock.calls).toEqual([['BN', 7]]);
  });

  it('turning keepers off turns dynasty off with it; dynasty on forces keepers on and unlimited', () => {
    const setKeeperEnabled = vi.fn();
    const setDynastyMode = vi.fn();
    const setKeeperCount = vi.fn();
    const f = form({ keeperEnabled: true, setKeeperEnabled, setDynastyMode, setKeeperCount });
    const keeper = field(f, 'season', 'keeper');
    const dynasty = field(f, 'season', 'dynasty');
    if (keeper.kind !== 'toggle' || dynasty.kind !== 'toggle') throw new Error('toggle');
    keeper.onChange(false);
    expect(setDynastyMode.mock.calls).toEqual([[false]]);
    dynasty.onChange(true);
    expect(setKeeperEnabled.mock.calls.at(-1)).toEqual([true]);
    expect(setKeeperCount.mock.calls).toEqual([['0']]);
  });

  it('keeper count and cost appear only once keepers are on', () => {
    expect(() => field(form(), 'season', 'keeperCount')).toThrow();
    expect(field(form({ keeperEnabled: true }), 'season', 'keeperCount').kind).toBe('select');
  });

  it('the FAAB budget appears only for FAAB waivers', () => {
    expect(() => field(form(), 'waivers', 'faab')).toThrow();
    const faab = field(form({ waivers: { ...form().waivers, waiver_type: 'faab' } }), 'waivers', 'faab');
    expect(faab).toMatchObject({ kind: 'number', unit: '$', value: 100 });
  });

  it('the pick clock is a snake or linear draft’s; an auction gets its own group', () => {
    expect(field(form(), 'draft', 'clock').kind).toBe('select');
    const auction = form({ draftType: 'auction' });
    expect(() => field(auction, 'draft', 'clock')).toThrow();
    expect(field(auction, 'draft', 'budget')).toMatchObject({ kind: 'number', unit: '$' });
  });

  it('an auction carries BOTH clocks: the nomination window and the bid window the engine reads', () => {
    // SETTINGS PASS-THROUGH (2026-09-05): auctionBidWindowSeconds was never
    // written, so every auction ran a 30s bid clock whatever was chosen.
    const auction = form({ draftType: 'auction', auctionBidTime: '15' });
    expect(field(auction, 'draft', 'nomination')).toMatchObject({ kind: 'select', value: '30' });
    expect(field(auction, 'draft', 'bid')).toMatchObject({ kind: 'select', value: '15' });
    expect(() => field(form(), 'draft', 'bid')).toThrow();
  });
});

describe('the rules under the rows', () => {
  it('the roster callout is the page’s rounds-vs-roster warning, verbatim', () => {
    const warning = 'Rosters have 23 spots but the draft runs 21 rounds.';
    const roster = buildCreateLeagueSections(form({ roundsVsRoster: warning })).find((s) => s.key === 'roster');
    expect(roster?.callout).toBe(warning);
  });

  it('every select offers the value it currently holds', () => {
    for (const s of buildCreateLeagueSections(form())) {
      for (const f of s.groups.flatMap((g) => g.fields)) {
        if (f.kind === 'select') {
          expect(f.options.map((o) => o.value), `${s.key}.${f.key}`).toContain(f.value);
        }
      }
    }
  });
});
