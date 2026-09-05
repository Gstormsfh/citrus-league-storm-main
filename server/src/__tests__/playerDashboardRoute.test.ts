import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { createChain, createMockSupabase } from './helpers';
import { clearPlayerDashboardCache, clearPlayerXgHistoryCache } from '../services/PlayerDashboardService';

/**
 * GET /api/players/:playerId/dashboard — COMPONENT 6.5.
 *
 * The route that finally makes the player dashboard a shippable page:
 * one round trip carrying a player's shots (with our model's xG on each),
 * his whole `player_xg_season` career arc, GSAx if he is a goalie, his
 * talent row, and a real `as_of`.
 *
 * Three things are pinned here and nowhere else:
 *
 *  1. INPUT VALIDATION HAPPENS BEFORE ANY QUERY. A junk playerId, an
 *     out-of-range season or an invented gameType must 400 without a
 *     single `.from()` — otherwise the endpoint is a free, authenticated
 *     probe against a service-role client.
 *  2. THE SERVICE-ROLE CLIENT IS SCOPED TO `nhl_shots`. The table is
 *     deny-all to end-user roles by design, so the shot read genuinely
 *     needs it; everything else must stay on the caller's RLS-scoped
 *     client. A regression that swaps the two is invisible in prod until
 *     it is a security incident.
 *  3. A MISSING SERVICE ROLE KEY IS A DEGRADED PAGE, NOT A 500.
 *     `getSupabaseAdmin()` throws when SUPABASE_SERVICE_ROLE_KEY is unset
 *     (a preview deploy, a misconfigured env). The four other reads are
 *     still fine, so the response is 200 with `shots_available: false`.
 *
 * The auth gate itself is asserted in app.test.ts against the REAL
 * middleware, because this file stubs it out.
 */

const adminFrom = vi.fn();
const adminClient = { from: adminFrom } as unknown as { from: typeof adminFrom };
let adminThrows = false;

