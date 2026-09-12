import type { SupabaseClient } from '@supabase/supabase-js';
import { readAllPaged } from '../lib/pagedRead';

type Row = Record<string, unknown>;
export interface GoalieAllocation { player_id: number; team_abbrev: string | null; games_remaining: number }
export interface ScheduledGame { game_id: number; game_date: string; home_team: string; away_team: string }

/** Add units without mutating conditional category counts used by existing clients. */
export function withGoalieExposure(row: Row, allocations: GoalieAllocation[], schedule: ScheduledGame[], today: string): Row {
  if (row.calculation_method === 'canonical_expected_volume_v1') {
    const p = row.projected_gp == null ? NaN : Number(row.projected_gp);
    return Number.isFinite(p) && p >= 0 && p <= 1
      ? { ...row, projection_basis: 'unconditional', expected_starts: row.is_goalie ? p : null, start_probability: row.is_goalie ? p : null, availability_source: row.is_goalie ? 'canonical_crease_share' : 'canonical_snapshot' }
      : { ...row, projection_basis: 'unknown', expected_starts: null, availability_source: 'unavailable' };
  }
  if (!row.is_goalie) return row;
  const unavailable = { ...row, projection_basis: 'unknown', expected_starts: null, start_probability: null, availability_source: 'unavailable' };
  if (row.calculation_method === 'probability_based_volume') {
    const p = row.projected_gp == null ? NaN : Number(row.projected_gp);
    return Number.isFinite(p) && p >= 0 && p <= 1
      ? { ...row, projection_basis: 'unconditional', expected_starts: p, start_probability: p, availability_source: 'writer_probability' }
      : unavailable;
  }
  if (row.calculation_method !== 'v2_rates_age_home_b2b' || String(row.projection_date) < today) return unavailable;
  const allocation = allocations.find(a => a.player_id === Number(row.player_id));
  if (!allocation?.team_abbrev) return unavailable;
  const remaining = schedule.filter(g => g.game_date >= today && (g.home_team === allocation.team_abbrev || g.away_team === allocation.team_abbrev));
  if (!remaining.some(g => g.game_id === Number(row.game_id)) || remaining.length === 0) return unavailable;
  const starts = Number(allocation.games_remaining);
  // Validate the WHOLE crease rather than normalizing only requested players.
  const teamStarts = allocations.filter(a => a.team_abbrev === allocation.team_abbrev).reduce((n, a) => n + Number(a.games_remaining), 0);
  if (!Number.isFinite(starts) || starts < 0 || starts > remaining.length || Math.abs(teamStarts - remaining.length) > 1e-6) return unavailable;
  const p = starts / remaining.length;
  return { ...row, projection_basis: 'conditional_on_start', expected_starts: p, start_probability: p, availability_source: 'ros_crease_share' };
}

export async function addGoalieExposure(supabase: SupabaseClient, rows: Row[], today = new Date().toISOString().slice(0, 10)): Promise<Row[]> {
  const seasons = [...new Set(rows.filter(r => r.is_goalie && r.calculation_method === 'v2_rates_age_home_b2b').map(r => Number(r.season)))];
  const evidence = new Map<number, { allocations: GoalieAllocation[]; schedule: ScheduledGame[] }>();
  for (const season of seasons) {
    try {
    const [ros, schedule] = await Promise.all([
      readAllPaged<GoalieAllocation>(supabase, { table: 'player_ros_projections', columns: 'player_id,team_abbrev,games_remaining', filters: [['season', season], ['is_goalie', true]], orderBy: ['player_id'] }),
      readAllPaged<ScheduledGame>(supabase, { table: 'nhl_games', columns: 'game_id,game_date,home_team,away_team', filters: [['season', season], ['game_type', 'regular']], orderBy: ['game_id'] }),
    ]);
    if (!ros.error && !schedule.error) evidence.set(season, { allocations: ros.data, schedule: schedule.data });
    } catch {
      // Optional availability evidence must not take down existing daily stats.
      // The explicit unknown/null metadata prevents consumers guessing starts.
    }
  }
  return rows.map(row => {
    const e = evidence.get(Number(row.season));
    return withGoalieExposure(row, e?.allocations ?? [], e?.schedule ?? [], today);
  });
}
