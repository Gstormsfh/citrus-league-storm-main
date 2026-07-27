// Phase 4.5 chunk 11g.5b — draftClientStore tests.
//
// Tests use Zustand's `useDraftClientStore.getState()` and
// `useDraftClientStore.setState()` directly — no React rendering
// needed for store logic. Component-level tests that consume the
// store via hooks live in the component test files (RTL).

import { describe, it, expect, beforeEach } from 'vitest';
import type { BufferedDraftEvent, DraftSnapshot } from '@citrus/shared';
import { useDraftClientStore } from '../draftClientStore';

const initialReset = () => useDraftClientStore.getState().reset();

beforeEach(() => {
  initialReset();
});

const samplePickEvent = (
  seq: number,
  correlationId: string,
): BufferedDraftEvent => ({
  kind: 'pick_submitted',
  seq,
  timestamp: '2026-05-05T12:00:00.000Z',
  teamId: 'team-1',
  playerId: 8478000 + seq,
  roundNumber: 1,
  pickNumber: seq,
  correlationId,
});

const sampleSnapshot = (events: BufferedDraftEvent[] = []): DraftSnapshot => ({
  lobbyId: 'lobby-1',
  format: 'snake',
  recentEvents: events,
  stateSnapshot: {
    currentPickNumber: events.length + 1,
    currentRoundNumber: 1,
    onClockTeamId: 'team-1',
    totalPicks: 9,
    picksMade: events.length,
    draftStatus: 'in_progress',
    currentPickDeadline: null,
  },
});

describe('draftClientStore — initial state', () => {
  it('starts with idle connection state and empty collections', () => {
    const s = useDraftClientStore.getState();
    expect(s.connectionState.kind).toBe('idle');
    expect(s.snapshot).toBeNull();
    expect(s.pendingActions.size).toBe(0);
    expect(s.presentUserIds.size).toBe(0);
    expect(s.lastError).toBeNull();
  });
});

describe('draftClientStore — connection state mirror', () => {
  it('setConnectionState updates the state slice', () => {
    useDraftClientStore.getState().setConnectionState({
      kind: 'connecting',
      wsUrl: 'ws://localhost:3002/ws/draft/d1',
      attempt: 0,
    });
    expect(useDraftClientStore.getState().connectionState.kind).toBe('connecting');
  });
});

describe('draftClientStore — snapshot + events', () => {
  it('setSnapshot updates the snapshot slice and reconciles pending actions', () => {
    const store = useDraftClientStore.getState();
    store.recordPending({
      correlationId: 'idem-A',
      teamId: 'team-1',
      playerId: 8478001,
      submittedAt: 1_700_000_000_000,
    });
    expect(useDraftClientStore.getState().pendingActions.size).toBe(1);

    // Snapshot containing the pick we submitted (path 4 — network
    // failure resync recovers the in-flight action).
    store.setSnapshot(sampleSnapshot([samplePickEvent(1, 'idem-A')]));
    const after = useDraftClientStore.getState();
    expect(after.snapshot?.recentEvents).toHaveLength(1);
    expect(after.pendingActions.has('idem-A')).toBe(false);
  });

  it('applyEvent reconciles the matching pending action and appends to snapshot', () => {
    const store = useDraftClientStore.getState();
    store.setSnapshot(sampleSnapshot([]));
    store.recordPending({
      correlationId: 'idem-B',
      teamId: 'team-1',
      playerId: 8478002,
      submittedAt: 1_700_000_000_000,
    });

    store.applyEvent(samplePickEvent(2, 'idem-B'));

    const after = useDraftClientStore.getState();
    expect(after.pendingActions.has('idem-B')).toBe(false);
    expect(after.snapshot?.recentEvents).toHaveLength(1);
    expect(after.snapshot?.recentEvents[0].seq).toBe(2);
  });

  it('10c-2 batch 3 C2: pick_submitted with pickDeadline updates stateSnapshot.currentPickDeadline', () => {
    // Regression lock for the C2 client-side re-arm hook. The store's
    // applyEvent must mirror the event's `pickDeadline` field into
    // `stateSnapshot.currentPickDeadline` so DraftTimerV2's countdown
    // stays authoritative without a resync.
    const store = useDraftClientStore.getState();
    store.setSnapshot(sampleSnapshot([]));
    const deadlineIso = '2026-07-28T12:00:30.000Z';
    store.applyEvent({
      kind: 'pick_submitted',
      seq: 3,
      timestamp: '2026-07-28T12:00:00.000Z',
      teamId: 'team-1',
      playerId: 8478003,
      roundNumber: 1,
      pickNumber: 3,
      correlationId: 'idem-C',
      pickDeadline: deadlineIso,
    });
    const after = useDraftClientStore.getState();
    expect(after.snapshot?.stateSnapshot.currentPickDeadline).toBe(deadlineIso);
  });

  it('10c-2 batch 3 C2: pick_submitted WITHOUT pickDeadline (v1 payload) preserves prior deadline', () => {
    // Backwards-compat: pre-batch-2 v1 events replayed at bootstrap
    // don't carry pickDeadline. The store must NOT clobber
    // currentPickDeadline in that case — the snapshot's original
    // value stays authoritative.
    const store = useDraftClientStore.getState();
    const priorDeadline = '2026-07-28T11:59:30.000Z';
    store.setSnapshot({
      ...sampleSnapshot([]),
      stateSnapshot: {
        ...sampleSnapshot([]).stateSnapshot,
        currentPickDeadline: priorDeadline,
      },
    });
    store.applyEvent(samplePickEvent(4, 'idem-D')); // no pickDeadline
    const after = useDraftClientStore.getState();
    expect(after.snapshot?.stateSnapshot.currentPickDeadline).toBe(priorDeadline);
  });

  it('applyEvents reconciles multiple pending actions in one call', () => {
    const store = useDraftClientStore.getState();
    store.setSnapshot(sampleSnapshot([]));
    store.recordPending({
      correlationId: 'idem-X',
      teamId: 'team-1',
      playerId: 8478001,
      submittedAt: 0,
    });
    store.recordPending({
      correlationId: 'idem-Y',
      teamId: 'team-2',
      playerId: 8478002,
      submittedAt: 0,
    });
    store.applyEvents([samplePickEvent(1, 'idem-X'), samplePickEvent(2, 'idem-Y')]);
    const after = useDraftClientStore.getState();
    expect(after.pendingActions.size).toBe(0);
    expect(after.snapshot?.recentEvents).toHaveLength(2);
  });
});

