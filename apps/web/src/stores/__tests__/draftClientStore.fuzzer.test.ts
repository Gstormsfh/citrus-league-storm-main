// T2 (2026-08-08 third-shift) — INTEGRATION FUZZER for the full
// client draft pipeline. Extends S2's unit fuzzer beyond
// deriveDraftState.foldEvents to the real draftClientStore +
// optimistic-layer wiring.
//
// Invariants asserted (per architect T2 directive):
//   INV-A: never throws (INV-1 from S2 at store level)
//   INV-B: idempotent under duplicates (INV-2 from S2 at store level)
//   INV-C: terminal states absorbing at store level
//   INV-D: no stuck optimistic entries (broadcast fires → correlationId
//          removed from pendingActions map)
//   INV-E: no duplicate render state (setSnapshot re-derives cleanly;
//          derivedState after applyEvents(A) === derivedState after
//          setSnapshot({recentEvents: A}))
//
// ≥10,000 sequences per invariant. Offline, no network, no DB.
//
// This is the integration coverage the unit tests cannot give:
// exercises the store's applyEvent (which wraps foldEvents + snapshot
// mutation + optimistic reconciliation), NOT foldEvents in isolation.

import { describe, it, expect, beforeEach } from 'vitest';
import type { BufferedDraftEvent, DraftFormat, DraftSnapshot } from '@citrus/shared';
import { useDraftClientStore } from '../draftClientStore';

// ── Seedable PRNG (mulberry32) ─────────────────────────────────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Fixture ────────────────────────────────────────────────────────
const TEAMS_12 = Array.from({ length: 12 }, (_, i) => `team-${i + 1}`);
const ROUNDS_3 = 3;

function makeSnakeMatrix() {
  const slots: Array<{ round: number; pickNumber: number; teamId: string }> = [];
  let pickNumber = 1;
  for (let round = 1; round <= ROUNDS_3; round++) {
    const reverse = round % 2 === 0;
    const ordered = reverse ? [...TEAMS_12].reverse() : [...TEAMS_12];
    for (const teamId of ordered) {
      slots.push({ round, pickNumber, teamId });
      pickNumber++;
    }
  }
  return slots;
}
const MATRIX = makeSnakeMatrix();

function makeSnapshot(): DraftSnapshot {
  return {
    lobbyId: 'league-fuzz',
    format: 'snake' as DraftFormat,
    stateSnapshot: {
      draftStatus: 'not_started',
      picksMade: 0,
      totalPicks: TEAMS_12.length * ROUNDS_3,
      onClockTeamId: null,
      currentPickDeadline: null,
      currentPickNumber: null,
      currentRoundNumber: null,
    },
    recentEvents: [],
    presentUserIds: [],
  } as DraftSnapshot;
}

function makePickEvent(seq: number, slot: typeof MATRIX[0], corrIndex: number): BufferedDraftEvent {
  return {
    kind: 'pick_submitted',
    seq,
    timestamp: `2026-08-08T00:00:${String(seq % 60).padStart(2, '0')}.000Z`,
    teamId: slot.teamId,
    playerId: 8478000 + corrIndex,
    roundNumber: slot.round,
    pickNumber: slot.pickNumber,
    correlationId: `corr-${seq}`,
  };
}

function makeDraftStarted(seq: number): BufferedDraftEvent {
  return {
    kind: 'draft_started',
    seq,
    timestamp: `2026-08-08T00:00:${String(seq % 60).padStart(2, '0')}.000Z`,
    correlationId: `s-${seq}`,
    startedAt: '2026-08-08T00:00:00.000Z',
    firstPickDeadline: '2026-08-08T00:00:30.000Z',
    totalRounds: ROUNDS_3,
    totalTeams: TEAMS_12.length,
    pickTimeLimitSeconds: 30,
    draftFormat: 'snake' as DraftFormat,
  };
}

function makeDraftCompleted(seq: number): BufferedDraftEvent {
  return {
    kind: 'draft_completed',
    seq,
    timestamp: `2026-08-08T00:00:${String(seq % 60).padStart(2, '0')}.000Z`,
    correlationId: `c-${seq}`,
    completedAt: '2026-08-08T00:00:00.000Z',
    totalPicks: TEAMS_12.length * ROUNDS_3,
  };
}

function makeUnknown(seq: number): BufferedDraftEvent {
  return {
    kind: `future_${seq % 4}`,
    seq,
    timestamp: `2026-08-08T00:00:${String(seq % 60).padStart(2, '0')}.000Z`,
  } as unknown as BufferedDraftEvent;
}

interface GenResult {
  events: BufferedDraftEvent[];
  seed: number;
}

