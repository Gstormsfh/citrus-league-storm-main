// Phase 4.5 chunk 11g.5b — minimum v2 draft room.
//
// Consumes chunk-11g.5a's `DraftClientRunner` end-to-end, wires it
// into the chunk-11g.5b `useDraftClientStore`, and renders:
//   - `<ConnectionBanner />` at the top
//   - barebones state view (current pick, on-clock team, presence
//     count, recent events list)
//
// **Minimum surface by design.** The full visual integration of the
// 8 reusable v1 components (DraftBoard, PlayerPool, DraftHistory,
// DraftTimer, etc. — see chunk-11g.5b recon) is iterative work
// post-5b. 5b's job is to prove the protocol-to-UX wiring works
// end-to-end; the visual richness lands in follow-up PRs.
//
// Routing: `/draft-v2/:leagueId/:draftId?` (App.tsx wires the
// route). v1 `DraftRoom.tsx` continues to serve `/draft` and
// `/draft-room` for the cutover-safety window — chunk 11g.9 retires
// v1 once all leagues have migrated.

import { useEffect, useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { ConnectionBanner } from '@/components/draft/v2/ConnectionBanner';
import {
  DraftTimerV2,
  useClockOffsetEstimator,
} from '@/components/draft/v2/DraftTimerV2';
import { DraftClientRunner } from '@/lib/draftClient/runner';
import {
  useDraftClientStore,
  useDraftConnectionState,
  useDraftSnapshot,
  usePresence,
} from '@/stores/draftClientStore';
import {
  notifyConnectionFatal,
  notifyPresenceJoined,
  notifyPresenceLeft,
} from '@/lib/draftClient/toasts';

export default function DraftRoomV2() {
  const params = useParams<{ leagueId: string; draftId?: string }>();
  const leagueId = params.leagueId ?? '';
  const draftId = params.draftId ?? leagueId;

  const runnerRef = useRef<DraftClientRunner | null>(null);
  const store = useDraftClientStore();
  // Chunk 10c-2 batch 3 C2 (2026-07-28): rolling clock-offset
  // estimator for the DraftTimerV2 countdown. Fed by every event
  // frame's `timestamp` field; blended into an EMA. See
  // `useClockOffsetEstimator` in DraftTimerV2.tsx.
  const { offsetMs: clockOffsetMs, updateOffset } = useClockOffsetEstimator();

  // Mount: instantiate runner, wire callbacks to store, connect.
  // Unmount: disconnect + reset store.
  useEffect(() => {
    const runner = new DraftClientRunner();
    runnerRef.current = runner;

    const unsubscribe = runner.subscribe((state) => {
      store.setConnectionState(state);
      // Surface fatal states via toast (banner is the primary
      // surface; toast is the secondary).
      if (state.kind === 'fatal') {
        notifyConnectionFatal(state.reason, state.errorMessage);
      }
    });

    runner.connect(
      { leagueId, draftId },
      {
        onSnapshot: (snapshot) => store.setSnapshot(snapshot),
        onEvent: (event) => {
          // 10c-2 batch 3 C2: capture skew estimate BEFORE the store
          // mutation so a slow store update doesn't skew the offset.
          const clientReceiveMs = Date.now();
          const serverMs = new Date(event.timestamp).getTime();
          if (Number.isFinite(serverMs)) {
            updateOffset(clientReceiveMs, serverMs);
          }
          store.applyEvent(event);
        },
        onEvents: (events) => {
          // 10c-2 batch 3 C2: seed skew from the most-recent event
          // in the batch (single sample rather than N; the resync
          // path can carry a large batch and per-event offset
          // updates would over-weight it in the EMA).
          if (events.length > 0) {
            const last = events[events.length - 1];
            const serverMs = new Date(last.timestamp).getTime();
            if (Number.isFinite(serverMs)) {
              updateOffset(Date.now(), serverMs);
            }
          }
          store.applyEvents(events);
        },
        onPresence: (payload) => {
          store.applyPresence(payload);
          if (payload.kind === 'joined') {
            notifyPresenceJoined(payload.userId);
          } else {
            notifyPresenceLeft(payload.userId);
          }
        },
        onError: (error) => store.setError(error),
      },
    );

    return () => {
      unsubscribe();
      runner.disconnect();
      runnerRef.current = null;
      store.reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, draftId]);

  const handleRetryNow = useMemo(
    () => () => {
      const runner = runnerRef.current;
      if (runner === null) return;
      runner.disconnect();
      runner.connect({ leagueId, draftId });
    },
    [leagueId, draftId],
  );

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Draft Room v2</h1>
      <ConnectionBanner onRetryNow={handleRetryNow} />
      <DraftStateView clockOffsetMs={clockOffsetMs} />
    </div>
  );
}

// ── Barebones state view (5b minimum surface) ──────────────────────

function DraftStateView({ clockOffsetMs }: { clockOffsetMs: number }) {
  const connectionState = useDraftConnectionState();
  const snapshot = useDraftSnapshot();
  const presentUserIds = usePresence();

  if (connectionState.kind === 'idle') {
    return null;
  }

  if (snapshot === null) {
    return (
      <div className="mt-4 text-muted-foreground">
        Waiting for draft state…
      </div>
    );
  }

  const stateSnapshot = snapshot.stateSnapshot;
  // Chunk 10c-2 batch 3 C2 (2026-07-28): WS-open signal for the
  // DraftTimerV2 stale indicator. The runner exposes `connected`
  // (fully wired) vs any of the disconnected/reconnecting/fatal
  // states. Only `connected` renders the timer without dim.
  const wsOpen = connectionState.kind === 'connected';

  return (
    <div className="mt-4 space-y-4" data-testid="draft-state-view">
      <DraftTimerV2
        currentPickDeadline={stateSnapshot.currentPickDeadline}
        draftStatus={stateSnapshot.draftStatus}
        wsOpen={wsOpen}
        clockOffsetMs={clockOffsetMs}
      />
      <div className="grid grid-cols-2 gap-4">
        <StateCard label="Format" value={snapshot.format} />
        <StateCard
          label="Status"
          value={stateSnapshot.draftStatus}
        />
        <StateCard
          label="Pick"
          value={
            stateSnapshot.currentPickNumber !== null
              ? `${stateSnapshot.currentPickNumber} / ${stateSnapshot.totalPicks}`
              : `${stateSnapshot.picksMade} / ${stateSnapshot.totalPicks} done`
          }
        />
        <StateCard
          label="Round"
          value={
            stateSnapshot.currentRoundNumber !== null
              ? String(stateSnapshot.currentRoundNumber)
              : '—'
          }
        />
        <StateCard
          label="On the clock"
          value={stateSnapshot.onClockTeamId ?? '—'}
        />
        <StateCard
          label="Connected users"
          value={String(presentUserIds.size)}
        />
      </div>
      <details>
        <summary className="cursor-pointer text-sm font-medium">
          Recent events ({snapshot.recentEvents.length})
        </summary>
        <ul className="mt-2 space-y-1 text-xs font-mono">
          {snapshot.recentEvents.map((event) => (
            <li key={event.seq} className="border-l-2 border-muted pl-2">
              [seq={event.seq}] {event.kind}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

interface StateCardProps {
  label: string;
  value: string;
}

function StateCard({ label, value }: StateCardProps) {
  return (
    <div className="border rounded-md p-3 bg-card">
      <div className="text-xs text-muted-foreground uppercase tracking-wide">
        {label}
      </div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
