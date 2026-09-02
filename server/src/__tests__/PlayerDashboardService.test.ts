// PlayerDashboardService — merge/read-model tests for the /players
// section index (2026-08-18). Mirrors the PlayerService test pattern:
// mock the Supabase chain per-table, assert the merged wire shape.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PlayerDashboardService,
  clearDashboardIndexCache,
  clearPlayerDashboardCache,
  parsePlayerDashboardRequest,
  MIN_DASHBOARD_SEASON,
  SHOT_CAP,
} from '../services/PlayerDashboardService';
import { createChain, createMockSupabase } from './helpers';

const DIR = [
  {
    player_id: 8479318,
    full_name: 'Auston Matthews',
    position_code: 'C',
    team_abbrev: 'TOR',
    jersey_number: '34',
    headshot_url: 'https://assets.nhle.com/mugs/nhl/20252026/TOR/8479318.png',
    eligible_positions: ['C'],
  },
  {
    player_id: 8479361,
    full_name: 'Joseph Woll',
    position_code: 'G',
    team_abbrev: 'TOR',
    jersey_number: '60',
    headshot_url: null,
    eligible_positions: ['G'],
  },
];
const STATS = [
  {
    player_id: 8479318,
    games_played: 60,
    nhl_goals: 27,
    nhl_assists: 26,
    nhl_points: 53,
    nhl_shots_on_goal: 227,
    nhl_hits: 42,
    nhl_blocks: 81,
    nhl_pim: 18,
    nhl_ppp: 12,
    nhl_plus_minus: -4,
    nhl_toi_seconds: 74894,
    x_goals: 29.49,
    goalie_gp: 0,
    nhl_wins: 0,
    nhl_saves: 0,
    nhl_save_pct: 0,
    nhl_gaa: 0,
    nhl_shutouts: 0,
    nhl_goals_against: 0,
  },
  {
    player_id: 8479361,
    games_played: 0,
    nhl_goals: 0,
    nhl_assists: 0,
    nhl_points: 0,
    nhl_shots_on_goal: 0,
    nhl_hits: 0,
    nhl_blocks: 0,
    nhl_pim: 2,
    nhl_ppp: 0,
    nhl_plus_minus: 0,
    nhl_toi_seconds: 133804,
    x_goals: 0,
    goalie_gp: 60,
    nhl_wins: 15,
    nhl_saves: 1097,
    nhl_save_pct: 0.899,
    nhl_gaa: 2.9,
    nhl_shutouts: 2,
    nhl_goals_against: 124,
  },
];
const GAR = [
  {
    player_id: 8479318,
    evo_gar_per_60: 0.41,
    evd_gar_per_60: 0,
    ppo_gar_per_60: 0.085,
    ppd_gar_per_60: 0,
    penalty_gar_per_60: 0,
    total_gar_per_60: 0.497,
    toi_total_minutes: 434.7,
  },
];
const TALENT = [
  { player_id: 8479318, xg_per_60: 1.42, xg_rating: 'Elite', roster_status: null },
];
const ROS = [
  {
    player_id: 8479318,
    games_remaining: 63,
    total_projected_points: 337.44,
    avg_points_per_game: 5.36,
    projected_goals: 32.9,
    projected_assists: 31.55,
    projected_sog: 245.23,
    projected_ppp: 17.81,
    projected_hits: 49.02,
    projected_blocks: 78.87,
    projected_wins_ros: 0,
    projected_saves_ros: 0,
    projected_shutouts_ros: 0,
  },
];

function mockTables(supabase: any, overrides: Record<string, { data: unknown; error: unknown }> = {}) {
  supabase.from = vi.fn((table: string) => {
    if (overrides[table]) return createChain(overrides[table]);
    if (table === 'player_directory') return createChain({ data: DIR, error: null });
    if (table === 'player_season_stats') return createChain({ data: STATS, error: null });
    if (table === 'player_gar_components') return createChain({ data: GAR, error: null });
    if (table === 'player_talent_metrics') return createChain({ data: TALENT, error: null });
    if (table === 'player_ros_projections') return createChain({ data: ROS, error: null });
    return createChain({ data: [], error: null });
  });
}

