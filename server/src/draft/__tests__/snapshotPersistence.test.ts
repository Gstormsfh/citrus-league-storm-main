// Phase 4.5 chunk 11g.7 sub-step 7c — snapshotPersistence.ts unit tests.
//
// Covers serialize/deserialize round-trip, validation reason
// discriminator, ENGINE_SNAPSHOT_VERSION mismatch detection, and
// the seq-bounds invariants on bootstrap validation.

import { describe, it, expect } from 'vitest';
import type { DraftSnapshot } from '@citrus/shared';
import {
  ENGINE_SNAPSHOT_VERSION,
  deserializeEngineState,
  serializeEngineState,
  validateSnapshotForBootstrap,
  type SnapshotRecord,
} from '../snapshotPersistence';

const VALID_SNAPSHOT: DraftSnapshot = {
  lobbyId: 'lobby-1',
  format: 'snake',
  recentEvents: [],
  stateSnapshot: {
    currentPickNumber: 1,
    currentRoundNumber: 1,
    onClockTeamId: 'team-1',
    totalPicks: 9,
    picksMade: 0,
    draftStatus: 'in_progress',
    currentPickDeadline: null,
  },
};

function makeRecord(overrides: Partial<SnapshotRecord> = {}): SnapshotRecord {
  return {
    id: 'snap-1',
    lastAppliedSeq: 5,
    engineVersion: ENGINE_SNAPSHOT_VERSION,
    snapshot: VALID_SNAPSHOT,
    engineState: {
      currentTimerKind: 'pick',
      pauseState: null,
      eventsSinceLastSnapshot: 3,
    },
    ...overrides,
  };
}

describe('serialize/deserialize round-trip (chunk 11g.7 sub-step 7c)', () => {
  it('round-trips an engine state with no pause + null timer kind', () => {
    const input = {
      currentTimerKind: null,
      pauseState: null,
      eventsSinceLastSnapshot: 0,
    };
    const serialized = serializeEngineState(input);
    const back = deserializeEngineState(serialized);
    expect(back).toEqual(input);
  });

  it('round-trips an engine state with active timer + pauseState', () => {
    const pausedAt = new Date('2026-05-07T12:00:00Z');
    const input = {
      currentTimerKind: 'bid_window' as const,
      pauseState: {
        pausedAt,
        remainingMs: 18_000,
        pausedTimerKind: 'bid_window' as const,
      },
      eventsSinceLastSnapshot: 17,
    };
    const serialized = serializeEngineState(input);
    // pauseState.pausedAt stored as ISO string in JSON
    expect(serialized.pauseState?.pausedAt).toBe('2026-05-07T12:00:00.000Z');
    const back = deserializeEngineState(serialized);
    expect(back.pauseState?.pausedAt.toISOString()).toBe(pausedAt.toISOString());
    expect(back.pauseState?.remainingMs).toBe(18_000);
    expect(back.pauseState?.pausedTimerKind).toBe('bid_window');
    expect(back.currentTimerKind).toBe('bid_window');
    expect(back.eventsSinceLastSnapshot).toBe(17);
  });

  it('deserializeEngineState tolerates missing optional fields gracefully', () => {
    const back = deserializeEngineState({});
    expect(back.currentTimerKind).toBeNull();
    expect(back.pauseState).toBeNull();
    expect(back.eventsSinceLastSnapshot).toBe(0);
  });

  it('deserializeEngineState normalizes unknown pausedTimerKind to bid_window', () => {
    const back = deserializeEngineState({
      currentTimerKind: 'pick',
      pauseState: {
        pausedAt: '2026-05-07T12:00:00Z',
        remainingMs: 5_000,
        pausedTimerKind: 'unknown_value' as never,
      },
      eventsSinceLastSnapshot: 0,
    });
    expect(back.pauseState?.pausedTimerKind).toBe('bid_window');
  });
});

describe('validateSnapshotForBootstrap (chunk 11g.7 sub-step 7c)', () => {
  it('returns ok for a valid record with seq within bounds', () => {
    const result = validateSnapshotForBootstrap(makeRecord(), 10, 1);
    expect(result).toEqual({ ok: true });
  });

  it('reason: version_mismatch when engineVersion != current constant', () => {
    const stale = makeRecord({ engineVersion: 999 });
    const result = validateSnapshotForBootstrap(stale, 10, 1);
    expect(result).toMatchObject({
      ok: false,
      reason: 'version_mismatch',
    });
  });

  it('reason: seq_ahead_of_log when lastAppliedSeq > currentMaxSeq', () => {
    const result = validateSnapshotForBootstrap(
      makeRecord({ lastAppliedSeq: 999 }),
      5,
      1,
    );
    expect(result).toMatchObject({
      ok: false,
      reason: 'seq_ahead_of_log',
    });
  });

  it('reason: seq_below_oldest_event when snapshot is older than oldest event', () => {
    // currentMinSeq=10 means events 1-9 are gone; snapshot.lastAppliedSeq=3
    // would mean delta(seq>3) starts at 10, missing events 4-9 that the
    // snapshot's base state doesn't reflect.
    const result = validateSnapshotForBootstrap(
      makeRecord({ lastAppliedSeq: 3 }),
      20,
      10,
    );
    expect(result).toMatchObject({
      ok: false,
      reason: 'seq_below_oldest_event',
    });
  });

  it('reason: engine_state_invalid when currentTimerKind is unknown value', () => {
    const result = validateSnapshotForBootstrap(
      makeRecord({
        engineState: {
          currentTimerKind: 'rogue_kind' as never,
          pauseState: null,
          eventsSinceLastSnapshot: 0,
        },
      }),
      10,
      1,
    );
    expect(result).toMatchObject({
      ok: false,
      reason: 'engine_state_invalid',
    });
  });

  it('reason: payload_deserialization_failed when snapshot lacks required fields', () => {
    const result = validateSnapshotForBootstrap(
      makeRecord({
        snapshot: {} as never,
      }),
      10,
      1,
    );
    expect(result).toMatchObject({
      ok: false,
      reason: 'payload_deserialization_failed',
    });
  });

  it('accepts lastAppliedSeq equal to currentMaxSeq (snapshot caught up to log head)', () => {
    const result = validateSnapshotForBootstrap(
      makeRecord({ lastAppliedSeq: 10 }),
      10,
      1,
    );
    expect(result).toEqual({ ok: true });
  });

  it('accepts seq sanity when no events exist (currentMaxSeq=0, currentMinSeq=0)', () => {
    // First-deploy edge: snapshot was written but no events exist —
    // shouldn't happen in practice, but validation is permissive.
    const result = validateSnapshotForBootstrap(
      makeRecord({ lastAppliedSeq: 0 }),
      0,
      0,
    );
    expect(result).toEqual({ ok: true });
  });
});
