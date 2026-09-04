// S2 (2026-08-08 evening architect directive) — frame-sequence fuzzer.
//
// Generator produces random wire-event sequences and asserts FOUR
// invariants on `deriveDraftState.foldEvents`:
//
//   INV-1: never throws
//   INV-2: idempotent under duplicates
//          fold(events) == fold(events ++ events)
//          (repeated events at same seq are skipped by outer guard)
//   INV-3: terminal states absorbing
//          any event on a terminal-state input leaves status
//          unchanged; foldedThroughSeq still advances
//   INV-4: fold is associative under sequential batches
//          fold(A ++ B) == fold(fold(A), B)
//          (state is a pure function of the seq-ordered event stream;
//          batching doesn't matter)
//
// Runs 10,000+ random sequences per invariant. Any violation is a real
// F28 bug found today instead of on draft night.
//
// Uses seedable PRNG so failures are reproducible. Seed is logged on
// any assertion failure. Test itself is offline (no network, no DB).

import { describe, it, expect } from 'vitest';
import type { BufferedDraftEvent, DraftFormat } from '@citrus/shared';
import {
  emptyDerivedState,
  foldEvents,
  type DerivationSeed,
  type DerivedDraftState,
} from '../deriveDraftState';
import type { DraftOrderSlot } from '../fetchDraftOrderMatrix';

// ── Seedable PRNG (mulberry32, tiny + deterministic) ───────────────
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

// ── Test fixture ───────────────────────────────────────────────────
const TEAMS_12 = Array.from({ length: 12 }, (_, i) => `team-${i + 1}`);
const ROUNDS_3 = 3;
const TOTAL_PICKS = TEAMS_12.length * ROUNDS_3; // 36

const SEED_12x3: DerivationSeed = {
  totalPicks: TOTAL_PICKS,
  format: 'snake',
};

function makeSnakeMatrix(): DraftOrderSlot[] {
  const slots: DraftOrderSlot[] = [];
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

// ── Event generators (parametrized by PRNG rand + seq) ─────────────
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
    totalPicks: TOTAL_PICKS,
  };
}

function makePickFromSlot(seq: number, slot: DraftOrderSlot, playerIdBase: number): BufferedDraftEvent {
  return {
    kind: 'pick_submitted',
    seq,
    timestamp: `2026-08-08T00:00:${String(seq % 60).padStart(2, '0')}.000Z`,
    teamId: slot.teamId,
    playerId: playerIdBase,
    roundNumber: slot.round,
    pickNumber: slot.pickNumber,
    correlationId: `p-${seq}`,
  };
}

function makeUnknownKind(seq: number): BufferedDraftEvent {
  return {
    kind: `future_variant_${seq % 5}`,
    seq,
    timestamp: `2026-08-08T00:00:${String(seq % 60).padStart(2, '0')}.000Z`,
  } as unknown as BufferedDraftEvent;
}

// ── Sequence generator ─────────────────────────────────────────────
// Produces a "realistic-ish" wire stream with adversarial noise:
// - a proper draft_started at seq 1 (usually)
// - N pick events at seq 2..N+1 in monotonic order
// - maybe a draft_completed at seq N+2
// - RANDOM injections: duplicates, unknown kinds, out-of-order (via
//   sorting AFTER injection or NOT sorting to test the gap guard)
function generateSequence(seed: number): {
  events: BufferedDraftEvent[];
  meta: {
    seed: number;
    injectedDuplicates: number;
    injectedUnknown: number;
    outOfOrderShuffled: boolean;
    hasDraftStarted: boolean;
    hasDraftCompleted: boolean;
    pickCount: number;
  };
} {
  const rand = mulberry32(seed);

  const hasDraftStarted = rand() < 0.9;
  const pickCount = Math.floor(rand() * (TOTAL_PICKS + 5)); // 0..40
  const hasDraftCompleted = rand() < 0.5;

  let seq = 1;
  const events: BufferedDraftEvent[] = [];

  if (hasDraftStarted) {
    events.push(makeDraftStarted(seq++));
  }

  for (let i = 0; i < Math.min(pickCount, TOTAL_PICKS); i++) {
    const slot = MATRIX[i];
    events.push(makePickFromSlot(seq++, slot, 8478000 + i));
  }
  // Overshoot picks past matrix bounds don't matter for the fuzzer's
  // invariants; the terminal guard + picksMade>=totalPicks handle it.

  if (hasDraftCompleted) {
    events.push(makeDraftCompleted(seq++));
  }

  // Injected duplicates: 0-3 events cloned at their same seq.
  const dupeCount = Math.floor(rand() * 4);
  const injectedDuplicates = dupeCount > 0 && events.length > 0 ? dupeCount : 0;
  for (let i = 0; i < injectedDuplicates; i++) {
    const idx = Math.floor(rand() * events.length);
    // Clone by cloning the original event at the SAME seq — matches
    // F27b-2 wire-duplicate class.
    events.push({ ...events[idx] });
  }

  // Injected unknown kinds: 0-2 events with a bogus kind at NEW seqs.
  const unkCount = Math.floor(rand() * 3);
  for (let i = 0; i < unkCount; i++) {
    events.push(makeUnknownKind(seq++));
  }

  // Out-of-order shuffle: 25% chance. Fisher-Yates using the PRNG.
  const outOfOrderShuffled = rand() < 0.25;
  if (outOfOrderShuffled) {
    for (let i = events.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [events[i], events[j]] = [events[j], events[i]];
    }
  }

  return {
    events,
    meta: {
      seed,
      injectedDuplicates,
      injectedUnknown: unkCount,
      outOfOrderShuffled,
      hasDraftStarted,
      hasDraftCompleted,
      pickCount: Math.min(pickCount, TOTAL_PICKS),
    },
  };
}

