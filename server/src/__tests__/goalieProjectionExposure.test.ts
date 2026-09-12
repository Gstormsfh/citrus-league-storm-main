import { describe, expect, it } from 'vitest';
import { addGoalieExposure, withGoalieExposure } from '../services/goalieProjectionExposure';
const schedule = Array.from({ length: 84 }, (_, i) => ({ game_id: i + 1, game_date: '2026-10-01', home_team: 'NYR', away_team: 'BOS' }));
const allocations = [
  { player_id: 1, team_abbrev: 'NYR', games_remaining: 49 },
  { player_id: 2, team_abbrev: 'NYR', games_remaining: 30 },
  { player_id: 3, team_abbrev: 'NYR', games_remaining: 5 },
];
const row = { player_id: 3, game_id: 1, projection_date: '2026-10-01', is_goalie: true, calculation_method: 'v2_rates_age_home_b2b', projected_gp: 1, projected_saves: 28, total_projected_points: 14, starter_confirmed: true };
const apply = (r = row, a = allocations) => withGoalieExposure(r, a, schedule, '2026-09-12');
describe('daily goalie exposure contract', () => {
  it('gives Garand 5/84 probability while preserving conditional rates', () => {
    const actual = apply();
    expect(actual.expected_starts).toBe(5 / 84);
    expect(actual.projection_basis).toBe('conditional_on_start');
    expect(actual.projected_saves).toBe(28);
    expect(actual.total_projected_points).toBe(14);
    expect(actual.projected_gp).toBe(1);
    expect(actual.expected_starts).not.toBe(1); // inferred starter_confirmed is NOT evidence
  });
  it('conserves one start per team game and three across a three-game week', () => {
    const sum = allocations.reduce((n, a) => n + Number(apply({ ...row, player_id: a.player_id }).expected_starts), 0);
    expect(sum).toBeCloseTo(1);
    expect(sum * 3).toBeCloseTo(3);
    expect(Number(apply({ ...row, player_id: 2 }).expected_starts) * 3).toBeGreaterThan(1);
  });
  it('does not apply a second workload probability to Python unconditional rows', () => {
    const actual = apply({ ...row, calculation_method: 'probability_based_volume', projected_gp: 0.3 });
    expect(actual.projection_basis).toBe('unconditional');
    expect(actual.expected_starts).toBe(0.3);
    expect(actual.projected_saves).toBe(28);
  });
  it('marks canonical counts unconditional without scaling again', () => {
    const actual = apply({ ...row, calculation_method: 'canonical_expected_volume_v1', projected_gp: 0.125 });
    expect(actual.projection_basis).toBe('unconditional');
    expect(actual.availability_source).toBe('canonical_crease_share');
    expect(actual.expected_starts).toBe(0.125);
    expect(actual.projected_saves).toBe(28);
  });
  it('retains valid zero allocation', () => {
    expect(apply(row, [{ ...allocations[0], games_remaining: 84 }, { ...allocations[2], games_remaining: 0 }]).expected_starts).toBe(0);
  });
  it('does not normalize only the requested goalie or hide incomplete crease data', () => {
    expect(apply(row, [allocations[2]]).expected_starts).toBeNull();
  });
  it('rejects a game outside his team schedule and historical dates', () => {
    expect(apply({ ...row, game_id: 999 }).expected_starts).toBeNull();
    expect(apply({ ...row, projection_date: '2025-10-01' }).expected_starts).toBeNull();
  });
  it('leaves skaters intact and refuses unknown goalie units', () => {
    const skater = { ...row, is_goalie: false };
    expect(apply(skater)).toBe(skater);
    expect(apply({ ...row, calculation_method: 'unverified' }).projection_basis).toBe('unknown');
  });
});


it('fetches the whole season crease and schedule to enrich a request for only Garand', async () => {
  const tables: string[] = [];
  const supabase = { from(table: string) {
    tables.push(table);
    const chain = { select: () => chain, eq: () => chain, order: () => chain,
      range: async () => ({ data: table === 'nhl_games' ? schedule : allocations, error: null }) };
    return chain;
  } };
  const result = await addGoalieExposure(supabase as never, [{ ...row, season: 2026 }], '2026-09-12');
  expect(tables.sort()).toEqual(['nhl_games', 'player_ros_projections']);
  expect(result[0].expected_starts).toBe(5 / 84);
});

it('preserves existing stats and marks unavailable on evidence query failure', async () => {
  const supabase = { from: () => { throw new Error('network unavailable'); } };
  const result = await addGoalieExposure(supabase as never, [{ ...row, season: 2026 }], '2026-09-12');
  expect(result[0].projected_saves).toBe(28);
  expect(result[0].expected_starts).toBeNull();
  expect(result[0].projection_basis).toBe('unknown');
});
