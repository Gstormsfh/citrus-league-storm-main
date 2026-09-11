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

/** Keep cached raw games reusable when the manager switches league weights. */
export function scoreGameLog(entries: GameLogEntry[], scoring: unknown): GameLogEntry[] {
  const scorer = new ScoringCalculator(projectionSettings(scoring));
  return entries.map(entry => ({
    ...entry,
    actualPoints: entry.actualStats
      ? scorer.calculatePoints(entry.actualStats as Record<string, number>, entry.isGoalie)
      : undefined,
  }));
}
