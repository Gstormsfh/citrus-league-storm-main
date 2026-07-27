// Phase 4.5 chunk 11g.7 sub-step 7c — snapshotPersistence.ts unit tests.
//
// Covers serialize/deserialize round-trip, validation reason
// discriminator, ENGINE_SNAPSHOT_VERSION mismatch detection, and
// the seq-bounds invariants on bootstrap validation.

import { describe, it, expect, vi } from 'vitest';
import type { DraftSnapshot } from '@citrus/shared';
import {
  ENGINE_SNAPSHOT_VERSION,
  deserializeEngineState,
  serializeEngineState,
  validateSnapshotForBootstrap,
  writeSnapshot,
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

describe('writeSnapshot UPSERT-per-league (chunk 11g.10 sub-step 10c-2 batch 1 item A1)', () => {
  // Regression lock for the retention refactor: writeSnapshot MUST use
  // .upsert({...}, { onConflict: 'league_id' }) so the single-row-per-
  // league invariant established by 20260727000000_draft_snapshots_upsert_per_league.sql
  // is preserved on every write. Prior behavior (INSERT + keep-latest-N
  // + PostgREST not-in DELETE) allowed silent 999-row overnight
  // accumulation on staging.
  //
  // The mock Supabase client asserts:
  //   1. `.from('draft_snapshots')` is the entry point (not any other table)
  //   2. `.upsert()` is the write method (not `.insert()`)
  //   3. The `onConflict: 'league_id'` option is passed to upsert
  //   4. No `.delete()` call happens on the write path (no prune left)

  function makeMockSupabase() {
    // Typed as `any` because vitest's tuple-inference on `vi.fn(async () => ...)`
    // resolves the args tuple to `[]`, which makes downstream destructuring
    // (`const [row, options] = mock.upsert.mock.calls[0]`) fail typecheck.
    // The runtime shape is dynamic per the Supabase client API — the mock
    // records whatever args are passed and the assertions check them via
    // property access. `any` is the appropriate escape for a mock recorder.
    const upsert: any = vi.fn(async () => ({ error: null }));
    const insert: any = vi.fn(async () => ({ error: null }));
    const del: any = vi.fn(async () => ({ error: null, count: 0 }));
    const from: any = vi.fn((_table: string) => ({
      upsert,
      insert,
      delete: () => ({ eq: () => ({ not: del }) }),
    }));
    return { from, upsert, insert, del };
  }

  it('calls .upsert with onConflict:league_id (not .insert, not .delete)', async () => {
    const mock = makeMockSupabase();
    await writeSnapshot(mock as any, {
      leagueId: 'league-1',
      lastAppliedSeq: 42,
      snapshot: VALID_SNAPSHOT,
      engineState: {
        currentTimerKind: 'pick',
        pauseState: null,
        eventsSinceLastSnapshot: 5,
      },
      draftStatus: 'in_progress',
    });
    expect(mock.from).toHaveBeenCalledWith('draft_snapshots');
    expect(mock.upsert).toHaveBeenCalledTimes(1);
    const call = mock.upsert.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
    const row = call[0];
    const options = call[1];
    expect(row.league_id).toBe('league-1');
    expect(row.last_applied_seq).toBe(42);
    expect(row.engine_version).toBe(ENGINE_SNAPSHOT_VERSION);
    expect(options).toEqual({ onConflict: 'league_id' });
    expect(mock.insert).not.toHaveBeenCalled();
    expect(mock.del).not.toHaveBeenCalled();
  });

  it('throws on upsert error path (bubbles the Supabase error)', async () => {
    const err = { message: 'unique_violation', code: '23505' };
    const upsert = vi.fn(async () => ({ error: err }));
    const from = vi.fn(() => ({ upsert }));
    await expect(
      writeSnapshot({ from } as any, {
        leagueId: 'league-1',
        lastAppliedSeq: 1,
        snapshot: VALID_SNAPSHOT,
        engineState: {
          currentTimerKind: null,
          pauseState: null,
          eventsSinceLastSnapshot: 0,
        },
        draftStatus: 'in_progress',
      }),
    ).rejects.toEqual(err);
  });

  it('does not branch on draftStatus (completed drafts also UPSERT, no audit-preservation prune skip)', async () => {
    // Prior code skipped the prune for completed/cancelled drafts.
    // With UPSERT-per-league, there is no prune to skip; the write
    // path is uniform across statuses. Regression lock so a future
    // refactor doesn't reintroduce per-status branching by accident.
    const mock = makeMockSupabase();
    for (const draftStatus of ['not_started', 'in_progress', 'completed', 'cancelled'] as const) {
      await writeSnapshot(mock as any, {
        leagueId: `league-${draftStatus}`,
        lastAppliedSeq: 1,
        snapshot: VALID_SNAPSHOT,
        engineState: {
          currentTimerKind: null,
          pauseState: null,
          eventsSinceLastSnapshot: 0,
        },
        draftStatus,
      });
    }
    expect(mock.upsert).toHaveBeenCalledTimes(4);
    expect(mock.del).not.toHaveBeenCalled();
  });
});
