import { useCallback, useMemo } from 'react';
import { isFantasyIrEligible, type PlayerAvailability } from '@citrus/shared';
import { usePlayerDashboardIndex } from './usePlayerDashboardIndex';

/** Shares the periodically refreshed card evidence; stored roster flags cannot
 * override a newer clear, unknown or expired status. */
export function useFantasyIrEligibility(enabled = true) {
  const index = usePlayerDashboardIndex({ enabled });
  const byId = useMemo(() => new Map(index.players.map(p => [String(p.id), p.availability])), [index.players]);
  return useCallback((player: { id: string | number; availability?: PlayerAvailability | null }) =>
    isFantasyIrEligible(byId.has(String(player.id)) ? byId.get(String(player.id)) : player.availability), [byId]);
}
