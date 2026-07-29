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

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ConnectionBanner } from '@/components/draft/v2/ConnectionBanner';
import {
  DraftTimerV2,
  useClockOffsetEstimator,
} from '@/components/draft/v2/DraftTimerV2';
import { DraftClientRunner } from '@/lib/draftClient/runner';
import { fetchDraftOrderMatrix } from '@/lib/draftClient/fetchDraftOrderMatrix';
import { submitPick } from '@/lib/draftClient/submitPick';
import {
  useDraftClientStore,
  useDraftConnectionState,
  useDraftSnapshot,
  usePresence,
  useDerivedDraftState,
  useDraftLastFoldGaps,
  useMyTeamId,
  usePendingActions,
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

  // DR-2 (2026-07-29) — fetch the caller's teamId in this league on
  // mount. Non-fatal on failure (spectator flow): the submit control
  // simply never renders when myTeamId stays null. Uses the existing
  // v1 route GET /api/leagues/:id/my-team. Dynamic import keeps
  // vi.mock hoisting clean for the page tests.
  //
  // DR-2 round-2 diagnostic (2026-07-29): expose the outcome via
  // console.log AND via the debug overlay in DraftStateView so the
  // "control never rendered" bug is diagnosable at the pixel level.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { apiClient } = await import('@/api/client');
        const path = `/api/leagues/${encodeURIComponent(leagueId)}/my-team`;
        // eslint-disable-next-line no-console
        console.log('[DR-2 my-team] fetching', path);
        const response = await apiClient.get<{ id?: string }>(path);
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.log('[DR-2 my-team] response', response);
        const payload = response.data ?? (response as unknown as { id?: string });
        const teamId =
          payload && typeof payload === 'object' && typeof payload.id === 'string'
            ? payload.id
            : null;
        // eslint-disable-next-line no-console
        console.log('[DR-2 my-team] extracted teamId:', teamId);
        useDraftClientStore.getState().setMyTeamId(teamId);
      } catch (err) {
        // Non-fatal — spectator flow. But LOG the error so we can see
        // it in the DevTools console during acceptance.
        // eslint-disable-next-line no-console
        console.error('[DR-2 my-team] fetch failed', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  // Mount: instantiate runner, wire callbacks to store, connect.
  // Unmount: disconnect + reset store.
  //
  // DR-1b (2026-07-28) additions:
  //   - onSnapshot: kick off `fetchDraftOrderMatrix` (non-fatal per F1
  //     ratification; caller retries on transition — see the derived-
  //     state watcher useEffect further down).
  //   - onEvent / onEvents already surface gaps into `lastFoldGaps`
  //     via the store; the gap-triggered resync useEffect watches it.
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
        onSnapshot: (snapshot) => {
          store.setSnapshot(snapshot);
          // DR-1b F1 ratification: fetch the draft-order matrix on
          // first snapshot receipt. Non-fatal — a null return leaves
          // derivedState.onClockTeamId null (board still renders
          // picks-made + rosters); refetch happens on the
          // not_started → in_progress transition (see the watcher
          // below) so a mid-draft configuration lands as soon as the
          // commissioner completes setup.
          void fetchDraftOrderMatrix(
            leagueId,
            snapshot.stateSnapshot.totalPicks,
          ).then((matrix) => {
            store.setMatrix(matrix);
          });
        },
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

  // DR-1b (2026-07-28) F1 ratification — refetch matrix on
  // not_started → in_progress transition. Guards pre-draft reorders
  // while the room sits open: the commissioner may finish configuring
  // the draft (or reorder teams) after the client's initial connect,
  // and the first-snapshot fetch's matrix would be stale (or null).
  // Watch the derived draftStatus; on the transition, retry the fetch.
  const derivedForRefetch = useDerivedDraftState();
  const prevStatusRef = useRef<string | null>(null);
  useEffect(() => {
    const cur = derivedForRefetch?.draftStatus ?? null;
    const prev = prevStatusRef.current;
    prevStatusRef.current = cur;
    if (prev === 'not_started' && cur === 'in_progress') {
      const totalPicks = derivedForRefetch?.totalPicks ?? 0;
      void fetchDraftOrderMatrix(leagueId, totalPicks).then((matrix) => {
        useDraftClientStore.getState().setMatrix(matrix);
      });
    }
  }, [derivedForRefetch, leagueId]);

  // DR-1b (2026-07-28) F3 ratification — gap-triggered resync
  // dispatch. When the derivation surfaces missing seqs, ask the
  // runner to resync from the last contiguous seq. Loop guard lives
  // inside `runner.requestResyncForGap` (a repeat sinceSeq escalates
  // to full close-and-reconnect via 1006 → backoff).
  const lastFoldGaps = useDraftLastFoldGaps();
  const derivedForGap = useDerivedDraftState();
  useEffect(() => {
    if (lastFoldGaps.length === 0) return;
    if (derivedForGap === null) return;
    const runner = runnerRef.current;
    if (runner === null) return;
    runner.requestResyncForGap(derivedForGap.foldedThroughSeq);
  }, [lastFoldGaps, derivedForGap]);

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
      <DraftStateView clockOffsetMs={clockOffsetMs} leagueId={leagueId} />
    </div>
  );
}

