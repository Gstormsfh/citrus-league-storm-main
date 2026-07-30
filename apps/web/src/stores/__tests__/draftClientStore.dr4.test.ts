// DR-4 (2026-07-30) — draftClientStore presence-seed + idempotency +
// observed-leaves tests.
//
// Contract enforced:
//   1. setSnapshot seeds presentUserIds from snapshot.presentUserIds
//      (fixes the DR-1 anomaly where first client saw 0)
//   2. applyPresence is idempotent — same set in, no mutation
//   3. applyPresence for kind='left' records the userId in
//      observedLeftUserIds even when the set doesn't visually change
//   4. presentUserIds and observedLeftUserIds are both cleared by reset

import { describe, it, expect, beforeEach } from 'vitest';
import type { DraftSnapshot } from '@citrus/shared';
import { useDraftClientStore } from '../draftClientStore';

const mkSnapshot = (over: Partial<DraftSnapshot> = {}): DraftSnapshot => ({
  lobbyId: 'lobby-a',
  format: 'snake',
  recentEvents: [],
  stateSnapshot: {
    currentPickNumber: null,
    currentRoundNumber: null,
    onClockTeamId: null,
    picksMade: 0,
    totalPicks: 12,
    draftStatus: 'not_started',
    currentPickDeadline: null,
  },
  ...over,
});

beforeEach(() => {
  useDraftClientStore.getState().reset();
});

describe('DR-4 — setSnapshot seeds presentUserIds', () => {
  it('seeds presentUserIds from snapshot.presentUserIds when provided', () => {
    const snap = mkSnapshot({ presentUserIds: ['user-a', 'user-b', 'user-c'] });
    useDraftClientStore.getState().setSnapshot(snap);
    const set = useDraftClientStore.getState().presentUserIds;
    expect(set.size).toBe(3);
    expect(set.has('user-a')).toBe(true);
    expect(set.has('user-b')).toBe(true);
    expect(set.has('user-c')).toBe(true);
  });

  it('preserves prior presentUserIds when snapshot omits the field (legacy server)', () => {
    // Simulate legacy state — client already has some presence from
    // events, then a snapshot arrives from a pre-DR-4 server.
    useDraftClientStore.getState().applyPresence({
      kind: 'joined',
      userId: 'user-a',
      presentUserIds: ['user-a'],
    });
    const snap = mkSnapshot(); // no presentUserIds
    useDraftClientStore.getState().setSnapshot(snap);
    const set = useDraftClientStore.getState().presentUserIds;
    expect(set.size).toBe(1);
    expect(set.has('user-a')).toBe(true);
  });

  it('empty presentUserIds array seeds an empty set (distinct from undefined)', () => {
    const snap = mkSnapshot({ presentUserIds: [] });
    useDraftClientStore.getState().setSnapshot(snap);
    expect(useDraftClientStore.getState().presentUserIds.size).toBe(0);
  });
});

describe('DR-4 — applyPresence idempotency', () => {
  it('does not create a new Set reference when the incoming set is identical', () => {
    useDraftClientStore.getState().applyPresence({
      kind: 'joined',
      userId: 'user-a',
      presentUserIds: ['user-a', 'user-b'],
    });
    const setBefore = useDraftClientStore.getState().presentUserIds;
    useDraftClientStore.getState().applyPresence({
      kind: 'joined',
      userId: 'user-b', // different userId, same set
      presentUserIds: ['user-a', 'user-b'],
    });
    const setAfter = useDraftClientStore.getState().presentUserIds;
    expect(setAfter).toBe(setBefore); // reference-equal (no mutation)
  });

  it('creates a new Set when the incoming set differs by any member', () => {
    useDraftClientStore.getState().applyPresence({
      kind: 'joined',
      userId: 'user-a',
      presentUserIds: ['user-a'],
    });
    useDraftClientStore.getState().applyPresence({
      kind: 'joined',
      userId: 'user-b',
      presentUserIds: ['user-a', 'user-b'],
    });
    const set = useDraftClientStore.getState().presentUserIds;
    expect(set.size).toBe(2);
    expect(set.has('user-b')).toBe(true);
  });
});

describe('DR-4 — observedLeftUserIds tracking', () => {
  it('starts empty', () => {
    expect(useDraftClientStore.getState().observedLeftUserIds.size).toBe(0);
  });

  it('records a userId on kind="left" even if the set doesn\'t change visibly', () => {
    // Prime with two users, then send a left with same set (edge case
    // — server would normally decrement, but the record fires).
    useDraftClientStore.getState().applyPresence({
      kind: 'joined',
      userId: 'user-a',
      presentUserIds: ['user-a', 'user-b'],
    });
    useDraftClientStore.getState().applyPresence({
      kind: 'left',
      userId: 'user-b',
      presentUserIds: ['user-a'],
    });
    expect(useDraftClientStore.getState().observedLeftUserIds.has('user-b')).toBe(true);
    expect(useDraftClientStore.getState().presentUserIds.has('user-b')).toBe(false);
  });

  it('does NOT record on kind="joined" (only positive left observations)', () => {
    useDraftClientStore.getState().applyPresence({
      kind: 'joined',
      userId: 'user-a',
      presentUserIds: ['user-a'],
    });
    expect(useDraftClientStore.getState().observedLeftUserIds.size).toBe(0);
  });

  it('rejoin keeps them in observedLeftUserIds — PresenceDot uses presentUserIds first', () => {
    useDraftClientStore.getState().applyPresence({
      kind: 'joined',
      userId: 'user-a',
      presentUserIds: ['user-a'],
    });
    useDraftClientStore.getState().applyPresence({
      kind: 'left',
      userId: 'user-a',
      presentUserIds: [],
    });
    useDraftClientStore.getState().applyPresence({
      kind: 'joined',
      userId: 'user-a',
      presentUserIds: ['user-a'],
    });
    // still in observedLeftUserIds — but PresenceDot renders CONNECTED
    // because presentUserIds takes priority (see computePresenceStatus).
    expect(useDraftClientStore.getState().observedLeftUserIds.has('user-a')).toBe(true);
    expect(useDraftClientStore.getState().presentUserIds.has('user-a')).toBe(true);
  });

  it('reset clears both presentUserIds and observedLeftUserIds', () => {
    useDraftClientStore.getState().applyPresence({
      kind: 'left',
      userId: 'user-x',
      presentUserIds: [],
    });
    useDraftClientStore.getState().reset();
    expect(useDraftClientStore.getState().presentUserIds.size).toBe(0);
    expect(useDraftClientStore.getState().observedLeftUserIds.size).toBe(0);
  });
});
