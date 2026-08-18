// ARCHITECT 2026-08-12 (LOBBY-WAIT / inbox E124) — the discovery
// failure path, split in two.
//
// FIELD EVIDENCE THIS TEST ENCODES. Opening the v2 room on a real
// staging league whose draft had not been started yet produced, in
// the browser, a red "Connection lost / Reconnecting in 1s — Draft is
// not active. Current status: not_started" banner over "Waiting for
// draft state…", and an endless ~2s loop of 409s against
// /api/drafts/:id/server (22 requests observed in the first sample,
// 11 more in a second 22s window, all 409). Instrumenting the page's
// own setTimeout showed the delays it scheduled: 832, 913, 953, 980,
// 994, 1005, 1008, 1054, 1074, 1127, 1138 ms — i.e. computeBackoffMs(0)
// with jitter, forever. The exponential curve never started.
//
// TWO DEFECTS, ONE LINE APART:
//   A. `not_started` was classified as a transient error. It is not an
//      error at all; the commissioner simply has not pressed START.
//      Eleven of THE TWELVE will see this state on draft night.
//   B. `handleTokenFetchFailed` passed `state.attempt` through
//      unchanged, and `handleBackoffTimerFired` preserves it on the
//      way back in, so the counter was pinned. Every discovery-path
//      failure — including a real API outage — retried at ~1Hz per
//      client with no escalation, which is the thundering herd
//      backoff.ts's own header says it exists to prevent.
//
// The tests below lock both halves: the waiting path must stay flat
// and calm, and the error path must escalate.

import { describe, it, expect } from 'vitest';
import { reduce } from '../reduce';
import {
  NOT_STARTED_POLL_MS,
  JITTER_FACTOR,
  INITIAL_BACKOFF_MS,
  MAX_BACKOFF_MS,
} from '../backoff';
import type { DraftClientState } from '../types';

const noJitter = () => 0.5; // (0.5*2-1)*F === 0 → exact delays
const fetchingToken = (attempt = 0): DraftClientState => ({
  kind: 'fetching_token',
  attempt,
});

const notStarted = (attempt = 0) =>
  reduce(
    fetchingToken(attempt),
    {
      type: 'token_fetch_failed',
      error: 'Draft is not active. Current status: not_started',
      statusCode: 409,
      draftStatus: 'not_started',
    },
    noJitter,
  );

const serverError = (attempt = 0) =>
  reduce(
    fetchingToken(attempt),
    { type: 'token_fetch_failed', error: 'boom', statusCode: 503 },
    noJitter,
  );

