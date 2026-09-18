import { ScoringCalculator, projectionSettings, scoreProjectedStats } from '@citrus/shared';
import { projectionStats } from '@/components/player/projectionScoring';
import type { RosterWeekEntry } from '@/components/pressbox/rosterWeek';

export const ROSTER_STAT_VIEWS = [
  ['actuals', 'Actuals'], ['week', 'Week'], ['seasonProjection', 'Season Proj'], ['priorSeason', 'Prior Season'],
] as const;
export type RosterStatView = typeof ROSTER_STAT_VIEWS[number][0];
export interface RosterStatSummary {
  points: number | null;
  detail: string;
  projected: boolean;
}
export interface RosterSeasonSources {
  /** undefined means unavailable; null means the query succeeded with no season row. */
  actual?: Record<string, unknown> | null;
  prior?: Record<string, unknown> | null;
  ros?: Record<string, unknown>;
}

const STAT_COLUMNS = {
  goals: 'nhl_goals', assists: 'nhl_assists', sog: 'nhl_shots_on_goal',
  blocks: 'nhl_blocks', hits: 'nhl_hits', pim: 'nhl_pim', ppp: 'nhl_ppp',
  shp: 'nhl_shp', plus_minus: 'nhl_plus_minus', wins: 'nhl_wins',
  saves: 'nhl_saves', shutouts: 'nhl_shutouts', goals_against: 'nhl_goals_against',
} as const;

export function actualStats(row: Record<string, unknown> | null | undefined): Record<string, number> | null {
  if (row === undefined) return null;
  // A successful empty current-season query means no recorded games, not
  // last season's totals. Missing/failed responses take the branch above.
  if (row === null) return Object.fromEntries(Object.keys(STAT_COLUMNS).map(key => [key, 0]));
  return Object.fromEntries(Object.entries(STAT_COLUMNS).flatMap(([stat, column]) => {
    const value = row[column];
    return value != null && value !== '' && typeof value !== 'boolean' && Number.isFinite(Number(value))
      ? [[stat, Number(value)]] : [];
  }));
}

function score(stats: Record<string, number>, goalie: boolean, scoring: unknown): number | null {
  const settings = projectionSettings(scoring);
  const weights = goalie ? settings.goalie : settings.skater;
  const aliases: Record<string, string> = { shots_on_goal: 'sog', power_play_points: 'ppp', short_handed_points: 'shp', penalty_minutes: 'pim' };
  // Never silently score a missing enabled category as zero.
  if (Object.entries(weights).some(([key, weight]) => weight != null && weight !== 0 && stats[aliases[key] ?? key] == null)) return null;
  return new ScoringCalculator(settings).calculatePoints(stats, goalie);
}

function statLine(stats: Record<string, number> | null, goalie: boolean): string {
  if (!stats) return 'Stats unavailable';
  const columns = goalie ? [['wins', 'W'], ['saves', 'SV'], ['goals_against', 'GA']] : [['goals', 'G'], ['assists', 'A'], ['sog', 'SOG']];
  return columns.map(([key, label]) => `${stats[key] == null ? '–' : Math.round(stats[key])} ${label}`).join(' · ');
}

export function rosterStatSummary(view: RosterStatView, sources: RosterSeasonSources | undefined, goalie: boolean, scoring: unknown, season: number, week?: RosterWeekEntry): RosterStatSummary {
  if (view === 'week') return {
    points: week?.weekPoints ?? null, projected: true,
    detail: week ? `${week.actualToDate.toFixed(1)} earned + ${week.projRemaining.toFixed(1)} remaining` : 'Weekly outlook unavailable',
  };
  const projected = view === 'seasonProjection';
  const prior = view === 'priorSeason';
  const label = `${prior ? season - 1 : season}-${String(prior ? season : season + 1).slice(-2)}`;
  const stats = actualStats(prior ? sources?.prior ?? undefined : sources?.actual);
  if (!projected) return {
    points: stats ? score(stats, goalie, scoring) : null, projected: false,
    detail: `${label} · ${statLine(stats, goalie)}`,
  };
  const ros = sources?.ros;
  const valid = ros && Number(ros.season) === season && ros.games_remaining != null && Number.isFinite(Number(ros.games_remaining)) && Number(ros.games_remaining) >= 0;
  const remaining = valid ? scoreProjectedStats({ ...ros, is_goalie: goalie }, new ScoringCalculator(projectionSettings(scoring))) : null;
  const earned = stats ? score(stats, goalie, scoring) : null;
  if (remaining == null || earned == null || !stats || !ros) return { points: null, projected: true, detail: `${label} · Season forecast unavailable` };
  const future = projectionStats(ros);
  const totals = Object.fromEntries(Object.entries(future).filter(([key]) => stats[key] != null).map(([key, value]) => [key, value + stats[key]]));
  return { points: earned + remaining, projected: true, detail: `${label} · ${statLine(totals, goalie)}` };
}
