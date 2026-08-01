// F20 (2026-08-01) — boundary tests for the pick-timer early-fire
// guard. Six boundary cases from architect ruling 5 plus the ruling-
// amendment case (cap exhausted + fail-open). The 1ms-early case with
// a forced clock converts the differential-diagnosis hypothesis for
// the seq-25→seq-26 stall into a proof; the (tolerance+1)ms case
// asserts THE RE-ARM, not merely the rejection — asserting only the
// rejection re-certifies the bug.
//
// Tests call `handleClockExpired` directly through an `any` cast to
// bypass setTimeout scheduling — the timer machinery is exercised by
// the existing LobbyManager.test.ts suite; here we drive the guard
// with controlled inputs and assert its output (log, re-arm, accept).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LobbyManager, type LobbyManagerOptions } from '../LobbyManager';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  DraftEventRow,
  DraftServiceV2,
  SubmitPickResult,
} from '../../services/DraftServiceV2';
import type {
  CommissionerAuthorizationResult,
  DraftOrderSlot,
  TeamAuthorizationResult,
} from '../types';
import type { AutopickStrategy } from '../autopickStrategy';
import { structuredLogger } from '@citrus/shared';

// ── minimal LobbyManager factory (mirrors LobbyManager.test.ts) ──────

// Deterministic autopick strategy: always picks '8478001'. Lets the
// outcome assertions (Amendment A) confirm the autopick reached
// submitPick after the guard's re-arm or cap-exhaust path.
const fixedPlayerStrategy: AutopickStrategy = async () => ({
  ok: true as const,
  playerId: 8478001,
  source: 'projections',
});