describe('A — not_started is a waiting state, not a failure', () => {
  it('flags the reconnecting state with waitingForStart', () => {
    const { state } = notStarted();
    expect(state.kind).toBe('reconnecting');
    if (state.kind !== 'reconnecting') throw new Error('unreachable');
    expect(state.waitingForStart).toBe(true);
  });

  it("2026-08-18: 'queued' (v1 lobby's ready-to-start marker) waits identically", () => {
    // Discovery 409s queued since CONNECTABLE_DRAFT_STATUSES dropped
    // it; a queued league is pre-ignition and must get the Start
    // lobby, not a reconnect loop (prod league 3327bc2e incident).
    const { state } = reduce(
      fetchingToken(),
      {
        type: 'token_fetch_failed',
        error: 'Draft is not active. Current status: queued',
        statusCode: 409,
        draftStatus: 'queued',
      },
      noJitter,
    );
    expect(state.kind).toBe('reconnecting');
    if (state.kind !== 'reconnecting') throw new Error('unreachable');
    expect(state.waitingForStart).toBe(true);
    expect(state.attempt).toBe(0);
  });

  it('carries no lastError — there is nothing wrong to report', () => {
    // The pre-fix banner rendered the raw server string at the user.
    const { state } = notStarted();
    if (state.kind !== 'reconnecting') throw new Error('unreachable');
    expect(state.lastError).toBeNull();
  });

  it('polls at NOT_STARTED_POLL_MS, not the backoff curve', () => {
    const { sideEffects } = notStarted();
    expect(sideEffects).toEqual([
      { kind: 'schedule_backoff_timer', delayMs: NOT_STARTED_POLL_MS },
    ]);
  });

  it('DOES NOT escalate — the tenth wait polls as fast as the first', () => {
    // The point of the whole branch: a manager who opened the room ten
    // minutes early must still enter promptly when START is pressed.
    const delays = [0, 1, 2, 3, 5, 8, 10].map((a) => {
      const { sideEffects } = notStarted(a);
      const eff = sideEffects[0];
      return eff.kind === 'schedule_backoff_timer' ? eff.delayMs : -1;
    });
    expect(new Set(delays)).toEqual(new Set([NOT_STARTED_POLL_MS]));
  });

  it('jitters the poll so twelve clients do not align on one tick', () => {
    const lo = reduce(fetchingToken(), {
      type: 'token_fetch_failed', error: 'x', statusCode: 409, draftStatus: 'not_started',
    }, () => 0);
    const hi = reduce(fetchingToken(), {
      type: 'token_fetch_failed', error: 'x', statusCode: 409, draftStatus: 'not_started',
    }, () => 1);
    const d = (r: typeof lo) =>
      r.sideEffects[0].kind === 'schedule_backoff_timer' ? r.sideEffects[0].delayMs : -1;
    expect(d(lo)).toBe(Math.round(NOT_STARTED_POLL_MS * (1 - JITTER_FACTOR)));
    expect(d(hi)).toBe(Math.round(NOT_STARTED_POLL_MS * (1 + JITTER_FACTOR)));
    expect(d(lo)).toBeLessThan(d(hi));
  });

  it('RESETS the error-escalation counter — a healthy 409 proves the API is up', () => {
    // Self-review addition (E139). A client that climbed to attempt 10
    // during an outage must not carry that penalty into its next real
    // error once the API is demonstrably answering again.
    const { state } = notStarted(10);
    if (state.kind !== 'reconnecting') throw new Error('unreachable');
    expect(state.attempt).toBe(0);
  });

  it('so the first real error AFTER a wait backs off from the bottom of the curve', () => {
    const waited = notStarted(10);
    if (waited.state.kind !== 'reconnecting') throw new Error('unreachable');
    const { sideEffects } = reduce(
      fetchingToken(waited.state.attempt),
      { type: 'token_fetch_failed', error: 'boom', statusCode: 503 },
      noJitter,
    );
    const eff = sideEffects[0];
    expect(eff.kind === 'schedule_backoff_timer' ? eff.delayMs : -1).toBe(2000);
  });

  it('only claims the branch on a 409 — a 500 that happens to mention a status still escalates', () => {
    const { state } = reduce(
      fetchingToken(),
      { type: 'token_fetch_failed', error: 'ise', statusCode: 500, draftStatus: 'not_started' },
      noJitter,
    );
    if (state.kind !== 'reconnecting') throw new Error('unreachable');
    expect(state.waitingForStart).toBeUndefined();
  });
});

describe('B — real discovery failures escalate (the pinned-counter bug)', () => {
  it('increments the attempt counter (pre-fix: passed through unchanged)', () => {
    const { state } = serverError(0);
    if (state.kind !== 'reconnecting') throw new Error('unreachable');
    expect(state.attempt).toBe(1);
  });

  it('produces the documented exponential curve across successive failures', () => {
    // Feed each failure's resulting attempt back in, exactly as the
    // real loop does via handleBackoffTimerFired (which preserves it).
    const seen: number[] = [];
    let attempt = 0;
    for (let i = 0; i < 8; i++) {
      const { state, sideEffects } = serverError(attempt);
      if (state.kind !== 'reconnecting') throw new Error('unreachable');
      const eff = sideEffects[0];
      seen.push(eff.kind === 'schedule_backoff_timer' ? eff.delayMs : -1);
      attempt = state.attempt;
    }
    expect(seen).toEqual([2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000]);
    // Sanity-tie to the module's own constants rather than magic numbers.
    expect(seen[0]).toBe(INITIAL_BACKOFF_MS * 2);
    expect(seen[seen.length - 1]).toBe(MAX_BACKOFF_MS);
  });

  it('caps the stored attempt at 10 so the counter cannot run away', () => {
    const { state } = serverError(50);
    if (state.kind !== 'reconnecting') throw new Error('unreachable');
    expect(state.attempt).toBe(10);
  });

  it('does not set waitingForStart on a real failure', () => {
    const { state } = serverError();
    if (state.kind !== 'reconnecting') throw new Error('unreachable');
    expect(state.waitingForStart).toBeUndefined();
    expect(state.lastError).toBe('boom');
  });

  it('leaves the 401/403 terminal branch untouched', () => {
    for (const statusCode of [401, 403]) {
      const { state } = reduce(
        fetchingToken(),
        { type: 'token_fetch_failed', error: 'nope', statusCode },
        noJitter,
      );
      expect(state.kind).toBe('fatal');
    }
  });

  it('a successful connect resets the escalation for free', () => {
    // currentAttempt() returns 0 outside fetching_token/connecting/
    // reconnecting, so one bad night never leaves a client slow.
    const { state } = reduce(
      { kind: 'connected', sessionId: 's', lastSeenSeq: 0 } as DraftClientState,
      { type: 'ws_closed', code: 1006, reason: 'abnormal' },
      noJitter,
    );
    if (state.kind !== 'reconnecting') throw new Error('unreachable');
    expect(state.attempt).toBe(1);
  });
});