// ── Silence debug logs (fuzz runs generate many) ───────────────────
function withSilencedDebug<T>(fn: () => T): T {
  const original = console.debug;
  console.debug = () => undefined;
  try {
    return fn();
  } finally {
    console.debug = original;
  }
}

// ── Assertion helper with seed-in-error for reproducibility ────────
function assertWithSeed(seed: number, expr: boolean, msg: string): void {
  if (!expr) {
    throw new Error(`Fuzzer invariant violation @ seed=${seed}: ${msg}`);
  }
}

// ── INV-1: never throws ────────────────────────────────────────────
describe('S2 fuzzer — INV-1: foldEvents never throws under adversarial input', () => {
  it('10000 random sequences all fold without throwing', () => {
    withSilencedDebug(() => {
      let violations = 0;
      const violationsSample: Array<{ seed: number; error: string }> = [];
      for (let seed = 1; seed <= 10_000; seed++) {
        const { events, meta } = generateSequence(seed);
        try {
          foldEvents(emptyDerivedState(SEED_12x3), events, MATRIX);
        } catch (err) {
          violations++;
          if (violationsSample.length < 5) {
            violationsSample.push({
              seed,
              error: (err as Error).message ?? String(err),
            });
          }
          void meta;
        }
      }
      if (violations > 0) {
        // Fail with first-5-sample seeds so failures are reproducible.
        expect(violations, `${violations} throws found; first-5 seeds:\n${JSON.stringify(violationsSample, null, 2)}`).toBe(0);
      }
      expect(violations).toBe(0);
    });
  }, /* timeout */ 60_000);
});

// ── INV-2: idempotent under duplicates ─────────────────────────────
// fold(events) == fold(events ++ events)
// (repeated events at same seq are skipped by the outer guard)
describe('S2 fuzzer — INV-2: foldEvents is idempotent under duplicate replay', () => {
  it('10000 random sequences: fold(A) == fold(A ++ A)', () => {
    withSilencedDebug(() => {
      let violations = 0;
      const violationsSample: Array<{ seed: number; diff: string }> = [];
      for (let seed = 1; seed <= 10_000; seed++) {
        const { events } = generateSequence(seed);
        const s1 = foldEvents(emptyDerivedState(SEED_12x3), events, MATRIX).state;
        const s2 = foldEvents(
          emptyDerivedState(SEED_12x3),
          [...events, ...events],
          MATRIX,
        ).state;
        const eq = statesEqual(s1, s2);
        // Explicit `=== false` rather than `!eq.ok`: tsconfig.app.json still
        // has strictNullChecks off, and truthiness alone does not narrow
        // this boolean-discriminated union to the branch carrying `diff`.
        if (eq.ok === false) {
          violations++;
          if (violationsSample.length < 5) {
            violationsSample.push({ seed, diff: eq.diff });
          }
        }
      }
      if (violations > 0) {
        expect(violations, `${violations} duplicate-idempotency violations; first-5 seeds:\n${JSON.stringify(violationsSample, null, 2)}`).toBe(0);
      }
      expect(violations).toBe(0);
    });
  }, 60_000);
});

