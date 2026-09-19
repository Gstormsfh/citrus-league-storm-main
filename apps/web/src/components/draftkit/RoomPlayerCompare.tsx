import { useMemo } from 'react';
import type { DashboardIndexEntry, ScoringSettings } from '@citrus/shared';
import type { DraftProjection } from '@citrus/shared/leagueProjection';
import { useDraftConnectionState, useDraftLastFoldGaps } from '@/stores/draftClientStore';
import { PlayerCompare } from './PlayerCompare';
import { roomComparePlayers, weightedCompareStats } from './compareAdapters';
export default function RoomPlayerCompare({entries,projections,scoring,scoringReady,draftedIds}:{entries:readonly DashboardIndexEntry[];projections:Map<string,DraftProjection>;scoring:ScoringSettings;scoringReady:boolean;draftedIds:string[]}) {
  const connection=useDraftConnectionState(), gaps=useDraftLastFoldGaps();
  const verified=connection.kind==='connected'&&!gaps.length;
  const players=useMemo(()=>roomComparePlayers(entries,projections,new Set(draftedIds),verified),[entries,projections,draftedIds,verified]);
  if(!scoringReady)return <p className="p-3 text-sm">Comparison is waiting for this league’s scoring.</p>;
  return <PlayerCompare players={players} rankLabel="Player" stats={weightedCompareStats(scoring)} context="Published remaining-season projections, scored for this league. Games and goalie starts are different workloads." availability={verified?'Availability follows confirmed room picks.':'Connection is not verified. Availability may be stale.'} />;
}
