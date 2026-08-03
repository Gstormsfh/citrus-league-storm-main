// F20 Piece 3 (2026-08-02) — LobbyRegistry clock-liveness scanner tests.
//
// Boundary cases 5, 6, 7 from architect ruling 5 (Piece 3 scope):
//   5. Scanner detects stalled lobby and re-arms
//   6. Scanner does NOT re-arm during in-flight submit
//   7. Scanner escalates at 3 strikes and stops
// Plus architect ruling 2 (2026-08-02):
//   - UNKILLABLE: one throwing lobby does not shield the rest
// Plus strike-map hygiene:
//   - Entries pruned when lobby leaves registry
//   - Entries cleared on natural recovery
// Plus edge cases:
//   - (a) pick_deadline NULL while in_progress → NOT a stall
//   - (b) re-derived deadline already in past → fires immediately

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LobbyRegistry, type LobbyConfig } from '../LobbyRegistry';
import { LobbyManager } from '../LobbyManager';
import type { DraftServiceV2 } from '../../services/DraftServiceV2';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CommissionerAuthorizationResult,
  DraftFormat,
  TeamAuthorizationResult,
} from '../types';
import { structuredLogger } from '@citrus/shared';

// ── Test helpers ─────────────────────────────────────────────────────

function makeStubSupabase(): SupabaseClient {
  const stub: Record<string, unknown> = {};
  const chain = () => stub;
  stub.from = chain;
  stub.select = chain;
  stub.eq = chain;
  stub.order = chain;
  stub.then = (resolve: (val: { data: unknown[]; error: null }) => void) =>
    resolve({ data: [], error: null });
  return stub as unknown as SupabaseClient;
}

function makeRegistry(): LobbyRegistry {
  const draftService = { submitPick: vi.fn() } as unknown as DraftServiceV2;
  const lobbyConfigLookup = async (_leagueId: string): Promise<LobbyConfig> => ({
    format: 'snake' as DraftFormat,
    draftOrder: [{ round: 1, pickNumber: 1, teamId: 'team-1' }],
    pickClockSeconds: 60,
    initialPickDeadline: null,
    initialDraftState: 'in_progress',
    nominationOrder: [],
    auctionBudget: 0,
    auctionMinBid: 0,
    draftRounds: 0,
    initialTeamBudgets: new Map(),
    initialPlayersWon: new Map(),
    initialActiveNomination: null,
    auctionAntiSnipeThresholdSeconds: 0,
    auctionAntiSnipeExtensionSeconds: 0,
    auctionMinBidIncrementTiers: [],
    auctionBidWindowSeconds: 0,
    auctionNominationWindowSeconds: 0,
  });
  return new LobbyRegistry({
    draftService,
    lobbyConfigLookup,
    verifyTeamAuthorization: async (): Promise<TeamAuthorizationResult> => ({
      authorized: true,
    }),
    verifyCommissionerAuthorization: async (): Promise<CommissionerAuthorizationResult> => ({
      authorized: true,
    }),
    publish: vi.fn(),
    supabase: makeStubSupabase(),
    idleEvictionMs: 0,
    idleEvictionScanMs: 0,
    // Scanner interval disabled (tests call scanClockLiveness directly),
    // but stall threshold set to production default so the tests exercise
    // real threshold logic. Testing with a 0 threshold would make every
    // deadline-in-the-past look stalled — including legitimate 3-4s
    // autopick lag per architect ruling 3.
    clockLivenessScanMs: 0,
    clockLivenessStallMs: 10_000,
  });
}

// Build a stub LobbyManager-shaped object that mimics enough of the
// interface for the scanner. Full LobbyManager construction is heavy
// and not needed here — we're testing the scanner's decision logic,
// not the recovery mechanism (that's Piece 1 boundary tests).
interface StubLobbyState {
  draftStatus?: string;
  deadlineOffsetMs?: number | null;
  timerArmSeq?: number;
  recoveryResult?: {
    recovered: boolean;
    reason:
      | 're_armed'
      | 'shut_down'
      | 'not_in_progress'
      | 'paused'
      | 'seq_advanced'
      | 'no_deadline'
      | 'no_stall'
      | 'submit_in_flight';
    currentSeq: number;
    deadlineOverdueMs: number | null;
  };
  attemptClockRecoveryImpl?: (observedSeq: number) => Promise<
    NonNullable<StubLobbyState['recoveryResult']>
  >;
  getDraftStatusImpl?: () => string;
  getCurrentTimerDeadlineImpl?: () => Date | null;
  getTimerArmSeqImpl?: () => number;
}