// ── INV-3: terminal states absorbing ───────────────────────────────
describe('S2 fuzzer — INV-3: terminal states absorb every subsequent frame', () => {
  it('10000 sequences: after entering completed/cancelled, no event flips status back', () => {
    withSilencedDebug(() => {
      let violations = 0;
      const violationsSample: Array<{ seed: number; msg: string }> = [];
      for (let seed = 1; seed <= 10_000; seed++) {
        const { events } = generateSequence(seed);
        // Prime: run each event one at a time; whenever draftStatus
        // enters terminal, every subsequent step MUST leave it there.
        let state = emptyDerivedState(SEED_12x3);
        let sawTerminal = false;
        for (const ev of events) {
          const prev = state.draftStatus;
          const { state: next } = foldEvents(state, [ev], MATRIX);
          if (sawTerminal && next.draftStatus !== prev) {
            violations++;
            if (violationsSample.length < 5) {
              violationsSample.push({
                seed,
                msg: `terminal-escape: prev=${prev} next=${next.draftStatus} on ev.kind=${ev.kind} ev.seq=${ev.seq}`,
              });
            }
            break;
          }
          if (next.draftStatus === 'completed' || next.draftStatus === 'cancelled') {
            sawTerminal = true;
          }
          state = next;
        }
      }
      if (violations > 0) {
        expect(violations, `${violations} terminal-escape violations; first-5 seeds:\n${JSON.stringify(violationsSample, null, 2)}`).toBe(0);
      }
      expect(violations).toBe(0);
    });
  }, 60_000);
});

// ── INV-4: fold is associative under sequential batches (NARROWED) ─
// Original formulation: fold(A ++ B) == fold(fold(A), B) universally.
//
// **FUZZER FINDING 2026-08-08:** original INV-4 fails 195/10000 with
// unsorted (adversarial-shuffled) streams. The failure is NOT a bug —
// it's the intended gap-halt semantic diverging between the combined
// and split paths:
//
//   Combined fold([seq=5, seq=1]) — first event seq=5 fails
//   expectedNext=1 gap-check → break; foldedThroughSeq=0.
//   Second event never processed.
//
//   Split fold([seq=5]) → halt at seq 5 gap-check; state has
//   foldedThroughSeq=0. Then fold(state, [seq=1]) → first event
//   seq=1 matches expectedNext=1 → processes. Result diverges.
//
// The gap-halt "STOPS the fold" is deliberate per deriveDraftState.ts
// :184-196 (runner resyncs to fill gap before continuing). Batch-vs-
// single-event equivalence is NOT a fold guarantee under shuffling.
//
// **RESOLUTION:** narrow the invariant to the REALISTIC wire pattern
// — foldEvents is only exercised in monotonic seq order via the
// runner's wire pipeline (reduce.ts orders by dispatch order; WS is
// TCP-ordered per connection). Non-shuffled fuzzer sequences MUST be
// associative. Shuffled sequences are informative but not correctness
// invariants.
describe('S2 fuzzer — INV-4: fold associative on monotonic-seq streams (narrowed)', () => {
  it('10000 sequences: on monotonic-seq streams, fold(A++B) == fold(fold(A), B)', () => {
    withSilencedDebug(() => {
      let violations = 0;
      let skipped = 0;
      const violationsSample: Array<{ seed: number; diff: string; split: number }> = [];
      for (let seed = 1; seed <= 10_000; seed++) {
        const { events, meta } = generateSequence(seed);
        if (events.length < 2) { skipped++; continue; }
        // Only test the realistic wire pattern — monotonic seq order.
        if (meta.outOfOrderShuffled) { skipped++; continue; }
        const rand = mulberry32(seed ^ 0x9e3779b9);
        const split = 1 + Math.floor(rand() * (events.length - 1));
        const A = events.slice(0, split);
        const B = events.slice(split);
        const combined = foldEvents(emptyDerivedState(SEED_12x3), events, MATRIX).state;
        const stepA = foldEvents(emptyDerivedState(SEED_12x3), A, MATRIX).state;
        const stepAB = foldEvents(stepA, B, MATRIX).state;
        const eq = statesEqual(combined, stepAB);
        // Explicit `=== false` rather than `!eq.ok`: tsconfig.app.json still
        // has strictNullChecks off, and truthiness alone does not narrow
        // this boolean-discriminated union to the branch carrying `diff`.
        if (eq.ok === false) {
          violations++;
          if (violationsSample.length < 5) {
            violationsSample.push({ seed, diff: eq.diff, split });
          }
        }
      }
      if (violations > 0) {
        expect(violations, `${violations} associativity violations on monotonic streams (${skipped} shuffled skipped); first-5 seeds:\n${JSON.stringify(violationsSample, null, 2)}`).toBe(0);
      }
      expect(violations).toBe(0);
    });
  }, 60_000);
});

