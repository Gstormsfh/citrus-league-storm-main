import { projectedSummary, projectionStats } from '@/components/player/projectionScoring';

/** Counts from legacy goalie rows are conditional on starting. Only an
 * explicit API basis permits weighting; a row's mere existence is no start. */
export function summarizeWeeklyProjection(rows: Record<string, unknown>[], scoring: unknown, goalie: boolean): {
  points: number; expectedStarts: number | null; teamGames: number;
} | null {
  if (!rows.length) return null;
  let expectedStarts = 0;
  const normalized: Record<string, unknown>[] = [];
  for (const row of rows) {
    const required = goalie ? ['projected_wins', 'projected_saves', 'projected_shutouts', 'projected_goals_against'] : ['projected_goals', 'projected_assists'];
    if (required.some(key => row[key] == null || !Number.isFinite(Number(row[key])))) return null;
    let multiplier = 1;
    if (goalie) {
      const basis = row.projection_basis;
      if (basis !== 'conditional_on_start' && basis !== 'unconditional') return null;
      const rawExposure = row.expected_starts ?? (basis === 'conditional_on_start' ? row.start_probability : row.projected_gp);
      const exposure = Number(rawExposure);
      if (rawExposure == null || !Number.isFinite(exposure) || exposure < 0 || exposure > 1) return null;
      expectedStarts += exposure;
      if (basis === 'conditional_on_start') multiplier = exposure;
    }
    const stats = projectionStats(row);
    normalized.push(Object.fromEntries(Object.entries({
      projected_goals: stats.goals, projected_assists: stats.assists,
      projected_sog: stats.sog, projected_blocks: stats.blocks,
      projected_hits: stats.hits, projected_pim: stats.pim,
      projected_ppp: stats.ppp, projected_shp: stats.shp,
      projected_wins: stats.wins, projected_saves: stats.saves,
      projected_shutouts: stats.shutouts, projected_goals_against: stats.goals_against,
    }).map(([key, value]) => [key, value * multiplier])));
  }
  return { points: projectedSummary(normalized, scoring, goalie).points,
    expectedStarts: goalie ? expectedStarts : null, teamGames: rows.length };
}

export const weeklyPointsLabel = (points: number | null | undefined): string =>
  points != null && Number.isFinite(points) ? points.toFixed(1) : '–';

export const weeklyProjectionOrder = (points: number | null | undefined): number =>
  points != null && Number.isFinite(points) ? points : Number.NEGATIVE_INFINITY;

export function weeklyExposureLabel(player: { position: string; gamesThisWeek: number; expectedStarts?: number | null }, compact = false): string {
  if (compact) return player.position === 'G'
    ? (player.expectedStarts == null ? 'STARTS —' : `${player.expectedStarts.toFixed(1)} STARTS`)
    : `${player.gamesThisWeek} TEAM GP`;
  return player.position === 'G'
    ? `${player.expectedStarts == null ? 'Starts unavailable' : `${player.expectedStarts.toFixed(1)} expected starts`} · ${player.gamesThisWeek} team games`
    : `${player.gamesThisWeek} team game${player.gamesThisWeek === 1 ? '' : 's'}`;
}

/** Before the opener use the league's first scheduled matchup, not a draft
 * date or a stale in_progress flag. Both projection and schedule readers use it. */
export function freeAgentMatchupWeek<T extends { week_start_date: string; week_end_date: string }>(rows: T[], today: string): T | undefined {
  const ordered = [...rows].sort((a, b) => a.week_start_date.localeCompare(b.week_start_date));
  return ordered.find(row => row.week_start_date <= today && row.week_end_date >= today)
    ?? ordered.find(row => row.week_start_date > today);
}