describe('PlayerDashboardService.getDashboardIndex', () => {
  let service: PlayerDashboardService;
  let mockSupabase: any;

  beforeEach(() => {
    clearDashboardIndexCache();
    mockSupabase = createMockSupabase();
    service = new PlayerDashboardService(mockSupabase);
  });

  it('merges all five tables into one entry per directory player', async () => {
    mockTables(mockSupabase);
    const { players, error } = await service.getDashboardIndex();
    expect(error).toBeNull();
    expect(players).toHaveLength(2);

    const am = players.find((p) => p.id === 8479318)!;
    expect(am.name).toBe('Auston Matthews');
    expect(am.is_goalie).toBe(false);
    expect(am.gp).toBe(60); // skater gp = games_played
    expect(am.points).toBe(53);
    expect(am.gar_per_60).toBeCloseTo(0.497);
    expect(am.gar_ppo).toBeCloseTo(0.085);
    expect(am.xg_per_60).toBeCloseTo(1.42);
    expect(am.xg_rating).toBe('Elite');
    expect(am.proj_fantasy_points).toBeCloseTo(337.44);
    expect(am.proj_gp).toBe(63);
  });

  it('goalies read gp from goalie_gp and carry goalie stat columns', async () => {
    mockTables(mockSupabase);
    const { players } = await service.getDashboardIndex();
    const woll = players.find((p) => p.id === 8479361)!;
    expect(woll.is_goalie).toBe(true);
    expect(woll.gp).toBe(60); // goalie gp = goalie_gp, NOT skater games_played (0)
    expect(woll.wins).toBe(15);
    expect(woll.save_pct).toBeCloseTo(0.899);
  });

  it('players missing metric rows get nulls, not fabricated zeros', async () => {
    mockTables(mockSupabase);
    const { players } = await service.getDashboardIndex();
    const woll = players.find((p) => p.id === 8479361)!;
    // Woll has no GAR / talent / ROS rows in the fixtures.
    expect(woll.gar_per_60).toBeNull();
    expect(woll.xg_per_60).toBeNull();
    expect(woll.proj_fantasy_points).toBeNull();
  });

  it('caches: a second call issues no new queries', async () => {
    mockTables(mockSupabase);
    await service.getDashboardIndex();
    const calls1 = mockSupabase.from.mock.calls.length;
    await service.getDashboardIndex();
    expect(mockSupabase.from.mock.calls.length).toBe(calls1);
  });

  it('propagates the first table error and returns an empty list', async () => {
    mockTables(mockSupabase, {
      player_gar_components: { data: null, error: { message: 'permission denied' } },
    });
    const { players, error } = await service.getDashboardIndex();
    expect(players).toHaveLength(0);
    expect(error?.message).toContain('permission denied');
  });

  // REGRESSION (2026-08-18 launch audit): the first cut of this service
  // issued one unbounded .select() per table. PostgREST silently clamps
  // those to the project max-rows (~1000 here) and returns 200 with a
  // truncated body — no error. player_directory is ~1.9k rows in prod,
  // so the Players page would have shipped showing roughly half the
  // league, with missing stars looking like they simply don't exist.
  // This is the same trap already documented in usePreloadedPlayers.ts.
  it('pages past the PostgREST row clamp instead of silently truncating', async () => {
    const PAGE = 1000;
    // 1500 directory rows across two pages; page 2 is short => stop.
    const mkDir = (i: number) => ({
      player_id: 900000 + i,
      full_name: `Player ${i}`,
      position_code: 'C',
      team_abbrev: 'TOR',
      jersey_number: null,
      headshot_url: null,
      eligible_positions: ['C'],
    });
    const dirPages = [
      Array.from({ length: PAGE }, (_, i) => mkDir(i)),
      Array.from({ length: 500 }, (_, i) => mkDir(PAGE + i)),
    ];

    let dirCall = 0;
    const rangeCalls: Array<[number, number]> = [];
    const pagedDirChain: Record<string, any> = {};
    for (const m of ['select', 'eq', 'order']) pagedDirChain[m] = vi.fn(() => pagedDirChain);
    pagedDirChain.range = vi.fn((from: number, to: number) => {
      rangeCalls.push([from, to]);
      return pagedDirChain;
    });
    pagedDirChain.then = (resolve: any, reject: any) =>
      Promise.resolve({ data: dirPages[dirCall++] ?? [], error: null }).then(resolve, reject);

    mockSupabase.from = vi.fn((table: string) => {
      if (table === 'player_directory') return pagedDirChain;
      if (table === 'player_season_stats') return createChain({ data: STATS, error: null });
      if (table === 'player_gar_components') return createChain({ data: GAR, error: null });
      if (table === 'player_talent_metrics') return createChain({ data: TALENT, error: null });
      if (table === 'player_ros_projections') return createChain({ data: ROS, error: null });
      return createChain({ data: [], error: null });
    });

    const { players, error } = await service.getDashboardIndex();
    expect(error).toBeNull();
    // 1500, not 1000 — the whole point.
    expect(players).toHaveLength(1500);
    expect(rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    // Ordering is explicit, or the two windows could overlap/skip rows.
    expect(pagedDirChain.order).toHaveBeenCalledWith('player_id', { ascending: true });
  });
});

// ═════════════════════════════════════════════════════════════════════
// COMPONENT 6.5 — the per-player dashboard endpoint's read model.
//
// The fixtures below are shaped after the real rows, including the two
// traps this service exists to survive:
//
//   * PostgREST returns `numeric` columns as STRINGS and `double
//     precision` as numbers, and `nhl_shots` mixes them in the same row
//     (`distance` numeric, `distance_adj` double). A UI calling
//     `.toFixed()` on "37.2" throws.
//   * `nhl_shots` is deny-all to end-user roles, so the shot read runs on
//     a DIFFERENT client. If the two get crossed, either the shot map is
//     silently empty or a service-role client is being used where the
//     caller's RLS should apply. Both are asserted here.

const MCDAVID = 8478402;

/** Two shots: one from the slot that went in, one point shot that did not. */
const SHOTS = [
  {
    game_id: 2025020001,
    event_id: 501,
    game_date: '2025-10-08',
    // `numeric` columns arrive as strings; `double precision` as numbers.
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
  },
  {
    game_id: 2025020001,
    event_id: 774,
    game_date: '2025-10-08',
    x_norm: '31.0',
    y_norm: '18.0',
    // The adjusted pair is missing on this row — the normalised pair is
    // the documented fallback, and it must actually be used.
    x_adj: null,
    y_adj: null,
    distance: '61.3',
    angle: '17.1',
    distance_adj: null,
    angle_adj: null,
    xg_sql: 0.0184,
    is_goal: false,
    shot_type: 'slap',
    event_type: 'shot-on-goal',
    is_rush: false,
    is_rebound: null,
    is_power_play: true,
    is_shorthanded: null,
    is_empty_net: null,
    strength_state: '5v4',
    created_at: '2026-08-30T04:10:00.000Z',
  },
];

const XG_SEASONS = [
  {
    season: 2024,
    game_type: 'regular',
    player_id: MCDAVID,
    shots: 411,
    sog: 231,
    goals: 33,
    xg: 38.12,
    finishing: -5.12,
    shots_ev: 300,
    shots_pp: 100,
    shots_pk: 11,
    goals_ev: 22,
    goals_pp: 10,
    goals_sh: 1,
    xg_ev: 26.1,
    xg_pp: 11.02,
    xg_pk: 1.0,
    goals_en: 2,
    xg_en: 1.4,
    avg_dist: 27.4,
    avg_xg_per_shot: 0.0927,
    rebounds_shot: 30,
    rush_shots: 61,
    updated_at: '2026-08-20T06:00:00.000Z',
  },
  {
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
  },
];

const GSAX = [
  {
    goalie_id: 8479361,
    season: 2025,
    total_shots_faced: 1421,
    // numeric → string on the wire.
    total_xga: '108.4',
    total_ga: 116,
    raw_gsax: '-7.6',
    regressed_gsax: '-4.1',
    league_sv_pct: '0.9033',
    updated_at: '2026-08-29T06:00:00.000Z',
  },
];

const TALENT_DETAIL = [
  {
    player_id: MCDAVID,
    xg_per_60: '1.42',
    xg_rating: 'Elite',
    vopa_score: '3.114',
    avg_toi_per_game: '21.60',
    positional_replacement_level: '0.410',
    positional_std_dev: '0.220',
    updated_at: '2026-09-02T06:00:00.000Z',
  },
];

const IDENTITY = [
  {
    player_id: MCDAVID,
    full_name: 'Connor McDavid',
    position_code: 'C',
    team_abbrev: 'EDM',
    jersey_number: '97',
    headshot_url: 'https://assets.nhle.com/mugs/nhl/20252026/EDM/8478402.png',
  },
];

/**
 * The caller's RLS-scoped client. `nhl_shots` deliberately answers with
 * the error PostgREST returns when the grant is revoked, so a test that
 * accidentally reads shots through this client fails loudly.
 */
function userClient(overrides: Record<string, { data: unknown; error: unknown }> = {}) {
  const mock = createMockSupabase();
  mock.from = vi.fn((table: string) => {
    if (overrides[table]) return createChain(overrides[table]);
    if (table === 'player_xg_season') return createChain({ data: XG_SEASONS, error: null });
    if (table === 'goalie_gsax_primary') return createChain({ data: [], error: null });
    if (table === 'player_talent_metrics') return createChain({ data: TALENT_DETAIL, error: null });
    if (table === 'player_directory') return createChain({ data: IDENTITY, error: null });
    if (table === 'nhl_shots') {
      return createChain({
        data: null,
        error: { message: 'permission denied for table nhl_shots' },
      });
    }
    return createChain({ data: [], error: null });
  });
  return mock;
}

/** The service-role client. Only ever asked for `nhl_shots`. */
function elevatedClient(rows: unknown[] = SHOTS, error: unknown = null) {
  const mock = createMockSupabase();
  mock.from = vi.fn(() => createChain({ data: error ? null : rows, error }));
  return mock;
}

const REQ = { playerId: MCDAVID, season: 2025, gameType: 'regular' as const };

describe('parsePlayerDashboardRequest', () => {
  it('accepts a bare player id and defaults season + gameType', () => {
    const { value, message } = parsePlayerDashboardRequest('8478402', undefined, undefined, 2025);
    expect(message).toBeNull();
    expect(value).toEqual({ playerId: 8478402, season: 2025, gameType: 'regular' });
  });

  it('accepts an explicit in-range season and playoff game type', () => {
    const { value } = parsePlayerDashboardRequest('8478402', '2019', 'playoff', 2025);
    expect(value).toEqual({ playerId: 8478402, season: 2019, gameType: 'playoff' });
  });

  // A validator that accepts a PREFIX is not a validator: parseInt('1e9')
  // is 1 and parseInt('8478402 or 1=1') is 8478402. Nothing here reaches a
  // query until it is a clean run of digits.
  it.each([
    ['', 'empty'],
    ['abc', 'letters'],
    ['1e9', 'exponent notation'],
    ['8478402 or 1=1', 'a trailing payload'],
    ['-8478402', 'a negative'],
    ['8478402.0', 'a decimal'],
    ['1234567890', 'too many digits'],
  ])('rejects playerId %j (%s)', (raw) => {
    const { value, message } = parsePlayerDashboardRequest(raw, undefined, undefined, 2025);
    expect(value).toBeNull();
    expect(message).toMatch(/playerId/);
  });

  it.each([['20255'], ['abcd'], ['25']])('rejects a malformed season %j', (raw) => {
    const { value, message } = parsePlayerDashboardRequest('8478402', raw, undefined, 2025);
    expect(value).toBeNull();
    expect(message).toMatch(/season/);
  });

  it('bounds season to the seasons the shot table actually holds', () => {
    expect(parsePlayerDashboardRequest('8478402', '2016', undefined, 2025).value).toBeNull();
    expect(parsePlayerDashboardRequest('8478402', '2099', undefined, 2025).value).toBeNull();
    expect(
      parsePlayerDashboardRequest('8478402', String(MIN_DASHBOARD_SEASON), undefined, 2025).value,
    ).not.toBeNull();
  });

  it('rejects any gameType that is not regular or playoff', () => {
    const { value, message } = parsePlayerDashboardRequest('8478402', undefined, 'preseason', 2025);
    expect(value).toBeNull();
    expect(message).toMatch(/gameType/);
  });
});

describe('PlayerDashboardService.getPlayerDashboard', () => {
  beforeEach(() => {
    clearPlayerDashboardCache();
  });

  it('returns shots, the career arc, talent and identity in one payload', async () => {
    const user = userClient();
    const admin = elevatedClient();
    const svc = new PlayerDashboardService(user, admin);

    const { payload, error } = await svc.getPlayerDashboard(REQ);
    expect(error).toBeNull();
    expect(payload!.player_id).toBe(MCDAVID);
    expect(payload!.season).toBe(2025);
    expect(payload!.game_type).toBe('regular');
    expect(payload!.shots_available).toBe(true);
    expect(payload!.shots).toHaveLength(2);
    expect(payload!.shots_truncated).toBe(false);
    expect(payload!.shots_cap).toBe(SHOT_CAP);
    // ALL seasons, not just the requested one — this is the career arc.
    expect(payload!.seasons.map((s) => s.season)).toEqual([2024, 2025]);
    expect(payload!.seasons[1].finishing).toBeCloseTo(7.53);
    expect(payload!.talent!.vopa_score).toBeCloseTo(3.114);
    expect(payload!.talent!.avg_toi_per_game).toBeCloseTo(21.6);
    expect(payload!.player!.name).toBe('Connor McDavid');
    expect(payload!.player!.jersey).toBe(97);
    expect(payload!.player!.is_goalie).toBe(false);
  });

  it('prefers the adjusted coordinate pair and falls back to the normalised one', async () => {
    const svc = new PlayerDashboardService(userClient(), elevatedClient());
    const { payload } = await svc.getPlayerDashboard(REQ);

    // Row 1 carries x_adj/y_adj — the model's own mirrored frame.
    expect(payload!.shots[0].x).toBeCloseTo(74.2);
    expect(payload!.shots[0].y).toBeCloseTo(-3.5);
    expect(payload!.shots[0].distance).toBeCloseTo(15.3);
    // Row 2 has neither, so x_norm/y_norm stand in — and they arrived as
    // STRINGS, which is the whole reason `num()` exists.
    expect(payload!.shots[1].x).toBe(31);
    expect(payload!.shots[1].y).toBe(18);
    expect(payload!.shots[1].distance).toBeCloseTo(61.3);
    expect(typeof payload!.shots[1].x).toBe('number');
  });

  it('normalises nullable booleans instead of shipping null to the UI', async () => {
    const svc = new PlayerDashboardService(userClient(), elevatedClient());
    const { payload } = await svc.getPlayerDashboard(REQ);
    expect(payload!.shots[1].is_rebound).toBe(false);
    expect(payload!.shots[1].is_shorthanded).toBe(false);
    expect(payload!.shots[1].is_power_play).toBe(true);
    expect(payload!.shots[0].is_goal).toBe(true);
  });

  it('reads nhl_shots through the SERVICE-ROLE client, never the caller’s', async () => {
    const user = userClient();
    const admin = elevatedClient();
    await new PlayerDashboardService(user, admin).getPlayerDashboard(REQ);

    // The one table the elevated client is allowed to touch.
    expect(admin.from.mock.calls.map((c: unknown[]) => c[0])).toEqual(['nhl_shots']);
    // ...and the caller's client never asks for it, because it would be
    // refused (RLS on, no policy, SELECT revoked).
    expect(user.from.mock.calls.map((c: unknown[]) => c[0])).not.toContain('nhl_shots');
  });

  it('scopes the shot read to shooter/season/gameType and pages it by the primary key', async () => {
    const chain = createChain({ data: SHOTS, error: null });
    const admin = createMockSupabase();
    admin.from = vi.fn(() => chain);

    await new PlayerDashboardService(userClient(), admin).getPlayerDashboard(REQ);

    expect(chain.eq).toHaveBeenCalledWith('shooter_id', MCDAVID);
    expect(chain.eq).toHaveBeenCalledWith('season', 2025);
    expect(chain.eq).toHaveBeenCalledWith('game_type', 'regular');
    // nhl_shots_pkey is (game_id, event_id). Ordering by game_date alone
    // is NOT unique for one player, and a non-unique sort across
    // LIMIT/OFFSET windows duplicates and skips rows.
    expect(chain.order).toHaveBeenCalledWith('game_id', { ascending: true });
    expect(chain.order).toHaveBeenCalledWith('event_id', { ascending: true });
    expect(chain.range).toHaveBeenCalledWith(0, 999);
  });

  it('caps the shot list and SAYS SO rather than clipping silently', async () => {
    const mkShot = (i: number) => ({ ...SHOTS[0], game_id: 2025020000 + i, event_id: i });
    const pages = [
      Array.from({ length: 1000 }, (_, i) => mkShot(i)),
      Array.from({ length: 300 }, (_, i) => mkShot(1000 + i)),
    ];
    let call = 0;
    const chain: Record<string, any> = {};
    for (const m of ['select', 'eq', 'order']) chain[m] = vi.fn(() => chain);
    chain.range = vi.fn(() => chain);
    chain.then = (resolve: any, reject: any) =>
      Promise.resolve({ data: pages[call++] ?? [], error: null }).then(resolve, reject);

    const admin = createMockSupabase();
    admin.from = vi.fn(() => chain);

    const { payload } = await new PlayerDashboardService(userClient(), admin).getPlayerDashboard(REQ);
    expect(payload!.shots).toHaveLength(SHOT_CAP);
    expect(payload!.shots_truncated).toBe(true);
    expect(payload!.shots_available).toBe(true);
  });

  it('degrades to shots_available:false when no service-role client is supplied', async () => {
    const user = userClient();
    const { payload, error } = await new PlayerDashboardService(user).getPlayerDashboard(REQ);

    expect(error).toBeNull();
    expect(payload!.shots_available).toBe(false);
    expect(payload!.shots).toEqual([]);
    // The rest of the page is still true and still renders.
    expect(payload!.seasons).toHaveLength(2);
    expect(payload!.talent).not.toBeNull();
    expect(user.from.mock.calls.map((c: unknown[]) => c[0])).not.toContain('nhl_shots');
  });

  it('a failed shot read is NOT an endpoint failure', async () => {
    const admin = elevatedClient([], { message: 'permission denied for table nhl_shots' });
    const { payload, error } = await new PlayerDashboardService(
      userClient(),
      admin,
    ).getPlayerDashboard(REQ);

    expect(error).toBeNull();
    expect(payload!.shots_available).toBe(false);
    expect(payload!.shots).toEqual([]);
    expect(payload!.seasons).toHaveLength(2);
  });

  // The career arc IS the page below the hero. Without it there is nothing
  // to render, so that one read is allowed to fail the request.
  it('propagates a career-arc failure as an error', async () => {
    const user = userClient({
      player_xg_season: { data: null, error: { message: 'permission denied' } },
    });
    const { payload, error } = await new PlayerDashboardService(
      user,
      elevatedClient(),
    ).getPlayerDashboard(REQ);

    expect(payload).toBeNull();
    expect(error?.message).toContain('permission denied');
  });

  it('maps GSAx for a goalie and leaves it null for a skater', async () => {
    const skater = await new PlayerDashboardService(
      userClient(),
      elevatedClient(),
    ).getPlayerDashboard(REQ);
    expect(skater.payload!.gsax).toBeNull();

    clearPlayerDashboardCache();
    const goalieUser = userClient({ goalie_gsax_primary: { data: GSAX, error: null } });
    const goalie = await new PlayerDashboardService(goalieUser, elevatedClient()).getPlayerDashboard({
      ...REQ,
      playerId: 8479361,
    });
    expect(goalie.payload!.gsax).toEqual({
      season: 2025,
      shots_faced: 1421,
      xga: 108.4,
      ga: 116,
      raw_gsax: -7.6,
      regressed_gsax: -4.1,
      league_sv_pct: 0.9033,
    });
  });

  // A player with a directory row and no shots is a real, common state
  // (a call-up, a season a player missed). It must be "zero shots", not
  // "the shot map is broken" — the UI renders different things for those.
  it('an empty shot list still reports the map as available', async () => {
    const { payload } = await new PlayerDashboardService(
      userClient(),
      elevatedClient([]),
    ).getPlayerDashboard(REQ);
    expect(payload!.shots).toEqual([]);
    expect(payload!.shots_available).toBe(true);
  });

  it('as_of is the newest REAL timestamp read, across all four sources', async () => {
    const { payload } = await new PlayerDashboardService(
      userClient(),
      elevatedClient(),
    ).getPlayerDashboard(REQ);
    // player_talent_metrics 2026-09-02 beats player_xg_season 2026-09-01
    // and the newest nhl_shots.created_at 2026-09-01T04:12.
    expect(payload!.as_of).toBe('2026-09-02T06:00:00.000Z');
  });

  // Null is the honest answer when nothing carries a stamp, and the UI
  // contract is that null HIDES StaleDataBadge. A synthesised "now" here
  // would make the badge print a freshness claim we cannot support.
  it('as_of is null when nothing read carried a timestamp', async () => {
    const stripped = XG_SEASONS.map(({ updated_at: _drop, ...rest }) => rest);
    const user = userClient({
      player_xg_season: { data: stripped, error: null },
      player_talent_metrics: { data: [], error: null },
    });
    const { payload } = await new PlayerDashboardService(user, elevatedClient([])).getPlayerDashboard(
      REQ,
    );
    expect(payload!.as_of).toBeNull();
  });

  it('caches per player+season+gameType, and a different key is a fresh read', async () => {
    const user = userClient();
    const admin = elevatedClient();
    const svc = new PlayerDashboardService(user, admin);

    await svc.getPlayerDashboard(REQ);
    const afterFirst = user.from.mock.calls.length;
    await svc.getPlayerDashboard(REQ);
    expect(user.from.mock.calls.length).toBe(afterFirst);

    // Same player, different game type ⇒ a different key ⇒ real queries.
    await svc.getPlayerDashboard({ ...REQ, gameType: 'playoff' });
    expect(user.from.mock.calls.length).toBeGreaterThan(afterFirst);
  });

  it('clearPlayerDashboardCache forces the next call to re-read', async () => {
    const user = userClient();
    const svc = new PlayerDashboardService(user, elevatedClient());
    await svc.getPlayerDashboard(REQ);
    const afterFirst = user.from.mock.calls.length;
    clearPlayerDashboardCache();
    await svc.getPlayerDashboard(REQ);
    expect(user.from.mock.calls.length).toBeGreaterThan(afterFirst);
  });
});
