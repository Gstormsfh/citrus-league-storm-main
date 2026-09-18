import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChain } from './helpers';
import { MatchupService } from '../services/MatchupService';
import { ScheduleGenerationService } from '../services/ScheduleGenerationService';

/**
 * SCHEDULE OWNERSHIP (2026-09-14). The Matchup page no longer builds a
 * league's schedule from the browser; this service does, from the first
 * read of an empty schedule and from the hourly sweep. These tests pin the
 * contract the page relied on: idempotent, never deletes, the same week
 * math as the client, and a Mountain-time completion date on a UTC server.
 */
const LEAGUE = '11111111-1111-1111-1111-111111111111';

function harness(opts: {
  league?: Record<string, unknown> | null;
  existing?: number;
  teams?: number;
  gamesInLastWeek?: number;
  generateError?: unknown;
} = {}) {
  const league = opts.league === undefined
    ? { id: LEAGUE, draft_status: 'completed', settings: { draftCompletedAt: '2026-09-14T22:00:00-06:00' }, created_at: '2026-09-01T00:00:00Z' }
    : opts.league;
  const chains: Record<string, any> = {
    leagues: createChain({ data: league, error: league ? null : { message: 'no rows' } }),
    matchups: createChain({ data: null, error: null, count: opts.existing ?? 0 }),
    teams: createChain({ data: Array.from({ length: opts.teams ?? 12 }, (_, i) => ({ id: `team-${i + 1}` })), error: null }),
    nhl_games: createChain({ data: null, error: null, count: opts.gamesInLastWeek ?? 5 }),
  };
  const admin = { from: vi.fn((table: string) => chains[table] ?? createChain()), rpc: vi.fn() } as any;
  const generate = vi.spyOn(MatchupService.prototype, 'generateMatchupsForLeague').mockResolvedValue({ error: opts.generateError ?? null } as never);
  return { admin, chains, generate, service: new ScheduleGenerationService(admin) };
}

beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-15T04:00:00Z') }));
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('ScheduleGenerationService.ensureLeagueSchedule', () => {
  it.each([['sunday', '2026-09-27', '2026-10-03', 0, 6], ['monday', '2026-09-28', '2026-10-04', 1, 0]] as const)('keeps the configured %s calendar through both DST changes', async (weekStartDay, start, end, startDow, endDow) => {
    const h = harness({ league: { id: LEAGUE, draft_status: 'completed', settings: {
      draftCompletedAt: '2026-09-14T22:00:00-06:00', weekStartDay, playoffTeams: 0,
    }, created_at: '2026-09-01T00:00:00Z' } });
    expect((await h.service.ensureLeagueSchedule(LEAGUE)).outcome).toBe('generated');
    const weeks = h.generate.mock.calls[0][2];
    expect(weeks[0]).toEqual({ week_number: 1, start_date: start, end_date: end });
    expect(weeks.length).toBeGreaterThan(27);
    weeks.forEach((week, i) => {
      const first = new Date(week.start_date + 'T00:00:00');
      const last = new Date(week.end_date + 'T00:00:00');
      expect(first.getDay()).toBe(startDow);
      expect(last.getDay()).toBe(endDow);
      first.setDate(first.getDate() + 6);
      expect(first.getTime()).toBe(last.getTime());
      if (i > 0) {
        const previousEnd = new Date(weeks[i - 1].end_date + 'T00:00:00');
        previousEnd.setDate(previousEnd.getDate() + 1);
        expect(previousEnd.getTime()).toBe(new Date(week.start_date + 'T00:00:00').getTime());
      }
    });
    expect(h.generate.mock.calls[0][3]).toBe(false);
  });

  it('generates once for a completed-draft league with no matchups, with the same weeks the client computed', async () => {
    const h = harness();
    const result = await h.service.ensureLeagueSchedule(LEAGUE);
    expect(result.outcome).toBe('generated');
    expect(result.teams).toBe(12);

    const [leagueId, teams, weeks, force] = h.generate.mock.calls[0];
    expect(leagueId).toBe(LEAGUE);
    expect(teams).toHaveLength(12);
    expect(force).toBe(false);
    // A September completion clamps to the season anchor: the Sunday on or
    // before Oct 1 2026 (a Thursday) is Sep 27. 29 calendar weeks reach mid
    // April; the default 3-week playoff reserve leaves 26 regular weeks.
    expect(weeks[0]).toEqual({ week_number: 1, start_date: '2026-09-27', end_date: '2026-10-03' });
    expect(weeks).toHaveLength(26);
    expect(weeks[25].end_date).toBe('2027-03-27');
  });

  it('leaves a league that already holds matchups alone', async () => {
    const h = harness({ existing: 143 });
    const result = await h.service.ensureLeagueSchedule(LEAGUE);
    expect(result.outcome).toBe('exists');
    expect(h.generate).not.toHaveBeenCalled();
  });

  it('skips a league whose draft is not complete, and one with fewer than two teams', async () => {
    const notDone = harness({ league: { id: LEAGUE, draft_status: 'in_progress', settings: {}, created_at: '2026-09-01T00:00:00Z' } });
    expect((await notDone.service.ensureLeagueSchedule(LEAGUE)).outcome).toBe('skipped');
    expect(notDone.generate).not.toHaveBeenCalled();
    const solo = harness({ teams: 1 });
    expect((await solo.service.ensureLeagueSchedule(LEAGUE)).outcome).toBe('skipped');
    expect(solo.generate).not.toHaveBeenCalled();
  });

  it('treats a duplicate-key race as exists, never as a failure to retry with a delete', async () => {
    const h = harness({ generateError: { message: 'duplicate key value violates unique constraint "matchups_league_week_team"' } });
    const result = await h.service.ensureLeagueSchedule(LEAGUE);
    expect(result.outcome).toBe('exists');
    expect(result.reason).toMatch(/concurrently/);
    // forceRegenerate is pinned false on every call.
    expect(h.generate.mock.calls.every((call) => call[3] === false)).toBe(true);
  });

  // One harness per test: spyOn returns the same spy for an already-spied
  // method, so a second harness in one test would read the first call.
  it('honors playoffTeams 0: no playoff reservation, every calendar week is regular season', async () => {
    const h = harness({ league: { id: LEAGUE, draft_status: 'completed', settings: { draftCompletedAt: '2026-09-14T22:00:00-06:00', playoffTeams: 0 }, created_at: '2026-09-01T00:00:00Z' } });
    await h.service.ensureLeagueSchedule(LEAGUE);
    expect(h.generate.mock.calls[0][2]).toHaveLength(29);
  });

  it('honors playoffWeeks 2: reserves exactly two weeks', async () => {
    const h = harness({ league: { id: LEAGUE, draft_status: 'completed', settings: { draftCompletedAt: '2026-09-14T22:00:00-06:00', playoffTeams: 6, playoffWeeks: 2 }, created_at: '2026-09-01T00:00:00Z' } });
    await h.service.ensureLeagueSchedule(LEAGUE);
    expect(h.generate.mock.calls[0][2]).toHaveLength(27);
  });

  it('trims trailing calendar weeks that hold no NHL games', async () => {
    const h = harness({ gamesInLastWeek: 0 });
    await h.service.ensureLeagueSchedule(LEAGUE);
    // Four probes, all empty, drop four weeks: 29 - 4 = 25 calendar weeks, minus the 3-week reserve.
    expect(h.generate.mock.calls[0][2]).toHaveLength(22);
  });
});

describe('ScheduleGenerationService.fantasyWeeksFor on a UTC server', () => {
  it('reads the completion date as the Mountain civil date, so a late-Sunday in-season draft starts that week, not the next', async () => {
    // Sunday Nov 1 2026, 22:00 Mountain, is Monday Nov 2, 05:00 UTC. Cloud
    // Run is UTC; without the timezone the week math would land on Nov 8.
    vi.setSystemTime(new Date('2026-11-02T06:00:00Z'));
    const h = harness();
    const weeks = await h.service.fantasyWeeksFor({ id: LEAGUE, draft_status: 'completed', settings: { draftCompletedAt: '2026-11-02T05:00:00Z' }, created_at: '2026-09-01T00:00:00Z' });
    expect(weeks[0].start_date).toBe('2026-11-01');
  });
});