// ── DR-2 (2026-07-29) — submit-pick control ────────────────────────
//
// Minimal by design (PlayerPool + player picker land in DR-3): text
// input for playerId + Submit button, double-click guard via disabled
// state while a pending action exists. Optimistic:
//   1. Generate attemptId (UUIDv4).
//   2. store.recordPending({correlationId=attemptId, ...}) — control
//      disables + shows "Submitting…".
//   3. submitPick(...) — 8s timeout inside apiClient.
//   4a. Success → the WS broadcast will arrive with matching
//       correlationId and reconcileOnBroadcast (already wired into
//       store.applyEvent) removes the pending entry.
//   4b. Failure → store.rollBackPending + toast with the mapped copy.
//
// Post-submit safety timer (architect amendment): even on a
// successful HTTP submit, if no broadcast lands within 8s the pending
// pick dangles forever — so we schedule a rollback that fires if the
// entry is still pending after 8s. If the broadcast beat it,
// rollBackPending is a no-op (correlationId already removed).
interface SubmitPickControlProps {
  leagueId: string;
  teamId: string;
  roundNumber: number;
  pickNumber: number;
}

function SubmitPickControl({
  leagueId,
  teamId,
  roundNumber,
  pickNumber,
}: SubmitPickControlProps) {
  const [playerIdText, setPlayerIdText] = useState('');
  const pendingActions = usePendingActions();
  // We only care about pending actions submitted from THIS control —
  // i.e., ones for our team. Rendered as "you have a pending pick".
  const myPending = useMemo(
    () =>
      Array.from(pendingActions.values()).find(
        (p) => p.teamId === teamId && p.optimisticState === 'pending',
      ) ?? null,
    [pendingActions, teamId],
  );
  const disabled = myPending !== null;

  const handleSubmit = async () => {
    const playerId = parseInt(playerIdText.trim(), 10);
    if (!Number.isFinite(playerId) || playerId <= 0) {
      toast.error('Enter a valid player ID');
      return;
    }
    const attemptId = crypto.randomUUID();
    const submittedAt = Date.now();
    // Optimistic entry — control disables via pendingActions.
    useDraftClientStore.getState().recordPending({
      correlationId: attemptId,
      teamId,
      playerId,
      submittedAt,
    });

    // Dangle-safety timer (architect amendment): if no broadcast lands
    // within 8s and no synchronous rejection fired, the connection may
    // have swallowed a confirm. Roll back with the "check the board"
    // copy so the user sees a clear signal; the fold will show the
    // pick if it actually landed.
    const dangleTimer = setTimeout(() => {
      const current = useDraftClientStore
        .getState()
        .pendingActions.get(attemptId);
      if (current !== undefined && current.optimisticState === 'pending') {
        useDraftClientStore
          .getState()
          .rollBackPending(
            attemptId,
            "We couldn't confirm your pick — check the board",
          );
        toast.error("We couldn't confirm your pick — check the board");
      }
    }, 8000);

    try {
      const result = await submitPick({
        leagueId,
        teamId,
        playerId,
        roundNumber,
        pickNumber,
        attemptId,
      });
      if (!result.ok) {
        // Synchronous rejection — roll back immediately. The dangle
        // timer's guard will find the entry already rolled_back and
        // no-op, so it's safe to leave the timer running.
        useDraftClientStore
          .getState()
          .rollBackPending(attemptId, result.message);
        toast.error(result.message);
      }
      // On success: DO NOT clear the dangle timer (architect amendment
      // 2026-07-29). A connected socket with a lost confirm must not
      // dangle a pending pick forever — even a successful HTTP submit
      // needs the safety net. If the broadcast arrives before 8s, the
      // timer's guard finds no pending entry and is a no-op.
    } catch (err) {
      // Defensive — submitPick catches its own errors and returns a
      // typed result. Any error here is a programming bug; still
      // roll back to avoid dangling optimistic state. Dangle timer
      // left running per the same architect amendment.
      useDraftClientStore
        .getState()
        .rollBackPending(attemptId, 'Unexpected error');
      toast.error('Unexpected error');
      void err;
    } finally {
      setPlayerIdText('');
    }
  };

  // DR-2 (2026-07-29) — UX survivability under a 30s clock: the
  // placeholder shows a VALID example ID a user can literally type
  // and submit; the hint tells them the clock is ticking. This is
  // still a minimal control per brief scope (PlayerPool is DR-3),
  // but "usable enough that Garrett actually submits within 30s".
  return (
    <div
      className="border-2 border-primary rounded-md p-4 bg-card space-y-2"
      data-testid="submit-pick-control"
    >
      <div className="text-base font-bold text-primary">
        You're on the clock
      </div>
      <div className="text-xs text-muted-foreground">
        Pick {pickNumber} · Round {roundNumber} · Type any valid NHL
        player ID and click Submit before the clock runs out.
      </div>
      <div className="flex gap-2 items-center">
        <input
          type="text"
          inputMode="numeric"
          placeholder="Player ID — try 8478050"
          className="flex-1 rounded border-2 px-3 py-2 text-base"
          value={playerIdText}
          disabled={disabled}
          onChange={(e) => setPlayerIdText(e.target.value)}
          data-testid="submit-pick-input"
          autoFocus
        />
        <button
          type="button"
          className="rounded bg-primary text-primary-foreground px-4 py-2 text-base font-semibold disabled:opacity-50"
          disabled={disabled}
          onClick={handleSubmit}
          data-testid="submit-pick-button"
        >
          {disabled ? 'Submitting…' : 'Submit pick →'}
        </button>
      </div>
    </div>
  );
}