vi.mock('../lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
  createUserClient: vi.fn(),
  getSupabaseAdmin: () => {
    if (adminThrows) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set: admin client unavailable');
    return adminClient;
  },
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

afterEach(() => {
  vi.clearAllMocks();
  adminThrows = false;
  clearPlayerDashboardCache();
  clearPlayerXgHistoryCache();
});

const MCDAVID = 8478402;

const XG_SEASON_ROW = {
  season: 2025,
  game_type: 'regular',
  player_id: MCDAVID,
  shots: 425,
  sog: 244,
  goals: 48,
  xg: 40.47,
  finishing: 7.53,
  shots_ev: 310,
  shots_pp: 105,
  shots_pk: 10,
  goals_ev: 33,
  goals_pp: 14,
  goals_sh: 1,
  xg_ev: 27.9,
  xg_pp: 11.6,
  xg_pk: 0.97,
  goals_en: 3,
  xg_en: 1.8,
  avg_dist: 26.1,
  avg_xg_per_shot: 0.0952,
  rebounds_shot: 33,
  rush_shots: 70,
  updated_at: '2026-09-01T06:00:00.000Z',
};

const SHOT_ROW = {
  game_id: 2025020001,
  event_id: 501,
  game_date: '2025-10-08',
  x_norm: '73.0',
  y_norm: '-4.0',
  x_adj: 74.2,
  y_adj: -3.5,
  distance: '17.4',
  angle: '11.9',
  distance_adj: 15.3,
  angle_adj: 13.2,
  xg_sql: 0.2841,
  is_goal: true,
  shot_type: 'wrist',
  event_type: 'goal',
  is_rush: true,
  is_rebound: false,
  is_power_play: false,
  is_shorthanded: false,
  is_empty_net: false,
  strength_state: '5v5',
  created_at: '2026-09-01T04:12:00.000Z',
};

const IDENTITY_ROW = {
  player_id: MCDAVID,
  full_name: 'Connor McDavid',
  position_code: 'C',
  team_abbrev: 'EDM',
  jersey_number: '97',
  headshot_url: 'https://assets.nhle.com/mugs/nhl/20252026/EDM/8478402.png',
};

/** Wire up both clients; returns the user-client mock for call assertions. */
async function wire() {
  const { createUserClient } = await import('../lib/supabase');
  const user = createMockSupabase();
  user.from = vi.fn((table: string) => {
    if (table === 'player_xg_season') return createChain({ data: [XG_SEASON_ROW], error: null });
    if (table === 'player_directory') return createChain({ data: [IDENTITY_ROW], error: null });
    return createChain({ data: [], error: null });
  });
  (createUserClient as any).mockReturnValue(user);
  adminFrom.mockImplementation(() => createChain({ data: [SHOT_ROW], error: null }));
  return user;
}

function get(app: any, path: string) {
  return app.request(path);
}

describe('GET /api/players/:playerId/dashboard', () => {
  it('returns the whole dashboard payload in one response', async () => {
    const user = await wire();
    const { app } = await import('../app');

    const res = await get(app, `/api/players/${MCDAVID}/dashboard?season=2025&gameType=regular`);
    expect(res.status).toBe(200);

    const body = await res.json();
    const payload = body.data;
    expect(payload.player_id).toBe(MCDAVID);
    expect(payload.season).toBe(2025);
    expect(payload.game_type).toBe('regular');
    expect(payload.player.name).toBe('Connor McDavid');
    expect(payload.shots).toHaveLength(1);
    expect(payload.shots[0].xg).toBeCloseTo(0.2841);
    expect(payload.shots_available).toBe(true);
    expect(payload.shots_truncated).toBe(false);
    expect(payload.seasons).toHaveLength(1);
    expect(payload.seasons[0].finishing).toBeCloseTo(7.53);
    expect(payload.as_of).toBe('2026-09-01T06:00:00.000Z');
    expect(user.from).toHaveBeenCalledWith('player_xg_season');
  });

  it('defaults season and gameType when the query omits them', async () => {
    await wire();
    const { app } = await import('../app');

    const res = await get(app, `/api/players/${MCDAVID}/dashboard`);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.game_type).toBe('regular');
    expect(typeof data.season).toBe('number');
  });

  it('serves the playoff slice when asked for it', async () => {
    await wire();
    const { app } = await import('../app');

    const res = await get(app, `/api/players/${MCDAVID}/dashboard?season=2025&gameType=playoff`);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.game_type).toBe('playoff');
  });

  it('reads nhl_shots on the service-role client and nothing else on it', async () => {
    const user = await wire();
    const { app } = await import('../app');

    await get(app, `/api/players/${MCDAVID}/dashboard?season=2025`);

    expect(adminFrom.mock.calls.map((c) => c[0])).toEqual(['nhl_shots']);
    // The caller's RLS-scoped client must never be pointed at a table that
    // is deny-all to end-user roles — it would simply error.
    expect(user.from.mock.calls.map((c: unknown[]) => c[0])).not.toContain('nhl_shots');
    // ...and the tables that DO have authenticated read policies stay on it.
    expect(user.from.mock.calls.map((c: unknown[]) => c[0])).toEqual(
      expect.arrayContaining([
        'player_xg_season',
        'goalie_gsax_primary',
        'player_talent_metrics',
        'player_directory',
      ]),
    );
  });

  it('degrades to shots_available:false when the service role key is missing', async () => {
    await wire();
    adminThrows = true;
    const { app } = await import('../app');

    const res = await get(app, `/api/players/${MCDAVID}/dashboard?season=2025`);
    // 200, not 500: four of the five reads are fine and the page renders.
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.shots_available).toBe(false);
    expect(data.shots).toEqual([]);
    expect(data.seasons).toHaveLength(1);
    expect(adminFrom).not.toHaveBeenCalled();
  });

  it('a shot-read failure is still a 200 with the rest of the page', async () => {
    const user = await wire();
    adminFrom.mockImplementation(() =>
      createChain({ data: null, error: { message: 'permission denied for table nhl_shots' } }),
    );
    const { app } = await import('../app');

    const res = await get(app, `/api/players/${MCDAVID}/dashboard?season=2025`);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.shots_available).toBe(false);
    expect(data.seasons).toHaveLength(1);
    expect(user.from).toHaveBeenCalledWith('player_xg_season');
  });

  it('surfaces a career-arc failure as an error status', async () => {
    const { createUserClient } = await import('../lib/supabase');
    const user = createMockSupabase();
    user.from = vi.fn((table: string) => {
      if (table === 'player_xg_season') {
        return createChain({ data: null, error: { message: 'permission denied' } });
      }
      return createChain({ data: [], error: null });
    });
    (createUserClient as any).mockReturnValue(user);
    adminFrom.mockImplementation(() => createChain({ data: [], error: null }));

    const { app } = await import('../app');
    const res = await get(app, `/api/players/${MCDAVID}/dashboard?season=2025`);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  // ── Validation: nothing unvalidated reaches a query ───────────────────

  it.each([
    ['abc', 'letters'],
    ['1e9', 'exponent notation'],
    ['-1', 'a negative'],
    ['8478402.5', 'a decimal'],
    ['1234567890123', 'an oversized id'],
  ])('400s on a junk playerId %j (%s) without touching the database', async (raw) => {
    const user = await wire();
    const { app } = await import('../app');

    const res = await get(app, `/api/players/${encodeURIComponent(raw)}/dashboard`);
    expect(res.status).toBe(400);
    expect(user.from).not.toHaveBeenCalled();
    expect(adminFrom).not.toHaveBeenCalled();
  });

  it.each([['1999'], ['2099'], ['20255'], ['nope']])(
    '400s on an out-of-range or malformed season %j',
    async (raw) => {
      const user = await wire();
      const { app } = await import('../app');

      const res = await get(app, `/api/players/${MCDAVID}/dashboard?season=${raw}`);
      expect(res.status).toBe(400);
      expect(user.from).not.toHaveBeenCalled();
    },
  );

  it('400s on a gameType that is not regular or playoff', async () => {
    const user = await wire();
    const { app } = await import('../app');

    const res = await get(app, `/api/players/${MCDAVID}/dashboard?gameType=preseason`);
    expect(res.status).toBe(400);
    expect(user.from).not.toHaveBeenCalled();
  });

  // The literal route registered above `/:playerId` must not have eaten
  // the browse index — Hono matches in registration order, and
  // `/dashboard-index` is one segment while this route is two.
  it('does not shadow GET /api/players/dashboard-index', async () => {
    const { createUserClient } = await import('../lib/supabase');
    const user = createMockSupabase();
    user.from = vi.fn(() => createChain({ data: [], error: null }));
    (createUserClient as any).mockReturnValue(user);

    const { app } = await import('../app');
    const res = await get(app, '/api/players/dashboard-index');
    expect(res.status).toBe(200);
    expect(user.from).toHaveBeenCalledWith('player_directory');
  });
});

