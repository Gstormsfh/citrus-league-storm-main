import { projectionSettings, ScoringCalculator, ADDITIONAL_SCORING_STATS } from '@citrus/shared';

const CATEGORIES = ['goals', 'assists', 'points', 'shots_on_goal', 'blocks', 'ppp', 'shp',
  'hits', 'pim', 'plus_minus', 'wins', 'saves', 'shutouts', 'goals_against',
  ...ADDITIONAL_SCORING_STATS.skater, ...ADDITIONAL_SCORING_STATS.goalie] as const;
const ALIASES: Record<string, string> = { power_play_goals: 'ppg', power_play_assists: 'ppa',
  short_handed_goals: 'shg', short_handed_assists: 'sha', shots_blocked_by_opp: 'shots_blocked',
  game_winning_goals: 'gwg', overtime_goals: 'otg', power_play_points: 'ppp',
  short_handed_points: 'shp', penalty_minutes: 'pim' };
const rawStat = (row: Record<string, unknown>, key: string): unknown =>
  key === 'toi_minutes' || key === 'goalie_toi_minutes'
    ? row.toi_seconds == null ? null : Number(row.toi_seconds) / 60
    : row[key] ?? row[ALIASES[key]] ?? (key === 'shots_on_goal' ? row.sog : key === 'blocks' ? row.blk : undefined);
export interface EarnedStats extends Record<string, unknown> {
  daily_total_points?: number;
  daily_stats_breakdown: Record<string, { count: number; points: number }>;
}
const finite = (value: unknown): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? n : 0;
};

/** Raw NHL earned counts, independent of forecast starts, probability or roster assumptions. */
export function aggregateEarnedStats(rows: readonly Record<string, unknown>[], scoring: unknown): Map<number, EarnedStats> {
  const totals = new Map<number, { goalie: boolean; stats: Record<string, number>; missing: Set<string> }>();
  const weights = scoring == null ? null : projectionSettings(scoring);
  for (const row of rows) {
    const id = Number(row.player_id);
    if (!Number.isInteger(id) || id <= 0) continue;
    const entry = totals.get(id) ?? { goalie: row.is_goalie === true, stats: {}, missing: new Set<string>() };
    const group = weights?.[entry.goalie ? 'goalie' : 'skater'];
    for (const [key, weight] of Object.entries(group ?? {})) {
      const raw = rawStat(row, key);
      if (weight && ((!CATEGORIES.includes(key as typeof CATEGORIES[number]) && !(key in ALIASES)) || raw == null || !Number.isFinite(Number(raw)))) entry.missing.add(key);
    }
    for (const key of CATEGORIES) entry.stats[key] = (entry.stats[key] ?? 0) + finite(rawStat(row, key));
    totals.set(id, entry);
  }
  // Null here means the page has not loaded its league settings yet.
  const scorer = scoring == null ? null : new ScoringCalculator(weights!);
  return new Map([...totals].map(([id, { goalie, stats, missing }]) => {
    const breakdown: EarnedStats['daily_stats_breakdown'] = {};
    if (scorer) {
      for (const key of CATEGORIES) {
        if (stats[key] !== 0) breakdown[key] = { count: stats[key],
          points: scorer.calculatePoints({ [key]: stats[key] }, goalie) };
      }
    }
    return [id, { ...stats, is_goalie: goalie,
      daily_total_points: missing.size ? undefined : scorer?.calculatePoints(stats, goalie), daily_stats_breakdown: breakdown }];
  }));
}

export function elapsedStatDates(dates: readonly string[], today: string): string[] {
  return dates.filter(date => date <= today);
}

/** A known zero or negative score is a correction, never a missing-data signal. */
export function finiteEarnedTotal(values: readonly number[]): number | null {
  return values.length > 0 && values.every(Number.isFinite) ? values.reduce((sum, n) => sum + n, 0) : null;
}

/** Read an earned scope only; a season points field is never a fantasy-week fallback. */
export function scopedEarnedPoints(player: { total_points?: number | null; daily_total_points?: number | null },
  daily: boolean, dayPoints?: unknown): number | null {
  const finiteValue = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (daily) {
    if (finiteValue(dayPoints)) return dayPoints;
    return finiteValue(player.daily_total_points) ? player.daily_total_points : null;
  }
  return finiteValue(player.total_points) ? player.total_points : null;
}

/** A date-bounded actual stat row is not invalid merely because its counts are high. */
export function scoreEarnedWeek(stats: Record<string, number> | undefined, scorer: ScoringCalculator, goalie: boolean): number {
  if (!stats) return NaN;
  const row = { ...stats, player_id: 1, is_goalie: goalie };
  return aggregateEarnedStats([row], scorer.getSettings()).get(1)?.daily_total_points ?? NaN;
}
