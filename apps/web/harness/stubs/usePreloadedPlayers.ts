/** Stand-in for @/hooks/usePreloadedPlayers — no supabase, canned directory. */
import { useMemo } from 'react';
import { PLAYERS } from './draftFixtures';

export function usePreloadedPlayers() {
  const playersById = useMemo(
    () => new Map(PLAYERS.map((p) => [p.id, p])) as ReadonlyMap<string, never>,
    [],
  );
  return { playersById, isLoading: false, error: null, reload: () => {} };
}
export default usePreloadedPlayers;
