// PlayerDashboardService — merge/read-model tests for the /players
// section index (2026-08-18). Mirrors the PlayerService test pattern:
// mock the Supabase chain per-table, assert the merged wire shape.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlayerDashboardService, clearDashboardIndexCache } from '../services/PlayerDashboardService';
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
});