// ═════════════════════════════════════════════════════════════════════
// GET /api/players/:playerId/xg-history (2026-09-03). The career arc on
// its own, for the condensed card's sparkline: the same `player_xg_season`
// read the dashboard makes, merged per season, and NOTHING on the
// service-role client. Two things are pinned here:
//
//  1. The same validator gates it, so the same junk ids 400 before a query.
//  2. The admin client is never constructed, let alone used: this route
//     takes the caller's RLS-scoped client and nothing else.

describe('GET /api/players/:playerId/xg-history', () => {
  const TRADED_ROWS = [
    { ...XG_SEASON_ROW, season: 2024, team_id: 22, shots: 150, sog: 90, goals: 12, xg: 14.25 },
    { ...XG_SEASON_ROW, season: 2024, team_id: 10, shots: 140, sog: 85, goals: 11, xg: 12.5 },
    { ...XG_SEASON_ROW, season: 2025, team_id: 22 },
  ];

  it('returns the merged arc in one response', async () => {
    const { createUserClient } = await import('../lib/supabase');
    const user = createMockSupabase();
    user.from = vi.fn((table: string) => {
      if (table === 'player_xg_season') return createChain({ data: TRADED_ROWS, error: null });
      return createChain({ data: [], error: null });
    });
    (createUserClient as any).mockReturnValue(user);
    const { app } = await import('../app');

    const res = await get(app, `/api/players/${MCDAVID}/xg-history`);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.player_id).toBe(MCDAVID);
    // Two 2024 team rows became one point; the wire says so.
    expect(data.points.map((p: { season: number }) => p.season)).toEqual([2024, 2025]);
    expect(data.points[0].teams).toBe(2);
    expect(data.points[0].xg).toBeCloseTo(26.75);
    expect(data.points[1].teams).toBe(1);
    expect(data.as_of).toBe('2026-09-01T06:00:00.000Z');
    expect(user.from.mock.calls.map((c: unknown[]) => c[0])).toEqual(['player_xg_season']);
  });

  it('never reaches for the service-role client', async () => {
    await wire();
    const { app } = await import('../app');
    const res = await get(app, `/api/players/${MCDAVID}/xg-history`);
    expect(res.status).toBe(200);
    expect(adminFrom).not.toHaveBeenCalled();
  });

  it('is a 200 with an empty arc for a player with no seasons on record', async () => {
    const { createUserClient } = await import('../lib/supabase');
    const user = createMockSupabase();
    user.from = vi.fn(() => createChain({ data: [], error: null }));
    (createUserClient as any).mockReturnValue(user);
    const { app } = await import('../app');

    const res = await get(app, `/api/players/${MCDAVID}/xg-history`);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.points).toEqual([]);
    expect(data.as_of).toBeNull();
  });

  it.each([
    ['abc', 'letters'],
    ['1e9', 'exponent notation'],
    ['-1', 'a negative'],
    ['8478402.5', 'a decimal'],
    ['1234567890123', 'an oversized id'],
  ])('400s on a junk playerId %j (%s) without touching the database', async (raw) => {
    const user = await wire();
    const { app } = await import('../app');

    const res = await get(app, `/api/players/${encodeURIComponent(raw)}/xg-history`);
    expect(res.status).toBe(400);
    expect(user.from).not.toHaveBeenCalled();
    expect(adminFrom).not.toHaveBeenCalled();
  });

  it('surfaces a read failure as an error status', async () => {
    const { createUserClient } = await import('../lib/supabase');
    const user = createMockSupabase();
    user.from = vi.fn(() => createChain({ data: null, error: { message: 'permission denied' } }));
    (createUserClient as any).mockReturnValue(user);
    const { app } = await import('../app');

    const res = await get(app, `/api/players/${MCDAVID}/xg-history`);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