// ── INV-4-EXTENDED (informational): shuffle divergence census ─────
// Not a hard assertion — measures how often the gap-halt semantic
// causes combined-vs-split divergence under adversarial shuffling.
// Provides a canary for future fold refactors: if the divergence
// count changes dramatically, gap-halt semantics have shifted.
describe('S2 fuzzer — INV-4-EXTENDED: gap-halt divergence census under shuffling', () => {
  it('shuffled streams: divergence rate stays within historical range', () => {
    withSilencedDebug(() => {
      let divergences = 0;
      let shuffledCount = 0;
      for (let seed = 1; seed <= 10_000; seed++) {
        const { events, meta } = generateSequence(seed);
        if (events.length < 2 || !meta.outOfOrderShuffled) continue;
        shuffledCount++;
        const rand = mulberry32(seed ^ 0x9e3779b9);
        const split = 1 + Math.floor(rand() * (events.length - 1));
        const A = events.slice(0, split);
        const B = events.slice(split);
        const combined = foldEvents(emptyDerivedState(SEED_12x3), events, MATRIX).state;
        const stepA = foldEvents(emptyDerivedState(SEED_12x3), A, MATRIX).state;
        const stepAB = foldEvents(stepA, B, MATRIX).state;
        if (!statesEqual(combined, stepAB).ok) divergences++;
      }
      const rate = shuffledCount > 0 ? divergences / shuffledCount : 0;
      // Historical baseline from this fuzzer's first run: ~195/2500
      // shuffled = ~8%. Assert rate stays below 20% — a dramatic
      // increase suggests fold semantics changed unexpectedly.
      console.info(`[S2 fuzzer INV-4-EXTENDED] shuffled divergence: ${divergences}/${shuffledCount} = ${(rate * 100).toFixed(1)}%`);
      expect(rate).toBeLessThan(0.20);
    });
  }, 60_000);
});

// ── Deep-equality helper for DerivedDraftState ─────────────────────
function statesEqual(
  a: DerivedDraftState,
  b: DerivedDraftState,
): { ok: true } | { ok: false; diff: string } {
  const diffs: string[] = [];
  if (a.picksMade !== b.picksMade) diffs.push(`picksMade: ${a.picksMade} vs ${b.picksMade}`);
  if (a.draftStatus !== b.draftStatus) diffs.push(`draftStatus: ${a.draftStatus} vs ${b.draftStatus}`);
  if (a.foldedThroughSeq !== b.foldedThroughSeq) diffs.push(`foldedThroughSeq: ${a.foldedThroughSeq} vs ${b.foldedThroughSeq}`);
  if (a.onClockTeamId !== b.onClockTeamId) diffs.push(`onClockTeamId: ${a.onClockTeamId} vs ${b.onClockTeamId}`);
  if (a.currentPickNumber !== b.currentPickNumber) diffs.push(`currentPickNumber: ${a.currentPickNumber} vs ${b.currentPickNumber}`);
  if (a.currentRoundNumber !== b.currentRoundNumber) diffs.push(`currentRoundNumber: ${a.currentRoundNumber} vs ${b.currentRoundNumber}`);
  // teamRosters: content equality
  const aRosters = Array.from(a.teamRosters.entries()).sort(([k1], [k2]) => k1.localeCompare(k2));
  const bRosters = Array.from(b.teamRosters.entries()).sort(([k1], [k2]) => k1.localeCompare(k2));
  if (JSON.stringify(aRosters) !== JSON.stringify(bRosters)) {
    diffs.push(`teamRosters: ${JSON.stringify(aRosters)} vs ${JSON.stringify(bRosters)}`);
  }
  return diffs.length === 0
    ? { ok: true }
    : { ok: false, diff: diffs.join(' | ') };
}
