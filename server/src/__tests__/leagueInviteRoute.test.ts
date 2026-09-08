import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { createChain, createMockSupabase } from './helpers';

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

afterEach(() => vi.clearAllMocks());

/**
 * GET /api/leagues/invite/:code (2026-09-09, #19).
 *
 * The invite accept screen shows who is inviting you to which league and how
 * full it is BEFORE joining. The viewer is not a member yet, so the read goes
 * through the admin client and only the drawn fields leave the server.
 */
const LEAGUE = { id: 'L1', name: 'Final Build #15', commissioner_id: 'u-commish', draft_status: 'not_started', settings: { teamsCount: 10, leagueType: 'fantasy' } };

function tables(opts: { member?: boolean; league?: any } = {}) {
  const teams = createChain({ data: opts.member ? { id: 't-mine' } : null, count: 3, error: null });
  return {
    leagues: createChain({ data: opts.league === undefined ? LEAGUE : opts.league, error: null }),
    teams,
    profiles: createChain({ data: { username: 'gdaddy', first_name: 'Garrett', last_name: 'Storms' }, error: null }),
  };
}

function get(app: any, code: string) {
  return app.request(`/api/leagues/invite/${code}`, { method: 'GET', headers: { Authorization: 'Bearer tok' } });
}

describe('GET /api/leagues/invite/:code', () => {
  it('answers the league, the commissioner, and the seat count for a non-member', async () => {
    const { getSupabaseAdmin, createUserClient } = await import('../lib/supabase');
    const { app } = await import('../app');
    const t = tables();
    (getSupabaseAdmin as any).mockReturnValue(createMockSupabase(t));
    (createUserClient as any).mockReturnValue(createMockSupabase({}));

    const res = await get(app, 'qhnepz');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({
      leagueId: 'L1',
      name: 'Final Build #15',
      leagueType: 'fantasy',
      commissionerName: 'Garrett Storms',
      draftStatus: 'not_started',
      filled: 3,
      maxTeams: 10,
      alreadyMember: false,
    });
    // Case-insensitive lookup, so a hand-typed lowercase code still resolves.
    expect(t.leagues.ilike).toHaveBeenCalledWith('join_code', 'qhnepz');
  });

  it('flags an existing member so the screen can say "you are already in"', async () => {
    const { getSupabaseAdmin, createUserClient } = await import('../lib/supabase');
    const { app } = await import('../app');
    (getSupabaseAdmin as any).mockReturnValue(createMockSupabase(tables({ member: true })));
    (createUserClient as any).mockReturnValue(createMockSupabase({}));

    const res = await get(app, 'QHNEPZ');
    expect(res.status).toBe(200);
    expect((await res.json()).data.alreadyMember).toBe(true);
  });

  it('refuses wildcard characters before they reach ilike', async () => {
    const { getSupabaseAdmin, createUserClient } = await import('../lib/supabase');
    const { app } = await import('../app');
    const admin = createMockSupabase(tables());
    (getSupabaseAdmin as any).mockReturnValue(admin);
    (createUserClient as any).mockReturnValue(createMockSupabase({}));

    const res = await get(app, '%25');
    expect(res.status).toBe(400);
    expect(admin.from).not.toHaveBeenCalled();
  });

  it('404s an unknown code without leaking anything', async () => {
    const { getSupabaseAdmin, createUserClient } = await import('../lib/supabase');
    const { app } = await import('../app');
    (getSupabaseAdmin as any).mockReturnValue(createMockSupabase(tables({ league: null })));
    (createUserClient as any).mockReturnValue(createMockSupabase({}));

    const res = await get(app, 'NOPE00');
    expect(res.status).toBe(404);
  });
});