// Sequence generator (adapted from S2 to be more realistic wire flow
// — no shuffling for integration tests; store expects TCP-ordered
// stream).
function generateSequence(seed: number): GenResult {
  const rand = mulberry32(seed);
  const hasStarted = rand() < 0.9;
  const pickCount = Math.floor(rand() * (TEAMS_12.length * ROUNDS_3 + 3));
  const hasCompleted = rand() < 0.5 && pickCount > 0;
  const dupeCount = Math.floor(rand() * 3);
  const unkCount = Math.floor(rand() * 2);

  let seq = 1;
  const events: BufferedDraftEvent[] = [];

  if (hasStarted) events.push(makeDraftStarted(seq++));

  for (let i = 0; i < Math.min(pickCount, MATRIX.length); i++) {
    events.push(makePickEvent(seq++, MATRIX[i], i));
  }

  if (hasCompleted) events.push(makeDraftCompleted(seq++));

  // Duplicates at same seq (F27b-2 wire pattern).
  for (let i = 0; i < dupeCount; i++) {
    if (events.length === 0) break;
    const idx = Math.floor(rand() * events.length);
    events.push({ ...events[idx] });
  }

  // Unknown kinds at new seqs.
  for (let i = 0; i < unkCount; i++) {
    events.push(makeUnknown(seq++));
  }

  return { events, seed };
}

// Silence debug logs from deriveDraftState absorbing guard + default
// clause (fuzz generates many).
function withSilencedDebug<T>(fn: () => T): T {
  const originalDebug = console.debug;
  console.debug = () => undefined;
  try {
    return fn();
  } finally {
    console.debug = originalDebug;
  }
}

// Reset store between test runs to prevent state leakage.
beforeEach(() => {
  useDraftClientStore.getState().reset();
});

// ── INV-A: store never throws ──────────────────────────────────────
describe('T2 store fuzzer — INV-A: applyEvent never throws under adversarial input', () => {
  it('10000 random sequences: setSnapshot + applyEvent chain never throws', () => {
    withSilencedDebug(() => {
      let violations = 0;
      const sampleViolations: Array<{ seed: number; err: string }> = [];
      for (let seed = 1; seed <= 10_000; seed++) {
        try {
          const store = useDraftClientStore.getState();
          store.reset();
          store.setSnapshot(makeSnapshot());
          const { events } = generateSequence(seed);
          for (const ev of events) {
            store.applyEvent(ev);
          }
        } catch (err) {
          violations++;
          if (sampleViolations.length < 5) {
            sampleViolations.push({ seed, err: (err as Error).message ?? String(err) });
          }
        }
      }
      if (violations > 0) {
        expect(violations, `${violations} throws; first-5:\n${JSON.stringify(sampleViolations, null, 2)}`).toBe(0);
      }
      expect(violations).toBe(0);
    });
  }, 60_000);
});

// ── INV-B: idempotent under duplicates (store level) ───────────────
describe('T2 store fuzzer — INV-B: store state after applyEvent(A) == after applyEvent(A++A)', () => {
  it('10000 sequences: derivedState identical when duplicates re-applied', () => {
    withSilencedDebug(() => {
      let violations = 0;
      const sampleViolations: Array<{ seed: number; diff: string }> = [];
      for (let seed = 1; seed <= 10_000; seed++) {
        const { events } = generateSequence(seed);

        // Path 1: apply events once.
        useDraftClientStore.getState().reset();
        useDraftClientStore.getState().setSnapshot(makeSnapshot());
        for (const ev of events) useDraftClientStore.getState().applyEvent(ev);
        const state1 = useDraftClientStore.getState().derivedState;

        // Path 2: apply events twice.
        useDraftClientStore.getState().reset();
        useDraftClientStore.getState().setSnapshot(makeSnapshot());
        for (const ev of [...events, ...events]) useDraftClientStore.getState().applyEvent(ev);
        const state2 = useDraftClientStore.getState().derivedState;

        // derivedState should be identical (idempotent via foldEvents outer
        // seq guard). Note: snapshot.recentEvents diverges (store appends
        // duplicates unconditionally — F28-L4 docketed finding), but the
        // DERIVED-state fold is idempotent.
        if (state1?.picksMade !== state2?.picksMade
            || state1?.draftStatus !== state2?.draftStatus
            || state1?.foldedThroughSeq !== state2?.foldedThroughSeq) {
          violations++;
          if (sampleViolations.length < 5) {
            sampleViolations.push({
              seed,
              diff: `picksMade: ${state1?.picksMade} vs ${state2?.picksMade} | status: ${state1?.draftStatus} vs ${state2?.draftStatus} | folded: ${state1?.foldedThroughSeq} vs ${state2?.foldedThroughSeq}`,
            });
          }
        }
      }
      if (violations > 0) {
        expect(violations, `${violations} store-idempotency violations; first-5:\n${JSON.stringify(sampleViolations, null, 2)}`).toBe(0);
      }
      expect(violations).toBe(0);
    });
  }, 60_000);
});