function makeStubLobby(state: StubLobbyState = {}): LobbyManager {
  const draftStatus = state.draftStatus ?? 'in_progress';
  const deadline =
    state.deadlineOffsetMs === undefined
      ? new Date(Date.now() - 60_000) // default: 60s in past = stalled
      : state.deadlineOffsetMs === null
        ? null
        : new Date(Date.now() + state.deadlineOffsetMs);
  const timerArmSeq = state.timerArmSeq ?? 42;
  const stub = {
    getDraftStatus: state.getDraftStatusImpl ?? (() => draftStatus),
    getCurrentTimerDeadline:
      state.getCurrentTimerDeadlineImpl ?? (() => deadline),
    getTimerArmSeq: state.getTimerArmSeqImpl ?? (() => timerArmSeq),
    attemptClockRecovery:
      state.attemptClockRecoveryImpl ??
      (async (observedSeq: number) =>
        state.recoveryResult ?? {
          recovered: true,
          reason: 're_armed' as const,
          currentSeq: observedSeq + 2,
          deadlineOverdueMs: 60_000,
        }),
  };
  // Scanner iterates lobbies with `instanceof LobbyManager` to skip
  // in-flight Promise placeholders during lazy construction. Reparent
  // the stub so it passes that check without dragging in the full
  // LobbyManager constructor.
  Object.setPrototypeOf(stub, LobbyManager.prototype);
  return stub as unknown as LobbyManager;
}

// Insert a stub lobby directly into the registry's private map.
function injectLobby(
  registry: LobbyRegistry,
  lobbyId: string,
  lobby: LobbyManager,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lobbies = (registry as any).lobbies as Map<string, LobbyManager>;
  lobbies.set(lobbyId, lobby);
}

function evictLobby(registry: LobbyRegistry, lobbyId: string): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lobbies = (registry as any).lobbies as Map<string, LobbyManager>;
  lobbies.delete(lobbyId);
}

