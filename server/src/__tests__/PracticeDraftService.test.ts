import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createChain } from './helpers';
import { PracticeDraftService } from '../services/PracticeDraftService';
import { LeagueMembershipService } from '../services/LeagueMembershipService';
import { AppError } from '../lib/errors';

/**
 * THE MOCK DRAFT IS A REAL DRAFT (2026-09-14). A practice league is created
 * through the same insert as every real league, gets every seat but the
 * human's filled with the same owner_id=null rows the commissioner's "fill
 * with AI" writes, and is marked settings.practice so it stays out of
 * league lists, the freeze gate and the sweep. Launched from a league it
 * inherits that league's geometry and scoring.
 */
const SOURCE = '11111111-1111-1111-1111-111111111111';
const USER = 'user-1';

function harness(opts: { source?: Record<string, unknown> | null; member?: boolean } = {}) {
  const leagueInsert = createChain({ data: { id: 'mock-league', name: 'Mock Draft' }, error: null });
  const teamInsert = createChain({ data: { id: 'my-team', team_name: 'My Team' }, error: null });
  const aiInsert = createChain({ data: null, error: null });
  const membershipTeams = createChain({ data: opts.member === false ? null : { id: 'seat' }, error: null });
  let leagueReads = 0;
  const user = {
    from: vi.fn((table: string) => {
      if (table === 'leagues') {
        leagueReads += 1;
        // Order when launched from a league: membership's commissioner read,
        // the source read, then the insert. From the home page: just the insert.
        if (opts.source !== undefined) {
          if (leagueReads === 1) return createChain({ data: { commissioner_id: 'someone-else' }, error: null });
          if (leagueReads === 2) return createChain({ data: opts.source, error: opts.source ? null : { message: 'no rows' } });
        }
        return leagueInsert;
      }
      if (table === 'profiles') return createChain({ data: { username: 'garrett' }, error: null });
      if (table === 'teams') {
        // membership check reads teams before createLeague inserts the human's team
        if (opts.source !== undefined && membershipTeams.select.mock.calls.length === 0) return membershipTeams;
        return teamInsert;
      }
      return createChain();
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  } as any;
  const admin = { from: vi.fn((table: string) => (table === 'teams' ? aiInsert : createChain())) } as any;
  return { user, admin, leagueInsert, teamInsert, aiInsert, service: new PracticeDraftService(user, admin) };
}

beforeEach(() => LeagueMembershipService.clearCache());

describe('PracticeDraftService.create', () => {
  it('creates a practice league through the real insert and seats every other chair with AI', async () => {
    const h = harness();
    const result = await h.service.create(USER, { teamsCount: 12, now: '2026-09-14T23:52:00Z' });
    expect(result).toEqual({ leagueId: 'mock-league', teamId: 'my-team', aiSeats: 11 });

    const inserted = h.leagueInsert.insert.mock.calls[0][0];
    expect(inserted.commissioner_id).toBe(USER);
    expect(inserted.name).toMatch(/^Mock Draft /);
    expect(inserted.name).not.toMatch(/—/);
    expect(inserted.league_size).toBe(12);
    expect(inserted.draft_rounds).toBe(21);
    expect(inserted.settings).toMatchObject({ practice: true, teamsCount: 12, pickTimeLimit: 30, leagueType: 'fantasy' });

    const rows = h.aiInsert.insert.mock.calls[0][0];
    expect(rows).toHaveLength(11);
    expect(rows.every((r: { owner_id: unknown; league_id: string }) => r.owner_id === null && r.league_id === 'mock-league')).toBe(true);
    expect(rows[0].team_name).toBe('AI Team 2');
  });

  it('is league_size minus one AI seats, whatever the size', async () => {
    const h = harness();
    const result = await h.service.create(USER, { teamsCount: 8 });
    expect(result.aiSeats).toBe(7);
    expect(h.aiInsert.insert.mock.calls[0][0]).toHaveLength(7);
    expect(h.leagueInsert.insert.mock.calls[0][0].league_size).toBe(8);
  });

  it('inherits size, rounds, roster slots, draft type and scoring from the source league', async () => {
    const scoring = { skater: { goals: 7, assists: 3 }, goalie: { wins: 4 } };
    const h = harness({ source: {
      league_size: 10, draft_rounds: 18, roster_size: 18,
      roster_slots: { C: 2, LW: 2, RW: 2, D: 4, G: 2 },
      settings: { rosterSlots: { C: 3, LW: 2, RW: 2, D: 4, G: 2 }, draftType: 'linear', keeperEnabled: true },
      scoring_settings: scoring,
    } });
    const result = await h.service.create(USER, { fromLeagueId: SOURCE, teamsCount: 12 });
    expect(result.aiSeats).toBe(9);
    const inserted = h.leagueInsert.insert.mock.calls[0][0];
    expect(inserted.league_size).toBe(10);
    expect(inserted.draft_rounds).toBe(18);
    expect(inserted.roster_size).toBe(18);
    expect(inserted.scoring_settings).toEqual(scoring);
    expect(inserted.roster_slots).toEqual({ C: 3, LW: 2, RW: 2, D: 4, G: 2 });
    expect(inserted.settings).toMatchObject({ practice: true, draftType: 'linear', practiceOf: SOURCE, teamsCount: 10 });
    // keepers and anything else league-specific do not come along
    expect(inserted.settings.keeperEnabled).toBeUndefined();
  });

  it('refuses when the caller is not a member of the source league', async () => {
    const h = harness({ source: { league_size: 12 }, member: false });
    await expect(h.service.create(USER, { fromLeagueId: SOURCE })).rejects.toThrow(/not a member/);
    expect(h.leagueInsert.insert).not.toHaveBeenCalled();
  });

  // One harness per test: the membership cache is module-level and keyed on
  // (user, league), so a second harness in the same test would skip the
  // membership read and shift the mocked `leagues` read order.
  it('refuses a source league with no size', async () => {
    const h = harness({ source: { league_size: null, settings: {} } });
    await expect(h.service.create(USER, { fromLeagueId: SOURCE })).rejects.toMatchObject({ message: expect.stringMatching(/Set the league size/) });
    expect(h.leagueInsert.insert).not.toHaveBeenCalled();
  });

  it('refuses a mock of a mock', async () => {
    const h = harness({ source: { league_size: 12, settings: { practice: true } } });
    await expect(h.service.create(USER, { fromLeagueId: SOURCE })).rejects.toMatchObject({ message: expect.stringMatching(/another mock draft/) });
    expect(h.leagueInsert.insert).not.toHaveBeenCalled();
  });

  it('refuses sizes the engine cannot draft', async () => {
    for (const teamsCount of [1, 21, 2.5]) {
      const h = harness();
      await expect(h.service.create(USER, { teamsCount })).rejects.toBeInstanceOf(AppError);
      expect(h.leagueInsert.insert).not.toHaveBeenCalled();
    }
  });

  it('surfaces the league insert error and never seats AI on a league that does not exist', async () => {
    const h = harness();
    h.leagueInsert.single.mockResolvedValue({ data: null, error: { message: 'Playoff teams (6) cannot exceed total teams (2)' } });
    await expect(h.service.create(USER, { teamsCount: 12 })).rejects.toMatchObject({ message: expect.stringMatching(/Playoff teams/) });
    expect(h.aiInsert.insert).not.toHaveBeenCalled();
  });
});
