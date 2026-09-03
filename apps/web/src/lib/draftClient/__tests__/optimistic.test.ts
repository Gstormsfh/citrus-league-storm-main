// Phase 4.5 chunk 11g.5b — optimistic action reconciliation tests.
//
// Pure-function unit tests covering the four reconciliation paths
// (broadcast / resync / rejection / network-failure-with-resync) and
// the helper that removes rolled-back entries after the animation.

import { describe, it, expect } from 'vitest';
import type { BufferedDraftEvent } from '@citrus/shared';
import {
  recordPendingAction,
  reconcileOnBroadcast,
  reconcileOnRejection,
  reconcileOnResync,
  removeRolledBack,
  type PendingAction,
} from '../optimistic';

const emptyMap = (): Map<string, PendingAction> => new Map();

const sample = (correlationId: string): PendingAction => ({
  correlationId,
  teamId: 'team-1',
  playerId: 8478001,
  submittedAt: 1_700_000_000_000,
  optimisticState: 'pending',
});

describe('recordPendingAction', () => {
  it('adds a new entry and returns a new map (immutability)', () => {
    const before = emptyMap();
    const after = recordPendingAction(before, {
      correlationId: 'idem-1',
      teamId: 'team-1',
      playerId: 8478001,
      submittedAt: 1_700_000_000_000,
    });
    expect(after).not.toBe(before); // new reference
    expect(after.size).toBe(1);
    expect(after.get('idem-1')?.optimisticState).toBe('pending');
    expect(before.size).toBe(0); // input unchanged
  });
});

describe('reconcileOnBroadcast (path 1)', () => {
  it('removes the matching correlationId', () => {
    const map = new Map([['idem-1', sample('idem-1')]]);
    const after = reconcileOnBroadcast(map, 'idem-1');
    expect(after.has('idem-1')).toBe(false);
    expect(after.size).toBe(0);
  });

  it('returns the same map (referential equality) when correlationId not found', () => {
    const map = new Map([['idem-1', sample('idem-1')]]);
    const after = reconcileOnBroadcast(map, 'idem-other');
    expect(after).toBe(map); // exact reference preserved
  });
});

describe('reconcileOnResync (path 2)', () => {
  it('removes correlationIds matched by pick_submitted events', () => {
    const map = new Map([
      ['idem-1', sample('idem-1')],
      ['idem-2', sample('idem-2')],
      ['idem-3', sample('idem-3')],
    ]);
    const events: BufferedDraftEvent[] = [
      {
        kind: 'pick_submitted',
        seq: 1,
        timestamp: 'x',
        teamId: 'team-1',
        playerId: 8478001,
        roundNumber: 1,
        pickNumber: 1,
        correlationId: 'idem-1',
      },
      {
        kind: 'pick_submitted',
        seq: 3,
        timestamp: 'x',
        teamId: 'team-3',
        playerId: 8478003,
        roundNumber: 1,
        pickNumber: 3,
        correlationId: 'idem-3',
      },
    ];
    const after = reconcileOnResync(map, events);
    expect(after.has('idem-1')).toBe(false);
    expect(after.has('idem-2')).toBe(true);
    expect(after.has('idem-3')).toBe(false);
  });

  it('also matches commissioner_override events', () => {
    const map = new Map([['idem-co', sample('idem-co')]]);
    const events: BufferedDraftEvent[] = [
      {
        kind: 'commissioner_override',
        seq: 1,
        timestamp: 'x',
        teamId: 'team-1',
        playerId: 8478001,
        roundNumber: 1,
        pickNumber: 1,
        correlationId: 'idem-co',
      },
    ];
    const after = reconcileOnResync(map, events);
    expect(after.has('idem-co')).toBe(false);
  });

  it('returns the same map when nothing matches (referential equality)', () => {
    const map = new Map([['idem-1', sample('idem-1')]]);
    const after = reconcileOnResync(map, []);
    expect(after).toBe(map);
  });

  it('ignores auction events (chunk 11g.6 territory)', () => {
    const map = new Map([['idem-1', sample('idem-1')]]);
    const events: BufferedDraftEvent[] = [
      {
        kind: 'auction_bid_placed',
        seq: 1,
        timestamp: 'x',
        correlationId: 'idem-1',
        nominationId: 'nom-1',
        bidderTeamId: 'team-1',
        bidAmount: 25,
        clockDeadline: '2026-08-08T00:00:30.000Z',
      },
    ];
    const after = reconcileOnResync(map, events);
    expect(after).toBe(map); // unchanged
  });
});

describe('reconcileOnRejection (paths 3 & 4)', () => {
  it('transitions an existing entry to rolled_back with reason', () => {
    const map = new Map([['idem-1', sample('idem-1')]]);
    const after = reconcileOnRejection(map, 'idem-1', 'player_taken');
    const entry = after.get('idem-1');
    expect(entry?.optimisticState).toBe('rolled_back');
    expect(entry?.rejectionReason).toBe('player_taken');
  });

  it('returns the same map for a missing correlationId', () => {
    const map = new Map([['idem-1', sample('idem-1')]]);
    const after = reconcileOnRejection(map, 'idem-other', 'reason');
    expect(after).toBe(map);
  });

  it('returns the same map if entry is already rolled_back (idempotent)', () => {
    const rolled: PendingAction = {
      ...sample('idem-1'),
      optimisticState: 'rolled_back',
      rejectionReason: 'previous',
    };
    const map = new Map([['idem-1', rolled]]);
    const after = reconcileOnRejection(map, 'idem-1', 'new-reason');
    expect(after).toBe(map);
  });
});

describe('removeRolledBack', () => {
  it('removes the entry from the map', () => {
    const map = new Map([['idem-1', sample('idem-1')]]);
    const after = removeRolledBack(map, 'idem-1');
    expect(after.has('idem-1')).toBe(false);
  });

  it('returns the same map when correlationId not found', () => {
    const map = new Map([['idem-1', sample('idem-1')]]);
    const after = removeRolledBack(map, 'idem-other');
    expect(after).toBe(map);
  });
});
