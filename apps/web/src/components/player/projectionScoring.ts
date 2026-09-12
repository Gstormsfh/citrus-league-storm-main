import type { GameLogEntry } from './gameLogRows';
import { ScoringCalculator } from '@/utils/scoringUtils';
import { projectionSettings } from '@citrus/shared/leagueProjection';

export function projectionStats(row: Record<string, unknown>): Record<string, number> {
  const fields: Record<string, string[]> = {
    goals: ['projected_goals'], assists: ['projected_assists'], sog: ['projected_sog'],
    blocks: ['projected_blocks'], hits: ['projected_hits'], pim: ['projected_pim'],
    ppp: ['projected_ppp'], shp: ['projected_shp'],
    wins: ['projected_wins_ros', 'projected_wins'], saves: ['projected_saves_ros', 'projected_saves'],
    shutouts: ['projected_shutouts_ros', 'projected_shutouts'], goals_against: ['projected_ga_ros', 'projected_goals_against'],
  };
  return Object.fromEntries(Object.entries(fields).map(([stat, aliases]) => {
    const value = aliases.map(key => row[key]).find(v => v != null);
    return [stat, Number.isFinite(Number(value)) ? Number(value) : 0];
  }));
}

/**
 * Missing categories in a configured league are disabled, never
 * default-weighted. Moved to `@citrus/shared/leagueProjection` on
 * 2026-09-11 so the server scores the writeup's projection sentence with
 * the same normalisation the card displays; re-exported here so this
 * module's callers keep their import.
 */
export { projectionSettings } from '@citrus/shared/leagueProjection';

export function projectedSummary(rows: Record<string, unknown>[], scoring: unknown, goalie: boolean) {
  const stats: Record<string, number> = {};
  for (const row of rows) for (const [key, value] of Object.entries(projectionStats(row))) stats[key] = (stats[key] ?? 0) + value;
  const scorer = new ScoringCalculator(projectionSettings(scoring));
  return { stats, points: scorer.calculatePoints(stats, goalie), breakdown: scorer.getStatBreakdown(stats, goalie) };
}

/** ROS already includes expected GP/starts. Daily conditional rows are not a
 * fallback for missing season exposure, even when a full team schedule exists. */
export function seasonProjectionSummary(row: Record<string, unknown> | null, scoring: unknown, goalie: boolean) {
  if (row?.games_remaining == null) return null;
  const gp = Number(row.games_remaining);
  if (!Number.isFinite(gp) || gp < 0) return null;
  const count = goalie ? row.projected_saves_ros : row.projected_goals;
  if (count == null || !Number.isFinite(Number(count))) return null;
  return { ...projectedSummary([row], scoring, goalie), gp };
}

/** Keep cached raw games reusable when the manager switches league weights. */
export function scoreGameLog(entries: GameLogEntry[], scoring: unknown): GameLogEntry[] {
  const scorer = new ScoringCalculator(projectionSettings(scoring));
  return entries.map(entry => ({
    ...entry,
    projectedPoints: entry.projection
      ? scorer.calculatePoints(projectionStats(entry.projection), entry.isGoalie)
      : 0,
    // Stored FPTS intervals are in default scoring units. Raw category
    // covariance is unavailable, so do not present them as league intervals.
    projection: entry.projection && scoring != null ? {
      ...entry.projection,
      likely_low: null, likely_high: null,
      projection_ci_50_lower: null, projection_ci_50_upper: null,
      projection_std_dev: null,
    } : entry.projection,
    actualPoints: entry.actualStats
      ? scorer.calculatePoints(entry.actualStats as Record<string, number>, entry.isGoalie)
      : undefined,
  }));
}