describe('draftClientStore — optimistic action paths', () => {
  it('rollBackPending transitions the entry to rolled_back', () => {
    const store = useDraftClientStore.getState();
    store.recordPending({
      correlationId: 'idem-R',
      teamId: 'team-1',
      playerId: 8478001,
      submittedAt: 0,
    });
    store.rollBackPending('idem-R', 'player_taken');
    const entry = useDraftClientStore.getState().pendingActions.get('idem-R');
    expect(entry?.optimisticState).toBe('rolled_back');
    expect(entry?.rejectionReason).toBe('player_taken');
  });

  it('removeRolledBack drops the entry after the animation', () => {
    const store = useDraftClientStore.getState();
    store.recordPending({
      correlationId: 'idem-D',
      teamId: 'team-1',
      playerId: 8478001,
      submittedAt: 0,
    });
    store.rollBackPending('idem-D', 'reason');
    store.removeRolledBack('idem-D');
    expect(useDraftClientStore.getState().pendingActions.has('idem-D')).toBe(false);
  });
});

describe('draftClientStore — presence + error', () => {
  it('applyPresence replaces the presentUserIds set', () => {
    const store = useDraftClientStore.getState();
    store.applyPresence({
      kind: 'joined',
      userId: 'user-1',
      presentUserIds: ['user-1', 'user-2'],
    });
    const present = useDraftClientStore.getState().presentUserIds;
    expect(present.has('user-1')).toBe(true);
    expect(present.has('user-2')).toBe(true);
    expect(present.size).toBe(2);
  });

  it('setError stores the error payload', () => {
    useDraftClientStore.getState().setError({
      code: 'lobby_not_ready',
      message: 'Lobby is bootstrapping',
    });
    expect(useDraftClientStore.getState().lastError).toEqual({
      code: 'lobby_not_ready',
      message: 'Lobby is bootstrapping',
    });
  });
});

describe('draftClientStore — reset', () => {
  it('reset returns to initial state', () => {
    const store = useDraftClientStore.getState();
    store.setConnectionState({
      kind: 'connecting',
      wsUrl: 'ws://x',
      attempt: 0,
    });
    store.recordPending({
      correlationId: 'idem',
      teamId: 'team',
      playerId: 1,
      submittedAt: 0,
    });
    store.setError({ code: 'x', message: 'y' });

    store.reset();
    const after = useDraftClientStore.getState();
    expect(after.connectionState.kind).toBe('idle');
    expect(after.pendingActions.size).toBe(0);
    expect(after.lastError).toBeNull();
  });
});
