import { useMemo } from 'react';
import type { ScoringSettings } from '@citrus/shared';
import { useAuth } from '@/contexts/AuthContext';
import { PurchasedDraftDesk } from './PurchasedDraftDesk';
import { isNativeShell } from '@/lib/nativeAuth';
import { useDerivedDraftState, useDraftConnectionState, useDraftLastFoldGaps } from '@/stores/draftClientStore';
import { toDraftedPlayerIds } from '@/lib/draftClient/v1Adapters';
import { DraftDeskPanel, type DeskLiveState } from './DraftDeskPanel';
export { DraftDeskPanel, type DeskLiveState } from './DraftDeskPanel';

/** Same authenticated room subscription, no second socket, pick mutation or scoring engine. */
export function ConnectedDraftDesk(props: {
  leagueId: string; scoring: ScoringSettings; scoringReady: boolean; onReady?: (leagueId: string | null) => void; onReturnToDraft?: () => void;
}) {
  if (import.meta.env.VITE_NATIVE === '1' || isNativeShell()) return null;
  return <BrowserConnectedDraftDesk {...props} />;
}
function BrowserConnectedDraftDesk({leagueId,scoring,scoringReady,onReady,onReturnToDraft}:Parameters<typeof ConnectedDraftDesk>[0]) {
  const { user } = useAuth();
  const derived = useDerivedDraftState(), connection = useDraftConnectionState(), gaps = useDraftLastFoldGaps();
  const ids = useMemo(() => new Set(derived ? toDraftedPlayerIds(derived) : []), [derived]);
  let status: DeskLiveState['status'] = 'waiting';
  if (connection.kind === 'fatal') status = 'denied';
  else if (gaps.length || connection.kind === 'resyncing' || connection.kind === 'snapshot_required') status = 'catching-up';
  else if (derived && (derived.draftStatus === 'completed' || derived.draftStatus === 'cancelled')) status = 'finished';
  else if (derived && connection.kind === 'connected') status = 'live';
  else if (connection.kind === 'reconnecting' && !connection.waitingForStart) status = 'disconnected';
  const live = { status, unavailableIds: ids, sequence: derived?.foldedThroughSeq ?? null };
  return user ? <PurchasedDraftDesk key={`${user.id}:${leagueId}`} leagueId={leagueId} live={live} scoring={scoring} scoringReady={scoringReady} onReady={onReady} onReturnToDraft={onReturnToDraft} />
    : <DraftDeskPanel key={leagueId} live={live} scoring={scoring} scoringReady={scoringReady} onReturnToDraft={onReturnToDraft} />;
}
