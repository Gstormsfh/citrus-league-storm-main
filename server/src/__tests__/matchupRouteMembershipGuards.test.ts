import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createChain } from './helpers';

/**
 * Regression tests for the IDOR gap on the service-role matchup routes
 * (2026-09-14 handoff review).
 *
 * `daily-scores`, `frozen-roster-batch` and `ensure-rosters` resolve the
 * matchup on getSupabaseAdmin() and two of them persist rows. Before this
 * guard, any signed-in user who learned a matchup UUID could read both
 * teams' frozen lineups for a league they never joined, and trigger
 * roster/score persistence for it. `/api/rosters/daily-roster` took team_id
 * and matchup_id from the query string with only auth.
 *
 * Every route now runs assertMatchupVisible / assertMatchupTeamVisible on
 * the CALLER's client first, so the `matchups` SELECT policy is the gate.
 * These tests pin that: an invisible matchup is a 404 and the service is
 * never constructed with the admin client; a visibility lookup failure is a
 * 500, not a 404; a visible matchup proceeds exactly as before.
 */

const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  admin: vi.fn(),
  matchupsChain: null as any,
  rostersChain: null as any,
  calculateDailyMatchupScores: vi.fn(),
  getFrozenRosterBatch: vi.fn(),
  ensureMatchupRosters: vi.fn(),
  getDailyRoster: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({
  createUserClient: mocks.client,
  getSupabaseAdmin: mocks.admin,
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock('../middleware/auth', () => ({
  authMiddleware: async (c: any, next: any) => {
    if (!c.req.header('Authorization')) return c.json({ error: 'Unauthorized' }, 401);
    c.set('userId', 'u-outsider');
    c.set('userToken', 'test-session');
    await next();
  },
}));

vi.mock('../services/MatchupService', () => ({
  MatchupService: class {
    calculateDailyMatchupScores = mocks.calculateDailyMatchupScores;
    getFrozenRosterBatch = mocks.getFrozenRosterBatch;
    ensureMatchupRosters = mocks.ensureMatchupRosters;
  },
}));

vi.mock('../services/LineupService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/LineupService')>();
  return {
    ...actual,
    LineupService: class {
      getDailyRoster = mocks.getDailyRoster;
    },
  };
});

import { matchupRoutes } from '../routes/matchups';
import { rosterRoutes } from '../routes/rosters';

const app = new Hono()
  .route('/api/matchups', matchupRoutes)
  .route('/api/rosters', rosterRoutes);

const MATCHUP = '576e3b64-229d-49c1-9498-2e4d2be36731';
const TEAM1 = '11111111-1111-1111-1111-111111111111';
const TEAM2 = '22222222-2222-2222-2222-222222222222';
const FOREIGN_TEAM = '99999999-9999-9999-9999-999999999999';

const headers = { Authorization: 'Bearer test-session', 'Content-Type': 'application/json' };

function setVisibility(value: { data: any; error: any }) {
  mocks.matchupsChain = createChain(value);
  mocks.client.mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'matchups') return mocks.matchupsChain;
      if (table === 'fantasy_daily_rosters') return mocks.rostersChain;
      return createChain();
    }),
    rpc: vi.fn(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rostersChain = createChain({ data: [], error: null });
  mocks.calculateDailyMatchupScores.mockResolvedValue({ data: { team1: 10, team2: 8 }, error: null });
  mocks.getFrozenRosterBatch.mockResolvedValue({ entries: [{ player_id: 1 }], error: null });
  mocks.ensureMatchupRosters.mockResolvedValue({ initialized: 0 });
  mocks.getDailyRoster.mockResolvedValue({ data: [{ player_id: 1, slot_type: 'starter', slot_id: 'C1' }], error: null });
  setVisibility({ data: { team1_id: TEAM1, team2_id: TEAM2 }, error: null });
});

const routes = [
  {
    name: 'GET /api/matchups/:id/daily-scores',
    request: () => app.request(`/api/matchups/${MATCHUP}/daily-scores`, { headers }),
    service: () => mocks.calculateDailyMatchupScores,
    okBody: { data: { team1: 10, team2: 8 } },
  },
  {
    name: 'POST /api/matchups/:id/frozen-roster-batch',
    request: () => app.request(`/api/matchups/${MATCHUP}/frozen-roster-batch`, {
      method: 'POST', headers, body: JSON.stringify({ dates: ['2026-10-08'] }),
    }),
    service: () => mocks.getFrozenRosterBatch,
    okBody: { data: [{ player_id: 1 }] },
  },
  {
    name: 'POST /api/matchups/:id/ensure-rosters',
    request: () => app.request(`/api/matchups/${MATCHUP}/ensure-rosters`, { method: 'POST', headers }),
    service: () => mocks.ensureMatchupRosters,
    okBody: { data: { initialized: 0 } },
  },
  {
    name: 'GET /api/rosters/daily-roster',
    request: () => app.request(
      `/api/rosters/daily-roster?team_id=${TEAM1}&matchup_id=${MATCHUP}&roster_date=2026-10-08`,
      { headers },
    ),
    service: () => mocks.getDailyRoster,
    okBody: { data: [{ player_id: 1, slot_type: 'starter', slot_id: 'C1' }] },
  },
];

describe.each(routes)('$name membership guard', ({ request, service, okBody }) => {
  it('answers 404 and never reaches the service when the caller cannot see the matchup', async () => {
    setVisibility({ data: null, error: null });
    const response = await request();
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('NOT_FOUND');
    expect(service()).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it('checks visibility on the caller client, by matchup id, before the service runs', async () => {
    await request();
    expect(mocks.client).toHaveBeenCalledWith('test-session');
    expect(mocks.matchupsChain.select).toHaveBeenCalledWith('team1_id, team2_id');
    expect(mocks.matchupsChain.eq).toHaveBeenCalledWith('id', MATCHUP);
    expect(mocks.matchupsChain.maybeSingle.mock.invocationCallOrder[0])
      .toBeLessThan(service().mock.invocationCallOrder[0]);
  });

  it('does not hide a visibility lookup failure as a missing matchup', async () => {
    setVisibility({ data: null, error: { code: '57014', message: 'Query timed out' } });
    const response = await request();
    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe('INTERNAL_ERROR');
    expect(service()).not.toHaveBeenCalled();
  });

  it('proceeds unchanged for a matchup the caller can see', async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(okBody);
    expect(service()).toHaveBeenCalledTimes(1);
  });

  it('requires authentication', async () => {
    const response = await app.request(`/api/matchups/${MATCHUP}/ensure-rosters`, { method: 'POST' });
    expect(response.status).toBe(401);
  });
});

describe('GET /api/rosters/daily-roster team pinning', () => {
  it('refuses a team that is not in the visible matchup', async () => {
    const response = await app.request(
      `/api/rosters/daily-roster?team_id=${FOREIGN_TEAM}&matchup_id=${MATCHUP}&roster_date=2026-10-08`,
      { headers },
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('FORBIDDEN');
    expect(mocks.getDailyRoster).not.toHaveBeenCalled();
  });

  it('accepts either team in the matchup', async () => {
    const response = await app.request(
      `/api/rosters/daily-roster?team_id=${TEAM2}&matchup_id=${MATCHUP}&roster_date=2026-10-08`,
      { headers },
    );
    expect(response.status).toBe(200);
    expect(mocks.getDailyRoster).toHaveBeenCalledWith(TEAM2, MATCHUP, '2026-10-08');
  });

  it('still requires all three query params', async () => {
    const response = await app.request(`/api/rosters/daily-roster?team_id=${TEAM1}`, { headers });
    expect(response.status).toBe(400);
  });
});
