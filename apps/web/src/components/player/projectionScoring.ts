import { ScoringCalculator, DEFAULT_SCORING, type ScoringSettings } from '@/utils/scoringUtils';

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

/** Missing categories in a configured league are disabled, never default-weighted. */
export function projectionSettings(raw: unknown): ScoringSettings {
  if (raw == null) return DEFAULT_SCORING;
  const source = raw as Record<string, Record<string, unknown>>;
  return Object.fromEntries(Object.entries(DEFAULT_SCORING).map(([group, defaults]) => [group,
    Object.fromEntries(Object.keys(defaults).map(stat => {
      const value = source[group]?.[stat];
      return [stat, typeof value === 'number' && Number.isFinite(value) ? value : 0];
    })),
  ])) as unknown as ScoringSettings;
}

export function projectedSummary(rows: Record<string, unknown>[], scoring: unknown, goalie: boolean) {
  const stats: Record<string, number> = {};
  for (const row of rows) for (const [key, value] of Object.entries(projectionStats(row))) stats[key] = (stats[key] ?? 0) + value;
  const scorer = new ScoringCalculator(projectionSettings(scoring));
  return { stats, points: scorer.calculatePoints(stats, goalie), breakdown: scorer.getStatBreakdown(stats, goalie) };
}
