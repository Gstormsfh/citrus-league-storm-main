import { useMemo } from 'react';

/** Keep enrichment rerenders from cancelling an in-flight game-log request. */
export function useGameLogIdentity(player: { id: string | number; team?: string; teamAbbreviation?: string; position?: string } | null) {
  const id = player == null ? null : String(player.id);
  const team = player?.teamAbbreviation || player?.team || '';
  const position = player?.position || '';
  return useMemo(() => id === null ? null : ({ id, team, position }), [id, team, position]);
}
