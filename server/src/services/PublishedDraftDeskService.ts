import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getProjectionsSeason, projectionSettings, ScoringCalculator, scoreProjectedStats } from '@citrus/shared';
import { AppError } from '../lib/errors';
import { readAllPaged } from '../lib/pagedRead';

export interface ConnectedKit {
  version: 1; fingerprint: string; revision: string; projectionDate: string; league: string;
  projectionBasis?: 'remaining_season';
  weights: Record<string, Record<string, number>>;
  players: Array<{ key: string; [key: string]: unknown }>;
}

// Adapt the existing ROS vocabulary; no rate, exposure or scoring model here.
const FIELDS = {
  skater: { goals: 'projected_goals', assists: 'projected_assists',
    power_play_points: 'projected_ppp', short_handed_points: 'projected_shp',
    shots_on_goal: 'projected_sog', blocks: 'projected_blocks', hits: 'projected_hits', penalty_minutes: 'projected_pim',
    plus_minus: 'projected_plus_minus' },
  goalie: { wins: 'projected_wins_ros', shutouts: 'projected_shutouts_ros',
    saves: 'projected_saves_ros', goals_against: 'projected_ga_ros' },
} as const;
export const DESK_SUPPORTED_WEIGHTS = Object.fromEntries(Object.entries(FIELDS).map(([group, fields]) =>
  [group, Object.fromEntries(Object.keys(fields).map(stat => [stat, projectionSettings(null)[group][stat]]))]));
const COLUMNS = ['season', 'projection_run_id', 'projection_revision', 'player_id', 'player_name',
  'position', 'team_abbrev', 'is_goalie', 'games_remaining', ...Object.values(FIELDS.skater), ...Object.values(FIELDS.goalie)].join(',');
type Weights = Record<string, Record<string, number>>;
type Row = Record<string, any>;
type Publication = { season: number; run_id: string; revision: string; activated_at: string; last_refresh_status: string | null };
const unavailable = () => AppError.serviceUnavailable('The live draft projections could not be verified. Please retry.');
const number = (v: unknown): number | null =>
  (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && Number.isFinite(Number(v)) ? Number(v) : null;

/** Same published counts and ScoringCalculator used by the draft room/cards.
 * Never fill missing live players or values from a dated PDF snapshot.
 */
export function publishedDeskKit(rows: Row[], publication: Publication, league: string, weights: Weights): ConnectedKit {
  const settings = projectionSettings(weights), scorer = new ScoringCalculator(settings);
  const active = Object.fromEntries(Object.entries(weights).map(([g, stats]) => [g, Object.values(stats).some(v => v !== 0)]));
  if (!active.skater && !active.goalie) throw AppError.badRequest('Add at least one scoring category to open your draft board.');
  const seen = new Set<string>();
  const players = rows.flatMap(row => {
    const id = String(row.player_id);
    if (!/^[1-9]\d{0,9}$/.test(id) || seen.has(id) || typeof row.is_goalie !== 'boolean'
      || row.season !== publication.season || row.projection_run_id !== publication.run_id
      || row.projection_revision !== publication.revision) throw unavailable();
    seen.add(id);
    const group = row.is_goalie ? 'goalie' : 'skater';
    if (!active[group]) return [];
    const games = number(row.games_remaining);
    if (games === null || games < 0 || !row.player_name || !row.position || !row.team_abbrev) throw unavailable();
    const totals: Record<string, number> = {};
    for (const [stat, column] of Object.entries(FIELDS[group])) {
      const value = number(row[column]);
      if (value === null) {
        if (weights[group][stat] !== 0) throw unavailable();
      } else {
        if ((value < 0 && stat !== 'plus_minus') || (games === 0 && value !== 0)) throw unavailable();
        totals[stat] = value;
      }
    }
    const points = scoreProjectedStats(row, scorer);
    if (points === null || !Number.isFinite(points)) throw unavailable();
    return [{ key: `canonical:${id}`, name: row.player_name as string, team: row.team_abbrev as string,
      position: row.position as string, rank: 0, points, games, goalie: row.is_goalie as boolean, totals }];
  });
  // Rank the complete population using this league, not the default top 300.
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  players.sort((a, b) => b.points-a.points || compare(a.name.toLowerCase(), b.name.toLowerCase()) || compare(a.key, b.key));
  if (!players.length) throw unavailable();
  const payload = { version: 1 as const, league, revision: publication.revision,
    projectionBasis: 'remaining_season' as const,
    projectionDate: publication.activated_at.slice(0, 10), weights,
    players: players.slice(0, 300).map((p, index) => ({ ...p, rank: index+1 })) };
  return { ...payload, fingerprint: createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
}

/** Called only after the parent service verifies league membership and purchase.
 * Read-only user client; no administrator key, private-user cache or writes.
 */
export class PublishedDraftDeskService {
  constructor(private db: SupabaseClient) {}

  private async pointer(season: number): Promise<Publication> {
    const { data, error } = await this.db.from('canonical_published_runs')
      .select('season,run_id,revision,activated_at,last_refresh_status').eq('season', season).maybeSingle();
    if (error || !data || data.season !== season || typeof data.run_id !== 'string' || !data.run_id
      || !/^[a-f0-9]{64}$/.test(data.revision) || typeof data.activated_at !== 'string'
      || !Number.isFinite(Date.parse(data.activated_at))) throw unavailable();
    return data;
  }

  async connected(league: string, weights: Weights, season = getProjectionsSeason()) {
    // Bounded pagination once per desk open, never on each pick or note edit.
    // Two pointer reads bracket ALL pages. One retry handles concurrent activation.
    for (let attempt = 0; attempt < 2; attempt++) {
      const before = await this.pointer(season);
      const { data, error } = await readAllPaged<Row>(this.db, {
        table: 'player_ros_projections', columns: COLUMNS, filters: [['season', season]], orderBy: ['player_id'],
      });
      if (error) throw unavailable();
      const after = await this.pointer(season);
      if (before.run_id !== after.run_id || before.revision !== after.revision
        || data.some(r => r.projection_run_id !== after.run_id || r.projection_revision !== after.revision)) continue;
      return { kit: publishedDeskKit(data, after, league, weights),
        warning: after.last_refresh_status === 'failed'
          ? 'The latest projection update failed. This board uses the last published projections, dated '+after.activated_at.slice(0, 10)+'.'
          : null };
    }
    throw unavailable();
  }
}
