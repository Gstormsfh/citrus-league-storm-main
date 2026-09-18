import type { DashboardIndexEntry } from '@/hooks/usePlayerDashboardIndex';
import type { GoalieSortKey, SkaterSortKey } from './playersBrowse';
import { leaderboardSortValue } from './playersBrowse';

export type SampleKind = 'xgMinutes' | 'garMinutes' | 'shotsFaced';
// Display qualification, not a claim that a rate becomes statistically reliable
// at this boundary. A manager can lower it, including to All samples.
export const DEFAULT_MINIMUM_SAMPLE = 300;
export const SAMPLE_OPTIONS = [0, 100, 300, 600] as const;

export function sampleKindFor(sort: SkaterSortKey | GoalieSortKey): SampleKind | null {
  if (sort === 'xg_per_60') return 'xgMinutes';
  if (sort === 'gar_per_60') return 'garMinutes';
  return sort === 'save_pct' ? 'shotsFaced' : null;
}
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;

/** Match each rate's denominator. GAR minutes must not borrow NHL total TOI. */
export function sampleSize(player: DashboardIndexEntry, kind: SampleKind): number | null {
  if (kind === 'garMinutes') return finite(player.toi_total_minutes) ? player.toi_total_minutes : null;
  if (kind === 'xgMinutes') return finite(player.toi_seconds) ? player.toi_seconds / 60 : null;
  return finite(player.saves) && finite(player.goals_against) ? player.saves + player.goals_against : null;
}

export function qualifiesForLeaderboard(player: DashboardIndexEntry, sort: SkaterSortKey | GoalieSortKey, minimum: number, searching: boolean): boolean {
  const kind = sampleKindFor(sort);
  // Search is discovery, not a qualified leaderboard. Keep prospects reachable.
  if (!kind || searching) return true;
  if (leaderboardSortValue(player, sort) === null) return false;
  if (minimum === 0) return true;
  const sample = sampleSize(player, kind);
  return sample !== null && sample >= minimum;
}
