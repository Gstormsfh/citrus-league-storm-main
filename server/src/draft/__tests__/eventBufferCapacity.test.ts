/**
 * RECONNECT (2026-08-12) — the blank-board regression.
 *
 * The defect: `EVENT_BUFFER_CAPACITY` was a flat 200 while a 12-team
 * league at the DEFAULT roster size of 21 emits 253 events. Eviction
 * began around pick 200 — round 17 of 21 — and because the mid-draft
 * snapshot carries only `recentEvents` (the authoritative `picks` array
 * is attached for TERMINAL drafts only), a reconnecting client had to
 * fold a sequence that no longer started at seq 1. `deriveDraftState`
 * correctly refuses to fold across a gap, so the room rendered
 * picksMade=0, draftStatus='not_started', empty rosters: a blank board,
 * mid-draft, in the last five rounds.
 *
 * Why THESE tests and not "capacity === 500": the commissioner picks the
 * round count on the night of the draft. Any assertion on a fixed number
 * re-encodes the original mistake — it just moves the cliff. What must
 * hold is the RELATIONSHIP: the buffer always outlasts the draft it
 * belongs to.
 *
 * Mutation-checked. Each of these kills at least one mutant:
 *   - `Math.max(MIN, ...)` -> `Math.min(MIN, ...)`  → killed by the
 *     21-round and 25-round cases (they'd collapse to 200).
 *   - dropping `+ EVENT_BUFFER_HEADROOM`             → killed by
 *     'holds every event of a full 12x21 draft' (253 > 252).
 *   - dropping the `isFinite` guard                  → killed by the
 *     NaN/Infinity case (NaN capacity throws in RingBuffer).
 *   - returning `totalPicks` alone                   → killed by the
 *     floor cases.
 *
 * An earlier `totalPicks <= 0` guard was removed: mutating it to `< 0`
 * killed no test, and correctly so — Math.max already rescues 0 and
 * negatives identically, so the branch could not change any output. An
 * equivalent mutant, not a test hole.
 */

import { describe, it, expect } from 'vitest';
import { eventBufferCapacityFor } from '../LobbyManager';
import { RingBuffer } from '../RingBuffer';

/** Lifecycle events that share the buffer with picks. */
const DRAFT_STARTED = 1;

describe('eventBufferCapacityFor — the floor', () => {
  it('falls back to the 200 floor for an empty draft order', () => {
    // Auction lobbies pre-nomination, and rigs mid-construction, are
    // constructed with an empty order. They must not get a 64-event
    // buffer.
    expect(eventBufferCapacityFor(0)).toBe(200);
  });

  it('falls back to the floor for negative, NaN and Infinity', () => {
    expect(eventBufferCapacityFor(-1)).toBe(200);
    expect(eventBufferCapacityFor(Number.NaN)).toBe(200);
    expect(eventBufferCapacityFor(Number.POSITIVE_INFINITY)).toBe(200);
  });

  it('never returns less than the old constant, for any shape', () => {
    // The change must be strictly non-regressive: no league that worked
    // before gets a SMALLER buffer now.
    for (const picks of [0, 1, 12, 60, 100, 135, 136, 200, 252, 300, 1000]) {
      expect(eventBufferCapacityFor(picks)).toBeGreaterThanOrEqual(200);
    }
  });
});

describe('eventBufferCapacityFor — the relationship that matters', () => {
  const SHAPES: ReadonlyArray<{ teams: number; rounds: number; label: string }> = [
    { teams: 12, rounds: 12, label: "THE TWELVE, 12 rounds (the shape E142 was certified at)" },
    { teams: 12, rounds: 21, label: 'THE TWELVE at the DEFAULT roster size — the live defect' },
    { teams: 12, rounds: 25, label: 'a deep keeper league' },
    { teams: 20, rounds: 21, label: 'the largest league shape seen on staging' },
    { teams: 2, rounds: 3, label: 'a two-team test rig' },
  ];

  for (const { teams, rounds, label } of SHAPES) {
    it(`holds every event of a full ${teams}x${rounds} draft — ${label}`, () => {
      const totalPicks = teams * rounds;
      const totalEvents = totalPicks + DRAFT_STARTED;
      expect(eventBufferCapacityFor(totalPicks)).toBeGreaterThanOrEqual(
        totalEvents,
      );
    });
  }

  it('leaves room for the pause/resume/extend lifecycle events too', () => {
    // A commissioner who pauses and resumes twice, and extends a clock,
    // adds 5 more events on top of the picks. The headroom must absorb
    // that without pushing the first pick out of the buffer.
    const totalPicks = 12 * 21;
    const noisyLifecycle = DRAFT_STARTED + 2 + 2 + 1;
    expect(eventBufferCapacityFor(totalPicks)).toBeGreaterThanOrEqual(
      totalPicks + noisyLifecycle,
    );
  });
});

describe('RingBuffer at the computed capacity — end to end', () => {
  it('a full 12x21 draft never evicts, so seq 1 is still resumable at the final pick', () => {
    // This is the actual failure reproduced at the buffer level: append
    // every event of the draft, then ask for everything since the very
    // beginning. Pre-fix (capacity 200) this returned `too_old`.
    const totalPicks = 12 * 21;
    const buffer = new RingBuffer<{ seq: number }>(
      eventBufferCapacityFor(totalPicks),
    );

    for (let seq = 1; seq <= totalPicks + DRAFT_STARTED; seq += 1) {
      buffer.append({ seq });
    }

    const result = buffer.getEventsSinceSeq(0);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.events.length).toBe(totalPicks + DRAFT_STARTED);
      expect(result.events[0]?.seq).toBe(1);
    }
  });

  it('the OLD flat capacity of 200 demonstrably loses the start of that draft', () => {
    // Guard against someone "simplifying" this back to a constant: this
    // test documents the exact behaviour that shipped, so the regression
    // is legible rather than folklore.
    const totalPicks = 12 * 21;
    const buffer = new RingBuffer<{ seq: number }>(200);

    for (let seq = 1; seq <= totalPicks + DRAFT_STARTED; seq += 1) {
      buffer.append({ seq });
    }

    // Whole-object assertion, matching RingBuffer.test.ts's existing
    // style — it sidesteps discriminated-union narrowing AND pins the
    // exact eviction: 253 events into a 200 buffer drops seqs 1-53, so
    // the oldest survivor is 54. That number IS the bug — a client
    // resuming from seq 0 cannot be served, and the fold refuses to
    // start at 54.
    expect(buffer.getEventsSinceSeq(0)).toEqual({
      ok: false,
      reason: 'too_old',
      oldestAvailableSeq: 54,
    });
  });
});
