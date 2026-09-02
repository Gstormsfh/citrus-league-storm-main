/**
 * What the scores screen is allowed to SAY.
 *
 * These are the display rules that stop a row asserting something the
 * database does not support: a score on a game nobody has played, a summary
 * counting players we did not find, a leader in a game with no score.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ScoreboardGame, ScoresGameCitrus, ScoresPlayerLine } from '@citrus/shared';
import {
  buildDateStrip,
  citrusSummaryText,
  compareGames,
  formatPoints,
  formatToi,
  friendlyDateLabel,
  hasUnconfirmedGoalieDuel,
  leadingSide,
  rowStatusText,
  shiftDate,
  shortDateLabel,
  showsLivePulse,
  statusTone,
  teamDisplayName,
  teamFullName,
} from '../scoresFormat';

const TEAM = (abbrev: string, city: string | null = null, name: string | null = null) => ({
  abbrev,
  teamId: null,
  city,
  name,
});

const GAME = (over: Partial<ScoreboardGame> = {}): ScoreboardGame => ({
  gameId: 2026020001,
  gameDate: '2026-09-29',
  startsAt: '2026-09-29T21:00:00+00:00',
  state: 'scheduled',
  statusRaw: 'scheduled',
  period: null,
  periodTime: null,
  venue: null,
  gameType: 'regular',
  season: 2026,
  away: TEAM('FLA', 'Florida', 'Panthers'),
  home: TEAM('CAR', 'Carolina', 'Hurricanes'),
  awayScore: null,
  homeScore: null,
  citrus: null,
  ...over,
});

const LINE = (over: Partial<ScoresPlayerLine> = {}): ScoresPlayerLine => ({
  playerId: 1,
  name: 'Player',
  teamAbbrev: 'CAR',
  position: 'C',
  isGoalie: false,
  headshotUrl: null,
  projectedPoints: 5,
  confidenceLabel: 'High',
  actualPoints: null,
  actuals: null,
  roster: null,
  ...over,
});

const CITRUS = (over: Partial<ScoresGameCitrus> = {}): ScoresGameCitrus => ({
  projectedPlayers: 4,
  players: [LINE()],
  rosteredCount: null,
  myCount: null,
  confidence: { high: 4, medium: 0, low: 0, unlabeled: 0 },
  hasActuals: false,
  ...over,
});

describe('row status', () => {
  it('prints the start time for a scheduled game, never a score', () => {
    // 21:00 UTC is 3pm Mountain on 2026-09-29 (MDT).
    expect(rowStatusText(GAME())).toBe('3:00 PM');
  });

  it('falls back to the word Scheduled when there is no puck drop', () => {
    expect(rowStatusText(GAME({ startsAt: null }))).toBe('Scheduled');
  });

  it('defers to the shared vocabulary for live and final', () => {
    expect(rowStatusText(GAME({ state: 'live', period: '3rd', periodTime: '00:42' })))
      .toBe('00:42 3rd');
    expect(rowStatusText(GAME({ state: 'live', period: '2nd', periodTime: 'INT' })))
      .toBe('INT 2nd');
    expect(rowStatusText(GAME({ state: 'final', period: 'OT' }))).toBe('Final/OT');
    expect(rowStatusText(GAME({ state: 'final', period: null }))).toBe('Final');
  });

  it('escalates the tone inside the final minute of the third or later', () => {
    expect(statusTone(GAME({ state: 'live', period: '3rd', periodTime: '00:42' }))).toBe('urgent');
    expect(statusTone(GAME({ state: 'live', period: '1st', periodTime: '00:42' }))).toBe('live');
    expect(statusTone(GAME({ state: 'live', period: '3rd', periodTime: '11:07' }))).toBe('live');
    expect(statusTone(GAME({ state: 'final' }))).toBe('final');
    expect(statusTone(GAME({ state: 'unknown' }))).toBe('muted');
  });

  it('does not pulse through an intermission', () => {
    expect(showsLivePulse(GAME({ state: 'live', periodTime: '11:07' }))).toBe(true);
    expect(showsLivePulse(GAME({ state: 'live', periodTime: 'INT' }))).toBe(false);
    expect(showsLivePulse(GAME({ state: 'final' }))).toBe(false);
  });
});

describe('leader emphasis', () => {
  it('emphasises nobody when there is no score, including a scheduled game', () => {
    expect(leadingSide(GAME())).toBeNull();
    expect(leadingSide(GAME({ state: 'live', homeScore: 2, awayScore: 2 }))).toBeNull();
  });

  it('picks the side that is actually ahead', () => {
    expect(leadingSide(GAME({ state: 'live', homeScore: 3, awayScore: 2 }))).toBe('home');
    expect(leadingSide(GAME({ state: 'final', homeScore: 1, awayScore: 4 }))).toBe('away');
  });
});

describe('numbers', () => {
  it('shows a dot rather than a zero when there is no number', () => {
    expect(formatPoints(null)).toBe('.');
    expect(formatPoints(undefined)).toBe('.');
    expect(formatPoints(Number.NaN)).toBe('.');
    expect(formatPoints(0)).toBe('0.0');
    expect(formatPoints(8.889)).toBe('8.9');
  });

  it('formats ice time and keeps a real zero', () => {
    expect(formatToi(1140)).toBe('19:00');
    expect(formatToi(65)).toBe('1:05');
    expect(formatToi(0)).toBe('0:00');
    expect(formatToi(null)).toBe('.');
  });
});

describe('team naming', () => {
  it('falls back to the abbreviation when nhl_teams has no row', () => {
    expect(teamDisplayName(TEAM('ZZZ'))).toBe('ZZZ');
    expect(teamFullName(TEAM('ZZZ'))).toBe('ZZZ');
    expect(teamDisplayName(TEAM('CAR', 'Carolina', 'Hurricanes'))).toBe('Hurricanes');
    expect(teamFullName(TEAM('CAR', 'Carolina', 'Hurricanes'))).toBe('Carolina Hurricanes');
  });
});

describe('citrus summary', () => {
  it('says nothing at all when there is no projection', () => {
    expect(citrusSummaryText(GAME())).toBe('');
    expect(citrusSummaryText(GAME({ citrus: CITRUS({ projectedPlayers: 0 }) }))).toBe('');
  });

  it('leads with your own players when you have any', () => {
    expect(citrusSummaryText(GAME({ citrus: CITRUS({ myCount: 1, rosteredCount: 4 }) })))
      .toBe('1 of your player in this one');
    expect(citrusSummaryText(GAME({ citrus: CITRUS({ myCount: 3, rosteredCount: 6 }) })))
      .toBe('3 of your players in this one');
  });

  it('falls back to league rosters, then to the projected field', () => {
    expect(citrusSummaryText(GAME({ citrus: CITRUS({ myCount: 0, rosteredCount: 2 }) })))
      .toBe('2 rostered players in your league');
    expect(citrusSummaryText(GAME({ citrus: CITRUS({ projectedPlayers: 49 }) })))
      .toBe('49 projected');
  });

  it('contains no em dash, per the house voice rule', () => {
    const all = [
      citrusSummaryText(GAME({ citrus: CITRUS({ myCount: 2 }) })),
      citrusSummaryText(GAME({ citrus: CITRUS({ rosteredCount: 2, myCount: 0 }) })),
      citrusSummaryText(GAME({ citrus: CITRUS() })),
      rowStatusText(GAME()),
      friendlyDateLabel('2026-09-29'),
    ].join(' ');
    expect(all).not.toContain('—');
  });
});

describe('goalie honesty', () => {
  it('flags two goalies from one club, since no starter is ever confirmed', () => {
    expect(
      hasUnconfirmedGoalieDuel([
        LINE({ playerId: 1, isGoalie: true, teamAbbrev: 'CAR' }),
        LINE({ playerId: 2, isGoalie: true, teamAbbrev: 'CAR' }),
      ]),
    ).toBe(true);
  });

  it('does not flag one goalie per club, or a goalie with no team', () => {
    expect(
      hasUnconfirmedGoalieDuel([
        LINE({ playerId: 1, isGoalie: true, teamAbbrev: 'CAR' }),
        LINE({ playerId: 2, isGoalie: true, teamAbbrev: 'FLA' }),
        LINE({ playerId: 3, isGoalie: false, teamAbbrev: 'CAR' }),
      ]),
    ).toBe(false);
    expect(hasUnconfirmedGoalieDuel([LINE({ isGoalie: true, teamAbbrev: null })])).toBe(false);
  });
});

describe('day ordering', () => {
  it('puts live above scheduled above final, then orders by puck drop', () => {
    const games = [
      GAME({ gameId: 4, state: 'final', startsAt: '2026-09-29T18:00:00Z' }),
      GAME({ gameId: 1, state: 'scheduled', startsAt: '2026-09-30T02:00:00Z' }),
      GAME({ gameId: 2, state: 'live', startsAt: '2026-09-29T23:00:00Z' }),
      GAME({ gameId: 3, state: 'scheduled', startsAt: '2026-09-29T21:00:00Z' }),
    ];
    expect([...games].sort(compareGames).map((g) => g.gameId)).toEqual([2, 3, 1, 4]);
  });
});

describe('date strip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Noon Mountain on the real "today" this branch was built against.
    vi.setSystemTime(new Date('2026-09-02T18:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shifts dates across month and year boundaries', () => {
    expect(shiftDate('2026-09-30', 1)).toBe('2026-10-01');
    expect(shiftDate('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('builds a window that leans forward and marks today exactly once', () => {
    const strip = buildDateStrip('2026-09-02');
    expect(strip).toHaveLength(14);
    expect(strip[0].date).toBe('2026-08-30');
    expect(strip[strip.length - 1].date).toBe('2026-09-12');
    expect(strip.filter((d) => d.isToday).map((d) => d.date)).toEqual(['2026-09-02']);
  });

  it('labels the weekday and day number without slipping a day', () => {
    const [first] = buildDateStrip('2026-09-29', 0, 0);
    expect(first).toMatchObject({ date: '2026-09-29', weekday: 'TUE', day: '29', isToday: false });
  });

  it('names today, yesterday and tomorrow, and spells out anything else', () => {
    expect(friendlyDateLabel('2026-09-02')).toBe('Today');
    expect(friendlyDateLabel('2026-09-01')).toBe('Yesterday');
    expect(friendlyDateLabel('2026-09-03')).toBe('Tomorrow');
    expect(friendlyDateLabel('2026-09-29')).toBe('Tuesday, September 29');
    expect(shortDateLabel('2026-06-14')).toBe('Jun 14');
  });
});
