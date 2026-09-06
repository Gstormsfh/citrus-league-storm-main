import type { DashboardIndexEntry, ScoringSettings } from '@citrus/shared';
import { buildDraftProjectionMap } from '@/components/draft/draftDecision';
import { projectionSettings } from './projectionScoring';

export function hasUnprojectedPlusMinus(settings: unknown): boolean {
  return Boolean(projectionSettings(settings).skater.plus_minus);
}

export function usesFantasyPoints(format?: string): boolean {
  return format !== 'h2h-categories' && format !== 'roto';
}

/** Reweight a shared raw payload without mutating the cache used by other leagues. */
export function leagueDashboardProjection(
  entries: readonly DashboardIndexEntry[],
  settings: unknown,
  ready = true,
): DashboardIndexEntry[] {
  const projections = ready ? buildDraftProjectionMap(entries, settings as ScoringSettings | null) : null;
  return entries.map(entry => {
    const projection = projections?.get(String(entry.id));
    return { ...entry, proj_fantasy_points: projection?.total ?? null, proj_fantasy_ppg: projection?.perGp ?? null };
  });
}
