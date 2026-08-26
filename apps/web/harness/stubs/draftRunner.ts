/**
 * Stand-in for @/lib/draftClient/runner. Same public surface, but the
 * WebSocket is replaced by a scripted timeline so the room can be driven
 * deterministically at a phone viewport.
 *
 * Deliberately NOT a mock of `reduce`/`deriveDraftState` — those are the real
 * modules under test in the unit suite. This only replaces the transport.
 */
import { snakeMatrix, TEAMS, ROUNDS, PLAYERS } from './draftFixtures';

const MATRIX = snakeMatrix(ROUNDS);

/** How many picks are already in the book when the room opens. */
const PRE_PICKS = Number(new URLSearchParams(location.search).get('picks') ?? 5);
/** Seconds on the clock, as the harness reports it. */
const CLOCK_SECONDS = 30;

type Listener = (s: unknown) => void;

function pickEvent(seq: number) {
  const slot = MATRIX[seq - 1];
  return {
    kind: 'pick_submitted' as const,
    seq,
    timestamp: `2026-09-28T18:00:${String(seq % 60).padStart(2, '0')}.000Z`,
    teamId: slot.teamId,
    playerId: Number(PLAYERS[seq - 1].id),
    roundNumber: slot.round,
    pickNumber: slot.pickNumber,
    correlationId: `harness-${seq}`,
    isAutopick: false,
  };
}

export class DraftClientRunner {
  private listeners = new Set<Listener>();
  private state: unknown = { kind: 'idle' };
  private cbs: Record<string, ((...a: unknown[]) => void) | undefined> = {};
  private seq = PRE_PICKS;

  connect(_params: unknown, callbacks: Record<string, unknown> = {}) {
    this.cbs = callbacks as never;
    const deadline = new Date(Date.now() + CLOCK_SECONDS * 1000).toISOString();
    const recentEvents = Array.from({ length: PRE_PICKS }, (_, i) => pickEvent(i + 1));
    const next = MATRIX[PRE_PICKS];
    queueMicrotask(() => {
      this.cbs.onSnapshot?.({
        lobbyId: 'harness-lobby',
        format: 'snake',
        recentEvents,
        stateSnapshot: {
          currentPickNumber: next.pickNumber,
          currentRoundNumber: next.round,
          onClockTeamId: next.teamId,
          picksMade: PRE_PICKS,
          draftStatus: 'in_progress',
          totalPicks: MATRIX.length,
          currentPickDeadline: deadline,
        },
        presentUserIds: TEAMS.map((t) => t.user_id),
        serverReceivedAtMs: Date.now(),
      });
      this.set({ kind: 'connected', wsUrl: 'ws://harness', lastSeenSeq: PRE_PICKS, attempt: 0 });
    });
    // Expose a manual driver so a Playwright script can advance the draft.
    (window as unknown as Record<string, unknown>).__harnessAdvance = () => {
      this.seq += 1;
      this.cbs.onEvent?.(pickEvent(this.seq));
    };
  }

  disconnect() {
    this.set({ kind: 'idle' });
  }

  setDraftActive(_active: boolean) { /* no-op */ }
  requestResyncForGap(_lastContiguousSeq: number) { /* no-op */ }
  getState() { return this.state; }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.state);
    return () => { this.listeners.delete(listener); };
  }

  private set(s: unknown) {
    this.state = s;
    this.cbs.onStateChange?.(s);
    for (const l of this.listeners) l(s);
  }
}