// ── INV-C: terminal states absorbing at store level ────────────────
describe('T2 store fuzzer — INV-C: once derivedState terminal, applyEvent cannot un-complete', () => {
  it('10000 sequences: after terminal, subsequent applyEvent leaves status unchanged', () => {
    withSilencedDebug(() => {
      let violations = 0;
      const sampleViolations: Array<{ seed: number; msg: string }> = [];
      for (let seed = 1; seed <= 10_000; seed++) {
        const { events } = generateSequence(seed);
        useDraftClientStore.getState().reset();
        useDraftClientStore.getState().setSnapshot(makeSnapshot());
        let sawTerminal = false;
        for (const ev of events) {
          const before = useDraftClientStore.getState().derivedState?.draftStatus;
          useDraftClientStore.getState().applyEvent(ev);
          const after = useDraftClientStore.getState().derivedState?.draftStatus;
          if (sawTerminal && after !== before) {
            violations++;
            if (sampleViolations.length < 5) {
              sampleViolations.push({
                seed,
                msg: `terminal-escape at ev.kind=${ev.kind} ev.seq=${ev.seq}: ${before} → ${after}`,
              });
            }
            break;
          }
          if (after === 'completed' || after === 'cancelled') sawTerminal = true;
        }
      }
      if (violations > 0) {
        expect(violations, `${violations} terminal-escape violations; first-5:\n${JSON.stringify(sampleViolations, null, 2)}`).toBe(0);
      }
      expect(violations).toBe(0);
    });
  }, 60_000);
});

// ── INV-D: optimistic layer — no stuck pending entries ─────────────
describe('T2 store fuzzer — INV-D: recordPending + applyEvent(broadcast) removes from pendingActions', () => {
  it('10000 sequences: for every recordPending, matching event.correlationId broadcast clears the entry', () => {
    withSilencedDebug(() => {
      let violations = 0;
      const sampleViolations: Array<{ seed: number; msg: string }> = [];
      for (let seed = 1; seed <= 10_000; seed++) {
        useDraftClientStore.getState().reset();
        useDraftClientStore.getState().setSnapshot(makeSnapshot());

        const rand = mulberry32(seed);
        // Generate pick events + record a pending action for each with
        // matching correlationId. Then apply the events. Post-apply,
        // pendingActions map should be empty (all broadcast).
        const pickCount = 1 + Math.floor(rand() * 8);
        const events: BufferedDraftEvent[] = [makeDraftStarted(1)];
        for (let i = 0; i < pickCount && i < MATRIX.length; i++) {
          const ev = makePickEvent(i + 2, MATRIX[i], i);
          events.push(ev);
          useDraftClientStore.getState().recordPending({
            correlationId: ev.correlationId,
            teamId: (ev as { teamId: string }).teamId,
            playerId: (ev as { playerId: number }).playerId,
            pickNumber: (ev as { pickNumber: number }).pickNumber,
            roundNumber: (ev as { roundNumber: number }).roundNumber,
            submittedAt: Date.now(),
          });
        }

        // Apply all events (broadcasts arrive).
        for (const ev of events) useDraftClientStore.getState().applyEvent(ev);

        const remaining = useDraftClientStore.getState().pendingActions.size;
        if (remaining !== 0) {
          violations++;
          if (sampleViolations.length < 5) {
            sampleViolations.push({
              seed,
              msg: `pendingActions.size=${remaining} (expected 0) after ${pickCount} broadcasts`,
            });
          }
        }
      }
      if (violations > 0) {
        expect(violations, `${violations} stuck-optimistic violations; first-5:\n${JSON.stringify(sampleViolations, null, 2)}`).toBe(0);
      }
      expect(violations).toBe(0);
    });
  }, 60_000);
});

// ── INV-E: setSnapshot re-derives cleanly (no duplicate render state) ─
describe('T2 store fuzzer — INV-E: setSnapshot re-derive matches applyEvent chain', () => {
  it('10000 sequences: setSnapshot with recentEvents = full stream produces same derivedState as applyEvent chain', () => {
    withSilencedDebug(() => {
      let violations = 0;
      const sampleViolations: Array<{ seed: number; diff: string }> = [];
      for (let seed = 1; seed <= 10_000; seed++) {
        const { events } = generateSequence(seed);

        // Path 1: setSnapshot(empty) then applyEvent chain.
        useDraftClientStore.getState().reset();
        useDraftClientStore.getState().setSnapshot(makeSnapshot());
        for (const ev of events) useDraftClientStore.getState().applyEvent(ev);
        const state1 = useDraftClientStore.getState().derivedState;

        // Path 2: setSnapshot with all events as recentEvents.
        useDraftClientStore.getState().reset();
        const snapWithEvents = { ...makeSnapshot(), recentEvents: events };
        useDraftClientStore.getState().setSnapshot(snapWithEvents);
        const state2 = useDraftClientStore.getState().derivedState;

        if (state1?.picksMade !== state2?.picksMade
            || state1?.draftStatus !== state2?.draftStatus
            || state1?.foldedThroughSeq !== state2?.foldedThroughSeq) {
          violations++;
          if (sampleViolations.length < 5) {
            sampleViolations.push({
              seed,
              diff: `picksMade: ${state1?.picksMade} vs ${state2?.picksMade} | status: ${state1?.draftStatus} vs ${state2?.draftStatus} | folded: ${state1?.foldedThroughSeq} vs ${state2?.foldedThroughSeq}`,
            });
          }
        }
      }
      if (violations > 0) {
        expect(violations, `${violations} setSnapshot-re-derive divergence; first-5:\n${JSON.stringify(sampleViolations, null, 2)}`).toBe(0);
      }
      expect(violations).toBe(0);
    });
  }, 60_000);
});
