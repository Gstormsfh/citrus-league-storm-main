/**
 * The league menu's lines (2026-09-05). See leagueMenuTiles.ts.
 */
import { describe, it, expect } from 'vitest';
import { leagueMenuTiles } from '../leagueMenuTiles';

const standings = [
  { team_id: 'a', wins: 5, losses: 0, pointsFor: 612.4 },
  { team_id: 'me', wins: 4, losses: 1, pointsFor: 588.9 },
  { team_id: 'c', wins: 4, losses: 1, ties: 1, pointsFor: 561.2 },
];

const byKey = (tiles: ReturnType<typeof leagueMenuTiles>) => Object.fromEntries(tiles.map((t) => [t.key, t]));

describe('leagueMenuTiles', () => {
  it('with nothing in hand: the four routes and the simulator, no lines', () => {
    const tiles = leagueMenuTiles({ leagueId: 'lg' });
    expect(tiles.map((t) => t.key)).toEqual(['standings', 'trades', 'waivers', 'schedule', 'mockdraft']);
    for (const t of tiles) expect(t.stat ?? null).toBeNull();
  });

  it('the lines the artboard prints, from the reads the screens already make', () => {
    const t = byKey(
      leagueMenuTiles({
        leagueId: 'lg',
        myTeamId: 'me',
        standings,
        pendingTrades: [{ to_team_id: 'me' }, { to_team_id: 'c' }],
        waiverPriority: [{ team_id: 'a', priority: 1 }, { team_id: 'me', priority: 7 }],
        waiverProcessTime: '02:00:00',
        nextWeek: { number: 2, opponent: 'Bench Bosses' },
        draft: { completed: true, type: 'snake', rounds: 18 },
        managers: { count: 12, max: 12, canInvite: true },
        commissioner: true,
      }),
    );
    expect(t.standings.stat).toBe('2nd · 4–1');
    expect(t.trades.stat).toBe('1 offer waiting on you · 2 pending');
    expect(t.waivers.stat).toBe("You're #7 · processes 2:00 AM MT");
    expect(t.schedule.stat).toBe('Wk 2 vs Bench Bosses');
    expect(t.draft.stat).toBe('Snake · 18 rds');
    expect(t.draft.to).toBe('/draft-v2/lg');
    expect(t.managers.stat).toBe('12/12 · share link');
    expect(t.settings.to).toBe('/league/lg?settings=1');
    expect(t.mockdraft).toBeTruthy();
  });

  it('ties in the record, a bye next week, no offers, a member who cannot invite', () => {
    const t = byKey(
      leagueMenuTiles({
        leagueId: 'lg',
        myTeamId: 'c',
        standings,
        pendingTrades: [],
        nextWeek: { number: 9, opponent: null },
        draft: { completed: false, type: 'snake', rounds: 18 },
        managers: { count: 9, max: null, canInvite: false },
      }),
    );
    expect(t.standings.stat).toBe('3rd · 4–1–1');
    expect(t.trades.stat).toBe('No open offers');
    expect(t.schedule.stat).toBe('Wk 9 · bye');
    expect(t.draft).toBeUndefined();
    expect(t.managers.stat).toBe('9 teams');
    expect(t.settings).toBeUndefined();
  });

  it('pending offers none of which are yours', () => {
    const t = byKey(leagueMenuTiles({ leagueId: 'lg', myTeamId: 'me', pendingTrades: [{ to_team_id: 'c' }] }));
    expect(t.trades.stat).toBe('1 pending');
  });
});
