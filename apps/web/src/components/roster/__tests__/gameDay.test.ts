// Game-day line from the schedule (2026-09-01, audit R9).
//
// Rows used to print "EDM · Game" on every day but today, because the
// opponent came from today's schedule and a literal 'Game' stood in when it
// was missing. What this pins: the line is derived from the schedule row for
// the SELECTED date, reads vs/@ from which side the team is on, and is
// simply absent — never a placeholder — when there is no such row.
import { describe, it, expect, vi } from 'vitest';

// gameDay reuses ScheduleService.getGameInfo (pure), but importing the
// service module pulls the API client, whose Supabase client throws at
// module scope with the suite's hermetic (empty) env. Stub it out.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn(), auth: { getSession: vi.fn() } },
}));

import { gameOnDate, rowGameFor } from '../gameDay';
import type { NHLGame } from '@/services/ScheduleService';

const game = (over: Partial<NHLGame> = {}): NHLGame => ({
  id: 'g1',
  game_id: 2026020123,
  game_date: '2026-10-14',
  // 01:00Z on the 15th is 7:00 PM Mountain Daylight Time on the 14th.
  game_time: '2026-10-15T01:00:00Z',
  home_team: 'EDM',
  away_team: 'BOS',
  home_score: 0,
  away_score: 0,
  status: 'scheduled',
  period: null,
  period_time: null,
  venue: null,
  season: 2026,
  game_type: 'regular',
  ...over,
});

const OPTS = { targetDate: '2026-10-14', todayStr: '2026-10-14', timezone: 'America/Denver' };

describe('gameOnDate', () => {
  it('picks the game on the asked-for day out of a week of rows', () => {
    const rows = [game({ game_date: '2026-10-12' }), game({ game_date: '2026-10-14' }), game({ game_date: '2026-10-16' })];
    expect(gameOnDate(rows, '2026-10-14')?.game_date).toBe('2026-10-14');
    expect(gameOnDate(rows, '2026-10-13')).toBeNull();
  });

  it('tolerates timestamped dates and missing rows', () => {
    expect(gameOnDate([game({ game_date: '2026-10-14T00:00:00' })], '2026-10-14')).toBeTruthy();
    expect(gameOnDate(undefined, '2026-10-14')).toBeNull();
    expect(gameOnDate([], '2026-10-14')).toBeNull();
  });
});

describe('rowGameFor — the opponent is real or absent, never a placeholder', () => {
  it('home reads "vs", away reads "@"', () => {
    expect(rowGameFor(game(), 'EDM', OPTS)?.opponent).toBe('vs BOS');
    expect(rowGameFor(game(), 'BOS', OPTS)?.opponent).toBe('@ EDM');
  });

  it('carries the face-off time in the manager\'s timezone while the game is ahead', () => {
    const line = rowGameFor(game(), 'EDM', OPTS);
    expect(line?.status).toBe('scheduled');
    expect(line?.gameTime).toBe('7:00 PM');
    expect(line?.score).toBeUndefined();
  });

  it('is null — not "Game" — when there is no row, or the row is someone else\'s game', () => {
    expect(rowGameFor(null, 'EDM', OPTS)).toBeNull();
    expect(rowGameFor(undefined, 'EDM', OPTS)).toBeNull();
    expect(rowGameFor(game(), 'TOR', OPTS)).toBeNull();
    expect(rowGameFor(game(), '', OPTS)).toBeNull();
  });

  it('never produces the literal placeholder', () => {
    for (const team of ['EDM', 'BOS', 'TOR']) {
      const line = rowGameFor(game(), team, OPTS);
      expect(line?.opponent).not.toBe('Game');
      expect(JSON.stringify(line ?? {})).not.toContain('"Game"');
    }
  });

  it('live and final carry the short home-away score the chip prints', () => {
    const live = rowGameFor(game({ status: 'live', home_score: 2, away_score: 1 }), 'EDM', OPTS);
    expect(live?.status).toBe('live');
    expect(live?.score).toBe('2-1');
    const final = rowGameFor(game({ status: 'final', home_score: 4, away_score: 2 }), 'BOS', OPTS);
    expect(final?.status).toBe('final');
    expect(final?.score).toBe('4-2');
    expect(final?.opponent).toBe('@ EDM');
  });

  it('a past day still marked scheduled reads as final — the calendar beats a lagging feed', () => {
    const line = rowGameFor(game({ game_date: '2026-10-13' }), 'EDM', {
      ...OPTS,
      targetDate: '2026-10-13',
      todayStr: '2026-10-14',
    });
    expect(line?.status).toBe('final');
    expect(line?.opponent).toBe('vs BOS');
  });

  it('a future day is scheduled with its own opponent and time', () => {
    const line = rowGameFor(game({ game_date: '2026-10-16', away_team: 'TOR' }), 'EDM', {
      ...OPTS,
      targetDate: '2026-10-16',
    });
    expect(line?.status).toBe('scheduled');
    expect(line?.opponent).toBe('vs TOR');
    expect(line?.gameTime).toBe('7:00 PM');
  });

  it('a postponed game is no game', () => {
    expect(rowGameFor(game({ status: 'postponed' }), 'EDM', OPTS)).toBeNull();
  });

  it('an unknown status falls back to scheduled', () => {
    const line = rowGameFor(game({ status: 'weird' as NHLGame['status'] }), 'EDM', OPTS);
    expect(line?.status).toBe('scheduled');
  });
});
