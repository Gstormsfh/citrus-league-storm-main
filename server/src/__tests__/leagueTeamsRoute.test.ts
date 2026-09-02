import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { createChain, createMockSupabase } from './helpers';
import { LeagueMembershipService } from '../services/LeagueMembershipService';

// Mock the supabase factory + auth middleware before importing the app.
vi.mock('../lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
  createUserClient: vi.fn(),
  getSupabaseAdmin: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('userId', 'u-test');
    c.set('userToken', 'tok');
    await next();
  },
}));

beforeAll(() => {
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
});

beforeEach(() => LeagueMembershipService.clearCache());
afterEach(() => vi.clearAllMocks());

/**
 * GET /api/leagues/:leagueId/teams — owner avatars on every team row
 * (2026-09-01, Sleeper parity audit M8).
 *
 * Teams have no avatar column. The matchup header and scoreboard discs
 * show the OWNER's profiles.avatar_url, so this response joins it in by
 * owner_id — explicit columns, one profiles read for the league, null for
 * AI teams and owners without a picture — on both the plain and the
 * ?withOwners=true shapes. Membership is the middleware's job and still
 * runs first: a non-member gets a 403 and no profiles read at all.
 */
const LEAGUE = '11111111-1111-1111-1111-111111111111';
const MY_TEAM = '22222222-2222-2222-2222-222222222222';

const TEAM_ROWS = [
  { id: MY_TEAM, league_id: LEAGUE, owner_id: 'u-test', team_name: 'Citrus Crushers', created_at: 't', updated_at: 't' },
  { id: 't-2', league_id: LEAGUE, owner_id: 'u-2', team_name: 'Thunder Titans', created_at: 't', updated_at: 't' },
  { id: 't-ai', league_id: LEAGUE, owner_id: null, team_name: 'AI Team 1', created_at: 't', updated_at: 't' },
];

const PROFILE_ROWS = [
  { id: 'u-test', username: 'me', display_name: 'Me', first_name: null, last_name: null, avatar_url: 'https://cdn/me.png' },
  { id: 'u-2', username: 'user_c4489220', display_name: null, first_name: null, last_name: null, avatar_url: null },
];

/** One chain per table; awaiting any builder yields the table's value. */
function tables(member = true) {
  return {
    // membership: commissioner check (single)
    leagues: createChain({ data: { id: LEAGUE, commissioner_id: 'someone-else' }, error: null }),
    // membership: own-team check (maybeSingle)
    teams: createChain({ data: member ? { id: MY_TEAM } : null, error: null }),
    profiles: createChain({ data: PROFILE_ROWS, error: null }),
  };
}

function get(app: any, qs = '') {
  return app.request(`/api/leagues/${LEAGUE}/teams${qs}`, {
    method: 'GET',
    headers: { Authorization: 'Bearer tok' },
  });
}

describe('GET /api/leagues/:leagueId/teams — owner avatar join', () => {
  it('serves avatar_url on every team: the owner picture, null for AI teams and owners without one', async () => {
    const { createUserClient } = await import('../lib/supabase');
    const { app } = await import('../app');
    const t = tables();
    // get_league_teams RPC answers the teams list.
    (createUserClient as any).mockReturnValue(createMockSupabase(t, { data: TEAM_ROWS, error: null }));

    const res = await get(app);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.map((row: { id: string; avatar_url: string | null }) => [row.id, row.avatar_url])).toEqual([
      [MY_TEAM, 'https://cdn/me.png'],
      ['t-2', null],
      ['t-ai', null],
    ]);
    // Everything the row carried before is still there.
    expect(body.data[0].team_name).toBe('Citrus Crushers');
    expect(body.data[0].owner_id).toBe('u-test');

    // Explicit columns, no SELECT *, and only the owners that exist.
    expect(t.profiles.select).toHaveBeenCalledTimes(1);
    expect(t.profiles.select).toHaveBeenCalledWith('id, avatar_url');
    expect(t.profiles.in).toHaveBeenCalledWith('id', ['u-test', 'u-2']);
  });

  it('?withOwners=true carries the avatar beside owner_name from a single profiles read', async () => {
    const { createUserClient } = await import('../lib/supabase');
    const { app } = await import('../app');
    const t = tables();
    (createUserClient as any).mockReturnValue(createMockSupabase(t, { data: TEAM_ROWS, error: null }));

    const res = await get(app, '?withOwners=true');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0]).toMatchObject({ id: MY_TEAM, owner_name: 'Me', avatar_url: 'https://cdn/me.png' });
    // Generated handle → "Manager", and no picture.
    expect(body.data[1]).toMatchObject({ id: 't-2', owner_name: 'Manager', avatar_url: null });
    expect(body.data[2]).toMatchObject({ id: 't-ai', owner_name: 'Unknown', avatar_url: null });
    expect(t.profiles.select).toHaveBeenCalledTimes(1);
    expect(t.profiles.select).toHaveBeenCalledWith('id, username, display_name, first_name, last_name, avatar_url');
  });

  it('a failed profiles read still returns the teams, with initials-worthy nulls', async () => {
    const { createUserClient } = await import('../lib/supabase');
    const { app } = await import('../app');
    const t = { ...tables(), profiles: createChain({ data: null, error: { message: 'boom' } }) };
    (createUserClient as any).mockReturnValue(createMockSupabase(t, { data: TEAM_ROWS, error: null }));

    const res = await get(app);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(3);
    expect(body.data.every((row: { avatar_url: unknown }) => row.avatar_url === null)).toBe(true);
  });

  it('a non-member is refused before any team or profile is read', async () => {
    const { createUserClient } = await import('../lib/supabase');
    const { app } = await import('../app');
    const t = tables(false);
    const client = createMockSupabase(t, { data: TEAM_ROWS, error: null });
    (createUserClient as any).mockReturnValue(client);

    const res = await get(app);
    expect(res.status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
    expect(t.profiles.select).not.toHaveBeenCalled();
  });
});