async function makeLobby(submitPickSpy?: ReturnType<typeof vi.fn>): Promise<LobbyManager> {
  const draftOrder: DraftOrderSlot[] = [
    { round: 1, pickNumber: 1, teamId: 'team-1' },
    { round: 1, pickNumber: 2, teamId: 'team-2' },
    { round: 1, pickNumber: 3, teamId: 'team-3' },
  ];
  const submitPick =
    submitPickSpy ??
    vi.fn(
      async (_p: unknown): Promise<SubmitPickResult> => ({
        event_id: 1,
        seq: 1,
        pick_deadline: null,
        was_duplicate: false,
      }),
    );
  const draftService = {
    submitPick,
    listDraftEvents: vi.fn(
      async (_leagueId: string, _sinceSeq?: number): Promise<DraftEventRow[]> => [],
    ),
    nominatePlayer: vi.fn(),
    placeBid: vi.fn(),
    closeNomination: vi.fn(),
    pauseAuction: vi.fn(),
    resumeAuction: vi.fn(),
    skipNomination: vi.fn(),
    commissionerOverride: vi.fn(),
  } as unknown as DraftServiceV2;

  const supabaseStub = {
    from: () => ({
      select: () => ({
        in: () => Promise.resolve({ data: [], error: null }),
        eq: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
  } as unknown as SupabaseClient;

  const opts: LobbyManagerOptions = {
    lobbyId: 'lobby-f20',
    leagueId: 'league-f20',
    format: 'snake',
    draftOrder,
    draftService,
    publish: vi.fn(),
    verifyTeamAuthorization: async (): Promise<TeamAuthorizationResult> => ({
      authorized: true,
    }),
    verifyCommissionerAuthorization: async (): Promise<CommissionerAuthorizationResult> => ({
      authorized: true,
    }),
    pickClockSeconds: 60,
    initialPickDeadline: null,
    initialDraftState: 'in_progress',
    supabase: supabaseStub,
    // Auction stubs — unused for snake tests but the type requires them.
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
    autopickStrategies: [fixedPlayerStrategy],
  };
  const lobby = new LobbyManager(opts);
  await lobby.init();
  return lobby;
}

// ── Test helpers ─────────────────────────────────────────────────────

function driveGuard(
  lobby: LobbyManager,
  armSeq: number,
  armedDeadlineMs: number,
  firedAtMs: number,
  armedKind: 'pick' | 'bid_window' | 'nomination_window' = 'pick',
): Promise<void> {
  vi.setSystemTime(firedAtMs);
  const armedDeadline = new Date(armedDeadlineMs);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (lobby as any).handleClockExpired(armSeq, armedDeadline, armedKind);
}

// Force `timerArmSeq` to match what the caller expects, and set an
// armedDeadline that setPickDeadline will re-arm to. Bypasses
// setPickDeadline's own setTimeout scheduling — we're testing the
// guard's decision, not the timer plumbing.
function primeLobby(lobby: LobbyManager, armedDeadlineMs: number): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const l = lobby as any;
  l.timerArmSeq = 42;
  l.currentTimerDeadline = new Date(armedDeadlineMs);
  l.currentTimerKind = 'pick';
  l.earlyFireRearmCount = 0;
  l.earlyFireRearmForDeadlineMs = null;
  // Force draftStatus='in_progress' so handleClockExpired's status guard
  // passes when the re-armed timer fires (or when cap-exhaust falls
  // through). init() leaves it 'not_started' when the event log is
  // empty; we're testing the timer guard in isolation.
  l.draftStatus = 'in_progress';
  l.picksMade = 0;
  l.pauseState = null;
  l.shutDown = false;
  return 42;
}

// Sink structured logger calls (they're single-writer per level) so
// tests can assert emitted lines without shell noise. Restored per-test.
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

describe('F20 — pick-timer early-fire guard (LobbyManager.handleClockExpired)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('CASE 1: fires EXACTLY at deadline → accepted (no early-fire log)', async () => {
    const lobby = await makeLobby();
    const armedMs = Date.now() + 60_000;
    const armSeq = primeLobby(lobby, armedMs);
    const logs = captureLogs();
    try {
      await driveGuard(lobby, armSeq, armedMs, armedMs);
      const earlyFireEntries = logs.entries.filter(
        (e) => e.event === 'autopick.stale_timer_skipped',
      );
      expect(earlyFireEntries).toHaveLength(0);
    } finally {
      logs.restore();
    }
  });

  it('CASE 2: fires 1ms EARLY → accepted within tolerance (no early-fire log)', async () => {
    const lobby = await makeLobby();
    const armedMs = Date.now() + 60_000;
    const armSeq = primeLobby(lobby, armedMs);
    const logs = captureLogs();
    try {
      await driveGuard(lobby, armSeq, armedMs, armedMs - 1);
      const earlyFireEntries = logs.entries.filter(
        (e) => e.event === 'autopick.stale_timer_skipped',
      );
      expect(earlyFireEntries).toHaveLength(0);
    } finally {
      logs.restore();
    }
  });

  it('CASE 3 (THE ONE THAT MATTERS — LIVENESS OUTCOME): fires (tolerance+1)ms EARLY → REJECTED, RE-ARMED, AND THE AUTOPICK ACTUALLY FIRES', async () => {
    const submitPickSpy = vi.fn(
      async (_p: unknown): Promise<SubmitPickResult> => ({
        event_id: 1,
        seq: 1,
        pick_deadline: null,
        was_duplicate: false,
      }),
    );
    const lobby = await makeLobby(submitPickSpy);
    const armedMs = Date.now() + 60_000;
    const armSeq = primeLobby(lobby, armedMs);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const l = lobby as any;
    const beforeArmSeq = l.timerArmSeq as number;
    const logs = captureLogs();
    try {
      await driveGuard(lobby, armSeq, armedMs, armedMs - 26); // 26ms early
      // Mechanism assertions (necessary but NOT sufficient — architect
      // Amendment A: "for a liveness defect the assertion must be on
      // the OUTCOME, never on the mechanism").
      const warns = logs.entries.filter(
        (e) => e.event === 'autopick.stale_timer_skipped' && e.level === 'warn',
      );
      expect(warns).toHaveLength(1);
      const ctx = warns[0].ctx as Record<string, unknown>;
      expect(ctx.reason).toBe('fired_before_deadline');
      expect(ctx.driftMs).toBe(-26);
      expect(ctx.action).toBe('re_armed');
      const afterArmSeq = l.timerArmSeq as number;
      expect(afterArmSeq).toBeGreaterThan(beforeArmSeq);
      expect(l.currentTimerHandle).not.toBeNull();

      // *** OUTCOME ASSERTION (Amendment A) *** Advance the fake clock
      // past the armed deadline so the re-armed setTimeout fires. If
      // the re-arm scheduled a real timer AND the pipeline completes,
      // draftService.submitPick MUST be called with is_autopick=true.
      // A test that stops at "a timer exists" would pass even if the
      // draft still dies — F22 was tonight's lesson in what a suite
      // that looks green while asserting nothing costs.
      await vi.advanceTimersByTimeAsync(30);  // >26ms so re-armed timer fires
      await vi.runAllTimersAsync();           // drain any follow-on async

      // Autopick MUST have landed. Because runAllTimersAsync drains
      // the entire pending queue and the autopick handler schedules
      // the NEXT pick's timer after success, this may cascade through
      // all draftOrder slots — that's fine; the assertion we care
      // about is that submitPick was called AT LEAST ONCE and the
      // FIRST call is the autopick from team-1's re-armed timer.
      expect(submitPickSpy).toHaveBeenCalled();
      const call = submitPickSpy.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(call.actor).toMatchObject({ kind: 'autopick' });
      expect(call.teamId).toBe('team-1');  // first slot on the clock
      expect(String(call.playerId)).toBe('8478001');
    } finally {
      logs.restore();
    }
  });

  it('CASE 4: fires 1ms LATE → accepted (no early-fire log)', async () => {
    const lobby = await makeLobby();
    const armedMs = Date.now() + 60_000;
    const armSeq = primeLobby(lobby, armedMs);
    const logs = captureLogs();
    try {
      await driveGuard(lobby, armSeq, armedMs, armedMs + 1);
      const earlyFireEntries = logs.entries.filter(
        (e) => e.event === 'autopick.stale_timer_skipped',
      );
      expect(earlyFireEntries).toHaveLength(0);
    } finally {
      logs.restore();
    }
  });

  it('CASE 5 (superseded): armSeq mismatch → INFO log timer_superseded, NO re-arm', async () => {
    const lobby = await makeLobby();
    const armedMs = Date.now() + 60_000;
    primeLobby(lobby, armedMs); // sets timerArmSeq=42
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const l = lobby as any;
    const beforeArmSeq = l.timerArmSeq as number;
    const logs = captureLogs();
    try {
      // Fire with armSeq=41 (stale — current is 42). Deadline is
      // late so wall-clock guard would pass; only identity guard
      // should trip.
      await driveGuard(lobby, 41, armedMs, armedMs + 100);
      const supersededInfos = logs.entries.filter(
        (e) =>
          e.event === 'autopick.stale_timer_skipped' &&
          e.level === 'info' &&
          (e.ctx as Record<string, unknown>).reason === 'timer_superseded',
      );
      expect(supersededInfos).toHaveLength(1);
      // No re-arm — timerArmSeq unchanged.
      const afterArmSeq = l.timerArmSeq as number;
      expect(afterArmSeq).toBe(beforeArmSeq);
    } finally {
      logs.restore();
    }
  });

  it('CASE 6 (F20 blocking amendment — CAP EXHAUSTED, FAIL OPEN, LIVENESS OUTCOME): 4th consecutive early fire → ERROR + AUTOPICK ACTUALLY LANDS', async () => {
    const submitPickSpy = vi.fn(
      async (_p: unknown): Promise<SubmitPickResult> => ({
        event_id: 1,
        seq: 1,
        pick_deadline: null,
        was_duplicate: false,
      }),
    );
    const lobby = await makeLobby(submitPickSpy);
    const armedMs = Date.now() + 60_000;
    let armSeq = primeLobby(lobby, armedMs);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const l = lobby as any;
    const logs = captureLogs();
    try {
      // Fires 1, 2, 3 — each 26ms early. All rejected and re-armed.
      // Because each re-arm calls setPickDeadline which bumps
      // timerArmSeq (via cancelPickTimer's +1 AND its own +1), we
      // capture the new value each iteration.
      for (let i = 0; i < 3; i++) {
        await driveGuard(lobby, armSeq, armedMs, armedMs - 26);
        armSeq = l.timerArmSeq as number;
        // Reset currentTimerHandle so the next iteration's re-arm
        // via setPickDeadline doesn't clearTimeout on a real handle
        // (which would double-fire in real life).
        l.currentTimerHandle = null;
      }
      expect(l.earlyFireRearmCount).toBe(3);
      expect(submitPickSpy).not.toHaveBeenCalled();  // No autopick yet.

      // Fire 4 — same armedDeadline, another 26ms early. Cap hits.
      // Fail-open falls through to normal autopick handling in-place
      // (no re-arm; the current handleClockExpired invocation runs
      // through to processAutopickTimeout).
      await driveGuard(lobby, armSeq, armedMs, armedMs - 26);
      // Drain any follow-on async work from the fail-open path.
      await vi.runAllTimersAsync();

      // Mechanism assertions.
      const errors = logs.entries.filter(
        (e) => e.event === 'autopick.early_fire_tolerance_exhausted',
      );
      expect(errors).toHaveLength(1);
      expect(errors[0].level).toBe('error');
      const ctx = errors[0].ctx as Record<string, unknown>;
      expect(ctx.consecutiveRearms).toBe(3);
      expect(ctx.action).toBe('proceeding_anyway');
      expect(l.earlyFireRearmCount).toBe(0);
      expect(l.earlyFireRearmForDeadlineMs).toBeNull();

      // *** OUTCOME ASSERTION (Amendment A) *** The pick MUST land.
      // If cap-exhaust logs ERROR but the pick doesn't actually fire,
      // the draft still dies — same failure at one remove. First call
      // is the autopick from fail-open; runAllTimersAsync may cascade
      // through the remaining draftOrder slots (also proves liveness
      // continues past the recovery).
      expect(submitPickSpy).toHaveBeenCalled();
      const submitCall = submitPickSpy.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(submitCall.actor).toMatchObject({ kind: 'autopick' });
      expect(submitCall.teamId).toBe('team-1');
      expect(String(submitCall.playerId)).toBe('8478001');
    } finally {
      logs.restore();
    }
  });

  it('CASE 7: a fresh setPickDeadline (different armedMs) resets the consecutive-rearm counter', async () => {
    const lobby = await makeLobby();
    const firstArmedMs = Date.now() + 60_000;
    let armSeq = primeLobby(lobby, firstArmedMs);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const l = lobby as any;
    const logs = captureLogs();
    try {
      // Two early fires against firstArmedMs → count = 2.
      for (let i = 0; i < 2; i++) {
        await driveGuard(lobby, armSeq, firstArmedMs, firstArmedMs - 26);
        armSeq = l.timerArmSeq as number;
        l.currentTimerHandle = null;
      }
      expect(l.earlyFireRearmCount).toBe(2);
      // Now an early fire against a DIFFERENT armedMs. Counter should
      // reset to 1 (this early fire is the first for the new
      // deadline).
      const secondArmedMs = Date.now() + 120_000;
      await driveGuard(lobby, armSeq, secondArmedMs, secondArmedMs - 26);
      expect(l.earlyFireRearmCount).toBe(1);
      expect(l.earlyFireRearmForDeadlineMs).toBe(secondArmedMs);
    } finally {
      logs.restore();
    }
  });

  it('CASE 8 (F21 log truth): guard log carries firedAtMs and armedMs as raw numbers, not just ISO strings', async () => {
    const lobby = await makeLobby();
    const armedMs = Date.now() + 60_000;
    const armSeq = primeLobby(lobby, armedMs);
    const logs = captureLogs();
    try {
      await driveGuard(lobby, armSeq, armedMs, armedMs - 26);
      const warns = logs.entries.filter(
        (e) => e.event === 'autopick.stale_timer_skipped' && e.level === 'warn',
      );
      expect(warns).toHaveLength(1);
      const ctx = warns[0].ctx as Record<string, unknown>;
      // The F21 fix: firedAtMs and armedMs are captured once at guard
      // time and reused for the log. driftMs === firedAtMs - armedMs
      // must hold exactly — no microsecond drift between the guard's
      // Date.now() and the log's Date.now() because there was only
      // ONE Date.now() call.
      expect(typeof ctx.firedAtMs).toBe('number');
      expect(typeof ctx.armedMs).toBe('number');
      expect(typeof ctx.driftMs).toBe('number');
      expect((ctx.firedAtMs as number) - (ctx.armedMs as number)).toBe(
        ctx.driftMs as number,
      );
    } finally {
      logs.restore();
    }
  });
});