// Log capture — same helper as LobbyManager.f20.test.ts.
type LogEntry = { level: string; event: string; ctx: unknown };
function captureLogs(): { entries: LogEntry[]; restore: () => void } {
  const entries: LogEntry[] = [];
  const origInfo = structuredLogger.info;
  const origWarn = structuredLogger.warn;
  const origError = structuredLogger.error;
  structuredLogger.info = ((event: string, ctx: unknown) => {
    entries.push({ level: 'info', event, ctx });
  }) as typeof structuredLogger.info;
  structuredLogger.warn = ((event: string, ctx: unknown) => {
    entries.push({ level: 'warn', event, ctx });
  }) as typeof structuredLogger.warn;
  structuredLogger.error = ((event: string, ctx: unknown) => {
    entries.push({ level: 'error', event, ctx });
  }) as typeof structuredLogger.error;
  return {
    entries,
    restore: () => {
      structuredLogger.info = origInfo;
      structuredLogger.warn = origWarn;
      structuredLogger.error = origError;
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('F20 Piece 3 — LobbyRegistry.scanClockLiveness', () => {
  let registry: LobbyRegistry;
  beforeEach(() => {
    registry = makeRegistry();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('CASE 5 (Ruling 5): detects stalled lobby (deadline > 10s past) and calls attemptClockRecovery', async () => {
    const recoverySpy = vi.fn(async (observedSeq: number) => ({
      recovered: true,
      reason: 're_armed' as const,
      currentSeq: observedSeq + 2,
      deadlineOverdueMs: 60_000,
    }));
    injectLobby(
      registry,
      'lobby-stalled',
      makeStubLobby({
        deadlineOffsetMs: -60_000, // 60s in past
        attemptClockRecoveryImpl: recoverySpy,
      }),
    );

    const logs = captureLogs();
    try {
      const result = await registry.scanClockLiveness();
      expect(result.scanned).toBe(1);
      expect(result.stalled).toBe(1);
      expect(result.recovered).toBe(1);
      expect(recoverySpy).toHaveBeenCalledTimes(1);
      // Called with observedSeq captured at scan time (42).
      expect(recoverySpy).toHaveBeenCalledWith(42);
      // ERROR emitted on recovery — architect ruling 6 severity ladder.
      const recoveryErrors = logs.entries.filter(
        (e) =>
          e.event === 'registry.clock_stall_recovered' && e.level === 'error',
      );
      expect(recoveryErrors).toHaveLength(1);
    } finally {
      logs.restore();
    }
  });

  it('CASE 6 (Ruling 5): does NOT re-arm during in-flight submit (attemptClockRecovery returns submit_in_flight)', async () => {
    const recoverySpy = vi.fn(async () => ({
      recovered: false,
      reason: 'submit_in_flight' as const,
      currentSeq: 42,
      deadlineOverdueMs: 60_000,
    }));
    injectLobby(
      registry,
      'lobby-in-flight',
      makeStubLobby({
        deadlineOffsetMs: -60_000,
        attemptClockRecoveryImpl: recoverySpy,
      }),
    );

    const result = await registry.scanClockLiveness();
    expect(result.stalled).toBe(1);
    expect(result.recovered).toBe(0);
    expect(recoverySpy).toHaveBeenCalledTimes(1);
    // Strike map should NOT increment on submit_in_flight (leave as-is
    // for next scan to re-evaluate).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const strikes = (registry as any).clockLivenessStrikes as Map<
      string,
      unknown
    >;
    expect(strikes.has('lobby-in-flight')).toBe(false);
  });

  it('CASE 7 (Ruling 5): escalates at 3 strikes and STOPS re-arming (ERROR + alertable)', async () => {
    const recoverySpy = vi.fn(async (observedSeq: number) => ({
      recovered: true,
      reason: 're_armed' as const,
      currentSeq: observedSeq + 2,
      deadlineOverdueMs: 60_000,
    }));
    injectLobby(
      registry,
      'lobby-persistent',
      makeStubLobby({
        deadlineOffsetMs: -60_000,
        attemptClockRecoveryImpl: recoverySpy,
      }),
    );

    const logs = captureLogs();
    try {
      // Scan 1 → strike 1 (recovery ok).
      let result = await registry.scanClockLiveness();
      expect(result.recovered).toBe(1);
      expect(result.escalated).toBe(0);
      // Scan 2 → strike 2.
      result = await registry.scanClockLiveness();
      expect(result.recovered).toBe(1);
      expect(result.escalated).toBe(0);
      // Scan 3 → strike 3 = ESCALATION. Recovery still happens THIS
      // pass but is flagged as the final attempt.
      result = await registry.scanClockLiveness();
      expect(result.recovered).toBe(1);
      expect(result.escalated).toBe(1);
      // Scan 4 → cap reached, do NOT re-arm.
      recoverySpy.mockClear();
      result = await registry.scanClockLiveness();
      expect(recoverySpy).not.toHaveBeenCalled();

      // ERROR + alertable at escalation.
      const giveUps = logs.entries.filter(
        (e) => e.event === 'registry.clock_stall_giving_up',
      );
      expect(giveUps).toHaveLength(1);
      expect(giveUps[0].level).toBe('error');
      const ctx = giveUps[0].ctx as Record<string, unknown>;
      expect(ctx.alertable).toBe(true);
      expect(ctx.consecutiveRecoveries).toBe(3);
    } finally {
      logs.restore();
    }
  });

  it('UNKILLABLE (architect ruling 2, 2026-08-02): one throwing lobby does NOT shield the others', async () => {
    const goodRecoverySpy = vi.fn(async (observedSeq: number) => ({
      recovered: true,
      reason: 're_armed' as const,
      currentSeq: observedSeq + 2,
      deadlineOverdueMs: 60_000,
    }));
    // Malformed lobby: getCurrentTimerDeadline throws.
    injectLobby(
      registry,
      'lobby-malformed',
      makeStubLobby({
        getCurrentTimerDeadlineImpl: () => {
          throw new Error('lobby is broken');
        },
      }),
    );
    // Healthy stalled lobby appears AFTER the malformed one in
    // iteration order.
    injectLobby(
      registry,
      'lobby-good',
      makeStubLobby({
        deadlineOffsetMs: -60_000,
        attemptClockRecoveryImpl: goodRecoverySpy,
      }),
    );

    const logs = captureLogs();
    try {
      const result = await registry.scanClockLiveness();
      // The good lobby MUST still recover — the malformed one MUST
      // NOT terminate the loop.
      expect(result.scanned).toBe(2);
      expect(result.errored).toBe(1);
      expect(result.recovered).toBe(1);
      expect(goodRecoverySpy).toHaveBeenCalledTimes(1);
      // Malformed lobby logs an ERROR with lobbyId.
      const scanErrors = logs.entries.filter(
        (e) => e.event === 'registry.clock_liveness_scan_lobby_threw',
      );
      expect(scanErrors).toHaveLength(1);
      expect((scanErrors[0].ctx as Record<string, unknown>).lobbyId).toBe(
        'lobby-malformed',
      );
    } finally {
      logs.restore();
    }

    // Next scan interval still runs (the whole scan didn't die).
    const result2 = await registry.scanClockLiveness();
    expect(result2.scanned).toBe(2);
    expect(goodRecoverySpy).toHaveBeenCalledTimes(2);
  });

  it('STRIKE-MAP HYGIENE (architect ruling 2, 2026-08-02): entries pruned when lobby leaves registry', async () => {
    const recoverySpy = vi.fn(async (observedSeq: number) => ({
      recovered: true,
      reason: 're_armed' as const,
      currentSeq: observedSeq + 2,
      deadlineOverdueMs: 60_000,
    }));
    injectLobby(
      registry,
      'lobby-departing',
      makeStubLobby({
        deadlineOffsetMs: -60_000,
        attemptClockRecoveryImpl: recoverySpy,
      }),
    );

    await registry.scanClockLiveness();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const strikes = (registry as any).clockLivenessStrikes as Map<
      string,
      unknown
    >;
    expect(strikes.has('lobby-departing')).toBe(true);

    // Simulate departure (eviction / completion / force-purge).
    evictLobby(registry, 'lobby-departing');

    // Next scan prunes the orphaned strike entry.
    await registry.scanClockLiveness();
    expect(strikes.has('lobby-departing')).toBe(false);
  });

  it('STRIKE-MAP HYGIENE: cleared on natural recovery (lobby healthy in next scan)', async () => {
    // Lobby starts stalled.
    let deadlineOffsetMs = -60_000;
    let currentSeq = 42;
    const recoverySpy = vi.fn(async (observedSeq: number) => {
      // Simulate recovery working — bump seq. Test manually flips the
      // stall state below.
      currentSeq = observedSeq + 2;
      return {
        recovered: true,
        reason: 're_armed' as const,
        currentSeq,
        deadlineOverdueMs: 60_000,
      };
    });
    injectLobby(
      registry,
      'lobby-healed',
      makeStubLobby({
        deadlineOffsetMs,
        attemptClockRecoveryImpl: recoverySpy,
        getCurrentTimerDeadlineImpl: () =>
          new Date(Date.now() + deadlineOffsetMs),
        getTimerArmSeqImpl: () => currentSeq,
      }),
    );

    await registry.scanClockLiveness();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const strikes = (registry as any).clockLivenessStrikes as Map<
      string,
      unknown
    >;
    expect(strikes.has('lobby-healed')).toBe(true);

    // Simulate lobby healing — deadline moves to future.
    deadlineOffsetMs = 60_000;
    await registry.scanClockLiveness();
    expect(strikes.has('lobby-healed')).toBe(false);
  });

  it('EDGE (a): pick_deadline NULL while in_progress → NOT a stall (no recovery attempt)', async () => {
    const recoverySpy = vi.fn();
    injectLobby(
      registry,
      'lobby-prearm',
      makeStubLobby({
        draftStatus: 'in_progress',
        deadlineOffsetMs: null, // NULL deadline — pre-first-arm
        attemptClockRecoveryImpl: recoverySpy,
      }),
    );

    const result = await registry.scanClockLiveness();
    expect(result.scanned).toBe(1);
    expect(result.stalled).toBe(0);
    expect(result.recovered).toBe(0);
    expect(recoverySpy).not.toHaveBeenCalled();
  });

  it('SKIPS lobbies where draftStatus !== in_progress (not_started, completed, cancelled)', async () => {
    const recoverySpy = vi.fn();
    injectLobby(
      registry,
      'lobby-not-started',
      makeStubLobby({
        draftStatus: 'not_started',
        attemptClockRecoveryImpl: recoverySpy,
      }),
    );
    injectLobby(
      registry,
      'lobby-completed',
      makeStubLobby({
        draftStatus: 'completed',
        attemptClockRecoveryImpl: recoverySpy,
      }),
    );

    const result = await registry.scanClockLiveness();
    expect(result.scanned).toBe(2);
    expect(result.stalled).toBe(0);
    expect(recoverySpy).not.toHaveBeenCalled();
  });

  it('SKIPS lobbies within tolerance (deadline < 10s past — legitimate autopick lag)', async () => {
    // Deadline 8s in past — under the 10s stall threshold. This
    // simulates a legitimate autopick landing at deadline + 1s pad +
    // few s of DB load per architect ruling 3 rationale.
    const recoverySpy = vi.fn();
    injectLobby(
      registry,
      'lobby-slow-not-stalled',
      makeStubLobby({
        deadlineOffsetMs: -8_000,
        attemptClockRecoveryImpl: recoverySpy,
      }),
    );

    const result = await registry.scanClockLiveness();
    expect(result.scanned).toBe(1);
    expect(result.stalled).toBe(0);
    expect(recoverySpy).not.toHaveBeenCalled();
  });
});