// ── Barebones state view (5b minimum surface) ──────────────────────

function DraftStateView({
  clockOffsetMs,
  leagueId,
}: {
  clockOffsetMs: number;
  leagueId: string;
}) {
  const connectionState = useDraftConnectionState();
  const snapshot = useDraftSnapshot();
  const derived = useDerivedDraftState();
  const presentUserIds = usePresence();
  const myTeamId = useMyTeamId();

  if (connectionState.kind === 'idle') {
    return null;
  }

  if (snapshot === null || derived === null) {
    return (
      <div className="mt-4 text-muted-foreground">
        Waiting for draft state…
      </div>
    );
  }

  // Chunk 10c-2 batch 3 C2 (2026-07-28): WS-open signal for the
  // DraftTimerV2 stale indicator. The runner exposes `connected`
  // (fully wired) vs any of the disconnected/reconnecting/fatal
  // states. Only `connected` renders the timer without dim.
  const wsOpen = connectionState.kind === 'connected';

  // DR-1b (2026-07-28): cards render from `derived` (folded from
  // events + fetched matrix), NOT from `snapshot.stateSnapshot`'s
  // convenience fields — those are seed-only per the F4 fix. The
  // ONE field we still consume from `snapshot.stateSnapshot` is
  // `currentPickDeadline`, which is authoritative per-event (batch
  // 3 C2 keeps it fresh via the applyEvent's pickDeadline mirror).
  return (
    <div className="mt-4 space-y-4" data-testid="draft-state-view">
      {/* DR-2 round-2 diagnostic (2026-07-29): pixel-level view of the
          three values the submit-control-render gate depends on.
          Remove after acceptance passes. */}
      <div
        className="border border-dashed border-yellow-500 rounded p-2 text-xs font-mono bg-yellow-50"
        data-testid="dr2-debug"
      >
        <div>DEBUG (remove after DR-2 ratifies)</div>
        <div>myTeamId: {myTeamId ?? '<NOT LOADED>'}</div>
        <div>derived.onClockTeamId: {derived.onClockTeamId ?? '<null>'}</div>
        <div>
          amIOnClock:{' '}
          {myTeamId !== null &&
          derived.onClockTeamId !== null &&
          myTeamId === derived.onClockTeamId
            ? 'YES — control should render below'
            : 'no'}
        </div>
        <div>
          derived.currentPickNumber:{' '}
          {derived.currentPickNumber !== null
            ? String(derived.currentPickNumber)
            : '<null>'}
        </div>
        <div>
          derived.currentRoundNumber:{' '}
          {derived.currentRoundNumber !== null
            ? String(derived.currentRoundNumber)
            : '<null>'}
        </div>
      </div>
      {/* DR-2 (2026-07-29): submit control renders ONLY when the
         caller's team is on the clock. Spectators + off-clock members
         see nothing here. */}
      {derived.onClockTeamId !== null &&
        myTeamId !== null &&
        derived.onClockTeamId === myTeamId &&
        derived.currentPickNumber !== null &&
        derived.currentRoundNumber !== null && (
          <SubmitPickControl
            leagueId={leagueId}
            teamId={myTeamId}
            roundNumber={derived.currentRoundNumber}
            pickNumber={derived.currentPickNumber}
          />
        )}
      <DraftTimerV2
        currentPickDeadline={snapshot.stateSnapshot.currentPickDeadline}
        draftStatus={derived.draftStatus}
        wsOpen={wsOpen}
        clockOffsetMs={clockOffsetMs}
      />
      <div className="grid grid-cols-2 gap-4">
        <StateCard label="Format" value={snapshot.format} />
        <StateCard label="Status" value={derived.draftStatus} />
        <StateCard
          label="Pick"
          value={
            derived.currentPickNumber !== null
              ? `${derived.currentPickNumber} / ${derived.totalPicks}`
              : `${derived.picksMade} / ${derived.totalPicks} done`
          }
        />
        <StateCard
          label="Round"
          value={
            derived.currentRoundNumber !== null
              ? String(derived.currentRoundNumber)
              : '—'
          }
        />
        <StateCard
          label="On the clock"
          value={derived.onClockTeamId ?? '—'}
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
